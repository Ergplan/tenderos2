/**
 * The finance team's inputs of 4 November (docs/dev/FINANCE-V3-SPEC.md): the keys they live under
 * in state.fin / state.costs / state.bess, their defaults (every one off, so the model's numbers do
 * not move until a box is filled), and the helpers the screens share. The engine
 * (web/src/rtc/engine.js) reads the same keys; this file keeps the screens working whether or
 * not a row is present in a model result.
 */

export const V3_FIN_DEFAULTS = {
  codDate: null,
  parts: [],
  bridge: { months: 0, rate: null, feePct: 0 },
  generationCase: "p50",
  caseFactors: { p75: 0.97, p90: 0.94 },
  carbon: { enabled: false, tPerMwh: 0.71, pricePerT: 500, years: 10, escalation: 0.03 },
  extension: { years: 0, capexCr: 0, tariffRsPerKwh: null, omFactor: 1, degradation: null },
  repower: { year: 0, capexCr: 0, upliftPct: 0 },
  solarOmEscalation: null,
  windOmEscalation: null,
  bessOmEscalation: null,
  windOmComponents: [],
  otherFixedLines: [],
  refiRepayment: null,
  rateStepDown: { afterYears: 0, rate: null },
  topUp: { year: 0, debtFraction: null },
  prepaymentPct: 0,
  sweep: { pct: 0, fromYear: 1, toYear: null },
  dsraBasis: "next",
  dsraInterestRate: 0,
  quasi: { amountCr: 0, rate: 0.12, lenderMinDscr: 1.2, repayFromYear: 1 },
  mezz: { amountCr: 0, rate: 0.14, tenorYears: 10, graceYears: 0, repayment: "equal", feePct: 0 },
  guarantees: [],
  bookDepreciation: "slm",
  lives: null,
  thinCapPct: 0,
  lossCarryYears: 8,
  holdco: { expensesCrPerYear: 0, promoterShare: 1 },
  lenderReinvestRate: null,
  capexUsdShare: 0,
  fxBase: 83,
};

export const V3_COST_DEFAULTS = { phasing: null, moduleSharePct: 0.45 };

export const V3_FIN_KEYS = Object.keys(V3_FIN_DEFAULTS);

/** The finance keys with their defaults filled in, so a screen can read `fin.carbon.enabled` safely. */
export function v3Fin(fin) {
  const out = { ...V3_FIN_DEFAULTS, ...(fin || {}) };
  for (const k of ["bridge", "caseFactors", "carbon", "extension", "repower", "rateStepDown", "topUp", "sweep", "quasi", "mezz", "holdco"]) {
    out[k] = { ...V3_FIN_DEFAULTS[k], ...(fin?.[k] || {}) };
  }
  for (const k of ["parts", "windOmComponents", "otherFixedLines", "guarantees"]) out[k] = Array.isArray(fin?.[k]) ? fin[k] : [];
  return out;
}

/** The guarantees a tender asks for, as rows the finance team starts from. */
export const GUARANTEE_PRESETS = [
  { id: "emd", label: "Earnest money deposit (EMD)", feePct: 0.01, marginPct: 0.1, marginRate: 0.06, fromYear: 0, years: 1 },
  { id: "pbg", label: "Performance bank guarantee (PBG)", feePct: 0.01, marginPct: 0.1, marginRate: 0.06, fromYear: 0, years: 3 },
  { id: "connectivity", label: "Connectivity bank guarantee", feePct: 0.01, marginPct: 0.1, marginRate: 0.06, fromYear: 0, years: 3 },
  { id: "statutory", label: "Statutory bank guarantee", feePct: 0.01, marginPct: 0.1, marginRate: 0.06, fromYear: 1, years: 5 },
  { id: "surety", label: "Surety bond", feePct: 0.006, marginPct: 0, marginRate: 0, fromYear: 0, years: 3 },
];

export const PHASING_COMPONENTS = [["solar", "Solar"], ["wind", "Wind"], ["bess", "Battery"], ["evac", "Evacuation / pooling"], ["other", "Other capex"]];

/** An ISO date (YYYY-MM-DD) from a date string, a Date or a millisecond timestamp; null when it is not a date. */
export function isoDateOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : typeof value === "number" ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "May 2028" for an ISO date. */
export function monthYear(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The column label of a model year: "Y3", or "Y3 · May 2030 – Apr 2031" once the model has dates. */
export function yearLabel(row) {
  if (!row?.start) return `Y${row.year}`;
  const end = row.end ? new Date(new Date(row.end).getTime() - 86_400_000).toISOString() : null;
  return `Y${row.year} · ${monthYear(row.start)}${end ? ` – ${monthYear(end)}` : ""}`;
}

/** A long date for the screens: "01 May 2028". */
export function longDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** True when some year of the model carries a non-zero value on this key (arrays: any element). */
export function rowsHave(rows, key) {
  return (rows || []).some((r) => {
    const v = r?.[key];
    if (Array.isArray(v)) return v.some((x) => Math.abs(x || 0) > 1e-9);
    return v !== null && v !== undefined && Math.abs(Number(v) || 0) > 1e-9;
  });
}
