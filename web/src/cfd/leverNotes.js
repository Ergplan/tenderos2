// Plain-words notes for the What-if levers of a CfD bid: what each input is, and why moving it moves
// the strike price the model needs. The What-if step shows them under each row, with the row's own
// numbers put into a sentence (explainLever). Keys are the inputs of FIELDS (model.js).
import { nf, pf } from "../rtc/ui";

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
