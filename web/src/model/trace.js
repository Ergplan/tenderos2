// The traceable financial model: the same "Live model" sheet the bid workbook carries
// (web/lib/liveModel.js), written into an in-memory worksheet instead of an Excel file, so the app
// can show every number with the formula that makes it, the numbers it reads (precedents) and the
// numbers that read it (dependents). Plain JavaScript, used in Node by tools/check_trace.mjs.
import { addLiveModel, liveModelInput, LIVE_SHEET } from "../../lib/liveModel.js";

const colNum = (letters) => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
export const colName = (n) => {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
};
const splitAddr = (addr) => {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(addr);
  return m ? { col: colNum(m[1]), row: Number(m[2]) } : null;
};
export const addrOf = (row, col) => `${colName(col)}${row}`;

// ---- an in-memory stand-in for the few exceljs Worksheet calls the live model makes
class RecCell {
  constructor(sheet, row, col) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.formula = null;
    this.v = null;
    this.numFmt = null;
    this.font = null;
    this.fill = null;
    this.note = null;
  }

  set value(x) {
    if (x && typeof x === "object" && "formula" in x) {
      this.formula = x.formula;
      this.v = x.result === undefined ? null : x.result;
    } else {
      this.formula = null;
      this.v = x ?? null;
    }
    this.sheet.touch(this);
  }

  get value() { return this.formula ? { formula: this.formula, result: this.v } : this.v; }
}

class RecRow {
  constructor(sheet, n) { this.sheet = sheet; this.number = n; this.height = null; }

  getCell(c) { return this.sheet.cellAt(this.number, c); }
}

class RecSheet {
  constructor(name) {
    this.name = name;
    this.cells = new Map(); // "C12" → RecCell
    this.rows = new Map();
    this.maxRow = 0;
    this.maxCol = 0;
    this.views = [];
  }

  cellAt(row, col) {
    const a = addrOf(row, col);
    if (!this.cells.has(a)) this.cells.set(a, new RecCell(this, row, col));
    return this.cells.get(a);
  }

  touch(cell) {
    this.maxRow = Math.max(this.maxRow, cell.row);
    this.maxCol = Math.max(this.maxCol, cell.col);
  }

  getRow(n) {
    if (!this.rows.has(n)) this.rows.set(n, new RecRow(this, n));
    return this.rows.get(n);
  }

  getCell(addr) {
    const p = splitAddr(addr);
    return this.cellAt(p.row, p.col);
  }

  getColumn() { return { width: null }; }

  addConditionalFormatting() {}
}

class RecBook {
  constructor() { this.sheets = []; }

  addWorksheet(name) {
    const s = new RecSheet(name);
    this.sheets.push(s);
    return s;
  }
}

// ---- reading references out of a formula
const STRINGS = /"(?:[^"]|"")*"/g;
const REF = /(?<![A-Z$])\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![\d(A-Z])/g;

/** The cells a formula reads, ranges expanded, in order of first use. */
export function formulaRefs(formula) {
  if (!formula) return [];
  const text = formula.replace(STRINGS, (s) => " ".repeat(s.length));
  const out = [];
  const seen = new Set();
  const add = (a) => { if (!seen.has(a)) { seen.add(a); out.push(a); } };
  for (const m of text.matchAll(REF)) {
    const c1 = colNum(m[1]);
    const r1 = Number(m[2]);
    if (!m[3]) { add(addrOf(r1, c1)); continue; }
    const c2 = colNum(m[3]);
    const r2 = Number(m[4]);
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r += 1) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c += 1) add(addrOf(r, c));
    }
  }
  return out;
}

/** The formula split into text and references, for showing each reference as a chip. */
export function formulaParts(formula) {
  if (!formula) return [];
  const parts = [];
  const masked = formula.replace(STRINGS, (s) => "\u0000".repeat(s.length));
  let last = 0;
  for (const m of masked.matchAll(REF)) {
    if (m.index > last) parts.push({ text: formula.slice(last, m.index) });
    const c1 = colNum(m[1]);
    const r1 = Number(m[2]);
    parts.push(m[3]
      ? { range: [addrOf(r1, c1), addrOf(Number(m[4]), colNum(m[3]))], text: m[0] }
      : { ref: addrOf(r1, c1), text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < formula.length) parts.push({ text: formula.slice(last) });
  return parts;
}

const KIND_OF_FONT = { FF0000FF: "input", FF00703C: "opt" };

/**
 * Build the traceable model from a live-model request (the same `live` block the Excel export
 * sends). Returns the grid with each cell's label, year, value, formula, kind, precedents and
 * dependents, and the addresses of the key results.
 */
export function traceModel(live) {
  const m = liveModelInput(live);
  if (!m) return null;
  const wb = new RecBook();
  const res = addLiveModel(wb, m);
  const ws = wb.sheets[0];
  const N = m.ops.length;
  // the year header row: "Year 0" in D, years in E onwards
  let yearRow = 0;
  for (let r = 1; r <= ws.maxRow && !yearRow; r += 1) if (ws.cells.get(addrOf(r, 4))?.v === "Year 0") yearRow = r;
  // the key results block at the top compares the workbook with the app: its own column names
  let keyHead = 0;
  for (let r = 1; r <= ws.maxRow && !keyHead; r += 1) if (ws.cells.get(addrOf(r, 3))?.v === "This workbook") keyHead = r;
  const rows = [];
  let keyEnd = 0;
  for (let r = 1; r <= ws.maxRow; r += 1) {
    const a = ws.cells.get(addrOf(r, 1));
    const label = a && typeof a.v === "string" ? a.v : "";
    const unit = ws.cells.get(addrOf(r, 2))?.v;
    const section = a?.font?.color?.argb === "FFFFFFFF" && a?.font?.size === 12;
    const group = !section && a?.fill?.fgColor?.argb === "FFEDEDED";
    if (section && keyHead && r > keyHead && !keyEnd) keyEnd = r;
    rows.push({ row: r, label, unit: typeof unit === "string" && r !== yearRow ? unit : "", section, group, note: a?.note || null });
  }
  const inKeys = (r) => keyHead && r > keyHead && r < keyEnd;
  const KEY_COLS = { 3: "This workbook", 4: "App", 5: "Difference", 6: "Same as app?" };
  const colLabel = (r, c) => (inKeys(r) ? KEY_COLS[c] || colName(c)
    : c === 3 ? "Value / total" : c === 4 ? "Year 0" : c >= 5 && c <= 4 + N ? `Year ${c - 4}` : colName(c));
  const cells = {};
  for (const [addr, c] of ws.cells) {
    if (c.col < 3 || c.row < yearRow) continue;
    if (c.row === yearRow && typeof c.v !== "number") continue; // the year numbers are read by the escalation formulas
    if (c.formula === null && (c.v === null || c.v === "")) continue;
    const row = rows[c.row - 1];
    // a one-value row keeps where its input came from in D (text, not a year 0 number)
    const d = ws.cells.get(addrOf(c.row, 4));
    const isSourceText = (cell) => cell && !cell.formula && typeof cell.v === "string" && !inKeys(cell.row);
    if (c.col === 4 && isSourceText(c)) continue;
    if (inKeys(c.row) && c.col >= 4) continue; // the workbook's own check against the app
    cells[addr] = {
      addr,
      row: c.row,
      col: c.col,
      label: c.row === yearRow ? "Year number" : row?.label || "",
      unit: row?.unit || "",
      column: colLabel(c.row, c.col),
      value: c.v,
      formula: c.formula,
      fmt: c.numFmt,
      kind: c.formula ? "calc" : KIND_OF_FONT[c.font?.color?.argb] || (c.font?.italic ? "app" : "value"),
      source: c.col === 3 && isSourceText(d) ? d.v : null,
      refs: formulaRefs(c.formula),
      usedBy: [],
    };
  }
  for (const c of Object.values(cells)) for (const a of c.refs) cells[a]?.usedBy.push(c.addr);
  const keys = Object.fromEntries(Object.entries(res.cells).map(([k, ref]) => [k, ref.split("!").pop().replace(/\$/g, "")]));
  // each model line's key → { addr } for one value, { row } for a year series
  const lines = Object.fromEntries(Object.entries(res.addr || {}).map(([k, a]) => [k, typeof a === "number" ? { row: a } : { addr: String(a).replace(/\$/g, "") }]));
  // each row's line key, and the hourly profiles behind the generation build-up (for the drill-down
  // from a year to its months and 15-minute blocks; the profiles are not part of the Excel request)
  const rowKey = {};
  for (const [k, l] of Object.entries(lines)) rowKey[l.row ?? cells[l.addr]?.row] = k;
  const gen = Object.fromEntries(Object.entries(m.gen || {}).filter(([k]) => live.gen?.[k]?.hourly?.length >= 8760)
    .map(([k, g]) => [k, { ...g, hourly: live.gen[k].hourly }]));
  return { sheet: LIVE_SHEET, title: m.title, engine: m.engine, N, yearRow, maxCol: ws.maxCol, rows, cells, keys, lines, rowKey, gen, values: res.values };
}

/** A short name for a cell: its row label and, for a year series, the year. */
export function cellName(model, addr) {
  const c = model.cells[addr];
  if (!c) return addr;
  return c.col >= 4 ? `${c.label} · ${c.column}` : c.label;
}

/** Every input a cell rests on, followed through all the formulas in between. */
export function inputsOf(model, addr, limit = 50000) {
  const out = [];
  const seen = new Set();
  const stack = [addr];
  while (stack.length && seen.size < limit) {
    const a = stack.pop();
    if (seen.has(a)) continue;
    seen.add(a);
    const c = model.cells[a];
    if (!c) continue;
    if (!c.formula && a !== addr) { out.push(a); continue; }
    stack.push(...c.refs);
  }
  return out.sort((x, y) => model.cells[x].row - model.cells[y].row || model.cells[x].col - model.cells[y].col);
}
