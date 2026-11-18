// A small reader of .xlsx cell values, for the bid-input template (./inputWorkbook.js): each
// sheet's cells with their value as typed (numbers, text, booleans, dates, errors, a formula's
// result), their number format (to tell 24% from 24) and whether they sit in a merged range.
// It reads only what the template needs and does not depend on who wrote the file (Excel,
// LibreOffice, Google Sheets, openpyxl); ExcelJS's reader fails on notes written by some of them.
// JSZip is passed in. No browser APIs: checked in Node by tools/check_bid_input_sheet.mjs.

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()]));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? unescape(m[1]) : null; };
// the text of an <si> or <is>: its <t> runs, without phonetic hints
const textOf = (xml) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => unescape(m[1] || "")).join("");

const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const BUILTIN_FORMATS = { 9: "0%", 10: "0.00%", 14: "mm-dd-yy" };
const isDateFormat = (id, code) => {
  if (BUILTIN_DATES.has(id)) return true;
  if (!code) return false;
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare);
};

/** Column letters and row number of an A1 address. */
export const splitAddress = (a) => { const m = String(a).match(/^([A-Z]+)(\d+)$/); return m ? { col: m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), row: Number(m[2]) } : null; };
export const address = (row, col) => { let s = ""; for (let c = col; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s; return `${s}${row}`; };

/**
 * The workbook's sheets: { names: [..], sheet(name) } where a sheet is { rowCount,
 * cell(row, col) -> { address, value, numFmt, isMerged } }. A value is a number, string, boolean,
 * Date (UTC midnight for a date cell), { error } or null; all() lists the cells that hold something. Throws when the data is not an .xlsx.
 */
export async function readXlsx(JSZip, data) {
  const zip = await JSZip.loadAsync(data);
  const read = async (path) => { const f = zip.file(path); return f ? f.async("string") : null; };
  const workbook = await read("xl/workbook.xml");
  if (!workbook) throw new Error("not an .xlsx workbook");
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);
  const rels = (await read("xl/_rels/workbook.xml.rels")) || "";
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) target[attr(m[0], "Id")] = attr(m[0], "Target");
  const shared = [];
  const sst = await read("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(textOf(m[1] || ""));
  // the number format of each cell style
  const styles = (await read("xl/styles.xml")) || "";
  const codes = { ...BUILTIN_FORMATS };
  for (const m of styles.matchAll(/<numFmt\b[^>]*\/?>/g)) codes[Number(attr(m[0], "numFmtId"))] = attr(m[0], "formatCode");
  const xfs = [];
  const cellXfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (cellXfs) for (const m of cellXfs[1].matchAll(/<xf\b[^>]*\/?>/g)) { const id = Number(attr(m[0], "numFmtId") || 0); xfs.push({ id, code: codes[id] || "General" }); }

  const sheets = {};
  const names = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], "name");
    const rid = attr(m[0], "r:id");
    let path = target[rid];
    if (!name || !path) continue;
    path = path.startsWith("/") ? path.slice(1) : `xl/${path}`;
    names.push(name);
    sheets[name] = path;
  }
  const parsed = {};
  async function sheet(name) {
    if (!(name in sheets)) return null;
    if (parsed[name]) return parsed[name];
    const xml = (await read(sheets[name])) || "";
    const cells = new Map();
    let rowCount = 0;
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c${m[1]}>`;
      const r = attr(tag, "r");
      const at = splitAddress(r);
      if (!at) continue;
      rowCount = Math.max(rowCount, at.row);
      const t = attr(tag, "t") || "n";
      const style = xfs[Number(attr(tag, "s") || 0)] || { id: 0, code: "General" };
      const body = m[2] || "";
      const v = body.match(/<v>([\s\S]*?)<\/v>/);
      let value = null;
      if (t === "s") value = v ? shared[Number(v[1])] ?? null : null;
      else if (t === "inlineStr") { const is = body.match(/<is>([\s\S]*?)<\/is>/); value = is ? textOf(is[1]) : null; }
      else if (t === "str") value = v ? unescape(v[1]) : null;
      else if (t === "b") value = v ? v[1] === "1" : null;
      else if (t === "e") value = { error: v ? unescape(v[1]) : "#ERROR" };
      else if (t === "d") { const d = v ? new Date(unescape(v[1])) : null; value = d && Number.isFinite(d.getTime()) ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) : null; }
      else if (v) {
        const n = Number(v[1]);
        value = Number.isFinite(n) ? n : null;
        if (value !== null && isDateFormat(style.id, style.code)) value = new Date(Math.round((value + (date1904 ? 1462 : 0) - 25569) * 86400000));
      }
      if (typeof value === "string" && value.trim() === "") value = null;
      cells.set(r, { address: r, value, numFmt: style.code, isMerged: false });
    }
    // every cell of a merged range but its first is merged; the first carries the value
    const merged = new Set();
    for (const mm of xml.matchAll(/<mergeCell\b[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
      const a = splitAddress(mm[1]); const b = splitAddress(mm[2]);
      for (let row = a.row; row <= b.row; row += 1) for (let col = a.col; col <= b.col; col += 1) merged.add(address(row, col));
    }
    const out = {
      rowCount,
      all: () => [...cells.values()],
      cell: (row, col) => { const a = address(row, col); const c = cells.get(a) || { address: a, value: null, numFmt: "General" }; return { ...c, isMerged: merged.has(a) }; },
    };
    parsed[name] = out;
    return out;
  }
  return { names, sheet };
}
