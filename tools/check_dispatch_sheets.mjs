// Checks for the hour-by-hour dispatch sheets of the Live model (web/lib/dispatchSheets.js): with a
// dispatch of the modelled years 1 and 25 (a stand-in for the HiGHS sizing's, built here by the
// rule the LP's optimum follows: direct = MIN(contract − discharge, generation − charge)), the
// workbook's energy by PPA year is formulas on those sheets, they carry the app's values, and
// LibreOffice recalculates every formula, the 17,520 hours included, to the same numbers.
// Run from the repository root:   node tools/check_dispatch_sheets.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import * as E from "../web/src/rtc/engine.js";
import { defaultBidState, defaultLosses, modelInputs, opsFromLp, resourceProfiles, lossFactorsOf } from "../web/src/bid/model.js";
import { liveModelRequest } from "../web/src/bid/liveModelRequest.js";
import { LIVE_SHEET, addLiveModel, liveModelInput } from "../web/lib/liveModel.js";
import { buildModelWorkbook } from "../web/lib/modelWorkbook.js";
import { FIRST_ROW, TOTAL_ROW, dispatchLetters, dispatchSheetName } from "../web/lib/dispatchSheets.js";
import { seciTerms } from "../web/src/seci/terms.js";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const ExcelJS = require("exceljs");
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---- a SECI-like bid: solar, wind and a battery, time-block floors, the loss chain to the meter
const s = defaultBidState();
s.bid = { baseMw: 200, greenshoe: false };
s.sources = { solar: true, wind: true, hydro: false, biomass: false, thermal: false, bess: true };
s.src.solar = { capacity: { mode: "optimise", mw: 2000 }, cuf: 0.25, dcAc: 1.4, degradation: 0.005, capex: 3.6, om: 4 };
s.src.wind = { capacity: { mode: "optimise", mw: 1000 }, cuf: 0.33, capex: 6.5, om: 9 };
s.src.bess = { capacity: { mode: "optimise", mw: 600 }, duration: "4", rte: 0.87, minSoc: 0.05, maxSoc: 0.95, degradation: 0.02, augmentation: "annual", capex: 1.0, om: 1.2 };
s.costs = { preopPct: 0.05, evacuationCr: 120 };
s.losses = defaultLosses();
const terms = seciTerms({ peakPlan: "evening", shortfall: "penalty" });
const m = modelInputs(s, terms);
const sizes = { solarMw: 430, windMw: 310, bessMw: 300, bessMwh: 1200 };
const prof = resourceProfiles(s);
const lf = lossFactorsOf(s);
const poi = (1 - lf.trafo) * (1 - lf.line);
const eta = Math.sqrt(lf.rteBus);
const solarCf = Array.from(prof.solarCf, (v) => Math.round(v * lf.solar * 1e6) / 1e6);
const windCf = Array.from(prof.windCf, (v) => Math.round(v * lf.wind * 1e6) / 1e6);
const peakSet = new Set([18, 19, 20, 21, 22, 23]);
const peak = Array.from({ length: E.HOURS }, (_, t) => (peakSet.has(E.HOUR_OF_DAY[t]) ? 1 : 0));
const contract = 200;
const rep = [1, 25];

// the stand-in dispatch of each modelled year
function dispatchYear(year) {
  const f = E.yearFactors(year, m.fin, m.bess);
  const cap = (0.95 - 0.05) * sizes.bessMwh * f.bessFactor;
  let level = (0.5 - 0.05) * sizes.bessMwh * f.bessFactor;
  const target = contract / poi;
  const charge = [];
  const discharge = [];
  let delivered = 0;
  let short = 0;
  for (let t = 0; t < E.HOURS; t += 1) {
    const g = sizes.solarMw * solarCf[t] * f.solarFactor + sizes.windMw * windCf[t] * f.windFactor;
    const direct = Math.min(target, g);
    const ch = Math.max(0, Math.min(g - direct, sizes.bessMw, (cap - level) / eta));
    level += ch * eta;
    const dis = Math.max(0, Math.min(target - direct, sizes.bessMw, level * eta));
    level -= dis / eta;
    charge.push(ch);
    discharge.push(dis);
    const del = (direct + dis) * poi;
    delivered += del;
    short += Math.max(0, contract * (peak[t] ? 0.9 : 0.7) - del);
  }
  return { year, bf: f.bessFactor, charge, discharge, delivered, short };
}
const years = rep.map(dispatchYear);
const n = m.fin.years || 25;
const weights = Array.from({ length: n }, (_, i) => {
  const y = i + 1;
  const th = (y - 1) / 24;
  return [1 - th, th];
});
const lifetime = weights.map((w, i) => ({
  year: i + 1, demandMwh: contract * 8760, exportMwh: 0,
  deliveredMwh: w[0] * years[0].delivered + w[1] * years[1].delivered,
  blockShortfallMwh: w[0] * years[0].short + w[1] * years[1].short,
}));
const lp = { sizes, tariff: 6.5, perYear: [{ year: 1, rules: [] }], lifetime };
const ops = opsFromLp(lp, m.fin, m.bess);
const finance = E.runFinancialModel(null, sizes, { costs: m.costs, fin: m.fin, bess: m.bess, dfrTarget: 0, tariffLocked: false, ops, solveBy: "npv" });
const live = liveModelRequest({ state: s, lp, finance, costs: m.costs, fin: m.fin, bess: m.bess, ops, dfrTarget: 0 });
live.dispatch = {
  solar: true, wind: true, sell: false, blocks: true, contract, poi, eta, minSoc: 0.05, maxSoc: 0.95, initSoc: 0.5,
  peakFloor: 0.9, offFloor: 0.7, solarCf, windCf, peak, weights,
  byYear: years.map(({ year, bf, charge, discharge }) => ({ year, bf, charge, discharge })),
};
const input = liveModelInput(JSON.parse(JSON.stringify(live)));
assert.ok(input.dispatch, "the dispatch passes the input check");
assert.equal(liveModelInput({ ...live, dispatch: { ...live.dispatch, solarCf: solarCf.slice(1) } }).dispatch, null, "a short series is refused");

// ---- the sheet: energy by year is a formula on the dispatch sheets and carries the app's value
const res = addLiveModel(new ExcelJS.Workbook(), input);
const ws0 = res.sheet;
const row = res.addr.delivered;
const y10 = ws0.getRow(row).getCell(4 + 10);
assert.match(y10.formula, /'Dispatch Y1'!\$\w+\$5.*'Dispatch Y25'!\$\w+\$5/, y10.formula);
for (const r of finance.rows) {
  assert.ok(close(res.rows.delivered[r.year], r.deliveredMu, 1e-9), `delivered year ${r.year}: ${res.rows.delivered[r.year]} vs ${r.deliveredMu}`);
  assert.ok(close(res.rows.blockShort[r.year], r.blockShortfallMu, 1e-9), `short year ${r.year}`);
}
assert.ok(close(res.values.equityIrr, finance.equityIrr, 1e-9), "the same equity IRR");

// ---- the in-app trace: the energy rows read the dispatch sheets' year totals, each a cell of its own
{
  const { traceModel } = await import("../web/src/model/trace.js");
  const model = traceModel(JSON.parse(JSON.stringify(live)));
  const cell = model.cells[`N${model.lines.delivered.row}`]; // year 10
  const ext = cell.refs.filter((a) => a.startsWith("Dispatch Y"));
  assert.deepEqual(ext.map((a) => a.split("!")[0]), ["Dispatch Y1", "Dispatch Y25"], cell.formula);
  const total = model.cells[ext[0]];
  assert.ok(total && close(total.value, years[0].delivered, 1e-9) && total.dispatch.key === "delivered" && total.dispatch.year === 1);
  assert.ok(total.usedBy.includes(cell.addr), "the year total knows the rows that read it");
  assert.equal(model.dispatch.years[1].values.delivered.length, 8760, "the hours behind it, for the drill-down");
}

// ---- the workbook as the route builds it, recalculated by LibreOffice from no stored value
const { buffer } = await buildModelWorkbook({ title: "Check", rows: finance.rows, cover: { outputs: [] }, live: JSON.parse(JSON.stringify(live)) }, { preparedBy: "check", product: "Tender to Bid" });
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
assert.ok(wb.getWorksheet(dispatchSheetName(1)) && wb.getWorksheet(dispatchSheetName(25)), "a sheet per modelled year");
const L = dispatchLetters(input.dispatch);
const d1 = wb.getWorksheet(dispatchSheetName(1));
assert.equal(d1.getCell(`${L.direct}${FIRST_ROW + 19}`).formula, `MIN($E$3/$F$3-${L.discharge}${FIRST_ROW + 19},${L.gen}${FIRST_ROW + 19}-${L.charge}${FIRST_ROW + 19})`);
const mb = (buffer.length / 1e6).toFixed(1);

let soffice = null;
for (const bin of ["soffice", "libreoffice"]) {
  try { execFileSync("which", [bin], { stdio: "pipe" }); soffice = bin; break; } catch { /* next */ }
}
if (!soffice) {
  console.log(`Dispatch sheet checks passed without LibreOffice (${mb} MB workbook); recalculation NOT RUN`);
  process.exit(0);
}
const bare = new ExcelJS.Workbook();
await bare.xlsx.load(buffer);
for (const ws of bare.worksheets) ws.eachRow((r) => r.eachCell((cell) => { if (cell.formula) cell._value.model.result = undefined; }));
const dir = mkdtempSync(path.join(tmpdir(), "dispatch-wb-"));
try {
  const src = path.join(dir, "book.xlsx");
  writeFileSync(src, Buffer.from(await bare.xlsx.writeBuffer()));
  mkdirSync(path.join(dir, "profile", "user"), { recursive: true });
  writeFileSync(path.join(dir, "profile", "user", "registrymodifications.xcu"), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
`);
  const t0 = Date.now();
  execFileSync(soffice, [`-env:UserInstallation=file://${path.join(dir, "profile")}`, "--headless", "--calc", "--convert-to", "xlsx", "--outdir", path.join(dir, "out"), src], {
    stdio: "pipe", timeout: 600_000, env: { ...process.env, HOME: dir },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(readFileSync(path.join(dir, "out", "book.xlsx")));
  const resultOf = (cell) => (cell.formula ? cell.result : cell.value);
  let formulas = 0;
  for (const name of [LIVE_SHEET, dispatchSheetName(1), dispatchSheetName(25)]) {
    const want = wb.getWorksheet(name);
    const got = out.getWorksheet(name);
    want.eachRow((r) => r.eachCell((cell) => {
      if (!cell.formula) return;
      formulas += 1;
      const g = resultOf(got.getCell(cell.address));
      assert.ok(!(g && typeof g === "object" && "error" in g), `${name}!${cell.address} ${cell.formula} → ${JSON.stringify(g)}`);
      // 17,520 hours summed in another order: the totals differ in the 9th digit, and a difference of
      // two large numbers (profit, the key results' "difference from the app") by up to 1e-4 (₹1,000)
      if (typeof cell.result === "number") assert.ok(typeof g === "number" && (close(g, cell.result, 1e-6) || Math.abs(g - cell.result) < 1e-4), `${name}!${cell.address} ${cell.formula}: ${g} vs ${cell.result}`);
      else if (typeof cell.result === "string") assert.equal(g ?? "", cell.result, `${name}!${cell.address} ${cell.formula}`);
    }));
  }
  const total = resultOf(out.getWorksheet(dispatchSheetName(1)).getCell(`${L.delivered}${TOTAL_ROW}`));
  assert.ok(close(total, years[0].delivered, 1e-6), `year 1 delivered: ${total} vs ${years[0].delivered}`);
  console.log(`Dispatch sheet checks passed (${formulas.toLocaleString("en-IN")} formulas recalculated by LibreOffice in ${secs} s; ${mb} MB workbook; year-1 delivered ${(total / 1000).toFixed(1)} MU)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
