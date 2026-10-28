// Checks for the SECI results in Recent tenders (web/src/market/seed.js), read from SECI's result
// notices: each record adds up the way an e-reverse auction does, and points at its notice.
// Run from the repository root:   node tools/check_market.mjs
import assert from "node:assert/strict";
import { SECI_RESULTS, latest, tariffRange, weightedTariff } from "../web/src/market/seed.js";

assert.ok(SECI_RESULTS.length >= 6);
const ids = new Set();
for (const r of SECI_RESULTS) {
  assert.ok(!ids.has(r.id), `${r.id} once`);
  ids.add(r.id);
  assert.match(r.rfsNo, /^SECI\/C&P\/IPP\//, `${r.id}: an RfS number`);
  assert.match(r.auctionDate, /^20\d\d-\d\d-\d\d$/);
  assert.ok(!r.loaDate || r.loaDate >= r.auctionDate, `${r.id}: LoAs after the auction`);
  assert.ok(!r.rfsDate || r.rfsDate < r.auctionDate, `${r.id}: the RfS before the auction`);
  const sum = r.winners.reduce((a, w) => a + w.mw, 0);
  assert.ok(Math.abs(sum - r.awardedMw) < 0.01, `${r.id}: awards add up (${sum} vs ${r.awardedMw})`);
  assert.ok(r.awardedMw <= r.tenderedMw + 1e-9, `${r.id}: no more than tendered`);
  for (const w of r.winners) assert.ok(w.mw > 0 && w.mw <= w.bidMw + 1e-9, `${r.id}: ${w.name} awarded at most what it bid`);
  // the e-RA awards from the lowest tariff up: every unawarded bidder is at or above the highest awarded tariff
  const [lo, hi] = tariffRange(r);
  for (const o of r.others) assert.ok(o.tariff >= hi - 1e-9, `${r.id}: ${o.name} at ₹${o.tariff} not awarded below ₹${hi}`);
  assert.ok(lo > 1 && hi < 15);
  const wt = weightedTariff(r);
  assert.ok(wt >= lo - 1e-9 && wt <= hi + 1e-9);
  assert.ok(r.sources.some((s) => /^https:\/\/www\.seci\.co\.in\/uploads\/tenders\/bidders\/.+\.pdf$/.test(s.url)), `${r.id}: the notice's PDF`);
}
// the notices the user asked about
const xix = SECI_RESULTS.find((r) => r.id === "seci-wind-xix");
assert.deepEqual(tariffRange(xix), [3.67, 3.69]);
assert.equal(xix.awardedMw, 1200);
assert.equal(xix.winners[0].name, "K.P. Energy Limited");
assert.equal(latest("Wind").id, "seci-wind-xx");
console.log(`Market checks passed (${SECI_RESULTS.length} SECI results, ${SECI_RESULTS.reduce((a, r) => a + r.winners.length, 0)} awards)`);
