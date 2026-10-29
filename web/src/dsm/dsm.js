// Deviation settlement (CERC DSM Regulations, 2024, as amended): what the plant pays for the
// difference between its day-ahead schedule and what it injects, block by block. The sizing and
// the financial model dispatch the plant with perfect foresight, so the deviation comes from a
// forecast-error assumption: the error in a 15-minute block, as a share of the schedule, is taken
// as normally distributed with the chosen standard deviation (a battery firms the schedule and
// cuts it). Every MWh scheduled then carries the same expected charge, so the year's charge is the
// scheduled energy times that unit charge, and it moves year by year with the X factor (the share
// of the in-band deviation still settled at the contract rate, which CERC winds down from April
// 2026) and the tighter bands from then on.
//
// The norms are inputs (DSM_DEFAULTS): the regulations' structure is coded here, the numbers can
// be set to the notified text and the orders of the day. Charges are relative to the financial
// model's baseline, in which every MWh injected earns the contract tariff: an under-injection in a
// band charged at 150% of the contract rate costs the seller the extra 50%; an over-injection paid
// at 50% loses it half the tariff on that energy; in-band deviation settled at the normal rate
// (the market reference) costs or earns the difference between the normal and the contract rate.

/** The X factor by financial year (April to March): the in-band share settled at the contract rate. */
export const X_TRAJECTORY = { 2027: 1, 2028: 0.95, 2029: 0.85, 2030: 0.65, 2031: 0.35 }; // 0 from FY2031-32

/** The tolerance bands by seller category, before and from 1 April 2026 (FY2026-27). */
export const TOLERANCE = {
  before2026: { solar: 0.10, wind: 0.15, hybrid: 0.10 },
  from2026: { solar: 0.05, wind: 0.10, hybrid: 0.05 },
};

export const DSM_CATEGORIES = { solar: "Solar", wind: "Wind", hybrid: "Wind-solar hybrid (with or without storage)" };

/** The forecast error's standard deviation by category, as a share of the schedule in a block. */
export const SIGMA_DEFAULT = { solar: 0.08, wind: 0.12, hybrid: 0.09 };

export const DSM_DEFAULTS = {
  on: true,
  category: "auto", // "auto": by the sources switched on; else solar | wind | hybrid
  sigmaPct: null, // null: SIGMA_DEFAULT by category
  storageFirming: 0.3, // share of the forecast error a battery takes out (when the plant has one)
  // ₹/kWh: the normal rate of charges for deviation (the market reference: DAM / RTM) in the blocks
  // the plant is short (the market tends to be dear then) and in the blocks it is long (cheap)
  normalUnder: 6.0,
  normalOver: 2.5,
  codFy: 2028, // the financial year operations start (FY2027-28: 2028), for the X factor and the bands
  // beyond the tolerance band, in steps of the schedule: the charge for under-injection as a
  // multiple of the contract rate, and the rate paid for over-injection as a share of it
  steps: [
    { width: 0.05, under: 1.1, over: 0.9 },
    { width: 0.10, under: 1.5, over: 0.5 },
    { width: Infinity, under: 2.0, over: 0 },
  ],
};

/** The category the plant falls in: wind, solar or hybrid. */
export function dsmCategory(dsm, sources) {
  if (dsm?.category && dsm.category !== "auto") return dsm.category;
  const solar = Boolean(sources?.solar);
  const wind = Boolean(sources?.wind);
  return solar && wind ? "hybrid" : wind ? "wind" : "solar";
}

/** The X factor in a model year (1 = the COD year). */
export function xFactor(year, codFy) {
  const fy = (codFy || DSM_DEFAULTS.codFy) + year - 1;
  if (fy <= 2026) return 1;
  return X_TRAJECTORY[fy] ?? (fy > 2031 ? 0 : 1);
}

/** The tolerance band in a model year. */
export function toleranceOf(category, year, codFy) {
  const fy = (codFy || DSM_DEFAULTS.codFy) + year - 1;
  return (fy >= 2027 ? TOLERANCE.from2026 : TOLERANCE.before2026)[category] ?? TOLERANCE.before2026.hybrid;
}

/** The forecast error's standard deviation used: by category, cut by the battery's firming. */
export function sigmaOf(dsm, category, hasStorage) {
  const base = dsm?.sigmaPct != null ? dsm.sigmaPct : SIGMA_DEFAULT[category] ?? SIGMA_DEFAULT.hybrid;
  return hasStorage ? base * (1 - (dsm?.storageFirming || 0)) : base;
}

// the error distribution: a normal in 61 buckets between −3σ and +3σ (the tails beyond carry
// a tenth of a percent each, folded into the last buckets)
const BUCKETS = 61;
function errorBuckets(sigma) {
  if (!(sigma > 0)) return [{ e: 0, p: 1 }];
  const out = [];
  const step = 6 / (BUCKETS - 1);
  const pdf = (z) => Math.exp(-0.5 * z * z);
  let total = 0;
  for (let i = 0; i < BUCKETS; i += 1) {
    const z = -3 + i * step;
    const p = pdf(z);
    out.push({ e: z * sigma, p });
    total += p;
  }
  for (const b of out) b.p /= total;
  return out;
}

/**
 * The charge for one block with a deviation of e × schedule, per MWh scheduled, relative to the
 * contract-rate baseline, as a line in the contract rate: charge = a × contract + b, with
 * contract and the normal rates in ₹/kWh and the charge in ₹ per MWh scheduled. Linear in the
 * contract rate, so the financial model can apply it to the tariff it solves for.
 */
export function chargePerMwh(e, { tolerance, x, steps, normalUnder, normalOver }) {
  const abs = Math.abs(e);
  if (abs < 1e-12) return { a: 0, b: 0 };
  const under = e < 0;
  let a = 0;
  let b = 0;
  // within the tolerance band: X at the contract rate (no cost against the baseline), the rest at
  // the normal rate of the blocks the plant is short in (dear) or long in (cheap)
  const inBand = Math.min(abs, tolerance);
  if (under) { a -= inBand * (1 - x); b += inBand * (1 - x) * normalUnder; } else { a += inBand * (1 - x); b -= inBand * (1 - x) * normalOver; }
  let left = abs - inBand;
  for (const s of steps) {
    if (left <= 1e-12) break;
    const d = Math.min(left, s.width);
    a += under ? d * (s.under - 1) : d * (1 - s.over);
    left -= d;
  }
  return { a: a * 1000, b: b * 1000 }; // ₹/kWh × (share of a MWh) → ₹ per MWh scheduled
}

/**
 * The expected charge per MWh scheduled in a model year as a line in the contract rate
 * (perMwh = a × contract + b, ₹/MWh with the rates in ₹/kWh), and the pieces behind it.
 */
export function dsmUnitCharge({ dsm, category, hasStorage, year, contract = null }) {
  const d = { ...DSM_DEFAULTS, ...dsm };
  const sigma = sigmaOf(d, category, hasStorage);
  const tolerance = toleranceOf(category, year, d.codFy);
  const x = xFactor(year, d.codFy);
  const steps = d.steps?.length ? d.steps : DSM_DEFAULTS.steps;
  let a = 0;
  let b = 0;
  let outOfBand = 0;
  for (const k of errorBuckets(sigma)) {
    const c = chargePerMwh(k.e, { tolerance, x, steps, normalUnder: d.normalUnder, normalOver: d.normalOver });
    a += k.p * c.a;
    b += k.p * c.b;
    if (Math.abs(k.e) > tolerance) outOfBand += k.p;
  }
  if (d.on === false) { a = 0; b = 0; }
  return { a, b, perMwh: contract === null ? null : a * contract + b, sigma, tolerance, x, outOfBand, fy: (d.codFy || DSM_DEFAULTS.codFy) + year - 1 };
}

/**
 * The year's DSM charge in ₹ crore for the energy scheduled (MWh) at the contract tariff (₹/kWh).
 * 0 when DSM is switched off.
 */
export function dsmChargeCr({ dsm, category, hasStorage, year, contract, scheduledMwh }) {
  const u = dsmUnitCharge({ dsm, category, hasStorage, year, contract });
  return (scheduledMwh * u.perMwh) / 1e7;
}

/** The unit-charge lines (a, b) of every model year, for the yearly operations of a bid. */
export function dsmLines({ dsm, sources, years }) {
  const category = dsmCategory(dsm, sources);
  const hasStorage = Boolean(sources?.bess);
  return Array.from({ length: years }, (_, i) => {
    const u = dsmUnitCharge({ dsm, category, hasStorage, year: i + 1 });
    return { dsmA: u.a, dsmB: u.b };
  });
}

/**
 * The DSM charges of every year for a lifetime of yearly energy (deliveredMwh + exportMwh +
 * buyerExcessMwh scheduled), at the tariff escalating as the model's. Returns ₹ crore by year.
 */
export function dsmByYear({ dsm, sources, years, tariff, tariffEscalation = 0, scheduled }) {
  const category = dsmCategory(dsm, sources);
  const hasStorage = Boolean(sources?.bess);
  return Array.from({ length: years }, (_, i) => {
    const y = i + 1;
    const contract = tariff * (1 + tariffEscalation) ** i;
    return dsmChargeCr({ dsm, category, hasStorage, year: y, contract, scheduledMwh: scheduled(y) || 0 });
  });
}

/** One line on the norms applied, for the screen and the documents. */
export function dsmNote(dsm, category, year = 1) {
  const d = { ...DSM_DEFAULTS, ...dsm };
  const tol = toleranceOf(category, year, d.codFy);
  const x = xFactor(year, d.codFy);
  return `${DSM_CATEGORIES[category] || category}: tolerance ±${(tol * 100).toFixed(0)}% of the schedule in FY${d.codFy + year - 1}, X = ${(x * 100).toFixed(0)}% settled at the contract rate within it; beyond it under-injection at ${d.steps.map((s) => `${(s.under * 100).toFixed(0)}%`).join(" / ")} and over-injection paid at ${d.steps.map((s) => `${(s.over * 100).toFixed(0)}%`).join(" / ")} of the contract rate in the steps`;
}
