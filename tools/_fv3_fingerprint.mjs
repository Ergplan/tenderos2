import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as E from "../web/src/rtc/engine.js";
import { defaultBidState, modelInputs, opsFromLp } from "../web/src/bid/model.js";
import { liveModelRequest } from "../web/src/bid/liveModelRequest.js";
import { defaultCfdState, fillBenchmarks, runModel as runCfdModel } from "../web/src/cfd/model.js";
import { cfdLiveRequest, runCfdFinance } from "../web/src/cfd/finance.js";

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
  // SECI CfD-I through the same engine: the day-by-day operation's yearly totals, charging power
  // and exchange fees, the Letter of Credit and the weekly shortfall penalty moving with the strike
  // price, SECI's charges as other project cost, 15 operating years (web/src/cfd/finance.js)
  ["SECI CfD-I: charging power, exchange fees, Letter of Credit and weekly penalty moving with the strike price", (() => {
    const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
    const s = fillBenchmarks(defaultCfdState());
    s.inputs.effectiveDate = "2027-02-01";
    s.inputs.useMarket = false; // no bought power and little own RE: some weeks fall short, and the strike price below ₹10 holds an LC
    s.inputs.solarMw = 60;
    s.inputs.lcCostPct = 0.015;
    s.fin = { ...s.fin, repayment: "annuity", graceYears: 1, omStockMonths: 1, sparesPctOm: 0.15, dsraMonths: 3 };
    s.costs = { constructionMonths: 12, drawdown: "sCurve", drawOrder: "proRata" };
    s.tariffLocked = true;
    s.fin.tariff = 7.5;
    const model = runCfdModel(s, prices);
    const finance = runCfdFinance(s, model);
    const req = cfdLiveRequest({ state: s, model, finance });
    const run = (over = {}) => runCfdFinance({ ...s, fin: over.fin ? { ...s.fin, ...over.fin } : s.fin }, model, { tariffLocked: over.tariffLocked ?? true });
    return { name: "", s, m: { fin: finance.engine.fin, costs: finance.engine.costs, bess: finance.engine.bess }, lp: { sizes: finance.engine.sizes }, ops: finance.engine.ops, finance, req, run, dfrTarget: 0 };
  })()],
  ["solar alone, no debt", bid({
    sources: { solar: true },
    fin: { debtFraction: 0, tenorYears: 10 },
    sizes: { solarMw: 3000, windMw: 0, bessMw: 0, bessMwh: 0 },
    years: 20,
    lifetime: yearsOf(20, () => ({ demandMwh: 1000 * 8760, deliveredMwh: 0.25 * 1000 * 8760, exportMwh: 0 })),
  })],
];
import { writeFileSync } from "node:fs";
const rnd = (v) => (typeof v === "number" ? Number(v.toPrecision(12)) : v);
const out = {};
for (const [name, c] of CASES) {
  const f = c.finance;
  out[name] = { tariff: rnd(f.tariff), equityIrr: rnd(f.equityIrr), projectIrr: rnd(f.projectIrr), minDscr: rnd(f.minDscr), debt: rnd(f.debt), equity: rnd(f.equity), capex: rnd(f.capex.total), payback: f.payback,
    rows: f.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => typeof v === "number" || v === null).map(([k, v]) => [k, rnd(v)]))) };
}
// RTC default run too
const inputs = E.DEFAULT_RTC_INPUTS;
const demand = E.buildDemand({ annualEnergyMu: inputs.annualEnergyMu });
const ctx = E.buildContext({ demand, solarCf: E.synthSolarCf({ targetCuf: inputs.solarCuf, dcAc: inputs.solarDcAc }), windCf: E.synthWindCf({ targetCuf: inputs.windCuf }), plantMw: inputs.plantCapacityMw, bess: E.DEFAULT_BESS });
const fr = E.runFinancialModel(ctx, { solarMw: 695, windMw: 460, bessMw: 400, bessMwh: 1600 }, { costs: E.DEFAULT_COSTS, fin: E.DEFAULT_FINANCE, bess: E.DEFAULT_BESS, dfrTarget: 0.85, tariffLocked: false });
out.rtc = { tariff: rnd(fr.tariff), equityIrr: rnd(fr.equityIrr), minDscr: rnd(fr.minDscr), rows: fr.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => typeof v === "number" || v === null).map(([k, v]) => [k, rnd(v)]))) };
writeFileSync(process.argv[2], JSON.stringify(out));
console.log("fingerprint written", Object.keys(out).length, "cases");
