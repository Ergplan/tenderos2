// The generation build-up in words, for the voice agent: a CFO asks "how is the solar energy
// worked out?" or "I get 1,719 million units, is that right?" and the agent answers from the same
// traceable model the screen shows (web/src/model/trace.js): MW × CUF × 365 × 24 ÷ 1,000, the
// year's degradation, the losses to the 33 kV bus, the month, a day's 15-minute blocks, and what
// the dispatch did with the energy. Plain JavaScript, checked in Node (tools/check_generation.mjs).
import { MONTH_DAYS } from "../rtc/engine.js";
import { MONTHS, dayLabel, quarterHours } from "./generation.js";
import { traceModel } from "./trace.js";

const r = (v, d = 1) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const pct = (v, d = 2) => r(v * 100, d);
const num = (v, d = 1) => (Number.isFinite(v) ? v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
const hhmm = (q) => `${String(Math.floor(q / 4)).padStart(2, "0")}:${String((q % 4) * 15).padStart(2, "0")}`;
const NAMES = { solar: "Solar", wind: "Wind" };

/** A year-series cell's address and value in the trace model. */
function seriesCell(model, key, year) {
  const l = model.lines[key];
  if (!l?.row) return null;
  let col = "";
  for (let k = 4 + year; k > 0; k = Math.floor((k - 1) / 26)) col = String.fromCharCode(65 + ((k - 1) % 26)) + col;
  const addr = `${col}${l.row}`;
  return model.cells[addr] ? { addr, value: model.cells[addr].value } : null;
}
const oneCell = (model, key) => {
  const a = model.lines[key]?.addr;
  return a && model.cells[a] ? { addr: a, value: model.cells[a].value } : null;
};

/**
 * The generation of one or both technologies in year `year`, worked out step by step, with the
 * month (1-12) and the day of that month in 15-minute blocks when asked. theirMu: a figure the user
 * worked out, compared with the model's and explained.
 */
export function explainGeneration(live, { source = "all", year = 1, month = null, day = null, theirMu = null } = {}) {
  const model = live ? traceModel(live) : null;
  if (!model) return { ok: false, error: "There is no financial model yet: size the plant first." };
  const techs = Object.keys(model.gen || {}).filter((k) => source === "all" || source === k);
  if (!techs.length) return { ok: false, error: source === "all" ? "This model has no solar or wind generation." : `This model has no ${source}.` };
  const y = Math.min(model.N, Math.max(1, Math.round(Number(year) || 1)));
  const m = month ? Math.min(12, Math.max(1, Math.round(Number(month)))) : null;
  const d = m && day ? Math.min(MONTH_DAYS[m - 1], Math.max(1, Math.round(Number(day)))) : null;
  const sheet = (addr) => `'Live model'!${addr}`;
  const out = { ok: true, year: y, formula: "MW × CUF × 365 days × 24 hours ÷ 1,000 = MU (million kWh), × the year's degradation factor, × (1 − losses to the 33 kV bus)", sources: [] };
  const spoken = [];
  const candidates = { model: 0, noDegradation: 0, noLosses: 0, neither: 0 };
  for (const k of techs) {
    const g = model.gen[k];
    const mw = oneCell(model, `${k}Mw`)?.value || 0;
    const cufCell = oneCell(model, `${k}Cuf`);
    const cuf = cufCell?.value ?? g.cuf;
    const degF = seriesCell(model, `${k}DegF`, y)?.value ?? 1;
    const genCell = seriesCell(model, `${k}Gen`, y);
    const busCell = seriesCell(model, `${k}Bus`, y) || genCell;
    const toBus = oneCell(model, `${k}ToBus`)?.value || 0;
    const base = (mw * cuf * 365 * 24) / 1000;
    candidates.model += busCell.value;
    candidates.noDegradation += base * (1 - toBus);
    candidates.noLosses += genCell.value;
    candidates.neither += base;
    const at = toBus > 0 ? "the 33 kV bus" : `the ${g.cufAt || "point its CUF is measured"}`;
    const steps = [
      `${num(mw)} MW × ${pct(cuf)}% CUF × 365 × 24 ÷ 1,000 = ${num(base)} MU`,
      ...(y > 1 ? [`× ${num(degF, 4)} (${pct(g.degradation)}% a year degradation, year ${y}) = ${num(genCell.value)} MU`] : []),
      ...(toBus > 0 ? [`× (1 − ${pct(toBus)}% losses from the ${g.cufAt} to the bus) = ${num(busCell.value)} MU at the 33 kV bus`] : []),
    ];
    const months = g.monthCuf ? g.monthCuf.map((c, i) => ({
      month: MONTHS[i], days: MONTH_DAYS[i], cufPct: pct(c), mu: r(((mw * c * MONTH_DAYS[i] * 24) / 1000) * degF * (1 - toBus)),
    })) : null;
    const item = {
      source: NAMES[k], mw: r(mw), cufPct: pct(cuf), cufMeasuredAt: g.cufAt || null, profile: g.profile || null,
      degradationFactor: r(degF, 4), lossesToBusPct: pct(toBus), steps, generationMu: r(genCell.value), atBusMu: r(busCell.value),
      excelCells: { mw: sheet(oneCell(model, `${k}Mw`)?.addr), cuf: sheet(cufCell?.addr), generation: sheet(genCell.addr), ...(busCell !== genCell ? { atBus: sheet(busCell.addr) } : {}) },
      cufFromMonths: g.monthCuf ? "the annual CUF is the days-weighted mean of the twelve monthly CUFs: (Jan × 31 + Feb × 28 + … + Dec × 31) ÷ 365" : null,
      months,
    };
    spoken.push(`${NAMES[k]}, year ${y}: ${num(mw, 0)} megawatts times ${num(cuf * 100, 2)} percent CUF times 365 days times 24 hours, divided by a thousand, is ${num(base)} million units`
      + `${y > 1 ? `; times the year's degradation factor ${num(degF, 4)} gives ${num(genCell.value)}` : ""}`
      + `${toBus > 0 ? `; less ${num(toBus * 100, 2)} percent losses to the bus, ${num(busCell.value)} million units at ${at}` : ""}.`);
    if (m && months) {
      const mm = months[m - 1];
      item.month = { ...mm, steps: `${num(mw)} MW × ${mm.cufPct}% × ${mm.days} days × 24 ÷ 1,000${y > 1 ? ` × ${num(degF, 4)}` : ""}${toBus > 0 ? ` × (1 − ${pct(toBus)}%)` : ""} = ${num(mm.mu)} MU` };
      spoken.push(`In ${mm.month}: ${num(mw, 0)} megawatts times ${num(mm.cufPct, 2)} percent times ${mm.days} days times 24 hours is ${num(mm.mu)} million units.`);
    }
    if (d && g.hourly) {
      const start = (MONTH_DAYS.slice(0, m - 1).reduce((a, x) => a + x, 0) + d - 1) * 24;
      const blocks = quarterHours(g.hourly, start, start + 24);
      const mwh = (v) => mw * v * degF * (1 - toBus) * 0.25;
      const on = blocks.map((v, q) => [v, q]).filter(([v]) => v > 1e-6);
      const peakQ = blocks.reduce((best, v, q) => (v > blocks[best] ? q : best), 0);
      const dayMwh = blocks.reduce((a, v) => a + mwh(v), 0);
      item.day = {
        date: dayLabel(start / 24), blocks: 96, dayCufPct: pct(blocks.reduce((a, v) => a + v, 0) / 96), dayMwh: r(dayMwh, 0),
        generatingFrom: on.length ? hhmm(on[0][1]) : null, generatingTo: on.length ? hhmm(on.at(-1)[1] + 1) : null,
        peakBlock: { time: `${hhmm(peakQ)}–${hhmm(peakQ + 1)}`, capacityFactor: r(blocks[peakQ], 3), mwh: r(mwh(blocks[peakQ])), steps: `${num(mw)} MW × ${num(blocks[peakQ], 3)} × 0.25 h${y > 1 ? ` × ${num(degF, 4)}` : ""}${toBus > 0 ? ` × (1 − ${pct(toBus)}%)` : ""} = ${num(mwh(blocks[peakQ]))} MWh` },
        note: "Each hour of the profile is split into four 15-minute blocks along its trend, keeping the hour's energy, as the 15-minute dispatch does; all 35,040 blocks of the year add up to the year's figure.",
      };
      spoken.push(`On ${item.day.date} it generates from ${item.day.generatingFrom || "no block"} to ${item.day.generatingTo || "no block"}, ${num(dayMwh, 0)} megawatt hours in all; the biggest block, ${item.day.peakBlock.time}, is ${num(mw, 0)} megawatts times ${num(blocks[peakQ], 3)} times a quarter hour, ${num(mwh(blocks[peakQ]))} megawatt hours.`);
    } else if (d) item.day = { note: "The hourly profile is not available here: open the traceable model on screen for the 15-minute blocks." };
    out.sources.push(item);
  }
  // what the dispatch did with the year's generation
  const v = (key) => seriesCell(model, key, y)?.value;
  if (source === "all" && v("genBus") !== undefined) {
    out.dispatch = {
      generatedAtBusMu: r(v("genBus")), deliveredMu: r(v("delivered")), soldMu: r(v("excess")), notDeliveredOrSoldMu: r(v("unused")), deliveredOrSoldPct: pct(v("usedShare"), 1),
      note: "The generation is the formula above. The dispatch only decides where each hour's energy goes: to the procurer, into the battery, sold, or curtailed; what is not delivered or sold was curtailed or lost in the battery and the evacuation.",
    };
    spoken.push(`Of the ${num(v("genBus"))} million units generated in year ${y}, ${num(v("delivered"))} reached the procurer and ${num(v("excess"))} were sold; the other ${num(v("unused"))} were curtailed or lost in the battery and the evacuation.`);
  }
  if (Number.isFinite(Number(theirMu)) && theirMu !== null) {
    const t = Number(theirMu);
    const close = (a) => Math.abs(t - a) <= Math.max(0.5, Math.abs(a) * 0.002);
    const modelMu = candidates.model;
    const lossy = candidates.noLosses - candidates.model > 1e-6;
    const aged = candidates.noDegradation - candidates.model > 1e-6;
    const left = [aged && `the year-${y} degradation`, lossy && "the losses to the 33 kV bus"].filter(Boolean).join(" and ");
    const mu = (x) => `${num(x)} million units`;
    let verdict;
    if (close(modelMu)) verdict = `Your ${mu(t)} matches the model's ${mu(modelMu)}.`;
    else if (close(candidates.neither) && left) verdict = `Your ${mu(t)} is megawatts times CUF times 365 times 24 before ${left}; with ${aged && lossy ? "them" : "it"} the model has ${mu(modelMu)}.`;
    else if (lossy && close(candidates.noLosses)) verdict = `Your ${mu(t)} is the generation before the losses to the 33 kV bus; after them the model has ${mu(modelMu)}.`;
    else if (aged && close(candidates.noDegradation)) verdict = `Your ${mu(t)} leaves out the year-${y} degradation; with it the model has ${mu(modelMu)}.`;
    else verdict = `Your ${mu(t)} differs from the model's ${mu(modelMu)} by ${num(t - modelMu)} million units (${num(((t - modelMu) / (modelMu || 1)) * 100, 2)} percent). Check the megawatts and the CUF against the steps.`;
    out.check = { theirMu: r(t), modelMu: r(modelMu), matches: close(modelMu), verdict };
    spoken.unshift(verdict);
  }
  out.spoken = spoken.join(" ");
  // what to open on screen: one technology's line (its drill-down to months and blocks), or the total
  const one = techs.length === 1 || m ? techs[0] : null;
  out.show = { line: one ? (model.lines[`${one}Bus`] ? `${one}Bus` : `${one}Gen`) : "genBus", year: y, drill: m ? { month: m, day: d } : null };
  return out;
}
