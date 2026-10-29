// The tariff levers of a What-if case: for each input the bidder can move on bid day, how the
// tariff needed for the target equity IRR moves per unit of that input (its slope, from a run of
// the model either side of the case), and how far that input alone would have to move to reach a
// tariff the bidder wants to quote. Every number comes from runWhatIf; nothing is estimated.
import { runWhatIf } from "./model.js";

/** path: where the lever lives in the What-if state; step: the move tried each side; fmt: the unit for the screen. */
export const LEVERS = [
  { id: "solarCapex", label: "Solar capex", path: ["costs", "solarCrPerMwac"], step: 0.1, unit: "₹ cr/MWac", min: 0 },
  { id: "windCapex", label: "Wind capex", path: ["costs", "windCrPerMw"], step: 0.1, unit: "₹ cr/MW", min: 0 },
  { id: "bessCapex", label: "Battery capex", path: ["costs", "bessCrPerMwh"], step: 0.05, unit: "₹ cr/MWh", min: 0 },
  { id: "evac", label: "Evacuation cost", path: ["costs", "evacuationCr"], step: 10, unit: "₹ cr", min: 0 },
  { id: "preop", label: "Pre-operative cost", path: ["costs", "preopPct"], step: 0.01, unit: "% of hard cost", pct: true, min: 0 },
  { id: "construction", label: "Construction months", path: ["costs", "constructionMonths"], step: 3, unit: "months", min: 0, int: true },
  { id: "solarCuf", label: "Solar CUF", path: ["solarCuf"], step: 0.005, unit: "%", pct: true, min: 0.05 },
  { id: "windCuf", label: "Wind CUF", path: ["windCuf"], step: 0.005, unit: "%", pct: true, min: 0.1 },
  { id: "solarOm", label: "Solar O&M", path: ["om", "solarLakhPerMwac"], step: 0.5, unit: "₹ lakh/MWac/yr", min: 0 },
  { id: "windOm", label: "Wind O&M", path: ["om", "windLakhPerMw"], step: 0.5, unit: "₹ lakh/MW/yr", min: 0 },
  { id: "bessOm", label: "Battery O&M", path: ["om", "bessLakhPerMwh"], step: 0.2, unit: "₹ lakh/MWh/yr", min: 0 },
  { id: "omEsc", label: "O&M escalation", path: ["fin", "omEscalation"], step: 0.005, unit: "%/yr", pct: true, min: 0 },
  { id: "debt", label: "Debt share", path: ["fin", "debtFraction"], step: 0.05, unit: "%", pct: true, min: 0, max: 0.95 },
  { id: "rate", label: "Interest rate", path: ["fin", "interestRate"], step: 0.0025, unit: "%", pct: true, min: 0 },
  { id: "tenor", label: "Loan tenor", path: ["fin", "tenorYears"], step: 1, unit: "years", min: 1, max: 25, int: true },
  { id: "irr", label: "Target equity IRR", path: ["fin", "targetEquityIrr"], step: 0.005, unit: "%", pct: true, min: 0.01 },
  { id: "tax", label: "Corporate tax", path: ["fin", "taxRate"], step: 0.01, unit: "%", pct: true, min: 0 },
  { id: "insurance", label: "Insurance", path: ["fin", "insurancePct"], step: 0.0005, unit: "% of hard cost/yr", pct: true, min: 0 },
  { id: "recv", label: "Receivable days", path: ["fin", "receivableDays"], step: 15, unit: "days", min: 0, int: true },
  { id: "dsmSigma", label: "Forecast error (DSM)", path: ["dsm", "sigmaPct"], step: 0.01, unit: "% of the schedule", pct: true, min: 0, derive: (s) => s.dsm?.sigmaPct ?? null },
];

const getAt = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
const setAt = (obj, path, value) => {
  if (path.length === 1) return { ...obj, [path[0]]: value };
  return { ...obj, [path[0]]: setAt(obj[path[0]] || {}, path.slice(1), value) };
};

/** The lever's current value in the case (a derived default when it is unset). */
export function leverValue(state, lever) {
  const v = getAt(state, lever.path);
  if (v == null && lever.derive) return lever.derive(state);
  return v;
}

/** The case with one lever moved to a value. */
export function withLever(state, lever, value) {
  let v = value;
  if (lever.min != null) v = Math.max(lever.min, v);
  if (lever.max != null) v = Math.min(lever.max, v);
  if (lever.int) v = Math.round(v);
  return setAt(state, lever.path, v);
}

/**
 * Every lever's effect on the tariff needed for the target equity IRR: the tariff with the lever
 * one step up and one step down, the slope per unit, and (when a target tariff is given) the move
 * of that lever alone that reaches it, by secant from the slope.
 */
export function leverEffects(state, { prices = null, target = null, levers = LEVERS, base = null } = {}) {
  const run = (st) => runWhatIf(st, { prices }).finance.tariffNeeded;
  const t0 = base ?? run(state);
  const out = [];
  for (const lever of levers) {
    const v0 = leverValue(state, lever);
    if (v0 == null || !Number.isFinite(v0)) continue;
    // a lever that cannot move (no wind: wind capex) is left out
    const up = withLever(state, lever, v0 + lever.step);
    const down = withLever(state, lever, v0 - lever.step);
    const vUp = leverValue(up, lever);
    const vDown = leverValue(down, lever);
    if (vUp === vDown) continue;
    const tUp = run(up);
    const tDown = run(down);
    const slope = (tUp - tDown) / (vUp - vDown); // ₹/kWh per unit of the lever
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-9) continue;
    const perStep = slope * lever.step;
    const reach = target != null ? v0 + (target - t0) / slope : null;
    const reachable = reach != null && (lever.min == null || reach >= lever.min - 1e-12) && (lever.max == null || reach <= lever.max + 1e-12);
    out.push({ id: lever.id, label: lever.label, unit: lever.unit, pct: Boolean(lever.pct), value: v0, step: lever.step, tariffUp: tUp, tariffDown: tDown, slope, perStep, reach, reachable });
  }
  // the biggest movers first
  out.sort((a, b) => Math.abs(b.perStep) - Math.abs(a.perStep));
  return { base: t0, levers: out };
}
