// SECI FDRE-RTC-V (issued as RTC-TM-V; renamed by Amendment-03): the tender's terms for the sizing and the financial model, from the tender pack
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

/** Which supply profile the floors follow: Amendment-03's (in force) or Amendment-01's, to compare. */
export const PROFILES = {
  amd3: { label: "Amendment-03 (in force)", detail: "90% in the Peak Hours; at least 50% and at most 60% in the Solar Hours, the excess offered to the buyer at half the tariff; 70% in the Remaining Hours" },
  amd1: { label: "Before Amendment-03", detail: "90% in the Peak Hours and 70% in every other block (Amendment-01), to see what the amendment changed" },
};

export const DEFAULT_SETTINGS = { peakPlan: "price", shortfall: "penalty", ppaDate: null, profile: "amd3", solarHours: null };

/** The Solar Hours the model uses (GRID-INDIA notifies them by State): the bidder's, else the pack's 08:00–18:00. */
export function solarHoursOf(settings = DEFAULT_SETTINGS) {
  const d = PACK.model.solarHours;
  const h = settings?.solarHours;
  const ok = (v) => Number.isInteger(v) && v >= 0 && v <= 24;
  return h && ok(h.start) && ok(h.end) && h.start < h.end ? { start: h.start, end: h.end } : { start: d.start, end: d.end };
}

/** 1 in every hour of the year from start to end (clock hours), else 0. */
export function solarMask({ start, end }) {
  const mask = new Uint8Array(8760);
  for (let t = 0; t < 8760; t++) mask[t] = t % 24 >= start && t % 24 < end ? 1 : 0;
  return mask;
}

/**
 * A typical SECI design per contracted MW, for the first sizing's start before there is a last
 * sizing: the HiGHS optimum of a 200 MW bid on the benchmark inputs with the costliest-hours plan,
 * nothing sold (delivered energy falls linearly over the term). Only where the sizing starts: a
 * rough start still halves the time against none (measured: 73 s against 116 s).
 * amd3: Amendment-03's profile, Solar Hours 08:00–18:00 (₹7.46/kWh, 73 s from cold);
 * amd1: the terms before it (₹6.50/kWh).
 */
const TYPICAL = {
  amd3: { tariff: 7.46, perMw: { solarMw: 2.217, windMw: 1.193, bessMw: 2.155, bessMwh: 8.622 }, deliveredFirst: 6363.5, deliveredLast: 6210.3 },
  amd1: { tariff: 6.5, perMw: { solarMw: 2.162, windMw: 1.557, bessMw: 1.485, bessMwh: 5.939 }, deliveredFirst: 7317.7, deliveredLast: 7112.9 },
};
const typicalSeedFor = (profile) => (years) => {
  const t = TYPICAL[profile];
  const n = Math.max(1, years);
  return {
    from: profile === "amd3" ? "a typical SECI FDRE-RTC-V design (Amendment-03)" : "a typical SECI RTC-TM design (before Amendment-03)",
    tariff: t.tariff,
    perMw: t.perMw,
    deliveredPerMw: Array.from({ length: n }, (_, i) => t.deliveredFirst + ((t.deliveredLast - t.deliveredFirst) * i) / Math.max(1, n - 1)),
    exportPerMw: new Array(n).fill(0),
  };
};

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
  const amd3 = settings.profile !== "amd1";
  const sh = solarHoursOf(settings);
  return {
    baseMw: PACK.tenderedMw,
    greenshoeMw: null,
    partAllowed: true,
    maxBidMw: m.maxBidMw,
    minBidMw: m.minBidMw,
    greenshoeStart: null,
    greenshoeSameTariff: null,
    rules: amd3 ? [
      { id: "peak", label: "Peak Hours floor (every block)", basis: "block", hours: "peak", target: m.peakFloor, penaltyMultiple: penalty },
      // the buyer takes at most 60% in a Solar Hour; above it, it has the first right at half the tariff
      { id: "solar", label: "Solar Hours band (every block)", basis: "block", hours: "solar", target: m.solarFloor, max: m.solarMax, excessTariffShare: m.solarExcessTariffShare, penaltyMultiple: penalty },
      { id: "remaining", label: "Remaining Hours floor (every block)", basis: "block", hours: "remaining", target: m.remainingFloor, penaltyMultiple: penalty },
    ] : [
      { id: "peak", label: "Peak Hours floor (every block)", basis: "block", hours: "peak", target: m.peakFloor, penaltyMultiple: penalty },
      { id: "offpeak", label: "Off-peak floor (every block)", basis: "block", hours: "offpeak", target: m.offpeakFloor, penaltyMultiple: penalty },
    ],
    profile: amd3 ? "amd3" : "amd1",
    // an hour the buyer picks as a Peak Hour is held as one, even inside the Solar Hours
    solar: amd3 ? { ...sh, setBy: "GRID-INDIA", mask: solarMask(sh) } : null,
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
    typicalSeed: typicalSeedFor(amd3 ? "amd3" : "amd1"),
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
      "rule.offpeak": { ...prov("dfrOffpeak"), label: "Off-peak floor", display: "At least 70% of contracted capacity in every 15-minute block outside the Peak Hours (Amendment-01)", page: 2, quote: "(ii) a minimum DFR of 70% in each time-block during the off-Peak Hours.", doc: "Amendment-01", docId: "amd1" },
      "rule.solar": prov("dfrSolar"),
      "rule.remaining": prov("dfrOffpeak"),
      "solar.hours": { ...prov("solarHours"), display: `${String(sh.start).padStart(2, "0")}:00 to ${String(sh.end).padStart(2, "0")}:00 assumed (GRID-INDIA notifies the Solar Hours by State)` },
      "market.buyerExcess": prov("excess", "Solar Hours excess"),
      "peak.hours": { ...prov("peakHours"), display: `${plan.label} (the Buying Entity picks 6 hours between 18:00 and 10:00, day-ahead)` },
      "market.sale": prov("excess", "Sale above the contracted capacity"),
      start: prov("scsd", "Supply start"),
      years: { ...prov("term", "PPA term"), display: "25 years from the SCSD" },
      ceiling: { ...prov("ceiling", "Ceiling tariff"), display: "None stated in the RfS" },
    },
  };
}
