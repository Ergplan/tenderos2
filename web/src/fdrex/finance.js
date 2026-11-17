// SECI-FDRE-X priced by the shared financial model (web/src/rtc/engine.js runFinancialModel): the
// day-by-day operation of ./model.js, summed per operating year, becomes the engine's `ops`; the
// plant, costs and financing terms take the engine's shape; the engine then solves the tariff for
// the target equity IRR with its full treatment of tax (losses carried, WDV), working capital, the
// debt schedule (every repayment method, moratorium, refinancing), the construction IDC and the
// reserves, and the same workbook (web/lib/liveModel.js) rebuilds it as formulas.
// What this tender uses of the engine: charging power bought as an operating cost line; the
// discount for the Payment Security Mechanism and the exchange fees on market sales as another;
// the monthly shortfall penalty at 1.5 x the tariff on the energy short beyond the tolerance (the
// engine's tariff-multiple penalty); and SECI's charges as "other project cost".
// Forked from web/src/cfd/finance.js (function names kept). Plain JavaScript (no browser APIs),
// checked in Node by tools/check_fdrex_model.mjs.
import * as E from "../rtc/engine.js";
import { genSource } from "../model/generation.js";
import { LIVE_BESS_KEYS, LIVE_COST_KEYS, LIVE_FIN_KEYS, liveResults } from "../rtc/exportModel.js";
import { reviewBid } from "./review.js";
import { BENCHMARK_NOTE, WINNING_NOTE, BG_YEARS, CFD_FIN_DEFAULTS, ownReSource, CHOICES, FIELDS, augmentationText, essTotalMwhPerMw, exchangeValue, fmtDate, keyDates, penaltyMwh, psmDiscount, rfsAmounts } from "./model.js";
import { TENDER } from "./tender.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** What a simplification of the shared model means for this tender, shown beside the results. */
export const MODEL_NOTES = [
  "The whole project cost is spent before the SCSD (the Construction schedule when months are set): the tender has one commissioning date for the whole Project.",
  "Years are operating years from the SCSD (365 days each, the last with the term's extra days); the 5% sourcing limit is applied per Contract Year (April to March) and the shortfall per billing month in the day-by-day operation.",
  "The tariff is fixed for the term (no escalation); the monthly shortfall penalty moves with it in every year.",
  "The Buying Entity is taken to choose its four dearest evening hours (18:00 to 24:00) every day. A choice in the morning non-solar hours needs the same stored energy; it would change what the extra battery can sell.",
  "The tender asks for connectivity with non-solar-hour access (RfS 7.2): unless the bid says it holds solar-hour connectivity too, nothing is injected from 06:00 to 18:00 and the day's surplus solar is curtailed. What is sold is sold at exchange prices; SECI has the first right to buy excess energy at the tariff if the Buying Entity consents (PPA 9.3), which the model does not count on.",
];

/** The notes for a bid (the same for every bid of this tender). */
export const modelNotesOf = () => MODEL_NOTES;

/** Where an input came from, for the workbook: typed, or filled as a benchmark. */
const sourceOf = (state, key) => (state.filled?.[key] === "winning" ? WINNING_NOTE : state.filled?.[key] ? BENCHMARK_NOTE : "Your input");

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
    // the monthly shortfall penalty: 1.5 x the tariff on the energy short beyond 10% of a billing
    // month (RfS 8.2, PPA 4.4.1.b), the engine's tariff-multiple penalty on ops.blockShortfallMWh
    blockPenaltyMultiple: TENDER.penaltyMultiple,
    lcCostPct: 0, cfdPenaltyMultiple: 0, // no Letter of Credit and no weekly penalty in this tender
  };
  const bess = {
    ...E.DEFAULT_BESS,
    rte: i.rte, annualDegradation: i.essDegradation || 0,
    augmentation: state.bess?.augmentation || (i.augmentation === "annual" ? "annual" : "none"), augmentationYears: state.bess?.augmentationYears || undefined, augmentationYear: state.bess?.augmentationYear, costDeclinePct: i.augDecline || 0,
    augmentationPct: state.bess?.augmentationPct || [], augmentationCr: state.bess?.augmentationCr || [],
    durationH: i.essMwPerMw > 0 ? essTotalMwhPerMw(i) / i.essMwPerMw : 4,
  };
  const psm = psmDiscount(i); // ₹/kWh off every unit billed, when the bid opts for the Payment Security Mechanism
  const ref = model.opYears[model.opYears.length - 1];
  const ops = [];
  for (let y = 1; y <= years; y += 1) {
    const inTerm = y <= model.opYears.length;
    const row = inTerm ? model.opYears[y - 1] : ref;
    const extra = inTerm ? 0 : y - model.opYears.length;
    const scale = inTerm ? 1 : ((1 + (i.priceEscalation || 0)) ** extra) * (365 / Math.max(1, ref.days));
    const sold = inTerm ? row.merchantMwh : row.merchantMwh + row.deliveredMwh; // after the term: the peak supply too is sold at market prices
    const merchantRev = inTerm ? row.merchantRevCr : (row.merchantRevCr + row.mcpDeliveredCr) * scale;
    const rec = 0; // the supply goes to the Buying Entity under the PPA: no RECs to the developer
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
      surplusRevenueCr: merchantRev + rec, // surplus RE (and the extra battery's energy) sold in the market
      merchantRevenueCr: merchantRev,
      recRevenueCr: rec,
      curtailMWh: row.curtailedMwh,
      solarGenMWh: row.solarMwh, windGenMWh: row.windMwh,
      chargingCostCr: inTerm ? row.marketCostCr : row.marketCostCr * scale,
      // the PSM discount on the energy billed, and the exchange fees on what is sold in the market
      pxFeesCr: (psm * delivered + (i.pxFee || 0) * sold) * 1e-4,
      psmDiscountCr: psm * delivered * 1e-4,
      exchangeFeesCr: (i.pxFee || 0) * sold * 1e-4,
      lcMw: 0,
      penaltyWeeks: [],
      // the energy the monthly penalty is charged on: each billing month's shortfall beyond 10%
      blockShortfallMWh: inTerm ? penaltyMwh(row) : 0,
      days,
    });
  }
  return { sizes, costs, fin, bess, ops, dfrTarget: 0, rfs, bgCostCr };
}

/**
 * The financial model of the bid: the tariff solved for the target equity IRR (equity NPV at
 * the target, as the Tender to Bid tab), or the returns at state.fin.tariff when the tariff is
 * locked. Returns the engine's result with the engine inputs under `engine`.
 */
export function runCfdFinance(state, model, { tariffLocked = state.tariffLocked, tariff = null } = {}) {
  const eng = cfdEngineInputs(state, model);
  if (isNum(tariff)) eng.fin = { ...eng.fin, tariff };
  const finance = E.runFinancialModel(null, eng.sizes, { costs: eng.costs, fin: eng.fin, bess: eng.bess, dfrTarget: 0, tariffLocked: Boolean(tariffLocked), ops: eng.ops, solveBy: "npv" });
  return { ...finance, engine: eng };
}

/** The tariff to quote: the solved tariff rounded up to two decimals (the RfS takes two decimals, 39.3). */
export const quoteOf = (sp) => (isNum(sp) ? Math.ceil(sp * 100 - 1e-9) / 100 : null);

/** The returns at a tariff the bidder means to quote, against the solved one. */
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
    "market.sell": s("merchant"), "bess.augmentation": state.bess?.augmentation ? "Your input (Finance inputs)" : s("augmentation"), "bess.degradation": s("essDegradation"), "bess.costDeclinePct": s("augDecline"),
    "fin.debtFraction": s("debtFraction"), "fin.interestRate": s("interestRate"), "fin.tenorYears": s("tenorYears"), "fin.targetEquityIrr": s("targetEquityIrr"), "fin.discountRate": s("discountRate"), "fin.taxRate": s("taxRate"),
    "solar.degradation": s("solarDegradation"), "fin.tariffEscalation": "Tender: the tariff is fixed for the term (PPA 9.1)", "fin.blockPenaltyMultiple": "Tender (RfS 8.2.a, PPA 4.4.1.b)",
    "costs.otherCapexCr": "RfS: the cost of the RfS, the bid processing fee and the Success Charges with GST, and the EMD and PBG guarantees' cost",
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
    sizedLabel: ownReSource(state).kind === "optimised" ? "Optimiser: the least tariff with every day met" : ownReSource(state).kind === "guess" ? "A first guess (Fill up); Optimise own RE refines it" : "Your size",
    title: `SECI-FDRE-X bid financial model · ${Math.round(i.contractedMw)} MW × 4 h`,
    tariff: finance.tariff,
    tariffLocked: finance.tariffLocked,
    tariffLabel: "Tariff",
    dfrTarget: 0,
    split: false,
    market: i.sellMarket || null,
    on: { solar: eng.sizes.solarMw > 0, wind: eng.sizes.windMw > 0, hydro: false, biomass: false, thermal: false, bess: true },
    sizes: pick(eng.sizes, ["solarMw", "windMw", "bessMw", "bessMwh"]),
    costs: { ...pick(eng.costs, [...LIVE_COST_KEYS, "otherCapexCr"]), plants: [] },
    otherCapexLabel: "SECI's charges and the bank guarantees' cost",
    // the workbook's rows named for this tender (web/lib/liveModel.js `labels`)
    labels: {
      boughtGroup: "Bought and owed by year (SECI-FDRE-X, from the day-by-day operation)",
      charging: "Charging power bought (green market)", chargingNote: "The power bought to charge the battery, at the hourly GDAM price plus charges, within 5% of the year's energy (RfS 8.1.e)",
      chargingCost: "Charging power (green market)",
      pxFees: "PSM discount and exchange fees", pxFeesNote: "The discount for the Payment Security Mechanism on the energy billed (RfS 18.4) and the exchange fees on what is sold in the market",
      pxFeeCost: "PSM discount and exchange fees",
      blockShort: "Short beyond 10% of the billing months", blockShortNote: "Each billing month's energy short of 90% of its requirement, summed over the year, from the day-by-day operation (RfS 8.2.b)",
      blockMult: "Monthly shortfall penalty", blockMultNote: "On a billing month's energy short beyond 10%, at this multiple of the year's tariff (RfS 8.2.a, PPA 4.4.1.b)",
      blockPen: "Monthly shortfall penalty", blockPenNote: "Energy short beyond the 10% × multiple × the year's tariff",
    },
    fin: pick(eng.fin, LIVE_FIN_KEYS),
    bess: pick(eng.bess, LIVE_BESS_KEYS),
    ops: eng.ops.map((o) => pick(o, ["demandMWh", "deliveredMWh", "excessMWh", "surplusRevenueCr", "chargingCostCr", "pxFeesCr", "blockShortfallMWh", "solarGenMWh", "windGenMWh"])),
    gen,
    dispatch: null,
    sources: liveSources(state),
    app: liveResults(finance, eng.fin),
  };
}

/** The workbook request (POST /api/fdrex/model → web/lib/modelWorkbook.js): cover, inputs, plant, capex, the model's years and the Live model block. */
export function cfdModelExport({ state, model, finance, review = null }) {
  const eng = finance.engine || cfdEngineInputs(state, model);
  const i = model.inputs;
  const X = i.contractedMw;
  const y1 = finance.rows[0];
  const dates = keyDates(i.effectiveDate);
  const quote = quoteOf(finance.tariff);
  const psm = psmDiscount(i);
  const worth = exchangeValue(model.sim, finance.tariff);
  const worthYear = worth.find((p) => p.cy === 2) || worth[0];
  const outputs = [
    ["Tariff to bid (₹/kWh, two decimals)", quote, "tariff", "the solved tariff rounded up to two decimals (RfS 39.3)"],
    [finance.tariffLocked ? "Tariff (fixed by you, ₹/kWh)" : "Tariff for the target IRR (₹/kWh)", finance.tariff, "tariff", `${finance.tariffLocked ? "the returns below are at this tariff" : `for a ${(eng.fin.targetEquityIrr * 100).toFixed(2)}% equity IRR`}; fast screening ₹${(model.screening?.sp ?? model.sp)?.toFixed(4) ?? "–"}`, "tariff"],
    ...(psm > 0 ? [["Tariff received after the PSM discount (₹/kWh)", finance.tariff - psm, "tariff", `₹${psm.toFixed(2)}/kWh off every bill for cover under the Payment Security Mechanism (RfS 18.4)`]] : []),
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
    ["Exchange price of the hours supplied (₹/kWh)", worthYear?.mcpAvg ?? 0, "tariff", `at 2025–26 ${i.sellMarket} prices in the four dearest evening hours: what the same energy costs the buyer on the exchange`],
    ["Year-1 supply (MU)", y1.deliveredMu, "mu", `${(y1.dfr * 100).toFixed(1)}% of 4 MWh/MW a day`],
    ["Monthly shortfall penalty over the term (₹ cr)", finance.totals.blockPenalty ?? finance.totals.penalty ?? 0, "cr", "1.5 × the tariff on each billing month's shortfall beyond 10% (RfS 8.2)"],
    [`Revenue over ${finance.rows.length} years (₹ cr)`, finance.totals.revenue, "cr", "", "revenueTotal"],
  ];
  const plant = [
    ["Contracted capacity (MW)", X, "mw", "the bid"],
    ["Battery (MW)", eng.sizes.bessMw, "mw", `${i.essMwPerMw} MW per contracted MW`],
    ["Battery (MWh)", eng.sizes.bessMwh, "mw", `${i.essMwhPerMw} MWh per contracted MW (the buyer's four hours)${i.extraEssMwhPerMw ? ` plus ${i.extraEssMwhPerMw} MWh per MW for evening sale` : ""}`],
    ["Own solar (MWac)", eng.sizes.solarMw, "mw", ownReSource(state).label],
    ["Own wind (MW)", eng.sizes.windMw, "mw"],
    ["Effective Date of the PPA", fmtDate(dates.ed), "text"], ["SCSD (supply starts)", fmtDate(dates.scd), "text"], ["Term ends", fmtDate(dates.end), "text"],
  ];
  const keyInputs = [
    ["Exchange for market prices", i.sellMarket, "text", "the buyer's four dearest evening hours are taken from it"],
    ["Charging power", i.useMarket ? "own RE, and the green market within 5% of the year's energy" : "own RE only", "text"],
    ["Connectivity", i.dayInjection ? "non-solar hours and solar hours: the day's surplus RE is sold" : "non-solar-hour access only (RfS 7.2): nothing is injected from 06:00 to 18:00", "text"],
    ["Payment Security Mechanism", i.psm ? `opted for: ₹${TENDER.psmChargeRsPerKwh.toFixed(2)}/kWh off every bill` : "not opted for", "text"],
    ["Financing", `equity IRR ${(i.targetEquityIrr * 100).toFixed(1)}% · debt ${(i.debtFraction * 100).toFixed(0)}% at ${(i.interestRate * 100).toFixed(2)}% for ${i.tenorYears} years · tax ${(i.taxRate * 100).toFixed(2)}%`, "text"],
    ["Repayment", `${E.REPAYMENT_METHODS[eng.fin.repayment]?.label || eng.fin.repayment}${eng.fin.graceYears ? `, ${eng.fin.graceYears}-year moratorium` : ""}${eng.fin.refiYear ? `, refinanced in year ${eng.fin.refiYear}` : ""}`, "text"],
  ];
  const tender = [
    ["Procurer", "Solar Energy Corporation of India Limited (SECI)", "text"],
    ["Tender", "SECI-FDRE-X, RfS No. SECI/C&P/IPP/13/0012/26-27", "text", "Assured peak supply of 4800 MWh (1200 MW × 4 h) from ISTS-connected RE projects with storage"],
    ["Supply", `${TENDER.mwhPerMwDay} MWh per MW a day, in four hours the Buying Entity chooses from the non-solar hours (RfS 8.1)`, "text"],
    ["Term", `${TENDER.termYears} years from the SCSD, under a PPA with SECI (RfS 20.2)`, "text"],
    ["Payment", "The tariff on every kWh supplied in the Peak Hours, fixed for the term (PPA 9.1)", "text"],
    ["Shortfall", "1.5 × the tariff on a billing month's shortfall beyond 10% (RfS 8.2, PPA 4.4.1.b)", "text"],
    ["Bought power", "Up to 5% of a year's energy from the green market or a bilateral agreement (RfS 8.1.e)", "text"],
    ["Ceiling tariff", "None in the RfS", "text"],
  ];
  const notes = [...modelNotesOf(i), `Inputs marked "Industry benchmark" are ${BENCHMARK_NOTE.charAt(0).toLowerCase()}${BENCHMARK_NOTE.slice(1)}; those marked "Competitive-bidder value" are what a bidder who wins SECI's 2026 auctions shows a lender; the rest are the bidder's own (sheet Inputs).`];
  const inputs = FIELDS.map((f) => ({ group: f.section, input: f.label, value: i[f.key], unit: f.pct ? "%" : f.unit, source: sourceOf(state, f.key) }));
  for (const k of ["effectiveDate", "sellMarket", "useMarket", "merchant", "dayInjection", "psm", "augmentation", "afterTerm"]) {
    // the augmentation as the model runs it: the finance team's schedule or year-by-year table over the Design step's choice
    inputs.push({ group: "choice", input: CHOICES[k].label, value: k === "augmentation" ? augmentationText(state) : String(i[k]), unit: "", source: k === "augmentation" && state.bess?.augmentation ? "Your input" : sourceOf(state, k) });
  }
  for (const [label, value, unit] of [["Repayment", eng.fin.repayment], ["Principal moratorium", eng.fin.graceYears, "years"], ["Instalments a year", eng.fin.paymentsPerYear], ["Refinance at the end of year", eng.fin.refiYear, "year"], ["Receivable days", eng.fin.receivableDays, "days"], ["O&M in hand", eng.fin.omStockMonths, "months"], ["Maintenance spares", eng.fin.sparesPctOm, "%"], ["Debt service reserve", eng.fin.dsraMonths, "months"], ["Tax depreciation", eng.fin.taxDepreciation], ["Book life", eng.fin.bookLifeYears, "years"], ["Construction", eng.costs.constructionMonths, "months"]]) {
    inputs.push({ group: "Financing terms", input: label, value, unit: unit || "", source: "Finance inputs (editable on the Financial model)" });
  }
  const capexRows = [
    ["Battery", eng.sizes.bessMwh * eng.costs.bessCrPerMwh, "cr", `${Math.round(eng.sizes.bessMwh)} MWh`],
    ["Own solar", eng.sizes.solarMw * eng.costs.solarCrPerMw, "cr"],
    ["Own wind", eng.sizes.windMw * eng.costs.windCrPerMw, "cr"],
    ["Transmission to the ISTS substation", eng.costs.evacuationCr, "cr"],
    ["SECI's charges and the bank guarantees' cost", eng.costs.otherCapexCr, "cr", "RfS cost, bid processing fee, Success Charges with GST; EMD and PBG over their validity"],
    ["Total project cost (incl. pre-operative & IDC)", finance.capex.total, "cr", `pre-operative ${((eng.costs.preopPct || 0) * 100).toFixed(1)}% of hard cost`],
    ["Debt", finance.debt, "cr", `${(eng.fin.debtFraction * 100).toFixed(0)}%`],
    ["Equity", finance.equity, "cr"],
  ];
  const energy = { title: "Energy and tariff", lines: [
    ["Energy to supply (4 MWh/MW a day)", "demandMu", "mu", "MU"], ["Supplied under the PPA", "deliveredMu", "mu", "MU"], ["Supplied ÷ required", "dfr", "pct", "", false],
    ["Surplus RE sold in the market", "excessMu", "mu", "MU"], ["Tariff", "tariff", "tariff", "₹/kWh", false],
  ] };
  const revenue = { title: "Revenue", lines: [["PPA revenue (tariff × energy supplied)", "energyRevenue"], ["Surplus RE sold in the market", "surplusRevenue"], ["Monthly shortfall penalty", "penalty"], ["Total revenue", "revenue"]] };
  const costsSection = { title: "Operating costs", lines: [["O&M", "om"], ["Insurance", "insurance"], ["Scheduling, fees, admin", "other"], ["Charging power (green market)", "charging"], ["PSM discount and exchange fees", "pxFees"], ["Total operating cost", "opex"]] };
  const streams = [energy, revenue, costsSection, { title: "Capital spend in operation", lines: [["Battery augmentation", "augCapex"]] }];
  const statements = [
    energy, revenue, costsSection,
    { title: "Profit and loss", lines: [["EBITDA", "ebitda"], ["Book depreciation", "bookDep"], ["Interest", "interest"], ["Profit before tax", "pbt"], ["Tax depreciation", "taxDep"], ["Tax", "tax"], ["Profit after tax", "pat"]] },
    { title: "Cash flow", lines: [["Receivables", "receivables", "cr", "₹ cr", false], ["Working capital change", "dWc"], ["Battery augmentation", "augCapex"], ["CFADS", "cfads"], ["Debt service", "debtService"], ["Free cash to equity", "fcfe"], ["Cumulative equity cash", "cumEquity", "cr", "₹ cr", false], ["Project cash flow", "projectCf"]] },
    { title: "Debt", lines: [["Opening debt", "openingDebt", "cr", "₹ cr", false], ["Interest", "interest"], ["Principal", "principal"], ["Closing debt", "closingDebt", "cr", "₹ cr", false], ["DSCR", "dscr", "x", "×", false]] },
  ];
  return {
    fileName: `SECI_FDRE-X_bid_${X}MW_financial_model`,
    title: "SECI-FDRE-X · bid financial model",
    subtitle: [`${X} MW × 4 h assured peak supply`, `tariff ₹${quote?.toFixed(2)}/kWh`, `${finance.rows.length} years`].filter(Boolean).join(" · "),
    tenderNumber: "SECI/C&P/IPP/13/0012/26-27",
    cover: { outputs, plant, inputs: keyInputs, tender, notes },
    conditions: [],
    // the Bid review's findings (./review.js), a sheet of their own
    review: (review || reviewBid({ state, model, finance })).findings.map((f) => ({ severity: f.severity, title: f.title, detail: f.detail, step: f.step || "" })),
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
  return downloadFile("/api/fdrex/model", payload, `${payload.fileName}.xlsx`);
}

/**
 * The second version of the workbook: the same model with the 15-minute dispatch of every day of
 * the term behind the Live model's energy (web/lib/cfdBlockSheets.js with this tender's model). The server runs the
 * dispatch on the saved bid `state`.
 */
export function downloadCfdModel15(payload, state) {
  return downloadFile("/api/fdrex/model", { ...payload, blocks15: true, state }, `${payload.fileName}_15min.xlsx`);
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
