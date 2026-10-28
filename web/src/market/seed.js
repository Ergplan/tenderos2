// Recent SECI auction results, as the trade press reported them (searched October 2026). The
// figures are the publications', not read from SECI's own result notices: open the source, and
// SECI's site, before relying on one. Each record keeps its sources; none is invented here.
export const SECI_RESULTS = [
  {
    id: "seci-rtc-iv-2025",
    agency: "SECI",
    product: "RTC (round-the-clock RE)",
    tender: "1,200 MW ISTS RTC power, RTC-IV",
    auctionDate: "2025-05-26",
    tenderedMw: 1200,
    awardedMw: 420,
    tariffUnit: "₹/kWh",
    winners: [
      { name: "Hero Solar Energy Pvt Ltd", mw: 120, tariff: 5.06 },
      { name: "Hexa Climate Solutions Pvt Ltd", mw: 100, tariff: 5.06 },
      { name: "Jindal India Power Ltd", mw: 150, tariff: 5.07 },
      { name: "Sembcorp Green Infra Pvt Ltd", mw: 50, tariff: 5.07 },
    ],
    note: "One report lists a fifth winner; the SECI-based reports list these four. CERC adopted the tariffs in an order dated 22 Nov 2025 (as reported).",
    sources: [
      { label: "Renewable Watch, 28 May 2025", url: "https://renewablewatch.in/2025/05/28/seci-announces-auction-results-for-1-2-gw-rtc-renewable-projects/" },
      { label: "Power Line, 28 May 2025", url: "https://powerline.net.in/2025/05/28/seci-announces-results-of-auction-for-1-2-gw-rtc-renewable-energy-projects/" },
      { label: "Saur Energy: CERC adopts the tariff", url: "https://www.saurenergy.com/solar-energy-news/cerc-adopts-tariff-for-secis-420-mw-round-the-clock-renewable-energy-projects-10814151" },
    ],
  },
  {
    id: "seci-fdre-rtc-1gw-2026",
    agency: "SECI",
    product: "FDRE-RTC",
    tender: "1,000 MW firm and dispatchable RE (round the clock)",
    auctionDate: "2026-08",
    tenderedMw: 1000,
    awardedMw: 1070,
    tariffUnit: "₹/kWh",
    winners: [
      { name: "Juniper Green Energy", mw: 300, tariff: 5.26 },
      { name: "Hexa Climate Solutions", mw: 150, tariff: 5.26 },
      { name: "Kengeri Prime Solar Power", mw: 180, tariff: 5.25 },
      { name: "Resolven Four Energy", mw: 150, tariff: 5.25 },
      { name: "Hero Solar Energy", mw: 120, tariff: 5.25 },
      { name: "EMIF II", mw: 100, tariff: 5.25 },
      { name: "Purvah Green Power (CESC)", mw: 70, tariff: 5.25 },
    ],
    note: "The reported awards add up to 1,070 MW against a 1,000 MW tender (a greenshoe, or a reporting error): check SECI's result. Another report gives Juniper 230 MW.",
    sources: [
      { label: "Saur Energy", url: "https://www.saurenergy.com/solar-energy-news/seci-awards-1-gw-fdre-rtc-project-at-525-526unit-to-seven-winners-12238650" },
      { label: "Energy Storage News, 10 Aug 2026", url: "https://www.ess-news.com/2026/08/10/seci-announces-winners-of-1-gw-round-the-clock-renewables-tender/" },
      { label: "SolarScope India: Hero Future Energies 120 MW", url: "https://solarscopeindia.com/hero-future-energies-wins-120-mw-fdre-rtc-project-in-seci-auction-at-%E2%82%B95-25-kwh/" },
    ],
  },
  {
    id: "seci-fdre-vii-2026",
    agency: "SECI",
    product: "FDRE peak power",
    tender: "FDRE Tranche VII (4,800 MWh peak supply)",
    auctionDate: "2026-02",
    tenderedMw: null,
    awardedMw: 1200,
    tariffUnit: "₹/kWh",
    winners: [
      { name: "Adyant Enersol (Datta Infra)", mw: 100, tariff: 6.27 },
      { name: "Serentica Renewables India", mw: 600, tariff: 6.28 },
      { name: "AMPIN Energy Utility Nine", mw: 199, tariff: 6.28 },
      { name: "ACME Solar Holdings", mw: 301, tariff: 6.28 },
    ],
    note: "A peak-power product (energy in the peak hours), not 24-hour supply.",
    sources: [
      { label: "Mercom India", url: "https://www.mercomindia.com/daily-news-wrap-up-seci-announces-winners-for-4-8-gwh-fdre-auction" },
      { label: "The Battery Magazine", url: "https://www.thebatterymagazine.com/seci-awards-peak-power-fdre-contracts-to-adyant-enersol-serentica-ampin-acme-solar/" },
    ],
  },
  {
    id: "seci-ists-xxi-solar-bess-2026",
    agency: "SECI",
    product: "Solar + BESS",
    tender: "1,200 MW ISTS solar with storage, Tranche XXI",
    auctionDate: "2026-02",
    tenderedMw: 1200,
    awardedMw: 1200,
    tariffUnit: "₹/kWh",
    winners: [
      { name: "NLC India Renewables", mw: 600, tariff: 3.12 },
      { name: "Engie Energy India", mw: null, tariff: null },
      { name: "RPIL Power Three", mw: null, tariff: null },
      { name: "Oriana Power", mw: null, tariff: null },
    ],
    tariffRange: [3.12, 3.13],
    note: "Tariffs reported at ₹3.12–3.13/kWh; the other winners' capacities were not in the reports read.",
    sources: [
      { label: "PSU Connect", url: "https://www.psuconnect.in/psu-news/nlc-india-emerges-top-winner-as-seci-discovers-3-12-kwh-tariff-in-1200-mw-solar-bess-auction" },
      { label: "SolarQuarter, 18 Feb 2026", url: "https://solarquarter.com/2026/02/18/seci-awards-over-11-gw-renewable-capacity-across-solar-hybrid-wind-and-fdre-auctions/" },
    ],
  },
];

export const SECI_SITE = "https://www.seci.co.in/";
export const TRADING_MARGIN_NOTE = "SECI sells on to the buying utilities at the discovered tariff plus its trading margin (₹0.07/kWh as reported), so compare discovered tariffs with discovered tariffs.";

/** The lowest and highest tariff of a result. */
export function tariffRange(r) {
  if (r.tariffRange) return r.tariffRange;
  const t = r.winners.map((w) => w.tariff).filter((v) => typeof v === "number");
  return t.length ? [Math.min(...t), Math.max(...t)] : [null, null];
}

/** Capacity-weighted average tariff of the winners whose capacity and tariff are known. */
export function weightedTariff(r) {
  const known = r.winners.filter((w) => typeof w.mw === "number" && typeof w.tariff === "number");
  const mw = known.reduce((a, w) => a + w.mw, 0);
  return mw > 0 ? known.reduce((a, w) => a + w.mw * w.tariff, 0) / mw : null;
}
