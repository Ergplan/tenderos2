// The CfD bid's financial model with its 15-minute dispatch behind the energy (the second version
// of the workbook: POST /api/cfd/model with `blocks15` and the saved bid state).
//
// The first version carries each operating year's energy as values from the day-by-day model. Here
// the Live model's "Contracted energy", "Delivered to the procurer" and "Sold in the market" rows
// are formulas, and the chain behind them is on these sheets:
//
//   Live model, year y      = '15-min by year' row of year y ÷ 1000
//   15-min by year          = SUMIFS over '15-min by day' by operating year
//   15-min by day           = SUM over the day's 96 blocks on the block sheets (same row number)
//   15-min supply due       = contracted MW × ¼ h in each of the day's 8 peak blocks (formulas)
//   15-min supplied, sold,  = the dispatch's MWh in each block (values: the model's output, green)
//   15-min charge …
//
// One row per day of the term on every sheet (the day's row number is the same on all of them),
// one column per 15-minute block on the block sheets; only blocks with energy are written, so an
// empty cell is zero. The blocks come from web/src/cfd/dispatch15.js on the model of the saved bid
// (the same run as the 15-minute dispatch export), so a year's sum equals the model's year
// (tools/check_cfd_blocks.mjs recalculates the workbook and proves it).
import { TENDER } from "../src/cfd/terms.js";
import { BLOCKS_PER_DAY, DT, blockTime, dispatch15 } from "../src/cfd/dispatch15.js";
import { modelOf } from "./cfdDispatch.js";

export const BLOCK_SHEETS = {
  years: "15-min by year",
  days: "15-min by day",
  due: "15-min supply due",
  supplied: "15-min supplied",
  sold: "15-min sold",
  own: "15-min charge own RE",
  market: "15-min charge market",
  group: "15-min charge group RE",
};
/** The block sheets holding the dispatch's values: [key, the dispatch15 column, heading, where it is measured]. */
const VALUE_SHEETS = [
  ["supplied", "delivered", "Supplied under the CfD", "at the meter"],
  ["sold", "sold", "Surplus sold in the market", "at the meter"],
  ["own", "chargeOwn", "Battery charged from own RE", "at the 33 kV bus"],
  ["market", "chargeMarket", "Battery charged from the green market", "at the meter"],
  ["group", "chargeGroup", "Battery charged from group RE", "at the meter"],
];
/** The columns of '15-min by day' and '15-min by year' that sum a block sheet: key → column letter. */
const DAY_COL = { due: "E", supplied: "F", sold: "I", own: "J", market: "K", group: "L" };
const DAY_ROW0 = 5; // the first day's row on the day sheet and on every block sheet
const YEAR_ROW0 = 8; // the first operating year's row on '15-min by year'
const CONTRACT_CELL = "$B$4";
const HOURS_CELL = "$B$5";
const BLOCK_COL0 = 3; // block 1 is column C
const DECIMALS = 5; // MWh in a block to 0.01 kWh: the sheets' sums are then the workbook's energy
const ACCENT = "FFD4FF3F";
const INK = "FF111111";
const GREEN = "FF00703C";
const NUM = "#,##0.00;-#,##0.00;-";
const DATE = "dd-mmm-yyyy";

const colName = (n) => { let s = ""; for (let c = n; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s; return s; };
const LAST_BLOCK = colName(BLOCK_COL0 + BLOCKS_PER_DAY - 1);
const q = (name) => `'${name}'`;
const round = (v) => { const p = 10 ** DECIMALS; return Math.round(v * p) / p; };
const fail = (status, message) => Object.assign(new Error(message), { status });

/**
 * The bid's 15-minute dispatch, held for the sheets: every day's blocks with energy (sparse) and
 * the sums per day and per operating year (365 days from the SCD, the last with the term's few
 * extra days: the financial model's years). Throws a 400 when the bid cannot be modelled.
 */
export function cfdBlockData(stateIn) {
  const { model } = modelOf(stateIn);
  const nOp = model.opYears.length;
  const X = model.inputs.contractedMw;
  const days = [];
  const years = model.opYears.map((o) => ({ year: o.index, start: o.start, end: o.end, days: 0, due: 0, supplied: 0, sold: 0, own: 0, market: 0, group: 0 }));
  dispatch15(model, {
    onDay: (d) => {
      const oy = Math.min(nOp - 1, Math.floor(d.k / 365)) + 1;
      const rec = { k: d.k, date: d.date, cy: d.cy, oy, peak: [], sum: { due: 0 } };
      for (let b = 0; b < BLOCKS_PER_DAY; b += 1) if (d.cols.peak[b]) rec.peak.push(b);
      rec.sum.due = X * DT * rec.peak.length;
      for (const [key, col] of VALUE_SHEETS) {
        const cells = [];
        let sum = 0;
        for (let b = 0; b < BLOCKS_PER_DAY; b += 1) {
          const v = round(d.cols[col][b] * DT);
          if (v > 0) { cells.push(b, v); sum += v; }
        }
        rec[key] = cells;
        rec.sum[key] = sum;
      }
      const y = years[oy - 1];
      y.days += 1;
      for (const k of Object.keys(DAY_COL)) y[k] += rec.sum[k];
      days.push(rec);
    },
  });
  return { model, contractedMw: X, days, years };
}

/**
 * The operating years' energy as the sheets hold it, laid over a Live model request's years: the
 * contracted, supplied and sold MWh of each year of the term become the sheets' sums (they differ
 * from the request's by rounding alone). Throws a 409 when the request is not the same bid.
 */
export function opsFromBlocks(ops, data) {
  if (!Array.isArray(ops) || ops.length < data.years.length) throw fail(409, "The financial model and the saved bid do not have the same years. Save the bid and download again.");
  const near = (a, b) => Math.abs(a - b) <= 0.5 + 1e-5 * Math.max(Math.abs(a), Math.abs(b));
  return ops.map((o, i) => {
    const y = data.years[i];
    if (!y) return o; // market years after the term: no dispatch behind them
    if (!near(o.demandMWh, y.due) || !near(o.deliveredMWh, y.supplied) || !near(o.excessMWh, y.sold)) {
      throw fail(409, `The 15-minute dispatch of the saved bid does not match the financial model in year ${y.year}. Save the bid and download again.`);
    }
    return { ...o, demandMWh: y.due, deliveredMWh: y.supplied, excessMWh: y.sold };
  });
}

/**
 * What the Live model needs to read its energy from the sheets (addLiveModel's `blocks`): the
 * formula and the value, in MU, of a row of '15-min by year' for an operating year of the term.
 */
export function blockBackup(data) {
  return {
    years: data.years.length,
    contractedMw: data.contractedMw,
    sheets: BLOCK_SHEETS,
    ref: (key, y) => (y >= 1 && y <= data.years.length && DAY_COL[key]
      ? { f: `${q(BLOCK_SHEETS.years)}!$${DAY_COL[key]}$${YEAR_ROW0 + y - 1}/1000`, v: data.years[y - 1][key] / 1000 }
      : null),
  };
}

function title(ws, text, note) {
  const a = ws.getCell("A1");
  a.value = text;
  a.font = { bold: true, size: 14 };
  const b = ws.getCell("A2");
  b.value = note;
  b.font = { italic: true, color: { argb: "FF555555" } };
}

function head(row, from = 1) {
  row.eachCell((cell, col) => {
    if (col < from) return;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

const formula = (cell, f, v) => {
  cell.value = { formula: f, result: v };
  if (v === 0 && cell._value?.model) cell._value.model.result = 0; // exceljs drops a zero result
};

/**
 * Write the sheets. `contractRef` is the Inputs cell of the contracted capacity (sheet-qualified);
 * the supply due on every peak block is a formula on it.
 */
export function addBlockSheets(wb, data, { contractRef }) {
  const S = BLOCK_SHEETS;
  const n = data.days.length;
  const lastDay = DAY_ROW0 + n - 1;
  const lastYear = YEAR_ROW0 + data.years.length - 1;
  const dayRange = (col) => `${q(S.days)}!$${col}$${DAY_ROW0}:$${col}$${lastDay}`;

  // ---- by operating year: what the Live model reads
  const wy = wb.addWorksheet(S.years, { properties: { tabColor: { argb: ACCENT } } });
  title(wy, "15-minute dispatch by operating year", "The Live model's energy rows read this sheet. Each number is the sum of the days of the year on '15-min by day', and each day is the sum of its 96 blocks on the block sheets.");
  wy.getCell("A4").value = "Contracted capacity (MW)";
  formula(wy.getCell("B4"), contractRef, data.contractedMw);
  wy.getCell("C4").value = "From the Inputs sheet (the bid)";
  wy.getCell("A5").value = "Hours in a 15-minute block";
  wy.getCell("B5").value = DT;
  wy.getCell("C5").value = `96 blocks a day; the supply is due in ${TENDER.peakHours * 4} of them (the ${TENDER.peakHours} peak hours of the day, ${TENDER.mwhPerMwDay} MWh per MW)`;
  const yHead = wy.getRow(YEAR_ROW0 - 1);
  ["Operating year", "From", "To", "Days", "Supply due (MWh)", "Supplied (MWh, meter)", "Short of the supply due (MWh)", "Supplied ÷ due", "Surplus sold (MWh, meter)", "Charged from own RE (MWh, bus)", "Charged from the green market (MWh, meter)", "Charged from group RE (MWh, meter)"]
    .forEach((t, i) => { yHead.getCell(i + 1).value = t; });
  head(yHead);
  yHead.height = 46;
  data.years.forEach((y, i) => {
    const r = YEAR_ROW0 + i;
    const row = wy.getRow(r);
    row.getCell(1).value = y.year;
    row.getCell(2).value = new Date(y.start);
    row.getCell(3).value = new Date(y.end - 86400000);
    formula(row.getCell(4), `COUNTIF(${dayRange("C")},$A${r})`, y.days);
    for (const [key, col] of Object.entries(DAY_COL)) formula(row.getCell(col.charCodeAt(0) - 64), `SUMIFS(${dayRange(col)},${dayRange("C")},$A${r})`, y[key]);
    formula(row.getCell(7), `E${r}-F${r}`, y.due - y.supplied);
    formula(row.getCell(8), `IF(E${r}>0,F${r}/E${r},0)`, y.due > 0 ? y.supplied / y.due : 0);
  });
  const tot = wy.getRow(lastYear + 1);
  tot.getCell(1).value = "Term";
  const sumOf = (k) => data.years.reduce((a, y) => a + y[k], 0);
  formula(tot.getCell(4), `SUM(D${YEAR_ROW0}:D${lastYear})`, n);
  for (const [key, col] of Object.entries(DAY_COL)) formula(tot.getCell(col.charCodeAt(0) - 64), `SUM(${col}${YEAR_ROW0}:${col}${lastYear})`, sumOf(key));
  formula(tot.getCell(7), `E${lastYear + 1}-F${lastYear + 1}`, sumOf("due") - sumOf("supplied"));
  formula(tot.getCell(8), `IF(E${lastYear + 1}>0,F${lastYear + 1}/E${lastYear + 1},0)`, sumOf("due") > 0 ? sumOf("supplied") / sumOf("due") : 0);
  tot.font = { bold: true };
  for (let r = YEAR_ROW0; r <= lastYear + 1; r += 1) {
    const row = wy.getRow(r);
    row.getCell(2).numFmt = DATE; row.getCell(3).numFmt = DATE;
    for (let c = 4; c <= 12; c += 1) row.getCell(c).numFmt = c === 4 ? "#,##0" : c === 8 ? "0.00%" : NUM;
  }
  wy.getRow(lastYear + 3).getCell(1).value = "Operating years are 365 days from the SCD (the last takes the term's few extra days), as the financial model's years. The sourcing limits of the CfDA are applied per Contract Year (April to March) in the dispatch itself.";
  wy.getRow(lastYear + 3).getCell(1).font = { italic: true, color: { argb: "FF555555" } };
  wy.getColumn(1).width = 30;
  for (let c = 2; c <= 12; c += 1) wy.getColumn(c).width = 17;
  wy.views = [{ state: "frozen", ySplit: YEAR_ROW0 - 1 }];

  // ---- by day: one row a day, each energy the sum of the day's row on a block sheet
  const wd = wb.addWorksheet(S.days, { properties: { tabColor: { argb: ACCENT } } });
  title(wd, "15-minute dispatch by day", "One row per day of the term. Each energy is the sum of the same row on its block sheet (MWh). Short = supply due − supplied: with an availability below 100% a day is supplied below its 2 MWh per MW by design.");
  const dHead = wd.getRow(DAY_ROW0 - 1);
  ["Day of the term", "Date", "Operating year", "Contract Year", "Supply due (MWh)", "Supplied (MWh, meter)", "Short of the supply due (MWh)", "Supplied ÷ due", "Surplus sold (MWh, meter)", "Charged from own RE (MWh, bus)", "Charged from the green market (MWh, meter)", "Charged from group RE (MWh, meter)"]
    .forEach((t, i) => { dHead.getCell(i + 1).value = t; });
  head(dHead);
  dHead.height = 46;
  wd.getColumn(2).numFmt = DATE;
  for (let c = 5; c <= 12; c += 1) wd.getColumn(c).numFmt = c === 8 ? "0.00%" : NUM;
  const rowSum = (sheet, r) => `SUM(${q(sheet)}!$${colName(BLOCK_COL0)}${r}:$${LAST_BLOCK}${r})`;
  for (const d of data.days) {
    const r = DAY_ROW0 + d.k;
    const row = wd.getRow(r);
    row.getCell(1).value = d.k + 1;
    row.getCell(2).value = new Date(d.date);
    row.getCell(3).value = d.oy;
    row.getCell(4).value = d.cy;
    for (const [key, col] of Object.entries(DAY_COL)) formula(row.getCell(col.charCodeAt(0) - 64), rowSum(S[key], r), d.sum[key]);
    formula(row.getCell(7), `E${r}-F${r}`, d.sum.due - d.sum.supplied);
    formula(row.getCell(8), `IF(E${r}>0,F${r}/E${r},0)`, d.sum.due > 0 ? d.sum.supplied / d.sum.due : 0);
  }
  wd.getColumn(1).width = 12; wd.getColumn(2).width = 13; wd.getColumn(3).width = 11; wd.getColumn(4).width = 11;
  for (let c = 5; c <= 12; c += 1) wd.getColumn(c).width = 17;
  wd.views = [{ state: "frozen", xSplit: 2, ySplit: DAY_ROW0 - 1 }];

  // ---- the block sheets: a day a row, a 15-minute block a column
  const blockSheet = (name, heading, note, font = null) => {
    const ws = wb.addWorksheet(name);
    // the columns' look first: the cells written below take it, the headings then set their own
    for (let b = 0; b < BLOCKS_PER_DAY; b += 1) { const col = ws.getColumn(BLOCK_COL0 + b); col.width = 8; col.numFmt = "0.00##"; if (font) col.font = font; }
    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 13;
    ws.getColumn(2).numFmt = DATE;
    title(ws, heading, note);
    const r3 = ws.getRow(DAY_ROW0 - 2);
    const r4 = ws.getRow(DAY_ROW0 - 1);
    r3.getCell(1).value = "Block"; r3.getCell(2).value = "";
    r4.getCell(1).value = "Day of the term"; r4.getCell(2).value = "Date";
    for (let b = 0; b < BLOCKS_PER_DAY; b += 1) { r3.getCell(BLOCK_COL0 + b).value = b + 1; r4.getCell(BLOCK_COL0 + b).value = blockTime(b); }
    head(r3); head(r4);
    ws.views = [{ state: "frozen", xSplit: 2, ySplit: DAY_ROW0 - 1 }];
    return ws;
  };
  const due = blockSheet(S.due, "Supply due in each 15-minute block (MWh)", `Contracted MW × ¼ h in the day's ${TENDER.peakHours * 4} peak blocks: the ${TENDER.peakHours} highest-priced hours of 18:00 to 24:00 in the market sold in. Formulas on the contracted capacity; an empty block has nothing due.`);
  const dueF = `${q(S.years)}!${CONTRACT_CELL}*${q(S.years)}!${HOURS_CELL}`;
  const dueV = data.contractedMw * DT;
  for (const d of data.days) {
    const row = due.getRow(DAY_ROW0 + d.k);
    row.getCell(1).value = d.k + 1;
    row.getCell(2).value = new Date(d.date);
    for (const b of d.peak) formula(row.getCell(BLOCK_COL0 + b), dueF, dueV);
  }
  for (const [key, , heading, at] of VALUE_SHEETS) {
    const ws = blockSheet(S[key], `${heading} in each 15-minute block (MWh, ${at})`, "The dispatch's output (green: values from the model, not formulas). MWh in the block = the block's average MW × ¼ h; an empty block is zero.", { color: { argb: GREEN } });
    for (const d of data.days) {
      const row = ws.getRow(DAY_ROW0 + d.k);
      row.getCell(1).value = d.k + 1;
      row.getCell(2).value = new Date(d.date);
      const cells = d[key];
      for (let i = 0; i < cells.length; i += 2) row.getCell(BLOCK_COL0 + cells[i]).value = cells[i + 1];
    }
  }
  return { sheets: Object.values(S), days: n, years: data.years.length, firstDayRow: DAY_ROW0, firstYearRow: YEAR_ROW0, dayColumns: DAY_COL, firstBlockColumn: BLOCK_COL0 };
}
