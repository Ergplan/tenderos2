// Round-the-clock (RTC) hybrid supply engine.
//
// Pure ES module with no DOM access, so it runs in the browser, in a Web Worker
// (optimizer) and in Node (tools/check_rtc_engine.mjs). Units:
//   power MW, energy MWh, money Rs crore (cr), tariffs Rs/kWh.
//   1 MWh x 1 Rs/kWh = Rs 1,000 = 1e-4 cr.

export const HOURS = 8760;
/** Capacity factors may exceed 1 when a plant's output exceeds its stated AC capacity (PVsyst). */
export const MAX_CF = 1.3;
/** Wind plants below this plant load factor are kept out of the profile library. */
export const MIN_WIND_PLF = 0.25;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const RS_CR_PER_MWH_AT_1RS = 1e-4;

export const MONTH_OF_HOUR = new Uint8Array(HOURS);
export const HOUR_OF_DAY = new Uint8Array(HOURS);
(() => {
  let t = 0;
  MONTH_DAYS.forEach((days, m) => {
    for (let d = 0; d < days; d += 1) {
      for (let h = 0; h < 24; h += 1) {
        MONTH_OF_HOUR[t] = m;
        HOUR_OF_DAY[t] = h;
        t += 1;
      }
    }
  });
})();

export const BEED_SITE = { name: "Beed, Maharashtra", lat: 18.99, lon: 75.76 };

export const DEFAULT_RTC_INPUTS = {
  site: BEED_SITE,
  annualEnergyMu: 2455, // million kWh = GWh
  plantCapacityMw: 285,
  dfrTarget: 0.85,
  dfrBasis: "annual", // 'annual' | 'monthly' (every month must meet the target)
  designCheck: "lifetime", // 'year1' | 'lifetime' (also meet the target in the most degraded year)
  demandGrowth: 0,
  lossPct: 0, // other losses before the 33 kV main bus (auxiliary); the hourly profiles are at that bus
  // evacuation from the 33 kV main bus bar to the point of interconnection (POI) at the 220 kV
  // GSS, where the billing meter is: delivered energy, the DFR and sales are counted there
  trafoLossPct: 0.004, // 33/220 kV power transformer
  lineLossPct: 0.005, // 220 kV transmission line to the GSS
  // each technology's losses before the 33 kV bus, and where its hourly profile is measured: the
  // stages before that point are already in the profile; the stages after it are applied (the
  // values are typical, and used only when the profile is measured before the stage)
  solarLoss: { dc: 0.02, inverter: 0.015, idt: 0.01, cable: 0.005 },
  solarFileAt: 4, // after all four stages: the 33 kV main bus bar
  windLoss: { wtgTrafo: 0.01, cable: 0.005 },
  windFileAt: 2, // the 33 kV main bus bar
  bessLoss: { pcs: 0.015, mvTrafo: 0.008, cable: 0.003 }, // each way
  bessRteAt: 3, // the round-trip efficiency is quoted at the 33 kV bus
  solarCuf: 0.245,
  windCuf: 0.33,
  solarDcAc: 1.4,
};

export const DEFAULT_BESS = {
  rte: 0.87,
  minSoc: 0.05,
  maxSoc: 0.95,
  initSoc: 0.5,
  annualDegradation: 0.02,
  augmentation: "annual", // 'annual' | 'none' | 'oneTime'
  augmentationYear: 12,
  augmentationYears: [6, 12, 18], // 'schedule': the years the capacity lost since the last augmentation is replaced
  costDeclinePct: 0.03,
  durationH: 4, // discharge duration chosen by the user: 2 or 4 hours (MWh = MW x hours); null = free
  minDurationH: 1,
  maxDurationH: 8,
};

export const DEFAULT_COSTS = {
  solarCrPerMw: 3.5,
  windCrPerMw: 6.5,
  bessCrPerMwh: 1.2,
  bessPcsCrPerMw: 0,
  evacuationCr: 0,
  preopPct: 0.05,
  // finance v3 (docs/dev/FINANCE-V3-SPEC.md): when each part of the hard cost is spent inside the
  // construction window, { solar: { start, months }, wind, bess, evac, other }; null: every part
  // over the whole window
  phasing: null,
  moduleSharePct: 0.45, // the modules' share of the solar capex (the reverse-auction sensitivity)
};

export const DEFAULT_FINANCE = {
  years: 25,
  tariff: 4.5,
  tariffEscalation: 0,
  targetEquityIrr: 0.14,
  debtFraction: 0.7,
  interestRate: 0.09,
  tenorYears: 15, // door to door, grace years included
  repayment: "equal", // 'equal' | 'annuity' | 'sculpted' | 'balloon' | 'bullet' | 'stepUp' (REPAYMENT_METHODS)
  graceYears: 0, // principal moratorium after COD; interest is paid
  paymentsPerYear: 1, // 1 yearly, 2 half-yearly, 4 quarterly, 12 monthly instalments
  targetDscr: 1.3, // sculpted: the principal each year is what keeps the DSCR at this
  balloonPct: 0.3, // balloon: this share of the debt is repaid in the last year, the rest in equal parts
  stepUpPct: 0.05, // stepUp: the principal grows at this rate a year
  refiYear: 0, // refinance the balance at the end of this year (0: never)
  refiRate: 0.085,
  refiTenorYears: 12, // from the refinancing year
  refiFeePct: 0.005, // of the balance refinanced, expensed that year
  omStockMonths: 0, // working capital: O&M in hand (CERC norm: 1 month)
  sparesPctOm: 0, // working capital: maintenance spares as a share of the year's O&M (CERC norm: 15%)
  wcInterestRate: 0, // interest on the working capital, expensed (0: working capital is equity funded)
  dsraMonths: 0, // debt service reserve: months of the next year's debt service, held from equity cash
  taxRate: 0.2517,
  taxDepreciation: "wdv", // 'wdv' | 'slm'
  wdvRate: 0.4,
  bookLifeYears: 25,
  salvagePct: 0.1,
  solarOmLakhPerMw: 4.0,
  windOmLakhPerMw: 9.0,
  bessOmLakhPerMwh: 1.2,
  omEscalation: 0.05,
  insurancePct: 0.003,
  otherFixedCr: 0,
  receivableDays: 45,
  sellSurplus: false,
  surplusPrice: 2.5,
  extraExportMw: 0, // export capacity for surplus on top of the plant capacity (only used when selling)
  shortfallPenalty: 0,
  solarDegradation: 0.005,
  windDegradation: 0,
  discountRate: 0.1,
  // ---- finance v3 (docs/dev/FINANCE-V3-SPEC.md); every input off by default
  codDate: null, // ISO date of the COD; year y runs from cod + (y − 1) years
  parts: [], // part commissioning: [{ share, offsetMonths }] (negative: early); [] = one part on the COD
  bridge: { months: 0, rate: null, feePct: 0 }, // bridge loan over the first months of construction
  generationCase: "p50", // 'p50' | 'p75' | 'p90'
  caseFactors: { p75: 0.97, p90: 0.94 },
  carbon: { enabled: false, tPerMwh: 0.71, pricePerT: 500, years: 10, escalation: 0.03 }, // ₹ per tonne
  extension: { years: 0, capexCr: 0, tariffRsPerKwh: null, omFactor: 1, degradation: null }, // life beyond the PPA
  repower: { year: 0, capexCr: 0, upliftPct: 0 }, // solar repowering
  solarOmEscalation: null, // null: omEscalation
  windOmEscalation: null,
  bessOmEscalation: null,
  windOmComponents: [], // [{ label, lakhPerMw, escalation }]; [] = windOmLakhPerMw
  otherFixedLines: [], // [{ label, crPerYear, escalation }]; [] = otherFixedCr
  refiRepayment: null, // the method after the refinancing; null: the same
  rateStepDown: { afterYears: 0, rate: null }, // the senior rate from year afterYears + 1
  topUp: { year: 0, debtFraction: null }, // new senior debt at the end of the year up to the fraction, paid to equity
  prepaymentPct: 0, // fee on principal prepaid outside the schedule (refinancing takeout, cash sweep)
  sweep: { pct: 0, fromYear: 1, toYear: null }, // share of the free cash prepaying the debt; unpaid sweep accrues
  dsraBasis: "next", // 'next' (months of the next year's debt service) | 'peak' (of the highest year left)
  dsraInterestRate: 0, // interest earned on the reserve, other income
  quasi: { amountCr: 0, rate: 0.12, lenderMinDscr: 1.2, repayFromYear: 1 }, // quasi-equity from the holdco
  mezz: { amountCr: 0, rate: 0.14, tenorYears: 10, graceYears: 0, repayment: "equal", feePct: 0 }, // mezzanine
  guarantees: [], // [{ label, amountCr, feePct, marginPct, marginRate, fromYear, years }]
  bookDepreciation: "slm", // 'slm' | 'wdv' (the books; taxDepreciation is the tax)
  bookWdvRate: null, // null: wdvRate
  lives: null, // book lives by component { solar, wind, bess, evac, other }; null: bookLifeYears
  thinCapPct: 0, // 0: off; 0.3 caps the deductible quasi-equity and mezzanine interest at 30% of EBITDA
  lossCarryYears: null, // business losses carried this many years; null: no limit (unabsorbed depreciation never lapses)
  holdco: { expensesCrPerYear: 0, promoterShare: 1 },
  lenderReinvestRate: null, // the lender's MIRR; null: the senior rate
  capexUsdShare: 0, // share of the capex paid in dollars (the exchange-rate sensitivity)
  fxBase: 83, // ₹ per dollar in the bid
};

/** The finance v3 inputs (docs/dev/FINANCE-V3-SPEC.md), for whitelists and the inputs sheet. */
export const FINANCE_V3_KEYS = {
  fin: ["codDate", "parts", "bridge", "generationCase", "caseFactors", "carbon", "extension", "repower",
    "solarOmEscalation", "windOmEscalation", "bessOmEscalation", "windOmComponents", "otherFixedLines",
    "refiRepayment", "rateStepDown", "topUp", "prepaymentPct", "sweep", "dsraBasis", "dsraInterestRate",
    "quasi", "mezz", "guarantees", "bookDepreciation", "bookWdvRate", "lives", "thinCapPct", "lossCarryYears",
    "holdco", "lenderReinvestRate", "capexUsdShare", "fxBase"],
  costs: ["phasing", "moduleSharePct"],
  bess: ["augmentationYears"],
};

// ---------------------------------------------------------------- helpers

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i += 1) s += arr[i];
  return arr.length ? s / arr.length : 0;
}

function scaleToCuf(raw, target, clip = 1) {
  const out = new Float64Array(raw.length);
  const cufFor = (k) => {
    let s = 0;
    for (let i = 0; i < raw.length; i += 1) s += Math.min(clip, raw[i] * k);
    return s / raw.length;
  };
  let lo = 0;
  let hi = 1;
  while (cufFor(hi) < target && hi < 1e6) hi *= 2;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (cufFor(mid) < target) lo = mid;
    else hi = mid;
  }
  for (let i = 0; i < raw.length; i += 1) out[i] = Math.min(clip, raw[i] * hi);
  return out;
}

export function monthlyMeans(series) {
  const sum = new Array(12).fill(0);
  const cnt = new Array(12).fill(0);
  for (let t = 0; t < HOURS; t += 1) {
    sum[MONTH_OF_HOUR[t]] += series[t];
    cnt[MONTH_OF_HOUR[t]] += 1;
  }
  return sum.map((s, m) => (cnt[m] ? s / cnt[m] : 0));
}

/** Average 24-hour shape for each month: rows[month][hour]. */
export function monthHourMatrix(series) {
  const sum = Array.from({ length: 12 }, () => new Array(24).fill(0));
  for (let t = 0; t < HOURS; t += 1) sum[MONTH_OF_HOUR[t]][HOUR_OF_DAY[t]] += series[t];
  return sum.map((row, m) => row.map((v) => v / MONTH_DAYS[m]));
}

// ---------------------------------------------------------------- resource profiles

const SOLAR_CLEARNESS = [0.95, 0.96, 0.95, 0.93, 0.9, 0.72, 0.58, 0.6, 0.7, 0.88, 0.93, 0.94];
const SOLAR_VARIABILITY = [0.05, 0.05, 0.06, 0.07, 0.1, 0.3, 0.38, 0.36, 0.3, 0.14, 0.06, 0.05];

/**
 * Synthetic hourly AC capacity factor for a fixed-tilt plant (per MWac), calibrated to
 * the annual AC CUF. Uses clear-sky geometry for the site plus a monsoon clearness pattern
 * typical of Marathwada (Beed). Replace with a PVsyst/SolarGIS 8760 via upload for bids.
 */
export function synthSolarCf({ lat = BEED_SITE.lat, lon = BEED_SITE.lon, targetCuf = 0.245, dcAc = 1.4, seed = 11 } = {}) {
  const rand = mulberry32(seed);
  const phi = (lat * Math.PI) / 180;
  const raw = new Float64Array(HOURS);
  let t = 0;
  for (let n = 1; n <= 365; n += 1) {
    const m = MONTH_OF_HOUR[t];
    const decl = ((23.45 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + n)) / 365);
    const b = (2 * Math.PI * (n - 81)) / 364;
    const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
    const dayCloud = Math.max(0.12, Math.min(1.05, SOLAR_CLEARNESS[m] * (1 + SOLAR_VARIABILITY[m] * (rand() * 2 - 1) * 1.6)));
    for (let h = 0; h < 24; h += 1) {
      const solarTime = h + 0.5 + (lon - 82.5) / 15 + eot / 60;
      const omega = ((solarTime - 12) * 15 * Math.PI) / 180;
      const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(omega);
      if (cosZ > 0.01) {
        const ghi = 1098 * cosZ * Math.exp(-0.057 / cosZ);
        // tilt = latitude, south facing: incidence depends on declination and hour angle
        const cosInc = Math.max(0, Math.cos(decl) * Math.cos(omega));
        const poa = ghi * (0.78 * (cosInc / Math.max(cosZ, 0.12)) * 0.93 + 0.22);
        const jitter = 1 + SOLAR_VARIABILITY[m] * 0.35 * (rand() * 2 - 1);
        raw[t] = Math.max(0, (poa / 1000) * dayCloud * jitter * dcAc * 0.82);
      }
      t += 1;
    }
  }
  return scaleToCuf(raw, targetCuf, 1);
}

// Beed / Marathwada wind: strong south-west monsoon (May-Aug), weak post-monsoon.
const WIND_MONTH_SPEED = [5.6, 5.7, 5.9, 6.3, 7.4, 9.0, 9.6, 9.0, 7.2, 5.2, 5.3, 5.6];
const WIND_DIURNAL = [1.06, 1.04, 1.02, 1.0, 0.97, 0.94, 0.9, 0.86, 0.83, 0.82, 0.84, 0.88, 0.93, 0.99, 1.05, 1.1, 1.14, 1.16, 1.16, 1.15, 1.13, 1.11, 1.09, 1.07];

function turbinePower(v) {
  if (v < 3 || v >= 25) return 0;
  if (v >= 11.5) return 1;
  return (v ** 3 - 27) / (11.5 ** 3 - 27);
}

/** Synthetic hourly wind capacity factor (per MW) calibrated to the annual CUF. */
export function synthWindCf({ targetCuf = 0.33, seed = 23 } = {}) {
  const rand = mulberry32(seed);
  const speed = new Float64Array(HOURS);
  const sigma = 0.24;
  const rho = 0.94;
  let x = 0;
  for (let t = 0; t < HOURS; t += 1) {
    x = rho * x + Math.sqrt(1 - rho * rho) * gaussian(rand) * sigma;
    speed[t] = WIND_MONTH_SPEED[MONTH_OF_HOUR[t]] * WIND_DIURNAL[HOUR_OF_DAY[t]] * Math.exp(x - (sigma * sigma) / 2);
  }
  const cufFor = (k) => {
    let s = 0;
    for (let t = 0; t < HOURS; t += 1) s += turbinePower(speed[t] * k);
    return (s / HOURS) * 0.94;
  };
  let lo = 0.2;
  let hi = 3;
  for (let i = 0; i < 50; i += 1) {
    const mid = (lo + hi) / 2;
    if (cufFor(mid) < targetCuf) lo = mid;
    else hi = mid;
  }
  const out = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t += 1) out[t] = turbinePower(speed[t] * hi) * 0.94;
  // exact calibration for capped profiles
  return scaleToCuf(out, targetCuf, 1);
}

/** Apply 12 monthly multipliers (user-drawn) to a capacity-factor profile, clipped to 1. */
export function applyMonthlyScale(cf, monthScale) {
  if (!monthScale || monthScale.every((v) => Math.abs(v - 1) < 1e-9)) return cf;
  const out = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t += 1) out[t] = Math.min(MAX_CF, cf[t] * monthScale[MONTH_OF_HOUR[t]]);
  return out;
}

// ---------------------------------------------------------------- demand

export const FLAT_HOUR_SHAPE = new Array(24).fill(1);
export const FLAT_MONTH_SHAPE = new Array(12).fill(1);

/**
 * Hourly demand (MW) for the year: either a custom 8760 shape or a 12x24 month-hour
 * shape, normalised so the year sums to annualEnergyMu (GWh).
 */
export function buildDemand({ annualEnergyMu, hourShape = FLAT_HOUR_SHAPE, monthShape = FLAT_MONTH_SHAPE, custom = null }) {
  const w = new Float64Array(HOURS);
  let sum = 0;
  for (let t = 0; t < HOURS; t += 1) {
    const v = custom ? Math.max(0, Number(custom[t]) || 0) : Math.max(0, hourShape[HOUR_OF_DAY[t]]) * Math.max(0, monthShape[MONTH_OF_HOUR[t]]);
    w[t] = v;
    sum += v;
  }
  const total = annualEnergyMu * 1000;
  for (let t = 0; t < HOURS; t += 1) w[t] = sum > 0 ? (w[t] / sum) * total : total / HOURS;
  return w;
}

// ---------------------------------------------------------------- uploads

/**
 * Parse an uploaded profile. Accepts one value per line or CSV with the value in the last
 * numeric column; 8760 / 8784 hourly or 35040 / 35136 quarter-hourly rows. Values above
 * 1.5 are treated as MW of a plant and normalised by `referenceMw` (or the maximum).
 */
export function parseProfileCsv(text, { kind = "cf", referenceMw = null } = {}) {
  const values = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    for (let i = cells.length - 1; i >= 0; i -= 1) {
      if (cells[i] !== "" && Number.isFinite(Number(cells[i]))) {
        values.push(Number(cells[i]));
        break;
      }
    }
  }
  let hourly = values;
  if (values.length === 35040 || values.length === 35136) {
    hourly = [];
    for (let i = 0; i + 3 < values.length; i += 4) hourly.push((values[i] + values[i + 1] + values[i + 2] + values[i + 3]) / 4);
  }
  if (hourly.length === 8784) hourly = [...hourly.slice(0, 59 * 24), ...hourly.slice(60 * 24)]; // drop 29 Feb
  if (hourly.length !== HOURS) {
    throw new Error(`Expected 8760 hourly (or 35040 15-minute) values, found ${values.length}.`);
  }
  const out = Float64Array.from(hourly, (v) => Math.max(0, v));
  if (kind === "demand") return { values: out, note: `${HOURS} hourly demand values (shape; scaled to the annual energy)` };
  const max = Math.max(...out);
  if (max > 1.5) {
    const ref = Number(referenceMw) > 0 ? Number(referenceMw) : max;
    for (let t = 0; t < HOURS; t += 1) out[t] = Math.min(MAX_CF, out[t] / ref);
    return { values: out, note: `MW values normalised by ${ref.toFixed(1)} MW → CUF ${(mean(out) * 100).toFixed(1)}%` };
  }
  for (let t = 0; t < HOURS; t += 1) out[t] = Math.min(MAX_CF, out[t]);
  return { values: out, note: `capacity factors, CUF ${(mean(out) * 100).toFixed(1)}%` };
}

// ---------------------------------------------------------------- dated time series (SCADA / meter exports)

const DAY_OFFSET = (() => {
  const out = [];
  let acc = 0;
  for (const d of MONTH_DAYS) { out.push(acc); acc += d; }
  return out;
})();

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === ";" || c === "\t") { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** "2025-09-29", "29-09-2025", "29/09/2025", "2025-09-29 00:15" → { m (0-11), d (1-31), hh, mm } */
function parseDateTime(dateStr, timeStr) {
  const s = String(dateStr || "").trim();
  let y; let m; let d; let rest = "";
  let hit = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(.*)$/);
  if (hit) { [, y, m, d, rest] = hit; } else {
    hit = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(.*)$/);
    if (!hit) return null;
    [, d, m, y, rest] = hit;
  }
  const t = String(timeStr || rest || "").match(/(\d{1,2}):(\d{2})/);
  return { y: Number(y), m: Number(m) - 1, d: Number(d), hh: t ? Number(t[1]) : 0, mm: t ? Number(t[2]) : 0 };
}

/**
 * Turn a dated generation export (e.g. SLDC/RLDC SCADA blockwise CSV: Date, Clock Time,
 * Actual Generation (MW), CUF (%)) into an 8760 hourly capacity-factor profile with a quality
 * report. Handles 15-minute or hourly data covering part of a year:
 *   - capacity from `referenceMw`, else implied by the CUF column, else the 99.5th percentile;
 *   - negative readings (auxiliary consumption) → 0; readings above 110% of capacity → invalid;
 *   - hours without data are filled with the same month × hour-of-day average (or the
 *     annual hour-of-day average when a whole month is missing).
 * Returns null when the file has no recognisable date column (caller falls back to 8760 lists).
 */
export function parseDatedProfile(text, { referenceMw = null } = {}) {
  let lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 48) return null;
  // PVsyst / EYA exports start with metadata lines (site, "AC,300,MW", "DC,450,MWp") before the header
  let headerAt = lines.slice(0, 40).findIndex((l) => /(^|,|")\s*(date|timestamp|datetime)\b/i.test(l));
  if (headerAt < 0) headerAt = 0;
  const metaLines = lines.slice(0, headerAt).map(splitCsvLine);
  let metaAc = null;
  let metaDc = null;
  for (const c of metaLines) {
    const k = String(c[0] || "").trim().toLowerCase();
    const v = Number(c[1]);
    if (k === "ac" && v > 0) metaAc = v;
    if (k === "dc" && v > 0) metaDc = v;
  }
  const metaTitle = metaLines.map((c) => c.find((x) => x && x.trim()) || "").filter((t) => t && !/^(ac|dc)$/i.test(t.trim())).join(" · ");
  lines = lines.slice(headerAt);
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const find = (re, not) => header.findIndex((h, i) => re.test(h) && i !== not);
  const dateCol = find(/date|day|timestamp|datetime/);
  if (dateCol < 0) return null;
  const timeCol = find(/clock|time|hour/, dateCol);
  // prefer measured output over schedules / forecasts
  const PRIORITY = [/actual.*\(mw\)/, /actual.*(mw|kw|power|generation)/, /(generation|output|power).*\((mw|kw)\)/, /^(mw|kw|power|output|generation)$/, /\((mw|kw)\)/];
  let valCol = -1;
  for (const re of PRIORITY) {
    valCol = header.findIndex((h, i) => re.test(h) && !/schedul|forecast|deviation|injection|settlement|mwh|kwh/.test(h) && i !== dateCol && i !== timeCol);
    if (valCol >= 0) break;
  }
  const cufCol = find(/cuf|capacity factor/);
  const nameCol = find(/entity name|plant|site|name/);
  if (valCol < 0) {
    const sample = splitCsvLine(lines[1]);
    for (let i = sample.length - 1; i >= 0; i -= 1) if (i !== dateCol && i !== timeCol && Number.isFinite(Number(sample[i]))) { valCol = i; break; }
  }
  if (valCol < 0) throw new Error("No generation (MW) column found.");
  const kw = /kw/.test(header[valCol]) && !/mw/.test(header[valCol]);

  const sum = new Float64Array(HOURS);
  const cnt = new Uint16Array(HOURS);
  const raw = [];
  const implied = [];
  let first = null;
  let last = null;
  let name = "";
  for (let i = 1; i < lines.length; i += 1) {
    const c = splitCsvLine(lines[i]);
    const dt = parseDateTime(c[dateCol], timeCol >= 0 ? c[timeCol] : "");
    if (!dt || dt.m < 0 || dt.m > 11 || (dt.m === 1 && dt.d === 29)) continue;
    let mw = Number(c[valCol]);
    if (!Number.isFinite(mw)) continue;
    if (kw) mw /= 1000;
    const h = (DAY_OFFSET[dt.m] + dt.d - 1) * 24 + Math.min(23, dt.hh);
    if (h < 0 || h >= HOURS) continue;
    raw.push([h, mw]);
    if (cufCol >= 0) {
      const cf = Number(c[cufCol]);
      if (cf > 0.5 && mw > 0) implied.push(mw / (cf / 100));
    }
    const key = `${dt.y}-${String(dt.m + 1).padStart(2, "0")}-${String(dt.d).padStart(2, "0")}`;
    if (!first || key < first) first = key;
    if (!last || key > last) last = key;
    if (!name && nameCol >= 0) name = c[nameCol];
  }
  if (raw.length < 48) throw new Error("Too few dated rows were recognised.");
  const sorted = (arr) => [...arr].sort((a, b) => a - b);
  let capacityMw = Number(referenceMw) > 0 ? Number(referenceMw) : null;
  let capacitySource = "given";
  if (!capacityMw && metaAc) { capacityMw = metaAc; capacitySource = `AC capacity stated in the file${metaDc ? ` (DC ${metaDc.toFixed(1)} MWp, DC/AC ${(metaDc / metaAc).toFixed(2)})` : ""}`; }
  // Measured data (a CUF column, or no stated AC capacity) gets the strict 110% rule; modelled
  // yield files that state their AC capacity in the header (PVsyst) may exceed nameplate.
  const scada = cufCol >= 0 || !metaAc;
  if (!capacityMw && implied.length > 20) { capacityMw = sorted(implied)[implied.length >> 1]; capacitySource = "implied by the CUF column"; }
  if (!capacityMw) { const v = sorted(raw.map((r) => r[1])); capacityMw = v[Math.floor(v.length * 0.995)] || 1; capacitySource = "99.5th percentile of output (no capacity given)"; }

  // Output above nameplate: SCADA readings > 110% of capacity are errors; modelled (PVsyst)
  // output may exceed the contracted AC figure when inverter capacity is higher, so it is
  // kept up to 130% and dropped only beyond that.
  const hardCap = scada ? 1.1 : 1.3;
  let negatives = 0;
  let negEnergy = 0;
  let posEnergy = 0;
  let invalid = 0;
  let aboveNameplate = 0;
  for (const [h, mw0] of raw) {
    let mw = mw0;
    if (mw < 0) { negatives += 1; negEnergy -= mw; mw = 0; } else posEnergy += mw;
    if (mw > capacityMw * hardCap) { invalid += 1; continue; }
    if (mw > capacityMw * 1.001) aboveNameplate += 1;
    sum[h] += mw;
    cnt[h] += 1;
  }
  const cf = new Float64Array(HOURS);
  const have = new Uint8Array(HOURS);
  const mhSum = Array.from({ length: 12 }, () => new Float64Array(24));
  const mhCnt = Array.from({ length: 12 }, () => new Uint32Array(24));
  const hSum = new Float64Array(24);
  const hCnt = new Uint32Array(24);
  let covered = 0;
  for (let t = 0; t < HOURS; t += 1) {
    if (!cnt[t]) continue;
    const v = Math.min(MAX_CF, sum[t] / cnt[t] / capacityMw);
    cf[t] = v;
    have[t] = 1;
    covered += 1;
    mhSum[MONTH_OF_HOUR[t]][HOUR_OF_DAY[t]] += v;
    mhCnt[MONTH_OF_HOUR[t]][HOUR_OF_DAY[t]] += 1;
    hSum[HOUR_OF_DAY[t]] += v;
    hCnt[HOUR_OF_DAY[t]] += 1;
  }
  const monthsMissing = [];
  for (let m = 0; m < 12; m += 1) if (!mhCnt[m].some((n) => n > 0)) monthsMissing.push(MONTHS[m]);
  for (let t = 0; t < HOURS; t += 1) {
    if (have[t]) continue;
    const m = MONTH_OF_HOUR[t];
    const hh = HOUR_OF_DAY[t];
    cf[t] = mhCnt[m][hh] ? mhSum[m][hh] / mhCnt[m][hh] : hCnt[hh] ? hSum[hh] / hCnt[hh] : 0;
  }
  const coverage = covered / HOURS;
  const invalidShare = invalid / raw.length;
  const negShare = negatives / raw.length;
  const cuf = mean(cf);
  const issues = [];
  let quality = "validated";
  if (invalidShare > 0.05) { quality = "rejected"; issues.push(`${(invalidShare * 100).toFixed(1)}% of readings exceed ${Math.round(hardCap * 100)}% of the ${capacityMw.toFixed(1)} MW capacity (wrong capacity, unit or capacity change)`); }
  // small negative night readings (auxiliary load) are normal; large negative energy is not
  const negEnergyShare = posEnergy > 0 ? negEnergy / posEnergy : 1;
  if (negEnergyShare > 0.05) { quality = "rejected"; issues.push(`negative readings amount to ${(negEnergyShare * 100).toFixed(0)}% of the generated energy (${(negShare * 100).toFixed(0)}% of readings)`); }
  if (quality !== "rejected") {
    if (coverage < 0.5) { quality = "suspect"; issues.push(`only ${(coverage * 100).toFixed(0)}% of the year has data`); }
    if (cuf < 0.12) { quality = "suspect"; issues.push(`very low CUF ${(cuf * 100).toFixed(1)}% (infirm / commissioning power or curtailment?)`); }
    if (monthsMissing.length >= 3) { quality = "suspect"; issues.push(`no data for ${monthsMissing.join(", ")} (filled with the average day)`); }
  }
  const notes = [];
  if (!scada && aboveNameplate > 0) {
    notes.push(`${aboveNameplate} readings are above the ${capacityMw.toFixed(0)} MW nameplate (inverter AC above the stated capacity); kept, so capacity factors reach ${(Math.max(...cf) * 100).toFixed(0)}%`);
  }
  if (negShare > 0) notes.push(`${(negShare * 100).toFixed(1)}% of readings were negative (night-time auxiliary consumption) and set to zero`);
  const monthly = monthlyMeans(cf);
  return {
    values: cf,
    name: name || metaTitle,
    notes,
    capacityMw,
    capacitySource,
    from: first,
    to: last,
    coverage,
    filledHours: HOURS - covered,
    invalidShare,
    negativeShare: negShare,
    monthsMissing,
    cuf,
    monthlyCuf: monthly,
    quality,
    issues,
    note: `${first} → ${last} · ${(coverage * 100).toFixed(0)}% of hours measured, rest filled · CUF ${(cuf * 100).toFixed(1)}% on ${capacityMw.toFixed(1)} MW`,
  };
}

/** Upload entry point: dated exports first, then plain 8760 / 35040 lists. */
export function parseAnyProfile(text, { kind = "cf", referenceMw = null } = {}) {
  if (kind !== "demand") {
    const dated = parseDatedProfile(text, { referenceMw });
    if (dated) return dated;
  }
  const plain = parseProfileCsv(text, { kind, referenceMw });
  const cuf = mean(plain.values);
  return { ...plain, cuf, monthlyCuf: monthlyMeans(plain.values), coverage: 1, quality: "validated", issues: [], filledHours: 0 };
}

export function profileTemplateCsv(kind) {
  const head = kind === "demand" ? "hour,month,hour_of_day,demand_mw" : `hour,month,hour_of_day,${kind}_cf_per_mw`;
  const rows = [head];
  for (let t = 0; t < HOURS; t += 1) rows.push(`${t + 1},${MONTH_OF_HOUR[t] + 1},${HOUR_OF_DAY[t]},${kind === "demand" ? 280 : 0}`);
  return rows.join("\n");
}

// ---------------------------------------------------------------- losses on the way to the meter

/** Each technology's stages from the source to the 33 kV main bus bar, in order. */
export const LOSS_STAGES = {
  solar: [
    { key: "dc", label: "DC losses", detail: "soiling, mismatch, DC cables", max: 0.1 },
    { key: "inverter", label: "Inverters", detail: "DC to LV AC", max: 0.05 },
    { key: "idt", label: "Inverter-duty transformers", detail: "LV / 33 kV", max: 0.05 },
    { key: "cable", label: "33 kV collection cables", detail: "inverter stations to the pooling substation", max: 0.05 },
  ],
  wind: [
    { key: "wtgTrafo", label: "WTG step-up transformers", detail: "0.69 / 33 kV at each turbine", max: 0.05 },
    { key: "cable", label: "33 kV collection cables", detail: "turbines to the pooling substation", max: 0.05 },
  ],
  bess: [
    { key: "pcs", label: "Power conversion system (PCS)", detail: "DC to AC, each way", max: 0.05 },
    { key: "mvTrafo", label: "MV transformers", detail: "LV / 33 kV, each way", max: 0.05 },
    { key: "cable", label: "33 kV feeder cables", detail: "to the pooling substation, each way", max: 0.05 },
  ],
};

/**
 * Share of the energy at the point a profile is measured that reaches the 33 kV bus: the product
 * of (1 - loss) over the stages after that point (`measuredAt` = how many stages the profile
 * already includes; all of them = measured at the bus).
 */
export function toBusFactor(kind, losses = {}, measuredAt = LOSS_STAGES[kind].length) {
  const stages = LOSS_STAGES[kind];
  let f = 1;
  for (let i = Math.max(0, measuredAt); i < stages.length; i += 1) f *= 1 - (losses?.[stages[i].key] || 0);
  return f;
}

/** The battery's round-trip efficiency seen from the 33 kV bus: the quoted one less the stages after it, both ways. */
export function rteAtBus(rte, losses, quotedAt) {
  const f = toBusFactor("bess", losses, quotedAt);
  return Math.min(1, rte * f * f);
}

/** All the bus factors for a set of inputs: solar and wind profiles, the battery's round trip, the bus-to-meter efficiency. */
export function lossFactors(inputs, rte) {
  return {
    solar: toBusFactor("solar", inputs.solarLoss, inputs.solarFileAt ?? LOSS_STAGES.solar.length),
    wind: toBusFactor("wind", inputs.windLoss, inputs.windFileAt ?? LOSS_STAGES.wind.length),
    rteBus: rteAtBus(rte, inputs.bessLoss, inputs.bessRteAt ?? LOSS_STAGES.bess.length),
    meter: evacuationEfficiency(inputs),
  };
}

// ---------------------------------------------------------------- dispatch

/**
 * Share of the energy injected at the 33 kV main bus bar that reaches the point of
 * interconnection (the 220 kV GSS and its billing meter): after the power transformer loss and
 * the transmission line loss. 1 when neither is set (Tender to Bid).
 */
export function evacuationEfficiency(ctx) {
  return (1 - (ctx.trafoLossPct || 0)) * (1 - (ctx.lineLossPct || 0));
}

/**
 * Hourly dispatch of solar + wind + BESS against demand, limited by plant (export) capacity.
 * Priority: RE direct to load → charge BESS from surplus → discharge BESS to deficit →
 * remaining surplus exported within spare plant capacity → rest curtailed. BESS charges only
 * from RE.
 *
 * Where it is measured: generation, the battery and curtailment at the 33 kV main bus bar (the
 * hourly profiles are there); demand, plant capacity, delivered energy, the DFR and surplus sold
 * at the POI (220 kV GSS, the billing meter). Everything injected at the bus (solar, wind and
 * battery discharge) loses the power transformer and line losses on its way to the meter, so the
 * dispatch runs at the bus with the demand and the capacity referred back to it (÷ η).
 */
export function simulate(ctx, sizes, opts = {}) {
  const { demand, solarCf, windCf, plantMw, bess } = ctx;
  const loss = 1 - (ctx.lossPct || 0);
  const poi = evacuationEfficiency(ctx); // η: bus → meter
  const busCap = plantMw / poi;
  const sF = (opts.solarFactor ?? 1) * loss;
  const wF = (opts.windFactor ?? 1) * loss;
  const dF = opts.demandFactor ?? 1;
  const S = Math.max(0, sizes.solarMw || 0);
  const W = Math.max(0, sizes.windMw || 0);
  const B = Math.max(0, sizes.bessMw || 0);
  const E = Math.max(0, sizes.bessMwh || 0) * (opts.bessFactor ?? 1);
  const eta = Math.sqrt(Math.min(1, Math.max(0.5, bess.rte)));
  const socMin = E * bess.minSoc;
  const socMax = E * bess.maxSoc;
  let soc = Math.min(socMax, Math.max(socMin, E * bess.initSoc));
  // Separate sites (ctx.sites.split): solar and wind on different sites, the battery split
  // between them by sizes.bessWindShare (MW and MWh alike; the optimizer decides it). Each
  // battery charges only from its own site: solar's surplus charges the solar-site battery, wind's
  // the wind-site battery, never the other way round. A deficit draws on both batteries.
  const split = Boolean(ctx.sites?.split);
  const share = split ? Math.min(1, Math.max(0, sizes.bessWindShare ?? 0.5)) : 0;
  const BA = B * (1 - share);
  const BB = B * share;
  const EA = E * (1 - share);
  const EB = E * share;
  let socA = EA * Math.min(bess.maxSoc, Math.max(bess.minSoc, bess.initSoc));
  let socB = EB * Math.min(bess.maxSoc, Math.max(bess.minSoc, bess.initSoc));
  const hourly = opts.hourly;
  const H = hourly
    ? {
        demand: new Float32Array(HOURS),
        solar: new Float32Array(HOURS),
        wind: new Float32Array(HOURS),
        discharge: new Float32Array(HOURS),
        charge: new Float32Array(HOURS),
        excess: new Float32Array(HOURS),
        curtail: new Float32Array(HOURS),
        unmet: new Float32Array(HOURS),
        soc: new Float32Array(HOURS),
      }
    : null;
  const mDemand = new Float64Array(12);
  const mDelivered = new Float64Array(12);
  let tDemand = 0;
  let tDelivered = 0;
  let tInjected = 0; // at the 33 kV bus: delivered + sold, before the transformer and line
  let tDischargePoi = 0;
  let tSolarGen = 0;
  let tWindGen = 0;
  let tSolarDirect = 0;
  let tWindDirect = 0;
  let tCharge = 0;
  let tDischarge = 0;
  let tExcess = 0;
  let tCurtail = 0;
  let sCharge = 0;
  let sExport = 0;
  let sCurtail = 0;
  let cuBatteryFull = 0;
  let cuBatteryPower = 0;
  let cuNoStorage = 0;
  const sell = Boolean(ctx.sellSurplus);
  const extraExport = Math.max(0, ctx.extraExportMw || 0);
  let tUnmet = 0;
  let aboveCap = 0;
  for (let t = 0; t < HOURS; t += 1) {
    const d = demand[t] * dF; // at the meter
    const dBus = d / poi; // what the bus must inject to deliver d at the meter
    const target = dBus < busCap ? dBus : busCap;
    if (d > plantMw) aboveCap += d - plantMw;
    const s = S * solarCf[t] * sF;
    const w = W * windCf[t] * wF;
    const g = s + w;
    const direct = g < target ? g : target;
    const surplus = g - direct;
    let ch = 0;
    let dis = 0;
    const deficit = target - direct;
    if (split) {
      // what each battery can still take
      const roomA = EA > 0 ? Math.max(0, Math.min(BA, (EA * bess.maxSoc - socA) / eta)) : 0;
      const roomB = EB > 0 ? Math.max(0, Math.min(BB, (EB * bess.maxSoc - socB) / eta)) : 0;
      if (surplus > 0) {
        // the customer is served from both sites; the surplus is split between them (solar's
        // part ss, wind's part surplus - ss) so that each battery takes as much of its own site's
        // surplus as it can: ss as close to the solar-site battery's room as solar allows
        const ssLo = Math.max(0, surplus - w);
        const ssHi = Math.min(s, surplus);
        const ss = Math.min(ssHi, Math.max(ssLo, roomA));
        const chA = Math.min(ss, roomA);
        const chB = Math.min(surplus - ss, roomB);
        socA += chA * eta;
        socB += chB * eta;
        ch = chA + chB;
      }
      if (deficit > 0) {
        const avA = EA > 0 ? Math.max(0, Math.min(BA, (socA - EA * bess.minSoc) * eta)) : 0;
        const avB = EB > 0 ? Math.max(0, Math.min(BB, (socB - EB * bess.minSoc) * eta)) : 0;
        dis = Math.min(deficit, avA + avB);
        const disA = avA + avB > 0 ? (dis * avA) / (avA + avB) : 0;
        socA -= disA / eta;
        socB -= (dis - disA) / eta;
      }
      soc = socA + socB;
    } else {
      if (surplus > 0 && E > 0) {
        ch = Math.min(surplus, B, (socMax - soc) / eta);
        if (ch < 0) ch = 0;
        soc += ch * eta;
      }
      if (deficit > 0 && E > 0) {
        dis = Math.min(deficit, B, (soc - socMin) * eta);
        if (dis < 0) dis = 0;
        soc -= dis / eta;
      }
    }
    const deliveredBus = direct + dis;
    const delivered = deliveredBus * poi; // at the meter
    const rest = surplus - ch;
    // Surplus the customer and the battery cannot take is sold only if surplus sales are on,
    // through spare plant capacity plus any extra export capacity; the rest is curtailed.
    const room = sell ? Math.max(0, busCap - deliveredBus) + extraExport / poi : 0;
    const ex = rest < room ? rest : room; // at the bus; ex * poi is sold at the meter
    const cu = rest - ex;
    if (cu > 1e-9) {
      if (E <= 0 || B <= 0) cuNoStorage += cu;
      else if (ch >= B - 1e-9) cuBatteryPower += cu;
      else cuBatteryFull += cu;
    }
    const m = MONTH_OF_HOUR[t];
    mDemand[m] += d;
    mDelivered[m] += delivered;
    tDemand += d;
    tDelivered += delivered;
    tSolarGen += s;
    tWindGen += w;
    const shareS = g > 0 ? s / g : 0;
    sCharge += ch * shareS;
    sExport += ex * shareS;
    sCurtail += cu * shareS;
    tSolarDirect += direct * shareS;
    tWindDirect += direct * (1 - shareS);
    tCharge += ch;
    tDischarge += dis;
    tDischargePoi += dis * poi;
    tInjected += deliveredBus + ex;
    tExcess += ex * poi;
    tCurtail += cu;
    tUnmet += d - delivered;
    if (H) {
      // what serves the customer at the meter (it adds up to the demand served); surplus at the bus
      H.demand[t] = d;
      H.solar[t] = direct * shareS * poi;
      H.wind[t] = direct * (1 - shareS) * poi;
      H.discharge[t] = dis * poi;
      H.charge[t] = ch;
      H.excess[t] = ex * poi;
      H.curtail[t] = cu;
      H.unmet[t] = d - delivered;
      H.soc[t] = E > 0 ? soc / E : 0;
    }
  }
  const monthlyDfr = Array.from(mDemand, (v, m) => (v > 0 ? mDelivered[m] / v : 1));
  const usable = E * (bess.maxSoc - bess.minSoc);
  const trafo = ctx.trafoLossPct || 0;
  return {
    demandMWh: tDemand,
    deliveredMWh: tDelivered, // at the meter (POI)
    // the bus-to-meter chain: what was injected at the 33 kV bus and what the power transformer
    // and the line took on the way to the billing meter
    evac: {
      efficiency: poi,
      trafoLossPct: trafo,
      lineLossPct: ctx.lineLossPct || 0,
      injectedMWh: tInjected,
      trafoLossMWh: tInjected * trafo,
      lineLossMWh: tInjected * (1 - trafo) * (ctx.lineLossPct || 0),
      meterMWh: tInjected * poi, // delivered + sold, at the meter
    },
    dfr: tDemand > 0 ? tDelivered / tDemand : 1,
    monthlyDfr,
    minMonthlyDfr: Math.min(...monthlyDfr),
    monthlyDemandMWh: Array.from(mDemand),
    monthlyDeliveredMWh: Array.from(mDelivered),
    solarGenMWh: tSolarGen, // at the 33 kV bus, as in the profile
    windGenMWh: tWindGen,
    solarDirectMWh: tSolarDirect, // at the bus
    windDirectMWh: tWindDirect,
    chargeMWh: tCharge, // at the bus
    dischargeMWh: tDischarge, // at the bus
    dischargePoiMWh: tDischargePoi, // battery energy that reached the meter
    excessMWh: tExcess, // sold, at the meter
    curtailMWh: tCurtail, // at the bus
    curtailReasons: { batteryFull: cuBatteryFull, batteryPower: cuBatteryPower, noStorage: cuNoStorage },
    // where each technology's output went at the bus (surplus flows split by the hour's solar/wind share)
    byTech: {
      solar: { direct: tSolarDirect, charge: sCharge, export: sExport, curtail: sCurtail },
      wind: { direct: tWindDirect, charge: tCharge - sCharge, export: tExcess / poi - sExport, curtail: tCurtail - sCurtail },
    },
    sellSurplus: sell,
    exportLimitMw: sell ? plantMw + extraExport : 0,
    unmetMWh: tUnmet,
    demandAboveCapMWh: aboveCap,
    cycles: usable > 0 ? tDischarge / usable : 0,
    hourly: H,
  };
}

// ---------------------------------------------------------------- degradation per year

export function yearFactors(year, fin, bess) {
  const solarFactor = (1 - (fin.solarDegradation || 0)) ** (year - 1);
  const windFactor = (1 - (fin.windDegradation || 0)) ** (year - 1);
  const demandFactor = (1 + (fin.demandGrowth || 0)) ** (year - 1);
  let bessFactor = 1;
  const deg = bess.annualDegradation || 0;
  if (bess.augmentation === "none") bessFactor = Math.max(0.4, 1 - deg * (year - 1));
  else if (bess.augmentation === "oneTime") {
    const since = year >= bess.augmentationYear ? year - bess.augmentationYear : year - 1;
    bessFactor = Math.max(0.4, 1 - deg * since);
  } else if (bess.augmentation === "schedule") {
    // finance v3: the capacity fades from the last augmentation year on or before this year
    const last = (bess.augmentationYears || []).map((v) => Math.round(v)).filter((v) => v > 1 && v <= year).reduce((a, b) => Math.max(a, b), 1);
    bessFactor = Math.max(0.4, 1 - deg * (year - last));
  }
  return { solarFactor, windFactor, bessFactor, demandFactor };
}

/**
 * Conservative design envelope for lifetime DFR checks: the lowest solar, wind and BESS
 * factors and the highest demand factor seen in any PPA year, applied together.
 */
export function worstYearFactors(fin, bess) {
  const years = fin.years || 25;
  const env = { solarFactor: 1, windFactor: 1, bessFactor: 1, demandFactor: 1 };
  for (let y = 1; y <= years; y += 1) {
    const f = yearFactors(y, fin, bess);
    env.solarFactor = Math.min(env.solarFactor, f.solarFactor);
    env.windFactor = Math.min(env.windFactor, f.windFactor);
    env.bessFactor = Math.min(env.bessFactor, f.bessFactor);
    env.demandFactor = Math.max(env.demandFactor, f.demandFactor);
  }
  return env;
}

// ---------------------------------------------------------------- costs

/** Apply the chosen discharge duration (MWh = MW x hours) when one is set. */
export function withDuration(sizes, bess) {
  const dur = Number(bess?.durationH);
  return dur > 0 ? { ...sizes, bessMwh: sizes.bessMw * dur } : sizes;
}

/** Repayment methods standard in Indian project finance, with the rule for each year's principal. */
export const REPAYMENT_METHODS = {
  equal: { label: "Equal principal", detail: "The balance in equal parts over the years left" },
  annuity: { label: "Annuity", detail: "Level debt service: interest falls, principal rises" },
  sculpted: { label: "Sculpted to a DSCR", detail: "Each year's principal is what keeps the DSCR at the target; the rest in the last year" },
  balloon: { label: "Balloon", detail: "A share of the debt in the last year, the rest in equal parts" },
  bullet: { label: "Bullet", detail: "Interest only; the whole debt in the last year" },
  stepUp: { label: "Step-up", detail: "The principal grows at a rate a year" },
};

/** How the project cost is spent over the construction months (cumulative share at t = m / M). */
export const DRAWDOWN_PROFILES = {
  linear: { label: "Even", detail: "The same amount every month", cum: (t) => t },
  sCurve: { label: "S-curve", detail: "Slow start, fast middle, slow finish", cum: (t) => (1 - Math.cos(Math.PI * t)) / 2 },
  front: { label: "Front-loaded", detail: "Most of it early (equipment advances)", cum: (t) => 1 - (1 - t) ** 2 },
  back: { label: "Back-loaded", detail: "Most of it late (milestone payments)", cum: (t) => t ** 2 },
};

/**
 * The construction phase month by month: the cost drawn in each month under the drawdown profile,
 * funded by equity and debt (pro rata, or equity first), the interest during construction (IDC)
 * on the debt drawn, and the IDC itself capitalised as debt. The debt share applies to the cost
 * before IDC, so there is no circularity: debt = share × cost + IDC, equity = (1 − share) × cost.
 * Interest in a month is on the balance at its start plus the month's draw.
 * Null when there is no construction schedule (constructionMonths 0): IDC is then inside the
 * pre-operative percentage, as before.
 */
export function constructionSchedule(baseCostCr, costs, fin, components = null) {
  const M = Math.max(0, Math.round(costs?.constructionMonths || 0));
  if (!(M > 0) || !fin) return null;
  const d = Math.min(1, Math.max(0, fin.debtFraction || 0));
  const r = (fin.interestRate || 0) / 12;
  const prof = DRAWDOWN_PROFILES[costs.drawdown] || DRAWDOWN_PROFILES.linear;
  const equityFirst = costs.drawOrder === "equityFirst";
  const equityTotal = baseCostCr * (1 - d);
  // finance v3: the parts of the hard cost, each spent under the profile inside its own window
  // (costs.phasing); a part without a window is spent over the whole construction like the
  // pre-operative cost. Without phasing the month's cost is the profile's share of the whole.
  const parts = (components || []).map((c) => {
    const ph = c.start !== undefined && c.months !== undefined && c.months > 0 ? { start: Math.max(0, Math.min(M - 1, Math.round(c.start))), months: Math.max(1, Math.round(c.months)) } : null;
    if (ph) ph.months = Math.min(ph.months, M - ph.start);
    return { ...c, ph };
  });
  const phased = parts.some((c) => c.ph);
  const bridgeMonths = Math.max(0, Math.min(M, Math.round(fin.bridge?.months || 0)));
  const bridgeRate = (fin.bridge?.rate ?? fin.interestRate ?? 0) / 12;
  const bridgeFeePct = bridgeMonths > 0 ? Math.max(0, fin.bridge?.feePct || 0) : 0;
  const rows = [];
  let cumEq = 0;
  let bal = 0;
  let idcTotal = 0;
  let bridgeFee = 0;
  for (let m = 1; m <= M; m += 1) {
    const share = prof.cum(m / M) - prof.cum((m - 1) / M);
    let cost = baseCostCr * share;
    const byComponent = {};
    if (phased) {
      cost = 0;
      for (const c of parts) {
        let v;
        if (c.ph) {
          const t1 = (m - c.ph.start) / c.ph.months;
          const t0 = (m - 1 - c.ph.start) / c.ph.months;
          v = t1 <= 0 || t0 >= 1 ? 0 : (c.costCr || 0) * (prof.cum(Math.min(1, t1)) - prof.cum(Math.max(0, t0)));
        } else v = (c.costCr || 0) * share;
        byComponent[c.key] = v;
        cost += v;
      }
    } else for (const c of parts) byComponent[c.key] = baseCostCr > 0 ? (cost * (c.costCr || 0)) / baseCostCr : 0;
    const equity = equityFirst ? Math.min(cost, Math.max(0, equityTotal - cumEq)) : cost * (1 - d);
    const debt = cost - equity;
    cumEq += equity;
    const opening = bal;
    const bridge = m <= bridgeMonths;
    const idc = (opening + debt) * (bridge ? bridgeRate : r);
    bal = opening + debt + idc;
    let fee = 0;
    if (bridge && m === bridgeMonths) { fee = bal * bridgeFeePct; bal += fee; bridgeFee += fee; }
    idcTotal += idc;
    rows.push({ month: m, share, cost, equity, debt, openingDebt: opening, idc, closingDebt: bal, bridge, bridgeFee: fee, byComponent });
  }
  return { months: M, profile: costs.drawdown || "linear", order: equityFirst ? "equityFirst" : "proRata", rows, idc: idcTotal, bridgeFee, bridgeMonths, debtDrawn: baseCostCr * d, equity: equityTotal, phased, components: parts.map((c) => ({ key: c.key, costCr: c.costCr, start: c.ph?.start ?? 0, months: c.ph?.months ?? M })) };
}

/**
 * The project cost: the hard cost, the pre-operative cost (a share of it) and, when a construction
 * schedule is set and the financing is given, the IDC worked out month by month; else the
 * pre-operative share stands for both. With a schedule the debt is the debt share of the cost
 * before IDC plus the IDC (debt0 / equity0 are then set; without one the caller applies the share).
 */
export function capexCr(sizes, costs, fin = null) {
  // the hard cost by component (finance v3: the breakup, its phasing and the asset register)
  const by = {
    solar: sizes.solarMw * costs.solarCrPerMw,
    wind: sizes.windMw * costs.windCrPerMw,
    bess: sizes.bessMwh * costs.bessCrPerMwh,
    pcs: sizes.bessMw * (costs.bessPcsCrPerMw || 0),
    evac: costs.evacuationCr || 0,
    other: (sizes.biomassMw || 0) * (costs.biomassCrPerMw || 0) // Tender to Bid only; 0 for Round the clock
      // Tender to Bid dispatchable plants (hydro, thermal): capex per MW; none for Round the clock
      + (costs.plants || []).reduce((sum, pl) => sum + (sizes[`${pl.id}Mw`] || 0) * (pl.capexCrPerMw || 0), 0)
      // other project cost given outright (SECI CfD-I: SECI's charges with GST and the bank guarantees' cost); 0 elsewhere
      + (costs.otherCapexCr || 0),
  };
  const hard = by.solar + by.wind + by.bess + by.pcs + by.evac + by.other;
  const preop = hard * (costs.preopPct || 0);
  const ph = costs.phasing || null;
  const components = [
    ...["solar", "wind", "bess", "evac", "other"].map((k) => ({ key: k, costCr: k === "bess" ? by.bess + by.pcs : by[k], ...(ph?.[k] ? { start: ph[k].start || 0, months: ph[k].months } : {}) })),
    { key: "preop", costCr: preop },
  ];
  const construction = constructionSchedule(hard + preop, costs, fin, components);
  const idc = construction ? construction.idc : 0;
  const bridgeFee = construction ? construction.bridgeFee : 0;
  // finance v3 fees funded by equity: the guarantees' fees over the construction period and the
  // mezzanine arrangement fee
  const M = construction ? construction.months : 0;
  const guaranteeFees = (fin?.guarantees || []).reduce((a, g) => a + ((g.fromYear || 0) === 0 ? (g.amountCr || 0) * (g.feePct || 0) * (M / 12) : 0), 0);
  const mezzFee = (fin?.mezz?.amountCr || 0) * (fin?.mezz?.feePct || 0);
  const fees = guaranteeFees + mezzFee;
  const total = hard + preop + idc + bridgeFee + fees;
  return {
    hard, preop, idc, bridgeFee, fees, guaranteeFees, mezzFee, total, construction,
    byComponent: { ...by, preop, idc, bridgeFee, fees },
    debt0: construction ? construction.debtDrawn + idc + bridgeFee : null,
    equity0: construction ? construction.equity + fees : null,
  };
}

function crf(rate, n) {
  if (rate <= 0) return 1 / n;
  const f = (1 + rate) ** n;
  return (rate * f) / (f - 1);
}

function augmentationScheduleCr(sizes, costs, bess, years) {
  const out = new Array(years + 1).fill(0);
  const deg = bess.annualDegradation || 0;
  const priceAt = (y) => costs.bessCrPerMwh * (1 - (bess.costDeclinePct || 0)) ** (y - 1);
  if (!sizes.bessMwh || !deg) return out;
  if (bess.augmentation === "annual") {
    for (let y = 2; y <= years; y += 1) out[y] = sizes.bessMwh * deg * priceAt(y);
  } else if (bess.augmentation === "oneTime" && bess.augmentationYear > 1 && bess.augmentationYear <= years) {
    const y = bess.augmentationYear;
    const lost = Math.min(0.6, deg * (y - 1));
    out[y] = sizes.bessMwh * lost * priceAt(y);
  } else if (bess.augmentation === "schedule") {
    // finance v3: in each listed year the capacity lost since the previous augmentation is replaced
    const ys = [...new Set((bess.augmentationYears || []).map((v) => Math.round(v)).filter((v) => v > 1 && v <= years))].sort((a, b) => a - b);
    let last = 1;
    for (const y of ys) {
      out[y] = sizes.bessMwh * Math.min(0.6, deg * (y - last)) * priceAt(y);
      last = y;
    }
  }
  return out;
}

function omCr(sizes, fin) {
  return (sizes.solarMw * fin.solarOmLakhPerMw + sizes.windMw * fin.windOmLakhPerMw + sizes.bessMwh * fin.bessOmLakhPerMwh
    + (sizes.biomassMw || 0) * (fin.biomassOmLakhPerMw || 0)) / 100;
}

/**
 * Screening objective used by the optimizer: levelised cost of delivered energy
 * (Rs/kWh) = (capex·CRF + levelised O&M + levelised augmentation − surplus revenue) / energy.
 */
export function evaluateDesign(ctx, sizes, model) {
  const { costs, fin, bess, dfrTarget, dfrBasis, designCheck } = model;
  const y1 = simulate(ctx, sizes);
  let worst = null;
  if (designCheck === "lifetime") worst = simulate(ctx, sizes, model.worstFactors);
  const dfrY1 = dfrBasis === "monthly" ? y1.minMonthlyDfr : y1.dfr;
  const dfrWorst = worst ? (dfrBasis === "monthly" ? worst.minMonthlyDfr : worst.dfr) : dfrY1;
  const dfrCheck = Math.min(dfrY1, dfrWorst);
  const capex = capexCr(sizes, costs, fin);
  const years = fin.years || 25;
  const r = fin.discountRate || 0.1;
  const f = crf(r, years);
  let omPv = 0;
  const om = omCr(sizes, fin) + capex.hard * (fin.insurancePct || 0) + (fin.otherFixedCr || 0);
  const aug = augmentationScheduleCr(sizes, costs, bess, years);
  for (let y = 1; y <= years; y += 1) omPv += (om * (1 + fin.omEscalation) ** (y - 1) + aug[y]) / (1 + r) ** y;
  const energy = worst ? (y1.deliveredMWh + worst.deliveredMWh) / 2 : y1.deliveredMWh;
  const excess = worst ? (y1.excessMWh + worst.excessMWh) / 2 : y1.excessMWh;
  const surplusRevenue = fin.sellSurplus ? excess * fin.surplusPrice * RS_CR_PER_MWH_AT_1RS : 0;
  const annualCost = capex.total * f + omPv * f - surplusRevenue;
  const lcoe = energy > 0 ? annualCost / (energy * RS_CR_PER_MWH_AT_1RS) : Infinity;
  const feasible = dfrCheck >= dfrTarget - 1e-6;
  return {
    sizes: { ...sizes },
    dfr: y1.dfr,
    minMonthlyDfr: y1.minMonthlyDfr,
    dfrWorst: worst ? worst.dfr : y1.dfr,
    dfrCheck,
    feasible,
    capexCr: capex.total,
    lcoe,
    deliveredMWh: y1.deliveredMWh,
    excessMWh: y1.excessMWh,
    curtailMWh: y1.curtailMWh,
    cycles: y1.cycles,
  };
}

function objectiveValue(ev, objective, dfrTarget) {
  const base = objective === "capex" ? ev.capexCr / 1000 : ev.lcoe; // "tariff" screens on LCOE
  if (ev.feasible) return base;
  return base + 10 + (dfrTarget - ev.dfrCheck) * 200;
}

// ---------------------------------------------------------------- optimizer

export const DEFAULT_VARS = {
  solarMw: { value: 450, min: 0, max: 1200, step: 5, locked: false },
  windMw: { value: 300, min: 0, max: 900, step: 5, locked: false },
  bessMw: { value: 150, min: 0, max: 500, step: 5, locked: false },
  bessMwh: { value: 600, min: 0, max: 3000, step: 10, locked: false },
};

const VAR_KEYS = ["solarMw", "windMw", "bessMw", "bessMwh"];

function snap(v, spec) {
  const s = spec.step || 1;
  return Math.min(spec.max, Math.max(spec.min, Math.round(v / s) * s));
}

function linspace(spec, n) {
  if (spec.locked) return [spec.value];
  if (spec.max <= spec.min) return [spec.min];
  const out = new Set();
  for (let i = 0; i < n; i += 1) out.add(snap(spec.min + ((spec.max - spec.min) * i) / (n - 1), spec));
  return [...out];
}

/**
 * Least-cost sizing. Stage 1: coarse grid over solar x wind x BESS power, bisecting BESS energy
 * for the smallest feasible MWh. Stage 2: compass (pattern) search from the best candidates
 * on the snapped lattice. Locked variables are held at their value.
 */
const fmtSizes = (z) => `solar ${Math.round(z.solarMw)} MW, wind ${Math.round(z.windMw)} MW, BESS ${Math.round(z.bessMw)} MW / ${Math.round(z.bessMwh)} MWh${z.bessWindShare !== undefined ? ` (${Math.round(z.bessWindShare * 100)}% at the wind site)` : ""}`;
const SHARE_SPEC = { value: 0.5, min: 0, max: 1, step: 0.05, locked: false };

export function* optimizeSteps(ctx, model, onProgress) {
  const started = Date.now();
  const clock = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
  const t0 = clock();
  // Optimizer log: what was searched, every surface point, every accepted move, final checks.
  const log = [];
  const L = (stage, msg, extra = {}) => { if (log.length < 4000) log.push({ t: Math.round(clock() - t0), stage, msg, ...extra }); };
  let cacheHits = 0;
  let simMs = 0;
  // separate sites: the share of the battery at the wind site is searched too
  const split = Boolean(ctx.sites?.split);
  const KEYS = split ? [...VAR_KEYS, "bessWindShare"] : VAR_KEYS;
  const WALK_KEYS = VAR_KEYS; // exhaustive neighbourhood walks: sizes only; the share gets its own sweep
  const vars = {};
  for (const k of KEYS) {
    const v = model.vars[k] || SHARE_SPEC;
    vars[k] = { ...v, value: v.locked ? v.value : snap(v.value, v), min: Math.min(v.min, v.max), max: Math.max(v.min, v.max) };
  }
  const withShare = (input) => (split && input.bessWindShare === undefined ? { ...input, bessWindShare: vars.bessWindShare.value } : input);
  const cache = new Map();
  const cloud = [];
  let evals = 0;
  const minDur = model.bess.minDurationH || 0;
  const maxDur = model.bess.maxDurationH || 1e9;
  // fixed discharge duration: battery energy follows battery power, only MW is searched
  const fixedDur = Number(model.bess.durationH) > 0 ? Number(model.bess.durationH) : null;
  if (fixedDur) vars.bessMwh = { ...vars.bessMwh, locked: true, value: 0 };
  const evalAt = (raw) => {
    const input = withShare(raw);
    const sizes = fixedDur ? { ...input, bessMwh: input.bessMw * fixedDur } : input;
    const key = KEYS.map((k) => sizes[k]).join("|");
    if (cache.has(key)) { cacheHits += 1; return cache.get(key); }
    const ts = clock();
    const ev = evaluateDesign(ctx, sizes, model);
    simMs += clock() - ts;
    // duration window only applies when a BESS exists
    if (fixedDur) {
      // duration is fixed by definition
    } else if (sizes.bessMwh > 0 && sizes.bessMw > 0) {
      const dur = sizes.bessMwh / sizes.bessMw;
      if (dur < minDur - 1e-9 || dur > maxDur + 1e-9) ev.durationViolation = true;
    } else if (sizes.bessMwh > 0 !== sizes.bessMw > 0) ev.durationViolation = true;
    // tiny tie-breaker: when PCS is free, prefer the smaller inverter for equal cost
    ev.score = objectiveValue(ev, model.objective, model.dfrTarget) + (ev.durationViolation ? 50 : 0) + sizes.bessMw * 1e-7;
    evals += 1;
    cache.set(key, ev);
    if (cloud.length < 4000) cloud.push({ ...ev.sizes, dfr: ev.dfrCheck, lcoe: ev.lcoe, capexCr: ev.capexCr, feasible: ev.feasible && !ev.durationViolation });
    return ev;
  };

  // full 25-year financial model of one design: yearly dispatch with degradation and
  // augmentation, debt, tax, working capital, and the tariff that gives the target equity IRR.
  // Feasible = DFR met in every PPA year (exact, not an envelope).
  const tariffMode = model.objective === "tariff";
  const tcache = new Map();
  let tariffEvals = 0;
  let tariffMs = 0;
  const tariffAt = (raw) => {
    const input = withShare(raw);
    const sizes = fixedDur ? { ...input, bessMwh: input.bessMw * fixedDur } : input;
    const key = KEYS.map((k) => sizes[k]).join("|");
    if (tcache.has(key)) return tcache.get(key);
    const ts = clock();
    const fm = runFinancialModel(ctx, sizes, { costs: model.costs, fin: model.fin, bess: model.bess, dfrTarget: model.dfrTarget, tariffLocked: false });
    tariffMs += clock() - ts;
    tariffEvals += 1;
    const dfrOf = (r) => (model.dfrBasis === "monthly" ? r.minMonthlyDfr : r.dfr);
    const worstYear = fm.rows.reduce((w, r) => (dfrOf(r) < dfrOf(w) ? r : w), fm.rows[0]);
    const minDfr = dfrOf(worstYear);
    const feasible = minDfr >= model.dfrTarget - 1e-6;
    const rec = {
      sizes: { ...sizes },
      tariff: fm.tariff,
      lcoe: fm.lcoe,
      capexCr: fm.capex.total,
      minDfr,
      worstYear: worstYear.year,
      augCapexCr: fm.totals.augCapex,
      feasible,
      score: (feasible ? fm.tariff : fm.tariff + 10 + (model.dfrTarget - minDfr) * 200) + sizes.bessMw * 1e-7,
      deliveredMwh: fm.rows.map((r) => r.deliveredMu * 1000),
      exportMwh: fm.rows.map((r) => r.excessMu * 1000),
    };
    tcache.set(key, rec);
    return rec;
  };

  const gridN = model.gridPoints || 11;
  const solarGrid = linspace(vars.solarMw, gridN);
  const windGrid = linspace(vars.windMw, gridN);
  const bessGrid = linspace(vars.bessMw, fixedDur ? 9 : 6);
  const total = solarGrid.length * windGrid.length * bessGrid.length;
  let done = 0;
  const simsPerEval = model.designCheck === "lifetime" ? 2 : 1;
  L("setup", `Objective: ${model.objective === "capex" ? "least capital cost" : model.objective === "tariff" ? "least 25-year tariff (screened by levelised cost, then full 25-year financial model on a shortlist)" : "least levelised cost of delivered energy"}; DFR ≥ ${(model.dfrTarget * 100).toFixed(1)}% (${model.dfrBasis === "monthly" ? "every month" : "annual"}); check: ${model.designCheck === "lifetime" ? "year 1 and the most degraded year" : "year 1 only"}`);
  for (const k of KEYS) {
    const v = vars[k];
    if (k === "bessMwh" && fixedDur) L("setup", `bessMwh: follows battery power × ${fixedDur} h (fixed discharge duration)`);
    else L("setup", `${k}: ${v.locked ? `locked at ${v.value}` : `searched ${v.min}–${v.max} step ${v.step}`}`);
  }
  L("setup", `Plant capacity ${ctx.plantMw} MW; demand ${(ctx.demand.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} MU; surplus ${ctx.sellSurplus ? `sold (extra export ${ctx.extraExportMw || 0} MW)` : "curtailed"}`);
  L("setup", `Grid: ${solarGrid.length} solar × ${windGrid.length} wind × ${bessGrid.length} battery-power points${fixedDur ? "" : ", battery MWh by bisection to the smallest feasible size"}; each design = ${simsPerEval} full 8,760-hour dispatch${simsPerEval > 1 ? "es" : ""}`);
  let gridBest = null;
  const seeds = [];
  const cellBests = [];
  if (onProgress) onProgress({ stage: "axes", solarGrid, windGrid, total });
  solarGrid.forEach((solarMw, si) => {
    windGrid.forEach((windMw, wi) => {
      let cellBest = null;
      for (const bessMw of bessGrid) {
        done += 1;
        let best;
        if (vars.bessMwh.locked) {
          best = evalAt({ solarMw, windMw, bessMw, bessMwh: vars.bessMwh.value });
        } else {
          let lo = Math.max(vars.bessMwh.min, bessMw > 0 ? bessMw * minDur : 0);
          let hi = Math.min(vars.bessMwh.max, bessMw > 0 ? bessMw * maxDur : 0);
          if (bessMw === 0) { lo = 0; hi = 0; }
          lo = snap(lo, vars.bessMwh);
          hi = snap(hi, vars.bessMwh);
          const top = evalAt({ solarMw, windMw, bessMw, bessMwh: hi });
          if (!top.feasible || hi <= lo) best = top;
          else {
            const bottom = evalAt({ solarMw, windMw, bessMw, bessMwh: lo });
            if (bottom.feasible) best = bottom;
            else {
              let a = lo;
              let b = hi;
              while (b - a > vars.bessMwh.step) {
                const mid = snap((a + b) / 2, vars.bessMwh);
                if (mid <= a || mid >= b) break;
                if (evalAt({ solarMw, windMw, bessMw, bessMwh: mid }).feasible) b = mid;
                else a = mid;
              }
              best = evalAt({ solarMw, windMw, bessMw, bessMwh: b });
            }
          }
        }
        seeds.push(best);
        if (!cellBest || best.score < cellBest.score) cellBest = best;
        if (onProgress && done % 25 === 0) onProgress({ stage: "grid", done, total, evals });
      }
      // one point of the cost surface: best storage for this solar x wind pair
      const okCell = Boolean(cellBest.feasible && !cellBest.durationViolation);
      cellBests.push({ si, wi, ev: cellBest, ok: okCell });
      const isNewBest = okCell && (!gridBest || cellBest.score < gridBest.score);
      if (isNewBest) gridBest = cellBest;
      L("grid", `${fmtSizes(cellBest.sizes)} → ${okCell ? `LCOE ₹${cellBest.lcoe.toFixed(3)}/kWh` : "misses DFR"} · DFR ${(cellBest.dfrCheck * 100).toFixed(2)}% · capex ₹${Math.round(cellBest.capexCr)} cr${isNewBest ? "  ← best so far" : ""}`, { sizes: cellBest.sizes, lcoe: cellBest.lcoe, dfr: cellBest.dfrCheck, feasible: okCell, evals });
      if (onProgress) {
        onProgress({
          stage: "cell",
          si,
          wi,
          lcoe: cellBest.lcoe,
          capexCr: cellBest.capexCr,
          feasible: Boolean(cellBest.feasible && !cellBest.durationViolation),
          dfr: cellBest.dfrCheck,
          sizes: cellBest.sizes,
        });
      }
    });
  });
  seeds.sort((a, b) => a.score - b.score);
  const starts = [];
  for (const s of seeds) {
    if (starts.length >= (model.starts || 6)) break;
    if (!starts.some((x) => KEYS.every((k) => Math.abs(x.sizes[k] - s.sizes[k]) < 1e-9))) starts.push(s);
  }
  L("grid", `Grid done: ${evals} designs evaluated, ${seeds.filter((x) => x.feasible && !x.durationViolation).length} of ${seeds.length} grid designs meet the DFR`, { evals });
  // hand the screening optimum to the caller: it starts the HiGHS LP now, in parallel
  let highsSeed = null;
  if (tariffMode && gridBest) {
    const r = tariffAt(gridBest.sizes);
    highsSeed = { sizes: r.sizes, tariff: r.tariff, deliveredMwh: r.deliveredMwh, exportMwh: r.exportMwh };
  }
  yield { stage: "screened", seed: highsSeed };

  // tariff map: the 25-year tariff of the cheapest design at every solar × wind point
  let tariffMap = null;
  if (tariffMode) {
    L("tariff", `Tariff map: full 25-year financial model for the best design at each of ${cellBests.length} solar × wind points (DFR required in every year)`);
    tariffMap = { solarGrid, windGrid, cells: [] };
    cellBests.forEach(({ si, wi, ev, ok }, i) => {
      const r = ok || ev.dfrCheck >= model.dfrTarget - 0.02 ? tariffAt(ev.sizes) : null;
      const cell = { si, wi, sizes: ev.sizes, tariff: r ? r.tariff : null, minDfr: r ? r.minDfr : ev.dfrCheck, worstYear: r ? r.worstYear : null, feasible: Boolean(r?.feasible) };
      tariffMap.cells.push(cell);
      if (r) L("tariff", `${fmtSizes(ev.sizes)} → ₹${r.tariff.toFixed(4)}/kWh · lowest yearly DFR ${(r.minDfr * 100).toFixed(2)}% (year ${r.worstYear})${r.feasible ? "" : " ✗ misses DFR"}`, { sizes: ev.sizes, tariff: r.tariff, dfr: r.minDfr, feasible: r.feasible });
      if (onProgress) onProgress({ stage: "tcell", ...cell, z: cell.tariff });
      if (onProgress && i % 8 === 0) onProgress({ stage: "tariffmap", done: i + 1, total: cellBests.length, evals });
    });
  }

  starts.forEach((st, i) => L("refine", `Start ${i + 1}: ${fmtSizes(st.sizes)} (LCOE ₹${st.lcoe.toFixed(3)}, DFR ${(st.dfrCheck * 100).toFixed(2)}%)`));
  const results = [];
  starts.forEach((start, si) => {
    let cur = start;
    const steps = {};
    for (const k of KEYS) {
      const spec = vars[k];
      steps[k] = spec.locked ? 0 : Math.max(spec.step, snap((spec.max - spec.min) / (gridN - 1) / 2, { ...spec, min: 0 }));
    }
    let guard = 0;
    while (guard < 400) {
      guard += 1;
      let improved = false;
      for (const k of KEYS) {
        if (!steps[k]) continue;
        for (const dir of [1, -1]) {
          const next = { ...cur.sizes, [k]: snap(cur.sizes[k] + dir * steps[k], vars[k]) };
          if (next[k] === cur.sizes[k]) continue;
          const ev = evalAt(next);
          if (ev.score < cur.score - 1e-9) {
            L("refine", `Start ${si + 1}: ${k} ${cur.sizes[k]} → ${next[k]} · LCOE ₹${cur.lcoe.toFixed(4)} → ₹${ev.lcoe.toFixed(4)} · DFR ${(ev.dfrCheck * 100).toFixed(2)}%${ev.feasible ? "" : " (infeasible)"}`, { evals });
            cur = ev;
            improved = true;
          }
        }
      }
      // coupled move: storage power and energy together (keeps duration)
      if (steps.bessMw && steps.bessMwh) {
        for (const dir of [1, -1]) {
          const next = { ...cur.sizes, bessMw: snap(cur.sizes.bessMw + dir * steps.bessMw, vars.bessMw), bessMwh: snap(cur.sizes.bessMwh + dir * steps.bessMwh * 4, vars.bessMwh) };
          const ev = evalAt(next);
          if (ev.score < cur.score - 1e-9) {
            L("refine", `Start ${si + 1}: battery MW+MWh together → ${Math.round(next.bessMw)} MW / ${Math.round(next.bessMwh)} MWh · LCOE ₹${ev.lcoe.toFixed(4)}`, { evals });
            cur = ev;
            improved = true;
          }
        }
      }
      if (!improved) {
        let any = false;
        for (const k of KEYS) {
          if (steps[k] > vars[k].step) {
            steps[k] = Math.max(vars[k].step, snap(steps[k] / 2, { ...vars[k], min: 0 }));
            any = true;
          }
        }
        if (!any) break;
        L("refine", `Start ${si + 1}: no improving move; halving steps → ${KEYS.filter((k) => steps[k]).map((k) => `${k} ${steps[k]}`).join(", ")}`);
      }
    }
    L("refine", `Start ${si + 1} converged: ${fmtSizes(cur.sizes)} · LCOE ₹${cur.lcoe.toFixed(4)} · DFR ${(cur.dfrCheck * 100).toFixed(2)}%`, { evals });
    results.push(cur);
    if (onProgress) onProgress({ stage: "refine", done: si + 1, total: starts.length, evals });
  });
  results.sort((a, b) => a.score - b.score);
  const ranked = [...cache.values()].filter((e) => e.feasible && !e.durationViolation).sort((a, b) => a.score - b.score);
  const alternatives = [];
  for (const e of ranked) {
    if (alternatives.length >= 8) break;
    // distinct plant mixes only (BESS power alone is a weak differentiator)
    const mix = (x) => [x.sizes.solarMw, x.sizes.windMw, x.sizes.bessMwh].join("|");
    if (!alternatives.some((x) => mix(x) === mix(e))) alternatives.push(e);
  }
  let best = results[0] || seeds[0];
  // neighbourhood check: exhaustively evaluate every design within ±3 double-steps of the
  // answer (7 × 7 × 7 around solar, wind and battery power), adopt anything cheaper and repeat
  // around the new answer until a round finds nothing better (max 4 rounds)
  for (let round = 1; round <= 4; round += 1) {
    const axes = WALK_KEYS.filter((k) => !vars[k].locked).map((k) => ({ k, stride: vars[k].step * 2 }));
    const combos = [];
    const walk = (i, cur) => {
      if (i === axes.length) { combos.push(cur); return; }
      for (let d = -3; d <= 3; d += 1) walk(i + 1, { ...cur, [axes[i].k]: snap(best.sizes[axes[i].k] + d * axes[i].stride, vars[axes[i].k]) });
    };
    walk(0, { ...best.sizes });
    const before = evals;
    let improvedBy = null;
    for (const c of combos) {
      const ev = evalAt(c);
      if (ev.feasible && !ev.durationViolation && ev.score < best.score - 1e-9) { improvedBy = ev; best = ev; }
    }
    const span = axes.map((a) => `${a.k} ±${a.stride * 3}`).join(", ");
    L("verify", improvedBy
      ? `Neighbourhood check ${round} (${combos.length} designs, ${span}; ${evals - before} new): found a cheaper feasible design and adopted it: ${fmtSizes(best.sizes)} · LCOE ₹${best.lcoe.toFixed(4)}`
      : `Neighbourhood check ${round} (${combos.length} designs, ${span}; ${evals - before} new): no cheaper feasible design; the answer is a local optimum ✓`, { evals });
    if (!improvedBy) break;
  }
  if (split) {
    // the battery's split between the sites, swept from all at the solar site to all at the wind site
    let sweptBy = null;
    for (let v = vars.bessWindShare.min; v <= vars.bessWindShare.max + 1e-9; v += vars.bessWindShare.step) {
      const ev = evalAt({ ...best.sizes, bessWindShare: snap(v, vars.bessWindShare) });
      if (ev.feasible && !ev.durationViolation && ev.score < best.score - 1e-9) { sweptBy = ev; best = ev; }
    }
    L("verify", sweptBy ? `Battery split between the sites: ${Math.round(best.sizes.bessWindShare * 100)}% at the wind site is cheaper; adopted` : `Battery split between the sites: ${Math.round(best.sizes.bessWindShare * 100)}% at the wind site is the cheapest ✓`, { evals });
  }
  // ---- HiGHS: wait for the LP optimum (the caller resumes with it, or with nothing) ------
  const ext = yield { stage: "await-seeds" };
  let highs = null;
  if (ext?.log?.length) for (const line of ext.log) if (log.length < 4000) log.push(line);
  if (ext?.highs) highs = ext.highs;
  if (split && highs?.ok && highs.sizes) {
    const share = highs.sizes.bessMw > 1e-6 ? (highs.sizes.bessWindSiteMw || 0) / highs.sizes.bessMw : vars.bessWindShare.value;
    highs = { ...highs, sizes: { ...highs.sizes, bessWindShare: share } };
  }
  if (ext?.error) {
    highs = { ok: false, error: ext.error };
    L("highs", `HiGHS unavailable (${ext.error}); continuing with the search results only`);
  }

  // ---- stage 2: the 25-year tariff is the objective ------------------------------------
  let tariffRanked = null;
  if (tariffMode) {
    const tlog = (tag, r) => L("tariff", `${tag}${fmtSizes(r.sizes)} → 25-yr tariff ₹${r.tariff.toFixed(4)}/kWh · lowest yearly DFR ${(r.minDfr * 100).toFixed(2)}% (year ${r.worstYear})${r.feasible ? "" : " ✗ misses DFR"} · aug capex ₹${Math.round(r.augCapexCr)} cr`, { sizes: r.sizes, tariff: r.tariff, dfr: r.minDfr, feasible: r.feasible });
    // shortlist: refine results + best screening designs, including ones just below the target
    // (the screening envelope is conservative, the yearly check may accept them)
    const mixKey = (z) => KEYS.map((k) => z[k]).join("|");
    const highsDesigns = [];
    if (highs?.ok && highs.sizes) {
      const free = KEYS.filter((k) => !vars[k].locked);
      const combos = [{}];
      for (const k of free) {
        const st = vars[k].step || 1;
        const lo = snap(Math.floor(highs.sizes[k] / st) * st, vars[k]);
        const hi = snap(Math.ceil(highs.sizes[k] / st) * st, vars[k]);
        const next = [];
        for (const c of combos) for (const v of new Set([lo, hi])) next.push({ ...c, [k]: v });
        combos.splice(0, combos.length, ...next);
      }
      for (const c of combos) {
        const sizes = { ...Object.fromEntries(KEYS.map((k) => [k, vars[k].locked ? vars[k].value : highs.sizes[k]])), ...c };
        highsDesigns.push({ sizes });
      }
      const rs = (v) => (Number.isFinite(v) ? `₹${v.toFixed(4)}` : "n/a");
      L("highs", `HiGHS LP optimum ${fmtSizes(highs.sizes)} (linearised tariff ${rs(highs.tariff)}/kWh, proven lower bound ${rs(highs.lowerBound)}); pricing its ${highsDesigns.length} rounded neighbours with the exact 25-year model`);
    }
    const pool = [...highsDesigns, ...results, ...[...cache.values()].filter((e) => !e.durationViolation && e.dfrCheck >= model.dfrTarget - 0.02).sort((a, b) => a.score - b.score)];
    const shortlist = [];
    for (const e of pool) {
      if (shortlist.length >= 40) break;
      if (!shortlist.some((x) => mixKey(x.sizes) === mixKey(e.sizes))) shortlist.push(e);
    }
    L("tariff", `Solving the 25-year tariff (target equity IRR ${(model.fin.targetEquityIrr * 100).toFixed(1)}%) for ${shortlist.length} shortlisted designs; DFR must hold in every year`);
    let tbest = null;
    shortlist.forEach((e, i) => {
      const r = tariffAt(e.sizes);
      tlog(`#${i + 1}: `, r);
      if (!tbest || r.score < tbest.score) tbest = r;
      if (onProgress && i % 4 === 0) onProgress({ stage: "tariff", done: i + 1, total: shortlist.length, evals });
    });
    L("tariff", `Best of the shortlist: ${fmtSizes(tbest.sizes)} at ₹${tbest.tariff.toFixed(4)}/kWh`);
    // pattern search on the tariff itself
    const free = KEYS.filter((k) => !vars[k].locked);
    const steps = Object.fromEntries(free.map((k) => [k, vars[k].step * 4]));
    for (let guard = 0; guard < 200; guard += 1) {
      let moved = false;
      for (const k of free) {
        for (const dir of [1, -1]) {
          const next = { ...tbest.sizes, [k]: snap(tbest.sizes[k] + dir * steps[k], vars[k]) };
          if (next[k] === tbest.sizes[k]) continue;
          const r = tariffAt(next);
          if (r.score < tbest.score - 1e-9) {
            L("tariff", `Refine: ${k} ${tbest.sizes[k]} → ${next[k]} · tariff ₹${tbest.tariff.toFixed(4)} → ₹${r.tariff.toFixed(4)} · lowest yearly DFR ${(r.minDfr * 100).toFixed(2)}%`);
            tbest = r;
            moved = true;
          }
        }
      }
      if (onProgress && guard % 3 === 0) onProgress({ stage: "tariff", done: tariffEvals, total: tariffEvals + 20, evals });
      if (!moved) {
        let any = false;
        for (const k of free) if (steps[k] > vars[k].step) { steps[k] = Math.max(vars[k].step, steps[k] / 2); any = true; }
        if (!any) break;
      }
    }
    // neighbourhood check on the tariff
    const walkFree = free.filter((k) => k !== "bessWindShare");
    for (let round = 1; round <= 3; round += 1) {
      const combos = [];
      const walk = (i, cur) => {
        if (i === walkFree.length) { combos.push(cur); return; }
        for (let d = -2; d <= 2; d += 1) walk(i + 1, { ...cur, [walkFree[i]]: snap(tbest.sizes[walkFree[i]] + d * vars[walkFree[i]].step * 2, vars[walkFree[i]]) });
      };
      walk(0, { ...tbest.sizes });
      if (split) {
        for (let v = vars.bessWindShare.min; v <= vars.bessWindShare.max + 1e-9; v += vars.bessWindShare.step) combos.push({ ...tbest.sizes, bessWindShare: snap(v, vars.bessWindShare) });
      }
      const before = tariffEvals;
      let better = null;
      for (const c of combos) {
        const r = tariffAt(c);
        if (r.score < tbest.score - 1e-9) { better = r; tbest = r; }
      }
      L("verify", better
        ? `Tariff neighbourhood check ${round} (${combos.length} designs, ±${free.map((k) => `${k} ${vars[k].step * 4}`).join(", ")}; ${tariffEvals - before} new): cheaper design adopted: ${fmtSizes(tbest.sizes)} at ₹${tbest.tariff.toFixed(4)}`
        : `Tariff neighbourhood check ${round} (${combos.length} designs; ${tariffEvals - before} new): no lower tariff nearby; the answer is a local optimum of the 25-year tariff ✓`);
      if (!better) break;
    }
    tariffRanked = [...tcache.values()].filter((r) => r.feasible).sort((a, b) => a.tariff - b.tariff);
    if (highs?.ok) {
      const onGrid = highsDesigns.map((d) => tariffAt(d.sizes)).sort((a, b) => a.score - b.score)[0];
      if (onGrid && Number.isFinite(highs.tariff)) L("highs", `Exact model at the rounded HiGHS design ${fmtSizes(onGrid.sizes)}: ₹${onGrid.tariff.toFixed(4)}/kWh (LP estimate ₹${highs.tariff.toFixed(4)}; difference ₹${(onGrid.tariff - highs.tariff).toFixed(4)} from rounding, tax-loss timing and interpolated years)`);
    }
    const finalEv = evalAt(tbest.sizes);
    best = { ...finalEv, tariff: tbest.tariff, minLifetimeDfr: tbest.minDfr, worstYear: tbest.worstYear, feasible: tbest.feasible, durationViolation: finalEv.durationViolation, score: tbest.score };
    L("result", `25-year tariff optimum: ${fmtSizes(best.sizes)} · ₹${tbest.tariff.toFixed(4)}/kWh for ${(model.fin.targetEquityIrr * 100).toFixed(1)}% equity IRR · lowest yearly DFR ${(tbest.minDfr * 100).toFixed(2)}% in year ${tbest.worstYear} · ${tariffEvals} full 25-year models in ${(tariffMs / 1000).toFixed(2)} s (${(tariffMs / Math.max(1, tariffEvals)).toFixed(1)} ms each)`, { sizes: best.sizes, tariff: tbest.tariff });
  }

  // independent re-check of the winner: fresh dispatch of year 1 (and the degraded envelope)
  const y1 = simulate(ctx, best.sizes);
  const worst = model.designCheck === "lifetime" ? simulate(ctx, best.sizes, model.worstFactors) : null;
  const ms = Date.now() - started;
  L("result", `Best: ${fmtSizes(best.sizes)} · ${best.tariff ? `25-yr tariff ₹${best.tariff.toFixed(4)}/kWh · ` : ""}LCOE ₹${best.lcoe.toFixed(4)}/kWh · capex ₹${Math.round(best.capexCr)} cr`, { sizes: best.sizes, lcoe: best.lcoe, dfr: best.dfrCheck });
  L("result", `Re-check: year-1 DFR ${(y1.dfr * 100).toFixed(3)}%${worst ? `, degraded-year DFR ${(worst.dfr * 100).toFixed(3)}%` : ""}, lowest month ${(y1.minMonthlyDfr * 100).toFixed(2)}% → ${best.feasible && !best.durationViolation ? "meets" : "does NOT meet"} the ${(model.dfrTarget * 100).toFixed(1)}% target`);
  L("result", `Work: ${evals} unique designs (${cacheHits} repeat look-ups served from cache), ${evals * simsPerEval} full-year dispatches = ${((evals * simsPerEval * HOURS) / 1e6).toFixed(1)} million simulated hours in ${(simMs / 1000).toFixed(2)} s (${((simMs / Math.max(1, evals * simsPerEval))).toFixed(2)} ms per dispatch); total ${(ms / 1000).toFixed(2)} s`);
  return {
    log: log.sort((a, b) => a.t - b.t), // HiGHS lines carry their own times
    stats: { evals, cacheHits, dispatches: evals * simsPerEval + tariffEvals * (model.fin.years || 25), simulatedHours: (evals * simsPerEval + tariffEvals * (model.fin.years || 25)) * HOURS, simMs: Math.round(simMs + tariffMs), ms, gridPoints: solarGrid.length * windGrid.length, starts: starts.length, tariffEvals, tariffMs: Math.round(tariffMs) },
    tariffRanked: tariffRanked ? tariffRanked.slice(0, 12).map(({ deliveredMwh, exportMwh, ...r }) => r) : null,
    tariffMap,
    highs,
    best,
    feasible: Boolean(best?.feasible && !best?.durationViolation),
    alternatives,
    cloud,
    evals,
    ms,
  };
}

/**
 * Run the optimizer to completion. `external` is what the caller would resume the
 * "await-seeds" step with ({ highs, log } from a HiGHS run, or { error }); null = search only.
 */
export function optimize(ctx, model, onProgress, external = null) {
  const it = optimizeSteps(ctx, model, onProgress);
  let r = it.next();
  while (!r.done) r = it.next(r.value.stage === "await-seeds" ? external : undefined);
  return r.value;
}

/** Request body for the engine's HiGHS sizing LP (/api/rtc/lp). */
export function highsPayload(ctx, model, seed) {
  const round = (arr, d) => Array.from(arr, (v) => Math.round(v * 10 ** d) / 10 ** d);
  const vars = {};
  for (const k of VAR_KEYS) {
    const v = model.vars[k];
    vars[k] = { locked: Boolean(v.locked), value: v.value, min: Math.min(v.min, v.max), max: Math.max(v.min, v.max), step: v.step };
  }
  return {
    ctx: {
      demand: round(ctx.demand, 4),
      solarCf: round(ctx.solarCf, 6),
      windCf: round(ctx.windCf, 6),
      plantMw: ctx.plantMw,
      lossPct: ctx.lossPct || 0,
      trafoLossPct: ctx.trafoLossPct || 0,
      lineLossPct: ctx.lineLossPct || 0,
      sellSurplus: Boolean(ctx.sellSurplus),
      extraExportMw: ctx.extraExportMw || 0,
    },
    bess: model.bess,
    costs: model.costs,
    fin: model.fin,
    dfrTarget: model.dfrTarget,
    dfrBasis: model.dfrBasis,
    vars,
    seed: seed || null,
    tariffGuess: seed?.tariff || null,
    ...(ctx.sites?.split ? { sites: { split: true } } : {}),
  };
}

// ---------------------------------------------------------------- 25-year financial model

export function irr(flows) {
  const npv = (r) => flows.reduce((s, cf, i) => s + cf / (1 + r) ** i, 0);
  let lo = -0.99;
  let hi = 1.5;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || fLo * fHi > 0) return NaN;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (fm * fLo > 0) { lo = mid; fLo = fm; } else hi = mid;
    if (hi - lo < 1e-9) break;
  }
  return (lo + hi) / 2;
}

export function npvAt(rate, flows) {
  return flows.reduce((s, cf, i) => s + cf / (1 + rate) ** i, 0);
}

/** Simulate every PPA year (degradation, augmentation, demand growth). */
export function simulateLifetime(ctx, sizes, fin, bess) {
  const years = fin.years || 25;
  const out = [];
  for (let y = 1; y <= years; y += 1) {
    const f = yearFactors(y, fin, bess);
    const r = simulate(ctx, sizes, f);
    out.push({ year: y, ...f, ...r, hourly: undefined });
  }
  return out;
}

/** The debt schedule's settings, checked: the method, grace, instalments, refinancing. */
export function debtTerms(fin, years) {
  const tenor = Math.min(years, Math.max(1, Math.round(fin.tenorYears)));
  const grace = Math.min(tenor - 1, Math.max(0, Math.round(fin.graceYears || 0)));
  const q = [1, 2, 4, 12].includes(Number(fin.paymentsPerYear)) ? Number(fin.paymentsPerYear) : 1;
  const method = REPAYMENT_METHODS[fin.repayment] ? fin.repayment : "equal";
  const refiYear = Math.round(fin.refiYear || 0);
  const refi = refiYear > 0 && refiYear < tenor;
  const refiEnd = refi ? Math.min(years, refiYear + Math.max(1, Math.round(fin.refiTenorYears || 1))) : tenor;
  return {
    tenor, grace, q, method,
    // instalments within the year pay down the balance before the year end: the interest is on the
    // average balance, (q − 1) / 2q of the year's principal less (not for sculpting: the sculpted
    // principal is set from the cash flow after tax, which the interest feeds)
    adj: method === "sculpted" ? 0 : (q - 1) / (2 * q),
    refi, refiYear, refiEnd,
    refiRate: refi ? fin.refiRate || 0 : fin.interestRate,
    refiFeePct: refi ? fin.refiFeePct || 0 : 0,
    targetDscr: Math.max(1, fin.targetDscr || 1.3),
    balloonPct: method === "bullet" ? 1 : Math.min(1, Math.max(0, fin.balloonPct || 0)),
    stepUp: Math.max(0, fin.stepUpPct || 0),
    dsraMonths: Math.max(0, fin.dsraMonths || 0),
  };
}

/** The principal of year y under the method, from the opening balance and the years left (n). */
export function principalOf(method, opening, n, rate, interestOpen, { balloon = 0, stepUp = 0, cfads = 0, targetDscr = 1.3 } = {}) {
  if (!(opening > 1e-9) || n < 1) return 0;
  if (n === 1) return opening; // the last year clears the balance under every method
  switch (method) {
    case "annuity": return Math.min(opening, opening * crf(rate, n) - interestOpen);
    case "sculpted": return Math.min(opening, Math.max(0, cfads / targetDscr - interestOpen));
    case "balloon": case "bullet": return Math.min(opening, Math.max(0, (opening - balloon) / (n - 1)));
    case "stepUp": return Math.min(opening, stepUp > 0 ? (opening * stepUp) / ((1 + stepUp) ** n - 1) : opening / n);
    default: return opening / n;
  }
}

// ---------------------------------------------------------------- finance v3 helpers

/** An ISO date moved by months (and days); null in, null out. */
export function shiftDate(iso, months, days = 0) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Internal rate of return of dated flows [{ date, amount }] (annual compounding on day fractions). */
export function xirr(flows) {
  const fl = flows.filter((f) => f && Number.isFinite(f.amount) && f.date);
  if (fl.length < 2) return NaN;
  const t0 = new Date(`${fl[0].date}T00:00:00Z`).getTime();
  const ts = fl.map((f) => (new Date(`${f.date}T00:00:00Z`).getTime() - t0) / (365 * 86400e3));
  const npv = (r) => fl.reduce((s, f, i) => s + f.amount / (1 + r) ** ts[i], 0);
  let lo = -0.99;
  let hi = 1.5;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || fLo * fHi > 0) return NaN;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (fm * fLo > 0) { lo = mid; fLo = fm; } else hi = mid;
    if (hi - lo < 1e-9) break;
  }
  return (lo + hi) / 2;
}

/** Modified IRR of yearly flows: the outflows financed at one rate, the inflows reinvested at another. */
export function mirr(flows, financeRate, reinvestRate) {
  const n = flows.length - 1;
  if (n < 1) return NaN;
  let pvNeg = 0;
  let fvPos = 0;
  flows.forEach((cf, i) => {
    if (cf < 0) pvNeg += cf / (1 + financeRate) ** i;
    else fvPos += cf * (1 + reinvestRate) ** (n - i);
  });
  if (!(pvNeg < 0) || !(fvPos > 0)) return NaN;
  return (fvPos / -pvNeg) ** (1 / n) - 1;
}

/** The share of year y the parts of the plant run (capacity weighted); 1 without part commissioning. */
export function operatingFactor(y, parts) {
  if (!Array.isArray(parts) || !parts.length) return 1;
  let f = 0;
  for (const p of parts) {
    const o = Number(p.offsetMonths) || 0;
    const lo = y === 1 ? o : Math.max(12 * (y - 1), o);
    const months = Math.max(0, 12 * y - lo);
    f += (Number(p.share) || 0) * (months / 12);
  }
  return f;
}

/** Thin capitalisation and loss carry-forward: the year's tax from the pools carried in; pure. */
function taxYear(fin, pools, y, { income, seniorInterest, otherInterest, fees, shInterest, taxDep }) {
  const thin = Math.max(0, fin.thinCapPct || 0);
  const intPool = pools.intPool.filter((e) => y - e.year <= 8); // disallowed interest lapses after eight years
  const carriedIn = intPool.reduce((a, e) => a + e.amt, 0);
  // the allowance goes to the interest carried in first (it lapses sooner), then to this year's;
  // interestDisallowed is this year's interest not allowed, the pool what is carried out
  let allowedSh = shInterest + carriedIn;
  if (thin > 0) allowedSh = Math.min(shInterest + carriedIn, thin * Math.max(0, income));
  let left = allowedSh;
  const newIntPool = [];
  for (const e of intPool) {
    const use = Math.min(e.amt, left);
    left -= use;
    if (e.amt - use > 1e-12) newIntPool.push({ year: e.year, amt: e.amt - use });
  }
  const interestDisallowed = Math.max(0, shInterest - left);
  if (interestDisallowed > 1e-12) newIntPool.push({ year: y, amt: interestDisallowed });
  let taxable = income - seniorInterest - otherInterest - fees - allowedSh - taxDep;
  // losses: unabsorbed depreciation never lapses; business losses lapse after lossCarryYears
  const limit = fin.lossCarryYears > 0 ? Math.round(fin.lossCarryYears) : null;
  let lossPool = (limit ? pools.lossPool.filter((e) => y - e.year <= limit) : pools.lossPool).map((e) => ({ ...e })); // copied: the function is called more than once a year
  let depPool = pools.depPool;
  let lossSetOff = 0;
  let depSetOff = 0;
  if (taxable > 0) {
    for (const e of lossPool) {
      if (taxable <= 0) break;
      const use = Math.min(e.amt, taxable);
      e.amt -= use;
      taxable -= use;
      lossSetOff += use;
    }
    lossPool = lossPool.filter((e) => e.amt > 1e-12);
    if (taxable > 0 && depPool > 0) {
      depSetOff = Math.min(depPool, taxable);
      depPool -= depSetOff;
      taxable -= depSetOff;
    }
  } else if (taxable < 0) {
    const loss = -taxable;
    const dep = Math.min(taxDep, loss); // the loss is depreciation first (unabsorbed depreciation)
    depPool += dep;
    if (loss - dep > 0) lossPool.push({ year: y, amt: loss - dep });
    taxable = 0;
  }
  return {
    tax: taxable * fin.taxRate, taxable, lossSetOff, depSetOff, interestDisallowed,
    pools: { lossPool, depPool, intPool: newIntPool },
    lossCarried: lossPool.reduce((a, e) => a + e.amt, 0), depCarried: depPool, interestCarried: newIntPool.reduce((a, e) => a + e.amt, 0),
  };
}

function cashflows(ops, sizes, costs, fin, bess, dfrTarget, tariff) {
  const years = fin.years || 25; // the PPA years
  const extYears = Math.max(0, Math.round(fin.extension?.years || 0));
  const T = years + extYears; // the model's years
  const capex = capexCr(sizes, costs, fin);
  const mezz0 = Math.max(0, fin.mezz?.amountCr || 0);
  const quasi0 = Math.max(0, fin.quasi?.amountCr || 0);
  const debt0 = capex.debt0 ?? (capex.total - capex.fees) * fin.debtFraction;
  const equity0 = capex.total - debt0 - mezz0 - quasi0;
  const aug = augmentationScheduleCr(sizes, costs, bess, years);
  const dt = debtTerms(fin, years);
  const bookBase = capex.total * (1 - fin.salvagePct);
  const bookLife = fin.bookLifeYears;
  const cod = fin.codDate || null;
  const nominalCod = cod || "2028-01-01"; // the lender's dated flows when no COD is given
  // finance v3 settings
  const parts = Array.isArray(fin.parts) && fin.parts.length ? fin.parts : null;
  const genFactor = fin.generationCase && fin.generationCase !== "p50" ? (fin.caseFactors?.[fin.generationCase] ?? 1) : 1;
  const carbon = fin.carbon?.enabled ? fin.carbon : null;
  const ext = extYears > 0 ? fin.extension : null;
  const extTariff = ext ? (ext.tariffRsPerKwh ?? fin.surplusPrice ?? 0) : 0;
  const extDeg = ext ? (ext.degradation ?? fin.solarDegradation ?? 0) : 0;
  const extCapex = ext ? Math.max(0, ext.capexCr || 0) : 0;
  const rp = fin.repower && fin.repower.year > 0 && fin.repower.year <= T ? fin.repower : null;
  const stepDown = fin.rateStepDown && fin.rateStepDown.afterYears > 0 ? fin.rateStepDown : null;
  const topUp = fin.topUp && fin.topUp.year > 0 && fin.topUp.year < dt.tenor ? fin.topUp : null;
  const prepayPct = Math.max(0, fin.prepaymentPct || 0);
  const sweep = fin.sweep && fin.sweep.pct > 0 ? fin.sweep : null;
  const mz = mezz0 > 0 ? { ...fin.mezz, tenor: Math.min(T, Math.max(1, Math.round(fin.mezz.tenorYears || 1))), grace: Math.max(0, Math.round(fin.mezz.graceYears || 0)) } : null;
  const qs = quasi0 > 0 ? fin.quasi : null;
  const guarantees = (fin.guarantees || []).filter((g) => (g.amountCr || 0) > 0);
  const lives = fin.lives || null;
  const bookWdv = fin.bookDepreciation === "wdv";
  const bookWdvRate = fin.bookWdvRate ?? fin.wdvRate;
  const holdcoExp = Math.max(0, fin.holdco?.expensesCrPerYear || 0);
  // O&M by source (the sum is the old omBase × escalation when nothing is split)
  const omSplit = fin.solarOmEscalation != null || fin.windOmEscalation != null || fin.bessOmEscalation != null || (fin.windOmComponents || []).length > 0;
  const windComps = (fin.windOmComponents || []).filter((c) => (c.lakhPerMw || 0) > 0);
  const om0 = {
    solar: (sizes.solarMw * fin.solarOmLakhPerMw) / 100,
    wind: windComps.length ? windComps.reduce((a, c) => a + (sizes.windMw * c.lakhPerMw) / 100, 0) : (sizes.windMw * fin.windOmLakhPerMw) / 100,
    bess: (sizes.bessMwh * fin.bessOmLakhPerMwh) / 100,
    biomass: ((sizes.biomassMw || 0) * (fin.biomassOmLakhPerMw || 0)) / 100,
  };
  const omBase = omCr(sizes, fin);
  const escOf = (rate, y) => (1 + (rate ?? fin.omEscalation)) ** (y - 1);
  const otherLines = (fin.otherFixedLines || []).filter((l) => (l.crPerYear || 0) > 0);
  // the asset register: the gross block by component, the book lives
  const hardShare = (k) => (capex.hard > 0 ? capex.byComponent[k] / capex.hard : 0);
  const regKeys = ["solar", "wind", "bess", "pcs", "evac", "other"];
  const lifeOf = (k) => (lives ? Math.max(1, Math.round(lives[k === "pcs" ? "bess" : k] || bookLife)) : bookLife);
  const gross = Object.fromEntries(regKeys.map((k) => [k, capex.byComponent[k]]));
  gross.preop = capex.preop; gross.idc = capex.idc; gross.fees = capex.fees + capex.bridgeFee;
  const accDepBy = Object.fromEntries(Object.keys(gross).map((k) => [k, 0]));
  // the extension capex depreciated straight line over the extension; the repowering over the book life left
  const rpBookYears = rp ? Math.max(1, bookLife - rp.year + 1) : 0;
  let augBookDep = 0;
  let extAugDep = 0; // depreciation of the extension capex
  let bookWdvBlock = capex.total;
  let taxWdvBlock = capex.total;
  let pools = { lossPool: [], depPool: 0, intPool: [] };
  let debt = debt0;
  let balloonBase = debt0; // the balance the balloon share applies to: the debt, or the balance refinanced
  let mezzBal = mezz0;
  let quasiBal = quasi0;
  let quasiAccrued = 0;
  let sweepAccrued = 0;
  let prevWc = 0;
  let prevMargin = 0;
  let retained = 0;
  let cumEquity = -equity0;
  let payback = null;
  const rows = [];
  const equityFlows = [-equity0];
  const projectFlows = [-capex.total];
  const preTaxEquityFlows = [-equity0];
  const preTaxProjectFlows = [-capex.total];
  const holdcoFlows = [-(equity0 + quasi0)];
  const lenderYearly = [-debt0];
  const lenderFlows = [];
  if (capex.construction) {
    const M = capex.construction.months;
    for (const r of capex.construction.rows) if (r.debt > 0) lenderFlows.push({ date: shiftDate(nominalCod, r.month - M - 1), amount: -r.debt, kind: "draw" });
  } else lenderFlows.push({ date: nominalCod, amount: -debt0, kind: "draw" });
  // the yearly loop; dsraInterestIn: the reserve's interest by year from the previous pass (0 first)
  const yearLoop = (dsraInterestIn) => {
    rows.length = 0;
    equityFlows.length = 1; projectFlows.length = 1; preTaxEquityFlows.length = 1; preTaxProjectFlows.length = 1; holdcoFlows.length = 1; lenderYearly.length = 1;
    lenderFlows.length = capex.construction ? capex.construction.rows.filter((r) => r.debt > 0).length : 1;
    augBookDep = 0; extAugDep = 0; bookWdvBlock = capex.total; taxWdvBlock = capex.total;
    pools = { lossPool: [], depPool: 0, intPool: [] };
    debt = debt0; balloonBase = debt0; mezzBal = mezz0; quasiBal = quasi0; quasiAccrued = 0; sweepAccrued = 0;
    prevWc = 0; prevMargin = 0; retained = 0; cumEquity = -equity0; payback = null;
    for (const k of Object.keys(accDepBy)) accDepBy[k] = 0;
    // the asset register starts again each pass (the reserve's interest runs the years more than once)
    for (const k of regKeys) gross[k] = capex.byComponent[k];
    let cumAug = 0;
    for (let y = 1; y <= T; y += 1) {
      const inPpa = y <= years;
      const op0 = ops[Math.min(y, years) - 1];
      // finance v3: the operating factor (part commissioning), the generation case, the extension
      const opFactor = operatingFactor(y, parts);
      const fade = inPpa ? 1 : (1 - extDeg) ** (y - years);
      const k = genFactor * opFactor * fade;
      const solarShare = (op0.solarGenMWh || 0) + (op0.windGenMWh || 0) > 0 ? (op0.solarGenMWh || 0) / ((op0.solarGenMWh || 0) + (op0.windGenMWh || 0)) : 1;
      const uplift = rp && y > rp.year ? solarShare * (rp.upliftPct || 0) : 0;
      const op = k === 1 && uplift === 0 && inPpa ? op0 : {
        ...op0,
        deliveredMWh: op0.deliveredMWh * k * (1 + uplift),
        excessMWh: (op0.excessMWh || 0) * k * (1 + uplift),
        buyerExcessMWh: (op0.buyerExcessMWh || 0) * k * (1 + uplift),
        demandMWh: op0.demandMWh * opFactor,
        dfr: genFactor !== 1 || fade !== 1 || uplift ? Math.min(op0.dfr * genFactor * fade * (1 + uplift), 1) : op0.dfr,
        solarGenMWh: (op0.solarGenMWh || 0) * k * (1 + uplift),
        windGenMWh: (op0.windGenMWh || 0) * k,
        curtailMWh: (op0.curtailMWh || 0) * k,
        biomassMWh: (op0.biomassMWh || 0) * opFactor,
        ...(Number.isFinite(op0.surplusRevenueCr) ? { surplusRevenueCr: op0.surplusRevenueCr * k * (1 + uplift) } : {}),
        ...(op0.evac ? { evac: Object.fromEntries(Object.entries(op0.evac).map(([n, v]) => [n, typeof v === "number" && n.endsWith("MWh") ? v * k * (1 + uplift) : v])) } : {}),
        ...Object.fromEntries((costs.plants || []).map((pl) => [`${pl.id}MWh`, (op0[`${pl.id}MWh`] || 0) * opFactor])),
        ...(inPpa ? {} : { blockShortfallMWh: 0, penaltyWeeks: [], dsmChargeCr: 0, dsmA: 0, dsmB: 0, chargingCostCr: 0, pxFeesCr: 0, lcMw: 0, buyerExcessMWh: 0, buyerExcessShare: 0 }),
      };
      const repowerUplift = uplift ? op0.deliveredMWh * k * uplift : 0;
      const trf = inPpa ? tariff * (1 + fin.tariffEscalation) ** (y - 1) : extTariff;
      // in the extension every unit (the PPA's and the surplus) sells at the extension price
      const energyRev = (inPpa ? op.deliveredMWh : op.deliveredMWh + (op.excessMWh || 0)) * trf * RS_CR_PER_MWH_AT_1RS;
      // op.surplusRevenueCr: surplus sold at hourly market prices (Tender to Bid, IEX); else a flat price
      const surplusRev = inPpa && fin.sellSurplus ? (op.surplusRevenueCr ?? op.excessMWh * fin.surplusPrice * RS_CR_PER_MWH_AT_1RS) : 0;
      // SECI FDRE-RTC-V (Amendment-03): the Solar Hours excess the buyer takes at a share of the year's tariff
      const buyerRev = inPpa && fin.sellSurplus ? (op.buyerExcessMWh || 0) * (op.buyerExcessShare || 0) * trf * RS_CR_PER_MWH_AT_1RS : 0;
      const shortfallMWh = inPpa ? Math.max(0, dfrTarget * op.demandMWh - op.deliveredMWh) : 0;
      const annualPenalty = shortfallMWh * (fin.shortfallPenalty || 0) * RS_CR_PER_MWH_AT_1RS;
      // time-block floors (SECI RTC-TM): energy short of each block's floor, at a multiple of the
      // year's tariff (1.5x); 0 when the sizing has no block floors
      const blockShortfallMWh = op.blockShortfallMWh || 0;
      const blockPenalty = blockShortfallMWh * (fin.blockPenaltyMultiple || 0) * trf * RS_CR_PER_MWH_AT_1RS;
      // SECI CfD-I (web/src/cfd/finance.js): the weekly shortfall penalty, 1.5 × (the week's reference
      // price − the strike price) on the energy short beyond the tolerance, week by week; 0 elsewhere
      const cfdPenalty = (op.penaltyWeeks || []).reduce((a, w) => a + (fin.cfdPenaltyMultiple || 0) * Math.max(0, w.ref - trf) * w.beyondMwh, 0) * RS_CR_PER_MWH_AT_1RS;
      const penalty = annualPenalty + blockPenalty + cfdPenalty;
      // finance v3: carbon credits on the energy generated, for the first years
      const carbonRevenue = carbon && y <= (carbon.years || 0)
        ? ((op.deliveredMWh + (op.excessMWh || 0)) * (carbon.tPerMwh || 0) * (carbon.pricePerT || 0) * (1 + (carbon.escalation || 0)) ** (y - 1)) / 1e7 : 0;
      const revenue = energyRev + surplusRev + buyerRev - penalty + carbonRevenue;
      const esc = (1 + fin.omEscalation) ** (y - 1);
      const omFactor = (inPpa ? 1 : (ext.omFactor ?? 1)) * opFactor;
      // O&M by source, each escalating at its own rate (finance v3); the wind by component
      const windOmComponents = windComps.map((c) => (sizes.windMw * c.lakhPerMw) / 100 * escOf(c.escalation ?? fin.windOmEscalation, y) * omFactor);
      let omBy;
      if (omSplit) {
        omBy = {
          solar: om0.solar * escOf(fin.solarOmEscalation, y) * omFactor,
          wind: windComps.length ? windOmComponents.reduce((a, b) => a + b, 0) : om0.wind * escOf(fin.windOmEscalation, y) * omFactor,
          bess: om0.bess * escOf(fin.bessOmEscalation, y) * omFactor,
          biomass: om0.biomass * esc * omFactor,
        };
      } else {
        const omAll = omBase * esc * omFactor;
        const sum = om0.solar + om0.wind + om0.bess + om0.biomass;
        omBy = Object.fromEntries(Object.entries(om0).map(([n, v]) => [n, sum > 0 ? (omAll * v) / sum : 0]));
      }
      const om = omSplit ? omBy.solar + omBy.wind + omBy.bess + omBy.biomass : omBase * esc * omFactor;
      const insurance = capex.hard * fin.insurancePct;
      // other fixed costs: one line, or the split lines each with its own escalation (finance v3)
      const otherLinesCr = otherLines.map((l) => (l.crPerYear || 0) * escOf(l.escalation, y) * (inPpa ? 1 : (ext.omFactor ?? 1)));
      const other = otherLines.length ? otherLinesCr.reduce((a, b) => a + b, 0) : (fin.otherFixedCr || 0) * esc * (inPpa ? 1 : (ext.omFactor ?? 1));
      // biomass fuel (Tender to Bid): Rs/kWh of biomass generation, escalating; 0 for Round the clock
      const fuel = (op.biomassMWh || 0) * (fin.biomassFuelRsPerKwh || 0) * (1 + (fin.biomassFuelEscalation || 0)) ** (y - 1) * RS_CR_PER_MWH_AT_1RS;
      // dispatchable plants (Tender to Bid): fixed charge per MW and energy cost per kWh (RECs for
      // non-RE), each escalating at the plant's rate; none for Round the clock
      const plantCost = {};
      let plantsTotal = 0;
      for (const pl of costs.plants || []) {
        const escP = (1 + (pl.escalation || 0)) ** (y - 1);
        const fixed = ((sizes[`${pl.id}Mw`] || 0) * (pl.fixedLakhPerMw || 0)) / 100 * escP;
        const energy = (op[`${pl.id}MWh`] || 0) * ((pl.energyRsPerKwh || 0) + (pl.recRsPerKwh || 0)) * escP * RS_CR_PER_MWH_AT_1RS;
        plantCost[`${pl.id}Cost`] = fixed + energy;
        plantCost[`${pl.id}Mu`] = (op[`${pl.id}MWh`] || 0) / 1000;
        plantsTotal += fixed + energy;
      }
      // DSM (CERC deviation settlement, web/src/dsm/dsm.js): the year's charges on the forecast
      // error, a line in the year's tariff on the energy scheduled (what reaches the meter); a cost
      // of operation. op.dsmChargeCr: given outright
      const scheduledMWh = op.deliveredMWh + (op.excessMWh || 0) + (op.buyerExcessMWh || 0);
      const dsm = op.dsmChargeCr ?? (scheduledMWh * ((op.dsmA || 0) * trf + (op.dsmB || 0))) / 1e7;
      // SECI CfD-I: the power bought to charge the battery (green market, group RE), the exchange
      // fees on the energy sold, and the cost of the Letter of Credit to SECI, which moves with the
      // strike price: LC = 2000 kWh × MW × (C − SP) × 30 days, C at least ₹10/kWh; 0 elsewhere
      const charging = op.chargingCostCr || 0;
      const pxFees = op.pxFeesCr || 0;
      const lcCost = (op.lcMw || 0) > 0 && (fin.lcCostPct || 0) > 0
        ? (fin.lcCostPct * 2000 * op.lcMw * Math.max(0, (fin.lcMinPrice ?? 10) - trf) * (fin.lcDays ?? 30)) / 1e7 : 0;
      const opex = om + insurance + other + fuel + plantsTotal + dsm + charging + pxFees + lcCost;
      const ebitda = revenue - opex;
      // finance v3: the guarantees' fees and margin money, the reserve's and the margin's interest
      let guaranteeFees = 0;
      let marginBalance = 0;
      let marginInterest = 0;
      for (const g of guarantees) {
        const from = Math.max(1, Math.round(g.fromYear || 0));
        const to = Math.round(g.fromYear || 0) + Math.max(1, Math.round(g.years || 1)) - 1;
        if (y >= from && y <= to) {
          guaranteeFees += g.amountCr * (g.feePct || 0);
          const margin = g.amountCr * (g.marginPct || 0);
          marginBalance += margin;
          marginInterest += margin * (g.marginRate || 0);
        }
      }
      const dMargin = marginBalance - prevMargin;
      prevMargin = marginBalance;
      const dsraInterest = dsraInterestIn[y] || 0;
      const otherIncome = dsraInterest + marginInterest;
      // the capex of the year beyond the plant: battery augmentation, the life extension (in the
      // last PPA year), the solar repowering
      const augCapex = aug[y] || 0;
      const extensionCapex = ext && y === years ? extCapex : 0;
      const repowerCapex = rp && y === rp.year ? rp.capexCr || 0 : 0;
      cumAug += augCapex;
      // book depreciation: straight line (by component life when given) and written down, both
      // kept; the augmentation over the remaining life
      if (augCapex > 0) augBookDep += augCapex / Math.max(1, years - y + 1);
      if (extensionCapex > 0) extAugDep += extensionCapex / extYears;
      const extDep = ext && y > years ? extAugDep : 0;
      const rpDep = rp && y >= rp.year && y < rp.year + rpBookYears ? (rp.capexCr || 0) / rpBookYears : 0;
      // with component lives the whole book base (the pre-operative cost, IDC and fees included)
      // sits on the hard assets pro rata, each written off over its own life
      let slmBy;
      if (lives) {
        slmBy = Object.fromEntries(Object.keys(gross).map((kk) => {
          if (!regKeys.includes(kk)) return [kk, 0];
          const life = lifeOf(kk);
          return [kk, y <= life ? (bookBase * hardShare(kk)) / life : 0];
        }));
      }
      const bookDepSlm = (lives ? Object.values(slmBy).reduce((a, b) => a + b, 0) : (y <= bookLife ? bookBase / bookLife : 0)) + augBookDep + extDep + rpDep;
      bookWdvBlock += augCapex + extensionCapex + repowerCapex;
      const bookDepWdv = bookWdvBlock * bookWdvRate;
      bookWdvBlock -= bookDepWdv;
      const bookDep = bookWdv ? bookDepWdv : bookDepSlm;
      // the asset register
      gross.bess += augCapex; gross.other += extensionCapex; gross.solar += repowerCapex;
      const grossBlock = Object.values(gross).reduce((a, b) => a + b, 0);
      if (lives && !bookWdv) {
        for (const kk of Object.keys(gross)) accDepBy[kk] += slmBy[kk];
        accDepBy.bess += augBookDep; accDepBy.other += extDep; accDepBy.solar += rpDep;
      } else for (const kk of Object.keys(gross)) accDepBy[kk] += grossBlock > 0 ? (bookDep * gross[kk]) / grossBlock : 0;
      const accDep = Object.values(accDepBy).reduce((a, b) => a + b, 0);
      const netBlock = grossBlock - accDep;
      // working capital: receivables, O&M in hand and spares, held at the year end; interest on it
      const recv = (revenue * fin.receivableDays) / 365;
      const omStock = (om * (fin.omStockMonths || 0)) / 12;
      const spares = om * (fin.sparesPctOm || 0);
      const wcBalance = recv + omStock + spares;
      const dWc = wcBalance - prevWc;
      prevWc = wcBalance;
      const wcInterest = wcBalance * (fin.wcInterestRate || 0);
      // debt: the balance at the start of the year, this year's terms (refinanced from the year
      // after the refinancing, stepped down after the step-down year), the principal under the
      // method, and the interest
      const opening = debt;
      const phase2 = dt.refi && y > dt.refiYear;
      const rate = phase2 ? dt.refiRate : (stepDown && y > stepDown.afterYears ? (stepDown.rate ?? fin.interestRate) : fin.interestRate);
      const end = phase2 ? dt.refiEnd : dt.tenor;
      const method = phase2 && REPAYMENT_METHODS[fin.refiRepayment] ? fin.refiRepayment : dt.method;
      const adj = method === "sculpted" ? 0 : (dt.q - 1) / (2 * dt.q);
      const n = end - y + 1;
      const repaying = y > dt.grace && y <= end && opening > 1e-9;
      const interestOpen = opening * rate;
      const sculpt = method === "sculpted";
      let principal = 0;
      if (repaying && !sculpt) principal = principalOf(method, opening, n, rate, interestOpen, { balloon: dt.balloonPct * balloonBase, stepUp: dt.stepUp });
      let interest = interestOpen - adj * principal;
      // the mezzanine: interest on the opening balance, principal per its schedule
      const mezzOpening = mezzBal;
      const mezzInterest = mezzOpening * (mz?.rate || 0);
      let mezzPrincipal = 0;
      if (mz && mezzOpening > 1e-9 && y > mz.grace && y <= mz.tenor) mezzPrincipal = mz.repayment === "bullet" ? (y === mz.tenor ? mezzOpening : 0) : mezzOpening / (mz.tenor - y + 1);
      if (mz && y === T) mezzPrincipal = mezzOpening; // whatever is left clears with the project
      mezzBal = mezzOpening - mezzPrincipal;
      const mezzService = mezzInterest + mezzPrincipal;
      // tax depreciation: both bases kept, the chosen one used
      taxWdvBlock += augCapex + extensionCapex + repowerCapex;
      const taxDepWdv = taxWdvBlock * fin.wdvRate;
      taxWdvBlock -= taxDepWdv;
      const taxDepSlm = bookDepSlm;
      const taxDep = fin.taxDepreciation === "wdv" ? taxDepWdv : taxDepSlm;
      // the sculpted principal needs the tax, which needs the interest: worked out first, on the
      // opening balance (no instalment adjustment for sculpting)
      const refiFeeOn = dt.refi && y === dt.refiYear;
      const income = ebitda + otherIncome;
      const taxOf = (intr, fee, shInt) => taxYear(fin, pools, y, { income, seniorInterest: intr, otherInterest: wcInterest, fees: fee + guaranteeFees, shInterest: shInt, taxDep });
      let refiFee = 0;
      if (sculpt && repaying) {
        const t0 = taxOf(interestOpen, 0, mezzInterest);
        const cfads0 = ebitda - t0.tax - dWc - augCapex - wcInterest + otherIncome - guaranteeFees - extensionCapex - repowerCapex;
        principal = principalOf("sculpted", opening, n, rate, interestOpen, { cfads: cfads0, targetDscr: dt.targetDscr });
        interest = interestOpen;
      }
      debt = opening - principal;
      let prepaymentFee = 0;
      if (refiFeeOn) { refiFee = debt * dt.refiFeePct; prepaymentFee += debt * prepayPct; balloonBase = debt; }
      // the cash flow before the sweep, the mezzanine and the quasi-equity
      const t1 = taxOf(interest, refiFee + prepaymentFee, mezzInterest);
      const cfadsOf = (tax) => ebitda - tax - dWc - augCapex - wcInterest + otherIncome - guaranteeFees - extensionCapex - repowerCapex;
      const debtService = interest + principal;
      let fcfeBefore = cfadsOf(t1.tax) - debtService - refiFee - prepaymentFee - mezzService;
      // the cash sweep: a share of the free cash prepays the debt after the scheduled principal;
      // what cannot be paid accrues to the next year
      let sweepCr = 0;
      if (sweep && y >= (sweep.fromYear || 1) && y <= (sweep.toYear || dt.tenor) && debt > 1e-9) {
        const due = sweep.pct * Math.max(0, fcfeBefore) + sweepAccrued;
        sweepCr = Math.min(due, Math.max(0, fcfeBefore), debt);
        sweepAccrued = due - sweepCr;
        debt -= sweepCr;
        prepaymentFee += sweepCr * prepayPct;
      } else if (sweep && debt <= 1e-9) sweepAccrued = 0;
      // the top-up: new senior debt at the end of the year up to the fraction, paid out to equity
      let topUpCr = 0;
      if (topUp && y === topUp.year) {
        topUpCr = Math.max(0, (topUp.debtFraction ?? fin.debtFraction) * capex.total - debt);
        debt += topUpCr;
        balloonBase = debt;
      }
      // the quasi-equity: interest due (and accrued) paid when the senior DSCR clears the lender's
      // floor and the cash allows; the principal from what is left
      const quasiOpening = quasiBal;
      const dscr = debtService > 1e-9 ? cfadsOf(t1.tax) / debtService : null;
      let quasiInterestPaid = 0;
      let quasiRepaid = 0;
      let terminal = 0;
      if (y === T) terminal = capex.total * fin.salvagePct + wcBalance;
      if (qs) {
        const due = quasiOpening * (qs.rate || 0) + quasiAccrued;
        const cash = fcfeBefore - sweepCr - prepaymentFee + (refiFeeOn ? debt * 0 : 0) + (y === T ? terminal - debt : 0);
        const ok = dscr === null || dscr >= (qs.lenderMinDscr || 0);
        if (ok) {
          quasiInterestPaid = Math.min(due, Math.max(0, cash));
          if (y >= (qs.repayFromYear || 1)) quasiRepaid = Math.min(quasiOpening, Math.max(0, cash - quasiInterestPaid));
        }
        quasiAccrued = due - quasiInterestPaid;
        quasiBal = quasiOpening - quasiRepaid;
      }
      // the tax with every deduction of the year (the quasi interest when paid)
      const t = qs || prepaymentFee ? taxOf(interest, refiFee + prepaymentFee, mezzInterest + quasiInterestPaid) : t1;
      pools = t.pools;
      const tax = t.tax;
      const pbt = ebitda + otherIncome - bookDep - interest - wcInterest - refiFee - prepaymentFee - guaranteeFees - mezzInterest - quasiInterestPaid;
      const pat = pbt - tax;
      const cfads = cfadsOf(tax);
      const fscr = debtService > 1e-9 ? (cfads + other + guaranteeFees) / (debtService + other + guaranteeFees) : null;
      const totalDscr = debtService + mezzService > 1e-9 ? cfads / (debtService + mezzService) : null;
      let fcfe = cfads - debtService - refiFee - prepaymentFee - sweepCr - mezzService - quasiInterestPaid - quasiRepaid + topUpCr - dMargin;
      let projectCf = ebitda - Math.max(0, (ebitda - taxDep) * fin.taxRate) - dWc - augCapex - extensionCapex - repowerCapex + otherIncome - guaranteeFees;
      if (y === T) {
        fcfe += terminal - debt;
        projectCf += terminal;
      }
      const dividends = fcfe; // the free cash is paid out each year (negative: equity put in)
      retained += pat - dividends;
      rows.push({
        year: y,
        start: shiftDate(cod, 12 * (y - 1)),
        end: shiftDate(cod, 12 * y, -1),
        phase: inPpa ? "ppa" : "extension",
        opFactor,
        generationFactor: genFactor,
        tariff: trf,
        demandMu: op.demandMWh / 1000,
        // the units billed: generation at the 33 kV bus, the power transformer and line losses on
        // the way to the 220 kV GSS, and what the billing meter records there
        genBusMu: ((op.solarGenMWh || 0) + (op.windGenMWh || 0)) / 1000,
        injectedMu: (op.evac?.injectedMWh ?? 0) / 1000,
        trafoLossMu: (op.evac?.trafoLossMWh ?? 0) / 1000,
        lineLossMu: (op.evac?.lineLossMWh ?? 0) / 1000,
        meterMu: (op.evac?.meterMWh ?? op.deliveredMWh + (op.excessMWh || 0) + (op.buyerExcessMWh || 0)) / 1000,
        deliveredMu: op.deliveredMWh / 1000,
        dfr: op.dfr,
        minMonthlyDfr: op.minMonthlyDfr,
        excessMu: (op.excessMWh + (op.buyerExcessMWh || 0)) / 1000, // sold: in the market and, under SECI Amendment-03, to the buyer
        curtailMu: op.curtailMWh / 1000,
        shortfallMu: shortfallMWh / 1000,
        solarFactor: op.solarFactor,
        bessFactor: op.bessFactor,
        repowerUplift,
        energyRevenue: energyRev,
        surplusRevenue: surplusRev,
        buyerExcessMu: (op.buyerExcessMWh || 0) / 1000,
        buyerRevenue: buyerRev,
        carbonRevenue,
        penalty,
        annualPenalty,
        blockPenalty,
        cfdPenalty,
        blockShortfallMu: blockShortfallMWh / 1000,
        revenue,
        om,
        solarOm: omBy.solar,
        windOm: omBy.wind,
        bessOm: omBy.bess,
        biomassOm: omBy.biomass,
        windOmComponents,
        insurance,
        other,
        otherLines: otherLinesCr,
        fuel,
        biomassMu: (op.biomassMWh || 0) / 1000,
        ...plantCost,
        dsm,
        charging,
        pxFees,
        lcCost,
        opex,
        ebitda,
        guaranteeFees,
        marginBalance,
        dMargin,
        marginInterest,
        dsraInterest,
        otherIncome,
        bookDep,
        bookDepSlm,
        bookDepWdv,
        grossBlock,
        grossBlockByComponent: { ...gross },
        accDep,
        netBlock,
        netBlockByComponent: Object.fromEntries(Object.keys(gross).map((kk) => [kk, gross[kk] - accDepBy[kk]])),
        interest,
        wcInterest,
        refiFee,
        prepaymentFee,
        mezzOpening,
        mezzInterest,
        mezzPrincipal,
        mezzClosing: mezzBal,
        mezzService,
        quasiOpening,
        quasiInterestPaid,
        quasiAccrued,
        quasiRepaid,
        quasiClosing: quasiBal,
        pbt,
        taxDep,
        taxDepSlm,
        taxDepWdv,
        taxableIncome: t.taxable,
        lossSetOff: t.lossSetOff,
        depSetOff: t.depSetOff,
        lossCarried: t.lossCarried,
        depCarried: t.depCarried,
        interestDisallowed: t.interestDisallowed,
        interestCarried: t.interestCarried,
        tax,
        pat,
        receivables: recv,
        omStock,
        spares,
        wcBalance,
        dWc,
        augCapex,
        extensionCapex,
        repowerCapex,
        cfads,
        debtRate: rate,
        openingDebt: opening,
        principal,
        sweepCr,
        sweepAccrued,
        topUpCr,
        closingDebt: debt,
        debtService,
        dscr,
        totalDscr,
        fscr,
        fcfe,
        dividends,
        cumEquity,
        projectCf,
        preTaxEquityCf: fcfe + tax,
        preTaxProjectCf: projectCf + Math.max(0, (ebitda - taxDep) * fin.taxRate),
        shareCapital: equity0,
        retained,
        cwip: 0,
        lenderCf: debtService + sweepCr + refiFee + prepaymentFee - topUpCr,
      });
    }
  };
  // the debt service reserve: months of the next year's debt service (or of the highest year
  // left: 'peak'), built and released from the equity cash (it does not touch the DSCR); its
  // interest is other income, so the years run again until it settles when the rate is set
  const dsraOf = () => {
    const out = new Array(T + 1).fill(0);
    for (let y = 1; y <= T; y += 1) {
      if (y >= T) break;
      if (fin.dsraBasis === "peak") {
        let peak = 0;
        for (let k = y + 1; k <= T; k += 1) peak = Math.max(peak, rows[k - 1].debtService);
        out[y] = (peak * dt.dsraMonths) / 12;
      } else out[y] = (rows[y].debtService * dt.dsraMonths) / 12;
    }
    return out;
  };
  let dsraInterestIn = new Array(T + 1).fill(0);
  yearLoop(dsraInterestIn);
  let dsra = dsraOf();
  const dsraRate = Math.max(0, fin.dsraInterestRate || 0);
  if (dsraRate > 0 && dt.dsraMonths > 0) {
    for (let pass = 0; pass < 4; pass += 1) {
      dsraInterestIn = dsra.map((v, y) => (y > 0 ? (dsra[y - 1] || 0) * dsraRate : 0));
      yearLoop(dsraInterestIn);
      dsra = dsraOf();
    }
  }
  let prevDsra = 0;
  for (let y = 1; y <= T; y += 1) {
    const row = rows[y - 1];
    row.dsraBalance = dsra[y];
    row.dDsra = dsra[y] - prevDsra;
    prevDsra = dsra[y];
    row.fcfe -= row.dDsra;
    row.dividends = row.fcfe;
    row.preTaxEquityCf -= row.dDsra;
    // the balance sheet: the free cash is paid out, so the cash is the balancing figure between the
    // book and the cash timing (small; 0 when the two agree)
    row.retained = (y > 1 ? rows[y - 2].retained : 0) + row.pat - row.fcfe;
    row.cash = (row.shareCapital + row.retained + row.closingDebt + row.mezzClosing + row.quasiClosing + row.quasiAccrued + row.sweepAccrued)
      - (row.netBlock + row.wcBalance + row.dsraBalance + row.marginBalance);
    equityFlows.push(row.fcfe);
    projectFlows.push(row.projectCf);
    preTaxEquityFlows.push(row.preTaxEquityCf);
    preTaxProjectFlows.push(row.preTaxProjectCf);
    holdcoFlows.push(row.fcfe + row.quasiInterestPaid + row.quasiRepaid - holdcoExp);
    lenderYearly.push(row.lenderCf);
    lenderFlows.push({ date: shiftDate(nominalCod, 12 * y, -1), amount: row.lenderCf, kind: "service" });
    cumEquity += row.fcfe;
    row.cumEquity = cumEquity;
    if (payback === null && cumEquity >= 0) payback = y;
  }
  // the loan life and project life cover ratios: the present value of the CFADS over the years left
  // (to the tenor; to the end) at the year's rate, over the opening debt
  for (let y = 1; y <= T; y += 1) {
    const row = rows[y - 1];
    if (!(row.openingDebt > 1e-9)) { row.llcr = null; row.plcr = null; continue; }
    const end = dt.refi && y > dt.refiYear ? dt.refiEnd : dt.tenor;
    let pvLoan = 0;
    let pvProject = 0;
    for (let k = y; k <= T; k += 1) {
      const pv = rows[k - 1].cfads / (1 + row.debtRate) ** (k - y + 1);
      if (k <= end) pvLoan += pv;
      pvProject += pv;
    }
    row.llcr = pvLoan / row.openingDebt;
    row.plcr = pvProject / row.openingDebt;
  }
  const promoterShare = Math.min(1, Math.max(0, fin.holdco?.promoterShare ?? 1));
  const promoterFlows = holdcoFlows.map((v) => v * promoterShare);
  return {
    rows, equityFlows, projectFlows, preTaxEquityFlows, preTaxProjectFlows, holdcoFlows, promoterFlows, lenderFlows, lenderYearly,
    capex, debt0, equity0, mezz0, quasi0, payback, debtTerms: dt, years: T, ppaYears: years,
    timeline: cod ? { codDate: cod, constructionStart: shiftDate(cod, -(capex.construction?.months || 0)) } : null,
  };
}

export function runFinancialModel(ctx, sizes, { costs, fin, bess, dfrTarget, tariffLocked, ops: givenOps = null, solveBy = "irr" }) {
  // givenOps: year-by-year energy from another dispatch (the Tender to Bid HiGHS run)
  const ops = givenOps || simulateLifetime(ctx, sizes, fin, bess);
  const solveTariff = () => {
    let lo = 0.5;
    let hi = 30;
    for (let i = 0; i < 70; i += 1) {
      const mid = (lo + hi) / 2;
      const flows = cashflows(ops, sizes, costs, fin, bess, dfrTarget, mid).equityFlows;
      // solveBy "npv" (Tender to Bid): equity NPV at the target IRR, which stays defined when a
      // trial tariff gives an IRR beyond the IRR search range; "irr" is the Round-the-clock rule
      if (solveBy === "npv") {
        if (npvAt(fin.targetEquityIrr, flows) < 0) lo = mid;
        else hi = mid;
        continue;
      }
      const r = irr(flows);
      if (!Number.isFinite(r) || r < fin.targetEquityIrr) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  const tariff = tariffLocked ? fin.tariff : solveTariff();
  const cf = cashflows(ops, sizes, costs, fin, bess, dfrTarget, tariff);
  const equityIrr = irr(cf.equityFlows);
  const projectIrr = irr(cf.projectFlows);
  const dscrs = cf.rows.map((r) => r.dscr).filter((v) => v !== null && Number.isFinite(v));
  const minOf = (k) => { const v = cf.rows.map((row) => row[k]).filter((x) => x !== null && Number.isFinite(x)); return v.length ? Math.min(...v) : null; };
  const seniorRate = fin.interestRate || 0;
  const r = fin.discountRate;
  // levelised cost of delivered energy (pre-financing, pre-tax)
  let pvCost = cf.capex.total;
  let pvEnergy = 0;
  let pvTariffRev = 0;
  cf.rows.forEach((row) => {
    const df = (1 + r) ** row.year;
    pvCost += (row.opex + row.augCapex) / df;
    pvEnergy += row.deliveredMu * 1000 / df;
    pvTariffRev += (row.deliveredMu * 1000 * row.tariff) / df;
  });
  const lcoe = pvEnergy > 0 ? pvCost / (pvEnergy * RS_CR_PER_MWH_AT_1RS) : NaN;
  const levelisedTariff = pvEnergy > 0 ? pvTariffRev / pvEnergy : NaN;
  const sum = (k) => cf.rows.reduce((s, row) => s + row[k], 0);
  return {
    tariff,
    tariffLocked: Boolean(tariffLocked),
    levelisedTariff,
    lcoe,
    equityIrr,
    projectIrr,
    equityNpv: npvAt(fin.targetEquityIrr, cf.equityFlows),
    projectNpv: npvAt(r, cf.projectFlows),
    minDscr: dscrs.length ? Math.min(...dscrs) : null,
    avgDscr: dscrs.length ? dscrs.reduce((a, b) => a + b, 0) / dscrs.length : null,
    payback: cf.payback,
    capex: cf.capex,
    construction: cf.capex.construction,
    debtTerms: cf.debtTerms,
    debt: cf.debt0,
    equity: cf.equity0,
    rows: cf.rows,
    equityFlows: cf.equityFlows,
    projectFlows: cf.projectFlows,
    // finance v3 (docs/dev/FINANCE-V3-SPEC.md)
    years: cf.years,
    ppaYears: cf.ppaYears,
    timeline: cf.timeline,
    mezz: cf.mezz0,
    quasi: cf.quasi0,
    minFscr: minOf("fscr"),
    minLlcr: minOf("llcr"),
    minPlcr: minOf("plcr"),
    minTotalDscr: minOf("totalDscr"),
    preTaxEquityIrr: irr(cf.preTaxEquityFlows),
    preTaxProjectIrr: irr(cf.preTaxProjectFlows),
    holdcoIrr: irr(cf.holdcoFlows),
    promoterIrr: irr(cf.promoterFlows),
    holdcoFlows: cf.holdcoFlows,
    promoterFlows: cf.promoterFlows,
    lenderFlows: cf.lenderFlows,
    lenderXirr: xirr(cf.lenderFlows),
    lenderMirr: mirr(cf.lenderYearly, seniorRate, fin.lenderReinvestRate ?? seniorRate),
    totals: {
      deliveredMu: sum("deliveredMu"),
      revenue: sum("revenue"),
      ebitda: sum("ebitda"),
      pat: sum("pat"),
      tax: sum("tax"),
      augCapex: sum("augCapex"),
      penalty: sum("penalty"),
      interest: sum("interest"),
      dsm: sum("dsm"),
      charging: sum("charging"),
      lcCost: sum("lcCost"),
      cfdPenalty: sum("cfdPenalty"),
      carbonRevenue: sum("carbonRevenue"),
      guaranteeFees: sum("guaranteeFees"),
      sweepCr: sum("sweepCr"),
      prepaymentFee: sum("prepaymentFee"),
      mezzInterest: sum("mezzInterest"),
      quasiInterestPaid: sum("quasiInterestPaid"),
      otherIncome: sum("otherIncome"),
    },
    minLifetimeDfr: Math.min(...cf.rows.map((row) => row.dfr)),
  };
}

/**
 * The reverse-auction sensitivities (finance v3): the tariff the target equity IRR needs, and the
 * equity IRR and the lowest DSCR at the bid's tariff, with one input moved at a time: the capital
 * cost, the module cost (its share of the solar capex), the exchange rate (on the dollar share of
 * the capex), the interest rate, the generation case, a part-commissioning delay, a life extension
 * and the refinancing rate. Every point is a full run of runFinancialModel on the same yearly
 * energy. args: the runFinancialModel options (costs, fin, bess, dfrTarget, ops, solveBy) with the
 * bid's tariff in fin.tariff (or `tariff`).
 */
export function sensitivities(ctx, sizes, args) {
  const base = { ...args, fin: { ...args.fin, tariff: args.tariff ?? args.fin.tariff } };
  const run = ({ costs = base.costs, fin = base.fin } = {}) => {
    const solved = runFinancialModel(ctx, sizes, { ...base, costs, fin, tariffLocked: false });
    const at = runFinancialModel(ctx, sizes, { ...base, costs, fin, tariffLocked: true });
    return { tariff: solved.tariff, equityIrr: at.equityIrr, minDscr: at.minDscr };
  };
  const scaleCapex = (k) => ({
    ...base.costs,
    solarCrPerMw: base.costs.solarCrPerMw * k, windCrPerMw: base.costs.windCrPerMw * k, bessCrPerMwh: base.costs.bessCrPerMwh * k,
    bessPcsCrPerMw: (base.costs.bessPcsCrPerMw || 0) * k, biomassCrPerMw: (base.costs.biomassCrPerMw || 0) * k,
    evacuationCr: (base.costs.evacuationCr || 0) * k, otherCapexCr: (base.costs.otherCapexCr || 0) * k,
    plants: (base.costs.plants || []).map((pl) => ({ ...pl, capexCrPerMw: (pl.capexCrPerMw || 0) * k })),
  });
  const pct = (d) => `${d > 0 ? "+" : ""}${Math.round(d * 100)}%`;
  const moduleShare = base.costs.moduleSharePct ?? 0.45;
  const usdShare = base.fin.capexUsdShare || 0;
  const axes = [
    { key: "capex", label: "Capital cost", steps: [-0.1, 0.1].map((d) => ({ label: pct(d), costs: scaleCapex(1 + d) })) },
    { key: "module", label: `Module cost (${Math.round(moduleShare * 100)}% of the solar capex)`, steps: [-0.1, 0.1].map((d) => ({ label: pct(d), costs: { ...base.costs, solarCrPerMw: base.costs.solarCrPerMw * (1 + d * moduleShare) } })) },
    { key: "fx", label: `Exchange rate (${Math.round(usdShare * 100)}% of the capex in dollars, ₹${base.fin.fxBase || 83}/$)`, steps: [-0.05, 0.05].map((d) => ({ label: pct(d), costs: scaleCapex(1 + d * usdShare) })) },
    { key: "rate", label: "Interest rate", steps: [-0.005, 0.005].map((d) => ({ label: `${d > 0 ? "+" : "−"}50 bp`, fin: { ...base.fin, interestRate: Math.max(0, base.fin.interestRate + d) } })) },
    { key: "generation", label: "Generation case", steps: ["p50", "p75", "p90"].filter((c) => c !== (base.fin.generationCase || "p50")).map((c) => ({ label: c.toUpperCase(), fin: { ...base.fin, generationCase: c } })) },
    { key: "parts", label: "Commissioning delay", steps: [3, 6].map((m) => ({ label: `+${m} months`, fin: { ...base.fin, parts: [{ share: 1, offsetMonths: m }] } })) },
    { key: "extension", label: "Project life", steps: [5, 10].map((n) => ({ label: `+${n} years`, fin: { ...base.fin, extension: { ...(base.fin.extension || DEFAULT_FINANCE.extension), years: (base.fin.extension?.years || 0) + n } } })) },
    { key: "refi", label: base.fin.refiYear > 0 ? `Refinancing rate (year ${base.fin.refiYear})` : "Refinancing rate (no refinancing in the bid)", steps: [-0.01, 0.01].map((d) => ({ label: `${d > 0 ? "+" : "−"}100 bp`, fin: { ...base.fin, refiRate: Math.max(0, (base.fin.refiRate || 0) + d) } })) },
  ];
  const baseline = run();
  return {
    base: { label: "Bid", ...baseline },
    rows: axes.map((a) => ({ key: a.key, label: a.label, cases: a.steps.map((st) => ({ label: st.label, ...run({ costs: st.costs, fin: st.fin }) })) })),
  };
}

/**
 * How ageing moves the 25-year tariff: the same plant with no ageing, with solar and wind
 * degradation, and with battery fade + augmentation as configured.
 */
export function tariffAgeingBreakdown(ctx, sizes, { costs, fin, bess, dfrTarget }) {
  const run = (f, b) => runFinancialModel(ctx, sizes, { costs, fin: f, bess: b, dfrTarget, tariffLocked: false });
  const noAgeFin = { ...fin, solarDegradation: 0, windDegradation: 0 };
  const noAgeBess = { ...bess, annualDegradation: 0 };
  const ideal = run(noAgeFin, noAgeBess);
  const gen = run(fin, noAgeBess);
  const all = run(fin, bess);
  return {
    ideal: { tariff: ideal.tariff, minDfr: ideal.minLifetimeDfr, deliveredMu: ideal.totals.deliveredMu },
    gen: { tariff: gen.tariff, minDfr: gen.minLifetimeDfr, deliveredMu: gen.totals.deliveredMu },
    all: { tariff: all.tariff, minDfr: all.minLifetimeDfr, deliveredMu: all.totals.deliveredMu, augCapexCr: all.totals.augCapex, penaltyCr: all.totals.penalty },
    genImpact: gen.tariff - ideal.tariff,
    bessImpact: all.tariff - gen.tariff,
  };
}

/** Solar and wind are on separate sites, each with its own battery. */
export function splitSitesReady(sites) {
  return Boolean(sites?.split);
}

export function buildContext({ demand, solarCf, windCf, plantMw, bess, lossPct = 0, trafoLossPct = 0, lineLossPct = 0, sellSurplus = false, extraExportMw = 0, sites = null }) {
  // sites: { split: true } for solar and wind on separate sites (each battery charges from its own
  // site only); null for one site
  return { demand, solarCf, windCf, plantMw, bess, lossPct, trafoLossPct, lineLossPct, sellSurplus, extraExportMw, sites };
}

export function buildModel({ inputs, costs, fin, bess, vars, objective = "tariff", gridPoints = 11 }) {
  const finWithGrowth = { ...fin, demandGrowth: inputs.demandGrowth || 0 };
  return {
    costs,
    fin: finWithGrowth,
    bess,
    vars,
    objective,
    gridPoints,
    dfrTarget: inputs.dfrTarget,
    dfrBasis: inputs.dfrBasis,
    designCheck: inputs.designCheck,
    worstFactors: worstYearFactors(finWithGrowth, bess),
  };
}
