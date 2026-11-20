// SECI-FDRE-X for the Tender to Bid steps (the FDRE-X Bid tab, FdrexBidTab.jsx): the tender's terms
// in the shape the sizing, the finance and the workbook use (web/src/bid/tenderMap.js tenderTerms, as
// the SECI RTC tab's seciTerms), from the figures of ./terms.js, each tied there to its clause.
//
// What the tender asks, as the HiGHS sizing sees it (engine/sizing/rtc_lp.py):
//   * supply only in the 4 hours a day the Buying Entity names in the non-solar hours (RfS 8.1),
//     1 MWh per MW in each: the demand is the contracted MW in those hours and nothing elsewhere;
//   * a monthly reconciliation (RfS 8.2): with "Pay the penalty", 10% of the month's energy short is
//     free and the energy short beyond it costs 1.5 x the tariff; with "Meet every month", the whole
//     month's energy is a hard floor;
//   * up to 5% of each year's energy may be bought from the green market or a bilateral agreement,
//     supplied directly or through the storage (RfS 8.1.e): priced at the hourly IEX GDAM price plus
//     the charges to the meter;
//   * nothing is injected in the solar hours unless the bidder also holds connectivity for them
//     (RfS 3.1, 8.2: connectivity for non-solar-hour access): the surplus sale is closed there;
//   * the Payment Security Mechanism, when taken, is ₹0.02/kWh off every bill (RfS 18.4);
//   * the Success Charges, ₹1 lakh per MW of Installed Capacity (RE in MW, storage in MWh) + GST,
//     are part of the project cost (RfS 18.1).
// Plain JavaScript (no JSX), checked in Node by tools/check_fdrex_bid.mjs.
import { costliestHours } from "../seci/peakPrices.js";
import { DOCUMENTS, RFS, TENDER, docById, termById } from "./terms.js";
import { FDREX_BENCHMARKS } from "./marketCase.js";

const GST = 0.18;

/** How the 4 hours the buyer names each day are planned for. */
export const PEAK_PLANS = {
  price: { label: "The 4 costliest non-solar hours each day", detail: "Each day, the 4 hours from 18:00 to 06:00 with the highest IEX Day-Ahead prices: the hours a buyer would most likely name", byPrice: true },
  evening: { label: "Evening 18:00–22:00", detail: "Plan on the four evening hours only; a buyer naming later or morning hours would find the plant short", start: 18, hours: 4 },
};

/** What a shortfall means for the sizing (RfS 8.2: reconciled monthly). */
export const SHORTFALL_MODES = {
  penalty: { label: "Pay the penalty beyond 10%", detail: "Each month, 10% of the energy may fall short for free (its revenue is lost); the energy short beyond it costs 1.5 × the tariff. The optimizer weighs it against more plant" },
  hard: { label: "Meet every month in full", detail: "The whole month's peak energy is supplied: no shortfall in any month of any modelled year" },
};

export const NON_SOLAR = { start: 18, end: 6 }; // the model's non-solar hours where GRID-INDIA has not notified the State's (RfS 8.1.a: sunset to sunrise)

export const DEFAULT_SETTINGS = {
  peakPlan: "price",
  shortfall: "penalty",
  ppaDate: null, // the Effective Date of the PPA
  buy: true, // buy green-market / bilateral power within 5% of each year's energy
  buyCharges: 0.3, // ₹/kWh on bought power: exchange fee, transmission charges and losses to the meter
  dayInjection: false, // connectivity for the solar hours too (the tender asks for the non-solar hours only)
  psm: false, // the Payment Security Mechanism (₹0.02/kWh off every bill)
};

/** 1 in every non-solar hour of the year (18:00 to 06:00), else 0. */
export function nonSolarMask({ start, end } = NON_SOLAR) {
  const mask = new Uint8Array(8760);
  for (let t = 0; t < 8760; t += 1) { const h = t % 24; mask[t] = h >= start || h < end ? 1 : 0; }
  return mask;
}

/** The buyer's 4 hours each day under a plan: { mask, picked (the costliest-hours detail) | null, pending }. */
export function supplyHours(settings = DEFAULT_SETTINGS, prices = null) {
  const plan = PEAK_PLANS[settings.peakPlan] || PEAK_PLANS.price;
  if (plan.byPrice) {
    const picked = costliestHours(prices, { picks: TENDER.peakHours, windowStart: NON_SOLAR.start, windowHours: 24 - NON_SOLAR.start + NON_SOLAR.end });
    if (picked) return { mask: picked.mask, picked, pending: false };
    // until the prices are there: the evening hours
    return { ...supplyHours({ ...settings, peakPlan: "evening" }), pending: true };
  }
  const mask = new Uint8Array(8760);
  for (let t = 0; t < 8760; t += 1) { const h = t % 24; mask[t] = h >= plan.start && h < plan.start + plan.hours ? 1 : 0; }
  return { mask, picked: null, pending: false };
}

const addMonths = (iso, n) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1 + n, +m[3])).toISOString().slice(0, 10);
};

/** SCSD, Financial Closure and the latest start, from the PPA's Effective Date (or null). */
export function keyDates(ppaDate) {
  if (!ppaDate) return null;
  const scsd = addMonths(ppaDate, TENDER.scdMonths);
  return { ppa: ppaDate, financialClosure: addMonths(scsd, -TENDER.finCloseMonthsBeforeScd), scsd, latestStart: addMonths(scsd, TENDER.delayMonthsMax) };
}

/** EMD, PBG, net worth and Success Charges (₹) on the installed solar MW, wind MW and storage MWh (RfS 16, 17, 36.1, 18.1). */
export function moneyAtStake(sizes) {
  const S = Math.max(0, sizes?.solarMw || 0);
  const W = Math.max(0, sizes?.windMw || 0);
  const E = Math.max(0, sizes?.bessMwh || 0);
  const lakh = (r) => (r.solarMw * S + r.windMw * W + r.essMwh * E) * 1e5;
  const installed = S + W + E; // the Installed Capacity of RfS 18.1: the RE in MW and the storage in MWh
  return {
    S, W, E, installed,
    emdRs: lakh(TENDER.emdLakh), pbgRs: lakh(TENDER.pbgLakh), netWorthRs: lakh(TENDER.netWorthLakh),
    successRs: installed * TENDER.successChargeLakhPerMw * 1e5 * (1 + GST),
  };
}

/** SECI's charges in the project cost (₹ cr, with GST): Success Charges, the RfS cost and the bid fee (RfS 18.1, Bid Information Sheet F and G). */
export function seciChargesCr(sizes, mw = 0) {
  const fee = Math.min(TENDER.bidFeeLakhPerMw * Math.max(0, mw || 0), TENDER.bidFeeMaxLakh);
  return moneyAtStake(sizes).successRs / 1e7 + ((TENDER.rfsCostLakh + fee) / 100) * (1 + GST);
}

/** A tender term as a provenance chip: label, display, page, quote, document. */
export function prov(id, label = null, display = null) {
  const t = termById[id];
  if (!t) return null;
  return { label: label || t.label, display: display || t.display, page: t.page, quote: t.quote, located: true, doc: docById[t.doc]?.short || t.doc, docId: t.doc, clause: t.clause };
}

/** The workbook's names for the rows FDRE-X fills (web/lib/liveModel.js LABEL_KEYS). */
export const WORKBOOK_LABELS = {
  otherCapex: "SECI's charges (Success Charges, RfS cost, bid fee, with GST)",
  charging: "Power bought (green market, bilateral)",
  chargingNote: "Bought within 5% of each year's energy (RfS 8.1.e), supplied directly or through the storage, at the hourly IEX GDAM price plus the charges to the meter",
  chargingCost: "Power bought (green market, bilateral)",
  pxFees: "PSM discount",
  pxFeesNote: `The Payment Security Mechanism: ₹${TENDER.psmChargeRsPerKwh.toFixed(2)}/kWh off every bill for the whole term (RfS 18.4)`,
  pxFeeCost: "PSM discount",
  blockShort: "Energy short beyond the monthly 10%",
  blockShortNote: "Each month's peak energy not supplied beyond the 10% that is free (RfS 8.2)",
  blockPen: "Monthly shortfall penalty",
  blockPenNote: "1.5 × the tariff on the energy short beyond 10% of the month's requirement (RfS 8.2)",
};

/**
 * The tender's terms for the bid steps, under the bidder's choices. prices (the IEX hourly prices)
 * pick the buyer's hours under "the 4 costliest hours"; until they are there, the evening hours.
 */
export function fdrexTerms(settings = DEFAULT_SETTINGS, prices = null) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const hours = supplyHours(s, prices);
  const penalty = s.shortfall !== "hard";
  const dates = keyDates(s.ppaDate);
  const plan = PEAK_PLANS[s.peakPlan] || PEAK_PLANS.price;
  return {
    baseMw: TENDER.totalMw,
    greenshoeMw: null,
    partAllowed: true,
    maxBidMw: TENDER.bidMaxMw,
    minBidMw: TENDER.bidMinMw,
    greenshoeStart: null,
    greenshoeSameTariff: null,
    rules: [{
      id: "peak", label: penalty ? "Peak energy each month (10% free, 1.5 × tariff beyond)" : "Peak energy each month, in full", basis: "monthly", hours: "all", target: 1,
      ...(penalty ? { penaltyMultiple: TENDER.penaltyMultiple, tolerance: TENDER.shortfallTolerance } : {}),
    }],
    // the 4 hours a day the buyer takes: the demand is the contracted MW in them, nothing elsewhere
    supplyMask: hours.mask,
    supplyLabel: `${TENDER.peakHours} hours a day of assured peak supply`,
    peak: { start: plan.start ?? NON_SOLAR.start, hours: TENDER.peakHours, setBy: "Buying Entity", windows: [{ start: "18:00", end: "06:00" }], mask: hours.mask,
      ...(hours.picked ? { picked: hours.picked } : {}), ...(hours.pending ? { pricesPending: true } : {}) },
    peakAny: false,
    peakPlan: s.peakPlan in PEAK_PLANS ? s.peakPlan : "price",
    shortfall: penalty ? "penalty" : "hard",
    // connectivity for the non-solar hours only: no sale in the solar hours unless held for them too
    saleMask: s.dayInjection ? null : nonSolarMask(),
    purchase: { enabled: Boolean(s.buy), maxShare: TENDER.marketShare, market: "GDAM", chargesRsPerKwh: Math.max(0, Number(s.buyCharges) || 0) },
    psmRsPerKwh: s.psm ? TENDER.psmChargeRsPerKwh : 0,
    // SECI's charges, not refunded: the Success Charges on the sized plant, the RfS cost and the bid
    // processing fee, each with GST
    otherCapexCr: (sizes, mw = 0) => seciChargesCr(sizes, mw),
    workbookLabels: WORKBOOK_LABELS,
    // RE with storage: solar and wind, the storage mandatory and RE-charged
    permitted: { solar: true, wind: true, hydro: false, biomass: false, thermal: false, bess: true },
    mandatory: { solar: false, bess: true },
    greenMin: null,
    solarMultiple: null,
    sale: "allowed", // outside the buyer's hours, the PPA first (PPA 4.4.1, RfS 8.4)
    // a sale while the day's supply is unfulfilled is a breach, penalised at 1.5 x the day's highest
    // exchange rate on the volume sold (RfS 8.1.f): the plant sells only on days it meets in full
    saleOnMetDays: true,
    // the benchmark inputs this tender fills in where they differ from Tender to Bid's (./marketCase.js)
    benchmarks: FDREX_BENCHMARKS,
    site: null,
    years: TENDER.termYears,
    typicalSeed: null,
    yearsAssumed: false,
    supplyStart: dates?.scsd || null,
    ceiling: null,
    emdPerMw: null, // EMD and PBG are on the installed capacity: see moneyAtStake
    pbgPerMw: null,
    deadline: null,
    dates,
    provenance: {
      capacity: prov("capacityBid", "Bid capacity"),
      maxBid: prov("capacityBid", "Most one bidder may offer"),
      minBid: prov("capacityBid", "Least one bidder may offer"),
      part: prov("capacityAward", "Successful bidders"),
      sources: prov("newProject", "RE sources"),
      storage: prov("ess", "Energy storage"),
      "rule.peak": prov("mandate"),
      "peak.hours": prov("fourHours", null, `${plan.label} (the Buying Entity names 4 hours of the non-solar hours each day)`),
      "market.sale": prov("essOtherUse", "Sale outside the buyer's hours"),
      "market.purchase": prov("marketShare"),
      start: prov("scsd", "Supply start"),
      years: prov("term", "PPA term"),
      ceiling: { label: "Ceiling tariff", display: "None stated in the RfS", located: false },
    },
  };
}

/** The tender's identity, for titles and the workbook. */
export const TENDER_ID = {
  name: "SECI-FDRE-X",
  seedKey: "seci-fdre-x",
  result: {
    values: {
      "core.identity.tender_number": RFS.number,
      "core.identity.issuing_agency": "Solar Energy Corporation of India (SECI)",
      "core.identity.title": "Assured peak supply of 4800 MWh a day (1200 MW × 4 hours) from ISTS-connected RE projects with storage",
      "core.identity.tender_type_as_stated": "FDRE-X (assured peak supply)",
    },
  },
};

export { DOCUMENTS, RFS, TENDER };
