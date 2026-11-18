// The bid-input template as an Excel workbook: written from a tab's state (its current values in
// yellow input cells, each with a note saying what the input is, its unit, the values allowed and
// the "Fill up for me please" value; dropdowns for every choice and a range check on every
// number), and read back into the tab's state. A file with any wrong cell is refused whole, with
// the sheet, the cell and the reason for each, so a typo never reaches the model.
//
// ExcelJS (to write) and JSZip (to read, through ./xlsxCells.js, whatever program saved the file)
// are passed in: the browser loads them on the click, the Node checks the packages. Checked by
// tools/check_bid_input_sheet.mjs.

import { AUG_YEARS, augmentationOf, otherLinesOf } from "./inputSheet.js";
import { readXlsx } from "./xlsxCells.js";

export const TEMPLATE_VERSION = 1;
const MARK = "TenderOS bid inputs";
const SHEET = { readme: "Read me", inputs: "Bid inputs", aug: "Battery augmentation", lines: "Other fixed costs", lists: "Lists" };
const LINE_ROWS = 15;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round = (v, d = 9) => Math.round(v * 10 ** d) / 10 ** d;

const FONT = { name: "Arial", size: 10 };
const INPUT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
const GROUP_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F1" } };
const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
const BORDER = { top: { style: "thin", color: { argb: "FFBFBFBF" } }, bottom: { style: "thin", color: { argb: "FFBFBFBF" } }, left: { style: "thin", color: { argb: "FFBFBFBF" } }, right: { style: "thin", color: { argb: "FFBFBFBF" } } };

/** A value in the units the sheet shows (percent for a percent row, the option's label for a choice). */
export function shownValue(row, v) {
  if (v === null || v === undefined || v === "") return null;
  if (row.kind === "boolean") return v ? "Yes" : "No";
  if (row.kind === "choice") return row.options.find(([k]) => String(k) === String(v))?.[1] ?? String(v);
  if (row.kind === "date") return String(v).slice(0, 10);
  if (row.pct && isNum(v)) return round(v * 100, 6);
  return v;
}

const allowedText = (row) => {
  if (row.kind === "boolean") return "Yes or No";
  if (row.kind === "choice") return `One of: ${row.options.map(([, l]) => l).join(" | ")}`;
  if (row.kind === "date") return "A date (dd-mmm-yyyy)";
  const range = isNum(row.min) && isNum(row.max) ? `${row.min} to ${row.max}` : isNum(row.min) ? `${row.min} or more` : "a number";
  return `${row.int ? "A whole number, " : ""}${range}${row.pct ? " (percent: 24 means 24%)" : ""}`;
};

const noteText = (row, current) => [
  row.label,
  row.about,
  row.unit ? `Unit: ${row.unit}${row.pct ? " (type 24 for 24%)" : ""}.` : null,
  `Allowed: ${allowedText(row)}.`,
  row.benchmark !== null && row.benchmark !== undefined ? `"Fill up for me please" puts: ${shownValue(row, row.benchmark)}${row.unit && row.kind === "number" ? ` ${row.unit}` : ""}.` : null,
  row.where ? `In the app: ${row.where}.` : null,
  current === null ? "Empty in the app now. Blank keeps it empty." : "Blank keeps the app's value.",
].filter(Boolean).join("\n");

/**
 * The template workbook for a tab's state: `rows` from ./inputSheet.js sheetRows, `meta`
 * { module, title, tender }. Returns the ExcelJS workbook (call workbook.xlsx.writeBuffer()).
 */
export function buildInputWorkbook(ExcelJS, { state, rows, meta }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TenderOS";
  wb.title = `${meta.title}: bid inputs`;
  const readme = wb.addWorksheet(SHEET.readme, { properties: { tabColor: { argb: "FF1F3864" } } });
  const ws = wb.addWorksheet(SHEET.inputs, { views: [{ state: "frozen", ySplit: 4, xSplit: 2 }] });
  const aug = wb.addWorksheet(SHEET.aug, { views: [{ state: "frozen", ySplit: 4 }] });
  const lines = wb.addWorksheet(SHEET.lines, { views: [{ state: "frozen", ySplit: 4 }] });
  const lists = wb.addWorksheet(SHEET.lists, { state: "veryHidden" });

  // ---- Read me
  readme.columns = [{ width: 4 }, { width: 110 }];
  const say = (r, text, o = {}) => { const c = readme.getCell(r, 2); c.value = text; c.font = { ...FONT, ...o.font }; c.alignment = { wrapText: true, vertical: "top" }; if (o.fill) c.fill = o.fill; };
  say(1, `${meta.title}: bid inputs`, { font: { size: 14, bold: true } });
  say(2, `${meta.tender} · template written ${new Date().toISOString().slice(0, 10)} from the app's current values`, { font: { italic: true, color: { argb: "FF595959" } } });
  const steps = [
    ["How to use it", true],
    ["1. Fill the yellow cells on the sheet 'Bid inputs' (and, if you use them, 'Battery augmentation' and 'Other fixed costs'). Every yellow cell has a note: hover over it (or select it) to read what the input is, its unit, the values allowed and what 'Fill up for me please' would put there.", false],
    ["2. Choices have a dropdown; numbers are checked against their range as you type. Percent inputs are typed in percent: 24 means 24%.", false],
    ["3. A blank cell on 'Bid inputs' keeps the app's value. To change a value, type the new one; nothing else on the sheet needs to change. Do not change the Key column: the app finds each input by its key, so rows may be sorted or moved.", false],
    ["4. In the app, on the Bid inputs, Design or Finance inputs step, click 'Upload bid inputs' beside 'Fill up for me please' and choose this file. The file is read in your browser; it is not sent anywhere.", false],
    ["5. The app checks every cell first. If any cell is wrong (text in a number cell, a value out of range, a choice not in the list, a frozen input changed), nothing is loaded and the app lists each cell with the reason. Correct them and upload again. If every cell is right, the app loads them all and lists what changed.", false],
    ["6. After the upload the own RE is sized again for the least tariff unless 'Own RE size' says 'Your size' (or you changed the solar or wind size, which then becomes your size). Any input still empty is listed: fill it here or click 'Fill up for me please'.", false],
    ["Colours: yellow cells with blue figures are inputs; everything else is a label or a help column.", false],
    ["The tables: 'Battery augmentation' is used only when 'Battery augmentation (finance team)' says 'Year by year'; blank years add nothing. 'Other fixed costs' replaces the app's list of named fixed-cost lines: a row with a cost is a line, an empty table removes the lines.", false],
  ];
  steps.forEach(([text, head], k) => say(4 + k, text, head ? { font: { bold: true, size: 11 } } : {}));
  say(5 + steps.length, `${MARK} · ${meta.module} · v${TEMPLATE_VERSION}`, { font: { size: 8, color: { argb: "FF808080" } } });

  // ---- the lists behind the dropdowns
  let listCol = 0;
  const listRef = (labels) => {
    listCol += 1;
    labels.forEach((l, k) => { lists.getCell(k + 1, listCol).value = l; });
    const col = lists.getColumn(listCol).letter;
    return `'${SHEET.lists}'!$${col}$1:$${col}$${labels.length}`;
  };
  const yesNo = listRef(["Yes", "No"]);

  // ---- Bid inputs
  ws.columns = [{ width: 26 }, { width: 46 }, { width: 22 }, { width: 18 }, { width: 40 }, { width: 18 }, { width: 70 }, { width: 26 }];
  ws.getCell("A1").value = `${meta.title}: bid inputs`;
  ws.getCell("A1").font = { ...FONT, size: 14, bold: true };
  ws.getCell("A2").value = "Fill the yellow cells; each has a note. A blank cell keeps the app's value. Upload the file with 'Upload bid inputs' beside 'Fill up for me please'.";
  ws.getCell("A2").font = { ...FONT, italic: true, color: { argb: "FF595959" } };
  const head = ["Group", "Input", "Value", "Unit", "Allowed", "Fill up for me", "What it is", "Key (do not change)"];
  head.forEach((h, k) => { const c = ws.getCell(4, k + 1); c.value = h; c.font = { ...FONT, bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HEAD_FILL; c.alignment = { vertical: "middle", wrapText: true }; c.border = BORDER; });
  let r = 5;
  let group = null;
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      ws.mergeCells(r, 1, r, 8);
      const c = ws.getCell(r, 1); c.value = group; c.font = { ...FONT, bold: true }; c.fill = GROUP_FILL;
      r += 1;
    }
    const current = row.get(state);
    const cells = [row.group, row.label, null, row.unit || "", allowedText(row), shownValue(row, row.benchmark) ?? "", row.about, row.key];
    cells.forEach((v, k) => { const c = ws.getCell(r, k + 1); c.value = v; c.font = { ...FONT, ...(k === 7 ? { color: { argb: "FF808080" }, size: 8 } : {}) }; c.alignment = { vertical: "top", wrapText: k === 4 || k === 6 }; c.border = BORDER; });
    const v = ws.getCell(r, 3);
    const shown = shownValue(row, current);
    if (row.kind === "date" && shown) { const [y, m, d] = shown.split("-").map(Number); v.value = new Date(Date.UTC(y, m - 1, d)); v.numFmt = "dd-mmm-yyyy"; } else v.value = shown;
    if (row.kind === "date" && !shown) v.numFmt = "dd-mmm-yyyy";
    v.fill = INPUT_FILL;
    v.font = { ...FONT, color: { argb: "FF0000FF" } };
    v.note = { texts: [{ text: noteText(row, shown) }], margins: { insetmode: "auto" } };
    if (row.kind === "number") {
      const lo = isNum(row.min) ? row.min : -1e12;
      const hi = isNum(row.max) ? row.max : 1e12;
      v.dataValidation = { type: row.int ? "whole" : "decimal", operator: "between", allowBlank: true, formulae: [lo, hi], showErrorMessage: true, errorStyle: "stop", errorTitle: row.label, error: `${allowedText(row)}.`, showInputMessage: false };
    } else if (row.kind === "choice" || row.kind === "boolean") {
      v.dataValidation = { type: "list", allowBlank: true, formulae: [row.kind === "boolean" ? yesNo : listRef(row.options.map(([, l]) => l))], showErrorMessage: true, errorStyle: "stop", errorTitle: row.label, error: "Choose from the list." };
    } else if (row.kind === "date") {
      v.dataValidation = { type: "date", operator: "greaterThan", allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, errorStyle: "stop", errorTitle: row.label, error: "Type a date, for example 01-Feb-2027." };
    }
    r += 1;
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: r - 1, column: 8 } };

  // ---- Battery augmentation by year
  const tableHead = (sheet, title, note, cols) => {
    sheet.getCell("A1").value = title; sheet.getCell("A1").font = { ...FONT, size: 14, bold: true };
    sheet.getCell("A2").value = note; sheet.getCell("A2").font = { ...FONT, italic: true, color: { argb: "FF595959" } };
    cols.forEach((h, k) => { const c = sheet.getCell(4, k + 1); c.value = h; c.font = { ...FONT, bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HEAD_FILL; c.alignment = { wrapText: true, vertical: "middle" }; c.border = BORDER; });
  };
  const inputCell = (c, value, note, validation) => {
    c.value = value; c.fill = INPUT_FILL; c.font = { ...FONT, color: { argb: "FF0000FF" } }; c.border = BORDER;
    if (note) c.note = { texts: [{ text: note }], margins: { insetmode: "auto" } };
    if (validation) c.dataValidation = { allowBlank: true, showErrorMessage: true, errorStyle: "stop", ...validation };
  };
  aug.columns = [{ width: 16 }, { width: 30 }, { width: 30 }];
  tableHead(aug, "Battery augmentation by year", "Used only when 'Battery augmentation (finance team)' on 'Bid inputs' says 'Year by year'. MWh added in an operating year, as a percent of the nameplate MWh; blank or 0: none that year. The cost is optional: blank prices it at the battery capex less its yearly fall.", ["Operating year", "MWh added (% of nameplate)", "Cost (₹ cr, optional)"]);
  augmentationOf(state).forEach((a, k) => {
    const row = 5 + k;
    const y = aug.getCell(row, 1); y.value = a.year; y.font = FONT; y.border = BORDER;
    inputCell(aug.getCell(row, 2), a.pct === null ? null : round(a.pct * 100, 6), k === 0 ? "Percent of the nameplate MWh added in this operating year: 6 means 6%. Blank or 0: none." : null, { type: "decimal", operator: "between", formulae: [0, 100], errorTitle: "MWh added", error: "A percent from 0 to 100." });
    inputCell(aug.getCell(row, 3), a.cr, k === 0 ? "The year's augmentation cost in ₹ crore, if you know it. Blank: the battery capex per MWh less its yearly fall, times the MWh added." : null, { type: "decimal", operator: "between", formulae: [0, 1e6], errorTitle: "Cost", error: "₹ crore, 0 or more." });
  });

  // ---- Other fixed cost lines
  lines.columns = [{ width: 44 }, { width: 20 }, { width: 30 }];
  tableHead(lines, "Other fixed costs", "Named fixed-cost lines (a land lease, a fee) on top of the per-MW admin cost. This table replaces the app's list: a row with a cost is a line; an empty table removes the lines.", ["Line", "₹ cr a year (year 1)", "Escalation (% a year; blank: the O&M escalation)"]);
  const current = otherLinesOf(state);
  for (let k = 0; k < LINE_ROWS; k += 1) {
    const l = current[k] || { label: null, crPerYear: null, escalation: null };
    const row = 5 + k;
    inputCell(lines.getCell(row, 1), l.label || null, k === 0 ? "What the cost is, for example 'Land lease, own solar'." : null, null);
    inputCell(lines.getCell(row, 2), l.crPerYear, k === 0 ? "The cost in the first operating year in ₹ crore; it escalates at the rate beside." : null, { type: "decimal", operator: "between", formulae: [0, 1e6], errorTitle: "Cost", error: "₹ crore, 0 or more." });
    inputCell(lines.getCell(row, 3), l.escalation === null ? null : round(l.escalation * 100, 6), k === 0 ? "Percent a year: 10 means 10%. Blank: the common O&M escalation." : null, { type: "decimal", operator: "between", formulae: [-20, 50], errorTitle: "Escalation", error: "A percent from -20 to 50." });
  }
  return wb;
}

// ---------------------------------------------------------------- reading

/** A cell's value as typed (./xlsxCells.js): text trimmed, blank text as empty. */
function cellValue(cell) {
  let v = cell?.value;
  if (typeof v === "string") { v = v.trim(); if (v === "") return null; }
  return v ?? null;
}
const isPercentFormat = (cell) => /%/.test(String(cell?.numFmt || ""));
const NUM_RE = /^[-+]?(\d{1,3}(,\d{2,3})*|\d+)(\.\d+)?$/;

function readNumber(raw, cell, row) {
  let n;
  let percentGiven = false;
  if (typeof raw === "number") { n = raw; percentGiven = row.pct && isPercentFormat(cell); }
  else if (typeof raw === "string") {
    let t = raw.replace(/₹|rs\.?|inr/gi, "").replace(/\s+/g, "");
    if (t.endsWith("%")) { percentGiven = true; t = t.slice(0, -1); }
    if (!NUM_RE.test(t)) throw new Error(`"${raw}" is not a number.`);
    n = Number(t.replace(/,/g, ""));
    if (percentGiven && !row.pct) throw new Error(`"${raw}": this input is not a percent (unit ${row.unit || "none"}).`);
    percentGiven = false; // "24%" typed as text is already in percent
  } else if (typeof raw === "boolean") throw new Error("a number is needed, not TRUE or FALSE.");
  else throw new Error("a number is needed.");
  // a number in a cell formatted as a percentage is held as a fraction (24% is 0.24)
  if (percentGiven) n *= 100;
  n = round(n, 9);
  if (row.int && !Number.isInteger(n)) throw new Error(`${n} is not a whole number.`);
  if (isNum(row.min) && n < row.min - 1e-9) throw new Error(`${n} is below the lowest allowed, ${row.min}${row.pct ? "%" : ""}.`);
  if (isNum(row.max) && n > row.max + 1e-9) throw new Error(`${n} is above the highest allowed, ${row.max}${row.pct ? "%" : ""}.`);
  return row.pct ? round(n / 100, 12) : n;
}

const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function readDate(raw) {
  let y; let m; let d;
  if (raw instanceof Date) { y = raw.getUTCFullYear(); m = raw.getUTCMonth() + 1; d = raw.getUTCDate(); }
  else if (typeof raw === "number") { const t = new Date(Math.round((raw - 25569) * 86400000)); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); }
  else {
    const t = String(raw).trim();
    let k;
    if ((k = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [Number(k[1]), Number(k[2]), Number(k[3])];
    else if ((k = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, m, y] = [Number(k[1]), Number(k[2]), Number(k[3])];
    else if ((k = t.match(/^(\d{1,2})[-\s/.]([A-Za-z]{3})[A-Za-z]*[-\s/.,]*(\d{4})$/)) && MONTH[k[2].toLowerCase()]) [d, m, y] = [Number(k[1]), MONTH[k[2].toLowerCase()], Number(k[3])];
    else throw new Error(`"${t}" is not a date; type it as 01-Feb-2027.`);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 2000 || y > 2100) throw new Error("not a valid date.");
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function readCell(raw, cell, row) {
  if (raw && typeof raw === "object" && "error" in raw) throw new Error(`the cell shows ${raw.error}.`);
  if (row.kind === "number") return readNumber(raw, cell, row);
  if (row.kind === "date") return readDate(raw);
  const t = String(raw).trim().toLowerCase();
  if (row.kind === "boolean") {
    if (raw === true || /^(yes|y|true|1)$/.test(t)) return true;
    if (raw === false || /^(no|n|false|0)$/.test(t)) return false;
    throw new Error(`"${raw}": choose Yes or No.`);
  }
  const hit = row.options.find(([k, l]) => String(k).toLowerCase() === t || l.toLowerCase() === t);
  if (!hit) throw new Error(`"${raw}" is not in the list: ${row.options.map(([, l]) => l).join(" | ")}.`);
  return hit[0];
}

const same = (row, a, b) => {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (row.kind === "number" && isNum(a) && isNum(b)) return Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a));
  return String(a) === String(b);
};

/**
 * Read an uploaded template into the tab's state. Returns { ok, state, changes, errors, read }:
 * on any error ok is false and state is the state passed in, unchanged; errors are
 * { sheet, cell, label, value, message }; changes are { label, from, to } in the sheet's units.
 */
export async function readInputWorkbook(JSZip, data, { state, rows, meta }) {
  let book;
  try { book = await readXlsx(JSZip, data); } catch { return { ok: false, state, changes: [], read: 0, errors: [{ sheet: "", cell: "", label: "The file", value: "", message: "It is not an Excel workbook (.xlsx). Download the template from the tab and fill that." }] }; }
  const fail = (message) => ({ ok: false, state, changes: [], read: 0, errors: [{ sheet: "", cell: "", label: "The file", value: "", message }] });
  // the template's mark: which tab wrote it
  let mark = null;
  for (const name of book.names) {
    for (const c of (await book.sheet(name)).all()) { const v = cellValue(c); const m = typeof v === "string" && v.match(/^TenderOS bid inputs · ([\w-]+) · v(\d+)$/); if (m) mark = { module: m[1], version: Number(m[2]) }; }
  }
  if (!mark) return fail("It is not a TenderOS bid-input template. Download the template from the tab ('Download input template') and fill that.");
  if (mark.module !== meta.module) return fail(`It is the template of another tab (${mark.module}); this tab is ${meta.title}. Download this tab's template.`);
  if (mark.version > TEMPLATE_VERSION) return fail("It was written by a newer TenderOS; update the application to read it.");
  const ws = await book.sheet(SHEET.inputs);
  if (!ws) return fail(`The sheet '${SHEET.inputs}' is missing.`);
  // the header row and the Value and Key columns, wherever they are now
  let headRow = null; let valueCol = null; let keyCol = null;
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headRow; r += 1) {
    for (let col = 1; col <= 30; col += 1) { const v = String(cellValue(ws.cell(r, col)) || ""); if (/^key\b/i.test(v)) keyCol = col; if (/^value$/i.test(v)) valueCol = col; }
    if (keyCol && valueCol) headRow = r; else { keyCol = null; valueCol = null; }
  }
  if (!headRow) return fail(`The sheet '${SHEET.inputs}' has lost its Value or Key column header.`);

  const byKey = Object.fromEntries(rows.map((x) => [x.key, x]));
  const errors = [];
  const values = [];
  const seen = new Set();
  const locked = (key) => Boolean(state.locks?.[key] || state.locks?.[`inputs.${key}`]);
  for (let r = headRow + 1; r <= ws.rowCount; r += 1) {
    const keyCell = ws.cell(r, keyCol);
    if (keyCell.isMerged) continue; // a group's heading
    const key = cellValue(keyCell);
    if (!key || typeof key !== "string") continue;
    const row = byKey[key];
    const cell = ws.cell(r, valueCol);
    const ref = cell.address;
    if (!row) { errors.push({ sheet: SHEET.inputs, cell: ref, label: key, value: "", message: "Unknown key: the Key column was changed. Download a fresh template." }); continue; }
    if (seen.has(key)) { errors.push({ sheet: SHEET.inputs, cell: ref, label: row.label, value: "", message: "This input appears twice." }); continue; }
    seen.add(key);
    const raw = cellValue(cell);
    if (raw === null) continue; // blank: the app's value stays
    const before = row.get(state);
    // the app's own value written back as it was is kept as it is, even where the app holds it
    // outside the range a box allows today
    const shownBefore = shownValue(row, before);
    if (shownBefore !== null && (raw === shownBefore || (row.kind === "date" && raw instanceof Date && raw.toISOString().slice(0, 10) === shownBefore))) { values.push({ row, v: before, ref: cell.address, changed: false }); continue; }
    let v;
    try { v = readCell(raw, cell, row); } catch (err) { errors.push({ sheet: SHEET.inputs, cell: ref, label: row.label, value: raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw?.error ?? raw), message: err.message }); continue; }
    if (same(row, before, v)) { values.push({ row, v, ref, changed: false }); continue; }
    if (locked(key)) { errors.push({ sheet: SHEET.inputs, cell: ref, label: row.label, value: String(shownValue(row, v)), message: `Frozen in the app at ${shownValue(row, before)}: unfreeze it there first, or put that value back here.` }); continue; }
    values.push({ row, v, ref, changed: true, before });
  }

  // the tables
  const augSheet = await book.sheet(SHEET.aug);
  const aug = { pct: [], cr: [], any: false };
  if (augSheet) {
    for (let r = 5; r <= Math.max(augSheet.rowCount, 5); r += 1) {
      const year = cellValue(augSheet.cell(r, 1));
      if (!isNum(year) || !Number.isInteger(year) || year < 2 || year > AUG_YEARS) continue;
      for (const [col, key, scale, label] of [[2, "pct", 100, "MWh added"], [3, "cr", 1, "Cost"]]) {
        const cell = augSheet.cell(r, col);
        const raw = cellValue(cell);
        if (raw === null) continue;
        try {
          const n = readNumber(raw, cell, { pct: scale === 100, min: 0, max: scale === 100 ? 100 : 1e6, unit: scale === 100 ? "%" : "₹ cr" });
          aug[key][year] = n; if (n > 0) aug.any = true;
        } catch (err) { errors.push({ sheet: SHEET.aug, cell: cell.address, label: `${label}, year ${year}`, value: String(raw), message: err.message }); }
      }
    }
  }
  const lineSheet = await book.sheet(SHEET.lines);
  let otherLines = null;
  if (lineSheet) {
    otherLines = [];
    for (let k = 0; k < LINE_ROWS; k += 1) {
      const r = 5 + k;
      const label = cellValue(lineSheet.cell(r, 1));
      const costCell = lineSheet.cell(r, 2);
      const escCell = lineSheet.cell(r, 3);
      const cost = cellValue(costCell);
      const esc = cellValue(escCell);
      if (label === null && cost === null && esc === null) continue;
      let cr = null; let escalation = null;
      try { cr = cost === null ? null : readNumber(cost, costCell, { min: 0, max: 1e6, unit: "₹ cr" }); } catch (err) { errors.push({ sheet: SHEET.lines, cell: costCell.address, label: `Cost of '${label || `row ${r}`}'`, value: String(cost), message: err.message }); continue; }
      try { escalation = esc === null ? null : readNumber(esc, escCell, { pct: true, min: -20, max: 50, unit: "%" }); } catch (err) { errors.push({ sheet: SHEET.lines, cell: escCell.address, label: `Escalation of '${label || `row ${r}`}'`, value: String(esc), message: err.message }); continue; }
      if (cr === null) { errors.push({ sheet: SHEET.lines, cell: costCell.address, label: String(label || `row ${r}`), value: "", message: "A line needs its cost (₹ cr a year); clear the row to remove the line." }); continue; }
      if (label === null) { errors.push({ sheet: SHEET.lines, cell: lineSheet.cell(r, 1).address, label: `row ${r}`, value: "", message: "Name the line (for example 'Land lease')." }); continue; }
      if (cr > 0) otherLines.push({ label: String(label).slice(0, 120), crPerYear: cr, escalation });
    }
  }
  if (errors.length) return { ok: false, state, changes: [], errors, read: values.length };

  // every cell is right: apply them in the sheet's order
  let next = state;
  for (const x of values) {
    if (!x.changed) continue;
    try { next = x.row.set(next, x.v); } catch (err) { errors.push({ sheet: SHEET.inputs, cell: x.ref, label: x.row.label, value: String(shownValue(x.row, x.v)), message: err.message }); }
  }
  if (errors.length) return { ok: false, state, changes: [], errors, read: values.length };
  const changes = values.filter((x) => x.changed).map((x) => ({ label: x.row.label, from: shownValue(x.row, x.before), to: shownValue(x.row, x.v), unit: x.row.unit }));
  if (next.bess?.augmentation === "byYear") {
    const pct = Array.from({ length: AUG_YEARS + 1 }, (_, y) => aug.pct[y] || 0);
    const cr = Array.from({ length: AUG_YEARS + 1 }, (_, y) => aug.cr[y] || 0);
    const was = state.bess || {};
    const differs = (a, b) => a.some((v, y) => Math.abs(v - (b?.[y] || 0)) > 1e-12) || (b || []).some((v, y) => (v || 0) > 0 && !(a[y] > 0));
    if (differs(pct, was.augmentationPct) || differs(cr, was.augmentationCr)) {
      changes.push({ label: "Battery augmentation by year", from: "", to: `${pct.filter((v) => v > 0).length} years with MWh added`, unit: null });
      next = { ...next, bess: { ...(next.bess || {}), augmentation: "byYear", augmentationPct: pct, augmentationCr: cr } };
    }
  }
  if (otherLines) {
    const was = otherLinesOf(state);
    const key = (ls) => JSON.stringify(ls.map((l) => [l.label, round(l.crPerYear ?? 0, 9), l.escalation === null ? null : round(l.escalation, 9)]));
    if (key(was) !== key(otherLines)) {
      changes.push({ label: "Other fixed cost lines", from: `${was.length} line${was.length === 1 ? "" : "s"}`, to: `${otherLines.length} line${otherLines.length === 1 ? "" : "s"}`, unit: null });
      next = { ...next, fin: { ...(next.fin || {}), otherFixedLines: otherLines } };
    }
  }
  return { ok: true, state: next, changes, errors: [], read: values.length };
}

/** The file name of a tab's template. */
export const templateFileName = (state, meta) => `${meta.module}-bid-inputs${Number.isFinite(state?.inputs?.contractedMw) ? `-${state.inputs.contractedMw}mw` : ""}.xlsx`;
