// The SECI RTC bid agent: GPT-Live (gpt-live-1) talks with the bidder while a backend model,
// configured as the session's Responses delegation, works the bid on screen through the function
// tools below. The browser runs every tool against the same state the screen shows, so a spoken
// "make the wind CUF 35 percent and size it again" changes the input, re-runs HiGHS and reads back
// the new result. Plain JavaScript with no browser APIs (the WebRTC connection is in
// LiveAgent.jsx), checked in Node by tools/check_seci.mjs.
//
// Facts come only from the tools: the tender from its pack (each with document and page), the
// numbers from the sizing and the financial model. Nothing the agent says is written into the
// tender pack or used to change a rule.
import { BENCHMARKS, FINANCE_FIELDS, SOURCE_FIELDS, fillBenchmarks, missingInputs, modelInputs, opsFromLp } from "../bid/model.js";
import { liveModelRequest } from "../bid/liveModelRequest.js";
import { explainGeneration } from "../model/explainGeneration.js";
import { quotedReturns } from "../bid/quote.js";
import { PACK, PEAK_PLANS, SHORTFALL_MODES, keyDates, moneyAtStake } from "./terms.js";
import { FORM_FIELDS, bidChecks, formIssues, visibleFields } from "./forms.js";
import { applies, blankValue, formatPrint, formatStatus, formatsSummary } from "./formats.js";
import { CHART_KINDS, agentChart } from "./charts.js";
import { buildScript, explainFinance, explainResults, financeOf, parseDate, parseNumber } from "./voice.js";

export const LIVE_MODEL = "gpt-live-1";

const STEPS = ["documents", "conditions", "bid", "sources", "size", "finance", "forms"];
const SECI_SOURCES = ["solar", "wind", "biomass", "bess"];
const NAMES = { solar: "Solar", wind: "Wind", biomass: "Biomass", bess: "Battery" };
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r = (v, d = 2) => (isNum(v) ? Number(v.toFixed(d)) : null);

// ---------------------------------------------------------------- the inputs the agent can set

/**
 * Every input on screen as { key, label, step, kind, unit, options, get(state), set(state, value),
 * benchmark }. Percent inputs take and give percent (24 means 24%). set returns the new state or
 * throws an Error whose message says what is allowed.
 */
export function agentInputs(state) {
  const m = PACK.model;
  const out = [];
  const add = (x) => out.push(x);
  const clear = (s) => ({ ...s, lp: null });
  add({ key: "bidMw", label: "Contracted capacity bid", step: "bid", kind: "number", unit: "MW", min: m.minBidMw, max: m.maxBidMw,
    get: (s) => s.bid.baseMw, benchmark: 300, set: (s, v) => clear({ ...s, bid: { ...s.bid, baseMw: Math.round(v), greenshoe: false } }) });
  add({ key: "peakPlan", label: "Peak Hours plan", step: "bid", kind: "choice", options: Object.entries(PEAK_PLANS).map(([k, p]) => [k, p.label]),
    get: (s) => s.seci.peakPlan, benchmark: "price", set: (s, v) => clear({ ...s, seci: { ...s.seci, peakPlan: v } }) });
  add({ key: "shortfall", label: "Shortfall plan", step: "bid", kind: "choice", options: Object.entries(SHORTFALL_MODES).map(([k, p]) => [k, p.label]),
    get: (s) => s.seci.shortfall, benchmark: "penalty", set: (s, v) => clear({ ...s, seci: { ...s.seci, shortfall: v } }) });
  add({ key: "ppaDate", label: "Expected PPA Effective Date", step: "bid", kind: "date",
    get: (s) => s.seci.ppaDate, benchmark: null, set: (s, v) => ({ ...s, seci: { ...s.seci, ppaDate: v } }) });
  for (const id of SECI_SOURCES) {
    add({ key: `use.${id}`, label: `${NAMES[id]} in the plant`, step: "sources", kind: "boolean",
      get: (s) => Boolean(s.sources[id]), benchmark: ["solar", "wind", "bess"].includes(id),
      set: (s, v) => {
        if (id === "bess" && !v) throw new Error("Storage is mandatory in this tender; the battery cannot be switched off.");
        return clear({ ...s, sources: { ...s.sources, [id]: Boolean(v) } });
      } });
    if (!state.sources[id]) continue;
    add({ key: `${id}.size`, label: `${NAMES[id]} size (a number fixes it; "auto" lets HiGHS choose)`, step: "sources", kind: "size", unit: id === "bess" ? "MW" : "MW",
      get: (s) => (s.src[id].capacity.mode === "fixed" ? s.src[id].capacity.mw : "auto"), benchmark: "auto",
      set: (s, v) => clear({ ...s, src: { ...s.src, [id]: { ...s.src[id], capacity: v === "auto" ? { mode: "optimise", mw: null } : { mode: "fixed", mw: v } } } }) });
    for (const f of SOURCE_FIELDS[id]) {
      add({ key: `${id}.${f.key}`, label: `${NAMES[id]} ${f.label}`, step: "sources", kind: f.options ? "choice" : "number", options: f.options || null,
        unit: f.pct ? "%" : f.unit, pct: Boolean(f.pct), min: f.min, max: f.max, benchmark: BENCHMARKS[id]?.[f.key] ?? null,
        get: (s) => s.src[id][f.key],
        set: (s, v) => clear({ ...s, src: { ...s.src, [id]: { ...s.src[id], [f.key]: v } }, filled: { ...s.filled, [`${id}.${f.key}`]: false } }) });
    }
  }
  for (const f of FINANCE_FIELDS) {
    add({ key: `${f.section}.${f.key}`, label: f.label, step: "sources", kind: "number", unit: f.pct ? "%" : f.unit, pct: Boolean(f.pct), min: f.min, max: f.max,
      benchmark: BENCHMARKS[f.section]?.[f.key] ?? null, get: (s) => s[f.section][f.key],
      set: (s, v) => clear({ ...s, [f.section]: { ...s[f.section], [f.key]: v }, filled: { ...s.filled, [`${f.section}.${f.key}`]: false } }) });
  }
  add({ key: "market.sell", label: "Sell surplus above the contracted capacity at the exchange (GDAM)", step: "sources", kind: "boolean",
    get: (s) => s.market.sell, benchmark: null, set: (s, v) => clear({ ...s, market: { ...s.market, sell: Boolean(v), source: s.market.source === "flat" ? "flat" : "GDAM" }, filled: { ...s.filled, "market.sell": false } }) });
  add({ key: "sites.split", label: "Solar and wind on separate sites (each battery charges from its own site)", step: "sources", kind: "boolean",
    get: (s) => Boolean(s.sites?.split), benchmark: false, set: (s, v) => clear({ ...s, sites: { ...s.sites, split: Boolean(v) } }) });
  for (const f of visibleFields(state.forms || {})) {
    add({ key: `forms.${f.key}`, label: f.label, step: "forms", kind: f.type === "select" ? "choice" : f.type === "number" ? "number" : f.type === "date" ? "date" : "text",
      options: f.options || null, unit: f.key === "tariff" ? "₹/kWh" : f.key === "netWorthCr" ? "₹ cr" : undefined, min: f.type === "number" ? 0 : undefined,
      get: (s) => s.forms?.[f.key] ?? null, benchmark: null, set: (s, v) => ({ ...s, forms: { ...s.forms, [f.key]: v } }) });
  }
  // each format's own blanks (the shared ones are the particulars above)
  for (const fmt of PACK.formats) {
    if (applies(state, fmt) === "no") continue;
    for (const x of fmt.fields) {
      if (blankValue(state, fmt, x).source !== "own") continue;
      add({ key: `forms.${fmt.id}.${x.key}`, label: `Format ${fmt.id}: ${x.label}`, step: "forms", format: fmt.id,
        kind: x.kind === "choice" ? "choice" : x.kind === "number" ? "number" : x.kind === "date" ? "date" : "text",
        options: x.kind === "choice" ? x.options.map((o) => [o, o]) : null, get: (s) => s.forms?.[`${fmt.id}.${x.key}`] ?? null, benchmark: null,
        set: (s, v) => ({ ...s, forms: { ...s.forms, [`${fmt.id}.${x.key}`]: v }, formsView: fmt.id }) });
    }
  }
  return out;
}

/** A spoken or typed value for an input, checked against its kind and range. */
export function readValue(input, value) {
  const text = String(value ?? "").trim();
  if (input.kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (/^(yes|true|on|y|sell|split|1)$/i.test(text)) return true;
    if (/^(no|false|off|n|0)$/i.test(text)) return false;
    throw new Error(`${input.label}: say yes or no.`);
  }
  if (input.kind === "choice") {
    const t = text.toLowerCase();
    const hit = input.options.find(([k, label]) => k.toLowerCase() === t || label.toLowerCase() === t)
      || input.options.find(([k, label]) => t && (label.toLowerCase().includes(t) || t.includes(k.toLowerCase())));
    if (!hit) throw new Error(`${input.label}: choose one of ${input.options.map(([k, label]) => `${k} (${label})`).join(", ")}.`);
    return hit[0];
  }
  if (input.kind === "date") {
    const d = parseDate(text);
    if (!d) throw new Error(`${input.label}: give a date such as 2026-06-07.`);
    return d;
  }
  if (input.kind === "text") {
    if (!text) throw new Error(`${input.label}: give a value.`);
    return text.slice(0, 2000);
  }
  if (input.kind === "size" && /^(auto|optimi[sz]e|free|any|let .*choose)/i.test(text)) return "auto";
  const n = isNum(value) ? value : parseNumber(text);
  if (n === null || !isNum(n)) throw new Error(`${input.label}: give a number${input.unit ? ` in ${input.unit}` : ""}.`);
  const lo = input.min ?? (input.kind === "size" ? 0 : -Infinity);
  const hi = input.max ?? Infinity;
  if (n < lo - 1e-9 || n > hi + 1e-9) throw new Error(`${input.label}: ${n}${input.unit === "%" ? "%" : ""} is outside ${lo} to ${hi === Infinity ? "any" : hi}${input.unit ? ` ${input.unit}` : ""}.`);
  return input.pct ? n / 100 : n;
}

/** An input's value as the agent reads it (percent inputs in percent). */
function shown(input, v) {
  if (v === null || v === undefined || v === "") return null;
  if (input.pct && isNum(v)) return r(v * 100, 3);
  if (input.options) return input.options.find(([k]) => k === v)?.[1] || v;
  return v;
}

// ---------------------------------------------------------------- the guided sequence

const SCRIPT_KEYS = { bidMw: "bidMw", peakPlan: "peakPlan", shortfall: "shortfall", ppaDate: "ppaDate", market: "market.sell" };

/**
 * The next input of the guided exercise: the first, in the guide's order, the bidder has not yet
 * answered or kept in this conversation (`confirmed`, a Set of keys). Null when all are done.
 */
export function nextQuestion(state, terms, confirmed = new Set()) {
  const inputs = Object.fromEntries(agentInputs(state).map((x) => [x.key, x]));
  for (const item of buildScript(state)) {
    if (item.kind === "say" || item.kind === "results" || item.kind === "finance" || item.id === "size") continue;
    if (item.id === "fill") {
      if (!confirmed.has("fill") && missingInputs(state, terms).length > 1) return { key: "fill", question: item.ask, kind: "yesno", hint: "Yes: call use_benchmarks. No: ask each input." };
      continue;
    }
    const key = SCRIPT_KEYS[item.id] || item.id;
    const input = inputs[key];
    if (!input || confirmed.has(key)) continue;
    const v = input.get(state);
    return { key, question: item.ask || `${input.label}?`, kind: input.kind, unit: input.unit || null, options: input.options || null,
      current: shown(input, v), benchmark: shown(input, input.benchmark), step: input.step };
  }
  return null;
}

// ---------------------------------------------------------------- the tender, searchable

const words = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9%.]+/g, " ").split(" ").filter((w) => w.length > 2);
const docTitle = (id) => PACK.documents.find((d) => d.id === id)?.title || id;
const cite = (q) => (q ? { document: docTitle(q.doc), page: q.page, quote: q.quote } : null);

/** The tender's conditions, amendments and clarifications that best match the words asked about. */
export function tenderLookup(query, limit = 5) {
  const want = words(query);
  const items = [
    ...PACK.conditions.map((c) => ({ kind: "condition", id: c.id, title: c.label, text: `${c.label} ${c.group} ${c.value} ${c.was || ""} ${c.flag || ""} ${c.sources.map((q) => q.quote).join(" ")}`,
      out: { kind: "condition", id: c.id, label: c.label, group: c.group, rule: c.value, status: c.status, ...(c.was ? { was: c.was } : {}), ...(c.flag ? { flag: c.flag } : {}), ...(c.by ? { changedBy: docTitle(c.by) } : {}), sources: c.sources.map(cite) } })),
    ...PACK.changes.map((c) => ({ kind: "change", id: c.id, title: c.topic, text: `${c.topic} ${c.clause} ${c.effect} ${c.before?.quote || ""} ${c.after?.quote || ""}`,
      out: { kind: "amendment", id: c.id, topic: c.topic, by: docTitle(c.doc), clause: `${c.document} ${c.clause}`, effect: c.effect, was: cite(c.before), now: cite(c.after) } })),
    ...PACK.clarifications.map((c) => ({ kind: "clarification", id: `q${c.no}`, title: c.topic, text: `${c.topic} ${c.clause} ${c.request} ${c.response}`,
      out: { kind: "clarification", query: c.no, topic: c.topic, clause: c.clause, asked: c.request, seci: c.response, source: cite(c.quote) } })),
  ];
  const exact = items.find((x) => x.id === String(query).trim());
  if (exact) return [exact.out];
  const scored = items.map((x) => {
    const have = words(x.text);
    const title = words(x.title);
    const score = want.reduce((a, w) => a + (title.some((t) => t.startsWith(w)) ? 3 : 0) + (have.some((t) => t.startsWith(w)) ? 1 : 0), 0);
    return { x, score };
  }).filter((y) => y.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((y) => y.x.out);
}

/** The key conditions, as the guide explains them (the guide's own words, from the pack). */
export function tenderBrief(state) {
  return buildScript(state).filter((i) => i.kind === "say" && i.id.startsWith("c.")).map((i) => i.say);
}

// ---------------------------------------------------------------- what is on screen

/** The bid as it stands: inputs still needed, the sizing, the financials, the quote and the forms. */
export function status(state, terms, run = null) {
  const lp = state.lp;
  const fin = lp ? financeOf(state, terms) : null;
  const quote = isNum(state.forms?.tariff) ? quotedReturns(state, terms, state.forms.tariff) : null;
  const missing = missingInputs(state, terms);
  return {
    step: state.step,
    bid: { contractedMw: state.bid.baseMw, peakPlan: PEAK_PLANS[state.seci.peakPlan]?.label, shortfall: SHORTFALL_MODES[state.seci.shortfall]?.label, ppaDate: state.seci.ppaDate },
    sources: SECI_SOURCES.filter((id) => state.sources[id]).map((id) => NAMES[id]),
    inputsMissing: missing.length ? missing.slice(0, 12) : "none",
    optimizer: run?.active ? "running" : lp ? "sized" : run?.error ? `failed: ${run.error}` : "not run",
    plant: lp ? { solarMw: r(lp.sizes.solarMw, 0), solarMwp: r(lp.sizes.solarMw * (state.src.solar.dcAc || 1), 0), windMw: r(lp.sizes.windMw, 0), bessMw: r(lp.sizes.bessMw, 0), bessMwh: r(lp.sizes.bessMwh, 0), sizingTariff: r(lp.tariff, 3) } : null,
    financials: fin ? { bidTariff: r(fin.tariff, 3), equityIrrPct: r(fin.equityIrr * 100), projectIrrPct: r(fin.projectIrr * 100), minDscr: r(fin.minDscr) } : null,
    quote: quote ? { tariff: quote.tariff, status: quote.status, equityIrrPct: r(quote.equityIrr * 100), projectIrrPct: r(quote.projectIrr * 100), message: quote.message } : state.forms?.tariff ? null : "no tariff quoted yet",
    formsToFill: formIssues(state).length,
    next: missing.length ? "inputs to fill: use next_question" : lp ? "results are ready" : "ready to size",
  };
}

// ---------------------------------------------------------------- the tools

const obj = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });

/** The function tools, in the Responses API's format, as the session's backend sees them. */
export const AGENT_TOOLS = [
  { type: "function", name: "get_status", description: "The bid as it stands on screen: the step shown, the bid, the sources, inputs still needed, whether the optimizer ran, the plant, the financials (bid tariff, equity and project IRR), the quoted tariff and the next input. Call it first and whenever unsure.", parameters: obj() },
  { type: "function", name: "tender_brief", description: "The key bid conditions of SECI RTC-TM-V after the amendments, as short spoken paragraphs. Use at the start of the guided exercise.", parameters: obj() },
  { type: "function", name: "tender_lookup", description: "Search the tender: its conditions after the amendments, what each amendment changed, and SECI's clarifications, each with document, page and quote. Pass words (e.g. 'EMD', 'peak hours penalty', 'net worth') or an exact condition id.", parameters: obj({ query: { type: "string" } }, ["query"]) },
  { type: "function", name: "next_question", description: "The next input of the guided model-filling exercise, in order: the question to ask, its current value and the benchmark. Inputs set with set_input count as answered. Pass `keep` with an input key when the bidder keeps its current value ('next', 'same'), or keep_rest true to accept every remaining value as it stands.", parameters: obj({ keep: { type: ["string", "null"], description: "Input key the bidder keeps as it is, or null" }, keep_rest: { type: "boolean" } }, ["keep", "keep_rest"]) },
  { type: "function", name: "list_inputs", description: "The inputs of one part of the screen with their keys, current values, units, ranges and benchmarks. Percent inputs are in percent.", parameters: obj({ part: { type: "string", enum: ["bid", "sources", "forms", "all"] } }, ["part"]) },
  { type: "function", name: "set_input", description: "Change one input on screen and show it. `value` is what the bidder said: a number (percent inputs in percent, 24 means 24%), a choice key or label, a date (YYYY-MM-DD), yes/no, 'auto' for a size, or text. Changing a sizing input clears the sizing until the optimizer runs again.", parameters: obj({ key: { type: "string" }, value: { type: ["string", "number", "boolean"] } }, ["key", "value"]) },
  { type: "function", name: "use_benchmarks", description: "Fill every empty sizing and financing input with industry benchmarks (CERC norms, 2025-26 prices), marked as benchmarks on screen.", parameters: obj() },
  { type: "function", name: "go_to_step", description: "Show a step of the tab.", parameters: obj({ step: { type: "string", enum: STEPS } }, ["step"]) },
  { type: "function", name: "run_optimizer", description: "Size the plant with HiGHS against every peak and off-peak block (takes one to a few minutes); returns the result when done. Run again after inputs change.", parameters: obj() },
  { type: "function", name: "stop_optimizer", description: "Stop a sizing that is running.", parameters: obj() },
  { type: "function", name: "get_results", description: "The sized plant: sizes, sizing tariff, the share of hours each floor is met, the shortfall, EMD, PBG, the net worth needed and the dates.", parameters: obj() },
  { type: "function", name: "get_financials", description: "The 25-year financial model of the sized plant: the tariff for the target equity IRR, equity IRR, project IRR, DSCR, project cost, debt, penalties.", parameters: obj() },
  { type: "function", name: "check_tariff", description: "What a tariff the bidder may quote earns: equity IRR and project IRR at that tariff against the target, with a warning when it is below the tariff the target needs. Also records it as the tariff quoted in the bid forms when record is true.", parameters: obj({ tariff: { type: "number", description: "₹/kWh" }, record: { type: "boolean" } }, ["tariff", "record"]) },
  { type: "function", name: "review_bid_forms", description: "The bid forms: the particulars still empty, every RfS format this bid needs with its blanks left and whether the bidder reviewed it, and every check against the tender (capacity, tariff, storage, substation, net worth, experience, EMD, PBG, dates).", parameters: obj() },
  { type: "function", name: "open_format", description: "Show one RfS bid format on screen (e.g. '7.1' Covering Letter, '7.6' Financial Requirement, '7.10' Financial Bid) or 'particulars', and list its blanks: the input key to set each with set_input, the value now, where it comes from, and the RfS words around the blank with the page.", parameters: obj({ id: { type: "string" } }, ["id"]) },
  { type: "function", name: "show_chart", description: `Open a chart beside the conversation, drawn from the bid itself, and get a short summary of what it shows to describe it. Use it whenever the user asks to see, draw, plot or compare something, and on your own when a picture explains better: ${Object.entries(CHART_KINDS).map(([k, v]) => `${k}: ${v}`).join("; ")}.`,
    parameters: obj({ kind: { type: "string", enum: Object.keys(CHART_KINDS) }, month: { type: ["integer", "null"], description: "typical_day only: 1-12, or null for the whole year" }, from: { type: ["number", "null"], description: "irr_vs_tariff only: lowest tariff, or null" }, to: { type: ["number", "null"], description: "irr_vs_tariff only: highest tariff, or null" } }, ["kind", "month", "from", "to"]) },
  { type: "function", name: "explain_generation", description: "How the plant's energy is worked out, with the bid's own numbers from the traceable financial model (the same as the Excel model): for solar and wind, MW × CUF × 365 days × 24 hours ÷ 1,000 = million units, the year's degradation and the losses to the 33 kV bus; the twelve months (MW × month's CUF × days × 24); a day's 96 fifteen-minute blocks (MW × capacity factor × ¼ hour); and what the dispatch did with the year's energy (delivered, sold, curtailed). Use it whenever the user asks how energy, generation, CUF or units are calculated, or gives their own figure to check (their_mu). show true opens that line of the traceable model on screen with its drill-down.", parameters: obj({
    source: { type: "string", enum: ["solar", "wind", "all"] },
    year: { type: ["integer", "null"], description: "PPA year, 1 if not said" },
    month: { type: ["integer", "null"], description: "1-12 for a month's figure, else null" },
    day: { type: ["integer", "null"], description: "Day of that month for its 15-minute blocks, else null" },
    their_mu: { type: ["number", "null"], description: "The user's own figure in million units (MU) to check, else null" },
    show: { type: "boolean" },
  }, ["source", "year", "month", "day", "their_mu", "show"]) },
  { type: "function", name: "mark_format_reviewed", description: "Record that the bidder has reviewed a format as filled. Only when the bidder says they have reviewed it.", parameters: obj({ id: { type: "string" }, reviewed: { type: "boolean" } }, ["id", "reviewed"]) },
];

/** The traceable model's request for the sized plant, as the Financials step builds it. */
function liveOf(state, terms) {
  const { costs, fin, bess } = modelInputs(state, terms);
  const ops = opsFromLp(state.lp, fin, bess);
  const finance = financeOf(state, terms);
  return liveModelRequest({ state, lp: state.lp, finance, costs, fin, bess, ops, dfrTarget: 0 });
}

/**
 * Runs the tools against the tab. ctx: { getState() (the latest state, updated at once by apply),
 * apply(fn) (set the state), getTerms(), goto(step), highlight(target), runSizing() (resolves
 * with the sizing or null), stopSizing(), getRun(), getHourly() (the year-1 hourly dispatch),
 * showChart(chart) (open the chart window), showTrace({ line, year, drill }) (open the traceable
 * model at a line) }.
 */
export function createToolRunner(ctx) {
  const input = (key) => agentInputs(ctx.getState()).find((x) => x.key === key);
  const confirmed = new Set(); // inputs the bidder answered or kept in this conversation
  const target = (key) => (key.startsWith("forms.") ? `form.${key.slice(6)}` : key);
  const tools = {
    get_status: () => status(ctx.getState(), ctx.getTerms(), ctx.getRun?.()),
    tender_brief: () => ({ conditions: tenderBrief(ctx.getState()) }),
    tender_lookup: ({ query }) => {
      const hits = tenderLookup(query);
      return hits.length ? { matches: hits } : { matches: [], note: "Nothing in the tender documents matches; say so rather than guess." };
    },
    next_question: ({ keep = null, keep_rest: keepRest = false } = {}) => {
      if (keep) confirmed.add(keep);
      if (keepRest) for (let q = nextQuestion(ctx.getState(), ctx.getTerms(), confirmed); q; q = nextQuestion(ctx.getState(), ctx.getTerms(), confirmed)) confirmed.add(q.key);
      const q = nextQuestion(ctx.getState(), ctx.getTerms(), confirmed);
      if (q?.step) ctx.goto(q.step);
      if (q?.key && q.key !== "fill") ctx.highlight?.(target(q.key));
      return q || { done: true, note: ctx.getState().lp ? "Every input is in and the plant is sized." : "Every input is in: offer to run the optimizer." };
    },
    list_inputs: ({ part = "all" } = {}) => ({
      inputs: agentInputs(ctx.getState()).filter((x) => part === "all" || x.step === part || (part === "sources" && x.step === "sources")).map((x) => ({
        key: x.key, label: x.label, value: shown(x, x.get(ctx.getState())), unit: x.unit || null, ...(x.options ? { options: x.options.map(([k, l]) => `${k}: ${l}`) } : {}),
        ...(x.min !== undefined && x.min !== -Infinity ? { min: x.min } : {}), ...(x.max !== undefined ? { max: x.max } : {}), benchmark: shown(x, x.benchmark),
      })),
    }),
    set_input: ({ key, value }) => {
      const x = input(key);
      if (!x) return { ok: false, error: `No input "${key}". Use list_inputs for the keys.` };
      let v;
      try { v = readValue(x, value); } catch (err) { return { ok: false, error: err.message }; }
      const before = ctx.getState();
      let next;
      try { next = x.set(before, v); } catch (err) { return { ok: false, error: err.message }; }
      ctx.apply(() => next);
      confirmed.add(key);
      ctx.goto(x.step);
      ctx.highlight?.(target(key));
      const out = { ok: true, key, value: shown(x, x.get(next)) };
      if (before.lp && !next.lp) out.note = "The sizing was cleared: run the optimizer again for new results.";
      if (key === "forms.tariff" && isNum(v)) {
        const q = quotedReturns(next, ctx.getTerms(), v);
        if (q) out.quote = { status: q.status, equityIrrPct: r(q.equityIrr * 100), projectIrrPct: r(q.projectIrr * 100), message: q.message };
      }
      return out;
    },
    use_benchmarks: () => {
      const before = missingInputs(ctx.getState(), ctx.getTerms()).length;
      ctx.apply((s) => fillBenchmarks(s, ctx.getTerms()));
      confirmed.add("fill");
      ctx.goto("sources");
      return { ok: true, filled: before, stillMissing: missingInputs(ctx.getState(), ctx.getTerms()) };
    },
    go_to_step: ({ step }) => {
      if (!STEPS.includes(step)) return { ok: false, error: `Steps: ${STEPS.join(", ")}` };
      ctx.goto(step);
      return { ok: true, step };
    },
    run_optimizer: async () => {
      const missing = missingInputs(ctx.getState(), ctx.getTerms());
      if (missing.length) return { ok: false, error: `Inputs still empty: ${missing.slice(0, 8).join(", ")}. Ask for them or call use_benchmarks.` };
      if (ctx.getRun?.()?.active) return { ok: false, error: "The optimizer is already running." };
      ctx.goto("size");
      const lp = await ctx.runSizing();
      if (!lp) return { ok: false, error: ctx.getRun?.()?.error || "The sizing did not finish." };
      ctx.apply((s) => ({ ...s, lp }));
      return { ok: true, ...tools.get_results() };
    },
    stop_optimizer: () => { ctx.stopSizing(); return { ok: true }; },
    get_results: () => {
      const s = ctx.getState();
      if (!s.lp) return { ok: false, error: "The plant is not sized yet." };
      const z = s.lp.sizes;
      const money = moneyAtStake(z);
      const y1 = s.lp.perYear?.[0] || {};
      return {
        summary: explainResults(s),
        plant: { solarMw: r(z.solarMw, 0), solarMwp: r(z.solarMw * (s.src.solar.dcAc || 1), 0), windMw: r(z.windMw, 0), bessMw: r(z.bessMw, 0), bessMwh: r(z.bessMwh, 0) },
        sizingTariff: r(s.lp.tariff, 3),
        year1Floors: (y1.rules || []).map((x) => ({ floor: x.id, hoursMetPct: r((x.hoursMet ?? 1) * 100, 1), shortfallMu: r(x.shortfallMu ?? 0, 2) })),
        emdCr: r(money.emdRs / 1e7), pbgCr: r(money.pbgRs / 1e7), netWorthNeededCr: r(money.netWorthRs / 1e7),
        dates: keyDates(s.seci.ppaDate),
      };
    },
    get_financials: () => {
      const s = ctx.getState();
      const f = financeOf(s, ctx.getTerms());
      if (!f) return { ok: false, error: "Size the plant first." };
      return {
        summary: explainFinance(s, f),
        bidTariff: r(f.tariff, 3), quoteRoundedUp: Math.ceil(f.tariff * 100) / 100, equityIrrPct: r(f.equityIrr * 100), projectIrrPct: r(f.projectIrr * 100),
        targetEquityIrrPct: r(s.fin.targetEquityIrr * 100), minDscr: r(f.minDscr), avgDscr: r(f.avgDscr), projectCostCr: r(f.capex.total, 0), debtCr: r(f.debt, 0),
        penaltiesOverTermCr: r(f.totals.penalty, 0), year1DeliveredMu: r(f.rows[0].deliveredMu, 0),
      };
    },
    check_tariff: ({ tariff, record = false }) => {
      const s = ctx.getState();
      const q = quotedReturns(s, ctx.getTerms(), Number(tariff));
      if (!q) return { ok: false, error: s.lp ? "Give a tariff above zero." : "Size the plant first." };
      if (record) {
        ctx.apply((st) => ({ ...st, forms: { ...st.forms, tariff: Number(Number(tariff).toFixed(2)) } }));
        ctx.goto("finance");
        ctx.highlight?.("quoteTariff");
      }
      return { ok: true, status: q.status, tariff: q.tariff, targetTariff: r(q.targetTariff, 3), equityIrrPct: r(q.equityIrr * 100), projectIrrPct: r(q.projectIrr * 100),
        targetEquityIrrPct: r(q.targetEquityIrr * 100), message: q.message, recorded: Boolean(record) };
    },
    review_bid_forms: () => {
      const s = ctx.getState();
      ctx.goto("forms");
      const sum = formatsSummary(s);
      return {
        particularsStillEmpty: formIssues(s),
        particularKeys: FORM_FIELDS.map((f) => `forms.${f.key}`),
        formats: { needed: sum.needed, reviewed: sum.reviewed, blanksLeft: sum.blanksLeft,
          list: PACK.formats.map((f) => ({ f, st: formatStatus(s, f) })).filter(({ st }) => st.applies !== "no")
            .map(({ f, st }) => ({ id: f.id, title: f.title, needed: st.applies, blanksLeft: st.missing.length, reviewed: st.reviewed || "no" })) },
        checks: bidChecks(s, ctx.getTerms()).map((c) => ({ check: c.label, status: { ok: "OK", bad: "NOT MET", warn: "CHECK", todo: "TO DO" }[c.status], detail: c.detail })),
      };
    },
    open_format: ({ id }) => {
      const s = ctx.getState();
      ctx.goto("forms");
      if (id === "particulars") {
        ctx.apply((st) => ({ ...st, formsView: "particulars" }));
        return { particulars: visibleFields(s.forms || {}).map((x) => ({ key: `forms.${x.key}`, label: x.label, value: s.forms?.[x.key] ?? null, required: Boolean(x.required) })) };
      }
      const fmt = PACK.formats.find((f) => f.id.toLowerCase() === String(id).toLowerCase().replace(/^format\s*/, ""));
      if (!fmt) return { ok: false, error: `No format ${id}. Formats: ${PACK.formats.map((f) => f.id).join(", ")}` };
      ctx.apply((st) => ({ ...st, formsView: fmt.id }));
      const st = formatStatus(s, fmt);
      return {
        id: fmt.id, title: fmt.title, purpose: fmt.purpose, signedBy: fmt.submittedBy, paper: fmt.paper, envelope: fmt.envelope, when: fmt.when, needed: st.applies,
        rfsPages: fmt.pages, reviewed: st.reviewed || "no",
        blanks: fmt.fields.map((x) => {
          const b = blankValue(s, fmt, x);
          return { label: x.label, value: b.value || null, from: b.source === "model" ? "the bid (not editable)" : b.source === "shared" ? "the particulars" : "this format",
            key: b.source === "model" ? null : b.source === "shared" ? `forms.${b.key}` : `forms.${fmt.id}.${x.key}`, rfs: { page: x.context.page, words: x.context.quote } };
        }),
        enclose: (fmt.attachments || []).map((a) => a.label),
      };
    },
    show_chart: ({ kind, month = null, from = null, to = null }) => {
      let chart;
      try {
        chart = agentChart(kind, { state: ctx.getState(), terms: ctx.getTerms(), hourly: ctx.getHourly?.() || null, params: { month, from, to } });
      } catch (err) {
        return { ok: false, error: err.message };
      }
      ctx.showChart?.(chart);
      return { ok: true, shown: chart.title, caption: chart.caption, summary: chart.summary };
    },
    explain_generation: ({ source = "all", year = 1, month = null, day = null, their_mu: theirMu = null, show = false }) => {
      const s = ctx.getState();
      if (!s.lp) return { ok: false, error: "Size the plant first: the generation is worked out on the sized plant." };
      const res = explainGeneration(liveOf(s, ctx.getTerms()), { source, year, month, day, theirMu });
      if (res.ok && show) {
        ctx.goto("finance");
        ctx.showTrace?.(res.show);
      }
      return res;
    },
    mark_format_reviewed: ({ id, reviewed }) => {
      const fmt = PACK.formats.find((f) => f.id === id);
      if (!fmt) return { ok: false, error: `No format ${id}.` };
      ctx.apply((st) => {
        const next = { ...(st.formsReview || {}) };
        if (reviewed) next[fmt.id] = { at: new Date().toISOString(), print: formatPrint(st, fmt) };
        else delete next[fmt.id];
        return { ...st, formsReview: next, formsView: fmt.id };
      });
      ctx.goto("forms");
      return { ok: true, id: fmt.id, reviewed: Boolean(reviewed) };
    },
  };
  return async function run(name, args = {}) {
    const fn = tools[name];
    if (!fn) return { ok: false, error: `Unknown tool ${name}` };
    try {
      return await fn(args || {});
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  };
}

// ---------------------------------------------------------------- the prompts

export const LIVE_INSTRUCTIONS = `You are the voice of the TenderOS bid agent for SECI's RTC-TM-V tender: 1,000 MW of round-the-clock thermal-mimic power from ISTS-connected renewable projects with storage. You speak with a bid manager in India while a backend agent works the bid model on their screen.

Speak briefly: one to three sentences, then let the user talk. Use Indian number words (lakh, crore) and say units in full. Use the user's language if they switch.

Delegate to the backend whenever the user asks about the tender, asks to see, draw or compare something (the backend opens a chart beside you), gives or changes any input, asks to run or re-run the optimiser, asks about results, financials, IRR, the tariff to quote or the bid forms, or says next or go on. Never state a tender condition, an input value or a result yourself unless the backend has just given it to you; if you do not know, say you will check and delegate.

Lead a guided model-filling exercise. At the start, greet the user in one sentence and ask the backend to brief the key bid conditions and give the first question. After each answer, ask the backend to set it and fetch the next question. When everything is in, offer to run the optimiser. While it runs (a minute or more), say so; you can keep answering questions about the tender meanwhile. Then explain the results and the financials, ask what tariff they want to quote, and finish with the bid forms.

A CFO or reviewer may ask how the energy is worked out or read out their own calculation (for example "785 times 25 percent times 8,760"). Delegate: the backend works it out from the model and opens it on screen. Say the formula with its numbers, megawatts times CUF times 365 days times 24 hours, and confirm their figure or say exactly what differs. Do not call it the solver's number: the generation is a formula, and the dispatch only decides where each hour's energy goes.

When the backend reports a warning, such as a tariff below what the target IRR needs, an input out of range or a check not met, say it plainly with the numbers it gave.`;

export const BACKEND_INSTRUCTIONS = `You operate the SECI RTC-TM-V bid model in the user's browser through function tools, for a voice assistant that speaks your results aloud.

Truth rules:
- Every statement about the tender comes from tender_brief or tender_lookup, and you name the document and page. If the tools find nothing, say the tender documents do not say.
- Every number about the bid comes from get_status, get_results, get_financials or check_tariff. Never estimate.
- Inputs change only through set_input or use_benchmarks, with the value the user gave. Do not invent a value; if a needed detail is unclear, ask for it.

The guided exercise:
1. get_status. If nothing is entered yet, tender_brief, then next_question.
2. Ask exactly the question next_question returns, mentioning the current value and the benchmark. When the user answers, set_input with that key, confirm the value set, then next_question again. "Next", "keep it" or "same" keeps the current value: call next_question with keep set to that key. "Keep the rest" accepts all remaining values: keep_rest true. "Benchmark" sets the benchmark. For the key "fill", yes means use_benchmarks.
3. When next_question says everything is in, offer run_optimizer; when it returns, explain the plant, the tariff, how often each floor is met, the shortfall, EMD, PBG, net worth and the dates (get_results).
4. get_financials: the tariff for the target equity IRR, rounded up to the paisa for quoting, the equity IRR and the project IRR, the minimum DSCR and the penalties.
5. Ask what tariff they will quote; check_tariff with record true. If it is below the target tariff, warn clearly and give the equity IRR and the project IRR at that tariff.
6. review_bid_forms. Fill the particulars first (open_format "particulars"), then each RfS format the bid needs in order: open_format, read out its blanks still empty, set them as the user answers (the keys come from open_format), and ask the user to review it on screen; mark_format_reviewed only when they say it is reviewed.

Show, don't only tell: call show_chart whenever the user asks to see, draw, plot or compare something, and on your own when explaining the Peak Hours and the floors (peak_window), how the sized plant runs through a day (typical_day), the energy month by month (monthly_energy), what a tariff earns (irr_vs_tariff), the cash flows (cash_flows) or the money at stake (money). Then describe the chart in one or two sentences from its summary.

How the energy is worked out: when the user asks how generation, energy, CUF or million units are calculated, asks for a month or a day in 15-minute blocks, or reads out their own figure to check, call explain_generation with show true (their_mu when they give a figure, in million units; convert from MWh or kWh if they say so). Say the steps it returns with the numbers: megawatts times CUF times 365 times 24 divided by a thousand, then the degradation and the losses to the bus if any. If they gave a figure, start with the verdict: it matches, or what it leaves out. Say the dispatch does not make the energy; it only decides where each hour's energy goes, and give the delivered, sold and not used figures when asked. Point out the Excel cell when they want to check it in the workbook.

At any time: answer tender questions with tender_lookup; change any input the user names (list_inputs gives the keys; percent inputs are in percent, 24 means 24%); after a change that clears the sizing, offer to run the optimizer again; go_to_step to show what you talk about.

Reply in plain spoken sentences, at most about 80 words, no markdown, lists or tables. In the guided exercise, end with the next question.`;

/** The session request POST /v1/live/sessions takes (transport added by the server). */
export function liveSessionConfig({ backendModel, voice, greeting = null }) {
  return {
    model: LIVE_MODEL,
    instructions: LIVE_INSTRUCTIONS,
    ...(voice ? { audio: { output: { voice } } } : {}),
    ...(greeting ? { input: [{ type: "message", role: "developer", content: [{ type: "input_text", text: greeting }] }] } : {}),
    delegation: {
      type: "responses",
      responses: { model: backendModel, instructions: BACKEND_INSTRUCTIONS, tools: AGENT_TOOLS, tool_choice: "auto", parallel_tool_calls: false },
    },
  };
}

// ---------------------------------------------------------------- the session's events

/**
 * The GPT-Live event loop on the data channel, without the transport: transcripts in, function
 * calls from the Responses backend run with runTool and answered (response.item.create with the
 * function_call_output, then response.create to continue). send(obj) writes to the data channel.
 * on: { status(text), heard(text) (user speech), said(text) (assistant speech), tool(name, args,
 * result), error(message), closed(usage) }.
 */
export class LiveEvents {
  constructor({ send, runTool, on = {} }) {
    this.send = send;
    this.runTool = runTool;
    this.on = on;
    this.ready = false;
    this.calls = new Map(); // delegation id -> { calls: [{call_id, promise}], completed }
    this.seq = 0;
  }

  id(prefix) {
    this.seq += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.seq}`;
  }

  /** One message from the data channel (a JSON string or an object). */
  async handle(message) {
    const ev = typeof message === "string" ? JSON.parse(message) : message;
    switch (ev.type) {
      case "session.started":
        this.ready = true;
        this.on.status?.("connected");
        return;
      case "session.input_transcript.delta":
        this.on.heard?.(ev.delta || "");
        return;
      case "session.output_transcript.delta":
        this.on.said?.(ev.delta || "");
        return;
      case "session.delegation.created":
        this.on.status?.("working");
        return;
      case "response.event":
        await this.backend(ev.delegation_id || "default", ev.event || {});
        return;
      case "error":
        this.on.error?.(ev.error?.message || ev.message || "The voice session reported an error.");
        return;
      case "session.closed":
        this.ready = false;
        this.on.closed?.(ev.usage || null);
        return;
      default:
    }
  }

  async backend(delegation, ev) {
    let entry = this.calls.get(delegation);
    if (!entry || ev.type === "response.created") {
      entry = { calls: [], completed: false };
      this.calls.set(delegation, entry);
    }
    if (ev.type === "response.output_item.done" && ev.item?.type === "function_call") {
      const { call_id: callId, name } = ev.item;
      let args = {};
      try { args = ev.item.arguments ? JSON.parse(ev.item.arguments) : {}; } catch { args = {}; }
      const promise = Promise.resolve(this.runTool(name, args)).then((result) => {
        this.on.tool?.(name, args, result);
        return result;
      });
      entry.calls.push({ callId, promise });
      return;
    }
    if (ev.type === "response.completed" || ev.type === "response.incomplete") {
      if (!entry.calls.length) { this.calls.delete(delegation); this.on.status?.("connected"); return; }
      const pending = entry.calls.splice(0);
      const results = await Promise.all(pending.map((c) => c.promise.then((result) => ({ callId: c.callId, result }))));
      for (const { callId, result } of results) {
        this.send({ type: "response.item.create", event_id: this.id("tool"), item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) } });
      }
      this.send({ type: "response.create", event_id: this.id("continue") });
      return;
    }
    if (ev.type === "response.failed") {
      this.calls.delete(delegation);
      this.on.error?.(ev.response?.error?.message || "The backend could not finish that request.");
    }
  }
}
