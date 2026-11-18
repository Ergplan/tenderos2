// The FDRE-X Bid tab's state (FdrexBidTab.jsx): the Tender to Bid state with this tender, what a new
// bid starts from, a saved bid read back, and the view of it the bid forms read. Plain JavaScript,
// used in Node by tools/check_fdrex_bid.mjs.
import { defaultBidState, defaultLosses, mergeBidState } from "../bid/model.js";
import { DEFAULT_SETTINGS, TENDER_ID } from "./bidTerms.js";

export const STEP_IDS = ["documents", "conditions", "bid", "sources", "financeInputs", "size", "finance", "whatif", "forms"];

/** The FDRE-X bid when nothing is entered: the Tender to Bid state with this tender, 100 MW, solar, wind and the storage on. */
export function defaultFdrexBidState() {
  const base = defaultBidState();
  return {
    ...base,
    step: "documents",
    tender: TENDER_ID,
    bid: { baseMw: 100, greenshoe: false },
    sources: { ...Object.fromEntries(Object.keys(base.sources).map((k) => [k, false])), solar: true, wind: true, bess: true },
    market: { ...base.market, sell: true, source: "GDAM" },
    fdrex: { ...DEFAULT_SETTINGS },
    losses: defaultLosses(), // to the billing meter, each technology's transformer included
    forms: {},
    formsReview: {},
    letters: {},
    signed: {},
    clarifications: {},
  };
}

/** A saved bid (this browser's, or one opened from the library) as the tab's state. */
export function fromSaved(saved) {
  if (!saved || saved.version !== 4) return defaultFdrexBidState(); // a bid of the earlier FDRE-X tab starts afresh
  const merged = mergeBidState(saved);
  return {
    ...merged,
    tender: TENDER_ID,
    step: STEP_IDS.includes(saved.step) ? saved.step : "documents",
    fdrex: { ...DEFAULT_SETTINGS, ...(saved.fdrex || {}) },
    losses: saved.losses ? { ...defaultLosses(), ...saved.losses } : defaultLosses(),
    forms: saved.forms || {},
    formsReview: saved.formsReview || {},
    letters: saved.letters || {},
    signed: saved.signed || {},
    clarifications: saved.clarifications || {},
  };
}

/**
 * The bid forms (BidForms.jsx, forms.js, formats.js) read the bid as the earlier FDRE-X model named
 * it: the contracted MW, the Effective Date, the storage per contracted MW, the sizes and the PSM.
 * This gives them that view of this tab's bid and its sized plant.
 */
export function formsView(state) {
  const X = state.bid.baseMw || 0;
  const s = state.lp?.sizes || {};
  return {
    ...state,
    inputs: {
      contractedMw: state.bid.baseMw,
      effectiveDate: state.fdrex?.ppaDate || null,
      solarMw: s.solarMw ?? null,
      windMw: s.windMw ?? null,
      essMwPerMw: X > 0 && s.bessMw != null ? s.bessMw / X : null,
      essMwhPerMw: X > 0 && s.bessMwh != null ? s.bessMwh / X : null,
      extraEssMwhPerMw: 0,
      psm: Boolean(state.fdrex?.psm),
      gstRate: 0.18,
    },
  };
}

