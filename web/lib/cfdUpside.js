// The Upside of a CfD bid on the server (POST /api/cfd/upside, and the tools of the bid analyst,
// web/lib/cfdAgent.js): the sweep of additions, one plan priced, a plan stressed, the bid lowered
// instead. The cases are web/src/cfd/upside.js on the saved bid state and the IEX price year the
// tab loads, so the numbers equal the Upside step's on screen.
import { mergeCfdState, missingInputs } from "../src/cfd/model.js";
import { caseSummary, cleanPlan, evaluatePlan, middayPath, strikeWithSolar, sweepSummary, upsideContext, upsideSettings, upsideSweep } from "../src/cfd/upside.js";
import { marketPrices } from "./cfdDispatch.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** The saved bid state merged over the defaults, or a 400 when it is not complete. */
export function bidState(stateIn) {
  const state = mergeCfdState(stateIn && typeof stateIn === "object" ? { version: 1, ...stateIn } : null);
  const missing = missingInputs(state);
  if (missing.length) throw fail(400, `The bid is not complete: ${missing.slice(0, 4).join("; ")}${missing.length > 4 ? "…" : ""}.`);
  return state;
}

/** The context every case shares, or a 400 when the bid cannot be priced. */
export function upsideContextOf(stateIn, settings = {}) {
  const ctx = upsideContext(bidState(stateIn), marketPrices(), settings);
  if (!ctx) throw fail(400, "The bid could not be modelled.");
  return ctx;
}

/** The whole sweep as plain data. */
export async function runUpsideSweep(stateIn, settings = {}) {
  const out = await upsideSweep(bidState(stateIn), marketPrices(), settings, { pause: () => new Promise((r) => { setImmediate(r); }) });
  if (!out) throw fail(400, "The bid could not be modelled.");
  return sweepSummary(out);
}

/**
 * One plan priced: { plan: { solarMw, battery: [{ year, mwh }] }, stress: { dayInjection, middayPerYear, debtShare } }.
 * Returns the bid's own case, the plan's, and the strike price the plan's solar would need for the bid's target IRR.
 */
export function runUpsideCase(stateIn, settings = {}, plan = {}, stress = {}, { ctx = null, lowerBid = false } = {}) {
  const c = ctx || upsideContextOf(stateIn, settings);
  const p = cleanPlan(plan, c.years);
  if (p.solarMw > 20 * c.X) throw fail(400, "The solar addition is beyond 20 MWac per contracted MW.");
  if (p.battery.reduce((a, t) => a + t.mwh, 0) > 40 * c.X) throw fail(400, "The battery added is beyond 40 MWh per contracted MW.");
  const over = {};
  if (stress?.dayInjection === false || stress?.dayInjection === true) over.dayInjection = stress.dayInjection;
  if (isNum(stress?.middayPerYear) && stress.middayPerYear !== 0) over.pricePath = middayPath(c, Math.max(-0.3, Math.min(0.3, stress.middayPerYear)));
  if (isNum(stress?.debtShare)) over.debtShare = Math.max(0, Math.min(0.9, stress.debtShare));
  const out = evaluatePlan(c, p, over);
  const sp = lowerBid && p.solarMw > 0 ? strikeWithSolar(c, p.solarMw) : null;
  return {
    tariff: Number(c.tariff.toFixed(4)), targetIrr: c.targetIrr, settings: upsideSettings(c.settings), stress: over.pricePath ? { ...stress, pricePath: undefined } : stress,
    base: caseSummary(c.base), case: caseSummary(out),
    lowerBid: isNum(sp) ? { solarMw: p.solarMw, tariff: Number(sp.toFixed(4)), change: Number((sp - c.tariff).toFixed(4)) } : null,
  };
}
