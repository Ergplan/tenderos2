// The SECI-FDRE-X bid formats as full letters: the RfS wording of each format with its blanks
// filled from the bid, for the in-app letter view (BidForms.jsx), the Word file
// (app/api/fdrex/letters) and the PDF (engine /api/bid/document/pdf). Forked from the CfD-I
// letters (web/src/cfd/letters/), with the same module shape. The template syntax and the letter
// engine are web/src/seci/letters/index.js (letterFrom); the blanks' values come from
// ../formats.js blankValue. One file per format of Section 7 and per annexure a bidder hands in
// (A, C, K with the bid; H before the PPA).
import { letterFrom } from "../../seci/letters/index.js";
import { FORMATS, applies, blankValue } from "../formats.js";
import f71 from "./7.1.js";
import f72 from "./7.2.js";
import f73a from "./7.3A.js";
import f73b from "./7.3B.js";
import f73c from "./7.3C.js";
import f73d from "./7.3D.js";
import f73e from "./7.3E.js";
import f73f from "./7.3F.js";
import f74 from "./7.4.js";
import f75 from "./7.5.js";
import f76 from "./7.6.js";
import f77 from "./7.7.js";
import f78 from "./7.8.js";
import f78a from "./7.8A.js";
import f78annex from "./7.8-annex.js";
import f79 from "./7.9.js";
import f710 from "./7.10.js";
import f711 from "./7.11.js";
import f712 from "./7.12.js";
import annexA from "./Annexure-A.js";
import annexC from "./Annexure-C.js";
import annexH from "./Annexure-H.js";
import annexK from "./Annexure-K.js";

export { letterHtml, LETTER_CSS, parseTemplate, segments, textFromNodes, tokensOf } from "../../seci/letters/index.js";

export const TEMPLATES = {
  "7.1": f71, "7.2": f72, "7.3A": f73a, "7.3B": f73b, "7.3C": f73c, "7.3D": f73d, "7.3E": f73e, "7.3F": f73f, "7.4": f74, "7.5": f75, "7.6": f76,
  "7.7": f77, "7.8": f78, "7.8A": f78a, "7.8-annex": f78annex, "7.9": f79, "7.10": f710, "7.11": f711, "7.12": f712,
  A: annexA, C: annexC, H: annexH, K: annexK,
};

/** The values of a format's blanks as the letter prints them (field key -> text). */
export function letterValues(state, format) {
  const out = {};
  for (const field of format.fields) {
    const b = blankValue(state, format, field);
    out[field.key] = b.source === "na" ? "" : b.value;
  }
  return out;
}

/** A format as a letter (web/src/seci/letters/index.js letterFrom, with this pack's blanks). */
export function letterOf(state, format) {
  const template = TEMPLATES[format.id];
  if (!template) return null;
  return letterFrom(state, format, template, letterValues(state, format));
}

/** The letters of every format this bid needs, in pack order. */
export function lettersForBid(state) {
  return FORMATS.filter((f) => TEMPLATES[f.id] && ["yes", "choose"].includes(applies(state, f))).map((f) => letterOf(state, f));
}
