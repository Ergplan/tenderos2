// Plain-words notes for the What-if levers of a CfD bid: what each input is, and why moving it moves
// the strike price the model needs. The What-if step shows them under each row, with the row's own
// numbers put into a sentence (explainLever). Keys are the inputs of FIELDS (model.js).
// plain JavaScript (checked in Node): the formatters are the same as ../rtc/ui's
const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "–" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v)));
const pf = (v, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "–");

export const LEVER_NOTES = {
  contractedMw: {
    what: "The MW you bid for (50 to 150, whole MW). Every other size follows it: 2 MWh of battery per MW, the daily 2 MWh per MW of supply, the EMD and PBG.",
    why: "A bigger bid spreads the fixed costs (SECI's charges, scheduling and admin, the transmission line) over more energy, so the price needs a little less; it also needs more own solar to keep the same share of own power, which the optimiser re-sizes.",
  },
  essMwhPerMw: {
    what: "Battery energy per contracted MW. The tender needs at least 2 (2 hours at full power).",
    why: "More than 2 MWh per MW buys headroom for degradation and bad days, but it is capex (about ₹1 cr per MWh) that earns nothing on a normal day, so the price rises. Below 2 is not allowed.",
  },
  extraEssMwhPerMw: {
    what: "Battery beyond the tender's 2 MWh per MW, kept for selling in the evening hours outside your two peak hours, once the day's commitment is met.",
    why: "It earns the market price on those evenings (the Pool does not settle it) but costs capex, O&M, augmentation and charging power. It lowers the price only when the evening hours left after your peak pay more than that cost over 15 years.",
  },
  essMwPerMw: {
    what: "Battery power per contracted MW. At least 1, so the battery can deliver the full MW in each peak hour.",
    why: "More power than 1 MW per MW only lets the battery charge or discharge faster; it costs inverters and earns almost nothing on this tender, so the price barely moves.",
  },
  solarMw: {
    what: "Your own solar, co-located with the battery. Fill it and charge the battery from it instead of the market.",
    why: "Own solar replaces bought charging power (about ₹2.2/kWh) and sells its surplus at midday prices, against about ₹4 cr of capex per MWac. The first MW lower the price a lot; past the size that fills the battery the surplus sells for less than it costs, and the price turns up again. This is the lever the optimiser sets.",
  },
  windMw: {
    what: "Your own wind. It can supply the peak hours directly when it blows in the evening and charge the battery at night.",
    why: "Evening wind cuts the energy the battery must carry and the charging bought; the capex is about ₹6.5 cr per MW, so it pays only where the evening wind is good.",
  },
  reCodMonths: {
    what: "When your own solar and wind come online, in months after the SCD. The tender allows up to 21 months after the SCD (36 from the Effective Date).",
    why: "Every month without own RE, the battery is charged entirely from the market at about ₹2.2/kWh; earlier RE replaces that cost sooner, so the price falls.",
  },
  availability: {
    what: "The share of the daily 2 MWh per MW you expect to deliver, after outages and curtailment.",
    why: "Energy not delivered earns nothing and, beyond 10% a week, is penalised; so lower availability needs a higher price on the energy you do deliver.",
  },
  solarCuf: {
    what: "Capacity utilisation of your solar, on the AC side: the share of the year it runs at full power.",
    why: "A better site makes more energy from the same capex: more free charging and more surplus to sell, so the price falls.",
  },
  solarDcAc: {
    what: "The DC:AC ratio of the solar plant: MWp of modules per MWac of inverters. It shapes the hourly profile (clipping at midday) and converts capex per MWac to per MWp.",
    why: "A higher ratio gives a flatter, fuller day at the same CUF, so more of the energy falls in the hours the battery charges in; it costs more modules per MWac, which the studio prices.",
  },
  windDegradation: {
    what: "How much the wind output falls each year.",
    why: "Faster degradation means less own energy in the later years, more bought power and less surplus sold, so the price rises slightly.",
  },
  essSocMin: {
    what: "The lowest state of charge the battery is run to. Usable energy = (maximum − minimum) × nameplate.",
    why: "A wider window frees more of the nameplate for the 2 MWh per MW, so less battery is bought for the same supply and the price falls; the supplier's warranty sets the floor.",
  },
  essSocMax: {
    what: "The highest state of charge the battery is run to.",
    why: "As for the minimum: a wider window means less nameplate for the same usable energy, so the price falls.",
  },
  solarDegradation: {
    what: "How much the solar output falls each year.",
    why: "Faster degradation means less own energy in the later years, more bought power and less surplus sold, so the price rises slightly.",
  },
  windCuf: {
    what: "Capacity utilisation of your wind.",
    why: "More wind energy from the same capex: less charging bought and more direct evening supply, so the price falls.",
  },
  rte: {
    what: "Round-trip efficiency of the battery: the energy out for every unit put in.",
    why: "At 87% you buy or generate 1.15 units for every unit sold; a better battery needs less charging power, so the price falls.",
  },
  essDegradation: {
    what: "How much usable battery capacity is lost each year before augmentation tops it up.",
    why: "Faster fade means more augmentation (new cells bought every year to keep the 2 MWh per MW), so the price rises.",
  },
  marketCharges: {
    what: "What you pay on top of the exchange price for green-market power: exchange fee, transmission charges and losses.",
    why: "It is paid on every unit bought for charging, all of it in the first years and a quarter later; higher charges mean dearer charging, so the price rises.",
  },
  groupPrice: {
    what: "The price of RE bought from your group companies to charge the battery, allowed after month 36 for up to 50% of the energy.",
    why: "Group RE replaces market power when it is cheaper; a dearer group price means more market power or dearer charging, so the price rises.",
  },
  groupCharges: {
    what: "Charges on group-company power: transmission and losses.",
    why: "Paid on every unit of group RE used for charging; higher charges, dearer charging, higher price.",
  },
  priceEscalation: {
    what: "How the exchange prices move each year from today's IEX year, for both the midday charging price and the evening selling price (the F.9 path can split the two).",
    why: "Higher prices make charging dearer but the surplus you sell dearer too; which wins depends on how much surplus RE the bid sells. On the benchmark bid the surplus wins, so higher escalation lowers the price.",
  },
  gdamShareCap: {
    what: "The share of an hour's cleared GDAM volume you allow yourself to buy for charging.",
    why: "A tighter cap pushes charging into dearer hours or leaves the battery short on thin days, so the price rises; it only binds for large bids.",
  },
  recPrice: {
    what: "The price of a Renewable Energy Certificate. Energy sold in the brown markets (DAM, RTM) earns RECs; you keep half the proceeds.",
    why: "Extra income on the energy sold, so a higher REC price lowers the strike price a little.",
  },
  essCrPerMwh: {
    what: "All-in battery capex per MWh: cells, PCS, civil, EMS, everything up to the pooling station.",
    why: "The largest single cost of the bid: 200 MWh at ₹1 cr is ₹200 cr of the project. Every ₹0.01 cr per MWh is ₹2 cr of capex to recover over 15 years, so the price moves almost one to one with it.",
  },
  solarCrPerMw: {
    what: "Solar capex per MWac, with domestic cells and modules as the RfS requires.",
    why: "Paid on every MW of own solar; dearer solar means a higher price, in proportion to the solar in the bid.",
  },
  windCrPerMw: {
    what: "Wind capex per MW.",
    why: "Paid on every MW of own wind in the bid.",
  },
  evacuationCrPerMw: {
    what: "The line and bay from the plant to the ISTS substation, per contracted MW.",
    why: "A fixed cost of the connection; dearer evacuation means a higher price.",
  },
  preopPct: {
    what: "Pre-operative expenses and interest during construction, as a share of the hard cost.",
    why: "Added to the project cost before a unit is sold, so a higher share means a higher price.",
  },
  augDecline: {
    what: "How fast battery prices fall each year, which sets what the yearly augmentation (replacing faded capacity) costs.",
    why: "Faster falling prices make the later top-ups cheaper, so the price falls a little.",
  },
  essOmLakhPerMwh: {
    what: "Battery operation and maintenance per MWh a year.",
    why: "A yearly cost on the whole battery for 15 years; higher O&M, higher price.",
  },
  solarOmLakhPerMw: {
    what: "Solar O&M per MW a year.",
    why: "A yearly cost on the own solar; higher O&M, higher price, in proportion to the solar in the bid.",
  },
  windOmLakhPerMw: {
    what: "Wind O&M per MW a year.",
    why: "A yearly cost on the own wind.",
  },
  otherFixedLakhPerMw: {
    what: "Scheduling and forecasting, exchange membership, SECI's administration, audit and other fixed costs, per contracted MW a year.",
    why: "A yearly fixed cost over the term; higher means a higher price.",
  },
  insurancePct: {
    what: "Insurance as a share of the capex each year.",
    why: "A yearly cost on the whole project; higher means a higher price.",
  },
  omEscalation: {
    what: "How fast the O&M and fixed costs rise each year.",
    why: "The revenue is fixed at the strike price for 15 years, so costs that rise faster need a higher price from day one.",
  },
  pxFee: {
    what: "The exchange's fee on every unit you sell.",
    why: "Paid on the contracted supply and the surplus alike; a small lever.",
  },
  lcCostPct: {
    what: "What the bank charges each year for the Letter of Credit SECI asks for (2000 × MW × (₹10 − strike price) × 30 days).",
    why: "The LC is larger the lower your strike price; its cost is small, so this lever barely moves the price.",
  },
  pbgCostPct: {
    what: "What the bank charges each year for the EMD and the performance bank guarantee.",
    why: "A small cost before and around the SCD; a small lever.",
  },
  targetEquityIrr: {
    what: "The return your equity asks for, after tax. The strike price is solved so that the equity earns exactly this.",
    why: "The price is the direct answer to this number: a higher target needs a higher price. If you can live with a lower return, this is the cheapest rupee to find on bid day.",
  },
  debtFraction: {
    what: "The share of the project cost funded by loans; the rest is your equity.",
    why: "Debt at 9% is cheaper than equity at 14%, so more debt lowers the price, until the DSCR falls below what the lender accepts.",
  },
  interestRate: {
    what: "The interest rate on the senior loan.",
    why: "Paid on about three quarters of the project cost for the tenor; a cheaper loan lowers the price.",
  },
  tenorYears: {
    what: "How many years the loan is repaid over, within the 15-year term.",
    why: "A longer tenor spreads the principal over more years, which lowers the yearly debt service and lets the equity be paid earlier, so the price falls.",
  },
  taxRate: {
    what: "Corporate tax on the project's profit (25.17% under section 115BAA).",
    why: "A higher tax rate needs a higher price for the same after-tax return; the early years carry little tax because of depreciation.",
  },
  essLifeYears: {
    what: "The years the battery is depreciated over in the books.",
    why: "A shorter life means more depreciation each year, less tax early on, and a slightly lower price; it does not change the cash cost of the battery.",
  },
  reLifeYears: {
    what: "The years the solar and wind are depreciated over.",
    why: "As for the battery life: a timing effect on tax, a small lever.",
  },
  discountRate: {
    what: "The rate used for the levelised cost and the project NPV; it does not enter the strike price.",
    why: "The strike price is solved on the equity IRR, not on this rate, so this lever leaves it where it is.",
  },
  graceYears: {
    what: "Years after the COD in which only interest is paid, no principal (the moratorium).",
    why: "Later principal means more cash to the equity in the early years, which the IRR values most, so the price falls slightly.",
  },
  receivableDays: {
    what: "Days between selling the energy and receiving the money, which sets the working capital you must fund.",
    why: "More days tie up more cash at the working-capital interest rate, so the price rises a little.",
  },
};

/** A sentence with the row's own numbers: what one step does and how far this lever alone would have to go. */
export function explainLever(row, res, target) {
  const fmt = (v) => (row.pct ? pf(v, 2) : nf(v, row.step < 0.01 ? 4 : row.step < 1 ? 2 : 0));
  const unit = row.pct ? "" : ` ${row.unit}`;
  const up = row.priceUp - res.base;
  const down = row.priceDown - res.base;
  const dir = (d) => (Math.abs(d) < 5e-4 ? "leaves the price where it is" : `${d < 0 ? "lowers" : "raises"} it by ₹${nf(Math.abs(d), 3)} to ₹${nf(res.base + d, 3)}`);
  const parts = [
    `Now ${fmt(row.value)}${unit}; one step is ${fmt(row.step)}${unit}.`,
    `Up a step, to ${fmt(row.value + row.step)}${unit}, ${dir(up)}; down a step, to ${fmt(row.value - row.step)}${unit}, ${dir(down)}.`,
  ];
  if (Number.isFinite(target) && row.reach !== null) {
    parts.push(row.reachable
      ? `To bring the price to ₹${nf(target, 3)} with this lever alone it would have to be ${fmt(row.reach)}${unit} (${row.reach > row.value ? "up" : "down"} ${fmt(Math.abs(row.reach - row.value))}${unit}), if its effect stayed straight that far.`
      : `This lever alone cannot bring the price to ₹${nf(target, 3)} within its range (${fmt(row.min)} to ${fmt(row.max)}${unit}).`);
  }
  if (row.operation) parts.push("Moving it changes the day-by-day operation (the charging, the surplus, the shortfalls), so the model re-simulates every day of the term before pricing.");
  return parts.join(" ");
}

// ---- how far each lever can plausibly move (the track to a quote, track.js)
//
// Three bands per lever, in the input's own units (percent inputs as fractions): `sure` is where
// the bidder can put the input at will, `likely` where it lands with normal effort or a fair
// negotiation, `stretch` what takes luck or a hard bargain. Chance of a move: 100% inside the sure
// band, 50% at the likely edge, 10% at the stretch edge, 0 one stretch-width beyond it (or at the
// input's hard limit). Benchmark judgement for a 2028 project in India, not from the tender; a band
// given as a function reads the bid (X = contracted MW). Levers with no band are not the bidder's
// to choose (the tax rate, a market view).
export const LEVER_BANDS = {
  contractedMw: { sure: [50, 150], likely: [50, 150], stretch: [50, 150], who: "your bid" },
  essMwhPerMw: { sure: [2, 2.2], likely: [2, 2.5], stretch: [2, 3], who: "your design (at least 2)" },
  extraEssMwhPerMw: { sure: [0, 0], likely: [0, 1], stretch: [0, 2], who: "your design" },
  essMwPerMw: { sure: [1, 1], likely: [1, 1.25], stretch: [1, 1.5], who: "your design (at least 1)" },
  solarMw: { sure: (X) => [0, 1.5 * X], likely: (X) => [0, 2.5 * X], stretch: (X) => [0, 4 * X], who: "your design and land" },
  windMw: { sure: (X) => [0, X], likely: (X) => [0, 1.5 * X], stretch: (X) => [0, 2 * X], who: "your design and site" },
  reCodMonths: { sure: [18, 21], likely: [12, 21], stretch: [6, 21], who: "your construction plan" },
  availability: { sure: [0.95, 0.97], likely: [0.93, 0.98], stretch: [0.9, 0.985], who: "your operations" },
  solarCuf: { sure: [0.23, 0.26], likely: [0.21, 0.28], stretch: [0.19, 0.3], who: "the site you pick" },
  solarDegradation: { sure: [0.004, 0.006], likely: [0.003, 0.007], stretch: [0.0025, 0.008], who: "the module warranty" },
  solarDcAc: { sure: [1.3, 1.5], likely: [1.2, 1.7], stretch: [1.1, 2], who: "your design" },
  windDegradation: { sure: [0, 0.005], likely: [0, 0.01], stretch: [0, 0.015], who: "the turbine warranty" },
  essSocMin: { sure: [0.08, 0.12], likely: [0.05, 0.15], stretch: [0.02, 0.2], who: "the battery supplier's warranty" },
  essSocMax: { sure: [0.93, 0.97], likely: [0.9, 1], stretch: [0.85, 1], who: "the battery supplier's warranty" },
  windCuf: { sure: [0.3, 0.36], likely: [0.28, 0.4], stretch: [0.25, 0.45], who: "the site you pick" },
  rte: { sure: [0.86, 0.88], likely: [0.85, 0.9], stretch: [0.83, 0.92], who: "the battery supplier" },
  essDegradation: { sure: [0.02, 0.02], likely: [0.015, 0.025], stretch: [0.01, 0.03], who: "the battery warranty" },
  marketCharges: { sure: [0.25, 0.35], likely: [0.15, 0.45], stretch: [0.08, 0.6], who: "the exchange and the ISTS waiver" },
  groupPrice: { sure: [2.8, 3.2], likely: [2.5, 3.5], stretch: [2.2, 4], who: "your group" },
  groupCharges: { sure: [0.25, 0.35], likely: [0.15, 0.45], stretch: [0.08, 0.6], who: "the transmission route" },
  priceEscalation: { sure: [0, 0], likely: [-0.01, 0.02], stretch: [-0.03, 0.04], who: "the market, not you: a view, not a lever" },
  gdamShareCap: { sure: [0.1, 0.3], likely: [0.05, 0.5], stretch: [0.02, 1], who: "the market's depth" },
  recPrice: { sure: [100, 200], likely: [50, 400], stretch: [0, 1000], who: "the REC market" },
  essCrPerMwh: { sure: [0.7, 0.85], likely: [0.6, 0.95], stretch: [0.5, 1.1], who: "the battery supplier, for 2028 delivery" },
  solarCrPerMw: { sure: [3.8, 4.2], likely: [3.4, 4.6], stretch: [3, 5], who: "the EPC, with domestic modules" },
  windCrPerMw: { sure: [6, 7], likely: [5.5, 7.5], stretch: [5, 8.5], who: "the turbine supplier" },
  evacuationCrPerMw: { sure: [0.25, 0.35], likely: [0.15, 0.5], stretch: [0.1, 0.8], who: "the distance to the substation" },
  preopPct: { sure: [0.04, 0.06], likely: [0.03, 0.08], stretch: [0.02, 0.1], who: "your construction schedule and drawdown" },
  augDecline: { sure: [0.04, 0.06], likely: [0.02, 0.08], stretch: [0, 0.12], who: "the battery market" },
  essOmLakhPerMwh: { sure: [1.1, 1.3], likely: [0.9, 1.6], stretch: [0.7, 2], who: "the O&M contract" },
  solarOmLakhPerMw: { sure: [3.5, 4.5], likely: [3, 5.5], stretch: [2.5, 7], who: "the O&M contract" },
  windOmLakhPerMw: { sure: [8, 10], likely: [7, 12], stretch: [6, 14], who: "the O&M contract" },
  otherFixedLakhPerMw: { sure: [1.5, 2.5], likely: [1, 3], stretch: [0.5, 4], who: "your overheads" },
  insurancePct: { sure: [0.0025, 0.0035], likely: [0.002, 0.004], stretch: [0.0015, 0.005], who: "the insurer" },
  omEscalation: { sure: [0.045, 0.055], likely: [0.035, 0.06], stretch: [0.03, 0.07], who: "the O&M contract" },
  pxFee: { sure: [0.02, 0.02], likely: [0.015, 0.025], stretch: [0.01, 0.03], who: "the exchange" },
  lcCostPct: { sure: [0.008, 0.012], likely: [0.005, 0.015], stretch: [0.003, 0.02], who: "your bank" },
  pbgCostPct: { sure: [0.008, 0.012], likely: [0.005, 0.015], stretch: [0.003, 0.02], who: "your bank" },
  targetEquityIrr: { sure: [0.13, 0.15], likely: [0.12, 0.16], stretch: [0.1, 0.18], who: "your board" },
  debtFraction: { sure: [0.7, 0.75], likely: [0.65, 0.8], stretch: [0.6, 0.85], who: "the lender (DSCR permitting)" },
  interestRate: { sure: [0.0875, 0.0925], likely: [0.08, 0.1], stretch: [0.075, 0.11], who: "the lender" },
  tenorYears: { sure: [10, 13], likely: [8, 15], stretch: [7, 15], who: "the lender, within the 15-year term" },
  taxRate: null,
  essLifeYears: { sure: [12, 15], likely: [10, 15], stretch: [8, 20], who: "your auditor" },
  reLifeYears: { sure: [25, 25], likely: [20, 30], stretch: [15, 35], who: "your auditor" },
  discountRate: null,
  "fin.receivableDays": { sure: [30, 45], likely: [15, 60], stretch: [7, 90], who: "the exchange's settlement cycle" },
  "fin.graceYears": { sure: [0, 0], likely: [0, 1], stretch: [0, 2], who: "the lender" },
};

const bandOf = (band, X) => (typeof band === "function" ? band(X) : band);

/**
 * The chance (0 to 1) that a lever ends up at `value`, from its value in the bid, by the bands
 * above: 1 inside the sure band, 0.5 at the likely edge, 0.1 at the stretch edge, 0 one
 * stretch-width beyond it or at the lever's hard limit. `edges` gives those four values for the
 * direction of the move, so the screen can say "likely to X (50%), stretch to Y (10%)".
 */
export function leverChance(lever, value, inputs) {
  const bands = LEVER_BANDS[lever.key];
  if (!bands) return { p: Math.abs(value - lever.value) < 1e-12 ? 1 : 0, edges: null, fixed: true };
  const X = inputs?.contractedMw || 100;
  const dir = value > lever.value ? 1 : value < lever.value ? -1 : 0;
  if (dir === 0) return { p: 1, edges: null, fixed: false };
  const side = dir > 0 ? 1 : 0;
  const edge = (b) => {
    const e = bandOf(b, X)[side];
    return dir > 0 ? Math.max(e, lever.value) : Math.min(e, lever.value); // the bid's own value counts as reachable
  };
  const sure = edge(bands.sure);
  const likely = dir > 0 ? Math.max(edge(bands.likely), sure) : Math.min(edge(bands.likely), sure);
  const stretch = dir > 0 ? Math.max(edge(bands.stretch), likely) : Math.min(edge(bands.stretch), likely);
  const hard = dir > 0 ? lever.max : lever.min;
  let zero = stretch + dir * Math.abs(stretch - likely);
  zero = dir > 0 ? Math.min(zero, hard) : Math.max(zero, hard);
  const d = (a, b) => Math.abs(b - a);
  const dist = d(lever.value, value);
  const seg = (from, to, pFrom, pTo) => {
    const w = d(from, to);
    if (w < 1e-12) return pTo;
    return pFrom + ((pTo - pFrom) * (dist - d(lever.value, from))) / w;
  };
  let p;
  if (dist <= d(lever.value, sure) + 1e-12) p = 1;
  else if (dist <= d(lever.value, likely) + 1e-12) p = seg(sure, likely, 1, 0.5);
  else if (dist <= d(lever.value, stretch) + 1e-12) p = seg(likely, stretch, 0.5, 0.1);
  else if (dist <= d(lever.value, zero) + 1e-12) p = seg(stretch, zero, 0.1, 0);
  else p = 0;
  return { p: Math.max(0, Math.min(1, p)), edges: { sure, likely, stretch, zero, dir }, fixed: false, who: bands.who };
}
