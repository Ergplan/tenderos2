// The track to a quote (web/src/cfd/track.js): the greedy plan over the lever effects and the
// plausibility bands, priced for real step by step; a reachable target and an impossible one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultCfdState, fillBenchmarks, runModel } from "../web/src/cfd/model.js";
import { runCfdFinance } from "../web/src/cfd/finance.js";
import { cfdLeverEffects, leversOf, withCfdLever } from "../web/src/cfd/levers.js";
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
// ---- frozen levers: left alone by the track, the gap found elsewhere
{
  const { freezeLever, unfreezeLever } = await import("../web/src/cfd/Freeze.jsx").catch(() => ({}));
  const before = await planTrack({ state, model, prices, effects, target: Number((effects.base - 0.4).toFixed(2)), tick: async () => {} });
  const first = before.steps[0];
  const frozenState = { ...state, frozen: { [first.key]: { key: first.key, label: first.label, value: first.from, at: "2026-11-07T00:00:00Z", by: "test" } }, locks: { ...(state.locks || {}), [first.key]: true } };
  const after = await planTrack({ state: frozenState, model, prices, effects, target: Number((effects.base - 0.4).toFixed(2)), tick: async () => {} });
  assert.ok(!after.steps.some((s) => s.key === first.key), `the frozen lever ${first.key} is not moved`);
  assert.ok(after.reached && after.frozenKeys.length === 1, "the gap is found elsewhere; the frozen lever is reported");
  console.log(`frozen ${first.label}: the track now uses ${after.steps.map((s) => s.label).join(", ")} (chance ${(after.chance * 100).toFixed(0)}%)`);
  if (freezeLever) {
    const s2 = freezeLever(state, { key: "essCrPerMwh", label: "Battery capex (all-in)", unit: "₹ cr/MWh", step: 0.01 }, 0.8, { by: "test", note: "quote", evidence: null });
    assert.ok(s2.inputs.essCrPerMwh === 0.8 && s2.locks.essCrPerMwh && s2.frozen.essCrPerMwh.value === 0.8, "freezing writes the value, locks it and keeps the record");
    const s3 = unfreezeLever(s2, "essCrPerMwh");
    assert.ok(!s3.frozen.essCrPerMwh && !s3.locks.essCrPerMwh && s3.inputs.essCrPerMwh === 0.8, "unfreezing drops the record and the lock, the value stays");
  }
}

// ---- the bid size carries the plant: own solar and wind scale with the contracted MW, a locked
// or frozen one stays, so the lever is the size of the bid and not the mix behind it
{
  const s0 = { ...state, inputs: { ...state.inputs, contractedMw: 150, solarMw: 240, windMw: 30 } };
  const lever = { key: "contractedMw", min: 50, max: 150, int: true, value: 150 };
  const s1 = withCfdLever(s0, lever, 50);
  assert.equal(s1.inputs.contractedMw, 50);
  assert.equal(s1.inputs.solarMw, 80, "own solar scales with the bid");
  assert.equal(s1.inputs.windMw, 10, "own wind scales with the bid");
  const s2 = withCfdLever({ ...s0, locks: { solarMw: true } }, lever, 100);
  assert.equal(s2.inputs.solarMw, 240, "a locked solar size stays");
  assert.equal(s2.inputs.windMw, 20);
  const s3 = withCfdLever(s0, { key: "essMwhPerMw", min: 2, max: 3, value: 2 }, 2.5);
  assert.equal(s3.inputs.solarMw, 240, "other levers leave the plant alone");
}

// ---- a lever turned down is left out of the plan; the bid size is never a lever
{
  assert.ok(!leversOf(state, model).some((l) => l.key === "contractedMw"), "the bid size is not offered as a lever");
  const reachable = Number((effects.base - 0.4).toFixed(2));
  const plan = await planTrack({ state, model, prices, effects, target: reachable, tick: async () => {} });
  const firstKey = plan.steps[0].key;
  const s2 = { ...state, rejected: { [firstKey]: { key: firstKey, label: plan.steps[0].label, at: new Date().toISOString(), by: "test" } } };
  const plan2 = await planTrack({ state: s2, model, prices, effects, target: reachable, tick: async () => {} });
  assert.ok(!plan2.steps.some((st) => st.key === firstKey), "a turned-down lever is not moved");
  assert.deepEqual(plan2.rejectedKeys, [firstKey]);
  assert.ok(plan2.reached, "the gap is found through the other levers");
  console.log(`rejected ${plan.steps[0].label}: the track now uses ${plan2.steps.map((st) => st.label).join(", ")}`);
}
console.log("CfD track checks passed (frozen levers, the bid size carries the plant, turned-down levers)");
