// Tender to Bid: the "Live model" sheet of the bid workbook. The same financial model as the app
// (web/src/rtc/engine.js cashflows), written as Excel formulas: every number is a formula on the
// inputs (blue on yellow, on their own Inputs sheet) and on the optimiser's year-by-year energy
// (green), so the bidder can change an input and see the tariff's returns move. Each formula cell
// also carries its value, worked out here line by line the same way, so viewers that do not
// recalculate still show it; tools/check_live_model.mjs recalculates the workbook with LibreOffice
// and checks both against the app.
//
// Finance v3 (docs/dev/FINANCE-V3-SPEC.md): the Inputs sheet apart from the model, the dated year
// row, the operating factors (part commissioning, the generation case, the life extension, the
// repowering), the carbon credits, the O&M by source and the other fixed cost by line, the
// guarantees and their margin money, the reserve's interest, the depreciation on both bases with
// the asset register, the tax with thin capitalisation and the pools of losses carried, the debt
// with the step-down, the top-up, the cash sweep and the prepayment fee, the mezzanine and the
// quasi-equity, the cover ratios, the returns at the SPV, the holding company, the promoter and
// the lender, and the balance sheet with every asset line.
//
// Units: energy in MU (million kWh), money in ₹ crore, prices in ₹/kWh. MU × ₹/kWh ÷ 10 = ₹ crore.

import { addDispatchSheet, dispatchRef } from "./dispatchSheets.js";
import { DEFAULT_FINANCE, FINANCE_V3_KEYS, runFinancialModel, sensitivities as reverseAuction, xirr as xirrOf, mirr as mirrOf } from "../src/rtc/engine.js";

export const LIVE_SHEET = "Live model";
export const INPUTS_SHEET = "Inputs";
export const CONSTRUCTION_SHEET = "Construction";
export const DEBT_SHEET = "Debt schedule";
export const DEPRECIATION_SHEET = "Depreciation and tax";
export const WORKING_CAPITAL_SHEET = "Working capital";
export const PL_SHEET = "Profit and loss";
export const CASH_FLOW_SHEET = "Cash flow";
export const BALANCE_SHEET = "Balance sheet";
export const TAX_SHEET = "Tax schedule";
export const RETURNS_SHEET = "Returns";
export const GUARANTEES_SHEET = "Guarantees and reserves";
export const MEZZ_SHEET = "Quasi-equity and mezzanine";
export const SENSITIVITY_SHEET = "Sensitivity";
/** The schedule sheets beside the Live model (every cell a formula on it), in tab order. */
export const SCHEDULE_SHEETS = [CONSTRUCTION_SHEET, PL_SHEET, CASH_FLOW_SHEET, BALANCE_SHEET, DEBT_SHEET, DEPRECIATION_SHEET, WORKING_CAPITAL_SHEET, TAX_SHEET, RETURNS_SHEET, GUARANTEES_SHEET, MEZZ_SHEET, SENSITIVITY_SHEET];
/** Every sheet the live model writes formulas on (the checks recalculate them all). */
export const FORMULA_SHEETS = [LIVE_SHEET, INPUTS_SHEET, ...SCHEDULE_SHEETS];

// the sensitivity steps: capex and CUF relative, the interest rate in percentage points
const SENS_CAPEX = [-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2];
const SENS_CUF = [-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15];
const SENS_RATE = [-0.02, -0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015, 0.02];

/** The engine's run on a Live model request's inputs and energy (the model the sheet mirrors). */
function engineArgs(m) {
  const N = m.ops.length;
  return { costs: m.costs, fin: { ...m.fin, years: N, tariff: m.tariff }, bess: m.bess, dfrTarget: m.dfrTarget, ops: m.ops, solveBy: "npv" };
}

/**
 * The sensitivities of a Live model request: the tariff the target equity IRR needs and the equity
 * IRR at the model's tariff, with the capex, the solar and wind CUFs and the interest rate moved
 * one at a time, and three two-way grids. Each point is a full run of the app's financial model
 * (web/src/rtc/engine.js runFinancialModel) on the request's inputs and yearly energy: a solved
 * tariff cannot be one Excel formula, so the sheet carries the app's numbers. A CUF change scales
 * the energy delivered and sold in proportion to that source's share of the generation; the
 * dispatch, the floors and the storage are not rerun (TenderOS's What-if does that).
 */
export function sensitivityTables(m) {
  const base0 = engineArgs(m);
  const fin = base0.fin;
  const baseCosts = m.costs;
  const sz = m.sizes;
  const genOf = (k) => (m.gen?.[k]?.cuf > 0 ? (sz[`${k}Mw`] || 0) * m.gen[k].cuf : 0);
  const genAll = genOf("solar") + genOf("wind");
  const share = { solar: genAll > 0 ? genOf("solar") / genAll : 0, wind: genAll > 0 ? genOf("wind") / genAll : 0 };
  const run = ({ capex = 0, rate = 0, solarCuf = 0, windCuf = 0 } = {}) => {
    const k = 1 + capex;
    const costs = {
      ...baseCosts,
      solarCrPerMw: baseCosts.solarCrPerMw * k, windCrPerMw: baseCosts.windCrPerMw * k, bessCrPerMwh: baseCosts.bessCrPerMwh * k, bessPcsCrPerMw: (baseCosts.bessPcsCrPerMw || 0) * k,
      biomassCrPerMw: (baseCosts.biomassCrPerMw || 0) * k, evacuationCr: (baseCosts.evacuationCr || 0) * k,
      plants: (baseCosts.plants || []).map((pl) => ({ ...pl, capexCrPerMw: (pl.capexCrPerMw || 0) * k })),
    };
    const f = { ...fin, interestRate: Math.max(0, fin.interestRate + rate) };
    const e = 1 + solarCuf * share.solar + windCuf * share.wind;
    const ops = e === 1 ? m.ops : m.ops.map((o) => ({
      ...o, deliveredMWh: o.deliveredMWh * e, excessMWh: o.excessMWh * e, buyerExcessMWh: (o.buyerExcessMWh || 0) * e,
      ...(finite(o.surplusRevenueCr) ? { surplusRevenueCr: o.surplusRevenueCr * e } : {}),
    }));
    const args = { costs, fin: f, bess: m.bess, dfrTarget: m.dfrTarget, ops, solveBy: "npv" };
    const solved = runFinancialModel(null, sz, { ...args, tariffLocked: false });
    const atTariff = runFinancialModel(null, sz, { ...args, tariffLocked: true });
    return { tariff: solved.tariff, irr: atTariff.equityIrr, dscr: atTariff.minDscr };
  };
  const base = run();
  const oneWay = [
    { key: "capex", title: "Capital cost (every item)", unit: "change", fmt: "pct", steps: SENS_CAPEX, at: (d) => ({ capex: d }), value: (d) => d },
    ...(share.solar > 0 ? [{ key: "solarCuf", title: `Solar CUF (${(m.gen.solar.cuf * 100).toFixed(2)}% in the bid)`, unit: "CUF", fmt: "pct", steps: SENS_CUF, at: (d) => ({ solarCuf: d }), value: (d) => m.gen.solar.cuf * (1 + d) }] : []),
    ...(share.wind > 0 ? [{ key: "windCuf", title: `Wind CUF (${(m.gen.wind.cuf * 100).toFixed(2)}% in the bid)`, unit: "CUF", fmt: "pct", steps: SENS_CUF, at: (d) => ({ windCuf: d }), value: (d) => m.gen.wind.cuf * (1 + d) }] : []),
    { key: "rate", title: `Interest rate (${(fin.interestRate * 100).toFixed(2)}% in the bid)`, unit: "rate", fmt: "pct", steps: SENS_RATE, at: (d) => ({ rate: d }), value: (d) => fin.interestRate + d },
  ].map((t) => ({ ...t, points: t.steps.map((d) => ({ step: d, value: t.value(d), ...run(t.at(d)) })) }));
  const grid = (rowsT, colsT, at) => ({
    rows: rowsT, cols: colsT,
    tariff: rowsT.steps.map((r) => colsT.steps.map((c) => run(at(r, c)).tariff)),
  });
  const T = Object.fromEntries(oneWay.map((t) => [t.key, t]));
  const grids = [
    { title: "Tariff for the target equity IRR: capital cost × interest rate", ...grid(T.capex, T.rate, (r, c) => ({ capex: r, rate: c })) },
    ...(T.solarCuf ? [{ title: "Tariff for the target equity IRR: capital cost × solar CUF", ...grid(T.capex, T.solarCuf, (r, c) => ({ capex: r, solarCuf: c })) }] : []),
    ...(T.windCuf ? [{ title: "Tariff for the target equity IRR: capital cost × wind CUF", ...grid(T.capex, T.windCuf, (r, c) => ({ capex: r, windCuf: c })) }] : []),
    ...(T.solarCuf ? [{ title: "Tariff for the target equity IRR: interest rate × solar CUF", ...grid(T.rate, T.solarCuf, (r, c) => ({ rate: r, solarCuf: c })) }] : []),
  ];
  // the reverse-auction axes of the finance team (web/src/rtc/engine.js sensitivities): the module
  // cost, the exchange rate, the generation case, a commissioning delay, a longer life, the
  // refinancing rate, beside the capital cost and the interest rate
  const auction = reverseAuction(null, sz, { ...base0, tariff: m.tariff });
  return { base, oneWay, grids, share, targetIrr: fin.targetEquityIrr, tariff: m.tariff, tariffLocked: Boolean(m.tariffLocked), auction };
}
export const REPAYMENT_LIST = ["equal", "annuity", "sculpted", "balloon", "bullet", "stepUp"];
export const DRAWDOWN_LIST = ["linear", "sCurve", "front", "back"];
export const AUGMENTATION_LIST = ["annual", "oneTime", "schedule", "none"];
export const CASE_LIST = ["p50", "p75", "p90"];
export const DSRA_BASIS_LIST = ["next", "peak"];
export const BOOK_LIST = ["slm", "wdv"];
export const MEZZ_REPAY_LIST = ["equal", "bullet"];
export const REFI_REPAY_LIST = ["same", ...REPAYMENT_LIST];
const SLOTS = 6; // rows in each input table (parts, wind O&M components, other fixed lines, guarantees, augmentation years)
const PHASED = ["solar", "wind", "bess", "evac", "other"]; // the hard-cost parts that can have their own spend window
const REGISTER = ["solar", "wind", "bess", "pcs", "evac", "other", "preop", "idc", "fees"]; // the asset register's components
const INT_LAPSE_YEARS = 8; // disallowed interest (thin capitalisation) lapses after eight years

const INK = "FF111111";
const ACCENT = "FFD4FF3F";
const STYLE = {
  input: { font: { color: { argb: "FF0000FF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } } },
  opt: { font: { color: { argb: "FF00703C" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } } },
  calc: { font: { color: { argb: "FF000000" } } },
  app: { font: { italic: true, color: { argb: "FF666666" } } },
};
const THIN = { style: "thin", color: { argb: "FFBFBFBF" } };
const FMT = {
  cr: '#,##0.00;[Red]-#,##0.00;"–"',
  mu: '#,##0.0;[Red]-#,##0.0;"–"',
  mw: '#,##0.0;[Red]-#,##0.0;"–"',
  tariff: "0.000",
  pct: "0.00%",
  factor: "0.0000",
  x: '0.00"×"',
  int: "0",
  num: "#,##0.00",
  year: '"Year "0',
  text: "@",
  date: "yyyy-mm-dd",
  month: "mmm yyyy",
};

const colName = (n) => {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
};
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const sumOf = (arr) => arr.reduce((a, x) => a + (finite(x) ? x : 0), 0);

function irr(flows) {
  const npv = (r) => flows.reduce((s, cf, i) => s + cf / (1 + r) ** i, 0);
  let lo = -0.99;
  let hi = 1.5;
  let fLo = npv(lo);
  if (!Number.isFinite(fLo) || fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (fm * fLo > 0) { lo = mid; fLo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- dates as Excel serial numbers (days since 1899-12-30), moved as the engine moves them
// (web/src/rtc/engine.js shiftDate: the month first, then the days, each rolling over like
// Excel's DATE(year, month + k, day + d))
const EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86400e3;
const serialOf = (iso) => {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : Math.round((d.getTime() - EPOCH) / DAY_MS);
};
const shiftSerial = (serial, months, days = 0) => {
  const d = new Date(EPOCH + serial * DAY_MS);
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate() + days) - EPOCH) / DAY_MS);
};
/** The Excel formula for a date cell moved by months and days, rolling over as the engine does. */
const dateF = (cell, months, days = 0) => `DATE(YEAR(${cell}),MONTH(${cell})+${months},DAY(${cell})${days < 0 ? `-${-days}` : days > 0 ? `+${days}` : ""})`;

/** The sheet writer: rows of labels, units, a value or total column, year 0 and the years. */
class Sheet {
  constructor(ws, years) {
    this.ws = ws;
    this.N = years;
    this.row = 0;
    this.cell = {}; // key → "$C$12" (one value, or "'Inputs'!$C$12" on the Inputs sheet) or row number (a year series)
    this.val = {}; // key → value, or [year 0, year 1, ..., year N]
    this.yearRow = 0;
    this.datesRow = 0; // the year's first day under the year numbers (finance v3)
  }

  col(y) { return colName(4 + y); } // year 0 in D, year 1 in E

  get last() { return this.col(this.N); }

  /** A year series' cell in year y (y = 0 is the investment year). */
  at(key, y) { return `${this.col(y)}${this.cell[key]}`; }

  /** A year series across years 1..N. */
  span(key, from = 1) { return `${this.col(from)}${this.cell[key]}:${this.last}${this.cell[key]}`; }

  /** A single value's absolute address (sheet-qualified when it is an input). */
  s(key) { return this.cell[key]; }

  yr(y) { return `${this.col(y)}$${this.yearRow}`; }

  v(key, y) { return y === undefined ? this.val[key] : this.val[key]?.[y]; }

  next() { this.row += 1; return this.ws.getRow(this.row); }

  blank() { this.next(); }

  put(cell, { f, v, fmt, kind = "calc", bold = false }) {
    if (f) {
      cell.value = finite(v) || typeof v === "string" ? { formula: f, result: v } : { formula: f };
      // exceljs drops a falsy result (0, "") when the value is set; keep it so the cell shows it
      if ((v === 0 || v === "") && cell._value?.model) cell._value.model.result = v;
    } else cell.value = v ?? null;
    if (fmt) cell.numFmt = FMT[fmt] || fmt;
    const st = STYLE[kind] || STYLE.calc;
    cell.font = { ...st.font, bold };
    if (st.fill) cell.fill = st.fill;
    if (kind === "input" || kind === "opt") cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  }

  label(r, text, unit, { note, bold, indent } = {}) {
    const a = r.getCell(1);
    a.value = text;
    a.font = { bold: Boolean(bold) };
    if (indent) a.alignment = { indent };
    if (note) a.note = note;
    if (unit) {
      r.getCell(2).value = unit;
      r.getCell(2).font = { color: { argb: "FF666666" } };
    }
  }

  section(title) {
    this.blank();
    const r = this.next();
    for (let c = 1; c <= 4 + this.N; c += 1) {
      r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    }
    r.getCell(1).value = title;
    r.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
    r.height = 20;
  }

  group(title) {
    const r = this.next();
    r.getCell(1).value = title;
    r.getCell(1).font = { bold: true, color: { argb: INK } };
    for (let c = 1; c <= 4; c += 1) r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
  }

  /** One value in column C: an input, an optimiser result or a formula. Source text goes in D. */
  one(key, text, unit, { v, f, fmt, kind = "calc", note, source, bold, list }) {
    const r = this.next();
    this.label(r, text, unit, { note, bold, indent: 1 });
    const c = r.getCell(3);
    this.put(c, { f, v, fmt, kind, bold });
    if (list) c.dataValidation = { type: "list", allowBlank: true, formulae: [`"${list.join(",")}"`], showErrorMessage: true, errorTitle: "Choose from the list", error: `One of: ${list.join(", ")}` };
    if (source) {
      r.getCell(4).value = source;
      r.getCell(4).font = { italic: true, color: { argb: /benchmark/i.test(source) ? "FFB26A00" : "FF777777" } };
    }
    this.cell[key] = `$C$${this.row}`;
    this.val[key] = v;
    return this.cell[key];
  }

  /**
   * A row by year. f(y) is the formula for year y, v(y) its value; total sums the years in C;
   * y0 ({ f, v }) fills year 0 (the investment). kind "opt" rows are the optimiser's numbers;
   * kindOf(y) picks the kind year by year (the energy beyond the PPA is a formula on the last year).
   */
  series(key, text, unit, { f, v, fmt = "cr", kind = "calc", kindOf = null, total = false, y0, note, bold }) {
    const r = this.next();
    this.label(r, text, unit, { note, bold, indent: 1 });
    this.cell[key] = this.row;
    const vals = [y0 ? y0.v : null];
    this.val[key] = vals;
    for (let y = 1; y <= this.N; y += 1) vals[y] = v(y);
    if (y0) this.put(r.getCell(4), { f: y0.f, v: y0.v, fmt, kind: y0.kind || "calc", bold });
    for (let y = 1; y <= this.N; y += 1) {
      const fy = f ? f(y) : null;
      this.put(r.getCell(4 + y), { f: fy, v: vals[y], fmt, kind: kindOf ? kindOf(y) : fy ? "calc" : kind, bold });
    }
    if (total) {
      this.put(r.getCell(3), { f: `SUM(${this.span(key)})`, v: sumOf(vals.slice(1)), fmt, bold: true });
    }
    if (bold) {
      for (let c = 1; c <= 4 + this.N; c += 1) r.getCell(c).border = { top: { style: "thin", color: { argb: INK } } };
    }
    return this.row;
  }

  /** Fill one year cell of a series declared with empty values (the rows worked out in a loop). */
  fill(key, y, { f, v, fmt = "cr", bold = false, kind = "calc" }) {
    this.val[key][y] = v;
    this.put(this.ws.getCell(`${this.col(y)}${this.cell[key]}`), { f, v, fmt, bold, kind });
  }

  /** The total in C of a series filled in a loop. */
  total(key, fmt = "cr") {
    this.put(this.ws.getCell(`C${this.cell[key]}`), { f: `SUM(${this.span(key)})`, v: sumOf(this.val[key].slice(1)), fmt, bold: true });
  }
}

/** The worksheets of one workbook by name (created once, in the tab order they are first asked for). */
function sheetOf(wb, sheets, name, colour) {
  if (!sheets.has(name)) sheets.set(name, wb.addWorksheet(name, { properties: { tabColor: { argb: colour || "FF888888" } } }));
  return sheets.get(name);
}

/**
 * The Construction sheet: the project cost before IDC spent month by month under the drawdown
 * profile, by part of the hard cost (each in its own spend window when phased), funded by equity
 * and debt (pro rata or equity first), the interest during construction on the debt drawn (on the
 * balance at the start of the month plus the month's draw; at the bridge loan's rate during the
 * bridge months, whose fee is capitalised with the IDC), and the IDC capitalised into the debt.
 * Every cell is a formula on the Inputs sheet (linked at the top), one row per construction month
 * (none when there is no construction schedule: the IDC is then in the pre-operative share; to
 * model more months, set them in TenderOS and download again — the check "Construction spends the
 * whole cost" catches months set in Excel beyond the rows). Returns the IDC, the bridge fee and
 * the references to their totals and to the cost spent.
 * Mirrors web/src/rtc/engine.js constructionSchedule.
 */
function addConstructionSheet(wb, sheets, S, { base, months, profile, order, debtPct, rate, parts, bridge }) {
  const ws = sheetOf(wb, sheets, CONSTRUCTION_SHEET, "FF00703C");
  const L = (key) => (String(S.s(key)).includes("!") ? S.s(key) : `'${LIVE_SHEET}'!${S.s(key)}`);
  const rows = Math.max(1, months);
  let r = ws.getRow(1);
  r.getCell(1).value = "Construction: the cost spent month by month, by part of the plant, its funding and the interest during construction";
  r.getCell(1).font = { bold: true, size: 14 };
  r = ws.getRow(2);
  r.getCell(1).value = months > 0
    ? `${months} months, one row each, linked from the Inputs sheet (change them there). Each part of the hard cost follows the drawdown profile inside its own window when one is set (Inputs › Construction phasing), else over the whole construction, like the pre-operative cost. Interest in a month is on the debt at its start plus the month's draw, at the bridge loan's rate during the bridge months; the IDC and the bridge fee are capitalised as debt. The debt share applies to the cost before IDC. To model more months, set them in TenderOS and download again.`
    : "No construction months set in TenderOS: the IDC is inside the pre-operative share of the hard cost. Set the months on the Finance inputs step and download again for the month-by-month schedule.";
  r.getCell(1).font = { italic: true, color: { argb: "FF777777" } };
  // the parameters, linked
  const P = {};
  let prow = 3;
  const param = (key, text, v, fmt, { f = null, liveKey = null, kind = "calc" } = {}) => {
    prow += 1;
    const rr = ws.getRow(prow);
    rr.getCell(1).value = text;
    S.put(rr.getCell(2), { f: f || L(liveKey || key), v, fmt, kind });
    P[key] = `$B$${prow}`;
  };
  param("base", "Project cost before IDC (₹ cr)", base, "cr");
  param("months", "Construction months", months, "int", { liveKey: "consMonths" });
  param("profile", "Drawdown profile", profile, "text", { liveKey: "drawdown" });
  param("order", "Funding order", order, "text", { liveKey: "drawOrder" });
  param("debtPct", "Debt share of the cost", debtPct, "pct");
  param("rate", "Interest rate (a year)", rate, "pct");
  const equityTotal = base * (1 - debtPct);
  param("equity", "Equity to put in (₹ cr)", equityTotal, "cr", { f: `${P.base}*(1-${P.debtPct})` });
  // the bridge loan (finance v3): its months within the construction, its rate and its fee
  const bridgeMonthsU = Math.max(0, Math.min(months, Math.round(bridge.months || 0)));
  const bridgeRateU = bridge.rate ?? rate;
  const bridgeFeePct = bridgeMonthsU > 0 ? Math.max(0, bridge.feePct || 0) : 0;
  param("bridgeMonths", "Bridge loan months (within the construction)", bridgeMonthsU, "int", { f: `MAX(0,MIN(${P.months},ROUND(${L("bridgeMonths")},0)))` });
  param("bridgeRate", "Bridge loan rate (a year; blank in the inputs: the interest rate)", bridgeRateU, "pct", { f: `IF(ISNUMBER(${L("bridgeRate")}),${L("bridgeRate")},${P.rate})` });
  param("bridgeFee", "Bridge takeout fee (share of the balance)", bridgeFeePct, "pct", { f: `IF(${P.bridgeMonths}>0,MAX(0,${L("bridgeFeePct")}),0)` });
  // the parts of the cost: each one's amount (from the Live model) and its spend window (from the inputs)
  const COMP = [...PHASED, "preop"];
  const compLabel = { solar: "Solar", wind: "Wind", bess: "Battery (energy and power conversion)", evac: "Transmission / evacuation", other: "Other project cost", preop: "Pre-operative cost" };
  prow += 1;
  const hr = ws.getRow(prow);
  ["Part of the cost", "Amount (₹ cr)", "Window set?", "Start month (used)", "Months (used)"].forEach((h, i) => { const c = hr.getCell(i + 1); c.value = h; c.font = { bold: true }; });
  const partRows = {};
  for (const k of COMP) {
    prow += 1;
    const rr = ws.getRow(prow);
    rr.getCell(1).value = compLabel[k];
    const pk = parts[k];
    S.put(rr.getCell(2), { f: pk.amountF, v: pk.amount, fmt: "cr" });
    if (k === "preop") {
      S.put(rr.getCell(3), { v: "no (whole window)" });
      partRows[k] = { amount: `$B$${prow}`, has: null, amountV: pk.amount };
      continue;
    }
    const monthsIn = L(`phase_${k}_months`);
    const startIn = L(`phase_${k}_start`);
    const has = pk.months > 0 ? 1 : 0;
    S.put(rr.getCell(3), { f: `IF(${monthsIn}>0,1,0)`, v: has, fmt: "int" });
    const startU = has ? Math.max(0, Math.min(months - 1, Math.round(pk.start || 0))) : 0;
    const monthsU = has ? Math.min(Math.max(1, Math.round(pk.months)), months - startU) : months;
    S.put(rr.getCell(4), { f: `IF($C$${prow}=1,MAX(0,MIN(${P.months}-1,ROUND(${startIn},0))),0)`, v: startU, fmt: "int" });
    S.put(rr.getCell(5), { f: `IF($C$${prow}=1,MIN(MAX(1,ROUND(${monthsIn},0)),${P.months}-$D$${prow}),${P.months})`, v: monthsU, fmt: "int" });
    partRows[k] = { amount: `$B$${prow}`, has: `$C$${prow}`, start: `$D$${prow}`, months: `$E$${prow}`, startU, monthsU, hasV: has, amountV: pk.amount };
  }
  // the table
  const HEAD = prow + 2;
  const heads = ["Month", "Share of the cost", ...COMP.map((k) => compLabel[k]), "Cost drawn", "Equity drawn", "Debt drawn", "Opening debt", "Bridge month?", "Rate of the month", "IDC", "Bridge fee", "Closing debt", "Equity so far"];
  r = ws.getRow(HEAD);
  heads.forEach((h, i) => {
    const c = r.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    c.alignment = { horizontal: i ? "right" : "left", wrapText: true };
  });
  r.height = 32;
  const C0 = 3; // the first part column
  const col = (i) => colName(i);
  const IC = C0 + COMP.length; // cost drawn
  const [cCost, cEq, cDebt, cOpen, cBridge, cRate, cIdc, cFee, cClose, cEqCum] = [IC, IC + 1, IC + 2, IC + 3, IC + 4, IC + 5, IC + 6, IC + 7, IC + 8, IC + 9];
  const CUM = { linear: (t) => t, sCurve: (t) => (1 - Math.cos(Math.PI * t)) / 2, front: (t) => 1 - (1 - t) ** 2, back: (t) => t ** 2 }[profile] || ((t) => t);
  const cumF = (t) => `IF(${P.profile}="linear",${t},IF(${P.profile}="sCurve",(1-COS(PI()*${t}))/2,IF(${P.profile}="front",1-(1-${t})^2,${t}^2)))`;
  let cumEq = 0;
  let bal = 0;
  let idc = 0;
  let fee = 0;
  let spent = 0;
  const byComponent = [];
  const debts = [];
  const first = HEAD + 1;
  for (let m = 1; m <= rows; m += 1) {
    const row = first + m - 1;
    const on = m <= months;
    const share = on ? CUM(m / months) - CUM((m - 1) / months) : 0;
    const rr = ws.getRow(row);
    const A = `$A${row}`;
    const t = (k) => `MIN(1,(${A}${k})/${P.months})`;
    S.put(rr.getCell(1), { v: m, fmt: "int" });
    S.put(rr.getCell(2), { f: `IF(OR(${P.months}<=0,${A}>${P.months}),0,${cumF(t("+0"))}-${cumF(t("-1"))})`, v: share, fmt: "pct" });
    // each part: its window's share of the profile, or the whole window's
    let cost = 0;
    const by = {};
    COMP.forEach((k, i) => {
      const pr = partRows[k];
      let v;
      if (pr.has && pr.hasV) {
        const t1 = (m - pr.startU) / pr.monthsU;
        const t0 = (m - 1 - pr.startU) / pr.monthsU;
        v = !on || t1 <= 0 || t0 >= 1 ? 0 : pr.amountV * (CUM(Math.min(1, t1)) - CUM(Math.max(0, t0)));
      } else v = pr.amountV * share;
      by[k] = v;
      cost += v;
      // a window of zero months (no construction months set) spends nothing here: the IDC is then
      // inside the pre-operative share, and the division by the window must not be reached
      const win = pr.has
        ? `IF(${pr.has}=1,IF(OR(${P.months}<=0,${pr.months}<=0),0,IF(OR(${A}>${P.months},(${A}-${pr.start})/${pr.months}<=0,(${A}-1-${pr.start})/${pr.months}>=1),0,${pr.amount}*(${cumF(`MIN(1,(${A}-${pr.start})/${pr.months})`)}-${cumF(`MAX(0,(${A}-1-${pr.start})/${pr.months})`)}))),${pr.amount}*$B${row})`
        : `${pr.amount}*$B${row}`;
      S.put(rr.getCell(C0 + i), { f: win, v, fmt: "cr" });
    });
    const equity = on ? (order === "equityFirst" ? Math.min(cost, Math.max(0, equityTotal - cumEq)) : cost * (1 - debtPct)) : 0;
    const debt = cost - equity;
    const opening = bal;
    const isBridge = on && m <= bridgeMonthsU;
    const rateM = (isBridge ? bridgeRateU : rate) / 12;
    const i = on ? (opening + debt) * rateM : 0; // no interest after the construction ends: the debt is in operation
    const feeM = isBridge && m === bridgeMonthsU ? (opening + debt + i) * bridgeFeePct : 0;
    bal = opening + debt + i + feeM;
    idc += i;
    fee += feeM;
    spent += cost;
    cumEq += equity;
    byComponent.push(by);
    debts.push(debt);
    const cellF = (c) => `$${col(c)}${row}`;
    const prevEq = m === 1 ? "0" : cellF(cEqCum).replace(/\d+$/, String(row - 1));
    const fs = {
      [cCost]: `SUM($${col(C0)}${row}:$${col(C0 + COMP.length - 1)}${row})`,
      [cEq]: `IF(${P.order}="equityFirst",MIN(${cellF(cCost)},MAX(0,${P.equity}-${prevEq})),${cellF(cCost)}*(1-${P.debtPct}))`,
      [cDebt]: `${cellF(cCost)}-${cellF(cEq)}`,
      [cOpen]: m === 1 ? "0" : `$${col(cClose)}${row - 1}`,
      [cBridge]: `IF(AND(${A}<=${P.months},${A}<=${P.bridgeMonths}),1,0)`,
      [cRate]: `IF(${cellF(cBridge)}=1,${P.bridgeRate},${P.rate})/12`,
      [cIdc]: `IF(${A}>${P.months},0,(${cellF(cOpen)}+${cellF(cDebt)})*${cellF(cRate)})`,
      [cFee]: `IF(AND(${cellF(cBridge)}=1,${A}=${P.bridgeMonths}),(${cellF(cOpen)}+${cellF(cDebt)}+${cellF(cIdc)})*${P.bridgeFee},0)`,
      [cClose]: `${cellF(cOpen)}+${cellF(cDebt)}+${cellF(cIdc)}+${cellF(cFee)}`,
      [cEqCum]: `${prevEq}+${cellF(cEq)}`,
    };
    const vals = { [cCost]: cost, [cEq]: equity, [cDebt]: debt, [cOpen]: opening, [cBridge]: isBridge ? 1 : 0, [cRate]: on ? rateM : rate / 12, [cIdc]: i, [cFee]: feeM, [cClose]: bal, [cEqCum]: cumEq };
    const fmts = { [cBridge]: "int", [cRate]: "0.0000%" };
    for (const c of Object.keys(fs)) S.put(rr.getCell(Number(c)), { f: fs[c], v: vals[c], fmt: fmts[c] || "cr" });
  }
  const last = first + rows - 1;
  const totRow = last + 1;
  const tr = ws.getRow(totRow);
  tr.getCell(1).value = "Total";
  tr.getCell(1).font = { bold: true };
  const totals = { 2: ["pct", spent / (base || 1)], [cCost]: ["cr", spent], [cEq]: ["cr", cumEq], [cDebt]: ["cr", spent - cumEq], [cIdc]: ["cr", idc], [cFee]: ["cr", fee] };
  COMP.forEach((k, i) => { totals[C0 + i] = ["cr", byComponent.reduce((a, b) => a + b[k], 0)]; });
  for (const [c, [fmt, v]] of Object.entries(totals)) {
    const letter = col(Number(c));
    S.put(tr.getCell(Number(c)), { f: `SUM(${letter}${first}:${letter}${last})`, v, fmt, bold: true });
  }
  ws.getColumn(1).width = 34;
  for (let c = 2; c <= cEqCum; c += 1) ws.getColumn(c).width = 14;
  ws.views = [{ state: "frozen", ySplit: HEAD, showGridLines: false }];
  const ref = (c) => `'${CONSTRUCTION_SHEET}'!$${col(c)}$${totRow}`;
  return {
    sheet: ws, idc, bridgeFee: fee, spent, byComponent, debtByMonth: debts,
    idcRef: ref(cIdc), bridgeFeeRef: ref(cFee), spentRef: ref(cCost), debtCol: col(cDebt), headRow: HEAD, firstRow: first, lastRow: last, totalRow: totRow,
  };
}

/**
 * Add the Live model sheet (and the Inputs, Construction, schedule and Sensitivity sheets) to an
 * exceljs workbook. m is the request's `live` block (see web/src/bid/liveModelRequest.js), checked
 * by liveModelInput. Returns { sheet, cells, values, rows, addr, dispatch } where cells maps the
 * key results (tariff, equityIrr, ...) to their 'Live model'!C.. addresses for other sheets.
 */
export function addLiveModel(wb, m, { dispatchRows = true, sensitivity = true } = {}) {
  const NP = m.ops.length; // the PPA years (the energy given year by year)
  const fi = m.fin;
  const EXT = Math.max(0, Math.round(fi.extension?.years || 0));
  const N = NP + EXT; // the model's years
  const sheets = new Map();
  const ws = sheetOf(wb, sheets, LIVE_SHEET, "FF0000FF");
  const wsI = sheetOf(wb, sheets, INPUTS_SHEET, "FFFFC000");
  const S = new Sheet(ws, N);
  const I = new Sheet(wsI, 0);
  const sz = m.sizes;
  const co = m.costs;
  const bs = m.bess;
  const on = m.on;
  const plant = (id) => (co.plants || []).find((p) => p.id === id) || null;
  const hydro = on.hydro ? plant("hydro") : null;
  const thermal = on.thermal ? plant("thermal") : null;
  const hourly = m.ops.some((o) => finite(o.surplusRevenueCr));
  const recIncome = hourly && m.ops.some((o) => finite(o.recRevenueCr) && o.recRevenueCr > 0);
  // where each input came from: the request names some; sourceAll (Round the clock: the tab) names the rest
  const src = (key, fallback = "Your input") => m.sources?.[key] || m.sourceAll || fallback;
  const sim = m.engine === "simulation";
  const sized = m.sizedLabel || (sim ? "Round the clock plant" : "HiGHS sizing");
  const meter = m.ops.some((o) => finite(o.meterMWh) && o.meterMWh > 0);
  const blocky = m.ops.some((o) => finite(o.blockShortfallMWh) && o.blockShortfallMWh > 0) || (fi.blockPenaltyMultiple || 0) > 0;
  const cfd = m.ops.some((o) => (o.lcMw || 0) > 0 || (o.penaltyWeeks || []).length > 0 || (o.chargingCostCr || 0) !== 0 || (o.pxFeesCr || 0) !== 0);
  const penK = cfd ? Math.max(...m.ops.map((o) => (o.penaltyWeeks || []).length)) : 0;
  const tariffText = m.tariffLabel || (sim ? "Tariff" : "Bid tariff");
  const inPpa = (y) => y <= NP;
  const ppaY = (y) => Math.min(y, NP); // the energy year the model year reads (the last PPA year beyond the PPA)
  // the engine's own run on these inputs: the few values a sheet cannot hold as a formula come from it
  const eng = runFinancialModel(null, sz, { ...engineArgs(m), tariffLocked: true });
  const engRow = (y) => eng.rows[y - 1] || {};

  // ---- the Inputs sheet: every input of the model, in groups; the model and the schedules link to it
  let r = I.next();
  r.getCell(1).value = `${m.title || "Bid financial model"} · inputs`;
  r.getCell(1).font = { bold: true, size: 16 };
  r = I.next();
  r.getCell(1).value = "Every input of the model in one place: blue cells are yours to change (the Live model and every schedule follow), green cells are the plant the optimiser sized and the energy it dispatched. A blank cell where the note says \"blank:\" means the fallback applies.";
  r.getCell(1).font = { color: { argb: "FF555555" } };
  r = I.next();
  r.getCell(1).value = "Colour key";
  r.getCell(1).font = { bold: true };
  I.put(r.getCell(2), { v: "Input", kind: "input" });
  I.put(r.getCell(3), { v: sim ? "Simulation" : "Optimiser", kind: "opt" });
  I.put(r.getCell(4), { v: "Formula" });
  r.getCell(4).border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  for (const c of [2, 3, 4]) r.getCell(c).alignment = { horizontal: "center" };
  r = I.next();
  ["Input", "Unit", "Value", "Source"].forEach((t, i) => { const c = r.getCell(i + 1); c.value = t; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; });
  const inputsHeadRow = I.row;
  /** One input on the Inputs sheet, registered on the Live model under its key (sheet-qualified). */
  const inp = (key, text, unit, opts) => {
    const a = I.one(key, text, unit, opts);
    S.cell[key] = `'${INPUTS_SHEET}'!${a}`;
    S.val[key] = opts.v;
    return S.cell[key];
  };
  /**
   * A table of input slots on the Inputs sheet: a header row, then SLOTS rows with one column per
   * field (from C). Each cell is registered as `${prefix}${i}_${field}` and each column's range as
   * `${prefix}_${field}Rng`; calc columns hold a formula per slot (f(i, cellOf) → formula).
   */
  const inpTable = (prefix, title, fields, rows, note) => {
    I.group(title);
    if (note) { const nr = I.next(); nr.getCell(1).value = note; nr.getCell(1).font = { italic: true, color: { argb: "FF777777" } }; }
    const hr = I.next();
    hr.getCell(1).value = "Slot";
    hr.getCell(1).font = { bold: true, color: { argb: "FF555555" } };
    fields.forEach((fd, j) => { const c = hr.getCell(3 + j); c.value = fd.head; c.font = { bold: true, color: { argb: "FF555555" } }; c.alignment = { horizontal: "right", wrapText: true }; });
    hr.height = 30;
    const first = I.row + 1;
    for (let i = 1; i <= SLOTS; i += 1) {
      const rr = I.next();
      rr.getCell(1).value = `${i}`;
      rr.getCell(1).alignment = { indent: 1 };
      const data = rows[i - 1] || null;
      const cellOf = (field) => `'${INPUTS_SHEET}'!$${colName(3 + fields.findIndex((fd) => fd.key === field))}$${I.row}`;
      fields.forEach((fd, j) => {
        const key = `${prefix}${i}_${fd.key}`;
        let v = data ? data[fd.key] : null;
        if (v === undefined) v = null;
        let f = null;
        if (fd.f) { f = fd.f(i, cellOf); v = fd.v(data); }
        I.put(rr.getCell(3 + j), { f, v, fmt: fd.fmt, kind: fd.f ? "calc" : "input" });
        if (fd.list) rr.getCell(3 + j).dataValidation = { type: "list", allowBlank: true, formulae: [`"${fd.list.join(",")}"`] };
        S.cell[key] = `'${INPUTS_SHEET}'!$${colName(3 + j)}$${I.row}`;
        S.val[key] = v;
      });
    }
    fields.forEach((fd, j) => {
      const c = colName(3 + j);
      S.cell[`${prefix}_${fd.key}Rng`] = `'${INPUTS_SHEET}'!$${c}$${first}:$${c}$${first + SLOTS - 1}`;
      S.val[`${prefix}_${fd.key}Rng`] = Array.from({ length: SLOTS }, (_, i) => S.val[`${prefix}${i + 1}_${fd.key}`]);
    });
  };
  const v3 = (k) => fi[k] ?? DEFAULT_FINANCE[k];
  const nz = (v) => (finite(v) ? v : 0);
  const orNull = (v) => (finite(v) ? v : null);

  I.section("Tariff");
  inp("tariff", tariffText, "₹/kWh", { v: m.tariff, kind: "input", fmt: "tariff", source: m.tariffLocked ? "Fixed by you" : "Solved in TenderOS for the target equity IRR" });
  inp("tariffEsc", "Tariff escalation", "%/yr", { v: fi.tariffEscalation || 0, kind: "input", fmt: "pct", source: src("fin.tariffEscalation") });

  I.section("Timeline (finance v3)");
  const codSerial = serialOf(fi.codDate);
  inp("cod", "Commercial operation date", "date", { v: codSerial, kind: "input", fmt: "date", source: src("fin.codDate", codSerial === null ? "Not set (years are numbered only)" : "Your input"), note: "Year 1 runs from this date; the 'Year starts' row of every sheet follows. Blank: the years are numbered only" });
  inp("ppaYears", "PPA years", "years", { v: NP, kind: "input", fmt: "int", source: "The term the plant was dispatched for", note: "The energy is given for these years; the columns beyond them are the life extension (set in TenderOS, which adds the columns)" });
  inp("extYears", "Life extension beyond the PPA", "years", { f: `COUNT('${LIVE_SHEET}'!$E$5:$${S.last}$5)-${S.s("ppaYears")}`, v: EXT, fmt: "int", source: src("fin.extension", "Model default"), note: "The columns of the model less the PPA years: change it in TenderOS and download again" });
  inp("extTariffIn", "Price beyond the PPA", "₹/kWh (blank: the market sale price)", { v: orNull(fi.extension?.tariffRsPerKwh), kind: "input", fmt: "tariff", source: src("fin.extension", "Model default"), note: "Every unit (the PPA's and the surplus) sells at this price after the PPA" });
  inp("extCapexIn", "Life extension capital cost", "₹ cr (in the last PPA year)", { v: nz(fi.extension?.capexCr), kind: "input", fmt: "cr", source: src("fin.extension", "Model default"), note: "Spent in the last PPA year, depreciated straight line over the extension" });
  inp("extOmFactor", "O&M and fixed cost beyond the PPA", "× the escalated cost", { v: fi.extension?.omFactor ?? 1, kind: "input", fmt: "factor", source: src("fin.extension", "Model default") });
  inp("solarDegFin", "Solar degradation", "%/yr", { v: nz(fi.solarDegradation), kind: "input", fmt: "pct", source: src("solar.degradation", "Model default"), note: "The fade beyond the PPA when none is set below" });
  inp("extDegIn", "Energy fade beyond the PPA", "%/yr (blank: the solar degradation)", { v: orNull(fi.extension?.degradation), kind: "input", fmt: "pct", source: src("fin.extension", "Model default") });

  I.section(sim ? "Plant (from the Round the clock tab)" : "Plant (sized by the optimiser)");
  if (on.solar) inp("solarMw", "Solar", "MW", { v: sz.solarMw || 0, kind: "opt", fmt: "mw", source: sized });
  if (on.wind) inp("windMw", "Wind", "MW", { v: sz.windMw || 0, kind: "opt", fmt: "mw", source: sized });
  if (on.biomass) inp("biomassMw", "Biomass", "MW", { v: sz.biomassMw || 0, kind: "opt", fmt: "mw", source: "HiGHS sizing" });
  if (hydro) inp("hydroMw", "Hydro", "MW", { v: sz.hydroMw || 0, kind: "opt", fmt: "mw", source: "HiGHS sizing" });
  if (thermal) inp("thermalMw", "Thermal (non-RE)", "MW", { v: sz.thermalMw || 0, kind: "opt", fmt: "mw", source: "HiGHS sizing" });
  if (on.bess) {
    inp("bessMw", "Battery power", "MW", { v: sz.bessMw || 0, kind: "opt", fmt: "mw", source: m.bessNote || (m.split ? `${sized}, both sites together` : sized) });
    inp("bessMwh", "Battery energy", "MWh", { v: sz.bessMwh || 0, kind: "opt", fmt: "mw", source: sized });
  }

  I.section("Capital cost");
  if (on.solar) inp("solarCapex", "Solar", "₹ cr/MW", { v: co.solarCrPerMw || 0, kind: "input", fmt: "num", source: src("solar.capex") });
  if (on.wind) inp("windCapex", "Wind", "₹ cr/MW", { v: co.windCrPerMw || 0, kind: "input", fmt: "num", source: src("wind.capex") });
  if (on.biomass) inp("biomassCapex", "Biomass", "₹ cr/MW", { v: co.biomassCrPerMw || 0, kind: "input", fmt: "num", source: src("biomass.capex") });
  if (hydro) inp("hydroCapex", "Hydro", "₹ cr/MW", { v: hydro.capexCrPerMw || 0, kind: "input", fmt: "num", source: src("hydro.capex") });
  if (thermal) inp("thermalCapex", "Thermal (non-RE)", "₹ cr/MW", { v: thermal.capexCrPerMw || 0, kind: "input", fmt: "num", source: src("thermal.capex") });
  if (on.bess) {
    inp("bessCapex", "Battery energy", "₹ cr/MWh", { v: co.bessCrPerMwh || 0, kind: "input", fmt: "num", source: src("bess.capex") });
    inp("bessPcs", "Battery power conversion", "₹ cr/MW", { v: co.bessPcsCrPerMw || 0, kind: "input", fmt: "num", source: src("costs.bessPcsCrPerMw", "Included in the energy price") });
  }
  inp("evac", "Transmission / evacuation", "₹ cr", { v: co.evacuationCr || 0, kind: "input", fmt: "cr", source: src("costs.evacuationCr") });
  if (co.otherCapexCr) inp("otherCapex", m.otherCapexLabel || "Other project cost", "₹ cr", { v: co.otherCapexCr, kind: "input", fmt: "cr", source: src("costs.otherCapexCr", "Given") });
  const consM = Math.max(0, Math.round(co.constructionMonths || 0));
  inp("preop", consM > 0 ? "Pre-operative cost (IDC worked out on the Construction sheet)" : "Pre-operative and IDC", "% of hard cost", { v: co.preopPct || 0, kind: "input", fmt: "pct", source: src("costs.preopPct") });
  inp("consMonths", "Construction months", "months", { v: consM, kind: "input", fmt: "int", source: src("costs.constructionMonths", "Model default"), note: "0: the IDC is inside the pre-operative share. Else the sheet Construction spends the cost month by month and works out the IDC" });
  inp("drawdown", "Drawdown profile", "linear / sCurve / front / back", { v: DRAWDOWN_LIST.includes(co.drawdown) ? co.drawdown : "linear", kind: "input", list: DRAWDOWN_LIST, source: src("costs.drawdown", "Model default") });
  inp("drawOrder", "Funding order", "proRata / equityFirst", { v: co.drawOrder === "equityFirst" ? "equityFirst" : "proRata", kind: "input", list: ["proRata", "equityFirst"], source: src("costs.drawOrder", "Model default") });
  inp("bridgeMonths", "Bridge loan: months", "months of the construction", { v: nz(fi.bridge?.months), kind: "input", fmt: "int", source: src("fin.bridge", "Model default"), note: "The debt drawn in the first months is a bridge loan; the term loan takes it out in the last bridge month, paying the fee" });
  inp("bridgeRate", "Bridge loan: rate", "%/yr (blank: the interest rate)", { v: orNull(fi.bridge?.rate), kind: "input", fmt: "pct", source: src("fin.bridge", "Model default") });
  inp("bridgeFeePct", "Bridge loan: takeout fee", "% of the balance", { v: nz(fi.bridge?.feePct), kind: "input", fmt: "pct", source: src("fin.bridge", "Model default"), note: "Capitalised with the IDC" });
  const phasing = co.phasing || {};
  const phaseLabel = { solar: "Solar", wind: "Wind", bess: "Battery (energy and power conversion)", evac: "Transmission / evacuation", other: "Other project cost (biomass, dispatchable plants, other)" };
  I.group("Construction phasing: when each part of the hard cost is spent (blank months: over the whole construction)");
  for (const k of PHASED) {
    inp(`phase_${k}_start`, `${phaseLabel[k]}: starts at month`, "months after the start", { v: finite(phasing[k]?.months) && phasing[k].months > 0 ? nz(phasing[k].start) : null, kind: "input", fmt: "int", source: src("costs.phasing", "Model default") });
    inp(`phase_${k}_months`, `${phaseLabel[k]}: spent over`, "months", { v: finite(phasing[k]?.months) && phasing[k].months > 0 ? phasing[k].months : null, kind: "input", fmt: "int", source: src("costs.phasing", "Model default") });
  }
  inpTable("part", "Part commissioning: the parts of the plant and when each starts (blank: one part on the COD)",
    [{ key: "share", head: "Share of the capacity", fmt: "pct" }, { key: "offset", head: "Months after the COD (negative: early)", fmt: "int" }],
    (fi.parts || []).map((p) => ({ share: nz(p.share), offset: nz(p.offsetMonths) })),
    "A year's operating share is the capacity-weighted share of the year the parts run; an early part credits its months to year 1. The shares should sum to 100%.");

  I.section("Generation (finance v3)");
  inp("genCase", "Generation case", "p50 / p75 / p90", { v: CASE_LIST.includes(fi.generationCase) ? fi.generationCase : "p50", kind: "input", list: CASE_LIST, source: src("fin.generationCase", "Model default"), note: "P75 and P90 scale the energy delivered and sold by their factors" });
  inp("caseP75", "P75 energy factor", "× P50", { v: fi.caseFactors?.p75 ?? 0.97, kind: "input", fmt: "factor", source: src("fin.caseFactors", "Model default") });
  inp("caseP90", "P90 energy factor", "× P50", { v: fi.caseFactors?.p90 ?? 0.94, kind: "input", fmt: "factor", source: src("fin.caseFactors", "Model default") });
  const genF = S.v("genCase") === "p75" ? S.v("caseP75") : S.v("genCase") === "p90" ? S.v("caseP90") : 1;
  inp("genF", "Generation factor used", "×", { f: `IF(${S.s("genCase")}="p75",${S.s("caseP75")},IF(${S.s("genCase")}="p90",${S.s("caseP90")},1))`, v: genF, fmt: "factor" });
  const carbon = fi.carbon || {};
  inp("carbonOn", "Carbon credits", "Yes / No", { v: carbon.enabled ? "Yes" : "No", kind: "input", list: ["Yes", "No"], source: src("fin.carbon", "Model default") });
  inp("carbonT", "Emission factor", "t CO₂ per MWh", { v: carbon.tPerMwh ?? 0.71, kind: "input", fmt: "num", source: src("fin.carbon", "Model default") });
  inp("carbonPrice", "Carbon price", "₹ per tonne", { v: carbon.pricePerT ?? 500, kind: "input", fmt: "num", source: src("fin.carbon", "Model default") });
  inp("carbonYears", "Credits earned for", "years", { v: carbon.years ?? 10, kind: "input", fmt: "int", source: src("fin.carbon", "Model default") });
  inp("carbonEsc", "Carbon price escalation", "%/yr", { v: carbon.escalation ?? 0.03, kind: "input", fmt: "pct", source: src("fin.carbon", "Model default") });
  const rp = fi.repower || {};
  inp("rpYear", "Solar repowering: year", "year (0: none)", { v: nz(rp.year), kind: "input", fmt: "int", source: src("fin.repower", "Model default") });
  inp("rpCapex", "Solar repowering: capital cost", "₹ cr", { v: nz(rp.capexCr), kind: "input", fmt: "cr", source: src("fin.repower", "Model default"), note: "Depreciated straight line over the book life left" });
  inp("rpUplift", "Solar repowering: energy uplift", "% of the solar share of the energy, from the year after", { v: nz(rp.upliftPct), kind: "input", fmt: "pct", source: src("fin.repower", "Model default") });

  if (on.bess) {
    I.section("Battery augmentation");
    inp("augMethod", "Augmentation", AUGMENTATION_LIST.join(" / "), { v: AUGMENTATION_LIST.includes(bs.augmentation) ? bs.augmentation : "none", kind: "input", list: AUGMENTATION_LIST, source: src("bess.augmentation") });
    inp("deg", "Battery capacity fade", "%/yr", { v: bs.annualDegradation || 0, kind: "input", fmt: "pct", source: src("bess.degradation") });
    inp("augYear", "One-time augmentation year", "year", { v: bs.augmentationYear || 0, kind: "input", fmt: "int", source: src("bess.augmentationYear", "Model default (used with oneTime)") });
    inp("decline", "Battery price decline", "%/yr", { v: bs.costDeclinePct || 0, kind: "input", fmt: "pct", source: src("bess.costDeclinePct", "Model default") });
    inpTable("augY", "Augmentation years (schedule): in each listed year the capacity lost since the last augmentation is replaced", [{ key: "year", head: "Year", fmt: "int" }],
      (bs.augmentationYears || []).map((y) => ({ year: y })), null);
  }

  I.section("Operating cost");
  if (on.solar) inp("solarOm", "Solar O&M", "₹ lakh/MW/yr", { v: fi.solarOmLakhPerMw || 0, kind: "input", fmt: "num", source: src("solar.om") });
  if (on.wind) inp("windOm", "Wind O&M", "₹ lakh/MW/yr", { v: fi.windOmLakhPerMw || 0, kind: "input", fmt: "num", source: src("wind.om"), note: "Used when no wind O&M component is given below" });
  if (on.bess) inp("bessOm", "Battery O&M", "₹ lakh/MWh/yr", { v: fi.bessOmLakhPerMwh || 0, kind: "input", fmt: "num", source: src("bess.om") });
  if (on.biomass) inp("biomassOm", "Biomass O&M", "₹ lakh/MW/yr", { v: fi.biomassOmLakhPerMw || 0, kind: "input", fmt: "num", source: src("biomass.om") });
  inp("omEsc", "O&M escalation", "%/yr", { v: fi.omEscalation || 0, kind: "input", fmt: "pct", source: src("fin.omEscalation") });
  const escUsedF = (inKey) => `IF(ISNUMBER(${S.s(inKey)}),${S.s(inKey)},${S.s("omEsc")})`;
  const escUsedV = (v) => (finite(v) ? v : S.v("omEsc"));
  inp("solarOmEscIn", "Solar O&M escalation", "%/yr (blank: the O&M escalation)", { v: orNull(fi.solarOmEscalation), kind: "input", fmt: "pct", source: src("fin.solarOmEscalation", "Model default") });
  inp("windOmEscIn", "Wind O&M escalation", "%/yr (blank: the O&M escalation)", { v: orNull(fi.windOmEscalation), kind: "input", fmt: "pct", source: src("fin.windOmEscalation", "Model default") });
  inp("bessOmEscIn", "Battery O&M escalation", "%/yr (blank: the O&M escalation)", { v: orNull(fi.bessOmEscalation), kind: "input", fmt: "pct", source: src("fin.bessOmEscalation", "Model default") });
  inp("solarEscU", "Solar O&M escalation used", "%/yr", { f: escUsedF("solarOmEscIn"), v: escUsedV(fi.solarOmEscalation), fmt: "pct" });
  inp("windEscU", "Wind O&M escalation used", "%/yr", { f: escUsedF("windOmEscIn"), v: escUsedV(fi.windOmEscalation), fmt: "pct" });
  inp("bessEscU", "Battery O&M escalation used", "%/yr", { f: escUsedF("bessOmEscIn"), v: escUsedV(fi.bessOmEscalation), fmt: "pct" });
  inp("insurance", "Insurance", "% of hard cost/yr", { v: fi.insurancePct || 0, kind: "input", fmt: "pct", source: src("fin.insurancePct") });
  inp("otherFixed", "Other fixed cost", "₹ cr/yr", { v: fi.otherFixedCr || 0, kind: "input", fmt: "cr", source: src("fin.otherFixedCr", "Model default"), note: "Escalates with O&M; used when no line is given below" });
  const windEscU = S.v("windEscU");
  inpTable("windC", "Wind O&M by component (blank: the wind O&M above)",
    [{ key: "label", head: "Component", fmt: "text" }, { key: "lakh", head: "₹ lakh/MW/yr", fmt: "num" }, { key: "esc", head: "Escalation (blank: the wind O&M escalation)", fmt: "pct" },
      { key: "escU", head: "Escalation used", fmt: "pct", f: (i, cellOf) => `IF(ISNUMBER(${cellOf("esc")}),${cellOf("esc")},${S.s("windEscU")})`, v: (d) => (finite(d?.esc) ? d.esc : windEscU) }],
    (fi.windOmComponents || []).map((c) => ({ label: c.label || "", lakh: nz(c.lakhPerMw), esc: orNull(c.escalation) })), null);
  inpTable("otherL", "Other fixed costs by line (blank: the other fixed cost above)",
    [{ key: "label", head: "Line", fmt: "text" }, { key: "cr", head: "₹ cr/yr", fmt: "cr" }, { key: "esc", head: "Escalation (blank: the O&M escalation)", fmt: "pct" },
      { key: "escU", head: "Escalation used", fmt: "pct", f: (i, cellOf) => `IF(ISNUMBER(${cellOf("esc")}),${cellOf("esc")},${S.s("omEsc")})`, v: (d) => (finite(d?.esc) ? d.esc : S.v("omEsc")) }],
    (fi.otherFixedLines || []).map((l) => ({ label: l.label || "", cr: nz(l.crPerYear), esc: orNull(l.escalation) })), null);
  if (on.biomass) {
    inp("fuel", "Biomass fuel", "₹/kWh", { v: fi.biomassFuelRsPerKwh || 0, kind: "input", fmt: "tariff", source: src("biomass.fuel") });
    inp("fuelEsc", "Biomass fuel escalation", "%/yr", { v: fi.biomassFuelEscalation || 0, kind: "input", fmt: "pct", source: src("biomass.fuelEscalation") });
  }
  if (hydro) {
    inp("hydroFixed", "Hydro capacity charge", "₹ lakh/MW/yr", { v: hydro.fixedLakhPerMw || 0, kind: "input", fmt: "num", source: src("hydro.fixed") });
    inp("hydroEnergy", "Hydro energy charge", "₹/kWh", { v: hydro.energyRsPerKwh || 0, kind: "input", fmt: "tariff", source: src("hydro.energy") });
    inp("hydroEsc", "Hydro escalation", "%/yr", { v: hydro.escalation || 0, kind: "input", fmt: "pct", source: src("hydro.escalation") });
  }
  if (thermal) {
    inp("thermalFixed", "Thermal capacity charge", "₹ lakh/MW/yr", { v: thermal.fixedLakhPerMw || 0, kind: "input", fmt: "num", source: src("thermal.fixed") });
    inp("thermalEnergy", "Thermal energy charge", "₹/kWh", { v: thermal.energyRsPerKwh || 0, kind: "input", fmt: "tariff", source: src("thermal.energy") });
    inp("thermalRec", "RECs for thermal energy", "₹/kWh", { v: thermal.recRsPerKwh || 0, kind: "input", fmt: "tariff", source: src("thermal.rec") });
    inp("thermalEsc", "Thermal escalation", "%/yr", { v: thermal.escalation || 0, kind: "input", fmt: "pct", source: src("thermal.escalation") });
  }

  I.section("Revenue and supply");
  inp("sell", "Sell surplus in the market", "Yes / No", { v: fi.sellSurplus ? "Yes" : "No", kind: "input", list: ["Yes", "No"], source: src("market.sell") });
  // SECI FDRE-RTC-V (Amendment-03): the buyer's first right to the Solar Hours excess, at a share of the tariff
  const buyer = m.ops.some((o) => (o.buyerExcessMWh || 0) > 0);
  if (buyer) inp("buyerShare", "Solar Hours excess taken by the buyer at", "× tariff", { v: m.ops.find((o) => o.buyerExcessShare > 0)?.buyerExcessShare || 0, kind: "input", fmt: "x", source: "Tender", note: "Amendment-03: power above 60% in a Solar Hour goes first to the buyer at 50% of the tariff; it takes it when the market pays more" });
  inp("flatPrice", hourly ? "Market sale price (flat; the PPA years use the hourly prices)" : "Market sale price", "₹/kWh", { v: fi.surplusPrice || 0, kind: "input", fmt: "tariff", source: hourly ? "Used beyond the PPA when no price is set above" : fi.sellSurplus ? "Your input (flat price)" : "Not used: no market sale" });
  inp("target", "Annual supply floor", "% of contracted", { v: m.dfrTarget || 0, kind: "input", fmt: "pct", source: src("target", "Tender") });
  inp("penalty", "Shortfall penalty", "₹/kWh short", { v: fi.shortfallPenalty || 0, kind: "input", fmt: "tariff", source: src("fin.shortfallPenalty", "Model default") });
  if (blocky) inp("blockMult", "Time-block shortfall penalty", "× tariff", { v: fi.blockPenaltyMultiple || 0, kind: "input", fmt: "x", source: src("fin.blockPenaltyMultiple", "Tender"), note: "On the energy short of each time-block's floor, at this multiple of the year's tariff (SECI RTC-TM: 1.5)" });
  if (cfd) {
    I.group("Letter of Credit and weekly shortfall penalty (SECI CfD-I)");
    inp("lcPct", "Letter of Credit cost", "% of the LC a year", { v: fi.lcCostPct || 0, kind: "input", fmt: "pct", source: src("fin.lcCostPct") });
    inp("lcC", "LC reference price (C)", "₹/kWh", { v: fi.lcMinPrice ?? 10, kind: "input", fmt: "tariff", source: "Tender (CfDA 10.4.2)", note: "LC = 2000 kWh × contracted MW × (C − strike price) × days; nothing when the strike price is above C" });
    inp("lcDays", "LC days", "days", { v: fi.lcDays ?? 30, kind: "input", fmt: "int", source: "Tender (CfDA 10.4.2)" });
    inp("cfdMult", "Weekly shortfall penalty", "× (reference − strike price)", { v: fi.cfdPenaltyMultiple || 0, kind: "input", fmt: "x", source: "Tender (CfDA 4.4.3)", note: "On the energy short beyond 10% of a Contract Week's 14 MWh/MW, at this multiple of the week's highest evening price across the exchanges less the strike price; nothing when that price is below the strike price" });
  }

  // the hour-by-hour dispatch sheets (dispatchSheets.js) read these
  const dsp = m.dispatch && (m.dispatch.solar ? m.gen?.solar : true) && (m.dispatch.wind ? m.gen?.wind : true) ? m.dispatch : null;
  if (dsp) {
    I.section("Dispatch, hour by hour (sheets Dispatch Y…)");
    inp("contract", "Contracted capacity", "MW", { v: dsp.contract, kind: "input", fmt: "mw", source: "The bid" });
    inp("poi", "Share of the energy reaching the meter", "%", { v: dsp.poi, kind: "input", fmt: "pct", source: "Power transformer and line losses", note: "(1 − transformer loss) × (1 − line loss): from the 33 kV bus to the 220 kV billing meter" });
    inp("rte", "Battery round trip, at the 33 kV bus", "%", { v: dsp.eta ** 2, kind: "input", fmt: "pct", source: src("bess.rte") });
    inp("eta", "Battery efficiency each way", "%", { f: `SQRT(${S.s("rte")})`, v: dsp.eta, fmt: "pct" });
    inp("minSoc", "Battery minimum charge", "%", { v: dsp.minSoc, kind: "input", fmt: "pct", source: src("bess.minSoc") });
    inp("maxSoc", "Battery maximum charge", "%", { v: dsp.maxSoc, kind: "input", fmt: "pct", source: src("bess.maxSoc") });
    inp("initSoc", "Battery charge at the start of a year", "%", { v: dsp.initSoc, kind: "input", fmt: "pct", source: "Model default" });
    if (dsp.blocks) {
      inp("peakFloor", "Peak Hours floor", "% of contracted", { v: dsp.peakFloor, kind: "input", fmt: "pct", source: "Tender" });
      inp("offFloor", dsp.solarHours ? "Remaining Hours floor" : "Off-peak floor", "% of contracted", { v: dsp.offFloor, kind: "input", fmt: "pct", source: "Tender" });
      if (dsp.solarHours) {
        inp("solarFloor", "Solar Hours floor", "% of contracted", { v: dsp.solarFloor, kind: "input", fmt: "pct", source: "Tender (Amendment-03)" });
        inp("solarMax", "Most the buyer takes in a Solar Hour", "% of contracted", { v: dsp.solarMax, kind: "input", fmt: "pct", source: "Tender (Amendment-03)" });
      }
    }
  }

  // the generation build-up's inputs (the CUFs by month, the degradation and the losses to the bus)
  const gen = ["solar", "wind"].filter((k) => m.gen?.[k] && on[k]);
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  for (const k of gen) {
    const g = m.gen[k];
    const name = k === "solar" ? "Solar" : "Wind";
    const from = g.profile ? `${g.profile}: ` : "";
    I.section(`${name} generation: CUF of each month, degradation and losses`);
    if (g.monthCuf) {
      g.monthCuf.forEach((c, i) => inp(`${k}CufM${i + 1}`, `${MONTHS[i]} CUF`, "%", { v: c, kind: "input", fmt: "pct", source: `${from}mean of the ${DAYS[i] * 24} hours of ${MONTHS[i]}` }));
    } else {
      inp(`${k}Cuf`, `${name} CUF${g.cufAt ? ` (at the ${g.cufAt})` : ""}`, "%", { v: g.cuf, kind: "input", fmt: "pct", source: `${from}mean of the 8,760 hours` });
    }
    inp(`${k}Deg`, `${name} degradation`, "%/yr", { v: g.degradation, kind: "input", fmt: "pct", source: src(`${k}.degradation`) });
    if (g.toBus > 0) inp(`${k}ToBus`, `${name} losses to the 33 kV bus`, "%", { v: g.toBus, kind: "input", fmt: "pct", source: src(`${k}.losses`, "Loss chain") });
  }

  I.section("Financing");
  inp("debtPct", "Debt share", "% of project cost", { v: fi.debtFraction, kind: "input", fmt: "pct", source: src("fin.debtFraction") });
  inp("rate", "Interest rate", "%/yr", { v: fi.interestRate, kind: "input", fmt: "pct", source: src("fin.interestRate") });
  inp("tenor", "Loan tenor", "years", { v: fi.tenorYears, kind: "input", fmt: "int", source: src("fin.tenorYears") });
  inp("repay", "Repayment", REPAYMENT_LIST.join(" / "), { v: REPAYMENT_LIST.includes(fi.repayment) ? fi.repayment : "equal", kind: "input", list: REPAYMENT_LIST, source: src("fin.repayment", "Model default"),
    note: "equal: the balance in equal parts over the years left; annuity: level debt service; sculpted: the principal that keeps the DSCR at the target; balloon: a share in the last year; bullet: all in the last year; stepUp: principal growing at a rate" });
  inp("grace", "Principal moratorium", "years", { v: fi.graceYears || 0, kind: "input", fmt: "int", source: src("fin.graceYears", "Model default"), note: "Within the tenor; interest is paid" });
  inp("instalments", "Instalments a year", "1 / 2 / 4 / 12", { v: [1, 2, 4, 12].includes(fi.paymentsPerYear) ? fi.paymentsPerYear : 1, kind: "input", fmt: "int", list: ["1", "2", "4", "12"], source: src("fin.paymentsPerYear", "Model default"), note: "Instalments within the year pay the balance down earlier: the interest is on the average balance (not for sculpting)" });
  inp("targetDscr", "Target DSCR (sculpted)", "×", { v: fi.targetDscr || 1.3, kind: "input", fmt: "x", source: src("fin.targetDscr", "Model default") });
  inp("balloonPct", "Balloon share (balloon)", "% of the debt", { v: fi.balloonPct || 0, kind: "input", fmt: "pct", source: src("fin.balloonPct", "Model default") });
  inp("stepUp", "Principal step-up (stepUp)", "%/yr", { v: fi.stepUpPct || 0, kind: "input", fmt: "pct", source: src("fin.stepUpPct", "Model default") });
  inp("stepAfter", "Interest step-down after", "years from COD (0: none)", { v: nz(fi.rateStepDown?.afterYears), kind: "input", fmt: "int", source: src("fin.rateStepDown", "Model default"), note: "The senior rate steps down from the year after, until a refinancing applies" });
  inp("stepRateIn", "Interest rate after the step-down", "%/yr (blank: the interest rate)", { v: orNull(fi.rateStepDown?.rate), kind: "input", fmt: "pct", source: src("fin.rateStepDown", "Model default") });
  inp("stepRateU", "Rate after the step-down, used", "%/yr", { f: `IF(ISNUMBER(${S.s("stepRateIn")}),${S.s("stepRateIn")},${S.s("rate")})`, v: fi.rateStepDown?.rate ?? fi.interestRate, fmt: "pct" });
  inp("refiYear", "Refinance at the end of year", "year (0: never)", { v: fi.refiYear || 0, kind: "input", fmt: "int", source: src("fin.refiYear", "Model default") });
  inp("refiRate", "Refinanced interest rate", "%/yr", { v: fi.refiRate || 0, kind: "input", fmt: "pct", source: src("fin.refiRate", "Model default") });
  inp("refiTenor", "Refinanced tenor", "years from then", { v: fi.refiTenorYears || 0, kind: "input", fmt: "int", source: src("fin.refiTenorYears", "Model default") });
  inp("refiFee", "Refinancing fee", "% of the balance", { v: fi.refiFeePct || 0, kind: "input", fmt: "pct", source: src("fin.refiFeePct", "Model default") });
  inp("refiRepay", "Repayment after the refinancing", REFI_REPAY_LIST.join(" / "), { v: REPAYMENT_LIST.includes(fi.refiRepayment) ? fi.refiRepayment : "same", kind: "input", list: REFI_REPAY_LIST, source: src("fin.refiRepayment", "Model default"), note: "same: the method above; sculpted re-sculpts the refinanced balance to the target DSCR" });
  inp("prepayPct", "Prepayment fee", "% of principal prepaid", { v: nz(fi.prepaymentPct), kind: "input", fmt: "pct", source: src("fin.prepaymentPct", "Model default"), note: "On the refinancing takeout and the cash sweep; expensed" });
  inp("topUpYear", "Top-up: at the end of year", "year (0: none)", { v: nz(fi.topUp?.year), kind: "input", fmt: "int", source: src("fin.topUp", "Model default"), note: "New senior debt up to the fraction of the project cost, paid out to equity and repaid under the method over the years left" });
  inp("topUpFracIn", "Top-up: debt to", "% of project cost (blank: the debt share)", { v: orNull(fi.topUp?.debtFraction), kind: "input", fmt: "pct", source: src("fin.topUp", "Model default") });
  inp("topUpFracU", "Top-up: debt to, used", "%", { f: `IF(ISNUMBER(${S.s("topUpFracIn")}),${S.s("topUpFracIn")},${S.s("debtPct")})`, v: fi.topUp?.debtFraction ?? fi.debtFraction, fmt: "pct" });
  inp("sweepPct", "Cash sweep", "% of the free cash to equity", { v: nz(fi.sweep?.pct), kind: "input", fmt: "pct", source: src("fin.sweep", "Model default"), note: "Prepays the debt after the scheduled principal; what cannot be paid accrues to the next year" });
  inp("sweepFrom", "Cash sweep from year", "year", { v: fi.sweep?.fromYear ?? 1, kind: "input", fmt: "int", source: src("fin.sweep", "Model default") });
  inp("sweepToIn", "Cash sweep to year", "year (blank: the tenor)", { v: orNull(fi.sweep?.toYear), kind: "input", fmt: "int", source: src("fin.sweep", "Model default") });
  inp("targetIrr", "Target equity IRR", "%", { v: fi.targetEquityIrr, kind: "input", fmt: "pct", source: src("fin.targetEquityIrr") });
  inp("disc", "Discount rate (LCOE, project NPV)", "%", { v: fi.discountRate, kind: "input", fmt: "pct", source: src("fin.discountRate", "Model default") });

  I.section("Quasi-equity and mezzanine (finance v3)");
  const qs = fi.quasi || {};
  const mz = fi.mezz || {};
  inp("quasi0", "Quasi-equity", "₹ cr", { v: nz(qs.amountCr), kind: "input", fmt: "cr", source: src("fin.quasi", "Model default"), note: "From the holding company; part of the funding (the equity is what is left)" });
  inp("quasiRate", "Quasi-equity interest", "%/yr", { v: qs.rate ?? 0.12, kind: "input", fmt: "pct", source: src("fin.quasi", "Model default"), note: "Paid when the senior DSCR clears the lender's floor and the cash allows; else accrued (not compounded)" });
  inp("quasiMinDscr", "Lender's DSCR floor for quasi-equity payments", "×", { v: qs.lenderMinDscr ?? 1.2, kind: "input", fmt: "x", source: src("fin.quasi", "Model default") });
  inp("quasiFrom", "Quasi-equity repaid from year", "year", { v: qs.repayFromYear ?? 1, kind: "input", fmt: "int", source: src("fin.quasi", "Model default") });
  inp("mezz0", "Mezzanine", "₹ cr", { v: nz(mz.amountCr), kind: "input", fmt: "cr", source: src("fin.mezz", "Model default"), note: "Ranks below the senior debt; part of the funding" });
  inp("mezzRate", "Mezzanine interest", "%/yr", { v: mz.rate ?? 0.14, kind: "input", fmt: "pct", source: src("fin.mezz", "Model default") });
  inp("mezzTenor", "Mezzanine tenor", "years", { v: mz.tenorYears ?? 10, kind: "input", fmt: "int", source: src("fin.mezz", "Model default") });
  inp("mezzGrace", "Mezzanine moratorium", "years", { v: nz(mz.graceYears), kind: "input", fmt: "int", source: src("fin.mezz", "Model default") });
  inp("mezzRepay", "Mezzanine repayment", MEZZ_REPAY_LIST.join(" / "), { v: mz.repayment === "bullet" ? "bullet" : "equal", kind: "input", list: MEZZ_REPAY_LIST, source: src("fin.mezz", "Model default") });
  inp("mezzFeePct", "Mezzanine arrangement fee", "% of the amount", { v: nz(mz.feePct), kind: "input", fmt: "pct", source: src("fin.mezz", "Model default"), note: "Funded by equity with the project cost" });
  inpTable("bg", "Guarantees (EMD, PBG, connectivity BG, statutory BG, surety bonds): fees while they run, margin money blocked",
    [{ key: "label", head: "Guarantee", fmt: "text" }, { key: "amt", head: "₹ cr", fmt: "cr" }, { key: "fee", head: "Fee (%/yr)", fmt: "pct" }, { key: "marginPct", head: "Margin money (% of the amount)", fmt: "pct" },
      { key: "marginRate", head: "Interest on the margin (%/yr)", fmt: "pct" }, { key: "from", head: "From year (0: construction)", fmt: "int" }, { key: "years", head: "Years", fmt: "int" },
      { key: "fromU", head: "First operating year", fmt: "int", f: (i, c) => `IF(${c("amt")}>0,MAX(1,ROUND(${c("from")},0)),0)`, v: (d) => (d && nz(d.amt) > 0 ? Math.max(1, Math.round(nz(d.from))) : 0) },
      { key: "toU", head: "Last operating year", fmt: "int", f: (i, c) => `IF(${c("amt")}>0,ROUND(${c("from")},0)+MAX(1,ROUND(${c("years")},0))-1,-1)`, v: (d) => (d && nz(d.amt) > 0 ? Math.round(nz(d.from)) + Math.max(1, Math.round(nz(d.years))) - 1 : -1) }],
    (fi.guarantees || []).map((g) => ({ label: g.label || "", amt: nz(g.amountCr), fee: nz(g.feePct), marginPct: nz(g.marginPct), marginRate: nz(g.marginRate), from: nz(g.fromYear), years: nz(g.years) })),
    "A guarantee from year 0 runs through the construction: its construction-period fee is part of the project cost (funded by equity); from the COD its fees are expensed and its margin money is blocked from the equity cash, earning interest.");

  I.section("Tax and depreciation");
  inp("taxRate", "Corporate tax", "%", { v: fi.taxRate, kind: "input", fmt: "pct", source: src("fin.taxRate") });
  inp("taxMethod", "Tax depreciation", "wdv / slm", { v: fi.taxDepreciation === "wdv" ? "wdv" : "slm", kind: "input", list: ["wdv", "slm"], source: src("fin.taxDepreciation", "Model default"), note: "wdv: written-down value at the WDV rate; slm: the straight-line book depreciation" });
  inp("wdvRate", "WDV rate", "%/yr", { v: fi.wdvRate, kind: "input", fmt: "pct", source: src("fin.wdvRate", "Model default") });
  inp("bookMethod", "Book depreciation", "slm / wdv", { v: fi.bookDepreciation === "wdv" ? "wdv" : "slm", kind: "input", list: BOOK_LIST, source: src("fin.bookDepreciation", "Model default"), note: "The books: straight line over the life (by component when lives are given), or written down" });
  inp("bookWdvRateIn", "Book WDV rate", "%/yr (blank: the WDV rate)", { v: orNull(fi.bookWdvRate), kind: "input", fmt: "pct", source: src("fin.bookWdvRate", "Model default") });
  inp("bookWdvRateU", "Book WDV rate used", "%/yr", { f: `IF(ISNUMBER(${S.s("bookWdvRateIn")}),${S.s("bookWdvRateIn")},${S.s("wdvRate")})`, v: fi.bookWdvRate ?? fi.wdvRate, fmt: "pct" });
  inp("bookLife", "Book life", "years", { v: fi.bookLifeYears, kind: "input", fmt: "int", source: src("fin.bookLifeYears", "Model default") });
  inp("salvage", "Salvage value", "% of project cost", { v: fi.salvagePct, kind: "input", fmt: "pct", source: src("fin.salvagePct", "Model default") });
  const lives = fi.lives || null;
  inp("livesOn", "Book lives by component", "Yes / No", { v: lives ? "Yes" : "No", kind: "input", list: ["Yes", "No"], source: src("fin.lives", "Model default"), note: "Yes: each component of the hard cost is written off straight line over its own life (blank: the book life), the whole depreciable value spread over them pro rata" });
  const lifeLabel = { solar: "Solar", wind: "Wind", bess: "Battery (energy and power conversion)", evac: "Transmission / evacuation", other: "Other project cost" };
  for (const k of PHASED) {
    inp(`life_${k}`, `${lifeLabel[k]} life`, "years (blank: the book life)", { v: lives && finite(lives[k]) && lives[k] > 0 ? lives[k] : null, kind: "input", fmt: "int", source: src("fin.lives", "Model default") });
  }
  inp("thinCap", "Thin capitalisation", "% of EBITDA (0: off)", { v: nz(fi.thinCapPct), kind: "input", fmt: "pct", source: src("fin.thinCapPct", "Model default"), note: `Caps the deductible interest on the quasi-equity and the mezzanine at this share of the EBITDA (and other income); the excess carries forward ${INT_LAPSE_YEARS} years` });
  inp("lossCarryIn", "Business losses carried for", "years (blank: no limit)", { v: fi.lossCarryYears > 0 ? Math.round(fi.lossCarryYears) : null, kind: "input", fmt: "int", source: src("fin.lossCarryYears", "Model default"), note: "Unabsorbed depreciation never lapses" });

  I.section("Working capital and reserves");
  inp("recvDays", "Receivable days", "days", { v: fi.receivableDays, kind: "input", fmt: "int", source: src("fin.receivableDays", "Model default") });
  inp("omMonths", "O&M in hand", "months", { v: fi.omStockMonths || 0, kind: "input", fmt: "num", source: src("fin.omStockMonths", "Model default"), note: "CERC norm: one month of O&M" });
  inp("sparesPct", "Maintenance spares", "% of the year's O&M", { v: fi.sparesPctOm || 0, kind: "input", fmt: "pct", source: src("fin.sparesPctOm", "Model default"), note: "CERC norm: 15%" });
  inp("wcRate", "Interest on working capital", "%/yr", { v: fi.wcInterestRate || 0, kind: "input", fmt: "pct", source: src("fin.wcInterestRate", "Model default"), note: "0: the working capital is funded from equity cash" });
  inp("dsraMonths", "Debt service reserve", "months of debt service", { v: fi.dsraMonths || 0, kind: "input", fmt: "num", source: src("fin.dsraMonths", "Model default"), note: "Held from the equity cash, released as the debt service falls and at the end" });
  inp("dsraBasis", "Debt service reserve basis", "next / peak", { v: fi.dsraBasis === "peak" ? "peak" : "next", kind: "input", list: DSRA_BASIS_LIST, source: src("fin.dsraBasis", "Model default"), note: "next: months of the next year's debt service; peak: of the highest year left" });
  inp("dsraRate", "Interest earned on the reserve", "%/yr", { v: nz(fi.dsraInterestRate), kind: "input", fmt: "pct", source: src("fin.dsraInterestRate", "Model default"), note: "Other income, on the reserve held at the start of the year" });

  I.section("Returns and sensitivity (finance v3)");
  inp("holdcoExp", "Holding company expenses", "₹ cr/yr", { v: nz(fi.holdco?.expensesCrPerYear), kind: "input", fmt: "cr", source: src("fin.holdco", "Model default"), note: "The holding company funds the equity and the quasi-equity and receives the dividends and the quasi-equity's interest and repayments" });
  inp("promoterShare", "Promoter's share of the holding company", "%", { v: fi.holdco?.promoterShare ?? 1, kind: "input", fmt: "pct", source: src("fin.holdco", "Model default") });
  inp("reinvestIn", "Lender's reinvestment rate (MIRR)", "%/yr (blank: the interest rate)", { v: orNull(fi.lenderReinvestRate), kind: "input", fmt: "pct", source: src("fin.lenderReinvestRate", "Model default") });
  inp("reinvestU", "Lender's reinvestment rate used", "%/yr", { f: `IF(ISNUMBER(${S.s("reinvestIn")}),${S.s("reinvestIn")},${S.s("rate")})`, v: fi.lenderReinvestRate ?? fi.interestRate, fmt: "pct" });
  inp("usdShare", "Share of the capital cost paid in dollars", "%", { v: nz(fi.capexUsdShare), kind: "input", fmt: "pct", source: src("fin.capexUsdShare", "Model default"), note: "The exchange-rate axis of the Sensitivity sheet (the app's runs)" });
  inp("fxBase", "Exchange rate in the bid", "₹ per dollar", { v: fi.fxBase ?? 83, kind: "input", fmt: "num", source: src("fin.fxBase", "Model default") });
  inp("moduleShare", "Modules' share of the solar capital cost", "%", { v: co.moduleSharePct ?? 0.45, kind: "input", fmt: "pct", source: src("costs.moduleSharePct", "Model default"), note: "The module-cost axis of the Sensitivity sheet (the app's runs)" });
  wsI.getColumn(1).width = 58;
  wsI.getColumn(2).width = 30;
  wsI.getColumn(3).width = 16;
  wsI.getColumn(4).width = 46;
  for (let c = 5; c <= 12; c += 1) wsI.getColumn(c).width = 14;
  wsI.views = [{ state: "frozen", ySplit: inputsHeadRow, showGridLines: false }];

  // ---- the Live model: title, legend and the year header (frozen), with the year's first day
  r = S.next();
  r.getCell(1).value = m.title || "Bid financial model";
  r.getCell(1).font = { bold: true, size: 16 };
  r = S.next();
  r.getCell(1).value = `Every number below is a formula on the Inputs sheet (blue) and the ${sim ? "simulated" : "optimiser's"} energy (green). Change a blue cell there: the whole model, the returns and the Cover move with it.`;
  r.getCell(1).font = { color: { argb: "FF555555" } };
  r = S.next();
  r.getCell(1).value = "Colour key";
  r.getCell(1).font = { bold: true };
  S.put(r.getCell(2), { v: "Input", kind: "input" });
  S.put(r.getCell(3), { v: sim ? "Simulation" : "Optimiser", kind: "opt" });
  S.put(r.getCell(4), { v: "Formula" });
  r.getCell(4).border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  for (const c of [2, 3, 4]) r.getCell(c).alignment = { horizontal: "center" };
  r = S.next();
  r.getCell(1).value = sim
    ? "The energy comes from the Round the clock tab's hourly simulation of every year; changing a plant size here moves its cost, not its energy (change it in the tab for that)."
    : m.dispatch
      ? `Each year's energy is worked out hour by hour on the sheets ${m.dispatch.byYear.map((y) => `"Dispatch Y${y.year}"`).join(" and ")} from the optimiser's choices (green) and the inputs; years between them are interpolated as the optimiser does. Changing a plant size moves its output there, but not the optimiser's choices: size the plant again in TenderOS for a new dispatch.`
      : "The optimiser's energy comes from the hourly HiGHS dispatch of every year; changing a plant size here moves its cost, not its energy (size the plant again in TenderOS for that). Size the plant again to include the hour-by-hour sheets.";
  r.getCell(1).font = { italic: true, color: { argb: "FF777777" } };
  r = S.next();
  S.yearRow = S.row;
  ["₹ crore unless stated", "Unit", "Total / value", "Year 0"].forEach((t, i) => { r.getCell(i + 1).value = t; });
  for (let y = 1; y <= N; y += 1) {
    const c = r.getCell(4 + y);
    c.value = y === 1 ? 1 : { formula: `${S.col(y - 1)}${S.row}+1`, result: y };
    c.numFmt = FMT.year;
  }
  for (let c = 1; c <= 4 + N; c += 1) {
    const cell = r.getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { horizontal: c > 2 ? "right" : "left" };
  }
  const yearRow = S.row;
  if (yearRow !== 5) throw new Error("the Live model's year header must be row 5 (the Inputs sheet counts its columns)");
  // the year's first day (finance v3): from the COD, rolled over month by month as the app does
  const startSerial = (y) => (codSerial === null ? "" : shiftSerial(codSerial, 12 * (y - 1)));
  S.series("yearStart", "Year starts", "date", { f: (y) => `IF(ISNUMBER(${S.s("cod")}),${dateF(S.s("cod"), 12 * (y - 1))},"")`, v: startSerial, fmt: "month", note: "The first day of the year, from the commercial operation date on the Inputs sheet" });
  S.datesRow = S.cell.yearStart;
  S.series("phase", "Phase", "", { f: (y) => `IF(${S.yr(y)}<=${S.s("ppaYears")},"PPA","Extension")`, v: (y) => (inPpa(y) ? "PPA" : "Extension"), fmt: "text" });
  ws.getRow(S.datesRow).font = { color: { argb: "FF555555" } };

  // ---- key results: filled at the end, once every row they read exists
  S.section("Key results");
  const KEYS = [
    ["tariff", tariffText, "₹/kWh", "tariff"],
    ["equityIrr", "Equity IRR", "%", "pct"],
    ["irrGap", "Equity IRR less the target", "%", "pct"],
    ["projectIrr", "Project IRR", "%", "pct"],
    ["equityNpv", "Equity NPV at the target IRR", "₹ cr", "cr"],
    ["projectNpv", "Project NPV at the discount rate", "₹ cr", "cr"],
    ["minDscr", "Minimum DSCR", "×", "x"],
    ["avgDscr", "Average DSCR", "×", "x"],
    ["lcoe", "Levelised cost of supply", "₹/kWh", "tariff"],
    ["levelisedTariff", "Levelised tariff", "₹/kWh", "tariff"],
    ["payback", "Equity payback", "year", "int"],
    ["capexTotal", "Project cost", "₹ cr", "cr"],
    ["debt", "Debt", "₹ cr", "cr"],
    ["equity", "Equity", "₹ cr", "cr"],
    ["revenueTotal", `Revenue over ${N} years`, "₹ cr", "cr"],
    ["mezz", "Mezzanine", "₹ cr", "cr"],
    ["quasi", "Quasi-equity", "₹ cr", "cr"],
    ["preTaxEquityIrr", "Equity IRR before tax", "%", "pct"],
    ["preTaxProjectIrr", "Project IRR before tax", "%", "pct"],
    ["holdcoIrr", "Holding company IRR", "%", "pct"],
    ["promoterIrr", "Promoter IRR", "%", "pct"],
    ["lenderXirr", "Lender's XIRR (dated flows)", "%", "pct"],
    ["lenderMirr", "Lender's MIRR", "%", "pct"],
    ["minFscr", "Minimum FSCR", "×", "x"],
    ["minLlcr", "Minimum LLCR", "×", "x"],
    ["minPlcr", "Minimum PLCR", "×", "x"],
    ["minTotalDscr", "Minimum DSCR including the mezzanine", "×", "x"],
    ["checks", "Model checks", "", null],
  ];
  r = S.next();
  ["", "", "This workbook", "App", "Difference", "Same as app?"].forEach((t, i) => {
    const c = r.getCell(i + 1);
    c.value = t || null;
    c.font = { bold: true, color: { argb: "FF555555" } };
    c.alignment = { horizontal: i > 1 ? "right" : "left" };
  });
  const keyRow0 = S.row + 1;
  S.row += KEYS.length;
  r = S.next();
  r.getCell(1).value = `To price ${sim ? "the supply" : "the bid"} again after changing an input: Data › What-If Analysis › Goal Seek, set the cell "Equity IRR less the target" to 0 by changing the ${sim ? "" : "bid "}tariff (on the Inputs sheet).`;
  r.getCell(1).font = { italic: true, color: { argb: "FF555555" } };

  // ---- project cost and funding
  S.section("Project cost and funding");
  const hardTerms = [];
  const capLine = (key, text, sizeKey, rateKey, unit) => {
    const v = S.v(sizeKey) * S.v(rateKey);
    S.one(key, text, unit, { f: `${S.s(sizeKey)}*${S.s(rateKey)}`, v, fmt: "cr" });
    hardTerms.push(key);
  };
  if (on.solar) capLine("solarCost", "Solar", "solarMw", "solarCapex", "₹ cr");
  if (on.wind) capLine("windCost", "Wind", "windMw", "windCapex", "₹ cr");
  if (on.biomass) capLine("biomassCost", "Biomass", "biomassMw", "biomassCapex", "₹ cr");
  if (hydro) capLine("hydroCost", "Hydro", "hydroMw", "hydroCapex", "₹ cr");
  if (thermal) capLine("thermalCost", "Thermal (non-RE)", "thermalMw", "thermalCapex", "₹ cr");
  if (on.bess) {
    capLine("bessCost", "Battery energy", "bessMwh", "bessCapex", "₹ cr");
    capLine("pcsCost", "Battery power conversion", "bessMw", "bessPcs", "₹ cr");
  }
  S.one("evacCost", "Transmission / evacuation", "₹ cr", { f: S.s("evac"), v: S.v("evac"), fmt: "cr" });
  hardTerms.push("evacCost");
  if (co.otherCapexCr) {
    S.one("otherCost", m.otherCapexLabel || "Other project cost", "₹ cr", { f: S.s("otherCapex"), v: S.v("otherCapex"), fmt: "cr" });
    hardTerms.push("otherCost");
  }
  const hard = hardTerms.reduce((a, k) => a + S.v(k), 0);
  S.one("hard", "Hard cost", "₹ cr", { f: `SUM(${S.s(hardTerms[0])}:${S.s(hardTerms[hardTerms.length - 1])})`, v: hard, fmt: "cr", bold: true });
  // the hard cost by part (the asset register and the construction phasing; finance v3)
  const regCost = {
    solar: { f: on.solar ? S.s("solarCost") : "0", v: on.solar ? S.v("solarCost") : 0 },
    wind: { f: on.wind ? S.s("windCost") : "0", v: on.wind ? S.v("windCost") : 0 },
    bess: { f: on.bess ? S.s("bessCost") : "0", v: on.bess ? S.v("bessCost") : 0 },
    pcs: { f: on.bess ? S.s("pcsCost") : "0", v: on.bess ? S.v("pcsCost") : 0 },
    evac: { f: S.s("evacCost"), v: S.v("evacCost") },
  };
  {
    const others = ["biomassCost", "hydroCost", "thermalCost", "otherCost"].filter((k) => S.cell[k]);
    regCost.other = { f: others.length ? others.map((k) => S.s(k)).join("+") : "0", v: others.reduce((a, k) => a + S.v(k), 0) };
  }
  S.group("The hard cost by part (the asset register)");
  const regLabel = { solar: "Solar", wind: "Wind", bess: "Battery energy", pcs: "Battery power conversion", evac: "Transmission / evacuation", other: "Other project cost (biomass, dispatchable plants, other)" };
  for (const k of ["solar", "wind", "bess", "pcs", "evac", "other"]) S.one(`reg_${k}`, regLabel[k], "₹ cr", { f: regCost[k].f, v: regCost[k].v, fmt: "cr" });
  for (const k of ["solar", "wind", "bess", "pcs", "evac", "other"]) {
    S.one(`share_${k}`, `${regLabel[k]}: share of the hard cost`, "%", { f: `IF(${S.s("hard")}>0,${S.s(`reg_${k}`)}/${S.s("hard")},0)`, v: hard > 0 ? regCost[k].v / hard : 0, fmt: "pct" });
  }
  S.group("Project cost");
  S.one("preopCost", consM > 0 ? "Pre-operative cost" : "Pre-operative and IDC", "₹ cr", { f: `${S.s("hard")}*${S.s("preop")}`, v: hard * S.v("preop"), fmt: "cr" });
  const base = hard * (1 + S.v("preop"));
  S.one("base", "Project cost before IDC", "₹ cr", { f: `${S.s("hard")}+${S.s("preopCost")}`, v: base, fmt: "cr" });
  // the construction sheet: the cost spent month by month by part, its funding, the bridge loan and the IDC
  const cons = addConstructionSheet(wb, sheets, S, {
    base, months: consM, profile: S.v("drawdown"), order: S.v("drawOrder"), debtPct: S.v("debtPct"), rate: S.v("rate"),
    parts: {
      solar: { amountF: `'${LIVE_SHEET}'!${S.s("reg_solar")}`, amount: regCost.solar.v, start: S.v("phase_solar_start"), months: S.v("phase_solar_months") },
      wind: { amountF: `'${LIVE_SHEET}'!${S.s("reg_wind")}`, amount: regCost.wind.v, start: S.v("phase_wind_start"), months: S.v("phase_wind_months") },
      bess: { amountF: `'${LIVE_SHEET}'!${S.s("reg_bess")}+'${LIVE_SHEET}'!${S.s("reg_pcs")}`, amount: regCost.bess.v + regCost.pcs.v, start: S.v("phase_bess_start"), months: S.v("phase_bess_months") },
      evac: { amountF: `'${LIVE_SHEET}'!${S.s("reg_evac")}`, amount: regCost.evac.v, start: S.v("phase_evac_start"), months: S.v("phase_evac_months") },
      other: { amountF: `'${LIVE_SHEET}'!${S.s("reg_other")}`, amount: regCost.other.v, start: S.v("phase_other_start"), months: S.v("phase_other_months") },
      preop: { amountF: `'${LIVE_SHEET}'!${S.s("preopCost")}`, amount: hard * S.v("preop") },
    },
    bridge: { months: S.v("bridgeMonths"), rate: S.v("bridgeRate"), feePct: S.v("bridgeFeePct") },
  });
  S.one("idc", "Interest during construction (sheet Construction)", "₹ cr", { f: cons.idcRef, v: cons.idc, fmt: "cr", note: consM > 0 ? `${consM} months, ${S.v("drawdown")} drawdown, ${S.v("drawOrder") === "equityFirst" ? "equity first" : "pro rata"} funding` : "No construction months: the IDC is inside the pre-operative share" });
  S.one("bridgeFeeCr", "Bridge loan takeout fee (sheet Construction)", "₹ cr", { f: cons.bridgeFeeRef, v: cons.bridgeFee, fmt: "cr", note: "Capitalised as debt with the IDC" });
  const bgCons = sumOf(S.v("bg_amtRng").map((a, i) => (nz(a) > 0 && nz(S.v("bg_fromRng")[i]) === 0 ? a * nz(S.v("bg_feeRng")[i]) : 0))) * (consM / 12);
  S.one("bgFees0", "Guarantees' fees over the construction", "₹ cr", { f: `SUMPRODUCT((${S.s("bg_fromRng")}=0)*(${S.s("bg_amtRng")}>0)*${S.s("bg_amtRng")}*${S.s("bg_feeRng")})*${S.s("consMonths")}/12`, v: bgCons, fmt: "cr", note: "The guarantees from year 0 (EMD, PBG…): their fee for the construction months, funded by equity" });
  const mezzFee = S.v("mezz0") * S.v("mezzFeePct");
  S.one("mezzFeeCr", "Mezzanine arrangement fee", "₹ cr", { f: `${S.s("mezz0")}*${S.s("mezzFeePct")}`, v: mezzFee, fmt: "cr", note: "Funded by equity" });
  const fees = bgCons + mezzFee;
  S.one("fees", "Fees funded by equity", "₹ cr", { f: `${S.s("bgFees0")}+${S.s("mezzFeeCr")}`, v: fees, fmt: "cr" });
  const total = base + cons.idc + cons.bridgeFee + fees;
  S.one("total", "Total project cost", "₹ cr", { f: `${S.s("base")}+${S.s("idc")}+${S.s("bridgeFeeCr")}+${S.s("fees")}`, v: total, fmt: "cr", bold: true });
  const debt0 = base * S.v("debtPct") + cons.idc + cons.bridgeFee;
  S.one("debt", "Senior debt", "₹ cr", { f: `${S.s("base")}*${S.s("debtPct")}+${S.s("idc")}+${S.s("bridgeFeeCr")}`, v: debt0, fmt: "cr", note: "The debt share of the cost before IDC, plus the IDC and the bridge fee (capitalised as debt)" });
  S.one("mezzIn", "Mezzanine", "₹ cr", { f: S.s("mezz0"), v: S.v("mezz0"), fmt: "cr" });
  S.one("quasiIn", "Quasi-equity", "₹ cr", { f: S.s("quasi0"), v: S.v("quasi0"), fmt: "cr" });
  const mezz0 = S.v("mezz0");
  const quasi0 = S.v("quasi0");
  const equity0 = total - debt0 - mezz0 - quasi0;
  S.one("equity", "Equity", "₹ cr", { f: `${S.s("total")}-${S.s("debt")}-${S.s("mezzIn")}-${S.s("quasiIn")}`, v: equity0, fmt: "cr", note: "What the senior debt, the mezzanine and the quasi-equity leave" });
  S.one("years", "Model years", "years", { f: `COUNT(${S.col(1)}${yearRow}:${S.last}${yearRow})`, v: N, fmt: "int", note: "The PPA term the optimiser dispatched plus the life extension; one column per year" });
  const tenorUsed = Math.min(NP, Math.max(1, Math.round(S.v("tenor"))));
  S.one("tenorUsed", "Loan tenor used", "years", { f: `MIN(${S.s("ppaYears")},MAX(1,ROUND(${S.s("tenor")},0)))`, v: tenorUsed, fmt: "int", note: "Within the PPA years" });
  const rt = S.v("rate");
  const graceUsed = Math.min(tenorUsed - 1, Math.max(0, Math.round(S.v("grace"))));
  S.one("graceUsed", "Moratorium used", "years", { f: `MIN(${S.s("tenorUsed")}-1,MAX(0,ROUND(${S.s("grace")},0)))`, v: graceUsed, fmt: "int" });
  const q = Number(S.v("instalments")) || 1;
  S.one("adjBase", "Interest saved by instalments within the year", "× the year's principal", { f: `(VALUE(${S.s("instalments")})-1)/(2*VALUE(${S.s("instalments")}))`, v: (q - 1) / (2 * q), fmt: "factor", note: "(instalments − 1) ÷ (2 × instalments): the principal is paid through the year, so the interest is on the average balance; 0 in a sculpted year" });
  const refiOn = S.v("refiYear") > 0 && S.v("refiYear") < tenorUsed ? 1 : 0;
  S.one("refiOn", "Refinancing applies", "1 / 0", { f: `IF(AND(${S.s("refiYear")}>0,${S.s("refiYear")}<${S.s("tenorUsed")}),1,0)`, v: refiOn, fmt: "int", note: "Only while there is a balance to refinance" });
  const refiEnd = refiOn ? Math.min(NP, S.v("refiYear") + Math.max(1, Math.round(S.v("refiTenor")))) : tenorUsed;
  S.one("refiEnd", "Last year of the refinanced debt", "year", { f: `IF(${S.s("refiOn")}=1,MIN(${S.s("ppaYears")},${S.s("refiYear")}+MAX(1,ROUND(${S.s("refiTenor")},0))),${S.s("tenorUsed")})`, v: refiEnd, fmt: "int" });
  const balloonShare = S.v("repay") === "bullet" ? 1 : Math.min(1, Math.max(0, S.v("balloonPct")));
  S.one("balloonShare", "Share repaid in the last year", "% of the debt", { f: `IF(${S.s("repay")}="bullet",1,MIN(1,MAX(0,${S.s("balloonPct")})))`, v: balloonShare, fmt: "pct", note: "balloon: the balloon share; bullet: all of it (by the repayment method before any refinancing)" });
  const bookBase = total * (1 - S.v("salvage"));
  S.one("bookBase", "Depreciable value (less salvage)", "₹ cr", { f: `${S.s("total")}*(1-${S.s("salvage")})`, v: bookBase, fmt: "cr" });
  S.one("bookDepYr", "Book depreciation a year (one life)", "₹ cr/yr", { f: `${S.s("bookBase")}/${S.s("bookLife")}`, v: bookBase / S.v("bookLife"), fmt: "cr" });
  const livesOn = S.v("livesOn") === "Yes";
  const lifeU = {};
  for (const k of ["solar", "wind", "bess", "pcs", "evac", "other"]) {
    const lk = k === "pcs" ? "bess" : k;
    const lv = S.v(`life_${lk}`);
    lifeU[k] = livesOn ? Math.max(1, Math.round(lv > 0 ? lv : S.v("bookLife"))) : S.v("bookLife");
    S.one(`lifeU_${k}`, `${regLabel[k]}: book life used`, "years", { f: `IF(${S.s("livesOn")}="Yes",MAX(1,ROUND(IF(${S.s(`life_${lk}`)}>0,${S.s(`life_${lk}`)},${S.s("bookLife")}),0)),${S.s("bookLife")})`, v: lifeU[k], fmt: "int" });
  }
  const rpOn = S.v("rpYear") > 0 && S.v("rpYear") <= N ? 1 : 0;
  S.one("rpOn", "Solar repowering applies", "1 / 0", { f: `IF(AND(${S.s("rpYear")}>0,${S.s("rpYear")}<=${S.s("years")}),1,0)`, v: rpOn, fmt: "int" });
  const rpBookYears = rpOn ? Math.max(1, S.v("bookLife") - S.v("rpYear") + 1) : 1;
  S.one("rpBookYears", "Repowering written off over", "years", { f: `IF(${S.s("rpOn")}=1,MAX(1,${S.s("bookLife")}-${S.s("rpYear")}+1),1)`, v: rpBookYears, fmt: "int", note: "The book life left from the repowering year" });
  const extTariffU = finite(S.v("extTariffIn")) ? S.v("extTariffIn") : S.v("flatPrice");
  S.one("extTariffU", "Price beyond the PPA, used", "₹/kWh", { f: `IF(ISNUMBER(${S.s("extTariffIn")}),${S.s("extTariffIn")},${S.s("flatPrice")})`, v: extTariffU, fmt: "tariff" });
  const extDegU = finite(S.v("extDegIn")) ? S.v("extDegIn") : S.v("solarDegFin");
  S.one("extDegU", "Energy fade beyond the PPA, used", "%/yr", { f: `IF(ISNUMBER(${S.s("extDegIn")}),${S.s("extDegIn")},${S.s("solarDegFin")})`, v: extDegU, fmt: "pct" });
  const mezzTenorU = mezz0 > 0 ? Math.min(N, Math.max(1, Math.round(S.v("mezzTenor") || 1))) : 0;
  S.one("mezzTenorU", "Mezzanine tenor used", "years", { f: `IF(${S.s("mezz0")}>0,MIN(${S.s("years")},MAX(1,ROUND(${S.s("mezzTenor")},0))),0)`, v: mezzTenorU, fmt: "int" });
  const mezzGraceU = mezz0 > 0 ? Math.max(0, Math.round(S.v("mezzGrace") || 0)) : 0;
  S.one("mezzGraceU", "Mezzanine moratorium used", "years", { f: `IF(${S.s("mezz0")}>0,MAX(0,ROUND(${S.s("mezzGrace")},0)),0)`, v: mezzGraceU, fmt: "int" });
  const sweepToU = finite(S.v("sweepToIn")) ? S.v("sweepToIn") : tenorUsed;
  S.one("sweepToU", "Cash sweep to year, used", "year", { f: `IF(ISNUMBER(${S.s("sweepToIn")}),${S.s("sweepToIn")},${S.s("tenorUsed")})`, v: sweepToU, fmt: "int" });
  const lossLimit = S.v("lossCarryIn") > 0 ? Math.round(S.v("lossCarryIn")) : null;
  S.one("lossLimitOn", "Business losses lapse", "1 / 0", { f: `IF(ISNUMBER(${S.s("lossCarryIn")}),IF(${S.s("lossCarryIn")}>0,1,0),0)`, v: lossLimit ? 1 : 0, fmt: "int" });
  // the DSRA's interest feeds the tax, the sculpted principal and the sweep, which feed the debt
  // service the reserve is held against: a circle a sheet cannot hold (the principal's formula
  // names the sculpting branch whatever the method, so even a spreadsheet's dependency graph has
  // the cycle), so the sheet carries the app's interest (its iteration's result) as values
  const dsraIntByValue = true;

  // ---- operating factors (finance v3): part commissioning, the generation case, the extension's fade, the repowering
  S.section("Operating factors (part commissioning, the generation case, the life extension, the repowering)");
  const partShares = S.v("part_shareRng");
  const partOffs = S.v("part_offsetRng");
  const partsOn = partShares.some((x) => finite(x));
  for (let i = 1; i <= SLOTS; i += 1) {
    const sh = S.s(`part${i}_share`);
    const of = S.s(`part${i}_offset`);
    S.series(`partM${i}`, `Part ${i}: months running in the year`, "months", {
      f: (y) => `IF(${sh}>0,MAX(0,12*${S.yr(y)}-IF(${S.yr(y)}=1,N(${of}),MAX(12*(${S.yr(y)}-1),N(${of})))),0)`,
      v: (y) => { const s = partShares[i - 1]; if (!(nz(s) > 0)) return 0; const o = nz(partOffs[i - 1]); return Math.max(0, 12 * y - (y === 1 ? o : Math.max(12 * (y - 1), o))); }, fmt: "num",
    });
  }
  const opFactorV = (y) => (partsOn ? partShares.reduce((a, s, i) => a + nz(s) * (S.v(`partM${i + 1}`, y) / 12), 0) : 1);
  S.series("opFactor", "Operating share of the year", "×", {
    f: (y) => `IF(COUNT(${S.s("part_shareRng")})=0,1,SUMPRODUCT(${S.s("part_shareRng")},${S.col(y)}${S.cell.partM1}:${S.col(y)}${S.cell[`partM${SLOTS}`]})/12)`,
    v: opFactorV, fmt: "factor", note: "Capacity-weighted share of the year the parts run; 1 without part commissioning (an early part can take year 1 above 1)",
  });
  S.series("genFactor", "Generation case factor", "×", { f: () => S.s("genF"), v: () => genF, fmt: "factor" });
  const fadeV = (y) => (inPpa(y) ? 1 : (1 - extDegU) ** (y - NP));
  S.series("fade", "Energy fade beyond the PPA", "×", { f: (y) => `IF(${S.yr(y)}<=${S.s("ppaYears")},1,(1-${S.s("extDegU")})^(${S.yr(y)}-${S.s("ppaYears")}))`, v: fadeV, fmt: "factor" });
  const op0 = (y) => m.ops[ppaY(y) - 1];
  const solarShareV = (y) => { const o = op0(y); const g = (o.solarGenMWh || 0) + (o.windGenMWh || 0); return g > 0 ? (o.solarGenMWh || 0) / g : 1; };
  S.series("solarShare", "Solar share of the generation", "%", { v: (y) => solarShareV(y), kind: "opt", fmt: "pct", note: "From the dispatch; 1 when the generation is not split by source" });
  const upliftV = (y) => (rpOn && y > S.v("rpYear") ? solarShareV(y) * S.v("rpUplift") : 0);
  S.series("uplift", "Repowering uplift", "× the energy", { f: (y) => `IF(AND(${S.s("rpOn")}=1,${S.yr(y)}>${S.s("rpYear")}),${S.at("solarShare", y)}*${S.s("rpUplift")},0)`, v: upliftV, fmt: "factor" });
  const kV = (y) => genF * opFactorV(y) * fadeV(y);
  S.series("kFactor", "Energy factor (case × operating share × fade)", "×", { f: (y) => `${S.at("genFactor", y)}*${S.at("opFactor", y)}*${S.at("fade", y)}`, v: kV, fmt: "factor" });
  const kUpV = (y) => kV(y) * (1 + upliftV(y));
  S.series("kUp", "Energy factor with the repowering uplift", "×", { f: (y) => `${S.at("kFactor", y)}*(1+${S.at("uplift", y)})`, v: kUpV, fmt: "factor" });

  // ---- generation: capacity × CUF × 365 days × 24 hours, built up from the monthly CUFs
  const busKeys = [];
  if (gen.length) {
    S.section("Generation (capacity × CUF × 365 days × 24 hours)");
    for (const k of gen) {
      const g = m.gen[k];
      const name = k === "solar" ? "Solar" : "Wind";
      const at = g.cufAt ? ` (at the ${g.cufAt})` : "";
      S.group(`${name}: CUF and generation by year`);
      if (g.monthCuf) {
        S.one(`${k}Cuf`, `${name} CUF${at}`, "%", {
          f: `(${g.monthCuf.map((_, i) => `${S.s(`${k}CufM${i + 1}`)}*${DAYS[i]}`).join("+")})/365`,
          v: g.monthCuf.reduce((a, c, i) => a + c * DAYS[i], 0) / 365, fmt: "pct", bold: true,
          note: "Each month's CUF weighted by its days: the mean of the 8,760 hours (the months are on the Inputs sheet)",
        });
      }
      S.series(`${k}DegF`, `${name} degradation factor`, "×", {
        f: (y) => `(1-${S.s(`${k}Deg`)})^(${S.yr(y)}-1)`, v: (y) => (1 - g.degradation) ** (y - 1), fmt: "factor",
      });
      const cuf = S.v(`${k}Cuf`);
      S.series(`${k}Gen`, `${name} generation${at}`, "MU", {
        f: (y) => `${S.s(`${k}Mw`)}*${S.s(`${k}Cuf`)}*365*24/1000*${S.at(`${k}DegF`, y)}`,
        v: (y) => (S.v(`${k}Mw`) * cuf * 365 * 24 / 1000) * S.v(`${k}DegF`, y), fmt: "mu", total: true,
        note: "MW × CUF × 365 days × 24 hours ÷ 1,000 (MWh to MU) × the year's degradation factor",
      });
      if (g.toBus > 0) {
        S.series(`${k}Bus`, `${name} at the 33 kV bus`, "MU", {
          f: (y) => `${S.at(`${k}Gen`, y)}*(1-${S.s(`${k}ToBus`)})`, v: (y) => S.v(`${k}Gen`, y) * (1 - g.toBus), fmt: "mu", total: true,
        });
        busKeys.push(`${k}Bus`);
      } else busKeys.push(`${k}Gen`);
      if (g.monthCuf) {
        S.group(`${name}: year 1 by month (MW × month's CUF × days × 24 hours)`);
        g.monthCuf.forEach((c, i) => S.one(`${k}MuM${i + 1}`, MONTHS[i], "MU", {
          f: `${S.s(`${k}Mw`)}*${S.s(`${k}CufM${i + 1}`)}*${DAYS[i]}*24/1000`, v: (S.v(`${k}Mw`) * c * DAYS[i] * 24) / 1000, fmt: "mu",
        }));
        const months = g.monthCuf.reduce((a, c, i) => a + (S.v(`${k}Mw`) * c * DAYS[i] * 24) / 1000, 0);
        S.one(`${k}MuYear`, "Twelve months together (= year 1 above)", "MU", {
          f: `SUM(${S.s(`${k}MuM1`)}:${S.s(`${k}MuM12`)})`, v: months, fmt: "mu", bold: true,
        });
      }
    }
    S.group("All renewable generation");
    S.series("genBus", "Solar and wind at the 33 kV bus", "MU", {
      f: (y) => busKeys.map((key) => S.at(key, y)).join("+"), v: (y) => busKeys.reduce((a, key) => a + S.v(key, y), 0), fmt: "mu", total: true, bold: true,
      note: "What the plant can generate in the year. The dispatch below decides how much of it reaches the procurer",
    });
  }

  // ---- the modelled years hour by hour, on their own sheets; each PPA year's energy below is
  // their totals, weighted as the sizing interpolates between the modelled years
  const dTotals = {};
  if (dsp) {
    const lm = (addr) => (String(addr).includes("!") ? String(addr) : `'${LIVE_SHEET}'!${String(addr).replace(/^\$?([A-Z]+)\$?(\d+)$/, "$$$1$$$2")}`);
    for (const y of dsp.byYear) {
      const deg = (k) => (S.cell[`${k}DegF`] ? { f: lm(S.at(`${k}DegF`, y.year)), v: S.v(`${k}DegF`, y.year) } : null);
      const range = Math.min(Math.max(dsp.initSoc - dsp.minSoc, 0), dsp.maxSoc - dsp.minSoc);
      const links = {
        ...(dsp.solar ? { solarMw: { f: lm(S.s("solarMw")), v: S.v("solarMw") }, solarDegF: deg("solar") } : {}),
        ...(dsp.wind ? { windMw: { f: lm(S.s("windMw")), v: S.v("windMw") }, windDegF: deg("wind") } : {}),
        contract: { f: lm(S.s("contract")), v: dsp.contract },
        poi: { f: lm(S.s("poi")), v: dsp.poi },
        eta: { f: lm(S.s("eta")), v: dsp.eta },
        ...(dsp.blocks ? { peakFloor: { f: lm(S.s("peakFloor")), v: dsp.peakFloor }, offFloor: { f: lm(S.s("offFloor")), v: dsp.offFloor } } : {}),
        ...(dsp.solarHours ? { solarFloor: { f: lm(S.s("solarFloor")), v: dsp.solarFloor }, solarMax: { f: lm(S.s("solarMax")), v: dsp.solarMax } } : {}),
        start: !on.bess ? { v: 0 } : {
          f: `MIN(MAX(${lm(S.s("initSoc"))}-${lm(S.s("minSoc"))},0),${lm(S.s("maxSoc"))}-${lm(S.s("minSoc"))})*${lm(S.s("bessMwh"))}*${y.bf}`,
          v: range * (S.v("bessMwh") || 0) * y.bf,
        },
      };
      const out = addDispatchSheet(wb, dsp, y, links, { rows: dispatchRows });
      dTotals[y.year] = out;
    }
  }
  // energy of PPA year y from the modelled years' totals (MWh → MU)
  const fromDispatch = (key, y) => {
    const w = dsp.weights[y - 1].map((x, j) => [x, dsp.byYear[j].year]).filter(([x]) => x > 0);
    return {
      f: `(${w.map(([x, yr]) => `${x === 1 ? "" : `${+x.toFixed(6)}*`}${dispatchRef(yr, dTotals[yr].totals[key])}`).join("+")})/1000`,
      v: w.reduce((a, [x, yr]) => a + x * dTotals[yr].values.totals[key], 0) / 1000,
    };
  };

  // ---- energy from the optimiser: the dispatch's figures (green), then the model's energy after the operating factors
  S.section(sim ? "Energy (the hourly simulation of each year, summed)" : "Energy (the optimiser's hourly dispatch, summed by year)");
  const op = (y) => m.ops[y - 1];
  const mu = (x) => (x || 0) / 1000;
  // a dispatch row: the optimiser's value in the PPA years, the last PPA year's beyond them (the
  // extension re-uses that year's energy, faded); zero beyond the PPA for what the PPA alone has
  const optRow = (key, text, unit, valueOf, { total = true, note, fmt = "mu", zeroBeyond = false, dispatchKey = null } = {}) => S.series(key, text, unit, {
    f: (y) => (inPpa(y) ? (dispatchKey && dsp ? fromDispatch(dispatchKey, y).f : null) : zeroBeyond ? "0" : S.at(key, NP)),
    v: (y) => (inPpa(y) ? (dispatchKey && dsp ? fromDispatch(dispatchKey, y).v : valueOf(op(y))) : zeroBeyond ? 0 : S.v(key, NP)),
    kind: "opt", kindOf: (y) => (inPpa(y) && !(dispatchKey && dsp) ? "opt" : "calc"), fmt, total, note,
  });
  S.group("The dispatch's energy (before the operating factors)");
  if (dsp) S.series("demandRaw", "Contracted energy (the dispatch)", "MU", { f: () => `${S.s("contract")}*8760/1000`, v: () => (dsp.contract * 8760) / 1000, fmt: "mu", total: true });
  else optRow("demandRaw", "Contracted energy (the dispatch)", "MU", (o) => mu(o.demandMWh));
  optRow("deliveredRaw", "Delivered to the procurer (the dispatch)", "MU", (o) => mu(o.deliveredMWh), { dispatchKey: "delivered", note: dsp ? "The modelled years' hour-by-hour sheets (Dispatch Y…), summed; years between them interpolated as the sizing does" : undefined });
  const soldText = buyer ? "Sold, in the market and to the buyer" : "Sold in the market";
  optRow("excessRaw", `${soldText} (the dispatch)`, "MU", (o) => mu(o.excessMWh + (o.buyerExcessMWh || 0)), { dispatchKey: dsp?.sell ? "soldMeter" : null });
  if (buyer) optRow("buyerMuRaw", "Of which the buyer takes (Solar Hours excess; the dispatch)", "MU", (o) => mu(o.buyerExcessMWh), { note: "The Solar Hours above 60% sold in hours where the market pays more than the buyer's share of the tariff: the buyer takes those" });
  S.group("The model's energy (after the operating factors)");
  S.series("demand", "Contracted energy", "MU", { f: (y) => `${S.at("demandRaw", y)}*${S.at("opFactor", y)}`, v: (y) => S.v("demandRaw", y) * opFactorV(y), fmt: "mu", total: true });
  S.series("delivered", "Delivered to the procurer", "MU", { f: (y) => `${S.at("deliveredRaw", y)}*${S.at("kUp", y)}`, v: (y) => S.v("deliveredRaw", y) * kUpV(y), fmt: "mu", total: true });
  S.series("excess", soldText, "MU", {
    f: (y) => (buyer ? `(${S.at("excessRaw", y)}-IF(${S.yr(y)}<=${S.s("ppaYears")},0,${S.at("buyerMuRaw", y)}))*${S.at("kUp", y)}` : `${S.at("excessRaw", y)}*${S.at("kUp", y)}`),
    v: (y) => (S.v("excessRaw", y) - (buyer && !inPpa(y) ? S.v("buyerMuRaw", y) : 0)) * kUpV(y), fmt: "mu", total: true, note: "Beyond the PPA the buyer takes nothing: every unit is sold in the market",
  });
  if (buyer) {
    S.series("buyerMu", "Of which the buyer takes (Solar Hours excess)", "MU", { f: (y) => `IF(${S.yr(y)}<=${S.s("ppaYears")},${S.at("buyerMuRaw", y)}*${S.at("kUp", y)},0)`, v: (y) => (inPpa(y) ? S.v("buyerMuRaw", y) * kUpV(y) : 0), fmt: "mu", total: true });
    S.series("marketMu", "Of which sold in the market", "MU", { f: (y) => `${S.at("excess", y)}-${S.at("buyerMu", y)}`, v: (y) => S.v("excess", y) - S.v("buyerMu", y), fmt: "mu", total: true });
  }
  S.series("dfr", "Delivered ÷ contracted", "%", {
    f: (y) => `IF(${S.at("demand", y)}>0,IF(OR(${S.at("genFactor", y)}<>1,${S.at("fade", y)}<>1,${S.at("uplift", y)}>0),MIN(1,${S.at("delivered", y)}/${S.at("demand", y)}),${S.at("delivered", y)}/${S.at("demand", y)}),1)`,
    v: (y) => { if (!(S.v("demand", y) > 0)) return 1; const ratio = S.v("delivered", y) / S.v("demand", y); return genF !== 1 || fadeV(y) !== 1 || upliftV(y) > 0 ? Math.min(1, ratio) : ratio; }, fmt: "pct",
    note: "Capped at 100% when the generation case, the fade or the repowering moves the energy",
  });
  S.series("repowerUp", "Energy added by the repowering", "MU", { f: (y) => `${S.at("deliveredRaw", y)}*${S.at("kFactor", y)}*${S.at("uplift", y)}`, v: (y) => S.v("deliveredRaw", y) * kV(y) * upliftV(y), fmt: "mu", total: true });
  S.series("shortfall", "Short of the annual floor", "MU", {
    f: (y) => `IF(${S.yr(y)}<=${S.s("ppaYears")},MAX(0,${S.s("target")}*${S.at("demand", y)}-${S.at("delivered", y)}),0)`,
    v: (y) => (inPpa(y) ? Math.max(0, S.v("target") * S.v("demand", y) - S.v("delivered", y)) : 0), fmt: "mu", total: true,
  });
  if (blocky && dsp?.blocks) S.series("blockShort", "Short of the time-block floors", "MU", { f: (y) => (inPpa(y) ? fromDispatch("short", y).f : "0"), v: (y) => (inPpa(y) ? fromDispatch("short", y).v : 0), fmt: "mu", total: true, note: "Each hour's energy below its floor, summed from the hour-by-hour sheets" });
  else if (blocky) optRow("blockShort", "Short of the time-block floors", "MU", (o) => mu(o.blockShortfallMWh), { zeroBeyond: true, note: "Each hour's energy below its floor (peak and off-peak blocks), from the dispatch" });
  if (hourly) {
    optRow("price", `Realised market price${m.market ? ` (IEX ${m.market}, hourly)` : " (hourly)"}`, "₹/kWh", (o) => (o.excessMWh > 0 && finite(o.surplusRevenueCr) ? ((o.surplusRevenueCr - (finite(o.recRevenueCr) ? o.recRevenueCr : 0)) * 1e4) / o.excessMWh : 0), { total: false, fmt: "tariff", note: "Market revenue of the year ÷ energy sold, at the hourly prices the optimiser dispatched against (REC proceeds apart)" });
    // income not tied to the energy sold (SECI CfD-I: the bidder's share of the RECs on own RE supplied
    // in a brown market) is its own row, so a year that sells no surplus still carries it
    if (recIncome) optRow("recRev", "REC proceeds and other market income not tied to energy sold", "₹ cr", (o) => (finite(o.recRevenueCr) ? o.recRevenueCr : 0), { total: true, zeroBeyond: true, note: "From the day-by-day operation; added to the market sale revenue" });
  } else {
    S.series("price", "Market sale price", "₹/kWh", { f: () => S.s("flatPrice"), v: () => S.v("flatPrice"), fmt: "tariff" });
  }
  if (cfd) {
    S.group("Bought and owed by year (SECI CfD-I, from the day-by-day operation)");
    optRow("chargingCr", "Charging power bought (green market, group RE)", "₹ cr", (o) => o.chargingCostCr || 0, { fmt: "cr", zeroBeyond: true, note: "The power bought to charge the battery, at the hourly GDAM price plus charges and the group RE price plus charges, within each Contract Year's sourcing limits" });
    optRow("pxFeesCr", "Exchange fees on the energy sold", "₹ cr", (o) => o.pxFeesCr || 0, { fmt: "cr", zeroBeyond: true });
    optRow("lcMw", "Contracted capacity under the Letter of Credit", "MW", (o) => o.lcMw || 0, { fmt: "mw", total: false, zeroBeyond: true, note: "The contracted MW during the term; 0 in any market years after it" });
    for (let k = 1; k <= penK; k += 1) optRow(`penRef${k}`, `Penalised week ${k}: reference price`, "₹/kWh", (o) => o.penaltyWeeks?.[k - 1]?.ref || 0, { fmt: "tariff", total: false, zeroBeyond: true, note: k === 1 ? "The week's highest evening price across the exchanges and markets (CfDA 4.4.3.i); the weeks whose supply fell short beyond the tolerance, in order" : undefined });
    for (let k = 1; k <= penK; k += 1) optRow(`penMwh${k}`, `Penalised week ${k}: energy short beyond the tolerance`, "MWh", (o) => o.penaltyWeeks?.[k - 1]?.beyondMwh || 0, { fmt: "num", total: false, zeroBeyond: true, note: k === 1 ? "The shortfall beyond 10% of the Contract Week's 14 MWh/MW (CfDA 4.4.3.ii)" : undefined });
  }
  if (on.biomass) {
    optRow("biomassMuRaw", "Biomass generation (the dispatch)", "MU", (o) => mu(o.biomassMWh));
    S.series("biomassMu", "Biomass generation", "MU", { f: (y) => `${S.at("biomassMuRaw", y)}*${S.at("opFactor", y)}`, v: (y) => S.v("biomassMuRaw", y) * opFactorV(y), fmt: "mu", total: true });
  }
  if (hydro) {
    optRow("hydroMuRaw", "Hydro energy (the dispatch)", "MU", (o) => mu(o.hydroMWh));
    S.series("hydroMu", "Hydro energy", "MU", { f: (y) => `${S.at("hydroMuRaw", y)}*${S.at("opFactor", y)}`, v: (y) => S.v("hydroMuRaw", y) * opFactorV(y), fmt: "mu", total: true });
  }
  if (thermal) {
    optRow("thermalMuRaw", "Thermal (non-RE) energy (the dispatch)", "MU", (o) => mu(o.thermalMWh));
    S.series("thermalMu", "Thermal (non-RE) energy", "MU", { f: (y) => `${S.at("thermalMuRaw", y)}*${S.at("opFactor", y)}`, v: (y) => S.v("thermalMuRaw", y) * opFactorV(y), fmt: "mu", total: true });
  }
  if (gen.length) {
    // what the dispatch did not use: the generation (a formula above) less what it delivered and sold
    const used = ["delivered", "excess", on.biomass && "biomassMu", hydro && "hydroMu", thermal && "thermalMu"].filter(Boolean);
    const extra = used.slice(2);
    S.series("unused", "Generated but not delivered or sold", "MU", {
      f: (y) => `${S.at("genBus", y)}${extra.map((k) => `+${S.at(k, y)}`).join("")}-${S.at("delivered", y)}-${S.at("excess", y)}`,
      v: (y) => S.v("genBus", y) + extra.reduce((a, k) => a + S.v(k, y), 0) - S.v("delivered", y) - S.v("excess", y),
      fmt: "mu", total: true,
      note: "Curtailed (more than the contract and the battery could take that hour), lost in the battery's round trip and, where delivery is measured at the meter, lost in the transformer and line",
    });
    S.series("usedShare", "Share of the generation delivered or sold", "%", {
      f: (y) => `IF(${S.at("genBus", y)}>0,(${S.at("delivered", y)}+${S.at("excess", y)})/(${S.at("genBus", y)}${extra.map((k) => `+${S.at(k, y)}`).join("")}),0)`,
      v: (y) => { const g = S.v("genBus", y) + extra.reduce((a, k) => a + S.v(k, y), 0); return g > 0 ? (S.v("delivered", y) + S.v("excess", y)) / g : 0; },
      fmt: "pct",
    });
  }
  if (meter) {
    if (gen.length) S.series("genBusMu", "Generated at the 33 kV bus", "MU", { f: (y) => S.at("genBus", y), v: (y) => S.v("genBus", y), fmt: "mu", total: true });
    else optRow("genBusMu", "Generated at the 33 kV bus", "MU", (o) => mu(o.genBusMWh));
    optRow("injectedMu", "Injected at the 33 kV bus", "MU", (o) => mu(o.injectedMWh));
    optRow("trafoLossMu", "Power transformer loss", "MU", (o) => mu(o.trafoLossMWh));
    optRow("lineLossMu", "Transmission line loss", "MU", (o) => mu(o.lineLossMWh));
    optRow("meterMu", "At the 220 kV billing meter", "MU", (o) => mu(o.meterMWh));
    S.series("evacLoss", "Loss from the 33 kV bus to the meter", "% of injected", {
      f: (y) => `IF(${S.at("injectedMu", y)}>0,(${S.at("trafoLossMu", y)}+${S.at("lineLossMu", y)})/${S.at("injectedMu", y)},0)`,
      v: (y) => (S.v("injectedMu", y) > 0 ? (S.v("trafoLossMu", y) + S.v("lineLossMu", y)) / S.v("injectedMu", y) : 0), fmt: "pct",
    });
  }

  // ---- escalation and discount factors
  S.section("Escalation and discount factors");
  const factor = (key, text, rateKey, sign = 1) => S.series(key, text, "×", {
    f: (y) => `(1${sign > 0 ? "+" : "-"}${S.s(rateKey)})^(${S.yr(y)}-1)`,
    v: (y) => (1 + sign * S.v(rateKey)) ** (y - 1), fmt: "factor",
  });
  factor("tariffF", "Tariff", "tariffEsc");
  factor("omF", "O&M and other fixed cost", "omEsc");
  factor("solarOmF", "Solar O&M", "solarEscU");
  factor("windOmF", "Wind O&M", "windEscU");
  factor("bessOmF", "Battery O&M", "bessEscU");
  factor("carbonF", "Carbon price", "carbonEsc");
  if (on.biomass) factor("fuelF", "Biomass fuel", "fuelEsc");
  if (hydro) factor("hydroF", "Hydro charges", "hydroEsc");
  if (thermal) factor("thermalF", "Thermal charges", "thermalEsc");
  if (on.bess) factor("bessF", "Battery price", "decline", -1);
  S.series("extOmF", "O&M and fixed cost beyond the PPA", "×", { f: (y) => `IF(${S.yr(y)}<=${S.s("ppaYears")},1,${S.s("extOmFactor")})`, v: (y) => (inPpa(y) ? 1 : S.v("extOmFactor")), fmt: "factor" });
  const omFactorV = (y) => (inPpa(y) ? 1 : S.v("extOmFactor")) * opFactorV(y);
  S.series("omFactorY", "O&M factor of the year (extension × operating share)", "×", { f: (y) => `${S.at("extOmF", y)}*${S.at("opFactor", y)}`, v: omFactorV, fmt: "factor" });
  S.series("df", "Discount factor", "×", { f: (y) => `1/(1+${S.s("disc")})^${S.yr(y)}`, v: (y) => 1 / (1 + S.v("disc")) ** y, fmt: "factor" });

  // ---- revenue
  S.section("Revenue");
  S.series("trf", "Tariff", "₹/kWh", { f: (y) => `IF(${S.yr(y)}<=${S.s("ppaYears")},${S.s("tariff")}*${S.at("tariffF", y)},${S.s("extTariffU")})`, v: (y) => (inPpa(y) ? S.v("tariff") * S.v("tariffF", y) : extTariffU), fmt: "tariff", note: "The escalated tariff in the PPA years, the price beyond the PPA after" });
  S.series("ppaRev", "PPA supply revenue", "₹ cr", {
    f: (y) => `IF(${S.yr(y)}<=${S.s("ppaYears")},${S.at("delivered", y)},${S.at("delivered", y)}+${S.at("excess", y)})*${S.at("trf", y)}/10`,
    v: (y) => ((inPpa(y) ? S.v("delivered", y) : S.v("delivered", y) + S.v("excess", y)) * S.v("trf", y)) / 10, total: true,
    note: "Delivered MU × tariff ₹/kWh ÷ 10 = ₹ crore; beyond the PPA every unit sells at the extension price",
  });
  S.series("mktRev", m.market ? `Market sale revenue (IEX ${m.market})` : "Market sale revenue", "₹ cr", {
    f: (y) => `IF(AND(${S.s("sell")}="Yes",${S.yr(y)}<=${S.s("ppaYears")}),${S.at(buyer ? "marketMu" : "excess", y)}*${S.at("price", y)}/10${recIncome ? `+${S.at("recRev", y)}` : ""},0)`,
    v: (y) => (S.v("sell") === "Yes" && inPpa(y) ? (S.v(buyer ? "marketMu" : "excess", y) * S.v("price", y)) / 10 + (recIncome ? S.v("recRev", y) : 0) : 0), total: true,
    note: recIncome ? "Energy sold × the realised price, plus the REC proceeds" : undefined,
  });
  if (buyer) {
    S.series("buyerRev", "Solar Hours excess sold to the buyer", "₹ cr", {
      f: (y) => `IF(${S.s("sell")}="Yes",${S.at("buyerMu", y)}*${S.s("buyerShare")}*${S.at("trf", y)}/10,0)`,
      v: (y) => (S.v("sell") === "Yes" ? (S.v("buyerMu", y) * S.v("buyerShare") * S.v("trf", y)) / 10 : 0), total: true,
      note: "MU × the buyer's share × the year's tariff ÷ 10 = ₹ crore",
    });
  }
  S.series("penaltyCr", "Shortfall penalty", "₹ cr", { f: (y) => `${S.at("shortfall", y)}*${S.s("penalty")}/10`, v: (y) => (S.v("shortfall", y) * S.v("penalty")) / 10, total: true });
  if (blocky) {
    S.series("blockPenCr", "Time-block shortfall penalty", "₹ cr", {
      f: (y) => `${S.at("blockShort", y)}*${S.s("blockMult")}*${S.at("trf", y)}/10`,
      v: (y) => (S.v("blockShort", y) * S.v("blockMult") * S.v("trf", y)) / 10, total: true,
      note: "Energy short of the block floors × multiple × the year's tariff",
    });
  }
  if (cfd) {
    const refs = (y) => (penK ? `${S.at("penRef1", y)}:${S.at(`penRef${penK}`, y)}` : null);
    const mwhs = (y) => (penK ? `${S.at("penMwh1", y)}:${S.at(`penMwh${penK}`, y)}` : null);
    S.series("cfdPenCr", "Weekly shortfall penalty (SECI CfD-I)", "₹ cr", {
      f: (y) => (penK ? `SUMPRODUCT((${refs(y)}>${S.at("trf", y)})*(${refs(y)}-${S.at("trf", y)})*${mwhs(y)})*${S.s("cfdMult")}/10000` : "0"),
      v: (y) => Array.from({ length: penK }, (_, k) => k + 1).reduce((a, k) => a + Math.max(0, S.v(`penRef${k}`, y) - S.v("trf", y)) * S.v(`penMwh${k}`, y), 0) * S.v("cfdMult") / 1e4, total: true,
      note: "Each penalised week: the multiple × (reference price − strike price, when positive) × the energy short, summed, MWh × ₹/kWh ÷ 10,000 = ₹ crore",
    });
  }
  const carbonMu = (y) => S.v("delivered", y) + (buyer ? S.v("marketMu", y) : S.v("excess", y));
  S.series("carbonRev", "Carbon credit revenue", "₹ cr", {
    f: (y) => `IF(AND(${S.s("carbonOn")}="Yes",${S.yr(y)}<=${S.s("carbonYears")}),(${S.at("delivered", y)}+${S.at(buyer ? "marketMu" : "excess", y)})*1000*${S.s("carbonT")}*${S.s("carbonPrice")}*${S.at("carbonF", y)}/10000000,0)`,
    v: (y) => (S.v("carbonOn") === "Yes" && y <= S.v("carbonYears") ? (carbonMu(y) * 1000 * S.v("carbonT") * S.v("carbonPrice") * S.v("carbonF", y)) / 1e7 : 0), total: true,
    note: "MWh generated for the grid × t CO₂/MWh × ₹/t (escalated) ÷ 1e7 = ₹ crore, for the first years",
  });
  const minusPenalties = (y) => `-${S.at("penaltyCr", y)}${blocky ? `-${S.at("blockPenCr", y)}` : ""}${cfd ? `-${S.at("cfdPenCr", y)}` : ""}`;
  S.series("revenue", "Total revenue", "₹ cr", {
    f: (y) => `${S.at("ppaRev", y)}+${S.at("mktRev", y)}${buyer ? `+${S.at("buyerRev", y)}` : ""}${minusPenalties(y)}+${S.at("carbonRev", y)}`,
    v: (y) => S.v("ppaRev", y) + S.v("mktRev", y) + (buyer ? S.v("buyerRev", y) : 0) - S.v("penaltyCr", y) - (blocky ? S.v("blockPenCr", y) : 0) - (cfd ? S.v("cfdPenCr", y) : 0) + S.v("carbonRev", y), total: true, bold: true,
  });

  // ---- operating costs
  S.section("Operating costs");
  const opexKeys = [];
  const omLine = (key, text, sizeKey, rateKey, fKey) => {
    S.series(key, text, "₹ cr", {
      f: (y) => `${S.s(sizeKey)}*${S.s(rateKey)}/100*${S.at(fKey, y)}*${S.at("omFactorY", y)}`,
      v: (y) => ((S.v(sizeKey) * S.v(rateKey)) / 100) * S.v(fKey, y) * omFactorV(y), total: true, note: "Size × ₹ lakh ÷ 100 = ₹ crore, escalated at the source's rate, × the year's O&M factor",
    });
    opexKeys.push(key);
  };
  if (on.solar) omLine("solarOmCr", "Solar O&M", "solarMw", "solarOm", "solarOmF");
  if (on.wind) {
    const lakhs = S.v("windC_lakhRng");
    const escUs = S.v("windC_escURng");
    const compOn = lakhs.some((x) => nz(x) > 0);
    for (let i = 1; i <= SLOTS; i += 1) {
      S.series(`windOmC${i}`, `Wind O&M component ${i}${S.v(`windC${i}_label`) ? ` (${S.v(`windC${i}_label`)})` : ""}`, "₹ cr", {
        f: (y) => `IF(${S.s(`windC${i}_lakh`)}>0,${S.s("windMw")}*${S.s(`windC${i}_lakh`)}/100*(1+${S.s(`windC${i}_escU`)})^(${S.yr(y)}-1)*${S.at("omFactorY", y)},0)`,
        v: (y) => (nz(lakhs[i - 1]) > 0 ? ((S.v("windMw") * lakhs[i - 1]) / 100) * (1 + escUs[i - 1]) ** (y - 1) * omFactorV(y) : 0), total: true,
      });
    }
    S.series("windOmCr", "Wind O&M", "₹ cr", {
      f: (y) => `IF(COUNTIF(${S.s("windC_lakhRng")},">0")>0,SUM(${S.col(y)}${S.cell.windOmC1}:${S.col(y)}${S.cell[`windOmC${SLOTS}`]}),${S.s("windMw")}*${S.s("windOm")}/100*${S.at("windOmF", y)}*${S.at("omFactorY", y)})`,
      v: (y) => (compOn ? Array.from({ length: SLOTS }, (_, i) => S.v(`windOmC${i + 1}`, y)).reduce((a, b) => a + b, 0) : ((S.v("windMw") * S.v("windOm")) / 100) * S.v("windOmF", y) * omFactorV(y)), total: true,
      note: "The components when any is given, else MW × ₹ lakh/MW ÷ 100, escalated",
    });
    opexKeys.push("windOmCr");
  }
  if (on.bess) omLine("bessOmCr", "Battery O&M", "bessMwh", "bessOm", "bessOmF");
  if (on.biomass) omLine("biomassOmCr", "Biomass O&M", "biomassMw", "biomassOm", "omF");
  S.series("insuranceCr", "Insurance", "₹ cr", { f: () => `${S.s("hard")}*${S.s("insurance")}`, v: () => S.v("hard") * S.v("insurance"), total: true });
  opexKeys.push("insuranceCr");
  {
    const crs = S.v("otherL_crRng");
    const escUs = S.v("otherL_escURng");
    const linesOn = crs.some((x) => nz(x) > 0);
    for (let i = 1; i <= SLOTS; i += 1) {
      S.series(`otherL${i}`, `Other fixed cost line ${i}${S.v(`otherL${i}_label`) ? ` (${S.v(`otherL${i}_label`)})` : ""}`, "₹ cr", {
        f: (y) => `IF(${S.s(`otherL${i}_cr`)}>0,${S.s(`otherL${i}_cr`)}*(1+${S.s(`otherL${i}_escU`)})^(${S.yr(y)}-1)*${S.at("extOmF", y)},0)`,
        v: (y) => (nz(crs[i - 1]) > 0 ? crs[i - 1] * (1 + escUs[i - 1]) ** (y - 1) * (inPpa(y) ? 1 : S.v("extOmFactor")) : 0), total: true,
      });
    }
    S.series("otherCr", "Other fixed cost", "₹ cr", {
      f: (y) => `IF(COUNTIF(${S.s("otherL_crRng")},">0")>0,SUM(${S.col(y)}${S.cell.otherL1}:${S.col(y)}${S.cell[`otherL${SLOTS}`]}),${S.s("otherFixed")}*${S.at("omF", y)}*${S.at("extOmF", y)})`,
      v: (y) => (linesOn ? Array.from({ length: SLOTS }, (_, i) => S.v(`otherL${i + 1}`, y)).reduce((a, b) => a + b, 0) : S.v("otherFixed") * S.v("omF", y) * (inPpa(y) ? 1 : S.v("extOmFactor"))), total: true,
      note: "The lines when any is given (solar park fees, audit fees, asset management…), else one amount escalating with O&M",
    });
    opexKeys.push("otherCr");
  }
  // O&M of the year (the working capital's O&M in hand and spares are on it)
  const omKeys = opexKeys.filter((k) => k.endsWith("OmCr"));
  S.series("omCr", "O&M of the year", "₹ cr", { f: (y) => (omKeys.length ? omKeys.map((k) => S.at(k, y)).join("+") : "0"), v: (y) => omKeys.reduce((a, k) => a + S.v(k, y), 0), total: true });
  if (m.ops.some((o) => (o.dsmChargeCr || 0) > 0)) {
    optRow("dsmCr", "Deviation settlement charges (CERC DSM)", "₹ cr", (o) => o.dsmChargeCr || 0, { fmt: "cr", zeroBeyond: true, note: "The year's DSM charges on the forecast error, worked out block by block in TenderOS" });
    opexKeys.push("dsmCr");
  } else if (m.ops.some((o) => (o.dsmA || 0) !== 0 || (o.dsmB || 0) !== 0)) {
    // the charge per MWh scheduled is a line in the year's tariff: a × tariff + b (web/src/dsm/dsm.js)
    optRow("dsmA", "DSM charge per MWh scheduled, per ₹/kWh of tariff", "₹/MWh per ₹/kWh", (o) => o.dsmA || 0, { fmt: "num", total: false, zeroBeyond: true, note: "From the forecast-error distribution, the tolerance band and the X factor of the year, and the steps beyond the band (TenderOS, DSM norms)" });
    optRow("dsmB", "DSM charge per MWh scheduled, at the normal rates", "₹/MWh", (o) => o.dsmB || 0, { fmt: "num", total: false, zeroBeyond: true, note: "The in-band deviation settled at the normal rate: dear when the plant is short, cheap when it is long" });
    S.series("dsmCr", "Deviation settlement charges (CERC DSM)", "₹ cr", {
      f: (y) => `(${S.at("delivered", y)}+${S.at("excess", y)})*(${S.at("dsmA", y)}*${S.at("trf", y)}+${S.at("dsmB", y)})/10000`,
      v: (y) => ((S.v("delivered", y) + S.v("excess", y)) * (S.v("dsmA", y) * S.v("trf", y) + S.v("dsmB", y))) / 1e4,
      total: true, note: "Energy scheduled (MU, what reaches the meter) × (a × tariff + b) ÷ 10,000",
    });
    opexKeys.push("dsmCr");
  }
  if (cfd) {
    S.series("chargingCostCr", "Charging power (green market, group RE)", "₹ cr", { f: (y) => S.at("chargingCr", y), v: (y) => S.v("chargingCr", y), total: true });
    S.series("pxFeeCostCr", "Exchange fees", "₹ cr", { f: (y) => S.at("pxFeesCr", y), v: (y) => S.v("pxFeesCr", y), total: true });
    S.series("lcCostCr", "Letter of Credit to SECI", "₹ cr", {
      f: (y) => `${S.s("lcPct")}*2000*${S.at("lcMw", y)}*MAX(0,${S.s("lcC")}-${S.at("trf", y)})*${S.s("lcDays")}/10000000`,
      v: (y) => (S.v("lcPct") * 2000 * S.v("lcMw", y) * Math.max(0, S.v("lcC") - S.v("trf", y)) * S.v("lcDays")) / 1e7, total: true,
      note: "The LC's cost a year: cost % × 2000 kWh × MW × (C − strike price) × days ÷ 1e7 = ₹ crore",
    });
    opexKeys.push("chargingCostCr", "pxFeeCostCr", "lcCostCr");
  }
  if (on.biomass) {
    S.series("fuelCr", "Biomass fuel", "₹ cr", { f: (y) => `${S.at("biomassMu", y)}*${S.s("fuel")}*${S.at("fuelF", y)}/10`, v: (y) => (S.v("biomassMu", y) * S.v("fuel") * S.v("fuelF", y)) / 10, total: true });
    opexKeys.push("fuelCr");
  }
  if (hydro) {
    S.series("hydroFixedCr", "Hydro capacity charge", "₹ cr", { f: (y) => `${S.s("hydroMw")}*${S.s("hydroFixed")}/100*${S.at("hydroF", y)}`, v: (y) => ((S.v("hydroMw") * S.v("hydroFixed")) / 100) * S.v("hydroF", y), total: true });
    S.series("hydroEnergyCr", "Hydro energy charge", "₹ cr", { f: (y) => `${S.at("hydroMu", y)}*${S.s("hydroEnergy")}*${S.at("hydroF", y)}/10`, v: (y) => (S.v("hydroMu", y) * S.v("hydroEnergy") * S.v("hydroF", y)) / 10, total: true });
    opexKeys.push("hydroFixedCr", "hydroEnergyCr");
  }
  if (thermal) {
    S.series("thermalFixedCr", "Thermal capacity charge", "₹ cr", { f: (y) => `${S.s("thermalMw")}*${S.s("thermalFixed")}/100*${S.at("thermalF", y)}`, v: (y) => ((S.v("thermalMw") * S.v("thermalFixed")) / 100) * S.v("thermalF", y), total: true });
    S.series("thermalEnergyCr", "Thermal energy charge and RECs", "₹ cr", {
      f: (y) => `${S.at("thermalMu", y)}*(${S.s("thermalEnergy")}+${S.s("thermalRec")})*${S.at("thermalF", y)}/10`,
      v: (y) => (S.v("thermalMu", y) * (S.v("thermalEnergy") + S.v("thermalRec")) * S.v("thermalF", y)) / 10, total: true,
    });
    opexKeys.push("thermalFixedCr", "thermalEnergyCr");
  }
  S.series("opex", "Total operating cost", "₹ cr", {
    f: (y) => opexKeys.map((k) => S.at(k, y)).join("+"),
    v: (y) => opexKeys.reduce((a, k) => a + S.v(k, y), 0), total: true, bold: true,
  });
  S.series("ebitda", "EBITDA", "₹ cr", { f: (y) => `${S.at("revenue", y)}-${S.at("opex", y)}`, v: (y) => S.v("revenue", y) - S.v("opex", y), total: true, bold: true });
  S.series("margin", "EBITDA margin", "%", {
    f: (y) => `IF(${S.at("revenue", y)}<>0,${S.at("ebitda", y)}/${S.at("revenue", y)},"")`,
    v: (y) => (S.v("revenue", y) !== 0 ? S.v("ebitda", y) / S.v("revenue", y) : ""), fmt: "pct",
  });

  // ---- guarantees, margin money and the reserve's interest (finance v3)
  S.section("Guarantees, margin money and other income");
  const bgAmt = S.v("bg_amtRng"); const bgFee = S.v("bg_feeRng"); const bgMP = S.v("bg_marginPctRng"); const bgMR = S.v("bg_marginRateRng"); const bgFrom = S.v("bg_fromURng"); const bgTo = S.v("bg_toURng");
  const bgRun = (y) => bgAmt.map((a, i) => (nz(a) > 0 && bgFrom[i] <= y && bgTo[i] >= y ? i : -1)).filter((i) => i >= 0);
  const cond = (y) => `(${S.s("bg_fromURng")}<=${S.yr(y)})*(${S.s("bg_toURng")}>=${S.yr(y)})*(${S.s("bg_amtRng")}>0)`;
  S.series("bgFees", "Guarantee fees", "₹ cr", { f: (y) => `SUMPRODUCT(${cond(y)}*${S.s("bg_amtRng")}*${S.s("bg_feeRng")})`, v: (y) => bgRun(y).reduce((a, i) => a + bgAmt[i] * nz(bgFee[i]), 0), total: true, note: "Each guarantee's amount × fee while it runs; expensed below EBITDA" });
  S.series("marginBal", "Margin money blocked", "₹ cr", { f: (y) => `SUMPRODUCT(${cond(y)}*${S.s("bg_amtRng")}*${S.s("bg_marginPctRng")})`, v: (y) => bgRun(y).reduce((a, i) => a + bgAmt[i] * nz(bgMP[i]), 0), note: "Funded from the equity cash while the guarantees run, like the reserve" });
  S.series("dMargin", "Put into (released from) the margin money", "₹ cr", { f: (y) => (y === 1 ? S.at("marginBal", 1) : `${S.at("marginBal", y)}-${S.at("marginBal", y - 1)}`), v: (y) => S.v("marginBal", y) - (y === 1 ? 0 : S.v("marginBal", y - 1)), total: true });
  S.series("marginInt", "Interest on the margin money", "₹ cr", { f: (y) => `SUMPRODUCT(${cond(y)}*${S.s("bg_amtRng")}*${S.s("bg_marginPctRng")}*${S.s("bg_marginRateRng")})`, v: (y) => bgRun(y).reduce((a, i) => a + bgAmt[i] * nz(bgMP[i]) * nz(bgMR[i]), 0), total: true });
  S.series("dsraInt", "Interest on the debt service reserve", "₹ cr", { v: () => null, total: true, note: "The app's figures (the reserve held at the start of the year × its rate): the interest, the tax, the sculpted principal and the reserve sized on the debt service form a circle a sheet cannot hold, so the app iterates it and the sheet carries the result" });
  S.series("otherIncome", "Other income", "₹ cr", { f: (y) => `${S.at("dsraInt", y)}+${S.at("marginInt", y)}`, v: () => null, total: true });

  // ---- capital spend in operation: battery augmentation, the life extension, the solar repowering
  S.section("Capital spend in operation (battery augmentation, life extension, repowering)");
  if (on.bess) {
    const augYs = S.v("augY_yearRng").map((v) => (finite(v) ? Math.round(v) : null)).filter((v) => v !== null && v > 1 && v <= NP);
    const lastAugV = (y) => Math.max(1, ...augYs.filter((a) => a < y));
    const isAugV = (y) => augYs.includes(y);
    const slotY = (i) => `ROUND(N(${S.s(`augY${i}_year`)}),0)`;
    S.series("lastAug", "Last augmentation year before this one (schedule)", "year", {
      f: (y) => `MAX(1,${Array.from({ length: SLOTS }, (_, i) => `IF(AND(${slotY(i + 1)}>1,${slotY(i + 1)}<=${S.s("ppaYears")},${slotY(i + 1)}<${S.yr(y)}),${slotY(i + 1)},0)`).join(",")})`,
      v: lastAugV, fmt: "int",
    });
    S.series("isAug", "Augmentation year (schedule)", "1 / 0", {
      f: (y) => `IF(OR(${Array.from({ length: SLOTS }, (_, i) => `AND(${slotY(i + 1)}>1,${slotY(i + 1)}<=${S.s("ppaYears")},${slotY(i + 1)}=${S.yr(y)})`).join(",")}),1,0)`,
      v: (y) => (isAugV(y) ? 1 : 0), fmt: "int",
    });
    const augV = (y) => {
      if (!inPpa(y)) return 0;
      const price = S.v("bessCapex") * S.v("bessF", y);
      if (S.v("augMethod") === "annual") return y >= 2 ? S.v("bessMwh") * S.v("deg") * price : 0;
      if (S.v("augMethod") === "oneTime" && y === S.v("augYear") && S.v("augYear") > 1 && S.v("augYear") <= NP) return S.v("bessMwh") * Math.min(0.6, S.v("deg") * (y - 1)) * price;
      if (S.v("augMethod") === "schedule" && isAugV(y)) return S.v("bessMwh") * Math.min(0.6, S.v("deg") * (y - lastAugV(y))) * price;
      return 0;
    };
    S.series("aug", "Battery augmentation", "₹ cr", {
      f: (y) => `IF(${S.yr(y)}>${S.s("ppaYears")},0,IF(${S.s("augMethod")}="annual",IF(${S.yr(y)}>=2,${S.s("bessMwh")}*${S.s("deg")}*${S.s("bessCapex")}*${S.at("bessF", y)},0),`
        + `IF(AND(${S.s("augMethod")}="oneTime",${S.yr(y)}=${S.s("augYear")},${S.s("augYear")}>1,${S.s("augYear")}<=${S.s("ppaYears")}),`
        + `${S.s("bessMwh")}*MIN(0.6,${S.s("deg")}*(${S.yr(y)}-1))*${S.s("bessCapex")}*${S.at("bessF", y)},`
        + `IF(AND(${S.s("augMethod")}="schedule",${S.at("isAug", y)}=1),${S.s("bessMwh")}*MIN(0.6,${S.s("deg")}*(${S.yr(y)}-${S.at("lastAug", y)}))*${S.s("bessCapex")}*${S.at("bessF", y)},0))))`,
      v: augV, total: true,
      note: "annual: each year from year 2 replaces the year's fade (MWh × fade × the year's battery price); oneTime: the fade to that year (at most 60%), once; schedule: in each listed year the fade since the last augmentation. Within the PPA years",
    });
  } else {
    S.series("aug", "Battery augmentation (no battery)", "₹ cr", { v: () => 0, total: true });
  }
  S.series("extCapex", "Life extension capital cost", "₹ cr", {
    f: (y) => `IF(AND(${S.s("extYears")}>0,${S.yr(y)}=${S.s("ppaYears")}),MAX(0,${S.s("extCapexIn")}),0)`,
    v: (y) => (EXT > 0 && y === NP ? Math.max(0, S.v("extCapexIn")) : 0), total: true, note: "Spent in the last PPA year",
  });
  S.series("repower", "Solar repowering capital cost", "₹ cr", {
    f: (y) => `IF(AND(${S.s("rpOn")}=1,${S.yr(y)}=${S.s("rpYear")}),${S.s("rpCapex")},0)`,
    v: (y) => (rpOn && y === S.v("rpYear") ? S.v("rpCapex") : 0), total: true,
  });
  S.series("capexOps", "Capital spend in operation", "₹ cr", { f: (y) => `${S.at("aug", y)}+${S.at("extCapex", y)}+${S.at("repower", y)}`, v: (y) => S.v("aug", y) + S.v("extCapex", y) + S.v("repower", y), total: true, bold: true });

  // ---- book depreciation: straight line by component (one life, or each component's), the additions, and written down
  S.section("Book depreciation (straight line and written down)");
  for (const k of ["solar", "wind", "bess", "pcs", "evac", "other"]) {
    S.series(`slm_${k}`, `${regLabel[k]}: straight line`, "₹ cr", {
      f: (y) => `IF(${S.yr(y)}<=${S.s(`lifeU_${k}`)},${S.s("bookBase")}*${S.s(`share_${k}`)}/${S.s(`lifeU_${k}`)},0)`,
      v: (y) => (y <= lifeU[k] ? (bookBase * S.v(`share_${k}`)) / lifeU[k] : 0), total: true,
    });
  }
  const slmKeys = ["solar", "wind", "bess", "pcs", "evac", "other"].map((k) => `slm_${k}`);
  S.series("baseDep", "On the project cost (straight line, the components together)", "₹ cr", {
    f: (y) => slmKeys.map((k) => S.at(k, y)).join("+"), v: (y) => slmKeys.reduce((a, k) => a + S.v(k, y), 0), total: true,
    note: "One life: the depreciable value ÷ the book life; by component: each component's share of it ÷ its life",
  });
  S.series("augDepAdd", "Added for this year's augmentation", "₹ cr", {
    f: (y) => `${S.at("aug", y)}/MAX(1,${S.s("ppaYears")}-${S.yr(y)}+1)`, v: (y) => S.v("aug", y) / Math.max(1, NP - y + 1),
    note: "Augmentation is depreciated over the PPA years left",
  });
  S.series("augDep", "On augmentation", "₹ cr", {
    f: (y) => (y === 1 ? S.at("augDepAdd", 1) : `${S.at("augDep", y - 1)}+${S.at("augDepAdd", y)}`),
    v: (y) => (y === 1 ? S.v("augDepAdd", 1) : S.v("augDep", y - 1) + S.v("augDepAdd", y)), total: true,
  });
  S.series("extDep", "On the life extension (over the extension years)", "₹ cr", {
    f: (y) => `IF(AND(${S.s("extYears")}>0,${S.yr(y)}>${S.s("ppaYears")}),C${S.cell.extCapex}/${S.s("extYears")},0)`,
    v: (y) => (EXT > 0 && y > NP ? sumOf(S.v("extCapex").slice(1)) / EXT : 0), total: true,
  });
  S.series("rpDep", "On the repowering (over the book life left)", "₹ cr", {
    f: (y) => `IF(AND(${S.s("rpOn")}=1,${S.yr(y)}>=${S.s("rpYear")},${S.yr(y)}<${S.s("rpYear")}+${S.s("rpBookYears")}),${S.s("rpCapex")}/${S.s("rpBookYears")},0)`,
    v: (y) => (rpOn && y >= S.v("rpYear") && y < S.v("rpYear") + rpBookYears ? S.v("rpCapex") / rpBookYears : 0), total: true,
  });
  S.series("bookDepSlm", "Book depreciation, straight line", "₹ cr", {
    f: (y) => `${S.at("baseDep", y)}+${S.at("augDep", y)}+${S.at("extDep", y)}+${S.at("rpDep", y)}`,
    v: (y) => S.v("baseDep", y) + S.v("augDep", y) + S.v("extDep", y) + S.v("rpDep", y), total: true, bold: true,
  });
  S.series("bookWdvOpen", "Book block, opening (written down)", "₹ cr", { v: () => null });
  S.series("bookWdvDep", "Book depreciation, written down", "₹ cr", { v: () => null, total: true, bold: true, note: "(opening + the year's capital spend) × the book WDV rate" });
  S.series("bookWdvClose", "Book block, closing (written down)", "₹ cr", { v: () => null });
  {
    let block = total;
    for (let y = 1; y <= N; y += 1) {
      const open = block;
      block += S.v("capexOps", y);
      const dep = block * S.v("bookWdvRateU");
      block -= dep;
      S.fill("bookWdvOpen", y, { f: y === 1 ? S.s("total") : S.at("bookWdvClose", y - 1), v: open });
      S.fill("bookWdvDep", y, { f: `(${S.at("bookWdvOpen", y)}+${S.at("capexOps", y)})*${S.s("bookWdvRateU")}`, v: dep, bold: true });
      S.fill("bookWdvClose", y, { f: `${S.at("bookWdvOpen", y)}+${S.at("capexOps", y)}-${S.at("bookWdvDep", y)}`, v: block });
    }
    S.total("bookWdvDep");
  }
  const bookWdv = S.v("bookMethod") === "wdv";
  S.series("bookDep", "Book depreciation", "₹ cr", { f: (y) => `IF(${S.s("bookMethod")}="wdv",${S.at("bookWdvDep", y)},${S.at("bookDepSlm", y)})`, v: (y) => (bookWdv ? S.v("bookWdvDep", y) : S.v("bookDepSlm", y)), total: true, bold: true });

  // ---- the asset register: the gross block, the accumulated depreciation and the net block by component
  S.section("Asset register (gross block, accumulated depreciation and net block by component)");
  const regLabelAll = { ...regLabel, preop: "Pre-operative cost", idc: "Interest during construction", fees: "Fees capitalised (bridge, guarantees, mezzanine)" };
  const gross0 = { solar: regCost.solar.v, wind: regCost.wind.v, bess: regCost.bess.v, pcs: regCost.pcs.v, evac: regCost.evac.v, other: regCost.other.v, preop: hard * S.v("preop"), idc: cons.idc, fees: fees + cons.bridgeFee };
  const gross0F = { solar: S.s("reg_solar"), wind: S.s("reg_wind"), bess: S.s("reg_bess"), pcs: S.s("reg_pcs"), evac: S.s("reg_evac"), other: S.s("reg_other"), preop: S.s("preopCost"), idc: S.s("idc"), fees: `${S.s("fees")}+${S.s("bridgeFeeCr")}` };
  const addsOf = { bess: "aug", other: "extCapex", solar: "repower" };
  for (const k of REGISTER) {
    const add = addsOf[k];
    S.series(`gross_${k}`, `${regLabelAll[k]}: gross block`, "₹ cr", {
      y0: { f: gross0F[k], v: gross0[k] },
      f: (y) => (add ? `${S.at(`gross_${k}`, y - 1)}+${S.at(add, y)}` : S.at(`gross_${k}`, y - 1)),
      v: (y) => S.v(`gross_${k}`, y - 1) + (add ? S.v(add, y) : 0),
    });
  }
  S.series("grossBlock", "Gross block", "₹ cr", {
    y0: { f: REGISTER.map((k) => S.at(`gross_${k}`, 0)).join("+"), v: total },
    f: (y) => REGISTER.map((k) => S.at(`gross_${k}`, y)).join("+"), v: (y) => REGISTER.reduce((a, k) => a + S.v(`gross_${k}`, y), 0), bold: true,
  });
  const extraDep = { bess: "augDep", other: "extDep", solar: "rpDep" };
  const regOf = (k) => ["solar", "wind", "bess", "pcs", "evac", "other"].includes(k);
  const componentDep = livesOn && !bookWdv;
  for (const k of REGISTER) {
    const slmF = regOf(k) ? S.cell[`slm_${k}`] && ((y) => S.at(`slm_${k}`, y)) : null;
    S.series(`accDep_${k}`, `${regLabelAll[k]}: accumulated depreciation`, "₹ cr", {
      y0: { f: "0", v: 0 },
      f: (y) => `IF(AND(${S.s("livesOn")}="Yes",${S.s("bookMethod")}<>"wdv"),${S.at(`accDep_${k}`, y - 1)}${slmF ? `+${slmF(y)}` : ""}${extraDep[k] ? `+${S.at(extraDep[k], y)}` : ""},${S.at(`accDep_${k}`, y - 1)}+IF(${S.at("grossBlock", y)}>0,${S.at("bookDep", y)}*${S.at(`gross_${k}`, y)}/${S.at("grossBlock", y)},0))`,
      v: (y) => S.v(`accDep_${k}`, y - 1) + (componentDep
        ? (regOf(k) ? S.v(`slm_${k}`, y) : 0) + (extraDep[k] ? S.v(extraDep[k], y) : 0)
        : (S.v("grossBlock", y) > 0 ? (S.v("bookDep", y) * S.v(`gross_${k}`, y)) / S.v("grossBlock", y) : 0)),
    });
  }
  S.series("accDep", "Accumulated depreciation", "₹ cr", {
    y0: { f: "0", v: 0 },
    f: (y) => REGISTER.map((k) => S.at(`accDep_${k}`, y)).join("+"), v: (y) => REGISTER.reduce((a, k) => a + S.v(`accDep_${k}`, y), 0), bold: true,
    note: "By component when book lives are given (straight line); else the year's book depreciation spread pro rata to the gross block",
  });
  for (const k of REGISTER) {
    S.series(`net_${k}`, `${regLabelAll[k]}: net block`, "₹ cr", { y0: { f: S.at(`gross_${k}`, 0), v: gross0[k] }, f: (y) => `${S.at(`gross_${k}`, y)}-${S.at(`accDep_${k}`, y)}`, v: (y) => S.v(`gross_${k}`, y) - S.v(`accDep_${k}`, y) });
  }
  S.series("netBlock", "Net block", "₹ cr", { y0: { f: S.at("grossBlock", 0), v: total }, f: (y) => `${S.at("grossBlock", y)}-${S.at("accDep", y)}`, v: (y) => S.v("grossBlock", y) - S.v("accDep", y), bold: true });

  // ---- working capital (before the debt: the sculpted principal reads the cash flow)
  S.section("Working capital");
  S.series("recv", "Receivables", "₹ cr", { f: (y) => `${S.at("revenue", y)}*${S.s("recvDays")}/365`, v: (y) => (S.v("revenue", y) * S.v("recvDays")) / 365, note: "Revenue × receivable days ÷ 365, held at the year end" });
  S.series("omStock", "O&M in hand", "₹ cr", { f: (y) => `${S.at("omCr", y)}*${S.s("omMonths")}/12`, v: (y) => (S.v("omCr", y) * S.v("omMonths")) / 12 });
  S.series("spares", "Maintenance spares", "₹ cr", { f: (y) => `${S.at("omCr", y)}*${S.s("sparesPct")}`, v: (y) => S.v("omCr", y) * S.v("sparesPct") });
  S.series("wcBal", "Working capital", "₹ cr", { f: (y) => `${S.at("recv", y)}+${S.at("omStock", y)}+${S.at("spares", y)}`, v: (y) => S.v("recv", y) + S.v("omStock", y) + S.v("spares", y), bold: true });
  S.series("dWc", "Increase in working capital", "₹ cr", {
    f: (y) => (y === 1 ? S.at("wcBal", 1) : `${S.at("wcBal", y)}-${S.at("wcBal", y - 1)}`),
    v: (y) => (y === 1 ? S.v("wcBal", 1) : S.v("wcBal", y) - S.v("wcBal", y - 1)), total: true,
  });
  S.series("wcInt", "Interest on working capital", "₹ cr", { f: (y) => `${S.at("wcBal", y)}*${S.s("wcRate")}`, v: (y) => S.v("wcBal", y) * S.v("wcRate"), total: true });

  // ---- tax depreciation (before the debt: the sculpted principal needs the tax): both bases, the chosen one used
  S.section("Tax depreciation (written down and straight line)");
  S.series("wdvOpen", "Tax block, opening", "₹ cr", { v: () => null });
  S.series("wdvAdd", "Added: the year's capital spend", "₹ cr", { f: (y) => S.at("capexOps", y), v: (y) => S.v("capexOps", y), total: true });
  S.series("taxDepWdv", "Tax depreciation, written down", "₹ cr", { v: () => null, total: true });
  S.series("wdvClose", "Tax block, closing", "₹ cr", { v: () => null });
  S.series("taxDepSlm", "Tax depreciation, straight line (the book straight line)", "₹ cr", { f: (y) => S.at("bookDepSlm", y), v: (y) => S.v("bookDepSlm", y), total: true });
  S.series("taxDep", "Tax depreciation", "₹ cr", { v: () => null, total: true, bold: true });
  {
    let block = total;
    const wdv = S.v("taxMethod") === "wdv";
    for (let y = 1; y <= N; y += 1) {
      const open = block;
      block += S.v("capexOps", y);
      const depW = block * S.v("wdvRate");
      block -= depW;
      S.fill("wdvOpen", y, { f: y === 1 ? S.s("total") : S.at("wdvClose", y - 1), v: open });
      S.fill("taxDepWdv", y, { f: `(${S.at("wdvOpen", y)}+${S.at("wdvAdd", y)})*${S.s("wdvRate")}`, v: depW });
      S.fill("wdvClose", y, { f: `${S.at("wdvOpen", y)}+${S.at("wdvAdd", y)}-${S.at("taxDepWdv", y)}`, v: block });
      S.fill("taxDep", y, { f: `IF(${S.s("taxMethod")}="wdv",${S.at("taxDepWdv", y)},${S.at("taxDepSlm", y)})`, v: wdv ? depW : S.v("taxDepSlm", y), bold: true });
    }
    S.total("taxDepWdv");
    S.total("taxDep");
  }

  // ---- the tax pools' layout on the Tax schedule sheet (filled once the model's rows exist): the
  // losses and the disallowed interest by year of origin, so that each lapses on time
  const TL = taxLayout(N);
  const taxRef = (row, y) => `'${TAX_SHEET}'!${S.col(y)}${row}`;

  // ---- debt
  S.section("Debt");
  S.group("The year's terms");
  S.series("openDebt", "Opening debt", "₹ cr", { v: () => null });
  S.series("rateY", "Interest rate of the year", "%", { v: () => null, fmt: "pct", note: "The refinanced rate from the year after the refinancing; the stepped-down rate from the year after the step-down" });
  S.series("endY", "Last year of the debt", "year", { v: () => null, fmt: "int" });
  S.series("methodY", "Repayment method of the year", "", { v: () => null, fmt: "text", note: "The method after the refinancing when one is set" });
  S.series("adjY", "Interest saved by instalments within the year", "× the year's principal", { v: () => null, fmt: "factor" });
  S.series("intOpen", "Interest on the opening balance", "₹ cr", { v: () => null });
  S.series("balloonBase", "Balance the balloon share applies to", "₹ cr", { v: () => null, note: "The debt, or the balance refinanced, or the balance after a top-up" });
  S.series("balloonAmt", "Amount kept for the last year (balloon, bullet)", "₹ cr", { v: () => null });
  S.group("Mezzanine (ranks below the senior debt)");
  S.series("mezzOpen", "Mezzanine, opening", "₹ cr", { v: () => null });
  S.series("mezzInt", "Mezzanine interest", "₹ cr", { v: () => null, total: true });
  S.series("mezzPrin", "Mezzanine principal", "₹ cr", { v: () => null, total: true, note: "Equal parts over the years left after the moratorium, or a bullet in the last year; whatever is left clears with the project" });
  S.series("mezzClose", "Mezzanine, closing", "₹ cr", { v: () => null });
  S.series("mezzService", "Mezzanine service", "₹ cr", { v: () => null, total: true });
  S.group("Tax pools brought forward (from the Tax schedule sheet: the losses and the disallowed interest by year of origin)");
  S.series("lossBf", "Business losses available", "₹ cr", { v: () => null, note: "Those not lapsed (Tax schedule)" });
  S.series("depBf", "Unabsorbed depreciation available", "₹ cr", { v: () => null, note: "Never lapses" });
  S.series("intBf", "Disallowed interest available", "₹ cr", { v: () => null, note: `Carried ${INT_LAPSE_YEARS} years (Tax schedule)` });
  S.series("allowedShA", "Deductible quasi-equity and mezzanine interest, before the quasi-equity's (sculpting and the pre-sweep tax)", "₹ cr", { v: () => null, note: "The mezzanine interest plus the pool, capped at the thin-capitalisation share of EBITDA and other income when set" });
  S.group("Sculpting: the cash flow after tax with the interest on the opening balance");
  S.series("preTaxS", "Taxable profit before losses (sculpting)", "₹ cr", { v: () => null });
  S.series("lossUsedS", "Losses set off (sculpting)", "₹ cr", { v: () => null });
  S.series("depUsedS", "Depreciation set off (sculpting)", "₹ cr", { v: () => null });
  S.series("taxableS", "Taxable income (sculpting)", "₹ cr", { v: () => null });
  S.series("taxS", "Tax (sculpting)", "₹ cr", { v: () => null });
  S.series("cfadsS", "Cash flow for debt service (sculpting)", "₹ cr", { v: () => null, note: "EBITDA − tax − working capital − capital spend in operation − interest on working capital + other income − guarantee fees, the tax on the interest on the opening balance" });
  S.group("Repayment");
  S.series("principal", "Principal", "₹ cr", { v: () => null, total: true, note: "Under the repayment method, after the moratorium, until the last year of the debt (which clears it)" });
  S.series("debtAfterP", "Balance after the scheduled principal", "₹ cr", { v: () => null });
  S.series("interest", "Interest", "₹ cr", { v: () => null, total: true, note: "On the opening balance, less the instalment saving on the year's principal" });
  S.series("refiFeeCr", "Refinancing fee", "₹ cr", { v: () => null, total: true, note: "On the balance refinanced, in the refinancing year" });
  S.series("prepayRefi", "Prepayment fee on the refinancing takeout", "₹ cr", { v: () => null, total: true });
  S.group("The cash before the sweep, the mezzanine and the quasi-equity (the tax before the sweep's fee and the quasi-equity's interest)");
  S.series("pre1", "Taxable profit before losses (pre-sweep)", "₹ cr", { v: () => null });
  S.series("lossUsed1", "Losses set off (pre-sweep)", "₹ cr", { v: () => null });
  S.series("depUsed1", "Depreciation set off (pre-sweep)", "₹ cr", { v: () => null });
  S.series("taxable1", "Taxable income (pre-sweep)", "₹ cr", { v: () => null });
  S.series("tax1", "Tax (pre-sweep)", "₹ cr", { v: () => null });
  S.series("cfads1", "Cash flow for debt service (pre-sweep)", "₹ cr", { v: () => null });
  S.series("debtService", "Debt service", "₹ cr", { v: () => null, total: true, bold: true });
  S.series("fcfeBefore", "Free cash before the sweep, the mezzanine's principal and the quasi-equity", "₹ cr", { v: () => null, note: "CFADS (pre-sweep) − debt service − refinancing and prepayment fees − mezzanine service" });
  S.group("Cash sweep and top-up");
  S.series("sweepDue", "Sweep due (the share of the free cash plus what accrued)", "₹ cr", { v: () => null });
  S.series("sweep", "Cash sweep (principal prepaid)", "₹ cr", { v: () => null, total: true, note: "Paid up to the cash available and the balance; the rest accrues" });
  S.series("sweepAccr", "Sweep accrued", "₹ cr", { v: () => null });
  S.series("prepaySweep", "Prepayment fee on the sweep", "₹ cr", { v: () => null, total: true });
  S.series("prepayFee", "Prepayment fee", "₹ cr", { v: () => null, total: true, note: "On the refinancing takeout and the sweep; expensed" });
  S.series("debtAfterSweep", "Balance after the sweep", "₹ cr", { v: () => null });
  S.series("topUp", "Top-up debt drawn (paid to equity)", "₹ cr", { v: () => null, total: true, note: "At the end of the top-up year: up to the fraction of the project cost, less the balance" });
  S.series("closeDebt", "Closing debt", "₹ cr", { v: () => null, bold: true });
  S.group("Quasi-equity (paid when the senior DSCR clears the lender's floor)");
  S.series("quasiOpen", "Quasi-equity, opening", "₹ cr", { v: () => null });
  S.series("dscr1", "Senior DSCR for the quasi-equity test (pre-sweep CFADS ÷ debt service)", "×", { v: () => null, fmt: "x" });
  S.series("terminal", "Salvage and working capital released (final year)", "₹ cr", { v: () => null, total: true });
  S.series("quasiDue", "Quasi-equity interest due (with the accrued)", "₹ cr", { v: () => null });
  S.series("quasiCash", "Cash available for the quasi-equity", "₹ cr", { v: () => null, note: "The free cash before the sweep, less the sweep and the prepayment fee (the final year: plus the realisation less the debt)" });
  S.series("quasiOk", "Lender's floor cleared", "1 / 0", { v: () => null, fmt: "int" });
  S.series("quasiInt", "Quasi-equity interest paid", "₹ cr", { v: () => null, total: true });
  S.series("quasiRepay", "Quasi-equity repaid", "₹ cr", { v: () => null, total: true });
  S.series("quasiAccr", "Quasi-equity interest accrued", "₹ cr", { v: () => null });
  S.series("quasiClose", "Quasi-equity, closing", "₹ cr", { v: () => null });

  // ---- profit and loss (the tax with every deduction of the year)
  S.section("Profit and loss");
  const link = (key, from, text) => S.series(key, text, "₹ cr", { f: (y) => S.at(from, y), v: (y) => S.v(from, y), total: true });
  link("plEbitda", "ebitda", "EBITDA");
  S.series("plOtherIncome", "Add: other income (reserve and margin interest)", "₹ cr", { v: () => null, total: true });
  link("plBookDep", "bookDep", "Less: book depreciation");
  link("plInterest", "interest", "Less: interest on the senior debt");
  link("plWcInt", "wcInt", "Less: interest on working capital");
  link("plRefiFee", "refiFeeCr", "Less: refinancing fee");
  S.series("plPrepay", "Less: prepayment fee", "₹ cr", { v: () => null, total: true });
  link("plBgFees", "bgFees", "Less: guarantee fees");
  S.series("plMezzInt", "Less: mezzanine interest", "₹ cr", { v: () => null, total: true });
  S.series("plQuasiInt", "Less: quasi-equity interest paid", "₹ cr", { v: () => null, total: true });
  S.series("pbt", "Profit before tax", "₹ cr", { v: () => null, total: true, bold: true });
  S.group("Tax computation (thin capitalisation, losses and depreciation carried)");
  S.series("shInt", "Interest on the mezzanine and the quasi-equity (paid)", "₹ cr", { v: () => null });
  S.series("allowedSh", "Deductible of it, with the disallowed interest brought forward", "₹ cr", { v: () => null, note: "Capped at the thin-capitalisation share of EBITDA and other income when set" });
  S.series("intUsed", "Disallowed interest brought forward, deducted", "₹ cr", { v: () => null });
  S.series("intDisallowed", "This year's interest disallowed", "₹ cr", { v: () => null, total: true });
  S.series("intCf", "Disallowed interest carried forward", "₹ cr", { v: () => null, note: "From the Tax schedule (lapses after eight years)" });
  S.series("preTaxable", "Taxable profit before losses brought forward", "₹ cr", { v: () => null, note: "EBITDA + other income − interest (senior, working capital, deductible quasi-equity and mezzanine) − fees − tax depreciation" });
  S.series("lossUsed", "Business losses set off", "₹ cr", { v: () => null, total: true });
  S.series("depUsed", "Unabsorbed depreciation set off", "₹ cr", { v: () => null, total: true });
  S.series("taxable", "Taxable income", "₹ cr", { v: () => null, total: true });
  S.series("depAdd", "Unabsorbed depreciation of the year", "₹ cr", { v: () => null, note: "A loss is depreciation first, business loss after" });
  S.series("lossAdd", "Business loss of the year", "₹ cr", { v: () => null });
  S.series("lossCf", "Business losses carried forward", "₹ cr", { v: () => null, note: "From the Tax schedule (those not lapsed)" });
  S.series("depCf", "Unabsorbed depreciation carried forward", "₹ cr", { v: () => null });
  S.series("tax", "Tax", "₹ cr", { v: () => null, total: true });
  S.series("pat", "Profit after tax", "₹ cr", { v: () => null, total: true, bold: true });

  // ---- the year-by-year loop: the debt, the mezzanine, the sweep, the top-up, the quasi-equity and the tax
  const pools = { lossAv: [], lossUse: [], lossBal: [], intAv: [], intUse: [], intBal: [] }; // [i][y] by year of origin i
  for (const k of Object.keys(pools)) for (let i = 0; i <= N; i += 1) pools[k][i] = new Array(N + 1).fill(0);
  const thin = S.v("thinCap");
  const otherIncomeV = (y) => nz(engRow(y).dsraInterest) + S.v("marginInt", y);
  {
    let open = debt0;
    let balloonBase = debt0;
    let mezzBal = mezz0;
    let quasiBal = quasi0;
    let quasiAccrued = 0;
    let sweepAccrued = 0;
    let depPool = 0;
    const repay = S.v("repay");
    const refiRepay = S.v("refiRepay");
    const crfOf = (r, n) => (r <= 0 ? 1 / n : (r * (1 + r) ** n) / ((1 + r) ** n - 1));
    const principalOf = (method, o, n, rate, intOpen, { balloon, cfads }) => {
      if (!(o > 1e-9) || n < 1) return 0;
      if (n === 1) return o;
      switch (method) {
        case "annuity": return Math.min(o, o * crfOf(rate, n) - intOpen);
        case "sculpted": return Math.min(o, Math.max(0, cfads / S.v("targetDscr") - intOpen));
        case "balloon": case "bullet": return Math.min(o, Math.max(0, (o - balloon) / (n - 1)));
        case "stepUp": return Math.min(o, S.v("stepUp") > 0 ? (o * S.v("stepUp")) / ((1 + S.v("stepUp")) ** n - 1) : o / n);
        default: return o / n;
      }
    };
    for (let y = 1; y <= N; y += 1) {
      const Y = S.yr(y);
      const income = S.v("ebitda", y) + otherIncomeV(y);
      const wcInt = S.v("wcInt", y);
      const taxDep = S.v("taxDep", y);
      const bgFeesY = S.v("bgFees", y);
      // the pools brought forward: the vintages not lapsed
      let lossAvail = 0;
      let intAvail = 0;
      for (let i = 1; i < y; i += 1) {
        pools.lossAv[i][y] = lossLimit && y - i > lossLimit ? 0 : pools.lossBal[i][y - 1];
        pools.intAv[i][y] = y - i > INT_LAPSE_YEARS ? 0 : pools.intBal[i][y - 1];
        lossAvail += pools.lossAv[i][y];
        intAvail += pools.intAv[i][y];
      }
      const depAvail = depPool;
      // the senior debt's terms this year
      const phase2 = refiOn && y > S.v("refiYear");
      const stepped = S.v("stepAfter") > 0 && y > S.v("stepAfter");
      const rate = phase2 ? S.v("refiRate") : stepped ? S.v("stepRateU") : rt;
      const end = phase2 ? refiEnd : tenorUsed;
      const methodY = phase2 && refiRepay !== "same" ? refiRepay : repay;
      const adj = methodY === "sculpted" ? 0 : (q - 1) / (2 * q);
      const n = end - y + 1;
      const intOpen = open * rate;
      const balloonAmt = balloonBase * balloonShare;
      const repaying = y > graceUsed && y <= end && open > 1e-9;
      // the mezzanine
      const mezzOpen = mezzBal;
      const mezzInt = mezzOpen * (mezz0 > 0 ? S.v("mezzRate") : 0);
      let mezzPrin = 0;
      if (mezz0 > 0 && mezzOpen > 1e-9 && y > mezzGraceU && y <= mezzTenorU) mezzPrin = S.v("mezzRepay") === "bullet" ? (y === mezzTenorU ? mezzOpen : 0) : mezzOpen / (mezzTenorU - y + 1);
      if (mezz0 > 0 && y === N) mezzPrin = mezzOpen;
      mezzBal = mezzOpen - mezzPrin;
      const mezzService = mezzInt + mezzPrin;
      // the deductible subordinated interest before the quasi-equity's (sculpting and the pre-sweep tax)
      const allowedShA = thin > 0 ? Math.min(mezzInt + intAvail, thin * Math.max(0, income)) : mezzInt + intAvail;
      const setOff = (pre) => {
        const lossUsed = pre > 0 ? Math.min(lossAvail, pre) : 0;
        const depUsed = pre > 0 ? Math.min(depAvail, pre - lossUsed) : 0;
        return { lossUsed, depUsed, taxable: Math.max(0, pre - lossUsed - depUsed) };
      };
      // sculpting: the tax on the interest on the opening balance
      const preS = income - intOpen - wcInt - bgFeesY - allowedShA - taxDep;
      const sS = setOff(preS);
      const taxS = sS.taxable * S.v("taxRate");
      const cfadsS = S.v("ebitda", y) - taxS - S.v("dWc", y) - S.v("aug", y) - wcInt + otherIncomeV(y) - bgFeesY - S.v("extCapex", y) - S.v("repower", y);
      const principal = repaying ? principalOf(methodY, open, n, rate, intOpen, { balloon: balloonAmt, cfads: cfadsS }) : 0;
      const debtAfterP = open - principal;
      const interest = intOpen - adj * principal;
      const refiNow = refiOn && y === S.v("refiYear");
      const refiFeeCr = refiNow ? debtAfterP * S.v("refiFee") : 0;
      const prepayRefi = refiNow ? debtAfterP * S.v("prepayPct") : 0;
      // the tax before the sweep's fee and the quasi-equity's interest
      const pre1 = income - interest - wcInt - (refiFeeCr + prepayRefi + bgFeesY) - allowedShA - taxDep;
      const s1 = setOff(pre1);
      const tax1 = s1.taxable * S.v("taxRate");
      const cfadsOf = (tax) => S.v("ebitda", y) - tax - S.v("dWc", y) - S.v("aug", y) - wcInt + otherIncomeV(y) - bgFeesY - S.v("extCapex", y) - S.v("repower", y);
      const cfads1 = cfadsOf(tax1);
      const debtService = interest + principal;
      const fcfeBefore = cfads1 - debtService - refiFeeCr - prepayRefi - mezzService;
      // the cash sweep
      const sweepPct = S.v("sweepPct");
      const inRange = y >= S.v("sweepFrom") && y <= sweepToU;
      const sweepOn = sweepPct > 0 && inRange && debtAfterP > 1e-9;
      const sweepDue = sweepOn ? sweepPct * Math.max(0, fcfeBefore) + sweepAccrued : 0;
      const sweep = sweepOn ? Math.min(sweepDue, Math.max(0, fcfeBefore), debtAfterP) : 0;
      sweepAccrued = sweepPct > 0 ? (debtAfterP <= 1e-9 ? 0 : sweepOn ? sweepDue - sweep : sweepAccrued) : 0;
      const prepaySweep = sweep * S.v("prepayPct");
      const prepayFee = prepayRefi + prepaySweep;
      const debtAfterSweep = debtAfterP - sweep;
      // the top-up
      const topUpNow = S.v("topUpYear") > 0 && S.v("topUpYear") < tenorUsed && y === S.v("topUpYear");
      const topUp = topUpNow ? Math.max(0, S.v("topUpFracU") * total - debtAfterSweep) : 0;
      const closeDebt = debtAfterSweep + topUp;
      // the quasi-equity
      const quasiOpen = quasiBal;
      const dscr1 = debtService > 1e-9 ? cfads1 / debtService : "";
      const terminal = y === N ? total * S.v("salvage") + S.v("wcBal", y) : 0;
      const quasiDue = quasi0 > 0 ? quasiOpen * S.v("quasiRate") + quasiAccrued : 0;
      const quasiCash = fcfeBefore - sweep - prepayFee + (y === N ? terminal - closeDebt : 0);
      const quasiOk = dscr1 === "" || dscr1 >= S.v("quasiMinDscr") ? 1 : 0;
      const quasiInt = quasi0 > 0 && quasiOk ? Math.min(quasiDue, Math.max(0, quasiCash)) : 0;
      const quasiRepay = quasi0 > 0 && quasiOk && y >= S.v("quasiFrom") ? Math.min(quasiOpen, Math.max(0, quasiCash - quasiInt)) : 0;
      quasiAccrued = quasi0 > 0 ? quasiDue - quasiInt : 0;
      quasiBal = quasiOpen - quasiRepay;
      // the tax with every deduction of the year; the pools by vintage (oldest first)
      const shInt = mezzInt + quasiInt;
      const allowedSh = thin > 0 ? Math.min(shInt + intAvail, thin * Math.max(0, income)) : shInt + intAvail;
      let left = allowedSh;
      for (let i = 1; i < y; i += 1) { pools.intUse[i][y] = Math.min(pools.intAv[i][y], left); left -= pools.intUse[i][y]; pools.intBal[i][y] = pools.intAv[i][y] - pools.intUse[i][y]; }
      const intUsed = Math.min(intAvail, allowedSh);
      const intDisallowed = Math.max(0, shInt - (allowedSh - intUsed));
      pools.intBal[y][y] = intDisallowed;
      const preTaxable = income - interest - wcInt - (refiFeeCr + prepayFee + bgFeesY) - allowedSh - taxDep;
      const sF = setOff(preTaxable);
      let remain = preTaxable > 0 ? preTaxable : 0;
      for (let i = 1; i < y; i += 1) { pools.lossUse[i][y] = Math.min(pools.lossAv[i][y], Math.max(0, remain)); remain -= pools.lossUse[i][y]; pools.lossBal[i][y] = pools.lossAv[i][y] - pools.lossUse[i][y]; }
      const depAdd = preTaxable < 0 ? Math.min(taxDep, -preTaxable) : 0;
      const lossAdd = preTaxable < 0 ? -preTaxable - depAdd : 0;
      pools.lossBal[y][y] = lossAdd;
      depPool = depAvail - sF.depUsed + depAdd;
      const lossCf = sumOf(pools.lossBal.map((row) => row[y]));
      const intCf = sumOf(pools.intBal.map((row) => row[y]));
      const tax = sF.taxable * S.v("taxRate");
      const pbt = S.v("ebitda", y) + otherIncomeV(y) - S.v("bookDep", y) - interest - wcInt - refiFeeCr - prepayFee - bgFeesY - mezzInt - quasiInt;
      const pat = pbt - tax;

      // ---- the formulas
      const O = S.at("openDebt", y);
      const R = S.at("rateY", y);
      const NL = `(${S.at("endY", y)}-${Y}+1)`;
      const IO = S.at("intOpen", y);
      const M = S.at("methodY", y);
      const method = `IF(${NL}<=1,${O},`
        + `IF(${M}="annuity",MIN(${O},IF(${R}<=0,${O}/${NL},${O}*${R}*(1+${R})^${NL}/((1+${R})^${NL}-1))-${IO}),`
        + `IF(${M}="sculpted",MIN(${O},MAX(0,${S.at("cfadsS", y)}/${S.s("targetDscr")}-${IO})),`
        + `IF(OR(${M}="balloon",${M}="bullet"),MIN(${O},MAX(0,(${O}-${S.at("balloonAmt", y)})/(${NL}-1))),`
        + `IF(${M}="stepUp",MIN(${O},IF(${S.s("stepUp")}>0,${O}*${S.s("stepUp")}/((1+${S.s("stepUp")})^${NL}-1),${O}/${NL})),`
        + `${O}/${NL})))))`;
      const phase2F = `AND(${S.s("refiOn")}=1,${Y}>${S.s("refiYear")})`;
      const refiNowF = `AND(${S.s("refiOn")}=1,${Y}=${S.s("refiYear")})`;
      const ebitdaA = S.at("ebitda", y);
      const incomeF = `(${ebitdaA}+${S.at("otherIncome", y)})`;
      const cfadsF = (taxA) => `${ebitdaA}-${taxA}-${S.at("dWc", y)}-${S.at("aug", y)}-${S.at("wcInt", y)}+${S.at("otherIncome", y)}-${S.at("bgFees", y)}-${S.at("extCapex", y)}-${S.at("repower", y)}`;
      const setOffF = (preA, lossKey, depKey) => ({
        loss: `IF(${preA}>0,MIN(${S.at("lossBf", y)},${preA}),0)`,
        dep: `IF(${preA}>0,MIN(${S.at("depBf", y)},${preA}-${S.at(lossKey, y)}),0)`,
        taxable: `MAX(0,${preA}-${S.at(lossKey, y)}-${S.at(depKey, y)})`,
      });
      const allowedF = (shIntA) => `IF(${S.s("thinCap")}>0,MIN(${shIntA}+${S.at("intBf", y)},${S.s("thinCap")}*MAX(0,${incomeF})),${shIntA}+${S.at("intBf", y)})`;
      const sS2 = setOffF(S.at("preTaxS", y), "lossUsedS", "depUsedS");
      const s12 = setOffF(S.at("pre1", y), "lossUsed1", "depUsed1");
      const sF2 = setOffF(S.at("preTaxable", y), "lossUsed", "depUsed");
      const sweepOnF = `AND(${S.s("sweepPct")}>0,${Y}>=${S.s("sweepFrom")},${Y}<=${S.s("sweepToU")},${S.at("debtAfterP", y)}>1E-9)`;
      const fs = {
        openDebt: y === 1 ? S.s("debt") : S.at("closeDebt", y - 1),
        rateY: `IF(${phase2F},${S.s("refiRate")},IF(AND(${S.s("stepAfter")}>0,${Y}>${S.s("stepAfter")}),${S.s("stepRateU")},${S.s("rate")}))`,
        endY: `IF(${phase2F},${S.s("refiEnd")},${S.s("tenorUsed")})`,
        methodY: `IF(AND(${phase2F},${S.s("refiRepay")}<>"same"),${S.s("refiRepay")},${S.s("repay")})`,
        adjY: `IF(${M}="sculpted",0,${S.s("adjBase")})`,
        intOpen: `${O}*${R}`,
        balloonBase: y === 1 ? S.s("debt") : `IF(AND(${S.s("topUpYear")}>0,${S.s("topUpYear")}<${S.s("tenorUsed")},${Y}=${S.s("topUpYear")}+1),${S.at("closeDebt", y - 1)},IF(AND(${S.s("refiOn")}=1,${Y}=${S.s("refiYear")}+1),${S.at("debtAfterP", y - 1)},${S.at("balloonBase", y - 1)}))`,
        balloonAmt: `${S.at("balloonBase", y)}*${S.s("balloonShare")}`,
        mezzOpen: y === 1 ? S.s("mezz0") : S.at("mezzClose", y - 1),
        mezzInt: `${S.at("mezzOpen", y)}*IF(${S.s("mezz0")}>0,${S.s("mezzRate")},0)`,
        mezzPrin: `IF(${S.s("mezz0")}>0,IF(${Y}=${S.s("years")},${S.at("mezzOpen", y)},IF(AND(${S.at("mezzOpen", y)}>1E-9,${Y}>${S.s("mezzGraceU")},${Y}<=${S.s("mezzTenorU")}),IF(${S.s("mezzRepay")}="bullet",IF(${Y}=${S.s("mezzTenorU")},${S.at("mezzOpen", y)},0),${S.at("mezzOpen", y)}/(${S.s("mezzTenorU")}-${Y}+1)),0)),0)`,
        mezzClose: `${S.at("mezzOpen", y)}-${S.at("mezzPrin", y)}`,
        mezzService: `${S.at("mezzInt", y)}+${S.at("mezzPrin", y)}`,
        lossBf: taxRef(TL.lossAv.total, y),
        depBf: y === 1 ? "0" : S.at("depCf", y - 1),
        intBf: taxRef(TL.intAv.total, y),
        allowedShA: allowedF(S.at("mezzInt", y)),
        preTaxS: `${incomeF}-${IO}-${S.at("wcInt", y)}-${S.at("bgFees", y)}-${S.at("allowedShA", y)}-${S.at("taxDep", y)}`,
        lossUsedS: sS2.loss, depUsedS: sS2.dep, taxableS: sS2.taxable,
        taxS: `${S.at("taxableS", y)}*${S.s("taxRate")}`,
        cfadsS: cfadsF(S.at("taxS", y)),
        principal: `IF(AND(${Y}>${S.s("graceUsed")},${Y}<=${S.at("endY", y)},${O}>1E-9),${method},0)`,
        debtAfterP: `${O}-${S.at("principal", y)}`,
        interest: `${IO}-${S.at("adjY", y)}*${S.at("principal", y)}`,
        refiFeeCr: `IF(${refiNowF},${S.at("debtAfterP", y)}*${S.s("refiFee")},0)`,
        prepayRefi: `IF(${refiNowF},${S.at("debtAfterP", y)}*${S.s("prepayPct")},0)`,
        pre1: `${incomeF}-${S.at("interest", y)}-${S.at("wcInt", y)}-(${S.at("refiFeeCr", y)}+${S.at("prepayRefi", y)}+${S.at("bgFees", y)})-${S.at("allowedShA", y)}-${S.at("taxDep", y)}`,
        lossUsed1: s12.loss, depUsed1: s12.dep, taxable1: s12.taxable,
        tax1: `${S.at("taxable1", y)}*${S.s("taxRate")}`,
        cfads1: cfadsF(S.at("tax1", y)),
        debtService: `${S.at("interest", y)}+${S.at("principal", y)}`,
        fcfeBefore: `${S.at("cfads1", y)}-${S.at("debtService", y)}-${S.at("refiFeeCr", y)}-${S.at("prepayRefi", y)}-${S.at("mezzService", y)}`,
        sweepDue: `IF(${sweepOnF},${S.s("sweepPct")}*MAX(0,${S.at("fcfeBefore", y)})+${y === 1 ? "0" : S.at("sweepAccr", y - 1)},0)`,
        sweep: `IF(${sweepOnF},MIN(${S.at("sweepDue", y)},MAX(0,${S.at("fcfeBefore", y)}),${S.at("debtAfterP", y)}),0)`,
        sweepAccr: `IF(${S.s("sweepPct")}>0,IF(${S.at("debtAfterP", y)}<=1E-9,0,IF(${sweepOnF},${S.at("sweepDue", y)}-${S.at("sweep", y)},${y === 1 ? "0" : S.at("sweepAccr", y - 1)})),0)`,
        prepaySweep: `${S.at("sweep", y)}*${S.s("prepayPct")}`,
        prepayFee: `${S.at("prepayRefi", y)}+${S.at("prepaySweep", y)}`,
        debtAfterSweep: `${S.at("debtAfterP", y)}-${S.at("sweep", y)}`,
        topUp: `IF(AND(${S.s("topUpYear")}>0,${S.s("topUpYear")}<${S.s("tenorUsed")},${Y}=${S.s("topUpYear")}),MAX(0,${S.s("topUpFracU")}*${S.s("total")}-${S.at("debtAfterSweep", y)}),0)`,
        closeDebt: `${S.at("debtAfterSweep", y)}+${S.at("topUp", y)}`,
        quasiOpen: y === 1 ? S.s("quasi0") : S.at("quasiClose", y - 1),
        dscr1: `IF(${S.at("debtService", y)}>1E-9,${S.at("cfads1", y)}/${S.at("debtService", y)},"")`,
        terminal: `IF(${Y}=${S.s("years")},${S.s("total")}*${S.s("salvage")}+${S.at("wcBal", y)},0)`,
        quasiDue: `IF(${S.s("quasi0")}>0,${S.at("quasiOpen", y)}*${S.s("quasiRate")}+${y === 1 ? "0" : S.at("quasiAccr", y - 1)},0)`,
        quasiCash: `${S.at("fcfeBefore", y)}-${S.at("sweep", y)}-${S.at("prepayFee", y)}+IF(${Y}=${S.s("years")},${S.at("terminal", y)}-${S.at("closeDebt", y)},0)`,
        quasiOk: `IF(OR(${S.at("dscr1", y)}="",N(${S.at("dscr1", y)})>=${S.s("quasiMinDscr")}),1,0)`,
        quasiInt: `IF(AND(${S.s("quasi0")}>0,${S.at("quasiOk", y)}=1),MIN(${S.at("quasiDue", y)},MAX(0,${S.at("quasiCash", y)})),0)`,
        quasiRepay: `IF(AND(${S.s("quasi0")}>0,${S.at("quasiOk", y)}=1,${Y}>=${S.s("quasiFrom")}),MIN(${S.at("quasiOpen", y)},MAX(0,${S.at("quasiCash", y)}-${S.at("quasiInt", y)})),0)`,
        quasiAccr: `IF(${S.s("quasi0")}>0,${S.at("quasiDue", y)}-${S.at("quasiInt", y)},0)`,
        quasiClose: `${S.at("quasiOpen", y)}-${S.at("quasiRepay", y)}`,
        plOtherIncome: S.at("otherIncome", y),
        plPrepay: S.at("prepayFee", y),
        plMezzInt: S.at("mezzInt", y),
        plQuasiInt: S.at("quasiInt", y),
        pbt: `${S.at("plEbitda", y)}+${S.at("plOtherIncome", y)}-${S.at("plBookDep", y)}-${S.at("plInterest", y)}-${S.at("plWcInt", y)}-${S.at("plRefiFee", y)}-${S.at("plPrepay", y)}-${S.at("plBgFees", y)}-${S.at("plMezzInt", y)}-${S.at("plQuasiInt", y)}`,
        shInt: `${S.at("mezzInt", y)}+${S.at("quasiInt", y)}`,
        allowedSh: allowedF(S.at("shInt", y)),
        intUsed: `MIN(${S.at("intBf", y)},${S.at("allowedSh", y)})`,
        intDisallowed: `MAX(0,${S.at("shInt", y)}-(${S.at("allowedSh", y)}-${S.at("intUsed", y)}))`,
        intCf: taxRef(TL.intBal.total, y),
        preTaxable: `${incomeF}-${S.at("interest", y)}-${S.at("wcInt", y)}-(${S.at("refiFeeCr", y)}+${S.at("prepayFee", y)}+${S.at("bgFees", y)})-${S.at("allowedSh", y)}-${S.at("taxDep", y)}`,
        lossUsed: sF2.loss, depUsed: sF2.dep, taxable: sF2.taxable,
        depAdd: `IF(${S.at("preTaxable", y)}<0,MIN(${S.at("taxDep", y)},-${S.at("preTaxable", y)}),0)`,
        lossAdd: `IF(${S.at("preTaxable", y)}<0,-${S.at("preTaxable", y)}-${S.at("depAdd", y)},0)`,
        lossCf: taxRef(TL.lossBal.total, y),
        depCf: `${S.at("depBf", y)}-${S.at("depUsed", y)}+${S.at("depAdd", y)}`,
        tax: `${S.at("taxable", y)}*${S.s("taxRate")}`,
        pat: `${S.at("pbt", y)}-${S.at("tax", y)}`,
      };
      const vals = {
        openDebt: open, rateY: rate, endY: end, methodY, adjY: adj, intOpen, balloonBase, balloonAmt,
        mezzOpen, mezzInt, mezzPrin, mezzClose: mezzBal, mezzService,
        lossBf: lossAvail, depBf: depAvail, intBf: intAvail, allowedShA,
        preTaxS: preS, lossUsedS: sS.lossUsed, depUsedS: sS.depUsed, taxableS: sS.taxable, taxS, cfadsS,
        principal, debtAfterP, interest, refiFeeCr, prepayRefi,
        pre1, lossUsed1: s1.lossUsed, depUsed1: s1.depUsed, taxable1: s1.taxable, tax1, cfads1, debtService, fcfeBefore,
        sweepDue, sweep, sweepAccr: sweepAccrued, prepaySweep, prepayFee, debtAfterSweep, topUp, closeDebt,
        quasiOpen, dscr1, terminal, quasiDue, quasiCash, quasiOk, quasiInt, quasiRepay, quasiAccr: quasiAccrued, quasiClose: quasiBal,
        plOtherIncome: otherIncomeV(y), plPrepay: prepayFee, plMezzInt: mezzInt, plQuasiInt: quasiInt, pbt,
        shInt, allowedSh, intUsed, intDisallowed, intCf, preTaxable, lossUsed: sF.lossUsed, depUsed: sF.depUsed, taxable: sF.taxable, depAdd, lossAdd, lossCf, depCf: depPool, tax, pat,
      };
      const fmts = { rateY: "pct", endY: "int", methodY: "text", adjY: "factor", dscr1: "x", quasiOk: "int" };
      for (const k of Object.keys(fs)) S.fill(k, y, { f: fs[k], v: vals[k], fmt: fmts[k] || "cr", bold: k === "debtService" || k === "pbt" || k === "pat" || k === "closeDebt" });
      open = closeDebt;
      if (topUpNow) balloonBase = closeDebt;
      else if (refiNow) balloonBase = debtAfterP;
    }
    for (const k of ["mezzInt", "mezzPrin", "mezzService", "principal", "interest", "refiFeeCr", "prepayRefi", "debtService", "sweep", "prepaySweep", "prepayFee", "topUp", "terminal", "quasiInt", "quasiRepay",
      "plOtherIncome", "plPrepay", "plMezzInt", "plQuasiInt", "pbt", "intDisallowed", "lossUsed", "depUsed", "taxable", "tax", "pat"]) S.total(k);
    // the profit and loss lines linked to rows the loop filled: their values and totals now
    for (const [k, from] of [["plInterest", "interest"], ["plRefiFee", "refiFeeCr"]]) {
      for (let y = 1; y <= N; y += 1) S.fill(k, y, { f: S.at(from, y), v: S.v(from, y) });
      S.total(k);
    }
  }

  // ---- cash flow
  S.section("Cash flow");
  S.series("cfads", "Cash flow available for debt service (CFADS)", "₹ cr", {
    f: (y) => `${S.at("ebitda", y)}-${S.at("tax", y)}-${S.at("dWc", y)}-${S.at("aug", y)}-${S.at("wcInt", y)}+${S.at("otherIncome", y)}-${S.at("bgFees", y)}-${S.at("extCapex", y)}-${S.at("repower", y)}`,
    v: (y) => S.v("ebitda", y) - S.v("tax", y) - S.v("dWc", y) - S.v("aug", y) - S.v("wcInt", y) + otherIncomeV(y) - S.v("bgFees", y) - S.v("extCapex", y) - S.v("repower", y), total: true, bold: true,
    note: "EBITDA − tax − working capital − capital spend in operation − interest on working capital + other income − guarantee fees",
  });
  S.series("dscr", "DSCR", "×", {
    f: (y) => `IF(${S.at("debtService", y)}>1E-9,${S.at("cfads", y)}/${S.at("debtService", y)},"")`,
    v: (y) => (S.v("debtService", y) > 1e-9 ? S.v("cfads", y) / S.v("debtService", y) : ""), fmt: "x",
  });
  S.series("fscr", "FSCR (fixed charges cover: CFADS and fixed costs over debt service and fixed costs)", "×", {
    f: (y) => `IF(${S.at("debtService", y)}>1E-9,(${S.at("cfads", y)}+${S.at("otherCr", y)}+${S.at("bgFees", y)})/(${S.at("debtService", y)}+${S.at("otherCr", y)}+${S.at("bgFees", y)}),"")`,
    v: (y) => (S.v("debtService", y) > 1e-9 ? (S.v("cfads", y) + S.v("otherCr", y) + S.v("bgFees", y)) / (S.v("debtService", y) + S.v("otherCr", y) + S.v("bgFees", y)) : ""), fmt: "x",
  });
  S.series("totalDscr", "DSCR including the mezzanine", "×", {
    f: (y) => `IF(${S.at("debtService", y)}+${S.at("mezzService", y)}>1E-9,${S.at("cfads", y)}/(${S.at("debtService", y)}+${S.at("mezzService", y)}),"")`,
    v: (y) => (S.v("debtService", y) + S.v("mezzService", y) > 1e-9 ? S.v("cfads", y) / (S.v("debtService", y) + S.v("mezzService", y)) : ""), fmt: "x",
  });
  const dsraV = (y) => {
    if (y >= N) return 0;
    if (S.v("dsraBasis") === "peak") return (Math.max(...S.val.debtService.slice(y + 1, N + 1)) * S.v("dsraMonths")) / 12;
    return (S.v("debtService", y + 1) * S.v("dsraMonths")) / 12;
  };
  S.series("dsra", "Debt service reserve held", "₹ cr", {
    f: (y) => (y < N ? `${S.s("dsraMonths")}/12*IF(${S.s("dsraBasis")}="peak",MAX(${S.col(y + 1)}${S.cell.debtService}:${S.last}${S.cell.debtService}),${S.at("debtService", y + 1)})` : "0"),
    v: dsraV, note: "Months of the next year's debt service, or of the highest year left (peak); nothing after the last year",
  });
  S.series("dDsra", "Put into (released from) the reserve", "₹ cr", {
    f: (y) => (y === 1 ? S.at("dsra", 1) : `${S.at("dsra", y)}-${S.at("dsra", y - 1)}`),
    v: (y) => (y === 1 ? S.v("dsra", 1) : S.v("dsra", y) - S.v("dsra", y - 1)), total: true,
  });
  // the reserve's interest and the other income, now that the reserve is known (declared above the debt)
  for (let y = 1; y <= N; y += 1) {
    const dsraInt = nz(engRow(y).dsraInterest);
    if (dsraIntByValue) S.fill("dsraInt", y, { f: null, v: dsraInt, kind: "app" });
    else S.fill("dsraInt", y, { f: y === 1 ? "0" : `${S.at("dsra", y - 1)}*${S.s("dsraRate")}`, v: dsraInt });
    S.fill("otherIncome", y, { f: `${S.at("dsraInt", y)}+${S.at("marginInt", y)}`, v: otherIncomeV(y) });
  }
  S.total("dsraInt");
  S.total("otherIncome");
  S.series("debtEnd", "Debt still owed, repaid in the final year", "₹ cr", {
    f: (y) => `IF(${S.yr(y)}=${S.s("years")},${S.at("closeDebt", y)},0)`, v: (y) => (y === N ? S.v("closeDebt", y) : 0), total: true,
  });
  S.series("fcfe", "Equity cash flow (year 0: the equity put in)", "₹ cr", {
    y0: { f: `-${S.s("equity")}`, v: -equity0 },
    f: (y) => `${S.at("cfads", y)}-${S.at("debtService", y)}-${S.at("refiFeeCr", y)}-${S.at("prepayFee", y)}-${S.at("sweep", y)}-${S.at("mezzService", y)}-${S.at("quasiInt", y)}-${S.at("quasiRepay", y)}+${S.at("topUp", y)}-${S.at("dMargin", y)}-${S.at("dDsra", y)}+${S.at("terminal", y)}-${S.at("debtEnd", y)}`,
    v: (y) => S.v("cfads", y) - S.v("debtService", y) - S.v("refiFeeCr", y) - S.v("prepayFee", y) - S.v("sweep", y) - S.v("mezzService", y) - S.v("quasiInt", y) - S.v("quasiRepay", y) + S.v("topUp", y) - S.v("dMargin", y) - S.v("dDsra", y) + S.v("terminal", y) - S.v("debtEnd", y), total: true, bold: true,
    note: "CFADS − debt service − fees − sweep − mezzanine service − quasi-equity interest and repayment + top-up − margin money and reserve put aside + salvage and working capital released − debt still owed",
  });
  S.series("dividends", "Paid out to equity (the free cash)", "₹ cr", { f: (y) => S.at("fcfe", y), v: (y) => S.v("fcfe", y), total: true });
  S.series("cumEq", "Cumulative equity cash", "₹ cr", {
    y0: { f: S.at("fcfe", 0), v: -equity0 },
    f: (y) => `${S.at("cumEq", y - 1)}+${S.at("fcfe", y)}`,
    v: (y) => S.v("cumEq", y - 1) + S.v("fcfe", y),
  });
  S.series("paybackFlag", "Equity paid back by this year", "year", {
    f: (y) => `IF(${S.at("cumEq", y)}>=0,${S.yr(y)},"")`,
    v: (y) => (S.v("cumEq", y) >= 0 ? y : ""), fmt: "int", note: "The payback year is the first year marked here",
  });
  S.series("projTax", "Tax on the unlevered project", "₹ cr", {
    f: (y) => `MAX(0,(${S.at("ebitda", y)}-${S.at("taxDep", y)})*${S.s("taxRate")})`,
    v: (y) => Math.max(0, (S.v("ebitda", y) - S.v("taxDep", y)) * S.v("taxRate")), total: true,
    note: "The project IRR's tax: no interest shield, no losses carried",
  });
  S.series("projCf", "Project cash flow (year 0: the project cost)", "₹ cr", {
    y0: { f: `-${S.s("total")}`, v: -total },
    f: (y) => `${S.at("ebitda", y)}-${S.at("projTax", y)}-${S.at("dWc", y)}-${S.at("aug", y)}-${S.at("extCapex", y)}-${S.at("repower", y)}+${S.at("otherIncome", y)}-${S.at("bgFees", y)}+${S.at("terminal", y)}`,
    v: (y) => S.v("ebitda", y) - S.v("projTax", y) - S.v("dWc", y) - S.v("aug", y) - S.v("extCapex", y) - S.v("repower", y) + otherIncomeV(y) - S.v("bgFees", y) + S.v("terminal", y), total: true, bold: true,
  });
  S.series("preTaxEq", "Equity cash flow before tax", "₹ cr", { y0: { f: S.at("fcfe", 0), v: -equity0 }, f: (y) => `${S.at("fcfe", y)}+${S.at("tax", y)}`, v: (y) => S.v("fcfe", y) + S.v("tax", y), total: true });
  S.series("preTaxProj", "Project cash flow before tax", "₹ cr", { y0: { f: S.at("projCf", 0), v: -total }, f: (y) => `${S.at("projCf", y)}+${S.at("projTax", y)}`, v: (y) => S.v("projCf", y) + S.v("projTax", y), total: true });
  S.series("holdcoCf", "Holding company cash flow (year 0: the equity and the quasi-equity put in)", "₹ cr", {
    y0: { f: `-(${S.s("equity")}+${S.s("quasi0")})`, v: -(equity0 + quasi0) },
    f: (y) => `${S.at("fcfe", y)}+${S.at("quasiInt", y)}+${S.at("quasiRepay", y)}-${S.s("holdcoExp")}`,
    v: (y) => S.v("fcfe", y) + S.v("quasiInt", y) + S.v("quasiRepay", y) - S.v("holdcoExp"), total: true,
    note: "The dividends plus the quasi-equity's interest and repayments, less the holding company's expenses",
  });
  const promoterShare = Math.min(1, Math.max(0, S.v("promoterShare")));
  S.series("promoterCf", "Promoter cash flow", "₹ cr", {
    y0: { f: `${S.at("holdcoCf", 0)}*MIN(1,MAX(0,${S.s("promoterShare")}))`, v: -(equity0 + quasi0) * promoterShare },
    f: (y) => `${S.at("holdcoCf", y)}*MIN(1,MAX(0,${S.s("promoterShare")}))`, v: (y) => S.v("holdcoCf", y) * promoterShare, total: true,
  });
  S.series("lenderCf", "Lender's cash flow (year 0: the debt out)", "₹ cr", {
    y0: { f: `-${S.s("debt")}`, v: -debt0 },
    f: (y) => `${S.at("debtService", y)}+${S.at("sweep", y)}+${S.at("refiFeeCr", y)}+${S.at("prepayFee", y)}-${S.at("topUp", y)}`,
    v: (y) => S.v("debtService", y) + S.v("sweep", y) + S.v("refiFeeCr", y) + S.v("prepayFee", y) - S.v("topUp", y), total: true,
    note: "Debt service, sweep and fees back; a top-up is new debt out",
  });
  S.series("llcr", "Loan life cover ratio (PV of CFADS to the last year of the debt ÷ opening debt)", "×", {
    f: (y) => `IF(${S.at("openDebt", y)}>1E-9,IF(${S.yr(y)}<=${S.at("endY", y)},NPV(${S.at("rateY", y)},${S.col(y)}${S.cell.cfads}:INDEX(${S.span("cfads")},1,${S.at("endY", y)}))/${S.at("openDebt", y)},0),"")`,
    v: (y) => {
      if (!(S.v("openDebt", y) > 1e-9)) return "";
      const end = S.v("endY", y);
      let pv = 0;
      for (let k = y; k <= Math.min(end, N); k += 1) pv += S.v("cfads", k) / (1 + S.v("rateY", y)) ** (k - y + 1);
      return pv / S.v("openDebt", y);
    }, fmt: "x",
  });
  S.series("plcr", "Project life cover ratio (PV of CFADS to the end ÷ opening debt)", "×", {
    f: (y) => `IF(${S.at("openDebt", y)}>1E-9,NPV(${S.at("rateY", y)},${S.span("cfads", y)})/${S.at("openDebt", y)},"")`,
    v: (y) => {
      if (!(S.v("openDebt", y) > 1e-9)) return "";
      let pv = 0;
      for (let k = y; k <= N; k += 1) pv += S.v("cfads", k) / (1 + S.v("rateY", y)) ** (k - y + 1);
      return pv / S.v("openDebt", y);
    }, fmt: "x",
  });
  S.group("Balance sheet lines");
  S.series("retained", "Retained earnings", "₹ cr", {
    y0: { f: "0", v: 0 }, f: (y) => `${S.at("retained", y - 1)}+${S.at("pat", y)}-${S.at("fcfe", y)}`, v: (y) => S.v("retained", y - 1) + S.v("pat", y) - S.v("fcfe", y),
    note: "Profit after tax less what is paid out (the free cash)",
  });
  S.series("cash", "Cash (the balancing figure)", "₹ cr", {
    y0: { f: "0", v: 0 },
    f: (y) => `(${S.s("equity")}+${S.at("retained", y)}+${S.at("closeDebt", y)}+${S.at("mezzClose", y)}+${S.at("quasiClose", y)}+${S.at("quasiAccr", y)}+${S.at("sweepAccr", y)})-(${S.at("netBlock", y)}+${S.at("wcBal", y)}+${S.at("dsra", y)}+${S.at("marginBal", y)})`,
    v: (y) => (equity0 + S.v("retained", y) + S.v("closeDebt", y) + S.v("mezzClose", y) + S.v("quasiClose", y) + S.v("quasiAccr", y) + S.v("sweepAccr", y)) - (S.v("netBlock", y) + S.v("wcBal", y) + S.v("dsra", y) + S.v("marginBal", y)),
    note: "The free cash is paid out, so the cash is what the book and the cash timing leave between them (small; 0 when they agree)",
  });

  // ---- levelised cost
  S.section("Levelised cost and tariff");
  S.series("lcCost", "Operating cost and augmentation", "₹ cr", { f: (y) => `${S.at("opex", y)}+${S.at("aug", y)}`, v: (y) => S.v("opex", y) + S.v("aug", y), total: true });
  S.series("pvCost", "Discounted", "₹ cr", { f: (y) => `${S.at("lcCost", y)}*${S.at("df", y)}`, v: (y) => S.v("lcCost", y) * S.v("df", y), total: true });
  S.series("pvEnergy", "Delivered energy, discounted", "MU", { f: (y) => `${S.at("delivered", y)}*${S.at("df", y)}`, v: (y) => S.v("delivered", y) * S.v("df", y), fmt: "mu", total: true });
  S.series("pvPpa", "PPA supply revenue, discounted", "₹ cr", { f: (y) => `${S.at("delivered", y)}*${S.at("trf", y)}/10*${S.at("df", y)}`, v: (y) => ((S.v("delivered", y) * S.v("trf", y)) / 10) * S.v("df", y), total: true, note: "Delivered × the year's tariff, discounted (the levelised tariff)" });

  // ---- returns
  S.section("Returns");
  const sum = (k) => sumOf(S.val[k].slice(1));
  const eqFlows = S.val.fcfe.slice(0, N + 1);
  const prFlows = S.val.projCf.slice(0, N + 1);
  const npv = (rate, flows) => flows.reduce((a, cf, i) => a + cf / (1 + rate) ** i, 0);
  const dscrs = S.val.dscr.slice(1).filter(finite);
  const minOf = (key) => { const v = S.val[key].slice(1).filter(finite); return v.length ? Math.min(...v) : ""; };
  const minF = (key) => `IF(COUNT(${S.span(key)})=0,"",MIN(${S.span(key)}))`;
  const paybacks = S.val.paybackFlag.slice(1).filter(finite);
  // the lender's dated flows (the Returns sheet): the draws by construction month, the service at each year's end
  const nominalCod = codSerial ?? serialOf("2028-01-01");
  const lenderDated = [];
  if (consM > 0) cons.debtByMonth.forEach((d, i) => { if (d > 0) lenderDated.push({ date: shiftSerial(nominalCod, i + 1 - consM - 1), amount: -d }); });
  else lenderDated.push({ date: nominalCod, amount: -debt0 });
  for (let y = 1; y <= N; y += 1) lenderDated.push({ date: shiftSerial(nominalCod, 12 * y, -1), amount: S.v("lenderCf", y) });
  const isoOf = (serial) => new Date(EPOCH + serial * DAY_MS).toISOString().slice(0, 10);
  const lenderXirr = debt0 > 0 ? xirrOf(lenderDated.map((f) => ({ date: isoOf(f.date), amount: f.amount }))) : NaN;
  const lenderMirr = debt0 > 0 ? mirrOf(S.val.lenderCf.slice(0, N + 1), rt, S.v("reinvestU")) : NaN;
  const out = {
    tariff: [S.s("tariff"), S.v("tariff")],
    equityIrr: [`IFERROR(IRR(${S.span("fcfe", 0)}),"n/a")`, irr(eqFlows) ?? "n/a"],
    projectIrr: [`IFERROR(IRR(${S.span("projCf", 0)}),"n/a")`, irr(prFlows) ?? "n/a"],
    equityNpv: [`${S.at("fcfe", 0)}+NPV(${S.s("targetIrr")},${S.span("fcfe")})`, npv(S.v("targetIrr"), eqFlows)],
    projectNpv: [`${S.at("projCf", 0)}+NPV(${S.s("disc")},${S.span("projCf")})`, npv(S.v("disc"), prFlows)],
    minDscr: [minF("dscr"), dscrs.length ? Math.min(...dscrs) : ""],
    avgDscr: [`IF(COUNT(${S.span("dscr")})=0,"",AVERAGE(${S.span("dscr")}))`, dscrs.length ? dscrs.reduce((a, b) => a + b, 0) / dscrs.length : ""],
    lcoe: [`IF(C${S.cell.pvEnergy}>0,(${S.s("total")}+C${S.cell.pvCost})*10/C${S.cell.pvEnergy},"")`, sum("pvEnergy") > 0 ? ((total + sum("pvCost")) * 10) / sum("pvEnergy") : ""],
    levelisedTariff: [`IF(C${S.cell.pvEnergy}>0,C${S.cell.pvPpa}*10/C${S.cell.pvEnergy},"")`, sum("pvEnergy") > 0 ? (sum("pvPpa") * 10) / sum("pvEnergy") : ""],
    payback: [`IF(COUNT(${S.span("paybackFlag")})=0,"beyond the term",MIN(${S.span("paybackFlag")}))`, paybacks.length ? Math.min(...paybacks) : "beyond the term"],
    capexTotal: [S.s("total"), total],
    debt: [S.s("debt"), debt0],
    equity: [S.s("equity"), equity0],
    revenueTotal: [`C${S.cell.revenue}`, sum("revenue")],
    mezz: [S.s("mezz0"), mezz0],
    quasi: [S.s("quasi0"), quasi0],
    preTaxEquityIrr: [`IFERROR(IRR(${S.span("preTaxEq", 0)}),"n/a")`, irr(S.val.preTaxEq.slice(0, N + 1)) ?? "n/a"],
    preTaxProjectIrr: [`IFERROR(IRR(${S.span("preTaxProj", 0)}),"n/a")`, irr(S.val.preTaxProj.slice(0, N + 1)) ?? "n/a"],
    holdcoIrr: [`IFERROR(IRR(${S.span("holdcoCf", 0)}),"n/a")`, irr(S.val.holdcoCf.slice(0, N + 1)) ?? "n/a"],
    promoterIrr: [`IFERROR(IRR(${S.span("promoterCf", 0)}),"n/a")`, irr(S.val.promoterCf.slice(0, N + 1)) ?? "n/a"],
    lenderXirr: [`IFERROR('${RETURNS_SHEET}'!__LENDER_XIRR__,"n/a")`, finite(lenderXirr) ? lenderXirr : "n/a"],
    lenderMirr: [`IFERROR(MIRR(${S.span("lenderCf", 0)},${S.s("rate")},${S.s("reinvestU")}),"n/a")`, finite(lenderMirr) ? lenderMirr : "n/a"],
    minFscr: [minF("fscr"), minOf("fscr")],
    minLlcr: [minF("llcr"), minOf("llcr")],
    minPlcr: [minF("plcr"), minOf("plcr")],
    minTotalDscr: [minF("totalDscr"), minOf("totalDscr")],
  };
  out.irrGap = [`IFERROR(${"$C$" + (keyRow0 + 1)}-${S.s("targetIrr")},"n/a")`, finite(out.equityIrr[1]) ? out.equityIrr[1] - S.v("targetIrr") : "n/a"];
  const returnsRows = [
    ["equityIrr", "Equity IRR", "%", "pct"], ["projectIrr", "Project IRR", "%", "pct"], ["equityNpv", "Equity NPV at the target IRR", "₹ cr", "cr"],
    ["projectNpv", "Project NPV at the discount rate", "₹ cr", "cr"], ["minDscr", "Minimum DSCR", "×", "x"], ["avgDscr", "Average DSCR", "×", "x"],
    ["lcoe", "Levelised cost of supply (project cost + discounted costs) ÷ discounted energy", "₹/kWh", "tariff"],
    ["levelisedTariff", "Levelised tariff", "₹/kWh", "tariff"], ["payback", "Equity payback", "year", "int"],
    ["preTaxEquityIrr", "Equity IRR before tax", "%", "pct"], ["preTaxProjectIrr", "Project IRR before tax", "%", "pct"],
    ["holdcoIrr", "Holding company IRR", "%", "pct"], ["promoterIrr", "Promoter IRR", "%", "pct"], ["lenderMirr", "Lender's MIRR (yearly flows; reinvested at the rate on the Inputs sheet)", "%", "pct"],
    ["minFscr", "Minimum FSCR", "×", "x"], ["minLlcr", "Minimum LLCR", "×", "x"], ["minPlcr", "Minimum PLCR", "×", "x"], ["minTotalDscr", "Minimum DSCR including the mezzanine", "×", "x"],
  ];
  for (const [key, text, unit, fmt] of returnsRows) S.one(`ret_${key}`, text, unit, { f: out[key][0], v: out[key][1], fmt, bold: key === "equityIrr" });

  // ---- checks
  S.section("Checks");
  const checks = [];
  const check = (key, text, f, ok) => {
    S.one(key, text, "", { f: `IF(${f},"OK","CHECK")`, v: ok ? "OK" : "CHECK" });
    checks.push(S.s(key));
  };
  check("chkFunding", "Debt + mezzanine + quasi-equity + equity = project cost", `ABS(${S.s("debt")}+${S.s("mezzIn")}+${S.s("quasiIn")}+${S.s("equity")}-${S.s("total")})<0.001`, true);
  const closeAtTenor = S.v("closeDebt", refiEnd);
  check("chkDebt", "Debt repaid by its last year (unless topped up after it)", `OR(${S.s("topUpYear")}>=${S.s("refiEnd")},ABS(INDEX(${S.span("closeDebt")},1,${S.s("refiEnd")}))<0.01)`, S.v("topUpYear") >= refiEnd || Math.abs(closeAtTenor) < 0.01);
  const consOk = consM === 0 || Math.abs(cons.spent - base) < 0.01;
  check("chkCons", "Construction spends the whole cost before IDC", `OR(${S.s("consMonths")}<=0,ABS(${cons.spentRef}-${S.s("base")})<0.01)`, consOk);
  const balanced = Math.abs(sum("revenue") - sum("opex") - sum("ebitda")) < 0.01;
  check("chkEbitda", "Revenue − operating cost = EBITDA over the term", `ABS(C${S.cell.revenue}-C${S.cell.opex}-C${S.cell.ebitda})<0.01`, balanced);
  const lossesOk = S.val.lossCf.slice(1).every((x) => x >= -1e-9);
  check("chkLosses", "Tax losses never negative", `MIN(${S.span("lossCf")})>=-1E-9`, lossesOk);
  const partsSum = sumOf(S.v("part_shareRng"));
  check("chkParts", "Part commissioning shares sum to 100% (or none given)", `OR(COUNT(${S.s("part_shareRng")})=0,ABS(SUM(${S.s("part_shareRng")})-1)<0.001)`, !partsOn || Math.abs(partsSum - 1) < 0.001);
  const irrOk = finite(out.equityIrr[1]) && out.equityIrr[1] >= S.v("targetIrr") - 1e-5;
  S.one("chkIrr", "Equity IRR meets the target", "", { f: `IF(ISNUMBER($C$${keyRow0 + 1}),IF($C$${keyRow0 + 1}>=${S.s("targetIrr")}-1E-5,"OK","Below target"),"No IRR")`, v: irrOk ? "OK" : "Below target" });
  const dscrOk = dscrs.length ? Math.min(...dscrs) >= 1 : true;
  S.one("chkDscr", "Minimum DSCR at least 1.0", "", { f: `IF(ISNUMBER($C$${keyRow0 + 6}),IF($C$${keyRow0 + 6}>=1,"OK","Below 1.0"),"OK")`, v: dscrOk ? "OK" : "Below 1.0" });
  out.checks = [`IF(AND(${checks.map((c) => `${c}="OK"`).join(",")}),"OK","CHECK")`, checks.length && [true, S.v("topUpYear") >= refiEnd || Math.abs(closeAtTenor) < 0.01, consOk, balanced, lossesOk, !partsOn || Math.abs(partsSum - 1) < 0.001].every(Boolean) ? "OK" : "CHECK"];

  // ---- the schedule sheets (the Tax schedule's pools give the Live model its losses available), then the key results
  const sched = addScheduleSheets(wb, sheets, S, { N, NP, yearRow, refiOn, tenorUsed, refiEnd, debt0, total, equity0, mezz0, quasi0, TL, pools, lossLimit, lenderDated, nominalCod, consM, cons, regLabelAll, REGISTER });
  out.lenderXirr[0] = out.lenderXirr[0].replace("__LENDER_XIRR__", sched.lenderXirrCell);

  // ---- key results (top of the sheet), against the app's numbers
  const tol = { equityIrr: 1e-5, projectIrr: 1e-5, irrGap: 1e-5 };
  KEYS.forEach(([key, text, unit, fmt], i) => {
    const row = ws.getRow(keyRow0 + i);
    S.label(row, text, unit, { indent: 1, bold: key === "tariff" || key === "equityIrr" });
    S.put(row.getCell(3), { f: out[key][0], v: out[key][1], fmt, bold: key === "tariff" || key === "equityIrr" });
    row.getCell(3).alignment = { horizontal: "right" };
    const app = m.app?.[key];
    if (key === "checks") {
      row.getCell(6).value = { formula: `IF(C${keyRow0 + i}="OK","OK","CHECK")`, result: "OK" };
    } else if (finite(app) || (key === "payback" && app !== undefined)) {
      S.put(row.getCell(4), { v: app, fmt, kind: "app" });
      if (finite(app) && finite(out[key][1])) {
        // within a millionth, and money within ₹1,000 (1e-4 crore): the hour-by-hour sheets carry the
        // optimiser's MW to six decimals, so an amount that is 0 in the app (the equity NPV at the
        // target IRR) can come out a few hundred rupees off
        const t = tol[key] ?? Math.max(fmt === "cr" ? 1e-4 : 1e-6, Math.abs(app) * 1e-6);
        S.put(row.getCell(5), { f: `IF(ISNUMBER(C${keyRow0 + i}),C${keyRow0 + i}-D${keyRow0 + i},"")`, v: out[key][1] - app, fmt });
        row.getCell(6).value = { formula: `IF(ISNUMBER(E${keyRow0 + i}),IF(ABS(E${keyRow0 + i})<=${t},"Yes","Changed"),"")`, result: Math.abs(out[key][1] - app) <= t ? "Yes" : "Changed" };
      } else {
        row.getCell(6).value = { formula: `IF(C${keyRow0 + i}=D${keyRow0 + i},"Yes","Changed")`, result: out[key][1] === app ? "Yes" : "Changed" };
      }
    }
    row.getCell(6).alignment = { horizontal: "right" };
    S.cell[`key_${key}`] = `$C$${keyRow0 + i}`;
  });
  const lastKey = keyRow0 + KEYS.length - 1;
  ws.addConditionalFormatting({
    ref: `F${keyRow0}:F${lastKey}`,
    rules: [
      { type: "expression", formulae: [`OR(F${keyRow0}="Yes",F${keyRow0}="OK")`], style: { font: { bold: true, color: { argb: "FF1E7B34" } } } },
      { type: "expression", formulae: [`OR(F${keyRow0}="Changed",F${keyRow0}="CHECK")`], style: { font: { bold: true, color: { argb: "FFB26A00" } } } },
    ],
  });
  const chk0 = Number(S.s("chkFunding").split("$").pop());
  ws.addConditionalFormatting({
    ref: `C${chk0}:C${S.row}`,
    rules: [
      { type: "expression", formulae: [`C${chk0}="OK"`], style: { font: { bold: true, color: { argb: "FF1E7B34" } } } },
      { type: "expression", formulae: [`C${chk0}<>"OK"`], style: { font: { bold: true, color: { argb: "FFB3261E" } } } },
    ],
  });

  // ---- layout
  ws.getColumn(1).width = 54;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 14;
  for (let y = 1; y <= N; y += 1) ws.getColumn(4 + y).width = 12;
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: S.datesRow, topLeftCell: `D${S.datesRow + 1}`, activeCell: "C1", showGridLines: false }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${yearRow}:${S.datesRow}` };
  ws.headerFooter = { oddFooter: "&L&A&R&P / &N" };

  // the sensitivities: the app's model run at every point (not for the in-app trace, which has no use for them)
  if (sensitivity) addSensitivitySheet(wb, sheets, S, m, sensitivityTables(m));

  const cells = Object.fromEntries(KEYS.map(([key]) => [key, `'${LIVE_SHEET}'!${S.cell[`key_${key}`]}`]));
  // addr: every row's key → its address ("$C$12" for one value, "'Inputs'!$C$12" for an input, the row number for a year series)
  return { sheet: ws, cells, values: Object.fromEntries(Object.entries(out).map(([k, [, v]]) => [k, v])), rows: S.val, addr: { ...S.cell }, dispatch: dsp ? dTotals : null };
}

/**
 * Where the tax pools sit on the Tax schedule sheet: for the business losses and the disallowed
 * interest, a block of rows by year of origin for what is available at the start of the year,
 * what is set off, and the balance at the year end, each with a total row. Fixed before the Live
 * model is built, since the model reads the totals and the blocks read the model.
 */
function taxLayout(N) {
  let row = 5; // rows 1-4: title, intro, the year header and the dates
  const block = () => { const b = { head: row + 1, first: row + 2, total: row + 2 + N }; row = b.total; return b; };
  const lossAv = block(); const lossUse = block(); const lossBal = block();
  const intAv = block(); const intUse = block(); const intBal = block();
  return { lossAv, lossUse, lossBal, intAv, intUse, intBal, next: row + 2 };
}

/**
 * The schedule sheets beside the Live model: the statements, the debt schedule, the depreciation
 * and tax schedules, the tax pools by year of origin, the returns with the lender's dated flows,
 * the guarantees and reserves, the quasi-equity and the mezzanine, and the working capital, each
 * laid out in full, year by year, with its parameters at the top. Every cell is a formula on the
 * Live model and the Inputs sheet (the one place the model is computed, so the trace, the checks
 * and Goal Seek keep working) or on the sheet's own rows; each carries its value for viewers that
 * do not recalculate. Returns the address of the lender's XIRR on the Returns sheet.
 */
function addScheduleSheets(wb, sheets, S, { N, NP, yearRow, refiOn, tenorUsed, refiEnd, debt0, total, equity0, mezz0, quasi0, TL, pools, lossLimit, lenderDated, nominalCod, consM, cons, regLabelAll, REGISTER: REG }) {
  const L = `'${LIVE_SHEET}'!`;
  const link = (key, y) => `${L}${S.at(key, y)}`; // a year cell of the Live model
  const one = (key) => (String(S.s(key)).includes("!") ? S.s(key) : `${L}${S.s(key)}`); // a single value of the Live model or an input
  const n0 = (v) => (finite(v) ? v : 0);

  /** A sheet with the Live model's year layout: labels in A, unit in B, total in C, year 0 in D, years from E. */
  const open = (name, title, intro, colour) => {
    const ws = sheetOf(wb, sheets, name, colour);
    const T = new Sheet(ws, N);
    let r = T.next();
    r.getCell(1).value = title;
    r.getCell(1).font = { bold: true, size: 14 };
    r = T.next();
    r.getCell(1).value = intro;
    r.getCell(1).font = { italic: true, color: { argb: "FF777777" } };
    r = T.next();
    T.yearRow = T.row;
    ["₹ crore unless stated", "Unit", "Total / value", "Year 0"].forEach((t, i) => { r.getCell(i + 1).value = t; });
    for (let y = 1; y <= N; y += 1) {
      const c = r.getCell(4 + y);
      c.value = { formula: `${L}${S.col(y)}${yearRow}`, result: y };
      c.numFmt = FMT.year;
    }
    for (let c = 1; c <= 4 + N; c += 1) {
      const cell = r.getCell(c);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
      cell.alignment = { horizontal: c > 2 ? "right" : "left" };
    }
    T.series("yearStart", "Year starts", "date", { f: (y) => link("yearStart", y), v: (y) => S.v("yearStart", y), fmt: "month" });
    T.datesRow = T.cell.yearStart;
    ws.getRow(T.datesRow).font = { color: { argb: "FF555555" } };
    ws.getColumn(1).width = 50;
    ws.getColumn(2).width = 14;
    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 12;
    for (let y = 1; y <= N; y += 1) ws.getColumn(4 + y).width = 12;
    ws.views = [{ state: "frozen", xSplit: 3, ySplit: T.datesRow, topLeftCell: `D${T.datesRow + 1}`, showGridLines: false }];
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${T.yearRow}:${T.datesRow}` };
    return { ws, T };
  };
  /** A parameter linked from the Live model (its input or result), in column C. */
  const param = (T, key, text, unit, { fmt = "cr", live = key } = {}) => {
    const r = T.next();
    T.label(r, text, unit, { indent: 1 });
    const v = S.v(live);
    T.put(r.getCell(3), { f: v === null || v === undefined ? `IF(ISBLANK(${one(live)}),"",${one(live)})` : one(live), v: v ?? "", fmt });
    T.cell[key] = `$C$${T.row}`;
    T.val[key] = v;
  };
  /** A year row linked from the Live model (year 0 optional), with its total. */
  const linked = (T, key, text, unit, { live = key, fmt = "cr", total = true, bold = false, y0 = null, note } = {}) => {
    const vals = S.val[live];
    T.series(key, text, unit, { f: (y) => link(live, y), v: (y) => vals[y], fmt, total, bold, note, y0: y0 ? { f: y0.f, v: y0.v } : (vals[0] !== null && vals[0] !== undefined ? { f: link(live, 0), v: vals[0] } : undefined) });
  };
  /** A row worked out on the sheet itself. */
  const own = (T, key, text, unit, { f, v, fmt = "cr", total = false, bold = false, y0, note } = {}) => T.series(key, text, unit, { f, v, fmt, total, bold, y0, note });
  /** One value worked out on the sheet itself, in column C. */
  const single = (T, key, text, unit, { f, v, fmt = "cr", bold = false, note } = {}) => {
    const r = T.next();
    T.label(r, text, unit, { indent: 1, note });
    T.put(r.getCell(3), { f, v, fmt, bold });
    T.cell[key] = `$C$${T.row}`;
    T.val[key] = v;
  };
  const has = (key) => S.cell[key] !== undefined;
  const cum = (T, key, from, text, unit = "₹ cr") => own(T, key, text, unit, {
    f: (y) => (y === 1 ? T.at(from, 1) : `${T.at(key, y - 1)}+${T.at(from, y)}`),
    v: (y) => (y === 1 ? T.v(from, 1) : T.v(key, y - 1) + T.v(from, y)),
  });
  const neg = (T, key, live, text) => own(T, key, text, "₹ cr", { f: (y) => `-${link(live, y)}`, v: (y) => -S.v(live, y), total: true });

  // ---- profit and loss
  {
    const { T } = open(PL_SHEET, "Profit and loss", "The statement of each year: revenue by stream, operating costs by line, EBITDA and other income, depreciation, interest and fees, tax and the profit after tax. Linked to the Live model.", "FF2E75B6");
    T.section("Revenue");
    linked(T, "ppaRev", "PPA supply revenue", "₹ cr");
    linked(T, "mktRev", "Market sale revenue", "₹ cr");
    if (has("buyerRev")) linked(T, "buyerRev", "Solar Hours excess sold to the buyer", "₹ cr");
    linked(T, "penaltyCr", "Less: shortfall penalty", "₹ cr");
    if (has("blockPenCr")) linked(T, "blockPenCr", "Less: time-block shortfall penalty", "₹ cr");
    if (has("cfdPenCr")) linked(T, "cfdPenCr", "Less: weekly shortfall penalty (SECI CfD-I)", "₹ cr");
    linked(T, "carbonRev", "Carbon credit revenue", "₹ cr");
    linked(T, "revenue", "Total revenue", "₹ cr", { bold: true });
    T.section("Operating costs");
    const opexLines = [["solarOmCr", "Solar O&M"], ["windOmCr", "Wind O&M"], ["bessOmCr", "Battery O&M"], ["biomassOmCr", "Biomass O&M"], ["insuranceCr", "Insurance"], ["otherCr", "Other fixed cost"],
      ["fuelCr", "Biomass fuel"], ["hydroFixedCr", "Hydro capacity charge"], ["hydroEnergyCr", "Hydro energy charge"], ["thermalFixedCr", "Thermal capacity charge"], ["thermalEnergyCr", "Thermal energy charge and RECs"], ["dsmCr", "Deviation settlement charges (CERC DSM)"],
      ["chargingCostCr", "Charging power (SECI CfD-I)"], ["pxFeeCostCr", "Exchange fees (SECI CfD-I)"], ["lcCostCr", "Letter of Credit to SECI"]];
    for (const [key, text] of opexLines) if (has(key)) linked(T, key, text, "₹ cr");
    for (let i = 1; i <= SLOTS; i += 1) if (n0(S.v(`otherL${i}_cr`)) > 0) linked(T, `otherL${i}`, `  of which other fixed cost line ${i}: ${S.v(`otherL${i}_label`) || ""}`, "₹ cr");
    for (let i = 1; i <= SLOTS; i += 1) if (has(`windOmC${i}`) && n0(S.v(`windC${i}_lakh`)) > 0) linked(T, `windOmC${i}`, `  of which wind O&M component ${i}: ${S.v(`windC${i}_label`) || ""}`, "₹ cr");
    linked(T, "opex", "Total operating cost", "₹ cr", { bold: true });
    T.section("Earnings");
    linked(T, "ebitda", "EBITDA", "₹ cr", { bold: true });
    linked(T, "margin", "EBITDA margin", "%", { fmt: "pct", total: false });
    linked(T, "otherIncome", "Add: other income (reserve and margin interest)", "₹ cr");
    linked(T, "bookDep", "Less: depreciation", "₹ cr");
    own(T, "ebit", "EBIT", "₹ cr", { f: (y) => `${T.at("ebitda", y)}+${T.at("otherIncome", y)}-${T.at("bookDep", y)}`, v: (y) => S.v("ebitda", y) + S.v("otherIncome", y) - S.v("bookDep", y), total: true, bold: true });
    linked(T, "interest", "Less: interest on the senior debt", "₹ cr");
    linked(T, "wcInt", "Less: interest on working capital", "₹ cr");
    linked(T, "refiFeeCr", "Less: refinancing fee", "₹ cr");
    linked(T, "prepayFee", "Less: prepayment fee", "₹ cr");
    linked(T, "bgFees", "Less: guarantee fees", "₹ cr");
    linked(T, "mezzInt", "Less: mezzanine interest", "₹ cr");
    linked(T, "quasiInt", "Less: quasi-equity interest paid", "₹ cr");
    linked(T, "pbt", "Profit before tax", "₹ cr", { bold: true });
    linked(T, "tax", "Less: tax", "₹ cr");
    linked(T, "pat", "Profit after tax", "₹ cr", { bold: true });
    own(T, "patMargin", "Profit after tax, share of revenue", "%", {
      f: (y) => `IF(${T.at("revenue", y)}<>0,${T.at("pat", y)}/${T.at("revenue", y)},"")`, v: (y) => (S.v("revenue", y) !== 0 ? S.v("pat", y) / S.v("revenue", y) : ""), fmt: "pct",
    });
    cum(T, "cumPat", "pat", "Cumulative profit after tax");
  }

  // ---- cash flow
  {
    const { T } = open(CASH_FLOW_SHEET, "Cash flow", "Cash from operations, investing and financing each year; the cash available for debt service, the equity cash flow and the unlevered project cash flow, and the holding company's, the promoter's and the lender's. Year 0 is the investment. Linked to the Live model.", "FF548235");
    T.section("Operations");
    linked(T, "ebitda", "EBITDA", "₹ cr");
    linked(T, "otherIncome", "Other income (reserve and margin interest)", "₹ cr");
    neg(T, "taxPaid", "tax", "Less: tax paid");
    neg(T, "wcCash", "dWc", "Less: increase in working capital");
    neg(T, "wcIntCash", "wcInt", "Less: interest on working capital");
    neg(T, "bgCash", "bgFees", "Less: guarantee fees");
    own(T, "cfo", "Cash from operations", "₹ cr", {
      f: (y) => `${T.at("ebitda", y)}+${T.at("otherIncome", y)}+${T.at("taxPaid", y)}+${T.at("wcCash", y)}+${T.at("wcIntCash", y)}+${T.at("bgCash", y)}`,
      v: (y) => S.v("ebitda", y) + S.v("otherIncome", y) - S.v("tax", y) - S.v("dWc", y) - S.v("wcInt", y) - S.v("bgFees", y), total: true, bold: true,
    });
    T.section("Investing");
    own(T, "capexCash", "Project cost (year 0) and battery augmentation", "₹ cr", { y0: { f: `-${one("total")}`, v: -total }, f: (y) => `-${link("aug", y)}`, v: (y) => -S.v("aug", y), total: true });
    neg(T, "extCash", "extCapex", "Less: life extension capital cost");
    neg(T, "rpCash", "repower", "Less: solar repowering");
    own(T, "salvageCash", "Salvage and working capital released (final year)", "₹ cr", { f: (y) => link("terminal", y), v: (y) => S.v("terminal", y), total: true });
    own(T, "cfi", "Cash from investing", "₹ cr", {
      y0: { f: T.at("capexCash", 0), v: -total },
      f: (y) => `${T.at("capexCash", y)}+${T.at("extCash", y)}+${T.at("rpCash", y)}+${T.at("salvageCash", y)}`, v: (y) => -S.v("aug", y) - S.v("extCapex", y) - S.v("repower", y) + S.v("terminal", y), total: true, bold: true,
    });
    own(T, "cfads", "Cash flow available for debt service", "₹ cr", {
      f: (y) => link("cfads", y), v: (y) => S.v("cfads", y), total: true, bold: true, note: "As on the Live model: EBITDA − tax − working capital − capital spend in operation − interest on working capital + other income − guarantee fees",
    });
    T.section("Financing");
    own(T, "debtIn", "Senior debt drawn (year 0, incl. IDC and the bridge fee)", "₹ cr", { y0: { f: one("debt"), v: debt0 }, f: () => "0", v: () => 0, total: true });
    own(T, "mezzIn", "Mezzanine drawn (year 0)", "₹ cr", { y0: { f: one("mezz0"), v: mezz0 }, f: () => "0", v: () => 0, total: true });
    own(T, "quasiInCf", "Quasi-equity put in (year 0)", "₹ cr", { y0: { f: one("quasi0"), v: quasi0 }, f: () => "0", v: () => 0, total: true });
    own(T, "equityIn", "Equity put in (year 0)", "₹ cr", { y0: { f: one("equity"), v: equity0 }, f: () => "0", v: () => 0, total: true });
    neg(T, "interestCash", "interest", "Less: interest paid");
    neg(T, "principalCash", "principal", "Less: principal repaid");
    neg(T, "sweepCash", "sweep", "Less: cash sweep (principal prepaid)");
    neg(T, "debtEndCash", "debtEnd", "Less: debt still owed, repaid in the final year");
    neg(T, "refiCash", "refiFeeCr", "Less: refinancing fee");
    neg(T, "prepayCash", "prepayFee", "Less: prepayment fee");
    own(T, "topUpCash", "Top-up debt drawn", "₹ cr", { f: (y) => link("topUp", y), v: (y) => S.v("topUp", y), total: true });
    neg(T, "mezzIntCash", "mezzInt", "Less: mezzanine interest");
    neg(T, "mezzPrinCash", "mezzPrin", "Less: mezzanine principal");
    neg(T, "quasiIntCash", "quasiInt", "Less: quasi-equity interest paid");
    neg(T, "quasiRepayCash", "quasiRepay", "Less: quasi-equity repaid");
    neg(T, "dsraCash", "dDsra", "Less: put into the debt service reserve (released: positive)");
    neg(T, "marginCash", "dMargin", "Less: margin money blocked (released: positive)");
    const cffKeys = ["debtIn", "mezzIn", "quasiInCf", "equityIn", "interestCash", "principalCash", "sweepCash", "debtEndCash", "refiCash", "prepayCash", "topUpCash", "mezzIntCash", "mezzPrinCash", "quasiIntCash", "quasiRepayCash", "dsraCash", "marginCash"];
    own(T, "cff", "Cash from financing (the equity put in included)", "₹ cr", {
      y0: { f: cffKeys.slice(0, 4).map((k) => T.at(k, 0)).join("+"), v: debt0 + mezz0 + quasi0 + equity0 },
      f: (y) => cffKeys.map((k) => T.at(k, y)).join("+"),
      v: (y) => cffKeys.reduce((a, k) => a + T.v(k, y), 0), total: true, bold: true,
    });
    T.section("To equity");
    own(T, "fcfe", "Cash to equity (year 0: the equity put in); the model's equity cash flow", "₹ cr", {
      y0: { f: link("fcfe", 0), v: -equity0 }, f: (y) => link("fcfe", y), v: (y) => S.v("fcfe", y), total: true, bold: true,
      note: "Every rupee of free cash is paid out to equity, so no cash builds up on the balance sheet",
    });
    own(T, "cfCheck", "Check: operations + investing + financing − cash to equity (0 every year)", "₹ cr", {
      y0: { f: `${T.at("cfi", 0)}+${T.at("cff", 0)}-${T.at("equityIn", 0)}-${T.at("fcfe", 0)}`, v: 0 },
      f: (y) => `${T.at("cfo", y)}+${T.at("cfi", y)}+${T.at("cff", y)}-${T.at("fcfe", y)}`,
      v: (y) => T.v("cfo", y) + T.v("cfi", y) + T.v("cff", y) - S.v("fcfe", y),
    });
    own(T, "cumEq", "Cumulative equity cash", "₹ cr", { y0: { f: link("cumEq", 0), v: -equity0 }, f: (y) => link("cumEq", y), v: (y) => S.v("cumEq", y) });
    T.section("Unlevered, before tax, and the other parties");
    linked(T, "projCf", "Project cash flow (unlevered, after the project's own tax)", "₹ cr", { bold: true });
    linked(T, "preTaxEq", "Equity cash flow before tax", "₹ cr");
    linked(T, "preTaxProj", "Project cash flow before tax", "₹ cr");
    linked(T, "holdcoCf", "Holding company cash flow", "₹ cr");
    linked(T, "promoterCf", "Promoter cash flow", "₹ cr");
    linked(T, "lenderCf", "Lender's cash flow", "₹ cr");
  }

  // ---- balance sheet
  {
    const { T } = open(BALANCE_SHEET, "Balance sheet", "At each year end: every asset at cost less accumulated depreciation, the working capital, the reserve and the margin money against the senior debt, the mezzanine, the quasi-equity and the accruals, the share capital and the retained earnings. Free cash is paid out to equity each year, so the cash is the small balancing figure; the final year's realisation is shown below the statement. Linked to the Live model.", "FFBF8F00");
    T.section("Assets");
    for (const k of REG) linked(T, `net_${k}`, `${regLabelAll[k]}: net block`, "₹ cr", { total: false });
    linked(T, "grossBlock", "Gross block", "₹ cr", { total: false });
    linked(T, "accDep", "Less: accumulated depreciation", "₹ cr", { total: false });
    linked(T, "netBlock", "Net block", "₹ cr", { total: false, bold: true });
    linked(T, "wcBal", "Working capital (receivables, O&M in hand, spares)", "₹ cr", { total: false, y0: { f: "0", v: 0 } });
    linked(T, "dsra", "Debt service reserve (cash held)", "₹ cr", { total: false, y0: { f: "0", v: 0 } });
    linked(T, "marginBal", "Margin money against the guarantees", "₹ cr", { total: false, y0: { f: "0", v: 0 } });
    linked(T, "cash", "Cash", "₹ cr", { total: false });
    const assetKeys = ["netBlock", "wcBal", "dsra", "marginBal", "cash"];
    own(T, "assets", "Total assets", "₹ cr", {
      y0: { f: assetKeys.map((k) => T.at(k, 0)).join("+"), v: total },
      f: (y) => assetKeys.map((k) => T.at(k, y)).join("+"), v: (y) => assetKeys.reduce((a, k) => a + n0(T.v(k, y)), 0), bold: true,
    });
    T.section("Equity and liabilities");
    own(T, "shareCap", "Share capital (the equity put in)", "₹ cr", { y0: { f: one("equity"), v: equity0 }, f: (y) => T.at("shareCap", y - 1), v: () => equity0 });
    linked(T, "retained", "Retained earnings", "₹ cr", { total: false, note: "Cumulative profit after tax less the cash paid out" });
    own(T, "equityBs", "Total equity", "₹ cr", { y0: { f: `${T.at("shareCap", 0)}+${T.at("retained", 0)}`, v: equity0 }, f: (y) => `${T.at("shareCap", y)}+${T.at("retained", y)}`, v: (y) => equity0 + S.v("retained", y), bold: true });
    own(T, "debtBs", "Senior debt (closing balance)", "₹ cr", { y0: { f: one("debt"), v: debt0 }, f: (y) => link("closeDebt", y), v: (y) => S.v("closeDebt", y) });
    own(T, "mezzBs", "Mezzanine (closing balance)", "₹ cr", { y0: { f: one("mezz0"), v: mezz0 }, f: (y) => link("mezzClose", y), v: (y) => S.v("mezzClose", y) });
    own(T, "quasiBs", "Quasi-equity (closing balance)", "₹ cr", { y0: { f: one("quasi0"), v: quasi0 }, f: (y) => link("quasiClose", y), v: (y) => S.v("quasiClose", y) });
    linked(T, "quasiAccr", "Quasi-equity interest accrued", "₹ cr", { total: false, y0: { f: "0", v: 0 } });
    linked(T, "sweepAccr", "Cash sweep accrued", "₹ cr", { total: false, y0: { f: "0", v: 0 } });
    const liabKeys = ["equityBs", "debtBs", "mezzBs", "quasiBs", "quasiAccr", "sweepAccr"];
    own(T, "liab", "Total equity and liabilities", "₹ cr", {
      y0: { f: liabKeys.map((k) => T.at(k, 0)).join("+"), v: total },
      f: (y) => liabKeys.map((k) => T.at(k, y)).join("+"), v: (y) => liabKeys.reduce((a, k) => a + n0(T.v(k, y)), 0), bold: true,
    });
    own(T, "bsCheck", "Check: assets − equity and liabilities (0 every year)", "₹ cr", {
      y0: { f: `${T.at("assets", 0)}-${T.at("liab", 0)}`, v: 0 }, f: (y) => `${T.at("assets", y)}-${T.at("liab", y)}`, v: (y) => T.v("assets", y) - T.v("liab", y),
    });
    own(T, "gearing", "Debt (senior and mezzanine), share of the balance sheet", "%", {
      y0: { f: `IF(${T.at("liab", 0)}>0.000001,(${T.at("debtBs", 0)}+${T.at("mezzBs", 0)})/${T.at("liab", 0)},"")`, v: total > 1e-6 ? (debt0 + mezz0) / total : "" },
      f: (y) => `IF(${T.at("liab", y)}>0.000001,(${T.at("debtBs", y)}+${T.at("mezzBs", y)})/${T.at("liab", y)},"")`, v: (y) => (T.v("liab", y) > 1e-6 ? (S.v("closeDebt", y) + S.v("mezzClose", y)) / T.v("liab", y) : ""), fmt: "pct",
    });
    T.section("Realisation at the end of the term (final year)");
    own(T, "realised", "Fixed assets sold at salvage and working capital released", "₹ cr", { f: (y) => link("terminal", y), v: (y) => S.v("terminal", y), total: true });
    own(T, "repaidEnd", "Less: debt repaid", "₹ cr", { f: (y) => `-${link("debtEnd", y)}`, v: (y) => -S.v("debtEnd", y), total: true });
    own(T, "toEquityEnd", "Returned to equity", "₹ cr", { f: (y) => `${T.at("realised", y)}+${T.at("repaidEnd", y)}`, v: (y) => S.v("terminal", y) - S.v("debtEnd", y), total: true, bold: true });
  }

  // ---- debt schedule
  {
    const { T } = open(DEBT_SHEET, "Debt schedule", "The senior debt year by year: the terms, the drawdown, interest and principal under the repayment method, the refinancing, the step-down, the cash sweep, the top-up, the cover ratios and the reserve. Linked to the Live model; change the terms on the Inputs sheet (blue cells).", "FF1F3864");
    T.section("Terms");
    param(T, "debt", "Senior debt at COD (incl. IDC and the bridge fee)", "₹ cr");
    param(T, "mezz0", "Mezzanine", "₹ cr");
    param(T, "quasi0", "Quasi-equity", "₹ cr");
    param(T, "equity", "Equity", "₹ cr");
    param(T, "total", "Project cost", "₹ cr");
    param(T, "rate", "Interest rate", "%/yr", { fmt: "pct" });
    param(T, "stepAfter", "Interest step-down after (years; 0: none)", "years", { fmt: "int" });
    param(T, "stepRateU", "Rate after the step-down", "%/yr", { fmt: "pct" });
    param(T, "tenorUsed", "Tenor (door to door)", "years", { fmt: "int" });
    param(T, "graceUsed", "Principal moratorium", "years", { fmt: "int" });
    param(T, "repay", "Repayment method", "", { fmt: "text" });
    param(T, "instalments", "Instalments a year", "", { fmt: "text" });
    param(T, "targetDscr", "Target DSCR (sculpted)", "×", { fmt: "x" });
    param(T, "balloonShare", "Share repaid in the last year (balloon / bullet)", "%", { fmt: "pct" });
    param(T, "refiOn", "Refinancing applies (1 / 0)", "", { fmt: "int" });
    param(T, "refiYear", "Refinanced at the end of year", "year", { fmt: "int" });
    param(T, "refiRate", "Refinanced rate", "%/yr", { fmt: "pct" });
    param(T, "refiEnd", "Last year of the debt", "year", { fmt: "int" });
    param(T, "refiFee", "Refinancing fee", "% of the balance", { fmt: "pct" });
    param(T, "refiRepay", "Repayment after the refinancing", "", { fmt: "text" });
    param(T, "prepayPct", "Prepayment fee", "% of principal prepaid", { fmt: "pct" });
    param(T, "sweepPct", "Cash sweep", "% of the free cash", { fmt: "pct" });
    param(T, "topUpYear", "Top-up at the end of year (0: none)", "year", { fmt: "int" });
    param(T, "dsraMonths", "Debt service reserve", "months", { fmt: "num" });
    param(T, "dsraBasis", "Reserve basis (next / peak)", "", { fmt: "text" });

    T.section("Schedule");
    linked(T, "openDebt", "Opening balance", "₹ cr", { total: false });
    own(T, "drawdown", "Drawdown (at COD, incl. IDC and the bridge fee)", "₹ cr", { y0: { f: one("debt"), v: debt0 }, f: () => "0", v: () => 0, total: true, note: "The construction sheet has the month-by-month draws" });
    linked(T, "rateY", "Interest rate of the year", "%", { fmt: "pct", total: false });
    linked(T, "methodY", "Repayment method of the year", "", { fmt: "text", total: false });
    linked(T, "intOpen", "Interest on the opening balance", "₹ cr", { total: true });
    linked(T, "interest", "Interest paid (after the instalment saving)", "₹ cr", { total: true });
    linked(T, "principal", "Principal repaid (scheduled)", "₹ cr", { total: true });
    linked(T, "sweep", "Cash sweep (principal prepaid)", "₹ cr", { total: true });
    linked(T, "topUp", "Top-up drawn", "₹ cr", { total: true });
    linked(T, "closeDebt", "Closing balance", "₹ cr", { total: false, bold: true });
    linked(T, "debtService", "Debt service (interest and scheduled principal)", "₹ cr", { total: true, bold: true });
    linked(T, "refiFeeCr", "Refinancing fee", "₹ cr", { total: true });
    linked(T, "prepayFee", "Prepayment fee", "₹ cr", { total: true });
    own(T, "cumPrincipal", "Cumulative principal repaid (scheduled and swept)", "₹ cr", {
      f: (y) => (y === 1 ? `${T.at("principal", 1)}+${T.at("sweep", 1)}` : `${T.at("cumPrincipal", y - 1)}+${T.at("principal", y)}+${T.at("sweep", y)}`),
      v: (y) => (y === 1 ? S.v("principal", 1) + S.v("sweep", 1) : T.v("cumPrincipal", y - 1) + S.v("principal", y) + S.v("sweep", y)),
    });
    own(T, "repaidPct", "Repaid, share of the debt", "%", {
      f: (y) => `IF(${T.s("debt")}>0,${T.at("cumPrincipal", y)}/${T.s("debt")},0)`,
      v: (y) => (debt0 > 0 ? T.v("cumPrincipal", y) / debt0 : 0), fmt: "pct",
    });
    own(T, "avgBalance", "Average balance (interest ÷ rate)", "₹ cr", {
      f: (y) => `IF(${T.at("rateY", y)}>0,${T.at("interest", y)}/${T.at("rateY", y)},0)`,
      v: (y) => (S.v("rateY", y) > 0 ? S.v("interest", y) / S.v("rateY", y) : 0),
    });

    T.section("Cover");
    linked(T, "cfads", "Cash flow available for debt service (CFADS)", "₹ cr", { total: true });
    linked(T, "dscr", "DSCR", "×", { fmt: "x", total: false, bold: true });
    linked(T, "fscr", "FSCR", "×", { fmt: "x", total: false });
    linked(T, "totalDscr", "DSCR including the mezzanine", "×", { fmt: "x", total: false });
    linked(T, "llcr", "Loan life cover ratio", "×", { fmt: "x", total: false, note: "PV of CFADS over the years left to the last year of the debt, at the year's rate, ÷ the opening balance" });
    linked(T, "plcr", "Project life cover ratio", "×", { fmt: "x", total: false, note: "PV of CFADS over the years left of the project ÷ the opening balance" });
    for (const [key, text] of [["dscr", "Minimum DSCR"], ["fscr", "Minimum FSCR"], ["totalDscr", "Minimum DSCR including the mezzanine"], ["llcr", "Minimum LLCR"], ["plcr", "Minimum PLCR"]]) {
      const d = S.val[key].slice(1).filter(finite);
      single(T, `min_${key}`, text, "×", { f: `IF(COUNT(${T.span(key)})=0,"",MIN(${T.span(key)}))`, v: d.length ? Math.min(...d) : "", fmt: "x", bold: key === "dscr" });
    }
    {
      const d = S.val.dscr.slice(1).filter(finite);
      single(T, "avgDscr", "Average DSCR", "×", { f: `IF(COUNT(${T.span("dscr")})=0,"",AVERAGE(${T.span("dscr")}))`, v: d.length ? d.reduce((a, b) => a + b, 0) / d.length : "", fmt: "x" });
    }
    linked(T, "lenderCf", "Lender's cash flow (the debt out at year 0; service, sweep and fees back; a top-up out)", "₹ cr", { total: true });
    {
      const flows = S.val.lenderCf.slice(0, N + 1);
      const v = debt0 > 0 ? irr(flows) : null;
      single(T, "lenderIrr", "Lender's IRR (yearly flows)", "%", { f: `IFERROR(IRR(${T.span("lenderCf", 0)}),"")`, v: v ?? "", fmt: "pct", bold: true });
    }

    T.section("Debt service reserve");
    linked(T, "dsra", "Reserve held", "₹ cr", { total: false, note: "Months of the next year's debt service, or of the highest year left (peak)" });
    linked(T, "dDsra", "Put into (released from) the reserve", "₹ cr", { total: true });
    linked(T, "dsraInt", "Interest earned on the reserve (other income)", "₹ cr", { total: true });
  }

  // ---- depreciation and tax
  {
    const { T } = open(DEPRECIATION_SHEET, "Depreciation and tax", "Book depreciation on both bases (straight line by component, written down), the tax block on both bases, the deferred tax and the tax of each year with the pools carried. Linked to the Live model; the pools by year of origin are on the Tax schedule sheet.", "FF7F6000");
    T.section("Terms");
    param(T, "total", "Project cost (incl. IDC and fees)", "₹ cr");
    param(T, "salvage", "Salvage value", "% of project cost", { fmt: "pct" });
    param(T, "bookBase", "Depreciable value (less salvage)", "₹ cr");
    param(T, "bookLife", "Book life", "years", { fmt: "int" });
    param(T, "livesOn", "Book lives by component (Yes / No)", "", { fmt: "text" });
    param(T, "bookMethod", "Book depreciation (slm / wdv)", "", { fmt: "text" });
    param(T, "bookWdvRateU", "Book WDV rate used", "%/yr", { fmt: "pct" });
    param(T, "taxMethod", "Tax depreciation method", "wdv / slm", { fmt: "text" });
    param(T, "wdvRate", "WDV rate", "%/yr", { fmt: "pct" });
    param(T, "taxRate", "Corporate tax", "%", { fmt: "pct" });
    param(T, "thinCap", "Thin capitalisation (share of EBITDA; 0: off)", "%", { fmt: "pct" });
    param(T, "lossLimitOn", "Business losses lapse (1 / 0)", "", { fmt: "int" });

    T.section("Book depreciation, straight line");
    for (const k of ["solar", "wind", "bess", "pcs", "evac", "other"]) linked(T, `slm_${k}`, `${regLabelAll[k]} (over ${S.v(`lifeU_${k}`)} years)`, "₹ cr", { total: true });
    linked(T, "baseDep", "On the project cost (the components together)", "₹ cr", { total: true });
    linked(T, "augDep", "On battery augmentation (over the PPA years left)", "₹ cr", { total: true });
    linked(T, "extDep", "On the life extension (over the extension)", "₹ cr", { total: true });
    linked(T, "rpDep", "On the repowering (over the book life left)", "₹ cr", { total: true });
    linked(T, "bookDepSlm", "Book depreciation, straight line", "₹ cr", { total: true, bold: true });
    T.section("Book depreciation, written down");
    linked(T, "bookWdvOpen", "Book block, opening", "₹ cr", { total: false });
    linked(T, "capexOps", "Added: the year's capital spend", "₹ cr", { total: true });
    linked(T, "bookWdvDep", "Book depreciation, written down", "₹ cr", { total: true, bold: true });
    linked(T, "bookWdvClose", "Book block, closing", "₹ cr", { total: false });
    T.section("The books");
    linked(T, "bookDep", "Book depreciation (the basis chosen)", "₹ cr", { total: true, bold: true });
    linked(T, "grossBlock", "Gross block", "₹ cr", { total: false });
    linked(T, "accDep", "Accumulated depreciation", "₹ cr", { total: false });
    linked(T, "netBlock", "Net block", "₹ cr", { total: false, bold: true });

    T.section("Tax depreciation");
    linked(T, "wdvOpen", "Tax block, opening", "₹ cr", { total: false });
    linked(T, "wdvAdd", "Added: the year's capital spend", "₹ cr", { total: true });
    linked(T, "taxDepWdv", "Tax depreciation, written down", "₹ cr", { total: true });
    linked(T, "wdvClose", "Tax block, closing", "₹ cr", { total: false });
    linked(T, "taxDepSlm", "Tax depreciation, straight line", "₹ cr", { total: true });
    linked(T, "taxDep", "Tax depreciation (the basis chosen)", "₹ cr", { total: true, bold: true });
    own(T, "depDiff", "Tax depreciation less book depreciation (timing difference)", "₹ cr", {
      f: (y) => `${T.at("taxDep", y)}-${T.at("bookDep", y)}`, v: (y) => S.v("taxDep", y) - S.v("bookDep", y), total: true,
    });
    own(T, "deferredTax", "Deferred tax on the difference (at the tax rate)", "₹ cr", {
      f: (y) => `${T.at("depDiff", y)}*${T.s("taxRate")}`, v: (y) => (S.v("taxDep", y) - S.v("bookDep", y)) * S.v("taxRate"), total: true,
      note: "Positive: tax deferred this year; negative: earlier deferrals reversing",
    });

    T.section("Tax computation");
    linked(T, "shInt", "Interest on the mezzanine and the quasi-equity (paid)", "₹ cr", { total: true });
    linked(T, "intBf", "Disallowed interest brought forward", "₹ cr", { total: false });
    linked(T, "allowedSh", "Deductible of them (thin capitalisation)", "₹ cr", { total: true });
    linked(T, "intDisallowed", "Interest disallowed this year", "₹ cr", { total: true });
    linked(T, "intCf", "Disallowed interest carried forward", "₹ cr", { total: false });
    linked(T, "preTaxable", "Taxable profit before losses brought forward", "₹ cr", { total: false });
    linked(T, "lossBf", "Business losses brought forward", "₹ cr", { total: false });
    linked(T, "lossUsed", "Business losses set off", "₹ cr", { total: true });
    linked(T, "depBf", "Unabsorbed depreciation brought forward", "₹ cr", { total: false });
    linked(T, "depUsed", "Unabsorbed depreciation set off", "₹ cr", { total: true });
    linked(T, "taxable", "Taxable income", "₹ cr", { total: true });
    linked(T, "lossAdd", "Business loss of the year", "₹ cr", { total: true });
    linked(T, "depAdd", "Unabsorbed depreciation of the year", "₹ cr", { total: true });
    linked(T, "lossCf", "Business losses carried forward", "₹ cr", { total: false });
    linked(T, "depCf", "Unabsorbed depreciation carried forward", "₹ cr", { total: false });
    linked(T, "tax", "Tax", "₹ cr", { total: true, bold: true });
    own(T, "effRate", "Effective tax rate on profit before tax", "%", {
      f: (y) => `IF(${link("pbt", y)}>0,${T.at("tax", y)}/${link("pbt", y)},"")`,
      v: (y) => (S.v("pbt", y) > 0 ? S.v("tax", y) / S.v("pbt", y) : ""), fmt: "pct",
    });
  }

  // ---- working capital
  {
    const { T } = open(WORKING_CAPITAL_SHEET, "Working capital", "The working capital held at each year end per the CERC norms (receivables, O&M in hand, maintenance spares), the cash it takes or releases, and the interest on it. Linked to the Live model.", "FF375623");
    T.section("Norms");
    param(T, "recvDays", "Receivable days", "days", { fmt: "int" });
    param(T, "omMonths", "O&M in hand", "months", { fmt: "num" });
    param(T, "sparesPct", "Maintenance spares", "% of the year's O&M", { fmt: "pct" });
    param(T, "wcRate", "Interest on working capital", "%/yr", { fmt: "pct" });
    T.section("Working capital held at the year end");
    linked(T, "revenue", "Revenue of the year", "₹ cr", { total: true });
    linked(T, "omCr", "O&M of the year", "₹ cr", { total: true });
    linked(T, "recv", "Receivables", "₹ cr", { total: false });
    linked(T, "omStock", "O&M in hand", "₹ cr", { total: false });
    linked(T, "spares", "Maintenance spares", "₹ cr", { total: false });
    linked(T, "wcBal", "Working capital", "₹ cr", { total: false, bold: true });
    own(T, "wcDays", "Working capital in days of revenue", "days", {
      f: (y) => `IF(${T.at("revenue", y)}>0,${T.at("wcBal", y)}/${T.at("revenue", y)}*365,"")`,
      v: (y) => (S.v("revenue", y) > 0 ? (S.v("wcBal", y) / S.v("revenue", y)) * 365 : ""), fmt: "num",
    });
    T.section("Cash and cost");
    linked(T, "dWc", "Increase in working capital (cash out; negative: released)", "₹ cr", { total: true });
    linked(T, "wcInt", "Interest on working capital (expensed)", "₹ cr", { total: true });
    own(T, "released", "Released at the end of the term", "₹ cr", {
      f: (y) => `IF(${T.yr(y)}=${one("years")},${T.at("wcBal", y)},0)`, v: (y) => (y === N ? S.v("wcBal", y) : 0), total: true,
    });
  }

  // ---- tax schedule: the pools by year of origin (the layout fixed before the Live model was built)
  {
    const ws = sheetOf(wb, sheets, TAX_SHEET, "FF833C0B");
    const T = new Sheet(ws, N);
    let r = T.next();
    r.getCell(1).value = "Tax schedule: the losses and the disallowed interest by year of origin";
    r.getCell(1).font = { bold: true, size: 14 };
    r = T.next();
    r.getCell(1).value = `Each year's loss and disallowed interest is a vintage: available from the next year, set off oldest first, and lapsed when its carry-forward limit passes (business losses: the years on the Inputs sheet, none when blank; disallowed interest: ${INT_LAPSE_YEARS} years; unabsorbed depreciation never lapses and is one pool on the Live model). The Live model reads the totals; the blocks read the Live model.`;
    r.getCell(1).font = { italic: true, color: { argb: "FF777777" } };
    r = T.next();
    T.yearRow = T.row;
    ["₹ crore", "Origin", "Total", "Year 0"].forEach((t, i) => { r.getCell(i + 1).value = t; });
    for (let y = 1; y <= N; y += 1) { const c = r.getCell(4 + y); c.value = { formula: `${L}${S.col(y)}${yearRow}`, result: y }; c.numFmt = FMT.year; }
    for (let c = 1; c <= 4 + N; c += 1) { const cell = r.getCell(c); cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; cell.alignment = { horizontal: c > 2 ? "right" : "left" }; }
    T.series("yearStart", "Year starts", "date", { f: (y) => link("yearStart", y), v: (y) => S.v("yearStart", y), fmt: "month" });
    T.datesRow = T.cell.yearStart;
    if (T.row !== 4) throw new Error("the Tax schedule's dates row must be row 4 (taxLayout)");
    const block = (b, title, rowF, rowV, { total = true } = {}) => {
      T.row = b.head - 1;
      T.group(title);
      for (let i = 1; i <= N; i += 1) {
        const rr = T.next();
        rr.getCell(1).value = `Vintage of year ${i}`;
        rr.getCell(1).alignment = { indent: 1 };
        rr.getCell(2).value = i;
        rr.getCell(2).numFmt = FMT.int;
        for (let y = 1; y <= N; y += 1) T.put(rr.getCell(4 + y), { f: rowF(i, y), v: rowV(i, y), fmt: "cr" });
      }
      if (total) {
        const tr = T.next();
        tr.getCell(1).value = `${title}: total`;
        tr.getCell(1).font = { bold: true };
        for (let y = 1; y <= N; y += 1) {
          const col = T.col(y);
          T.put(tr.getCell(4 + y), { f: `SUM(${col}${b.first}:${col}${b.first + N - 1})`, v: sumOf(Array.from({ length: N }, (_, i) => rowV(i + 1, y))), fmt: "cr", bold: true });
        }
        if (tr.number !== b.total) throw new Error("tax layout drift");
      }
    };
    const cellOf = (b, i, y) => `${T.col(y)}${b.first + i - 1}`;
    const above = (b, i, y) => (i === 1 ? "0" : `SUM(${T.col(y)}${b.first}:${T.col(y)}${b.first + i - 2})`);
    const yr = (y) => T.yr(y);
    block(TL.lossAv, "Business losses available at the start of the year",
      (i, y) => `IF(OR(${yr(y)}<=${i},AND(${one("lossLimitOn")}=1,${yr(y)}-${i}>N(${one("lossCarryIn")}))),0,${y === 1 ? "0" : cellOf(TL.lossBal, i, y - 1)})`,
      (i, y) => pools.lossAv[i][y]);
    block(TL.lossUse, "Business losses set off (oldest first)",
      (i, y) => `IF(${link("preTaxable", y)}>0,MIN(${cellOf(TL.lossAv, i, y)},MAX(0,${link("preTaxable", y)}-${above(TL.lossUse, i, y)})),0)`,
      (i, y) => pools.lossUse[i][y]);
    block(TL.lossBal, "Business losses carried at the year end",
      (i, y) => `IF(${yr(y)}=${i},${link("lossAdd", y)},${cellOf(TL.lossAv, i, y)}-${cellOf(TL.lossUse, i, y)})`,
      (i, y) => pools.lossBal[i][y]);
    block(TL.intAv, `Disallowed interest available at the start of the year (lapses after ${INT_LAPSE_YEARS} years)`,
      (i, y) => `IF(OR(${yr(y)}<=${i},${yr(y)}-${i}>${INT_LAPSE_YEARS}),0,${y === 1 ? "0" : cellOf(TL.intBal, i, y - 1)})`,
      (i, y) => pools.intAv[i][y]);
    block(TL.intUse, "Disallowed interest deducted (oldest first, within the allowance)",
      (i, y) => `MIN(${cellOf(TL.intAv, i, y)},MAX(0,${link("allowedSh", y)}-${above(TL.intUse, i, y)}))`,
      (i, y) => pools.intUse[i][y]);
    block(TL.intBal, "Disallowed interest carried at the year end",
      (i, y) => `IF(${yr(y)}=${i},${link("intDisallowed", y)},${cellOf(TL.intAv, i, y)}-${cellOf(TL.intUse, i, y)})`,
      (i, y) => pools.intBal[i][y]);
    T.row = TL.next;
    T.section("The year's tax (from the Live model)");
    linked(T, "preTaxable", "Taxable profit before losses brought forward", "₹ cr", { total: false });
    linked(T, "lossBf", "Business losses available", "₹ cr", { total: false });
    linked(T, "lossUsed", "Business losses set off", "₹ cr", { total: true });
    linked(T, "lossAdd", "Business loss of the year", "₹ cr", { total: true });
    linked(T, "lossCf", "Business losses carried forward", "₹ cr", { total: false });
    linked(T, "depBf", "Unabsorbed depreciation available", "₹ cr", { total: false });
    linked(T, "depUsed", "Unabsorbed depreciation set off", "₹ cr", { total: true });
    linked(T, "depCf", "Unabsorbed depreciation carried forward", "₹ cr", { total: false });
    linked(T, "shInt", "Interest on the mezzanine and the quasi-equity", "₹ cr", { total: true });
    linked(T, "allowedSh", "Deductible of it, with the pool brought forward", "₹ cr", { total: true });
    linked(T, "intDisallowed", "Interest disallowed this year", "₹ cr", { total: true });
    linked(T, "intCf", "Disallowed interest carried forward", "₹ cr", { total: false });
    linked(T, "taxable", "Taxable income", "₹ cr", { total: true });
    linked(T, "tax", "Tax", "₹ cr", { total: true, bold: true });
    ws.getColumn(1).width = 50; ws.getColumn(2).width = 10; ws.getColumn(3).width = 14; ws.getColumn(4).width = 10;
    for (let y = 1; y <= N; y += 1) ws.getColumn(4 + y).width = 12;
    ws.views = [{ state: "frozen", xSplit: 3, ySplit: 4, topLeftCell: "D5", showGridLines: false }];
  }

  // ---- returns: the flows of every party and their returns, the lender's dated flows
  let lenderXirrCell = "$C$1";
  {
    const { T } = open(RETURNS_SHEET, "Returns", "The cash flows of the SPV's equity (after and before tax), the unlevered project (after and before tax), the holding company, the promoter and the lender, with each one's return; the lender's flows dated by construction month and year end for the XIRR. Linked to the Live model.", "FF7030A0");
    T.section("Cash flows (year 0: the investment)");
    linked(T, "fcfe", "SPV equity, after tax", "₹ cr", { bold: true });
    linked(T, "preTaxEq", "SPV equity, before tax", "₹ cr");
    linked(T, "projCf", "Project, unlevered, after tax", "₹ cr", { bold: true });
    linked(T, "preTaxProj", "Project, unlevered, before tax", "₹ cr");
    linked(T, "holdcoCf", "Holding company (equity and quasi-equity in; dividends, quasi-equity interest and repayments out, less expenses)", "₹ cr");
    linked(T, "promoterCf", "Promoter (the share of the holding company)", "₹ cr");
    linked(T, "lenderCf", "Lender (the debt out; service, sweep and fees back; a top-up out)", "₹ cr");
    T.section("Returns");
    const irrRow = (key, text, flowKey) => {
      const v = irr(S.val[flowKey].slice(0, N + 1));
      single(T, key, text, "%", { f: `IFERROR(IRR(${T.span(flowKey, 0)}),"n/a")`, v: v ?? "n/a", fmt: "pct", bold: key === "equityIrr" });
    };
    irrRow("equityIrr", "Equity IRR (levered, after tax)", "fcfe");
    irrRow("preTaxEquityIrr", "Equity IRR before tax", "preTaxEq");
    irrRow("projectIrr", "Project IRR (unlevered, after tax)", "projCf");
    irrRow("preTaxProjectIrr", "Project IRR before tax", "preTaxProj");
    irrRow("holdcoIrr", "Holding company IRR", "holdcoCf");
    irrRow("promoterIrr", "Promoter IRR", "promoterCf");
    param(T, "reinvestU", "Lender's reinvestment rate (MIRR)", "%/yr", { fmt: "pct" });
    param(T, "rate", "Lender's finance rate (MIRR): the interest rate", "%/yr", { fmt: "pct" });
    {
      const v = debt0 > 0 ? mirrOf(S.val.lenderCf.slice(0, N + 1), S.v("rate"), S.v("reinvestU")) : NaN;
      single(T, "lenderMirr", "Lender's MIRR (yearly flows)", "%", { f: `IFERROR(MIRR(${T.span("lenderCf", 0)},${T.s("rate")},${T.s("reinvestU")}),"n/a")`, v: finite(v) ? v : "n/a", fmt: "pct" });
    }
    for (const [key, text] of [["dscr", "Minimum DSCR"], ["fscr", "Minimum FSCR"], ["llcr", "Minimum LLCR"], ["plcr", "Minimum PLCR"], ["totalDscr", "Minimum DSCR including the mezzanine"]]) {
      const d = S.val[key].slice(1).filter(finite);
      single(T, `min_${key}`, text, "×", { f: `IF(COUNT(${L}${S.span(key)})=0,"",MIN(${L}${S.span(key)}))`, v: d.length ? Math.min(...d) : "", fmt: "x" });
    }
    T.section("The lender's dated flows (the draws by construction month, the service at each year's end)");
    param(T, "cod", "Commercial operation date (blank: 1 January 2028 for the dates)", "date", { fmt: "date" });
    single(T, "nominalCod", "Date the flows are reckoned from", "date", { f: `IF(ISNUMBER(${T.s("cod")}),${T.s("cod")},DATE(2028,1,1))`, v: nominalCod, fmt: "date" });
    const hr = T.next();
    ["Flow", "", "Date", "Amount (₹ cr)"].forEach((t, i) => { const c = hr.getCell(i + 1); c.value = t || null; c.font = { bold: true, color: { argb: "FF555555" } }; c.alignment = { horizontal: i > 1 ? "right" : "left" }; });
    const first = T.row + 1;
    let k = 0;
    const drawRow = (text, dateF_, dateV, amtF, amtV) => {
      const rr = T.next();
      rr.getCell(1).value = text;
      rr.getCell(1).alignment = { indent: 1 };
      T.put(rr.getCell(3), { f: dateF_, v: dateV, fmt: "date" });
      T.put(rr.getCell(4), { f: amtF, v: amtV, fmt: "cr" });
      k += 1;
    };
    if (consM > 0) {
      for (let mo = 1; mo <= consM; mo += 1) {
        drawRow(`Draw, construction month ${mo}`, dateF(T.s("nominalCod"), mo - consM - 1), shiftSerial(nominalCod, mo - consM - 1), `-'${CONSTRUCTION_SHEET}'!$${cons.debtCol}$${cons.firstRow + mo - 1}`, -cons.debtByMonth[mo - 1]);
      }
    } else drawRow("Draw at the COD", T.s("nominalCod"), nominalCod, `-${one("debt")}`, -debt0);
    for (let y = 1; y <= N; y += 1) drawRow(`Year ${y}: service, sweep and fees, less a top-up`, dateF(T.s("nominalCod"), 12 * y, -1), shiftSerial(nominalCod, 12 * y, -1), link("lenderCf", y), S.v("lenderCf", y));
    const last = T.row;
    const xv = debt0 > 0 ? xirrOf(lenderDated.map((f) => ({ date: new Date(EPOCH + f.date * DAY_MS).toISOString().slice(0, 10), amount: f.amount }))) : NaN;
    single(T, "lenderXirr", "Lender's XIRR (dated flows)", "%", { f: `IFERROR(XIRR($D$${first}:$D$${last},$C$${first}:$C$${last}),"n/a")`, v: finite(xv) ? xv : "n/a", fmt: "pct", bold: true, note: "Annual compounding on the days between the flows, as the app" });
    lenderXirrCell = T.s("lenderXirr");
    void k;
  }

  // ---- guarantees and reserves
  {
    const { T } = open(GUARANTEES_SHEET, "Guarantees and reserves", "The guarantees (EMD, PBG, connectivity BG, statutory BG, surety bonds): their fees while they run and their margin money with its interest; the debt service reserve on its basis (the next year's debt service or the peak of the years left), its movements and its interest. Linked to the Live model and the Inputs sheet.", "FF9C5700");
    T.section("Guarantees (from the Inputs sheet)");
    const hr = T.next();
    ["Guarantee", "", "₹ cr", "Fee %/yr", "Margin %", "Margin interest", "From year", "Years", "First op. year", "Last op. year"].forEach((t, i) => { const c = hr.getCell(i + 1); c.value = t || null; c.font = { bold: true, color: { argb: "FF555555" } }; c.alignment = { horizontal: i > 1 ? "right" : "left" }; });
    for (let i = 1; i <= SLOTS; i += 1) {
      const rr = T.next();
      T.put(rr.getCell(1), { f: `IF(${S.s(`bg${i}_label`)}="","",${S.s(`bg${i}_label`)})`, v: S.v(`bg${i}_label`) || "", fmt: "text" });
      [["amt", "cr"], ["fee", "pct"], ["marginPct", "pct"], ["marginRate", "pct"], ["from", "int"], ["years", "int"], ["fromU", "int"], ["toU", "int"]].forEach(([f, fmt], j) => {
        const v = S.v(`bg${i}_${f}`);
        T.put(rr.getCell(3 + j), { f: v === null || v === undefined ? `IF(ISBLANK(${S.s(`bg${i}_${f}`)}),"",${S.s(`bg${i}_${f}`)})` : S.s(`bg${i}_${f}`), v: v ?? "", fmt });
      });
    }
    T.section("By year");
    own(T, "bgFees0", "Fees over the construction (in the project cost)", "₹ cr", { y0: { f: one("bgFees0"), v: S.v("bgFees0") }, f: () => "0", v: () => 0 });
    linked(T, "bgFees", "Guarantee fees (expensed)", "₹ cr", { total: true });
    linked(T, "marginBal", "Margin money blocked", "₹ cr", { total: false });
    linked(T, "dMargin", "Put into (released from) the margin money", "₹ cr", { total: true });
    linked(T, "marginInt", "Interest on the margin money (other income)", "₹ cr", { total: true });
    T.section("Debt service reserve");
    param(T, "dsraMonths", "Months of debt service held", "months", { fmt: "num" });
    param(T, "dsraBasis", "Basis (next / peak)", "", { fmt: "text" });
    param(T, "dsraRate", "Interest earned on the reserve", "%/yr", { fmt: "pct" });
    linked(T, "debtService", "Debt service of the year", "₹ cr", { total: true });
    own(T, "nextDs", "Next year's debt service", "₹ cr", { f: (y) => (y < N ? link("debtService", y + 1) : "0"), v: (y) => (y < N ? S.v("debtService", y + 1) : 0) });
    own(T, "peakDs", "Highest debt service of the years left", "₹ cr", { f: (y) => (y < N ? `MAX(${L}${S.col(y + 1)}${S.cell.debtService}:${L}${S.last}${S.cell.debtService})` : "0"), v: (y) => (y < N ? Math.max(...S.val.debtService.slice(y + 1, N + 1)) : 0) });
    linked(T, "dsra", "Reserve held", "₹ cr", { total: false, bold: true });
    linked(T, "dDsra", "Put into (released from) the reserve", "₹ cr", { total: true });
    linked(T, "dsraInt", "Interest earned (other income)", "₹ cr", { total: true });
    linked(T, "otherIncome", "Other income (reserve and margin interest)", "₹ cr", { total: true, bold: true });
  }

  // ---- quasi-equity and mezzanine
  {
    const { T } = open(MEZZ_SHEET, "Quasi-equity and mezzanine", "The mezzanine (interest every year, principal per its schedule, ranking below the senior debt) and the quasi-equity from the holding company (interest and repayments paid when the senior DSCR clears the lender's floor and the cash allows; the rest accrues). Linked to the Live model and the Inputs sheet.", "FF5B9BD5");
    T.section("Mezzanine terms");
    param(T, "mezz0", "Mezzanine", "₹ cr");
    param(T, "mezzRate", "Interest", "%/yr", { fmt: "pct" });
    param(T, "mezzTenorU", "Tenor used", "years", { fmt: "int" });
    param(T, "mezzGraceU", "Moratorium used", "years", { fmt: "int" });
    param(T, "mezzRepay", "Repayment (equal / bullet)", "", { fmt: "text" });
    param(T, "mezzFeeCr", "Arrangement fee (in the project cost)", "₹ cr");
    T.section("Mezzanine schedule");
    linked(T, "mezzOpen", "Opening", "₹ cr", { total: false });
    linked(T, "mezzInt", "Interest", "₹ cr", { total: true });
    linked(T, "mezzPrin", "Principal", "₹ cr", { total: true });
    linked(T, "mezzClose", "Closing", "₹ cr", { total: false, bold: true });
    linked(T, "mezzService", "Mezzanine service", "₹ cr", { total: true, bold: true });
    linked(T, "totalDscr", "DSCR including the mezzanine", "×", { fmt: "x", total: false });
    T.section("Quasi-equity terms");
    param(T, "quasi0", "Quasi-equity", "₹ cr");
    param(T, "quasiRate", "Interest", "%/yr", { fmt: "pct" });
    param(T, "quasiMinDscr", "Lender's DSCR floor for payments", "×", { fmt: "x" });
    param(T, "quasiFrom", "Repaid from year", "year", { fmt: "int" });
    T.section("Quasi-equity schedule");
    linked(T, "quasiOpen", "Opening", "₹ cr", { total: false });
    linked(T, "dscr1", "Senior DSCR tested (pre-sweep CFADS ÷ debt service)", "×", { fmt: "x", total: false });
    linked(T, "quasiOk", "Lender's floor cleared (1 / 0)", "", { fmt: "int", total: false });
    linked(T, "quasiCash", "Cash available", "₹ cr", { total: false });
    linked(T, "quasiDue", "Interest due (with the accrued)", "₹ cr", { total: false });
    linked(T, "quasiInt", "Interest paid", "₹ cr", { total: true });
    linked(T, "quasiAccr", "Interest accrued", "₹ cr", { total: false });
    linked(T, "quasiRepay", "Repaid", "₹ cr", { total: true });
    linked(T, "quasiClose", "Closing", "₹ cr", { total: false, bold: true });
    T.section("To the holding company");
    linked(T, "fcfe", "Dividends (the SPV's free cash)", "₹ cr", { total: true });
    linked(T, "holdcoCf", "Holding company cash flow", "₹ cr", { total: true, bold: true });
    linked(T, "promoterCf", "Promoter cash flow", "₹ cr", { total: true });
  }
  return { lenderXirrCell };
}

/** The Sensitivity sheet: one-way tables and two-way grids of the app's runs (sensitivityTables), and the reverse-auction axes. */
function addSensitivitySheet(wb, sheets, S, m, sens) {
  const ws = sheetOf(wb, sheets, SENSITIVITY_SHEET, "FFC00000");
  const T = new Sheet(ws, 0);
  const L = `'${LIVE_SHEET}'!`;
  let r = T.next();
  r.getCell(1).value = "Sensitivity";
  r.getCell(1).font = { bold: true, size: 14 };
  r = T.next();
  r.getCell(1).value = `Each point is a full run of TenderOS's financial model on this bid's inputs and yearly energy with one input moved (grey italics: the app's numbers, not formulas, since a tariff solved for a target IRR is not one Excel formula). The base case is checked against the Live model. A CUF change scales the energy delivered and sold in proportion to that source's share of the generation (solar ${(sens.share.solar * 100).toFixed(0)}%, wind ${(sens.share.wind * 100).toFixed(0)}%); the dispatch, the floors and the storage are not rerun — for that, use the What-if in TenderOS. For any other point, change the blue inputs on the Inputs sheet and Goal Seek the tariff.`;
  r.getCell(1).font = { italic: true, color: { argb: "FF777777" } };
  r.getCell(1).alignment = { wrapText: true, vertical: "top" };
  r.height = 64;
  ws.mergeCells(`A${T.row}:J${T.row}`);
  T.blank();

  T.section("Base case");
  const baseRow = (text, unit, f, v, app, fmt) => {
    const rr = T.next();
    T.label(rr, text, unit, { indent: 1 });
    T.put(rr.getCell(3), { f, v, fmt });
    T.put(rr.getCell(4), { v: app, fmt, kind: "app" });
    T.put(rr.getCell(5), { f: `IF(ISNUMBER(C${T.row}),IF(ABS(C${T.row}-D${T.row})<=0.000001,"Yes","Changed"),"")`, v: Math.abs(v - app) <= 1e-6 ? "Yes" : "Changed", fmt: "text" });
  };
  r = T.next();
  ["", "", "Live model", "App's run", "Same?"].forEach((t, i) => { const c = r.getCell(i + 1); c.value = t; c.font = { bold: true }; });
  const tariffRef = S.s("tariff");
  baseRow(sens.tariffLocked ? "Tariff (fixed in the bid)" : "Tariff for the target equity IRR", "₹/kWh", tariffRef, S.v("tariff"), sens.tariffLocked ? sens.tariff : sens.base.tariff, "tariff");
  baseRow("Target equity IRR", "%", S.s("targetIrr"), S.v("targetIrr"), sens.targetIrr, "pct");
  if (sens.tariffLocked) {
    const rr = T.next();
    T.label(rr, "Tariff the target equity IRR would need", "₹/kWh", { indent: 1 });
    T.put(rr.getCell(4), { v: sens.base.tariff, fmt: "tariff", kind: "app" });
  }

  for (const t of sens.oneWay) {
    T.section(t.title);
    r = T.next();
    ["Change", t.unit === "change" ? "" : t.unit === "rate" ? "Rate" : "CUF", "Tariff for the target IRR (₹/kWh)", "Change vs base (₹/kWh)", "Equity IRR at the bid tariff", "Minimum DSCR at the bid tariff"].forEach((h, i) => { const c = r.getCell(i + 1); c.value = h; c.font = { bold: true }; c.alignment = { wrapText: true }; });
    let baseCell = null;
    for (const pt of t.points) {
      const rr = T.next();
      const isBase = pt.step === 0;
      T.put(rr.getCell(1), { v: pt.step, fmt: t.key === "rate" ? '+0.00%;-0.00%;"base"' : '+0%;-0%;"base"', kind: "app", bold: isBase });
      if (t.unit !== "change") T.put(rr.getCell(2), { v: pt.value, fmt: "pct", kind: "app" });
      T.put(rr.getCell(3), { v: pt.tariff, fmt: "tariff", kind: "app", bold: isBase });
      if (isBase) baseCell = `$C$${T.row}`;
      T.put(rr.getCell(5), { v: finite(pt.irr) ? pt.irr : "", fmt: "pct", kind: "app" });
      T.put(rr.getCell(6), { v: finite(pt.dscr) ? pt.dscr : "", fmt: "x", kind: "app" });
    }
    // the deltas as formulas against the base row
    for (let k = 0; k < t.points.length; k += 1) {
      const rowNo = T.row - t.points.length + 1 + k;
      T.put(ws.getCell(`D${rowNo}`), { f: `C${rowNo}-${baseCell}`, v: t.points[k].tariff - sens.base.tariff, fmt: '+0.000;-0.000;"–"' });
    }
  }

  for (const g of sens.grids) {
    T.section(g.title);
    r = T.next();
    r.getCell(1).value = `${g.rows.title} ↓ · ${g.cols.title} →`;
    r.getCell(1).font = { bold: true };
    g.cols.steps.forEach((c, j) => T.put(r.getCell(2 + j), { v: c, fmt: g.cols.key === "rate" ? '+0.00%;-0.00%;"base"' : '+0%;-0%;"base"', kind: "app", bold: c === 0 }));
    g.rows.steps.forEach((rs, i) => {
      const rr = T.next();
      T.put(rr.getCell(1), { v: rs, fmt: g.rows.key === "rate" ? '+0.00%;-0.00%;"base"' : '+0%;-0%;"base"', kind: "app", bold: rs === 0 });
      g.cols.steps.forEach((c, j) => T.put(rr.getCell(2 + j), { v: g.tariff[i][j], fmt: "tariff", kind: "app", bold: rs === 0 && c === 0 }));
    });
  }

  // the reverse-auction axes (finance v3): the app's runs, one row per case
  if (sens.auction) {
    const a = sens.auction;
    T.section("Reverse auction: the tariff the target equity IRR needs with one input moved (the app's runs)");
    r = T.next();
    ["Axis", "Case", "Tariff for the target IRR (₹/kWh)", "Change vs the bid (₹/kWh)", "Equity IRR at the bid tariff", "Minimum DSCR at the bid tariff"].forEach((h, i) => { const c = r.getCell(i + 1); c.value = h; c.font = { bold: true }; c.alignment = { wrapText: true }; });
    const rr = T.next();
    T.put(rr.getCell(1), { v: "Bid", kind: "app", bold: true });
    T.put(rr.getCell(2), { v: a.base.label, kind: "app" });
    T.put(rr.getCell(3), { v: a.base.tariff, fmt: "tariff", kind: "app", bold: true });
    T.put(rr.getCell(5), { v: finite(a.base.equityIrr) ? a.base.equityIrr : "", fmt: "pct", kind: "app" });
    T.put(rr.getCell(6), { v: finite(a.base.minDscr) ? a.base.minDscr : "", fmt: "x", kind: "app" });
    const baseCell = `$C$${T.row}`;
    for (const axis of a.rows) {
      for (const c of axis.cases) {
        const row = T.next();
        T.put(row.getCell(1), { v: axis.label, kind: "app" });
        T.put(row.getCell(2), { v: c.label, kind: "app" });
        T.put(row.getCell(3), { v: c.tariff, fmt: "tariff", kind: "app" });
        T.put(row.getCell(4), { f: `C${T.row}-${baseCell}`, v: c.tariff - a.base.tariff, fmt: '+0.000;-0.000;"–"' });
        T.put(row.getCell(5), { v: finite(c.equityIrr) ? c.equityIrr : "", fmt: "pct", kind: "app" });
        T.put(row.getCell(6), { v: finite(c.minDscr) ? c.minDscr : "", fmt: "x", kind: "app" });
      }
    }
    const note = T.next();
    note.getCell(1).value = "The module cost moves the modules' share of the solar capital cost; the exchange rate moves the dollar share of the capital cost (both on the Inputs sheet); a commissioning delay runs the whole plant late; a longer life adds years at the price beyond the PPA.";
    note.getCell(1).font = { italic: true, color: { argb: "FF777777" } };
  }
  ws.getColumn(1).width = 44;
  for (let c = 2; c <= 10; c += 1) ws.getColumn(c).width = 16;
  ws.views = [{ state: "frozen", ySplit: 3, showGridLines: false }];
  return ws;
}

/**
 * The sizing's hour-by-hour dispatch of its modelled years (rtc_lp.solve returnDispatch), checked:
 * 8,760 finite numbers per series, at most six modelled years, weights for every PPA year. Null
 * when absent or malformed (the Live model then shows the optimiser's yearly energy as values).
 */
function dispatchInput(d, years) {
  const H = 8760;
  if (!d || typeof d !== "object" || !Array.isArray(d.byYear) || !d.byYear.length || d.byYear.length > 6) return null;
  const series = (a, lo = 0, hi = 1e7) => (Array.isArray(a) && a.length === H && a.every((v) => finite(v) && v >= lo - 1e-6 && v <= hi) ? a.map((v) => Math.max(lo, v)) : null);
  const num = (v, lo, hi) => (finite(v) && v >= lo && v <= hi ? v : null);
  const solar = Boolean(d.solar);
  const wind = Boolean(d.wind);
  const sell = Boolean(d.sell);
  const blocks = Boolean(d.blocks);
  const out = {
    solar, wind, sell, blocks,
    contract: num(d.contract, 1e-6, 1e6), poi: num(d.poi, 0.5, 1), eta: num(d.eta, 0.5, 1),
    minSoc: num(d.minSoc, 0, 1), maxSoc: num(d.maxSoc, 0, 1), initSoc: num(d.initSoc, 0, 1),
    peakFloor: blocks ? num(d.peakFloor, 0, 1) : 0, offFloor: blocks ? num(d.offFloor, 0, 1) : 0,
    solarCf: solar ? series(d.solarCf, 0, 2) : null, windCf: wind ? series(d.windCf, 0, 2) : null,
    peak: blocks ? series(d.peak, 0, 1) : null,
  };
  // Amendment-03: the Solar Hours outside the Peak Hours, their floor and the most the buyer takes
  if (blocks && d.solarHours != null) {
    Object.assign(out, { solarHours: series(d.solarHours, 0, 1), solarFloor: num(d.solarFloor, 0, 1), solarMax: num(d.solarMax, 0, 1) });
    if (out.solarHours === null || out.solarFloor === null || out.solarMax === null) return null;
  }
  const need = ["contract", "poi", "eta", "minSoc", "maxSoc", "initSoc", ...(blocks ? ["peakFloor", "offFloor", "peak"] : []), ...(solar ? ["solarCf"] : []), ...(wind ? ["windCf"] : [])];
  if ((!solar && !wind) || need.some((k) => out[k] === null)) return null;
  out.byYear = d.byYear.map((y) => ({
    year: Number.isInteger(y?.year) && y.year >= 1 && y.year <= years ? y.year : null,
    bf: num(y?.bf, 0, 1.5),
    charge: series(y?.charge), discharge: series(y?.discharge), sold: sell ? series(y?.sold) : new Array(H).fill(0),
  }));
  if (out.byYear.some((y) => Object.values(y).some((v) => v === null))) return null;
  const w = d.weights;
  if (!Array.isArray(w) || w.length !== years || !w.every((r) => Array.isArray(r) && r.length === out.byYear.length && r.every((x) => finite(x) && x >= 0 && x <= 1))) return null;
  out.weights = w;
  return out;
}

/**
 * The request's `live` block, checked: numbers are finite (else 0), choices are from their lists,
 * at most 60 years; the finance team's inputs (FINANCE_V3_KEYS) each in its shape, off when absent.
 * Returns null when there is no year to model.
 */
export function liveModelInput(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.ops) || !raw.ops.length) return null;
  const n = (v) => (finite(v) ? v : 0);
  const nOr = (v, d) => (finite(v) ? v : d);
  const nn = (v) => (finite(v) ? v : null); // a number, or null for "blank: the fallback applies"
  const nums = (o, keys) => Object.fromEntries(keys.map((k) => [k, n(o?.[k])]));
  const text = (s, max = 80) => (typeof s === "string" ? s.replace(/[^\w ()·,.%/&'-]/g, "").slice(0, max) : "");
  const list = (arr, max = SLOTS) => (Array.isArray(arr) ? arr.slice(0, max).filter((x) => x && typeof x === "object") : []);
  const fin = raw.fin || {};
  const costs = raw.costs || {};
  const bess = raw.bess || {};
  const plantIds = ["hydro", "thermal"];
  const D = DEFAULT_FINANCE;
  const iso = typeof fin.codDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fin.codDate) && serialOf(fin.codDate) !== null ? fin.codDate : null;
  const ext = fin.extension || {};
  const extYears = Math.max(0, Math.min(35, Math.round(n(ext.years))));
  const phasing = costs.phasing && typeof costs.phasing === "object"
    ? Object.fromEntries(PHASED.filter((k) => costs.phasing[k] && n(costs.phasing[k].months) > 0).map((k) => [k, { start: Math.max(0, Math.round(n(costs.phasing[k].start))), months: Math.max(1, Math.round(n(costs.phasing[k].months))) }]))
    : {};
  const lives = fin.lives && typeof fin.lives === "object" ? Object.fromEntries(PHASED.map((k) => [k, nn(fin.lives[k])])) : null;
  return {
    title: String(raw.title || "").slice(0, 200),
    tariffLabel: typeof raw.tariffLabel === "string" ? raw.tariffLabel.replace(/[^\w ()·,.%/-]/g, "").slice(0, 40) : null,
    otherCapexLabel: typeof raw.otherCapexLabel === "string" ? raw.otherCapexLabel.replace(/[^\w ()·,.%/'-]/g, "").slice(0, 80) : null,
    engine: raw.engine === "simulation" ? "simulation" : "highs",
    bessNote: typeof raw.bessNote === "string" ? raw.bessNote.slice(0, 120) : null,
    sourceAll: typeof raw.sourceAll === "string" ? raw.sourceAll.slice(0, 80) : null,
    tariff: n(raw.tariff),
    tariffLocked: Boolean(raw.tariffLocked),
    dfrTarget: n(raw.dfrTarget),
    split: Boolean(raw.split),
    market: typeof raw.market === "string" ? raw.market.replace(/[^\w -]/g, "").slice(0, 20) : null,
    sizedLabel: text(raw.sizedLabel, 80) || null, // who sized the plant (the CfD optimiser, a first guess, the bidder)
    on: Object.fromEntries(["solar", "wind", "hydro", "biomass", "thermal", "bess"].map((k) => [k, Boolean(raw.on?.[k])])),
    sizes: nums(raw.sizes, ["solarMw", "windMw", "bessMw", "bessMwh", "biomassMw", "hydroMw", "thermalMw"]),
    costs: {
      ...nums(costs, ["solarCrPerMw", "windCrPerMw", "bessCrPerMwh", "bessPcsCrPerMw", "biomassCrPerMw", "evacuationCr", "otherCapexCr", "preopPct", "constructionMonths"]),
      drawdown: DRAWDOWN_LIST.includes(costs.drawdown) ? costs.drawdown : "linear",
      drawOrder: costs.drawOrder === "equityFirst" ? "equityFirst" : "proRata",
      plants: (Array.isArray(costs.plants) ? costs.plants : []).filter((p) => plantIds.includes(p?.id))
        .map((p) => ({ id: p.id, ...nums(p, ["capexCrPerMw", "fixedLakhPerMw", "energyRsPerKwh", "recRsPerKwh", "escalation"]) })),
      phasing: Object.keys(phasing).length ? phasing : null,
      moduleSharePct: Math.min(1, Math.max(0, nOr(costs.moduleSharePct, 0.45))),
    },
    fin: {
      ...nums(fin, [
        "tariffEscalation", "solarOmLakhPerMw", "windOmLakhPerMw", "bessOmLakhPerMwh", "biomassOmLakhPerMw", "omEscalation", "insurancePct", "otherFixedCr",
        "biomassFuelRsPerKwh", "biomassFuelEscalation", "surplusPrice", "shortfallPenalty", "blockPenaltyMultiple", "debtFraction", "interestRate",
        "tenorYears", "targetEquityIrr", "discountRate", "taxRate", "wdvRate", "bookLifeYears", "salvagePct", "receivableDays",
        "graceYears", "targetDscr", "balloonPct", "stepUpPct", "refiYear", "refiRate", "refiTenorYears", "refiFeePct", "omStockMonths", "sparesPctOm", "wcInterestRate", "dsraMonths",
        "lcCostPct", "lcDays", "cfdPenaltyMultiple", "solarDegradation",
        "prepaymentPct", "dsraInterestRate", "thinCapPct", "capexUsdShare",
      ]),
      lcMinPrice: finite(fin.lcMinPrice) ? fin.lcMinPrice : 10,
      paymentsPerYear: [1, 2, 4, 12].includes(fin.paymentsPerYear) ? fin.paymentsPerYear : 1,
      sellSurplus: Boolean(fin.sellSurplus),
      repayment: REPAYMENT_LIST.includes(fin.repayment) ? fin.repayment : "equal",
      taxDepreciation: fin.taxDepreciation === "wdv" ? "wdv" : "slm",
      bookLifeYears: n(fin.bookLifeYears) > 0 ? fin.bookLifeYears : 25,
      tenorYears: n(fin.tenorYears) > 0 ? fin.tenorYears : 1,
      // the finance team's inputs (docs/dev/FINANCE-V3-SPEC.md), each in its shape
      codDate: iso,
      parts: list(fin.parts).map((p) => ({ share: n(p.share), offsetMonths: Math.round(n(p.offsetMonths)) })),
      bridge: { months: Math.max(0, Math.round(n(fin.bridge?.months))), rate: nn(fin.bridge?.rate), feePct: Math.max(0, n(fin.bridge?.feePct)) },
      generationCase: CASE_LIST.includes(fin.generationCase) ? fin.generationCase : "p50",
      caseFactors: { p75: nOr(fin.caseFactors?.p75, D.caseFactors.p75), p90: nOr(fin.caseFactors?.p90, D.caseFactors.p90) },
      carbon: { enabled: Boolean(fin.carbon?.enabled), tPerMwh: nOr(fin.carbon?.tPerMwh, D.carbon.tPerMwh), pricePerT: nOr(fin.carbon?.pricePerT, D.carbon.pricePerT), years: Math.round(nOr(fin.carbon?.years, D.carbon.years)), escalation: nOr(fin.carbon?.escalation, D.carbon.escalation) },
      extension: { years: extYears, capexCr: Math.max(0, n(ext.capexCr)), tariffRsPerKwh: nn(ext.tariffRsPerKwh), omFactor: nOr(ext.omFactor, 1), degradation: nn(ext.degradation) },
      repower: { year: Math.max(0, Math.round(n(fin.repower?.year))), capexCr: Math.max(0, n(fin.repower?.capexCr)), upliftPct: Math.max(0, n(fin.repower?.upliftPct)) },
      solarOmEscalation: nn(fin.solarOmEscalation), windOmEscalation: nn(fin.windOmEscalation), bessOmEscalation: nn(fin.bessOmEscalation),
      windOmComponents: list(fin.windOmComponents).map((c) => ({ label: text(c.label), lakhPerMw: n(c.lakhPerMw), escalation: nn(c.escalation) })),
      otherFixedLines: list(fin.otherFixedLines).map((l) => ({ label: text(l.label), crPerYear: n(l.crPerYear), escalation: nn(l.escalation) })),
      refiRepayment: REPAYMENT_LIST.includes(fin.refiRepayment) ? fin.refiRepayment : null,
      rateStepDown: { afterYears: Math.max(0, Math.round(n(fin.rateStepDown?.afterYears))), rate: nn(fin.rateStepDown?.rate) },
      topUp: { year: Math.max(0, Math.round(n(fin.topUp?.year))), debtFraction: nn(fin.topUp?.debtFraction) },
      sweep: { pct: Math.max(0, n(fin.sweep?.pct)), fromYear: Math.max(1, Math.round(nOr(fin.sweep?.fromYear, 1))), toYear: finite(fin.sweep?.toYear) ? Math.round(fin.sweep.toYear) : null },
      dsraBasis: fin.dsraBasis === "peak" ? "peak" : "next",
      quasi: { amountCr: Math.max(0, n(fin.quasi?.amountCr)), rate: nOr(fin.quasi?.rate, D.quasi.rate), lenderMinDscr: nOr(fin.quasi?.lenderMinDscr, D.quasi.lenderMinDscr), repayFromYear: Math.max(1, Math.round(nOr(fin.quasi?.repayFromYear, 1))) },
      mezz: { amountCr: Math.max(0, n(fin.mezz?.amountCr)), rate: nOr(fin.mezz?.rate, D.mezz.rate), tenorYears: Math.max(1, Math.round(nOr(fin.mezz?.tenorYears, D.mezz.tenorYears))), graceYears: Math.max(0, Math.round(n(fin.mezz?.graceYears))), repayment: fin.mezz?.repayment === "bullet" ? "bullet" : "equal", feePct: Math.max(0, n(fin.mezz?.feePct)) },
      guarantees: list(fin.guarantees).map((g) => ({ label: text(g.label), amountCr: Math.max(0, n(g.amountCr)), feePct: n(g.feePct), marginPct: n(g.marginPct), marginRate: n(g.marginRate), fromYear: Math.max(0, Math.round(n(g.fromYear))), years: Math.max(0, Math.round(n(g.years))) })),
      bookDepreciation: fin.bookDepreciation === "wdv" ? "wdv" : "slm",
      bookWdvRate: nn(fin.bookWdvRate),
      lives,
      lossCarryYears: n(fin.lossCarryYears) > 0 ? Math.round(fin.lossCarryYears) : null,
      holdco: { expensesCrPerYear: Math.max(0, n(fin.holdco?.expensesCrPerYear)), promoterShare: Math.min(1, Math.max(0, nOr(fin.holdco?.promoterShare, 1))) },
      lenderReinvestRate: nn(fin.lenderReinvestRate),
      fxBase: nOr(fin.fxBase, 83),
    },
    bess: {
      ...nums(bess, ["annualDegradation", "augmentationYear", "costDeclinePct"]),
      augmentation: ["annual", "oneTime", "schedule"].includes(bess.augmentation) ? bess.augmentation : "none",
      augmentationYears: (Array.isArray(bess.augmentationYears) ? bess.augmentationYears : []).filter(finite).slice(0, SLOTS).map((y) => Math.round(y)),
    },
    ops: raw.ops.slice(0, 60).map((o) => ({
      ...nums(o, ["demandMWh", "deliveredMWh", "excessMWh", "buyerExcessMWh", "buyerExcessShare", "biomassMWh", "hydroMWh", "thermalMWh", "blockShortfallMWh", "genBusMWh", "injectedMWh", "trafoLossMWh", "lineLossMWh", "meterMWh", "dsmA", "dsmB", "chargingCostCr", "pxFeesCr", "lcMw", "solarGenMWh", "windGenMWh"]),
      ...(finite(o?.dsmChargeCr) ? { dsmChargeCr: o.dsmChargeCr } : {}),
      // SECI CfD-I: the penalised weeks, at most one per week of the year
      penaltyWeeks: (Array.isArray(o?.penaltyWeeks) ? o.penaltyWeeks : []).slice(0, 54)
        .filter((w) => finite(w?.ref) && finite(w?.beyondMwh) && w.beyondMwh > 0).map((w) => ({ ref: Math.max(0, w.ref), beyondMwh: w.beyondMwh })),
      ...(finite(o?.surplusRevenueCr) ? { surplusRevenueCr: o.surplusRevenueCr } : {}),
      ...(finite(o?.recRevenueCr) ? { recRevenueCr: o.recRevenueCr } : {}),
    })),
    dispatch: dispatchInput(raw.dispatch, raw.ops.length),
    gen: Object.fromEntries(["solar", "wind"].filter((k) => raw.on?.[k] && finite(raw.gen?.[k]?.cuf) && raw.gen[k].cuf > 0).map((k) => {
      const g = raw.gen[k];
      const months = Array.isArray(g.monthCuf) && g.monthCuf.length === 12 && g.monthCuf.every(finite) ? g.monthCuf.map((c) => Math.min(1, Math.max(0, c))) : null;
      return [k, {
        cuf: Math.min(1, g.cuf), monthCuf: months, toBus: Math.min(0.5, Math.max(0, n(g.toBus))),
        degradation: Math.min(0.2, Math.max(0, n(g.degradation))), cufAt: text(g.cufAt), profile: text(g.profile),
      }];
    })),
    sources: Object.fromEntries(Object.entries(raw.sources || {}).slice(0, 200)
      .filter(([k, v]) => /^[\w.]{1,60}$/.test(k) && typeof v === "string").map(([k, v]) => [k, v.slice(0, 80)])),
    app: Object.fromEntries(Object.entries(raw.app || {}).slice(0, 40)
      .filter(([k, v]) => /^\w{1,40}$/.test(k) && (finite(v) || typeof v === "string")).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 40) : v])),
  };
}
