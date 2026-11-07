// The bid financial model workbook (Tender to Bid and Round the clock): cover page, the Live
// model (the whole financial model as Excel formulas, web/lib/liveModel.js), the tender's
// conditions when there is a tender, inputs, plant and capex, and the app's own numbers by year
// (revenue and costs by stream, the full financial model) for reference. The browser computes
// the model (web/src/rtc/engine.js) and sends it; this lays it out.
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { addLiveModel, liveModelInput } from "./liveModel.js";

const FMT = { cr: "#,##0.00", mu: "#,##0", tariff: "0.000", pct: "0.00%", x: "0.00", mw: "#,##0", int: "0", text: "@" };
const INK = "FF111111";
const ACCENT = "FFD4FF3F";

const str = (v, n = 400) => String(v ?? "").slice(0, n);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function header(row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  row.alignment = { vertical: "middle" };
}

function band(row, text) {
  row.getCell(1).value = text;
  row.font = { bold: true, color: { argb: INK } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
}

function addLogo(wb, ws) {
  const logoPath = path.join(process.cwd(), "public", "brand", "tenderos-logo.png");
  if (!fs.existsSync(logoPath)) return 0;
  const logo = wb.addImage({ buffer: fs.readFileSync(logoPath), extension: "png" });
  ws.addRow([]); ws.addRow([]); ws.addRow([]);
  ws.getRow(1).height = 24; ws.getRow(2).height = 24;
  ws.addImage(logo, { tl: { col: 0, row: 0 }, ext: { width: 196, height: 46 } });
  return 3;
}

/** label / value rows; value may be a number with a format key, or text. A link key names the
 * Live model cell the value comes from: the cell is then a formula on that sheet. */
function pairs(ws, items, links = {}) {
  for (const item of items || []) {
    const [label, value, fmt, note, link] = item;
    const row = ws.addRow([str(label, 120), typeof value === "number" ? value : str(value), str(note, 300)]);
    if (link && links[link]) row.getCell(2).value = { formula: links[link], result: typeof value === "number" ? value : str(value) };
    if (typeof value === "number") row.getCell(2).numFmt = FMT[fmt] || FMT.cr;
    row.getCell(2).alignment = { horizontal: "right" };
  }
}

/** The workbook for a request body; throws a 400-style Error(message) with .status when empty. */
export async function buildModelWorkbook(body, { preparedBy, product }) {
  const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 60) : [];
  if (!rows.length) throw Object.assign(new Error("The financial model has no years."), { status: 400 });
  const years = rows.map((r) => r.year);

  const wb = new ExcelJS.Workbook();
  wb.creator = `TenderOS · ${product}`;
  wb.created = new Date();
  // the formulas are recalculated when the file is opened; each one also carries its value
  wb.calcProperties = { fullCalcOnLoad: true };

  // ---- cover page: what is bid, the key results and the key inputs
  const cover = wb.addWorksheet("Cover", { properties: { tabColor: { argb: ACCENT } } });
  // ---- the live model: every number a formula (second tab)
  const liveInput = liveModelInput(body.live);
  const live = liveInput ? addLiveModel(wb, { ...liveInput, title: str(body.title, 200) }) : null;
  addLogo(wb, cover);
  cover.addRow([str(body.title, 200) || "Bid financial model"]).font = { bold: true, size: 16 };
  cover.addRow([str(body.subtitle, 300)]).font = { color: { argb: "FF555555" } };
  cover.addRow([`Prepared ${new Date().toISOString().slice(0, 10)} by ${preparedBy} · ${product} (TenderOS)`]).font = { italic: true, color: { argb: "FF777777" } };
  if (live) cover.addRow(["The key results below are linked to the Live model tab: change an input there (blue cells) and they follow."]).font = { italic: true, color: { argb: "FF0000FF" } };
  cover.addRow([]);
  band(cover.addRow([]), "Key results");
  pairs(cover, body.cover?.outputs, live?.cells);
  cover.addRow([]);
  band(cover.addRow([]), "Plant");
  pairs(cover, body.cover?.plant);
  cover.addRow([]);
  band(cover.addRow([]), "Key inputs");
  pairs(cover, body.cover?.inputs);
  cover.addRow([]);
  band(cover.addRow([]), "Tender");
  pairs(cover, body.cover?.tender);
  cover.addRow([]);
  for (const note of body.cover?.notes || []) cover.addRow([str(note, 400)]).font = { italic: true, color: { argb: "FF555555" } };
  cover.getColumn(1).width = 42;
  cover.getColumn(2).width = 22;
  cover.getColumn(3).width = 70;

  // ---- tender conditions against the plant and the bid (Tender to Bid only)
  const cond = (body.conditions || []).length ? wb.addWorksheet("Tender conditions") : null;
  if (cond) {
    header(cond.addRow(["Condition", "Tender says", "Page", "Quote", "Plant and bid", "Status"]));
    for (const c of body.conditions || []) {
      const row = cond.addRow([str(c.condition, 120), str(c.tender), num(c.page), str(c.quote, 600), str(c.result), str(c.status, 20)]);
      const color = c.status === "Met" ? "FF1E7B34" : c.status === "Not met" ? "FFB3261E" : "FF666666";
      row.getCell(6).font = { bold: true, color: { argb: color } };
      row.alignment = { vertical: "top", wrapText: true };
    }
    [30, 40, 7, 60, 44, 12].forEach((w, i) => { cond.getColumn(i + 1).width = w; });
    cond.views = [{ state: "frozen", ySplit: 1 }];
  }

  // ---- every input, with where it came from (the live model's own Inputs sheet holds the ones it reads)
  const inp = wb.addWorksheet("Inputs (list)");
  header(inp.addRow(["Group", "Input", "Value", "Unit", "Source"]));
  for (const i of body.inputs || []) {
    const row = inp.addRow([str(i.group, 60), str(i.input, 120), typeof i.value === "number" ? i.value : str(i.value), str(i.unit, 40), str(i.source, 120)]);
    if (typeof i.value === "number") row.getCell(3).numFmt = i.unit === "%" ? FMT.pct : "#,##0.####";
    if (/benchmark/i.test(i.source || "")) row.getCell(5).font = { color: { argb: "FFB26A00" } };
  }
  [18, 40, 16, 16, 46].forEach((w, i) => { inp.getColumn(i + 1).width = w; });
  inp.views = [{ state: "frozen", ySplit: 1 }];

  // ---- plant and capex
  const plant = wb.addWorksheet("Plant and capex");
  header(plant.addRow(["Item", "Value", "Note"]));
  pairs(plant, body.plant);
  plant.addRow([]);
  header(plant.addRow(["Capex", "₹ crore", "Note"]));
  pairs(plant, body.capex);
  plant.getColumn(1).width = 40; plant.getColumn(2).width = 18; plant.getColumn(3).width = 50;

  // ---- year-by-year sheets: revenue and costs by stream, and the full model
  const yearSheet = (name, sections, withTotal) => {
    const ws = wb.addWorksheet(name);
    header(ws.addRow(["₹ crore unless stated", "Unit", ...(withTotal ? ["Total"] : []), ...years.map((y) => `Year ${y}`)]));
    for (const section of sections || []) {
      band(ws.addRow([]), str(section.title, 80));
      for (const [label, key, fmt, unit, total] of section.lines || []) {
        const values = rows.map((r) => num(r[key]));
        if (values.every((v) => v === null)) continue;
        const sum = values.reduce((a, v) => a + (v || 0), 0);
        const row = ws.addRow([str(label, 120), str(unit || (fmt === "cr" ? "₹ cr" : ""), 20), ...(withTotal ? [total === false ? null : sum] : []), ...values]);
        row.eachCell((cell, col) => { if (col > 2) cell.numFmt = FMT[fmt] || FMT.cr; });
        if (/^(Total|EBITDA|Profit after tax|CFADS|Free cash to equity)/.test(label)) row.font = { bold: true };
      }
    }
    ws.getColumn(1).width = 38;
    ws.getColumn(2).width = 9;
    for (let c = 3; c <= years.length + (withTotal ? 3 : 2); c += 1) ws.getColumn(c).width = 12;
    ws.views = [{ state: "frozen", xSplit: withTotal ? 3 : 2, ySplit: 1 }];
    return ws;
  };
  // the app's own numbers, as computed in TenderOS when the workbook was made (values, not formulas)
  yearSheet("Revenue and costs (values)", body.streams, true);
  const model = yearSheet("Financial model (values)", body.statements, true);

  // equity and project cash flows with year 0 (the capex), as used for the IRRs
  model.addRow([]);
  band(model.addRow([]), "Returns (year 0 is the investment)");
  header(model.addRow(["Cash flow", "Unit", "Year 0", ...years.map((y) => `Year ${y}`)]));
  for (const [label, flows] of [["Equity cash flow", body.flows?.equity], ["Project cash flow", body.flows?.project]]) {
    if (!Array.isArray(flows)) continue;
    const row = model.addRow([label, "₹ cr", ...flows.slice(0, years.length + 1).map(num)]);
    row.eachCell((cell, col) => { if (col > 2) cell.numFmt = FMT.cr; });
  }
  pairs(model, (body.cover?.outputs || []).filter(([label]) => /IRR|DSCR|NPV|payback/i.test(label)));

  // ---- the What-if track (the CfD tab): the moves to the quote, their chances, the frozen levers
  if (body.whatIf && typeof body.whatIf === "object") {
    const w = body.whatIf;
    const ws = wb.addWorksheet("What-if track", { properties: { tabColor: { argb: ACCENT } } });
    ws.addRow([str(w.title, 200) || "The track to the price you want to quote"]).font = { bold: true, size: 14 };
    ws.addRow([str(w.verdict, 600)]).font = { italic: true };
    ws.addRow([]);
    band(ws.addRow([]), "Summary");
    pairs(ws, [
      ["The model needs (₹/kWh)", num(w.base), "tariff", "the strike price for the target equity IRR on the bid as it stands"],
      ["You want to quote (₹/kWh)", num(w.target), "tariff", ""],
      ["The track ends at (₹/kWh)", num(w.final), "tariff", w.reached ? "with the moves below applied" : "every lever at the end of its chance"],
      ["Chance it all comes off", num(w.chance), "pct", "the moves' chances multiplied, as if independent"],
    ]);
    ws.addRow([]);
    band(ws.addRow([]), "The moves, surest first");
    header(ws.addRow(["#", "Lever", "From", "To", "Unit", "Chance", "Price after (₹/kWh)", "Chance so far", "Who decides", "Why it works", "Frozen with evidence"]));
    (w.steps || []).slice(0, 200).forEach((s, k) => {
      const row = ws.addRow([k + 1, str(s.label, 80), num(s.from), num(s.to), str(s.unit, 40), num(s.p), num(s.price), num(s.cum), str(s.who, 120), str(s.why, 400), str(s.frozen, 120)]);
      row.getCell(6).numFmt = "0%";
      row.getCell(8).numFmt = "0.0%";
      row.getCell(7).numFmt = "0.000";
      row.alignment = { vertical: "top", wrapText: true };
    });
    ws.addRow([]);
    band(ws.addRow([]), "Frozen levers (kept as they are in every track)");
    header(ws.addRow(["Lever", "Value", "Unit", "Price impact (₹/kWh, fall)", "Frozen on", "By", "Evidence", "Note"]));
    for (const f of (w.frozen || []).slice(0, 200)) { const r = ws.addRow([str(f.label, 80), num(f.value), str(f.unit, 40), num(f.impact), str(f.at, 30), str(f.by, 80), str(f.evidence, 200), str(f.note, 400)]); r.getCell(4).numFmt = "0.000"; }
    [5, 34, 12, 12, 22, 10, 18, 13, 30, 70, 30].forEach((wd, i) => { ws.getColumn(i + 1).width = wd; });
    ws.views = [{ state: "frozen", ySplit: 0 }];
  }

  const buffer = await wb.xlsx.writeBuffer();
  const file = `${str(body.fileName, 80).replace(/[^\w.-]+/g, "_") || "bid_financial_model"}.xlsx`;
  return { buffer, file };
}

/** The download response for a built workbook. */
export function workbookResponse({ buffer, file }) {
  return new Response(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${file}"`,
    },
  });
}
