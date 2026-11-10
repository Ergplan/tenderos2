// The CfD bid agent: the same GPT-Live voice session as the SECI RTC tab (web/src/seci/agent.js,
// whose LiveEvents loop and readValue are reused), with this tab's inputs, tools and instructions.
// The browser runs every tool against the state the screen shows, so a spoken "make the battery
// three megawatt hours per megawatt and size it again" changes the input, re-runs the optimiser and
// reads back the strike price. Plain JavaScript with no browser APIs, checked in Node by
// tools/check_cfd_agent.mjs.
//
// Facts come only from the tools: the tender from its terms (each with document, clause and page),
// the numbers from the model on screen. Nothing the agent says changes a term.
import { readValue } from "../seci/agent.js";
import * as E from "../rtc/engine.js";
import { BENCHMARKS, CHOICES, FIELDS, fillBenchmarks, financials, keyDates, lcCr, missingInputs, rfsAmounts } from "./model.js";
import { DOCUMENTS, RFS, TENDER, TERMS, docById } from "./terms.js";
import { buildScript, explainCfd, explainFinance, explainResults, tenderBrief } from "./voice.js";

export { readValue };
export const LIVE_MODEL = "gpt-live-1";
export const STEPS = ["explain", "documents", "conditions", "bid", "design", "financeInputs", "size", "finance", "whatif", "forms", "reference"];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r = (v, d = 2) => (isNum(v) ? Number(v.toFixed(d)) : null);
const STEP_OF = { project: "design", resource: "design", sourcing: "bid", costs: "financeInputs", fin: "financeInputs" };
const FIN_TERMS = [
  { key: "repayment", label: "Debt repayment method", kind: "choice", options: Object.entries(E.REPAYMENT_METHODS).map(([k, m]) => [k, m.label]), benchmark: "equal" },
  { key: "graceYears", label: "Principal moratorium", unit: "years", min: 0, max: 5, benchmark: 0, int: true },
  { key: "paymentsPerYear", label: "Debt instalments a year", kind: "choice", options: [["1", "Yearly"], ["2", "Half-yearly"], ["4", "Quarterly"], ["12", "Monthly"]], benchmark: "1", number: true },
  { key: "targetDscr", label: "Target DSCR (sculpted repayment)", unit: "×", min: 1, max: 3, benchmark: 1.3 },
  { key: "balloonPct", label: "Balloon share (balloon repayment)", pct: true, min: 0, max: 100, benchmark: 30 },
  { key: "stepUpPct", label: "Principal step-up a year (step-up repayment)", pct: true, min: 0, max: 25, benchmark: 5 },
  { key: "refiYear", label: "Refinance at the end of year (0: never)", unit: "year", min: 0, max: 15, benchmark: 0, int: true },
  { key: "refiRate", label: "Interest rate after refinancing", pct: true, min: 0, max: 25, benchmark: 8.5 },
  { key: "refiTenorYears", label: "Tenor after refinancing", unit: "years", min: 1, max: 15, benchmark: 12, int: true },
  { key: "refiFeePct", label: "Refinancing fee", pct: true, min: 0, max: 5, benchmark: 0.5 },
  { key: "receivableDays", label: "Receivable days", unit: "days", min: 0, max: 180, benchmark: 45 },
  { key: "omStockMonths", label: "O&M in hand", unit: "months", min: 0, max: 6, benchmark: 0 },
  { key: "sparesPctOm", label: "Maintenance spares, share of O&M", pct: true, min: 0, max: 50, benchmark: 0 },
  { key: "wcInterestRate", label: "Interest on working capital", pct: true, min: 0, max: 25, benchmark: 0 },
  { key: "dsraMonths", label: "Debt service reserve", unit: "months", min: 0, max: 12, benchmark: 0 },
];
const COST_TERMS = [
  { key: "constructionMonths", label: "Construction months (0: IDC inside the pre-operative share)", unit: "months", min: 0, max: 36, benchmark: 0, int: true },
  { key: "drawdown", label: "Drawdown profile", kind: "choice", options: Object.entries(E.DRAWDOWN_PROFILES).map(([k, d]) => [k, d.label]), benchmark: "linear" },
  { key: "drawOrder", label: "Funding order", kind: "choice", options: [["proRata", "Debt and equity pro rata"], ["equityFirst", "Equity first, then debt"]], benchmark: "proRata" },
];

// ---------------------------------------------------------------- the inputs the agent can set

/**
 * Every input on screen as { key, label, step, kind, unit, options, get(state), set(state, value),
 * benchmark }. Percent inputs take and give percent (24 means 24%). set returns the new state or
 * throws an Error whose message says what is allowed.
 */
export function agentInputs(state) {
  const out = [];
  const add = (x) => out.push(x);
  const unmark = (s, key) => { const filled = { ...s.filled }; delete filled[key]; return filled; };
  add({ key: "contractedMw", label: "Contracted capacity bid", step: "bid", kind: "number", unit: "MW", min: TENDER.bidMinMw, max: TENDER.bidMaxMw, benchmark: 100,
    get: (s) => s.inputs.contractedMw, set: (s, v) => {
      if (!Number.isInteger(v)) throw new Error("The contracted capacity is quoted in whole megawatts.");
      return { ...s, inputs: { ...s.inputs, contractedMw: v } };
    } });
  add({ key: "effectiveDate", label: "Effective Date of the CfDA", step: "bid", kind: "date", benchmark: BENCHMARKS.effectiveDate,
    get: (s) => s.inputs.effectiveDate, set: (s, v) => ({ ...s, inputs: { ...s.inputs, effectiveDate: v }, filled: unmark(s, "effectiveDate") }) });
  for (const key of ["sellMarket", "useMarket", "useGroup", "merchant", "afterTerm", "augmentation", "shortfallPolicy"]) {
    const c = CHOICES[key];
    const yesNo = !c.options;
    add({ key, label: c.label, step: key === "augmentation" ? "design" : "bid", kind: yesNo ? "boolean" : "choice", options: yesNo ? null : c.options, benchmark: BENCHMARKS[key] ?? null,
      get: (s) => s.inputs[key], set: (s, v) => ({ ...s, inputs: { ...s.inputs, [key]: v }, filled: unmark(s, key) }) });
  }
  if (state.inputs?.afterTerm === "merchant") {
    add({ key: "merchantYears", label: "Years of market sales after the term", step: "bid", kind: "number", unit: "years", min: 0, max: 15, benchmark: 0,
      get: (s) => s.inputs.merchantYears, set: (s, v) => ({ ...s, inputs: { ...s.inputs, merchantYears: Math.round(v) }, filled: unmark(s, "merchantYears") }) });
  }
  for (const f of FIELDS) {
    if (f.key === "contractedMw") continue;
    add({ key: f.key, label: f.label, step: STEP_OF[f.section] || "design", kind: "number", unit: f.pct ? "%" : f.unit, pct: Boolean(f.pct), min: f.min, max: f.max,
      benchmark: BENCHMARKS[f.key] ?? null, get: (s) => s.inputs[f.key], set: (s, v) => ({ ...s, inputs: { ...s.inputs, [f.key]: v }, filled: unmark(s, f.key) }) });
  }
  for (const [section, list] of [["fin", FIN_TERMS], ["costs", COST_TERMS]]) {
    for (const t of list) {
      const key = `${section}.${t.key}`;
      add({ key, label: t.label, step: "financeInputs", kind: t.kind || "number", unit: t.pct ? "%" : t.unit, pct: Boolean(t.pct), options: t.options || null, min: t.min, max: t.max,
        benchmark: t.benchmark, get: (s) => { const v = s[section]?.[t.key]; return t.number && v !== undefined && v !== null ? String(v) : v ?? null; },
        set: (s, v) => ({ ...s, [section]: { ...(s[section] || {}), [t.key]: t.number ? Number(v) : t.int ? Math.round(v) : v } }) });
    }
  }
  add({ key: "quoteTariff", label: "Strike price you will quote", step: "finance", kind: "number", unit: "₹/kWh", min: 0, max: 40, benchmark: null,
    get: (s) => s.quoteTariff ?? null, set: (s, v) => ({ ...s, quoteTariff: Number(Number(v).toFixed(2)), forms: { ...(s.forms || {}), tariff: Number(Number(v).toFixed(2)) } }) });
  return out;
}

/** An input's value as the agent reads it (percent inputs in percent). */
export function shown(input, v) {
  if (v === null || v === undefined || v === "") return null;
  if (input.pct && isNum(v)) return r(v * 100, 3);
  if (input.options) return input.options.find(([k]) => k === v)?.[1] || v;
  return v;
}

// ---------------------------------------------------------------- the guided sequence

/**
 * The next input of the guided exercise: the first, in the guide's order, the bidder has not yet
 * answered or kept in this conversation (`confirmed`, a Set of keys). Null when all are done.
 */
export function nextQuestion(state, confirmed = new Set()) {
  const inputs = Object.fromEntries(agentInputs(state).map((x) => [x.key, x]));
  for (const item of buildScript(state)) {
    if (item.kind === "say" || item.kind === "results" || item.kind === "finance" || item.id === "size") continue;
    if (item.id === "fill") {
      if (!confirmed.has("fill") && missingInputs(state).length > 1) return { key: "fill", question: item.ask, kind: "yesno", hint: "Yes: call use_benchmarks. No: ask each input." };
      continue;
    }
    const input = inputs[item.id];
    if (!input || confirmed.has(item.id)) continue;
    const v = input.get(state);
    return { key: item.id, question: item.ask || `${input.label}?`, kind: input.kind, unit: input.unit || null, options: input.options || null,
      current: shown(input, v), benchmark: shown(input, input.benchmark), step: input.step };
  }
  return null;
}

// ---------------------------------------------------------------- the tender, searchable

const words = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9%.]+/g, " ").split(" ").filter((w) => w.length > 2);
const termOut = (t) => ({ id: t.id, group: t.group, condition: t.label, rule: t.display, status: t.status || "in force", document: docById[t.doc]?.title || t.doc, clause: t.clause, page: t.page, quote: t.quote });

/** Terms matching a query (an exact id, or words scored over label, rule, clause and quote). */
export function tenderLookup(query, limit = 6) {
  const q = String(query || "").trim();
  const exact = TERMS.find((t) => t.id === q);
  if (exact) return [termOut(exact)];
  const qw = words(q);
  if (!qw.length) return [];
  const scored = TERMS.map((t) => {
    const hay = `${t.label} ${t.display} ${t.clause} ${t.group}`.toLowerCase();
    const quote = t.quote.toLowerCase();
    let score = 0;
    for (const w of qw) { if (hay.includes(w)) score += 3; if (quote.includes(w)) score += 1; }
    return { t, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.t.page - b.t.page);
  return scored.slice(0, limit).map((x) => termOut(x.t));
}

/** What one amendment (amd1 to amd4, or "all") changed: the terms it states, and the ones it replaced. */
export function amendmentChanges(which = "all") {
  const ids = which === "all" ? ["amd1", "amd2", "amd3", "amd4"] : [String(which).toLowerCase().replace(/amendment[- ]?0?/, "amd").replace(/^0?(\d)$/, "amd$1")];
  const out = [];
  for (const id of ids) {
    const doc = docById[id];
    if (!doc) continue;
    out.push({ amendment: doc.title, now: TERMS.filter((t) => t.doc === id).map(termOut), replaced: TERMS.filter((t) => t.status === "replaced" && /amend/i.test(t.display) && new RegExp(id.replace("amd", "Amendment-0")).test(t.display)).map(termOut) });
  }
  return out;
}

// ---------------------------------------------------------------- what is on screen

/** The bid as it stands: inputs still needed, the sizing, the strike price, the quote. */
export function status(state, model, run = null) {
  const i = state.inputs;
  const missing = missingInputs(state);
  const quote = isNum(state.quoteTariff) && model ? checkTariff(model, state.quoteTariff) : null;
  return {
    step: state.step,
    bid: { contractedMw: i.contractedMw, effectiveDate: i.effectiveDate, sellMarket: i.sellMarket, useMarket: i.useMarket, useGroup: i.useGroup, merchant: i.merchant, afterTerm: i.afterTerm },
    plant: isNum(i.contractedMw) ? { bessMw: r(i.contractedMw * (i.essMwPerMw || 0), 0), bessMwh: r(i.contractedMw * ((i.essMwhPerMw || 0) + (i.extraEssMwhPerMw || 0)), 0), solarMw: r(i.solarMw, 0), windMw: r(i.windMw, 0) } : null,
    inputsMissing: missing.length ? missing.slice(0, 12) : "none",
    optimizer: run?.active ? `running (${run.done || 0}/${run.total || 0})` : "not running",
    strikePrice: model?.sp ? { forTargetIrr: r(model.sp, 3), quoteRoundedUp: r(model.bid, 2), equityIrrPct: r(model.fin.equityIrr * 100), projectIrrPct: r(model.fin.projectIrr * 100), minDscr: r(model.fin.minDscr) } : null,
    quote: quote ? { strikePrice: state.quoteTariff, ...quote } : state.quoteTariff ? null : "no strike price quoted yet",
    next: missing.length ? "inputs to fill: use next_question" : model?.sp ? "results are ready; run_optimizer sizes the own RE for the lowest strike price" : "ready to size",
  };
}

/** What a strike price the bidder may quote earns on the modelled plant. */
export function checkTariff(model, sp) {
  if (!model || !isNum(sp) || sp <= 0) return null;
  const f = financials(model.inputs, model.sim, sp);
  const target = model.inputs.targetEquityIrr;
  const below = model.sp ? sp < model.sp - 1e-9 : false;
  return {
    status: below ? "below target" : "at or above target",
    equityIrrPct: r(f.equityIrr * 100), projectIrrPct: r(f.projectIrr * 100), targetEquityIrrPct: r(target * 100), minDscr: r(f.minDscr),
    targetStrikePrice: r(model.sp, 3), lcCr: r(lcCr(model.inputs.contractedMw, sp)),
    message: below ? `₹${sp.toFixed(2)}/kWh earns a ${r(f.equityIrr * 100)}% equity IRR, below the ${r(target * 100)}% target; the target needs ₹${model.sp.toFixed(3)}/kWh.` : `₹${sp.toFixed(2)}/kWh earns a ${r(f.equityIrr * 100)}% equity IRR against the ${r(target * 100)}% target.`,
  };
}

// ---------------------------------------------------------------- the tools

const obj = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });

/** The function tools, in the Responses API's format, as the session's backend sees them. */
export const AGENT_TOOLS = [
  { type: "function", name: "get_status", description: "The bid as it stands on screen: the step shown, what is bid, the plant, inputs still needed, whether the optimiser runs, the strike price for the target IRR and the quoted strike price. Call it first and whenever unsure.", parameters: obj() },
  { type: "function", name: "explain_cfd", description: "What a Contract for Difference is in plain words, with this bid's strike price when there is one. Use when the user asks what a CfD is or how they get paid.", parameters: obj() },
  { type: "function", name: "tender_brief", description: "The key conditions of SECI CfD-I after Amendments 01 to 04, as short spoken paragraphs. Use at the start of the guided exercise.", parameters: obj() },
  { type: "function", name: "tender_lookup", description: "Search the tender's conditions (RfS, CfD Agreement, amendments), each with document, clause, page and quote. Pass words (e.g. 'EMD', 'peak hours', 'net worth', 'penalty') or an exact condition id.", parameters: obj({ query: { type: "string" } }, ["query"]) },
  { type: "function", name: "list_conditions", description: "Every condition in force, by group, with document, clause and page. Pass a group to narrow (e.g. 'Dates', 'Plant', 'Energy sourcing', 'CfD settlement').", parameters: obj({ group: { type: ["string", "null"] } }, ["group"]) },
  { type: "function", name: "amendment_changes", description: "What an amendment changed: the terms it states and the ones it replaced. amendment: 'amd1', 'amd2', 'amd3', 'amd4' or 'all'.", parameters: obj({ amendment: { type: "string", enum: ["amd1", "amd2", "amd3", "amd4", "all"] } }, ["amendment"]) },
  { type: "function", name: "next_question", description: "The next input of the guided exercise, in order: the question to ask, its current value and the benchmark. Inputs set with set_input count as answered. Pass `keep` with an input key when the bidder keeps its current value ('next', 'same'), or keep_rest true to accept every remaining value as it stands.", parameters: obj({ keep: { type: ["string", "null"] }, keep_rest: { type: "boolean" } }, ["keep", "keep_rest"]) },
  { type: "function", name: "list_inputs", description: "The inputs of one step with their keys, current values, units, ranges and benchmarks. Percent inputs are in percent.", parameters: obj({ part: { type: "string", enum: ["bid", "design", "financeInputs", "finance", "all"] } }, ["part"]) },
  { type: "function", name: "set_input", description: "Change one input on screen and show it. `value` is what the bidder said: a number (percent inputs in percent, 24 means 24%), a choice key or label, a date (YYYY-MM-DD), yes/no.", parameters: obj({ key: { type: "string" }, value: { type: ["string", "number", "boolean"] } }, ["key", "value"]) },
  { type: "function", name: "use_benchmarks", description: "Fill every empty input with industry benchmarks (2025-26 prices and norms), marked as benchmarks on screen.", parameters: obj() },
  { type: "function", name: "go_to_step", description: "Show a step of the tab.", parameters: obj({ step: { type: "string", enum: STEPS } }, ["step"]) },
  { type: "function", name: "run_optimizer", description: "Size the own RE: tries solar (and wind) sizes for the lowest strike price with every day's supply met within the sourcing limits (one to three minutes); returns the result when done. Run again after inputs change.", parameters: obj() },
  { type: "function", name: "stop_optimizer", description: "Stop a sizing that is running.", parameters: obj() },
  { type: "function", name: "get_results", description: "The modelled plant: the battery and own RE sizes, the strike price for the target IRR, the tender's conditions met or not, days short, penalised weeks, EMD, PBG, net worth and the dates.", parameters: obj() },
  { type: "function", name: "get_financials", description: "The financial model over the 15-year term: the strike price for the target equity IRR, equity and project IRR, DSCR, project cost, debt, the Letter of Credit.", parameters: obj() },
  { type: "function", name: "review_bid", description: "Why the bid is not optimal: findings from the tender's conditions, the price against SECI's peak-power awards, the plant (own RE at its best, the extra battery, the battery's window and fade), the inputs far from the benchmarks and the financing, each with where to fix it. Use when asked whether the bid is good, what is wrong with it, or what to improve.", parameters: obj() },
  { type: "function", name: "check_tariff", description: "What a strike price the bidder may quote earns: equity and project IRR against the target, with a warning when it is below the strike price the target needs. Records it as the quoted strike price when record is true.", parameters: obj({ tariff: { type: "number", description: "₹/kWh" }, record: { type: "boolean" } }, ["tariff", "record"]) },
];

/**
 * Runs the tools against the tab. ctx: { getState(), apply(fn), goto(step), highlight(target),
 * runSizing() (resolves with the optimiser's best or null), stopSizing(), getRun(), getModel() (the
 * model of the state as it stands, or null), getPrices() }.
 */
export function createToolRunner(ctx) {
  const input = (key) => agentInputs(ctx.getState()).find((x) => x.key === key);
  const confirmed = new Set();
  const model = () => (ctx.getModel ? ctx.getModel() : null);
  const tools = {
    get_status: () => status(ctx.getState(), model(), ctx.getRun?.()),
    explain_cfd: () => { ctx.goto("explain"); return { explanation: explainCfd(model()), documents: DOCUMENTS.map((d) => d.title), rfs: RFS.number }; },
    tender_brief: () => ({ conditions: tenderBrief(ctx.getState()) }),
    tender_lookup: ({ query }) => {
      const hits = tenderLookup(query);
      return hits.length ? { matches: hits } : { matches: [], note: "Nothing in the tender documents matches; say so rather than guess." };
    },
    list_conditions: ({ group = null } = {}) => {
      ctx.goto("conditions");
      const list = TERMS.filter((t) => !group || t.group.toLowerCase() === String(group).toLowerCase());
      return { groups: [...new Set(TERMS.map((t) => t.group))], conditions: list.map(termOut) };
    },
    amendment_changes: ({ amendment = "all" } = {}) => { ctx.goto("documents"); return { amendments: amendmentChanges(amendment) }; },
    next_question: ({ keep = null, keep_rest: keepRest = false } = {}) => {
      if (keep) confirmed.add(keep);
      if (keepRest) for (let q = nextQuestion(ctx.getState(), confirmed); q; q = nextQuestion(ctx.getState(), confirmed)) confirmed.add(q.key);
      const q = nextQuestion(ctx.getState(), confirmed);
      if (q?.step) ctx.goto(q.step);
      if (q?.key && q.key !== "fill") ctx.highlight?.(`inputs.${q.key}`);
      return q || { done: true, note: model()?.sp ? "Every input is in and the strike price is on screen; offer run_optimizer to size the own RE." : "Every input is in: offer to run the optimiser." };
    },
    list_inputs: ({ part = "all" } = {}) => ({
      inputs: agentInputs(ctx.getState()).filter((x) => part === "all" || x.step === part).map((x) => ({
        key: x.key, label: x.label, value: shown(x, x.get(ctx.getState())), unit: x.unit || null, ...(x.options ? { options: x.options.map(([k, l]) => `${k}: ${l}`) } : {}),
        ...(x.min !== undefined ? { min: x.min } : {}), ...(x.max !== undefined ? { max: x.max } : {}), benchmark: shown(x, x.benchmark),
      })),
    }),
    set_input: ({ key, value }) => {
      const x = input(key);
      if (!x) return { ok: false, error: `No input "${key}". Use list_inputs for the keys.` };
      let v;
      try { v = readValue(x, value); } catch (err) { return { ok: false, error: err.message }; }
      let next;
      try { next = x.set(ctx.getState(), v); } catch (err) { return { ok: false, error: err.message }; }
      ctx.apply(() => next);
      confirmed.add(key);
      ctx.goto(x.step);
      ctx.highlight?.(key.includes(".") ? key : `inputs.${key}`);
      const out = { ok: true, key, value: shown(x, x.get(next)) };
      if (key === "quoteTariff" && isNum(v)) { const q = checkTariff(model(), v); if (q) out.quote = q; }
      return out;
    },
    use_benchmarks: () => {
      const before = missingInputs(ctx.getState()).length;
      ctx.apply((s) => fillBenchmarks(s));
      confirmed.add("fill");
      ctx.goto("design");
      return { ok: true, filled: before, stillMissing: missingInputs(ctx.getState()) };
    },
    go_to_step: ({ step }) => {
      if (!STEPS.includes(step)) return { ok: false, error: `Steps: ${STEPS.join(", ")}` };
      ctx.goto(step);
      return { ok: true, step };
    },
    run_optimizer: async () => {
      const missing = missingInputs(ctx.getState());
      if (missing.length) return { ok: false, error: `Inputs still empty: ${missing.slice(0, 8).join(", ")}. Ask for them or call use_benchmarks.` };
      if (ctx.getRun?.()?.active) return { ok: false, error: "The optimiser is already running." };
      ctx.goto("size");
      const best = await ctx.runSizing();
      if (!best) return { ok: false, error: "The sizing did not finish." };
      return { ok: true, best: { solarMw: best.solarMw, windMw: best.windMw, strikePrice: r(best.sp, 3), everyDayMet: Boolean(best.ok) }, ...tools.get_results() };
    },
    stop_optimizer: () => { ctx.stopSizing?.(); return { ok: true }; },
    get_results: () => {
      const m = model();
      if (!m) return { ok: false, error: "The inputs are not complete yet." };
      const i = m.inputs;
      const years = m.sim.years;
      const a = rfsAmounts(i);
      return {
        summary: explainResults(m),
        plant: { contractedMw: i.contractedMw, bessMw: r(i.contractedMw * i.essMwPerMw, 0), bessMwh: r(i.contractedMw * ((i.essMwhPerMw || 0) + (i.extraEssMwhPerMw || 0)), 0), solarMw: r(i.solarMw, 0), windMw: r(i.windMw, 0) },
        strikePrice: m.sp ? { forTargetIrr: r(m.sp, 3), quoteRoundedUp: r(m.bid, 2) } : { reason: m.reason },
        supply: { daysShortOfCharging: years.reduce((s, y) => s + y.shortDays, 0), weeksPenalised: years.reduce((s, y) => s + y.weeks.filter((w) => w.beyondMwh > 1e-6).length, 0),
          ownShareAfterMonth36Pct: r(Math.min(...years.filter((y) => y.start >= m.sim.dates.extraUntil).map((y) => y.shareOwn * 100), 100), 1) },
        emdCr: r(a.emdCr), pbgCr: r(a.pbgCr), netWorthNeededCr: r(a.netWorthCr), cacCr: r(a.cacCr),
        dates: Object.fromEntries(Object.entries(keyDates(i.effectiveDate)).map(([k, t]) => [k, new Date(t).toISOString().slice(0, 10)])),
      };
    },
    get_financials: async () => {
      const m = model();
      if (!m?.sp) return { ok: false, error: m ? m.reason || "No strike price reaches the target." : "The inputs are not complete yet." };
      ctx.goto("finance");
      let full = null;
      try {
        const fin = await import("./finance.js");
        if (typeof fin.runCfdFinance === "function") full = fin.runCfdFinance(ctx.getState(), m);
      } catch { full = null; }
      const f = full || m.fin;
      return {
        summary: explainFinance(m, full),
        strikePrice: r(full?.tariff ?? m.sp, 3), quoteRoundedUp: Math.ceil((full?.tariff ?? m.sp) * 100) / 100,
        equityIrrPct: r(f.equityIrr * 100), projectIrrPct: r(f.projectIrr * 100), targetEquityIrrPct: r(m.inputs.targetEquityIrr * 100),
        minDscr: r(f.minDscr), avgDscr: r(f.avgDscr), projectCostCr: r(f.capex.total, 0), debtCr: r(full ? full.debt : f.capex.total * m.inputs.debtFraction, 0),
        letterOfCreditCr: r(lcCr(m.inputs.contractedMw, full?.tariff ?? m.sp)), model: full ? "the full financial model (shared engine)" : "the CfD model",
      };
    },
    review_bid: async () => {
      const m = model();
      if (!m) return { ok: false, error: "The inputs are not complete yet." };
      ctx.goto("size");
      const { reviewBid } = await import("./review.js");
      let finance = m.finance || null;
      if (!finance) {
        try { const fin = await import("./finance.js"); finance = fin.runCfdFinance(ctx.getState(), m); } catch { finance = null; }
      }
      const out = reviewBid({ state: ctx.getState(), model: m, finance, prices: ctx.getPrices?.() || null });
      return { summary: out.summary, counts: out.counts, findings: out.findings.map((f) => ({ severity: f.severity, title: f.title, detail: f.detail, fixOn: f.step })) };
    },
    check_tariff: ({ tariff, record = false }) => {
      const m = model();
      const q = checkTariff(m, Number(tariff));
      if (!q) return { ok: false, error: m ? "Give a strike price above zero." : "The inputs are not complete yet." };
      if (record) {
        const v = Number(Number(tariff).toFixed(2));
        ctx.apply((st) => ({ ...st, quoteTariff: v, forms: { ...(st.forms || {}), tariff: v } }));
        ctx.goto("finance");
        ctx.highlight?.("quoteTariff");
      }
      return { ok: true, tariff: Number(tariff), ...q, recorded: Boolean(record) };
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

export const CFD_GREETING = "Open the conversation: greet the bid manager in one short sentence, say you can explain what a Contract for Difference is, walk them through SECI's CfD-I bid step by step, size the own generation and explain the strike price, or answer any question about the tender, and ask whether to start.";

export const LIVE_INSTRUCTIONS = `You are the voice of the TenderOS bid agent for SECI's CfD-I tender: assured peak supply of 1,000 MWh a day (500 MW for 2 hours) from ISTS-connected renewable projects with storage, sold through the power exchanges under a Contract for Difference. You speak with a bid manager in India while a backend agent works the bid model on their screen.

Speak briefly: one to three sentences, then let the user talk. Use Indian number words (lakh, crore) and say units in full. Use the user's language if they switch.

Delegate to the backend whenever the user asks what a CfD is, asks about the tender or an amendment, gives or changes any input, asks to size or re-size the own generation, asks about results, the strike price, IRR, the financial model or the price to quote, or says next or go on. Never state a tender condition, an input value or a result yourself unless the backend has just given it to you; if you do not know, say you will check and delegate.

Lead a guided model-filling exercise. At the start, greet the user in one sentence and ask the backend to explain the CfD in two sentences, brief the key conditions and give the first question. After each answer, ask the backend to set it and fetch the next question. When everything is in, offer to size the own generation. While it runs (a minute or more), say so; you can keep answering questions meanwhile. Then explain the results and the strike price, ask what price they want to quote, and finish with the bid forms.

When the backend reports a warning, such as a quoted price below what the target IRR needs, an input out of range or a condition not met, say it plainly with the numbers it gave.`;

export const BACKEND_INSTRUCTIONS = `You operate the SECI CfD-I bid model in the user's browser through function tools, for a voice assistant that speaks your results aloud.

Truth rules:
- Every statement about the tender comes from explain_cfd, tender_brief, tender_lookup, list_conditions or amendment_changes, and you name the document, clause and page. If the tools find nothing, say the tender documents do not say.
- Every number about the bid comes from get_status, get_results, get_financials or check_tariff. Never estimate.
- Inputs change only through set_input or use_benchmarks, with the value the user gave. Do not invent a value; if a needed detail is unclear, ask for it.

The guided exercise:
1. get_status. If nothing is entered yet, explain_cfd in two sentences, tender_brief, then next_question.
2. Ask exactly the question next_question returns, mentioning the current value and the benchmark. When the user answers, set_input with that key, confirm the value set, then next_question again. "Next", "keep it" or "same" keeps the current value: call next_question with keep set to that key. "Keep the rest" accepts all remaining values: keep_rest true. "Benchmark" sets the benchmark. For the key "fill", yes means use_benchmarks.
3. When next_question says everything is in, offer run_optimizer; when it returns, explain the plant, the strike price, the conditions met, the days short and the penalised weeks, EMD, PBG, net worth and the dates (get_results).
4. get_financials: the strike price for the target equity IRR, rounded up to the paisa for quoting, the equity and project IRR, the DSCR and the Letter of Credit.
5. Ask what strike price they will quote; check_tariff with record true. If it is below the strike price the target needs, warn clearly and give the equity and project IRR at that price.
6. Point them to the bid forms step (go_to_step forms) for the particulars and the letters.

At any time: answer tender questions with tender_lookup or list_conditions; explain an amendment with amendment_changes; change any input the user names (list_inputs gives the keys; percent inputs are in percent, 24 means 24%); after a change, offer to run the optimiser again; go_to_step to show what you talk about.

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
