// The track to the price the bidder wants to quote (the What-if step): which levers to turn, how far,
// in what order, and the chance of each move happening, from the lever effects (levers.js) and the
// plausibility bands (leverNotes.js). A greedy plan: at every turn, the lever whose next step buys the
// most price per unit of chance given up is moved one step, until the gap is closed or no lever can
// move further; the moves are then merged per lever, ordered from the surest to the least likely, and
// priced for real one after another through the full model, so the story shows the true price after
// each move. The chance of the whole track is the product of the moves' chances (treated as
// independent). A target below what every lever at its limit can give is reported as out of reach,
// with the floor price and a chance of zero.
import { priceOf, withCfdLever } from "./levers.js";
import { LEVER_NOTES, leverChance } from "./leverNotes.js";

const noteOf = (key) => LEVER_NOTES[key] || LEVER_NOTES[key.replace(/^fin\./, "")] || null;

/** The value of a lever after a move of `n` steps toward the target, clipped to its range (integers kept whole). */
function moved(lever, n, dir) {
  let v = lever.value + dir * n * lever.step;
  v = Math.max(lever.min, Math.min(lever.max, v));
  if (lever.int) v = Math.round(v);
  return v;
}

/**
 * Plan the track. `effects` is the result of cfdLeverEffects; `target` the quote in ₹/kWh.
 * Returns { base, target, gap, above, reached, chance, floor, steps: [{ key, label, unit, pct, step,
 * from, to, dir, p, cum, price, drop, edges, who, why, operation }], floorLevers, tried }.
 * onProgress(done, total) between the real pricings; `signal` aborts.
 */
export async function planTrack({ state, model, prices, effects, target, onProgress = null, signal = null, tick = () => new Promise((r) => { setTimeout(r, 0); }) }) {
  const base = effects.base;
  const frozen = state.frozen || {}; // levers the bidder has frozen (with evidence): kept as they are
  const rejected = state.rejected || {}; // levers the bidder has turned down: the plan looks elsewhere
  const inputs = model?.inputs || state.inputs;
  const gap = base - target;
  const frozenKeys = Object.keys(frozen);
  const rejectedKeys = Object.keys(rejected);
  if (!(gap > 1e-6)) return { base, target, gap, above: true, reached: true, chance: 1, floor: null, steps: [], floorLevers: [], tried: 0, frozenKeys, rejectedKeys };

  // the candidates: levers that lower the price when moved, with their helpful direction. The
  // one-step price in each direction decides (not the secant): a lever sitting at its best value,
  // where both directions raise the price, is no candidate
  const cands = [];
  for (const lever of effects.levers) {
    if (frozen[lever.key] || rejected[lever.key]) continue;
    const gainUp = base - lever.priceUp;
    const gainDown = base - lever.priceDown;
    if (!(gainUp > 1e-6) && !(gainDown > 1e-6)) continue;
    const dir = gainUp >= gainDown ? 1 : -1;
    const rate = (dir > 0 ? gainUp : gainDown) / lever.step; // ₹/kWh per unit, in the helpful direction
    const lim = dir > 0 ? lever.max : lever.min;
    if (Math.abs(lim - lever.value) < 1e-12) continue;
    const first = leverChance(lever, moved(lever, 1, dir), inputs);
    if (first.fixed) continue; // not the bidder's to choose
    cands.push({ lever: { ...lever, slope: -dir * rate }, dir, n: 0, v: lever.value, p: 1, gain: 0 });
  }

  // the greedy plan on the slopes
  const planFor = (need) => {
    let got = cands.reduce((a, c) => a + c.gain, 0);
    let guard = 0;
    while (got < need - 1e-9 && guard < 2000) {
      guard += 1;
      let best = null;
      for (const c of cands) {
        if (c.dead) continue;
        const v2 = moved(c.lever, c.n + 1, c.dir);
        if (Math.abs(v2 - c.v) < 1e-12) continue; // at its limit
        const p2 = leverChance(c.lever, v2, inputs).p;
        if (p2 < 0.01) continue; // below a one-in-a-hundred chance the plan stops; the floor says what lies beyond
        const gain = Math.abs(c.lever.slope) * Math.abs(v2 - c.v);
        if (gain <= 1e-12) continue;
        // the chance given up by this step, per rupee gained
        const cost = Math.log(c.p / p2);
        const ratio = cost / gain;
        if (!best || ratio < best.ratio - 1e-12 || (Math.abs(ratio - best.ratio) < 1e-12 && gain > best.gain)) best = { c, v2, p2, gain, ratio };
      }
      if (!best) break;
      best.c.n += 1; best.c.v = best.v2; best.c.p = best.p2; best.c.gain += best.gain;
      got += best.gain;
    }
    return got;
  };
  planFor(gap);

  // the steps, surest first; then the real price after each, one after another
  const build = () => cands.filter((c) => c.n > 0).map((c) => {
    const chance = leverChance(c.lever, c.v, inputs);
    return { key: c.lever.key, label: c.lever.label, unit: c.lever.unit, pct: c.lever.pct, step: c.lever.step, int: c.lever.int, from: c.lever.value, to: c.v, dir: c.dir, p: chance.p, edges: chance.edges, who: chance.who, why: noteOf(c.lever.key)?.why || "", operation: c.lever.operation, lever: c.lever, estGain: c.gain };
  }).sort((a, b) => b.p - a.p || b.estGain - a.estGain);

  const priceSteps = async (steps) => {
    let s = state;
    let prev = base;
    let cum = 1;
    let anyOp = false;
    for (let k = 0; k < steps.length; k += 1) {
      if (signal?.aborted) throw new Error("Stopped.");
      const st = steps[k];
      s = withCfdLever(s, st.lever, st.to);
      anyOp = anyOp || st.operation;
      const price = priceOf(s, model, prices, { operation: anyOp });
      cum *= st.p;
      st.price = price;
      st.drop = prev - price;
      st.cum = cum;
      prev = price;
      onProgress?.(k + 1, steps.length + 1);
      await tick();
    }
    return { final: steps.length ? steps[steps.length - 1].price : base, cum, s };
  };

  let steps = build();
  let { final, cum } = await priceSteps(steps);
  let tried = 1;
  // a move that made the real price worse (the slope lied past the bid's value) is withdrawn
  const bad = steps.filter((st) => st.drop < -0.001);
  if (bad.length) {
    for (const st of bad) { const c = cands.find((x) => x.lever.key === st.key); if (c) { c.n = 0; c.v = c.lever.value; c.p = 1; c.gain = 0; c.dead = true; } }
    steps = build();
    ({ final, cum } = await priceSteps(steps));
  }
  // the slopes are straight lines: if the real price is still short, plan the residual once more
  for (let pass = 0; pass < 2 && final > target + 0.005; pass += 1) {
    const before = cands.reduce((a, c) => a + c.gain, 0);
    planFor(before + (final - target) * 1.1);
    const again = build();
    if (again.every((st, k) => steps[k] && Math.abs(st.to - steps[k].to) < 1e-12) && again.length === steps.length) break;
    steps = again;
    ({ final, cum } = await priceSteps(steps));
    tried += 1;
  }

  // the floor: every helpful lever at the end of its chance (one stretch-width beyond the stretch edge, or its limit)
  let floor = null;
  const floorLevers = [];
  if (final > target + 0.005) {
    let s = state;
    let anyOp = false;
    for (const c of cands) {
      if (c.dead) continue;
      let n = c.n;
      let v = c.v;
      let guard = 0;
      while (guard < 5000) {
        guard += 1;
        const v2 = moved(c.lever, n + 1, c.dir);
        if (Math.abs(v2 - v) < 1e-12) break;
        if (leverChance(c.lever, v2, inputs).p <= 0) break;
        n += 1; v = v2;
      }
      if (Math.abs(v - c.lever.value) > 1e-12) {
        s = withCfdLever(s, c.lever, v);
        anyOp = anyOp || c.lever.operation;
        floorLevers.push({ key: c.lever.key, label: c.lever.label, unit: c.lever.unit, pct: c.lever.pct, step: c.lever.step, from: c.lever.value, to: v });
      }
    }
    floor = priceOf(s, model, prices, { operation: anyOp });
    onProgress?.(steps.length + 1, steps.length + 1);
  }
  const reached = final <= target + 0.005;
  return { base, target, gap, above: false, reached, chance: reached ? cum : 0, floor, steps: steps.map(({ lever, ...rest }) => rest), floorLevers, tried, final, frozenKeys, rejectedKeys };
}
