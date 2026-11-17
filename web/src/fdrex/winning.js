// What wins SECI-FDRE-X, from the bid's own model, and the risks that stay with the bidder.
// Forked from web/src/cfd/winning.js. CfD-I had a Pool settling against exchange prices and an
// award test on its corpus; this tender has neither. Here the developer is paid one fixed tariff
// under a PPA with SECI, so three things decide the auction and the bid:
//   * the tariff against what SECI has already awarded for assured peak supply of 4 hours a day
//     (web/src/market/seed.js SECI_RESULTS, product "FDRE peak power");
//   * the tariff against the exchange price of the hours supplied, which is the buyer's alternative
//     (exchangeValue in ./model.js): the Buying Entities are not yet named, SECI signs a PPA only
//     after a PSA, and may annul the process if it finds no buyers (RfS 1.4, 20.1, 42.2);
//   * the auction rules: 80% of the qualified capacity is awarded (at most 1200 MW), the highest
//     first-round bidder is dropped when that exceeds 1200 MW, winners are within L1 + 2% in
//     tariff order, quotes fall in steps of ₹0.01 (RfS 40.2, 40.4, 41.2, 41.4).
// One thing separates a low bid from a high one before any of that: the connection the tender asks
// for carries power in the non-solar hours only (RfS 7.2), so solar beyond what charges the storage
// earns nothing unless the bid holds solar-hour connectivity too (inputs.dayInjection) or SECI buys
// the excess at the tariff (PPA 9.3). surplusOf() sizes it from the bid's own operation.
// Plain JavaScript: the Reference bids step shows it; the export names the CfD tab's screens use
// (eveningMcp, eveningAverage, whatWins, cfdRisks) are kept. poolAt and poolTable are gone with the
// Pool: tariffAt and tariffTable take their place.
import { bessCapFactor, exchangeValue, penaltyCr, rfsAmounts, socWindow } from "./model.js";
import { TENDER } from "./tender.js";
import { SECI_RESULTS, tariffRange, weightedTariff } from "../market/seed.js";
import { DSM_DEFAULTS, dsmCategory, dsmChargeCr, dsmUnitCharge } from "../dsm/dsm.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const nf = (v, d = 0) => (isNum(Number(v)) ? new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v)) : "–");
const pf = (v, d = 1) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : "–");
const dmy = (iso) => (iso ? iso.split("-").reverse().join(".") : "–");
const PEAK_PRODUCT = "FDRE peak power";

/** The full Contract Years (the first and last are part years). */
const fullYears = (model) => model.sim.years.filter((y) => y.days >= 300);

/** The energy supplied in an average full Contract Year, MWh. */
const yearMwh = (model) => {
  const ys = fullYears(model);
  return ys.length ? ys.reduce((a, y) => a + y.deliveredMwh, 0) / ys.length : 0;
};

/**
 * The average exchange price of the hours supplied, ₹/kWh: the four dearest evening hours of each
 * day in the exchange chosen for market prices, over the term's price year. It is what the same
 * energy would cost the buyer on the exchange.
 */
export function eveningMcp(model) {
  const ys = fullYears(model);
  const mwh = ys.reduce((a, y) => a + y.deliveredMwh, 0);
  return mwh > 0 ? (ys.reduce((a, y) => a + y.mcpDeliveredCr, 0) * 1e4) / mwh : null;
}

/** The average of every evening hour (18:00 to 24:00) of the price year, ₹/kWh: what the buyer's alternative costs when it does not pick the dearest hours. */
export function eveningAverage(model) {
  const sell = model.book?.sell;
  if (!sell) return null;
  let sum = 0;
  let n = 0;
  for (let d = 0; d < 365; d += 1) for (let h = TENDER.peakStart; h < TENDER.peakEnd; h += 1) { sum += sell[d * 24 + h]; n += 1; }
  return n ? sum / n : null;
}

/** The average over the price year of each day's highest hourly price across the DAM, GDAM and RTM, ₹/kWh: the reference rate of the third-party-sale penalty (RfS 8.1.f). */
export function dayHighAverage(model) {
  const all = model.book?.maxAll;
  if (!all) return null;
  let sum = 0;
  for (let d = 0; d < 365; d += 1) { let hi = 0; for (let h = 0; h < 24; h += 1) hi = Math.max(hi, all[d * 24 + h]); sum += hi; }
  return sum / 365;
}

/**
 * The own RE beyond what charges the storage, in an average full Contract Year: what is curtailed
 * (MWh), what is sold and what the sale earns (₹ cr), and what the curtailed energy would be worth
 * at the tariff if SECI bought it as excess energy (PPA 9.3). `dayInjection` is the bid's choice:
 * false = connectivity with non-solar-hour access only, nothing injected from 06:00 to 18:00.
 */
export function surplusOf(model, sp = null) {
  const ys = fullYears(model);
  const n = Math.max(1, ys.length);
  const sum = (k) => ys.reduce((a, y) => a + (y[k] || 0), 0) / n;
  const curtailedMwh = sum("curtailedMwh");
  return { dayInjection: Boolean(model.inputs.dayInjection), curtailedMwh, soldMwh: sum("merchantMwh"), soldCr: sum("merchantRevCr"), suppliedMwh: sum("deliveredMwh"), atTariffCr: isNum(sp) ? curtailedMwh * sp * 1e-4 : null };
}

/** The highest tariff inside the range when the lowest is `l1`: L1 + 2% of L1, in whole paise (RfS 41.2). */
export function rangeTop(l1) {
  return Math.floor(l1 * (1 + TENDER.eraRange) * 100 + 1e-9) / 100;
}

/** The capacity eligible for award (SE) when `qualifiedMw` of bids qualify: 80% of it, at most the 1200 MW tendered (RfS 40.2). */
export function awardCapacity(qualifiedMw) {
  return Math.min(TENDER.eraAwardShare * qualifiedMw, TENDER.totalMw);
}

/**
 * Whether the bidder with the highest first-round tariff is dropped before the e-RA (RfS 40.2 and
 * its note): only when 80% of the qualified capacity exceeds the 1200 MW tendered, one bidder alone
 * holds the highest tariff, 80% of what remains still exceeds 1200 MW and at least 3 bidders remain.
 * `bids` = [{ bidMw, tariff }], the first-round bids of the qualified bidders.
 */
export function h1Dropped(bids) {
  const total = bids.reduce((a, b) => a + b.bidMw, 0);
  if (TENDER.eraAwardShare * total <= TENDER.totalMw) return false;
  const top = Math.max(...bids.map((b) => b.tariff));
  const h1 = bids.filter((b) => b.tariff === top);
  if (h1.length !== 1) return false;
  return TENDER.eraAwardShare * (total - h1[0].bidMw) > TENDER.totalMw && bids.length - 1 >= 3;
}

/**
 * The award list of an e-RA (RfS 41.2, 41.4) from its final quotes [{ bidMw, tariff }]: in tariff
 * order (equal tariffs in the order given, the earlier last quote first), every bidder within
 * L1 + 2% is awarded its MW until `se` MW is used up; the last gets what is left, and nothing if
 * that is under the 50 MW of the smallest project. mayRefuse: a part under half the bid.
 */
export function awardList(quotes, se) {
  const sorted = quotes.map((q, k) => ({ ...q, k })).sort((a, b) => a.tariff - b.tariff || a.k - b.k);
  const top = sorted.length ? rangeTop(sorted[0].tariff) : null;
  let left = se;
  return sorted.map(({ k, ...q }, rank) => {
    const inRange = q.tariff <= top + 1e-9;
    let mw = inRange ? Math.min(q.bidMw, Math.max(0, left)) : 0;
    if (mw < q.bidMw && mw < TENDER.projectMinMw) mw = 0;
    left -= mw;
    return { ...q, rank: rank + 1, inRange, mw, part: mw > 0 && mw < q.bidMw, mayRefuse: mw > 0 && mw < 0.5 * q.bidMw };
  });
}

/**
 * SECI's earlier awards for assured peak supply (the same product name as this tender: MW x 4 h),
 * latest first, each from its result notice: the tariffs awarded, how much was quoted against the
 * capacity tendered, the range L1 + 2% would have allowed, the bidders inside that range who still
 * got nothing, and the part award of the last winner.
 */
export function peakAwards() {
  return SECI_RESULTS.filter((r) => r.product === PEAK_PRODUCT)
    .sort((a, b) => String(b.auctionDate).localeCompare(String(a.auctionDate)))
    .map((r) => {
      const [lo, hi] = tariffRange(r);
      if (lo === null) return null;
      const winners = r.winners || [];
      const others = r.others || [];
      const all = [...winners, ...others];
      const top = rangeTop(lo);
      const part = winners.find((w) => isNum(w.bidMw) && isNum(w.mw) && w.mw < w.bidMw) || null;
      const inRangeOut = others.filter((w) => isNum(w.tariff) && w.tariff <= top + 1e-9);
      return {
        id: r.id, tender: r.tender, short: (r.tender.match(/\(([^()]*)\)\s*$/) || [])[1] || r.tender,
        auctionDate: r.auctionDate, tenderedMw: r.tenderedMw, awardedMw: r.awardedMw,
        mwhPerMwDay: r.storageMwh && r.tenderedMw ? r.storageMwh / r.tenderedMw : null, // the energy bought per MW a day
        lo, hi, weighted: weightedTariff(r),
        bidders: all.length, quotedMw: all.reduce((a, w) => a + (w.bidMw || 0), 0),
        highestQuote: Math.max(...all.map((w) => w.tariff).filter(isNum)),
        rangeTop: top,
        inRangeUnawarded: inRangeOut.length, inRangeUnawardedMw: inRangeOut.reduce((a, w) => a + (w.bidMw || 0), 0),
        partAward: part ? { bidMw: part.bidMw, mw: part.mw, share: part.mw / part.bidMw } : null,
        quotes: all.filter((w) => isNum(w.bidMw) && isNum(w.tariff)).map((w) => ({ bidMw: w.bidMw, tariff: w.tariff })), // the final quotes, winners first as the notice lists them
      };
    })
    .filter(Boolean);
}

/**
 * A tariff against the buyer's alternative, for this plant: the Buying Entity pays the tariff plus
 * SECI's trading margin; the same energy on the exchange costs the price of the hours supplied.
 * savesCr is what the buyer saves a year against the exchange (negative: the PPA costs it more),
 * per MW and for the whole tender. rangeTop is where L1 + 2% ends if this tariff were the lowest.
 */
export function tariffAt(model, sp) {
  const X = model.inputs.contractedMw;
  const ids = new Set(fullYears(model).map((y) => y.index));
  const rows = exchangeValue(model.sim, sp).filter((f) => ids.has(f.cy));
  const netCr = rows.length ? rows.reduce((a, f) => a + f.netCr, 0) / rows.length : 0; // exchange value less the tariff paid, a year
  const margin = TENDER.tradingMarginRsPerKwh;
  const savesCr = netCr - margin * yearMwh(model) * 1e-4;
  const mcp = eveningMcp(model);
  return { sp, buyerCost: sp + margin, vsExchange: isNum(mcp) ? sp + margin - mcp : null, savesCr, perMwCr: savesCr / X, allCr: (savesCr / X) * TENDER.totalMw, rangeTop: rangeTop(sp) };
}

/** Tariffs around the earlier awards, the exchange price and the bid's own, for a table: each against the buyer's alternative and the latest award. */
export function tariffTable(model, sp = null) {
  const awards = peakAwards();
  const latest = awards[0] || null;
  const mcp = eveningMcp(model) ?? 8;
  const marks = new Map(); // tariff in paise -> the labels of that row
  const mark = (v, label) => { const k = Math.round(v * 100); const at = marks.get(k) || []; if (label) at.push(label); marks.set(k, at); };
  const lo = Math.floor(Math.min(mcp, ...awards.map((a) => a.lo), isNum(sp) ? sp : mcp) * 2) / 2 - 0.5;
  const hi = Math.max(mcp, isNum(sp) ? sp : mcp) + 0.5;
  for (let v = Math.max(1, lo); v <= hi + 1e-9; v += 0.5) mark(Math.round(v * 2) / 2, null);
  for (const a of awards) mark(a.lo, `lowest award, ${a.short}`);
  mark(Math.round(mcp * 100) / 100, "the exchange price of the hours supplied");
  if (isNum(sp)) mark(sp, "your quote");
  return [...marks.entries()].sort((a, b) => a[0] - b[0]).map(([k, labels]) => {
    const v = k / 100;
    return { ...tariffAt(model, v), label: labels.join("; ") || null, yours: isNum(sp) && Math.abs(v - sp) < 0.005, vsLatest: latest ? v - latest.hi : null };
  });
}

/**
 * The verdict on the bid's tariff: where it sits against SECI's earlier awards for the same
 * product, against the exchange price of the hours supplied (the buyer's alternative), and what
 * the auction rules then ask of it.
 */
export function whatWins({ model, finance = null }) {
  const sp = finance?.tariff ?? model.sp ?? null;
  const mcp = eveningMcp(model);
  const avg = eveningAverage(model);
  if (!isNum(sp) || !isNum(mcp)) return null;
  const quote = Math.ceil(sp * 100 - 1e-9) / 100;
  const X = model.inputs.contractedMw;
  const awards = peakAwards();
  const latest = awards[0] || null;
  const highest = awards.reduce((a, b) => (a === null || b.hi > a.hi ? b : a), null);
  const at = tariffAt(model, quote);
  const l1Floor = Math.ceil((quote / (1 + TENDER.eraRange)) * 100 - 1e-9) / 100; // the lowest L1 that still leaves this quote inside the range
  const buyer = at.vsExchange <= 0
    ? `With SECI's ₹${nf(TENDER.tradingMarginRsPerKwh, 2)} margin the buyer pays ₹${nf(at.buyerCost, 2)}, ₹${nf(-at.vsExchange, 2)} below the ₹${nf(mcp, 2)} the same hours cost on the exchange: it saves ₹${nf(at.savesCr, 1)} cr a year on your ${nf(X)} MW.`
    : `With SECI's ₹${nf(TENDER.tradingMarginRsPerKwh, 2)} margin the buyer pays ₹${nf(at.buyerCost, 2)}, ₹${nf(at.vsExchange, 2)} above the ₹${nf(mcp, 2)} the same hours cost on the exchange: ₹${nf(-at.savesCr, 1)} cr a year more on your ${nf(X)} MW. SECI must find a buyer at the discovered tariff before it signs.`;
  const surplus = surplusOf(model, quote);
  const conn = surplus.dayInjection
    ? ` This bid counts on connectivity in the solar hours too: it sells ${nf(surplus.soldMwh / 1000, 1)} GWh of surplus RE a year for ₹${nf(surplus.soldCr, 1)} cr, which the tariff does not have to carry. The tender asks only for non-solar-hour access; without the solar hours that income is gone.`
    : surplus.curtailedMwh > 0.01 * surplus.suppliedMwh
      ? ` This bid holds connectivity for the non-solar hours only, as the tender asks: ${nf(surplus.curtailedMwh / 1000, 1)} GWh of surplus solar a year is curtailed and the tariff carries the whole plant. Solar-hour connectivity, or SECI buying the excess at the tariff, is what separates a low bid from a high one.`
      : "";
  let verdict;
  let tone;
  if (!latest) { verdict = `At ₹${nf(quote, 2)}/kWh. ${buyer}`; tone = at.vsExchange <= 0 ? "good" : "warn"; }
  else if (quote <= latest.hi + 1e-9) {
    verdict = `At ₹${nf(quote, 2)} the quote is at or below the latest award for this product (${latest.short}, ₹${nf(latest.lo, 2)} to ${nf(latest.hi, 2)} on ${dmy(latest.auctionDate)}). ${buyer} If you are the lowest, the range runs up to ₹${nf(at.rangeTop, 2)}.`;
    tone = "good";
  } else if (quote <= highest.hi + 1e-9) {
    verdict = `At ₹${nf(quote, 2)} the quote is inside what SECI has awarded for this product (₹${nf(Math.min(...awards.map((a) => a.lo)), 2)} to ${nf(highest.hi, 2)}) but ₹${nf(quote - latest.hi, 2)} above the latest award (${latest.short}, ${dmy(latest.auctionDate)}). You stay inside L1 + ${pf(TENDER.eraRange, 0)} only while the lowest quote is ₹${nf(l1Floor, 2)} or more. ${buyer}`;
    tone = "warn";
  } else {
    verdict = `At ₹${nf(quote, 2)} the quote is ₹${nf(quote - highest.hi, 2)} above the highest tariff SECI has awarded for this product (₹${nf(highest.hi, 2)}, ${highest.short}) and ₹${nf(quote - latest.hi, 2)} above the latest (${latest.short}, ${dmy(latest.auctionDate)}). You stay inside L1 + ${pf(TENDER.eraRange, 0)} only while the lowest quote is ₹${nf(l1Floor, 2)} or more; if a rival repeats ₹${nf(latest.lo, 2)}, the range ends at ₹${nf(latest.rangeTop, 2)}. ${buyer}`;
    tone = "bad";
  }
  if (latest && quote > latest.hi + 1e-9) verdict += conn;
  // the quote among the final quotes of the latest peak auction, as if those bidders quoted the same here (yours last among equals)
  let replay = null;
  if (latest?.quotes?.length) {
    const list = awardList([...latest.quotes, { bidMw: X, tariff: quote, yours: true }], awardCapacity(latest.quotedMw + X));
    const me = list.find((q) => q.yours);
    replay = { tender: latest.short, rank: me.rank, of: list.length, inRange: me.inRange, mw: me.mw, rangeTop: rangeTop(list[0].tariff) };
    verdict += ` Placed with the ${nf(latest.quotes.length)} final quotes of ${latest.short}, yours would rank ${nf(me.rank)} of ${nf(list.length)} and be awarded ${me.mw > 0 ? `${nf(me.mw)} MW` : "nothing"}; that tender's terms may differ from this one's.`;
  }
  return { sp, quote, mcp, eveningAverage: avg, buyerCost: at.buyerCost, vsExchange: at.vsExchange, exchange: at, awards, latest, highest, vsLatest: latest ? quote - latest.hi : null, rangeTop: at.rangeTop, l1Floor, surplus, replay, verdict, tone };
}

/**
 * The risks that stay with the bidder, each sized where the model can. The exchange price is not
 * one of them for the PPA supply (the tariff is fixed, PPA 9.1); what remains is the buyer's
 * choice of hours, the penalties, the sourcing limit, the plant, the schedule and the award.
 * Each: { id, title, detail, cr (₹ cr a year, or null), cite (a term of ./terms.js) }.
 */
export function cfdRisks({ state, model, finance = null }) {
  const i = model.inputs;
  const X = i.contractedMw;
  const sp = finance?.tariff ?? model.sp ?? null;
  const ops = model.sim.opYears;
  const onYear = ops.find((o) => o.days >= 300) || ops[0];
  const mwh = onYear.deliveredMwh;
  const daily = X * TENDER.mwhPerMwDay;
  const tol = TENDER.shortfallTolerance;
  const out = [];

  // the buyer chooses the hours, each morning
  const mcp = eveningMcp(model);
  const avg = eveningAverage(model);
  out.push({ id: "hours", title: "The buyer chooses the four hours, each morning; the model assumes the evening",
    detail: `The Buying Entity names any ${TENDER.peakHours} of the non-solar hours, from the evening to the next morning, by 06:00 on the day, with at least 1 hour continuous; with no schedule the previous day's hours apply. Your revenue is the tariff whichever hours it picks. What is yours is readiness: ${nf(X)} MWh in each hour named, so the battery must hold the day's ${nf(daily)} MWh until then, into the next morning if asked. The model takes the four dearest hours of 18:00 to 24:00 in the ${i.sellMarket}${isNum(mcp) && isNum(avg) ? ` (₹${nf(mcp, 2)}/kWh on average in the price year; every evening hour averages ₹${nf(avg, 2)})` : ""}. Hours spread over the night leave less room for a sale outside the Peak Hours, and wind output counts only in the hours named. A project mapped to two or more Buying Entities answers to each one's hours separately.`,
    cr: null, cite: "fourHours" });

  // the monthly shortfall penalty at 1.5 x the tariff
  if (isNum(sp)) {
    const dayPenaltyLakh = (TENDER.penaltyMultiple * sp * daily) / 100; // ₹ lakh for one day's energy beyond the tolerance
    const dayRevenueLakh = (sp * daily) / 100;
    const termCr = model.sim.years.reduce((a, y) => a + penaltyCr(y, sp), 0);
    const months = model.sim.years.reduce((a, y) => a + y.months.filter((w) => w.beyondMwh > 1e-6).length, 0);
    const left = Math.max(0, tol - (1 - (i.availability ?? 1)));
    out.push({ id: "monthly", title: `Monthly shortfall penalty: ${nf(TENDER.penaltyMultiple, 1)} × the tariff, ₹${nf(dayPenaltyLakh, 1)} lakh for each day's supply missed beyond the tolerance`,
      detail: `Each billing month you owe ${nf(TENDER.mwhPerMwDay)} MWh per MW for every day. A shortfall of up to ${pf(tol, 0)} of the month is free; beyond it every kWh short costs ${nf(TENDER.penaltyMultiple, 1)} × ₹${nf(sp, 2)} = ₹${nf(TENDER.penaltyMultiple * sp, 2)}, and the ₹${nf(dayRevenueLakh, 1)} lakh a day of tariff is not earned either. At ${pf(i.availability, 1)} availability ${pf(1 - (i.availability ?? 1), 1)} of every month is already short, out of the ${pf(tol, 0)} allowed; what is left is about ${nf(left * 30, 1)} days of full outage in a 30-day month. The penalty rises with the tariff you quote, not with the exchange price. In this bid: ${months ? `${nf(months)} billing months penalised, ₹${nf(termCr, 1)} cr over the term` : "no billing month is penalised"}. If a Buying Entity levies its own penalty for a peak shortfall, the same is levied on you.`,
      cr: months ? termCr / TENDER.termYears : 0, cite: "shortfall" });
  }

  // selling to others while the PPA is short
  const dayHigh = dayHighAverage(model);
  out.push({ id: "thirdParty", title: `Selling elsewhere while the PPA is short: ${nf(TENDER.thirdPartyPenaltyMultiple, 1)} × the day's highest exchange rate${isNum(dayHigh) ? `, about ₹${nf(TENDER.thirdPartyPenaltyMultiple * dayHigh, 2)}/kWh` : ""}`,
    detail: `Outside the Peak Hours the storage may sell to third parties or on an exchange within the connectivity, without a NOC, but the PPA supply comes first. Any sale on a day the PPA is short is a breach: ${nf(TENDER.thirdPartyPenaltyMultiple, 1)} × the highest rate of the day in the DAM, G-DAM or RTM of any exchange, on the quantum sold, on top of the monthly shortfall penalty.${isNum(dayHigh) ? ` In the price year the day's highest IEX rate averaged ₹${nf(dayHigh, 2)}/kWh.` : ""} The model sells anything else only on days the supply is met; your scheduling desk has to hold to the same rule every day.`,
    cr: null, cite: "thirdPartyPenalty" });

  // connectivity for the non-solar hours only: the day's surplus solar
  const surplus = surplusOf(model, sp);
  out.push(surplus.dayInjection
    ? { id: "connectivity", title: `Solar-hour connectivity: ₹${nf(surplus.soldCr, 1)} cr a year of surplus sales depend on it`,
      detail: `The tender asks for connectivity with non-solar-hour access; that is what you must have applied for when you bid. This bid says you hold connectivity in the solar hours as well and sells ${nf(surplus.soldMwh / 1000, 1)} GWh of surplus RE a year at exchange prices. If that connectivity is not granted, or comes late, the surplus is curtailed and the income is lost, while the tariff you quoted stays. Getting connectivity is your responsibility and at your cost. Excess energy is offered to SECI and the buyer first.`,
      cr: surplus.soldCr, cite: "connectivityApplied" }
    : { id: "connectivity", title: `Connectivity is for the non-solar hours: ${nf(surplus.curtailedMwh / 1000, 1)} GWh of surplus solar a year earns nothing in this bid`,
      detail: `The tender asks for connectivity with non-solar-hour access, so this bid injects nothing from 06:00 to 18:00. Own RE is sized for the worst days, so on most days it makes more than the storage takes: ${nf(surplus.curtailedMwh / 1000, 1)} GWh a year is curtailed, against ${nf(surplus.suppliedMwh / 1000, 1)} GWh supplied under the PPA.${isNum(surplus.atTariffCr) ? ` At the tariff that energy would be worth ₹${nf(surplus.atTariffCr, 1)} cr a year, but SECI buys excess energy only if the Buying Entity consents, and the model does not count on it.` : ""} A bidder that holds solar-hour connectivity as well sells that surplus and can quote a lower tariff: set "Connectivity in the solar hours too" on Bid inputs only if you hold it.`,
      cr: null, cite: "connectivityApplied" });

  // the 5% limit on bought power
  const share = Math.max(0, ...model.sim.years.map((y) => y.shareMarket || 0));
  out.push({ id: "bought", title: `Bought power: at most ${pf(TENDER.marketShare, 0)} of a year's energy${i.useMarket ? `; this bid reaches ${pf(share, 1)}` : "; this bid buys none"}`,
    detail: `All the energy must be RE. Up to ${pf(TENDER.marketShare, 0)} of the year's requirement (${nf(TENDER.marketShare * daily * 365)} MWh for ${nf(X)} MW) may come from the green market or a bilateral agreement, directly in the Peak Hours or through the storage, counted on the energy discharged. Energy above the limit is not paid for and does not count as supplied, and charging the storage from the grid is otherwise not allowed. So a run of cloudy days cannot be bought out: own RE and the battery have to cover it, or the month runs into the penalty. The Size step shows the days short and why.`,
    cr: null, cite: "marketShare" });

  // the battery's fade
  const last = ops[ops.length - 1];
  const noAug = { ...i, augmentation: "none", augmentationMode: null };
  let fadeYear = null;
  for (let y = 1; y <= TENDER.termYears; y += 1) { if (i.essMwhPerMw * socWindow(i) * bessCapFactor(noAug, y) < TENDER.mwhPerMwDay * (1 - tol) - 1e-9) { fadeYear = y; break; } }
  const worst = ops.filter((o) => o.days >= 300).reduce((a, o) => (a === null || o.supplyShare < a.supplyShare ? o : a), null) || last;
  const fadeLostCr = isNum(sp) && worst ? Math.max(0, worst.requiredMwh * (i.availability ?? 1) - worst.deliveredMwh) * sp * 1e-4 : null;
  out.push({ id: "fade", title: worst && worst.supplyShare < 1 - tol ? `Battery fade: year ${worst.index} supplies ${pf(worst.supplyShare, 1)} of the mandate${isNum(fadeLostCr) ? `, ₹${nf(fadeLostCr, 1)} cr of tariff not earned` : ""}, and the penalty on top` : `Battery fade: covered in this bid (${pf(worst?.supplyShare, 1)} of the mandate in the weakest year)`,
    detail: `The battery must carry ${nf(TENDER.mwhPerMwDay)} MWh per MW for ${TENDER.termYears} years. ${fadeYear ? `Without augmentation a battery of ${nf(i.essMwhPerMw, 2)} MWh per MW fading ${pf(i.essDegradation, 1)} a year holds less than ${pf(1 - tol, 0)} of the daily ${nf(TENDER.mwhPerMwDay)} MWh per MW from year ${fadeYear}: every month from then is penalised.` : "At your degradation the battery stays above the penalty threshold for the whole term without augmentation."} ${i.augmentation === "annual" ? "This bid augments every year and carries that cost in the tariff; the cost depends on battery prices falling as you assumed." : "This bid does not augment every year: the Size step's checks and the Bid review say which years fall short."} The storage technology may be changed during the term, at your risk and cost.`,
    cr: worst && worst.supplyShare < 1 - tol ? fadeLostCr : null, cite: "ess" });

  // availability: every point below what the bid assumes
  if (isNum(sp) && mwh > 0) {
    const point = (mwh / Math.max(0.5, i.availability || 1)) * 0.01 * sp * 1e-4;
    out.push({ id: "availability", title: `Availability: each 1% below the bid's ${pf(i.availability, 1)} costs ₹${nf(point, 2)} cr a year of revenue`,
      detail: `The bid supplies ${nf(mwh / 1000, 1)} GWh a year at ${pf(i.availability, 1)} availability. You are paid only for energy supplied in the Peak Hours, so every MWh not delivered loses the tariff and counts towards the month's shortfall. The PPA itself tells you to schedule more than the minimum to stay clear of the penalty.`,
      cr: point, cite: "scheduleAbove" });
  }

  // DSM: the deviation charge on the scheduled energy, with the app's CERC-style DSM model (storage firms the forecast error)
  if (isNum(sp) && mwh > 0) {
    const category = dsmCategory(null, { solar: (i.solarMw || 0) > 0, wind: (i.windMw || 0) > 0 });
    const u = dsmUnitCharge({ dsm: DSM_DEFAULTS, category, hasStorage: true, year: 2, contract: sp });
    const cr = dsmChargeCr({ dsm: DSM_DEFAULTS, category, hasStorage: true, year: 2, contract: sp, scheduledMwh: mwh });
    out.push({ id: "dsm", title: `Deviation settlement (DSM): about ₹${nf(cr, 1)} cr a year`,
      detail: `You schedule the power yourself (Amendment-01 deleted the buyer's scheduling right) and every deviation from the schedule is settled under the DSM regulations to your account; the charges are paid by you directly. On a ${category} plant with a battery firming the forecast (σ ${pf(u.sigma, 1)}, tolerance ±${pf(u.tolerance, 0)}), the app's CERC-style DSM model prices it at ₹${nf(u.perMwh / 1000, 3)}/kWh of scheduled energy: ₹${nf(cr, 1)} cr on ${nf(mwh / 1000, 1)} GWh a year. A battery charged before the hours named keeps it there. If the RLDCs' schedules differ, SECI pays on the lowest until the error is corrected.`,
      cr, cite: "dsmOnRpd" });
  }

  // delay in commencement of supply
  const rfs = rfsAmounts(i);
  out.push({ id: "delay", title: `Late commencement: the PBG of ₹${nf(rfs.pbgCr, 1)} cr is encashed pro rata, and after ${TENDER.delayMonthsMax} months the capacity is cut`,
    detail: `The whole Project must supply by the SCSD, ${TENDER.essScdMonths} months from the Effective Date; there is no later date for the RE generation. For a delay of up to ${TENDER.delayMonthsMax} months the PBG is encashed pro rata to the Contracted Capacity that has not started supply. Beyond that the Contracted Capacity is cut to what is supplying and the PPA for the rest ends. Extensions are given only for Force Majeure, a SECI default, late connectivity that is the CTU's or the transmission licensee's, or late tariff adoption. If your delay costs the Buying Entity damages or transmission charges, they are passed on to you. Financial closure is due ${TENDER.finCloseMonthsBeforeScd} months before the SCSD.`,
    cr: null, cite: "delay" });

  // the award: 80% of the qualified capacity, in tariff order
  const awards = peakAwards();
  const withPart = awards.find((a) => a.partAward) || null;
  out.push({ id: "award", title: `A part award, or none: only ${pf(TENDER.eraAwardShare, 0)} of the qualified capacity is awarded, in tariff order`,
    detail: `SECI awards ${pf(TENDER.eraAwardShare, 0)} of the capacity of the qualified bids, at most ${nf(TENDER.totalMw)} MW, to the bidders inside L1 + ${pf(TENDER.eraRange, 0)}, lowest first. The last winner gets what is left: it must accept a part of half its bid or more (or lose the EMD) and may refuse a smaller part; no project under ${nf(TENDER.projectMinMw)} MW is awarded.${withPart ? ` In ${withPart.short} the last winner bid ${nf(withPart.partAward.bidMw)} MW and was awarded ${nf(withPart.partAward.mw)} MW (${pf(withPart.partAward.share, 0)}).` : ""} After the award SECI signs only the capacity it has sold under PSAs: if that is less than your Letter of Award you may leave without liability, and the LoA lapses if SECI has not signed within 12 months. Price the bid so that it still works at half the MW.`,
    cr: null, cite: "partial" });

  // off-take constraints and their compensation
  if (isNum(sp)) {
    const hours = TENDER.offtakeCompensationHours;
    const uncomp = hours * X * sp * 1e-4; // ₹ cr: the tariff on the contracted MW for the hours not compensated
    out.push({ id: "offtake", title: `Off-take constraints: the first ${nf(hours)} hours a year of each kind are not compensated, ₹${nf(uncomp, 1)} cr each at the contracted MW`,
      detail: `If the grid is unavailable or the Buying Entity does not take the power, compensation starts only beyond ${nf(hours)} hours in a Contract Year for each cause: the tariff × the MW offered and not scheduled × the hours, paid by the Buying Entity with no claim on SECI. To claim for reduced off-take you must sell the power on an exchange as a price taker, and 95% of what that sale earns is set off. Nothing is paid for a backdown on grounds of grid security, safety or Force Majeure. ${nf(hours)} hours at ${nf(X)} MW is ${nf(hours * X)} MWh, ${pf((hours * X) / (daily * 365), 0)} of a year's supply.`,
      cr: uncomp, cite: "offtakeThreshold" });
  }

  // the Buying Entity is not yet named
  const psmCr = i.psm ? TENDER.psmChargeRsPerKwh * mwh * 1e-4 : 0;
  out.push({ id: "buyer", title: "The Buying Entity is not yet named",
    detail: `SECI will name the Buying Entities later and may substitute an entity in another State. Until a PSA is signed there is no PPA: SECI may annul the process if it finds no buyers at the discovered tariffs, and may cancel bids if the tariff is high. So the hours you will be asked for, the State whose non-solar hours apply and the buyer's credit are unknown when you bid. SECI's duty to pay you the tariff is not back to back with the buyer's payment, and it opens a Letter of Credit in your favour; its other obligations are back to back. ${i.psm ? `This bid opts for cover under the Payment Security Mechanism: a discount of ₹${nf(TENDER.psmChargeRsPerKwh, 2)}/kWh on every bill, ₹${nf(psmCr, 2)} cr a year, for the whole term.` : `This bid does not opt for cover under the Payment Security Mechanism (a discount of ₹${nf(TENDER.psmChargeRsPerKwh, 2)}/kWh on every bill); the choice is made once, in the Covering Letter.`}`,
    cr: i.psm ? psmCr : null, cite: "buyingEntities" });

  // what is not yours
  out.push({ id: "market", title: `Not yours on the PPA supply: the exchange price over ${TENDER.termYears} years`,
    detail: "The tariff is fixed for the term and paid on the energy supplied in the Peak Hours, whatever the exchange clears at. A softer evening market does not lower your PPA revenue. It lowers what any extra battery, and surplus RE where your connectivity lets you inject it, earn outside the Peak Hours, and it weakens the buyer's case for the PPA, which matters before signing, not after. Excess energy goes first to SECI and the Buying Entity at the tariff, if they want it; the model sells it at exchange prices and does not count on them.",
    cr: null, cite: "tariffFixed" });
  return out;
}
