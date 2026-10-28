// How the winners of this tender bid ₹5.25: a bridge from this tab's benchmark tariff to the
// e-reverse auction's result, each step a run of the HiGHS sizing (200 MW, penalties allowed,
// Peak Hours on the 6 costliest IEX hours) with the inputs changed as the step says. Researched
// on 28.10.2026 from SECI's documents and public reporting; the runs used a copy of the sizing
// with Amendment-03's Solar Hours (08:00–18:00) and the 5% green-market allowance added. The
// app's own sizing now has Amendment-03 (the default profile) and gives the amd3 step's ₹7.46 and
// plant on the default 200 MW bid; the green-market purchases are not in the app. Steps marked
// estimate rest on assumptions no public source confirms.

export const RESULT = {
  rfsNo: "SECI/C&P/IPP/13/0020/25-26",
  name: "SECI-FDRE-RTC-V (this tender, renamed by Amendment-03)",
  auction: "e-reverse auction 06.08.2026",
  winners: "₹5.25–5.26 (seven bidders, 1,000 MW); NTPC at ₹5.39",
  firstRound: "₹6.26–6.99 in the sealed financial bids (median about ₹6.48); the e-RA took ₹1.0–1.2 off",
  source: "https://www.seci.co.in/uploads/tenders/bidders/SECI_FDRE-RTC-V-_1000_MW_result_website_upload.pdf",
};

const SECI = "https://www.seci.co.in/uploads/tenders/Amendment-03-SECI-FDRE-RTC-V-final_upload.pdf";
const IECC = "https://live-iecc-gspp.pantheon.berkeley.edu/wp-content/uploads/2026/08/IECC_Thermal_Mimic_Aug26_Web.pdf";
const IREDA = "https://www.ireda.in/IredaWebPortal/documents/loan-products/financing-norms.pdf";

/** Plant per contracted MW: solar MWac, wind MW, battery MW and MWh. */
const per = (solar, wind, bess, bessMwh) => ({ solar, wind, bess, bessMwh });

/** The bridge, cumulative: each step's tariff (₹/kWh) and the plant the sizing chose for it. */
export const BRIDGE = [
  { id: "base", step: "This tab's benchmark inputs, the terms before Amendment-03 (90% peak, 70% off-peak)", tariff: 6.50, plant: per(2.16, 1.56, 1.49, 5.93), basis: "Our sizing", kind: "run" },
  { id: "amd3", step: "Amendment-03's supply profile: Solar Hours at least 50% and at most 60% (08:00–18:00), Remaining Hours 70%; nothing sold", tariff: 7.46, plant: per(2.22, 1.19, 2.16, 8.62), basis: "Amendment-03, cl. 8.1.a", link: SECI, kind: "run" },
  { id: "green", step: "+ buy up to 5% of the year's energy on the green market at ₹6.0/kWh (RfS 8.1(j)); the hourly G-DAM price in those hours averaged ₹5.52", tariff: 6.90, plant: per(1.98, 1.32, 1.87, 7.47), basis: "RfS cl. 8.1(j)", kind: "run" },
  { id: "bess", step: "+ battery at ₹0.85 cr/MWh (was ₹1.20), round trip 89% (was 87%), augmentation 4% cheaper a year", tariff: 6.06, plant: per(2.28, 0.89, 2.28, 9.13), basis: "IECC (Berkeley), Aug 2026: $90/kWh", link: IECC, kind: "estimate" },
  { id: "sell", step: "+ sell the Solar Hours surplus on the IEX green day-ahead market (about ₹2.65/kWh, 165 GWh a year)", tariff: 5.80, plant: per(2.32, 1.00, 2.16, 8.66), basis: "Amendment-03, cl. 8.3", link: SECI, kind: "run" },
  { id: "finance", step: "+ debt 8.5% for 18 years at 75% gearing; equity IRR 12% (was 14%)", tariff: 5.24, plant: per(2.34, 1.01, 2.16, 8.62), basis: "IREDA norms from 01.06.2026 (8.65–9.65%); the 12% is an estimate", link: IREDA, kind: "estimate" },
  { id: "wind", step: "+ new-generation wind: CUF 37% at ₹7.0 cr/MW", tariff: 5.14, plant: per(2.26, 0.98, 2.09, 8.36), basis: "Estimate", kind: "estimate" },
];

/** The same last step with every hour of 18:00–10:00 held to 90% (the buyer may pick any 6). */
export const ANY_SIX = { tariff: 5.39, plant: per(2.67, 0.93, 2.59, 10.34) };

/** What a winner disclosed: Juniper Green Energy, 230 MW awarded (bid 300 MW), in Rajasthan. */
export const DISCLOSED = {
  who: "Juniper Green Energy (230 MW, Rajasthan)",
  plant: { solarMwp: 3.46, wind: 0.33, bessMwh: 9.6 },
  source: "https://themachinemaker.com/news/jgel-wins-seci-award-for-230-mw-rtc-renewable-power-project/",
  note: "795 MWp solar, 75 MW wind and 2,200 MWh of storage for 230 MW; it may be sized for the 300 MW it bid",
};

/** Each lever on its own, from ₹6.50 on the terms before Amendment-03. */
export const ONE_AT_A_TIME = [
  ["Battery cost (as above)", -0.71],
  ["Green-market purchases, 5%", -0.47],
  ["Wind CUF 37%", -0.39],
  ["Equity IRR 12%", -0.37],
  ["Debt 8.5%, 18 years, 75%", -0.33],
  ["Selling surplus (the old terms leave no room to sell into)", 0],
  ["Amendment-03's profile", +0.96],
  ["Peak Hours: any 6 of the 16 instead of the costliest", +0.54],
];

export const LEVERS = [
  ["Battery cost", "−₹0.7 to −0.85", "Cheaper storage moves the design to solar with 8–10 MWh of battery per MW."],
  ["Cost of capital", "−₹0.56", "Debt terms and a lower equity IRR together: the size of the cut winners made in the e-RA."],
  ["Market flexibility the tender allows", "about −₹0.8", "Buying up to 5% green power (−₹0.55) and selling the Solar Hours surplus (−₹0.27)."],
  ["Which Peak Hours the buyer picks", "±₹0.25–0.54", "The costliest evening hours, or any 6 of the 16 window hours."],
];

export const COMPARABLE = [
  ["FDRE-RTC-V (₹5.25)", "This tender, after Amendment-03: fully comparable. The app sizes it on Amendment-03's profile by default."],
  ["RTC-IV (₹5.06, May 2025)", "Easier: DFR averaged (80% a year, 75% a month, 90% over 4 fixed evening hours), not per block. On our benchmark inputs its terms give ₹6.15."],
  ["FDRE-VII, FDRE-IX (₹6.00–6.28)", "Assured-peak products: not comparable."],
];

export const NOT_VERIFIED = [
  "The winners' own capex, equity IRR and battery prices: only Juniper disclosed a configuration.",
  "Indian battery EPC prices at 2 GWh; new-turbine wind CUF; Rajasthan solar profiles (this tab's is Beed).",
  "How deep the green market is at night and at what price; whether buyers take the half-tariff Solar Hours excess.",
  "Solar Hours by state: NLDC notifies them weekly; the runs assumed 08:00–18:00.",
  "The runs are hourly over representative years, not 15-minute blocks over every year.",
];
