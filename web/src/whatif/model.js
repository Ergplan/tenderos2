// What-if analysis: the bidder's own sizes, costs, financing and bid tariff, run through an hourly
// dispatch of every PPA year against the tender's supply floors, then the 25-year financial model
// at that tariff. Answers: what equity and project IRR does this bid earn, what does the lender
// see, what tariff would the target IRR need, and does this plant meet the tender. Plain
// JavaScript, used in Node by tools/check_whatif.mjs.
//
// The dispatch is rule-based and instant (so every change answers at once): renewable output
// serves the contract; the battery charges from surplus; in the Peak Hours it discharges to the
// full contracted capacity, outside them only up to the off-peak floor, keeping energy for the
// peak. Energy is counted at the billing meter after the power transformer and line losses, as in
// the rest of the app. The HiGHS sizing in the SECI tab optimises the dispatch; this does not.
import * as E from "../rtc/engine.js";
import { scaleToCuf, peakHours } from "../bid/model.js";
import { PACK, PEAK_PLANS, seciTerms } from "../seci/terms.js";
import { genSource } from "../model/generation.js";
import { costliestHours } from "../seci/peakPrices.js";

export const WHATIF_NOTE = "Rule-based dispatch (battery held for the Peak Hours): an instant check of a size, not the HiGHS optimum.";

export function defaultWhatIf() {
  return {
    peakPlan: "price",
    shortfall: "penalty",
    contractedMw: 300,
    solarMwac: 785,
    dcAc: 1.4,
    windMw: 440,
    bessMw: 635,
    bessHours: 4,
    solarCuf: 0.25,
    windCuf: 0.33,
    trafoLossPct: 0.004,
    lineLossPct: 0.005,
    bess: { rte: 0.87, minSoc: 0.05, maxSoc: 0.95, annualDegradation: 0.02, augmentation: "annual", augmentationYear: 12, costDeclinePct: 0.03 },
    costs: { solarCrPerMwac: 4.0, windCrPerMw: 6.5, bessCrPerMwh: 1.2, bessPcsCrPerMw: 0, evacuationCr: 150, preopPct: 0.05 },
    om: { solarLakhPerMwac: 4.0, windLakhPerMw: 9.0, bessLakhPerMwh: 1.2 },
    fin: {
      tariff: 7.0,
      tariffEscalation: 0,
      targetEquityIrr: 0.14,
      debtFraction: 0.75,
      interestRate: 0.09,
      tenorYears: 18,
      repayment: "equal",
      taxRate: 0.2517,
      taxDepreciation: "wdv",
      wdvRate: 0.4,
      bookLifeYears: 25,
      salvagePct: 0.1,
      omEscalation: 0.05,
      insurancePct: 0.003,
      otherFixedCr: 0,
      receivableDays: 45,
      sellSurplus: true,
      surplusPrice: 3.0,
      solarDegradation: 0.005,
      windDegradation: 0,
      discountRate: 0.1,
      minDscr: 1.1,
    },
  };
}

/** The tender's rules this run checks: SECI RTC-TM-V, under the bidder's peak plan and shortfall choice. */
export function whatIfTerms(input) {
  return seciTerms({ peakPlan: input.peakPlan, shortfall: input.shortfall, ppaDate: null });
}

const profileCache = new Map();
/** Hourly capacity factors at the given CUF: the typical shape, or an uploaded one. */
export function profilesFor(input) {
  const key = `${input.solarCuf}|${input.dcAc}|${input.windCuf}|${input.solarUpload?.name || ""}|${input.windUpload?.name || ""}`;
  if (profileCache.has(key)) return profileCache.get(key);
  const solarShape = input.solarUpload?.values ? Float64Array.from(input.solarUpload.values) : E.synthSolarCf({ targetCuf: input.solarCuf, dcAc: input.dcAc || 1 });
  const windShape = input.windUpload?.values ? Float64Array.from(input.windUpload.values) : E.synthWindCf({ targetCuf: input.windCuf });
  const out = { solarCf: scaleToCuf(solarShape, input.solarCuf), windCf: scaleToCuf(windShape, input.windCuf) };
  if (profileCache.size > 20) profileCache.clear();
  profileCache.set(key, out);
  return out;
}

/** Which hours of the day are Peak Hours under the plan (1) and which are off-peak (0). */
export function peakHourMask(plan) {
  const p = PEAK_PLANS[plan] || PEAK_PLANS.any;
  const set = new Set(peakHours({ start: p.start, hours: p.hours }));
  return Array.from({ length: 24 }, (_, h) => (set.has(h) ? 1 : 0));
}

/**
 * The Peak Hours of the year, hour by hour: the costliest IEX hours of each day's window under the
 * "costliest hours" plan (when the prices are there), else the plan's hours of every day.
 */
export function peakYearMask(plan, prices = null) {
  const picked = PEAK_PLANS[plan]?.byPrice ? costliestHours(prices) : null;
  if (picked) return picked.mask;
  const day = peakHourMask(plan);
  return Uint8Array.from({ length: E.HOURS }, (_, t) => day[E.HOUR_OF_DAY[t]]);
}

/**
 * One year's hourly dispatch. f: the year's degradation factors (E.yearFactors). Returns the
 * year's totals at the meter, each floor's hours met and energy short, and (hourly: true) the hours.
 */
export function dispatchYear(input, prof, f, { hourly = false, peak: peakYear = null } = {}) {
  const terms = whatIfTerms(input);
  const peak = peakYear || peakYearMask(input.peakPlan);
  const floors = Object.fromEntries(terms.rules.map((r) => [r.hours, r.target]));
  const C = input.contractedMw;
  const poi = (1 - input.trafoLossPct) * (1 - input.lineLossPct);
  const S = input.solarMwac * f.solarFactor;
  const W = input.windMw * f.windFactor;
  const B = input.bessMw;
  const Ecap = input.bessMw * input.bessHours * f.bessFactor;
  const b = input.bess;
  const eta = Math.sqrt(Math.min(1, Math.max(0.5, b.rte)));
  const socMin = Ecap * b.minSoc;
  const socMax = Ecap * b.maxSoc;
  let soc = Ecap * 0.5;
  const busNeed = C / poi; // what the bus must send for the contract at the meter
  const sell = Boolean(input.fin.sellSurplus);
  const H = hourly ? { delivered: new Float32Array(E.HOURS), floor: new Float32Array(E.HOURS), solar: new Float32Array(E.HOURS), wind: new Float32Array(E.HOURS), discharge: new Float32Array(E.HOURS), charge: new Float32Array(E.HOURS), excess: new Float32Array(E.HOURS), curtail: new Float32Array(E.HOURS), soc: new Float32Array(E.HOURS), peak: new Uint8Array(E.HOURS) } : null;
  const t = { demand: 0, delivered: 0, excess: 0, curtail: 0, charge: 0, discharge: 0, solar: 0, wind: 0, injected: 0 };
  const rules = { peak: { hours: 0, met: 0, shortMWh: 0 }, offpeak: { hours: 0, met: 0, shortMWh: 0 } };
  for (let h = 0; h < E.HOURS; h += 1) {
    const isPeak = peak[h] === 1;
    const s = S * prof.solarCf[h];
    const w = W * prof.windCf[h];
    const g = s + w;
    const direct = Math.min(g, busNeed);
    let surplus = g - direct;
    // the battery fills the contract in the peak, only the floor outside it
    const want = isPeak ? busNeed : busNeed * (floors.offpeak ?? 0);
    let dis = 0;
    if (direct < want && Ecap > 0) dis = Math.max(0, Math.min(want - direct, B, (soc - socMin) * eta));
    soc -= dis / eta;
    let ch = 0;
    if (surplus > 0 && Ecap > 0) {
      ch = Math.max(0, Math.min(surplus, B, (socMax - soc) / eta));
      soc += ch * eta;
      surplus -= ch;
    }
    const deliveredBus = direct + dis;
    const room = sell ? Math.max(0, busNeed - deliveredBus) : 0;
    const ex = Math.min(surplus, room);
    const cu = surplus - ex;
    const delivered = deliveredBus * poi;
    const floor = (isPeak ? floors.peak : floors.offpeak) * C;
    const r = isPeak ? rules.peak : rules.offpeak;
    r.hours += 1;
    if (delivered >= floor - 1e-6) r.met += 1;
    else r.shortMWh += floor - delivered;
    t.demand += C;
    t.delivered += delivered;
    t.excess += ex * poi;
    t.curtail += cu;
    t.charge += ch;
    t.discharge += dis * poi;
    t.solar += s;
    t.wind += w;
    t.injected += deliveredBus + ex;
    if (H) {
      H.delivered[h] = delivered;
      H.floor[h] = floor;
      const share = g > 0 ? s / g : 0;
      H.solar[h] = direct * share * poi;
      H.wind[h] = direct * (1 - share) * poi;
      H.discharge[h] = dis * poi;
      H.charge[h] = ch;
      H.excess[h] = ex * poi;
      H.curtail[h] = cu;
      H.soc[h] = Ecap > 0 ? soc / Ecap : 0;
      H.peak[h] = isPeak ? 1 : 0;
    }
  }
  return {
    demandMWh: t.demand,
    deliveredMWh: t.delivered,
    excessMWh: t.excess,
    curtailMWh: t.curtail,
    chargeMWh: t.charge,
    dischargeMWh: t.discharge,
    solarGenMWh: t.solar,
    windGenMWh: t.wind,
    injectedMWh: t.injected,
    trafoLossMWh: t.injected * input.trafoLossPct,
    lineLossMWh: t.injected * (1 - input.trafoLossPct) * input.lineLossPct,
    meterMWh: t.injected * poi,
    blockShortfallMWh: rules.peak.shortMWh + rules.offpeak.shortMWh,
    rules: Object.fromEntries(Object.entries(rules).map(([k, r]) => [k, { ...r, share: r.hours ? r.met / r.hours : 1 }])),
    hourly: H,
  };
}

const sizesOf = (input) => ({
  solarMw: input.solarMwac,
  windMw: input.windMw,
  bessMw: input.bessMw,
  bessMwh: input.bessMw * input.bessHours,
});

const finOf = (input, terms) => ({
  ...E.DEFAULT_FINANCE,
  ...input.fin,
  years: terms.years || 25,
  solarOmLakhPerMw: input.om.solarLakhPerMwac,
  windOmLakhPerMw: input.om.windLakhPerMw,
  bessOmLakhPerMwh: input.om.bessLakhPerMwh,
  shortfallPenalty: 0,
  blockPenaltyMultiple: terms.shortfall === "hard" ? 0 : (terms.rules[0]?.penaltyMultiple || 0),
});

const costsOf = (input) => ({
  solarCrPerMw: input.costs.solarCrPerMwac,
  windCrPerMw: input.costs.windCrPerMw,
  bessCrPerMwh: input.costs.bessCrPerMwh,
  bessPcsCrPerMw: input.costs.bessPcsCrPerMw,
  evacuationCr: input.costs.evacuationCr,
  preopPct: input.costs.preopPct,
});

/** IRR of the lender's flows: the loan out in year 0, interest and principal back each year. */
function debtIrr(finance) {
  const flows = [-finance.debt, ...finance.rows.map((r) => (r.interest || 0) + (r.principal || 0))];
  return finance.debt > 0 ? E.irr(flows) : null;
}

/**
 * The whole what-if: dispatch of every year, the financial model at the bid tariff and the tariff
 * the target IRR needs, the lender's view and the tender checks.
 */
export function runWhatIf(raw, { prices = null } = {}) {
  const d = defaultWhatIf();
  const input = { ...d, ...raw, bess: { ...d.bess, ...(raw?.bess || {}) }, costs: { ...d.costs, ...(raw?.costs || {}) }, om: { ...d.om, ...(raw?.om || {}) }, fin: { ...d.fin, ...(raw?.fin || {}) } };
  const terms = whatIfTerms(input);
  const prof = profilesFor(input);
  const peak = peakYearMask(input.peakPlan, prices);
  const fin = finOf(input, terms);
  const bess = { ...E.DEFAULT_BESS, ...input.bess, durationH: input.bessHours };
  const sizes = sizesOf(input);
  const costs = costsOf(input);
  const years = fin.years;
  const ops = [];
  let year1 = null;
  for (let y = 1; y <= years; y += 1) {
    const f = E.yearFactors(y, fin, bess);
    const r = dispatchYear(input, prof, f, { hourly: y === 1, peak });
    if (y === 1) year1 = r;
    ops.push({ year: y, ...f, ...r, hourly: undefined });
  }
  const run = (locked, tariff = fin.tariff) => E.runFinancialModel(null, sizes, { costs, fin: { ...fin, tariff }, bess, dfrTarget: 0, tariffLocked: locked, ops, solveBy: "npv" });
  const atBid = run(true);
  const needed = run(false);
  const lenderIrr = debtIrr(atBid);
  // ---- tender checks
  const checks = [];
  const add = (id, label, ok, detail, hard = true) => checks.push({ id, label, ok, detail, hard });
  add("capacity", "Bid capacity", input.contractedMw >= terms.minBidMw && input.contractedMw <= terms.maxBidMw,
    `${input.contractedMw} MW; the tender takes ${terms.minBidMw}–${terms.maxBidMw} MW from one bidder`);
  add("storage", "Energy storage (mandatory)", input.bessMw > 0 && input.bessHours > 0, input.bessMw > 0 ? `${input.bessMw} MW × ${input.bessHours} h` : "No battery: the tender requires storage");
  add("re", "Renewable sources", input.solarMwac + input.windMw > 0, `${input.solarMwac} MWac solar, ${input.windMw} MW wind`);
  const hard = terms.shortfall === "hard";
  for (const rule of terms.rules) {
    const y1 = year1.rules[rule.hours];
    const worst = Math.min(...ops.map((o) => o.rules[rule.hours].share));
    add(rule.id, rule.label, hard ? worst >= 1 - 1e-9 : true,
      `year 1: ${(y1.share * 100).toFixed(1)}% of ${rule.hours === "peak" ? "peak" : "off-peak"} hours at ${(rule.target * 100).toFixed(0)}% of contracted; worst year ${(worst * 100).toFixed(1)}%`
        + (hard ? "" : `; short ${(y1.shortMWh / 1000).toFixed(1)} MU paid at ${rule.penaltyMultiple}× tariff`), hard);
  }
  const penaltyY1 = atBid.rows[0]?.blockPenalty || 0;
  const hardOk = checks.filter((c) => c.hard).every((c) => c.ok);
  const allFloors = terms.rules.every((r) => year1.rules[r.hours].share >= 1 - 1e-9);
  const verdict = !hardOk ? "fail" : allFloors ? "pass" : "penalty";
  const finance = {
    equityIrr: atBid.equityIrr,
    projectIrr: atBid.projectIrr,
    lenderIrr,
    equityNpv: atBid.equityNpv,
    projectNpv: atBid.projectNpv,
    minDscr: atBid.minDscr,
    avgDscr: atBid.avgDscr,
    lcoe: atBid.lcoe,
    payback: atBid.payback,
    tariffNeeded: needed.tariff,
    meetsTarget: Number.isFinite(atBid.equityIrr) && atBid.equityIrr >= fin.targetEquityIrr - 1e-6,
    bankable: atBid.minDscr === null || atBid.minDscr >= (input.fin.minDscr || 1.1) - 1e-9,
  };
  return { input, terms, prof, sizes, costs, fin, bess, ops, year1, atBid, needed, finance, checks, verdict, penaltyY1, live: liveRequest(input, terms, sizes, costs, fin, bess, ops, atBid, prof) };
}

/** The live-model request for the traceable model and the Excel workbook, at the bid tariff. */
function liveRequest(input, terms, sizes, costs, fin, bess, ops, finance, prof) {
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  return {
    title: `What-if · ${input.contractedMw} MW SECI RTC-TM at ₹${fin.tariff.toFixed(3)}/kWh`,
    engine: "simulation",
    sourceAll: "What-if tab",
    tariff: fin.tariff,
    tariffLocked: true,
    dfrTarget: 0,
    split: false,
    market: null,
    on: { solar: sizes.solarMw > 0, wind: sizes.windMw > 0, hydro: false, biomass: false, thermal: false, bess: sizes.bessMw > 0 },
    sizes,
    costs: { ...costs, plants: [] },
    fin: pick(fin, ["tariffEscalation", "solarOmLakhPerMw", "windOmLakhPerMw", "bessOmLakhPerMwh", "omEscalation", "insurancePct", "otherFixedCr", "surplusPrice", "shortfallPenalty", "blockPenaltyMultiple", "debtFraction", "interestRate", "tenorYears", "targetEquityIrr", "discountRate", "taxRate", "wdvRate", "bookLifeYears", "salvagePct", "receivableDays", "sellSurplus", "repayment", "taxDepreciation"]),
    bess: pick(bess, ["annualDegradation", "augmentation", "augmentationYear", "costDeclinePct"]),
    ops: ops.map((o) => pick(o, ["demandMWh", "deliveredMWh", "excessMWh", "blockShortfallMWh", "injectedMWh", "trafoLossMWh", "lineLossMWh", "meterMWh"])).map((o) => ({ ...o, genBusMWh: o.injectedMWh })),
    // the generation build-up: the profiles the dispatch ran, at the CUFs entered (at the 33 kV bus)
    gen: {
      solar: sizes.solarMw > 0 ? genSource({ cf: prof.solarCf, degradation: fin.solarDegradation, cufAt: "33 kV bus", profile: input.solarUpload?.name ? `Uploaded solar profile ${input.solarUpload.name}` : "Typical solar profile" }) : null,
      wind: sizes.windMw > 0 ? genSource({ cf: prof.windCf, degradation: fin.windDegradation, cufAt: "33 kV bus", profile: input.windUpload?.name ? `Uploaded wind profile ${input.windUpload.name}` : "Typical wind profile" }) : null,
    },
    app: { tariff: finance.tariff, equityIrr: finance.equityIrr, projectIrr: finance.projectIrr, minDscr: finance.minDscr },
  };
}

/** Sizes the tender allows: the SECI pack's bid range and its tendered capacity. */
export const SECI_LIMITS = { minBidMw: PACK.model.minBidMw, maxBidMw: PACK.model.maxBidMw, tenderedMw: PACK.tenderedMw };
