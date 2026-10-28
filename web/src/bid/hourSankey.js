// One hour of the year-1 dispatch as a see-through Sankey (an SVG string for the chart tooltip):
// where each source's output went, and how the delivery meets the hour's supply condition (SECI
// FDRE-RTC-V: 90% of the contract in every peak block; Amendment-03: 50% in the Solar Hours and
// 70% in the Remaining Hours; before it, 70% in every off-peak block). Plain
// JavaScript, used in Node by tools/check_seci.mjs.
//
// Energy is counted as hourlyAtMeter (bid/model.js) gives it: the contract, the PPA, battery
// discharge and sales at the 220 kV meter; generation, charging and curtailment at the 33 kV bus;
// the transformer and line losses between them.

import { chartColor } from "../themeColors.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mw = (v) => `${Math.round(v).toLocaleString("en-IN")} MW`;
const MIN = 0.5; // MW: smaller flows are left out
const RULE_HOURS = { peak: "Peak", offpeak: "Off-peak", solar: "Solar Hours", remaining: "Remaining Hours", all: "Supply" };

/** The hour's supply condition: the block rule over this hour, what it needs and what was delivered. */
export function hourCondition(hourly, t, { rules = [], peakHour = () => false, solarHour = () => false } = {}) {
  const contracted = hourly.demand?.[t] || 0;
  const delivered = (hourly.direct?.[t] || 0) + (hourly.discharge?.[t] || 0);
  const peak = peakHour(t);
  const solar = !peak && solarHour(t); // an hour picked as a Peak Hour is held as one
  const covers = { all: true, peak, offpeak: !peak, solar, remaining: !peak && !solar };
  const rule = rules.filter((r) => r.basis === "block" && covers[r.hours])
    .sort((a, b) => b.target - a.target)[0] || null;
  const need = rule ? rule.target * contracted : contracted;
  return {
    rule, peak, solar, contracted, delivered, need,
    met: Math.min(delivered, need),
    above: Math.max(0, delivered - need),
    short: Math.max(0, need - delivered),
  };
}

/**
 * The hour's flows: sources → uses → the condition. gens: generator keys in hourly (solar,
 * wind, …); titles and colors by key (bess for the battery). Returns { columns, links }.
 */
export function hourFlows(hourly, t, { gens, titles, colors, rules = [], peakHour = () => false, solarHour = () => false }) {
  const poi = hourly.atMeter || 1;
  const val = (k) => Math.max(0, hourly[k]?.[t] || 0);
  const gen = Object.fromEntries(gens.map((k) => [k, val(k)]));
  const G = Object.values(gen).reduce((a, b) => a + b, 0);
  const direct = val("direct"); // at the meter
  const dis = val("discharge"); // at the meter
  const sold = val("export"); // at the meter
  const charge = val("charge");
  const curtail = val("curtail");
  const loss = val("evacLoss");
  const cond = hourCondition(hourly, t, { rules, peakHour, solarHour });

  const sources = [...gens.filter((k) => gen[k] > MIN).map((k) => ({ id: k, label: titles[k] || k, color: colors[k] }))];
  if (dis > MIN) sources.push({ id: "bess", label: titles.bess || "Battery", color: colors.bess });
  const uses = [
    { id: "ppa", label: "To the PPA", color: colors.ppa || "#d4ff3f" },
    { id: "charge", label: "Battery charging", color: colors.bess },
    { id: "sold", label: "Sold", color: colors.surplus || "#7a8cff" },
    { id: "curtail", label: "Curtailed", color: "#8d8d99" },
    { id: "loss", label: "Losses to the meter", color: "#ff8a5f" },
  ];
  const kind = RULE_HOURS[cond.rule?.hours] || "Supply";
  const ruleLabel = cond.rule ? `${kind} floor ${Math.round(cond.rule.target * 100)}%` : "Contract";
  const right = [{ id: "met", label: `${ruleLabel}: met`, color: "#7ddc9a" }, { id: "above", label: "Above the floor", color: "#4fd1c5" }];
  if (cond.short > MIN) right.push({ id: "short", label: `Short${cond.rule?.penaltyMultiple != null ? ` (${cond.rule.penaltyMultiple}× tariff)` : " of the floor"}`, color: "#ff6b5f", ghost: true });

  const links = [];
  // every flow counts (the nodes add up); only sources under MIN are left out of the picture
  const add = (from, to, v, color) => { if (v > 1e-6) links.push({ from, to, value: v, color }); };
  for (const k of gens) {
    if (!(gen[k] > MIN) || !(G > 0)) continue;
    const s = gen[k] / G;
    add(k, "ppa", s * direct, colors[k]);
    add(k, "charge", s * charge, colors[k]);
    add(k, "sold", s * sold, colors[k]);
    add(k, "curtail", s * curtail, colors[k]);
    // what this source sends to the PPA and the market loses the transformer and line on the way
    add(k, "loss", s * ((direct + sold) / poi) * (1 - poi), colors[k]);
  }
  add("bess", "ppa", dis, colors.bess);
  add("bess", "loss", (dis / poi) * (1 - poi), colors.bess);
  add("ppa", "met", cond.met, "#7ddc9a");
  add("ppa", "above", cond.above, "#4fd1c5");
  // the losses node holds what the links bring; checked against the hour's loss series
  const lossIn = links.filter((l) => l.to === "loss").reduce((a, l) => a + l.value, 0);
  // a node is drawn when it carries at least MIN; its flows still count in the totals
  const carries = (id) => links.filter((l) => l.to === id).reduce((a, l) => a + l.value, 0) >= MIN;
  return { columns: [sources, uses.filter((u) => carries(u.id)), right.filter((r) => r.ghost || carries(r.id))], links, cond, lossCheck: { links: lossIn, series: loss } };
}

/** The flows laid out as an SVG string: translucent bands, nodes with their MW. */
export function sankeySvg(flows, { width = 640, height = 220, mode = "dark" } = {}) {
  const tone = (c) => chartColor(c, mode);
  const { columns, links, cond } = flows;
  const xs = [120, 286, 470];
  const nodeW = 9;
  const gap = 7;
  const top = 6;
  const total = (col, ci) => col.reduce((a, n) => a + nodeValue(n, ci), 0);
  function nodeValue(n, ci) {
    if (n.ghost) return cond.short;
    const out = links.filter((l) => l.from === n.id).reduce((a, l) => a + l.value, 0);
    const inn = links.filter((l) => l.to === n.id).reduce((a, l) => a + l.value, 0);
    return ci === 0 ? out : Math.max(out, inn);
  }
  const span = Math.max(1, ...columns.map((c, ci) => total(c, ci)));
  const usable = height - top * 2 - gap * Math.max(0, Math.max(...columns.map((c) => c.length)) - 1);
  const k = usable / span;
  const pos = {};
  columns.forEach((col, ci) => {
    let y = top;
    for (const n of col) {
      const h = Math.max(1.5, nodeValue(n, ci) * k);
      pos[n.id] = { x: xs[ci], y, h, out: y, in: y, n, value: nodeValue(n, ci) };
      y += h + gap;
    }
  });
  const parts = [];
  for (const l of links) {
    const a = pos[l.from];
    const b = pos[l.to];
    if (!a || !b) continue;
    const h = l.value * k;
    const x0 = a.x + nodeW;
    const x1 = b.x;
    const y0 = a.out;
    const y1 = b.in;
    a.out += h;
    b.in += h;
    const mx = (x0 + x1) / 2;
    parts.push(`<path d="M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z" fill="${esc(tone(l.color))}" fill-opacity="0.32"/>`);
  }
  const text = (x, y, s, anchor, extra = "") => `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" ${extra}>${esc(s)}</text>`;
  for (const { x, y, h, n, value } of Object.values(pos)) {
    const ci = xs.indexOf(x);
    parts.push(n.ghost
      ? `<rect x="${x}" y="${y}" width="${nodeW}" height="${h}" fill="none" stroke="${esc(tone(n.color))}" stroke-dasharray="3 2"/>`
      : `<rect x="${x}" y="${y}" width="${nodeW}" height="${h}" fill="${esc(tone(n.color))}" fill-opacity="0.85"/>`);
    const label = `${n.label} · ${mw(value)}`;
    parts.push(ci === 0 ? text(x - 6, y + h / 2, label, "end") : text(x + nodeW + 6, y + h / 2, label, "start"));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;font:11px var(--font-sans, system-ui);fill:${tone("#f4f4f1")};paint-order:stroke;stroke-linejoin:round" data-sankey="1"><g style="stroke:none">${parts.filter((p) => p.startsWith("<path")).join("")}</g><g style="stroke:${mode === "light" ? "rgba(255,255,255,0.75)" : "rgba(10,10,10,0.55)"};stroke-width:3px">${parts.filter((p) => !p.startsWith("<path")).join("")}</g></svg>`;
}

/** The tooltip for one hour: the hour, the condition's verdict, the Sankey. */
export function hourSankeyHtml(hourly, t, opts) {
  const flows = hourFlows(hourly, t, opts);
  const c = flows.cond;
  const tone = (col) => chartColor(col, opts.mode);
  const verdict = c.short > MIN
    ? `<span style="color:${tone("#ff6b5f")}">short ${mw(c.short)}${c.rule?.penaltyMultiple != null ? `, paid at ${c.rule.penaltyMultiple}× the tariff` : ""}</span>`
    : `<span style="color:${tone("#7ddc9a")}">met</span>`;
  const rule = c.rule ? `${RULE_HOURS[c.rule.hours] || "Supply"} block · floor ${Math.round(c.rule.target * 100)}% of ${mw(c.contracted)} = ${mw(c.need)}` : `Contract ${mw(c.contracted)}`;
  return `<div style="min-width:640px"><div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:4px"><b>${esc(opts.label || "")}</b>`
    + `<span style="opacity:.85">${esc(rule)} · delivered ${mw(c.delivered)} · ${verdict}</span></div>${sankeySvg(flows, { mode: opts.mode })}</div>`;
}
