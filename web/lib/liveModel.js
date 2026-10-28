// Tender to Bid: the "Live model" sheet of the bid workbook. The same 25-year financial model as
// the app (web/src/rtc/engine.js cashflows), written as Excel formulas: every number is a formula
// on the inputs (blue on yellow) and on the optimiser's year-by-year energy (green), so the bidder
// can change an input and see the tariff's returns move. Each formula cell also carries its value,
// worked out here line by line the same way, so viewers that do not recalculate still show it;
// tools/check_live_model.mjs recalculates the sheet with LibreOffice and checks both against the app.
//
// Units: energy in MU (million kWh), money in ₹ crore, prices in ₹/kWh. MU × ₹/kWh ÷ 10 = ₹ crore.

export const LIVE_SHEET = "Live model";

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
 * Add the Live model sheet to an exceljs workbook. m is the request's `live` block (see
 * web/src/bid/exportModel.js liveModelRequest). Returns { sheet, cells } where cells maps the
 * key results (tariff, equityIrr, ...) to their 'Live model'!C.. addresses for other sheets.
 */
export function addLiveModel(wb, m) {
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
    : "The optimiser's energy comes from the hourly HiGHS dispatch of every year; changing a plant size here moves its cost, not its energy (size the plant again in TenderOS for that).";
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
  S.one("preop", "Pre-operative and IDC", "% of hard cost", { v: co.preopPct || 0, kind: "input", fmt: "pct", source: src("costs.preopPct") });

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

  S.group("Financing");
  S.one("debtPct", "Debt share", "% of project cost", { v: fi.debtFraction, kind: "input", fmt: "pct", source: src("fin.debtFraction") });
  S.one("rate", "Interest rate", "%/yr", { v: fi.interestRate, kind: "input", fmt: "pct", source: src("fin.interestRate") });
  S.one("tenor", "Loan tenor", "years", { v: fi.tenorYears, kind: "input", fmt: "int", source: src("fin.tenorYears") });
  S.one("repay", "Repayment", "annuity / equal", { v: fi.repayment === "annuity" ? "annuity" : "equal", kind: "input", list: ["annuity", "equal"], source: src("fin.repayment", "Model default") });
  S.one("targetIrr", "Target equity IRR", "%", { v: fi.targetEquityIrr, kind: "input", fmt: "pct", source: src("fin.targetEquityIrr") });
  S.one("disc", "Discount rate (LCOE, project NPV)", "%", { v: fi.discountRate, kind: "input", fmt: "pct", source: src("fin.discountRate", "Model default") });

  S.group("Tax and depreciation");
  S.one("taxRate", "Corporate tax", "%", { v: fi.taxRate, kind: "input", fmt: "pct", source: src("fin.taxRate") });
  S.one("taxMethod", "Tax depreciation", "wdv / slm", { v: fi.taxDepreciation === "wdv" ? "wdv" : "slm", kind: "input", list: ["wdv", "slm"], source: src("fin.taxDepreciation", "Model default"), note: "wdv: written-down value at the WDV rate; slm: the book depreciation" });
  S.one("wdvRate", "WDV rate", "%/yr", { v: fi.wdvRate, kind: "input", fmt: "pct", source: src("fin.wdvRate", "Model default") });
  S.one("bookLife", "Book life", "years", { v: fi.bookLifeYears, kind: "input", fmt: "int", source: src("fin.bookLifeYears", "Model default") });
  S.one("salvage", "Salvage value", "% of project cost", { v: fi.salvagePct, kind: "input", fmt: "pct", source: src("fin.salvagePct", "Model default") });
  S.one("recvDays", "Receivable days", "days", { v: fi.receivableDays, kind: "input", fmt: "int", source: src("fin.receivableDays", "Model default") });

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
  S.one("preopCost", "Pre-operative and IDC", "₹ cr", { f: `${S.s("hard")}*${S.s("preop")}`, v: hard * S.v("preop"), fmt: "cr" });
  const total = hard * (1 + S.v("preop"));
  S.one("total", "Total project cost", "₹ cr", { f: `${S.s("hard")}+${S.s("preopCost")}`, v: total, fmt: "cr", bold: true });
  const debt0 = total * S.v("debtPct");
  S.one("debt", "Debt", "₹ cr", { f: `${S.s("total")}*${S.s("debtPct")}`, v: debt0, fmt: "cr" });
  S.one("equity", "Equity", "₹ cr", { f: `${S.s("total")}-${S.s("debt")}`, v: total - debt0, fmt: "cr" });
  S.one("years", "Model years", "years", { f: `COUNT(${S.col(1)}${yearRow}:${S.last}${yearRow})`, v: N, fmt: "int", note: "The PPA term the optimiser dispatched; one column per year" });
  const tenorUsed = Math.min(N, Math.max(1, Math.round(S.v("tenor"))));
  S.one("tenorUsed", "Loan tenor used", "years", { f: `MIN(${S.s("years")},MAX(1,ROUND(${S.s("tenor")},0)))`, v: tenorUsed, fmt: "int" });
  const rt = S.v("rate");
  const annuity = rt <= 0 ? debt0 / tenorUsed : (debt0 * rt * (1 + rt) ** tenorUsed) / ((1 + rt) ** tenorUsed - 1);
  S.one("annuity", "Annuity (interest + principal) if annuity repayment", "₹ cr/yr", {
    f: `IF(${S.s("rate")}<=0,${S.s("debt")}/${S.s("tenorUsed")},${S.s("debt")}*${S.s("rate")}*(1+${S.s("rate")})^${S.s("tenorUsed")}/((1+${S.s("rate")})^${S.s("tenorUsed")}-1))`,
    v: annuity, fmt: "cr",
  });
  S.one("equalPrincipal", "Principal a year if equal repayment", "₹ cr/yr", { f: `${S.s("debt")}/${S.s("tenorUsed")}`, v: debt0 / tenorUsed, fmt: "cr" });
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

  // ---- energy from the optimiser
  S.section(sim ? "Energy (the hourly simulation of each year, summed)" : "Energy (the optimiser's hourly dispatch, summed by year)");
  const op = (y) => m.ops[y - 1];
  const mu = (x) => (x || 0) / 1000;
  S.series("demand", "Contracted energy", "MU", { v: (y) => mu(op(y).demandMWh), kind: "opt", fmt: "mu", total: true });
  S.series("delivered", "Delivered to the procurer", "MU", { v: (y) => mu(op(y).deliveredMWh), kind: "opt", fmt: "mu", total: true });
  S.series("dfr", "Delivered ÷ contracted", "%", {
    f: (y) => `IF(${S.at("demand", y)}>0,${S.at("delivered", y)}/${S.at("demand", y)},1)`,
    v: (y) => (S.v("demand", y) > 0 ? S.v("delivered", y) / S.v("demand", y) : 1), fmt: "pct",
  });
  S.series("shortfall", "Short of the annual floor", "MU", {
    f: (y) => `MAX(0,${S.s("target")}*${S.at("demand", y)}-${S.at("delivered", y)})`,
    v: (y) => Math.max(0, S.v("target") * S.v("demand", y) - S.v("delivered", y)), fmt: "mu", total: true,
  });
  if (blocky) S.series("blockShort", "Short of the time-block floors", "MU", { v: (y) => mu(op(y).blockShortfallMWh), kind: "opt", fmt: "mu", total: true, note: "Each hour's energy below its floor (peak and off-peak blocks), from the dispatch" });
  S.series("excess", "Sold in the market", "MU", { v: (y) => mu(op(y).excessMWh), kind: "opt", fmt: "mu", total: true });
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
    f: (y) => `IF(${S.s("sell")}="Yes",${S.at("excess", y)}*${S.at("price", y)}/10,0)`,
    v: (y) => (S.v("sell") === "Yes" ? (S.v("excess", y) * S.v("price", y)) / 10 : 0), total: true,
  });
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
    f: (y) => `${S.at("ppaRev", y)}+${S.at("mktRev", y)}${minusPenalties(y)}`,
    v: (y) => S.v("ppaRev", y) + S.v("mktRev", y) - S.v("penaltyCr", y) - (blocky ? S.v("blockPenCr", y) : 0), total: true, bold: true,
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
    f: (y) => `SUM(${S.col(y)}${S.cell[opexKeys[0]]}:${S.col(y)}${S.cell[opexKeys[opexKeys.length - 1]]})`,
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

  // ---- debt
  S.section("Debt");
  S.series("openDebt", "Opening debt", "₹ cr", {
    f: (y) => (y === 1 ? S.s("debt") : null), v: (y) => (y === 1 ? debt0 : null),
  });
  S.series("interest", "Interest", "₹ cr", { f: (y) => `${S.at("openDebt", y)}*${S.s("rate")}`, v: () => null, total: true });
  S.series("principal", "Principal", "₹ cr", { f: () => null, v: () => null, total: true });
  S.series("closeDebt", "Closing debt", "₹ cr", { f: () => null, v: () => null });
  S.series("debtService", "Debt service", "₹ cr", { f: (y) => `${S.at("interest", y)}+${S.at("principal", y)}`, v: () => null, total: true, bold: true });
  // the four rows feed each other year by year: fill values and formulas together
  {
    const rows = ["openDebt", "interest", "principal", "closeDebt", "debtService"];
    let open = debt0;
    for (let y = 1; y <= N; y += 1) {
      const interest = open * rt;
      let principal = 0;
      if (y <= tenorUsed && open > 1e-9) principal = S.v("repay") === "annuity" ? Math.min(open, annuity - interest) : Math.min(open, debt0 / tenorUsed);
      const close = open - principal;
      const vals = { openDebt: open, interest, principal, closeDebt: close, debtService: interest + principal };
      const fs = {
        openDebt: y === 1 ? S.s("debt") : S.at("closeDebt", y - 1),
        interest: `${S.at("openDebt", y)}*${S.s("rate")}`,
        principal: `IF(AND(${S.yr(y)}<=${S.s("tenorUsed")},${S.at("openDebt", y)}>1E-9),IF(${S.s("repay")}="annuity",MIN(${S.at("openDebt", y)},${S.s("annuity")}-${S.at("interest", y)}),MIN(${S.at("openDebt", y)},${S.s("equalPrincipal")})),0)`,
        closeDebt: `${S.at("openDebt", y)}-${S.at("principal", y)}`,
        debtService: `${S.at("interest", y)}+${S.at("principal", y)}`,
      };
      for (const k of rows) {
        S.val[k][y] = vals[k];
        S.put(ws.getCell(`${S.col(y)}${S.cell[k]}`), { f: fs[k], v: vals[k], fmt: "cr", bold: k === "debtService" });
      }
      open = close;
    }
    for (const k of ["interest", "principal", "debtService"]) {
      const sum = S.val[k].slice(1).reduce((a, x) => a + x, 0);
      S.put(ws.getCell(`C${S.cell[k]}`), { f: `SUM(${S.span(k)})`, v: sum, fmt: "cr", bold: true });
    }
  }

  // ---- tax depreciation
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

  // ---- profit and loss
  S.section("Profit and loss");
  const link = (key, from, text) => S.series(key, text, "₹ cr", { f: (y) => S.at(from, y), v: (y) => S.v(from, y), total: true });
  link("plEbitda", "ebitda", "EBITDA");
  link("plBookDep", "bookDep", "Less: book depreciation");
  link("plInterest", "interest", "Less: interest");
  S.series("pbt", "Profit before tax", "₹ cr", {
    f: (y) => `${S.at("plEbitda", y)}-${S.at("plBookDep", y)}-${S.at("plInterest", y)}`,
    v: (y) => S.v("ebitda", y) - S.v("bookDep", y) - S.v("interest", y), total: true, bold: true,
  });
  S.series("preTaxable", "Taxable profit before losses brought forward", "₹ cr", {
    f: (y) => `${S.at("ebitda", y)}-${S.at("interest", y)}-${S.at("taxDep", y)}`,
    v: (y) => S.v("ebitda", y) - S.v("interest", y) - S.v("taxDep", y),
    note: "EBITDA − interest − tax depreciation",
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
  S.series("recv", "Receivables", "₹ cr", { f: (y) => `${S.at("revenue", y)}*${S.s("recvDays")}/365`, v: (y) => (S.v("revenue", y) * S.v("recvDays")) / 365, note: "Revenue × receivable days ÷ 365, held at the year end" });
  S.series("dWc", "Increase in working capital", "₹ cr", {
    f: (y) => (y === 1 ? S.at("recv", 1) : `${S.at("recv", y)}-${S.at("recv", y - 1)}`),
    v: (y) => (y === 1 ? S.v("recv", 1) : S.v("recv", y) - S.v("recv", y - 1)), total: true,
  });
  S.series("cfads", "Cash flow available for debt service (CFADS)", "₹ cr", {
    f: (y) => `${S.at("ebitda", y)}-${S.at("tax", y)}-${S.at("dWc", y)}-${S.at("aug", y)}`,
    v: (y) => S.v("ebitda", y) - S.v("tax", y) - S.v("dWc", y) - S.v("aug", y), total: true, bold: true,
    note: "EBITDA − tax − working capital − battery augmentation",
  });
  link("cfDebtService", "debtService", "Less: debt service");
  S.series("dscr", "DSCR", "×", {
    f: (y) => `IF(${S.at("debtService", y)}>1E-9,${S.at("cfads", y)}/${S.at("debtService", y)},"")`,
    v: (y) => (S.v("debtService", y) > 1e-9 ? S.v("cfads", y) / S.v("debtService", y) : ""), fmt: "x",
  });
  S.series("terminal", "Salvage and receivables released (final year)", "₹ cr", {
    f: (y) => `IF(${S.yr(y)}=${S.s("years")},${S.s("total")}*${S.s("salvage")}+${S.at("recv", y)},0)`,
    v: (y) => (y === N ? total * S.v("salvage") + S.v("recv", y) : 0), total: true,
  });
  S.series("debtEnd", "Debt still owed, repaid in the final year", "₹ cr", {
    f: (y) => `IF(${S.yr(y)}=${S.s("years")},${S.at("closeDebt", y)},0)`, v: (y) => (y === N ? S.v("closeDebt", y) : 0), total: true,
  });
  S.series("fcfe", "Equity cash flow (year 0: the equity put in)", "₹ cr", {
    y0: { f: `-${S.s("equity")}`, v: -(total - debt0) },
    f: (y) => `${S.at("cfads", y)}-${S.at("debtService", y)}+${S.at("terminal", y)}-${S.at("debtEnd", y)}`,
    v: (y) => S.v("cfads", y) - S.v("debtService", y) + S.v("terminal", y) - S.v("debtEnd", y), total: true, bold: true,
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
  const closeAtTenor = S.v("closeDebt", tenorUsed);
  check("chkDebt", "Debt repaid by the end of the loan tenor", `ABS(INDEX(${S.span("closeDebt")},1,${S.s("tenorUsed")}))<0.01`, Math.abs(closeAtTenor) < 0.01);
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
        const t = tol[key] ?? Math.max(1e-6, Math.abs(app) * 1e-6);
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
  return { sheet: ws, cells, values: Object.fromEntries(Object.entries(out).map(([k, [, v]]) => [k, v])), rows: S.val, addr: { ...S.cell } };
}

/**
 * The request's `live` block, checked: numbers are finite (else 0), choices are from their lists,
 * at most 60 years. Returns null when there is no year to model.
 */
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
      ...nums(raw.costs, ["solarCrPerMw", "windCrPerMw", "bessCrPerMwh", "bessPcsCrPerMw", "biomassCrPerMw", "evacuationCr", "preopPct"]),
      plants: (Array.isArray(raw.costs?.plants) ? raw.costs.plants : []).filter((p) => plantIds.includes(p?.id))
        .map((p) => ({ id: p.id, ...nums(p, ["capexCrPerMw", "fixedLakhPerMw", "energyRsPerKwh", "recRsPerKwh", "escalation"]) })),
    },
    fin: {
      ...nums(fin, [
        "tariffEscalation", "solarOmLakhPerMw", "windOmLakhPerMw", "bessOmLakhPerMwh", "biomassOmLakhPerMw", "omEscalation", "insurancePct", "otherFixedCr",
        "biomassFuelRsPerKwh", "biomassFuelEscalation", "surplusPrice", "shortfallPenalty", "blockPenaltyMultiple", "debtFraction", "interestRate",
        "tenorYears", "targetEquityIrr", "discountRate", "taxRate", "wdvRate", "bookLifeYears", "salvagePct", "receivableDays",
      ]),
      sellSurplus: Boolean(fin.sellSurplus),
      repayment: fin.repayment === "annuity" ? "annuity" : "equal",
      taxDepreciation: fin.taxDepreciation === "wdv" ? "wdv" : "slm",
      bookLifeYears: n(fin.bookLifeYears) > 0 ? fin.bookLifeYears : 25,
      tenorYears: n(fin.tenorYears) > 0 ? fin.tenorYears : 1,
    },
    bess: {
      ...nums(raw.bess, ["annualDegradation", "augmentationYear", "costDeclinePct"]),
      augmentation: ["annual", "oneTime"].includes(raw.bess?.augmentation) ? raw.bess.augmentation : "none",
    },
    ops: raw.ops.slice(0, 60).map((o) => ({
      ...nums(o, ["demandMWh", "deliveredMWh", "excessMWh", "biomassMWh", "hydroMWh", "thermalMWh", "blockShortfallMWh", "genBusMWh", "injectedMWh", "trafoLossMWh", "lineLossMWh", "meterMWh"]),
      ...(finite(o?.surplusRevenueCr) ? { surplusRevenueCr: o.surplusRevenueCr } : {}),
    })),
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
