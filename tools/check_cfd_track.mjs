// The track to a quote (web/src/cfd/track.js): the greedy plan over the lever effects and the
// plausibility bands, priced for real step by step; a reachable target and an impossible one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultCfdState, fillBenchmarks, runModel } from "../web/src/cfd/model.js";
import { runCfdFinance } from "../web/src/cfd/finance.js";
import { cfdLeverEffects, leversOf } from "../web/src/cfd/levers.js";
import { leverChance } from "../web/src/cfd/leverNotes.js";
import { planTrack } from "../web/src/cfd/track.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const state = fillBenchmarks(defaultCfdState());
state.inputs.contractedMw = 100;
state.inputs.effectiveDate = state.inputs.effectiveDate || "2026-12-01";
state.inputs.solarMw = 30;
const pricer = (inputs, sim) => runCfdFinance({ ...state, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
const model = runModel(state, prices, { price: pricer });

// the chance function
const levers = leversOf(state, model);
const capex = levers.find((l) => l.key === "essCrPerMwh");
assert.equal(leverChance(capex, capex.value, state.inputs).p, 1, "no move: sure");
const c85 = leverChance(capex, 0.85, state.inputs);
assert.ok(c85.p === 1 && c85.edges.dir === -1 && c85.edges.likely === 0.6 && c85.edges.stretch === 0.5, "down to the sure edge is sure; the edges read from the bands");
assert.ok(Math.abs(leverChance(capex, 0.6, state.inputs).p - 0.5) < 1e-9, "the likely edge is 50%");
assert.ok(Math.abs(leverChance(capex, 0.5, state.inputs).p - 0.1) < 1e-9, "the stretch edge is 10%");
assert.equal(leverChance(capex, 0.3, state.inputs).p, 0, "one stretch-width beyond: zero");
const tax = levers.find((l) => l.key === "taxRate");
assert.ok(leverChance(tax, tax.value - 0.01, state.inputs).fixed && leverChance(tax, tax.value - 0.01, state.inputs).p === 0, "the tax rate is not a lever");
const sol = levers.find((l) => l.key === "solarMw");
assert.equal(leverChance(sol, 150, state.inputs).p, 1, "solar up to 1.5× the contracted MW is sure");

// the lever effects (the full model, every lever)
const t0 = Date.now();
const effects = await cfdLeverEffects(state, model, prices, { target: null, tick: async () => {} });
console.log(`lever effects: ${effects.levers.length} levers, base ₹${effects.base.toFixed(3)}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// a reachable quote: a few likely moves
const target = Number((effects.base - 0.4).toFixed(2));
const track = await planTrack({ state, model, prices, effects, target, tick: async () => {} });
assert.ok(track.reached, `₹${target} is reached (final ₹${track.final?.toFixed(3)})`);
assert.ok(track.steps.length >= 1 && track.steps.length <= 12, `a handful of moves (${track.steps.length})`);
for (let k = 1; k < track.steps.length; k += 1) assert.ok(track.steps[k].p <= track.steps[k - 1].p + 1e-12, "surest moves first");
assert.ok(track.chance > 0 && track.chance <= 1 && Math.abs(track.chance - track.steps.reduce((a, s) => a * s.p, 1)) < 1e-9, "the chance is the product of the moves' chances");
assert.ok(track.steps.every((s) => Number.isFinite(s.price) && s.cum > 0 && s.who), "every move priced for real, with who decides it");
assert.ok(track.steps[track.steps.length - 1].price <= target + 0.005, "the last move lands on the quote");
console.log(`track to ₹${target}: ` + track.steps.map((s) => `${s.label} ${s.from}→${s.to} (${Math.round(s.p * 100)}%) ₹${s.price.toFixed(3)}`).join("; ") + ` · chance ${(track.chance * 100).toFixed(1)}%`);

// an impossible quote
const nope = await planTrack({ state, model, prices, effects, target: 1, tick: async () => {} });
assert.ok(!nope.reached && nope.chance === 0 && nope.floor > 1, `₹1 is out of reach: floor ₹${nope.floor?.toFixed(3)}, chance 0`);
assert.ok(nope.floorLevers.length >= 5 && nope.steps.some((s) => s.p === 0 || s.p < 0.1), "the floor pushes many levers to the end of their chance");
console.log(`₹1/kWh: out of reach; every lever at the end of its chance gives ₹${nope.floor.toFixed(3)} (${nope.floorLevers.length} levers)`);

// above the model's price: nothing to do
const above = await planTrack({ state, model, prices, effects, target: effects.base + 1, tick: async () => {} });
assert.ok(above.above && above.reached && above.steps.length === 0, "a quote above the model's price needs no move");
console.log("CfD track checks passed");
