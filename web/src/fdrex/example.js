// SECI-FDRE-X: a worked example for one bid size (forked from web/src/cfd/example.js). What the
// bidder signs up for, what it builds and when, the money it puts up, real IEX evenings (the four
// evening hours a buyer would choose, what they cost on the exchange, and what the PPA pays for
// them), a billing month with days missed, and a year of evenings against the tariff. The PPA pays
// the tariff on the energy supplied in the Peak Hours whatever the exchange price is: the exchange
// price is the buyer's alternative, not the developer's revenue. Every rule comes from ./tender.js
// (each quoted in ./terms.js); the round-trip efficiency and solar CUF used to size own solar are
// the bidder's inputs, or labelled examples. The example sizes own solar on the year's energy, so
// it shows no surplus; a plant sized to meet every day makes more than the battery takes, and the
// connection the tender asks for (non-solar-hour access) does not carry that surplus in the day.

import { TENDER } from "./tender.js";
import { rfsAmounts } from "./model.js";

const DAY_MS = 86400000;
// sp: the example tariff, ₹/kWh. With the connectivity the tender asks for (non-solar-hour access
// only, the bid's default: nothing is injected in the day, so surplus solar earns nothing) the
// model prices a 100 MW bid at about ₹9.5 to 10/kWh on the benchmark inputs (₹10.03 through the
// financial model with 112 MWac of own solar on the IEX DAM price year; ₹8.88 on the
// competitive-bidder fill). With solar-hour connectivity as well it is about ₹7 to 9. So ₹9.75
// stands in until the bid is priced on the Financial model step. SECI's earlier 4-hour peak awards
// (₹5.99 to 6.28/kWh, web/src/market/seed.js) are lower: the Reference bids step shows the gap.
// outageDays: the days without supply in the example of a short billing month.
export const EXAMPLE_DEFAULTS = { mw: 100, sp: 9.75, rte: 0.87, solarCuf: 0.25, outageDays: 5 };

const lakh = (rsPerKwh, mwh) => (rsPerKwh * mwh * 1000) / 1e5;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * The penalty for a billing month, ₹ lakh: 1.5 × the tariff on the energy short of 90% of the
 * month's requirement (PPA 4.4.1(b), whose example is "(0.90 x 3 - 2) x 2.7 x 1.5" = ₹28.35 lakh
 * for 3 MU required and 2 MU supplied at ₹2.70/kWh).
 */
export function shortfallPenaltyLakh(requiredMwh, suppliedMwh, sp) {
  return lakh(TENDER.penaltyMultiple * sp, Math.max(0, (1 - TENDER.shortfallTolerance) * requiredMwh - suppliedMwh));
}

/** The bid size the example shows: the one chosen there, else your contracted MW if it is a valid bid, else 100 MW. */
export function exampleMw(state) {
  const chosen = state.example?.mw;
  if (isNum(chosen)) return chosen;
  const mw = state.inputs?.contractedMw;
  return isNum(mw) && Number.isInteger(mw) && mw >= TENDER.bidMinMw && mw <= TENDER.bidMaxMw ? mw : EXAMPLE_DEFAULTS.mw;
}

/** The real date of day d (0-364) of the price year: each calendar day from the latest year with data. */
export function priceDate(prices, market, d) {
  const to = Date.parse(`${prices.markets[market].to}T00:00:00Z`);
  const year = new Date(to).getUTCFullYear();
  const t = Date.UTC(year, 0, 1) + d * DAY_MS;
  return t > to ? Date.UTC(year - 1, 0, 1) + d * DAY_MS : t;
}

/**
 * Each day's four dearest evening hours (18:00-24:00) in the exchange market, in clock order, with
 * prices in ₹/kWh: the hours a Buying Entity is taken to choose (the model's reading; the RfS lets
 * it choose any 4 of the non-solar hours, evening to the next morning).
 */
export function evenings(prices, market) {
  const s = prices.markets[market].hourlyRsPerMwh;
  const out = [];
  for (let d = 0; d < 365; d += 1) {
    const hours = [];
    for (let h = TENDER.peakStart; h < TENDER.peakEnd; h += 1) hours.push(h);
    hours.sort((a, b) => s[d * 24 + b] - s[d * 24 + a] || a - b);
    const best = hours.slice(0, TENDER.peakHours).sort((a, b) => a - b);
    const p = best.map((h) => s[d * 24 + h] / 1000);
    out.push({ d, hours: best, prices: p, avg: p.reduce((a, v) => a + v, 0) / p.length });
  }
  return out;
}

/**
 * One evening under the PPA: the developer is paid the tariff on the energy supplied (youLakh);
 * the same energy would have cost the buyer the exchange price in those hours (exchangeLakh).
 * gapLakh = youLakh − exchangeLakh: positive when the tariff is above the exchange price.
 * buyerLakh is what the Buying Entity pays SECI: the tariff plus SECI's trading margin.
 */
function settle(day, mw, sp, date) {
  const exchange = day.prices.reduce((a, p) => a + lakh(p, mw), 0);
  const energy = mw * day.prices.length;
  const you = lakh(sp, energy);
  return { ...day, date, mwhPerHour: mw, energyMwh: energy, exchangeLakh: exchange, youLakh: you, gapLakh: you - exchange, buyerLakh: lakh(sp + TENDER.tradingMarginRsPerKwh, energy) };
}

/**
 * The worked example for a bid of `mw` MW at tariff `sp` (₹/kWh), on the IEX prices of `market`.
 * Own solar is sized on energy alone (the year's supply through the battery, less the 5% that may
 * be bought), from the round-trip efficiency and the solar CUF; the Size step finds the size that
 * meets every day.
 */
export function workedExample({ mw, sp, prices, market = "DAM", rte = EXAMPLE_DEFAULTS.rte, solarCuf = EXAMPLE_DEFAULTS.solarCuf, outageDays = EXAMPLE_DEFAULTS.outageDays }) {
  const X = mw;
  const daily = TENDER.mwhPerMwDay * X;
  const yearly = daily * 365;
  // all the energy is RE; up to 5% of the year's energy may be bought (RfS 8.1.e), the rest is own RE
  const ownShareWithMarket = 1 - TENDER.marketShare;
  const ownShareAlone = 1;
  const solarFor = (share) => (share * yearly) / rte / (8760 * solarCuf);
  const solarWithMarket = solarFor(ownShareWithMarket);
  const solarAlone = solarFor(ownShareAlone);
  const plantSolar = Math.ceil(solarAlone / 5) * 5;
  const money = rfsAmounts({ contractedMw: X, solarMw: plantSolar, windMw: 0, essMwhPerMw: TENDER.essHoursMin });

  // real evenings: the cheapest, a middle one and the dearest of the year
  const ev = evenings(prices, market);
  const date = (d) => priceDate(prices, market, d);
  const byAvg = [...ev].sort((a, b) => a.avg - b.avg || a.d - b.d);
  const low = byAvg[0];
  const high = byAvg[byAvg.length - 1];
  // the middle evening, from a calendar month that lies wholly in one data year
  const monthDays = (d) => {
    const t = new Date(date(d));
    const first = d - (t.getUTCDate() - 1);
    const n = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return { first, n };
  };
  const wholeMonth = (d) => {
    const { first, n } = monthDays(d);
    return first >= 0 && first + n - 1 < 365 && date(first + n - 1) - date(first) === (n - 1) * DAY_MS;
  };
  const middle = byAvg.slice(Math.floor(byAvg.length / 2)).find((e) => wholeMonth(e.d)) || byAvg[Math.floor(byAvg.length / 2)];

  // a billing month (read as the calendar month) with the plant out for `outageDays` days from the middle evening
  const { first, n } = monthDays(middle.d);
  const out = Math.max(1, Math.min(Math.round(outageDays), n));
  const outFrom = Math.min(middle.d, first + n - out);
  const required = daily * n;
  const missed = daily * out;
  const free = TENDER.shortfallTolerance * required;
  const penalised = Math.max(0, missed - free);
  const month = {
    start: date(first), end: date(first + n - 1), days: n,
    outageDays: out, outageFrom: date(outFrom), outageTo: date(outFrom + out - 1),
    requiredMwh: required, suppliedMwh: required - missed, shortMwh: missed, shortPct: missed / required,
    freeMwh: free, freeDays: free / daily, penalisedMwh: penalised,
    penaltyRate: TENDER.penaltyMultiple * sp, // ₹/kWh on the energy penalised
    penaltyLakh: shortfallPenaltyLakh(required, required - missed, sp),
    lostLakh: lakh(sp, missed), // the tariff not earned on the energy not supplied
    oneDayPct: daily / required,
  };

  // a year of evenings, every one supplied in full: what the PPA pays against what the exchange would have cost
  const series = ev.map((e) => ({ d: e.d, date: date(e.d), avg: e.avg, gapLakh: lakh(sp - e.avg, daily) })).sort((a, b) => a.date - b.date); // in date order
  const exchangeCr = ev.reduce((a, e) => a + e.prices.reduce((b, p) => b + lakh(p, X), 0), 0) / 100;
  const youCr = lakh(sp, yearly) / 100;
  const year = {
    series,
    energyMwh: yearly,
    exchangeCr, // the four chosen hours of every evening at the exchange price
    youCr, // the tariff on the same energy: the developer's revenue
    gapCr: youCr - exchangeCr, // positive: the tariff costs more than the exchange would have
    buyerCr: lakh(sp + TENDER.tradingMarginRsPerKwh, yearly) / 100, // what the Buying Entity pays SECI
    psmCr: lakh(TENDER.psmChargeRsPerKwh, yearly) / 100, // the discount for cover under the Payment Security Mechanism, if opted
    daysExchangeCheaper: ev.filter((e) => e.avg < sp - 1e-9).length, // evenings the four hours cost less on the exchange than the tariff
    daysPpaCheaper: ev.filter((e) => e.avg > sp + 1e-9).length,
    avgPrice: ev.reduce((a, e) => a + e.avg, 0) / ev.length,
    maxPrice: Math.max(...ev.map((e) => e.avg)),
    from: prices.markets[market].from,
    to: prices.markets[market].to,
  };

  return {
    mw: X, sp, market, rte, solarCuf,
    commit: {
      dailyMwh: daily, hourlyMwh: TENDER.maxMwhPerMwHour * X,
      monthlyMwh: daily * 30, monthlyMinMwh: daily * 30 * (1 - TENDER.shortfallTolerance), // a 30-day billing month
      yearlyMwh: yearly, batteryMw: X, batteryMwh: TENDER.essHoursMin * X, share: X / TENDER.totalMw,
    },
    charging: { perDayMwh: daily / rte, boughtShare: TENDER.marketShare, boughtMwhYear: TENDER.marketShare * yearly, ownShareWithMarket, ownShareAlone, solarWithMarket, solarAlone, plantSolar },
    money,
    evenings: { low: settle(low, X, sp, date(low.d)), middle: settle(middle, X, sp, date(middle.d)), high: settle(high, X, sp, date(high.d)) },
    month,
    year,
  };
}
