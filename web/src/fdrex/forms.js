// SECI-FDRE-X bid forms: the particulars the bidder fills in once, the checks of the bid against
// the tender's conditions, and the request for the bid pack (POST /api/fdrex/forms, a Word file).
// Forked from the CfD-I file (web/src/cfd/forms.js), whose exports it keeps. Plain JavaScript,
// checked in Node by tools/check_fdrex_forms.mjs.
import { DOCUMENTS, RFS, docById, termById } from "./terms.js";
import { TENDER } from "./tender.js";
import { keyDates, fmtDate as fmtDay } from "./model.js";
import { tenderAmounts } from "./formats.js";

/** The EMD and the PBG may each be one of three instruments (RfS 16, 16.4, 16.5 and 17.1, 17.12, 17.13). */
export const INSTRUMENTS = {
  emd: [["bg", "Bank Guarantee (Format 7.3A)"], ["poi", "Payment on Order Instrument (Format 7.3B)"], ["surety", "Insurance Surety Bond (Format 7.3C)"]],
  pbg: [["bg", "Bank Guarantee (Format 7.3D)"], ["poi", "Payment on Order Instrument (Format 7.3E)"], ["surety", "Insurance Surety Bond (Format 7.3F)"]],
};

/** The particulars of the bid forms, in the order they are filled. */
export const FORM_FIELDS = [
  { key: "bidder", group: "Bidder", label: "Bidder's name", type: "text", required: true },
  { key: "bidderType", group: "Bidder", label: "Bidding as", type: "select", options: [["company", "Single company"], ["consortium", "Consortium"]], required: true },
  { key: "leadMember", group: "Bidder", label: "Lead member (consortium)", type: "text", when: (f) => f.bidderType === "consortium", required: true },
  { key: "address", group: "Bidder", label: "Registered office", type: "textarea", required: true },
  { key: "contact", group: "Bidder", label: "Contact person", type: "text", required: true },
  { key: "email", group: "Bidder", label: "Email", type: "email", required: true },
  { key: "phone", group: "Bidder", label: "Phone", type: "text" },
  { key: "commonShareholding", group: "Bidder", label: "A common shareholder (more than 10%, less than 26%) in another bidder?", type: "select", options: [["no", "No (Format 7.8)"], ["yes", "Yes (Format 7.8A)"]], required: true, hint: "RfS cl. 5.1 note" },
  { key: "signatory", group: "Signing", label: "Authorised signatory (name, designation)", type: "text", required: true, hint: "Signs the formats under the Board Resolution (Format 7.4)" },
  { key: "letterDate", group: "Signing", label: "Date on the letters", type: "date", required: true },
  { key: "place", group: "Signing", label: "Place", type: "text", required: true },
  { key: "bidDeadline", group: "Offer", label: "Bid submission deadline (as per the NIT on the ETS portal)", type: "date", required: true, hint: "01.12.2026 on SECI's website on 17.11.2026; check the portal. The EMD runs 12 months from it; the bid is valid 12 months from it" },
  { key: "tariff", group: "Offer", label: "Tariff quoted (₹/kWh)", type: "number", step: 0.01, required: true, hint: "One tariff for all the projects, two decimals, entered only in the electronic form on the ETS portal (RfS 39.3); the RfS sets no ceiling" },
  { key: "emdForm", group: "Offer", label: "EMD instrument", type: "select", options: INSTRUMENTS.emd, required: true, hint: "A bank guarantee, a letter of undertaking of REC or PFC, or an insurer's surety bond (RfS 16)" },
  { key: "pbgForm", group: "Offer", label: "PBG instrument (after the award)", type: "select", options: INSTRUMENTS.pbg, hint: "Not needed to bid: the format of the instrument you choose stays under After the award (RfS 17)" },
  { key: "substation", group: "Project", label: "Delivery Point (ISTS substation)", type: "text", required: true, hint: "One of the four kinds of ISTS substation of RfS 7.2, with injection rights in the non-solar hours" },
  { key: "connectivity", group: "Project", label: "Connectivity for non-solar hour access at the Delivery Point", type: "select", options: [["applied", "Applied"], ["inPrinciple", "In-principle grant"], ["final", "Final grant"], ["none", "Not applied yet"]], required: true, hint: "The application must be on file before the bid, for at least the contracted MW; its proof goes with the Covering Letter (RfS 7.2)" },
  { key: "connectivityBy", group: "Project", label: "The connectivity application is in the name of", type: "select", options: [["own", "The bidder"], ["other", "Another entity whose connectivity the bidder may use (Annexure-K)"]], required: true, hint: "Another entity's connectivity needs its undertaking, Annexure-K, with the Covering Letter (RfS 7.2)" },
  { key: "site", group: "Project", label: "Project site (village, tehsil, district, state)", type: "text", required: true, hint: "RE generation and the storage co-located (RfS 6.1)" },
  { key: "netWorthCr", group: "Eligibility", label: "Net worth (₹ cr)", type: "number", step: 0.01, required: true, hint: "Of the bidder, with the affiliates that undertake to fund it (RfS 36.1)" },
  { key: "netWorthYear", group: "Eligibility", label: "Financial year of that net worth", type: "text", hint: "2025-26, or a date at least 7 days before the bid deadline" },
  { key: "liquidityRoute", group: "Eligibility", label: "Liquidity shown through", type: "select", options: [["turnover", "Annual turnover (RfS 36.2.i)"], ["pbdit", "PBDIT (36.2.ii)"], ["loc", "Line of credit sanction letter (36.2.iii)"]], required: true },
  { key: "turnoverCr", group: "Eligibility", label: "Annual turnover, other income excluded (₹ cr)", type: "number", step: 0.01, when: (f) => f.liquidityRoute === "turnover", required: true },
  { key: "pbditCr", group: "Eligibility", label: "PBDIT, other and exceptional income excluded (₹ cr)", type: "number", step: 0.01, when: (f) => f.liquidityRoute === "pbdit", required: true },
  { key: "lineOfCreditCr", group: "Eligibility", label: "Line of credit committed (₹ cr)", type: "number", step: 0.01, when: (f) => f.liquidityRoute === "loc", required: true },
];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fmtDate = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join(".") : "–");
const addMonthsIso = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
};

/** The fields shown for these answers (a consortium adds the lead member; the liquidity route its figure). */
export function visibleFields(forms = {}) {
  return FORM_FIELDS.filter((f) => !f.when || f.when(forms));
}

/** Required fields still empty. */
export function formIssues(state) {
  const f = state.forms || {};
  return visibleFields(f).filter((x) => x.required && (f[x.key] === undefined || f[x.key] === null || f[x.key] === "")).map((x) => x.label);
}

/** A tender term as a provenance chip (web/src/bid/RequirementsStep.jsx SourceChip): label, page, quote, document. */
export function termProv(id) {
  const t = termById[id];
  if (!t) return null;
  const doc = docById[t.doc];
  return { label: t.label, display: t.display, page: t.page, quote: t.quote, located: true, doc: t.doc, docTitle: doc?.title || t.doc };
}

/** "9.68 lakh/MW solar + 13.68 lakh/MW wind + 2.40 lakh/MWh storage", from the tender's rates (₹ lakh). */
const perUnit = (r) => `${r.solarMw.toFixed(2)} lakh/MW solar + ${r.windMw.toFixed(2)} lakh/MW wind and other RE + ${r.essMwh.toFixed(2)} lakh/MWh storage`;
const INSTRUMENT_NAMES = { bg: "bank guarantee", poi: "Payment on Order Instrument of REC or PFC", surety: "insurance surety bond" };
/** "bank guarantee (7.3A)": an instrument as the checks name it, with its format. */
const instrument = (kind, key) => `${INSTRUMENT_NAMES[key] || key} (${(INSTRUMENTS[kind].find(([k]) => k === key)?.[1] || "").replace(/^.*\(Format (.*)\)$/, "$1")})`;

/**
 * Each check of the bid against the tender: { id, label, status: ok | bad | warn | todo, detail,
 * condition (term id in web/src/fdrex/terms.js) }. model: the bid model (runModel) when it has run.
 */
export function bidChecks(state, model = null) {
  const f = state.forms || {};
  const i = state.inputs || {};
  const X = i.contractedMw;
  const amounts = tenderAmounts(state);
  const out = [];
  const add = (row) => out.push(row);
  add({ id: "capacity", label: "Contracted capacity", condition: "capacityBid",
    status: isNum(X) && Number.isInteger(X) && X >= TENDER.bidMinMw && X <= TENDER.bidMaxMw ? "ok" : "bad",
    detail: isNum(X) ? `${X} MW (${TENDER.bidMinMw} to ${TENDER.bidMaxMw} MW for the bidder and its group, whole MW)` : "Enter the contracted capacity (Bid inputs)" });
  const sp = f.tariff;
  const twoDecimals = isNum(sp) && Math.abs(sp * 100 - Math.round(sp * 100)) < 1e-9;
  const target = model?.bid ?? null;
  add({ id: "tariff", label: "Tariff quoted (the financial bid)", condition: "bid",
    status: !isNum(sp) || sp <= 0 ? "todo" : !twoDecimals ? "bad" : target !== null && sp < target - 1e-9 ? "warn" : "ok",
    detail: !isNum(sp) || sp <= 0 ? "Enter the tariff (the Financial model gives the tariff for your target IRR)"
      : !twoDecimals ? `₹${sp}/kWh: quote two decimals only; digits beyond the second are ignored`
        : `₹${sp.toFixed(2)}/kWh, one tariff for all the projects, fixed for the ${TENDER.termYears}-year term; the RfS sets no ceiling; entered only in the electronic form on the ETS portal${target !== null ? (sp < target - 1e-9 ? `; below the ₹${target.toFixed(2)} your target IRR needs` : `; your target IRR needs ₹${target.toFixed(2)}`) : ""}` });
  const storageOk = isNum(i.essMwPerMw) && isNum(i.essMwhPerMw) && i.essMwPerMw >= TENDER.maxMwhPerMwHour - 1e-9 && i.essMwhPerMw >= TENDER.essHoursMin - 1e-9;
  add({ id: "storage", label: `Storage for the ${TENDER.peakHours} Peak Hours`, condition: "ess",
    status: !isNum(i.essMwPerMw) || !isNum(i.essMwhPerMw) ? "todo" : storageOk ? "ok" : "warn",
    detail: isNum(X) && isNum(i.essMwPerMw) && isNum(i.essMwhPerMw)
      ? `${Math.round(X * i.essMwPerMw)} MW / ${Math.round(amounts.essMwh)} MWh for ${X} MW; storage is mandatory, co-located, yours or tied up with a third party${storageOk ? "" : `. Below ${TENDER.maxMwhPerMwHour} MW and ${TENDER.essHoursMin} MWh per contracted MW the storage alone cannot carry the ${TENDER.mwhPerMwDay} MWh per MW the buyer may ask for in any four non-solar hours (the RfS sets no minimum size; this is the model's reading)`}`
      : "Set the storage (Design)" });
  add({ id: "site", label: "Site and Delivery Point", condition: "substation",
    status: f.site && f.substation ? "ok" : "todo",
    detail: f.site && f.substation ? `${f.site}; ${f.substation}` : "Name the site and the ISTS substation" });
  add({ id: "connectivity", label: "Connectivity applied for", condition: "connectivityApplied",
    status: !f.connectivity || !f.connectivityBy ? "todo" : f.connectivity === "none" ? "bad" : "ok",
    detail: !f.connectivity || !f.connectivityBy ? "Say whether connectivity for non-solar hour access is applied for at the Delivery Point, and in whose name"
      : f.connectivity === "none" ? "Not applied yet: the application for non-solar hour access must be on file before the bid, for at least the contracted MW, and its proof goes with the Covering Letter"
        : `Applied for${isNum(X) ? `, to cover at least ${X} MW` : ""}; enclose the proof with Format 7.1${f.connectivityBy === "other" ? ", and the applicant's undertaking as Annexure-K" : ""}` });
  add({ id: "emd", label: "EMD to furnish", condition: "emd",
    status: amounts ? (f.emdForm ? "ok" : "todo") : "todo",
    detail: amounts ? `₹${amounts.emdCr.toFixed(2)} crore (${perUnit(TENDER.emdLakh)})${f.emdForm ? `, as a ${instrument("emd", f.emdForm)}` : "; choose the instrument: bank guarantee, Payment on Order Instrument or surety bond"}` : "Enter the plant (Design): the EMD follows the installed capacity" });
  const emdValid = f["7.1.emdValidUpTo"] || f["7.3A.validUpTo"] || f["7.3B.validUpTo"] || f["7.3C.validUpTo"] || null;
  const needValid = f.bidDeadline ? addMonthsIso(f.bidDeadline, TENDER.emdValidityMonths) : null;
  add({ id: "emdValidity", label: "EMD validity", condition: "emdValidity",
    status: !f.bidDeadline ? "todo" : !emdValid ? "todo" : emdValid >= needValid ? "ok" : "bad",
    detail: !f.bidDeadline ? `Enter the bid deadline: the EMD must run ${TENDER.emdValidityMonths} months from it`
      : `${TENDER.emdValidityMonths} months from ${fmtDate(f.bidDeadline)}: valid to at least ${fmtDate(needValid)}${emdValid ? `; yours to ${fmtDate(emdValid)}` : " (fill the EMD blank in 7.1 / 7.3)"}. Claimable ${TENDER.bgClaimDays} days more; issued on or before the bid deadline, the original at SECI within 2 working days of it. If the deadline moves, an EMD still valid 6 months past the final deadline need not be extended during evaluation` });
  add({ id: "pbg", label: "PBG and Success Charges after the award", condition: "pbg", status: amounts ? "ok" : "todo",
    detail: amounts ? `PBG ₹${amounts.pbgCr.toFixed(2)} crore (${perUnit(TENDER.pbgLakh)})${f.pbgForm ? `, as a ${instrument("pbg", f.pbgForm)}` : ""}, within ${TENDER.docsDueDays} days of SECI's invitation to sign, valid to ${TENDER.pbgAfterScdMonths} months after the SCSD; Success Charges ₹${amounts.cacCr.toFixed(2)} crore + GST on an Installed Capacity of ${Math.round(amounts.installedMw)} (the RE in MW and the storage in MWh, RfS 18.1), ${Math.round(TENDER.successChargeFirstShare * 100)}% within ${TENDER.successChargeFirstDays} days of the LoA and the rest before signing` : "Enter the plant (Design)" });
  add({ id: "networth", label: "Net worth", condition: "netWorth",
    status: !amounts || !isNum(f.netWorthCr) ? "todo" : f.netWorthCr >= amounts.netWorthCr - 1e-9 ? "ok" : "bad",
    detail: amounts ? `Need ₹${amounts.netWorthCr.toFixed(2)} cr (${perUnit(TENDER.netWorthLakh)})${isNum(f.netWorthCr) ? `; you have ₹${f.netWorthCr.toFixed(2)} cr` : ""}` : "Enter the plant (Design)" });
  const route = f.liquidityRoute;
  const liq = route === "turnover" ? { have: f.turnoverCr, need: amounts?.turnoverCr, label: "turnover", term: "turnover", rate: TENDER.turnoverLakhPerMw }
    : route === "pbdit" ? { have: f.pbditCr, need: amounts?.pbditCr, label: "PBDIT", term: "pbdit", rate: TENDER.pbditLakhPerMw }
      : route === "loc" ? { have: f.lineOfCreditCr, need: amounts?.lineOfCreditCr, label: "line of credit", term: "lineOfCredit", rate: TENDER.lineOfCreditLakhPerMw } : null;
  add({ id: "liquidity", label: "Liquidity (one of three)", condition: liq?.term || "turnover",
    status: !liq || !isNum(liq.need) ? "todo" : !isNum(liq.have) ? "todo" : liq.have >= liq.need - 1e-9 ? "ok" : "bad",
    detail: !liq ? "Choose the route: turnover, PBDIT or a line of credit" : !isNum(liq.need) ? "Enter the contracted capacity" : `${liq.label}: need ₹${liq.need.toFixed(2)} cr for ${X} MW (${liq.rate} lakh per contracted MW)${isNum(liq.have) ? `; you show ₹${liq.have.toFixed(2)} cr` : ""}` });
  add({ id: "psm", label: "Payment Security Mechanism", condition: "psmOptIn",
    status: typeof i.psm === "boolean" ? "ok" : "todo",
    detail: i.psm === true ? `Cover opted for: a discount of ₹${TENDER.psmChargeRsPerKwh.toFixed(2)}/kWh on every monthly bill for the whole term, undertaken in the Covering Letter (para 5)`
      : i.psm === false ? "Not opted for: para 5 of the Covering Letter is struck out, and the project is not covered for the whole term"
        : "Choose on Bid inputs whether to take the cover: the Covering Letter carries the answer and it cannot be changed after" });
  add({ id: "validity", label: "Bid validity", condition: "bidValidity",
    status: f.bidDeadline ? "ok" : "todo",
    detail: f.bidDeadline ? `${TENDER.bidValidityMonths} months from ${fmtDate(f.bidDeadline)}: to ${fmtDate(addMonthsIso(f.bidDeadline, TENDER.bidValidityMonths))}; the tariff in the LoA holds until the PPA is signed` : "Enter the bid deadline" });
  const ed = i.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(i.effectiveDate) ? keyDates(i.effectiveDate) : null;
  add({ id: "dates", label: "Commencement of supply", condition: "scsd", status: ed ? "ok" : "todo",
    detail: ed ? `Supply from the full capacity by ${fmtDay(ed.scd)} (SCSD, ${TENDER.essScdMonths} months from the Effective Date); financial closure by ${fmtDay(ed.finClose)}; latest start, with the PBG encashed pro rata, ${fmtDay(ed.lastWithPenalty)}` : "Enter the Effective Date (Bid inputs)" });
  return out;
}

/** The bid pack request: the answers, the plant, the checks and the terms they rest on. */
export function bidPackRequest(state, model = null) {
  const f = state.forms || {};
  const i = state.inputs || {};
  const amounts = tenderAmounts(state);
  const ed = i.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(i.effectiveDate) ? keyDates(i.effectiveDate) : null;
  const iso = (t) => (t ? new Date(t).toISOString().slice(0, 10) : null);
  const checks = bidChecks(state, model).map((c) => {
    const t = termById[c.condition];
    const doc = t ? docById[t.doc] : null;
    return { ...c, source: t ? `${doc?.short || t.doc} ${t.clause}, p. ${t.page}` : "" };
  });
  return {
    tender: { short: "SECI-FDRE-X", title: RFS.title, rfsNo: RFS.number, issuer: "Solar Energy Corporation of India Limited (SECI)" },
    fields: visibleFields(f).map((x) => {
      const v = f[x.key];
      const shown = x.options ? (x.options.find(([k]) => k === v)?.[1] || "") : x.type === "date" ? fmtDate(v) : v;
      return { group: x.group, label: x.label, value: shown === undefined || shown === null ? "" : String(shown) };
    }),
    bid: {
      contractedMw: isNum(X(i)) ? X(i) : null,
      tariff: f.tariff ?? null,
      modelTariff: model?.bid ?? null,
      termYears: TENDER.termYears,
      solarMw: i.solarMw ?? null, windMw: i.windMw ?? null,
      bessMw: isNum(X(i)) && isNum(i.essMwPerMw) ? X(i) * i.essMwPerMw : null, bessMwh: amounts && isNum(i.essMwhPerMw) ? amounts.essMwh : null,
      installedMw: amounts?.installedMw ?? null,
      emdCr: amounts?.emdCr ?? null, pbgCr: amounts?.pbgCr ?? null, netWorthCr: amounts?.netWorthCr ?? null, cacCr: amounts?.cacCr ?? null,
      emdForm: INSTRUMENTS.emd.find(([k]) => k === f.emdForm)?.[1] || null, pbgForm: INSTRUMENTS.pbg.find(([k]) => k === f.pbgForm)?.[1] || null,
      psm: typeof i.psm === "boolean" ? i.psm : null, psmRsPerKwh: TENDER.psmChargeRsPerKwh,
    },
    dates: ed ? { loa: iso(ed.loa), docsDue: iso(ed.docsDue), effective: iso(ed.ed), finClose: iso(ed.finClose), scd: iso(ed.scd), lastWithPenalty: iso(ed.lastWithPenalty), pbgUntil: iso(ed.pbgUntil), end: iso(ed.end) } : null,
    checks,
    documents: DOCUMENTS.map((d) => ({ title: d.title, ref: d.short, date: "", provided: Boolean(d.file) })),
    fileName: `SECI_FDRE_X_bid_${isNum(X(i)) ? X(i) : 0}MW`,
  };
}
const X = (i) => i.contractedMw;
