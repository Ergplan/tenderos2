// SECI-FDRE-X: the RfS's bid formats (Section 7 and Annexures A, C, H and K; the data is in
// ./formatsData.js) filled from the bid: which formats this bid needs, where each blank's value
// comes from, how much is filled and whether the bidder has reviewed it since the last change.
// Forked from the CfD-I file (web/src/cfd/formats.js), whose exports it keeps. Plain JavaScript,
// checked in Node by tools/check_fdrex_forms.mjs.
//
// A blank's value comes from one of three places:
//   model:  the bid itself (contracted MW, the plant, EMD, PBG and Success Charges, the choice of
//           cover under the Payment Security Mechanism, the RfS's number and title);
//   shared: a particular asked once and used in every format (bidder, address, signatory...);
//   own:    a blank only this format has (state.forms["<format>.<key>"]).
//
// What this RfS adds to the CfD logic: the EMD and the PBG may each be a bank guarantee, a
// Payment on Order Instrument of REC/PFC or an insurance surety bond (`applies` emd-bg / emd-poi
// / emd-surety and pbg-bg / pbg-poi / pbg-surety); Annexure-K is needed only when the
// connectivity application is another entity's ("third-party-connectivity"); Annexure-H comes
// after the award ("after-award"); Format 7.8 gives way to Format 7.8A when a common shareholder
// sits in another bidder ("no-common-shareholding"); and a format may carry `notes` (rules quoted
// from the RfS).
import { RFS } from "./terms.js";
import { TENDER } from "./tender.js";
import { rfsAmounts } from "./model.js";
import { FORM_FIELDS } from "./forms.js";
import { FORMATS, RFS_FILE } from "./formatsData.js";

export { FORMATS, RFS_FILE };

const fmtDate = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join(".") : iso || "");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const rs = (v) => (isNum(v) ? `INR ${Math.round(v).toLocaleString("en-IN")}` : "");
const mw = (v) => (isNum(v) ? String(Math.round(v)) : "");

export const formatById = (id) => FORMATS.find((f) => f.id === id) || null;

/** The two answers of the Covering Letter's para 5, as the format's blank lists them. */
const PSM_OPTIONS = formatById("7.1").fields.find((x) => x.maps === "psm").options;

/** Values the bid already holds, by the `maps` names the formats use. */
export function modelValues(state) {
  const i = state.inputs || {};
  const X = isNum(i.contractedMw) ? i.contractedMw : null;
  const amounts = X ? rfsAmounts(i) : null;
  return {
    contractedMw: mw(X),
    solarMw: isNum(i.solarMw) ? mw(i.solarMw) : "",
    windMw: isNum(i.windMw) ? mw(i.windMw) : "0",
    otherReMw: "0",
    bessMw: X && isNum(i.essMwPerMw) ? mw(X * i.essMwPerMw) : "",
    // the storage energy the EMD, the PBG and the net worth are worked on: the four hours' battery and any extra
    bessMwh: X && isNum(i.essMwhPerMw) ? mw(amounts.essMwh) : "",
    emdAmount: amounts ? rs(amounts.emdCr * 1e7) : "",
    pbgAmount: amounts ? rs(amounts.pbgCr * 1e7) : "",
    cacAmount: amounts ? rs(amounts.cacCr * 1e7) : "", // the Success Charges, on the Installed Capacity (RfS 18.1), before GST
    // cover under the Payment Security Mechanism at Rs 0.02/kWh: the bid's input, written into the Covering Letter
    psm: i.psm === true ? PSM_OPTIONS[0] : i.psm === false ? PSM_OPTIONS[1] : "",
    rfsNo: RFS.number,
    rfsDate: fmtDate(RFS.date),
    title: RFS.title,
  };
}
const MODEL = new Set(["contractedMw", "solarMw", "windMw", "otherReMw", "bessMw", "bessMwh", "emdAmount", "pbgAmount", "cacAmount", "psm", "rfsNo", "rfsDate", "title"]);
/** Shared particulars a format blank maps to (state.forms keys); `date` is the letters' date. */
const SHARED = { date: "letterDate", tariff: "tariff", netWorthCr: "netWorthCr", netWorthYear: "netWorthYear" };

/**
 * Whether a blank applies to this bid: a blank marked `when: "consortium"` is left out of a single
 * company's format, and a blank that maps to a particular asked only on one route (the turnover,
 * PBDIT or line-of-credit figure) is left out when another route is chosen.
 */
export function fieldApplies(state, field) {
  const f = state.forms || {};
  if (field.when === "consortium") return f.bidderType === "consortium";
  if (field.maps && !MODEL.has(field.maps)) {
    const shared = FORM_FIELDS.find((x) => x.key === (SHARED[field.maps] || field.maps));
    if (shared?.when && !shared.when(f)) return false;
  }
  return true;
}

export const NOT_APPLICABLE = "Not applicable to this bid";

/** Where a blank's value comes from: { source: "model"|"shared"|"own"|"na", key, value }. */
export function blankValue(state, format, field) {
  const f = state.forms || {};
  if (!fieldApplies(state, field)) return { source: "na", key: `${format.id}.${field.key}`, value: NOT_APPLICABLE };
  if (field.maps && MODEL.has(field.maps)) return { source: "model", key: field.maps, value: modelValues(state)[field.maps] };
  if (field.maps) {
    const key = SHARED[field.maps] || field.maps;
    const v = f[key];
    const options = FORM_FIELDS.find((x) => x.key === key)?.options;
    const shown = v === undefined || v === null ? "" : options ? options.find(([k]) => k === v)?.[1] || String(v) : /date|Deadline/i.test(key) ? fmtDate(v) : String(v);
    return { source: "shared", key, value: shown };
  }
  const key = `${format.id}.${field.key}`;
  const v = f[key];
  return { source: "own", key, value: v === undefined || v === null ? "" : field.kind === "date" ? fmtDate(v) : String(v) };
}

/**
 * Whether this bid needs the format: "yes", "no", "later" (after the award) or "choose" (an EMD
 * instrument to pick). The EMD is one of three instruments (forms.emdForm: bg, poi, surety); so
 * is the PBG, after the award (forms.pbgForm, optional: once chosen the other two are not needed).
 */
export function applies(state, format) {
  const f = state.forms || {};
  const a = format.applies;
  if (a === "always") return "yes";
  if (a === "consortium") return f.bidderType === "consortium" ? "yes" : "no";
  if (a.startsWith("emd-")) return !f.emdForm ? "choose" : a === `emd-${f.emdForm}` ? "yes" : "no";
  if (a.startsWith("pbg-")) return f.pbgForm && a !== `pbg-${f.pbgForm}` ? "no" : "later";
  if (a === "after-award") return "later";
  if (a === "common-shareholding") return f.commonShareholding === "yes" ? "yes" : "no";
  // Format 7.8 is for every bidder but those with a common shareholder, who file Format 7.8A in its place (RfS 5.1 note)
  if (a === "no-common-shareholding") return f.commonShareholding === "yes" ? "no" : "yes";
  if (a === "third-party-connectivity") return f.connectivityBy === "other" ? "yes" : "no";
  return "yes";
}

/** A fingerprint of a format's filled values, so a review is known to be out of date after an edit. */
export function formatPrint(state, format) {
  const vals = format.fields.map((x) => blankValue(state, format, x).value);
  const att = (format.attachments || []).map((_, i) => (state.forms?.[`${format.id}.att.${i}`] ? 1 : 0));
  const edits = state.letters?.[format.id] || {};
  let h = 0;
  for (const ch of JSON.stringify([vals, att, edits])) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return String(h);
}

/**
 * The state of one format: { applies, filled, total, missing (labels), attached, attachments,
 * notes, reviewed: null | "current" | "changed" }. Table blanks are optional (a schedule may be
 * attached).
 */
export function formatStatus(state, format) {
  const needed = format.fields.filter((x) => x.kind !== "table" && fieldApplies(state, x));
  const missing = needed.filter((x) => !blankValue(state, format, x).value).map((x) => x.label);
  const att = format.attachments || [];
  const review = state.formsReview?.[format.id] || null;
  return {
    applies: applies(state, format),
    filled: needed.length - missing.length,
    total: needed.length,
    missing,
    attached: att.filter((_, i) => state.forms?.[`${format.id}.att.${i}`]).length,
    attachments: att.length,
    notes: (format.notes || []).length,
    reviewed: !review ? null : review.print === formatPrint(state, format) ? "current" : "changed",
    reviewedAt: review?.at || null,
  };
}

/** The formats in the order to work through them, grouped as they are submitted. */
export function formatGroups(state) {
  const groups = [
    { id: "envelope1", title: "Envelope I · techno-commercial", list: [] },
    { id: "envelope2", title: "Envelope II · financial", list: [] },
    { id: "later", title: "After the award", list: [] },
    { id: "na", title: "Not needed for this bid", list: [] },
  ];
  for (const f of FORMATS) {
    const a = applies(state, f);
    // the envelope is the format's own: here Format 7.12 goes with 7.11 in the financial bid (RfS 26.2)
    const g = a === "no" ? "na" : a === "later" ? "later" : /financial/i.test(f.envelope) ? "envelope2" : "envelope1";
    groups.find((x) => x.id === g).list.push(f);
  }
  return groups.filter((g) => g.list.length);
}

/** Totals for the step header and the checks: formats needed, complete, reviewed. */
export function formatsSummary(state) {
  const needed = FORMATS.filter((f) => ["yes", "choose"].includes(applies(state, f)));
  const st = needed.map((f) => formatStatus(state, f));
  return {
    needed: needed.length,
    complete: st.filter((s) => s.applies === "yes" && s.missing.length === 0).length,
    reviewed: st.filter((s) => s.reviewed === "current").length,
    blanksLeft: st.reduce((a, s) => a + s.missing.length, 0),
  };
}

/** The formats as the bid pack lays them out: the ones this bid needs, every blank and its value, the enclosures and the RfS's notes. */
export function formatsForPack(state) {
  return FORMATS.filter((f) => applies(state, f) !== "no").map((f) => {
    const s = formatStatus(state, f);
    return {
      id: f.id, title: f.title, pages: f.pages, submittedBy: f.submittedBy, paper: f.paper, envelope: f.envelope, when: f.when,
      applies: s.applies, reviewed: s.reviewed, reviewedAt: s.reviewedAt,
      fields: f.fields.filter((x) => fieldApplies(state, x)).map((x) => ({ label: x.label, value: blankValue(state, f, x).value, page: x.context.page })),
      attachments: (f.attachments || []).map((a, i) => ({ label: a.label, done: Boolean(state.forms?.[`${f.id}.att.${i}`]) })),
      notes: (f.notes || []).map((n) => ({ label: n.label, quote: n.context.quote, page: n.context.page })),
    };
  });
}

/** How a format is named on screen and in the files: "Format 7.1", "Format 7.8 annexure", "Annexure-K". */
export const formatName = (id) => (/^[A-Z]$/.test(id) ? `Annexure-${id}` : `Format ${String(id).replace("7.8-annex", "7.8 annexure")}`);

/** The tender's securities and thresholds this bid needs (₹ crore), for the checks. */
export const tenderAmounts = (state) => (isNum(state.inputs?.contractedMw) ? rfsAmounts(state.inputs) : null);

export { TENDER, fmtDate };
