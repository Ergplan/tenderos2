// Which Peak Hours the buyer would pick. SECI RTC-TM-V lets the Buying Entity choose any 6 hours a
// day, day-ahead, between 18:00 and 10:00 the next morning (Amendment-01 p. 2; PSA p. 18). A buyer
// contracting round-the-clock power picks the hours it would otherwise pay the market most for:
// here, each day's 6 hours of that window with the highest IEX Day-Ahead Market prices
// (web/public/market/iex_hourly_prices.json, one calendar year of hourly prices).
import * as E from "../rtc/engine.js";

export const PEAK_MARKET = "DAM";
export const PEAK_PICKS = 6;
const WINDOW_START = 18; // 18:00 of the day …
const WINDOW_HOURS = 16; // … to 10:00 the next morning

/**
 * The hours picked over the year: mask (one per hour, 1 = a Peak Hour), the share of days each hour
 * of the day is picked, and the average price of the picked hours and of the whole window. The
 * window that starts on 31 December runs into 1 January of the same price year (the year wraps).
 * Null when the prices are not there.
 */
export function costliestHours(prices, { market = PEAK_MARKET, picks = PEAK_PICKS } = {}) {
  const m = prices?.markets?.[market];
  const p = m?.hourlyRsPerMwh;
  if (!Array.isArray(p) || p.length < E.HOURS) return null;
  const mask = new Uint8Array(E.HOURS);
  const days = E.HOURS / 24;
  let picked = 0;
  let window = 0;
  for (let d = 0; d < days; d += 1) {
    const hours = Array.from({ length: WINDOW_HOURS }, (_, k) => (d * 24 + WINDOW_START + k) % E.HOURS);
    // the highest prices first; an earlier hour wins a tie
    const top = [...hours].sort((a, b) => p[b] - p[a] || hours.indexOf(a) - hours.indexOf(b)).slice(0, picks);
    for (const t of top) { mask[t] = 1; picked += p[t]; }
    for (const t of hours) window += p[t];
  }
  const share = new Array(24).fill(0);
  for (let t = 0; t < E.HOURS; t += 1) if (mask[t]) share[E.HOUR_OF_DAY[t]] += 1 / days;
  const often = share.map((s, h) => [h, s]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, picks).map(([h]) => h).sort((a, b) => ((a + 24 - WINDOW_START) % 24) - ((b + 24 - WINDOW_START) % 24));
  return {
    mask,
    share,
    mostOften: often,
    market,
    marketLabel: `IEX ${market}${m.from && m.to ? `, ${m.from} to ${m.to}` : ""}`,
    pickedRsPerKwh: picked / (days * picks) / 1000,
    windowRsPerKwh: window / (days * WINDOW_HOURS) / 1000,
  };
}

/** "18:00, 19:00, …" as hour ranges: [18,19,20,21,22,23] → "18:00–24:00". */
export function hourRanges(hours) {
  const out = [];
  for (const h of hours) {
    const last = out[out.length - 1];
    if (last && (last[1] % 24) === h) last[1] = h + 1;
    else out.push([h, h + 1]);
  }
  return out.map(([a, b]) => `${String(a).padStart(2, "0")}:00–${String(b > 24 ? b - 24 : b).padStart(2, "0")}:00`).join(", ");
}
