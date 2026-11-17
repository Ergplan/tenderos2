// The Upside of a SECI-FDRE-X bid: what more the same connection could earn once the bid's plant is
// built. Forked from the CfD-I tab's upside (web/src/cfd/upside.js); the mechanics carry over.
//
// The bid's line to the ISTS substation, its bay and its connectivity are paid for by the bid. More
// own solar, and more battery added in later years at a falling price, carry none of that cost.
// The solar charges the bid's battery (fewer days short, less bought power) and, where the bid
// holds connectivity in the solar hours too (the bid's choice `dayInjection`), sells its surplus on
// the exchange in the day; the added battery sells in the evening hours outside the four hours
// the buyer chose for the day. The tender allows that other use of the storage outside the Peak
// Hours, within the connectivity and with the PPA supply first (RfS 8.1.f, PPA 4.4.1.a.iv), and
// gives no connectivity above the Contracted Capacity (RfS 6.1): every case sells within the
// contracted MW, and nothing on a day the supply is short. Bought power for the added battery sits
// inside the same 5% of the year's energy as the supply (RfS 8.1.e; grid charging beyond it is not
// allowed, PPA 4.4.1.a.vii), after the supply's own need, so in practice it charges from own RE.
//
// Not counted: SECI has the first right to excess generation, at the tariff, if the Buying Entity
// consents (PPA 9.3). The cases sell the surplus at exchange prices, which takes it that SECI was
// offered the energy and refused it (PPA 9.3 lets it go to others only then).
//
// Every case here is the bid's own model run again: the day-by-day operation (model.js simulate)
// with the addition, priced by the shared financial engine at the bid's tariff, so the answer is
// what the addition does to the bid's equity IRR, and what it earns on its own cost (the
// difference of the two runs' cash flows). The sweep walks the solar sizes, then the year a
// battery tranche starts to pay, then a ladder of yearly tranches, and stresses the best plans.
// Day injection follows the bid. The tender asks for connectivity with non-solar-hour access (RfS
// 7.2), so by default nothing is injected from 06:00 to 18:00: more solar then earns only by
// charging the battery, and the same plans "with solar-hour connectivity too" are run beside them
// as a what-if. Where the bid holds solar-hour connectivity, the stresses are no injection in solar
// hours and midday prices falling. Either way, the addition paid from equity (a lender may not
// lend on market revenue) is a stress.
//
// More solar by the SCSD is a change of the Installed Capacity (RfS 4.2), which carries SECI's
// Success Charges and a larger PBG (RfS 17.2, 18.3): the bid's model prices both on the added
// solar. A battery added after the SCSD is capital spend in operation (paid from the project's
// cash, like an augmentation; PPA 5.9 lets the plant be reconfigured at the developer's risk and
// cost) and fades from its own year; its O&M and insurance are operating costs from that year.
// Plain JavaScript (no browser APIs).
import * as E from "../rtc/engine.js";
import { cfdEngineInputs, runCfdFinance } from "./finance.js";
import { modelInputs, pricePathOf, priceBook, profiles, simulate } from "./model.js";
import { TERMS } from "./terms.js";
import { TENDER } from "./tender.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** The IRR of cash flows, or null when there is none (no outlay, or never paid back). */
const irrOf = (flows) => { const v = E.irr(flows); return isNum(v) ? v : null; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);

/** The settings of the step, with their defaults. */
export const UPSIDE_DEFAULTS = {
  batteryDecline: 0.1, // the battery price falls this much a year (a tranche bought in year y costs price × (1 − decline)^(y − 1))
  debtShare: null, // the debt on the addition's cost at the SCSD, as a share (null: the bid's debt share; 0: paid from equity)
  dayInjection: null, // surplus own RE may be injected in solar hours (null: as in the bid, its choice `dayInjection`; false: connectivity with non-solar-hour access only, RfS 7.2)
  trancheMwhPerMw: 0.5, // one battery tranche, MWh per contracted MW
  maxSolarPerMw: 1, // the largest solar addition tried, MWac per contracted MW
  middayStress: -0.05, // the stress on midday prices, a year
};

/** The settings as typed; `dayInjection` null means "as in the bid" (upsideContext makes it the bid's choice). */
export function upsideSettings(raw = {}) {
  const s = { ...UPSIDE_DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
  return {
    batteryDecline: clamp(isNum(s.batteryDecline) ? s.batteryDecline : UPSIDE_DEFAULTS.batteryDecline, 0, 0.5),
    debtShare: isNum(s.debtShare) ? clamp(s.debtShare, 0, 0.9) : null,
    dayInjection: typeof s.dayInjection === "boolean" ? s.dayInjection : null,
    trancheMwhPerMw: clamp(isNum(s.trancheMwhPerMw) ? s.trancheMwhPerMw : UPSIDE_DEFAULTS.trancheMwhPerMw, 0.05, 4),
    maxSolarPerMw: clamp(isNum(s.maxSolarPerMw) ? s.maxSolarPerMw : UPSIDE_DEFAULTS.maxSolarPerMw, 0.1, 3),
    middayStress: clamp(isNum(s.middayStress) ? s.middayStress : UPSIDE_DEFAULTS.middayStress, -0.3, 0.3),
  };
}

/** A plan in its plain shape: { solarMw (MWac added), battery: [{ year, mwh }] sorted, one entry a year }. */
export function cleanPlan(plan, years = TENDER.termYears) {
  const byYear = new Map();
  for (const t of Array.isArray(plan?.battery) ? plan.battery : []) {
    const y = Math.round(t?.year);
    if (!(y >= 1 && y <= years) || !(t?.mwh > 0)) continue;
    byYear.set(y, (byYear.get(y) || 0) + t.mwh);
  }
  return { solarMw: Math.max(0, isNum(plan?.solarMw) ? plan.solarMw : 0), battery: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, mwh]) => ({ year, mwh })) };
}

/** The plan in a few words. */
export function planLabel(plan) {
  const p = cleanPlan(plan);
  const parts = [];
  if (p.solarMw > 0) parts.push(`+${Math.round(p.solarMw)} MWac solar`);
  if (p.battery.length === 1) parts.push(`+${Math.round(p.battery[0].mwh)} MWh battery in year ${p.battery[0].year}`);
  else if (p.battery.length > 1) {
    const same = p.battery.every((t) => Math.abs(t.mwh - p.battery[0].mwh) < 1e-6);
    const run = p.battery.every((t, k) => k === 0 || t.year === p.battery[k - 1].year + 1);
    parts.push(same && run ? `+${Math.round(p.battery[0].mwh)} MWh battery a year, years ${p.battery[0].year} to ${p.battery[p.battery.length - 1].year}` : `battery ${p.battery.map((t) => `+${Math.round(t.mwh)} MWh in year ${t.year}`).join(", ")}`);
  }
  return parts.length ? parts.join(", ") : "The bid as it stands";
}

/**
 * What the sweep and every case share: the bid's inputs, the price book and profiles (they do not
 * change with the sizes), the tariff the cases are priced at, and the bid's own case. Day injection
 * is the bid's choice unless the settings say otherwise: ctx.settings.dayInjection is then always
 * true or false, and ctx.bidDayInjection is the bid's own. Returns null when the bid cannot be modelled.
 */
export function upsideContext(state, prices, rawSettings = {}, { tariff = null } = {}) {
  const inputs = modelInputs(state);
  if (!inputs || !prices) return null;
  const settings = upsideSettings(rawSettings);
  const bidDayInjection = Boolean(inputs.dayInjection); // false: connectivity with non-solar-hour access only (RfS 7.2)
  if (settings.dayInjection === null) settings.dayInjection = bidDayInjection;
  const ctx = { state, settings, bidDayInjection, book: priceBook(prices, inputs.sellMarket), prof: profiles(inputs), years: null, tariff: null, base: null, X: inputs.contractedMw };
  const plain = modelOfPlan(ctx, { solarMw: 0, battery: [] }, {});
  ctx.years = plain.opYears.length;
  if (isNum(tariff) && tariff > 0) ctx.tariff = tariff;
  else {
    // the bid's own tariff: the one it fixed, or the one its target equity IRR needs
    const fin = runCfdFinance(state, plain);
    if (!fin || !isNum(fin.tariff)) return null;
    ctx.tariff = fin.tariff;
  }
  ctx.targetIrr = inputs.targetEquityIrr;
  ctx.base = evaluatePlan(ctx, { solarMw: 0, battery: [] });
  return ctx;
}

/** The bid's state with a plan laid over it, and the day-by-day operation of it. */
function modelOfPlan(ctx, plan, over) {
  const p = cleanPlan(plan);
  const byYear = [];
  for (const t of p.battery) byYear[t.year] = t.mwh / ctx.X;
  const st = {
    ...ctx.state,
    inputs: {
      ...ctx.state.inputs,
      solarMw: (ctx.state.inputs.solarMw || 0) + p.solarMw,
      extraEssByYear: byYear,
      dayInjection: over.dayInjection ?? ctx.settings.dayInjection,
      ...(over.pricePath ? { priceScenario: "custom", pricePath: over.pricePath } : {}),
    },
  };
  const inputs = modelInputs(st);
  const sim = simulate(inputs, ctx.book, ctx.prof);
  return { state: st, inputs, sim, opYears: sim.opYears, sp: ctx.tariff };
}

/** The engine's run for a plan: the bid's financial model with the plan's capital and running costs. */
function financeOfPlan(ctx, plan, model, debtShare) {
  const p = cleanPlan(plan);
  const eng = cfdEngineInputs(model.state, model);
  const i = model.inputs;
  const years = eng.ops.length;
  const decline = ctx.settings.batteryDecline;
  const mwhAt = new Array(years + 1).fill(0);
  for (const t of p.battery) if (t.year <= years) mwhAt[t.year] = t.mwh;
  const priceAt = (y) => i.essCrPerMwh * (1 - decline) ** (y - 1);
  // the bid's own augmentation as a schedule of costs, with each later tranche's cost in its year
  const cr = E.augmentationScheduleCr(eng.sizes, eng.costs, eng.bess, years).slice();
  const laterCapex = new Array(years + 1).fill(0);
  for (let y = 2; y <= years; y += 1) { laterCapex[y] = mwhAt[y] * priceAt(y); cr[y] = (cr[y] || 0) + laterCapex[y]; }
  const sizes = { ...eng.sizes, bessMwh: eng.sizes.bessMwh + mwhAt[1] };
  const bess = { ...eng.bess, augmentation: "byYear", augmentationPct: [], augmentationCr: cr };
  // the later tranches' O&M and insurance, from the year each is added
  let mwh = 0;
  let capex = 0;
  const ops = eng.ops.map((o, k) => {
    const y = k + 1;
    if (y >= 2) { mwh += mwhAt[y]; capex += laterCapex[y]; }
    const running = (mwh * (i.essOmLakhPerMwh || 0)) / 100 * (1 + (i.omEscalation || 0)) ** (y - 1) + (i.insurancePct || 0) * capex;
    return running > 0 ? { ...o, pxFeesCr: (o.pxFeesCr || 0) + running, upsideRunningCr: running } : o;
  });
  // (the whole Project is due by the SCSD in this tender, so one engine run prices the case)
  const run = (debtFraction) => E.runFinancialModel(null, sizes, { costs: eng.costs, fin: { ...eng.fin, tariff: ctx.tariff, debtFraction }, bess, dfrTarget: 0, tariffLocked: true, ops, solveBy: "npv" });
  let f = run(eng.fin.debtFraction);
  // the debt on the addition: the bid's debt, plus the chosen share of what the addition costs at the SCSD
  const d = debtShare ?? ctx.settings.debtShare;
  if (ctx.base && isNum(d) && f.capex.total > ctx.base.finance.capex.total + 1e-6) {
    for (let k = 0; k < 3; k += 1) {
      const want = ctx.base.finance.debt + d * (f.capex.total - ctx.base.finance.capex.total);
      f = run(clamp((eng.fin.debtFraction * want) / Math.max(1e-9, f.debt), 0, 0.95));
      if (Math.abs(f.debt - want) < 0.01) break;
    }
  }
  return { finance: f, laterCapexCr: laterCapex.reduce((a, v) => a + v, 0), laterCapex };
}

/**
 * One case: the plan's operation and financial model at the bid's tariff, and what it does
 * against the bid (ctx.base). `over` stresses it: { dayInjection, pricePath, debtShare }.
 */
export function evaluatePlan(ctx, plan, over = {}) {
  const p = cleanPlan(plan, ctx.years || TENDER.termYears);
  const model = modelOfPlan(ctx, p, over);
  const { finance: f, laterCapexCr, laterCapex } = financeOfPlan(ctx, p, model, over.debtShare);
  const ops = model.opYears;
  const n = ops.length;
  const base = ctx.base;
  const dscrs = f.rows.filter((r) => r.dscr !== null).map((r) => [r.dscr, r.year]);
  const minDscr = dscrs.length ? dscrs.reduce((a, b) => (b[0] < a[0] ? b : a)) : null;
  const out = {
    plan: p,
    label: planLabel(p),
    finance: f,
    model,
    equityIrr: f.equityIrr,
    projectIrr: f.projectIrr,
    equityNpvCr: f.equityNpv,
    costCr: f.capex.total,
    debtCr: f.debt,
    equityCr: f.equity,
    laterCapexCr,
    laterCapex,
    minDscr: minDscr ? minDscr[0] : null,
    minDscrYear: minDscr ? minDscr[1] : null,
    shortDays: sum(ops, "shortDays"),
    suppliedMu: sum(ops, "deliveredMwh") / 1000,
    soldMuYr: sum(ops, "merchantMwh") / n / 1000,
    soldCrYr: sum(ops, "merchantRevCr") / n,
    batterySoldMuYr: sum(ops, "extraSoldMwh") / n / 1000,
    batterySoldCrYr: sum(ops, "extraRevCr") / n,
    boughtCrYr: sum(ops, "marketCostCr") / n, // green-market and bilateral power, within the 5% of RfS 8.1.e
    curtailedMuYr: sum(ops, "curtailedMwh") / n / 1000,
  };
  out.daySoldMuYr = out.soldMuYr - out.batterySoldMuYr;
  out.daySoldCrYr = out.soldCrYr - out.batterySoldCrYr;
  out.dayPrice = out.daySoldMuYr > 1e-6 ? (out.daySoldCrYr * 10) / out.daySoldMuYr : null; // ₹/kWh
  out.batteryPrice = out.batterySoldMuYr > 1e-6 ? (out.batterySoldCrYr * 10) / out.batterySoldMuYr : null;
  if (base) {
    out.addCostCr = out.costCr - base.costCr; // at the SCSD
    out.dEquityIrr = isNum(out.equityIrr) && isNum(base.equityIrr) ? out.equityIrr - base.equityIrr : null;
    out.dEquityNpvCr = out.equityNpvCr - base.equityNpvCr;
    out.dBoughtCrYr = out.boughtCrYr - base.boughtCrYr;
    out.dSoldCrYr = out.soldCrYr - base.soldCrYr;
    // the addition on its own: the difference of the two runs' cash flows
    out.addProjectIrr = out.addCostCr + out.laterCapexCr > 1e-6 ? irrOf(f.projectFlows.map((v, k) => v - base.finance.projectFlows[k])) : null;
    out.addEquityIrr = out.addCostCr + out.laterCapexCr > 1e-6 ? irrOf(f.equityFlows.map((v, k) => v - base.finance.equityFlows[k])) : null;
  }
  return out;
}

/** The tariff the bid's target equity IRR needs with a plan's solar (the bid lowered instead of the IRR raised). */
export function strikeWithSolar(ctx, solarMw) {
  const model = modelOfPlan(ctx, { solarMw, battery: [] }, {});
  const f = runCfdFinance({ ...model.state, tariffLocked: false }, model, { tariffLocked: false });
  return f && isNum(f.tariff) ? f.tariff : null;
}

/** A midday price path falling (or rising) `rate` a year on top of the bid's own path. */
export function middayPath(ctx, rate) {
  const path = pricePathOf(modelInputs(ctx.state), (ctx.years || TENDER.termYears) + 1);
  return { midday: path.midday.map((v, k) => v * (1 + rate) ** k), evening: path.evening.slice() };
}

/**
 * The tests of a plan beside its case. With day injection (the cases sell the day's surplus): no
 * injection in solar hours, midday prices moving, the addition paid from equity. Without it (the
 * tender's connectivity with non-solar-hour access): the what-if with solar-hour connectivity too,
 * and the addition paid from equity (midday prices do not reach a plan that sells nothing in the day).
 */
export function stressPlan(ctx, plan) {
  return Object.fromEntries(stressTests(ctx, true).map(([name, over]) => [name, evaluatePlan(ctx, plan, over)]));
}
/** The tests as [name, override]; `all` false keeps only the one on day injection (a late battery tranche needs no more). */
function stressTests(ctx, all) {
  const day = ctx.settings.dayInjection ? ["noDayInjection", { dayInjection: false }] : ["withDayInjection", { dayInjection: true }];
  if (!all) return [day];
  return [day, ...(ctx.settings.dayInjection ? [["middayPrices", { pricePath: middayPath(ctx, ctx.settings.middayStress) }]] : []), ["fromEquity", { debtShare: 0 }]];
}

const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const solarStep = (X) => Math.max(5, Math.round(X / 6 / 5) * 5);
const better = (a, b) => isNum(a?.equityIrr) && (!isNum(b?.equityIrr) || a.equityIrr > b.equityIrr + 1e-5);
/**
 * A step that pays: on the cash it takes it returns more than the bid's target equity IRR (half a
 * point of margin), so it adds value at that target. A late, small tranche can pay and still barely
 * move the blended IRR of the whole project: both are reported.
 */
const pays = (c, target) => (isNum(c?.stepEquityIrr) ? c.stepEquityIrr > target + 0.005 : Boolean(c?.stepEquityAbove));
/** The engine's IRR search ends at 150%: a step whose cash is still worth something at that rate returns more (stepEquityAbove). */
const IRR_CEILING = 1.5;
/** What a case earns over another on the cost between them: the IRRs of the difference of their cash flows. */
function stepOver(c, ref) {
  const d = (k) => c.finance[k].map((v, i) => v - ref.finance[k][i]);
  const eq = d("equityFlows");
  const stepEquityIrr = irrOf(eq);
  // a tranche paid from the project's cash can take so little equity cash in its year that no IRR up to the ceiling exists
  const stepEquityAbove = stepEquityIrr === null && eq.some((v) => Math.abs(v) > 1e-9) && E.npvAt(IRR_CEILING, eq) > 0;
  return { stepProjectIrr: irrOf(d("projectFlows")), stepEquityIrr, stepEquityAbove };
}
/** A step's own return in words. */
const stepText = (c) => (c?.stepEquityAbove ? `more than ${Math.round(IRR_CEILING * 100)}%` : pc(c?.stepEquityIrr));

/**
 * The sweep. Walks the solar additions, then the year a battery tranche starts to pay on the best
 * solar, then a ladder of yearly tranches from that year, and stresses the best solar and the best
 * plan, and the bid as it stands (bidStress): without injection in solar hours where the cases have
 * it (noDayInjection), with solar-hour connectivity too where they do not (withDayInjection).
 * `onProgress(done, total, label)` after each case; `shouldStop()` ends it early.
 * Returns { tariff, settings, bidDayInjection, base, solar[], timing[], ladder[], best, bestSolar, stress, bidStress, lowerBid, cases[] }.
 */
export async function upsideSweep(state, prices, rawSettings = {}, { onProgress = null, shouldStop = null, tariff = null, pause = tick } = {}) {
  const ctx = upsideContext(state, prices, rawSettings, { tariff });
  if (!ctx) return null;
  const X = ctx.X;
  const step = solarStep(X);
  const solarSizes = [];
  for (let s = step; s <= ctx.settings.maxSolarPerMw * X + 1e-6; s += step) solarSizes.push(s);
  // the years tried for a first tranche: as the CfD tab's, with two later ones for the 25-year term
  const timingYears = [1, 3, 5, 7, 9, 12, 15].filter((y) => y <= ctx.years - 3);
  const total = solarSizes.length + timingYears.length + 7 + 5 + 1;
  let done = 0;
  const stop = () => Boolean(shouldStop && shouldStop());
  const run = async (plan, over) => {
    const c = evaluatePlan(ctx, plan, over);
    done += 1;
    if (onProgress) onProgress(Math.min(done, total), total, c.label);
    await pause();
    return c;
  };
  const out = { tariff: ctx.tariff, targetIrr: ctx.targetIrr, settings: ctx.settings, bidDayInjection: ctx.bidDayInjection, contractedMw: X, years: ctx.years, base: ctx.base, solar: [], timing: [], ladder: [], best: ctx.base, bestSolar: null, stress: {}, bidStress: null, lowerBid: null, stopped: false };

  // 1. more own solar
  let falls = 0;
  for (const s of solarSizes) {
    if (stop()) { out.stopped = true; break; }
    const c = await run({ solarMw: s, battery: [] });
    out.solar.push(c);
    const prev = out.solar[out.solar.length - 2] || ctx.base;
    falls = isNum(c.equityIrr) && isNum(prev.equityIrr) && c.equityIrr < prev.equityIrr ? falls + 1 : 0;
    if (falls >= 2) break; // past the best size
  }
  const bestSolar = out.solar.reduce((a, c) => (better(c, a) ? c : a), ctx.base);
  out.bestSolar = bestSolar.plan.solarMw > 0 ? bestSolar : null;
  const S = bestSolar.plan.solarMw;

  // 2. the year a battery tranche starts to pay, on the best solar
  const B = ctx.settings.trancheMwhPerMw * X;
  for (const y of timingYears) {
    if (out.stopped || stop()) { out.stopped = true; break; }
    const c = await run({ solarMw: S, battery: [{ year: y, mwh: B }] });
    Object.assign(c, stepOver(c, bestSolar)); // the tranche alone, over the best solar
    out.timing.push(c);
  }
  const paying = out.timing.filter((c) => pays(c, ctx.targetIrr));

  // 3. a ladder of yearly tranches from the first year one pays
  let current = bestSolar;
  if (paying.length && !out.stopped) {
    current = paying[0]; // the first tranche that pays starts the ladder
    const from = paying[0].plan.battery[0].year + 1;
    for (let y = from; y <= Math.min(ctx.years - 3, from + 6); y += 1) {
      if (stop()) { out.stopped = true; break; }
      const c = await run({ solarMw: S, battery: [...current.plan.battery, { year: y, mwh: B }] });
      Object.assign(c, stepOver(c, current)); // this tranche alone, over the ladder so far
      out.ladder.push(c);
      if (pays(c, ctx.targetIrr)) current = c;
    }
  }
  // the best plan by equity IRR, and the one that adds the most value at the bid's target IRR
  out.best = [...paying, current].reduce((a, c) => (better(c, a) ? c : a), bestSolar);
  out.ladderPlan = current !== bestSolar ? current : null;
  out.bestValue = [...out.solar, ...paying, current].reduce((a, c) => (c.equityNpvCr > a.equityNpvCr + 1e-6 ? c : a), ctx.base);

  // 4. the stresses of the best solar and of the best plan, and the bid lowered instead
  if (!out.stopped) {
    // the bid as it stands on the other connectivity: without injection in solar hours where the
    // cases sell the day's surplus, with solar-hour connectivity too where they do not (RfS 7.2
    // asks for non-solar-hour access; the bid's own surplus is at stake like the addition's)
    const [dayName, dayOver] = stressTests(ctx, false)[0];
    const bidSells = ctx.settings.dayInjection ? ctx.base.daySoldMuYr > 0.05 : ctx.state.inputs.merchant !== false && ctx.base.curtailedMuYr > 0.05;
    if (bidSells && !stop()) out.bidStress = { [dayName]: await run({ solarMw: 0, battery: [] }, dayOver) };
    const withBattery = out.ladderPlan || (out.best !== bestSolar ? out.best : null);
    const targets = [out.bestSolar, withBattery && withBattery !== ctx.base ? withBattery : null].filter(Boolean);
    for (const t of targets) {
      const key = t === out.bestSolar ? "bestSolar" : "best";
      out.stress[key] = {};
      // the battery plan differs from its solar by a late tranche: only the stress the battery answers is run for it
      const tests = stressTests(ctx, key === "bestSolar");
      for (const [name, over] of tests) {
        if (stop()) { out.stopped = true; break; }
        out.stress[key][name] = await run(t.plan, over);
      }
    }
    if (out.bestSolar && !out.stopped) {
      const sp = strikeWithSolar(ctx, S);
      out.lowerBid = isNum(sp) ? { solarMw: S, tariff: sp, change: sp - ctx.tariff } : null;
    }
  }
  if (onProgress) onProgress(total, total, "done");
  out.cases = [ctx.base, ...out.solar, ...out.timing, ...out.ladder];
  out.suggestions = suggestionsOf(out);
  return out;
}

const pc = (v, d = 1) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : "no IRR");
const cr = (v, d = 0) => (isNum(v) ? `₹${v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })} cr` : "–");
const term = (id) => { const t = TERMS.find((x) => x.id === id); return t ? { id, doc: t.doc, clause: t.clause, page: t.page, quote: t.quote } : null; };

/** What the sweep found, in sentences: each { kind: "do" | "consider" | "avoid" | "risk" | "rule", title, detail, plan?, cite? }. */
export function suggestionsOf(r) {
  const out = [];
  const base = r.base;
  const s = r.bestSolar;
  const bought = `${Math.round(TENDER.marketShare * 100)}%`;
  const dayOn = r.settings.dayInjection !== false; // the cases inject in solar hours (the bid's choice unless the settings say otherwise)
  const whoseAccess = r.bidDayInjection === false && !dayOn ? "The bid has" : "The cases take";
  // without solar-hour connectivity: what the added solar's surplus does
  const curtailedNote = (c) => (!dayOn && c.curtailedMuYr - base.curtailedMuYr > 0.5 ? ` ${whoseAccess} connectivity with non-solar-hour access only, so the added solar earns only by charging the battery: ${(c.curtailedMuYr - base.curtailedMuYr).toFixed(0)} MU a year more is curtailed in the day.` : "");
  if (s) {
    const first = r.solar[0];
    const gainDigits = Math.abs(s.equityIrr - base.equityIrr) < 0.001 ? 2 : 1; // a small gain is shown to two decimals
    out.push({
      kind: "do", plan: s.plan, cite: term("configChange"),
      title: `Add ${Math.round(s.plan.solarMw)} MWac of own solar: equity IRR ${pc(base.equityIrr, gainDigits)} → ${pc(s.equityIrr, gainDigits)} at the same tariff`,
      detail: `${cr(s.addCostCr)} more project cost, with no line or bay to pay for; SECI's Success Charges and the larger PBG on the added MW are in it (RfS 17.2, 18.3).${base.shortDays > s.shortDays ? ` Days short over the term fall from ${base.shortDays} to ${s.shortDays}: more energy is billed at the tariff and less is penalised.` : ""}${base.boughtCrYr - s.boughtCrYr > 0.05 ? ` Green-market power bought falls from ${cr(base.boughtCrYr, 1)} to ${cr(s.boughtCrYr, 1)} a year.` : ""}${s.daySoldMuYr > 0.5 ? ` The plant then sells ${s.daySoldMuYr.toFixed(0)} MU a year in the day at ₹${(s.dayPrice ?? 0).toFixed(2)}/kWh (${(s.daySoldMuYr - base.daySoldMuYr).toFixed(0)} MU more than the bid).` : ""}${curtailedNote(s)} On its own cost it returns ${pc(s.addProjectIrr)} before debt and ${pc(s.addEquityIrr)} on the equity put in.${first && first !== s ? ` The first ${Math.round(first.plan.solarMw)} MWac alone gives ${pc(first.equityIrr)}.` : ""} The Installed Capacity can be changed until the SCSD (RfS 4.2).`,
    });
    if (r.lowerBid) {
      out.push({
        kind: "consider", plan: s.plan,
        title: `Or bid lower: with that solar the same ${pc(r.targetIrr)} needs ₹${r.lowerBid.tariff.toFixed(2)}/kWh, ₹${Math.abs(r.lowerBid.change).toFixed(2)} ${r.lowerBid.change < 0 ? "below" : "above"} the bid`,
        detail: `The gain can be kept as return at ₹${r.tariff.toFixed(2)}, or spent on the tariff to win the auction. Run Optimise own RE on the Size step to make it the bid's plant.`,
      });
    }
  } else {
    const first = r.solar[0];
    out.push({ kind: "avoid", title: dayOn ? "More own solar does not raise the equity IRR at these prices" : "More own solar does not raise the equity IRR without solar-hour connectivity", detail: `Every size tried up to ${Math.round(r.settings.maxSolarPerMw * r.contractedMw)} MWac gives less than the bid's ${pc(base.equityIrr)}.${first ? ` The first ${Math.round(first.plan.solarMw)} MWac gives ${pc(first.equityIrr)}${first.daySoldMuYr > 0.5 ? `: its surplus sells in the day at ₹${(first.dayPrice ?? 0).toFixed(2)}/kWh` : ""}${isNum(first.addEquityIrr) ? `, and returns ${pc(first.addEquityIrr)} on its own equity` : ", and never pays back its own equity"}.${curtailedNote(first)}` : ""}` });
  }
  if (s && r.bestValue && r.bestValue.plan.solarMw > s.plan.solarMw && r.bestValue.plan.battery.length === 0) {
    const v = r.bestValue;
    out.push({ kind: "consider", plan: v.plan, title: `Up to ${Math.round(v.plan.solarMw)} MWac still adds value above your ${pc(r.targetIrr, 0)}: equity IRR ${pc(v.equityIrr)}, ${cr(v.equityNpvCr - s.equityNpvCr, 1)} more value than at ${Math.round(s.plan.solarMw)} MWac`, detail: `The equity IRR peaks at ${Math.round(s.plan.solarMw)} MWac; beyond it each MWac still returns more than the target on its own equity (${pc(v.addEquityIrr)} on the whole addition) but sells into lower day prices (₹${(v.dayPrice ?? 0).toFixed(2)}/kWh on ${v.daySoldMuYr.toFixed(0)} MU a year), so the blended IRR eases.` });
  }
  const B = Math.round(r.settings.trancheMwhPerMw * r.contractedMw);
  const ref = s || base;
  const paying = r.timing.filter((c) => pays(c, r.targetIrr));
  const day1 = r.timing.find((c) => c.plan.battery[0]?.year === 1);
  // where the added battery sells: the model takes the buyer to choose its four dearest evening hours
  const left = TENDER.peakEnd - TENDER.peakStart - TENDER.peakHours;
  const hours = `the evening hours outside the buyer's four hours (the model takes the buyer to choose its four dearest hours of ${TENDER.peakStart}:00 to ${TENDER.peakEnd}:00, which leaves ${left})`;
  if (paying.length) {
    const firstYear = paying[0].plan.battery[0].year;
    const lad = r.ladderPlan && r.ladderPlan.plan.battery.length > 1 ? r.ladderPlan : null;
    const shown = lad || paying[0];
    const n = shown.plan.battery.length;
    const small = Math.abs(shown.equityIrr - ref.equityIrr) < 0.001;
    const atScsd = day1 && (isNum(day1.stepEquityIrr) || day1.stepEquityAbove) ? `returns ${stepText(day1)} on its own cash` : "does not pay";
    out.push({
      kind: "do", plan: shown.plan, cite: term("essOtherUse"),
      title: lad ? `Add ${n} battery tranches of ${B} MWh from year ${lad.plan.battery[0].year}: each returns more than your ${pc(r.targetIrr, 0)}` : `A ${B} MWh battery for evening sale pays from year ${firstYear}: ${stepText(paying[0])} on its own cash`,
      detail: `With the battery price falling ${pc(r.settings.batteryDecline, 0)} a year, ${firstYear === 1 ? `a tranche bought at the SCSD ${atScsd}, above your ${pc(r.targetIrr, 0)} target` : `a tranche bought at the SCSD ${atScsd}; one bought in year ${firstYear} returns ${stepText(paying[0])}, above your ${pc(r.targetIrr, 0)} target`}. It is charged from the surplus own RE${dayOn ? "" : ", which is otherwise curtailed in the day"} (bought power for it sits inside the ${bought} limit of RfS 8.1.e) and sold in ${hours}${shown.batteryPrice ? `, at about ₹${shown.batteryPrice.toFixed(2)}/kWh` : ""}.${shown.laterCapexCr > 0 ? ` Tranches after the SCSD are paid from the project's cash, ${cr(shown.laterCapexCr)} in all.` : ""} The project's blended equity IRR moves from ${pc(ref.equityIrr, 2)} to ${pc(shown.equityIrr, 2)}${small ? " (late, small tranches add value without moving the blended figure much)" : ""}; the value to equity at your target rises by ${cr(shown.equityNpvCr - ref.equityNpvCr, 1)}.`,
    });
  } else if (r.timing.length) {
    const bestT = r.timing.reduce((a, c) => ((c.stepEquityIrr ?? -1) > (a.stepEquityIrr ?? -1) ? c : a), r.timing[0]);
    const bestText = isNum(bestT.stepEquityIrr) ? `it returns ${pc(bestT.stepEquityIrr)} on its own cash` : "it never pays back its own cash";
    out.push({
      kind: "avoid",
      title: `A battery for evening sale does not pay in any year tried, even with the price falling ${pc(r.settings.batteryDecline, 0)} a year`,
      detail: `The best is ${B} MWh in year ${bestT.plan.battery[0].year}: ${bestText}, against your ${pc(r.targetIrr, 0)} target${day1 && isNum(day1.stepEquityIrr) ? `; bought at the SCSD, ${pc(day1.stepEquityIrr)}` : ""}. It would sell in ${hours}. ${r.settings.dayInjection ? "Those hours do not pay enough over selling the same solar in the day." : "Those hours do not pay for it at this price."}`,
    });
  }
  // the connectivity the RfS asks for is for non-solar hours: the bid's own day sale is at the same
  // risk where the cases have it, and a what-if with solar-hour connectivity too where they do not
  const bidNoDay = r.bidStress?.noDayInjection || null;
  const bidWithDay = r.bidStress?.withDayInjection || null;
  if (bidNoDay) out.push({ kind: "risk", cite: term("substation"), title: `Without injection in solar hours, the bid as it stands gives ${pc(bidNoDay.equityIrr)}, not ${pc(base.equityIrr)}`, detail: `The RfS asks for connectivity with injection scheduling rights in non-solar hours (RfS 7.2). The bid sells ${base.daySoldMuYr.toFixed(0)} MU a year of surplus own RE in the day; without rights in solar hours ${bidNoDay.curtailedMuYr.toFixed(0)} MU a year is curtailed. Confirm the connectivity before counting on day sale, in the bid and in any addition.` });
  if (bidWithDay) out.push({ kind: "consider", cite: term("connectivityApplied"), title: `What if: with solar-hour connectivity too, the bid as it stands gives ${pc(bidWithDay.equityIrr)}, not ${pc(base.equityIrr)}, at the same tariff`, detail: `${whoseAccess} connectivity with non-solar-hour access only, as the tender asks (RfS 7.2): nothing is injected from 06:00 to 18:00 and ${base.curtailedMuYr.toFixed(0)} MU a year of surplus own RE is curtailed. With connectivity in the solar hours as well, ${bidWithDay.daySoldMuYr.toFixed(0)} MU a year would be sold in the day${isNum(bidWithDay.dayPrice) ? ` at ₹${bidWithDay.dayPrice.toFixed(2)}/kWh` : ""}. That is a matter of the connectivity you hold, not of the plant: if you hold it, say so on the Bid inputs step and the bid's tariff falls.` });
  for (const [key, c] of [["bestSolar", r.bestSolar], ["best", r.ladderPlan || (r.best !== r.bestSolar ? r.best : null)]]) {
    const st = r.stress?.[key];
    if (!c || !st) continue;
    const name = key === "bestSolar" ? `+${Math.round(c.plan.solarMw)} MWac of solar` : c.label;
    if (st.fromEquity) out.push({ kind: "risk", title: `Paid from equity, ${name} gives ${pc(st.fromEquity.equityIrr)}, not ${pc(c.equityIrr)}`, detail: `The gain needs debt on the addition (${pc(r.settings.debtShare ?? c.debtCr / c.costCr, 0)} assumed). A lender may not lend that much against ${dayOn ? "market revenue" : "what the addition adds"}: with the bid's debt only (${cr(st.fromEquity.debtCr)} of ${cr(st.fromEquity.costCr)}), the equity is ${cr(st.fromEquity.equityCr)}.` });
    if (st.noDayInjection) out.push({ kind: "risk", cite: term("substation"), title: `Without injection in solar hours, ${name} gives ${pc(st.noDayInjection.equityIrr)}${bidNoDay ? ` (the bid alone: ${pc(bidNoDay.equityIrr)})` : ""}`, detail: `The RfS asks for connectivity with injection scheduling rights in non-solar hours (RfS 7.2). If the connectivity granted carries no rights in solar hours, ${st.noDayInjection.curtailedMuYr.toFixed(0)} MU a year of surplus is curtailed. Confirm the connectivity before building solar for day sale.` });
    if (st.withDayInjection) out.push({ kind: "consider", cite: term("connectivityApplied"), title: `What if: with solar-hour connectivity too, ${name} gives ${pc(st.withDayInjection.equityIrr)}${bidWithDay ? ` (the bid alone: ${pc(bidWithDay.equityIrr)})` : ""}`, detail: `The same plan with injection in the solar hours as well: ${st.withDayInjection.daySoldMuYr.toFixed(0)} MU a year sold in the day${isNum(st.withDayInjection.dayPrice) ? ` at ₹${st.withDayInjection.dayPrice.toFixed(2)}/kWh` : ""}, at the same tariff. It needs connectivity the tender does not ask for (RfS 7.2).` });
    if (st.middayPrices) out.push({ kind: "risk", title: `With midday prices ${r.settings.middayStress < 0 ? "falling" : "rising"} ${pc(Math.abs(r.settings.middayStress), 0)} a year, ${name} gives ${pc(st.middayPrices.equityIrr)}`, detail: "The cases hold the IEX price year flat for the term. Solar sold in the day is a view on midday prices, which fall as more solar is built. The PPA supply earns the fixed tariff either way; only the market sales are exposed." });
  }
  out.push({ kind: "rule", cite: term("essOtherUse"), title: "The battery may be used for market sale outside the Peak Hours, with the PPA supply first", detail: "RfS 8.1.f and PPA 4.4.1.a.iv allow any other use of the storage, sale on a power exchange included, outside the Peak Hours and within the connectivity, without an NOC. The four hours the buyer chooses are the day's Peak Hours (RfS 8.1.a), so the cases sell in the evening hours it leaves." });
  out.push({ kind: "rule", cite: term("thirdPartyPenalty"), title: `Selling while the PPA supply is short costs ${TENDER.thirdPartyPenaltyMultiple} × the day's highest exchange rate`, detail: "It is charged on the quantum sold, on top of the shortfall penalty (RfS 8.1.f, PPA 4.4.1.a.iv). The cases sell nothing on a day the supply is short." });
  out.push({ kind: "rule", cite: term("connectivity"), title: "No connectivity above the Contracted Capacity", detail: "RfS 6.1 gives no additional connectivity for the RE or the storage above the Contracted Capacity: every case sells within the contracted MW in every hour, the supply included." });
  out.push({ kind: "rule", cite: term("marketShare"), title: `Bought power stays within ${bought} of the year's energy`, detail: `Green-market or bilateral power may be ${bought} of the annual energy, counted on the energy discharged (RfS 8.1.e); grid charging of the storage beyond it is not allowed (PPA 4.4.1.a.vii). The added battery shares that limit after the supply's own need, so in practice it charges from own RE.` });
  // what the cases sell on the exchange, and at what price: the day's surplus where they inject in
  // solar hours, else the added battery's evening energy
  const sellCase = dayOn ? [r.best, r.bestSolar, base].find((c) => c && isNum(c.dayPrice)) || null : [r.ladderPlan, r.best].find((c) => c && isNum(c.batteryPrice)) || null;
  const sellPrice = sellCase ? (dayOn ? sellCase.dayPrice : sellCase.batteryPrice) : null;
  out.push({ kind: "rule", cite: term("excess"), title: "SECI has the first right to the excess energy, at the tariff: an upside the cases do not count", detail: `PPA 9.3: SECI buys generation above the assured supply at the tariff if the Buying Entity consents, and it may be sold to others only if SECI refuses it. The cases ${dayOn ? `sell the surplus at exchange prices${isNum(sellPrice) ? ` (₹${sellPrice.toFixed(2)}/kWh in the day on average)` : ""}` : `inject nothing in the solar hours, so the day's surplus is curtailed and cannot go to SECI either; what they sell is the added battery's evening energy, at exchange prices${isNum(sellPrice) ? ` (₹${sellPrice.toFixed(2)}/kWh on average)` : ""},`} and count nothing from SECI.${isNum(sellPrice) && r.tariff > sellPrice ? ` Every MU that SECI takes at ₹${r.tariff.toFixed(2)}/kWh instead earns ${cr((r.tariff - sellPrice) / 10, 2)} more.` : ""} Offer the energy to SECI and keep its refusal on record before selling it elsewhere.` });
  out.push({ kind: "rule", cite: term("repower"), title: "Capacity added after the SCSD is at your risk and cost", detail: "The Installed Capacity stated in the bid can be changed until the SCSD (RfS 4.2). After that the plant may be reconfigured and repowered at the developer's risk and cost, and SECI buys only up to the Contracted Capacity (RfS 20.7, PPA 5.9): the battery tranches of later years are of that kind." });
  return out;
}

/** A case as plain numbers (for the screen, the API and the agent): no model, no cash flows. */
export function caseSummary(c) {
  if (!c) return null;
  const r = (v, d = 4) => (isNum(v) ? Number(v.toFixed(d)) : null);
  return {
    label: c.label, plan: c.plan,
    equityIrr: r(c.equityIrr), projectIrr: r(c.projectIrr), dEquityIrr: r(c.dEquityIrr), equityNpvCr: r(c.equityNpvCr, 2), dEquityNpvCr: r(c.dEquityNpvCr, 2),
    costCr: r(c.costCr, 2), addCostCr: r(c.addCostCr, 2), laterCapexCr: r(c.laterCapexCr, 2), debtCr: r(c.debtCr, 2), equityCr: r(c.equityCr, 2),
    addProjectIrr: r(c.addProjectIrr), addEquityIrr: r(c.addEquityIrr), stepProjectIrr: r(c.stepProjectIrr), stepEquityIrr: r(c.stepEquityIrr), stepEquityAbove: Boolean(c.stepEquityAbove),
    minDscr: r(c.minDscr, 3), minDscrYear: c.minDscrYear, shortDays: c.shortDays,
    daySoldMuYr: r(c.daySoldMuYr, 2), dayPrice: r(c.dayPrice, 3), batterySoldMuYr: r(c.batterySoldMuYr, 2), batteryPrice: r(c.batteryPrice, 3),
    soldCrYr: r(c.soldCrYr, 2), boughtCrYr: r(c.boughtCrYr, 2), curtailedMuYr: r(c.curtailedMuYr, 2),
  };
}

/** The sweep as plain data: the cases' numbers, the stresses, the suggestions. */
export function sweepSummary(r) {
  if (!r) return null;
  const stress = {};
  for (const [k, v] of Object.entries(r.stress || {})) stress[k] = Object.fromEntries(Object.entries(v).map(([n, c]) => [n, caseSummary(c)]));
  return {
    tariff: Number(r.tariff.toFixed(4)), targetIrr: r.targetIrr, settings: r.settings, bidDayInjection: r.bidDayInjection, contractedMw: r.contractedMw, years: r.years, stopped: r.stopped,
    base: caseSummary(r.base), solar: r.solar.map(caseSummary), timing: r.timing.map(caseSummary), ladder: r.ladder.map(caseSummary),
    best: caseSummary(r.best), bestSolar: caseSummary(r.bestSolar), bestValue: caseSummary(r.bestValue), ladderPlan: caseSummary(r.ladderPlan), stress,
    bidStress: r.bidStress ? Object.fromEntries(Object.entries(r.bidStress).map(([n, c]) => [n, caseSummary(c)])) : null, lowerBid: r.lowerBid, suggestions: r.suggestions,
  };
}

/**
 * A plan made the bid's own, as far as the bid can hold it: the solar becomes the bid's own solar,
 * a battery tranche at the SCSD becomes the bid's extra battery for evening sale. Tranches of later
 * years stay with the Upside step (the bid's plant is what is built for the SCSD).
 */
export function applyPlan(state, plan) {
  const p = cleanPlan(plan);
  const X = state.inputs?.contractedMw || 0;
  const day1 = p.battery.find((t) => t.year === 1);
  const inputs = { ...state.inputs, solarMw: (state.inputs.solarMw || 0) + p.solarMw };
  if (day1 && X > 0) inputs.extraEssMwhPerMw = Number(((state.inputs.extraEssMwhPerMw || 0) + day1.mwh / X).toFixed(3));
  return { state: { ...state, inputs, filled: { ...(state.filled || {}), solarMw: false, ...(day1 ? { extraEssMwhPerMw: false } : {}) } }, kept: p.battery.filter((t) => t.year > 1) };
}
