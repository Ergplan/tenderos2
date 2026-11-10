// Checks for "What wins" (web/src/cfd/winning.js): the evening price of the chosen hours, the
// Pool's net flow falling as the strike price rises and crossing zero at the evening price, the
// award verdict at three quotes, and the risks list with the DSM charge sized. Run from the
// repository root:   node tools/check_cfd_winning.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultCfdState, fillBenchmarks, runModel } from "../web/src/cfd/model.js";
import { runCfdFinance } from "../web/src/cfd/finance.js";
import { TENDER } from "../web/src/cfd/terms.js";
import { cfdRisks, eveningAverage, eveningMcp, poolAt, poolTable, whatWins } from "../web/src/cfd/winning.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const s = fillBenchmarks(defaultCfdState());
s.inputs.solarMw = 30;
const pricer = (inputs, sim) => runCfdFinance({ ...s, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
const model = runModel(s, prices, { price: pricer });
const finance = runCfdFinance(s, model);

const mcp = eveningMcp(model);
const avg = eveningAverage(model);
assert.ok(mcp > 5 && mcp < 12, `the two chosen evening hours average a plausible price: ₹${mcp}`);
assert.ok(avg < mcp, "every evening hour averages less than the two chosen (the dearest)");
// the Pool's flow: collects below the evening price, pays above, monotonic in the strike price
const at = [6, 7, 8, 9, 10].map((sp) => poolAt(model, sp));
for (let k = 1; k < at.length; k += 1) assert.ok(at[k].paysCr > at[k - 1].paysCr, "the Pool pays more as the strike price rises");
assert.ok(poolAt(model, mcp - 1).paysCr < 0 && poolAt(model, mcp + 1).paysCr > 0, "the Pool collects below the evening price and pays above it");
assert.ok(Math.abs(poolAt(model, mcp).paysCr) < 0.05 * Math.abs(poolAt(model, mcp + 1).paysCr) + 1e-6, "the Pool is about neutral at the evening price");
assert.ok(Math.abs(poolAt(model, 7).allCr - poolAt(model, 7).perMwCr * TENDER.totalMw) < 1e-9, "the whole tender scales per MW");
// the table around the market, the bid's own quote marked
const rows = poolTable(model, finance.tariff);
assert.ok(rows.length >= 8 && rows.filter((r) => r.yours).length === 1, "a table around the market with the quote marked");
for (let k = 1; k < rows.length; k += 1) assert.ok(rows[k].sp > rows[k - 1].sp, "sorted by strike price");
// the verdict at three quotes
const low = whatWins({ model, finance: { tariff: mcp - 1 } });
const mid = whatWins({ model, finance: { tariff: mcp + 0.2 } });
const high = whatWins({ model, finance: { tariff: 26 } });
assert.equal(low.tone, "good"); assert.ok(/costs the corpus nothing/.test(low.verdict), low.verdict);
assert.ok(["warn", "bad"].includes(mid.tone), mid.verdict);
assert.equal(high.tone, "bad"); assert.ok(/restrict the award/.test(high.verdict) && high.pool.ratio > 3, high.verdict);
// the risks: DSM sized, availability per point, the designated hours, the fees, the penalty, the award, the market
const risks = cfdRisks({ state: s, model, finance });
const ids = risks.map((r) => r.id);
for (const id of ["dsm", "availability", "designated", "fees", "weekly", "award", "market"]) assert.ok(ids.includes(id), `risk ${id}`);
const dsm = risks.find((r) => r.id === "dsm");
assert.ok(dsm.cr > 0 && dsm.cr < 0.1 * finance.rows[1].revenue, `the DSM charge is sized and small against revenue: ₹${dsm.cr.toFixed(2)} cr`);
assert.ok(/Amendment-04/.test(dsm.detail) && /₹\d/.test(dsm.title), "the DSM risk cites Amendment-04 with a figure");
for (const r of risks) assert.ok(r.title && r.detail && r.cite, `${r.id} complete`);
console.log(`check_cfd_winning: ok (evening ₹${mcp.toFixed(2)}, all evening hours ₹${avg.toFixed(2)}; at ₹7 the Pool collects ₹${(-poolAt(model, 7).allCr).toFixed(0)} cr a year on 500 MW, at ₹10 it pays ₹${poolAt(model, 10).allCr.toFixed(0)} cr; DSM ₹${dsm.cr.toFixed(2)} cr a year on ${model.inputs.contractedMw} MW)`);
