// Charts the bid agent can show while it talks (show_chart): each is drawn from the bid itself
// (the tender's floors, the HiGHS year-1 hourly dispatch, the financial model), never from numbers
// the model says, and comes with a short summary the agent reads to describe it. Plain JavaScript
// returning ECharts options (drawn by LiveAgent.jsx), checked in Node by tools/check_seci_agent.mjs.
import * as E from "../rtc/engine.js";
import { DATA_COLORS } from "../dataColors.js";
import { capexBySource, modelInputs } from "../bid/model.js";
import { irrCurve } from "../bid/quote.js";
import { PACK, PEAK_PLANS, moneyAtStake } from "./terms.js";
import { hourRanges } from "./peakPrices.js";
import { financeOf } from "./voice.js";

/** The charts and what each shows (the agent's tool lists them). */
export const CHART_KINDS = {
  peak_window: "The 24-hour day: where the buyer may pick the 6 Peak Hours (18:00 to 10:00), the floor to meet in each hour under your plan, and, once sized, what the plant delivers in each hour on average and in its worst hour of the year",
  typical_day: "An average day of the sized plant hour by hour (year 1, or one month): supply to the PPA from solar, wind and the battery, battery charging, against the contracted supply and the floors",
  monthly_energy: "Energy each month of year 1: delivered to the PPA, the energy short of the floors, and the surplus sold",
  irr_vs_tariff: "Equity and project IRR against the tariff quoted, with the target IRR, the tariff it needs and your quote",
  cash_flows: "The financial model year by year: revenue, operating cost, penalties, debt service and the equity cash flow",
  money: "Capex by source and the money at stake: EMD, PBG, the net worth needed, equity and debt",
};

const HOURS24 = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const r = (v, d = 1) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const inWindow = (h) => h >= 18 || h < 10; // the Peak Hours window, RfS 8.1(c) as amended

/**
 * The floor (MW) to meet in each hour of the day under the bidder's Peak Hours plan. When the plan
 * picks the costliest hours each day (terms.peak.picked), an hour's floor is the average over the
 * days: the peak floor on the days it is picked, the off-peak floor on the others.
 */
export function floorsByHour(state, terms = null) {
  const m = PACK.model;
  const mw = state.bid.baseMw || 0;
  const plan = PEAK_PLANS[state.seci?.peakPlan] || PEAK_PLANS.any;
  const share = plan.byPrice ? terms?.peak?.picked?.share : null;
  if (share) return share.map((f) => (f * m.peakFloor + (1 - f) * m.offpeakFloor) * mw);
  const held = (h) => (plan.hours >= 16 ? inWindow(h) : h >= plan.start && h < plan.start + plan.hours);
  return HOURS24.map((_, h) => (held(h) ? m.peakFloor : m.offpeakFloor) * mw);
}

/** Throws when the chart needs a sized plant (and, with `hourly`, its hour-by-hour dispatch). */
function needSized(state, hourly = undefined) {
  if (!state.lp) throw new Error("Size the plant first (run_optimizer); this chart shows the sized plant.");
  if (hourly !== undefined && !hourly?.direct) throw new Error("The hourly dispatch is not loaded; run the optimizer again.");
}

/** Means (and minima) by hour of day over the hours `pick` keeps, for each series named. */
function byHour(hourly, keys, pick = () => true) {
  const sum = Object.fromEntries(keys.map((k) => [k, new Array(24).fill(0)]));
  const min = Object.fromEntries(keys.map((k) => [k, new Array(24).fill(Infinity)]));
  const n = new Array(24).fill(0);
  for (let t = 0; t < E.HOURS; t += 1) {
    if (!pick(t)) continue;
    const h = E.HOUR_OF_DAY[t];
    n[h] += 1;
    for (const k of keys) {
      const v = typeof k === "function" ? 0 : (hourly[k]?.[t] ?? 0);
      sum[k][h] += v;
      if (v < min[k][h]) min[k][h] = v;
    }
  }
  return { mean: Object.fromEntries(keys.map((k) => [k, sum[k].map((s, h) => (n[h] ? s / n[h] : 0))])), min };
}

function delivered(hourly) {
  return { ...hourly, delivered: hourly.direct.map((d, t) => d + (hourly.discharge?.[t] || 0)) };
}

const axisMw = { type: "value", name: "MW" };
const legend = { top: 0, type: "scroll" };
const grid = { left: 56, right: 18, top: 44, bottom: 34 };

function peakWindow(state, hourly, terms = null) {
  const mw = state.bid.baseMw || 0;
  const m = PACK.model;
  const floors = floorsByHour(state, terms);
  const plan = PEAK_PLANS[state.seci?.peakPlan] || PEAK_PLANS.any;
  const series = [
    { name: `Floor you plan for (${plan.label})`, type: "line", step: "middle", symbol: "none", data: floors.map((v) => r(v)), lineStyle: { color: DATA_COLORS.signal, width: 2 }, itemStyle: { color: DATA_COLORS.signal },
      markArea: { silent: true, itemStyle: { color: "rgba(212,255,63,0.08)" }, label: { color: "#86867f", fontSize: 10 },
        data: [[{ name: "Peak Hours may fall here", xAxis: "18" }, { xAxis: "23" }], [{ name: "…and here", xAxis: "00" }, { xAxis: "09" }]] } },
    { name: "Contracted capacity", type: "line", symbol: "none", data: HOURS24.map(() => mw), lineStyle: { color: DATA_COLORS.demand, type: "dashed", width: 1 }, itemStyle: { color: DATA_COLORS.demand } },
  ];
  const picked = plan.byPrice ? terms?.peak?.picked : null;
  if (picked) {
    series[0].name = "Floor you plan for (average of the days)";
    series.push({ name: "Days the hour is a Peak Hour", type: "bar", yAxisIndex: 1, barWidth: "55%", data: picked.share.map((f) => r(f * 100, 1)), itemStyle: { color: "rgba(212,255,63,0.35)" }, tooltip: { valueFormatter: (v) => `${v}% of days` } });
  }
  if (plan.hours < 16) {
    series.push({ name: "Floor if a morning hour is picked", type: "line", step: "middle", symbol: "none", data: HOURS24.map((_, h) => r((inWindow(h) ? m.peakFloor : m.offpeakFloor) * mw)), lineStyle: { color: DATA_COLORS.unmet, type: "dotted" }, itemStyle: { color: DATA_COLORS.unmet } });
  }
  const summary = {
    contractedMw: mw, peakFloorMw: r(m.peakFloor * mw), offpeakFloorMw: r(m.offpeakFloor * mw),
    window: "18:00 to 10:00 (16 hours); the buyer picks any 6 of them a day ahead", plan: plan.label,
    hoursHeldToPeakFloor: floors.filter((v) => v === m.peakFloor * mw).length,
    ...(picked ? {
      howPicked: `each day, the 6 hours of the window with the highest ${picked.marketLabel} prices`,
      hoursMostOftenPicked: hourRanges(picked.mostOften),
      shareOfDaysPickedByHour: Object.fromEntries(picked.share.map((f, h) => [HOURS24[h], r(f * 100, 0)]).filter(([, v]) => v > 0)),
      averagePricePickedRsPerKwh: r(picked.pickedRsPerKwh, 2), averagePriceWindowRsPerKwh: r(picked.windowRsPerKwh, 2),
    } : {}),
  };
  if (state.lp && hourly?.direct) {
    const d = delivered(hourly);
    const { mean, min } = byHour(d, ["delivered"]);
    series.push(
      { name: "Delivered, average", type: "line", smooth: true, symbol: "none", data: mean.delivered.map((v) => r(v)), lineStyle: { color: DATA_COLORS.bess, width: 2 }, itemStyle: { color: DATA_COLORS.bess } },
      { name: "Delivered, worst hour of the year", type: "line", symbol: "none", data: min.delivered.map((v) => r(v)), lineStyle: { color: DATA_COLORS.unmet, width: 1 }, itemStyle: { color: DATA_COLORS.unmet } },
    );
    const lowAvg = mean.delivered.reduce((a, v, h) => (v < a.mw ? { hour: HOURS24[h], mw: r(v, 0) } : a), { hour: null, mw: Infinity });
    const below = min.delivered.map((v, h) => (v < floors[h] - 0.5 ? HOURS24[h] : null)).filter(Boolean);
    Object.assign(summary, { sized: true, lowestAverageHour: lowAvg, hoursWhereTheWorstDayFallsBelowTheFloor: below });
  } else {
    summary.sized = false;
  }
  return {
    title: "Peak Hours and the floors, by hour of the day",
    caption: `The buyer picks 6 Peak Hours a day, day-ahead, anywhere in the shaded 18:00–10:00 window: ${r(m.peakFloor * 100, 0)}% of ${mw} MW in those, ${r(m.offpeakFloor * 100, 0)}% in every other block.`
      + (picked ? ` Planned on the 6 costliest ${picked.marketLabel} hours of each day; the bars show how often each hour is one of them.` : ""),
    option: { animation: false, grid: picked ? { ...grid, right: 48 } : grid, legend, tooltip: { trigger: "axis", valueFormatter: (v) => `${v} MW` }, xAxis: { type: "category", data: HOURS24, name: "hour" },
      yAxis: picked ? [{ ...axisMw, min: 0 }, { type: "value", name: "% of days", min: 0, max: 100, splitLine: { show: false } }] : { ...axisMw, min: 0 }, series },
    summary,
  };
}

function typicalDay(state, hourly, { month = null } = {}, terms = null) {
  needSized(state, hourly);
  const mo = Number.isInteger(month) && month >= 1 && month <= 12 ? month - 1 : null;
  const gens = ["solar", "wind", "biomass"].filter((k) => hourly[k]);
  const keys = [...gens, "direct", "discharge", "charge", "export", "demand"];
  const { mean } = byHour(hourly, keys, mo === null ? () => true : (t) => E.MONTH_OF_HOUR[t] === mo);
  const share = (k) => mean.direct.map((d, h) => {
    const g = gens.reduce((a, x) => a + mean[x][h], 0);
    return g > 0 ? (d * mean[k][h]) / g : 0;
  });
  const color = { solar: DATA_COLORS.solar, wind: DATA_COLORS.wind, biomass: "#c98b5a" };
  const series = [
    ...gens.map((k) => ({ name: `${k[0].toUpperCase()}${k.slice(1)} to the PPA`, type: "bar", stack: "ppa", data: share(k).map((v) => r(v)), itemStyle: { color: color[k] } })),
    { name: "Battery to the PPA", type: "bar", stack: "ppa", data: mean.discharge.map((v) => r(v)), itemStyle: { color: DATA_COLORS.bess } },
    { name: "Battery charging", type: "bar", data: mean.charge.map((v) => r(-v)), itemStyle: { color: "rgba(169,139,255,0.45)" } },
    { name: "Contracted supply", type: "line", symbol: "none", step: "middle", data: mean.demand.map((v) => r(v)), lineStyle: { color: DATA_COLORS.demand, type: "dashed", width: 1 }, itemStyle: { color: DATA_COLORS.demand } },
    { name: "Floor", type: "line", symbol: "none", step: "middle", data: floorsByHour(state, terms).map((v) => r(v)), lineStyle: { color: DATA_COLORS.signal, width: 1.5 }, itemStyle: { color: DATA_COLORS.signal } },
  ];
  if (mean.export.some((v) => v > 0.5)) series.splice(gens.length + 1, 0, { name: "Sold as surplus", type: "bar", stack: "ppa", data: mean.export.map((v) => r(v)), itemStyle: { color: DATA_COLORS.surplus } });
  const del = mean.direct.map((d, h) => d + mean.discharge[h]);
  const top = (arr) => arr.reduce((a, v, h) => (v > a.mw ? { hour: HOURS24[h], mw: r(v, 0) } : a), { hour: null, mw: -Infinity });
  const when = mo === null ? "an average day of year 1" : `an average day in ${E.MONTHS[mo]} (year 1)`;
  return {
    title: `The plant on ${when}`,
    caption: "Bars: what reaches the PPA each hour, by source, and what charges the battery (below zero). Lines: the contracted supply and the floor under your Peak Hours plan.",
    option: { animation: false, grid, legend, tooltip: { trigger: "axis", valueFormatter: (v) => `${v} MW` }, xAxis: { type: "category", data: HOURS24, name: "hour" }, yAxis: axisMw, series },
    summary: {
      period: when, deliveredAverageMw: r(del.reduce((a, v) => a + v, 0) / 24, 0),
      solarPeak: top(gens.includes("solar") ? mean.solar : new Array(24).fill(0)), batteryDischargePeak: top(mean.discharge), batteryChargingPeak: top(mean.charge),
      hoursBelowFloorOnAverage: del.map((v, h) => (v < floorsByHour(state, terms)[h] - 0.5 ? HOURS24[h] : null)).filter(Boolean),
    },
  };
}

function monthlyEnergy(state, hourly, terms = null) {
  needSized(state, hourly);
  const floors = floorsByHour(state, terms);
  const del = new Array(12).fill(0);
  const short = new Array(12).fill(0);
  const sold = new Array(12).fill(0);
  const contracted = new Array(12).fill(0);
  for (let t = 0; t < E.HOURS; t += 1) {
    const mo = E.MONTH_OF_HOUR[t];
    const d = hourly.direct[t] + (hourly.discharge?.[t] || 0);
    del[mo] += d;
    short[mo] += Math.max(0, floors[E.HOUR_OF_DAY[t]] - d);
    sold[mo] += hourly.export?.[t] || 0;
    contracted[mo] += hourly.demand?.[t] || 0;
  }
  const mu = (a) => a.map((v) => r(v / 1000, 2));
  return {
    title: "Energy by month, year 1",
    caption: "Delivered to the PPA against the contracted energy; the energy short of each hour's floor (penalised at 1.5 × the tariff); the surplus sold.",
    option: {
      animation: false, grid, legend, tooltip: { trigger: "axis", valueFormatter: (v) => `${v} MU` },
      xAxis: { type: "category", data: E.MONTHS }, yAxis: { type: "value", name: "MU" },
      series: [
        { name: "Delivered to the PPA", type: "bar", data: mu(del), itemStyle: { color: DATA_COLORS.bess } },
        { name: "Short of the floors", type: "bar", data: mu(short), itemStyle: { color: DATA_COLORS.unmet } },
        { name: "Surplus sold", type: "bar", data: mu(sold), itemStyle: { color: DATA_COLORS.surplus } },
        { name: "Contracted energy", type: "line", symbol: "none", data: mu(contracted), lineStyle: { color: DATA_COLORS.demand, type: "dashed" }, itemStyle: { color: DATA_COLORS.demand } },
      ],
    },
    summary: {
      deliveredMu: r(del.reduce((a, v) => a + v, 0) / 1000, 0), shortMu: r(short.reduce((a, v) => a + v, 0) / 1000, 2), soldMu: r(sold.reduce((a, v) => a + v, 0) / 1000, 0),
      worstMonth: E.MONTHS[short.indexOf(Math.max(...short))], worstMonthShortMu: r(Math.max(...short) / 1000, 2),
    },
  };
}

function irrVsTariff(state, terms, { from = null, to = null } = {}) {
  needSized(state);
  const first = irrCurve(state, terms, []);
  const t0 = first.target.tariff;
  const lo = Number.isFinite(from) ? from : Math.max(0.5, Math.floor((t0 - 1) * 10) / 10);
  const hi = Number.isFinite(to) && to > lo ? to : Math.ceil((t0 + 0.6) * 10) / 10;
  const step = Math.max(0.05, Math.round(((hi - lo) / 16) * 100) / 100);
  const tariffs = [];
  for (let t = lo; t <= hi + 1e-9; t += step) tariffs.push(Number(t.toFixed(2)));
  const quote = Number.isFinite(state.forms?.tariff) ? state.forms.tariff : null;
  if (quote && !tariffs.includes(quote)) tariffs.push(quote);
  tariffs.sort((a, b) => a - b);
  const c = irrCurve(state, terms, tariffs);
  const pct = (v) => (Number.isFinite(v) ? r(v * 100, 2) : null);
  const at = (t) => c.points.find((p) => p.tariff === t);
  return {
    title: "Equity and project IRR against the tariff quoted",
    caption: `The target equity IRR of ${pct(c.target.targetEquityIrr)}% needs ₹${t0.toFixed(3)}/kWh${quote ? `; your quote ₹${quote.toFixed(2)} gives ${pct(at(quote)?.equityIrr)}% on equity` : ""}.`,
    option: {
      animation: false, grid: { ...grid, left: 48 }, legend, tooltip: { trigger: "axis", valueFormatter: (v) => `${v}%` },
      xAxis: { type: "value", name: "₹/kWh", min: tariffs[0], max: tariffs[tariffs.length - 1] }, yAxis: { type: "value", name: "IRR %" },
      series: [
        { name: "Equity IRR", type: "line", symbol: "circle", symbolSize: 4, data: c.points.map((p) => [p.tariff, pct(p.equityIrr)]), lineStyle: { color: DATA_COLORS.signal, width: 2 }, itemStyle: { color: DATA_COLORS.signal },
          markLine: { symbol: "none", label: { formatter: "{b}", color: "#86867f", fontSize: 10 }, lineStyle: { type: "dashed", color: "#86867f" },
            data: [{ name: `target ${pct(c.target.targetEquityIrr)}%`, yAxis: pct(c.target.targetEquityIrr) }, { name: `₹${t0.toFixed(2)} needed`, xAxis: r(t0, 3) },
              ...(quote ? [{ name: `your quote ₹${quote.toFixed(2)}`, xAxis: quote, lineStyle: { color: DATA_COLORS.unmet, type: "solid" } }] : [])] } },
        { name: "Project IRR", type: "line", symbol: "circle", symbolSize: 4, data: c.points.map((p) => [p.tariff, pct(p.projectIrr)]), lineStyle: { color: DATA_COLORS.wind, width: 2 }, itemStyle: { color: DATA_COLORS.wind } },
      ],
    },
    summary: {
      targetEquityIrrPct: pct(c.target.targetEquityIrr), tariffForTarget: r(t0, 3), projectIrrAtTargetPct: pct(c.target.projectIrr),
      quote: quote ? { tariff: quote, equityIrrPct: pct(at(quote)?.equityIrr), projectIrrPct: pct(at(quote)?.projectIrr) } : null,
      equityIrrPerTenPaisa: c.points.length > 1 ? r(((c.points[c.points.length - 1].equityIrr - c.points[0].equityIrr) * 100) / ((c.points[c.points.length - 1].tariff - c.points[0].tariff) * 10), 2) : null,
    },
  };
}

function cashFlows(state, terms) {
  needSized(state);
  const f = financeOf(state, terms);
  const rows = f.rows;
  const cr = (v) => r(v, 1);
  return {
    title: `The financial model, ${rows.length} years`,
    caption: `At ₹${f.tariff.toFixed(3)}/kWh: revenue after penalties, operating cost, debt service and what is left for equity, year by year (₹ crore).`,
    option: {
      animation: false, grid, legend, tooltip: { trigger: "axis", valueFormatter: (v) => `₹${v} cr` },
      xAxis: { type: "category", data: rows.map((x) => `Y${x.year}`) }, yAxis: { type: "value", name: "₹ cr" },
      series: [
        { name: "Revenue", type: "bar", data: rows.map((x) => cr(x.revenue)), itemStyle: { color: DATA_COLORS.signal } },
        { name: "Operating cost", type: "bar", data: rows.map((x) => cr(-x.opex)), itemStyle: { color: DATA_COLORS.muted } },
        { name: "Penalties", type: "bar", data: rows.map((x) => cr(-x.penalty)), itemStyle: { color: DATA_COLORS.unmet } },
        { name: "Debt service", type: "line", symbol: "none", data: rows.map((x) => cr(x.debtService)), lineStyle: { color: DATA_COLORS.wind }, itemStyle: { color: DATA_COLORS.wind } },
        { name: "Cash to equity", type: "line", symbol: "none", data: rows.map((x) => cr(x.fcfe)), lineStyle: { color: DATA_COLORS.bess, width: 2 }, itemStyle: { color: DATA_COLORS.bess } },
      ],
    },
    summary: {
      tariff: r(f.tariff, 3), equityIrrPct: r(f.equityIrr * 100, 2), projectIrrPct: r(f.projectIrr * 100, 2), minDscr: r(f.minDscr, 2),
      year1RevenueCr: cr(rows[0].revenue), penaltiesOverTermCr: r(f.totals.penalty, 0), equityPaybackYear: f.payback || null,
    },
  };
}

function money(state, terms) {
  needSized(state);
  const z = state.lp.sizes;
  const { costs } = modelInputs(state, terms);
  const capex = capexBySource(z, costs);
  const m = moneyAtStake(z);
  const f = financeOf(state, terms);
  const items = [
    ...Object.entries(capex).filter(([, v]) => v > 0).map(([k, v]) => [`Capex: ${k}`, v, k === "solar" ? DATA_COLORS.solar : k === "wind" ? DATA_COLORS.wind : k === "bess" ? DATA_COLORS.bess : DATA_COLORS.muted]),
    ["Equity", f.equity, DATA_COLORS.signal], ["Debt", f.debt, DATA_COLORS.muted],
    ["Net worth needed", m.netWorthRs / 1e7, DATA_COLORS.demand], ["PBG", m.pbgRs / 1e7, DATA_COLORS.unmet], ["EMD", m.emdRs / 1e7, DATA_COLORS.unmet],
  ];
  return {
    title: "Capex and the money at stake",
    caption: "₹ crore. EMD, PBG and the net worth needed follow the installed solar MW, wind MW and storage MWh (Amendment-02).",
    option: {
      animation: false, grid: { ...grid, left: 130 }, tooltip: { valueFormatter: (v) => `₹${v} cr` },
      xAxis: { type: "value", name: "₹ cr" }, yAxis: { type: "category", data: items.map((x) => x[0]).reverse() },
      series: [{ type: "bar", data: items.map((x) => ({ value: r(x[1], 1), itemStyle: { color: x[2] } })).reverse(), label: { show: true, position: "right", color: "#86867f", fontSize: 10 } }],
    },
    summary: Object.fromEntries(items.map((x) => [x[0], r(x[1], 1)])),
  };
}

/**
 * The chart of `kind` for the bid as it stands: { kind, title, caption, option (ECharts),
 * summary }. Throws an Error saying what is missing (e.g. the plant is not sized).
 */
export function agentChart(kind, { state, terms, hourly = null, params = {} }) {
  switch (kind) {
    case "peak_window": return { kind, ...peakWindow(state, hourly, terms) };
    case "typical_day": return { kind, ...typicalDay(state, hourly, params, terms) };
    case "monthly_energy": return { kind, ...monthlyEnergy(state, hourly, terms) };
    case "irr_vs_tariff": return { kind, ...irrVsTariff(state, terms, params) };
    case "cash_flows": return { kind, ...cashFlows(state, terms) };
    case "money": return { kind, ...money(state, terms) };
    default: throw new Error(`No chart "${kind}". Charts: ${Object.keys(CHART_KINDS).join(", ")}.`);
  }
}
