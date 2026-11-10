// What wins SECI CfD-I, from the bid's own model: the evening price the plant sells into, the
// CfD Pool's net flow at a range of strike prices (who pays whom), the award test Amendment-04
// added (RfS 42.2.b: the capacity awarded is what the corpus carries at the discovered tariff),
// and the risks that stay with the bidder once the market price risk is the Pool's. Plain
// JavaScript: the Reference bids step shows it, the manual quotes it, tools/check_cfd_winning.mjs
// checks it.
import { poolFlows } from "./model.js";
import { TENDER } from "./terms.js";
import { DSM_DEFAULTS, dsmCategory, dsmChargeCr, dsmUnitCharge } from "../dsm/dsm.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const nf = (v, d = 0) => (isNum(Number(v)) ? new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v)) : "–");
const pf = (v, d = 1) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : "–");

/** The full Contract Years (the first and last are part years). */
const fullYears = (model) => model.sim.years.filter((y) => y.days >= 300);

/** The average market price in the two evening hours the plant chooses, over the term's price year, ₹/kWh. */
export function eveningMcp(model) {
  const ys = fullYears(model);
  const mwh = ys.reduce((a, y) => a + y.deliveredMwh, 0);
  return mwh > 0 ? (ys.reduce((a, y) => a + y.mcpDeliveredCr, 0) * 1e4) / mwh : null;
}

/** The average of every evening hour (18:00 to 24:00) of the price year, ₹/kWh: what SECI-designated hours would pay on average. */
export function eveningAverage(model) {
  const sell = model.book?.sell;
  if (!sell) return null;
  let sum = 0;
  let n = 0;
  for (let d = 0; d < 365; d += 1) for (let h = TENDER.peakStart; h < TENDER.peakEnd; h += 1) { sum += sell[d * 24 + h]; n += 1; }
  return n ? sum / n : null;
}

/** The Pool's net flow at a strike price: ₹ cr a year it pays this plant (negative: it collects), per MW and for the whole tender. */
export function poolAt(model, sp) {
  const X = model.inputs.contractedMw;
  const ids = new Set(fullYears(model).map((y) => y.index));
  const flows = poolFlows(model.sim, sp).filter((f) => ids.has(f.cy));
  const paysCr = flows.length ? -flows.reduce((a, f) => a + f.netCr, 0) / flows.length : 0;
  const perMw = paysCr / X;
  const allCr = perMw * TENDER.totalMw;
  return { sp, paysCr, perMwCr: perMw, allCr, ratio: allCr / TENDER.poolCr };
}

/** The Pool's flow at strike prices around the market and the bid's own, for a table. */
export function poolTable(model, sp = null) {
  const mcp = eveningMcp(model) ?? 8;
  const lo = Math.floor((mcp - 2.5) * 2) / 2;
  const rows = [];
  for (let v = Math.max(1, lo); v <= mcp + 2.01; v += 0.5) rows.push({ ...poolAt(model, Math.round(v * 2) / 2), yours: false });
  if (isNum(sp) && !rows.some((r) => Math.abs(r.sp - sp) < 1e-9)) rows.push({ ...poolAt(model, sp), yours: true });
  else if (isNum(sp)) rows.find((r) => Math.abs(r.sp - sp) < 1e-9).yours = true;
  return rows.sort((a, b) => a.sp - b.sp);
}

/**
 * The verdict on the bid's price under the award test: where it sits against the evening price,
 * what the Pool pays at it, and whether SECI can award the full tender at it.
 */
export function whatWins({ model, finance = null }) {
  const sp = finance?.tariff ?? model.sp ?? null;
  const mcp = eveningMcp(model);
  const avg = eveningAverage(model);
  if (!isNum(sp) || !isNum(mcp)) return null;
  const quote = Math.ceil(sp * 100 - 1e-9) / 100;
  const pool = poolAt(model, quote);
  const low = poolAt(model, quote).allCr; // at the chosen hours
  // SECI will test the price on its own evening view; a lower one (every evening hour, not the
  // two dearest; a market that softens as storage arrives) is the conservative reading
  const lowView = isNum(avg) ? quote - avg : null;
  let verdict;
  let tone;
  if (quote <= mcp) { verdict = `At ₹${nf(quote, 2)} the Pool collects, net, ₹${nf(-pool.paysCr, 0)} cr a year on your ${nf(model.inputs.contractedMw)} MW: the quote sits below the ₹${nf(mcp, 2)} the two chosen evening hours pay on average, so it costs the corpus nothing and SECI can award the full ${nf(TENDER.totalMw)} MW at it.`; tone = "good"; }
  else if (pool.allCr <= TENDER.poolCr) { verdict = `At ₹${nf(quote, 2)} the Pool pays ₹${nf(pool.paysCr, 0)} cr a year on your MW, ₹${nf(pool.allCr, 0)} cr a year on the full ${nf(TENDER.totalMw)} MW: within the ₹${nf(TENDER.poolCr)} cr corpus at the price year's evening prices, but ₹${nf(quote - mcp, 2)} above them; on a lower evening view SECI may cut the award.`; tone = "warn"; }
  else { verdict = `At ₹${nf(quote, 2)} the Pool pays ₹${nf(pool.allCr, 0)} cr a year on the full ${nf(TENDER.totalMw)} MW, ${nf(pool.ratio, 1)}× the ₹${nf(TENDER.poolCr)} cr corpus: SECI will restrict the award (RfS 42.2.b). The quote has to come down to about ₹${nf(mcp, 2)}, the evening market, to be awarded in full.`; tone = "bad"; }
  return { sp, quote, mcp, eveningAverage: avg, pool, verdict, tone, lowView };
}

/**
 * The risks that stay with the bidder, each sized where the model can: the market price risk is
 * the Pool's since Amendment-03; what remains is operational, and Amendment-04 spells it out.
 */
export function cfdRisks({ state, model, finance = null }) {
  const i = model.inputs;
  const X = i.contractedMw;
  const sp = finance?.tariff ?? model.sp ?? null;
  const ops = model.sim.opYears;
  const onYear = ops.find((o) => o.reDays > 300) || ops[1] || ops[0];
  const mwh = onYear.deliveredMwh;
  const out = [];
  // DSM: the deviation charge on the scheduled energy, with the app's CERC-style DSM model
  // (storage firms the forecast error); Amendment-04 (f) makes it the RPD's
  if (isNum(sp) && mwh > 0) {
    const category = dsmCategory(null, { solar: (i.solarMw || 0) > 0, wind: (i.windMw || 0) > 0 });
    const u = dsmUnitCharge({ dsm: DSM_DEFAULTS, category, hasStorage: true, year: 2, contract: sp });
    const cr = dsmChargeCr({ dsm: DSM_DEFAULTS, category, hasStorage: true, year: 2, contract: sp, scheduledMwh: mwh });
    out.push({ id: "dsm", title: `Deviation settlement (DSM): about ₹${nf(cr, 1)} cr a year`, detail: `Every block you schedule and miss, or exceed, is settled under the DSM regulations at the market reference rates, and Amendment-04 (f) puts the whole of it on you with an indemnity to SECI. On a ${category} plant with a battery firming the forecast (σ ${pf(u.sigma, 1)}, tolerance ±${pf(u.tolerance, 0)}), the app's CERC-style DSM model prices it at ₹${nf(u.perMwh / 1000, 3)}/kWh of scheduled energy: ₹${nf(cr, 1)} cr on ${nf(mwh / 1000, 1)} GWh a year, ₹${nf((cr * 1e4) / mwh, 3)}/kWh of the strike price. A battery that is charged before the declared blocks keeps it there; a plant that declares more than it can hold pays the full under-injection rate.`, cr, cite: "dsmOnRpd" });
  }
  // availability: every point below what you declare
  if (isNum(sp) && mwh > 0) {
    const point = (mwh / Math.max(0.5, i.availability || 1)) * 0.01 * sp * 1e-4;
    out.push({ id: "availability", title: `Availability: each 1% below the declaration costs ₹${nf(point, 2)} cr a year of revenue`, detail: `The bid runs at ${pf(i.availability, 1)} availability (${nf(mwh / 1000, 1)} GWh a year supplied). You declare the day's availability in MWh by 06:00 on D-1; if you declare nothing, 100% of the contracted capacity is deemed and you must deliver it. Every MWh declared and not delivered loses the strike price, counts towards the weekly shortfall and draws the DSM charge.`, cr: point, cite: "deemedAvail" });
  }
  // SECI-designated hours: the Pool's cost, not your revenue, unless the battery is not ready for them
  const mcp = eveningMcp(model);
  const avg = eveningAverage(model);
  if (isNum(mcp) && isNum(avg)) {
    out.push({ id: "designated", title: `SECI-designated hours: the two hours you would choose pay ₹${nf(mcp, 2)}/kWh, the evening on average ₹${nf(avg, 2)}`, detail: `Your revenue is the strike price either way: the ₹${nf(mcp - avg, 2)}/kWh difference is the Pool's cost, and SECI will weigh it when it sets the hours. What is yours is readiness: the battery must be charged for the blocks SECI names by 08:00 on D-1, which may not be the blocks your day plan charges for; a battery sized at the tender's minimum has no slack for a second window.`, cr: null, cite: "seciInstructs" });
  }
  // exchange and scheduling charges
  if (isNum(i.pxFee) && mwh > 0) {
    const cr = (mwh * i.pxFee) / 1e4;
    out.push({ id: "fees", title: `Exchange, transaction and scheduling charges: ₹${nf(cr, 2)} cr a year at ₹${nf(i.pxFee, 2)}/kWh`, detail: "All of them are yours under Amendment-04 (h), including what SECI pays on your behalf, which it recovers from your next monthly bill. The exchange fee input carries them in the price; check it against the exchange's current schedule and the scheduling charges of the RLDC.", cr, cite: "exchangeCharges" });
  }
  // the weekly shortfall penalty
  if (isNum(sp)) {
    const ref = Math.max(...model.sim.years.flatMap((y) => y.weeks.map((w) => w.ref)), 0);
    out.push({ id: "weekly", title: ref > sp ? `Weekly shortfall penalty: 1.5 × (₹${nf(ref, 2)} − ₹${nf(sp, 2)}) on energy beyond 10% short` : `Weekly shortfall penalty: nil at ₹${nf(sp, 2)}, above the highest evening price of ₹${nf(ref, 2)}`, detail: ref > sp ? "Shortfall beyond 10% of the week's 14 MWh/MW costs 1.5 × (the highest evening MCP across the markets − the strike price). With a strike price below the dearest evenings it bites in the weeks you fall short." : "The penalty is 1.5 × (the highest evening MCP − the strike price) on energy beyond 10% short in a week: at a strike price above every evening price of the year it is nil. The energy not supplied still earns nothing.", cr: null, cite: "tolerance" });
  }
  // the battery's fade
  const last = ops[ops.length - 1];
  if (last && last.supplyShare < 0.9) {
    const lost = (last.requiredMwh - last.deliveredMwh) * (sp || 0) * 1e-4;
    out.push({ id: "fade", title: `Battery fade: the last year supplies ${pf(last.supplyShare, 1)} of the mandate, ₹${nf(lost, 1)} cr of revenue not earned`, detail: "Augment every year, add years to the schedule, or size the nameplate for the last year. The Size step's checks and the Bid review say which years fall short.", cr: lost, cite: "mandate" });
  }
  // the award itself
  out.push({ id: "award", title: "A part award, or none: SECI sizes the award to the corpus at the discovered tariff", detail: `Amendment-04 (RfS 42.2.b) lets SECI restrict the capacity awarded to what the CfD corpus carries at the discovered strike price; RfS 42.4 lets the last winner refuse a part award below half its bid. A quote near the evening market price is the one awarded in full; a quote that clears L1 + 2% by a whisker may come back as half the MW.`, cr: null, cite: "corpusCap" });
  // what is not yours
  out.push({ id: "market", title: "Not yours: the evening price over 15 years", detail: "The strike price is fixed and the Pool carries the gap to the market in every block, up and down (Amendment-03). A market that softens as storage arrives raises the Pool's cost, not your revenue; it only matters to you through the award test above and the Pool's replenishment, which SECI undertakes (Amendment-01).", cr: null, cite: "noRisk" });
  return out;
}
