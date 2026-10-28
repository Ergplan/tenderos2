// Checks for the generation build-up of the traceable model (web/src/model/generation.js and the
// "Generation" section of web/lib/liveModel.js): each technology's year is MW × CUF × 365 × 24
// and that formula gives the same energy as the hourly dispatch of each tab, year by year; the
// annual CUF is the days-weighted mean of the monthly CUFs; the twelve months add up to year 1; the
// 15-minute blocks keep each hour's energy.
// Run from the repository root:   node tools/check_generation.mjs
import assert from "node:assert/strict";
import * as E from "../web/src/rtc/engine.js";
import { rtcModelExport } from "../web/src/rtc/exportModel.js";
import { runWhatIf } from "../web/src/whatif/model.js";
import { defaultBidState, lossFactorsOf, modelInputs, opsFromLp, resourceProfiles, defaultLosses } from "../web/src/bid/model.js";
import { liveModelRequest } from "../web/src/bid/liveModelRequest.js";
import { genSource, monthlyCuf, quarterHours } from "../web/src/model/generation.js";
import { traceModel } from "../web/src/model/trace.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const rowVals = (model, key) => {
  const r = model.lines[key]?.row;
  assert.ok(r, `row ${key}`);
  return Array.from({ length: model.N }, (_, i) => model.cells[`${E_COL(5 + i)}${r}`]?.value);
};
const E_COL = (n) => { let s = ""; for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s; return s; };
const one = (model, key) => model.cells[model.lines[key].addr].value;

// ---- the profile helpers
const cf = E.synthSolarCf({ targetCuf: 0.25, dcAc: 1.4 });
const months = monthlyCuf(cf);
near(months.reduce((a, c, m) => a + c * E.MONTH_DAYS[m], 0) / 365, E.mean(cf), 1e-12, "annual CUF = days-weighted months");
const q = quarterHours(cf);
assert.equal(q.length, E.HOURS * 4);
for (let h = 0; h < E.HOURS; h += 1) near((q[4 * h] + q[4 * h + 1] + q[4 * h + 2] + q[4 * h + 3]) / 4, cf[h], 1e-12, `hour ${h} keeps its energy`);
assert.ok(q.every((v) => v >= 0 && v <= 1), "every block within [0, 1]");
assert.equal(JSON.stringify(genSource({ cf })).includes("hourly"), false, "the hourly profile stays out of the Excel request");
assert.equal(genSource({ cf }).hourly, cf);

// ---- What-if: the formula is the dispatch's own solar and wind, every year
{
  const r = runWhatIf({});
  const model = traceModel(r.live);
  const solar = rowVals(model, "solarGen");
  const wind = rowVals(model, "windGen");
  r.ops.forEach((o, i) => {
    near(solar[i], o.solarGenMWh / 1000, 1e-9, `What-if solar year ${i + 1}`);
    near(wind[i], o.windGenMWh / 1000, 1e-9, `What-if wind year ${i + 1}`);
  });
  near(one(model, "solarMuYear"), solar[0], 1e-12, "What-if: the months add up to year 1");
  const cell = model.cells[`E${model.lines.solarGen.row}`];
  assert.match(cell.formula, /\*365\*24\/1000\*/, "MW × CUF × 365 × 24 in the formula");
  const unused = rowVals(model, "unused");
  assert.ok(unused.every((v) => v >= -1e-6), "never more delivered and sold than generated");
  console.log(`ok   What-if  solar ${solar[0].toFixed(1)} MU and wind ${wind[0].toFixed(1)} MU in year 1: MW × CUF × 365 × 24 = the dispatch, all ${model.N} years`);
}

// ---- Round the clock: the formula at the 33 kV bus is the simulation's generation at the bus
for (const sites of [null, { split: true }]) {
  const { site, ...inputs } = E.DEFAULT_RTC_INPUTS;
  const bess = { ...E.DEFAULT_BESS };
  const lf = E.lossFactors(inputs, bess.rte);
  const solarRaw = E.synthSolarCf({ targetCuf: inputs.solarCuf, dcAc: inputs.solarDcAc });
  const windRaw = E.synthWindCf({ targetCuf: inputs.windCuf });
  const solarCf = Float64Array.from(solarRaw, (v) => v * lf.solar);
  const windCf = Float64Array.from(windRaw, (v) => v * lf.wind);
  const bessBus = { ...bess, rte: lf.rteBus };
  const demand = E.buildDemand({ annualEnergyMu: inputs.annualEnergyMu });
  const ctx = E.buildContext({ demand, solarCf, windCf, plantMw: inputs.plantCapacityMw, bess: bessBus, lossPct: inputs.lossPct, trafoLossPct: inputs.trafoLossPct, lineLossPct: inputs.lineLossPct, sellSurplus: true, extraExportMw: 0, sites });
  const sizes = E.withDuration({ ...Object.fromEntries(Object.entries(E.DEFAULT_VARS).map(([k, v]) => [k, v.value])), bessWindShare: 0.4 }, bess);
  const fin = { ...E.DEFAULT_FINANCE, sellSurplus: true, surplusPrice: 2.5, demandGrowth: 0 };
  const finance = E.runFinancialModel(ctx, sizes, { costs: { ...E.DEFAULT_COSTS }, fin, bess: bessBus, dfrTarget: inputs.dfrTarget, tariffLocked: false });
  const live = rtcModelExport({ inputs, sizes, costs: { ...E.DEFAULT_COSTS }, fin, bess: bessBus, sites, finance, profiles: { solarCf: solarRaw, windCf: windRaw } }).live;
  const model = traceModel(live);
  const bus = rowVals(model, "genBus");
  finance.rows.forEach((row, i) => near(bus[i], row.genBusMu, 1e-9, `Round the clock${sites ? " (split)" : ""} bus year ${i + 1}`));
  assert.ok(rowVals(model, "unused").every((v) => v >= -1e-6));
  console.log(`ok   RTC${sites ? " split" : "      "} ${bus[0].toFixed(1)} MU at the 33 kV bus in year 1: (MW × CUF × 365 × 24) × (1 − losses to the bus) = the simulation, all ${model.N} years`);
}

// ---- Tender to Bid: the CUF and losses in the sheet are those of the profile the sizing dispatched
{
  const s = defaultBidState();
  s.bid = { baseMw: 300, greenshoe: false };
  s.sources = { solar: true, wind: true, hydro: false, biomass: false, thermal: false, bess: true };
  s.src.solar = { capacity: { mode: "optimise", mw: 2000 }, cuf: 0.25, dcAc: 1.4, degradation: 0.005, capex: 4, om: 4 };
  s.src.wind = { capacity: { mode: "optimise", mw: 1000 }, cuf: 0.33, capex: 6.5, om: 9 };
  s.src.bess = { capacity: { mode: "optimise", mw: 600 }, duration: "4", rte: 0.87, minSoc: 0.05, maxSoc: 0.95, degradation: 0.02, augmentation: "annual", capex: 1.2, om: 1.2 };
  s.losses = defaultLosses();
  const m = modelInputs(s, { years: 25, sale: "allowed", rules: [] });
  const sizes = { solarMw: 785, windMw: 439, bessMw: 634, bessMwh: 2538 };
  const prof = resourceProfiles(s);
  const lf = lossFactorsOf(s);
  // what the sizing dispatches (lpPayload): the profile × its loss to the bus × MW × the year's degradation
  const lpSolar = (y) => (sizes.solarMw * E.mean(prof.solarCf) * lf.solar * E.HOURS * (1 - m.fin.solarDegradation) ** (y - 1)) / 1000;
  const lifetime = Array.from({ length: 25 }, (_, i) => ({ year: i + 1, demandMwh: 300 * 8760, deliveredMwh: 0.89 * 300 * 8760, exportMwh: 0 }));
  const lp = { sizes, tariff: 7, perYear: [{ year: 1, minMonthlyDfr: 0.8 }], lifetime };
  const ops = opsFromLp(lp, m.fin, m.bess);
  const finance = E.runFinancialModel(null, sizes, { costs: m.costs, fin: m.fin, bess: m.bess, dfrTarget: 0.85, tariffLocked: false, ops, solveBy: "npv" });
  const model = traceModel(liveModelRequest({ state: s, lp, finance, costs: m.costs, fin: m.fin, bess: m.bess, ops, dfrTarget: 0.85 }));
  const bus = rowVals(model, "solarBus");
  for (const y of [1, 10, 25]) near(bus[y - 1], lpSolar(y), 1e-9, `Tender to Bid solar at the bus, year ${y}`);
  near(one(model, "solarCuf"), 0.25, 1e-6, "the bidder's CUF");
  assert.ok(model.cells[model.lines.solarCuf.addr].label.includes("inverter output"), "solar's CUF measured at the inverter output on the SECI loss chain");
  console.log(`ok   Bid      solar ${bus[0].toFixed(1)} MU at the bus in year 1 = 785 MW × 25% × 365 × 24 × (1 − ${((1 - lf.solar) * 100).toFixed(2)}% to the bus), as the HiGHS sizing dispatches it`);
}
