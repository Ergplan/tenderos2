// The strike-price levers of a CfD bid (the What-if step): for every input the bidder can move on
// bid day, the strike price the target equity IRR needs with that input one step up and one step
// down (everything else as in the case), the slope per unit, and how far that input alone would
// have to move to reach the price the bidder wants to quote (secant from the slope). Inputs that
// change the day-by-day operation are re-simulated (web/src/cfd/model.js); the rest only re-price
// the same operation through the shared engine (./finance.js). Plain JavaScript, checked in Node
// by tools/check_cfd_finance.mjs.
import { FIELDS, runModel } from "./model.js";
import { runCfdFinance } from "./finance.js";

/** The inputs whose change alters the operation (the rest only re-price it). */
const OPERATION_KEYS = new Set(["contractedMw", "essMwhPerMw", "essMwPerMw", "solarMw", "windMw", "reCodMonths", "availability", "solarCuf", "solarDegradation", "windCuf", "rte", "essDegradation", "marketCharges", "groupPrice", "groupCharges", "priceEscalation", "gdamShareCap", "extraEssMwhPerMw", "solarDcAc", "windDegradation", "essSocMin", "essSocMax"]);
/** Inputs that are not levers (fixed by the tender, or a choice rather than a number). */
// not levers: the GST rate (the law) and the bid size (it carries the whole plant with it and barely
// moves the price; the bidder chooses it on the Bid inputs step, not as a way to a quote)
const NOT_LEVERS = new Set(["gstRate", "contractedMw"]);

/** The lever of a FIELDS entry: its key, label, unit, step, range and whether it re-simulates. */
export function leversOf(state, model) {
  const i = model?.inputs || state.inputs;
  const out = [];
  for (const f of FIELDS) {
    if (NOT_LEVERS.has(f.key)) continue;
    const v = i[f.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (f.key === "windMw" && !(v > 0)) continue; // no wind: its levers cannot move
    if ((f.key === "windCuf" || f.key === "windCrPerMw" || f.key === "windOmLakhPerMw") && !(i.windMw > 0)) continue;
    if ((f.key === "groupPrice" || f.key === "groupCharges") && !i.useGroup) continue;
    if (f.key === "recPrice" && !(i.sellMarket === "DAM" || i.sellMarket === "RTM")) continue;
    const step = f.pct ? (f.step || 1) / 100 : f.step || 1;
    const min = f.pct ? (f.min ?? 0) / 100 : f.min ?? 0;
    const max = f.pct ? (f.max ?? 100) / 100 : f.max ?? Infinity;
    out.push({ key: f.key, label: f.label, unit: f.pct ? "%" : f.unit, pct: Boolean(f.pct), step: f.key === "contractedMw" ? 10 : f.key === "solarMw" || f.key === "windMw" ? Math.max(5, Math.round(i.contractedMw * 0.1)) : step, min, max, int: f.key === "contractedMw" || f.key === "tenorYears" || f.key === "reCodMonths", operation: OPERATION_KEYS.has(f.key), value: v });
  }
  // the Finance team's terms that move the price without changing the operation
  const fin = state.fin || {};
  out.push({ key: "fin.receivableDays", label: "Receivable days", unit: "days", pct: false, step: 15, min: 0, max: 180, int: true, operation: false, value: fin.receivableDays ?? 45 });
  out.push({ key: "fin.graceYears", label: "Principal moratorium", unit: "years", pct: false, step: 1, min: 0, max: 5, int: true, operation: false, value: fin.graceYears ?? 0 });
  return out;
}

/** The case with a lever at a value: the input (or the finance term) set, its benchmark mark cleared. */
export function withCfdLever(state, lever, value) {
  let v = value;
  v = Math.max(lever.min, Math.min(lever.max, v));
  if (lever.int) v = Math.round(v);
  if (lever.key.startsWith("fin.")) return { ...state, fin: { ...(state.fin || {}), [lever.key.slice(4)]: v } };
  const filled = { ...(state.filled || {}) };
  delete filled[lever.key];
  const inputs = { ...state.inputs, [lever.key]: v };
  // the bid size carries the plant with it: own solar and wind scale with the contracted MW (unless
  // locked or frozen), so the move is the size of the bid, not a change of the mix behind it
  if (lever.key === "contractedMw" && Number.isFinite(state.inputs?.contractedMw) && state.inputs.contractedMw > 0) {
    const f = v / state.inputs.contractedMw;
    for (const key of ["solarMw", "windMw"]) {
      if (Number.isFinite(state.inputs[key]) && state.inputs[key] > 0 && !state.locks?.[key] && !state.frozen?.[key]) inputs[key] = Math.round(state.inputs[key] * f);
    }
  }
  return { ...state, inputs, filled };
}

/** The strike price the target equity IRR needs for a case (re-simulated when the lever changes the operation). */
export function priceOf(state, model, prices, { operation = false } = {}) {
  const m = operation ? runModel(state, prices) : { ...model, inputs: { ...model.inputs, ...numericInputs(state.inputs) } };
  if (!m || !m.sim) return NaN;
  return runCfdFinance({ ...state, tariffLocked: false }, m).tariff;
}
const numericInputs = (inputs) => Object.fromEntries(Object.entries(inputs).filter(([, v]) => typeof v === "number" || typeof v === "boolean" || typeof v === "string"));

/**
 * Every lever's effect, one at a time: { base, levers: [{ key, label, unit, pct, value, step, priceUp,
 * priceDown, slope, perStep, reach, reachable, operation }] }, the biggest movers first. Calls
 * onProgress(done, total) and awaits a tick between levers so the screen stays live; `signal`
 * aborts.
 */
export async function cfdLeverEffects(state, model, prices, { target = null, onProgress = null, signal = null, tick = () => new Promise((r) => { setTimeout(r, 0); }) } = {}) {
  const levers = leversOf(state, model);
  const base = runCfdFinance({ ...state, tariffLocked: false }, model).tariff;
  const out = [];
  let done = 0;
  for (const lever of levers) {
    if (signal?.aborted) throw new Error("Stopped.");
    const up = withCfdLever(state, lever, lever.value + lever.step);
    const down = withCfdLever(state, lever, lever.value - lever.step);
    const vUp = lever.key.startsWith("fin.") ? up.fin[lever.key.slice(4)] : up.inputs[lever.key];
    const vDown = lever.key.startsWith("fin.") ? down.fin[lever.key.slice(4)] : down.inputs[lever.key];
    done += 1;
    if (vUp === vDown) { onProgress?.(done, levers.length); continue; }
    const pUp = priceOf(up, model, prices, { operation: lever.operation });
    const pDown = priceOf(down, model, prices, { operation: lever.operation });
    onProgress?.(done, levers.length);
    await tick();
    const slope = (pUp - pDown) / (vUp - vDown);
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-9) continue;
    const perStep = slope * lever.step;
    const reach = target != null ? lever.value + (target - base) / slope : null;
    const reachable = reach != null && reach >= lever.min - 1e-12 && reach <= lever.max + 1e-12;
    out.push({ ...lever, priceUp: pUp, priceDown: pDown, slope, perStep, reach, reachable });
  }
  out.sort((a, b) => Math.abs(b.perStep) - Math.abs(a.perStep));
  return { base, levers: out };
}
