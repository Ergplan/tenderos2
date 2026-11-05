// Checks for the SECI CfD-I bid priced by the shared financial engine (web/src/cfd/finance.js):
// the adapter's plant and costs (SECI's charges and the guarantees' cost as other project cost),
// the operation's energy carried year by year, the CfD cost lines (charging power, exchange fees,
// the Letter of Credit and the weekly penalty, the last two moving with the strike price, the
// bidder's 50% of the RECs), the solved strike price against the screening model, the tariff
// lock and the quote check, and the Live model request. Run from the repository root:
//   node tools/check_cfd_finance.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "../web/src/rtc/engine.js";
import { CFD_COST_DEFAULTS, CFD_FIN_DEFAULTS, defaultCfdState, fillBenchmarks, lcCr, mergeCfdState, rfsAmounts, runModel, simulate } from "../web/src/cfd/model.js";
import { MODEL_NOTES, cfdEngineInputs, cfdLiveRequest, cfdModelExport, quoteOf, quotedStrikeReturns, runCfdFinance } from "../web/src/cfd/finance.js";
import { liveModelInput } from "../web/lib/liveModel.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));

// ---- the state carries the finance terms, the construction schedule and the locks
const base = defaultCfdState();
assert.deepEqual(base.fin, CFD_FIN_DEFAULTS);
assert.deepEqual(base.costs, CFD_COST_DEFAULTS);
assert.deepEqual([base.locks, base.tariffLocked], [{}, false]);
assert.equal(CFD_FIN_DEFAULTS.repayment, E.DEFAULT_FINANCE.repayment);
const merged = mergeCfdState({ version: 1, inputs: { contractedMw: 120 }, fin: { repayment: "annuity" }, locks: { "fin.repayment": true }, tariffLocked: true });
assert.ok(merged.fin.repayment === "annuity" && merged.fin.wdvRate === 0.4 && merged.locks["fin.repayment"] && merged.tariffLocked && merged.costs.drawdown === "linear", "a saved bid merges over the defaults");

// ---- the benchmark 100 MW bid
const state = fillBenchmarks(defaultCfdState());
state.inputs.effectiveDate = "2027-02-01";
const model = runModel(state, prices);
assert.ok(model.sp > 0 && model.opYears.length === 15, "the screening model and 15 operating years");
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
near(sum(model.opYears, "deliveredMwh"), sum(model.sim.years, "deliveredMwh"), 1e-12, "the operating years carry the Contract Years' energy");
near(sum(model.opYears, "marketCostCr"), sum(model.sim.years, "marketCostCr"), 1e-9, "and their charging cost");
assert.equal(model.opYears.reduce((a, y) => a + y.weeks.length, 0), model.sim.years.reduce((a, y) => a + y.weeks.length, 0), "every week assigned once");

const eng = cfdEngineInputs(state, model);
const i = model.inputs;
const X = i.contractedMw;
assert.deepEqual(eng.sizes, { solarMw: i.solarMw, windMw: 0, bessMw: X * i.essMwPerMw, bessMwh: X * i.essMwhPerMw }, "the plant");
const rfs = rfsAmounts(i);
near(eng.costs.evacuationCr, X * i.evacuationCrPerMw, 1e-12, "the line to the substation");
assert.ok(eng.costs.otherCapexCr > rfs.seciChargesCr && eng.costs.otherCapexCr < rfs.seciChargesCr + rfs.emdCr + rfs.pbgCr, "SECI's charges plus the guarantees' cost");
assert.equal(eng.fin.years, 15);
assert.equal(eng.fin.tariffEscalation, 0, "the strike price is fixed for the term");
assert.deepEqual([eng.fin.lcMinPrice, eng.fin.lcDays, eng.fin.cfdPenaltyMultiple, eng.fin.lcCostPct], [10, 30, 1.5, i.lcCostPct]);
assert.equal(eng.ops.length, 15);
eng.ops.forEach((o, k) => {
  const y = model.opYears[k];
  near(o.deliveredMWh, y.deliveredMwh, 1e-12, `year ${k + 1} energy supplied`);
  near(o.demandMWh, X * 2 * y.days, 1e-12, `year ${k + 1} energy required`);
  near(o.excessMWh, y.merchantMwh, 1e-12, `year ${k + 1} surplus sold`);
  near(o.chargingCostCr, y.marketCostCr + y.groupCostCr, 1e-12, `year ${k + 1} charging cost`);
  near(o.surplusRevenueCr, y.merchantRevCr + (i.recPrice * y.recMwh * 0.5) / 1e7, 1e-12, `year ${k + 1} surplus revenue with the bidder's 50% of the RECs`);
  near(o.pxFeesCr, i.pxFee * (y.deliveredMwh + y.merchantMwh) * 1e-4, 1e-12, `year ${k + 1} exchange fees`);
  assert.equal(o.lcMw, X);
});
// the capex of the engine: hard cost with the other project cost, pre-operative on top
near(eng.costs.otherCapexCr + eng.costs.evacuationCr + eng.sizes.bessMwh * eng.costs.bessCrPerMwh + eng.sizes.solarMw * eng.costs.solarCrPerMw, E.capexCr(eng.sizes, eng.costs).hard, 1e-9, "hard cost");

// ---- the engine's model: the strike price for the target IRR, the CfD lines in the rows
const fin = runCfdFinance(state, model);
assert.ok(fin.rows.length === 15 && !fin.tariffLocked);
near(fin.equityIrr, i.targetEquityIrr, 1e-5, "the solved strike price gives the target equity IRR");
assert.ok(fin.tariff > model.sp * 0.85 && fin.tariff < model.sp * 1.25, `the engine's strike price (${fin.tariff.toFixed(3)}) is in the screening model's band (${model.sp.toFixed(3)})`);
const r1 = fin.rows[0];
near(r1.energyRevenue, (r1.deliveredMu * 1000 * fin.tariff) / 1e4, 1e-9, "CfD revenue = strike price × energy supplied");
near(r1.charging, eng.ops[0].chargingCostCr, 1e-12, "charging power in the operating cost");
near(r1.pxFees, eng.ops[0].pxFeesCr, 1e-12, "exchange fees in the operating cost");
near(r1.opex, r1.om + r1.insurance + r1.other + r1.charging + r1.pxFees + r1.lcCost, 1e-9, "the operating cost adds up");
assert.equal(r1.lcCost, 0, "no Letter of Credit cost when the strike price is above ₹10/kWh");
assert.equal(quoteOf(fin.tariff), Math.ceil(fin.tariff * 100 - 1e-9) / 100, "the quote rounds up to two decimals");
assert.ok(fin.totals.charging > 0 && fin.totals.cfdPenalty === 0, "the benchmark bid meets every week");

// ---- the Letter of Credit and the weekly penalty move with the strike price
{
  const low = runCfdFinance(state, model, { tariffLocked: true, tariff: 6 });
  near(low.rows[0].lcCost, (i.lcCostPct * 2000 * X * (10 - 6) * 30) / 1e7, 1e-9, "LC cost = cost % × 2000 × MW × (10 − SP) × 30");
  near(low.rows[0].lcCost / i.lcCostPct, lcCr(X, 6), 1e-9, "the LC itself as model.js works it out");
  assert.ok(low.equityIrr < i.targetEquityIrr - 0.01, "locked below the solved price: the IRR falls short");
  // a bid that falls short in some weeks: no bought power, little own RE
  const s2 = fillBenchmarks(defaultCfdState());
  s2.inputs.effectiveDate = "2027-02-01";
  s2.inputs.useMarket = false;
  s2.inputs.solarMw = 60;
  const m2 = runModel(s2, prices);
  const weeks = m2.opYears.reduce((a, y) => a + y.weeks.filter((w) => w.beyondMwh > 1e-9).length, 0);
  assert.ok(weeks > 0, "weeks short beyond the tolerance");
  const e2 = cfdEngineInputs(s2, m2);
  assert.equal(e2.ops.reduce((a, o) => a + o.penaltyWeeks.length, 0), weeks, "every penalised week handed to the engine");
  const at5 = runCfdFinance(s2, m2, { tariffLocked: true, tariff: 5 });
  const at8 = runCfdFinance(s2, m2, { tariffLocked: true, tariff: 8 });
  const expect5 = e2.ops.map((o) => o.penaltyWeeks.reduce((a, w) => a + 1.5 * Math.max(0, w.ref - 5) * w.beyondMwh, 0) * 1e-4);
  at5.rows.forEach((r, k) => near(r.cfdPenalty, expect5[k], 1e-9, `year ${k + 1} penalty at ₹5`));
  assert.ok(sum(at5.rows, "cfdPenalty") > sum(at8.rows, "cfdPenalty"), "a lower strike price means a larger penalty");
  assert.ok(sum(at5.rows, "penalty") === sum(at5.rows, "cfdPenalty"), "no other penalty in a CfD bid");
}

// ---- the tariff lock and the quote check
{
  const locked = { ...state, tariffLocked: true, fin: { ...state.fin, tariff: Number((fin.tariff - 1).toFixed(2)) } };
  const f2 = runCfdFinance(locked, model);
  assert.ok(f2.tariffLocked && Math.abs(f2.tariff - locked.fin.tariff) < 1e-12 && f2.equityIrr < i.targetEquityIrr, "locked: the returns at the fixed price");
  const q = quotedStrikeReturns(state, model, fin, quoteOf(fin.tariff));
  assert.equal(q.status, "ok");
  const qLow = quotedStrikeReturns(state, model, fin, Number((fin.tariff - 2).toFixed(2)));
  assert.ok(qLow.status !== "ok" && qLow.equityIrr < i.targetEquityIrr && /below/.test(qLow.message), "a quote below the solved price is flagged");
  assert.equal(quotedStrikeReturns(state, model, fin, null), null);
}

// ---- the finance terms reach the engine: annuity repayment with a moratorium, construction months
{
  const s3 = { ...state, fin: { ...state.fin, repayment: "annuity", graceYears: 1, omStockMonths: 1, sparesPctOm: 0.15, dsraMonths: 6 }, costs: { constructionMonths: 15, drawdown: "sCurve", drawOrder: "proRata" } };
  const f3 = runCfdFinance(s3, model);
  assert.equal(f3.rows[0].principal, 0, "moratorium: no principal in year 1");
  assert.ok(f3.construction && f3.construction.months === 15 && f3.capex.idc > 0, "the IDC from the construction schedule");
  assert.ok(f3.rows[0].omStock > 0 && f3.rows[0].spares > 0 && f3.rows[0].dsraBalance > 0, "working capital and the reserve");
  assert.ok(f3.tariff > fin.tariff, "the IDC and the reserve raise the strike price");
}

// ---- market years after the term
{
  const s4 = fillBenchmarks(defaultCfdState());
  s4.inputs.effectiveDate = "2027-02-01";
  s4.inputs.afterTerm = "merchant";
  s4.inputs.merchantYears = 3;
  const m4 = runModel(s4, prices);
  const f4 = runCfdFinance(s4, m4);
  assert.equal(f4.rows.length, 18);
  assert.ok(f4.rows[15].energyRevenue === 0 && f4.rows[15].surplusRevenue > f4.rows[14].surplusRevenue && f4.rows[15].lcCost === 0, "after the term: no CfD revenue, the supply sold at market prices, no LC");
  assert.ok(f4.tariff < fin.tariff, "market years after the term lower the strike price");
}

// ---- the workbook request
{
  const req = cfdLiveRequest({ state, model, finance: fin });
  const input = liveModelInput(JSON.parse(JSON.stringify(req)));
  assert.ok(input && input.ops.length === 15 && input.costs.otherCapexCr > 0 && input.fin.lcCostPct === i.lcCostPct && input.fin.lcMinPrice === 10 && input.fin.cfdPenaltyMultiple === 1.5, "the request survives the whitelist");
  assert.ok(input.ops.every((o) => Array.isArray(o.penaltyWeeks) && o.lcMw === X), "the CfD lines per year");
  assert.equal(input.tariffLabel, "Strike price");
  assert.ok(input.gen.solar && Math.abs(input.gen.solar.cuf - i.solarCuf) < 0.01, "the solar generation build-up at the bidder's CUF");
  const exp = cfdModelExport({ state, model, finance: fin });
  assert.ok(exp.rows.length === 15 && exp.live && exp.cover.outputs.some(([l]) => /Letter of Credit/.test(l)) && exp.capex.some(([l]) => /SECI/.test(l)), "the export's cover and capex");
  assert.ok(exp.inputs.some((x) => x.group === "Financing terms" && x.input === "Repayment") && exp.cover.notes.length >= MODEL_NOTES.length);
  assert.ok(!/undefined|NaN/.test(JSON.stringify(exp.cover)), "nothing undefined on the cover");
}
// one price: with the engine as the pricer, the model carries the engine's strike price (what the
// Size step, the chip, the agent and the forms show) and keeps the screening figure beside it
{
  const priced = runModel(state, prices, { price: (inputs, sim) => runCfdFinance({ ...state, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null }) });
  assert.ok(Math.abs(priced.sp - fin.tariff) < 1e-9, `the priced model's strike price is the engine's (${priced.sp} vs ${fin.tariff})`);
  assert.ok(priced.screening.sp > 0 && Math.abs(priced.screening.sp - model.sp) < 1e-9, "the screening price is kept beside it");
  assert.ok(Math.abs(priced.fin.equityIrr - fin.equityIrr) < 1e-9 && priced.bid === Math.ceil(fin.tariff * 100 - 1e-9) / 100, "the returns and the quote follow the engine");
}
console.log(`CfD finance checks passed: strike price ₹${fin.tariff.toFixed(4)}/kWh for a ${(i.targetEquityIrr * 100).toFixed(0)}% equity IRR (screening ₹${model.sp.toFixed(4)}), capex ₹${fin.capex.total.toFixed(1)} cr, min DSCR ${fin.minDscr.toFixed(2)}`);

// ---- the strike-price levers (the What-if step)
{
  const { cfdLeverEffects, leversOf, withCfdLever } = await import("../web/src/cfd/levers.js");
  const levers = leversOf(state, model);
  assert.ok(levers.length >= 25 && levers.some((l) => l.operation) && levers.some((l) => !l.operation), "operation and finance levers");
  assert.ok(!levers.some((l) => l.key === "windCuf"), "no wind: no wind levers");
  const moved = withCfdLever(state, levers.find((l) => l.key === "essCrPerMwh"), 1.2);
  assert.ok(moved.inputs.essCrPerMwh === 1.2 && !moved.filled.essCrPerMwh, "a lever applied clears the benchmark mark");
  const fewer = { ...state, inputs: { ...state.inputs } };
  const subset = ["essCrPerMwh", "targetEquityIrr", "solarCuf"];
  let progress = 0;
  const res = await cfdLeverEffects(fewer, model, prices, { target: fin.tariff - 1, onProgress: () => { progress += 1; }, tick: async () => {} });
  near(res.base, fin.tariff, 1e-9, "the base is the solved strike price");
  assert.ok(progress >= levers.length - 1);
  const by = Object.fromEntries(res.levers.map((l) => [l.key, l]));
  for (const k of subset) assert.ok(by[k], `lever ${k} computed`);
  assert.ok(by.essCrPerMwh.priceUp > res.base && by.essCrPerMwh.priceDown < res.base, "dearer battery, higher strike price");
  assert.ok(by.targetEquityIrr.slope > 0, "a higher target IRR needs a higher price");
  assert.ok(by.solarCuf.priceUp < res.base, "a better solar resource lowers the price (re-simulated)");
  assert.ok(by.essCrPerMwh.reach < state.inputs.essCrPerMwh && by.essCrPerMwh.reachable, "the battery price that alone reaches ₹1 less");
  assert.ok(res.levers[0].perStep >= res.levers[res.levers.length - 1].perStep || Math.abs(res.levers[0].perStep) >= Math.abs(res.levers[res.levers.length - 1].perStep), "biggest movers first");
}
console.log("CfD lever checks passed");
