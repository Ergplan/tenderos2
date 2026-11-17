// Checks for the What-if and Upside steps of the SECI-FDRE-X bid (web/src/fdrex/levers.js,
// leverNotes.js, track.js, Freeze.jsx, upside.js, UpsideStep.jsx).
//   Levers: every lever is an input of FIELDS or a finance term, its range within the field's; the
//     inputs this tender does not have are not levers; a moved lever changes the tariff, in the
//     direction its note says.
//   Notes and bands: every lever and input has a note; none speaks of what CfD-I has and FDRE-X
//     does not; every chance band lies within the input's range.
//   Track: a reachable quote is reached with the surest moves first; an unreachable one is said
//     to be, with the floor; frozen and turned-down levers are left alone.
//   Upside: the bid's own case is the bid's financial model to the paisa; a battery tranche of a
//     later year is capital spend in that year at the falling price and sells in the evening hours
//     outside the buyer's four; day injection follows the bid (the tender asks for connectivity with
//     non-solar-hour access, so the default bid injects nothing in the day and the opposite is a
//     named what-if); the sweep ends with a best plan or says none pays; every suggestion's citation
//     is a term of terms.js.
// The bid: "Fill up for me please" (fillWinning) at 100 MW with 120 MWac of own solar, on the IEX
// price year the tab loads. Run from the repository root (about a minute):
//   node tools/check_fdrex_whatif.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BENCHMARKS, CFD_FIN_DEFAULTS, FIELDS, WINNING, defaultCfdState, fillWinning, modelInputs, priceBook, profiles, runModel, simulate, socWindow } from "../web/src/fdrex/model.js";
import { runCfdFinance } from "../web/src/fdrex/finance.js";
import { TENDER } from "../web/src/fdrex/tender.js";
import { termById } from "../web/src/fdrex/terms.js";
import { cfdLeverEffects, leversOf, priceOf, withCfdLever } from "../web/src/fdrex/levers.js";
import { LEVER_BANDS, LEVER_NOTES, explainLever, leverChance } from "../web/src/fdrex/leverNotes.js";
import { planTrack } from "../web/src/fdrex/track.js";
import { UPSIDE_DEFAULTS, applyPlan, caseSummary, cleanPlan, evaluatePlan, planLabel, strikeWithSolar, stressPlan, suggestionsOf, sweepSummary, upsideContext, upsideSettings, upsideSweep } from "../web/src/fdrex/upside.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const pc = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const prices = JSON.parse(read("../web/public/market/iex_hourly_prices.json"));
const none = async () => {};

/** The bid of the check, priced through the full financial model as the tab does. */
function bidOf(over = {}) {
  const filled = fillWinning(defaultCfdState());
  const state = { ...filled, inputs: { ...filled.inputs, contractedMw: 100, solarMw: 120, ...over }, filled: { ...filled.filled, solarMw: false } };
  const pricer = (inputs, sim) => runCfdFinance({ ...state, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
  const model = runModel(state, prices, { price: pricer });
  assert.ok(model && model.sim, "the bid is complete and modelled");
  return { state, model, finance: runCfdFinance({ ...state, tariffLocked: false }, model) };
}
const { state, model, finance } = bidOf();
assert.equal(state.inputs.dayInjection, false, "the filled bid has connectivity with non-solar-hour access only");
assert.ok(finance.tariff > 1 && finance.tariff < 30 && Math.abs(model.sp - finance.tariff) < 1e-9, `the bid's tariff: ₹${finance.tariff}`);
assert.equal(model.opYears.length, TENDER.termYears);

// ---------------------------------------------------------------- the levers
const levers = leversOf(state, model);
const GONE = ["groupPrice", "groupCharges", "useGroup", "recPrice", "lcCostPct", "reCodMonths"];
for (const l of levers) {
  if (l.key.startsWith("fin.")) {
    assert.ok(l.key.slice(4) in CFD_FIN_DEFAULTS, `${l.key} is a finance term`);
    assert.ok(l.value >= l.min && l.value <= l.max && l.step > 0, `${l.key} within its range`);
    continue;
  }
  const f = FIELDS.find((x) => x.key === l.key);
  assert.ok(f, `the lever ${l.key} is an input of FIELDS`);
  const lo = f.pct ? f.min / 100 : f.min;
  const hi = f.pct ? f.max / 100 : f.max;
  assert.ok(l.min >= lo - 1e-12 && l.max <= hi + 1e-12, `${l.key}: lever range [${l.min}, ${l.max}] within the field's [${lo}, ${hi}]`);
  assert.ok(l.value >= l.min - 1e-12 && l.value <= l.max + 1e-12 && l.step > 0, `${l.key}: its value within the range`);
  assert.equal(l.label, f.label);
}
for (const k of [...GONE, "contractedMw", "gstRate", "psm", "dayInjection"]) assert.ok(!levers.some((l) => l.key === k), `${k} is not a lever`);
assert.ok(!levers.some((l) => /^wind/.test(l.key) && l.key !== "windDegradation"), "no wind in the bid: its levers cannot move");
assert.ok(levers.find((l) => l.key === "tenorYears").max === TENDER.termYears && levers.find((l) => l.key === "essMwhPerMw").min === TENDER.essHoursMin, "the tenor up to the 25-year term, the battery from four hours");

const effects = await cfdLeverEffects(state, model, prices, { target: Number((finance.tariff - 0.4).toFixed(2)), tick: none });
near(effects.base, finance.tariff, 1e-12, "the levers start from the bid's tariff");
assert.ok(effects.levers.length >= 20 && effects.levers.every((r) => Number.isFinite(r.priceUp) && Number.isFinite(r.priceDown) && Number.isFinite(r.slope) && r.slope !== 0), "every lever kept moves the tariff, finitely");
for (let k = 1; k < effects.levers.length; k += 1) assert.ok(Math.abs(effects.levers[k].perStep) <= Math.abs(effects.levers[k - 1].perStep) + 1e-12, "the biggest movers first");
// the direction each note gives (raised input: +1 the tariff rises, -1 it falls)
const SIGN = { essCrPerMwh: 1, solarCrPerMw: 1, targetEquityIrr: 1, interestRate: 1, debtFraction: -1, availability: -1, essMwhPerMw: 1, essOmLakhPerMwh: 1, solarOmLakhPerMw: 1, omEscalation: 1, insurancePct: 1, preopPct: 1, evacuationCrPerMw: 1, essDegradation: 1, augDecline: -1, pbgCostPct: 1, solarMw: 1, "fin.receivableDays": 1, "fin.graceYears": -1 };
for (const [k, sign] of Object.entries(SIGN)) {
  const row = effects.levers.find((x) => x.key === k);
  assert.ok(row, `${k} moves the tariff`);
  assert.equal(Math.sign(row.slope), sign, `${k}: raised, the tariff ${sign > 0 ? "rises" : "falls"} (slope ${row.slope})`);
}
{
  // one lever by hand: the battery ₹0.05 cr/MWh cheaper, priced through the full model
  const lv = levers.find((l) => l.key === "essCrPerMwh");
  const cheaper = priceOf(withCfdLever(state, lv, lv.value - 0.05), model, prices);
  assert.ok(cheaper < finance.tariff - 0.05 && cheaper > finance.tariff - 1, `a cheaper battery lowers the tariff: ₹${cheaper}`);
  assert.equal(withCfdLever(state, lv, 99).inputs.essCrPerMwh, lv.max, "a lever stays within its range");
  // the choice that is not a lever: cover under the Payment Security Mechanism costs its discount
  const noPsm = bidOf({ psm: false });
  near(finance.tariff - noPsm.finance.tariff, TENDER.psmChargeRsPerKwh, 0.1, "the PSM discount is in the tariff");
}

// ---------------------------------------------------------------- the notes and the chance bands
const noteOf = (key) => LEVER_NOTES[key] || LEVER_NOTES[key.replace(/^fin\./, "")];
for (const l of levers) assert.ok(noteOf(l.key)?.what && noteOf(l.key)?.why, `a note for the lever ${l.key}`);
for (const f of FIELDS) assert.ok(f.key === "gstRate" || LEVER_NOTES[f.key], `a note for the input ${f.key}`);
for (const k of GONE) assert.ok(!(k in LEVER_NOTES) && !(k in LEVER_BANDS), `no note or band for ${k}`);
const row0 = effects.levers.find((x) => x.key === "essCrPerMwh");
const words = [JSON.stringify(LEVER_NOTES), JSON.stringify(Object.values(LEVER_BANDS).map((b) => b?.who)), ...effects.levers.map((r) => explainLever(r, effects, finance.tariff - 0.4))].join("\n");
const NOT_THIS_TENDER = [/strike/i, /\bCfD/, /\bPool\b/, /weekly|a week\b|Contract Week/i, /group/i, /Letter of Credit/i, /\bRECs?\b/, /36 months/, /15 years|15-year/, /\b2 MWh/, /two peak/i, /\bSCD\b/, /—/];
for (const bad of NOT_THIS_TENDER) assert.ok(!bad.test(words), `the notes do not speak of ${bad}`);
assert.ok(/tariff/.test(explainLever(row0, effects, finance.tariff - 0.4)) && /4 MWh per MW/.test(LEVER_NOTES.essMwhPerMw.what) && /25/.test(LEVER_NOTES.tenorYears.what), "the notes speak of the tariff, 4 MWh per MW and 25 years");
for (const [k, b] of Object.entries(LEVER_BANDS)) {
  const f = FIELDS.find((x) => x.key === k);
  assert.ok(f || k.startsWith("fin."), `the band ${k} is an input`);
  if (!b) continue;
  const lim = f ? [f.pct ? f.min / 100 : f.min, f.pct ? f.max / 100 : f.max] : [0, 180];
  for (const X of [TENDER.bidMinMw, TENDER.bidMaxMw]) {
    const at = (name) => (typeof b[name] === "function" ? b[name](X) : b[name]);
    for (const name of ["sure", "likely", "stretch"]) assert.ok(at(name)[0] >= lim[0] - 1e-12 && at(name)[1] <= lim[1] + 1e-12 && at(name)[0] <= at(name)[1], `${k}.${name} within the input's range`);
    assert.ok(at("likely")[0] <= at("sure")[0] && at("likely")[1] >= at("sure")[1] && at("stretch")[0] <= at("likely")[0] && at("stretch")[1] >= at("likely")[1], `${k}: the bands nest`);
  }
  assert.ok(b.who, `${k}: who decides`);
}
for (const [k, v] of Object.entries({ ...BENCHMARKS, ...WINNING })) {
  const b = LEVER_BANDS[k];
  if (!b || typeof v !== "number") continue;
  const st = typeof b.stretch === "function" ? b.stretch(100) : b.stretch;
  assert.ok(v >= st[0] - 1e-12 && v <= st[1] + 1e-12, `${k}: the filled value ${v} lies within the stretch band`);
}
{
  const capex = levers.find((l) => l.key === "essCrPerMwh");
  assert.equal(leverChance(capex, capex.value, state.inputs).p, 1, "no move: sure");
  assert.ok(Math.abs(leverChance(capex, 0.6, state.inputs).p - 0.5) < 1e-9 && Math.abs(leverChance(capex, 0.5, state.inputs).p - 0.1) < 1e-9 && leverChance(capex, 0.3, state.inputs).p === 0, "50% at the likely edge, 10% at the stretch edge, none beyond");
  const tax = levers.find((l) => l.key === "taxRate");
  assert.ok(leverChance(tax, tax.value - 0.01, state.inputs).fixed, "the tax rate is not the bidder's to choose");
  const tenor = levers.find((l) => l.key === "tenorYears");
  assert.ok(leverChance(tenor, 22, state.inputs).p > 0 && leverChance(tenor, 25, state.inputs).p < 0.1, "a tenor beyond 22 years is a long shot");
}

// ---------------------------------------------------------------- the track
const target = Number((effects.base - 0.4).toFixed(2));
const track = await planTrack({ state, model, prices, effects, target, tick: none });
assert.ok(track.reached && track.final <= target + 0.005, `₹${target} is reached (final ₹${track.final?.toFixed(3)})`);
assert.ok(track.steps.length >= 1 && track.steps.length <= 12, `a handful of moves (${track.steps.length})`);
for (let k = 1; k < track.steps.length; k += 1) assert.ok(track.steps[k].p <= track.steps[k - 1].p + 1e-12, "surest moves first");
assert.ok(track.chance > 0 && track.chance <= 1 && Math.abs(track.chance - track.steps.reduce((a, s) => a * s.p, 1)) < 1e-9, "the chance is the product of the moves' chances");
assert.ok(track.steps.every((s) => Number.isFinite(s.price) && s.cum > 0 && s.who && s.why && !NOT_THIS_TENDER.some((bad) => bad.test(s.why))), "every move priced for real, with who decides it and why it works");
const nope = await planTrack({ state, model, prices, effects, target: 1, tick: none });
assert.ok(!nope.reached && nope.chance === 0 && Number.isFinite(nope.floor) && nope.floor > 1, `₹1 is out of reach: floor ₹${nope.floor?.toFixed(3)}, chance 0`);
assert.ok(nope.floorLevers.length >= 5, "the floor pushes many levers to the end of their chance");
const above = await planTrack({ state, model, prices, effects, target: effects.base + 1, tick: none });
assert.ok(above.above && above.reached && above.steps.length === 0, "a quote above the model's tariff needs no move");
{
  // a frozen lever and a turned-down one are left alone; the gap is found elsewhere
  const first = track.steps[0];
  const frozen = await planTrack({ state: { ...state, frozen: { [first.key]: { key: first.key, label: first.label, value: first.from } }, locks: { [first.key]: true } }, model, prices, effects, target, tick: none });
  assert.ok(!frozen.steps.some((s) => s.key === first.key) && frozen.reached && frozen.frozenKeys.length === 1, `the frozen lever ${first.key} is not moved`);
  const turned = await planTrack({ state: { ...state, rejected: { [first.key]: { key: first.key, label: first.label } } }, model, prices, effects, target, tick: none });
  assert.ok(!turned.steps.some((s) => s.key === first.key) && turned.reached, "a turned-down lever is not moved");
  assert.deepEqual(turned.rejectedKeys, [first.key]);
  // the bid size carries the plant
  const s0 = { ...state, inputs: { ...state.inputs, contractedMw: 600, solarMw: 720, windMw: 60 } };
  const size = { key: "contractedMw", min: TENDER.bidMinMw, max: TENDER.bidMaxMw, int: true, value: 600 };
  const s1 = withCfdLever(s0, size, 50);
  assert.ok(s1.inputs.contractedMw === 50 && s1.inputs.solarMw === 60 && s1.inputs.windMw === 5, "own solar and wind scale with the bid");
  assert.equal(withCfdLever({ ...s0, locks: { solarMw: true } }, size, 100).inputs.solarMw, 720, "a locked solar size stays");
}
{
  // the screens (JSX, read as text): evidence filed under the FDRE-X tab, the analyst of this tab
  const freeze = read("../web/src/fdrex/Freeze.jsx");
  assert.ok(freeze.includes("tab: \"fdrex\"") && freeze.includes("`fdrex:lever:${lever.key}`") && freeze.includes("FDRE-X Bid") && !/tab: "cfd"|cfd:lever/.test(freeze), "frozen levers file their evidence under the FDRE-X tab");
  for (const file of ["UpsideStep.jsx", "WhatIfStep.jsx", "TrackView.jsx", "Freeze.jsx"]) {
    const text = read(`../web/src/fdrex/${file}`);
    assert.ok(!text.includes("/api/cfd/") && !/strike price|CfD Pool|Contract Week|\bSCD\b/i.test(text), `${file}: nothing of the CfD tab's wording or routes`);
  }
  assert.ok(read("../web/src/fdrex/UpsideStep.jsx").includes("/api/fdrex/agent"));
}

// ---------------------------------------------------------------- the upside: settings and plans
assert.equal(UPSIDE_DEFAULTS.dayInjection, null, "day injection is the bid's unless set");
assert.deepEqual(upsideSettings({ batteryDecline: 9, debtShare: -1, dayInjection: false, trancheMwhPerMw: 0, junk: 1 }), { batteryDecline: 0.5, debtShare: 0, dayInjection: false, trancheMwhPerMw: 0.05, maxSolarPerMw: 1, middayStress: -0.05 });
assert.ok(upsideSettings().debtShare === null && upsideSettings().dayInjection === null && upsideSettings({ dayInjection: true }).dayInjection === true);
assert.deepEqual(cleanPlan({ solarMw: -5, battery: [{ year: 5, mwh: 20 }, { year: 3, mwh: 10 }, { year: 5, mwh: 5 }, { year: 40, mwh: 9 }, { year: 2, mwh: 0 }] }), { solarMw: 0, battery: [{ year: 3, mwh: 10 }, { year: 5, mwh: 25 }] });
assert.deepEqual(cleanPlan({ battery: [{ year: 25, mwh: 9 }] }).battery, [{ year: 25, mwh: 9 }], "a tranche in the last year of the 25");
assert.equal(planLabel({ solarMw: 50, battery: [{ year: 5, mwh: 75 }, { year: 6, mwh: 75 }] }), "+50 MWac solar, +75 MWh battery a year, years 5 to 6");
assert.equal(planLabel({}), "The bid as it stands");

// ---- the bid's own case is the bid's financial model
const ctx = upsideContext(state, prices, {});
assert.ok(ctx && ctx.years === TENDER.termYears && ctx.X === 100);
near(ctx.tariff, finance.tariff, 1e-12, "the cases are priced at the bid's tariff");
assert.ok(Math.abs(ctx.tariff - finance.tariff) < 0.005, "to the paisa");
near(ctx.base.equityIrr, finance.equityIrr, 1e-9, "the bid's own case is the bid's equity IRR");
near(ctx.base.projectIrr, finance.projectIrr, 1e-9, "and its project IRR");
near(ctx.base.costCr, finance.capex.total, 1e-9, "and its project cost");
near(ctx.base.debtCr, finance.debt, 1e-9, "and its debt");
assert.ok(ctx.base.laterCapexCr === 0 && ctx.base.addCostCr === undefined && ctx.base.label === "The bid as it stands");
{
  // a tariff the bid fixed: the cases are priced at it
  const fixed = { ...state, tariffLocked: true, fin: { ...state.fin, tariff: 9.5 } };
  const c = upsideContext(fixed, prices, {});
  assert.equal(c.tariff, 9.5);
  near(c.base.equityIrr, runCfdFinance(fixed, model).equityIrr, 1e-9, "the returns at the fixed tariff");
}

// ---- day injection follows the bid
assert.ok(ctx.settings.dayInjection === false && ctx.bidDayInjection === false, "the cases inject nothing in the solar hours, as the bid");
assert.ok(ctx.base.daySoldMuYr < 0.5 && ctx.base.curtailedMuYr > 20, `the bid's day surplus is curtailed: ${ctx.base.curtailedMuYr} MU a year`);
const sunny = bidOf({ dayInjection: true });
const ctxSunny = upsideContext(sunny.state, prices, {});
assert.ok(ctxSunny.settings.dayInjection === true && ctxSunny.bidDayInjection === true && ctxSunny.base.daySoldMuYr > 20 && ctxSunny.base.curtailedMuYr < 5, "a bid with solar-hour connectivity sells the day's surplus");
near(ctxSunny.tariff, sunny.finance.tariff, 1e-12, "and its cases are priced at its own tariff");
assert.ok(sunny.finance.tariff < finance.tariff - 0.5, `solar-hour connectivity lowers the tariff: ₹${sunny.finance.tariff} against ₹${finance.tariff}`);
{
  // the step's setting may say otherwise: the cases then take the other connectivity, at the tariff it needs
  const forced = upsideContext(state, prices, { dayInjection: true });
  assert.ok(forced.settings.dayInjection === true && forced.bidDayInjection === false);
  near(forced.tariff, sunny.finance.tariff, 1e-9, "the bid's tariff solved again with sale in solar hours");
}

// ---- more own solar, without and with solar-hour connectivity
const s50 = evaluatePlan(ctx, { solarMw: 50 });
near(s50.addCostCr / 50, state.inputs.solarCrPerMw, 0.12, "the solar's cost with its pre-operative share, Success Charges and PBG, no line");
assert.ok(s50.model.inputs.solarMw === 170 && s50.batterySoldMuYr === 0 && s50.daySoldMuYr < 0.5 && s50.curtailedMuYr > ctx.base.curtailedMuYr + 50 && s50.equityIrr < ctx.base.equityIrr, "without solar-hour connectivity the added solar's surplus is curtailed");
near(s50.finance.debt - ctx.base.finance.debt, state.inputs.debtFraction * s50.addCostCr, 0.02, "the bid's debt share on the addition by default");
const s50Sunny = evaluatePlan(ctxSunny, { solarMw: 50 });
assert.ok(s50Sunny.daySoldMuYr > ctxSunny.base.daySoldMuYr + 50 && s50Sunny.dayPrice > 1 && s50Sunny.dayPrice < 6 && s50Sunny.equityIrr > s50.equityIrr, `with it the surplus is sold in the day: ${s50Sunny.daySoldMuYr} MU at ₹${s50Sunny.dayPrice}`);
assert.ok(Number.isFinite(s50Sunny.addProjectIrr), "the addition's own return before debt");
near(evaluatePlan(upsideContext(state, prices, { debtShare: 0.5 }), { solarMw: 50 }).debtCr - ctx.base.debtCr, 0.5 * s50.addCostCr, 0.02, "the debt share on the addition as set");
{
  // too little solar: more of it makes good the days short
  const thin = bidOf({ solarMw: 90 });
  const c = upsideContext(thin.state, prices, {});
  const more = evaluatePlan(c, { solarMw: 30 });
  assert.ok(c.base.shortDays > 100 && more.shortDays < c.base.shortDays / 10, `days short fall with more solar: ${c.base.shortDays} to ${more.shortDays}`);
}

// ---- a battery tranche in year 6: capital spend in that year at the falling price, fading from its own year
const B = 50;
const b6 = evaluatePlan(ctx, { battery: [{ year: 6, mwh: B }] });
near(b6.addCostCr, 0, 1e-6, "nothing more at the SCSD");
near(b6.laterCapexCr, B * state.inputs.essCrPerMwh * (1 - UPSIDE_DEFAULTS.batteryDecline) ** 5, 1e-9, "the tranche at 10% a year off the battery price");
near(b6.finance.rows[5].augCapex - ctx.base.finance.rows[5].augCapex, b6.laterCapexCr, 1e-9, "spent in year 6");
assert.ok(b6.finance.rows[4].augCapex === ctx.base.finance.rows[4].augCapex && b6.finance.rows[6].augCapex === ctx.base.finance.rows[6].augCapex, "and in no other year");
assert.ok(b6.finance.rows[4].pxFees === ctx.base.finance.rows[4].pxFees && b6.finance.rows[6].pxFees > ctx.base.finance.rows[6].pxFees, "its O&M, insurance and exchange fees run from its year");
{
  const sold = (y) => b6.model.opYears[y - 1].extraSoldMwh;
  assert.ok(sold(5) === 0 && sold(6) > 0 && sold(TENDER.termYears) > 0 && sold(TENDER.termYears) < sold(6), "sold from year 6, less as it fades");
  assert.ok(b6.model.opYears[5].extraChargeOwnMwh > 0 && b6.model.opYears.every((o) => o.extraChargeMarketMwh <= 0.05 * o.deliveredMwh), "charged from own RE; bought power stays within the 5% of the supply");
  assert.ok(b6.shortDays === ctx.base.shortDays && b6.suppliedMu >= ctx.base.suppliedMu - 1e-6, "the PPA supply comes first");
  const inputs = modelInputs(b6.model.state);
  assert.equal(inputs.extraEssByYear[6], B / 100);
  const days = [365 * 5 + 200, 365 * 20 + 200];
  const rec = simulate(inputs, priceBook(prices, inputs.sellMarket), profiles(inputs), { record: days }).days;
  const out = (k) => rec[k].extraOut.reduce((a, v) => a + v, 0);
  const usable = (year) => B * socWindow(inputs) * (1 - inputs.essDegradation * (year - 6));
  assert.ok(out(days[0]) > 0 && out(days[0]) <= usable(6) + 1e-6 && out(days[1]) <= usable(21) + 1e-6 && usable(21) < usable(6), "a day's sale within the tranche's usable energy, faded from its own year");
  for (const k of days) {
    assert.equal(rec[k].chosen.length, TENDER.peakHours, "the buyer's four hours");
    assert.ok(rec[k].extraOut.every((v, h) => v === 0 || (h >= TENDER.peakStart && h < TENDER.peakEnd && !rec[k].chosen.includes(h))), "sold in the evening hours outside the buyer's four hours");
    assert.ok(rec[k].sale.every((v, h) => h < 6 || h >= TENDER.peakStart || v === 0), "nothing injected from 06:00 to 18:00");
  }
}
const b1 = evaluatePlan(ctx, { battery: [{ year: 1, mwh: B }] });
assert.ok(b1.laterCapexCr === 0 && b1.addCostCr > B * state.inputs.essCrPerMwh * 0.99, "a tranche at the SCSD is project cost");
assert.ok(b6.laterCapexCr < B * state.inputs.essCrPerMwh, "and the later one is cheaper");

// ---- the tests beside a plan follow the connectivity
const tests = stressPlan(ctx, { solarMw: 50 });
assert.deepEqual(Object.keys(tests), ["withDayInjection", "fromEquity"], "without solar-hour connectivity: the what-if with it, and the addition paid from equity");
assert.ok(tests.withDayInjection.daySoldMuYr > 50 && tests.withDayInjection.equityIrr > s50.equityIrr, "the what-if sells the day's surplus");
near(tests.fromEquity.debtCr, ctx.base.debtCr, 1e-4, "paid from equity: the bid's debt only");
assert.ok(tests.fromEquity.equityCr > s50.equityCr + 0.5 * s50.addCostCr, "and more equity");
const testsSunny = stressPlan(ctxSunny, { solarMw: 50 });
assert.deepEqual(Object.keys(testsSunny), ["noDayInjection", "middayPrices", "fromEquity"], "with it: no injection in solar hours, midday prices, paid from equity");
assert.ok(testsSunny.noDayInjection.daySoldMuYr < 0.5 && testsSunny.noDayInjection.curtailedMuYr > s50Sunny.curtailedMuYr + 50 && testsSunny.noDayInjection.equityIrr < s50Sunny.equityIrr, "no injection in solar hours: the surplus is curtailed");
assert.ok(testsSunny.middayPrices.dayPrice < s50Sunny.dayPrice && testsSunny.middayPrices.equityIrr < s50Sunny.equityIrr, "midday prices falling");
const lower = strikeWithSolar(ctxSunny, 50);
assert.ok(lower > 0 && (s50Sunny.equityIrr > ctxSunny.base.equityIrr) === (lower < ctxSunny.tariff), `a higher IRR at the bid's tariff is a lower tariff at the bid's IRR: ₹${lower} vs ₹${ctxSunny.tariff}`);

// ---- the sweep, on the bid as filled (non-solar-hour access) and with solar-hour connectivity
/** What every sweep must give: a best plan or the word that none pays, stresses that fit, and citations that exist. */
function checkSweep(r, dayOn, name) {
  assert.ok(r && !r.stopped && r.settings.dayInjection === dayOn && r.bidDayInjection === dayOn, `${name}: day injection as in the bid`);
  assert.ok(r.cases.length >= 8 && r.solar.length >= 2 && r.timing.length >= 5 && r.cases.every((c) => Number.isFinite(c.equityIrr) && Number.isFinite(c.costCr) && Number.isFinite(c.equityNpvCr)), `${name}: ${r.cases.length} finite cases`);
  assert.ok(r.solar.every((c, k) => c.plan.solarMw === 15 * (k + 1)), `${name}: solar in steps of 15 MWac for 100 MW`);
  assert.deepEqual(r.timing.map((c) => c.plan.battery[0].year), [1, 3, 5, 7, 9, 12, 15], `${name}: a first tranche tried up to year 15 of the 25`);
  assert.ok(r.best && r.best.equityIrr >= r.base.equityIrr - 1e-12 && r.best.equityIrr >= Math.max(...r.solar.map((c) => c.equityIrr)) - 1e-9, `${name}: the best plan is at least the bid and the best solar`);
  assert.ok(r.bestValue.equityNpvCr >= r.best.equityNpvCr - 1e-6, `${name}: the plan with the most value at the target IRR`);
  const kinds = r.suggestions.map((s) => s.kind);
  // a best plan, or the word that none pays
  if (r.best === r.base) assert.ok(!kinds.includes("do") && kinds.filter((k) => k === "avoid").length === 2, `${name}: no addition pays, and the suggestions say so for the solar and for the battery`);
  else assert.ok(kinds.includes("do"), `${name}: the best plan is suggested`);
  assert.equal(kinds.includes("avoid") || kinds.includes("do"), true);
  if (!r.bestSolar) assert.ok(r.suggestions.some((s) => s.kind === "avoid" && /solar/.test(s.title)) && r.lowerBid === null, `${name}: more solar does not pay, said so`);
  else assert.ok(r.lowerBid && r.lowerBid.solarMw === r.bestSolar.plan.solarMw && (r.lowerBid.change < 0) === (r.bestSolar.equityIrr > r.base.equityIrr), `${name}: the best solar priced as a lower bid`);
  // the tests fit the connectivity; the keys other modules read are bestSolar and best
  const dayTest = dayOn ? "noDayInjection" : "withDayInjection";
  for (const [key, set] of Object.entries(r.stress)) {
    assert.ok(key === "bestSolar" || key === "best", `${name}: stress key ${key}`);
    assert.ok(set[dayTest] && !set[dayOn ? "withDayInjection" : "noDayInjection"], `${name}: ${key} carries ${dayTest}`);
    if (key === "bestSolar") assert.ok(set.fromEquity && Boolean(set.middayPrices) === dayOn, `${name}: the best solar paid from equity${dayOn ? " and under falling midday prices" : ""}`);
  }
  if (r.bestSolar) assert.ok(r.stress.bestSolar, `${name}: the best solar is stressed`);
  assert.ok(r.bidStress && r.bidStress[dayTest] && (dayOn ? r.bidStress[dayTest].equityIrr < r.base.equityIrr : r.bidStress[dayTest].equityIrr > r.base.equityIrr), `${name}: the bid as it stands on the other connectivity`);
  // every suggestion in sentences; every citation a term of terms.js, as terms.js has it
  assert.ok(r.suggestions.every((s) => s.title && s.detail && !/undefined|NaN/.test(s.title + s.detail)), `${name}: suggestions in sentences`);
  for (const s of r.suggestions) {
    assert.ok(!NOT_THIS_TENDER.some((bad) => bad.test(`${s.title} ${s.detail}`)), `${name}: "${s.title}" speaks of this tender`);
    assert.ok(s.cite !== null, `${name}: "${s.title}" cites a term that exists`);
    if (!s.cite) continue;
    const t = termById[s.cite.id];
    assert.ok(t && t.doc === s.cite.doc && t.clause === s.cite.clause && t.page === s.cite.page && t.quote === s.cite.quote && t.page > 0, `${name}: the citation ${s.cite.id} is the term of terms.js`);
  }
  const rules = r.suggestions.filter((s) => s.kind === "rule");
  assert.deepEqual(rules.map((s) => s.cite?.id), ["essOtherUse", "thirdPartyPenalty", "connectivity", "marketShare", "excess", "repower"], `${name}: the tender's rules, each cited`);
  assert.ok(/PPA 9\.3/.test(rules[4].detail) && /do not count/.test(rules[4].title), `${name}: SECI's first right to the excess energy is an upside the cases do not count`);
  assert.deepEqual(suggestionsOf(r).map((s) => s.title), r.suggestions.map((s) => s.title));
  const plain = sweepSummary(r);
  assert.ok(JSON.parse(JSON.stringify(plain)).base.equityIrr === Number(r.base.equityIrr.toFixed(4)) && !("finance" in plain.base) && plain.solar.length === r.solar.length && plain.settings.dayInjection === dayOn && Object.keys(plain.stress).join() === Object.keys(r.stress).join(), `${name}: the sweep as plain data`);
}
let ticks = 0;
const r = await upsideSweep(state, prices, {}, { onProgress: () => { ticks += 1; }, pause: none });
assert.ok(ticks >= r.cases.length - 1, "progress after each case");
checkSweep(r, false, "non-solar-hour access");
assert.ok(!r.bestSolar && r.suggestions.some((s) => s.kind === "avoid" && /without solar-hour connectivity/.test(s.title)), "without solar-hour connectivity more solar does not pay");
assert.ok(r.suggestions.some((s) => s.kind === "consider" && s.cite.id === "connectivityApplied" && /with solar-hour connectivity too, the bid as it stands/.test(s.title)), "the what-if with solar-hour connectivity too is named");
assert.ok(r.timing.every((c) => Number.isFinite(c.stepEquityIrr) || c.stepEquityIrr === null) && r.timing.every((c) => c.daySoldMuYr < 0.5), "each battery year with the tranche's own return; nothing sold in the day");
const rSunny = await upsideSweep(sunny.state, prices, {}, { pause: none });
checkSweep(rSunny, true, "solar-hour connectivity");
assert.ok(rSunny.suggestions.some((s) => s.kind === "risk" && s.cite?.id === "substation" && /the bid as it stands/.test(s.title)), "with it, no injection in solar hours is a risk of the bid itself");
assert.equal(caseSummary(null), null);
{
  // stopped early: what was done is returned
  let n = 0;
  const part = await upsideSweep(state, prices, {}, { shouldStop: () => { n += 1; return n > 2; }, pause: none });
  assert.ok(part.stopped && part.solar.length === 2 && part.timing.length === 0 && part.suggestions.length > 0);
}

// ---- a plan made the bid's own
const applied = applyPlan(state, { solarMw: 50, battery: [{ year: 1, mwh: 50 }, { year: 6, mwh: 50 }] });
assert.ok(applied.state.inputs.solarMw === 170 && applied.state.inputs.extraEssMwhPerMw === 0.5 && applied.state.filled.solarMw === false && applied.state.inputs.dayInjection === false, "the solar and the SCSD tranche become the bid's plant");
assert.deepEqual(applied.kept, [{ year: 6, mwh: 50 }], "later tranches stay with the Upside step");

console.log(`OK  FDRE-X what-if and upside: ${levers.length} levers (${effects.levers.length} move the tariff), ${Object.keys(LEVER_NOTES).length} notes; bid ₹${finance.tariff.toFixed(3)}/kWh at ${pc(finance.equityIrr)} (₹${sunny.finance.tariff.toFixed(3)} with solar-hour connectivity); track to ₹${target} in ${track.steps.length} ${track.steps.length === 1 ? "move" : "moves"} (chance ${pc(track.chance, 0)}), ₹1 out of reach (floor ₹${nope.floor.toFixed(2)}); upside ${r.cases.length} + ${rSunny.cases.length} cases, best ${r.best.label}: ${pc(r.best.equityIrr, 2)}; with solar-hour connectivity ${rSunny.best.label}: ${pc(rSunny.best.equityIrr, 2)}`);
