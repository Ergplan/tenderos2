// The tariff surface the FDRE-X Bid tab draws while HiGHS sizes the plant (the optimizer theatre of
// the Round-the-Clock tab, ../rtc/Theatre.jsx): for each mix of solar and wind on a grid, the tariff
// the target equity IRR needs with the best of a few storage sizes, from the instant What-if
// dispatch (../whatif/model.js, a rule-based dispatch of every PPA year and the full financial
// model). It is a picture of the design space while the LP solves; the bid's numbers come from
// HiGHS and the Financial model, not from it. Plain JavaScript, used by surface.worker.js and
// checked in Node by tools/check_fdrex_bid.mjs.
import { runWhatIf, whatIfFromBid } from "../whatif/model.js";
import { fdrexTerms } from "./bidTerms.js";

const CAP = 20; // ₹/kWh: a mix that needs more is drawn on the plateau, as not worth bidding

const sizeOf = (state, id) => (state.src?.[id]?.capacity?.mode === "fixed" ? Number(state.src[id].capacity.mw) || 0 : null);

/**
 * The grid: solar 0–1.2 × the contracted MW in 7 steps, wind 0–1.75 × in 8, storage 0.7, 0.85 and
 * 1.0 × at the bid's hours (4 when the optimizer chooses them); a size the bidder fixed, or a source
 * switched off, is one point.
 */
export function surfaceAxes(state) {
  const mw = state.bid?.baseMw || 100;
  const grid = (id, top, n) => {
    if (!state.sources?.[id]) return [0];
    const fixed = sizeOf(state, id);
    if (fixed !== null) return [fixed];
    return Array.from({ length: n }, (_, i) => Math.round((top * mw * i) / (n - 1)));
  };
  const hours = Number(state.src?.bess?.duration) || 4;
  const fixedBess = sizeOf(state, "bess");
  return {
    solarGrid: grid("solar", 1.2, 7),
    windGrid: grid("wind", 1.75, 8),
    bessOptions: fixedBess !== null ? [fixedBess] : [0.7, 0.85, 1].map((k) => Math.round(k * mw)),
    bessHours: hours,
    xLabel: "SOLAR  MWac",
    yLabel: "WIND  MW",
    zUnit: "₹/kWh",
    missLabel: `above ₹${CAP}`,
  };
}

/** The What-if case every cell starts from: the bid as entered, with no plant yet. */
export function surfaceSeed(state, prices) {
  const terms = fdrexTerms(state.fdrex, prices);
  return whatIfFromBid({ ...state, lp: { sizes: { solarMw: 0, windMw: 0, bessMw: 0, bessMwh: 0 }, tariff: 9 } }, terms);
}

/** One cell: the cheapest storage of the options at this solar and wind, as the theatre draws it. */
export function surfaceCell(seed, axes, si, wi, prices) {
  let best = null;
  for (const bessMw of axes.bessOptions) {
    const r = runWhatIf({ ...seed, solarMwac: axes.solarGrid[si], windMw: axes.windGrid[wi], bessMw, bessHours: axes.bessHours }, { prices });
    const z = r.finance.tariffNeeded;
    if (!best || z < best.z) best = { z, verdict: r.verdict, bessMw };
  }
  const sizes = { solarMw: axes.solarGrid[si], windMw: axes.windGrid[wi], bessMw: best.bessMw, bessMwh: best.bessMw * axes.bessHours };
  const feasible = Number.isFinite(best.z) && best.z < CAP && best.verdict !== "fail";
  return { si, wi, sizes, z: feasible ? best.z : null, tariff: best.z, feasible };
}
