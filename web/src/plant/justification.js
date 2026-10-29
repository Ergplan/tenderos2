// Why one year's hourly profile stands for the whole PPA: the typical meteorological year method,
// the P50 level and what P75/P90 would mean, year-to-year variability, the degradation the model
// applies and the CUF it gives in the last year, the evidence the bid should attach and what the
// model leaves out. Structured text (a title and {heading, text} paragraphs) for the panel in
// web/src/plant/ProfileView.jsx and the Word file (app/api/plant/justification). Every number
// comes from the inputs; the variability ranges are typical for the technology and say so.
// Plain JavaScript, checked in Node (tools/check_cuf_file.mjs).
import { MONTHS } from "../rtc/engine.js";
import { yearCufTable } from "./cufFile.js";

const pct = (v, d = 2) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "–");
const num = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");

/** Typical year-to-year variation of a site's annual energy, as a share of its long-term mean (not from this site). */
export const INTERANNUAL = { solar: [0.03, 0.05], wind: [0.08, 0.12] };

export function cufJustification({ kind = "solar", stats = null, name = null, cuf, rawCuf = null, degradation = 0, years = 25, p50p90 = {}, cufAt = null }) {
  const tech = kind === "wind" ? "wind" : "solar";
  const Tech = tech === "wind" ? "Wind" : "Solar";
  const n = Math.max(1, Math.round(Number(years) || 25));
  const table = yearCufTable({ kind: tech, cuf, degradation, years: n });
  const last = table[table.length - 1];
  const total = last.cumulative;
  const flat = cuf * 8760 * n;
  const p50 = Number.isFinite(p50p90?.p50) ? p50p90.p50 : cuf;
  const p90 = Number.isFinite(p50p90?.p90) && p50p90.p90 > 0 ? p50p90.p90 : null;
  const [lo, hi] = INTERANNUAL[tech];
  const source = name ? `the uploaded file "${name}"` : `the typical ${tech} profile shape built into the model`;

  const shape = [];
  if (stats) {
    if (Number.isFinite(stats.peak)) shape.push(`its highest hour reaches ${pct(stats.peak, 1)} of capacity`);
    if (Number.isFinite(stats.zeroShare)) shape.push(`${pct(stats.zeroShare, 0)} of the hours (${num(stats.zeroShare * 8760)} h) are at zero`);
    if (Array.isArray(stats.monthly) && stats.monthly.length === 12) {
      const best = stats.monthly.indexOf(Math.max(...stats.monthly));
      const worst = stats.monthly.indexOf(Math.min(...stats.monthly));
      shape.push(`the best month is ${MONTHS[best]} at ${pct(stats.monthly[best], 1)} and the worst ${MONTHS[worst]} at ${pct(stats.monthly[worst], 1)}`);
    }
  }
  const scaled = rawCuf !== null && rawCuf !== undefined && Math.abs(rawCuf - cuf) > 1e-4;

  const paragraphs = [
    {
      heading: "The profile used in the bid",
      text: `The hourly ${tech} profile in this bid is ${source}. It has 8,760 values, one per hour of a 365-day year, each the output as a share of rated capacity. Its average is the CUF used in the bid, ${pct(cuf)}, which is ${num(cuf * 8760)} kWh per kW a year`
        + (rawCuf !== null && rawCuf !== undefined ? (scaled ? `. The file's own CUF is ${pct(rawCuf)}; the model keeps the file's hour-by-hour shape and scales its level to the CUF entered (no hour is allowed above 100%)` : `. The file's own CUF is the same, so it is used as it is`) : "")
        + (cufAt ? `. The CUF is measured at: ${cufAt}; the losses after that point are applied on the way to the billing meter` : "")
        + (shape.length ? `. In this profile ${shape.join("; ")}.` : "."),
    },
    {
      heading: `Why one year's profile stands for ${n} years`,
      text: `The model dispatches the plant hour by hour for one year and repeats that year for each of the ${n} PPA years, with the degradation below applied to its level. This is the typical meteorological year (TMY) method: one representative year is assembled from long-term data, month by month, so that each month's irradiance or wind and its diurnal pattern are typical of the long-term record rather than of any single calendar year. `
        + `The profile therefore carries the shape, that is when in the day and in the year the energy comes, while the CUF carries the level, that is how much energy comes in an average year. The shape is what the storage sizing and the peak-hour supply depend on; the level is what the energy and the revenue depend on. Separating the two is why the bid can enter its own CUF and keep the site's shape.`,
    },
    {
      heading: "P50, P75 and P90",
      text: `The CUF used in the bid${Number.isFinite(p50p90?.p50) && Math.abs(p50 - cuf) > 1e-6 ? ` is ${pct(cuf)}, and the P50 CUF entered here is ${pct(p50)}` : `, ${pct(p50)},`} is treated as the P50 level: the annual energy that the site is expected to exceed in half of its years. `
        + `A P75 level is exceeded in three years out of four and a P90 level in nine years out of ten; both lie below P50, and the gap between them is set by how much the site's annual energy varies from year to year and by the uncertainty of the resource data. Lenders usually size debt on P90 (or P75) energy, while the P50 is the expected case the equity return is based on. `
        + (p90
          ? `The P90 CUF entered is ${pct(p90)}, ${pct(p90 / p50, 1)} of the P50 (a P90/P50 ratio of ${(p90 / p50).toFixed(3)}); at P90 the first year gives ${num(p90 * 8760)} kWh per kW instead of ${num(p50 * 8760)}, ${num((p50 - p90) * 8760)} kWh per kW less.`
          : `No P90 CUF has been entered; the independent resource assessment gives it, and the bid should quote it beside the P50 so the lender's case can be read off the same profile.`),
    },
    {
      heading: "Year-to-year variability",
      text: `Any single year departs from the typical year. For a ${tech} site the annual energy typically varies by about ±${Math.round(lo * 100)}–${Math.round(hi * 100)}% around its long-term mean from one year to the next. These are typical ranges for the technology, not figures measured at this site; the site's own range comes from the long-term record in the resource assessment and should replace them in the bid when it is available. `
        + `Over ${n} years the high and low years largely average out, which is why the long-term mean (the P50) is the right level for the PPA as a whole, while the P90 shows how low a poor year can go. On this bid's CUF that typical range is ${pct(cuf * (1 - hi))} to ${pct(cuf * (1 + hi))} in a single year.`,
    },
    {
      heading: `Degradation and the CUF in year ${n}`,
      text: (degradation > 0
        ? `The model lowers the ${tech} output every year by ${pct(degradation)}: the factor in year y is (1 − ${pct(degradation)})^(y − 1), so it is 1.000 in year 1 and ${last.factor.toFixed(3)} in year ${n}. The CUF is ${pct(cuf)} in year 1 and ${pct(last.cuf)} in year ${n}; the energy per MW falls from ${num(cuf * 8760)} MWh to ${num(last.cuf * 8760)} MWh a year. `
          + `Over ${n} years the plant gives ${num(total)} MWh per MW, ${pct(total / flat, 1)} of what ${n} years at the year-1 CUF would give.`
        : `The model applies no degradation to ${tech}: the factor is 1.000 in every year, so the CUF is ${pct(cuf)} in year 1 and ${pct(last.cuf)} in year ${n}, ${num(cuf * 8760)} MWh per MW a year and ${num(total)} MWh per MW over ${n} years.`)
        + ` The 25-year CUF table downloadable beside this note lists every year.`,
    },
    {
      heading: "Evidence to attach to the bid",
      text: `The bid should attach, beside the hourly file: (1) the data source of the profile (the satellite or reanalysis dataset, or the ground station, and the model that turned it into plant output); (2) the period of the long-term record the typical year was built from, with its start and end dates; (3) the point at which the output is measured${cufAt ? ` (here: ${cufAt})` : ""} and the losses between that point and the billing meter; (4) the independent assessor's resource and energy yield report giving the P50, P75 and P90 annual energy and the uncertainty behind them; and (5) the degradation per year assumed and its basis (the module or turbine warranty, or the assessor's figure).`,
    },
    {
      heading: "What the model does not capture",
      text: `The profile and the CUF describe what the plant can generate. They do not include curtailment by the grid (instructions to back down, or transmission constraints), the plant's own availability (planned and forced outages of inverters, turbines, transformers or the evacuation line), or the effect of extreme years outside the long-term record. The model's losses to the billing meter cover the electrical path, not these events; where the tender or the lender asks for them, apply an availability factor and a curtailment allowance on top of the figures here.`,
    },
  ];

  return { title: `${Tech} CUF: why one year's hourly profile is used for ${n} years`, paragraphs, yearTable: table, year25: { year: n, factor: last.factor, cuf: last.cuf } };
}
