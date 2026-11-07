// The CfD plant's operation in 15-minute time blocks (96 a day, the scheduling block of the Indian
// Grid Code) for every day of the 15-year term, from the day-by-day model (model.js simulate).
//
// The model decides each day in hours: the two peak hours it supplies, what the battery charges from
// own RE, the green market and group RE in each hour before 18:00, what surplus it sells. This module
// turns each hour of that plan into four blocks, keeping the hour's energy exactly:
//
//   solar, wind       split along the hour's trend (half the change from the previous to the next
//                     hour), every value within [0, the day's peak]: the shape the engine's 15-minute
//                     dispatch uses for the SECI tender (engine/sizing/dispatch15.py split_hourly)
//   own-RE charging   follows the generation within the hour (a block charges no more than it makes)
//   bought charging   the hour's purchase spread evenly: the IEX prices are hourly, so the four
//                     blocks of an hour have the same price and the same purchase
//   discharge         even over the peak hour; wind supplied directly follows the wind
//   surplus sold      follows the generation; the evening-sale battery's output is even
//   battery energy    tracked block by block: stored + charging × ¼ h × round trip − discharge × ¼ h
//
// The sums over the four blocks equal the hour's values, so every Contract Year's totals here equal
// the model's (tools/check_cfd_dispatch15.mjs proves it). What the 15-minute view adds is the
// block-level shape: when within the hour the battery is at full power, where the state of charge
// peaks, and how the solar ramps sit against the charging. It cannot add 15-minute price detail:
// the price year is hourly.

import { TENDER } from "./terms.js";
import { simulate, socWindow } from "./model.js";

export const BLOCKS_PER_HOUR = 4;
export const BLOCKS_PER_DAY = 24 * BLOCKS_PER_HOUR;
export const DT = 1 / BLOCKS_PER_HOUR; // hours per block
const DAY_MS = 86400000;
const OFFS = [-3, -1, 1, 3];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "HH:MM" at the start of block b (0-based) of the day. */
export const blockTime = (b) => `${String(Math.floor(b / BLOCKS_PER_HOUR)).padStart(2, "0")}:${String((b % BLOCKS_PER_HOUR) * 15).padStart(2, "0")}`;

/**
 * Four 15-minute values per hour that follow the hour's trend and average to the hour's value.
 * Within hour h the blocks are v + s × (−3, −1, 1, 3)/8, s the hour's slope (half the change from
 * the previous to the next hour), limited so that every block stays within [0, peak].
 */
export function splitHourly(values, peak = null) {
  const n = values.length;
  let top = peak;
  if (!(top > 0)) { top = 0; for (const v of values) if (v > top) top = v; }
  const out = new Float64Array(n * BLOCKS_PER_HOUR);
  for (let h = 0; h < n; h += 1) {
    const v = values[h];
    const prev = values[h > 0 ? h - 1 : h];
    const next = values[h < n - 1 ? h + 1 : h];
    const room = (Math.max(0, Math.min(v, top - v)) * 8) / 3;
    const slope = Math.max(-room, Math.min(room, (next - prev) / 2));
    for (let q = 0; q < BLOCKS_PER_HOUR; q += 1) out[h * BLOCKS_PER_HOUR + q] = Math.min(Math.max(0, v + (slope * OFFS[q]) / 8), Math.max(top, 0));
  }
  return out;
}

/** What the block arithmetic needs of the plant: from the model's inputs and its simulation. */
export function blockContext(inputs, sim) {
  const X = inputs.contractedMw;
  const lf = sim?.loss || inputs.loss || null;
  return {
    X,
    P: X * inputs.essMwPerMw,
    meter: lf?.meter ?? 1,
    rte: lf ? lf.rteBus : inputs.rte,
    socMin: Number.isFinite(inputs.essSocMin) ? inputs.essSocMin : 0,
    window: socWindow(inputs),
    nameplate: X * ((inputs.essMwhPerMw || 0) + (inputs.extraEssMwhPerMw || 0)),
    solarMw: inputs.solarMw || 0,
    windMw: inputs.windMw || 0,
  };
}

/** The columns of a block row: [key, header, decimals]. MW are block averages. */
export const BLOCK_COLUMNS = [
  ["peak", "Peak block (1 = supply due)", 0],
  ["solar", "Solar output MW (33 kV bus)", 2],
  ["wind", "Wind output MW (bus)", 2],
  ["chargeOwn", "Charging from own RE MW (bus)", 2],
  ["chargeMarket", "Charging bought from the green market MW (meter)", 2],
  ["chargeGroup", "Charging from group RE MW (meter)", 2],
  ["discharge", "Battery discharge MW (bus)", 2],
  ["stored", "Battery energy stored MWh (usable, after the round trip)", 2],
  ["soc", "Battery state of charge % of nameplate", 1],
  ["windDirect", "Wind supplied directly MW (meter)", 2],
  ["delivered", "Delivered to the exchange MW (meter)", 2],
  ["required", "Supply due MW (meter)", 2],
  ["short", "Short of the supply due MW", 3],
  ["sold", "Surplus sold MW (meter)", 2],
  ["curtailed", "Curtailed MW (bus)", 2],
  ["sellPrice", "Selling-market price Rs/kWh", 3],
  ["buyPrice", "GDAM price Rs/kWh (charging)", 3],
];

/**
 * One day in 96 blocks from the model's hourly record of that day (simulate's `days[k]`): the
 * columns above as Float64Array(96), plus the day's date, Contract Year and day number.
 */
export function dayBlocks(day, ctx) {
  const n = BLOCKS_PER_DAY;
  const cols = Object.fromEntries(BLOCK_COLUMNS.map(([k]) => [k, new Float64Array(n)]));
  const solar = splitHourly(day.solar);
  const wind = splitHourly(day.wind);
  const peak = new Set(day.chosen);
  const perHourOut = day.chosen.length ? day.essOut / day.chosen.length : 0; // MW at the bus in each peak hour
  const degr = Number.isFinite(day.capFactor) ? day.capFactor : 1;
  const nameplate = ctx.nameplate * degr;
  let stored = 0;
  for (let h = 0; h < 24; h += 1) {
    const b0 = h * BLOCKS_PER_HOUR;
    let genSum = 0;
    let windSum = 0;
    for (let q = 0; q < BLOCKS_PER_HOUR; q += 1) { genSum += solar[b0 + q] + wind[b0 + q]; windSum += wind[b0 + q]; }
    const own = day.own[h] || 0; // MWh in the hour, at the bus
    const market = day.market[h] || 0; // at the bus
    const group = day.group[h] || 0;
    const extraOut = day.extraOut?.[h] || 0; // the evening-sale battery, at the bus
    const surplus = Math.max(0, (day.sale[h] || 0) - extraOut); // own RE sold, at the bus
    const direct = day.windDirect?.[h] || 0; // at the meter
    const isPeak = peak.has(h);
    // own-RE charging follows the generation within the hour (the hour's MWh shared as the
    // generation falls), then held within the battery's power: a block over it hands the excess to
    // the other blocks of the hour that have generation and room
    const ownQ = new Float64Array(BLOCKS_PER_HOUR);
    for (let q = 0; q < BLOCKS_PER_HOUR; q += 1) ownQ[q] = own * (genSum > 0 ? (solar[b0 + q] + wind[b0 + q]) / genSum : 1 / BLOCKS_PER_HOUR) * BLOCKS_PER_HOUR;
    const roomOwn = Math.max(0, ctx.P - market - group);
    let excess = 0;
    for (let pass = 0; pass < 3; pass += 1) {
      excess = 0;
      let roomSum = 0;
      for (let q = 0; q < BLOCKS_PER_HOUR; q += 1) {
        if (ownQ[q] > roomOwn) { excess += ownQ[q] - roomOwn; ownQ[q] = roomOwn; } else roomSum += Math.min(roomOwn, solar[b0 + q] + wind[b0 + q]) - ownQ[q];
      }
      if (excess <= 1e-9 || roomSum <= 1e-9) break;
      for (let q = 0; q < BLOCKS_PER_HOUR; q += 1) {
        const room = Math.max(0, Math.min(roomOwn, solar[b0 + q] + wind[b0 + q]) - ownQ[q]);
        ownQ[q] += (excess * room) / roomSum;
      }
      excess = 0;
    }
    // what no block of the hour has room for (a steep ramp: the hour's average was within the
    // battery's power, the generation inside it is not) stays with the generation, over the
    // rating; the hour's energy is kept and the block is counted (overPower)
    if (excess > 1e-9) for (let q = 0; q < BLOCKS_PER_HOUR; q += 1) ownQ[q] += excess * (genSum > 0 ? (solar[b0 + q] + wind[b0 + q]) / genSum : 1 / BLOCKS_PER_HOUR);
    for (let q = 0; q < BLOCKS_PER_HOUR; q += 1) {
      const b = b0 + q;
      const gen = solar[b] + wind[b];
      const wGen = genSum > 0 ? gen / genSum : 1 / BLOCKS_PER_HOUR; // the block's share of the hour's generation
      const wWind = windSum > 0 ? wind[b] / windSum : 1 / BLOCKS_PER_HOUR;
      const chargeOwn = ownQ[q];
      const chargeMarket = market; // MW at the bus, even over the hour
      const chargeGroup = group;
      const discharge = (isPeak ? perHourOut : 0) + extraOut;
      const windDirect = direct * wWind * BLOCKS_PER_HOUR;
      const delivered = windDirect + (isPeak ? perHourOut * ctx.meter : 0);
      const sold = (surplus * wGen * BLOCKS_PER_HOUR + extraOut) * ctx.meter;
      stored = Math.max(0, stored + (chargeOwn + chargeMarket + chargeGroup) * DT * ctx.rte - discharge * DT);
      cols.peak[b] = isPeak ? 1 : 0;
      cols.solar[b] = solar[b];
      cols.wind[b] = wind[b];
      cols.chargeOwn[b] = chargeOwn;
      cols.chargeMarket[b] = chargeMarket / ctx.meter;
      cols.chargeGroup[b] = chargeGroup / ctx.meter;
      cols.discharge[b] = discharge;
      cols.stored[b] = stored;
      cols.soc[b] = nameplate > 0 ? 100 * Math.min(1, ctx.socMin + stored / nameplate) : 0;
      cols.windDirect[b] = windDirect;
      cols.delivered[b] = delivered;
      cols.required[b] = isPeak ? ctx.X : 0;
      cols.short[b] = isPeak ? Math.max(0, ctx.X - delivered) : 0;
      cols.sold[b] = sold;
      cols.curtailed[b] = Math.max(0, gen - chargeOwn - surplus * wGen * BLOCKS_PER_HOUR - windDirect / ctx.meter);
      cols.sellPrice[b] = day.price[h];
      cols.buyPrice[b] = day.buyPrice[h];
    }
  }
  return { date: day.date, k: day.k, cy: day.cy, year: day.year, cols };
}

const blankTotals = () => ({
  blocks: 0, peakBlocks: 0, peakBlocksFull: 0, shortBlocks: 0, deliveredMwh: 0, requiredMwh: 0, shortMwh: 0,
  solarMwh: 0, windMwh: 0, chargeOwnMwh: 0, chargeMarketMwh: 0, chargeGroupMwh: 0, dischargeMwh: 0, soldMwh: 0, curtailedMwh: 0,
  maxChargeMw: 0, maxDischargeMw: 0, maxSoc: 0, minSoc: 100, days: 0, overPower: 0,
});

function addDay(tot, d) {
  const c = d.cols;
  tot.days += 1;
  for (let b = 0; b < BLOCKS_PER_DAY; b += 1) {
    tot.blocks += 1;
    if (c.peak[b]) {
      tot.peakBlocks += 1;
      if (c.delivered[b] >= c.required[b] * (1 - TENDER.weeklyTolerance) - 1e-6) tot.peakBlocksFull += 1; else tot.shortBlocks += 1;
    }
    tot.deliveredMwh += c.delivered[b] * DT;
    tot.requiredMwh += c.required[b] * DT;
    tot.shortMwh += c.short[b] * DT;
    tot.solarMwh += c.solar[b] * DT;
    tot.windMwh += c.wind[b] * DT;
    tot.chargeOwnMwh += c.chargeOwn[b] * DT;
    tot.chargeMarketMwh += c.chargeMarket[b] * DT;
    tot.chargeGroupMwh += c.chargeGroup[b] * DT;
    tot.dischargeMwh += c.discharge[b] * DT;
    tot.soldMwh += c.sold[b] * DT;
    tot.curtailedMwh += c.curtailed[b] * DT;
    const ch = c.chargeOwn[b] + c.chargeMarket[b] + c.chargeGroup[b];
    if (ch > tot.maxChargeMw) tot.maxChargeMw = ch;
    if (ch > tot.P + 1e-6) tot.overPower += 1;
    if (c.discharge[b] > tot.maxDischargeMw) tot.maxDischargeMw = c.discharge[b];
    if (c.soc[b] > tot.maxSoc) tot.maxSoc = c.soc[b];
    if (c.soc[b] < tot.minSoc) tot.minSoc = c.soc[b];
  }
}

/**
 * Every day of the term in 15-minute blocks. `onDay(blocks)` receives each day (dayBlocks) in
 * order; the return is the totals per Contract Year (`years`) and per month of each Contract Year
 * (`months`), plus the number of blocks. Streams: nothing but the totals is kept.
 */
export function dispatch15(model, { onDay = null } = {}) {
  const ctx = blockContext(model.inputs, model.sim);
  const years = new Map();
  const months = new Map();
  let blocks = 0;
  simulate(model.inputs, model.book, model.prof, {
    onDay: (k, rec) => {
      const d = dayBlocks(rec, ctx);
      blocks += BLOCKS_PER_DAY;
      let y = years.get(d.cy);
      if (!y) { y = { cy: d.cy, start: rec.date, ...blankTotals(), P: ctx.P }; years.set(d.cy, y); }
      y.end = rec.date + DAY_MS;
      addDay(y, d);
      const dt = new Date(rec.date);
      const mk = `${d.cy}-${dt.getUTCFullYear()}-${dt.getUTCMonth()}`;
      let m = months.get(mk);
      if (!m) { m = { cy: d.cy, year: dt.getUTCFullYear(), month: dt.getUTCMonth(), label: `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`, ...blankTotals(), P: ctx.P }; months.set(mk, m); }
      addDay(m, d);
      if (onDay) onDay(d);
    },
  });
  const ys = [...years.values()];
  for (const y of ys) {
    y.supplyShare = y.requiredMwh > 0 ? y.deliveredMwh / y.requiredMwh : 0;
    y.peakFullShare = y.peakBlocks > 0 ? y.peakBlocksFull / y.peakBlocks : 0;
  }
  return { years: ys, months: [...months.values()], blocks, ctx, termYears: TENDER.termYears };
}

/** The summary columns of a Contract Year or a month: [key, header, decimals]. */
export const SUMMARY_COLUMNS = [
  ["days", "Days", 0], ["blocks", "Blocks", 0], ["peakBlocks", "Peak blocks (supply due)", 0], ["peakBlocksFull", "Peak blocks within the 10% tolerance", 0], ["shortBlocks", "Peak blocks below it", 0],
  ["deliveredMwh", "Delivered MWh (meter)", 1], ["requiredMwh", "Supply due MWh", 1], ["shortMwh", "Short MWh", 2],
  ["solarMwh", "Solar MWh (bus)", 1], ["windMwh", "Wind MWh (bus)", 1],
  ["chargeOwnMwh", "Charged from own RE MWh (bus)", 1], ["chargeMarketMwh", "Charged from the green market MWh (meter)", 1], ["chargeGroupMwh", "Charged from group RE MWh (meter)", 1],
  ["dischargeMwh", "Discharged MWh (bus)", 1], ["soldMwh", "Surplus sold MWh (meter)", 1], ["curtailedMwh", "Curtailed MWh (bus)", 1],
  ["maxChargeMw", "Highest charging MW", 2], ["overPower", "Blocks charging over the battery's rating", 0], ["maxDischargeMw", "Highest discharge MW", 2], ["minSoc", "Lowest state of charge %", 1], ["maxSoc", "Highest state of charge %", 1],
];
