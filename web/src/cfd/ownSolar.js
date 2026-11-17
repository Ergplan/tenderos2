// The CfD Own Solar tab: the CfD bid as a bidder with solar of their own builds it.
//
// Two things differ from the CfD Bid tab's model, both switched by the bid's inputs:
//   * own RE's cost is spent when it is commissioned (inputs.reCostAtCod): the battery, the line
//     and SECI's charges are the project cost at the SCD; the RE's cost is put in by lenders and
//     equity in the operating year it is commissioned (finance.js cfdEngineInputs / withLateRe);
//   * an existing RE plant can charge the battery under a bilateral agreement, at a fixed price for
//     the first months from the SCD (inputs.bilateralMonths, bilateralPrice, bilateralCharges,
//     bilateralMw, bilateralUse; model.js simulate). It is part of the CfDA's green-market /
//     bilateral allowance (25% of the year's energy, and 75% more until month 36 from the
//     Effective Date, clause 4.4.1.iv as amended).
// Everything else is the CfD bid's: the same steps, checks, workbook and agent. This module holds
// the tab's own defaults, a bid's summary, the comparison of the two tabs' bids and the copy of
// one into the other. Plain JavaScript, checked in Node by tools/check_cfd_own_solar.mjs.
import { quoteOf } from "./finance.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);

/** The inputs this tab adds to a bid, with what a new bid starts from. */
export const OWN_SOLAR_DEFAULTS = {
  reCostAtCod: true, // own RE's cost spent in the year it is commissioned
  bilateralMonths: null, // months from the SCD the existing plant supplies (blank or 0: none)
  bilateralPrice: null, // ₹/kWh at the plant
  bilateralCharges: 0, // ₹/kWh of ISTS charges and losses on it
  bilateralMw: null, // the plant's MW (blank: as much as the battery takes)
  bilateralUse: "first", // "first": before the green market; "cheapest": only where it is the cheaper
};
export const OWN_SOLAR_KEYS = Object.keys(OWN_SOLAR_DEFAULTS);

/** Whether the bid has an existing plant to charge from. */
export const hasBilateral = (inputs) => isNum(inputs?.bilateralMonths) && inputs.bilateralMonths > 0 && isNum(inputs?.bilateralPrice) && inputs.bilateralPrice >= 0;

/** A bid in the numbers the two tabs are compared on (model: runModel, finance: runCfdFinance). */
export function bidSummary(state, model, finance) {
  const i = model.inputs;
  const ops = model.opYears;
  const n = ops.length;
  const late = finance.engine?.lateRe || null;
  const y1 = ops[0];
  const bought = (r) => r.chargeMarketMwh + r.chargeGroupMwh;
  const cost = (r) => r.marketCostCr + r.groupCostCr;
  const dscrs = finance.rows.filter((r) => r.dscr !== null);
  const minRow = dscrs.length ? dscrs.reduce((a, r) => (r.dscr < a.dscr ? r : a)) : null;
  return {
    tariff: finance.tariff,
    quote: quoteOf(finance.tariff),
    tariffLocked: Boolean(finance.tariffLocked),
    equityIrr: finance.equityIrr,
    projectIrr: finance.projectIrr,
    costAtScdCr: finance.capex.total,
    lateReCr: late ? late.capexCr : 0,
    lateReYear: late ? late.year : null,
    totalCostCr: finance.capex.total + (late ? late.capexCr : 0),
    debtCr: finance.debt + (late ? late.debtShare * late.capexCr : 0),
    equityCr: finance.equity + (late ? (1 - late.debtShare) * late.capexCr : 0),
    equityAtScdCr: finance.equity,
    solarMw: i.solarMw || 0,
    windMw: i.windMw || 0,
    batteryMwh: i.contractedMw * ((i.essMwhPerMw || 0) + (i.extraEssMwhPerMw || 0)),
    reCodMonths: i.reCodMonths || 0,
    shortDays: sum(ops, "shortDays"),
    suppliedMu: sum(ops, "deliveredMwh") / 1000,
    year1BoughtMu: bought(y1) / 1000,
    year1BoughtCr: cost(y1),
    year1BoughtPrice: bought(y1) > 0 ? (cost(y1) * 1e4) / bought(y1) : null,
    year1BilateralMu: (y1.chargeBilateralMwh || 0) / 1000,
    laterBoughtCrYr: n > 1 ? (sum(ops, "marketCostCr") + sum(ops, "groupCostCr") - cost(y1)) / (n - 1) : 0,
    daySoldMuYr: sum(ops, "merchantMwh") / n / 1000,
    minDscr: minRow ? minRow.dscr : null,
    minDscrYear: minRow ? minRow.year : null,
    revenueCr: finance.totals?.revenue ?? null,
    penaltyCr: sum(finance.rows, "cfdPenalty"),
  };
}

/**
 * The two bids side by side: [{ key, label, unit, a, b, diff, better }] with a = the CfD Bid
 * tab's bid and b = this tab's. `better` says which way is good for the bidder ("low" or "high"),
 * so the screen can mark it; rows without one are context.
 */
export function compareBids(a, b) {
  const row = (key, label, unit, better = null, digits = 2) => {
    const x = a[key];
    const y = b[key];
    return { key, label, unit, digits, a: x, b: y, diff: isNum(x) && isNum(y) ? y - x : null, better };
  };
  return [
    row("tariff", "Strike price for the target equity IRR", "₹/kWh", "low", 3),
    row("quote", "Strike price to bid (two decimals)", "₹/kWh", "low", 2),
    row("equityIrr", "Equity IRR", "%", "high"),
    row("projectIrr", "Project IRR", "%", "high"),
    row("solarMw", "Own solar", "MWac", null, 0),
    row("reCodMonths", "Own RE commissioned, months after the SCD", "months", null, 0),
    row("costAtScdCr", "Project cost at the SCD", "₹ cr", null, 1),
    row("lateReCr", "Own RE's cost, put in when it is commissioned", "₹ cr", null, 1),
    row("totalCostCr", "Capital in all", "₹ cr", "low", 1),
    row("equityAtScdCr", "Equity put in at the SCD", "₹ cr", "low", 1),
    row("equityCr", "Equity in all", "₹ cr", "low", 1),
    row("debtCr", "Debt in all", "₹ cr", null, 1),
    row("year1BoughtMu", "Year 1: charging power bought", "MU", null, 1),
    row("year1BilateralMu", "  of which from the existing plant", "MU", null, 1),
    row("year1BoughtPrice", "Year 1: what the bought power costs", "₹/kWh", "low", 2),
    row("year1BoughtCr", "Year 1: cost of the charging power bought", "₹ cr", "low", 1),
    row("laterBoughtCrYr", "Later years: cost of the charging power bought, a year", "₹ cr", "low", 1),
    row("daySoldMuYr", "Surplus sold in the market, a year", "MU", null, 1),
    row("shortDays", "Days short of the daily supply", "days", "low", 0),
    row("minDscr", "Minimum DSCR", "×", "high"),
    row("revenueCr", "Revenue over the term", "₹ cr", null, 0),
  ];
}

/**
 * The CfD Bid tab's bid brought into this tab: its inputs, finance terms, costs, battery and plant
 * detail, with this tab's own inputs kept as they are (or at their defaults). The forms, letters
 * and the team's answers stay with each tab.
 */
export function copyBid(from, into) {
  const own = Object.fromEntries(OWN_SOLAR_KEYS.map((k) => [k, into?.inputs?.[k] ?? OWN_SOLAR_DEFAULTS[k]]));
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    ...into,
    inputs: { ...clone(from.inputs), ...own },
    filled: clone(from.filled) || {},
    fin: clone(from.fin) || {},
    costs: clone(from.costs) || {},
    bess: clone(from.bess) || {},
    losses: clone(from.losses) ?? null,
    locks: {},
    sized: clone(from.sized) ?? null,
    studio: clone(from.studio) || {},
    solarUpload: clone(from.solarUpload) ?? null,
    windUpload: clone(from.windUpload) ?? null,
    solarMonthScale: clone(from.solarMonthScale) || new Array(12).fill(1),
    windMonthScale: clone(from.windMonthScale) || new Array(12).fill(1),
    tariffLocked: Boolean(from.tariffLocked),
    quoteTariff: from.quoteTariff ?? null,
    upside: clone(from.upside),
  };
}
