// SECI CfD-I bid forms: the particulars the bidder fills in once, the checks of the bid against
// the tender's conditions, and the request for the bid pack (POST /api/cfd/forms, a Word file).
// Plain JavaScript, checked in Node by tools/check_cfd_forms.mjs.
import { DOCUMENTS, RFS, TENDER, docById, termById } from "./terms.js";
import { keyDates, fmtDate as fmtDay } from "./model.js";
import { tenderAmounts } from "./formats.js";

/** The particulars of the bid forms, in the order they are filled. */
export const FORM_FIELDS = [
  { key: "bidder", group: "Bidder", label: "Bidder's name", type: "text", required: true },
  { key: "bidderType", group: "Bidder", label: "Bidding as", type: "select", options: [["company", "Single company"], ["consortium", "Consortium"]], required: true },
  { key: "leadMember", group: "Bidder", label: "Lead member (consortium)", type: "text", when: (f) => f.bidderType === "consortium", required: true },
  { key: "address", group: "Bidder", label: "Registered office", type: "textarea", required: true },
  { key: "contact", group: "Bidder", label: "Contact person", type: "text", required: true },
  { key: "email", group: "Bidder", label: "Email", type: "email", required: true },
  { key: "phone", group: "Bidder", label: "Phone", type: "text" },
  { key: "commonShareholding", group: "Bidder", label: "A common shareholder (10–26%) in another bidder?", type: "select", options: [["no", "No (Format 7.8)"], ["yes", "Yes (Format 7.8A)"]], required: true, hint: "RfS cl. 6.1 note" },
  { key: "signatory", group: "Signing", label: "Authorised signatory (name, designation)", type: "text", required: true, hint: "Signs the formats under the Board Resolution (Format 7.4)" },
  { key: "letterDate", group: "Signing", label: "Date on the letters", type: "date", required: true },
  { key: "place", group: "Signing", label: "Place", type: "text", required: true },
  { key: "bidDeadline", group: "Offer", label: "Bid submission deadline (as per the NIT on the ETS portal)", type: "date", required: true, hint: "The EMD runs 12 months from it; the bid is valid 12 months from it" },
  { key: "tariff", group: "Offer", label: "Strike price quoted (₹/kWh)", type: "number", step: 0.01, required: true, hint: "Two decimals, entered on the ETS portal; no ceiling (Amendment-03)" },
  { key: "emdForm", group: "Offer", label: "EMD instrument", type: "select", options: [["bg", "Bank Guarantee (Format 7.3A)"], ["surety", "Insurance Surety Bond (Format 7.3B)"]], required: true },
  { key: "substation", group: "Project", label: "Interconnection point (ISTS substation)", type: "text", required: true, hint: "Any ISTS substation in India with injection rights in the non-solar hours (RfS 8.2)" },
  { key: "connectivity", group: "Project", label: "Connectivity", type: "select", options: [["applied", "Applied"], ["inPrinciple", "In-principle grant"], ["final", "Final grant"], ["none", "Not applied yet"]], required: true },
  { key: "site", group: "Project", label: "Project site (village, tehsil, district, state)", type: "text", required: true, hint: "Generation and the battery co-located (CfDA 1.1)" },
  { key: "netWorthCr", group: "Eligibility", label: "Net worth, last audited year (₹ cr)", type: "number", step: 0.01, required: true },
  { key: "netWorthYear", group: "Eligibility", label: "Financial year of that net worth", type: "text", hint: "2024-25 or 2025-26, or a date at least 7 days before the deadline" },
  { key: "liquidityRoute", group: "Eligibility", label: "Liquidity shown through", type: "select", options: [["turnover", "Annual turnover (RfS 37.2.i)"], ["pbdit", "PBDIT (37.2.ii)"], ["loc", "Line of credit sanction letter (37.2.iii)"]], required: true },
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

/**
 * Each check of the bid against the tender: { id, label, status: ok | bad | warn | todo, detail,
 * condition (term id in web/src/cfd/terms.js) }. model: the CfD model (runModel) when it has run.
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
    detail: isNum(X) ? `${X} MW (${TENDER.bidMinMw} to ${TENDER.bidMaxMw} MW, whole MW)` : "Enter the contracted capacity (Bid inputs)" });
  const sp = f.tariff;
  const twoDecimals = isNum(sp) && Math.abs(sp * 100 - Math.round(sp * 100)) < 1e-9;
  const target = model?.bid ?? null;
  add({ id: "tariff", label: "Strike price quoted", condition: "bid",
    status: !isNum(sp) || sp <= 0 ? "todo" : !twoDecimals ? "bad" : target !== null && sp < target - 1e-9 ? "warn" : "ok",
    detail: !isNum(sp) || sp <= 0 ? "Enter the strike price (the Financial model gives the price for your target IRR)"
      : !twoDecimals ? `₹${sp}/kWh: quote two decimals only; digits beyond are ignored`
        : `₹${sp.toFixed(2)}/kWh, fixed for the 15-year term; no ceiling (Amendment-03 removed ₹5.80)${target !== null ? (sp < target - 1e-9 ? `; below the ₹${target.toFixed(2)} your target IRR needs` : `; your target IRR needs ₹${target.toFixed(2)}`) : ""}` });
  add({ id: "storage", label: "Battery of at least X MW / 2X MWh", condition: "ess",
    status: !isNum(i.essMwPerMw) || !isNum(i.essMwhPerMw) ? "todo" : i.essMwPerMw >= 1 - 1e-9 && i.essMwhPerMw >= TENDER.essHoursMin - 1e-9 ? "ok" : "bad",
    detail: isNum(X) && isNum(i.essMwPerMw) && isNum(i.essMwhPerMw) ? `${Math.round(X * i.essMwPerMw)} MW / ${Math.round(X * i.essMwhPerMw)} MWh for ${X} MW; owned by you, co-located` : "Set the battery (Design)" });
  add({ id: "site", label: "Site and interconnection", condition: "substation",
    status: f.site && f.substation ? (f.connectivity === "none" ? "warn" : "ok") : "todo",
    detail: f.site && f.substation ? `${f.site}; ${f.substation}${f.connectivity === "none" ? "; connectivity not applied for yet (your risk, RfS 8.2)" : ""}` : "Name the site and the ISTS substation" });
  add({ id: "emd", label: "EMD to furnish", condition: "emd",
    status: amounts ? (f.emdForm ? "ok" : "todo") : "todo",
    detail: amounts ? `₹${amounts.emdCr.toFixed(2)} crore (9.68 lakh/MW solar + 13.68 lakh/MW wind + 2.40 lakh/MWh battery)${f.emdForm ? `, as a ${f.emdForm === "bg" ? "bank guarantee (7.3A)" : "surety bond (7.3B)"}` : "; choose the instrument"}` : "Enter the plant (Design): the EMD follows the installed capacity" });
  const emdValid = f["7.1.emdValidUpTo"] || f["7.3A.validUpTo"] || f["7.3B.validUpTo"] || null;
  const needValid = f.bidDeadline ? addMonthsIso(f.bidDeadline, TENDER.emdValidityMonths) : null;
  add({ id: "emdValidity", label: "EMD validity", condition: "emdValidity",
    status: !f.bidDeadline ? "todo" : !emdValid ? "todo" : emdValid >= needValid ? "ok" : "bad",
    detail: !f.bidDeadline ? "Enter the bid deadline: the EMD must run 12 months from it"
      : `12 months from ${fmtDate(f.bidDeadline)}: valid to at least ${fmtDate(needValid)}${emdValid ? `; yours to ${fmtDate(emdValid)}` : " (fill the EMD blank in 7.1 / 7.3)"}. Claimable 30 days more; if it stays valid 6 months past the final deadline no extension is needed during evaluation (Amendment-03)` });
  add({ id: "pbg", label: "PBG after the award", condition: "pbg", status: amounts ? "ok" : "todo",
    detail: amounts ? `₹${amounts.pbgCr.toFixed(2)} crore within 20 days of the LoA, valid to 6 months after the SCD; plus Contract Administration Charges ₹${amounts.cacCr.toFixed(2)} crore + GST` : "Enter the plant (Design)" });
  add({ id: "networth", label: "Net worth", condition: "netWorth",
    status: !amounts || !isNum(f.netWorthCr) ? "todo" : f.netWorthCr >= amounts.netWorthCr - 1e-9 ? "ok" : "bad",
    detail: amounts ? `Need ₹${amounts.netWorthCr.toFixed(2)} cr (96.8 lakh/MW solar + 1.368 cr/MW wind + 24 lakh/MWh battery)${isNum(f.netWorthCr) ? `; you have ₹${f.netWorthCr.toFixed(2)} cr` : ""}` : "Enter the plant (Design)" });
  const route = f.liquidityRoute;
  const liq = route === "turnover" ? { have: f.turnoverCr, need: amounts?.turnoverCr, label: "turnover", term: "turnover" }
    : route === "pbdit" ? { have: f.pbditCr, need: amounts?.pbditCr, label: "PBDIT", term: "pbdit" }
      : route === "loc" ? { have: f.lineOfCreditCr, need: amounts?.lineOfCreditCr, label: "line of credit", term: "lineOfCredit" } : null;
  add({ id: "liquidity", label: "Liquidity (one of three)", condition: liq?.term || "turnover",
    status: !liq || !isNum(liq.need) ? "todo" : !isNum(liq.have) ? "todo" : liq.have >= liq.need - 1e-9 ? "ok" : "bad",
    detail: !liq ? "Choose the route: turnover, PBDIT or a line of credit" : !isNum(liq.need) ? "Enter the contracted capacity" : `${liq.label}: need ₹${liq.need.toFixed(2)} cr for ${X} MW${isNum(liq.have) ? `; you show ₹${liq.have.toFixed(2)} cr` : ""}` });
  add({ id: "validity", label: "Bid validity", condition: "bidValidity",
    status: f.bidDeadline ? "ok" : "todo",
    detail: f.bidDeadline ? `12 months from ${fmtDate(f.bidDeadline)}: to ${fmtDate(addMonthsIso(f.bidDeadline, 12))}; the tariff in the LoA holds until the CfDA` : "Enter the bid deadline" });
  const ed = i.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(i.effectiveDate) ? keyDates(i.effectiveDate) : null;
  add({ id: "dates", label: "Commissioning", condition: "essScd", status: ed ? "ok" : "todo",
    detail: ed ? `Battery by ${fmtDay(ed.scd)} (SCD, 15 months from the Effective Date); RE generation by ${fmtDay(ed.reDeadline)}; financial closure by ${fmtDay(ed.finClose)}` : "Enter the Effective Date (Bid inputs)" });
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
    tender: { short: "SECI CfD-I", title: RFS.title, rfsNo: RFS.number, issuer: "Solar Energy Corporation of India Limited (SECI)" },
    fields: visibleFields(f).map((x) => {
      const v = f[x.key];
      const shown = x.options ? (x.options.find(([k]) => k === v)?.[1] || "") : x.type === "date" ? fmtDate(v) : v;
      return { group: x.group, label: x.label, value: shown === undefined || shown === null ? "" : String(shown) };
    }),
    bid: {
      contractedMw: isNum(X(i)) ? X(i) : null,
      tariff: f.tariff ?? null,
      modelTariff: model?.bid ?? null,
      solarMw: i.solarMw ?? null, windMw: i.windMw ?? null,
      bessMw: isNum(X(i)) && isNum(i.essMwPerMw) ? X(i) * i.essMwPerMw : null, bessMwh: isNum(X(i)) && isNum(i.essMwhPerMw) ? X(i) * i.essMwhPerMw : null,
      emdCr: amounts?.emdCr ?? null, pbgCr: amounts?.pbgCr ?? null, netWorthCr: amounts?.netWorthCr ?? null, cacCr: amounts?.cacCr ?? null,
      sellMarket: i.sellMarket || null,
    },
    dates: ed ? { effective: iso(ed.ed), finClose: iso(ed.finClose), scd: iso(ed.scd), lastWithPenalty: iso(ed.lastWithPenalty), reDeadline: iso(ed.reDeadline), end: iso(ed.end) } : null,
    checks,
    documents: DOCUMENTS.map((d) => ({ title: d.title, ref: d.short, date: "", provided: Boolean(d.file) })),
    fileName: `SECI_CfD_I_bid_${isNum(X(i)) ? X(i) : 0}MW`,
  };
}
const X = (i) => i.contractedMw;
