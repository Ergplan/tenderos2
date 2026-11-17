// Checks for the FDRE-X bid's financial model with the 15-minute dispatch behind its energy
// (web/lib/fdrexBlockSheets.js, the second version of the workbook of POST /api/fdrex/model;
// forked from tools/check_cfd_blocks.mjs):
//   1. the sheets' data: every day of the 25-year term, 16 peak blocks a day, and each operating year's
//      supply due, supplied, sold and charged energy equal to the day-by-day model's year;
//   2. the request's years take the sheets' sums, and a different bid is refused;
//   3. the first version carries the years' energy as values; the second as formulas on the sheet
//      "15-min by year", with the seven 15-minute sheets at the end;
//   4. LibreOffice recalculates every formula of the second version (the Live model, the schedules
//      and the 15-minute sheets) to the value the cell carries, with no error, and the Cover shows
//      the app's tariff and equity IRR;
//   5. doubling the contracted capacity on the Inputs sheet doubles the supply due on the sheets
//      and in the Live model, and leaves the supplied energy (the dispatch's values) as it was;
//   6. market years after the term keep their values (no dispatch behind them).
// Steps 4 and 5 need LibreOffice (soffice); without it they are reported as not run.
// Run from the repository root:   node tools/check_fdrex_blocks.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import v8 from "node:v8";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TENDER } from "../web/src/fdrex/tender.js";
import { defaultCfdState, fillBenchmarks, runModel } from "../web/src/fdrex/model.js";
import { cfdModelExport, runCfdFinance } from "../web/src/fdrex/finance.js";
import { FORMULA_SHEETS, INPUTS_SHEET, LIVE_SHEET } from "../web/lib/liveModel.js";
import { buildModelWorkbook } from "../web/lib/modelWorkbook.js";
import * as blockLib from "../web/lib/fdrexBlockSheets.js";

const { BLOCK_SHEETS, cfdBlockData, opsFromBlocks } = blockLib;

// 25 years of 15-minute blocks, loaded several times over: run with a larger heap than Node's default
if (v8.getHeapStatistics().heap_size_limit < 5e9 && !process.env.FDREX_BLOCKS_CHILD) {
  const r = spawnSync(process.execPath, ["--max-old-space-size=7168", fileURLToPath(import.meta.url)], { stdio: "inherit", env: { ...process.env, FDREX_BLOCKS_CHILD: "1" } });
  process.exit(r.status ?? 1);
}

// the workbook code reads the logo and the price year from the web app's folder
process.chdir(fileURLToPath(new URL("../web/", import.meta.url)));
const require = createRequire(new URL("../web/package.json", import.meta.url));
const ExcelJS = require("exceljs");
const prices = JSON.parse(readFileSync("public/market/iex_hourly_prices.json", "utf8"));
const close = (a, b, tol = 1e-7) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);

// ---- the benchmark 100 MW bid, with solar-hour connectivity so that surplus is sold in the day
const state = fillBenchmarks(defaultCfdState());
state.inputs.dayInjection = true;
const model = runModel(state, prices);
const finance = runCfdFinance(state, model);
const body = JSON.parse(JSON.stringify(cfdModelExport({ state, model, finance })));
const X = model.inputs.contractedMw;

// 1. the sheets' data against the model's operating years
const data = cfdBlockData(JSON.parse(JSON.stringify(state)));
{
  const termDays = Math.round((model.sim.dates.end - model.sim.dates.scd) / 86400000);
  assert.equal(data.days.length, termDays, "a row for every day of the term");
  assert.equal(data.years.length, model.opYears.length);
  assert.ok(data.days.every((d, k) => d.k === k && d.peak.length === TENDER.peakHours * 4 && d.peak.every((b) => b >= TENDER.peakStart * 4)), "sixteen peak blocks a day, from 18:00");
  assert.ok(data.days.every((d) => d.oy === Math.min(model.opYears.length - 1, Math.floor(d.k / 365)) + 1), "the day's operating year");
  data.years.forEach((y, i) => {
    const o = model.opYears[i];
    assert.equal(y.days, o.days, `year ${y.year} days`);
    assert.ok(close(y.due, X * TENDER.mwhPerMwDay * o.days, 1e-12), `year ${y.year} supply due`);
    // the blocks are held to 0.01 kWh: a year's sum is the model's to that rounding
    for (const [mine, theirs] of [["supplied", "deliveredMwh"], ["sold", "merchantMwh"], ["own", "chargeOwnMwh"], ["market", "chargeMarketMwh"]]) {
      assert.ok(Math.abs(y[mine] - o[theirs]) <= 0.2, `year ${y.year} ${mine}: ${y[mine]} on the sheets, ${o[theirs]} in the model`);
    }
  });
  console.log(`ok   data    ${data.days.length} days in ${data.years.length} operating years: ${(sum(data.years, "supplied") / 1000).toFixed(1)} MU supplied of ${(sum(data.years, "due") / 1000).toFixed(1)} MU due, as the day-by-day model`);
}

// 2. the request's years take the sheets' sums; another bid is refused
{
  const ops = opsFromBlocks(body.live.ops, data);
  ops.forEach((o, i) => assert.deepEqual([o.demandMWh, o.deliveredMWh, o.excessMWh], [data.years[i].due, data.years[i].supplied, data.years[i].sold]));
  assert.ok(ops.every((o, i) => o.chargingCostCr === body.live.ops[i].chargingCostCr), "the rest of a year is kept");
  const other = JSON.parse(JSON.stringify(state));
  other.inputs.contractedMw = X * 1.2;
  assert.throws(() => opsFromBlocks(body.live.ops, cfdBlockData(other)), (e) => e.status === 409, "another bid's dispatch is refused");
  assert.throws(() => opsFromBlocks(body.live.ops.slice(0, 10), data), (e) => e.status === 409, "too few years are refused");
  assert.throws(() => cfdBlockData({ version: 1, inputs: {} }), (e) => e.status === 400, "an incomplete bid is a 400");
  console.log("ok   request the model's years take the sheets' sums; another bid's dispatch is refused (409)");
}

// 3. the two versions
const rowOf = (ws, label) => { let at = 0; ws.eachRow((row, n) => { if (!at && row.getCell(1).value === label) at = n; }); assert.ok(at, `row "${label}"`); return at; };
const ENERGY = [["Contracted energy (the dispatch)", "due"], ["Delivered to the procurer (the dispatch)", "supplied"], ["Sold in the market (the dispatch)", "sold"]];
const load = async (buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer); return wb; };
const first = await buildModelWorkbook(body, { preparedBy: "check", product: "FDRE-X bid" });
const second = await buildModelWorkbook(body, { preparedBy: "check", product: "FDRE-X bid", blockData: data, blockLib });
const wb2 = await load(second.buffer);
{
  const wb1 = await load(first.buffer);
  assert.ok(!wb1.worksheets.some((w) => w.name.startsWith("15-min")), "the first version has no 15-minute sheets");
  assert.ok(first.file.endsWith("financial_model.xlsx") && second.file.endsWith("financial_model_15min.xlsx"), "the second version's file name says so");
  assert.deepEqual(wb2.worksheets.slice(-7).map((w) => w.name), Object.values(BLOCK_SHEETS), "the seven 15-minute sheets at the end");
  assert.ok(!wb2.worksheets.some((w) => /group/i.test(w.name)), "no group-RE sheet in this tender");
  const l1 = wb1.getWorksheet(LIVE_SHEET);
  const l2 = wb2.getWorksheet(LIVE_SHEET);
  for (const [label, key] of ENERGY) {
    const r = rowOf(l2, label);
    assert.equal(rowOf(l1, label), r, "the same rows in both versions");
    for (let y = 1; y <= data.years.length; y += 1) {
      const a = l1.getRow(r).getCell(4 + y);
      const b = l2.getRow(r).getCell(4 + y);
      assert.ok(typeof a.value === "number", `${label}, year ${y}: a value in the first version`);
      assert.ok(b.formula && b.formula.includes(`'${BLOCK_SHEETS.years}'!`), `${label}, year ${y}: a formula on the 15-minute sheets in the second (${JSON.stringify(b.value)})`);
      assert.ok(close(b.result, data.years[y - 1][key] / 1000, 1e-12) && Math.abs(b.result - a.value) < 1e-6, `${label}, year ${y}: ${b.result} MU against ${a.value}`);
    }
  }
  const cells = Object.values(BLOCK_SHEETS).slice(2).map((n) => { let c = 0; wb2.getWorksheet(n).eachRow((row, i) => { if (i >= 5) row.eachCell((cell, col) => { if (col >= 3) c += 1; }); }); return c; });
  assert.equal(cells[0], data.days.length * TENDER.peakHours * 4, "a formula in every peak block of the supply due");
  console.log(`ok   books   first version ${(first.buffer.byteLength / 1e6).toFixed(2)} MB with the years' energy as values; second ${(second.buffer.byteLength / 1e6).toFixed(2)} MB with ${cells.reduce((a, b) => a + b, 0).toLocaleString("en-IN")} block cells behind it`);
}

// 6. market years after the term: values, no dispatch behind them
{
  const s = JSON.parse(JSON.stringify(state));
  Object.assign(s.inputs, { afterTerm: "merchant", merchantYears: 3 });
  const m = runModel(s, prices);
  const f = runCfdFinance(s, m);
  const b = JSON.parse(JSON.stringify(cfdModelExport({ state: s, model: m, finance: f })));
  assert.equal(b.live.ops.length, m.opYears.length + 3);
  const out = await buildModelWorkbook(b, { preparedBy: "check", product: "FDRE-X bid", blockData: cfdBlockData(s), blockLib });
  const ws = (await load(out.buffer)).getWorksheet(LIVE_SHEET);
  const r = rowOf(ws, "Delivered to the procurer (the dispatch)");
  assert.ok(ws.getRow(r).getCell(4 + m.opYears.length).formula && !ws.getRow(r).getCell(5 + m.opYears.length).formula, "the last year of the term reads the sheets; the first market year is a value");
  console.log("ok   tail    three market years after the term keep their values");
}

let soffice = null;
for (const bin of ["soffice", "libreoffice"]) {
  try { execFileSync("which", [bin], { stdio: "pipe" }); soffice = bin; break; } catch { /* next */ }
}
if (!soffice) {
  console.log("NOT RUN  LibreOffice recalculation: soffice not found (install LibreOffice to run steps 4 and 5)");
  process.exit(0);
}
async function recalc(buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), "fdrex-blocks-"));
  try {
    const src = path.join(dir, "book.xlsx");
    writeFileSync(src, Buffer.from(buffer));
    // a LibreOffice profile that recalculates every formula when an xlsx is opened
    mkdirSync(path.join(dir, "profile", "user"), { recursive: true });
    writeFileSync(path.join(dir, "profile", "user", "registrymodifications.xcu"), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
`);
    execFileSync(soffice, [`-env:UserInstallation=file://${path.join(dir, "profile")}`, "--headless", "--calc", "--convert-to", "xlsx", "--outdir", path.join(dir, "out"), src], { stdio: "pipe", timeout: 900_000, env: { ...process.env, HOME: dir } });
    return await load(readFileSync(path.join(dir, "out", "book.xlsx")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const asSerial = (v) => (v instanceof Date ? Math.round((v.getTime() - Date.UTC(1899, 11, 30)) / 86400e3) : v);
const resultOf = (cell) => asSerial(cell.formula ? cell.result : cell.value);

// 4. LibreOffice works every formula out, from no value, to the value the cell carries
{
  // every formula stripped of its value first, so nothing is read back from the file
  const bare = await load(second.buffer);
  const sheets = [...FORMULA_SHEETS.filter((n) => bare.getWorksheet(n)), BLOCK_SHEETS.years, BLOCK_SHEETS.days, BLOCK_SHEETS.due];
  for (const n of sheets) bare.getWorksheet(n).eachRow((row) => row.eachCell((cell) => { if (cell.formula) cell.value = { formula: cell.formula }; }));
  const out = await recalc(await bare.xlsx.writeBuffer());
  let formulas = 0;
  for (const n of sheets) {
    const theirs = out.getWorksheet(n);
    wb2.getWorksheet(n).eachRow((row) => row.eachCell((cell) => {
      if (!cell.formula) return;
      formulas += 1;
      const got = resultOf(theirs.getCell(cell.address));
      assert.ok(!(got && typeof got === "object" && "error" in got), `${n} ${cell.address} ${cell.formula} → ${JSON.stringify(got)}`);
      const want = asSerial(cell.result);
      if (typeof want === "number") assert.ok(typeof got === "number" && close(got, want, /IRR/.test(cell.formula) ? 1e-6 : 1e-7), `${n} ${cell.address} ${cell.formula}: LibreOffice ${got}, carried ${want}`);
    }));
  }
  const wy = out.getWorksheet(BLOCK_SHEETS.years);
  data.years.forEach((y, i) => {
    const row = wy.getRow(8 + i);
    assert.deepEqual([resultOf(row.getCell(1)), resultOf(row.getCell(4))], [y.year, y.days]);
    for (const [col, key] of [[5, "due"], [6, "supplied"], [9, "sold"], [10, "own"], [11, "market"]]) assert.ok(close(resultOf(row.getCell(col)), y[key], 1e-9), `15-min by year, year ${y.year} ${key}: ${resultOf(row.getCell(col))} vs ${y[key]}`);
  });
  const cover = out.getWorksheet("Cover");
  const coverValue = (label) => resultOf(cover.getRow(rowOf(cover, label)).getCell(2));
  assert.ok(close(coverValue("Equity IRR"), finance.equityIrr, 1e-5), `the Cover's equity IRR ${coverValue("Equity IRR")} is the app's ${finance.equityIrr}`);
  assert.ok(close(coverValue("Project cost (₹ cr)"), finance.capex.total, 1e-6), "and the project cost");
  console.log(`ok   recalc  ${formulas.toLocaleString("en-IN")} formulas: LibreOffice works each one out, from no value, to the value the cell carries; equity IRR ${(coverValue("Equity IRR") * 100).toFixed(3)}% as the app`);
}

// 5. the contracted capacity doubled on the Inputs sheet
{
  const wb = await load(second.buffer);
  const inputs = wb.getWorksheet(INPUTS_SHEET);
  const r = rowOf(inputs, "Contracted capacity");
  assert.equal(inputs.getRow(r).getCell(3).value, X, "the contracted capacity on the Inputs sheet");
  inputs.getRow(r).getCell(3).value = 2 * X;
  const out = await recalc(await wb.xlsx.writeBuffer());
  const live = out.getWorksheet(LIVE_SHEET);
  const wy = out.getWorksheet(BLOCK_SHEETS.years);
  const due = out.getWorksheet(BLOCK_SHEETS.due);
  const d0 = data.days[0];
  assert.ok(close(resultOf(due.getRow(5).getCell(3 + d0.peak[0])), 2 * X * 0.25, 1e-12), "the first peak block's supply due doubles");
  data.years.forEach((y, i) => {
    assert.ok(close(resultOf(wy.getRow(8 + i).getCell(5)), 2 * y.due, 1e-9), `year ${y.year}: the supply due doubles on the sheet`);
    assert.ok(close(resultOf(wy.getRow(8 + i).getCell(6)), y.supplied, 1e-9), `year ${y.year}: the supplied energy stays`);
    assert.ok(close(resultOf(live.getRow(rowOf(live, ENERGY[0][0])).getCell(5 + i)), (2 * y.due) / 1000, 1e-9), `year ${y.year}: and in the Live model`);
    assert.ok(close(resultOf(live.getRow(rowOf(live, ENERGY[1][0])).getCell(5 + i)), y.supplied / 1000, 1e-9));
  });
  console.log(`ok   input   contracted capacity ${X} → ${2 * X} MW on the Inputs sheet: the supply due doubles in every peak block, by day, by year and in the Live model`);
}
console.log("OK  FDRE-X 15-minute workbook: the sheets equal the model, the Live model reads them, LibreOffice recalculates every formula");
