// The CfD bid's 15-minute dispatch over the 15-year term as files (POST /api/cfd/dispatch15):
//   zip   one CSV per Contract Year (35,040 rows of 96 blocks a day), the summary by Contract Year
//         and by month, the inputs used and a README
//   xlsx  one workbook: About, Summary (every Contract Year), Monthly, then one sheet per Contract
//         Year with its blocks (values, not formulas: the dispatch is an output of the model)
// The blocks come from web/src/cfd/dispatch15.js on the same model the browser shows (runModel on
// the saved bid state and the IEX price year the tab loads), so the files equal the screen.
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { TENDER } from "../src/cfd/terms.js";
import { fmtDate, mergeCfdState, missingInputs, runModel } from "../src/cfd/model.js";
import { BLOCK_COLUMNS, BLOCKS_PER_DAY, SUMMARY_COLUMNS, blockTime, dispatch15 } from "../src/cfd/dispatch15.js";

let PRICES = null;
/** The IEX price year the CfD tab uses (web/public/market/iex_hourly_prices.json), read once. */
export function marketPrices() {
  if (!PRICES) PRICES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "market", "iex_hourly_prices.json"), "utf8"));
  return PRICES;
}

const fail = (status, message) => Object.assign(new Error(message), { status });

/** The model of a saved bid state, or a 400 when it cannot run. */
export function modelOf(stateIn) {
  const state = mergeCfdState(stateIn && typeof stateIn === "object" ? { version: 1, ...stateIn } : null);
  const missing = missingInputs(state);
  if (missing.length) throw fail(400, `The bid is not complete: ${missing.slice(0, 4).join("; ")}${missing.length > 4 ? "…" : ""}.`);
  const model = runModel(state, marketPrices());
  if (!model) throw fail(400, "The bid could not be modelled.");
  return { state, model };
}

const isoDate = (t) => new Date(t).toISOString().slice(0, 10);
const cyName = (cy) => `CY${String(cy).padStart(2, "0")}`;
const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : 0);

const BLOCK_HEAD = ["Contract Year", "Date", "Day of term", "Block", "Time", ...BLOCK_COLUMNS.map(([, h]) => h)];

function blockRow(d, b) {
  const row = [d.cy, isoDate(d.date), d.k + 1, b + 1, blockTime(b)];
  for (const [key, , dec] of BLOCK_COLUMNS) row.push(round(d.cols[key][b], dec));
  return row;
}

function summaryRows(items, first) {
  return items.map((it) => [...first(it), ...SUMMARY_COLUMNS.map(([key, , dec]) => round(it[key], dec))]);
}

const README = (model, out) => `15-minute dispatch, every Contract Year (CfD bid, SECI CfD-I)

dispatch_15min_CYnn.csv       one row per 15-minute block (96 a day), Contract Year nn from the SCD; MW are block averages
summary_by_contract_year.csv  the blocks, the supply, the charging by source, the sales, the battery's extremes
summary_by_month.csv          the same by month of each Contract Year
inputs.json                   the bid's inputs the dispatch was run on

Plant: ${model.inputs.contractedMw} MW contracted; battery ${out.ctx.P} MW / ${out.ctx.nameplate} MWh; own solar ${out.ctx.solarMw} MWac, own wind ${out.ctx.windMw} MW.
Term: ${fmtDate(model.sim.dates.scd)} (SCD) to ${fmtDate(model.sim.dates.end)}; own RE online ${fmtDate(model.sim.dates.reCod)}.
Blocks: ${out.blocks.toLocaleString("en-IN")} over ${out.years.reduce((a, y) => a + y.days, 0)} days.

How it is computed
* The CfD model decides each day in hours: the two peak hours (18:00-24:00) it supplies, what the
  battery charges from own RE, the green market and group RE before 18:00 (within the sourcing
  limits of the CfDA), what surplus it sells. The strike price comes from the same days.
* Each hour of that plan becomes four 15-minute blocks that keep the hour's energy exactly: solar
  and wind along the hour's trend, own-RE charging following the generation within the hour (held
  within the battery's power where the generation allows), bought charging even over the hour (the
  IEX prices are hourly), the discharge even over the peak hour, wind supplied directly following
  the wind.
* The battery's energy is tracked block by block: stored + charging x 1/4 h x round trip - discharge
  x 1/4 h, from empty each day (the model charges every day for that day's supply). The state of
  charge is the minimum of the window plus the stored energy over the nameplate of the year
  (degraded, or kept by augmentation).
* Supply due is the contracted MW in each of the 8 peak blocks (2 MWh per MW a day); a block counts
  as within tolerance when it delivers at least 90% of it (the CfDA's weekly tolerance).
* The sums over a Contract Year equal the model's totals (tools/check_cfd_dispatch15.mjs).
* Prices are hourly, so the four blocks of an hour carry the same price.
`;

function csv(rows) {
  return rows.map((r) => r.map((v) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v))).join(",")).join("\n") + "\n";
}

/** The ZIP of CSV files for a saved bid state. */
export async function buildCfdDispatchZip(stateIn) {
  const { state, model } = modelOf(stateIn);
  const zip = new JSZip();
  const perYear = new Map();
  const out = dispatch15(model, {
    onDay: (d) => {
      let rows = perYear.get(d.cy);
      if (!rows) { rows = [BLOCK_HEAD]; perYear.set(d.cy, rows); }
      for (let b = 0; b < BLOCKS_PER_DAY; b += 1) rows.push(blockRow(d, b));
    },
  });
  for (const [cy, rows] of perYear) zip.file(`dispatch_15min_${cyName(cy)}.csv`, csv(rows));
  zip.file("summary_by_contract_year.csv", csv([["Contract Year", "From", "To", ...SUMMARY_COLUMNS.map(([, h]) => h)], ...summaryRows(out.years, (y) => [y.cy, isoDate(y.start), isoDate(y.end - 1)])]));
  zip.file("summary_by_month.csv", csv([["Contract Year", "Month", ...SUMMARY_COLUMNS.map(([, h]) => h)], ...summaryRows(out.months, (m) => [m.cy, m.label])]));
  zip.file("inputs.json", JSON.stringify({ inputs: model.inputs, losses: state.losses || null, dates: { scd: isoDate(model.sim.dates.scd), end: isoDate(model.sim.dates.end), reCod: isoDate(model.sim.dates.reCod) } }, null, 2));
  zip.file("README.txt", README(model, out));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { buffer, file: "cfd-dispatch-15min-15-years.zip", blocks: out.blocks, years: out.years.length };
}

const ACCENT = "FFD4FF3F";
const headRow = (ws, values) => {
  const row = ws.addRow(values);
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
  row.commit?.();
  return row;
};

/** The workbook for a saved bid state: About, Summary, Monthly, one sheet per Contract Year. */
export async function buildCfdDispatchXlsx(stateIn) {
  const { model } = modelOf(stateIn);
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { stream.on("end", resolve); stream.on("error", reject); });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
  wb.creator = "TenderOS · CfD bid";
  wb.created = new Date();

  // the sheets are committed in order; the summaries need the totals, so the year sheets are
  // written first into memory-light committed rows and the summary sheets filled after the run
  const about = wb.addWorksheet("About");
  const summary = wb.addWorksheet("Summary");
  const monthly = wb.addWorksheet("Monthly");
  const yearSheets = new Map();
  const out = dispatch15(model, {
    onDay: (d) => {
      let ws = yearSheets.get(d.cy);
      if (!ws) {
        ws = wb.addWorksheet(cyName(d.cy));
        ws.columns = BLOCK_HEAD.map((h, i) => ({ header: h, key: `c${i}`, width: i < 5 ? 12 : 16 }));
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
        ws.getRow(1).commit();
        yearSheets.set(d.cy, ws);
      }
      for (let b = 0; b < BLOCKS_PER_DAY; b += 1) ws.addRow(blockRow(d, b)).commit();
    },
  });
  for (const ws of yearSheets.values()) ws.commit();

  about.columns = [{ width: 140 }];
  headRow(about, ["CfD bid: 15-minute dispatch over the term"]);
  for (const line of README(model, out).split("\n").slice(1)) about.addRow([line]).commit();
  about.commit();

  summary.columns = [{ width: 14 }, { width: 12 }, { width: 12 }, ...SUMMARY_COLUMNS.map(() => ({ width: 18 }))];
  headRow(summary, ["Contract Year", "From", "To", ...SUMMARY_COLUMNS.map(([, h]) => h)]);
  for (const r of summaryRows(out.years, (y) => [y.cy, isoDate(y.start), isoDate(y.end - 1)])) summary.addRow(r).commit();
  summary.commit();

  monthly.columns = [{ width: 14 }, { width: 12 }, ...SUMMARY_COLUMNS.map(() => ({ width: 18 }))];
  headRow(monthly, ["Contract Year", "Month", ...SUMMARY_COLUMNS.map(([, h]) => h)]);
  for (const r of summaryRows(out.months, (m) => [m.cy, m.label])) monthly.addRow(r).commit();
  monthly.commit();

  await wb.commit();
  await done;
  return { buffer: Buffer.concat(chunks), file: `cfd-dispatch-15min-${TENDER.termYears}-years.xlsx`, blocks: out.blocks, years: out.years.length };
}

export const zipResponse = ({ buffer, file }) => new Response(buffer, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${file}"` } });
