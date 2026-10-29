// The deployment zone (docs/enterprise/ARCHITECTURE.md, section 1). TENDEROS_ZONE=intake runs the
// tender reading with cloud models (the DMZ); core runs the bid workspace with no cloud client
// (the client's network); anything else is "all": one installation with everything, as in the demos.
// Server-only: read process.env at call time, not in the browser bundle.
export const ZONE = process.env.TENDEROS_ZONE === "intake" ? "intake" : process.env.TENDEROS_ZONE === "core" ? "core" : "all";

// the engine paths that read tender documents with cloud models (LlamaParse, the LLM extraction):
// intake-zone work; the core zone refuses them and takes signed packages instead
const INTAKE_ENGINE = [/^bid\/tender\/read(-set)?$/, /^bid\/cerc-order$/, /^bess\/parse$/];
/** Whether the zone lets this engine path run (path: "bid/tender/read-set"). */
export function zoneAllowsEngine(path) {
  if (ZONE !== "core") return true;
  return !INTAKE_ENGINE.some((re) => re.test(path));
}
/** Whether the zone lets cloud voice / chat agents run. */
export const CLOUD_AGENTS = ZONE !== "core";
/** What the browser is told about the installation. */
export const zoneInfo = () => ({ zone: ZONE, version: process.env.TENDEROS_VERSION || "dev", cloud: CLOUD_AGENTS });
