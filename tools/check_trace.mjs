// Checks for the traceable financial model (web/src/model/trace.js): the in-app grid is the Live
// model sheet of the bid workbook, every formula's references resolve to cells of the grid, every
// key result traces back to inputs, and precedents and dependents mirror each other.
// Run from the repository root:   node tools/check_trace.mjs
import assert from "node:assert/strict";
import * as E from "../web/src/rtc/engine.js";
import { defaultBidState, modelInputs, opsFromLp } from "../web/src/bid/model.js";
import { liveModelRequest } from "../web/src/bid/liveModelRequest.js";
import { cellName, formulaParts, formulaRefs, inputsOf, traceModel } from "../web/src/model/trace.js";

// references: ranges expand, strings and function names are not references
assert.deepEqual(formulaRefs('IF($C$12="Yes",E30*E$9/10,0)'), ["C12", "E30", "E9"]);
assert.deepEqual(formulaRefs("SUM(E5:G5)+LOG10(2)"), ["E5", "F5", "G5"]);
assert.deepEqual(formulaParts("C3*D4").map((p) => p.ref || p.text), ["C3", "*", "D4"]);

// a SECI RTC-TM bid: solar, wind and battery with the time-block floors
const s = defaultBidState();
s.bid = { baseMw: 300, greenshoe: false };
s.sources = { solar: true, wind: true, hydro: false, biomass: false, thermal: false, bess: true };
s.src.solar = { capacity: { mode: "optimise", mw: 2000 }, cuf: 0.25, dcAc: 1.4, degradation: 0.005, capex: 4, om: 4 };
s.src.wind = { capacity: { mode: "optimise", mw: 1000 }, cuf: 0.33, capex: 6.5, om: 9 };
s.src.bess = { capacity: { mode: "optimise", mw: 600 }, duration: "4", rte: 0.87, minSoc: 0.05, maxSoc: 0.95, degradation: 0.02, augmentation: "annual", capex: 1.2, om: 1.2 };
s.costs = { preopPct: 0.05, evacuationCr: 120 };
const rules = [{ id: "peak", basis: "block", hours: "peak", target: 0.9, penaltyMultiple: 1.5 }, { id: "offpeak", basis: "block", hours: "offpeak", target: 0.7, penaltyMultiple: 1.5 }];
const m = modelInputs(s, { years: 25, sale: "allowed", rules });
const sizes = { solarMw: 785, windMw: 439, bessMw: 634, bessMwh: 2538 };
const lifetime = Array.from({ length: 25 }, (_, i) => ({ year: i + 1, demandMwh: 300 * 8760, deliveredMwh: 0.89 * 300 * 8760, exportMwh: 0, blockShortfallMwh: 9000 + 300 * i }));
const lp = { sizes, tariff: 7, perYear: [{ year: 1, minMonthlyDfr: 0.8 }], lifetime };
const ops = opsFromLp(lp, m.fin, m.bess);
const finance = E.runFinancialModel(null, sizes, { costs: m.costs, fin: m.fin, bess: m.bess, dfrTarget: 0.85, tariffLocked: false, ops, solveBy: "npv" });
const live = liveModelRequest({ state: s, lp, finance, costs: m.costs, fin: m.fin, bess: m.bess, ops, dfrTarget: 0.85 });
const t0 = Date.now();
const model = traceModel(live);
const ms = Date.now() - t0;
assert.ok(model, "a model");
assert.equal(model.N, 25);

// every reference of every formula is a cell of the grid
const missing = [];
for (const c of Object.values(model.cells)) for (const a of c.refs) if (!model.cells[a]) missing.push(`${c.addr} → ${a}`);
assert.deepEqual(missing.slice(0, 5), [], "formula references resolve");

// precedents and dependents mirror each other
for (const c of Object.values(model.cells)) for (const a of c.refs) assert.ok(model.cells[a].usedBy.includes(c.addr));

// the key results carry the app's numbers and trace back to inputs and the optimiser's energy
const eq = model.cells[model.keys.equityIrr];
assert.ok(eq.formula, "equity IRR is a formula");
assert.ok(Math.abs(eq.value - finance.equityIrr) < 1e-6, `equity IRR ${eq.value} vs app ${finance.equityIrr}`);
assert.ok(Math.abs(model.cells[model.keys.tariff].value - finance.tariff) < 1e-9);
const ins = inputsOf(model, model.keys.equityIrr);
const kinds = new Set(ins.map((a) => model.cells[a].kind));
assert.ok(kinds.has("input") && kinds.has("opt"), [...kinds].join(","));
const names = ins.map((a) => cellName(model, a));
for (const want of ["Solar", "Debt share", "Interest rate", "Corporate tax", "Delivered to the procurer · Year 1"]) {
  assert.ok(names.some((n) => n.startsWith(want)), `equity IRR rests on ${want}`);
}
// inputs carry where they came from; year cells carry their year
const capex = Object.values(model.cells).find((c) => c.kind === "input" && c.label === "Solar" && c.unit === "₹ cr/MW");
assert.ok(capex && capex.source, "an input's source");
const ppa = Object.values(model.cells).find((c) => c.label === "PPA supply revenue" && c.column === "Year 3");
assert.ok(ppa && /\/10$/.test(ppa.formula) && ppa.refs.length === 2, ppa?.formula);
// sections for the grid
assert.ok(model.rows.filter((r) => r.section).map((r) => r.label).includes("Revenue"));
console.log(`Trace checks passed (${Object.keys(model.cells).length} cells, ${ins.length} inputs under the equity IRR, built in ${ms} ms)`);
