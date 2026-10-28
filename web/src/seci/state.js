// The SECI RTC tab's state when nothing is entered: the Tender to Bid state with this tender's
// identity, a 300 MW bid, solar, wind and the mandatory battery switched on, the planning choices
// and empty bid forms. Plain JavaScript, used in Node by tools/check_seci_agent.mjs.
import { defaultBidState, defaultLosses } from "../bid/model.js";
import { DEFAULT_SETTINGS, PACK } from "./terms.js";

/** The tender as the bid steps see it: its identity, for titles and the workbook. */
export const TENDER = {
  name: PACK.short,
  seedKey: PACK.id,
  result: {
    values: {
      "core.identity.tender_number": PACK.rfsNo,
      "core.identity.issuing_agency": PACK.issuer,
      "core.identity.title": PACK.title,
      "core.identity.tender_type_as_stated": "FDRE-RTC (issued as RTC-TM)",
    },
  },
};

export function defaultSeciState() {
  const base = defaultBidState();
  return {
    ...base,
    step: "documents",
    tender: TENDER,
    bid: { baseMw: 300, greenshoe: false },
    sources: { ...Object.fromEntries(Object.keys(base.sources).map((k) => [k, false])), solar: true, wind: true, bess: true },
    seci: { ...DEFAULT_SETTINGS },
    losses: defaultLosses(), // to the 220 kV billing meter, each technology's transformer included
    forms: {}, // the particulars and every format's blanks
    formsReview: {}, // format id -> { at, print }: reviewed, and on which values
    letters: {}, // format id -> { block index: the bidder's wording of that paragraph }
    signed: {}, // format id -> { fileId, name, by, at }: the signed copy accepted from the team
    clarifications: {}, // condition id -> { text, fileId, by, at }: the team's accepted reading
  };
}
