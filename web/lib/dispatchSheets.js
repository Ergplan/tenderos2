// The HiGHS sizing's hour-by-hour dispatch as Excel formulas: one sheet per modelled year
// ("Dispatch Y1", "Dispatch Y25"), 8,760 rows each. Every number is a formula except the inputs
// (the hourly capacity factors and the peak hours, blue) and the optimiser's three choices each
// hour (how much to charge, discharge and sell, green):
//
//   solar, wind MW      = MW × capacity factor × the year's degradation factor
//   direct to the PPA   = MIN(contract − discharge, generation − charge − sold)   (the LP always
//                         delivers what it can: each MWh earns the tariff; rtc_lp.solve)
//   curtailed           = generation − direct − charge − sold
//   battery energy      = last hour's + charge × η − discharge ÷ η   (above its minimum)
//   delivered (meter)   = (direct + discharge) × share reaching the meter
//   floor, short        = contract × the hour's floor;  MAX(0, floor − delivered)
//
// The year's totals (row TOTAL_ROW) are SUMs of the hours; the Live model's energy by PPA year is
// the totals of the modelled years, weighted as the sizing interpolates between them.
// tools/check_live_model.mjs recalculates the sheets with LibreOffice.

export const TOTAL_ROW = 5;
export const HEAD_ROW = 6;
export const FIRST_ROW = 7;
const HOURS = 8760;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const dispatchSheetName = (year) => `Dispatch Y${year}`;
/** A cell of a dispatch sheet as other sheets reference it. */
export const dispatchRef = (year, addr) => `'${dispatchSheetName(year)}'!${addr}`;

const STYLE = {
  input: { font: { color: { argb: "FF0000FF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } } },
  opt: { font: { color: { argb: "FF00703C" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } } },
  calc: { font: { color: { argb: "FF000000" } } },
};

function hourLabels() {
  const out = [];
  MONTH_DAYS.forEach((days, m) => {
    for (let d = 1; d <= days; d += 1) for (let h = 0; h < 24; h += 1) out.push(`${MONTHS[m]} ${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:00`);
  });
  return out;
}

/**
 * The columns of a dispatch sheet: [key, header, unit, kind]. Solar and wind only when sized;
 * selling, the floor and the shortfall only when the bid sells or has time-block floors.
 */
export function dispatchColumns(d) {
  const cols = [["hour", "Hour of the year", "", "input"], ["time", "Date and hour", "", "input"]];
  if (d.blocks) cols.push(["peak", "Peak hour (1 = yes)", "", "input"]);
  if (d.solar) cols.push(["solarCf", "Solar capacity factor at the 33 kV bus", "", "input"]);
  if (d.wind) cols.push(["windCf", "Wind capacity factor at the 33 kV bus", "", "input"]);
  if (d.solar) cols.push(["solar", "Solar output", "MW", "calc"]);
  if (d.wind) cols.push(["wind", "Wind output", "MW", "calc"]);
  cols.push(["gen", "Generation at the 33 kV bus", "MW", "calc"]);
  cols.push(["charge", "Battery charging (optimiser)", "MW", "opt"], ["discharge", "Battery discharging (optimiser)", "MW", "opt"]);
  if (d.sell) cols.push(["sold", "Sold in the market, at the bus (optimiser)", "MW", "opt"]);
  cols.push(["direct", "Direct to the PPA", "MW", "calc"], ["curtailed", "Curtailed", "MW", "calc"], ["battery", "Battery energy above its minimum, end of hour", "MWh", "calc"]);
  cols.push(["delivered", "Delivered to the procurer, at the meter", "MW", "calc"]);
  if (d.sell) cols.push(["soldMeter", "Sold in the market, at the meter", "MW", "calc"]);
  if (d.blocks) cols.push(["floor", "The hour's floor, at the meter", "MW", "calc"], ["short", "Short of the floor", "MW", "calc"]);
  return cols;
}

const colLetter = (n) => {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
};

/** Column letter of each key in a dispatch sheet. */
export function dispatchLetters(d) {
  return Object.fromEntries(dispatchColumns(d).map(([k], i) => [k, colLetter(i + 1)]));
}

// the parameter block (row 3), each linked to the Live model: key → [column, header]
const PARAMS = [
  ["solarMw", "Solar MW"], ["solarDegF", "Solar degradation factor this year"], ["windMw", "Wind MW"], ["windDegF", "Wind degradation factor this year"],
  ["contract", "Contracted MW at the meter"], ["poi", "Share reaching the meter"], ["eta", "Battery efficiency each way (√ round trip)"],
  ["peakFloor", "Peak floor"], ["offFloor", "Off-peak floor"], ["start", "Battery energy above its minimum at the start (MWh)"],
];
export const paramCell = (key) => `$${colLetter(PARAMS.findIndex(([k]) => k === key) + 1)}$3`;

/**
 * The hourly values of a modelled year, worked out the way the sheet's formulas work them out (the
 * cells carry them for viewers that do not recalculate), and the year's totals.
 */
export function dispatchValues(d, y, p) {
  const n = HOURS;
  const v = { solar: [], wind: [], gen: [], direct: [], curtailed: [], battery: [], delivered: [], soldMeter: [], floor: [], short: [] };
  let level = p.start;
  for (let t = 0; t < n; t += 1) {
    const s = d.solar ? p.solarMw * d.solarCf[t] * p.solarDegF : 0;
    const w = d.wind ? p.windMw * d.windCf[t] * p.windDegF : 0;
    const g = s + w;
    const ch = y.charge[t];
    const dis = y.discharge[t];
    const sold = d.sell ? y.sold[t] : 0;
    const direct = Math.min(p.contract / p.poi - dis, g - ch - sold);
    level = level + ch * p.eta - dis / p.eta;
    const delivered = (direct + dis) * p.poi;
    const floor = d.blocks ? p.contract * (d.peak[t] ? p.peakFloor : p.offFloor) : 0;
    v.solar.push(s); v.wind.push(w); v.gen.push(g); v.direct.push(direct); v.curtailed.push(g - direct - ch - sold);
    v.battery.push(level); v.delivered.push(delivered); v.soldMeter.push(sold * p.poi); v.floor.push(floor); v.short.push(Math.max(0, floor - delivered));
  }
  const sum = (a) => a.reduce((x, z) => x + z, 0);
  return { ...v, totals: { delivered: sum(v.delivered), soldMeter: sum(v.soldMeter), short: sum(v.short), gen: sum(v.gen), curtailed: sum(v.curtailed) } };
}

/**
 * Add the dispatch sheet of one modelled year. links maps each parameter key to its formula (a
 * Live model cell) and value; rows false writes the parameters and the totals only (the in-app
 * trace, which shows the hours from the data itself). Returns the totals row's addresses by key.
 */
export function addDispatchSheet(wb, d, y, links, { rows = true } = {}) {
  const ws = wb.addWorksheet(dispatchSheetName(y.year));
  const cols = dispatchColumns(d);
  const L = dispatchLetters(d);
  const p = Object.fromEntries(Object.entries(links).map(([k, l]) => [k, l.v]));
  const vals = dispatchValues(d, y, p);
  const put = (cell, { f, v, kind = "calc", fmt }) => {
    cell.value = f ? { formula: f, result: v } : v;
    if (f && v === 0 && cell._value?.model) cell._value.model.result = 0; // exceljs drops a 0 result
    const st = STYLE[kind];
    if (st.font) cell.font = st.font;
    if (st.fill) cell.fill = st.fill;
    if (fmt) cell.numFmt = fmt;
  };

  ws.getCell("A1").value = `Year ${y.year}: the optimiser's dispatch, hour by hour`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  PARAMS.forEach(([key, head], i) => {
    const l = links[key];
    if (!l) return;
    const c = ws.getRow(2).getCell(i + 1);
    c.value = head;
    c.font = { bold: true, color: { argb: "FF555555" } };
    c.alignment = { wrapText: true, vertical: "top" };
    put(ws.getRow(3).getCell(i + 1), { f: l.f, v: l.v, kind: l.kind || "calc", fmt: "0.0000" });
  });
  ws.getRow(2).height = 42;

  // the year's totals, then the column headers
  const totalLabel = ws.getRow(TOTAL_ROW).getCell(1);
  totalLabel.value = "Year total (MWh)";
  totalLabel.font = { bold: true };
  const last = FIRST_ROW + HOURS - 1;
  const totals = {};
  cols.forEach(([key, head, unit, kind], i) => {
    const h = ws.getRow(HEAD_ROW).getCell(i + 1);
    h.value = unit ? `${head} (${unit})` : head;
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111111" } };
    h.alignment = { wrapText: true, vertical: "top" };
    if (unit === "MW" || key === "short") {
      const letter = L[key];
      const v = vals[key] ? vals[key].reduce((a, z) => a + z, 0) : (key === "charge" ? y.charge : key === "discharge" ? y.discharge : y.sold || []).reduce((a, z) => a + z, 0);
      put(ws.getRow(TOTAL_ROW).getCell(i + 1), { f: `SUM(${letter}${FIRST_ROW}:${letter}${last})`, v, fmt: "#,##0.0" });
      ws.getRow(TOTAL_ROW).getCell(i + 1).font = { bold: true };
      totals[key] = `$${letter}$${TOTAL_ROW}`;
    }
    ws.getColumn(i + 1).width = i < 2 ? 14 : 13;
  });
  ws.getRow(HEAD_ROW).height = 48;
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: HEAD_ROW }];
  if (!rows) return { totals, values: vals };

  const labels = hourLabels();
  const P = (key) => paramCell(key);
  for (let t = 0; t < HOURS; t += 1) {
    const r = FIRST_ROW + t;
    const row = ws.getRow(r);
    const at = (key) => `${L[key]}${r}`;
    const cell = (key) => row.getCell(cols.findIndex(([k]) => k === key) + 1);
    cell("hour").value = t + 1;
    cell("time").value = labels[t];
    if (d.blocks) put(cell("peak"), { v: d.peak[t] ? 1 : 0, kind: "input" });
    if (d.solar) put(cell("solarCf"), { v: d.solarCf[t], kind: "input", fmt: "0.0000" });
    if (d.wind) put(cell("windCf"), { v: d.windCf[t], kind: "input", fmt: "0.0000" });
    if (d.solar) put(cell("solar"), { f: `${P("solarMw")}*${at("solarCf")}*${P("solarDegF")}`, v: vals.solar[t], fmt: "0.00" });
    if (d.wind) put(cell("wind"), { f: `${P("windMw")}*${at("windCf")}*${P("windDegF")}`, v: vals.wind[t], fmt: "0.00" });
    put(cell("gen"), { f: [d.solar && at("solar"), d.wind && at("wind")].filter(Boolean).join("+"), v: vals.gen[t], fmt: "0.00" });
    put(cell("charge"), { v: y.charge[t], kind: "opt", fmt: "0.00" });
    put(cell("discharge"), { v: y.discharge[t], kind: "opt", fmt: "0.00" });
    if (d.sell) put(cell("sold"), { v: y.sold[t], kind: "opt", fmt: "0.00" });
    const sold = d.sell ? `-${at("sold")}` : "";
    put(cell("direct"), { f: `MIN(${P("contract")}/${P("poi")}-${at("discharge")},${at("gen")}-${at("charge")}${sold})`, v: vals.direct[t], fmt: "0.00" });
    put(cell("curtailed"), { f: `${at("gen")}-${at("direct")}-${at("charge")}${sold}`, v: vals.curtailed[t], fmt: "0.00" });
    const prev = t === 0 ? P("start") : `${L.battery}${r - 1}`;
    put(cell("battery"), { f: `${prev}+${at("charge")}*${P("eta")}-${at("discharge")}/${P("eta")}`, v: vals.battery[t], fmt: "0.00" });
    put(cell("delivered"), { f: `(${at("direct")}+${at("discharge")})*${P("poi")}`, v: vals.delivered[t], fmt: "0.00" });
    if (d.sell) put(cell("soldMeter"), { f: `${at("sold")}*${P("poi")}`, v: vals.soldMeter[t], fmt: "0.00" });
    if (d.blocks) {
      put(cell("floor"), { f: `${P("contract")}*IF(${at("peak")}=1,${P("peakFloor")},${P("offFloor")})`, v: vals.floor[t], fmt: "0.00" });
      put(cell("short"), { f: `MAX(0,${at("floor")}-${at("delivered")})`, v: vals.short[t], fmt: "0.00" });
    }
  }
  return { totals, values: vals };
}
