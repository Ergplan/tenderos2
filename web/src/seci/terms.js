// SECI RTC-TM-V: the tender's terms for the sizing and the financial model, from the tender pack
// (seci-rtc-tm-v.json), in the shape the Tender to Bid steps use (web/src/bid/tenderMap.js
// tenderTerms), plus what the pack adds: EMD, PBG and net worth on the installed capacity, and the
// dates that follow the PPA's Effective Date. Plain JavaScript (no JSX), checked in Node by
// tools/check_seci.mjs.
import PACK from "./seci-rtc-tm-v.json" with { type: "json" };
import { costliestHours } from "./peakPrices.js";

export { PACK };

/** How the Peak Hours are planned for: the Buying Entity picks 6 of the 16 window hours each day. */
export const PEAK_PLANS = {
  price: { label: "The 6 costliest hours each day", detail: "Each day, the 6 hours from 18:00 to 10:00 with the highest IEX Day-Ahead prices: the hours a buyer would most likely pick", start: 18, hours: 16, byPrice: true },
  any: { label: "Any 6 of the 16 hours", detail: "Every hour from 18:00 to 10:00 held to the peak floor: safe whichever 6 hours are chosen", start: 18, hours: 16 },
  evening: { label: "Evening 18:00–24:00", detail: "Plan on the evening peak only; a morning pick would be short", start: 18, hours: 6 },
};

/** What a shortfall below a block's floor means for the sizing. */
export const SHORTFALL_MODES = {
  penalty: { label: "Pay the penalty", detail: "A block may fall short when that is cheaper than more plant; the shortfall costs 1.5 × tariff" },
  hard: { label: "Meet every block", detail: "No shortfall in any hour of any modelled year" },
};

export const DEFAULT_SETTINGS = { peakPlan: "price", shortfall: "penalty", ppaDate: null };

const byId = Object.fromEntries(PACK.conditions.map((c) => [c.id, c]));

/** A condition's first quote as a provenance chip (located: the pack's test checks every quote). */
export function prov(id, label = null) {
  const c = byId[id];
  const q = c?.sources?.[0];
  if (!q) return null;
  const doc = PACK.documents.find((d) => d.id === q.doc);
  return { label: label || c.label, display: c.value, page: q.page, quote: q.quote, located: true, doc: doc?.title || q.doc, docId: q.doc };
}

export function condition(id) {
  return byId[id] || null;
}

const addMonths = (iso, n) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1 + n, +m[3]));
  return d.toISOString().slice(0, 10);
};

/** SCSD, Financial Closure and the latest start, from the PPA's Effective Date (or null). */
export function keyDates(ppaDate) {
  const m = PACK.model;
  if (!ppaDate) return null;
  const scsd = addMonths(ppaDate, m.scsdMonths);
  return {
    ppa: ppaDate,
    financialClosure: addMonths(scsd, -m.fcMonthsBefore),
    scsd,
    latestStart: addMonths(scsd, m.lateMonths),
  };
}

/** EMD, PBG and minimum net worth (Rs) on the installed solar MW, wind MW and storage MWh. */
export function moneyAtStake(sizes) {
  const m = PACK.model;
  const S = Math.max(0, sizes?.solarMw || 0);
  const W = Math.max(0, (sizes?.windMw || 0) + (sizes?.biomassMw || 0)); // wind and other RE
  const E = Math.max(0, sizes?.bessMwh || 0);
  const f = (k) => m[k].solarPerMw * S + m[k].windPerMw * W + m[k].storagePerMwh * E;
  return { S, W, E, emdRs: f("emdRs"), pbgRs: f("pbgRs"), netWorthRs: f("netWorthRs") };
}

/**
 * The tender's terms for the bid steps, under the bidder's planning choices. prices (the IEX hourly
 * prices, loadMarketPrices) pick the Peak Hours of the "costliest hours" plan; until they are
 * there, that plan holds every hour of the window, as "Any 6 of the 16 hours" does.
 */
export function seciTerms(settings = DEFAULT_SETTINGS, prices = null) {
  const m = PACK.model;
  const plan = PEAK_PLANS[settings.peakPlan] || PEAK_PLANS.any;
  const picked = plan.byPrice ? costliestHours(prices) : null;
  const penalty = settings.shortfall === "hard" ? null : m.penaltyMultiple;
  const dates = keyDates(settings.ppaDate);
  return {
    baseMw: PACK.tenderedMw,
    greenshoeMw: null,
    partAllowed: true,
    maxBidMw: m.maxBidMw,
    minBidMw: m.minBidMw,
    greenshoeStart: null,
    greenshoeSameTariff: null,
    rules: [
      { id: "peak", label: "Peak Hours floor (every block)", basis: "block", hours: "peak", target: m.peakFloor, penaltyMultiple: penalty },
      { id: "offpeak", label: "Off-peak floor (every block)", basis: "block", hours: "offpeak", target: m.offpeakFloor, penaltyMultiple: penalty },
    ],
    peak: { start: plan.start, hours: plan.hours, setBy: "procurer", windows: [{ start: "18:00", end: "10:00" }],
      ...(picked ? { mask: picked.mask, picked } : {}), ...(plan.byPrice && !picked ? { pricesPending: true } : {}) },
    peakAny: false,
    peakPlan: settings.peakPlan in PEAK_PLANS ? settings.peakPlan : "any",
    shortfall: penalty === null ? "hard" : "penalty",
    // solar, wind and other RE (biomass) with storage; storage is mandatory and RE-charged
    permitted: { solar: true, wind: true, hydro: false, biomass: true, thermal: false, bess: true },
    mandatory: { solar: false, bess: true },
    greenMin: null,
    solarMultiple: null,
    sale: "allowed", // power above the contracted capacity may be sold (PSA 2.11.5)
    site: null,
    years: m.years, // RfS cl. 20.2: 25 years from the SCSD
    yearsAssumed: false,
    supplyStart: dates?.scsd || null,
    ceiling: null,
    emdPerMw: null, // EMD and PBG are on installed capacity here: see moneyAtStake
    pbgPerMw: null,
    deadline: null,
    dates,
    provenance: {
      capacity: prov("bidSize", "Bid capacity"),
      maxBid: prov("bidSize", "Most one bidder may offer"),
      minBid: prov("bidSize", "Least one bidder may offer"),
      part: prov("selection", "Successful bidders"),
      sources: prov("scope", "RE sources"),
      storage: prov("ess", "Energy storage"),
      "rule.peak": prov("dfrPeak"),
      "rule.offpeak": prov("dfrOffpeak"),
      "peak.hours": { ...prov("peakHours"), display: `${plan.label} (the Buying Entity picks 6 hours between 18:00 and 10:00, day-ahead)` },
      "market.sale": prov("excess", "Sale above the contracted capacity"),
      start: prov("scsd", "Supply start"),
      years: { ...prov("term", "PPA term"), display: "25 years from the SCSD" },
      ceiling: { ...prov("ceiling", "Ceiling tariff"), display: "None stated in the RfS" },
    },
  };
}
