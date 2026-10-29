// The CUF file a bidder downloads from the profile on screen (web/src/plant/ProfileView.jsx):
// the 8,760-hour profile as the bid uses it (scaled to the CUF entered) beside the uploaded
// file's own values, with a header block naming the source, the CUFs, the measuring point and the
// degradation; and the table of one row per PPA year with the degradation factor the model
// applies (web/src/rtc/engine.js yearFactors). Plain JavaScript, built in the browser, checked in
// Node (tools/check_cuf_file.mjs).
import { HOURS, MONTH_DAYS, yearFactors } from "../rtc/engine.js";

const pct = (v, d = 2) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "–");
const num = (v, d = 6) => (Number.isFinite(v) ? Number(v).toFixed(d) : "");
const techName = (kind) => (kind === "wind" ? "wind" : "solar");
const mean = (a) => (a?.length ? Array.from(a).reduce((s, v) => s + v, 0) / a.length : null);

/** Month (1-12), day of the month (1-31) and hour (0-23) of hour `h` (0-8759) of a 365-day year. */
export function calendarOf(h) {
  let day = Math.floor(h / 24);
  let month = 0;
  while (month < 11 && day >= MONTH_DAYS[month]) { day -= MONTH_DAYS[month]; month += 1; }
  return { month: month + 1, day: day + 1, hour: h % 24 };
}

/** The degradation factor of each PPA year for one technology, as the model applies it. */
export function yearFactorOf(kind, year, degradation) {
  const fin = kind === "wind" ? { windDegradation: degradation || 0 } : { solarDegradation: degradation || 0 };
  const f = yearFactors(year, fin, { augmentation: "annual", annualDegradation: 0 });
  return kind === "wind" ? f.windFactor : f.solarFactor;
}

/** One row per PPA year: the degradation factor, the CUF that year, MWh per MW and the running total. */
export function yearCufTable({ kind = "solar", cuf, degradation = 0, years = 25 }) {
  const n = Math.max(1, Math.round(Number(years) || 25));
  const rows = [];
  let cumulative = 0;
  for (let y = 1; y <= n; y += 1) {
    const factor = yearFactorOf(kind, y, degradation);
    const yearCuf = cuf * factor;
    const mwhPerMw = yearCuf * HOURS;
    cumulative += mwhPerMw;
    rows.push({ year: y, factor, cuf: yearCuf, mwhPerMw, cumulative });
  }
  return rows;
}

const headerLines = ({ kind, cuf, rawCuf, name, degradation, cufAt, date, years }) => {
  const tech = techName(kind);
  const lines = [
    `# ${tech[0].toUpperCase()}${tech.slice(1)} capacity factor, hour by hour, as used in the bid`,
    `# Source: ${name ? `uploaded file ${name}` : `Typical ${tech} profile`}`,
    `# CUF entered (used in the bid): ${pct(cuf)}`,
    `# CUF of the file: ${rawCuf === null || rawCuf === undefined ? "no file uploaded (typical profile)" : pct(rawCuf)}`,
    `# Measured at: ${cufAt || "not stated"}`,
    `# Degradation per year applied by the model: ${pct(degradation || 0, 2)}${years ? ` over ${years} years` : ""}`,
    `# Date: ${(date instanceof Date ? date : new Date(date || Date.now())).toISOString().slice(0, 10)}`,
    "# Capacity factor = output ÷ rated capacity in that hour (0 to 1); a 365-day year, hour 1 = 1 January 00:00",
  ];
  return lines;
};

/**
 * The CSV of the 8,760-hour profile. `values`: the profile the bid uses (scaled to the CUF entered);
 * `raw`: the uploaded file's values, or null when a typical profile is used.
 */
export function cufCsv({ kind = "solar", values, raw = null, cuf = null, rawCuf = null, name = null, degradation = 0, cufAt = null, date = null, years = null }) {
  const used = Array.from(values || []);
  if (used.length !== HOURS) throw new Error(`The profile has ${used.length} hours, not ${HOURS}.`);
  const file = raw?.length === HOURS ? Array.from(raw) : null;
  const entered = Number.isFinite(cuf) ? cuf : mean(used);
  const fileCuf = file ? (Number.isFinite(rawCuf) ? rawCuf : mean(file)) : null;
  const out = headerLines({ kind, cuf: entered, rawCuf: fileCuf, name, degradation, cufAt, date, years });
  out.push(["Hour of year", "Month", "Day", "Hour", "Capacity factor used in the bid", ...(file ? ["Capacity factor of the uploaded file"] : [])].join(","));
  for (let h = 0; h < HOURS; h += 1) {
    const c = calendarOf(h);
    out.push([h + 1, c.month, c.day, c.hour, num(used[h]), ...(file ? [num(file[h])] : [])].join(","));
  }
  return `${out.join("\n")}\n`;
}

/** The CSV of one row per PPA year with the degradation factor, the CUF, MWh per MW and the cumulative energy. */
export function cufByYearCsv({ kind = "solar", cuf, degradation = 0, years = 25, name = null, cufAt = null, date = null }) {
  const rows = yearCufTable({ kind, cuf, degradation, years });
  const out = headerLines({ kind, cuf, rawCuf: null, name, degradation, cufAt, date, years: rows.length });
  out.splice(3, 1); // the file's CUF does not belong to the by-year table
  out.push("# Degradation factor = (1 - degradation per year) ^ (year - 1); energy per MW = CUF × 8,760 h");
  out.push(["Year", "Degradation factor", "CUF", "Energy per MW (MWh)", "Cumulative energy per MW (MWh)"].join(","));
  for (const r of rows) out.push([r.year, num(r.factor), num(r.cuf), num(r.mwhPerMw, 1), num(r.cumulative, 1)].join(","));
  return `${out.join("\n")}\n`;
}
