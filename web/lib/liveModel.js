// Tender to Bid: the "Live model" sheet of the bid workbook. The same 25-year financial model as
// the app (web/src/rtc/engine.js cashflows), written as Excel formulas: every number is a formula
// on the inputs (blue on yellow) and on the optimiser's year-by-year energy (green), so the bidder
// can change an input and see the tariff's returns move. Each formula cell also carries its value,
// worked out here line by line the same way, so viewers that do not recalculate still show it;
// tools/check_live_model.mjs recalculates the sheet with LibreOffice and checks both against the app.
//
// Units: energy in MU (million kWh), money in ₹ crore, prices in ₹/kWh. MU × ₹/kWh ÷ 10 = ₹ crore.

import { addDispatchSheet, dispatchRef } from "./dispatchSheets.js";

export const LIVE_SHEET = "Live model";
export const CONSTRUCTION_SHEET = "Construction";
// the construction sheet has at least this many month rows, so the months can be changed in Excel
const MIN_CONSTRUCTION_ROWS = 48;
export const REPAYMENT_LIST = ["equal", "annuity", "sculpted", "balloon", "bullet", "stepUp"];
export const DRAWDOWN_LIST = ["linear", "sCurve", "front", "back"];

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
};

const colName = (n) => {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
};
const finite = (v) => typeof v === "number" && Number.isFinite(v);

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

/** The sheet writer: rows of labels, units, a value or total column, year 0 and the years. */
class Sheet {
  constructor(ws, years) {
    this.ws = ws;
    this.N = years;
    this.row = 0;
    this.cell = {}; // key → "$C$12" (one value) or row number (a year series)
    this.val = {}; // key → value, or [year 0, year 1, ..., year N]
    this.yearRow = 0;
  }

  col(y) { return colName(4 + y); } // year 0 in D, year 1 in E

  get last() { return this.col(this.N); }

  /** A year series' cell in year y (y = 0 is the investment year). */
  at(key, y) { return `${this.col(y)}${this.cell[key]}`; }

  /** A year series across years 1..N. */
  span(key, from = 1) { return `${this.col(from)}${this.cell[key]}:${this.last}${this.cell[key]}`; }

  /** A single value's absolute address. */
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
    if (list) c.dataValidation = { type: "list", allowBlank: false, formulae: [`"${list.join(",")}"`], showErrorMessage: true, errorTitle: "Choose from the list", error: `One of: ${list.join(", ")}` };
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
   * y0 ({ f, v }) fills year 0 (the investment). kind "opt" rows are the optimiser's numbers.
   */
  series(key, text, unit, { f, v, fmt = "cr", kind = "calc", total = false, y0, note, bold }) {
    const r = this.next();
    this.label(r, text, unit, { note, bold, indent: 1 });
    this.cell[key] = this.row;
    const vals = [y0 ? y0.v : null];
    this.val[key] = vals;
    for (let y = 1; y <= this.N; y += 1) vals[y] = v(y);
    if (y0) this.put(r.getCell(4), { f: y0.f, v: y0.v, fmt, kind: y0.kind || "calc", bold });
    for (let y = 1; y <= this.N; y += 1) {
      this.put(r.getCell(4 + y), { f: f ? f(y) : null, v: vals[y], fmt, kind, bold });
    }
    if (total) {
      const sum = vals.slice(1).reduce((a, x) => a + (finite(x) ? x : 0), 0);
      this.put(r.getCell(3), { f: `SUM(${this.span(key)})`, v: sum, fmt, bold: true });
    }
    if (bold) {
      for (let c = 1; c <= 4 + this.N; c += 1) r.getCell(c).border = { top: { style: "thin", color: { argb: INK } } };
    }
    return this.row;
  }
}

/**
 * The Construction sheet: the project cost before IDC spent month by month under the drawdown
 * profile, funded by equity and debt (pro rata or equity first), the interest during construction
 * on the debt drawn (on the balance at the start of the month plus the month's draw), and the IDC
 * capitalised into the debt. Every cell is a formula on the Live model's inputs (linked at the top),
 * with at least MIN_CONSTRUCTION_ROWS month rows so the months can be changed in Excel. Returns the
 * IDC and the Live-model references to its total and to the cost spent.
 * Mirrors web/src/rtc/engine.js constructionSchedule.
 */
function addConstructionSheet(wb, S, { base, months, profile, order, debtPct, rate }) {
  const ws = wb.addWorksheet(CONSTRUCTION_SHEET, { properties: { tabColor: { argb: "FF00703C" } } });
  const L = (key) => `'${LIVE_SHEET}'!${S.s(key)}`;
  const rows = Math.max(MIN_CONSTRUCTION_ROWS, months);
  let r = ws.getRow(1);
  r.getCell(1).value = "Construction: the cost spent month by month, its funding and the interest during construction";
  r.getCell(1).font = { bold: true, size: 14 };
  r = ws.getRow(2);
  r.getCell(1).value = "Linked from the Live model's inputs (change them there). Interest in a month is on the debt at its start plus the month's draw; the IDC is capitalised as debt. The debt share applies to the cost before IDC.";
  r.getCell(1).font = { italic: true, color: { argb: "FF777777" } };
  // the parameters, linked
  const P = {};
  const param = (row, key, text, liveKey, v, fmt) => {
    const rr = ws.getRow(row);
    rr.getCell(1).value = text;
    S.put(rr.getCell(2), { f: L(liveKey), v, fmt });
    P[key] = `$B$${row}`;
  };
  param(4, "base", "Project cost before IDC (₹ cr)", "base", base, "cr");
  param(5, "months", "Construction months", "consMonths", months, "int");
  param(6, "profile", "Drawdown profile", "drawdown", profile, "text");
  param(7, "order", "Funding order", "drawOrder", order, "text");
  param(8, "debtPct", "Debt share of the cost", "debtPct", debtPct, "pct");
  param(9, "rate", "Interest rate (a year)", "rate", rate, "pct");
  const equityTotal = base * (1 - debtPct);
  param(10, "equity", "Equity to put in (₹ cr)", "base", equityTotal, "cr");
  ws.getCell("B10").value = { formula: `${P.base}*(1-${P.debtPct})`, result: equityTotal };
  // the table
  const HEAD = 12;
  const heads = ["Month", "Share of the cost", "Cost drawn", "Equity drawn", "Debt drawn", "Opening debt", "IDC", "Closing debt", "Equity so far"];
  r = ws.getRow(HEAD);
  heads.forEach((h, i) => {
    const c = r.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    c.alignment = { horizontal: i ? "right" : "left" };
  });
  const CUM = { linear: (t) => t, sCurve: (t) => (1 - Math.cos(Math.PI * t)) / 2, front: (t) => 1 - (1 - t) ** 2, back: (t) => t ** 2 }[profile] || ((t) => t);
  const cumF = (t) => `IF(${P.profile}="linear",${t},IF(${P.profile}="sCurve",(1-COS(PI()*${t}))/2,IF(${P.profile}="front",1-(1-${t})^2,${t}^2)))`;
  let cumEq = 0;
  let bal = 0;
  let idc = 0;
  let spent = 0;
  const first = HEAD + 1;
  for (let m = 1; m <= rows; m += 1) {
    const row = first + m - 1;
    const on = m <= months;
    const share = on ? CUM(m / months) - CUM((m - 1) / months) : 0;
    const cost = base * share;
    const equity = on ? (order === "equityFirst" ? Math.min(cost, Math.max(0, equityTotal - cumEq)) : cost * (1 - debtPct)) : 0;
    const debt = cost - equity;
    const opening = bal;
    const i = on ? (opening + debt) * (rate / 12) : 0; // no interest after the construction ends: the debt is in operation
    bal = opening + debt + i;
    idc += i;
    spent += cost;
    const prevEq = cumEq;
    cumEq += equity;
    const rr = ws.getRow(row);
    const A = `$A${row}`;
    const t = (k) => `MIN(1,(${A}${k})/${P.months})`;
    const fs = [
      null,
      `IF(OR(${P.months}<=0,${A}>${P.months}),0,${cumF(t("+0"))}-${cumF(t("-1"))})`,
      `${P.base}*$B${row}`,
      `IF(${P.order}="equityFirst",MIN($C${row},MAX(0,${P.equity}-${m === 1 ? "0" : `$I${row - 1}`})),$C${row}*(1-${P.debtPct}))`,
      `$C${row}-$D${row}`,
      m === 1 ? "0" : `$H${row - 1}`,
      `IF(${A}>${P.months},0,($F${row}+$E${row})*${P.rate}/12)`,
      `$F${row}+$E${row}+$G${row}`,
      `${m === 1 ? "0" : `$I${row - 1}`}+$D${row}`,
    ];
    const vals = [m, share, cost, equity, debt, opening, i, bal, cumEq];
    const fmts = ["int", "pct", "cr", "cr", "cr", "cr", "cr", "cr", "cr"];
    vals.forEach((v, k) => S.put(rr.getCell(k + 1), { f: fs[k], v, fmt: fmts[k] }));
    void prevEq;
  }
  const last = first + rows - 1;
  const totRow = last + 1;
  const tr = ws.getRow(totRow);
  tr.getCell(1).value = "Total";
  tr.getCell(1).font = { bold: true };
  const totals = { 2: ["pct", spent / (base || 1)], 3: ["cr", spent], 4: ["cr", cumEq], 5: ["cr", spent - cumEq], 7: ["cr", idc] };
  for (const [col, [fmt, v]] of Object.entries(totals)) {
    const letter = colName(Number(col));
    S.put(tr.getCell(Number(col)), { f: `SUM(${letter}${first}:${letter}${last})`, v, fmt, bold: true });
  }
  ws.getColumn(1).width = 34;
  for (let c = 2; c <= 9; c += 1) ws.getColumn(c).width = 16;
  ws.views = [{ state: "frozen", ySplit: HEAD, showGridLines: false }];
  return { sheet: ws, idc, spent, idcRef: `'${CONSTRUCTION_SHEET}'!$G$${totRow}`, spentRef: `'${CONSTRUCTION_SHEET}'!$C$${totRow}`, headRow: HEAD, firstRow: first, lastRow: last, totalRow: totRow };
}

/**
 * Add the Live model sheet to an exceljs workbook. m is the request's `live` block (see
 * web/src/bid/exportModel.js liveModelRequest). Returns { sheet, cells } where cells maps the
 * key results (tariff, equityIrr, ...) to their 'Live model'!C.. addresses for other sheets.
 */
export function addLiveModel(wb, m, { dispatchRows = true } = {}) {
  const N = m.ops.length;
  const ws = wb.addWorksheet(LIVE_SHEET, { properties: { tabColor: { argb: "FF0000FF" } } });
  const S = new Sheet(ws, N);
  const sz = m.sizes;
  const co = m.costs;
  const fi = m.fin;
  const bs = m.bess;
  const on = m.on;
  const plant = (id) => (co.plants || []).find((p) => p.id === id) || null;
  const hydro = on.hydro ? plant("hydro") : null;
  const thermal = on.thermal ? plant("thermal") : null;
  const hourly = m.ops.some((o) => finite(o.surplusRevenueCr));
  // where each input came from: the request names some; sourceAll (Round the clock: the tab) names the rest
  const src = (key, fallback = "Your input") => m.sources?.[key] || m.sourceAll || fallback;
  // where the plant and the yearly energy come from: the HiGHS sizing (Tender to Bid) or the
  // tab's hourly simulation of every year (Round the clock)
  const sim = m.engine === "simulation";
  const sized = sim ? "Round the clock plant" : "HiGHS sizing";
  const meter = m.ops.some((o) => finite(o.meterMWh) && o.meterMWh > 0);
  const blocky = m.ops.some((o) => finite(o.blockShortfallMWh) && o.blockShortfallMWh > 0) || (fi.blockPenaltyMultiple || 0) > 0;
  const ys = Array.from({ length: N }, (_, i) => i + 1);

  // ---- title, legend and the year header (frozen)
  let r = S.next();
  r.getCell(1).value = m.title || "Bid financial model";
  r.getCell(1).font = { bold: true, size: 16 };
  r = S.next();
  r.getCell(1).value = `Every number below is a formula on the blue inputs and the ${sim ? "simulated" : "optimiser's"} energy (green). Change a blue cell: the whole model, the returns and the Cover move with it.`;
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

  // ---- key results: filled at the end, once every row they read exists
  S.section("Key results");
  const KEYS = [
    ["tariff", sim ? "Tariff" : "Bid tariff", "₹/kWh", "tariff"],
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
  r.getCell(1).value = `To price ${sim ? "the supply" : "the bid"} again after changing an input: Data › What-If Analysis › Goal Seek, set the cell "Equity IRR less the target" to 0 by changing the ${sim ? "" : "bid "}tariff.`;
  r.getCell(1).font = { italic: true, color: { argb: "FF555555" } };

  // ---- inputs
  S.section("Inputs");
  S.group("Tariff");
  S.one("tariff", sim ? "Tariff" : "Bid tariff", "₹/kWh", { v: m.tariff, kind: "input", fmt: "tariff", source: m.tariffLocked ? "Fixed by you" : "Solved in TenderOS for the target equity IRR" });
  S.one("tariffEsc", "Tariff escalation", "%/yr", { v: fi.tariffEscalation || 0, kind: "input", fmt: "pct", source: src("fin.tariffEscalation") });

  S.group(sim ? "Plant (from the Round the clock tab)" : "Plant (sized by the optimiser)");
  if (on.solar) S.one("solarMw", "Solar", "MW", { v: sz.solarMw || 0, kind: "opt", fmt: "mw", source: sized });
  if (on.wind) S.one("windMw", "Wind", "MW", { v: sz.windMw || 0, kind: "opt", fmt: "mw", source: sized });
  if (on.biomass) S.one("biomassMw", "Biomass", "MW", { v: sz.biomassMw || 0, kind: "opt", fmt: "mw", source: "HiGHS sizing" });
  if (hydro) S.one("hydroMw", "Hydro", "MW", { v: sz.hydroMw || 0, kind: "opt", fmt: "mw", source: "HiGHS sizing" });
  if (thermal) S.one("thermalMw", "Thermal (non-RE)", "MW", { v: sz.thermalMw || 0, kind: "opt", fmt: "mw", source: "HiGHS sizing" });
  if (on.bess) {
    S.one("bessMw", "Battery power", "MW", { v: sz.bessMw || 0, kind: "opt", fmt: "mw", source: m.bessNote || (m.split ? `${sized}, both sites together` : sized) });
    S.one("bessMwh", "Battery energy", "MWh", { v: sz.bessMwh || 0, kind: "opt", fmt: "mw", source: sized });
  }

  S.group("Capital cost");
  if (on.solar) S.one("solarCapex", "Solar", "₹ cr/MW", { v: co.solarCrPerMw || 0, kind: "input", fmt: "num", source: src("solar.capex") });
  if (on.wind) S.one("windCapex", "Wind", "₹ cr/MW", { v: co.windCrPerMw || 0, kind: "input", fmt: "num", source: src("wind.capex") });
  if (on.biomass) S.one("biomassCapex", "Biomass", "₹ cr/MW", { v: co.biomassCrPerMw || 0, kind: "input", fmt: "num", source: src("biomass.capex") });
  if (hydro) S.one("hydroCapex", "Hydro", "₹ cr/MW", { v: hydro.capexCrPerMw || 0, kind: "input", fmt: "num", source: src("hydro.capex") });
  if (thermal) S.one("thermalCapex", "Thermal (non-RE)", "₹ cr/MW", { v: thermal.capexCrPerMw || 0, kind: "input", fmt: "num", source: src("thermal.capex") });
  if (on.bess) {
    S.one("bessCapex", "Battery energy", "₹ cr/MWh", { v: co.bessCrPerMwh || 0, kind: "input", fmt: "num", source: src("bess.capex") });
    S.one("bessPcs", "Battery power conversion", "₹ cr/MW", { v: co.bessPcsCrPerMw || 0, kind: "input", fmt: "num", source: src("costs.bessPcsCrPerMw", "Included in the energy price") });
  }
  S.one("evac", "Transmission / evacuation", "₹ cr", { v: co.evacuationCr || 0, kind: "input", fmt: "cr", source: src("costs.evacuationCr") });
  const consM = Math.max(0, Math.round(co.constructionMonths || 0));
  S.one("preop", consM > 0 ? "Pre-operative cost (IDC worked out below)" : "Pre-operative and IDC", "% of hard cost", { v: co.preopPct || 0, kind: "input", fmt: "pct", source: src("costs.preopPct") });
  S.one("consMonths", "Construction months", "months", { v: consM, kind: "input", fmt: "int", source: src("costs.constructionMonths", "Model default"), note: "0: the IDC is inside the pre-operative share. Else the sheet Construction spends the cost month by month and works out the IDC" });
  S.one("drawdown", "Drawdown profile", "linear / sCurve / front / back", { v: DRAWDOWN_LIST.includes(co.drawdown) ? co.drawdown : "linear", kind: "input", list: DRAWDOWN_LIST, source: src("costs.drawdown", "Model default") });
  S.one("drawOrder", "Funding order", "proRata / equityFirst", { v: co.drawOrder === "equityFirst" ? "equityFirst" : "proRata", kind: "input", list: ["proRata", "equityFirst"], source: src("costs.drawOrder", "Model default") });

  S.group("Operating cost");
  if (on.solar) S.one("solarOm", "Solar O&M", "₹ lakh/MW/yr", { v: fi.solarOmLakhPerMw || 0, kind: "input", fmt: "num", source: src("solar.om") });
  if (on.wind) S.one("windOm", "Wind O&M", "₹ lakh/MW/yr", { v: fi.windOmLakhPerMw || 0, kind: "input", fmt: "num", source: src("wind.om") });
  if (on.bess) S.one("bessOm", "Battery O&M", "₹ lakh/MWh/yr", { v: fi.bessOmLakhPerMwh || 0, kind: "input", fmt: "num", source: src("bess.om") });
  if (on.biomass) S.one("biomassOm", "Biomass O&M", "₹ lakh/MW/yr", { v: fi.biomassOmLakhPerMw || 0, kind: "input", fmt: "num", source: src("biomass.om") });
  S.one("omEsc", "O&M escalation", "%/yr", { v: fi.omEscalation || 0, kind: "input", fmt: "pct", source: src("fin.omEscalation") });
  S.one("insurance", "Insurance", "% of hard cost/yr", { v: fi.insurancePct || 0, kind: "input", fmt: "pct", source: src("fin.insurancePct") });
  S.one("otherFixed", "Other fixed cost", "₹ cr/yr", { v: fi.otherFixedCr || 0, kind: "input", fmt: "cr", source: src("fin.otherFixedCr", "Model default"), note: "Escalates with O&M" });
  if (on.biomass) {
    S.one("fuel", "Biomass fuel", "₹/kWh", { v: fi.biomassFuelRsPerKwh || 0, kind: "input", fmt: "tariff", source: src("biomass.fuel") });
    S.one("fuelEsc", "Biomass fuel escalation", "%/yr", { v: fi.biomassFuelEscalation || 0, kind: "input", fmt: "pct", source: src("biomass.fuelEscalation") });
  }
  if (hydro) {
    S.one("hydroFixed", "Hydro capacity charge", "₹ lakh/MW/yr", { v: hydro.fixedLakhPerMw || 0, kind: "input", fmt: "num", source: src("hydro.fixed") });
    S.one("hydroEnergy", "Hydro energy charge", "₹/kWh", { v: hydro.energyRsPerKwh || 0, kind: "input", fmt: "tariff", source: src("hydro.energy") });
    S.one("hydroEsc", "Hydro escalation", "%/yr", { v: hydro.escalation || 0, kind: "input", fmt: "pct", source: src("hydro.escalation") });
  }
  if (thermal) {
    S.one("thermalFixed", "Thermal capacity charge", "₹ lakh/MW/yr", { v: thermal.fixedLakhPerMw || 0, kind: "input", fmt: "num", source: src("thermal.fixed") });
    S.one("thermalEnergy", "Thermal energy charge", "₹/kWh", { v: thermal.energyRsPerKwh || 0, kind: "input", fmt: "tariff", source: src("thermal.energy") });
    S.one("thermalRec", "RECs for thermal energy", "₹/kWh", { v: thermal.recRsPerKwh || 0, kind: "input", fmt: "tariff", source: src("thermal.rec") });
    S.one("thermalEsc", "Thermal escalation", "%/yr", { v: thermal.escalation || 0, kind: "input", fmt: "pct", source: src("thermal.escalation") });
  }

  S.group("Revenue and supply");
  S.one("sell", "Sell surplus in the market", "Yes / No", { v: fi.sellSurplus ? "Yes" : "No", kind: "input", list: ["Yes", "No"], source: src("market.sell") });
  // SECI FDRE-RTC-V (Amendment-03): the buyer's first right to the Solar Hours excess, at a share of the tariff
  const buyer = m.ops.some((o) => (o.buyerExcessMWh || 0) > 0);
  if (buyer) S.one("buyerShare", "Solar Hours excess taken by the buyer at", "× tariff", { v: m.ops.find((o) => o.buyerExcessShare > 0)?.buyerExcessShare || 0, kind: "input", fmt: "x", source: "Tender", note: "Amendment-03: power above 60% in a Solar Hour goes first to the buyer at 50% of the tariff; it takes it when the market pays more" });
  if (!hourly) S.one("flatPrice", "Market sale price", "₹/kWh", { v: fi.surplusPrice || 0, kind: "input", fmt: "tariff", source: fi.sellSurplus ? "Your input (flat price)" : "Not used: no market sale" });
  S.one("target", "Annual supply floor", "% of contracted", { v: m.dfrTarget || 0, kind: "input", fmt: "pct", source: src("target", "Tender") });
  S.one("penalty", "Shortfall penalty", "₹/kWh short", { v: fi.shortfallPenalty || 0, kind: "input", fmt: "tariff", source: src("fin.shortfallPenalty", "Model default") });
  if (blocky) S.one("blockMult", "Time-block shortfall penalty", "× tariff", { v: fi.blockPenaltyMultiple || 0, kind: "input", fmt: "x", source: src("fin.blockPenaltyMultiple", "Tender"), note: "On the energy short of each time-block's floor, at this multiple of the year's tariff (SECI RTC-TM: 1.5)" });

  if (on.bess) {
    S.group("Battery augmentation");
    S.one("augMethod", "Augmentation", "annual / oneTime / none", { v: bs.augmentation || "none", kind: "input", list: ["annual", "oneTime", "none"], source: src("bess.augmentation") });
    S.one("deg", "Battery capacity fade", "%/yr", { v: bs.annualDegradation || 0, kind: "input", fmt: "pct", source: src("bess.degradation") });
    S.one("augYear", "One-time augmentation year", "year", { v: bs.augmentationYear || 0, kind: "input", fmt: "int", source: src("bess.augmentationYear", "Model default (used with oneTime)") });
    S.one("decline", "Battery price decline", "%/yr", { v: bs.costDeclinePct || 0, kind: "input", fmt: "pct", source: src("bess.costDeclinePct", "Model default") });
  }

  // the hour-by-hour dispatch sheets (dispatchSheets.js) read these
  const dsp = m.dispatch && (m.dispatch.solar ? m.gen?.solar : true) && (m.dispatch.wind ? m.gen?.wind : true) ? m.dispatch : null;
  if (dsp) {
    S.group("Dispatch, hour by hour (sheets Dispatch Y…)");
    S.one("contract", "Contracted capacity", "MW", { v: dsp.contract, kind: "input", fmt: "mw", source: "The bid" });
    S.one("poi", "Share of the energy reaching the meter", "%", { v: dsp.poi, kind: "input", fmt: "pct", source: "Power transformer and line losses", note: "(1 − transformer loss) × (1 − line loss): from the 33 kV bus to the 220 kV billing meter" });
    S.one("rte", "Battery round trip, at the 33 kV bus", "%", { v: dsp.eta ** 2, kind: "input", fmt: "pct", source: src("bess.rte") });
    S.one("eta", "Battery efficiency each way", "%", { f: `SQRT(${S.s("rte")})`, v: dsp.eta, fmt: "pct" });
    S.one("minSoc", "Battery minimum charge", "%", { v: dsp.minSoc, kind: "input", fmt: "pct", source: src("bess.minSoc") });
    S.one("maxSoc", "Battery maximum charge", "%", { v: dsp.maxSoc, kind: "input", fmt: "pct", source: src("bess.maxSoc") });
    S.one("initSoc", "Battery charge at the start of a year", "%", { v: dsp.initSoc, kind: "input", fmt: "pct", source: "Model default" });
    if (dsp.blocks) {
      S.one("peakFloor", "Peak Hours floor", "% of contracted", { v: dsp.peakFloor, kind: "input", fmt: "pct", source: "Tender" });
      S.one("offFloor", dsp.solarHours ? "Remaining Hours floor" : "Off-peak floor", "% of contracted", { v: dsp.offFloor, kind: "input", fmt: "pct", source: "Tender" });
      if (dsp.solarHours) {
        S.one("solarFloor", "Solar Hours floor", "% of contracted", { v: dsp.solarFloor, kind: "input", fmt: "pct", source: "Tender (Amendment-03)" });
        S.one("solarMax", "Most the buyer takes in a Solar Hour", "% of contracted", { v: dsp.solarMax, kind: "input", fmt: "pct", source: "Tender (Amendment-03)" });
      }
    }
  }

  S.group("Financing");
  S.one("debtPct", "Debt share", "% of project cost", { v: fi.debtFraction, kind: "input", fmt: "pct", source: src("fin.debtFraction") });
  S.one("rate", "Interest rate", "%/yr", { v: fi.interestRate, kind: "input", fmt: "pct", source: src("fin.interestRate") });
  S.one("tenor", "Loan tenor", "years", { v: fi.tenorYears, kind: "input", fmt: "int", source: src("fin.tenorYears") });
  S.one("repay", "Repayment", REPAYMENT_LIST.join(" / "), { v: REPAYMENT_LIST.includes(fi.repayment) ? fi.repayment : "equal", kind: "input", list: REPAYMENT_LIST, source: src("fin.repayment", "Model default"),
    note: "equal: the balance in equal parts over the years left; annuity: level debt service; sculpted: the principal that keeps the DSCR at the target; balloon: a share in the last year; bullet: all in the last year; stepUp: principal growing at a rate" });
  S.one("grace", "Principal moratorium", "years", { v: fi.graceYears || 0, kind: "input", fmt: "int", source: src("fin.graceYears", "Model default"), note: "Within the tenor; interest is paid" });
  S.one("instalments", "Instalments a year", "1 / 2 / 4 / 12", { v: [1, 2, 4, 12].includes(fi.paymentsPerYear) ? fi.paymentsPerYear : 1, kind: "input", fmt: "int", list: ["1", "2", "4", "12"], source: src("fin.paymentsPerYear", "Model default"), note: "Instalments within the year pay the balance down earlier: the interest is on the average balance (not for sculpting)" });
  S.one("targetDscr", "Target DSCR (sculpted)", "×", { v: fi.targetDscr || 1.3, kind: "input", fmt: "x", source: src("fin.targetDscr", "Model default") });
  S.one("balloonPct", "Balloon share (balloon)", "% of the debt", { v: fi.balloonPct || 0, kind: "input", fmt: "pct", source: src("fin.balloonPct", "Model default") });
  S.one("stepUp", "Principal step-up (stepUp)", "%/yr", { v: fi.stepUpPct || 0, kind: "input", fmt: "pct", source: src("fin.stepUpPct", "Model default") });
  S.one("refiYear", "Refinance at the end of year", "year (0: never)", { v: fi.refiYear || 0, kind: "input", fmt: "int", source: src("fin.refiYear", "Model default") });
  S.one("refiRate", "Refinanced interest rate", "%/yr", { v: fi.refiRate || 0, kind: "input", fmt: "pct", source: src("fin.refiRate", "Model default") });
  S.one("refiTenor", "Refinanced tenor", "years from then", { v: fi.refiTenorYears || 0, kind: "input", fmt: "int", source: src("fin.refiTenorYears", "Model default") });
  S.one("refiFee", "Refinancing fee", "% of the balance", { v: fi.refiFeePct || 0, kind: "input", fmt: "pct", source: src("fin.refiFeePct", "Model default") });
  S.one("targetIrr", "Target equity IRR", "%", { v: fi.targetEquityIrr, kind: "input", fmt: "pct", source: src("fin.targetEquityIrr") });
  S.one("disc", "Discount rate (LCOE, project NPV)", "%", { v: fi.discountRate, kind: "input", fmt: "pct", source: src("fin.discountRate", "Model default") });

  S.group("Tax and depreciation");
  S.one("taxRate", "Corporate tax", "%", { v: fi.taxRate, kind: "input", fmt: "pct", source: src("fin.taxRate") });
  S.one("taxMethod", "Tax depreciation", "wdv / slm", { v: fi.taxDepreciation === "wdv" ? "wdv" : "slm", kind: "input", list: ["wdv", "slm"], source: src("fin.taxDepreciation", "Model default"), note: "wdv: written-down value at the WDV rate; slm: the book depreciation" });
  S.one("wdvRate", "WDV rate", "%/yr", { v: fi.wdvRate, kind: "input", fmt: "pct", source: src("fin.wdvRate", "Model default") });
  S.one("bookLife", "Book life", "years", { v: fi.bookLifeYears, kind: "input", fmt: "int", source: src("fin.bookLifeYears", "Model default") });
  S.one("salvage", "Salvage value", "% of project cost", { v: fi.salvagePct, kind: "input", fmt: "pct", source: src("fin.salvagePct", "Model default") });

  S.group("Working capital and reserves");
  S.one("recvDays", "Receivable days", "days", { v: fi.receivableDays, kind: "input", fmt: "int", source: src("fin.receivableDays", "Model default") });
  S.one("omMonths", "O&M in hand", "months", { v: fi.omStockMonths || 0, kind: "input", fmt: "num", source: src("fin.omStockMonths", "Model default"), note: "CERC norm: one month of O&M" });
  S.one("sparesPct", "Maintenance spares", "% of the year's O&M", { v: fi.sparesPctOm || 0, kind: "input", fmt: "pct", source: src("fin.sparesPctOm", "Model default"), note: "CERC norm: 15%" });
  S.one("wcRate", "Interest on working capital", "%/yr", { v: fi.wcInterestRate || 0, kind: "input", fmt: "pct", source: src("fin.wcInterestRate", "Model default"), note: "0: the working capital is funded from equity cash" });
  S.one("dsraMonths", "Debt service reserve", "months of the next year's debt service", { v: fi.dsraMonths || 0, kind: "input", fmt: "num", source: src("fin.dsraMonths", "Model default"), note: "Held from the equity cash, released as the debt service falls and at the end" });

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
  const hard = hardTerms.reduce((a, k) => a + S.v(k), 0);
  S.one("hard", "Hard cost", "₹ cr", { f: `SUM(${S.s(hardTerms[0])}:${S.s("evacCost")})`, v: hard, fmt: "cr", bold: true });
  S.one("preopCost", consM > 0 ? "Pre-operative cost" : "Pre-operative and IDC", "₹ cr", { f: `${S.s("hard")}*${S.s("preop")}`, v: hard * S.v("preop"), fmt: "cr" });
  const base = hard * (1 + S.v("preop"));
  S.one("base", "Project cost before IDC", "₹ cr", { f: `${S.s("hard")}+${S.s("preopCost")}`, v: base, fmt: "cr" });
  // the construction sheet: the cost spent month by month, its funding and the IDC
  const cons = addConstructionSheet(wb, S, { base, months: consM, profile: S.v("drawdown"), order: S.v("drawOrder"), debtPct: S.v("debtPct"), rate: S.v("rate") });
  S.one("idc", "Interest during construction (sheet Construction)", "₹ cr", { f: cons.idcRef, v: cons.idc, fmt: "cr", note: consM > 0 ? `${consM} months, ${S.v("drawdown")} drawdown, ${S.v("drawOrder") === "equityFirst" ? "equity first" : "pro rata"} funding` : "No construction months: the IDC is inside the pre-operative share" });
  const total = base + cons.idc;
  S.one("total", "Total project cost", "₹ cr", { f: `${S.s("base")}+${S.s("idc")}`, v: total, fmt: "cr", bold: true });
  const debt0 = base * S.v("debtPct") + cons.idc;
  S.one("debt", "Debt", "₹ cr", { f: `${S.s("base")}*${S.s("debtPct")}+${S.s("idc")}`, v: debt0, fmt: "cr", note: "The debt share of the cost before IDC, plus the IDC (capitalised as debt)" });
  S.one("equity", "Equity", "₹ cr", { f: `${S.s("total")}-${S.s("debt")}`, v: total - debt0, fmt: "cr" });
  S.one("years", "Model years", "years", { f: `COUNT(${S.col(1)}${yearRow}:${S.last}${yearRow})`, v: N, fmt: "int", note: "The PPA term the optimiser dispatched; one column per year" });
  const tenorUsed = Math.min(N, Math.max(1, Math.round(S.v("tenor"))));
  S.one("tenorUsed", "Loan tenor used", "years", { f: `MIN(${S.s("years")},MAX(1,ROUND(${S.s("tenor")},0)))`, v: tenorUsed, fmt: "int" });
  const rt = S.v("rate");
  const graceUsed = Math.min(tenorUsed - 1, Math.max(0, Math.round(S.v("grace"))));
  S.one("graceUsed", "Moratorium used", "years", { f: `MIN(${S.s("tenorUsed")}-1,MAX(0,ROUND(${S.s("grace")},0)))`, v: graceUsed, fmt: "int" });
  const q = Number(S.v("instalments")) || 1;
  const adj = S.v("repay") === "sculpted" ? 0 : (q - 1) / (2 * q);
  S.one("adj", "Interest saved by instalments within the year", "× the year's principal", { f: `IF(${S.s("repay")}="sculpted",0,(VALUE(${S.s("instalments")})-1)/(2*VALUE(${S.s("instalments")})))`, v: adj, fmt: "factor", note: "(instalments − 1) ÷ (2 × instalments): the principal is paid through the year, so the interest is on the average balance" });
  const refiOn = S.v("refiYear") > 0 && S.v("refiYear") < tenorUsed ? 1 : 0;
  S.one("refiOn", "Refinancing applies", "1 / 0", { f: `IF(AND(${S.s("refiYear")}>0,${S.s("refiYear")}<${S.s("tenorUsed")}),1,0)`, v: refiOn, fmt: "int", note: "Only while there is a balance to refinance" });
  const refiEnd = refiOn ? Math.min(N, S.v("refiYear") + Math.max(1, Math.round(S.v("refiTenor")))) : tenorUsed;
  S.one("refiEnd", "Last year of the refinanced debt", "year", { f: `IF(${S.s("refiOn")}=1,MIN(${S.s("years")},${S.s("refiYear")}+MAX(1,ROUND(${S.s("refiTenor")},0))),${S.s("tenorUsed")})`, v: refiEnd, fmt: "int" });
  const balloonShare = S.v("repay") === "bullet" ? 1 : Math.min(1, Math.max(0, S.v("balloonPct")));
  S.one("balloonShare", "Share repaid in the last year", "% of the debt", { f: `IF(${S.s("repay")}="bullet",1,MIN(1,MAX(0,${S.s("balloonPct")})))`, v: balloonShare, fmt: "pct", note: "balloon: the balloon share; bullet: all of it" });
  const bookBase = total * (1 - S.v("salvage"));
  S.one("bookBase", "Depreciable value (less salvage)", "₹ cr", { f: `${S.s("total")}*(1-${S.s("salvage")})`, v: bookBase, fmt: "cr" });
  S.one("bookDepYr", "Book depreciation a year", "₹ cr/yr", { f: `${S.s("bookBase")}/${S.s("bookLife")}`, v: bookBase / S.v("bookLife"), fmt: "cr" });

  // ---- generation: capacity × CUF × 365 days × 24 hours, built up from the monthly CUFs
  const gen = ["solar", "wind"].filter((k) => m.gen?.[k] && on[k]);
  const busKeys = [];
  if (gen.length) {
    S.section("Generation (capacity × CUF × 365 days × 24 hours)");
    const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    for (const k of gen) {
      const g = m.gen[k];
      const name = k === "solar" ? "Solar" : "Wind";
      const at = g.cufAt ? ` (at the ${g.cufAt})` : "";
      const from = g.profile ? `${g.profile}: ` : "";
      S.group(`${name}: CUF of each month, from the hourly profile`);
      if (g.monthCuf) {
        g.monthCuf.forEach((c, i) => S.one(`${k}CufM${i + 1}`, `${MONTHS[i]} CUF`, "%", {
          v: c, kind: "input", fmt: "pct", source: `${from}mean of the ${DAYS[i] * 24} hours of ${MONTHS[i]}`,
        }));
        S.one(`${k}Cuf`, `${name} CUF${at}`, "%", {
          f: `(${g.monthCuf.map((_, i) => `${S.s(`${k}CufM${i + 1}`)}*${DAYS[i]}`).join("+")})/365`,
          v: g.monthCuf.reduce((a, c, i) => a + c * DAYS[i], 0) / 365, fmt: "pct", bold: true,
          note: "Each month's CUF weighted by its days: the mean of the 8,760 hours",
        });
      } else {
        S.one(`${k}Cuf`, `${name} CUF${at}`, "%", { v: g.cuf, kind: "input", fmt: "pct", source: `${from}mean of the 8,760 hours` });
      }
      S.one(`${k}Deg`, `${name} degradation`, "%/yr", { v: g.degradation, kind: "input", fmt: "pct", source: src(`${k}.degradation`) });
      if (g.toBus > 0) S.one(`${k}ToBus`, `${name} losses to the 33 kV bus`, "%", { v: g.toBus, kind: "input", fmt: "pct", source: src(`${k}.losses`, "Loss chain") });

      S.group(`${name}: generation by year`);
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
    const lm = (addr) => `'${LIVE_SHEET}'!${String(addr).replace(/^\$?([A-Z]+)\$?(\d+)$/, "$$$1$$$2")}`;
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

  // ---- energy from the optimiser
  S.section(sim ? "Energy (the hourly simulation of each year, summed)" : "Energy (the optimiser's hourly dispatch, summed by year)");
  const op = (y) => m.ops[y - 1];
  const mu = (x) => (x || 0) / 1000;
  if (dsp) {
    S.series("demand", "Contracted energy", "MU", { f: () => `${S.s("contract")}*8760/1000`, v: () => (dsp.contract * 8760) / 1000, fmt: "mu", total: true });
    S.series("delivered", "Delivered to the procurer", "MU", { f: (y) => fromDispatch("delivered", y).f, v: (y) => fromDispatch("delivered", y).v, fmt: "mu", total: true,
      note: "The modelled years' hour-by-hour sheets (Dispatch Y…), summed; years between them interpolated as the sizing does" });
  } else {
    S.series("demand", "Contracted energy", "MU", { v: (y) => mu(op(y).demandMWh), kind: "opt", fmt: "mu", total: true });
    S.series("delivered", "Delivered to the procurer", "MU", { v: (y) => mu(op(y).deliveredMWh), kind: "opt", fmt: "mu", total: true });
  }
  S.series("dfr", "Delivered ÷ contracted", "%", {
    f: (y) => `IF(${S.at("demand", y)}>0,${S.at("delivered", y)}/${S.at("demand", y)},1)`,
    v: (y) => (S.v("demand", y) > 0 ? S.v("delivered", y) / S.v("demand", y) : 1), fmt: "pct",
  });
  S.series("shortfall", "Short of the annual floor", "MU", {
    f: (y) => `MAX(0,${S.s("target")}*${S.at("demand", y)}-${S.at("delivered", y)})`,
    v: (y) => Math.max(0, S.v("target") * S.v("demand", y) - S.v("delivered", y)), fmt: "mu", total: true,
  });
  if (blocky && dsp?.blocks) S.series("blockShort", "Short of the time-block floors", "MU", { f: (y) => fromDispatch("short", y).f, v: (y) => fromDispatch("short", y).v, fmt: "mu", total: true, note: "Each hour's energy below its floor, summed from the hour-by-hour sheets" });
  else if (blocky) S.series("blockShort", "Short of the time-block floors", "MU", { v: (y) => mu(op(y).blockShortfallMWh), kind: "opt", fmt: "mu", total: true, note: "Each hour's energy below its floor (peak and off-peak blocks), from the dispatch" });
  const soldText = buyer ? "Sold, in the market and to the buyer" : "Sold in the market";
  if (dsp?.sell) S.series("excess", soldText, "MU", { f: (y) => fromDispatch("soldMeter", y).f, v: (y) => fromDispatch("soldMeter", y).v, fmt: "mu", total: true });
  else S.series("excess", soldText, "MU", { v: (y) => mu(op(y).excessMWh + (op(y).buyerExcessMWh || 0)), kind: "opt", fmt: "mu", total: true });
  if (buyer) {
    S.series("buyerMu", "Of which the buyer takes (Solar Hours excess)", "MU", { v: (y) => mu(op(y).buyerExcessMWh), kind: "opt", fmt: "mu", total: true,
      note: "The Solar Hours above 60% sold in hours where the market pays more than the buyer's share of the tariff: the buyer takes those" });
    S.series("marketMu", "Of which sold in the market", "MU", { f: (y) => `${S.at("excess", y)}-${S.at("buyerMu", y)}`, v: (y) => S.v("excess", y) - S.v("buyerMu", y), fmt: "mu", total: true });
  }
  if (hourly) {
    S.series("price", `Realised market price${m.market ? ` (IEX ${m.market}, hourly)` : " (hourly)"}`, "₹/kWh", {
      v: (y) => (op(y).excessMWh > 0 && finite(op(y).surplusRevenueCr) ? (op(y).surplusRevenueCr * 1e4) / op(y).excessMWh : 0),
      kind: "opt", fmt: "tariff", note: "Market revenue of the year ÷ energy sold, at the hourly prices the optimiser dispatched against",
    });
  } else {
    S.series("price", "Market sale price", "₹/kWh", { f: () => S.s("flatPrice"), v: () => S.v("flatPrice"), fmt: "tariff" });
  }
  if (on.biomass) S.series("biomassMu", "Biomass generation", "MU", { v: (y) => mu(op(y).biomassMWh), kind: "opt", fmt: "mu", total: true });
  if (hydro) S.series("hydroMu", "Hydro energy", "MU", { v: (y) => mu(op(y).hydroMWh), kind: "opt", fmt: "mu", total: true });
  if (thermal) S.series("thermalMu", "Thermal (non-RE) energy", "MU", { v: (y) => mu(op(y).thermalMWh), kind: "opt", fmt: "mu", total: true });
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
    else S.series("genBusMu", "Generated at the 33 kV bus", "MU", { v: (y) => mu(op(y).genBusMWh), kind: "opt", fmt: "mu", total: true });
    S.series("injectedMu", "Injected at the 33 kV bus", "MU", { v: (y) => mu(op(y).injectedMWh), kind: "opt", fmt: "mu", total: true });
    S.series("trafoLossMu", "Power transformer loss", "MU", { v: (y) => mu(op(y).trafoLossMWh), kind: "opt", fmt: "mu", total: true });
    S.series("lineLossMu", "Transmission line loss", "MU", { v: (y) => mu(op(y).lineLossMWh), kind: "opt", fmt: "mu", total: true });
    S.series("meterMu", "At the 220 kV billing meter", "MU", { v: (y) => mu(op(y).meterMWh), kind: "opt", fmt: "mu", total: true });
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
  if (on.biomass) factor("fuelF", "Biomass fuel", "fuelEsc");
  if (hydro) factor("hydroF", "Hydro charges", "hydroEsc");
  if (thermal) factor("thermalF", "Thermal charges", "thermalEsc");
  if (on.bess) factor("bessF", "Battery price", "decline", -1);
  S.series("df", "Discount factor", "×", { f: (y) => `1/(1+${S.s("disc")})^${S.yr(y)}`, v: (y) => 1 / (1 + S.v("disc")) ** y, fmt: "factor" });

  // ---- revenue
  S.section("Revenue");
  S.series("trf", "Tariff", "₹/kWh", { f: (y) => `${S.s("tariff")}*${S.at("tariffF", y)}`, v: (y) => S.v("tariff") * S.v("tariffF", y), fmt: "tariff" });
  S.series("ppaRev", "PPA supply revenue", "₹ cr", {
    f: (y) => `${S.at("delivered", y)}*${S.at("trf", y)}/10`, v: (y) => (S.v("delivered", y) * S.v("trf", y)) / 10, total: true,
    note: "Delivered MU × tariff ₹/kWh ÷ 10 = ₹ crore",
  });
  S.series("mktRev", m.market ? `Market sale revenue (IEX ${m.market})` : "Market sale revenue", "₹ cr", {
    f: (y) => `IF(${S.s("sell")}="Yes",${S.at(buyer ? "marketMu" : "excess", y)}*${S.at("price", y)}/10,0)`,
    v: (y) => (S.v("sell") === "Yes" ? (S.v(buyer ? "marketMu" : "excess", y) * S.v("price", y)) / 10 : 0), total: true,
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
  const minusPenalties = (y) => `-${S.at("penaltyCr", y)}${blocky ? `-${S.at("blockPenCr", y)}` : ""}`;
  S.series("revenue", "Total revenue", "₹ cr", {
    f: (y) => `${S.at("ppaRev", y)}+${S.at("mktRev", y)}${buyer ? `+${S.at("buyerRev", y)}` : ""}${minusPenalties(y)}`,
    v: (y) => S.v("ppaRev", y) + S.v("mktRev", y) + (buyer ? S.v("buyerRev", y) : 0) - S.v("penaltyCr", y) - (blocky ? S.v("blockPenCr", y) : 0), total: true, bold: true,
  });

  // ---- operating costs
  S.section("Operating costs");
  const opexKeys = [];
  const omLine = (key, text, sizeKey, rateKey) => {
    S.series(key, text, "₹ cr", {
      f: (y) => `${S.s(sizeKey)}*${S.s(rateKey)}/100*${S.at("omF", y)}`,
      v: (y) => ((S.v(sizeKey) * S.v(rateKey)) / 100) * S.v("omF", y), total: true, note: "Size × ₹ lakh ÷ 100 = ₹ crore, escalated",
    });
    opexKeys.push(key);
  };
  if (on.solar) omLine("solarOmCr", "Solar O&M", "solarMw", "solarOm");
  if (on.wind) omLine("windOmCr", "Wind O&M", "windMw", "windOm");
  if (on.bess) omLine("bessOmCr", "Battery O&M", "bessMwh", "bessOm");
  if (on.biomass) omLine("biomassOmCr", "Biomass O&M", "biomassMw", "biomassOm");
  S.series("insuranceCr", "Insurance", "₹ cr", { f: () => `${S.s("hard")}*${S.s("insurance")}`, v: () => S.v("hard") * S.v("insurance"), total: true });
  opexKeys.push("insuranceCr");
  S.series("otherCr", "Other fixed cost", "₹ cr", { f: (y) => `${S.s("otherFixed")}*${S.at("omF", y)}`, v: (y) => S.v("otherFixed") * S.v("omF", y), total: true });
  opexKeys.push("otherCr");
  // O&M of the year (the working capital's O&M in hand and spares are on it)
  const omKeys = opexKeys.filter((k) => k.endsWith("OmCr"));
  S.series("omCr", "O&M of the year", "₹ cr", { f: (y) => (omKeys.length ? omKeys.map((k) => S.at(k, y)).join("+") : "0"), v: (y) => omKeys.reduce((a, k) => a + S.v(k, y), 0), total: true });
  if (m.ops.some((o) => (o.dsmChargeCr || 0) > 0)) {
    S.series("dsmCr", "Deviation settlement charges (CERC DSM)", "₹ cr", { v: (y) => m.ops[y - 1].dsmChargeCr || 0, kind: "opt", total: true, note: "The year's DSM charges on the forecast error, worked out block by block in TenderOS" });
    opexKeys.push("dsmCr");
  } else if (m.ops.some((o) => (o.dsmA || 0) !== 0 || (o.dsmB || 0) !== 0)) {
    // the charge per MWh scheduled is a line in the year's tariff: a × tariff + b (web/src/dsm/dsm.js)
    S.series("dsmA", "DSM charge per MWh scheduled, per ₹/kWh of tariff", "₹/MWh per ₹/kWh", { v: (y) => m.ops[y - 1].dsmA || 0, kind: "opt", fmt: "num", note: "From the forecast-error distribution, the tolerance band and the X factor of the year, and the steps beyond the band (TenderOS, DSM norms)" });
    S.series("dsmB", "DSM charge per MWh scheduled, at the normal rates", "₹/MWh", { v: (y) => m.ops[y - 1].dsmB || 0, kind: "opt", fmt: "num", note: "The in-band deviation settled at the normal rate: dear when the plant is short, cheap when it is long" });
    S.series("dsmCr", "Deviation settlement charges (CERC DSM)", "₹ cr", {
      f: (y) => `(${S.at("delivered", y)}+${S.at("excess", y)})*(${S.at("dsmA", y)}*${S.at("trf", y)}+${S.at("dsmB", y)})/10000`,
      v: (y) => ((S.v("delivered", y) + S.v("excess", y)) * ((m.ops[y - 1].dsmA || 0) * S.v("trf", y) + (m.ops[y - 1].dsmB || 0))) / 1e4,
      total: true, note: "Energy scheduled (MU, what reaches the meter) × (a × tariff + b) ÷ 10,000",
    });
    opexKeys.push("dsmCr");
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

  // ---- battery augmentation
  S.section("Battery augmentation (capital spend in operation)");
  if (on.bess) {
    const augV = (y) => {
      const price = S.v("bessCapex") * S.v("bessF", y);
      if (S.v("augMethod") === "annual") return y >= 2 ? S.v("bessMwh") * S.v("deg") * price : 0;
      if (S.v("augMethod") === "oneTime" && y === S.v("augYear") && S.v("augYear") > 1 && S.v("augYear") <= N) return S.v("bessMwh") * Math.min(0.6, S.v("deg") * (y - 1)) * price;
      return 0;
    };
    S.series("aug", "Battery augmentation", "₹ cr", {
      f: (y) => `IF(${S.s("augMethod")}="annual",IF(${S.yr(y)}>=2,${S.s("bessMwh")}*${S.s("deg")}*${S.s("bessCapex")}*${S.at("bessF", y)},0),`
        + `IF(AND(${S.s("augMethod")}="oneTime",${S.yr(y)}=${S.s("augYear")},${S.s("augYear")}>1,${S.s("augYear")}<=${S.s("years")}),`
        + `${S.s("bessMwh")}*MIN(0.6,${S.s("deg")}*(${S.yr(y)}-1))*${S.s("bessCapex")}*${S.at("bessF", y)},0))`,
      v: augV, total: true,
      note: "annual: each year from year 2 replaces the year's fade (MWh × fade × the year's battery price); oneTime: the fade to that year (at most 60%), once",
    });
  } else {
    S.series("aug", "Battery augmentation (no battery)", "₹ cr", { v: () => 0, total: true });
  }

  // ---- book depreciation
  S.section("Book depreciation");
  S.series("baseDep", "On the project cost (straight line)", "₹ cr", {
    f: (y) => `IF(${S.yr(y)}<=${S.s("bookLife")},${S.s("bookDepYr")},0)`, v: (y) => (y <= S.v("bookLife") ? S.v("bookDepYr") : 0), total: true,
  });
  S.series("augDepAdd", "Added for this year's augmentation", "₹ cr", {
    f: (y) => `${S.at("aug", y)}/MAX(1,${S.s("years")}-${S.yr(y)}+1)`, v: (y) => S.v("aug", y) / Math.max(1, N - y + 1),
    note: "Augmentation is depreciated over the years left",
  });
  S.series("augDep", "On augmentation", "₹ cr", {
    f: (y) => (y === 1 ? S.at("augDepAdd", 1) : `${S.at("augDep", y - 1)}+${S.at("augDepAdd", y)}`),
    v: (y) => (y === 1 ? S.v("augDepAdd", 1) : S.v("augDep", y - 1) + S.v("augDepAdd", y)), total: true,
  });
  S.series("bookDep", "Book depreciation", "₹ cr", { f: (y) => `${S.at("baseDep", y)}+${S.at("augDep", y)}`, v: (y) => S.v("baseDep", y) + S.v("augDep", y), total: true, bold: true });

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

  // ---- tax depreciation (before the debt: the sculpted principal needs the tax)
  S.section("Tax depreciation");
  S.series("wdvOpen", "Tax block, opening", "₹ cr", { v: () => null });
  S.series("wdvAdd", "Added: augmentation", "₹ cr", { f: (y) => S.at("aug", y), v: (y) => S.v("aug", y), total: true });
  S.series("taxDep", "Tax depreciation", "₹ cr", { v: () => null, total: true, bold: true });
  S.series("wdvClose", "Tax block, closing", "₹ cr", { v: () => null });
  {
    let block = total;
    const wdv = S.v("taxMethod") === "wdv";
    for (let y = 1; y <= N; y += 1) {
      const open = block;
      block += S.v("aug", y);
      let dep;
      if (wdv) { dep = block * S.v("wdvRate"); block -= dep; } else dep = S.v("bookDep", y);
      const vals = { wdvOpen: open, taxDep: dep, wdvClose: block };
      const fs = {
        wdvOpen: y === 1 ? S.s("total") : S.at("wdvClose", y - 1),
        taxDep: `IF(${S.s("taxMethod")}="wdv",(${S.at("wdvOpen", y)}+${S.at("wdvAdd", y)})*${S.s("wdvRate")},${S.at("bookDep", y)})`,
        wdvClose: `${S.at("wdvOpen", y)}+${S.at("wdvAdd", y)}-IF(${S.s("taxMethod")}="wdv",${S.at("taxDep", y)},0)`,
      };
      for (const k of Object.keys(vals)) {
        S.val[k][y] = vals[k];
        S.put(ws.getCell(`${S.col(y)}${S.cell[k]}`), { f: fs[k], v: vals[k], fmt: "cr", bold: k === "taxDep" });
      }
    }
    const sum = S.val.taxDep.slice(1).reduce((a, x) => a + x, 0);
    S.put(ws.getCell(`C${S.cell.taxDep}`), { f: `SUM(${S.span("taxDep")})`, v: sum, fmt: "cr", bold: true });
  }

  // ---- debt
  S.section("Debt");
  const debtRows = ["openDebt", "rateY", "endY", "intOpen", "balloonAmt", "preTaxS", "lossBfS", "lossUsedS", "taxableS", "lossCfS", "taxS", "cfadsS", "principal", "interest", "closeDebt", "debtService", "refiFeeCr"];
  S.series("openDebt", "Opening debt", "₹ cr", { v: () => null });
  S.series("rateY", "Interest rate of the year", "%", { v: () => null, fmt: "pct", note: "The refinanced rate from the year after the refinancing" });
  S.series("endY", "Last year of the debt", "year", { v: () => null, fmt: "int" });
  S.series("intOpen", "Interest on the opening balance", "₹ cr", { v: () => null });
  S.series("balloonAmt", "Amount kept for the last year (balloon, bullet)", "₹ cr", { v: () => null, note: "The share of the debt, or of the balance refinanced" });
  S.group("Sculpting: the cash flow after tax with the interest on the opening balance");
  S.series("preTaxS", "Taxable profit before losses (sculpting)", "₹ cr", { v: () => null });
  S.series("lossBfS", "Tax losses brought forward (sculpting)", "₹ cr", { v: () => null });
  S.series("lossUsedS", "Losses set off (sculpting)", "₹ cr", { v: () => null });
  S.series("taxableS", "Taxable income (sculpting)", "₹ cr", { v: () => null });
  S.series("lossCfS", "Tax losses carried forward (sculpting)", "₹ cr", { v: () => null });
  S.series("taxS", "Tax (sculpting)", "₹ cr", { v: () => null });
  S.series("cfadsS", "Cash flow for debt service (sculpting)", "₹ cr", { v: () => null, note: "EBITDA − tax − working capital − augmentation − interest on working capital, the tax on the interest on the opening balance" });
  S.group("Repayment");
  S.series("principal", "Principal", "₹ cr", { v: () => null, total: true, note: "Under the repayment method, after the moratorium, until the last year of the debt (which clears it)" });
  S.series("interest", "Interest", "₹ cr", { v: () => null, total: true, note: "On the opening balance, less the instalment saving on the year's principal" });
  S.series("closeDebt", "Closing debt", "₹ cr", { v: () => null });
  S.series("debtService", "Debt service", "₹ cr", { v: () => null, total: true, bold: true });
  S.series("refiFeeCr", "Refinancing fee", "₹ cr", { v: () => null, total: true, note: "On the balance refinanced, in the refinancing year" });
  {
    let open = debt0;
    let balloonBase = debt0;
    let carriedS = 0;
    const repay = S.v("repay");
    const crfOf = (r, n) => (r <= 0 ? 1 / n : (r * (1 + r) ** n) / ((1 + r) ** n - 1));
    for (let y = 1; y <= N; y += 1) {
      const phase2 = refiOn && y > S.v("refiYear");
      const rate = phase2 ? S.v("refiRate") : rt;
      const end = phase2 ? refiEnd : tenorUsed;
      const n = end - y + 1;
      const intOpen = open * rate;
      if (refiOn && y === S.v("refiYear") + 1) balloonBase = open;
      const balloonAmt = balloonBase * balloonShare;
      // sculpting's tax: on the interest on the opening balance, its own losses chain
      const preS = S.v("ebitda", y) - intOpen - S.v("wcInt", y) - S.v("taxDep", y);
      const bfS = carriedS;
      const usedS = preS > 0 ? Math.min(bfS, preS) : 0;
      const taxableS = Math.max(0, preS - usedS);
      carriedS = bfS - usedS + Math.max(0, -preS);
      const taxS = taxableS * S.v("taxRate");
      const cfadsS = S.v("ebitda", y) - taxS - S.v("dWc", y) - S.v("aug", y) - S.v("wcInt", y);
      const repaying = y > graceUsed && y <= end && open > 1e-9;
      let principal = 0;
      if (repaying) {
        if (n <= 1) principal = open;
        else if (repay === "annuity") principal = Math.min(open, open * crfOf(rate, n) - intOpen);
        else if (repay === "sculpted") principal = Math.min(open, Math.max(0, cfadsS / S.v("targetDscr") - intOpen));
        else if (repay === "balloon" || repay === "bullet") principal = Math.min(open, Math.max(0, (open - balloonAmt) / (n - 1)));
        else if (repay === "stepUp") principal = Math.min(open, S.v("stepUp") > 0 ? (open * S.v("stepUp")) / ((1 + S.v("stepUp")) ** n - 1) : open / n);
        else principal = open / n;
      }
      const interest = intOpen - adj * principal;
      const close = open - principal;
      const refiFee = refiOn && y === S.v("refiYear") ? close * S.v("refiFee") : 0;
      const vals = { openDebt: open, rateY: rate, endY: end, intOpen, balloonAmt, preTaxS: preS, lossBfS: bfS, lossUsedS: usedS, taxableS, lossCfS: carriedS, taxS, cfadsS, principal, interest, closeDebt: close, debtService: interest + principal, refiFeeCr: refiFee };
      const O = S.at("openDebt", y);
      const R = S.at("rateY", y);
      const NL = `(${S.at("endY", y)}-${S.yr(y)}+1)`;
      const IO = S.at("intOpen", y);
      const method = `IF(${NL}<=1,${O},`
        + `IF(${S.s("repay")}="annuity",MIN(${O},IF(${R}<=0,${O}/${NL},${O}*${R}*(1+${R})^${NL}/((1+${R})^${NL}-1))-${IO}),`
        + `IF(${S.s("repay")}="sculpted",MIN(${O},MAX(0,${S.at("cfadsS", y)}/${S.s("targetDscr")}-${IO})),`
        + `IF(OR(${S.s("repay")}="balloon",${S.s("repay")}="bullet"),MIN(${O},MAX(0,(${O}-${S.at("balloonAmt", y)})/(${NL}-1))),`
        + `IF(${S.s("repay")}="stepUp",MIN(${O},IF(${S.s("stepUp")}>0,${O}*${S.s("stepUp")}/((1+${S.s("stepUp")})^${NL}-1),${O}/${NL})),`
        + `${O}/${NL})))))`;
      const phase2F = `AND(${S.s("refiOn")}=1,${S.yr(y)}>${S.s("refiYear")})`;
      const fs = {
        openDebt: y === 1 ? S.s("debt") : S.at("closeDebt", y - 1),
        rateY: `IF(${phase2F},${S.s("refiRate")},${S.s("rate")})`,
        endY: `IF(${phase2F},${S.s("refiEnd")},${S.s("tenorUsed")})`,
        intOpen: `${O}*${R}`,
        balloonAmt: y === 1 ? `${S.s("debt")}*${S.s("balloonShare")}` : `IF(AND(${S.s("refiOn")}=1,${S.yr(y)}=${S.s("refiYear")}+1),${O}*${S.s("balloonShare")},${S.at("balloonAmt", y - 1)})`,
        preTaxS: `${S.at("ebitda", y)}-${IO}-${S.at("wcInt", y)}-${S.at("taxDep", y)}`,
        lossBfS: y === 1 ? "0" : S.at("lossCfS", y - 1),
        lossUsedS: `IF(${S.at("preTaxS", y)}>0,MIN(${S.at("lossBfS", y)},${S.at("preTaxS", y)}),0)`,
        taxableS: `MAX(0,${S.at("preTaxS", y)}-${S.at("lossUsedS", y)})`,
        lossCfS: `${S.at("lossBfS", y)}-${S.at("lossUsedS", y)}+MAX(0,-${S.at("preTaxS", y)})`,
        taxS: `${S.at("taxableS", y)}*${S.s("taxRate")}`,
        cfadsS: `${S.at("ebitda", y)}-${S.at("taxS", y)}-${S.at("dWc", y)}-${S.at("aug", y)}-${S.at("wcInt", y)}`,
        principal: `IF(AND(${S.yr(y)}>${S.s("graceUsed")},${S.yr(y)}<=${S.at("endY", y)},${O}>1E-9),${method},0)`,
        interest: `${IO}-${S.s("adj")}*${S.at("principal", y)}`,
        closeDebt: `${O}-${S.at("principal", y)}`,
        debtService: `${S.at("interest", y)}+${S.at("principal", y)}`,
        refiFeeCr: `IF(AND(${S.s("refiOn")}=1,${S.yr(y)}=${S.s("refiYear")}),${S.at("closeDebt", y)}*${S.s("refiFee")},0)`,
      };
      for (const k of debtRows) {
        S.val[k][y] = vals[k];
        S.put(ws.getCell(`${S.col(y)}${S.cell[k]}`), { f: fs[k], v: vals[k], fmt: k === "rateY" ? "pct" : k === "endY" ? "int" : "cr", bold: k === "debtService" });
      }
      open = close;
    }
    for (const k of ["principal", "interest", "debtService", "refiFeeCr"]) {
      const sum = S.val[k].slice(1).reduce((a, x) => a + x, 0);
      S.put(ws.getCell(`C${S.cell[k]}`), { f: `SUM(${S.span(k)})`, v: sum, fmt: "cr", bold: true });
    }
  }

  // ---- profit and loss
  S.section("Profit and loss");
  const link = (key, from, text) => S.series(key, text, "₹ cr", { f: (y) => S.at(from, y), v: (y) => S.v(from, y), total: true });
  link("plEbitda", "ebitda", "EBITDA");
  link("plBookDep", "bookDep", "Less: book depreciation");
  link("plInterest", "interest", "Less: interest");
  link("plWcInt", "wcInt", "Less: interest on working capital");
  link("plRefiFee", "refiFeeCr", "Less: refinancing fee");
  S.series("pbt", "Profit before tax", "₹ cr", {
    f: (y) => `${S.at("plEbitda", y)}-${S.at("plBookDep", y)}-${S.at("plInterest", y)}-${S.at("plWcInt", y)}-${S.at("plRefiFee", y)}`,
    v: (y) => S.v("ebitda", y) - S.v("bookDep", y) - S.v("interest", y) - S.v("wcInt", y) - S.v("refiFeeCr", y), total: true, bold: true,
  });
  S.series("preTaxable", "Taxable profit before losses brought forward", "₹ cr", {
    f: (y) => `${S.at("ebitda", y)}-${S.at("interest", y)}-${S.at("wcInt", y)}-${S.at("refiFeeCr", y)}-${S.at("taxDep", y)}`,
    v: (y) => S.v("ebitda", y) - S.v("interest", y) - S.v("wcInt", y) - S.v("refiFeeCr", y) - S.v("taxDep", y),
    note: "EBITDA − interest (on the debt and the working capital) − refinancing fee − tax depreciation",
  });
  S.series("lossBf", "Tax losses brought forward", "₹ cr", { v: () => null });
  S.series("lossUsed", "Losses set off", "₹ cr", { v: () => null, total: true });
  S.series("taxable", "Taxable income", "₹ cr", { v: () => null, total: true });
  S.series("lossCf", "Tax losses carried forward", "₹ cr", { v: () => null });
  S.series("tax", "Tax", "₹ cr", { v: () => null, total: true });
  {
    let carried = 0;
    for (let y = 1; y <= N; y += 1) {
      const pre = S.v("preTaxable", y);
      const bf = carried;
      const used = pre > 0 ? Math.min(bf, pre) : 0;
      const taxable = Math.max(0, pre - used);
      carried = bf - used + Math.max(0, -pre);
      const vals = { lossBf: bf, lossUsed: used, taxable, lossCf: carried, tax: taxable * S.v("taxRate") };
      const fs = {
        lossBf: y === 1 ? "0" : S.at("lossCf", y - 1),
        lossUsed: `IF(${S.at("preTaxable", y)}>0,MIN(${S.at("lossBf", y)},${S.at("preTaxable", y)}),0)`,
        taxable: `MAX(0,${S.at("preTaxable", y)}-${S.at("lossUsed", y)})`,
        lossCf: `${S.at("lossBf", y)}-${S.at("lossUsed", y)}+MAX(0,-${S.at("preTaxable", y)})`,
        tax: `${S.at("taxable", y)}*${S.s("taxRate")}`,
      };
      for (const k of Object.keys(vals)) {
        S.val[k][y] = vals[k];
        S.put(ws.getCell(`${S.col(y)}${S.cell[k]}`), { f: fs[k], v: vals[k], fmt: "cr" });
      }
    }
    for (const k of ["lossUsed", "taxable", "tax"]) {
      const sum = S.val[k].slice(1).reduce((a, x) => a + x, 0);
      S.put(ws.getCell(`C${S.cell[k]}`), { f: `SUM(${S.span(k)})`, v: sum, fmt: "cr", bold: true });
    }
  }
  S.series("pat", "Profit after tax", "₹ cr", { f: (y) => `${S.at("pbt", y)}-${S.at("tax", y)}`, v: (y) => S.v("pbt", y) - S.v("tax", y), total: true, bold: true });

  // ---- cash flow
  S.section("Cash flow");
  link("cfDWc", "dWc", "Less: increase in working capital");
  link("cfWcInt", "wcInt", "Less: interest on working capital");
  S.series("cfads", "Cash flow available for debt service (CFADS)", "₹ cr", {
    f: (y) => `${S.at("ebitda", y)}-${S.at("tax", y)}-${S.at("dWc", y)}-${S.at("aug", y)}-${S.at("wcInt", y)}`,
    v: (y) => S.v("ebitda", y) - S.v("tax", y) - S.v("dWc", y) - S.v("aug", y) - S.v("wcInt", y), total: true, bold: true,
    note: "EBITDA − tax − working capital − battery augmentation − interest on working capital",
  });
  link("cfDebtService", "debtService", "Less: debt service");
  S.series("dscr", "DSCR", "×", {
    f: (y) => `IF(${S.at("debtService", y)}>1E-9,${S.at("cfads", y)}/${S.at("debtService", y)},"")`,
    v: (y) => (S.v("debtService", y) > 1e-9 ? S.v("cfads", y) / S.v("debtService", y) : ""), fmt: "x",
  });
  S.series("dsra", "Debt service reserve held", "₹ cr", {
    f: (y) => (y < N ? `${S.at("debtService", y + 1)}*${S.s("dsraMonths")}/12` : "0"),
    v: (y) => (y < N ? (S.v("debtService", y + 1) * S.v("dsraMonths")) / 12 : 0), note: "Months of the next year's debt service; nothing after the last year",
  });
  S.series("dDsra", "Put into (released from) the reserve", "₹ cr", {
    f: (y) => (y === 1 ? S.at("dsra", 1) : `${S.at("dsra", y)}-${S.at("dsra", y - 1)}`),
    v: (y) => (y === 1 ? S.v("dsra", 1) : S.v("dsra", y) - S.v("dsra", y - 1)), total: true,
  });
  S.series("terminal", "Salvage and working capital released (final year)", "₹ cr", {
    f: (y) => `IF(${S.yr(y)}=${S.s("years")},${S.s("total")}*${S.s("salvage")}+${S.at("wcBal", y)},0)`,
    v: (y) => (y === N ? total * S.v("salvage") + S.v("wcBal", y) : 0), total: true,
  });
  S.series("debtEnd", "Debt still owed, repaid in the final year", "₹ cr", {
    f: (y) => `IF(${S.yr(y)}=${S.s("years")},${S.at("closeDebt", y)},0)`, v: (y) => (y === N ? S.v("closeDebt", y) : 0), total: true,
  });
  S.series("fcfe", "Equity cash flow (year 0: the equity put in)", "₹ cr", {
    y0: { f: `-${S.s("equity")}`, v: -(total - debt0) },
    f: (y) => `${S.at("cfads", y)}-${S.at("debtService", y)}-${S.at("refiFeeCr", y)}-${S.at("dDsra", y)}+${S.at("terminal", y)}-${S.at("debtEnd", y)}`,
    v: (y) => S.v("cfads", y) - S.v("debtService", y) - S.v("refiFeeCr", y) - S.v("dDsra", y) + S.v("terminal", y) - S.v("debtEnd", y), total: true, bold: true,
    note: "CFADS − debt service − refinancing fee − reserve put aside + salvage and working capital released − debt still owed",
  });
  S.series("cumEq", "Cumulative equity cash", "₹ cr", {
    y0: { f: S.at("fcfe", 0), v: -(total - debt0) },
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
    f: (y) => `${S.at("ebitda", y)}-${S.at("projTax", y)}-${S.at("dWc", y)}-${S.at("aug", y)}+${S.at("terminal", y)}`,
    v: (y) => S.v("ebitda", y) - S.v("projTax", y) - S.v("dWc", y) - S.v("aug", y) + S.v("terminal", y), total: true, bold: true,
  });

  // ---- levelised cost
  S.section("Levelised cost and tariff");
  S.series("lcCost", "Operating cost and augmentation", "₹ cr", { f: (y) => `${S.at("opex", y)}+${S.at("aug", y)}`, v: (y) => S.v("opex", y) + S.v("aug", y), total: true });
  S.series("pvCost", "Discounted", "₹ cr", { f: (y) => `${S.at("lcCost", y)}*${S.at("df", y)}`, v: (y) => S.v("lcCost", y) * S.v("df", y), total: true });
  S.series("pvEnergy", "Delivered energy, discounted", "MU", { f: (y) => `${S.at("delivered", y)}*${S.at("df", y)}`, v: (y) => S.v("delivered", y) * S.v("df", y), fmt: "mu", total: true });
  S.series("pvPpa", "PPA supply revenue, discounted", "₹ cr", { f: (y) => `${S.at("ppaRev", y)}*${S.at("df", y)}`, v: (y) => S.v("ppaRev", y) * S.v("df", y), total: true });

  // ---- returns
  S.section("Returns");
  const sum = (k) => S.val[k].slice(1).reduce((a, x) => a + (finite(x) ? x : 0), 0);
  const eqFlows = S.val.fcfe.slice(0, N + 1);
  const prFlows = S.val.projCf.slice(0, N + 1);
  const npv = (rate, flows) => flows.reduce((a, cf, i) => a + cf / (1 + rate) ** i, 0);
  const dscrs = S.val.dscr.slice(1).filter(finite);
  const paybacks = S.val.paybackFlag.slice(1).filter(finite);
  const out = {
    tariff: [S.s("tariff"), S.v("tariff")],
    equityIrr: [`IFERROR(IRR(${S.span("fcfe", 0)}),"n/a")`, irr(eqFlows) ?? "n/a"],
    projectIrr: [`IFERROR(IRR(${S.span("projCf", 0)}),"n/a")`, irr(prFlows) ?? "n/a"],
    equityNpv: [`${S.at("fcfe", 0)}+NPV(${S.s("targetIrr")},${S.span("fcfe")})`, npv(S.v("targetIrr"), eqFlows)],
    projectNpv: [`${S.at("projCf", 0)}+NPV(${S.s("disc")},${S.span("projCf")})`, npv(S.v("disc"), prFlows)],
    minDscr: [`IF(COUNT(${S.span("dscr")})=0,"",MIN(${S.span("dscr")}))`, dscrs.length ? Math.min(...dscrs) : ""],
    avgDscr: [`IF(COUNT(${S.span("dscr")})=0,"",AVERAGE(${S.span("dscr")}))`, dscrs.length ? dscrs.reduce((a, b) => a + b, 0) / dscrs.length : ""],
    lcoe: [`IF(C${S.cell.pvEnergy}>0,(${S.s("total")}+C${S.cell.pvCost})*10/C${S.cell.pvEnergy},"")`, sum("pvEnergy") > 0 ? ((total + sum("pvCost")) * 10) / sum("pvEnergy") : ""],
    levelisedTariff: [`IF(C${S.cell.pvEnergy}>0,C${S.cell.pvPpa}*10/C${S.cell.pvEnergy},"")`, sum("pvEnergy") > 0 ? (sum("pvPpa") * 10) / sum("pvEnergy") : ""],
    payback: [`IF(COUNT(${S.span("paybackFlag")})=0,"beyond the term",MIN(${S.span("paybackFlag")}))`, paybacks.length ? Math.min(...paybacks) : "beyond the term"],
    capexTotal: [S.s("total"), total],
    debt: [S.s("debt"), debt0],
    equity: [S.s("equity"), total - debt0],
    revenueTotal: [`C${S.cell.revenue}`, sum("revenue")],
  };
  out.irrGap = [`IFERROR(${"$C$" + (keyRow0 + 1)}-${S.s("targetIrr")},"n/a")`, finite(out.equityIrr[1]) ? out.equityIrr[1] - S.v("targetIrr") : "n/a"];
  const returnsRows = [
    ["equityIrr", "Equity IRR", "%", "pct"], ["projectIrr", "Project IRR", "%", "pct"], ["equityNpv", "Equity NPV at the target IRR", "₹ cr", "cr"],
    ["projectNpv", "Project NPV at the discount rate", "₹ cr", "cr"], ["minDscr", "Minimum DSCR", "×", "x"], ["avgDscr", "Average DSCR", "×", "x"],
    ["lcoe", "Levelised cost of supply (project cost + discounted costs) ÷ discounted energy", "₹/kWh", "tariff"],
    ["levelisedTariff", "Levelised tariff", "₹/kWh", "tariff"], ["payback", "Equity payback", "year", "int"],
  ];
  for (const [key, text, unit, fmt] of returnsRows) S.one(`ret_${key}`, text, unit, { f: out[key][0], v: out[key][1], fmt, bold: key === "equityIrr" });

  // ---- checks
  S.section("Checks");
  const checks = [];
  const check = (key, text, f, ok) => {
    S.one(key, text, "", { f: `IF(${f},"OK","CHECK")`, v: ok ? "OK" : "CHECK" });
    checks.push(S.s(key));
  };
  check("chkFunding", "Debt + equity = project cost", `ABS(${S.s("debt")}+${S.s("equity")}-${S.s("total")})<0.001`, true);
  const closeAtTenor = S.v("closeDebt", refiEnd);
  check("chkDebt", "Debt repaid by its last year", `ABS(INDEX(${S.span("closeDebt")},1,${S.s("refiEnd")}))<0.01`, Math.abs(closeAtTenor) < 0.01);
  const consOk = consM === 0 || Math.abs(cons.spent - base) < 0.01;
  check("chkCons", "Construction spends the whole cost before IDC", `OR(${S.s("consMonths")}<=0,ABS(${cons.spentRef}-${S.s("base")})<0.01)`, consOk);
  const balanced = Math.abs(sum("revenue") - sum("opex") - sum("ebitda")) < 0.01;
  check("chkEbitda", "Revenue − operating cost = EBITDA over the term", `ABS(C${S.cell.revenue}-C${S.cell.opex}-C${S.cell.ebitda})<0.01`, balanced);
  const lossesOk = S.val.lossCf.slice(1).every((x) => x >= -1e-9);
  check("chkLosses", "Tax losses never negative", `MIN(${S.span("lossCf")})>=-1E-9`, lossesOk);
  const irrOk = finite(out.equityIrr[1]) && out.equityIrr[1] >= S.v("targetIrr") - 1e-5;
  S.one("chkIrr", "Equity IRR meets the target", "", { f: `IF(ISNUMBER($C$${keyRow0 + 1}),IF($C$${keyRow0 + 1}>=${S.s("targetIrr")}-1E-5,"OK","Below target"),"No IRR")`, v: irrOk ? "OK" : "Below target" });
  const dscrOk = dscrs.length ? Math.min(...dscrs) >= 1 : true;
  S.one("chkDscr", "Minimum DSCR at least 1.0", "", { f: `IF(ISNUMBER($C$${keyRow0 + 6}),IF($C$${keyRow0 + 6}>=1,"OK","Below 1.0"),"OK")`, v: dscrOk ? "OK" : "Below 1.0" });
  out.checks = [`IF(AND(${checks.map((c) => `${c}="OK"`).join(",")}),"OK","CHECK")`, "OK"];

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
  const last = keyRow0 + KEYS.length - 1;
  ws.addConditionalFormatting({
    ref: `F${keyRow0}:F${last}`,
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
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: yearRow, topLeftCell: `D${yearRow + 1}`, activeCell: "C1", showGridLines: false }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${yearRow}:${yearRow}` };
  ws.headerFooter = { oddFooter: "&L&A&R&P / &N" };

  const cells = Object.fromEntries(KEYS.map(([key]) => [key, `'${LIVE_SHEET}'!${S.cell[`key_${key}`]}`]));
  // addr: every row's key → its address ("$C$12" for one value, the row number for a year series)
  return { sheet: ws, cells, values: Object.fromEntries(Object.entries(out).map(([k, [, v]]) => [k, v])), rows: S.val, addr: { ...S.cell }, dispatch: dsp ? dTotals : null };
}

/**
 * The request's `live` block, checked: numbers are finite (else 0), choices are from their lists,
 * at most 60 years. Returns null when there is no year to model.
 */
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

export function liveModelInput(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.ops) || !raw.ops.length) return null;
  const n = (v) => (finite(v) ? v : 0);
  const nums = (o, keys) => Object.fromEntries(keys.map((k) => [k, n(o?.[k])]));
  const fin = raw.fin || {};
  const plantIds = ["hydro", "thermal"];
  return {
    title: String(raw.title || "").slice(0, 200),
    engine: raw.engine === "simulation" ? "simulation" : "highs",
    bessNote: typeof raw.bessNote === "string" ? raw.bessNote.slice(0, 120) : null,
    sourceAll: typeof raw.sourceAll === "string" ? raw.sourceAll.slice(0, 80) : null,
    tariff: n(raw.tariff),
    tariffLocked: Boolean(raw.tariffLocked),
    dfrTarget: n(raw.dfrTarget),
    split: Boolean(raw.split),
    market: typeof raw.market === "string" ? raw.market.replace(/[^\w -]/g, "").slice(0, 20) : null,
    on: Object.fromEntries(["solar", "wind", "hydro", "biomass", "thermal", "bess"].map((k) => [k, Boolean(raw.on?.[k])])),
    sizes: nums(raw.sizes, ["solarMw", "windMw", "bessMw", "bessMwh", "biomassMw", "hydroMw", "thermalMw"]),
    costs: {
      ...nums(raw.costs, ["solarCrPerMw", "windCrPerMw", "bessCrPerMwh", "bessPcsCrPerMw", "biomassCrPerMw", "evacuationCr", "preopPct", "constructionMonths"]),
      drawdown: DRAWDOWN_LIST.includes(raw.costs?.drawdown) ? raw.costs.drawdown : "linear",
      drawOrder: raw.costs?.drawOrder === "equityFirst" ? "equityFirst" : "proRata",
      plants: (Array.isArray(raw.costs?.plants) ? raw.costs.plants : []).filter((p) => plantIds.includes(p?.id))
        .map((p) => ({ id: p.id, ...nums(p, ["capexCrPerMw", "fixedLakhPerMw", "energyRsPerKwh", "recRsPerKwh", "escalation"]) })),
    },
    fin: {
      ...nums(fin, [
        "tariffEscalation", "solarOmLakhPerMw", "windOmLakhPerMw", "bessOmLakhPerMwh", "biomassOmLakhPerMw", "omEscalation", "insurancePct", "otherFixedCr",
        "biomassFuelRsPerKwh", "biomassFuelEscalation", "surplusPrice", "shortfallPenalty", "blockPenaltyMultiple", "debtFraction", "interestRate",
        "tenorYears", "targetEquityIrr", "discountRate", "taxRate", "wdvRate", "bookLifeYears", "salvagePct", "receivableDays",
        "graceYears", "targetDscr", "balloonPct", "stepUpPct", "refiYear", "refiRate", "refiTenorYears", "refiFeePct", "omStockMonths", "sparesPctOm", "wcInterestRate", "dsraMonths",
      ]),
      paymentsPerYear: [1, 2, 4, 12].includes(fin.paymentsPerYear) ? fin.paymentsPerYear : 1,
      sellSurplus: Boolean(fin.sellSurplus),
      repayment: REPAYMENT_LIST.includes(fin.repayment) ? fin.repayment : "equal",
      taxDepreciation: fin.taxDepreciation === "wdv" ? "wdv" : "slm",
      bookLifeYears: n(fin.bookLifeYears) > 0 ? fin.bookLifeYears : 25,
      tenorYears: n(fin.tenorYears) > 0 ? fin.tenorYears : 1,
    },
    bess: {
      ...nums(raw.bess, ["annualDegradation", "augmentationYear", "costDeclinePct"]),
      augmentation: ["annual", "oneTime"].includes(raw.bess?.augmentation) ? raw.bess.augmentation : "none",
    },
    ops: raw.ops.slice(0, 60).map((o) => ({
      ...nums(o, ["demandMWh", "deliveredMWh", "excessMWh", "buyerExcessMWh", "buyerExcessShare", "biomassMWh", "hydroMWh", "thermalMWh", "blockShortfallMWh", "genBusMWh", "injectedMWh", "trafoLossMWh", "lineLossMWh", "meterMWh", "dsmA", "dsmB"]),
      ...(finite(o?.dsmChargeCr) ? { dsmChargeCr: o.dsmChargeCr } : {}),
      ...(finite(o?.surplusRevenueCr) ? { surplusRevenueCr: o.surplusRevenueCr } : {}),
    })),
    dispatch: dispatchInput(raw.dispatch, raw.ops.length),
    gen: Object.fromEntries(["solar", "wind"].filter((k) => raw.on?.[k] && finite(raw.gen?.[k]?.cuf) && raw.gen[k].cuf > 0).map((k) => {
      const g = raw.gen[k];
      const months = Array.isArray(g.monthCuf) && g.monthCuf.length === 12 && g.monthCuf.every(finite) ? g.monthCuf.map((c) => Math.min(1, Math.max(0, c))) : null;
      const text = (s) => (typeof s === "string" ? s.replace(/[^\w ()·,.%/-]/g, "").slice(0, 80) : "");
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
