// The generation build-up of the traceable model: each technology's hourly profile reduced to the
// numbers a CFO checks by hand. A year is capacity × CUF × 365 days × 24 hours; the CUF is the
// days-weighted mean of the twelve monthly CUFs; a month is capacity × that month's CUF × its
// days × 24 hours; and each hour splits into four 15-minute blocks the way the 15-minute dispatch
// splits it (engine/sizing/dispatch15.py split_hourly). Used by the three tabs' live-model
// requests (Tender to Bid, Round the clock, What-if) and by the trace's drill-down.
import { HOURS, MONTH_DAYS, MONTH_OF_HOUR } from "../rtc/engine.js";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// where a profile's CUF is measured: after how many of its loss stages (rtc/engine.js LOSS_STAGES)
const POINTS = {
  solar: ["module (DC) output", "inverter input", "inverter output", "inverter-duty transformer output", "33 kV bus"],
  wind: ["turbine terminals", "WTG transformer output", "33 kV bus"],
};
/** The point a profile is measured at, from how many loss stages it already includes (all: the bus). */
export const cufPoint = (kind, at) => POINTS[kind][Math.max(0, Math.min(POINTS[kind].length - 1, at ?? POINTS[kind].length - 1))];

/** Mean capacity factor of each month (the month's CUF). */
export function monthlyCuf(cf) {
  const sum = new Array(12).fill(0);
  for (let t = 0; t < HOURS; t += 1) sum[MONTH_OF_HOUR[t]] += cf[t] || 0;
  return sum.map((s, m) => s / (MONTH_DAYS[m] * 24));
}

/**
 * One technology for the live model's generation build-up. cf: its hourly capacity factors at the
 * point where its CUF is measured; toBus: the share lost from there to the 33 kV bus, where the
 * dispatch runs; degradation: per year. The hourly profile rides along for the browser's
 * drill-down only: it is not enumerable, so the Excel request (JSON) leaves it out.
 */
export function genSource({ cf, toBus = 0, degradation = 0, cufAt = "", profile = "" }) {
  if (!cf || cf.length < HOURS) return null;
  const monthCuf = monthlyCuf(cf);
  const src = {
    cuf: monthCuf.reduce((a, c, m) => a + c * MONTH_DAYS[m], 0) / 365,
    monthCuf,
    toBus: Math.min(0.5, Math.max(0, toBus || 0)),
    degradation: degradation || 0,
    cufAt,
    profile,
  };
  Object.defineProperty(src, "hourly", { value: cf, enumerable: false });
  return src;
}

/** First hour of a day of the year (0-based day). */
export const dayStart = (day) => Math.max(0, Math.min(364, day)) * 24;

/** Day of the year (0-based) and its date label, e.g. 172 → "21 June". */
export function dayLabel(day) {
  let d = day;
  for (let m = 0; m < 12; m += 1) {
    if (d < MONTH_DAYS[m]) return `${d + 1} ${MONTHS[m]}`;
    d -= MONTH_DAYS[m];
  }
  return `${day + 1}`;
}

/**
 * The 15-minute capacity factors of hours [from, to): four per hour along the hour's trend (half
 * the change from the previous to the next hour), keeping the hour's energy and each block in
 * [0, peak]. Same as split_hourly in engine/sizing/dispatch15.py.
 */
export function quarterHours(cf, from = 0, to = HOURS) {
  let top = 0;
  for (let t = 0; t < HOURS; t += 1) top = Math.max(top, cf[t] || 0);
  if (top <= 1) top = 1;
  const out = [];
  const w = [-3, -1, 1, 3].map((k) => k / 8);
  for (let h = from; h < to; h += 1) {
    const v = cf[h] || 0;
    const prev = cf[Math.max(0, h - 1)] || 0;
    const next = cf[Math.min(HOURS - 1, h + 1)] || 0;
    const room = (Math.max(0, Math.min(v, top - v)) * 8) / 3;
    const slope = Math.max(-room, Math.min(room, (next - prev) / 2));
    for (const k of w) out.push(Math.min(top, Math.max(0, v + slope * k)));
  }
  return out;
}
