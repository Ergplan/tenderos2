// Checks for the Live model sheet of the bid workbook (web/lib/liveModel.js): the formulas
// rebuild the app's financial model (web/src/rtc/engine.js) year by year. Three bids that between
// them use every branch: all six sources with a flat market price, WDV tax and annual battery
// augmentation; separate sites (no energy between them) with hourly market revenue, annuity repayment, straight-line tax,
// a one-time augmentation, tariff escalation, a shortfall penalty and tax losses; solar alone
// with no debt.
//   1. the values the sheet carries match the app's rows and results;
//   2. LibreOffice recalculates every formula to the value the cell carries, with no error;
//   3. change an input (the tariff, a capex) and the recalculated returns match the app run on
//      the changed input: the sheet is live, not a picture.
// Step 2 and 3 need LibreOffice (soffice); without it they are reported as not run.
// Run from the repository root:   node tools/check_live_model.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import * as E from "../web/src/rtc/engine.js";
import { defaultBidState, modelInputs, opsFromLp } from "../web/src/bid/model.js";
import { liveModelRequest } from "../web/src/bid/liveModelRequest.js";
import { CONSTRUCTION_SHEET, LIVE_SHEET, addLiveModel, liveModelInput } from "../web/lib/liveModel.js";
import { buildModelWorkbook } from "../web/lib/modelWorkbook.js";
import { rtcModelExport } from "../web/src/rtc/exportModel.js";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const ExcelJS = require("exceljs");

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---- three bids
function bid({ sources, src = {}, fin = {}, costs = {}, market, sites, years = 25, lifetime, sizes, tariffLocked = false, tariff, rules = [], lpExtra = {} }) {
  const s = defaultBidState();
  s.bid = { baseMw: 1000, greenshoe: false };
  s.sources = { solar: false, wind: false, hydro: false, biomass: false, thermal: false, bess: false, ...sources };
  s.src.solar = { capacity: { mode: "optimise", mw: 8000 }, cuf: 0.26, dcAc: 1.4, degradation: 0.005, capex: 3.6, om: 4 };
  s.src.wind = { capacity: { mode: "optimise", mw: 4000 }, cuf: 0.35, capex: 6.8, om: 9 };
  s.src.hydro = { capacity: { mode: "fixed", mw: 300 }, cuf: 0.45, availability: 1, capex: 0.5, fixed: 150, energy: 1.2, escalation: 0.02, monthlyCuf: null };
  s.src.biomass = { capacity: { mode: "optimise", mw: 500 }, availability: 0.9, cuf: 0.8, minLoad: 0.3, ramp: 0.005, capex: 7, om: 35, fuel: 4, fuelEscalation: 0.04 };
  s.src.thermal = { capacity: { mode: "optimise", mw: 800 }, availability: 0.85, cuf: 0.85, minLoad: 0, ramp: 0.01, capex: 0, fixed: 120, energy: 3, rec: 0.15, escalation: 0.03 };
  s.src.bess = { capacity: { mode: "optimise", mw: 3000 }, duration: "4", rte: 0.87, minSoc: 0.05, maxSoc: 0.95, degradation: 0.02, augmentation: "annual", capex: 1.2, om: 1.2 };
  for (const [id, v] of Object.entries(src)) s.src[id] = { ...s.src[id], ...v };
  s.fin = { ...s.fin, targetEquityIrr: 0.14, debtFraction: 0.7, interestRate: 0.09, tenorYears: 15, taxRate: 0.2517, omEscalation: 0.05, insurancePct: 0.003, tariffEscalation: 0, ...fin };
  s.costs = { preopPct: 0.05, evacuationCr: 120, ...costs };
  s.market = market || { sell: false, source: "flat", escalation: 0, flatPrice: 0 };
  if (sites) s.sites = sites;
  if (tariffLocked) { s.tariffLocked = true; s.fin.tariff = tariff; }
  const terms = { years, sale: "allowed", rules };
  const m = modelInputs(s, terms);
  const lp = { sizes, tariff: 5, perYear: [{ year: 1, minMonthlyDfr: 0.7 }], lifetime, ...lpExtra, ...(sites?.split ? { sites: { split: true } } : {}), ...(market?.source && market.source !== "flat" ? { market: market.source } : {}) };
  const ops = opsFromLp(lp, m.fin, m.bess);
  const dfrTarget = 0.8;
  const run = (over = {}) => E.runFinancialModel(null, over.sizes || sizes, { costs: over.costs || m.costs, fin: over.fin || m.fin, bess: m.bess, dfrTarget, tariffLocked: over.tariffLocked ?? tariffLocked, ops, solveBy: "npv" });
  const finance = run();
  const req = liveModelRequest({ state: s, lp, finance, costs: m.costs, fin: m.fin, bess: m.bess, ops, dfrTarget });
  return { name: "", s, m, lp, ops, finance, req, run, dfrTarget };
}

const yearsOf = (n, f) => Array.from({ length: n }, (_, i) => ({ year: i + 1, ...f(i + 1) }));
const CASES = [
  ["six sources, flat market sale, WDV, annual augmentation", bid({
    sources: { solar: true, wind: true, hydro: true, biomass: true, thermal: true, bess: true },
    market: { sell: true, source: "flat", escalation: 0, flatPrice: 2.5 },
    sizes: { solarMw: 4000, windMw: 1200, bessMw: 900, bessMwh: 3600, biomassMw: 200, hydroMw: 300, thermalMw: 300 },
    lifetime: yearsOf(25, (y) => ({ demandMwh: 1000 * 8760, deliveredMwh: (0.86 - 0.002 * y) * 1000 * 8760, exportMwh: 1e6 - 1e4 * y, biomassMwh: 1.2e6, hydroMwh: 1.1e6, thermalMwh: 0.9e6 })),
  })],
  ["separate sites, hourly IEX, annuity, SLM, one-time augmentation, escalation, penalty, tax losses", bid({
    sources: { solar: true, wind: true, bess: true },
    src: { bess: { augmentation: "annual" } },
    fin: { tariffEscalation: 0.01, repayment: "annuity", taxDepreciation: "slm", shortfallPenalty: 2, tenorYears: 18 },
    market: { sell: true, source: "DAM", escalation: 0, flatPrice: 0 },
    sites: { split: true },
    sizes: { solarMw: 2600, windMw: 900, bessMw: 700, bessMwh: 2800, bessSolarSiteMw: 500, bessSolarSiteMwh: 2000, bessWindSiteMw: 200, bessWindSiteMwh: 800 },
    lifetime: yearsOf(25, (y) => ({ demandMwh: 1000 * 8760, deliveredMwh: (y % 5 === 0 ? 0.76 : 0.83) * 1000 * 8760, exportMwh: 6e5, exportRevenueCr: 6e5 * (3.1 + 0.02 * y) * 1e-4 })),
    tariffLocked: true, tariff: 2.6,
  })],
  ["SECI RTC-TM time-block floors, 1.5x tariff penalty", bid({
    sources: { solar: true, wind: true, bess: true },
    fin: { tariffEscalation: 0.02 },
    // the tender's time-block floors carry the 1.5x tariff penalty into the financial model
    rules: [{ id: "peak", basis: "block", hours: "peak", target: 0.9, penaltyMultiple: 1.5 }, { id: "offpeak", basis: "block", hours: "offpeak", target: 0.7, penaltyMultiple: 1.5 }],
    sizes: { solarMw: 900, windMw: 700, bessMw: 300, bessMwh: 1200 },
    lifetime: yearsOf(25, (y) => ({ demandMwh: 300 * 8760, deliveredMwh: 0.8 * 300 * 8760, exportMwh: 0, blockShortfallMwh: 9000 + 400 * y })),
  })],
  ["SECI FDRE-RTC-V (Amendment-03): Peak, Solar and Remaining Hours; the Solar Hours excess to the buyer at half the tariff", bid({
    sources: { solar: true, wind: true, bess: true },
    fin: { tariffEscalation: 0.02 },
    market: { sell: true, source: "GDAM", escalation: 0, flatPrice: 0 },
    rules: [{ id: "peak", basis: "block", hours: "peak", target: 0.9, penaltyMultiple: 1.5 }, { id: "solar", basis: "block", hours: "solar", target: 0.5, max: 0.6, excessTariffShare: 0.5, penaltyMultiple: 1.5 },
      { id: "remaining", basis: "block", hours: "remaining", target: 0.7, penaltyMultiple: 1.5 }],
    sizes: { solarMw: 800, windMw: 300, bessMw: 650, bessMwh: 2600 },
    lifetime: yearsOf(25, (y) => ({ demandMwh: 300 * 8760, deliveredMwh: 0.74 * 300 * 8760, exportMwh: 1.2e5, exportRevenueCr: 1.2e5 * 4.1e-4, buyerExcessMwh: 9e4 - 500 * y, blockShortfallMwh: 4000 + 100 * y })),
    lpExtra: { buyerExcessShare: 0.5 },
  })],
  // the enterprise financing: a construction schedule with IDC, working capital per CERC norms with
  // interest on it, a principal moratorium, sculpted repayment, a debt service reserve and DSM charges
  ["18-month S-curve construction with IDC, sculpted repayment after a 1-year moratorium, CERC working capital, DSRA, DSM", bid({
    sources: { solar: true, wind: true, bess: true },
    fin: { repayment: "sculpted", targetDscr: 1.35, graceYears: 1, tenorYears: 18, omStockMonths: 1, sparesPctOm: 0.15, wcInterestRate: 0.11, dsraMonths: 6, tariffEscalation: 0.01 },
    costs: { constructionMonths: 18, drawdown: "sCurve", drawOrder: "proRata", preopPct: 0.03 },
    sizes: { solarMw: 900, windMw: 600, bessMw: 400, bessMwh: 1600 },
    lifetime: yearsOf(25, (y) => ({ demandMwh: 300 * 8760, deliveredMwh: 0.82 * 300 * 8760, exportMwh: 2e4, dsmChargeCr: 1.5 + 0.05 * y })),
  })],
  // balloon repayment with quarterly instalments, refinanced at the end of year 6 at a lower rate
  ["balloon repayment, quarterly instalments, refinanced in year 6", bid({
    sources: { solar: true, bess: true },
    fin: { repayment: "balloon", balloonPct: 0.35, paymentsPerYear: 4, tenorYears: 12, refiYear: 6, refiRate: 0.08, refiTenorYears: 10, refiFeePct: 0.01, taxDepreciation: "slm" },
    costs: { constructionMonths: 12, drawdown: "front", drawOrder: "equityFirst" },
    sizes: { solarMw: 1200, windMw: 0, bessMw: 300, bessMwh: 1200 },
    lifetime: yearsOf(25, (y) => ({ demandMwh: 300 * 8760, deliveredMwh: (0.6 - 0.001 * y) * 300 * 8760, exportMwh: 0 })),
  })],
  // the principal stepping up 6% a year, monthly instalments, equity put in first over a back-loaded build
  ["step-up repayment, monthly instalments, equity-first back-loaded construction", bid({
    sources: { solar: true, wind: true, bess: true },
    fin: { repayment: "stepUp", stepUpPct: 0.06, paymentsPerYear: 12, tenorYears: 15, graceYears: 2 },
    costs: { constructionMonths: 24, drawdown: "back", drawOrder: "equityFirst" },
    sizes: { solarMw: 700, windMw: 500, bessMw: 350, bessMwh: 1400 },
    lifetime: yearsOf(25, () => ({ demandMwh: 300 * 8760, deliveredMwh: 0.8 * 300 * 8760, exportMwh: 0 })),
  })],
  ["solar alone, no debt", bid({
    sources: { solar: true },
    fin: { debtFraction: 0, tenorYears: 10 },
    sizes: { solarMw: 3000, windMw: 0, bessMw: 0, bessMwh: 0 },
    years: 20,
    lifetime: yearsOf(20, () => ({ demandMwh: 1000 * 8760, deliveredMwh: 0.25 * 1000 * 8760, exportMwh: 0 })),
  })],
];
// the second bid uses a one-time augmentation in year 10, with the battery price falling 3% a year
{
  const c = CASES[1][1];
  const bess = { ...c.m.bess, augmentation: "oneTime", augmentationYear: 10, costDeclinePct: 0.03 };
  c.finance = E.runFinancialModel(null, c.lp.sizes, { costs: c.m.costs, fin: c.m.fin, bess, dfrTarget: c.dfrTarget, tariffLocked: true, ops: c.ops, solveBy: "npv" });
  c.req = { ...liveModelRequest({ state: c.s, lp: c.lp, finance: c.finance, costs: c.m.costs, fin: c.m.fin, bess, ops: c.ops, dfrTarget: c.dfrTarget }) };
  c.run = (over = {}) => E.runFinancialModel(null, c.lp.sizes, { costs: over.costs || c.m.costs, fin: over.fin || c.m.fin, bess, dfrTarget: c.dfrTarget, tariffLocked: over.tariffLocked ?? true, ops: c.ops, solveBy: "npv" });
}

// the sheet's rows that are the app's rows
const SAME = {
  ppaRev: "energyRevenue", mktRev: "surplusRevenue", penaltyCr: "annualPenalty", revenue: "revenue",
  blockShort: "blockShortfallMu", opex: "opex", ebitda: "ebitda", aug: "augCapex",
  bookDep: "bookDep", openDebt: "openingDebt", interest: "interest", principal: "principal", closeDebt: "closingDebt", taxDep: "taxDep",
  pbt: "pbt", tax: "tax", pat: "pat", recv: "receivables", dWc: "dWc", cfads: "cfads", debtService: "debtService", dscr: "dscr",
  fcfe: "fcfe", cumEq: "cumEquity", projCf: "projectCf", trf: "tariff", delivered: "deliveredMu", demand: "demandMu", excess: "excessMu", dfr: "dfr",
  buyerRev: "buyerRevenue", buyerMu: "buyerExcessMu",
  wcBal: "wcBalance", omStock: "omStock", spares: "spares", wcInt: "wcInterest", refiFeeCr: "refiFee", dsra: "dsraBalance", dDsra: "dDsra", rateY: "debtRate", dsmCr: "dsm",
};
const RESULTS = ["tariff", "equityIrr", "projectIrr", "equityNpv", "projectNpv", "minDscr", "avgDscr", "lcoe", "levelisedTariff", "capexTotal", "debt", "equity", "revenueTotal"];

// bare: every formula without its value, so LibreOffice must work each one out
async function build(c, { bare = false } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties = { fullCalcOnLoad: true };
  const input = liveModelInput(JSON.parse(JSON.stringify(c.req)));
  const live = addLiveModel(wb, { ...input, title: "Check" });
  if (bare) {
    for (const name of [LIVE_SHEET, CONSTRUCTION_SHEET]) {
      wb.getWorksheet(name).eachRow((row) => row.eachCell((cell) => {
        if (cell.formula) cell._value.model.result = undefined;
      }));
    }
  }
  return { wb, live, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}

// ---- 1. the values the sheet carries are the app's
for (const [name, c] of CASES) {
  const { live } = await build(c);
  for (const [key, appKey] of Object.entries({ ...SAME, ...(live.rows.blockPenCr ? { blockPenCr: "blockPenalty" } : {}) })) {
    if (!live.rows[key]) continue;
    for (const row of c.finance.rows) {
      const a = live.rows[key][row.year];
      const b = row[appKey];
      if (b === null || b === undefined) { assert.equal(a, "", `${name}: ${key} y${row.year} is blank where the app has none`); continue; }
      assert.ok(close(a, b, 1e-9), `${name}: ${key} year ${row.year}: sheet ${a}, app ${b}`);
    }
  }
  for (const key of RESULTS) {
    const app = c.req.app[key];
    if (app === null || app === undefined) continue;
    assert.ok(close(live.values[key], app, key.endsWith("Irr") ? 1e-6 : 1e-9), `${name}: ${key}: sheet ${live.values[key]}, app ${app}`);
  }
  assert.equal(live.values.payback, c.finance.payback ?? "beyond the term", `${name}: payback`);
  assert.equal(live.values.checks, "OK");
  console.log(`ok   values  ${name}: tariff ₹${c.finance.tariff.toFixed(4)}/kWh, equity IRR ${(c.finance.equityIrr * 100).toFixed(3)}%`);
}
// the branches each bid was meant to reach
assert.ok(CASES[0][1].finance.rows.some((r) => r.augCapex > 0) && CASES[0][1].finance.rows[1].augCapex > 0, "annual augmentation");
assert.ok(CASES[1][1].finance.rows.filter((r) => r.augCapex > 0).map((r) => r.year).join() === "10", "one-time augmentation in year 10");
assert.ok(CASES[1][1].finance.rows.some((r) => r.penalty > 0), "a shortfall penalty");
assert.ok(CASES[1][1].finance.rows[0].tax === 0 && CASES[1][1].finance.rows.some((r) => r.tax > 0), "tax losses carried, then tax");
assert.ok(CASES[1][1].finance.rows[0].surplusRevenue > 0);
assert.ok(CASES[CASES.length - 1][1].finance.rows.every((r) => r.dscr === null), "no debt: no DSCR");
{
  // the enterprise financing branches
  const a = CASES[4][1].finance;
  assert.ok(a.construction && a.construction.months === 18 && a.capex.idc > 0, "IDC from the construction schedule");
  assert.ok(Math.abs(a.construction.rows.reduce((t, r) => t + r.cost, 0) - (a.capex.hard + a.capex.preop)) < 1e-6, "the whole cost is spent");
  assert.ok(Math.abs(a.debt - (0.7 * (a.capex.hard + a.capex.preop) + a.capex.idc)) < 1e-9, "debt = share of the cost before IDC + IDC");
  assert.equal(a.rows[0].principal, 0, "moratorium: no principal in year 1");
  // the DSCR sits at the target while the balance lasts; the year that clears it (early, when the
  // cash flow allows) covers more, and nothing is owed by the tenor
  const sculpted = a.rows.filter((r) => r.openingDebt > 1e-6 && r.closingDebt > 1e-6 && r.year > 1);
  assert.ok(sculpted.length >= 8, "years of sculpted repayment");
  for (const r of sculpted) assert.ok(r.principal > 0 && Math.abs(r.dscr - 1.35) < 1e-6, `sculpted: DSCR 1.35 in year ${r.year} (${r.dscr})`);
  assert.ok(Math.abs(a.rows[17].closingDebt) < 1e-6 && a.rows[18].principal === 0, "the debt is cleared by the tenor");
  assert.ok(a.rows[0].wcInterest > 0 && a.rows[0].omStock > 0 && a.rows[0].spares > 0, "working capital per CERC norms with interest");
  assert.ok(a.rows[0].dsraBalance > 0 && Math.abs(a.rows[0].dsraBalance - (a.rows[1].debtService * 6) / 12) < 1e-9 && a.rows[24].dsraBalance === 0, "DSRA from the next year's debt service, released at the end");
  assert.ok(a.rows[2].dsm > 0 && Math.abs(a.rows[2].opex - (a.rows[2].om + a.rows[2].insurance + a.rows[2].other + a.rows[2].dsm)) < 1e-9, "DSM charges in the operating cost");
  const b = CASES[5][1].finance;
  const refi = b.rows[5];
  assert.ok(refi.refiFee > 0 && Math.abs(refi.refiFee - refi.closingDebt * 0.01) < 1e-9, "the refinancing fee on the balance refinanced");
  assert.ok(b.rows[6].debtRate === 0.08 && b.rows[5].debtRate === 0.09, "the refinanced rate from the year after");
  assert.ok(Math.abs(b.rows[15].closingDebt) < 1e-6 && b.rows[15].principal > 3 * b.rows[14].principal, "the balloon in the refinanced debt's last year (6 + 10)");
  assert.ok(b.rows[0].interest < b.rows[0].openingDebt * 0.09 - 1e-9, "quarterly instalments save interest within the year");
  assert.ok(b.construction.rows[0].debt === 0 && b.construction.rows[11].debt > 0, "equity first: the first month is all equity");
  const c = CASES[6][1].finance;
  assert.ok(c.rows[0].principal === 0 && c.rows[1].principal === 0 && c.rows[2].principal > 0, "two years' moratorium");
  for (let y = 4; y <= 14; y += 1) assert.ok(Math.abs(c.rows[y - 1].principal / c.rows[y - 2].principal - 1.06) < 1e-9, `step-up 6% in year ${y}`);
  assert.ok(Math.abs(c.rows[14].closingDebt) < 1e-6, "cleared by the tenor");
  // bullet: interest only, then everything
  const bullet = E.principalOf("bullet", 100, 5, 0.09, 9, { balloon: 100 });
  assert.equal(bullet, 0);
  assert.equal(E.principalOf("bullet", 100, 1, 0.09, 9, { balloon: 100 }), 100);
}
{
  // Amendment-03: the buyer pays half the year's (escalated) tariff for the Solar Hours excess
  const r3 = CASES[3][1].finance.rows[2];
  assert.ok(r3.buyerRevenue > 0 && Math.abs(r3.buyerRevenue - (r3.buyerExcessMu * 1000 * 0.5 * r3.tariff) / 1e4) < 1e-9, "the buyer's half tariff");
  assert.ok(Math.abs(r3.revenue - (r3.energyRevenue + r3.surplusRevenue + r3.buyerRevenue - r3.penalty)) < 1e-9);
}
{
  // the block penalty: shortfall x 1.5 x the year's (escalated) tariff
  const r5 = CASES[2][1].finance.rows[4];
  assert.ok(Math.abs(r5.blockPenalty - (r5.blockShortfallMu * 1000 * 1.5 * r5.tariff) / 1e4) < 1e-9, "1.5 x tariff on the energy short");
  assert.ok(r5.blockPenalty > 0 && Math.abs(r5.penalty - r5.annualPenalty - r5.blockPenalty) < 1e-9);
}

// ---- 2 and 3: LibreOffice
let soffice = null;
for (const bin of ["soffice", "libreoffice"]) {
  try { execFileSync("which", [bin], { stdio: "pipe" }); soffice = bin; break; } catch { /* next */ }
}
if (!soffice) {
  console.log("NOT RUN  LibreOffice recalculation: soffice not found (install LibreOffice to run steps 2 and 3)");
  process.exit(0);
}

async function recalc(buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), "live-model-"));
  try {
    const src = path.join(dir, "in.xlsx");
    writeFileSync(src, buffer);
    // a LibreOffice profile that recalculates every formula when an xlsx is opened
    mkdirSync(path.join(dir, "profile", "user"), { recursive: true });
    writeFileSync(path.join(dir, "profile", "user", "registrymodifications.xcu"), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
`);
    execFileSync(soffice, [`-env:UserInstallation=file://${path.join(dir, "profile")}`, "--headless", "--calc", "--convert-to", "xlsx", "--outdir", path.join(dir, "out"), src], {
      stdio: "pipe", timeout: 180_000, env: { ...process.env, HOME: dir },
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(readFileSync(path.join(dir, "out", "in.xlsx")));
    return wb.getWorksheet(LIVE_SHEET);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// cell.result, not cell.value.result: exceljs's value drops a result of 0 or ""
async function recalcBook(buffer, dir) {
  const src = path.join(dir, "book.xlsx");
  writeFileSync(src, buffer);
  mkdirSync(path.join(dir, "profile", "user"), { recursive: true });
  writeFileSync(path.join(dir, "profile", "user", "registrymodifications.xcu"), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
`);
  execFileSync(soffice, [`-env:UserInstallation=file://${path.join(dir, "profile")}`, "--headless", "--calc", "--convert-to", "xlsx", "--outdir", path.join(dir, "out"), src], {
    stdio: "pipe", timeout: 180_000, env: { ...process.env, HOME: dir },
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(path.join(dir, "out", "book.xlsx")));
  return wb;
}

const resultOf = (cell) => (cell.formula ? cell.result : cell.value);
const numberAt = (ws, addr) => {
  const v = resultOf(ws.getCell(addr.replace(/^'[^']+'!/, "").replace(/\$/g, "")));
  return typeof v === "object" && v !== null && "error" in v ? v.error : v;
};

for (const [name, c] of CASES) {
  const { wb, live } = await build(c);
  const bare = await recalcBook((await build(c, { bare: true })).buffer, mkdtempSync(path.join(tmpdir(), "live-model-")));
  const ws = bare.getWorksheet(LIVE_SHEET);
  let formulas = 0;
  for (const sheetName of [LIVE_SHEET, CONSTRUCTION_SHEET]) {
  const mine = wb.getWorksheet(sheetName);
  const theirs = bare.getWorksheet(sheetName);
  mine.eachRow((row) => row.eachCell((cell) => {
    const v = cell.value;
    if (!v || typeof v !== "object" || !("formula" in v)) return;
    formulas += 1;
    const got = resultOf(theirs.getCell(cell.address));
    assert.ok(!(got && typeof got === "object" && "error" in got), `${name}: ${cell.address} ${v.formula} → ${JSON.stringify(got)}`);
    const want = cell.result;
    if (typeof want === "number") {
      assert.ok(typeof got === "number" && close(got, want, cell.address.startsWith("C") && /IRR/.test(v.formula) ? 1e-6 : 1e-7),
        `${name}: ${cell.address} ${v.formula}: LibreOffice ${got}, carried ${want}`);
    } else if (want !== undefined) {
      assert.equal(got ?? "", want, `${name}: ${sheetName} ${cell.address} ${v.formula}`);
    }
  }));
  }
  for (const key of RESULTS) {
    const app = c.req.app[key];
    if (typeof app !== "number") continue;
    assert.ok(close(numberAt(ws, live.cells[key]), app, key.endsWith("Irr") ? 1e-6 : 1e-7), `${name}: ${key} recalculated: ${JSON.stringify(numberAt(ws, live.cells[key]))} vs ${app} at ${live.cells[key]}`);
  }
  console.log(`ok   recalc  ${name}: ${formulas} formulas: LibreOffice works each one out, from no value, to the value the cell carries`);
}

// a changed input moves the whole model: tariff + ₹0.25/kWh on the first bid, battery capex
// − 20% on the second; the recalculated returns are the app's on the same inputs
{
  const [name, c] = CASES[0];
  const newTariff = c.finance.tariff + 0.25;
  const { live, buffer } = await build(c);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws0 = wb.getWorksheet(LIVE_SHEET);
  // the tariff input cell (the key result row links to it)
  const tariffInput = ws0.getCell(live.cells.tariff.split("!")[1].replace(/\$/g, "")).value.formula.replace(/\$/g, "");
  ws0.getCell(tariffInput).value = newTariff;
  const ws = await recalc(Buffer.from(await wb.xlsx.writeBuffer()));
  const app = c.run({ fin: { ...c.m.fin, tariff: newTariff }, tariffLocked: true });
  for (const [key, want] of [["equityIrr", app.equityIrr], ["projectIrr", app.projectIrr], ["minDscr", app.minDscr], ["equityNpv", app.equityNpv], ["revenueTotal", app.totals.revenue]]) {
    assert.ok(close(numberAt(ws, live.cells[key]), want, 1e-6), `${name}, tariff +0.25: ${key} ${numberAt(ws, live.cells[key])} vs app ${want}`);
  }
  assert.equal(numberAt(ws, live.cells.checks), "OK");
  console.log(`ok   live    tariff ₹${newTariff.toFixed(3)}: equity IRR ${(app.equityIrr * 100).toFixed(3)}% in LibreOffice and in the app`);
}
{
  const [name, c] = CASES[1];
  const { live, buffer } = await build(c);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws0 = wb.getWorksheet(LIVE_SHEET);
  let capexCell = null;
  ws0.eachRow((row) => { if (row.getCell(1).value === "Battery energy" && row.getCell(2).value === "₹ cr/MWh") capexCell = row.getCell(3); });
  assert.ok(capexCell, "battery capex input");
  const newCapex = capexCell.value * 0.8;
  capexCell.value = newCapex;
  const ws = await recalc(Buffer.from(await wb.xlsx.writeBuffer()));
  const app = c.run({ costs: { ...c.m.costs, bessCrPerMwh: newCapex } });
  for (const [key, want] of [["capexTotal", app.capex.total], ["equityIrr", app.equityIrr], ["projectIrr", app.projectIrr], ["lcoe", app.lcoe], ["avgDscr", app.avgDscr]]) {
    assert.ok(close(numberAt(ws, live.cells[key]), want, 1e-6), `${name}, battery capex −20%: ${key} ${numberAt(ws, live.cells[key])} vs app ${want}`);
  }
  console.log(`ok   live    battery ₹${newCapex.toFixed(2)} cr/MWh: project cost ₹${app.capex.total.toFixed(1)} cr, equity IRR ${(app.equityIrr * 100).toFixed(3)}% in LibreOffice and in the app`);
}
// ---- 4. the whole workbook (web/lib/modelWorkbook.js, as the routes build it): Round the clock on
// one site and on separate sites, and the first Tender to Bid bid; the Cover's key results are
// formulas on the Live model and recalculate to the app's numbers
function rtcCase(sites) {
  const { site, ...inputs } = E.DEFAULT_RTC_INPUTS;
  const bess = { ...E.DEFAULT_BESS };
  const costs = { ...E.DEFAULT_COSTS };
  const fin0 = { ...E.DEFAULT_FINANCE, sellSurplus: true, surplusPrice: 2.5 };
  const lf = E.lossFactors(inputs, bess.rte);
  const solarRaw = E.synthSolarCf({ targetCuf: inputs.solarCuf, dcAc: inputs.solarDcAc });
  const windRaw = E.synthWindCf({ targetCuf: inputs.windCuf });
  const solarCf = Float64Array.from(solarRaw, (v) => v * lf.solar);
  const windCf = Float64Array.from(windRaw, (v) => v * lf.wind);
  const bessBus = { ...bess, rte: lf.rteBus };
  const demand = E.buildDemand({ annualEnergyMu: inputs.annualEnergyMu });
  const ctx = E.buildContext({ demand, solarCf, windCf, plantMw: inputs.plantCapacityMw, bess: bessBus, lossPct: inputs.lossPct, trafoLossPct: inputs.trafoLossPct, lineLossPct: inputs.lineLossPct, sellSurplus: true, extraExportMw: 0, sites });
  const sizes = E.withDuration({ ...Object.fromEntries(Object.entries(E.DEFAULT_VARS).map(([k, v]) => [k, v.value])), bessWindShare: 0.4 }, bess);
  const fin = { ...fin0, demandGrowth: 0 };
  const finance = E.runFinancialModel(ctx, sizes, { costs, fin, bess: bessBus, dfrTarget: inputs.dfrTarget, tariffLocked: false });
  return { finance, body: rtcModelExport({ inputs, sizes, costs, fin, bess: bessBus, sites, finance, profiles: { solarCf: solarRaw, windCf: windRaw } }) };
}
const WORKBOOKS = [
  ["Round the clock, one site", rtcCase(null), "Round the clock"],
  ["Round the clock, separate sites", rtcCase({ split: true }), "Round the clock"],
];
assert.ok(WORKBOOKS[0][1].finance.rows[0].trafoLossMu > 0, "losses to the 220 kV meter");
{
  // the first Tender to Bid bid, as its route sends it (the Live model part is what this check built)
  const c = CASES[0][1];
  WORKBOOKS.push(["Tender to Bid, six sources", { finance: c.finance, body: { title: "Check", rows: c.finance.rows, cover: { outputs: [
    ["Bid tariff (₹/kWh)", c.finance.tariff, "tariff", "", "tariff"], ["Equity IRR", c.finance.equityIrr, "pct", "", "equityIrr"], ["Minimum DSCR", c.finance.minDscr, "x", "", "minDscr"],
  ] }, live: c.req } }, "Tender to Bid"]);
}
for (const [name, { finance, body }, product] of WORKBOOKS) {
  const req = JSON.parse(JSON.stringify(body));
  const { buffer } = await buildModelWorkbook(req, { preparedBy: "check", product });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.deepEqual(wb.worksheets.slice(0, 2).map((w) => w.name), ["Cover", LIVE_SHEET], name);
  if (product === "Round the clock") {
    assert.ok(!wb.getWorksheet("Tender conditions"), "no tender, no conditions sheet");
    const text = [];
    wb.getWorksheet(LIVE_SHEET).eachRow((row) => text.push(String(row.getCell(1).value ?? "")));
    assert.ok(text.includes("At the 220 kV billing meter") && text.some((t) => t.startsWith("Energy (the hourly simulation")), name);
    assert.ok(!text.some((t) => /between the sites/.test(t)), `${name}: nothing is sent between the sites`);
    if (req.live.split) assert.ok(/% at the wind site/.test(req.live.bessNote), name);
  }
  // the app's values in the sheet, then LibreOffice from no stored value
  const live = addLiveModel(new ExcelJS.Workbook(), liveModelInput(req.live));
  for (const [key, appKey] of Object.entries(SAME)) {
    if (!live.rows[key]) continue;
    for (const row of finance.rows) {
      const b = row[appKey];
      if (b === null || b === undefined || Number.isNaN(b)) continue;
      assert.ok(close(live.rows[key][row.year], b, 1e-9), `${name}: ${key} year ${row.year}: sheet ${live.rows[key][row.year]}, app ${b}`);
    }
  }
  const bare = new ExcelJS.Workbook();
  await bare.xlsx.load(buffer);
  for (const ws of bare.worksheets) ws.eachRow((row) => row.eachCell((cell) => { if (cell.formula) cell._value.model.result = undefined; }));
  const dir = mkdtempSync(path.join(tmpdir(), "live-wb-"));
  try {
    const out = await recalcBook(Buffer.from(await bare.xlsx.writeBuffer()), dir);
    const ws = out.getWorksheet(LIVE_SHEET);
    let formulas = 0;
    wb.getWorksheet(LIVE_SHEET).eachRow((row) => row.eachCell((cell) => {
      if (!cell.formula) return;
      formulas += 1;
      const got = resultOf(ws.getCell(cell.address));
      const want = cell.result;
      assert.ok(!(got && typeof got === "object" && "error" in got), `${name}: ${cell.address} ${cell.formula} → ${JSON.stringify(got)}`);
      if (typeof want === "number") assert.ok(typeof got === "number" && close(got, want, 1e-6), `${name}: ${cell.address} ${cell.formula}: ${got} vs ${want}`);
      else if (want !== undefined) assert.equal(got ?? "", want, `${name}: ${cell.address}`);
    }));
    const cover = out.getWorksheet("Cover");
    let links = 0;
    wb.getWorksheet("Cover").eachRow((row) => row.eachCell((cell) => {
      if (!cell.formula) return;
      links += 1;
      const got = resultOf(cover.getCell(cell.address));
      if (typeof cell.result === "number") assert.ok(close(got, cell.result, 1e-6), `${name}: Cover ${cell.address} ${cell.formula}: ${got} vs ${cell.result}`);
    }));
    assert.ok(links >= 3, `${name}: Cover links`);
    for (const key of RESULTS) {
      const app = req.live.app[key];
      if (typeof app === "number") assert.ok(close(resultOf(ws.getCell(live.cells[key].split("!")[1].replace(/\$/g, ""))), app, key.endsWith("Irr") ? 1e-6 : 1e-6), `${name}: ${key}`);
    }
    console.log(`ok   book    ${name}: tariff ₹${finance.tariff.toFixed(4)}/kWh; ${formulas} Live model formulas and ${links} Cover links recalculated by LibreOffice to the app's numbers`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log("live model checks passed");
