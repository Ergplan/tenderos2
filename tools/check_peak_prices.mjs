// Checks for the "6 costliest hours each day" Peak Hours plan (web/src/seci/peakPrices.js): on the
// IEX price file the app serves, each day's 18:00–10:00 window gets exactly 6 Peak Hours, they are
// the window's highest-priced hours, and the plan reaches the sizing request (peakMask), the
// floors of the agent's charts and the What-if dispatch.
// Run from the repository root:   node tools/check_peak_prices.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "../web/src/rtc/engine.js";
import { costliestHours, hourRanges } from "../web/src/seci/peakPrices.js";
import { DEFAULT_SETTINGS, PACK, seciTerms } from "../web/src/seci/terms.js";
import { defaultSeciState } from "../web/src/seci/state.js";
import { fillBenchmarks, lpPayload, resourceProfiles } from "../web/src/bid/model.js";
import { floorsByHour } from "../web/src/seci/charts.js";
import { runWhatIf } from "../web/src/whatif/model.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url)));
const p = prices.markets.DAM.hourlyRsPerMwh;
const picked = costliestHours(prices);
assert.ok(picked, "the DAM prices pick the hours");
assert.equal(picked.mask.length, E.HOURS);
assert.equal(picked.mask.reduce((a, v) => a + v, 0), 365 * 6, "6 Peak Hours a day");
for (let d = 0; d < 365; d += 1) {
  const hours = Array.from({ length: 16 }, (_, k) => (d * 24 + 18 + k) % E.HOURS);
  const on = hours.filter((t) => picked.mask[t]);
  const off = hours.filter((t) => !picked.mask[t]);
  assert.equal(on.length, 6, `day ${d}: 6 hours`);
  assert.ok(Math.min(...on.map((t) => p[t])) >= Math.max(...off.map((t) => p[t])), `day ${d}: the picked hours are the costliest`);
}
for (let t = 0; t < E.HOURS; t += 1) {
  const h = E.HOUR_OF_DAY[t];
  if (h >= 10 && h < 18) assert.equal(picked.mask[t], 0, "never outside the window");
}
assert.ok(Math.abs(picked.share.reduce((a, s) => a + s, 0) - 6) < 1e-9, "the shares add up to 6 hours a day");
assert.ok(picked.pickedRsPerKwh > picked.windowRsPerKwh, "the picked hours cost more than the window on average");
assert.equal(hourRanges([18, 19, 20, 21, 22, 23]), "18:00–24:00");
assert.equal(hourRanges([22, 23, 0, 1]), "22:00–02:00");

// the default plan, with the prices: the sizing request holds those hours to the peak floor
assert.equal(DEFAULT_SETTINGS.peakPlan, "price");
let s = defaultSeciState();
s = { ...s, bid: { ...s.bid, baseMw: 200 } };
const terms = seciTerms(s.seci, prices);
s = fillBenchmarks(s, terms);
const payload = lpPayload(s, terms, resourceProfiles(s), null);
assert.deepEqual(payload.peakMask, Array.from(picked.mask), "the sizing gets the picked hours");
// without the prices: every window hour, as "Any 6 of the 16 hours"
const pending = seciTerms(s.seci, null);
assert.ok(pending.peak.pricesPending);
assert.equal(lpPayload(s, pending, resourceProfiles(s), null).peakMask.reduce((a, v) => a + v, 0), 365 * 16);

// the floors by hour of the agent's charts: the average day
const floors = floorsByHour(s, terms);
const m = PACK.model;
const expected = picked.share.reduce((a, f) => a + (f * m.peakFloor + (1 - f) * m.offpeakFloor) * 200, 0);
assert.ok(Math.abs(floors.reduce((a, v) => a + v, 0) - expected) < 1e-6);
assert.ok(floors[14] === m.offpeakFloor * 200, "14:00 is never a Peak Hour");

// What-if: the costliest hours hold 6 hours a day to 90%, not 16
const any = runWhatIf({ peakPlan: "any" }, { prices });
const price = runWhatIf({ peakPlan: "price" }, { prices });
const peakHours = (r) => r.year1.rules.peak.hours;
assert.equal(peakHours(any), 365 * 16);
assert.equal(peakHours(price), 365 * 6);
const met = (r) => r.year1.rules.peak.met / r.year1.rules.peak.hours;
console.log(`Peak price checks passed (most often ${hourRanges(picked.mostOften)}; ₹${picked.pickedRsPerKwh.toFixed(2)}/kWh picked vs ₹${picked.windowRsPerKwh.toFixed(2)} window; What-if peak blocks met ${(met(price) * 100).toFixed(1)}% with the costliest hours vs ${(met(any) * 100).toFixed(1)}% holding all 16, equity IRR ${(price.atBid.equityIrr * 100).toFixed(2)}% vs ${(any.atBid.equityIrr * 100).toFixed(2)}%)`);
