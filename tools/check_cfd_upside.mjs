// Checks for the Upside step of the CfD bid (web/src/cfd/upside.js): the bid's own case is the
// bid's financial model to the paisa; a plan's solar and battery reach the day-by-day operation
// and the engine (cost at the SCD, later tranches as capital spend in operation at the falling
// price, their running cost); the battery added in a later year fades from its own year; the
// stresses do what they say; the sweep ends with a best plan, the bid lowered instead, and
// suggestions that cite the tender. Run from the repository root:
//   node tools/check_cfd_upside.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultCfdState, fillBenchmarks, fillWinning, modelInputs, priceBook, profiles, runModel, simulate, socWindow } from "../web/src/cfd/model.js";
import { runCfdFinance } from "../web/src/cfd/finance.js";
import { applyPlan, caseSummary, cleanPlan, evaluatePlan, planLabel, strikeWithSolar, stressPlan, suggestionsOf, sweepSummary, upsideContext, upsideSettings, upsideSweep } from "../web/src/cfd/upside.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));

// ---- settings and plans
assert.deepEqual(upsideSettings({ batteryDecline: 9, debtShare: -1, dayInjection: false, trancheMwhPerMw: 0, junk: 1 }), { batteryDecline: 0.5, debtShare: 0, dayInjection: false, trancheMwhPerMw: 0.05, maxSolarPerMw: 1, middayStress: -0.05 });
assert.equal(upsideSettings().debtShare, null, "the bid's own debt share unless set");
assert.deepEqual(cleanPlan({ solarMw: -5, battery: [{ year: 5, mwh: 20 }, { year: 3, mwh: 10 }, { year: 5, mwh: 5 }, { year: 40, mwh: 9 }, { year: 2, mwh: 0 }] }), { solarMw: 0, battery: [{ year: 3, mwh: 10 }, { year: 5, mwh: 25 }] });
assert.equal(planLabel({ solarMw: 50, battery: [{ year: 5, mwh: 75 }, { year: 6, mwh: 75 }] }), "+50 MWac solar, +75 MWh battery a year, years 5 to 6");
assert.equal(planLabel({}), "The bid as it stands");

// ---- a bid with little own solar and bought charging power (the shape the step is for)
const state = fillWinning(fillBenchmarks(defaultCfdState()));
state.inputs = { ...state.inputs, contractedMw: 150, effectiveDate: "2027-02-01", solarMw: 15, useGroup: true, groupPrice: 2.5, essCrPerMwh: 0.7, augmentation: "annual" };
state.filled = { ...state.filled, solarMw: false };
const model = runModel(state, prices);
const finance = runCfdFinance(state, model);
const ctx = upsideContext(state, prices, {});
assert.ok(ctx && ctx.years === 15 && ctx.X === 150);
near(ctx.tariff, finance.tariff, 1e-12, "the cases are priced at the bid's strike price");
near(ctx.base.equityIrr, finance.equityIrr, 1e-9, "the bid's own case is the bid's equity IRR");
near(ctx.base.costCr, finance.capex.total, 1e-9, "and its project cost");
near(ctx.base.projectIrr, finance.projectIrr, 1e-9, "and its project IRR");
assert.equal(ctx.base.laterCapexCr, 0);
assert.ok(ctx.base.addCostCr === undefined && ctx.base.label === "The bid as it stands");

// ---- more own solar: the operation and the cost follow
const s50 = evaluatePlan(ctx, { solarMw: 50 });
near(s50.addCostCr / 50, state.inputs.solarCrPerMw, 0.12, "the solar's cost with its pre-operative share and IDC, no line");
assert.ok(s50.boughtCrYr < ctx.base.boughtCrYr - 1, "own solar replaces bought charging power");
assert.ok(s50.daySoldMuYr > ctx.base.daySoldMuYr && s50.dayPrice > 1 && s50.dayPrice < 6, `surplus sold in the day: ${s50.daySoldMuYr} MU at ₹${s50.dayPrice}`);
assert.ok(s50.model.inputs.solarMw === 65 && s50.batterySoldMuYr === 0);
assert.ok(Number.isFinite(s50.addProjectIrr) && (s50.addEquityIrr === null || Number.isFinite(s50.addEquityIrr)), `the addition's own returns, before debt ${s50.addProjectIrr} and on its equity ${s50.addEquityIrr}`);
near(s50.finance.debt - ctx.base.finance.debt, state.inputs.debtFraction * s50.addCostCr, 0.02, "the bid's debt share on the addition by default");

// ---- a battery tranche in year 6: capital spend in operation at the falling price, fading from its own year
const B = 75;
const b6 = evaluatePlan(ctx, { solarMw: 50, battery: [{ year: 6, mwh: B }] });
near(b6.addCostCr, s50.addCostCr, 1e-6, "nothing more at the SCD");
near(b6.laterCapexCr, B * state.inputs.essCrPerMwh * 0.9 ** 5, 1e-9, "the tranche at 10% a year off the battery price");
near(b6.finance.rows[5].augCapex - s50.finance.rows[5].augCapex, b6.laterCapexCr, 1e-9, "spent in year 6");
assert.ok(b6.finance.rows[4].pxFees === s50.finance.rows[4].pxFees && b6.finance.rows[6].pxFees > s50.finance.rows[6].pxFees, "its O&M and insurance run from its year");
{
  const sold = (c, y) => c.model.opYears[y - 1].extraSoldMwh;
  assert.ok(sold(b6, 5) === 0 && sold(b6, 6) > 0 && sold(b6, 15) > 0, "sold from year 6");
  // the usable energy of the tranche in a year: fresh in year 6, 2% a year less after
  const inputs = modelInputs(b6.model.state);
  assert.deepEqual(inputs.extraEssByYear[6], B / 150);
  const day = simulate(inputs, priceBook(prices, inputs.sellMarket), profiles(inputs), { record: [365 * 5 + 200, 365 * 13 + 200] }).days;
  const out = (k) => day[k].extraOut.reduce((a, v) => a + v, 0);
  const usable = (year) => B * socWindow(inputs) * (1 - inputs.essDegradation * (year - 6));
  assert.ok(out(365 * 5 + 200) <= usable(6) + 1e-6 && out(365 * 13 + 200) <= usable(14) + 1e-6 && usable(14) < usable(6), `a day's sale within the tranche's usable energy, faded from its own year: ${out(365 * 5 + 200)} of ${usable(6)}, ${out(365 * 13 + 200)} of ${usable(14)}`);
  assert.ok(day[365 * 5 + 200].extraOut.every((v, h) => v === 0 || (h >= 18 && !day[365 * 5 + 200].chosen.includes(h))), "sold in the evening hours outside the two peak hours");
}
const b1 = evaluatePlan(ctx, { solarMw: 50, battery: [{ year: 1, mwh: B }] });
assert.ok(b1.laterCapexCr === 0 && b1.addCostCr > s50.addCostCr + B * state.inputs.essCrPerMwh * 0.99, "a tranche at the SCD is project cost");
assert.ok(b6.laterCapexCr < B * state.inputs.essCrPerMwh, "and the later one is cheaper");

// ---- the stresses
const st = stressPlan(ctx, { solarMw: 50 });
assert.ok(st.noDayInjection.daySoldMuYr < 0.05 * s50.daySoldMuYr + 0.01 && st.noDayInjection.curtailedMuYr > s50.curtailedMuYr + 1 && st.noDayInjection.equityIrr < s50.equityIrr, "no injection in solar hours: the surplus is curtailed");
near(st.noDayInjection.boughtCrYr, s50.boughtCrYr, 0.02, "and the bid's own charging is as before");
assert.ok(st.middayPrices.dayPrice < s50.dayPrice && st.middayPrices.equityIrr < s50.equityIrr, "midday prices falling");
near(st.fromEquity.debtCr, ctx.base.debtCr, 1e-4, "paid from equity: the bid's debt only");
assert.ok(st.fromEquity.equityCr > s50.equityCr + 0.5 * s50.addCostCr && st.fromEquity.equityIrr < s50.equityIrr, "more equity, a lower equity IRR");
near(evaluatePlan(upsideContext(state, prices, { debtShare: 0.5 }), { solarMw: 50 }).debtCr - ctx.base.debtCr, 0.5 * s50.addCostCr, 0.02, "the debt share on the addition as set");

// ---- the bid lowered instead
const lower = strikeWithSolar(ctx, 50);
assert.ok(lower > 0 && (s50.equityIrr > ctx.base.equityIrr) === (lower < ctx.tariff), `a higher IRR at the bid's price is a lower price at the bid's IRR: ₹${lower} vs ₹${ctx.tariff}`);

// ---- the sweep
let ticks = 0;
const r = await upsideSweep(state, prices, {}, { onProgress: () => { ticks += 1; }, pause: async () => {} });
assert.ok(r && ticks >= r.cases.length - 1 && r.solar.length >= 2 && r.timing.length >= 3, `${r.solar.length} solar sizes, ${r.timing.length} battery years`);
assert.ok(r.solar.every((c, k) => c.plan.solarMw === 25 * (k + 1)), "solar in steps of 25 MWac for 150 MW");
assert.ok(r.best.equityIrr >= Math.max(...r.solar.map((c) => c.equityIrr)) - 1e-9 && r.best.equityIrr >= r.base.equityIrr, "the best plan is at least the best solar");
assert.ok(r.bestValue.equityNpvCr >= r.best.equityNpvCr - 1e-6, "the plan with the most value at the target IRR");
assert.ok(r.timing.every((c) => Number.isFinite(c.stepEquityIrr) || c.stepEquityIrr === null), "each battery year with the tranche's own return");
if (r.bestSolar) {
  assert.ok(r.stress.bestSolar.noDayInjection && r.stress.bestSolar.middayPrices && r.stress.bestSolar.fromEquity && r.lowerBid && r.lowerBid.solarMw === r.bestSolar.plan.solarMw, "the best solar stressed, and priced as a lower bid");
}
const kinds = r.suggestions.map((s) => s.kind);
assert.ok(kinds.includes("rule") && (kinds.includes("do") || kinds.includes("avoid")) && r.suggestions.every((s) => s.title && s.detail), "suggestions in sentences");
assert.ok(r.suggestions.filter((s) => s.kind === "rule").every((s) => s.cite && s.cite.clause && s.cite.page > 0 && s.cite.quote), "the tender's rules cited with clause and page");
assert.deepEqual(suggestionsOf(r).map((s) => s.title), r.suggestions.map((s) => s.title));
const plain = sweepSummary(r);
assert.ok(JSON.parse(JSON.stringify(plain)).base.equityIrr === Number(r.base.equityIrr.toFixed(4)) && !("finance" in plain.base) && plain.solar.length === r.solar.length, "the sweep as plain data");
assert.equal(caseSummary(null), null);
{
  // stopped early: what was done is returned
  let n = 0;
  const part = await upsideSweep(state, prices, {}, { shouldStop: () => { n += 1; return n > 2; }, pause: async () => {} });
  assert.ok(part.stopped && part.solar.length === 2 && part.timing.length === 0);
}
{
  // a battery price that does not fall: no year pays more than buying at the SCD does in cost
  const flat = await upsideSweep(state, prices, { batteryDecline: 0 }, { pause: async () => {} });
  const cost = (c) => c.laterCapexCr || c.addCostCr - (flat.bestSolar || flat.base).addCostCr || 0;
  assert.ok(flat.timing.slice(1).every((c) => Math.abs(c.laterCapexCr - B * state.inputs.essCrPerMwh) < 1e-6), `the same price in every year: ${flat.timing.map(cost).join()}`);
}

// ---- a plan made the bid's own
const applied = applyPlan(state, { solarMw: 50, battery: [{ year: 1, mwh: 75 }, { year: 6, mwh: 75 }] });
assert.ok(applied.state.inputs.solarMw === 65 && applied.state.inputs.extraEssMwhPerMw === 0.5 && applied.state.filled.solarMw === false, "the solar and the SCD tranche become the bid's plant");
assert.deepEqual(applied.kept, [{ year: 6, mwh: 75 }], "later tranches stay with the Upside step");

const pc = (v) => `${(v * 100).toFixed(1)}%`;
console.log(`CfD upside checks passed (${r.cases.length} cases; bid ${pc(r.base.equityIrr)} at ₹${r.tariff.toFixed(2)}; best ${r.best.label}: ${pc(r.best.equityIrr)}${r.lowerBid ? `; or ₹${r.lowerBid.tariff.toFixed(2)} at the same IRR` : ""})`);
