// The FDRE-X Bid tab's voice agent: the same GPT-Live session as the SECI RTC tab (its LiveEvents
// loop in LiveAgent.jsx, readValue for spoken values), with this tender's inputs, tools and
// instructions on the Tender to Bid state of FdrexBidTab.jsx. The browser runs every tool against
// the state the screen shows, so a spoken "take the evening hours and size it again" changes the
// input, re-runs HiGHS and reads back the new tariff. Plain JavaScript with no browser APIs,
// checked in Node by tools/check_fdrex_bid_agent.mjs.
//
// Facts come only from the tools: the tender from its terms (./terms.js, each with document, clause
// and page) and from the pack's record of Amendment-01 (./pack.js), the numbers from the sizing,
// the financial model, the quote check and the What-if on screen. Nothing the agent says changes a
// term.
import { readValue } from "../seci/agent.js";
import { financeOf } from "../seci/voice.js";
import { BRIDGE, FDREX_BENCHMARKS, LATEST, MARKET_CASE, NOT_VERIFIED, RESULTS, againstMarket, applyMarketCase } from "./marketCase.js";
import { BENCHMARKS, FINANCE_FIELDS, SOURCE_FIELDS, fillBenchmarks, missingInputs, modelInputs, opsFromLp, dsmFor } from "../bid/model.js";
import { liveModelRequest } from "../bid/liveModelRequest.js";
import { quotedReturns } from "../bid/quote.js";
import { explainGeneration } from "../model/explainGeneration.js";
import { runWhatIf, whatIfFromBid } from "../whatif/model.js";
import { DEFAULT_SETTINGS, PEAK_PLANS, SHORTFALL_MODES, TENDER, keyDates, moneyAtStake, seciChargesCr } from "./bidTerms.js";
import { formsView } from "./bidState.js";
import { TERMS } from "./terms.js";
import { amendmentChanges, tenderLookup } from "./agent.js";
import { FORM_FIELDS, bidChecks, formIssues, visibleFields } from "./forms.js";
import { FORMATS, applies, blankValue, formatPrint, formatStatus, formatsSummary } from "./formats.js";

export { readValue };
export const LIVE_MODEL = "gpt-live-1";
export const STEPS = ["documents", "conditions", "bid", "sources", "financeInputs", "size", "finance", "whatif", "forms"];
const SOURCES = ["solar", "wind", "bess"];
const NAMES = { solar: "Solar", wind: "Wind", bess: "Storage" };
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r = (v, d = 2) => (isNum(v) ? Number(v.toFixed(d)) : null);
const pct = (v) => Math.round(v * 100);
const AMENDMENTS = ["amd1"];

// ---------------------------------------------------------------- the inputs the agent can set

/**
 * Every input on screen as { key, label, step, kind, unit, options, get(state), set(state, value),
 * benchmark }. Percent inputs take and give percent (24 means 24%). set returns the new state or
 * throws an Error whose message says what is allowed. A change to the bid or the design clears the
 * sizing, as the screen does.
 */
export function agentInputs(state) {
  const out = [];
  const add = (x) => out.push(x);
  const clear = (s) => ({ ...s, lp: null });
  const fx = (s, v) => clear({ ...s, fdrex: { ...DEFAULT_SETTINGS, ...s.fdrex, ...v } });
  add({ key: "bidMw", label: "Contracted capacity bid", step: "bid", kind: "number", unit: "MW", min: TENDER.bidMinMw, max: TENDER.bidMaxMw,
    get: (s) => s.bid.baseMw, benchmark: 100,
    set: (s, v) => {
      if (!Number.isInteger(Math.round(v)) || v < TENDER.bidMinMw || v > TENDER.bidMaxMw) throw new Error(`Bid ${TENDER.bidMinMw} to ${TENDER.bidMaxMw} MW, in whole megawatts.`);
      return clear({ ...s, bid: { ...s.bid, baseMw: Math.round(v), greenshoe: false } });
    } });
  add({ key: "peakPlan", label: "The buyer's four hours each day", step: "bid", kind: "choice", options: Object.entries(PEAK_PLANS).map(([k, p]) => [k, p.label]),
    get: (s) => s.fdrex?.peakPlan, benchmark: "price", set: (s, v) => fx(s, { peakPlan: v }) });
  add({ key: "shortfall", label: "Shortfall plan", step: "bid", kind: "choice", options: Object.entries(SHORTFALL_MODES).map(([k, p]) => [k, p.label]),
    get: (s) => s.fdrex?.shortfall, benchmark: "penalty", set: (s, v) => fx(s, { shortfall: v }) });
  add({ key: "buy", label: `Buy green-market or bilateral power (within ${pct(TENDER.marketShare)}% of each year's energy)`, step: "bid", kind: "boolean",
    get: (s) => Boolean(s.fdrex?.buy), benchmark: true, set: (s, v) => fx(s, { buy: Boolean(v) }) });
  if (state.fdrex?.buy) {
    add({ key: "buyCharges", label: "Charges on bought power to the meter (exchange fee, transmission, losses)", step: "bid", kind: "number", unit: "₹/kWh", min: 0, max: 5,
      get: (s) => s.fdrex?.buyCharges, benchmark: DEFAULT_SETTINGS.buyCharges, set: (s, v) => fx(s, { buyCharges: v }) });
  }
  add({ key: "dayInjection", label: "Grid connectivity in the solar hours too (the tender asks for the non-solar hours only)", step: "bid", kind: "boolean",
    get: (s) => Boolean(s.fdrex?.dayInjection), benchmark: false, set: (s, v) => fx(s, { dayInjection: Boolean(v) }) });
  add({ key: "psm", label: `Cover under SECI's Payment Security Mechanism (₹${TENDER.psmChargeRsPerKwh}/kWh off every bill)`, step: "bid", kind: "boolean",
    get: (s) => Boolean(s.fdrex?.psm), benchmark: false, set: (s, v) => fx(s, { psm: Boolean(v) }) });
  add({ key: "ppaDate", label: "Expected PPA Effective Date", step: "bid", kind: "date",
    get: (s) => s.fdrex?.ppaDate || null, benchmark: null, set: (s, v) => ({ ...s, fdrex: { ...DEFAULT_SETTINGS, ...s.fdrex, ppaDate: v } }) });
  for (const id of SOURCES) {
    add({ key: `use.${id}`, label: `${NAMES[id]} in the plant`, step: "sources", kind: "boolean",
      get: (s) => Boolean(s.sources[id]), benchmark: true,
      set: (s, v) => {
        if (id === "bess" && !v) throw new Error("Storage is mandatory in this tender; it cannot be switched off.");
        if (!v && !SOURCES.some((k) => k !== id && k !== "bess" && s.sources[k])) throw new Error("Keep solar or wind: the supply must be renewable.");
        return clear({ ...s, sources: { ...s.sources, [id]: Boolean(v) } });
      } });
    if (!state.sources[id]) continue;
    add({ key: `${id}.size`, label: `${NAMES[id]} size in MW (a number fixes it; "auto" lets the optimizer choose)`, step: "sources", kind: "size", unit: "MW",
      get: (s) => (s.src[id].capacity.mode === "fixed" ? s.src[id].capacity.mw : "auto"), benchmark: "auto",
      set: (s, v) => clear({ ...s, src: { ...s.src, [id]: { ...s.src[id], capacity: v === "auto" ? { mode: "optimise", mw: null } : { mode: "fixed", mw: v } } } }) });
    for (const f of SOURCE_FIELDS[id] || []) {
      add({ key: `${id}.${f.key}`, label: `${NAMES[id]} ${f.label}`, step: "sources", kind: f.options ? "choice" : "number", options: f.options || null,
        unit: f.pct ? "%" : f.unit, pct: Boolean(f.pct), min: f.min, max: f.max, benchmark: FDREX_BENCHMARKS[id]?.[f.key] ?? BENCHMARKS[id]?.[f.key] ?? null,
        get: (s) => s.src[id][f.key],
        set: (s, v) => clear({ ...s, src: { ...s.src, [id]: { ...s.src[id], [f.key]: v } }, filled: { ...s.filled, [`${id}.${f.key}`]: false } }) });
    }
  }
  for (const f of FINANCE_FIELDS) {
    add({ key: `${f.section}.${f.key}`, label: f.label, step: f.section === "costs" ? "sources" : "financeInputs", kind: "number", unit: f.pct ? "%" : f.unit, pct: Boolean(f.pct), min: f.min, max: f.max,
      benchmark: FDREX_BENCHMARKS[f.section]?.[f.key] ?? BENCHMARKS[f.section]?.[f.key] ?? null, get: (s) => s[f.section][f.key],
      set: (s, v) => clear({ ...s, [f.section]: { ...s[f.section], [f.key]: v }, filled: { ...s.filled, [`${f.section}.${f.key}`]: false } }) });
  }
  add({ key: "market.sell", label: "Sell the surplus on the exchange outside the buyer's hours (on the Bid inputs step; PPA 9.3 offers excess energy to SECI first)", step: "bid", kind: "boolean",
    get: (s) => Boolean(s.market.sell), benchmark: true,
    set: (s, v) => clear({ ...s, market: { ...s.market, sell: Boolean(v), source: v && (!s.market.source || s.market.source === "flat") ? "GDAM" : s.market.source }, filled: { ...s.filled, "market.sell": false } }) });
  if (state.market?.sell) {
    add({ key: "market.source", label: "Market the surplus is sold on (IEX 15-minute prices built in)", step: "bid", kind: "choice",
      options: [["GDAM", "IEX GDAM (green day-ahead)"], ["DAM", "IEX DAM (day-ahead)"], ["RTM", "IEX RTM (real-time)"]],
      get: (s) => s.market.source, benchmark: "GDAM", set: (s, v) => clear({ ...s, market: { ...s.market, source: v } }) });
  }
  const view = formsView(state);
  for (const f of visibleFields(state.forms || {})) {
    add({ key: `forms.${f.key}`, label: f.label, step: "forms", kind: f.type === "select" ? "choice" : f.type === "number" ? "number" : f.type === "date" ? "date" : "text",
      options: f.options || null, unit: f.key === "tariff" ? "₹/kWh" : /Cr$/.test(f.key) ? "₹ cr" : undefined, min: f.type === "number" ? 0 : undefined,
      get: (s) => s.forms?.[f.key] ?? null, benchmark: null, set: (s, v) => ({ ...s, forms: { ...s.forms, [f.key]: v } }) });
  }
  for (const fmt of FORMATS) {
    if (applies(view, fmt) === "no") continue;
    for (const x of fmt.fields) {
      if (x.kind === "table" || blankValue(view, fmt, x).source !== "own") continue;
      add({ key: `forms.${fmt.id}.${x.key}`, label: `Format ${fmt.id}: ${x.label}`, step: "forms", format: fmt.id,
        kind: x.kind === "choice" ? "choice" : x.kind === "number" ? "number" : x.kind === "date" ? "date" : "text",
        options: x.kind === "choice" ? (x.options || []).map((o) => [o, o]) : null, get: (s) => s.forms?.[`${fmt.id}.${x.key}`] ?? null, benchmark: null,
        set: (s, v) => ({ ...s, forms: { ...s.forms, [`${fmt.id}.${x.key}`]: v }, formsView: fmt.id }) });
    }
  }
  return out;
}

function shown(input, v) {
  if (v === null || v === undefined || v === "") return null;
  if (input.pct && isNum(v)) return r(v * 100, 3);
  if (input.options) return input.options.find(([k]) => k === v)?.[1] || v;
  return v;
}

// ---------------------------------------------------------------- the guided sequence

/** The guided exercise's order: what the bidder decides, then the design inputs (or the benchmarks). */
const GUIDE = [
  { key: "bidMw", ask: `How many megawatts will you bid? Between ${TENDER.bidMinMw} and ${TENDER.bidMaxMw}, in whole megawatts.` },
  { key: "peakPlan", ask: "Which four hours a day should the plant plan for: the four costliest non-solar hours each day, as a buyer would most likely name them, or the evening, six to ten?" },
  { key: "shortfall", ask: "If a month falls short: pay the penalty beyond the free ten percent, or meet every month in full?" },
  { key: "buy", ask: `Will you buy green-market or bilateral power, up to ${pct(TENDER.marketShare)} percent of each year's energy, when it is cheaper than more plant?` },
  { key: "buyCharges", ask: "What charges do you expect on bought power to your meter, in rupees per unit: the exchange fee, the transmission charges and the losses?" },
  { key: "dayInjection", ask: "Will you hold grid connectivity in the solar hours as well? Without it nothing is sold between six in the morning and six in the evening." },
  { key: "market.sell", ask: "Will you sell the surplus on the exchange outside the buyer's hours? The RfS allows it; the PPA offers excess energy to SECI first, so the model assumes SECI does not take it." },
  { key: "market.source", ask: "On which market: the green day-ahead market, the day-ahead market or the real-time market?" },
  { key: "psm", ask: `Will you opt for SECI's Payment Security Mechanism? It takes ${Math.round(TENDER.psmChargeRsPerKwh * 100)} paise off every unit billed.` },
  { key: "ppaDate", ask: `When do you expect the PPA's Effective Date? Supply starts ${TENDER.scdMonths} months later. Say a date like 1 June 2027.` },
  { key: "fill", ask: "Shall I fill the design and financing inputs still empty with the benchmarks, marked as such on screen, so we can size? Say no to give each one." },
];

/**
 * The next input of the guided exercise: the first, in GUIDE's order, the bidder has not yet
 * answered or kept in this conversation (`confirmed`, a Set of keys); then the design inputs
 * still empty. Null when all are done.
 */
export function nextQuestion(state, terms, confirmed = new Set()) {
  const inputs = Object.fromEntries(agentInputs(state).map((x) => [x.key, x]));
  for (const g of GUIDE) {
    if (confirmed.has(g.key)) continue;
    if (g.key === "fill") {
      if (missingInputs(state, terms).length > 1) return { key: "fill", question: g.ask, kind: "yesno", hint: "Yes: call use_benchmarks. No: ask each input." };
      continue;
    }
    const input = inputs[g.key];
    if (!input) continue;
    return { key: g.key, question: g.ask, kind: input.kind, unit: input.unit || null, options: input.options || null,
      current: shown(input, input.get(state)), benchmark: shown(input, input.benchmark), step: input.step };
  }
  const missing = Object.values(inputs).find((x) => x.step !== "forms" && !confirmed.has(x.key) && (x.get(state) === null || x.get(state) === undefined) && x.key !== "ppaDate");
  if (missing) return { key: missing.key, question: `${missing.label}?`, kind: missing.kind, unit: missing.unit || null, options: missing.options || null, current: null, benchmark: shown(missing, missing.benchmark), step: missing.step };
  return null;
}

// ---------------------------------------------------------------- the tender

const term = (id) => tenderLookup(id)[0] || null;
const sourceOf = (t) => (t ? { document: t.document, clause: t.clause, page: t.page, quote: t.quote } : null);

/** The key conditions in short spoken paragraphs, each with the terms it rests on (document, clause, page, quote). */
export function tenderBrief() {
  const T = TENDER;
  const brief = [
    { say: `SECI's FDRE-X tender buys assured peak supply: ${(T.totalMw * T.mwhPerMwDay).toLocaleString("en-IN")} megawatt hours a day, ${T.totalMw.toLocaleString("en-IN")} megawatts for ${T.peakHours} hours, from ISTS-connected renewable projects with energy storage, at one fixed tariff for ${T.termYears} years under a PPA with SECI.`, ids: ["mandate", "term"] },
    { say: `For every contracted megawatt you supply ${T.mwhPerMwDay} megawatt hours a day, at most ${T.maxMwhPerMwHour} in an hour, in the ${T.peakHours} hours the Buying Entity names each morning from the non-solar hours. The supply is reconciled monthly: ${pct(T.shortfallTolerance)} percent short is free, its revenue lost; beyond that the energy short costs ${T.penaltyMultiple} times the tariff.`, ids: ["fourHours", "shortfall"] },
    { say: `Up to ${pct(T.marketShare)} percent of a year's energy may be bought from the green market or bilateral agreements, supplied directly or through the storage. Outside the buyer's hours the plant may sell its surplus, the PPA first; the connectivity the tender asks for is for the non-solar hours.`, ids: ["marketShare", "essOtherUse"] },
    { say: `You bid ${T.bidMinMw} to ${T.bidMaxMw} megawatts in whole megawatts, one tariff to two decimals, with no ceiling. The EMD, the performance guarantee, the net worth and SECI's Success Charges are set on the installed solar, wind and storage; with the Payment Security Mechanism you give ${Math.round(T.psmChargeRsPerKwh * 100)} paise per unit off every bill. Supply starts ${T.scdMonths} months from the PPA's Effective Date.`, ids: ["capacityBid", "emd", "pbg", "netWorth", "successCharges", "psm", "scsd"] },
  ];
  return brief.map((b) => ({ say: b.say, sources: b.ids.map((id) => sourceOf(term(id))).filter(Boolean) }));
}

// ---------------------------------------------------------------- what is on screen

const formsModelOf = (s) => (s.lp ? { bid: Math.ceil((s.lp.tariff || 0) * 100 - 1e-9) / 100 } : null);

/** The yearly rule outcome, the bought power and the sale of the sized plant, year 1 and the worst year. */
function sizingFacts(lp, hourly = null) {
  const life = lp.lifetime || [];
  const y1 = life[0] || {};
  const share = (row) => (row.demandMwh > 0 ? row.deliveredMwh / row.demandMwh : 1);
  const worst = life.reduce((w, row) => (share(row) < share(w) ? row : w), y1);
  const rule = lp.perYear?.[0]?.rules?.[0] || null;
  return {
    year1: { suppliedPct: r(share(y1) * 100, 1), penalisedMu: r((y1.monthlyPenaltyMwh || 0) / 1000, 2), boughtMu: r((y1.purchaseMwh || 0) / 1000, 2),
      boughtPct: r(y1.demandMwh > 0 ? ((y1.purchaseMwh || 0) / y1.demandMwh) * 100 : 0, 2), boughtCostCr: r(y1.purchaseCostCr || 0, 2), soldMu: r((y1.exportMwh || 0) / 1000, 1), saleRevenueCr: r(y1.exportRevenueCr || 0, 1),
      saleMarket: lp.market ? `IEX ${lp.market}` : "no sale",
      // the days met in full, which alone sell (a sale on a day left short is a breach)
      ...(lp.perYear?.[0]?.saleDays !== undefined ? { daysMetInFullAndSelling: lp.perYear[0].saleDays, daysShortNotSelling: lp.perYear[0].shortDays } : {}),
      // the surplus nobody takes (the year-1 hourly dispatch on screen, when it is there)
      ...(hourly?.curtail ? { curtailedMu: r(hourly.curtail.reduce((a, v) => a + v, 0) / 1000, 1) } : {}) },
    worstYear: { year: worst.year ?? 1, suppliedPct: r(share(worst) * 100, 1), penalisedMu: r((worst.monthlyPenaltyMwh || 0) / 1000, 2) },
    monthlyRule: rule ? { tolerancePct: rule.tolerance != null ? pct(rule.tolerance) : null, withinTolerance: rule.withinTolerance ?? null, penaltyMultiple: rule.penaltyMultiple ?? null } : null,
  };
}

/** The bid as it stands: inputs still needed, the sizing, the financials, the quote and the forms. */
export function status(state, terms, run = null) {
  const lp = state.lp;
  const fin = lp ? financeOf(state, terms) : null;
  const quote = isNum(state.forms?.tariff) && lp ? quotedReturns(state, terms, state.forms.tariff) : null;
  const missing = missingInputs(state, terms);
  const s = { ...DEFAULT_SETTINGS, ...state.fdrex };
  return {
    step: state.step,
    bid: { contractedMw: state.bid.baseMw, buyersHours: PEAK_PLANS[s.peakPlan]?.label, shortfall: SHORTFALL_MODES[s.shortfall]?.label, buyPower: s.buy ? `yes, from IEX GDAM, charges ₹${s.buyCharges}/kWh` : "no",
      sellSurplus: state.market?.sell ? `yes, on IEX ${state.market.source}` : "no: the surplus is curtailed",
      solarHourConnectivity: Boolean(s.dayInjection), psm: Boolean(s.psm), ppaDate: s.ppaDate },
    sources: SOURCES.filter((id) => state.sources[id]).map((id) => `${NAMES[id]} (${state.src[id].capacity.mode === "fixed" ? `fixed at ${state.src[id].capacity.mw} MW` : "optimizer sizes it"})`),
    inputsMissing: missing.length ? missing.slice(0, 12) : "none",
    optimizer: run?.active ? "running" : lp ? "sized" : run?.error ? `failed: ${run.error}` : "not run",
    plant: lp ? { solarMwac: r(lp.sizes.solarMw, 0), windMw: r(lp.sizes.windMw, 0), storageMw: r(lp.sizes.bessMw, 0), storageMwh: r(lp.sizes.bessMwh, 0), sizingTariff: r(lp.tariff, 3) } : null,
    financials: fin ? { bidTariff: r(fin.tariff, 3), equityIrrPct: r(fin.equityIrr * 100), projectIrrPct: r(fin.projectIrr * 100), minDscr: r(fin.minDscr) } : null,
    quote: quote ? { tariff: quote.tariff, status: quote.status, equityIrrPct: r(quote.equityIrr * 100), projectIrrPct: r(quote.projectIrr * 100), message: quote.message } : state.forms?.tariff ? null : "no tariff quoted yet",
    formsToFill: formIssues(state).length,
    next: missing.length ? "inputs to fill: use next_question" : lp ? "results are ready" : "ready to size",
  };
}

// ---------------------------------------------------------------- the tools

const obj = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const num = (description) => ({ type: ["number", "null"], description });

/** The function tools, in the Responses API's format, as the session's backend sees them. */
export const AGENT_TOOLS = [
  { type: "function", name: "get_status", description: "The bid as it stands on screen: the step shown, the bid (MW, the buyer's hours, the shortfall plan, bought power, connectivity, PSM, Effective Date), the sources, inputs still needed, whether the optimizer ran, the plant, the financials and the quoted tariff. Call it first and whenever unsure.", parameters: obj() },
  { type: "function", name: "tender_brief", description: "The key conditions of SECI-FDRE-X as short spoken paragraphs, each with the document, clause and page it rests on. Use at the start of the guided exercise.", parameters: obj() },
  { type: "function", name: "tender_lookup", description: "Search the tender's 450 conditions: pass words (e.g. 'EMD', 'monthly shortfall', 'net worth', 'connectivity') or an exact condition id. Each match has its document, clause, page and quote.", parameters: obj({ query: { type: "string" } }, ["query"]) },
  { type: "function", name: "list_conditions", description: "Every condition of the tender, by group, with document, clause and page. Pass a group to narrow; with group null it also returns the names of the groups.", parameters: obj({ group: { type: ["string", "null"] } }, ["group"]) },
  { type: "function", name: "amendment_changes", description: "What Amendment-01 changed, row by row: the clause, the document and page it stood in, whether it is deleted, and what that means for the bidder.", parameters: obj({ amendment: { type: "string", enum: [...AMENDMENTS, "all"] } }, ["amendment"]) },
  { type: "function", name: "next_question", description: "The next input of the guided model-filling exercise, in order: the question to ask, its current value and the benchmark. Inputs set with set_input count as answered. Pass `keep` with an input key when the bidder keeps its current value ('next', 'same'), or keep_rest true to accept every remaining value as it stands.", parameters: obj({ keep: { type: ["string", "null"], description: "Input key the bidder keeps as it is, or null" }, keep_rest: { type: "boolean" } }, ["keep", "keep_rest"]) },
  { type: "function", name: "list_inputs", description: "The inputs of one part of the screen with their keys, current values, units, ranges and benchmarks. Percent inputs are in percent.", parameters: obj({ part: { type: "string", enum: ["bid", "sources", "financeInputs", "forms", "all"] } }, ["part"]) },
  { type: "function", name: "set_input", description: "Change one input on screen and show it. `value` is what the bidder said: a number (percent inputs in percent, 24 means 24%), a choice key or label, a date (YYYY-MM-DD), yes/no, 'auto' for a size, or text. Changing a bid or design input clears the sizing until the optimizer runs again.", parameters: obj({ key: { type: "string" }, value: { type: ["string", "number", "boolean"] } }, ["key", "value"]) },
  { type: "function", name: "use_benchmarks", description: "Fill every empty design and financing input with industry benchmarks (2025-26 prices, CERC norms), marked as benchmarks on screen.", parameters: obj() },
  { type: "function", name: "go_to_step", description: "Show a step of the tab.", parameters: obj({ step: { type: "string", enum: STEPS } }, ["step"]) },
  { type: "function", name: "run_optimizer", description: "Size the plant with HiGHS for the least tariff against the tender's constraints: the contracted MW in the buyer's four hours each day, the monthly rule (10% free, 1.5 × tariff beyond, or every month in full), bought power within 5%, no sale in the solar hours without connectivity for them (about a minute). Returns the result when done. Run again after inputs change.", parameters: obj() },
  { type: "function", name: "stop_optimizer", description: "Stop a sizing that is running.", parameters: obj() },
  { type: "function", name: "get_results", description: "The sized plant: solar, wind and storage, the sizing tariff, the share of the buyer's energy supplied, the energy penalised beyond the free 10%, the power bought and its cost, the surplus sold, EMD, PBG, net worth, SECI's charges and the dates.", parameters: obj() },
  { type: "function", name: "get_financials", description: "The 25-year financial model of the sized plant: the tariff for the target equity IRR, equity IRR, project IRR, DSCR, project cost with SECI's charges, debt, the power bought, the PSM discount and the penalties over the term.", parameters: obj() },
  { type: "function", name: "market_check", description: "This bid against the market: the tariffs the earlier auctions of the same product discovered (SECI-FDRE-VI, SJVN FDRE-4, SECI-FDRE-VII, SECI-FDRE-IX, each with its date and source), where this bid's tariff stands against the latest, and the bridge from the older benchmark inputs to the market case (battery price, debt terms, interest, equity IRR, wind), each step's tariff from this tab's own sizing. Use it when the user asks why the tariff is above the auction results, what the market is bidding, or what would bring the tariff down.", parameters: obj() },
  { type: "function", name: "use_market_case", description: "Put the market case's inputs in the bid: battery Rs 0.80 crore per MWh, wind 37% CUF at Rs 7.0 crore per MW, debt 75% at 8.5% for 18 years, equity IRR 12%. It clears the sizing: run_optimizer after it. Only when the user asks for it; say first that the equity IRR and the wind figures are estimates, not any bidder's published numbers.", parameters: obj() },
  { type: "function", name: "check_tariff", description: "What a tariff the bidder may quote earns: equity and project IRR at that tariff against the target, with a warning when it is below the tariff the target needs. Records it as the tariff quoted in the bid forms when record is true.", parameters: obj({ tariff: { type: "number", description: "₹/kWh" }, record: { type: "boolean" } }, ["tariff", "record"]) },
  { type: "function", name: "what_if", description: "An instant what-if on the sized plant (a rule-based dispatch of every year and the full financial model, not the HiGHS optimum): change any of the sizes, the storage hours, the capex, the target equity IRR or the bid tariff, and get the tariff the target IRR needs, the IRRs at the bid tariff, the energy supplied, bought and penalised. Pass null for what stays as sized. show true opens the What-if step (it starts from the sized bid; the bidder moves the levers there).", parameters: obj({
    solarMw: num("Solar MWac, or null"), windMw: num("Wind MW, or null"), storageMw: num("Storage MW, or null"), storageHours: num("Storage hours (MWh per MW), or null"),
    solarCapex: num("₹ cr per MWac, or null"), windCapex: num("₹ cr per MW, or null"), storageCapex: num("₹ cr per MWh, or null"),
    targetEquityIrrPct: num("Target equity IRR in percent, or null"), tariff: num("Bid tariff ₹/kWh to test, or null"), show: { type: "boolean" },
  }, ["solarMw", "windMw", "storageMw", "storageHours", "solarCapex", "windCapex", "storageCapex", "targetEquityIrrPct", "tariff", "show"]) },
  { type: "function", name: "explain_generation", description: "How the plant's energy is worked out, with the bid's own numbers from the traceable financial model (the same as the Excel model): MW × CUF × 365 × 24 ÷ 1,000 = million units, the degradation and the losses; the twelve months; a day's blocks; and what the dispatch did with the year's energy (supplied, sold, curtailed). Use when the user asks how energy or CUF is calculated, or gives their own figure to check (their_mu). show true opens that line of the traceable model.", parameters: obj({
    source: { type: "string", enum: ["solar", "wind", "all"] },
    year: { type: ["integer", "null"], description: "PPA year, 1 if not said" },
    month: { type: ["integer", "null"], description: "1-12 for a month's figure, else null" },
    day: { type: ["integer", "null"], description: "Day of that month for its blocks, else null" },
    their_mu: { type: ["number", "null"], description: "The user's own figure in million units (MU) to check, else null" },
    show: { type: "boolean" },
  }, ["source", "year", "month", "day", "their_mu", "show"]) },
  { type: "function", name: "review_bid_forms", description: "The bid forms: the particulars still empty, every RfS format this bid needs with its blanks left and whether the bidder reviewed it, and every check against the tender (capacity, tariff, storage, connectivity, net worth, liquidity, EMD, dates).", parameters: obj() },
  { type: "function", name: "open_format", description: "Show one RfS bid format on screen (e.g. '7.1' Covering Letter, '7.6' Financial Requirement, '7.10' Financial Bid) or 'particulars', and list its blanks: the input key to set each with set_input, the value now, where it comes from, and the RfS words around the blank with the page.", parameters: obj({ id: { type: "string" } }, ["id"]) },
  { type: "function", name: "mark_format_reviewed", description: "Record that the bidder has reviewed a format as filled. Only when the bidder says they have reviewed it.", parameters: obj({ id: { type: "string" }, reviewed: { type: "boolean" } }, ["id", "reviewed"]) },
];

/** The traceable model's request for the sized plant, as the Financial model step builds it. */
function liveOf(state, terms) {
  const { costs, fin, bess } = modelInputs(state, terms);
  const ops = opsFromLp(state.lp, fin, bess, dsmFor(state));
  const finance = financeOf(state, terms);
  return liveModelRequest({ state, lp: state.lp, finance, costs, fin, bess, ops, dfrTarget: 0, labels: terms.workbookLabels });
}

const termOut = (t) => ({ id: t.id, group: t.group, condition: t.label, rule: t.display, status: t.status || "in force", clause: t.clause, page: t.page, quote: t.quote });

/**
 * Runs the tools against the tab. ctx: { getState() (the latest state, updated at once by apply),
 * apply(fn) (set the state), getTerms(), getPrices() (the IEX price year, or null), goto(step),
 * highlight(target), runSizing() (resolves with the sizing or null), stopSizing(), getRun(),
 * showTrace({ line, year, drill }) }.
 */
export function createToolRunner(ctx) {
  const input = (key) => agentInputs(ctx.getState()).find((x) => x.key === key);
  const confirmed = new Set();
  const target = (key) => (key.startsWith("forms.") ? `form.${key.slice(6)}` : key);
  const tools = {
    get_status: () => status(ctx.getState(), ctx.getTerms(), ctx.getRun?.()),
    tender_brief: () => ({ conditions: tenderBrief() }),
    tender_lookup: ({ query }) => {
      const hits = tenderLookup(query);
      return hits.length ? { matches: hits } : { matches: [], note: "Nothing in the tender documents matches; say so rather than guess." };
    },
    list_conditions: ({ group = null } = {}) => {
      ctx.goto("conditions");
      const list = TERMS.filter((t) => !group || t.group.toLowerCase() === String(group).toLowerCase());
      return { groups: [...new Set(TERMS.map((t) => t.group))], conditions: group ? list.map(termOut) : [] };
    },
    amendment_changes: ({ amendment = "all" } = {}) => { ctx.goto("documents"); return { amendments: amendmentChanges(amendment) }; },
    next_question: ({ keep = null, keep_rest: keepRest = false } = {}) => {
      if (keep) confirmed.add(keep);
      if (keepRest) for (let q = nextQuestion(ctx.getState(), ctx.getTerms(), confirmed); q; q = nextQuestion(ctx.getState(), ctx.getTerms(), confirmed)) confirmed.add(q.key);
      const q = nextQuestion(ctx.getState(), ctx.getTerms(), confirmed);
      if (q?.step) ctx.goto(q.step);
      if (q?.key && q.key !== "fill") ctx.highlight?.(target(q.key));
      return q || { done: true, note: ctx.getState().lp ? "Every input is in and the plant is sized." : "Every input is in: offer to run the optimizer." };
    },
    list_inputs: ({ part = "all" } = {}) => ({
      inputs: agentInputs(ctx.getState()).filter((x) => part === "all" || x.step === part).map((x) => ({
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
      if (key === "ppaDate") out.dates = keyDates(v);
      if (key === "forms.tariff" && isNum(v) && next.lp) {
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
      const mw = s.bid.baseMw;
      const money = moneyAtStake(z);
      return {
        plant: { solarMwac: r(z.solarMw, 0), solarMwp: r(z.solarMw * (s.src.solar?.dcAc || 1), 0), windMw: r(z.windMw, 0), storageMw: r(z.bessMw, 0), storageMwh: r(z.bessMwh, 0),
          storageHoursPerContractedMw: r(mw > 0 ? z.bessMwh / mw : 0, 2) },
        sizingTariff: r(s.lp.tariff, 3),
        ...sizingFacts(s.lp, ctx.getHourly?.() || null),
        emdCr: r(money.emdRs / 1e7), pbgCr: r(money.pbgRs / 1e7), netWorthNeededCr: r(money.netWorthRs / 1e7), seciChargesCr: r(seciChargesCr(z, mw), 2),
        dates: keyDates(s.fdrex?.ppaDate) || "enter the PPA Effective Date for the dates",
      };
    },
    market_check: () => {
      const st = ctx.getState();
      const f = financeOf(st, ctx.getTerms());
      const where = f ? againstMarket(f.tariff) : null;
      return {
        thisBid: f ? { tariff: r(f.tariff, 3), targetEquityIrrPct: r(st.fin.targetEquityIrr * 100), standing: where.words } : "not sized yet",
        latestAuction: { tender: LATEST.tender, date: LATEST.auction, tariff: `Rs ${LATEST.low.toFixed(2)} to ${LATEST.high.toFixed(2)} per kWh`, note: LATEST.note, source: LATEST.source },
        auctions: RESULTS.map((x) => ({ tender: x.tender, quantity: x.quantity, date: x.auction, tariff: x.low === x.high ? x.low : `${x.low} to ${x.high}`, note: x.note, source: x.source })),
        bridgeOn100Mw: BRIDGE.map((b, i) => ({ step: b.step, tariff: b.tariff, change: i ? r(b.tariff - BRIDGE[i - 1].tariff, 2) : null, basis: b.basis, estimate: b.kind === "estimate" })),
        whatThisTabFillsIn: "battery Rs 0.80 crore per MWh, debt 75% at 9% for 18 years, equity IRR 14%: the third step of the bridge",
        marketCase: MARKET_CASE,
        caveats: NOT_VERIFIED,
      };
    },
    use_market_case: () => {
      ctx.apply((st) => applyMarketCase(st));
      ctx.goto("size");
      return { ok: true, set: MARKET_CASE, next: "run_optimizer: the sizing was cleared" };
    },
    get_financials: () => {
      const s = ctx.getState();
      const f = financeOf(s, ctx.getTerms());
      if (!f) return { ok: false, error: "Size the plant first." };
      const sum = (k) => f.rows.reduce((a, row) => a + (row[k] || 0), 0);
      return {
        bidTariff: r(f.tariff, 3), quoteRoundedUp: Math.ceil(f.tariff * 100 - 1e-9) / 100, equityIrrPct: r(f.equityIrr * 100), projectIrrPct: r(f.projectIrr * 100),
        targetEquityIrrPct: r(s.fin.targetEquityIrr * 100), minDscr: r(f.minDscr), avgDscr: r(f.avgDscr), projectCostCr: r(f.capex.total, 0), debtCr: r(f.debt, 0),
        seciChargesInCostCr: r(seciChargesCr(s.lp.sizes, s.bid.baseMw), 2), powerBoughtOverTermCr: r(sum("charging"), 0), psmDiscountOverTermCr: r(sum("pxFees"), 1),
        penaltiesOverTermCr: r(f.totals?.penalty ?? sum("blockPenalty"), 1), year1SuppliedMu: r(f.rows[0].deliveredMu, 1), year1SaleRevenueCr: r(f.rows[0].surplusRevenue, 1),
      };
    },
    check_tariff: ({ tariff, record = false }) => {
      const s = ctx.getState();
      const q = s.lp ? quotedReturns(s, ctx.getTerms(), Number(tariff)) : null;
      if (!q) return { ok: false, error: s.lp ? "Give a tariff above zero." : "Size the plant first." };
      if (record) {
        ctx.apply((st) => ({ ...st, forms: { ...st.forms, tariff: Number(Number(tariff).toFixed(2)) } }));
        ctx.goto("finance");
        ctx.highlight?.("quoteTariff");
      }
      return { ok: true, status: q.status, tariff: q.tariff, targetTariff: r(q.targetTariff, 3), equityIrrPct: r(q.equityIrr * 100), projectIrrPct: r(q.projectIrr * 100),
        targetEquityIrrPct: r(q.targetEquityIrr * 100), message: q.message, recorded: Boolean(record) };
    },
    what_if: (a = {}) => {
      const s = ctx.getState();
      const seed = whatIfFromBid(s, ctx.getTerms());
      if (!seed) return { ok: false, error: "Size the plant first: the What-if starts from the sized bid." };
      const v = (x) => (isNum(x) ? x : null);
      const c = { ...seed, costs: { ...seed.costs }, fin: { ...seed.fin } };
      if (v(a.solarMw) !== null) c.solarMwac = Math.max(0, a.solarMw);
      if (v(a.windMw) !== null) c.windMw = Math.max(0, a.windMw);
      if (v(a.storageMw) !== null) c.bessMw = Math.max(0, a.storageMw);
      if (v(a.storageHours) !== null) c.bessHours = Math.max(0, a.storageHours);
      if (v(a.solarCapex) !== null) c.costs.solarCrPerMwac = a.solarCapex;
      if (v(a.windCapex) !== null) c.costs.windCrPerMw = a.windCapex;
      if (v(a.storageCapex) !== null) c.costs.bessCrPerMwh = a.storageCapex;
      if (v(a.targetEquityIrrPct) !== null) c.fin.targetEquityIrr = a.targetEquityIrrPct / 100;
      if (v(a.tariff) !== null) c.fin.tariff = a.tariff;
      const base = runWhatIf(seed, { prices: ctx.getPrices?.() || null });
      const res = runWhatIf(c, { prices: ctx.getPrices?.() || null });
      if (a.show) ctx.goto("whatif");
      const y = res.year1;
      return {
        ok: true, note: "Instant rule-based dispatch, not the HiGHS optimum: the sized bid itself reads a little dearer here than in the financial model.",
        plant: { solarMwac: r(c.solarMwac, 0), windMw: r(c.windMw, 0), storageMw: r(c.bessMw, 0), storageMwh: r(c.bessMw * c.bessHours, 0) },
        tariffNeeded: r(res.finance.tariffNeeded, 3), tariffNeededAsSized: r(base.finance.tariffNeeded, 3), change: r(res.finance.tariffNeeded - base.finance.tariffNeeded, 3),
        atBidTariff: { tariff: r(c.fin.tariff, 3), equityIrrPct: r(res.finance.equityIrr * 100), projectIrrPct: r(res.finance.projectIrr * 100), minDscr: r(res.finance.minDscr) },
        year1: { suppliedPct: r((y.deliveredMWh / y.demandMWh) * 100, 1), boughtPct: r((y.purchaseShare || 0) * 100, 2), penalisedMu: r(y.blockShortfallMWh / 1000, 2), soldMu: r(y.excessMWh / 1000, 1) },
        verdict: { pass: "meets the tender in year 1 with no penalty", penalty: "meets the tender's limits, with a monthly penalty", fail: "does not meet the tender" }[res.verdict],
        pricesPending: Boolean(res.pricesPending),
      };
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
    review_bid_forms: () => {
      const s = ctx.getState();
      const view = formsView(s);
      ctx.goto("forms");
      const sum = formatsSummary(view);
      return {
        particularsStillEmpty: formIssues(view),
        particularKeys: FORM_FIELDS.map((f) => `forms.${f.key}`),
        formats: { needed: sum.needed, reviewed: sum.reviewed, blanksLeft: sum.blanksLeft,
          list: FORMATS.map((f) => ({ f, st: formatStatus(view, f) })).filter(({ st }) => st.applies !== "no")
            .map(({ f, st }) => ({ id: f.id, title: f.title, needed: st.applies, blanksLeft: st.missing.length, reviewed: st.reviewed || "no" })) },
        checks: bidChecks(view, formsModelOf(s)).map((c) => ({ check: c.label, status: { ok: "OK", bad: "NOT MET", warn: "CHECK", todo: "TO DO" }[c.status] || c.status, detail: c.detail })),
      };
    },
    open_format: ({ id }) => {
      const s = ctx.getState();
      const view = formsView(s);
      ctx.goto("forms");
      if (id === "particulars") {
        ctx.apply((st) => ({ ...st, formsView: "particulars" }));
        return { particulars: visibleFields(s.forms || {}).map((x) => ({ key: `forms.${x.key}`, label: x.label, value: s.forms?.[x.key] ?? null, required: Boolean(x.required) })) };
      }
      const fmt = FORMATS.find((f) => f.id.toLowerCase() === String(id).toLowerCase().replace(/^(format|annexure)[\s-]*/, ""));
      if (!fmt) return { ok: false, error: `No format ${id}. Formats: ${FORMATS.map((f) => f.id).join(", ")}` };
      ctx.apply((st) => ({ ...st, formsView: fmt.id }));
      const st = formatStatus(view, fmt);
      return {
        id: fmt.id, title: fmt.title, purpose: fmt.purpose, signedBy: fmt.submittedBy, paper: fmt.paper, envelope: fmt.envelope, when: fmt.when, needed: st.applies,
        rfsPages: fmt.pages, reviewed: st.reviewed || "no",
        blanks: fmt.fields.filter((x) => x.kind !== "table").map((x) => {
          const b = blankValue(view, fmt, x);
          return { label: x.label, value: b.value || null, from: b.source === "model" ? "the bid (not editable)" : b.source === "shared" ? "the particulars" : b.source === "na" ? "not applicable" : "this format",
            key: b.source === "own" ? `forms.${fmt.id}.${x.key}` : b.source === "shared" ? `forms.${b.key}` : null, rfs: { page: x.context?.page, words: x.context?.quote } };
        }),
        enclose: (fmt.attachments || []).map((a) => a.label),
      };
    },
    mark_format_reviewed: ({ id, reviewed }) => {
      const fmt = FORMATS.find((f) => f.id === id);
      if (!fmt) return { ok: false, error: `No format ${id}.` };
      ctx.apply((st) => {
        const next = { ...(st.formsReview || {}) };
        if (reviewed) next[fmt.id] = { at: new Date().toISOString(), print: formatPrint(formsView(st), fmt) };
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

export const GREETING = "Open the conversation: greet the bid manager in one short sentence, say you can explain SECI's FDRE-X tender and its conditions, take the bid inputs one by one, size the plant with the optimizer, explain the tariff and the returns, try what-ifs, and fill the bid forms, and ask whether to start.";

export const LIVE_INSTRUCTIONS = `You are the voice of the TenderOS bid agent for SECI's FDRE-X tender: assured peak supply of ${(TENDER.totalMw * TENDER.mwhPerMwDay).toLocaleString("en-IN")} megawatt hours a day (${TENDER.totalMw.toLocaleString("en-IN")} megawatts for ${TENDER.peakHours} hours) from ISTS-connected renewable projects with energy storage, sold to SECI at one fixed tariff under a ${TENDER.termYears}-year Power Purchase Agreement. You speak with a bid manager in India while a backend agent works the bid model on their screen.

Speak briefly: one to three sentences, then let the user talk. Use Indian number words (lakh, crore) and say units in full. Use the user's language if they switch.

Delegate to the backend whenever the user asks about the tender or its amendment, gives or changes any input, asks to run or re-run the optimiser, asks about results, the tariff, IRR, the financial model, the price to quote, a what-if (another size, cost, IRR or tariff) or the bid forms, or says next or go on. Never state a tender condition, an input value or a result yourself unless the backend has just given it to you; if you do not know, say you will check and delegate.

Lead a guided model-filling exercise. At the start, greet the user in one sentence and ask the backend to brief the key conditions and give the first question. After each answer, ask the backend to set it and fetch the next question. When everything is in, offer to run the optimiser. While it runs (about a minute), say so; you can keep answering questions meanwhile. Then explain the results and the financials, offer a what-if, ask what tariff they want to quote, and finish with the bid forms.

When the backend reports a warning, such as a quoted tariff below what the target IRR needs, an input out of range or a check not met, say it plainly with the numbers it gave.`;

export const BACKEND_INSTRUCTIONS = `You operate the SECI-FDRE-X bid model in the user's browser through function tools, for a voice assistant that speaks your results aloud.

The tender in one line: for every MW contracted, ${TENDER.mwhPerMwDay} MWh a day in the ${TENDER.peakHours} hours the Buying Entity names each morning from the non-solar hours, for ${TENDER.termYears} years, paid at the tariff bid under a PPA with SECI; reconciled monthly, ${pct(TENDER.shortfallTolerance)}% short free and the energy short beyond it at ${TENDER.penaltyMultiple} × the tariff; up to ${pct(TENDER.marketShare)}% of a year's energy may be bought. There is no Contract for Difference and no strike price: say tariff and PPA.

Truth rules:
- Every statement about the tender comes from tender_brief, tender_lookup, list_conditions or amendment_changes, and you name the document, clause and page. If the tools find nothing, say the tender documents do not say.
- Every number about the bid comes from get_status, get_results, get_financials, check_tariff or what_if. Never estimate.
- Inputs change only through set_input or use_benchmarks, with the value the user gave. Do not invent a value; if a needed detail is unclear, ask for it.

The guided exercise:
1. get_status. If nothing is entered yet, tender_brief, then next_question.
2. Ask exactly the question next_question returns, mentioning the current value and the benchmark. When the user answers, set_input with that key, confirm the value set, then next_question again. "Next", "keep it" or "same" keeps the current value: call next_question with keep set to that key. "Keep the rest" accepts all remaining values: keep_rest true. "Benchmark" sets the benchmark. For the key "fill", yes means use_benchmarks.
Selling the surplus is the input market.sell (and market.source, the market), on the Bid inputs step: "yes" sells the energy the buyer's hours and the storage do not take, on IEX GDAM, DAM or RTM at its 15-minute prices; "no" curtails it. Say what the tender says with the pages: RfS 8.1.f allows the sale outside the buyer's hours, PPA 9.3 offers excess energy to SECI first (tender_lookup "excess").
3. When next_question says everything is in, offer run_optimizer; when it returns, explain the plant (solar, wind, storage), the sizing tariff, the share of the buyer's energy supplied, the energy penalised beyond the free ${pct(TENDER.shortfallTolerance)}%, the power bought against the ${pct(TENDER.marketShare)}% limit, the surplus sold (and on which market) and the energy curtailed, EMD, PBG, net worth, SECI's charges and the dates (get_results).
4. get_financials: the tariff for the target equity IRR, rounded up to the paisa for quoting, the equity and project IRR, the minimum DSCR, the power bought and the PSM discount if taken. Then market_check, and say in one or two sentences where the tariff stands against the latest auction of the same product.
If the user asks why the tariff is above the auction results, or what the market is bidding: market_check. Give the latest auction's tariff with its date, this bid's tariff, and the two or three bridge steps that explain most of the gap (the battery price first), naming which are estimates. The tariff is what the user's inputs need for the user's equity IRR; the winners' inputs are not public. Offer use_market_case to see the plant and tariff on the market case; it changes inputs, so only when they say yes.
The surplus is sold only on the days the supply is met in full: a sale on a day left short is a breach under RfS 8.1.f, at 1.5 times that day's highest exchange rate. get_results gives the days met in full.
5. Offer a what-if: what_if with what the user names (another size, capex, IRR or tariff); say the tariff it needs against the sized bid's and that it is an instant check, not the optimum; show true opens the What-if step.
6. Ask what tariff they will quote; check_tariff with record true. If it is below the tariff the target needs, warn clearly and give the equity and project IRR at that tariff.
7. review_bid_forms. Fill the particulars first (open_format "particulars"), then each RfS format the bid needs in order: open_format, read out its blanks still empty, set them as the user answers (the keys come from open_format), and ask the user to review it on screen; mark_format_reviewed only when they say it is reviewed.

How the energy is worked out: when the user asks how generation, energy or CUF is calculated, or reads out their own figure to check, call explain_generation with show true (their_mu in million units). Say the steps it returns with the numbers; if they gave a figure, start with the verdict.

At any time: answer tender questions with tender_lookup or list_conditions; explain the amendment with amendment_changes; change any input the user names (list_inputs gives the keys; percent inputs are in percent, 24 means 24%); after a change that clears the sizing, offer to run the optimizer again; go_to_step to show what you talk about.

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
