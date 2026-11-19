// Tender to Bid: the request for the workbook's Live model sheet (web/lib/liveModel.js), which
// rebuilds the financial model as Excel formulas. Kept apart from exportModel.js so the check
// (tools/check_live_model.mjs) can build it in Node.
import { FINANCE_FIELDS, SOURCES, SOURCE_FIELDS, dispatchFor, lossFactorsOf, resourceProfiles } from "./model.js";
import { cufPoint, genSource } from "../model/generation.js";
import { LIVE_BESS_KEYS, LIVE_COST_KEYS, LIVE_FIN_KEYS, liveResults } from "../rtc/exportModel.js";
import { DEFAULT_FINANCE } from "../rtc/engine.js";

/**
 * What the Live model sheet (web/lib/liveModel.js) needs to rebuild the financial model as Excel
 * formulas: the inputs, the optimiser's energy by year and the app's results to compare with.
 */
export function liveModelRequest({ state, lp, finance, costs, fin, bess, ops, dfrTarget, sourceOf = () => "Your input", labels = null }) {
  const n = finance.rows.length;
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
  const sources = {};
  for (const s of SOURCES) for (const f of SOURCE_FIELDS[s.id]) sources[`${s.id}.${f.key}`] = sourceOf(`${s.id}.${f.key}`);
  for (const f of FINANCE_FIELDS) sources[`${f.section}.${f.key}`] = sourceOf(`${f.section}.${f.key}`);
  sources["market.sell"] = sourceOf("market.sell");
  // the other financing inputs (refinancing, grace, reserves, …): the bidder's when changed from the model's default
  for (const [k, v] of Object.entries(state.fin || {})) {
    const key = `fin.${k}`;
    if (key in sources || v === null || typeof v === "object") continue;
    if (k in DEFAULT_FINANCE && v !== DEFAULT_FINANCE[k]) sources[key] = "Your input";
  }
  // the generation build-up: the profiles the sizing dispatched, at the bidder's CUF, and their losses to the 33 kV bus
  const prof = resourceProfiles(state);
  const lf = lossFactorsOf(state);
  const l = state.losses;
  const profileName = (up, kind) => (up?.name ? `Uploaded ${kind} profile ${up.name}` : `Typical ${kind} profile`);
  const gen = {
    solar: state.sources.solar ? genSource({ cf: prof.solarCf, toBus: 1 - lf.solar, degradation: fin.solarDegradation, cufAt: cufPoint("solar", l ? l.solarFileAt : undefined), profile: profileName(state.solarUpload, "solar") }) : null,
    wind: state.sources.wind ? genSource({ cf: prof.windCf, toBus: 1 - lf.wind, degradation: fin.windDegradation, cufAt: cufPoint("wind", l ? l.windFileAt : undefined), profile: profileName(state.windUpload, "wind") }) : null,
  };
  return {
    tariff: finance.tariff,
    tariffLocked: finance.tariffLocked,
    dfrTarget: dfrTarget || 0,
    split: Boolean(lp.sites?.split),
    market: lp.market || null,
    on: Object.fromEntries(SOURCES.map((s) => [s.id, Boolean(state.sources[s.id])])),
    sizes: pick(lp.sizes, ["solarMw", "windMw", "bessMw", "bessMwh", "biomassMw", "hydroMw", "thermalMw"]),
    costs: {
      ...pick(costs, [...LIVE_COST_KEYS, "otherCapexCr"]), // otherCapexCr: a tender's charges on the plant (SECI-FDRE-X)
      plants: (costs.plants || []).map((p) => pick(p, ["id", "capexCrPerMw", "fixedLakhPerMw", "energyRsPerKwh", "recRsPerKwh", "escalation"])),
    },
    fin: pick(fin, LIVE_FIN_KEYS),
    bess: pick(bess, LIVE_BESS_KEYS),
    ops: ops.slice(0, n).map((o) => pick(o, ["demandMWh", "deliveredMWh", "excessMWh", "surplusRevenueCr", "buyerExcessMWh", "buyerExcessShare", "biomassMWh", "hydroMWh", "thermalMWh", "blockShortfallMWh", "dsmChargeCr", "dsmA", "dsmB", "solarGenMWh", "windGenMWh", "chargingCostCr", "pxFeesCr"])),
    gen,
    dispatch: dispatchFor(lp), // the modelled years hour by hour: the workbook's dispatch sheets
    sources,
    app: liveResults(finance, fin),
    ...(labels ? { labels } : {}), // a tender's names for rows (SECI-FDRE-X: the power bought, the PSM discount)
    ...(labels?.otherCapex ? { otherCapexLabel: labels.otherCapex } : {}),
  };
}
