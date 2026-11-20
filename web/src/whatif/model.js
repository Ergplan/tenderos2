// What-if analysis: the bidder's own sizes, costs, financing and bid tariff, run through an hourly
// dispatch of every PPA year against the tender's supply floors, then the 25-year financial model
// at that tariff. Answers: what equity and project IRR does this bid earn, what does the lender
// see, what tariff would the target IRR need, and does this plant meet the tender. Plain
// JavaScript, used in Node by tools/check_whatif.mjs.
//
// The dispatch is rule-based and instant (so every change answers at once): renewable output
// serves the contract; the battery charges from surplus; in the Peak Hours it discharges to the
// full contracted capacity, outside them only up to the off-peak floor, keeping energy for the
// peak. Under Amendment-03 the contract in a Solar Hour is at most 60%, and what the plant sells
// above it in those hours goes to the buyer at half the tariff when the market pays more. Energy is counted at the billing meter after the power transformer and line losses, as in
// the rest of the app. The HiGHS sizing in the SECI tab optimises the dispatch; this does not.
import * as E from "../rtc/engine.js";
import { scaleToCuf, peakHours } from "../bid/model.js";
import { PACK, PEAK_PLANS, seciTerms } from "../seci/terms.js";
import { DSM_DEFAULTS, dsmLines } from "../dsm/dsm.js";
import { genSource } from "../model/generation.js";
import { costliestHours } from "../seci/peakPrices.js";
import { fdrexTerms } from "../fdrex/bidTerms.js";

export const WHATIF_NOTE = "Rule-based dispatch (battery held for the Peak Hours): an instant check of a size, not the HiGHS optimum.";

export function defaultWhatIf() {
  return {
    peakPlan: "price",
    shortfall: "penalty",
    profile: "amd3", // the supply profile: Amendment-03's (in force) or Amendment-01's ("amd1")
    contractedMw: 300,
    solarMwac: 785,
    dcAc: 1.4,
    windMw: 440,
    bessMw: 635,
    bessHours: 4,
    solarCuf: 0.25,
    windCuf: 0.33,
    trafoLossPct: 0.004,
    lineLossPct: 0.005,
    bess: { rte: 0.87, minSoc: 0.05, maxSoc: 0.95, annualDegradation: 0.02, augmentation: "annual", augmentationYear: 12, costDeclinePct: 0.03 },
    costs: { solarCrPerMwac: 4.0, windCrPerMw: 6.5, bessCrPerMwh: 1.2, bessPcsCrPerMw: 0, evacuationCr: 150, preopPct: 0.05 },
    dsm: { ...DSM_DEFAULTS }, // deviation settlement (CERC DSM) norms and the forecast-error assumption
    om: { solarLakhPerMwac: 4.0, windLakhPerMw: 9.0, bessLakhPerMwh: 1.2 },
    fin: {
      tariff: 7.0,
      tariffEscalation: 0,
      targetEquityIrr: 0.14,
      debtFraction: 0.75,
      interestRate: 0.09,
      tenorYears: 18,
      repayment: "equal",
      taxRate: 0.2517,
      taxDepreciation: "wdv",
      wdvRate: 0.4,
      bookLifeYears: 25,
      salvagePct: 0.1,
      omEscalation: 0.05,
      insurancePct: 0.003,
      otherFixedCr: 0,
      receivableDays: 45,
      sellSurplus: true,
      surplusPrice: 3.0,
      solarDegradation: 0.005,
      windDegradation: 0,
      discountRate: 0.1,
      minDscr: 1.1,
    },
  };
}

/** A case of the FDRE-X Bid tab (SECI-FDRE-X: the buyer's 4 hours, the monthly rule, bought power). */
export const isFdrex = (input) => input?.tender === "fdrex";

/**
 * The tender's rules this run checks: SECI FDRE-RTC-V, under the bidder's profile, peak plan and
 * shortfall choice; or, for an FDRE-X case, SECI-FDRE-X under its settings (the IEX prices pick
 * the buyer's 4 hours of the "costliest hours" plan).
 */
export function whatIfTerms(input, prices = null) {
  if (isFdrex(input)) return fdrexTerms(input.fdrex, prices);
  return seciTerms({ peakPlan: input.peakPlan, shortfall: input.shortfall, ppaDate: null, profile: input.profile === "amd1" ? "amd1" : "amd3", solarHours: input.solarHours || null });
}

/** The words for a rule's hours. */
export const HOURS_TEXT = { peak: "peak", offpeak: "off-peak", solar: "Solar", remaining: "Remaining" };

const profileCache = new Map();
/** Hourly capacity factors at the given CUF: the typical shape, or an uploaded one. */
export function profilesFor(input) {
  const key = `${input.solarCuf}|${input.dcAc}|${input.windCuf}|${input.solarUpload?.name || ""}|${input.windUpload?.name || ""}`;
  if (profileCache.has(key)) return profileCache.get(key);
  const solarShape = input.solarUpload?.values ? Float64Array.from(input.solarUpload.values) : E.synthSolarCf({ targetCuf: input.solarCuf, dcAc: input.dcAc || 1 });
  const windShape = input.windUpload?.values ? Float64Array.from(input.windUpload.values) : E.synthWindCf({ targetCuf: input.windCuf });
  const out = { solarCf: scaleToCuf(solarShape, input.solarCuf), windCf: scaleToCuf(windShape, input.windCuf) };
  if (profileCache.size > 20) profileCache.clear();
  profileCache.set(key, out);
  return out;
}

/** Which hours of the day are Peak Hours under the plan (1) and which are off-peak (0). */
export function peakHourMask(plan) {
  const p = PEAK_PLANS[plan] || PEAK_PLANS.any;
  const set = new Set(peakHours({ start: p.start, hours: p.hours }));
  return Array.from({ length: 24 }, (_, h) => (set.has(h) ? 1 : 0));
}

/**
 * The Peak Hours of the year, hour by hour: the costliest IEX hours of each day's window under the
 * "costliest hours" plan (when the prices are there), else the plan's hours of every day.
 */
export function peakYearMask(plan, prices = null) {
  const picked = PEAK_PLANS[plan]?.byPrice ? costliestHours(prices) : null;
  if (picked) return picked.mask;
  const day = peakHourMask(plan);
  return Uint8Array.from({ length: E.HOURS }, (_, t) => day[E.HOUR_OF_DAY[t]]);
}

/**
 * One year's hourly dispatch. f: the year's degradation factors (E.yearFactors). Returns the
 * year's totals at the meter, each floor's hours met and energy short, and (hourly: true) the hours.
 */
export function dispatchYear(input, prof, f, { hourly = false, peak: peakYear = null, terms: given = null, buy = null, tariff = 0, sellPrice = null } = {}) {
  const terms = given || whatIfTerms(input);
  if (isFdrex(input)) return dispatchFdrexYear(input, prof, f, terms, { hourly, buy, tariff, sellPrice });
  const peak = peakYear || peakYearMask(input.peakPlan);
  const floors = Object.fromEntries(terms.rules.map((r) => [r.hours, r.target]));
  // Amendment-03: the Solar Hours outside the Peak Hours (an hour picked as a Peak Hour stays one)
  const solarRule = terms.rules.find((r) => r.hours === "solar");
  const solarHr = terms.solar?.mask || null;
  const offKey = solarRule ? "remaining" : "offpeak";
  const C = input.contractedMw;
  const poi = (1 - input.trafoLossPct) * (1 - input.lineLossPct);
  const S = input.solarMwac * f.solarFactor;
  const W = input.windMw * f.windFactor;
  const B = input.bessMw;
  const Ecap = input.bessMw * input.bessHours * f.bessFactor;
  const b = input.bess;
  const eta = Math.sqrt(Math.min(1, Math.max(0.5, b.rte)));
  const socMin = Ecap * b.minSoc;
  const socMax = Ecap * b.maxSoc;
  let soc = Ecap * 0.5;
  const busNeed = C / poi; // what the bus must send for the contract at the meter
  const sell = Boolean(input.fin.sellSurplus);
  const H = hourly ? { delivered: new Float32Array(E.HOURS), floor: new Float32Array(E.HOURS), solar: new Float32Array(E.HOURS), wind: new Float32Array(E.HOURS), discharge: new Float32Array(E.HOURS), charge: new Float32Array(E.HOURS), excess: new Float32Array(E.HOURS), curtail: new Float32Array(E.HOURS), soc: new Float32Array(E.HOURS), peak: new Uint8Array(E.HOURS) } : null;
  const t = { demand: 0, delivered: 0, excess: 0, solarExcess: 0, curtail: 0, charge: 0, discharge: 0, solar: 0, wind: 0, injected: 0 };
  const rules = Object.fromEntries(terms.rules.map((r) => [r.hours, { hours: 0, met: 0, shortMWh: 0 }]));
  for (let h = 0; h < E.HOURS; h += 1) {
    const isPeak = peak[h] === 1;
    const kind = isPeak ? "peak" : solarRule && solarHr[h] ? "solar" : offKey;
    const cap = kind === "solar" ? busNeed * (solarRule.max ?? 1) : busNeed; // the most the PPA takes
    const s = S * prof.solarCf[h];
    const w = W * prof.windCf[h];
    const g = s + w;
    const direct = Math.min(g, cap);
    let surplus = g - direct;
    // the battery fills the contract in the peak, only the floor outside it
    const want = isPeak ? busNeed : busNeed * (floors[kind] ?? 0);
    let dis = 0;
    if (direct < want && Ecap > 0) dis = Math.max(0, Math.min(want - direct, B, (soc - socMin) * eta));
    soc -= dis / eta;
    let ch = 0;
    if (surplus > 0 && Ecap > 0) {
      ch = Math.max(0, Math.min(surplus, B, (socMax - soc) / eta));
      soc += ch * eta;
      surplus -= ch;
    }
    const deliveredBus = direct + dis;
    const room = sell ? Math.max(0, busNeed - deliveredBus) : 0; // the connection the PPA leaves
    const ex = Math.min(surplus, room);
    const cu = surplus - ex;
    const delivered = deliveredBus * poi;
    const floor = floors[kind] * C;
    const r = rules[kind];
    r.hours += 1;
    if (delivered >= floor - 1e-6) r.met += 1;
    else r.shortMWh += floor - delivered;
    t.demand += C;
    t.delivered += delivered;
    t.excess += ex * poi;
    if (kind === "solar") t.solarExcess += ex * poi;
    t.curtail += cu;
    t.charge += ch;
    t.discharge += dis * poi;
    t.solar += s;
    t.wind += w;
    t.injected += deliveredBus + ex;
    if (H) {
      H.delivered[h] = delivered;
      H.floor[h] = floor;
      const share = g > 0 ? s / g : 0;
      H.solar[h] = direct * share * poi;
      H.wind[h] = direct * (1 - share) * poi;
      H.discharge[h] = dis * poi;
      H.charge[h] = ch;
      H.excess[h] = ex * poi;
      H.curtail[h] = cu;
      H.soc[h] = Ecap > 0 ? soc / Ecap : 0;
      H.peak[h] = isPeak ? 1 : 0;
    }
  }
  return {
    demandMWh: t.demand,
    deliveredMWh: t.delivered,
    excessMWh: t.excess,
    curtailMWh: t.curtail,
    chargeMWh: t.charge,
    dischargeMWh: t.discharge,
    solarGenMWh: t.solar,
    windGenMWh: t.wind,
    injectedMWh: t.injected,
    trafoLossMWh: t.injected * input.trafoLossPct,
    lineLossMWh: t.injected * (1 - input.trafoLossPct) * input.lineLossPct,
    meterMWh: t.injected * poi,
    solarExcessMWh: t.solarExcess, // sold in the Solar Hours: the buyer's first right (Amendment-03)
    blockShortfallMWh: Object.values(rules).reduce((a, r) => a + r.shortMWh, 0),
    rules: Object.fromEntries(Object.entries(rules).map(([k, r]) => [k, { ...r, share: r.hours ? r.met / r.hours : 1 }])),
    hourly: H,
  };
}

/**
 * One year of SECI-FDRE-X, rule-based: the demand is the contracted MW in the buyer's 4 hours each
 * day (terms.supplyMask) and nothing else. Renewable output serves those hours; the battery charges
 * from any surplus and discharges only in them (as in the sizing, the storage serves the PPA; the
 * sale is of the plant's own output). The surplus is sold up to the connection in the hours a sale
 * is allowed (terms.saleMask): once a night's buyer's hours are over, before it charges the battery
 * (the day refills it from output that cannot be sold); before them, after it. At the hour's market
 * price when sellPrice (₹/kWh) is given, else at the flat surplus price. Then the power bought
 * (when the case buys and the prices are there: buy, the year's hourly price in ₹/kWh), within
 * terms.purchase.maxShare of the year's energy: first, in each month, the energy short beyond the
 * free tolerance, cheapest hours first, while it costs less than the tariff and the penalty it
 * saves; then any hour still short, cheapest first, while it costs less than the tariff. The
 * month's energy short beyond the tolerance after that is the penalised energy.
 */
function dispatchFdrexYear(input, prof, f, terms, { hourly = false, buy = null, tariff = 0, sellPrice = null } = {}) {
  const supply = terms.supplyMask;
  const saleOk = terms.saleMask || null;
  const rule = terms.rules[0];
  const hardRule = terms.shortfall === "hard";
  const tol = hardRule ? 0 : rule.tolerance || 0;
  const C = input.contractedMw;
  const poi = (1 - input.trafoLossPct) * (1 - input.lineLossPct);
  const S = input.solarMwac * f.solarFactor;
  const W = input.windMw * f.windFactor;
  const B = input.bessMw;
  const Ecap = input.bessMw * input.bessHours * f.bessFactor;
  const b = input.bess;
  const eta = Math.sqrt(Math.min(1, Math.max(0.5, b.rte)));
  const socMin = Ecap * b.minSoc;
  const socMax = Ecap * b.maxSoc;
  let soc = Ecap * 0.5;
  const busNeed = C / poi;
  const sell = Boolean(input.fin.sellSurplus);
  // for each hour: is a buyer's hour still ahead before the next 06:00 (the end of the night)?
  const ahead = new Uint8Array(E.HOURS);
  for (let h = E.HOURS - 1, next = 0; h >= 0; h -= 1) {
    if (E.HOUR_OF_DAY[h] === 5) next = 0; // 05:00 is the night's last hour
    ahead[h] = next;
    if (supply[h]) next = 1;
  }
  const H = hourly ? { delivered: new Float32Array(E.HOURS), floor: new Float32Array(E.HOURS), solar: new Float32Array(E.HOURS), wind: new Float32Array(E.HOURS), discharge: new Float32Array(E.HOURS), bought: new Float32Array(E.HOURS), charge: new Float32Array(E.HOURS), excess: new Float32Array(E.HOURS), curtail: new Float32Array(E.HOURS), soc: new Float32Array(E.HOURS), peak: new Uint8Array(E.HOURS) } : null;
  const t = { demand: 0, own: 0, excess: 0, curtail: 0, charge: 0, discharge: 0, solar: 0, wind: 0, injected: 0, saleRev: 0 };
  const short = new Float64Array(E.HOURS); // MWh at the meter still short in a buyer's hour
  const soldAt = new Float64Array(E.HOURS); // MWh sold at the meter, by hour (undone below on a day left short)
  const md = new Float64Array(12);
  const mv = new Float64Array(12);
  for (let h = 0; h < E.HOURS; h += 1) {
    const inSupply = supply[h] === 1;
    const need = inSupply ? busNeed : 0;
    const s = S * prof.solarCf[h];
    const w = W * prof.windCf[h];
    const g = s + w;
    const direct = Math.min(g, need);
    let surplus = g - direct;
    let dis = 0;
    if (direct < need && Ecap > 0) dis = Math.max(0, Math.min(need - direct, B, (soc - socMin) * eta));
    soc -= dis / eta;
    const deliveredBus = direct + dis;
    const canSell = sell && (!saleOk || saleOk[h]);
    const room = canSell ? Math.max(0, busNeed - deliveredBus) : 0;
    // with the night's buyer's hours over, the surplus is sold before it charges the battery (the
    // day refills it); before them, or where no sale is allowed, the battery charges first
    const sellFirst = canSell && !inSupply && !ahead[h];
    let ex = sellFirst ? Math.min(surplus, room) : 0;
    surplus -= ex;
    let ch = 0;
    if (surplus > 0 && Ecap > 0) {
      ch = Math.max(0, Math.min(surplus, B, (socMax - soc) / eta));
      soc += ch * eta;
      surplus -= ch;
    }
    if (!sellFirst) { const more = Math.min(surplus, room); ex += more; surplus -= more; }
    const cu = surplus;
    const sold = ex * poi;
    const own = deliveredBus * poi;
    const floor = inSupply ? C : 0;
    const m = E.MONTH_OF_HOUR[h];
    md[m] += floor;
    mv[m] += Math.min(own, floor);
    if (inSupply && own < floor - 1e-9) short[h] = floor - own;
    t.demand += floor;
    t.own += Math.min(own, floor);
    t.excess += sold;
    soldAt[h] = sold;
    if (sellPrice) t.saleRev += sold * sellPrice[h] * 1e-4;
    t.curtail += cu;
    t.charge += ch;
    t.discharge += dis * poi;
    t.solar += s;
    t.wind += w;
    t.injected += deliveredBus + ex;
    if (H) {
      H.delivered[h] = own;
      H.floor[h] = floor;
      const share = g > 0 ? s / g : 0;
      H.solar[h] = direct * share * poi;
      H.wind[h] = direct * (1 - share) * poi;
      H.discharge[h] = dis * poi;
      H.charge[h] = ch;
      H.excess[h] = sold;
      H.curtail[h] = cu;
      H.soc[h] = Ecap > 0 ? soc / Ecap : 0;
      H.peak[h] = inSupply ? 1 : 0;
    }
  }
  // the power bought, within the year's share
  const bought = new Float64Array(E.HOURS);
  let buyCost = 0;
  if (terms.purchase?.enabled && buy) {
    const charges = terms.purchase.chargesRsPerKwh || 0;
    let left = (terms.purchase.maxShare || 0) * t.demand;
    const price = (h) => buy[h] + charges;
    const take = (h, mwh) => { const q = Math.min(mwh, short[h] - bought[h], left); if (q > 0) { bought[h] += q; left -= q; buyCost += q * price(h) * 1e-4; } return q > 0 ? q : 0; };
    const hoursOf = Array.from({ length: 12 }, () => []);
    for (let h = 0; h < E.HOURS; h += 1) if (short[h] > 0) hoursOf[E.MONTH_OF_HOUR[h]].push(h);
    // 0. a day a little short, with surplus to sell (before the penalty's energy: it gains more per MWh bought): buying the rest of its supply lets the day sell
    // (nothing is sold on a day left short). Worth it while the energy's tariff and the day's sales
    // come to more than the power costs; the days that gain most per MWh bought first.
    if (terms.saleOnMetDays && sell) {
      const flat = input.fin.surplusPrice || 0;
      const days = [];
      for (let d = 0; d < E.HOURS / 24; d += 1) {
        let gap = 0;
        let rev = 0;
        let cost = 0;
        const hrs = [];
        for (let h = d * 24; h < d * 24 + 24; h += 1) {
          if (short[h] > 0) { gap += short[h]; cost += short[h] * price(h); hrs.push(h); }
          rev += soldAt[h] * (sellPrice ? sellPrice[h] : flat);
        }
        if (gap <= 1e-6 || rev <= 0) continue;
        const gain = gap * tariff + rev - cost;
        if (gain > 0) days.push({ gap, hrs, perMwh: gain / gap });
      }
      days.sort((a, z) => z.perMwh - a.perMwh);
      for (const day of days) {
        if (day.gap > left) continue;
        for (const h of day.hrs) take(h, short[h]);
      }
    }
    // 1. each month's energy beyond the tolerance: it saves the penalty too (in full in "meet every month in full")
    const worth = hardRule ? Infinity : tariff * (1 + (rule.penaltyMultiple || 0));
    for (let m = 0; m < 12 && left > 0; m += 1) {
      let gap = Math.max(0, (1 - tol) * md[m] - mv[m]);
      for (const h of [...hoursOf[m]].sort((a, z) => price(a) - price(z))) {
        if (gap <= 1e-9 || left <= 0 || price(h) >= worth) break;
        gap -= take(h, gap);
      }
    }
    // 2. any hour still short, while the energy earns more than it costs
    const all = hoursOf.flat().sort((a, z) => price(a) - price(z));
    for (const h of all) {
      if (left <= 0 || price(h) >= tariff) break;
      take(h, Infinity);
    }
  }
  let boughtMWh = 0;
  for (let h = 0; h < E.HOURS; h += 1) {
    if (!bought[h]) continue;
    boughtMWh += bought[h];
    mv[E.MONTH_OF_HOUR[h]] += bought[h];
    if (H) { H.bought[h] = bought[h]; H.delivered[h] += bought[h]; }
  }
  // a sale while the day's supply is short is a breach (RfS 8.1.f, 1.5 x the day's highest exchange
  // rate on the volume): on a day still short after the power bought, nothing is sold; what was
  // counted as sold is curtailed instead
  let shortDays = 0;
  if (terms.saleOnMetDays) {
    for (let d = 0; d < E.HOURS / 24; d += 1) {
      let gap = 0;
      for (let h = d * 24; h < d * 24 + 24; h += 1) gap += short[h] - bought[h];
      if (gap <= 1e-6) continue;
      shortDays += 1;
      for (let h = d * 24; h < d * 24 + 24; h += 1) {
        const sold = soldAt[h];
        if (!sold) continue;
        t.excess -= sold;
        if (sellPrice) t.saleRev -= sold * sellPrice[h] * 1e-4;
        t.curtail += sold / poi;
        t.injected -= sold / poi;
        if (H) { H.excess[h] = 0; H.curtail[h] += sold / poi; }
      }
    }
  }
  const months = Array.from({ length: 12 }, (_, m) => {
    const share = md[m] > 0 ? mv[m] / md[m] : 1;
    const penaltyMWh = Math.max(0, (1 - tol) * md[m] - mv[m]);
    return { month: m + 1, demandMWh: md[m], deliveredMWh: mv[m], share, penaltyMWh, free: share >= 1 - tol - 1e-9 };
  });
  const penaltyMWh = months.reduce((a, x) => a + x.penaltyMWh, 0);
  const delivered = t.own + boughtMWh;
  return {
    demandMWh: t.demand,
    deliveredMWh: delivered,
    excessMWh: t.excess,
    curtailMWh: t.curtail,
    chargeMWh: t.charge,
    dischargeMWh: t.discharge,
    solarGenMWh: t.solar,
    windGenMWh: t.wind,
    injectedMWh: t.injected,
    trafoLossMWh: t.injected * input.trafoLossPct,
    lineLossMWh: t.injected * (1 - input.trafoLossPct) * input.lineLossPct,
    meterMWh: t.injected * poi,
    solarExcessMWh: 0,
    ...(sellPrice ? { surplusRevenueCr: t.saleRev } : {}),
    purchaseMWh: boughtMWh,
    purchaseShare: t.demand > 0 ? boughtMWh / t.demand : 0,
    purchaseCostCr: buyCost,
    // the energy short beyond the month's free tolerance, charged at the penalty multiple × tariff
    // (in "meet every month in full" there is no penalty: the energy short only loses its revenue)
    blockShortfallMWh: hardRule ? 0 : penaltyMWh,
    shortMWh: t.demand - delivered,
    ...(terms.saleOnMetDays ? { shortDays, saleDays: E.HOURS / 24 - shortDays } : {}),
    months,
    rules: { peak: { hours: countSupply(supply), met: countSupply(supply) - countShort(short, bought), shortMWh: t.demand - delivered, share: 1 - countShort(short, bought) / Math.max(1, countSupply(supply)) } },
    hourly: H,
  };
}

const countSupply = (mask) => { let n = 0; for (let h = 0; h < mask.length; h += 1) n += mask[h] ? 1 : 0; return n; };
const countShort = (short, bought) => { let n = 0; for (let h = 0; h < short.length; h += 1) if (short[h] - bought[h] > 1e-6) n += 1; return n; };

const sizesOf = (input) => ({
  solarMw: input.solarMwac,
  windMw: input.windMw,
  bessMw: input.bessMw,
  bessMwh: input.bessMw * input.bessHours,
});

const finOf = (input, terms) => ({
  ...E.DEFAULT_FINANCE,
  ...input.fin,
  years: terms.years || 25,
  solarOmLakhPerMw: input.om.solarLakhPerMwac,
  windOmLakhPerMw: input.om.windLakhPerMw,
  bessOmLakhPerMwh: input.om.bessLakhPerMwh,
  shortfallPenalty: 0,
  blockPenaltyMultiple: terms.shortfall === "hard" ? 0 : (terms.rules[0]?.penaltyMultiple || 0),
  psmRsPerKwh: terms.psmRsPerKwh || 0,
});

const costsOf = (input) => ({
  solarCrPerMw: input.costs.solarCrPerMwac,
  windCrPerMw: input.costs.windCrPerMw,
  bessCrPerMwh: input.costs.bessCrPerMwh,
  bessPcsCrPerMw: input.costs.bessPcsCrPerMw,
  evacuationCr: input.costs.evacuationCr,
  preopPct: input.costs.preopPct,
  constructionMonths: input.costs.constructionMonths || 0,
  drawdown: input.costs.drawdown || "linear",
  drawOrder: input.costs.drawOrder || "proRata",
});

/** A size for the checks' words: whole MW (a sized plant's are fractions), or `d` decimals. */
const mw = (v, d = 0) => Number(Number(v || 0).toFixed(d)).toLocaleString("en-IN");

/** IRR of the lender's flows: the loan out in year 0, interest and principal back each year. */
function debtIrr(finance) {
  const flows = [-finance.debt, ...finance.rows.map((r) => (r.interest || 0) + (r.principal || 0))];
  return finance.debt > 0 ? E.irr(flows) : null;
}

/**
 * The whole what-if: dispatch of every year, the financial model at the bid tariff and the tariff
 * the target IRR needs, the lender's view and the tender checks.
 */
export function runWhatIf(raw, { prices = null } = {}) {
  const d = defaultWhatIf();
  const input = { ...d, ...raw, bess: { ...d.bess, ...(raw?.bess || {}) }, costs: { ...d.costs, ...(raw?.costs || {}) }, om: { ...d.om, ...(raw?.om || {}) }, fin: { ...d.fin, ...(raw?.fin || {}) } };
  const fdrex = isFdrex(input);
  const terms = whatIfTerms(input, prices);
  const prof = profilesFor(input);
  const peak = fdrex ? null : peakYearMask(input.peakPlan, prices);
  const fin = finOf(input, terms);
  const bess = { ...E.DEFAULT_BESS, ...input.bess, durationH: input.bessHours };
  const sizes = sizesOf(input);
  const costs = costsOf(input);
  if (fdrex && typeof terms.otherCapexCr === "function") costs.otherCapexCr = terms.otherCapexCr(sizes, input.contractedMw);
  const years = fin.years;
  const ops = [];
  let year1 = null;
  const dsmYears = dsmLines({ dsm: input.dsm || DSM_DEFAULTS, sources: { solar: input.solarMwac > 0, wind: input.windMw > 0, bess: input.bessMw > 0 }, years });
  // SECI-FDRE-X: bought power at the hourly price of its market (₹/kWh), escalating as the market does
  const buyBase = fdrex && terms.purchase?.enabled ? prices?.markets?.[terms.purchase.market]?.hourlyRsPerMwh || null : null;
  // and the surplus sold at the hourly price of the bid's market (a flat price when it has none)
  const sellBase = fdrex && input.saleMarket ? prices?.markets?.[input.saleMarket]?.hourlyRsPerMwh || null : null;
  if (fdrex) {
    for (let y = 1; y <= years; y += 1) {
      const f = E.yearFactors(y, fin, bess);
      const k = (1 + (input.buyEscalation || 0)) ** (y - 1);
      const buy = buyBase ? Float64Array.from(buyBase, (v) => (v / 1000) * k) : null;
      const sellPrice = sellBase ? Float64Array.from(sellBase, (v) => (v / 1000) * k) : null;
      const r = dispatchYear(input, prof, f, { hourly: y === 1, terms, buy, sellPrice, tariff: fin.tariff * (1 + (fin.tariffEscalation || 0)) ** (y - 1) });
      if (y === 1) year1 = r;
      ops.push({ year: y, ...f, ...r, buyerExcessMWh: 0, buyerExcessShare: 0, chargingCostCr: r.purchaseCostCr, pxFeesCr: (fin.psmRsPerKwh || 0) * r.deliveredMWh * 1e-4, ...dsmYears[y - 1], hourly: undefined, months: undefined });
    }
  }
  for (let y = 1; y <= (fdrex ? 0 : years); y += 1) {
    const f = E.yearFactors(y, fin, bess);
    const r = dispatchYear(input, prof, f, { hourly: y === 1, peak });
    if (y === 1) year1 = r;
    // Amendment-03: the buyer takes the Solar Hours sales at its share of the bid tariff when the
    // (flat) market price is higher; otherwise they go to the market
    const share = terms.rules.find((x) => x.hours === "solar")?.excessTariffShare;
    const toBuyer = share != null && fin.surplusPrice > share * fin.tariff * (1 + (fin.tariffEscalation || 0)) ** (y - 1) ? r.solarExcessMWh : 0;
    ops.push({ year: y, ...f, ...r, excessMWh: r.excessMWh - toBuyer, buyerExcessMWh: toBuyer, buyerExcessShare: share || 0, ...dsmYears[y - 1], hourly: undefined });
  }
  const run = (locked, tariff = fin.tariff) => E.runFinancialModel(null, sizes, { costs, fin: { ...fin, tariff }, bess, dfrTarget: 0, tariffLocked: locked, ops, solveBy: "npv" });
  const atBid = run(true);
  const needed = run(false);
  const lenderIrr = debtIrr(atBid);
  // ---- tender checks
  const checks = [];
  const add = (id, label, ok, detail, hard = true) => checks.push({ id, label, ok, detail, hard });
  add("capacity", "Bid capacity", input.contractedMw >= terms.minBidMw && input.contractedMw <= terms.maxBidMw,
    `${input.contractedMw} MW; the tender takes ${terms.minBidMw}–${terms.maxBidMw} MW from one bidder`);
  add("storage", "Energy storage (mandatory)", input.bessMw > 0 && input.bessHours > 0, input.bessMw > 0 ? `${mw(input.bessMw)} MW × ${mw(input.bessHours, 2)} h` : "No battery: the tender requires storage");
  add("re", "Renewable sources", input.solarMwac + input.windMw > 0, `${mw(input.solarMwac)} MWac solar, ${mw(input.windMw)} MW wind`);
  const hard = terms.shortfall === "hard";
  if (fdrex) return fdrexResult({ input, terms, prof, sizes, costs, fin, bess, ops, year1, atBid, needed, lenderIrr, checks, add, hard, buyBase });
  for (const rule of terms.rules) {
    const y1 = year1.rules[rule.hours];
    const worst = Math.min(...ops.map((o) => o.rules[rule.hours].share));
    add(rule.id, rule.label, hard ? worst >= 1 - 1e-9 : true,
      `year 1: ${(y1.share * 100).toFixed(1)}% of ${HOURS_TEXT[rule.hours] || rule.hours} hours at ${(rule.target * 100).toFixed(0)}% of contracted; worst year ${(worst * 100).toFixed(1)}%`
        + (hard ? "" : `; short ${(y1.shortMWh / 1000).toFixed(1)} MU paid at ${rule.penaltyMultiple}× tariff`), hard);
  }
  const penaltyY1 = atBid.rows[0]?.blockPenalty || 0;
  const hardOk = checks.filter((c) => c.hard).every((c) => c.ok);
  const allFloors = terms.rules.every((r) => year1.rules[r.hours].share >= 1 - 1e-9);
  const verdict = !hardOk ? "fail" : allFloors ? "pass" : "penalty";
  const finance = {
    equityIrr: atBid.equityIrr,
    projectIrr: atBid.projectIrr,
    lenderIrr,
    equityNpv: atBid.equityNpv,
    projectNpv: atBid.projectNpv,
    minDscr: atBid.minDscr,
    avgDscr: atBid.avgDscr,
    lcoe: atBid.lcoe,
    payback: atBid.payback,
    tariffNeeded: needed.tariff,
    meetsTarget: Number.isFinite(atBid.equityIrr) && atBid.equityIrr >= fin.targetEquityIrr - 1e-6,
    bankable: atBid.minDscr === null || atBid.minDscr >= (input.fin.minDscr || 1.1) - 1e-9,
  };
  return { input, terms, prof, sizes, costs, fin, bess, ops, year1, atBid, needed, finance, checks, verdict, penaltyY1, live: liveRequest(input, terms, sizes, costs, fin, bess, ops, atBid, prof) };
}

/** The tender checks, the verdict and the returns of an FDRE-X case (runWhatIf's second half). */
function fdrexResult({ input, terms, prof, sizes, costs, fin, bess, ops, year1, atBid, needed, lenderIrr, checks, add, hard, buyBase }) {
  const rule = terms.rules[0];
  const tol = hard ? 0 : rule.tolerance || 0;
  const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
  // year 1 month by month; the later years by their share of the year's peak energy
  const y1Months = year1.months;
  const worstY1 = Math.min(...y1Months.map((m) => m.share));
  const freeY1 = y1Months.filter((m) => m.free).length;
  const penaltyYears = ops.filter((o) => (o.blockShortfallMWh || 0) > 1e-6).length;
  const worstYearShare = Math.min(...ops.map((o) => (o.demandMWh > 0 ? o.deliveredMWh / o.demandMWh : 1)));
  if (hard) {
    add("monthly", rule.label, worstY1 >= 1 - 1e-9 && worstYearShare >= 1 - 1e-9,
      `year 1: ${y1Months.filter((m) => m.share >= 1 - 1e-9).length} of 12 months in full, the worst at ${pct(worstY1)}; worst year ${pct(worstYearShare)} of the peak energy`);
  } else {
    add("monthly", rule.label, true,
      `year 1: ${freeY1} of 12 months within the free ${pct(tol, 0)}, the worst at ${pct(worstY1)}; ${(year1.blockShortfallMWh / 1000).toFixed(2)} MU beyond it at ${rule.penaltyMultiple}× tariff; penalised in ${penaltyYears} of ${ops.length} years`, false);
  }
  const maxShare = terms.purchase?.maxShare || 0;
  const worstBuy = Math.max(...ops.map((o) => o.purchaseShare || 0));
  add("purchase", `Power bought within ${pct(maxShare, 0)} of the year's energy`, worstBuy <= maxShare + 1e-9,
    !terms.purchase?.enabled ? "not bought (switched off)" : buyBase ? `year 1: ${(year1.purchaseMWh / 1000).toFixed(2)} MU, ${pct(year1.purchaseShare, 2)} of the energy; most in a year ${pct(worstBuy, 2)}` : "the market prices are loading: nothing bought yet");
  add("sale", "Sale outside the buyer's hours", true,
    !input.fin.sellSurplus ? "sale switched off" : terms.saleMask ? `${(year1.excessMWh / 1000).toFixed(0)} MU in year 1, none from 06:00 to 18:00 (no connectivity in the solar hours)` : `${(year1.excessMWh / 1000).toFixed(0)} MU in year 1, solar hours included`, false);
  const penaltyY1 = atBid.rows[0]?.blockPenalty || 0;
  const hardOk = checks.filter((c) => c.hard).every((c) => c.ok);
  const verdict = !hardOk ? "fail" : year1.blockShortfallMWh > 1e-6 ? "penalty" : "pass";
  const finance = {
    equityIrr: atBid.equityIrr,
    projectIrr: atBid.projectIrr,
    lenderIrr,
    equityNpv: atBid.equityNpv,
    projectNpv: atBid.projectNpv,
    minDscr: atBid.minDscr,
    avgDscr: atBid.avgDscr,
    lcoe: atBid.lcoe,
    payback: atBid.payback,
    tariffNeeded: needed.tariff,
    meetsTarget: Number.isFinite(atBid.equityIrr) && atBid.equityIrr >= fin.targetEquityIrr - 1e-6,
    bankable: atBid.minDscr === null || atBid.minDscr >= (input.fin.minDscr || 1.1) - 1e-9,
  };
  return { input, terms, prof, sizes, costs, fin, bess, ops, year1, atBid, needed, finance, checks, verdict, penaltyY1, pricesPending: Boolean(terms.peak?.pricesPending || (terms.purchase?.enabled && !buyBase)),
    live: liveRequest(input, terms, sizes, costs, fin, bess, ops, atBid, prof) };
}

/** The live-model request for the traceable model and the Excel workbook, at the bid tariff. */
function liveRequest(input, terms, sizes, costs, fin, bess, ops, finance, prof) {
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  return {
    title: `What-if · ${input.contractedMw} MW ${isFdrex(input) ? "SECI-FDRE-X" : "SECI FDRE-RTC-V"} at ₹${fin.tariff.toFixed(3)}/kWh`,
    engine: "simulation",
    sourceAll: "What-if tab",
    tariff: fin.tariff,
    tariffLocked: true,
    dfrTarget: 0,
    split: false,
    market: null,
    on: { solar: sizes.solarMw > 0, wind: sizes.windMw > 0, hydro: false, biomass: false, thermal: false, bess: sizes.bessMw > 0 },
    sizes,
    costs: { ...costs, plants: [] },
    ...(terms.workbookLabels ? { labels: terms.workbookLabels, otherCapexLabel: terms.workbookLabels.otherCapex } : {}),
    fin: pick(fin, ["tariffEscalation", "solarOmLakhPerMw", "windOmLakhPerMw", "bessOmLakhPerMwh", "omEscalation", "insurancePct", "otherFixedCr", "surplusPrice", "shortfallPenalty", "blockPenaltyMultiple", "debtFraction", "interestRate", "tenorYears", "targetEquityIrr", "discountRate", "taxRate", "wdvRate", "bookLifeYears", "salvagePct", "receivableDays", "sellSurplus", "repayment", "taxDepreciation"]),
    bess: pick(bess, ["annualDegradation", "augmentation", "augmentationYear", "costDeclinePct"]),
    ops: ops.map((o) => pick(o, ["demandMWh", "deliveredMWh", "excessMWh", "buyerExcessMWh", "buyerExcessShare", "blockShortfallMWh", "injectedMWh", "trafoLossMWh", "lineLossMWh", "meterMWh", "dsmA", "dsmB", "chargingCostCr", "pxFeesCr", "surplusRevenueCr"])).map((o) => ({ ...o, genBusMWh: o.injectedMWh })),
    // the generation build-up: the profiles the dispatch ran, at the CUFs entered (at the 33 kV bus)
    gen: {
      solar: sizes.solarMw > 0 ? genSource({ cf: prof.solarCf, degradation: fin.solarDegradation, cufAt: "33 kV bus", profile: input.solarUpload?.name ? `Uploaded solar profile ${input.solarUpload.name}` : "Typical solar profile" }) : null,
      wind: sizes.windMw > 0 ? genSource({ cf: prof.windCf, degradation: fin.windDegradation, cufAt: "33 kV bus", profile: input.windUpload?.name ? `Uploaded wind profile ${input.windUpload.name}` : "Typical wind profile" }) : null,
    },
    app: { tariff: finance.tariff, equityIrr: finance.equityIrr, projectIrr: finance.projectIrr, minDscr: finance.minDscr },
  };
}

/** Sizes the tender allows: the SECI pack's bid range and its tendered capacity. */
export const SECI_LIMITS = { minBidMw: PACK.model.minBidMw, maxBidMw: PACK.model.maxBidMw, tenderedMw: PACK.tenderedMw };

/**
 * A What-if case seeded from a sized bid (the SECI tab): the sized plant, the bidder's CUFs,
 * losses, costs, financing, DSM norms and the tariff the model solved, so the levers start from
 * the bid itself. lf: the losses to the meter (lossFactorsOf) and the pooling stations.
 */
export function whatIfFromBid(state, terms) {
  const lp = state.lp;
  if (!lp?.sizes) return null;
  const d = defaultWhatIf();
  const src = state.src;
  const sz = lp.sizes;
  const l = state.losses || {};
  const flat = state.market?.sell && state.market.source === "flat" ? state.market.flatPrice : null;
  return {
    ...d,
    peakPlan: state.seci?.peakPlan || d.peakPlan,
    shortfall: state.seci?.shortfall || d.shortfall,
    profile: state.seci?.profile || d.profile,
    solarHours: state.seci?.solarHours || null,
    contractedMw: state.bid?.baseMw || d.contractedMw,
    solarMwac: sz.solarMw || 0,
    dcAc: src.solar?.dcAc || d.dcAc,
    windMw: sz.windMw || 0,
    bessMw: sz.bessMw || 0,
    bessHours: sz.bessMw > 0 ? (sz.bessMwh || 0) / sz.bessMw : Number(src.bess?.duration) || d.bessHours,
    solarCuf: src.solar?.cuf ?? d.solarCuf,
    windCuf: src.wind?.cuf ?? d.windCuf,
    solarUpload: state.solarUpload || null,
    windUpload: state.windUpload || null,
    trafoLossPct: l.trafoLossPct ?? d.trafoLossPct,
    lineLossPct: l.lineLossPct ?? d.lineLossPct,
    bess: { ...d.bess, rte: src.bess?.rte ?? d.bess.rte, minSoc: src.bess?.minSoc ?? d.bess.minSoc, maxSoc: src.bess?.maxSoc ?? d.bess.maxSoc, annualDegradation: src.bess?.degradation ?? d.bess.annualDegradation, augmentation: src.bess?.augmentation || d.bess.augmentation },
    costs: { ...d.costs, solarCrPerMwac: src.solar?.capex ?? d.costs.solarCrPerMwac, windCrPerMw: src.wind?.capex ?? d.costs.windCrPerMw, bessCrPerMwh: src.bess?.capex ?? d.costs.bessCrPerMwh, bessPcsCrPerMw: 0,
      evacuationCr: state.costs?.evacuationCr ?? d.costs.evacuationCr, preopPct: state.costs?.preopPct ?? d.costs.preopPct,
      constructionMonths: state.costs?.constructionMonths || 0, drawdown: state.costs?.drawdown || "linear", drawOrder: state.costs?.drawOrder || "proRata" },
    dsm: { ...DSM_DEFAULTS, ...(state.dsm || {}) },
    om: { solarLakhPerMwac: src.solar?.om ?? d.om.solarLakhPerMwac, windLakhPerMw: src.wind?.om ?? d.om.windLakhPerMw, bessLakhPerMwh: src.bess?.om ?? d.om.bessLakhPerMwh },
    fin: {
      ...d.fin,
      ...Object.fromEntries(Object.entries(state.fin || {}).filter(([k, v]) => k !== "tariff" && k !== "years" && v !== null && v !== undefined)),
      tariff: Number((state.forms?.tariff ?? lp.tariff ?? d.fin.tariff).toFixed(3)),
      sellSurplus: Boolean(state.market?.sell),
      surplusPrice: flat ?? d.fin.surplusPrice,
    },
    fromBid: { sizes: sz, tariff: lp.tariff, years: terms?.years || 25 },
    // the FDRE-X Bid tab: its tender and settings (the buyer's 4 hours, the shortfall plan, bought power, the sale, the PSM)
    ...(state.fdrex ? { tender: "fdrex", fdrex: { ...state.fdrex }, buyEscalation: state.market?.escalation || 0, saleMarket: state.market?.sell && state.market.source !== "flat" ? state.market.source : null } : {}),
  };
}
