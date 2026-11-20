// SECI-FDRE-X against the market: what the earlier auctions of the same product discovered, the
// benchmark inputs this tab fills in (current market prices where a source gives one), and a bridge
// from the older benchmark inputs to those results, each step a run of this tab's own sizing
// (HiGHS, sales only on days the supply is met) priced by the financial model. Plain JavaScript.
//
// Researched on 20.11.2026. The auction results are from SECI's result notices (the same rows as
// site/public/data/seci-results.json) and, for SJVN, CERC's tariff adoption order. No winner has
// published its capex, debt terms or equity IRR: the last two steps of the bridge are estimates
// and are marked so.

const JMK_OCT = "https://ieefa.org/sites/default/files/2026-10/ESSjmk-1026_0.pdf";
const IECC = "https://live-iecc-gspp.pantheon.berkeley.edu/wp-content/uploads/2026/08/IECC_Thermal_Mimic_Aug26_Web.pdf";
const IREDA = "https://www.ireda.in/IredaWebPortal/documents/loan-products/financing-norms.pdf";

/** The auctions of the same product: 4 MWh per contracted MW a day in four peak hours, 25 years, ₹/kWh on the energy supplied. */
export const RESULTS = [
  { id: "fdre-vi", tender: "SECI-FDRE-VI", quantity: "2,000 MW × 4 h", auction: "2025-01-02", low: 8.5, high: 8.5,
    note: "Only 820 MW was bid; 200 MW awarded. The sealed bids were ₹9.68 to ₹9.99.",
    source: "https://www.seci.co.in/Upload/Bidder/638724572197307981.pdf" },
  { id: "sjvn-fdre-4", tender: "SJVN FDRE-4", quantity: "1,500 MW × 4 h", auction: "2025-10-09", low: 6.74, high: 6.75,
    note: "All winners matched ₹6.74; the sealed bids started at ₹7.45.",
    source: "https://cercind.gov.in/2026/orders/31-AT-2026.pdf" },
  { id: "fdre-vii", tender: "SECI-FDRE-VII", quantity: "1,200 MW × 4 h", auction: "2026-02-05", low: 6.27, high: 6.28,
    note: "Four winners; the sealed bids were ₹6.87 to ₹9.90. CERC adopted the tariffs in October 2026.",
    source: "https://www.seci.co.in/uploads/tenders/bidders/SECI_FDRE-VII-_4800_MWh_result_website_upload.pdf" },
  { id: "fdre-ix", tender: "SECI-FDRE-IX", quantity: "1,500 MW × 4 h", auction: "2026-08-21", low: 5.99, high: 6.0,
    note: "Three winners; the sealed bids were ₹6.92 to ₹8.25: the e-reverse auction took about ₹0.9 off.",
    source: "https://www.seci.co.in/uploads/tenders/bidders/SECI_FDRE-IX-_6000_MWh_result_website_upload.pdf" },
];
/** The latest result: what a bid in this tender will be measured against. */
export const LATEST = RESULTS[RESULTS.length - 1];

/**
 * The benchmark inputs this tab fills in where they differ from the Tender to Bid ones
 * (web/src/bid/model.js BENCHMARKS): the battery at the current benchmark price, and project debt
 * on the lenders' current terms.
 */
export const FDREX_BENCHMARKS = {
  bess: { capex: 0.8 }, // ₹ cr/MWh: CTUIL's BESS benchmark (JMK Research / IEEFA, October 2026); was 1.20
  fin: { debtFraction: 0.75, tenorYears: 18 }, // IREDA's norms for RE projects; were 70% and 15 years
};
export const BENCHMARK_SOURCES = [
  { what: "Battery ₹0.80 cr/MWh", basis: "CTUIL's BESS benchmark; LFP cells $62–67/kWh landed in India (JMK Research / IEEFA, October 2026). IECC (Berkeley) used $90/kWh in August 2026.", link: JMK_OCT },
  { what: "Debt 75% for 18 years", basis: "IREDA's financing norms for RE projects (interest 8.65–9.65% from 01.06.2026; the tab fills 9%).", link: IREDA },
];

/** The inputs of the bridge's last step: what the recent winning tariffs imply. The last two are estimates. */
export const MARKET_CASE = {
  src: { bess: { capex: 0.8 }, wind: { cuf: 0.37, capex: 7.0 } },
  fin: { debtFraction: 0.75, tenorYears: 18, interestRate: 0.085, targetEquityIrr: 0.12 },
};

/** Plant per contracted MW: solar MWac, wind MW, battery MW and MWh. */
const per = (solar, wind, bess, bessMwh) => ({ solar, wind, bess, bessMwh });

/**
 * The bridge, cumulative, on a 100 MW bid (the buyer's four costliest hours, the penalty allowed,
 * 5% bought, the surplus sold on IEX GDAM on the days the supply is met): each step's tariff from
 * the financial model at the step's target equity IRR, the plant HiGHS chose, and the days of
 * year 1 met in full.
 */
export const BRIDGE = [
  { id: "old", label: "Older benchmarks", step: "The Tender to Bid benchmarks: battery ₹1.20 cr/MWh, debt 70% at 9% for 15 years, equity IRR 14%, wind 33% CUF at ₹6.5 cr/MW",
    tariff: 9.02, plant: per(0.13, 1.09, 0.76, 3.03), metDays: 246, basis: "CERC norms and 2025 prices", kind: "run" },
  { id: "bess", label: "Battery", step: "+ battery at ₹0.80 cr/MWh (was ₹1.20)",
    tariff: 7.51, plant: per(0.16, 0.96, 0.81, 3.25), metDays: 254, basis: "CTUIL benchmark, October 2026", link: JMK_OCT, kind: "run" },
  { id: "debt", label: "Debt terms", step: "+ debt 75% for 18 years (was 70% for 15): what this tab now fills in",
    tariff: 7.11, plant: per(0.10, 1.09, 0.79, 3.16), metDays: 260, basis: "IREDA financing norms", link: IREDA, kind: "run", filled: true },
  { id: "rate", label: "Interest", step: "+ debt at 8.5% (was 9%)",
    tariff: 6.89, plant: per(0.10, 1.09, 0.79, 3.17), metDays: 266, basis: "IREDA norms from 01.06.2026: 8.65–9.65%; the best-rated borrowers below", link: IREDA, kind: "estimate" },
  { id: "irr", label: "Equity IRR", step: "+ equity IRR 12% (was 14%)",
    tariff: 6.35, plant: per(0.10, 1.09, 0.79, 3.17), metDays: 264, basis: "Estimate: no winner has published its return", kind: "estimate" },
  { id: "wind", label: "Wind", step: "+ new-generation wind: 37% CUF at ₹7.0 cr/MW (was 33% at ₹6.5)",
    tariff: 5.8, plant: per(0.02, 1.09, 0.76, 3.05), metDays: 277, basis: "Estimate", kind: "estimate" },
];

/** Until this date the tab valued a sale at most at the tariff and sold on short days too: what it showed on the older benchmarks. */
export const BEFORE_FIX = { tariff: 8.55, note: "counted sales on days the supply was short, which the RfS penalises (8.1.f)" };

export const NOT_VERIFIED = [
  "No winner of FDRE-VI, VII, IX or SJVN FDRE-4 has published its capex, battery price, debt terms or equity IRR.",
  "Equity IRR 12% and wind at 37% CUF are estimates: they are what brings this model to the discovered tariffs, not facts about any bidder.",
  "The sale of surplus is at the last year's IEX prices held for 25 years; a lender will count less of it than the model does.",
  "IECC (Berkeley, August 2026) took a 10% WACC and $90/kWh batteries for the ₹5.25 RTC result; each $10/kWh moved that tariff by ₹0.28.",
];
export const SOURCES = { JMK_OCT, IECC, IREDA };

/** The bid with the market case's inputs (the sizing is cleared: size again). */
export function applyMarketCase(state) {
  const src = { ...state.src };
  for (const [id, values] of Object.entries(MARKET_CASE.src)) src[id] = { ...src[id], ...values };
  const filled = { ...(state.filled || {}) };
  for (const [id, values] of Object.entries(MARKET_CASE.src)) for (const k of Object.keys(values)) delete filled[`${id}.${k}`];
  for (const k of Object.keys(MARKET_CASE.fin)) delete filled[`fin.${k}`];
  return { ...state, src, fin: { ...state.fin, ...MARKET_CASE.fin }, filled, lp: null };
}

/** Where a tariff stands against the latest result: { gap, words }. */
export function againstMarket(tariff) {
  if (!Number.isFinite(tariff)) return null;
  const gap = tariff - LATEST.high;
  const within = tariff >= LATEST.low - 0.005 && tariff <= RESULTS[RESULTS.length - 2].high + 0.005;
  return {
    gap,
    words: gap <= 0.005 ? `at or below ${LATEST.tender}'s ₹${LATEST.low.toFixed(2)}–${LATEST.high.toFixed(2)}`
      : within ? `between ${LATEST.tender} (₹${LATEST.high.toFixed(2)}) and FDRE-VII (₹${RESULTS[RESULTS.length - 2].high.toFixed(2)})`
        : `₹${gap.toFixed(2)} above ${LATEST.tender}'s ₹${LATEST.high.toFixed(2)}`,
  };
}
