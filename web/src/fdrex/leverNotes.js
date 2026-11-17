// Plain-words notes for the What-if levers of a SECI-FDRE-X bid: what each input is, and why moving
// it moves the tariff the model needs. The What-if step shows them under each row, with the row's
// own numbers put into a sentence (explainLever). Keys are the inputs of FIELDS (./model.js) and the
// two finance terms levers.js adds. Forked from the CfD-I tab's notes (web/src/cfd/leverNotes.js):
// the notes for what this tender does not have (the RE commissioning date, group-company RE, RECs,
// the Letter of Credit) are gone, and the rest are written for a PPA at a fixed tariff: 4 MWh per
// MW a day in the buyer's four hours, a monthly penalty at 1.5 x the tariff, 5% bought power, 25 years.
// Plain JavaScript (no browser APIs): the formatters are the same as ../rtc/ui's.
import { TENDER } from "./tender.js";

const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "–" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v)));
const pf = (v, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "–");

// the tender's numbers the notes speak of (./tender.js)
const E4 = TENDER.mwhPerMwDay; // MWh per contracted MW a day
const YEARS = TENDER.termYears;
const TOL = `${Math.round(TENDER.shortfallTolerance * 100)}%`;
const PEN = `${TENDER.penaltyMultiple} × the tariff`;
const BOUGHT = `${Math.round(TENDER.marketShare * 100)}%`;

export const LEVER_NOTES = {
  contractedMw: {
    what: `The MW you bid for (${TENDER.bidMinMw} to ${TENDER.bidMaxMw}, whole MW). Every other size follows it: the battery for the buyer's four hours, the daily ${E4} MWh per MW of supply, the EMD and PBG.`,
    why: `Nearly every cost scales with the MW (the battery, the own solar, SECI's Success Charges, the EMD and PBG), so the size barely moves the tariff: what it changes is the money at stake and your share of the ${nf(TENDER.totalMw)} MW. In the What-if the own solar and wind scale with the bid, so the move is the size alone and not a change of the mix behind it; any size from ${TENDER.bidMinMw} to ${TENDER.bidMaxMw} MW is yours to choose.`,
  },
  essMwhPerMw: {
    what: `Battery energy per contracted MW. The model needs at least ${TENDER.essHoursMin}: the buyer names its four hours each morning, so the battery must be able to carry the whole ${E4} MWh per MW. The RfS itself sets no minimum battery size.`,
    why: `More than ${TENDER.essHoursMin} MWh per MW buys headroom for degradation and bad days, but it is capex (about ₹1 cr per MWh at the benchmark) that earns nothing on a normal day, so the tariff rises. The model does not go below ${TENDER.essHoursMin}.`,
  },
  extraEssMwhPerMw: {
    what: `Battery beyond the four hours' ${E4} MWh per MW, kept for selling on the exchange in the evening hours outside the buyer's four hours, once the day's supply is met (RfS 8.1.f, PPA 4.4.1.a.iv).`,
    why: `It earns the exchange price in those hours (in the model, the two evening hours the buyer leaves) but costs capex, O&M, augmentation and charging energy. Bought power for it sits inside the same ${BOUGHT} limit as the supply, so in practice your own RE must charge it; that energy costs nothing where the day's surplus would otherwise be curtailed (non-solar-hour access only). It lowers the tariff only when those hours pay more than its cost over ${YEARS} years.`,
  },
  essMwPerMw: {
    what: "Battery power per contracted MW. At least 1, so the battery can deliver 1 MWh per MW in each of the buyer's hours (RfS 8.1.c).",
    why: "More power than 1 MW per MW only lets the battery charge or discharge faster. The model prices the battery per MWh, so the tariff barely moves; a supplier's quote for a faster battery will be dearer per MWh.",
  },
  solarMw: {
    what: `Your own solar, co-located with the battery (RfS 6.1). It is what charges the battery: bought power may be at most ${BOUGHT} of a year's energy (RfS 8.1.e) and grid charging beyond that is not allowed (PPA 4.4.1.a.vii).`,
    why: `Too little solar leaves days short, and a billing month's shortfall beyond ${TOL} costs ${PEN}. More solar than the battery needs is surplus, against about ₹4 cr of capex per MWac at the benchmark: curtailed in the day where the bid has connectivity with non-solar-hour access only (RfS 7.2), sold at midday exchange prices where it holds the solar hours too. So the tariff has a lowest point between the two. This is the lever the optimiser sets.`,
  },
  windMw: {
    what: "Your own wind. It can supply the buyer's hours directly when it blows in the evening, and charge the battery before then.",
    why: "Evening wind cuts the energy the battery must carry and the solar needed to charge it; the capex is about ₹6.5 cr per MW at the benchmark, so it pays only where the evening wind is good.",
  },
  availability: {
    what: `The share of the daily ${E4} MWh per MW you expect to deliver, after outages.`,
    why: `Energy not delivered is not paid for and, beyond ${TOL} of a billing month's requirement, is penalised at ${PEN} (RfS 8.2); so lower availability needs a higher tariff on the energy you do deliver.`,
  },
  solarCuf: {
    what: "Capacity utilisation of your solar, on the AC side: the share of the year it runs at full power.",
    why: "A better site makes more energy from the same capex: the battery is charged from fewer MW (and, with solar-hour connectivity, more surplus is sold), so the tariff falls.",
  },
  solarDcAc: {
    what: "The DC:AC ratio of the solar plant: MWp of modules per MWac of inverters. Capex per MWac divided by the ratio is the capex per MWp.",
    why: "At a given AC CUF the typical hourly profile is pinned by the CUF, so the ratio alone does not move the tariff here. It matters in the design studio, where it sets the modules bought and the clipping at midday.",
  },
  windDegradation: {
    what: "How much the wind output falls each year.",
    why: "Faster degradation means less own energy in the later years: less direct evening supply and less surplus to sell, so the tariff rises slightly.",
  },
  essSocMin: {
    what: "The lowest state of charge the battery is run to. Usable energy = (maximum − minimum) × nameplate.",
    why: `A wider window frees more of the nameplate for the ${E4} MWh per MW, so less battery need be bought for the same supply: the tariff falls once the battery energy is cut to match. The supplier's warranty sets the floor.`,
  },
  essSocMax: {
    what: "The highest state of charge the battery is run to.",
    why: "As for the minimum: a wider window means less nameplate for the same usable energy, so the tariff falls once the battery energy is cut to match.",
  },
  solarDegradation: {
    what: "How much the solar output falls each year.",
    why: `Faster degradation means less own energy in the later years: less surplus to sell and, where the solar is sized close, days short towards the end of the ${YEARS} years. The tariff rises slightly.`,
  },
  windCuf: {
    what: "Capacity utilisation of your wind.",
    why: "More wind energy from the same capex: more direct evening supply and less for the battery to carry, so the tariff falls.",
  },
  rte: {
    what: "Round-trip efficiency of the battery: the energy out for every unit put in.",
    why: "At 87% you generate 1.15 units for every unit the battery supplies; a better battery needs less solar for the same supply, so the tariff falls.",
  },
  essDegradation: {
    what: "How much usable battery capacity is lost each year before augmentation tops it up.",
    why: `Faster fade means more augmentation (new cells bought every year to keep the ${E4} MWh per MW), so the tariff rises.`,
  },
  marketCharges: {
    what: "What you pay on top of the exchange price for green-market power: exchange fee, transmission charges and losses.",
    why: `Paid on every unit bought for charging, and that is at most ${BOUGHT} of a year's energy (RfS 8.1.e). Higher charges make that power dearer, so the tariff rises, but only a little.`,
  },
  priceEscalation: {
    what: "How the exchange prices move each year from today's IEX year: the green-market price of the power you buy, and the prices your surplus RE and any extra battery sell at (the price scenario on the Financial model step can split the midday and the evening path).",
    why: "The PPA supply earns the fixed tariff whatever the exchange does. Higher prices make the little power you buy dearer, so a bid that sells nothing (non-solar-hour access only, no extra battery) needs a slightly higher tariff. A bid that sells surplus RE in the day or an extra battery's energy gains more than it pays, so there higher escalation lowers the tariff. It is a view of the market, not something you set.",
  },
  gdamShareCap: {
    what: "The share of an hour's cleared GDAM volume you allow yourself to buy for charging.",
    why: "A tighter cap pushes the buying into dearer hours or leaves the battery short on thin days, so the tariff rises; it only binds for large bids or a very low cap.",
  },
  essCrPerMwh: {
    what: "All-in battery capex per MWh: cells, PCS, civil, EMS, everything up to the pooling station.",
    why: `The largest single cost of the bid: for 100 MW, ${nf(100 * TENDER.essHoursMin)} MWh at ₹1 cr per MWh is ₹${nf(100 * TENDER.essHoursMin)} cr of the project. Every ₹0.01 cr per MWh is ₹${nf(TENDER.essHoursMin)} cr of capex to recover over ${YEARS} years, and the yearly augmentation is bought on the same price path.`,
  },
  solarCrPerMw: {
    what: "Solar capex per MWac, with modules and cells from the ALMM lists, as the RfS requires.",
    why: "Paid on every MW of own solar; dearer solar means a higher tariff, in proportion to the solar in the bid.",
  },
  windCrPerMw: {
    what: "Wind capex per MW.",
    why: "Paid on every MW of own wind in the bid.",
  },
  evacuationCrPerMw: {
    what: "The line and bay from the plant to the ISTS substation, per contracted MW (RfS 7.4: at your cost).",
    why: "A fixed cost of the connection; dearer evacuation means a higher tariff.",
  },
  preopPct: {
    what: "Pre-operative expenses and interest during construction, as a share of the hard cost.",
    why: "Added to the project cost before a unit is supplied, so a higher share means a higher tariff.",
  },
  augDecline: {
    what: "How fast battery prices fall each year, which sets what the yearly augmentation (replacing faded capacity) costs.",
    why: "Faster falling prices make the later top-ups cheaper, so the tariff falls a little.",
  },
  essOmLakhPerMwh: {
    what: "Battery operation and maintenance per MWh a year.",
    why: `A yearly cost on the whole battery for ${YEARS} years; higher O&M, higher tariff.`,
  },
  solarOmLakhPerMw: {
    what: "Solar O&M per MW a year.",
    why: "A yearly cost on the own solar; higher O&M, higher tariff, in proportion to the solar in the bid.",
  },
  windOmLakhPerMw: {
    what: "Wind O&M per MW a year.",
    why: "A yearly cost on the own wind.",
  },
  otherFixedLakhPerMw: {
    what: "Scheduling and forecasting, fees, audit, administration and other fixed costs, per contracted MW a year.",
    why: "A yearly fixed cost over the term; higher means a higher tariff.",
  },
  insurancePct: {
    what: "Insurance as a share of the capex each year.",
    why: "A yearly cost on the whole project; higher means a higher tariff.",
  },
  omEscalation: {
    what: "How fast the O&M and fixed costs rise each year.",
    why: `The tariff is fixed for the ${YEARS} years (PPA 9.1), so costs that rise faster need a higher tariff from day one.`,
  },
  pxFee: {
    what: "The exchange's fee on every unit you sell in the market: the surplus RE (where the bid holds solar-hour connectivity) and any extra battery's evening sale.",
    why: "The PPA supply goes to the buyer and is not sold on an exchange, so the fee is paid on the market sales only: a small lever, and none at all for a bid that sells nothing.",
  },
  pbgCostPct: {
    what: "What the bank charges each year for the EMD and the Performance Bank Guarantee.",
    why: `The EMD runs for ${TENDER.emdValidityMonths} months from the bid deadline and the PBG until ${TENDER.pbgAfterScdMonths} months after the SCSD: a small cost before and just after supply starts; a small lever.`,
  },
  targetEquityIrr: {
    what: "The return your equity asks for, after tax. The tariff is solved so that the equity earns exactly this.",
    why: "The tariff is the direct answer to this number: a higher target needs a higher tariff. If you can live with a lower return, this is the cheapest rupee to find on bid day.",
  },
  debtFraction: {
    what: "The share of the project cost funded by loans; the rest is your equity.",
    why: "Debt (about 9% at the benchmark) is cheaper than equity (about 14%), so more debt lowers the tariff, until the DSCR falls below what the lender accepts.",
  },
  interestRate: {
    what: "The interest rate on the senior loan.",
    why: "Paid on about three quarters of the project cost for the tenor; a cheaper loan lowers the tariff.",
  },
  tenorYears: {
    what: `How many years the loan is repaid over, within the ${YEARS}-year term of the PPA.`,
    why: "A longer tenor spreads the principal over more years, which lowers the yearly debt service and lets the equity be paid earlier, so the tariff falls. Where the repayment is sculpted to the lender's DSCR, the schedule follows the cash flow and the tenor may not move the tariff.",
  },
  taxRate: {
    what: "Corporate tax on the project's profit (25.17% under section 115BAA).",
    why: "A higher tax rate needs a higher tariff for the same after-tax return; the early years carry little tax because of depreciation.",
  },
  essLifeYears: {
    what: "The years the battery is depreciated over in the books.",
    why: "Book depreciation only: the full financial model takes the tax depreciation and the book life from the Finance inputs, so this changes the reported profit, not the cash, and leaves the tariff where it is.",
  },
  reLifeYears: {
    what: "The years the solar and wind are depreciated over in the books.",
    why: "As for the battery life: it does not change the cash, so the tariff stays where it is.",
  },
  discountRate: {
    what: "The rate used for the levelised cost and the project NPV; it does not enter the tariff.",
    why: "The tariff is solved on the equity IRR, not on this rate, so this lever leaves it where it is.",
  },
  graceYears: {
    what: "Years after the start of supply in which only interest is paid, no principal (the moratorium).",
    why: "Later principal means more cash to the equity in the early years, which the IRR values most, so the tariff falls.",
  },
  receivableDays: {
    what: "Days between supplying the energy and SECI's payment, which sets the working capital you must fund. The monthly bill falls due on the 45th day after SECI receives it (PPA, Due Date).",
    why: "More days tie up more cash, so the tariff rises a little.",
  },
};

/** A sentence with the row's own numbers: what one step does and how far this lever alone would have to go. */
export function explainLever(row, res, target) {
  const fmt = (v) => (row.pct ? pf(v, 2) : nf(v, row.step < 0.01 ? 4 : row.step < 1 ? 2 : 0));
  const unit = row.pct ? "" : ` ${row.unit}`;
  const up = row.priceUp - res.base;
  const down = row.priceDown - res.base;
  const dir = (d) => (Math.abs(d) < 5e-4 ? "leaves the tariff where it is" : `${d < 0 ? "lowers" : "raises"} the tariff by ₹${nf(Math.abs(d), 3)} to ₹${nf(res.base + d, 3)}`);
  const parts = [
    `Now ${fmt(row.value)}${unit}; one step is ${fmt(row.step)}${unit}.`,
    `Up a step, to ${fmt(row.value + row.step)}${unit}, ${dir(up)}; down a step, to ${fmt(row.value - row.step)}${unit}, ${dir(down)}.`,
  ];
  if (Number.isFinite(target) && row.reach !== null) {
    parts.push(row.reachable
      ? `To bring the tariff to ₹${nf(target, 3)} with this lever alone it would have to be ${fmt(row.reach)}${unit} (${row.reach > row.value ? "up" : "down"} ${fmt(Math.abs(row.reach - row.value))}${unit}), if its effect stayed straight that far.`
      : `This lever alone cannot bring the tariff to ₹${nf(target, 3)} within its range (${fmt(row.min)} to ${fmt(row.max)}${unit}).`);
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
// input's hard limit). Benchmark judgement for a 2028 project in India (the SCSD is 18 months from
// the Effective Date), not from the tender; a band given as a function reads the bid (X = contracted
// MW). Levers with no band are not the bidder's to choose (the tax rate, a market view). Every band
// lies within the input's range in FIELDS (./model.js).
export const LEVER_BANDS = {
  contractedMw: { sure: [TENDER.bidMinMw, TENDER.bidMaxMw], likely: [TENDER.bidMinMw, TENDER.bidMaxMw], stretch: [TENDER.bidMinMw, TENDER.bidMaxMw], who: "your bid" },
  essMwhPerMw: { sure: [4, 4.4], likely: [4, 5], stretch: [4, 6], who: "your design (at least 4)" },
  extraEssMwhPerMw: { sure: [0, 0], likely: [0, 1], stretch: [0, 2], who: "your design" },
  essMwPerMw: { sure: [1, 1], likely: [1, 1.25], stretch: [1, 1.5], who: "your design (at least 1)" },
  solarMw: { sure: (X) => [0, 1.5 * X], likely: (X) => [0, 2.5 * X], stretch: (X) => [0, 4 * X], who: "your design and land" },
  windMw: { sure: (X) => [0, X], likely: (X) => [0, 1.5 * X], stretch: (X) => [0, 2 * X], who: "your design and site" },
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
  marketCharges: { sure: [0.25, 0.35], likely: [0.15, 0.45], stretch: [0.08, 0.6], who: "the exchange and the transmission charges on bought power" },
  priceEscalation: { sure: [0, 0], likely: [-0.01, 0.02], stretch: [-0.03, 0.04], who: "the market, not you: a view, not a lever" },
  gdamShareCap: { sure: [0.1, 0.3], likely: [0.05, 0.5], stretch: [0.02, 1], who: "the market's depth" },
  essCrPerMwh: { sure: [0.7, 0.85], likely: [0.6, 0.95], stretch: [0.5, 1.1], who: "the battery supplier, for 2028 delivery" },
  solarCrPerMw: { sure: [3.8, 4.2], likely: [3.4, 4.6], stretch: [3, 5], who: "the EPC, with modules and cells from the ALMM lists" },
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
  pbgCostPct: { sure: [0.008, 0.012], likely: [0.005, 0.015], stretch: [0.003, 0.02], who: "your bank" },
  targetEquityIrr: { sure: [0.13, 0.15], likely: [0.12, 0.16], stretch: [0.1, 0.18], who: "your board" },
  debtFraction: { sure: [0.7, 0.75], likely: [0.65, 0.8], stretch: [0.6, 0.85], who: "the lender (DSCR permitting)" },
  interestRate: { sure: [0.0875, 0.0925], likely: [0.08, 0.1], stretch: [0.075, 0.11], who: "the lender" },
  tenorYears: { sure: [15, 18], likely: [12, 20], stretch: [10, 22], who: `the lender, within the ${TENDER.termYears}-year term` },
  taxRate: null,
  essLifeYears: { sure: [20, 25], likely: [15, 25], stretch: [12, 30], who: "your auditor" },
  reLifeYears: { sure: [25, 25], likely: [20, 30], stretch: [15, 35], who: "your auditor" },
  discountRate: null,
  "fin.receivableDays": { sure: [45, 60], likely: [30, 75], stretch: [10, 90], who: "SECI's payment of the monthly bill (due on the 45th day after it is received)" },
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
