// SECI CfD-I priced by the shared financial model (web/src/rtc/engine.js runFinancialModel): the
// day-by-day operation of ./model.js, summed per operating year, becomes the engine's `ops`; the
// plant, costs and financing terms take the engine's shape; the engine then solves the strike
// price for the target equity IRR with its full treatment of tax (losses carried, WDV), working
// capital, the debt schedule (every repayment method, moratorium, refinancing), the construction
// IDC and the reserves, and the same workbook (web/lib/liveModel.js) rebuilds it as formulas.
// The engine's additions for this tender (default off elsewhere): charging power and exchange
// fees as operating cost lines, the Letter of Credit to SECI and the weekly shortfall penalty,
// both moving with the strike price, and SECI's charges as "other project cost".
// Plain JavaScript (no browser APIs), checked in Node by tools/check_cfd_finance.mjs.
import * as E from "../rtc/engine.js";
import { genSource } from "../model/generation.js";
import { LIVE_BESS_KEYS, LIVE_COST_KEYS, LIVE_FIN_KEYS, liveResults } from "../rtc/exportModel.js";
import { BENCHMARK_NOTE, BG_YEARS, CFD_FIN_DEFAULTS, CHOICES, FIELDS, essTotalMwhPerMw, fmtDate, keyDates, lcCr, poolFlows, rfsAmounts } from "./model.js";
import { TENDER } from "./terms.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** What a simplification of the shared model means for this tender, shown beside the results. */
export const MODEL_NOTES = [
  "The whole project cost is spent before the SCD (the Construction schedule when months are set): own RE commissioned after the SCD is a conservative simplification, its cost carried from year 0.",
  "Years are operating years from the SCD (365 days each, the last with the term's extra days); the sourcing limits are still applied per Contract Year (April to March) in the day-by-day operation.",
  "The strike price is fixed for the term (no escalation); the Letter of Credit and the weekly penalty move with it in every year.",
];

/** Where an input came from, for the workbook: typed, or filled as a benchmark. */
const sourceOf = (state, key) => (state.filled?.[key] ? BENCHMARK_NOTE : "Your input");

/**
 * The engine's inputs for the bid: { sizes, costs, fin, bess, ops, dfrTarget }. `model` is
 * runModel(state, prices) (its inputs with the derived values and the operating years).
 */
export function cfdEngineInputs(state, model) {
  const i = model.inputs;
  const X = i.contractedMw;
  const rfs = rfsAmounts(i);
  // the EMD and PBG bank guarantees' cost over their validity, with SECI's charges: paid before the SCD
  const bgCostCr = rfs.emdCr * (i.pbgCostPct || 0) * BG_YEARS.emd + rfs.pbgCr * (i.pbgCostPct || 0) * BG_YEARS.pbg;
  const sizes = { solarMw: i.solarMw || 0, windMw: i.windMw || 0, bessMw: X * i.essMwPerMw, bessMwh: X * essTotalMwhPerMw(i) };
  const costs = {
    solarCrPerMw: i.solarCrPerMw || 0, windCrPerMw: i.windCrPerMw || 0, bessCrPerMwh: i.essCrPerMwh, bessPcsCrPerMw: 0,
    evacuationCr: X * (i.evacuationCrPerMw || 0),
    otherCapexCr: rfs.seciChargesCr + bgCostCr,
    preopPct: i.preopPct || 0,
    constructionMonths: Math.max(0, Math.round(state.costs?.constructionMonths || 0)),
    drawdown: state.costs?.drawdown || "linear",
    drawOrder: state.costs?.drawOrder || "proRata",
    // the finance team's inputs (docs/dev/FINANCE-V3-SPEC.md)
    phasing: state.costs?.phasing || null,
    moduleSharePct: state.costs?.moduleSharePct ?? 0.45,
  };
  const scd = i.effectiveDate ? keyDates(i.effectiveDate).scd : null;
  const tail = i.afterTerm === "merchant" ? Math.max(0, Math.round(i.merchantYears || 0)) : 0;
  const years = model.opYears.length + tail;
  const sf = state.fin || {};
  const fin = {
    ...E.DEFAULT_FINANCE,
    ...sf,
    // the timeline: the bidder's COD, else the SCD from the Effective Date
    codDate: sf.codDate || (Number.isFinite(scd) ? new Date(scd).toISOString().slice(0, 10) : null),
    years,
    tariff: isNum(sf.tariff) ? sf.tariff : model.sp,
    tariffEscalation: 0,
    targetEquityIrr: i.targetEquityIrr, debtFraction: i.debtFraction, interestRate: i.interestRate, tenorYears: i.tenorYears, taxRate: i.taxRate,
    omEscalation: i.omEscalation, insurancePct: i.insurancePct,
    solarOmLakhPerMw: i.solarOmLakhPerMw || 0, windOmLakhPerMw: i.windOmLakhPerMw || 0, bessOmLakhPerMwh: i.essOmLakhPerMwh,
    otherFixedCr: ((i.otherFixedLakhPerMw || 0) * X) / 100,
    discountRate: i.discountRate,
    sellSurplus: true, surplusPrice: 0, extraExportMw: 0,
    shortfallPenalty: 0, blockPenaltyMultiple: 0,
    solarDegradation: i.solarDegradation || 0, windDegradation: 0,
    bookLifeYears: isNum(sf.bookLifeYears) && sf.bookLifeYears > 0 ? sf.bookLifeYears : i.essLifeYears,
    // the Letter of Credit (CfDA 10.4.2) and the weekly shortfall penalty (CfDA 4.4.3)
    lcCostPct: i.lcCostPct || 0, lcMinPrice: TENDER.lcMinPrice, lcDays: TENDER.lcDays, cfdPenaltyMultiple: TENDER.penaltyMultiple,
  };
  const bess = {
    ...E.DEFAULT_BESS,
    rte: i.rte, annualDegradation: i.essDegradation || 0,
    augmentation: state.bess?.augmentation || (i.augmentation === "annual" ? "annual" : "none"), augmentationYears: state.bess?.augmentationYears || undefined, augmentationYear: state.bess?.augmentationYear, costDeclinePct: i.augDecline || 0,
    durationH: i.essMwPerMw > 0 ? essTotalMwhPerMw(i) / i.essMwPerMw : 2,
  };
  const recShare = 1 - TENDER.recPoolShare; // the bidder keeps 50% of the REC proceeds (CfDA 9.2.vi)
  const ref = model.opYears[model.opYears.length - 1];
  const ops = [];
  for (let y = 1; y <= years; y += 1) {
    const inTerm = y <= model.opYears.length;
    const row = inTerm ? model.opYears[y - 1] : ref;
    const extra = inTerm ? 0 : y - model.opYears.length;
    const scale = inTerm ? 1 : ((1 + (i.priceEscalation || 0)) ** extra) * (365 / Math.max(1, ref.days));
    const sold = inTerm ? row.merchantMwh : row.merchantMwh + row.deliveredMwh; // after the term: the peak supply too is sold at market prices
    const merchantRev = inTerm ? row.merchantRevCr : (row.merchantRevCr + row.mcpDeliveredCr) * scale;
    const rec = ((i.recPrice || 0) * row.recMwh * (inTerm ? recShare : 1)) / 1e7 * (inTerm ? 1 : 365 / Math.max(1, ref.days));
    const delivered = inTerm ? row.deliveredMwh : 0;
    const days = inTerm ? row.days : 365;
    ops.push({
      year: y,
      ...E.yearFactors(y, fin, bess),
      demandMWh: X * TENDER.mwhPerMwDay * days,
      deliveredMWh: delivered,
      dfr: inTerm ? row.deliveredMwh / Math.max(1e-9, row.requiredMwh) : 0,
      minMonthlyDfr: NaN,
      excessMWh: sold,
      surplusRevenueCr: merchantRev + rec, // surplus RE sold in the market, and the bidder's share of the RECs
      merchantRevenueCr: merchantRev,
      recRevenueCr: rec,
      curtailMWh: row.curtailedMwh,
      solarGenMWh: row.solarMwh, windGenMWh: row.windMwh,
      chargingCostCr: inTerm ? row.marketCostCr + row.groupCostCr : (row.marketCostCr + row.groupCostCr) * scale,
      pxFeesCr: (i.pxFee || 0) * (delivered + sold) * 1e-4,
      lcMw: inTerm ? X : 0,
      penaltyWeeks: inTerm ? row.weeks.filter((w) => w.beyondMwh > 1e-9).map((w) => ({ ref: w.ref, beyondMwh: w.beyondMwh })) : [],
      days,
    });
  }
  return { sizes, costs, fin, bess, ops, dfrTarget: 0, rfs, bgCostCr };
}

/**
 * The financial model of the bid: the strike price solved for the target equity IRR (equity NPV at
 * the target, as the Tender to Bid tab), or the returns at state.fin.tariff when the tariff is
 * locked. Returns the engine's result with the engine inputs under `engine`.
 */
export function runCfdFinance(state, model, { tariffLocked = state.tariffLocked, tariff = null } = {}) {
  const eng = cfdEngineInputs(state, model);
  const fin = isNum(tariff) ? { ...eng.fin, tariff } : eng.fin;
  const finance = E.runFinancialModel(null, eng.sizes, { costs: eng.costs, fin, bess: eng.bess, dfrTarget: 0, tariffLocked: Boolean(tariffLocked), ops: eng.ops, solveBy: "npv" });
  return { ...finance, engine: { ...eng, fin } };
}

/** The strike price to quote: the solved price rounded up to two decimals (digits beyond two are ignored, RfS 40.3). */
export const quoteOf = (sp) => (isNum(sp) ? Math.ceil(sp * 100 - 1e-9) / 100 : null);

/** The returns at a strike price the bidder means to quote, against the solved one. */
export function quotedStrikeReturns(state, model, finance, quote) {
  if (!finance || !isNum(quote) || quote <= 0) return null;
  const target = finance.tariffLocked ? runCfdFinance(state, model, { tariffLocked: false }) : finance;
  const at = runCfdFinance(state, model, { tariffLocked: true, tariff: quote });
  const gap = quote - target.tariff;
  const status = gap >= -0.005 ? "ok" : !isNum(at.equityIrr) || at.equityIrr <= 0 ? "loss" : "below";
  const pct = (v) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : "no IRR (the equity is never paid back)");
  const message = status === "ok"
    ? `At ₹${quote.toFixed(2)}/kWh the equity IRR is ${pct(at.equityIrr)} (target ${pct(target.engine.fin.targetEquityIrr)}), project IRR ${pct(at.projectIrr)}.`
    : `₹${quote.toFixed(2)}/kWh is ₹${(-gap).toFixed(3)} below the ₹${target.tariff.toFixed(3)}/kWh your ${pct(target.engine.fin.targetEquityIrr)} target equity IRR needs. At this price the equity IRR is ${pct(at.equityIrr)} and the project IRR ${pct(at.projectIrr)}.`;
  return { quote, targetTariff: target.tariff, targetEquityIrr: target.engine.fin.targetEquityIrr, equityIrr: at.equityIrr, projectIrr: at.projectIrr, targetProjectIrr: target.projectIrr, minDscr: at.minDscr, gap, gapPct: gap / target.tariff, status, message };
}

// ---------------------------------------------------------------- the workbook

/** The input-source labels the Live model reads, by the engine's keys. */
function liveSources(state) {
  const s = (k) => sourceOf(state, k);
  // every finance input that differs from the model's default is the bidder's (fin.refiYear and
  // the like), so the Inputs sheet does not call a changed value "Model default"
  const fin = {};
  for (const [k, v] of Object.entries(state.fin || {})) {
    if (v === undefined || v === null) continue;
    if (JSON.stringify(v) !== JSON.stringify(CFD_FIN_DEFAULTS[k]) && JSON.stringify(v) !== JSON.stringify(E.DEFAULT_FINANCE[k])) fin[`fin.${k}`] = "Your input";
  }
  return {
    ...fin,
    "solar.capex": s("solarCrPerMw"), "wind.capex": s("windCrPerMw"), "bess.capex": s("essCrPerMwh"), "costs.evacuationCr": s("evacuationCrPerMw"), "costs.preopPct": s("preopPct"),
    "solar.om": s("solarOmLakhPerMw"), "wind.om": s("windOmLakhPerMw"), "bess.om": s("essOmLakhPerMwh"), "fin.omEscalation": s("omEscalation"), "fin.insurancePct": s("insurancePct"), "fin.otherFixedCr": s("otherFixedLakhPerMw"),
    "market.sell": s("merchant"), "bess.augmentation": s("augmentation"), "bess.degradation": s("essDegradation"), "bess.costDeclinePct": s("augDecline"),
    "fin.debtFraction": s("debtFraction"), "fin.interestRate": s("interestRate"), "fin.tenorYears": s("tenorYears"), "fin.targetEquityIrr": s("targetEquityIrr"), "fin.discountRate": s("discountRate"), "fin.taxRate": s("taxRate"),
    "solar.degradation": s("solarDegradation"), "fin.lcCostPct": s("lcCostPct"), "fin.tariffEscalation": "Tender: the strike price is fixed for the term",
    "costs.otherCapexCr": "RfS: the cost of the RfS, the bid fee and the Contract Administration Charges with GST, and the EMD and PBG guarantees' cost",
  };
}

/** The Live model sheet's request for the bid (web/lib/liveModel.js): inputs, the operation by year and the app's results. */
export function cfdLiveRequest({ state, model, finance }) {
  const eng = finance.engine || cfdEngineInputs(state, model);
  const i = model.inputs;
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
  const prof = model.prof;
  const gen = {
    solar: eng.sizes.solarMw > 0 && prof?.solar ? genSource({ cf: prof.solar, toBus: 0, degradation: eng.fin.solarDegradation, cufAt: "AC side", profile: state.solarUpload?.name ? `${state.solarUpload.name}, scaled to your CUF` : `Typical solar profile at your CUF, DC:AC ${i.solarDcAc || 1.4}` }) : null,
    wind: eng.sizes.windMw > 0 && prof?.wind ? genSource({ cf: prof.wind, toBus: 0, degradation: i.windDegradation || 0, cufAt: "AC side", profile: state.windUpload?.name ? `${state.windUpload.name}, scaled to your CUF` : "Typical wind profile at your CUF" }) : null,
  };
  return {
    title: `SECI CfD-I bid financial model · ${Math.round(i.contractedMw)} MW × 2 h`,
    tariff: finance.tariff,
    tariffLocked: finance.tariffLocked,
    tariffLabel: "Strike price",
    dfrTarget: 0,
    split: false,
    market: i.sellMarket || null,
    on: { solar: eng.sizes.solarMw > 0, wind: eng.sizes.windMw > 0, hydro: false, biomass: false, thermal: false, bess: true },
    sizes: pick(eng.sizes, ["solarMw", "windMw", "bessMw", "bessMwh"]),
    costs: { ...pick(eng.costs, [...LIVE_COST_KEYS, "otherCapexCr"]), plants: [] },
    otherCapexLabel: "SECI's charges and the bank guarantees' cost",
    fin: pick(eng.fin, [...LIVE_FIN_KEYS, "lcCostPct", "lcMinPrice", "lcDays", "cfdPenaltyMultiple"]),
    bess: pick(eng.bess, LIVE_BESS_KEYS),
    ops: eng.ops.map((o) => ({ ...pick(o, ["demandMWh", "deliveredMWh", "excessMWh", "surplusRevenueCr", "chargingCostCr", "pxFeesCr", "lcMw", "solarGenMWh", "windGenMWh"]), penaltyWeeks: o.penaltyWeeks })),
    gen,
    dispatch: null,
    sources: liveSources(state),
    app: liveResults(finance, eng.fin),
  };
}

/** The workbook request (POST /api/cfd/model → web/lib/modelWorkbook.js): cover, inputs, plant, capex, the model's years and the Live model block. */
export function cfdModelExport({ state, model, finance }) {
  const eng = finance.engine || cfdEngineInputs(state, model);
  const i = model.inputs;
  const X = i.contractedMw;
  const y1 = finance.rows[0];
  const dates = keyDates(i.effectiveDate);
  const quote = quoteOf(finance.tariff);
  const pool = poolFlows(model.sim, finance.tariff);
  const poolYear = pool.find((p) => p.cy === 2) || pool[0];
  const outputs = [
    ["Strike price to bid (₹/kWh, two decimals)", quote, "tariff", `the solved price rounded up; digits after two decimals are ignored (RfS 40.3)`],
    [finance.tariffLocked ? "Strike price (fixed by you, ₹/kWh)" : "Strike price for the target IRR (₹/kWh)", finance.tariff, "tariff", `${finance.tariffLocked ? "the returns below are at this price" : `for a ${(eng.fin.targetEquityIrr * 100).toFixed(2)}% equity IRR`}; fast screening ₹${(model.screening?.sp ?? model.sp)?.toFixed(4) ?? "–"}`, "tariff"],
    ["Equity IRR", finance.equityIrr, "pct", "", "equityIrr"],
    ["Project IRR", finance.projectIrr, "pct", "", "projectIrr"],
    ["Equity NPV at the target IRR (₹ cr)", finance.equityNpv, "cr", "", "equityNpv"],
    ["Minimum DSCR", finance.minDscr, "x", "", "minDscr"],
    ["Average DSCR", finance.avgDscr, "x", "", "avgDscr"],
    ["Equity payback (year)", finance.payback ?? "beyond the term", "int", "", "payback"],
    ["Project cost (₹ cr)", finance.capex.total, "cr", `₹${(finance.capex.total / X).toFixed(2)} cr per contracted MW`, "capexTotal"],
    ["Debt (₹ cr)", finance.debt, "cr", "", "debt"],
    ["Equity (₹ cr)", finance.equity, "cr", "", "equity"],
    ["Levelised cost of supply (₹/kWh)", finance.lcoe, "tariff", `at a ${(eng.fin.discountRate * 100).toFixed(1)}% discount rate`, "lcoe"],
    ["Letter of Credit to SECI (₹ cr)", lcCr(X, finance.tariff), "cr", "2000 × MW × (₹10 − SP) × 30 (CfDA 10.4.2)"],
    ["CfD Pool, net pay-in a year (₹ cr)", poolYear?.netCr ?? 0, "cr", "at 2025–26 market prices in your two best evening hours; negative: the Pool pays you"],
    ["Year-1 supply (MU)", y1.deliveredMu, "mu", `${(y1.dfr * 100).toFixed(1)}% of 2 MWh/MW a day`],
    [`Revenue over ${finance.rows.length} years (₹ cr)`, finance.totals.revenue, "cr", "", "revenueTotal"],
  ];
  const plant = [
    ["Contracted capacity (MW)", X, "mw", "the bid"],
    ["Battery (MW)", eng.sizes.bessMw, "mw", `${i.essMwPerMw} MW per contracted MW`],
    ["Battery (MWh)", eng.sizes.bessMwh, "mw", `${i.essMwhPerMw} MWh per contracted MW (at least 2, Amendment-02)${i.extraEssMwhPerMw ? ` plus ${i.extraEssMwhPerMw} MWh per MW for evening sale` : ""}`],
    ["Own solar (MWac)", eng.sizes.solarMw, "mw", state.filled?.solarMw ? "a first guess; Optimise own RE refines it" : "your size"],
    ["Own wind (MW)", eng.sizes.windMw, "mw"],
    ["Effective Date", fmtDate(dates.ed), "text"], ["SCD (battery, supply starts)", fmtDate(dates.scd), "text"], ["Own RE commissioned", fmtDate(model.sim.dates.reCod), "text"], ["Term ends", fmtDate(dates.end), "text"],
  ];
  const keyInputs = [
    ["Market sold in", i.sellMarket, "text", CHOICES.sellMarket.options.find(([k]) => k === i.sellMarket)?.[1] || ""],
    ["Charging power", `${i.useMarket ? "green market" : "no green market"}${i.useGroup ? ", group RE after month 36" : ""}`, "text"],
    ["Financing", `equity IRR ${(i.targetEquityIrr * 100).toFixed(1)}% · debt ${(i.debtFraction * 100).toFixed(0)}% at ${(i.interestRate * 100).toFixed(2)}% for ${i.tenorYears} years · tax ${(i.taxRate * 100).toFixed(2)}%`, "text"],
    ["Repayment", `${E.REPAYMENT_METHODS[eng.fin.repayment]?.label || eng.fin.repayment}${eng.fin.graceYears ? `, ${eng.fin.graceYears}-year moratorium` : ""}${eng.fin.refiYear ? `, refinanced in year ${eng.fin.refiYear}` : ""}`, "text"],
  ];
  const tender = [
    ["Procurer", "Solar Energy Corporation of India Limited (SECI)", "text"],
    ["Tender", "SECI-CfD-I, RfS No. SECI/C&P/IPP/13/0002/26-27", "text", "Assured peak supply of 1000 MWh (500 MW × 2 h) under a Contract for Difference"],
    ["Supply", `${TENDER.mwhPerMwDay} MWh per MW a day in 2 hours of 18:00–24:00`, "text"],
    ["Term", `${TENDER.termYears} years from the SCD (Amendment-03)`, "text"],
    ["Settlement", "The strike price on every kWh supplied; the market price risk is the CfD Pool's (Amendment-03)", "text"],
    ["Ceiling tariff", "None (removed by Amendment-03)", "text"],
  ];
  const notes = [...MODEL_NOTES, `Inputs marked "Industry benchmark" are ${BENCHMARK_NOTE.charAt(0).toLowerCase()}${BENCHMARK_NOTE.slice(1)}; the rest are the bidder's own (sheet Inputs).`];
  const inputs = FIELDS.map((f) => ({ group: f.section, input: f.label, value: i[f.key], unit: f.pct ? "%" : f.unit, source: sourceOf(state, f.key) }));
  for (const k of ["effectiveDate", "sellMarket", "useMarket", "useGroup", "merchant", "augmentation", "afterTerm"]) {
    inputs.push({ group: "choice", input: CHOICES[k].label, value: String(i[k]), unit: "", source: sourceOf(state, k) });
  }
  for (const [label, value, unit] of [["Repayment", eng.fin.repayment], ["Principal moratorium", eng.fin.graceYears, "years"], ["Instalments a year", eng.fin.paymentsPerYear], ["Refinance at the end of year", eng.fin.refiYear, "year"], ["Receivable days", eng.fin.receivableDays, "days"], ["O&M in hand", eng.fin.omStockMonths, "months"], ["Maintenance spares", eng.fin.sparesPctOm, "%"], ["Debt service reserve", eng.fin.dsraMonths, "months"], ["Tax depreciation", eng.fin.taxDepreciation], ["WDV rate", eng.fin.wdvRate, "%"], ["Book life", eng.fin.bookLifeYears, "years"], ["Salvage value", eng.fin.salvagePct, "%"], ["Construction", eng.costs.constructionMonths, "months"]]) {
    inputs.push({ group: "Financing terms", input: label, value, unit: unit || "", source: "Finance inputs (editable on the Financial model)" });
  }
  const capexRows = [
    ["Battery", eng.sizes.bessMwh * eng.costs.bessCrPerMwh, "cr", `${Math.round(eng.sizes.bessMwh)} MWh`],
    ["Own solar", eng.sizes.solarMw * eng.costs.solarCrPerMw, "cr"],
    ["Own wind", eng.sizes.windMw * eng.costs.windCrPerMw, "cr"],
    ["Transmission to the ISTS substation", eng.costs.evacuationCr, "cr"],
    ["SECI's charges and the bank guarantees' cost", eng.costs.otherCapexCr, "cr", "RfS cost, bid fee, Contract Administration Charges with GST; EMD and PBG over their validity"],
    ["Total project cost (incl. pre-operative & IDC)", finance.capex.total, "cr", `pre-operative ${((eng.costs.preopPct || 0) * 100).toFixed(1)}% of hard cost`],
    ["Debt", finance.debt, "cr", `${(eng.fin.debtFraction * 100).toFixed(0)}%`],
    ["Equity", finance.equity, "cr"],
  ];
  const energy = { title: "Energy and strike price", lines: [
    ["Energy to supply (2 MWh/MW a day)", "demandMu", "mu", "MU"], ["Supplied under the CfD", "deliveredMu", "mu", "MU"], ["Supplied ÷ required", "dfr", "pct", "", false],
    ["Surplus RE sold in the market", "excessMu", "mu", "MU"], ["Strike price", "tariff", "tariff", "₹/kWh", false],
  ] };
  const revenue = { title: "Revenue", lines: [["CfD revenue (strike price × energy supplied)", "energyRevenue"], ["Surplus RE sold and RECs", "surplusRevenue"], ["Weekly shortfall penalty", "penalty"], ["Total revenue", "revenue"]] };
  const costsSection = { title: "Operating costs", lines: [["O&M", "om"], ["Insurance", "insurance"], ["Scheduling, fees, admin", "other"], ["Charging power (green market, group RE)", "charging"], ["Exchange fees", "pxFees"], ["Letter of Credit to SECI", "lcCost"], ["Total operating cost", "opex"]] };
  const streams = [energy, revenue, costsSection, { title: "Capital spend in operation", lines: [["Battery augmentation", "augCapex"]] }];
  const statements = [
    energy, revenue, costsSection,
    { title: "Profit and loss", lines: [["EBITDA", "ebitda"], ["Book depreciation", "bookDep"], ["Interest", "interest"], ["Profit before tax", "pbt"], ["Tax depreciation", "taxDep"], ["Tax", "tax"], ["Profit after tax", "pat"]] },
    { title: "Cash flow", lines: [["Receivables", "receivables", "cr", "₹ cr", false], ["Working capital change", "dWc"], ["Battery augmentation", "augCapex"], ["CFADS", "cfads"], ["Debt service", "debtService"], ["Free cash to equity", "fcfe"], ["Cumulative equity cash", "cumEquity", "cr", "₹ cr", false], ["Project cash flow", "projectCf"]] },
    { title: "Debt", lines: [["Opening debt", "openingDebt", "cr", "₹ cr", false], ["Interest", "interest"], ["Principal", "principal"], ["Closing debt", "closingDebt", "cr", "₹ cr", false], ["DSCR", "dscr", "x", "×", false]] },
  ];
  return {
    fileName: `SECI_CfD-I_bid_${X}MW_financial_model`,
    title: "SECI CfD-I · bid financial model",
    subtitle: [`${X} MW × 2 h assured peak supply`, `strike price ₹${quote?.toFixed(2)}/kWh`, `${finance.rows.length} years`].filter(Boolean).join(" · "),
    tenderNumber: "SECI/C&P/IPP/13/0002/26-27",
    cover: { outputs, plant, inputs: keyInputs, tender, notes },
    conditions: [],
    inputs,
    plant,
    capex: capexRows,
    rows: finance.rows,
    streams,
    statements,
    flows: { equity: finance.equityFlows, project: finance.projectFlows },
    live: cfdLiveRequest({ state, model, finance }),
  };
}

/** POST the request and save the workbook (the browser). */
export function downloadCfdModel(payload) {
  return downloadFile("/api/cfd/model", payload, `${payload.fileName}.xlsx`);
}

/** POST a request and save the file it answers with (the workbooks, the 15-minute dispatch). */
export async function downloadFile(url, payload, fileName) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}
