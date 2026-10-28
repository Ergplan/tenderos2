// Tender to Bid: the request for the workbook's Live model sheet (web/lib/liveModel.js), which
// rebuilds the financial model as Excel formulas. Kept apart from exportModel.js so the check
// (tools/check_live_model.mjs) can build it in Node.
import { FINANCE_FIELDS, SOURCES, SOURCE_FIELDS, lossFactorsOf, resourceProfiles } from "./model.js";
import { cufPoint, genSource } from "../model/generation.js";
import { LIVE_FIN_KEYS, liveResults } from "../rtc/exportModel.js";

/**
 * What the Live model sheet (web/lib/liveModel.js) needs to rebuild the financial model as Excel
 * formulas: the inputs, the optimiser's energy by year and the app's results to compare with.
 */
export function liveModelRequest({ state, lp, finance, costs, fin, bess, ops, dfrTarget, sourceOf = () => "Your input" }) {
  const n = finance.rows.length;
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
  const sources = {};
  for (const s of SOURCES) for (const f of SOURCE_FIELDS[s.id]) sources[`${s.id}.${f.key}`] = sourceOf(`${s.id}.${f.key}`);
  for (const f of FINANCE_FIELDS) sources[`${f.section}.${f.key}`] = sourceOf(`${f.section}.${f.key}`);
  sources["market.sell"] = sourceOf("market.sell");
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
      ...pick(costs, ["solarCrPerMw", "windCrPerMw", "bessCrPerMwh", "bessPcsCrPerMw", "biomassCrPerMw", "evacuationCr", "preopPct"]),
      plants: (costs.plants || []).map((p) => pick(p, ["id", "capexCrPerMw", "fixedLakhPerMw", "energyRsPerKwh", "recRsPerKwh", "escalation"])),
    },
    fin: pick(fin, LIVE_FIN_KEYS),
    bess: pick(bess, ["annualDegradation", "augmentation", "augmentationYear", "costDeclinePct"]),
    ops: ops.slice(0, n).map((o) => pick(o, ["demandMWh", "deliveredMWh", "excessMWh", "surplusRevenueCr", "biomassMWh", "hydroMWh", "thermalMWh", "blockShortfallMWh"])),
    gen,
    sources,
    app: liveResults(finance, fin),
  };
}
