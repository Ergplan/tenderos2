// Checks for the Excel bid-input template ("Download input template" and "Upload bid inputs"
// beside "Fill up for me please" in the CfD Bid, CfD Own Solar and FDRE-X Bid tabs):
// web/src/cfd/inputSheet.js (the rows), inputWorkbook.js (write and read), xlsxCells.js (the reader).
//   1. every row of each tab's template has a yellow input cell with a note, a check (a dropdown or
//      a range) and its key; the groups come in order, each once;
//   2. a template read back as written loads with no change and leaves the state exactly as it was;
//   3. every row takes a value: each one changed in the file is the value in the state after the
//      upload (percent typed as 24 or in a percentage cell, choices by label, dates as text);
//   4. any wrong cell (text in a number, out of range, not whole, a choice not in the list, a bad
//      date, a frozen input changed, an unnamed cost line) loads nothing and names the cell and why;
//   5. another tab's template, a file that is not a template and one that is not .xlsx are refused;
//   6. the battery augmentation by year and the other fixed cost lines are read from their sheets.
// Run from the repository root:  node tools/check_bid_input_sheet.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
import { sheetRows } from "../web/src/cfd/inputSheet.js";
import { buildInputWorkbook, readInputWorkbook, shownValue } from "../web/src/cfd/inputWorkbook.js";
import * as CM from "../web/src/cfd/model.js";
import * as CA from "../web/src/cfd/agent.js";
import { OWN_SOLAR_DEFAULTS } from "../web/src/cfd/ownSolar.js";
import * as FM from "../web/src/fdrex/model.js";
import * as FA from "../web/src/fdrex/agent.js";

const TABS = [
  { name: "CfD Bid", state: CM.fillWinning(CM.defaultCfdState()), catalogue: { agentInputs: CA.agentInputs, fields: CM.FIELDS, choices: CM.CHOICES, bilateral: false }, meta: { module: "cfd", title: "CfD bid · SECI", tender: "SECI CfD-I" } },
  { name: "CfD Own Solar", state: (() => { const s = CM.fillWinning(CM.defaultCfdState()); s.inputs = { ...s.inputs, ...OWN_SOLAR_DEFAULTS }; return s; })(), catalogue: { agentInputs: CA.agentInputs, fields: CM.FIELDS, choices: CM.CHOICES, bilateral: true }, meta: { module: "cfdOwnSolar", title: "CfD bid · own solar · SECI", tender: "SECI CfD-I" } },
  { name: "FDRE-X Bid", state: FM.fillWinning(FM.defaultCfdState()), catalogue: { agentInputs: FA.agentInputs, fields: FM.FIELDS, choices: FM.CHOICES, bilateral: false }, meta: { module: "fdrex", title: "FDRE-X bid · SECI", tender: "SECI-FDRE-X" } },
];
const plain = (s) => JSON.parse(JSON.stringify(s));
const bufferOf = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());
// an uploaded file edited in Excel: the template with cells changed (key → value; a { v, numFmt } sets a format too)
async function edited(tab, rows, edits, more = null) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await bufferOf(buildInputWorkbook(ExcelJS, { state: tab.state, rows, meta: tab.meta })));
  const ws = wb.getWorksheet("Bid inputs");
  const at = {};
  ws.eachRow((row, r) => { const k = row.getCell(8).value; if (typeof k === "string" && r > 4) at[k] = r; });
  for (const [key, v] of Object.entries(edits)) {
    assert.ok(at[key], `${tab.name}: ${key} is on the template`);
    const c = ws.getCell(at[key], 3);
    if (v && typeof v === "object" && "numFmt" in v) { c.value = v.v; c.numFmt = v.numFmt; } else c.value = v;
  }
  if (more) more(wb);
  return { data: await bufferOf(wb), at };
}

for (const tab of TABS) {
  const rows = sheetRows(tab.state, tab.catalogue);
  // ---- 1. the template
  const wb = buildInputWorkbook(ExcelJS, { state: tab.state, rows, meta: tab.meta });
  const data = await bufferOf(wb);
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(data);
  const ws = back.getWorksheet("Bid inputs");
  let n = 0;
  const groups = [];
  ws.eachRow((row, r) => {
    if (r <= 4) return;
    const key = row.getCell(8).value;
    if (row.getCell(1).isMerged) { groups.push(row.getCell(1).value); return; }
    const c = row.getCell(3);
    assert.ok(typeof key === "string" && rows.some((x) => x.key === key), `${tab.name} row ${r}: a key`);
    assert.equal(c.fill?.fgColor?.argb, "FFFFF2CC", `${tab.name} ${key}: a yellow input cell`);
    assert.ok(c.note && JSON.stringify(c.note).length > 60, `${tab.name} ${key}: a note`);
    assert.ok(c.dataValidation && ["list", "decimal", "whole", "date"].includes(c.dataValidation.type), `${tab.name} ${key}: a check`);
    n += 1;
  });
  assert.equal(n, rows.length, `${tab.name}: every row on the sheet`);
  assert.equal(new Set(groups).size, groups.length, `${tab.name}: each group once`);
  for (const key of ["contractedMw", "effectiveDate", "essCrPerMwh", "targetEquityIrr", "fin.repayment", "fin.refiTopUpPct", "fin.taxDepreciation", "sizeAuto", "bess.augmentation"]) assert.ok(rows.some((x) => x.key === key), `${tab.name}: ${key} on the template`);
  assert.equal(rows.some((x) => x.key === "bilateralMonths"), tab.catalogue.bilateral, `${tab.name}: the existing-plant inputs only where the tab has them`);

  // ---- 2. read back as written
  const same = await readInputWorkbook(JSZip, data, { state: tab.state, rows, meta: tab.meta });
  assert.ok(same.ok, `${tab.name}: the template as written loads (${JSON.stringify(same.errors.slice(0, 3))})`);
  assert.equal(same.changes.length, 0, `${tab.name}: no change (${JSON.stringify(same.changes.slice(0, 3))})`);
  assert.deepEqual(plain(same.state), plain(tab.state), `${tab.name}: the state is as it was`);

  // ---- 3. every row takes a value
  const pick = (x) => {
    const cur = x.get(tab.state);
    if (x.kind === "boolean") return { cell: cur ? "No" : "Yes", want: !cur };
    if (x.kind === "choice") { const o = x.options.find(([k]) => String(k) !== String(cur ?? "")) || x.options[0]; return { cell: o[1], want: o[0] }; }
    if (x.kind === "date") return { cell: "15-Mar-2027", want: "2027-03-15" };
    const lo = Number.isFinite(x.min) ? x.min : 0;
    const hi = Number.isFinite(x.max) ? Math.min(x.max, lo + 1000) : lo + 10;
    let v = x.int ? Math.round((lo + hi) / 2) : Math.round(((lo + hi) / 2) * 100) / 100;
    if (x.key === "contractedMw") v = (tab.state.inputs.contractedMw || 100) + 5;
    return { cell: v, want: x.pct ? v / 100 : v };
  };
  const plan = Object.fromEntries(rows.map((x) => [x.key, pick(x)]));
  const { data: d3 } = await edited(tab, rows, Object.fromEntries(Object.entries(plan).map(([k, p]) => [k, p.cell])));
  const all = await readInputWorkbook(JSZip, d3, { state: tab.state, rows, meta: tab.meta });
  assert.ok(all.ok, `${tab.name}: every row changed loads (${JSON.stringify(all.errors.slice(0, 4))})`);
  for (const x of rows) {
    const got = x.get(all.state);
    const want = plan[x.key].want;
    const ok = typeof want === "number" ? Math.abs(Number(got) - want) < 1e-9 : String(got) === String(want);
    assert.ok(ok, `${tab.name} ${x.key}: ${JSON.stringify(got)} after the upload, ${JSON.stringify(want)} in the file`);
  }
  // percent typed in a percentage cell and as text
  const pctRow = rows.find((x) => x.key === "interestRate");
  const { data: d3b } = await edited(tab, rows, { interestRate: { v: 0.0925, numFmt: "0.00%" }, debtFraction: "72%", marketCharges: "₹ 0.35" });
  const p = await readInputWorkbook(JSZip, d3b, { state: tab.state, rows, meta: tab.meta });
  assert.ok(p.ok && Math.abs(p.state.inputs.interestRate - 0.0925) < 1e-12 && Math.abs(p.state.inputs.debtFraction - 0.72) < 1e-12 && p.state.inputs.marketCharges === 0.35, `${tab.name}: 9.25% in a percentage cell and "72%" as text (${shownValue(pctRow, p.state.inputs.interestRate)})`);

  // ---- 4. wrong cells load nothing and say why
  const lockedState = { ...tab.state, locks: { ...(tab.state.locks || {}), "inputs.essCrPerMwh": true } };
  const { data: d4 } = await edited(tab, rows, { contractedMw: 100.5, interestRate: "nine", debtFraction: 120, shortfallPolicy: "Meet evry day", effectiveDate: "31-02-2027", useMarket: "maybe", essCrPerMwh: 0.5 }, (w) => { w.getWorksheet("Other fixed costs").getCell("B6").value = 3; });
  const bad = await readInputWorkbook(JSZip, d4, { state: lockedState, rows, meta: tab.meta });
  assert.equal(bad.ok, false, `${tab.name}: a file with wrong cells is refused`);
  assert.deepEqual(plain(bad.state), plain(lockedState), `${tab.name}: and nothing is loaded`);
  const why = Object.fromEntries(bad.errors.map((e) => [e.label, e.message]));
  const label = (k) => rows.find((x) => x.key === k).label;
  assert.match(why[label("contractedMw")], /not a whole number/);
  assert.match(why[label("interestRate")], /not a number/);
  assert.match(why[label("debtFraction")], /above the highest allowed/);
  assert.match(why[label("shortfallPolicy")], /not in the list/);
  assert.match(why[label("effectiveDate")], /not a valid date/);
  assert.match(why[label("useMarket")], /Yes or No/);
  assert.match(why[label("essCrPerMwh")], /Frozen in the app/);
  assert.ok(bad.errors.some((e) => e.sheet === "Other fixed costs" && /Name the line/.test(e.message)), `${tab.name}: an unnamed cost line`);
  assert.ok(bad.errors.every((e) => /^[A-Z]+\d+$/.test(e.cell)), `${tab.name}: every error names its cell`);

  // ---- 5. not this tab's template
  const other = TABS.find((t) => t.meta.module !== tab.meta.module);
  const otherData = await bufferOf(buildInputWorkbook(ExcelJS, { state: other.state, rows: sheetRows(other.state, other.catalogue), meta: other.meta }));
  const wrongTab = await readInputWorkbook(JSZip, otherData, { state: tab.state, rows, meta: tab.meta });
  assert.match(wrongTab.errors[0].message, /template of another tab/);
  const blank = new ExcelJS.Workbook(); blank.addWorksheet("Sheet1").getCell("A1").value = 5;
  assert.match((await readInputWorkbook(JSZip, await bufferOf(blank), { state: tab.state, rows, meta: tab.meta })).errors[0].message, /not a TenderOS bid-input template/);
  assert.match((await readInputWorkbook(JSZip, Buffer.from("not a zip"), { state: tab.state, rows, meta: tab.meta })).errors[0].message, /not an Excel workbook/);

  // ---- 6. the tables
  const { data: d6 } = await edited(tab, rows, { "bess.augmentation": "Year by year: the Battery augmentation sheet" }, (w) => {
    const a = w.getWorksheet("Battery augmentation");
    a.getCell("B7").value = 6; // year 4
    a.getCell("B11").value = 20.3; a.getCell("C11").value = 41; // year 8
    const l = w.getWorksheet("Other fixed costs");
    for (let r = 5; r < 20; r += 1) for (const c of ["A", "B", "C"]) l.getCell(`${c}${r}`).value = null;
    l.getCell("A5").value = "Land lease, own solar"; l.getCell("B5").value = 0.62; l.getCell("C5").value = 10;
  });
  const t6 = await readInputWorkbook(JSZip, d6, { state: tab.state, rows, meta: tab.meta });
  assert.ok(t6.ok, `${tab.name}: the tables load (${JSON.stringify(t6.errors.slice(0, 3))})`);
  assert.equal(t6.state.bess.augmentation, "byYear");
  assert.ok(Math.abs(t6.state.bess.augmentationPct[4] - 0.06) < 1e-12 && Math.abs(t6.state.bess.augmentationPct[8] - 0.203) < 1e-12 && t6.state.bess.augmentationCr[8] === 41 && t6.state.bess.augmentationPct[5] === 0, `${tab.name}: augmentation in years 4 and 8`);
  assert.deepEqual(t6.state.fin.otherFixedLines, [{ label: "Land lease, own solar", crPerYear: 0.62, escalation: 0.1 }], `${tab.name}: the cost lines replace the app's`);
  console.log(`ok   ${tab.name}: ${rows.length} inputs in ${groups.length} groups; read back unchanged; every input takes a value; ${bad.errors.length} wrong cells named; tables read`);
}
console.log("OK  bid-input template: written with notes and checks, read back exactly, every typo refused with its cell");
