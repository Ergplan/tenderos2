// Checks the What-if step of the FDRE-X Bid tab (web/src/whatif/model.js on a case seeded from an
// FDRE-X bid): the demand only in the buyer's 4 hours, the battery held for them, the monthly
// rule with its free 10% and the penalty beyond, power bought within 5% while it costs less than
// the tariff, no sale in the solar hours without connectivity for them, the PSM discount and
// SECI's charges in the finance. Run: node tools/check_fdrex_whatif.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "../web/src/rtc/engine.js";
import { runWhatIf, whatIfFromBid } from "../web/src/whatif/model.js";
import { defaultFdrexBidState } from "../web/src/fdrex/bidState.js";
import { fdrexTerms, seciChargesCr } from "../web/src/fdrex/bidTerms.js";
import { fillBenchmarks } from "../web/src/bid/model.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
let st = defaultFdrexBidState();
st = fillBenchmarks(st, fdrexTerms(st.fdrex, prices));
st.lp = { sizes: { solarMw: 21, windMw: 89, bessMw: 74, bessMwh: 297 }, tariff: 8.93 };
const terms = fdrexTerms(st.fdrex, prices);
const seed = whatIfFromBid(st, terms);
assert.equal(seed.tender, "fdrex", "the case keeps its tender");
assert.equal(seed.contractedMw, 100);
assert.equal(seed.windMw, 89);
assert.ok(Math.abs(seed.bessHours - 297 / 74) < 1e-9);

const r = runWhatIf(seed, { prices });
const y1 = r.year1;
const H = y1.hourly;
const mask = r.terms.supplyMask;
// the demand: the contracted MW in the 4 hours a day and nothing else
assert.equal(y1.demandMWh, 100 * 4 * 365, "4 MWh per MW a day");
for (let t = 0; t < E.HOURS; t += 1) {
  if (!mask[t]) {
    assert.equal(H.floor[t], 0);
    assert.equal(H.discharge[t], 0, "the battery discharges only in the buyer's hours");
    assert.equal(H.bought[t], 0, "nothing bought outside them");
  }
  const h = t % 24;
  if (h >= 6 && h < 18) assert.equal(H.excess[t], 0, "no sale in the solar hours without connectivity for them");
  assert.ok(H.delivered[t] <= (mask[t] ? 100 : 0) + 1e-6 || !mask[t], "never more than the contracted MW in the buyer's hours");
}
// bought power: within 5% of each year's energy, only while it costs less than the tariff
for (const o of r.ops) assert.ok(o.purchaseShare <= 0.05 + 1e-9, `year ${o.year}: bought ${o.purchaseShare}`);
assert.ok(y1.purchaseMWh > 0, "some power bought on this plant");
assert.ok(Math.abs(r.ops[0].chargingCostCr - y1.purchaseCostCr) < 1e-9, "its cost in the operating costs");
const avgPrice = (y1.purchaseCostCr * 1e4) / y1.purchaseMWh;
assert.ok(avgPrice < r.fin.tariff, `bought at ₹${avgPrice.toFixed(2)} below the tariff`);
// the monthly rule: the penalised energy is the energy short beyond 90% of each month
const pen = y1.months.reduce((a, m) => a + Math.max(0, 0.9 * m.demandMWh - m.deliveredMWh), 0);
assert.ok(Math.abs(pen - y1.blockShortfallMWh) < 1e-6);
assert.equal(r.fin.blockPenaltyMultiple, 1.5);
assert.ok(Math.abs((r.atBid.rows[0].blockPenalty || 0) - y1.blockShortfallMWh * 1.5 * r.fin.tariff * 1e-4) < 0.01, "penalty at 1.5 × tariff");
assert.ok(["pass", "penalty"].includes(r.verdict), `verdict ${r.verdict}`);
// SECI's charges in the project cost; the PSM off by default
assert.ok(Math.abs(r.costs.otherCapexCr - seciChargesCr(r.sizes, 100)) < 1e-9);
assert.equal(r.ops[0].pxFeesCr, 0);
console.log(`100 MW: bought ${(y1.purchaseShare * 100).toFixed(2)}% at ₹${avgPrice.toFixed(2)}, penalised ${(y1.blockShortfallMWh / 1000).toFixed(2)} MU, tariff needed ₹${r.finance.tariffNeeded.toFixed(3)} (LP ₹8.93), verdict ${r.verdict}`);

// the PSM: ₹0.02/kWh off the energy supplied
const psm = runWhatIf({ ...seed, fdrex: { ...seed.fdrex, psm: true } }, { prices });
assert.ok(Math.abs(psm.ops[0].pxFeesCr - 0.02 * psm.year1.deliveredMWh * 1e-4) < 1e-9);
assert.ok(psm.finance.tariffNeeded > r.finance.tariffNeeded, "the PSM discount raises the tariff needed");
// no buying: more short, a higher tariff
const nobuy = runWhatIf({ ...seed, fdrex: { ...seed.fdrex, buy: false } }, { prices });
assert.equal(nobuy.year1.purchaseMWh, 0);
assert.ok(nobuy.year1.deliveredMWh < y1.deliveredMWh);
// connectivity in the solar hours: more sold
const day = runWhatIf({ ...seed, fdrex: { ...seed.fdrex, dayInjection: true } }, { prices });
assert.ok(day.year1.excessMWh >= y1.excessMWh);
// meet every month in full: no penalty, and a plant this size fails the hard rule
const hard = runWhatIf({ ...seed, fdrex: { ...seed.fdrex, shortfall: "hard" } }, { prices });
assert.equal(hard.fin.blockPenaltyMultiple, 0);
assert.equal(hard.year1.blockShortfallMWh, 0);
const big = runWhatIf({ ...seed, fdrex: { ...seed.fdrex, shortfall: "hard" }, bessMw: 140, bessHours: 4.5, windMw: 200 }, { prices });
assert.ok(big.checks.find((c) => c.id === "monthly").ok || big.verdict === "fail", "the hard check is reported");
// without the prices: evening hours, nothing bought, flagged
const noPrices = runWhatIf(seed, { prices: null });
assert.ok(noPrices.pricesPending);
assert.equal(noPrices.year1.purchaseMWh, 0);
// the live model carries the tender's rows
assert.ok(r.live.title.includes("SECI-FDRE-X"));
assert.ok("chargingCostCr" in r.live.ops[0] && r.live.otherCapexLabel);
// the RTC case is unchanged by the tender switch
const rtc = runWhatIf(whatIfFromBid({ ...st, fdrex: undefined }, terms));
assert.ok(rtc.year1.rules.peak && !rtc.year1.months, "an RTC case still runs the RTC dispatch");
console.log("FDRE-X What-if checks passed");
