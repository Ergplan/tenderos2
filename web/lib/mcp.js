// TenderOS as a remote MCP server (Model Context Protocol, Streamable HTTP), so Claude (a custom
// connector in claude.ai or Claude Desktop, or Claude Code) can work a SECI FDRE-RTC-V bid: read
// the tender with page citations, fill the bid model, size the plant with HiGHS, get the financial
// model, check a quoted tariff, test a design instantly (What-if) and see how the winners bid.
//
// The tools are the SECI bid agent's (web/src/seci/agent.js createToolRunner), run on a bid kept
// on the server for each MCP session, plus four of its own: list_conditions, amendment_changes,
// check_bid (the What-if model) and winning_bid. Every number comes from the app's own model.
//
// The transport is Streamable HTTP without streams: each POST carries one JSON-RPC message (or a
// batch) and gets a plain JSON reply; a request's session is the Mcp-Session-Id header given at
// initialize. An unknown session (after a restart) starts a new bid rather than failing. Plain
// JavaScript with relative imports, so tools/check_mcp.mjs drives it in Node; the route is
// web/app/api/mcp/[token]/route.js.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createToolRunner, tenderLookup } from "../src/seci/agent.js";
import { defaultSeciState } from "../src/seci/state.js";
import { PACK, PEAK_PLANS, PROFILES, SHORTFALL_MODES, seciTerms } from "../src/seci/terms.js";
import { hourlyAtMeter, lpPayload, missingInputs, resourceProfiles, sizingSeedOf } from "../src/bid/model.js";
import { runWhatIf, SECI_LIMITS } from "../src/whatif/model.js";
import { ANY_SIX, BRIDGE, COMPARABLE, DISCLOSED, LEVERS, NOT_VERIFIED, RESULT } from "../src/seci/winningBid.js";

export const SERVER_INFO = { name: "tenderos", title: "TenderOS bid model", version: "1.0.0" };
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const ENGINE_URL = () => process.env.ENGINE_URL || "http://127.0.0.1:8000";
// how long run_optimizer waits for HiGHS before answering "running" (Claude allows a tool call 240 s)
const WAIT_MS = () => Number(process.env.MCP_SIZING_WAIT_MS || 180_000);
const SESSION_TTL_MS = 6 * 3600 * 1000;
const MAX_SESSIONS = 50;

export const INSTRUCTIONS = `TenderOS works a bid for SECI's FDRE-RTC-V tender (RfS SECI/C&P/IPP/13/0020/25-26, issued as RTC-TM-V and renamed by Amendment-03): 1,000 MW of firm and dispatchable round-the-clock power from ISTS-connected renewable projects with storage.
- State tender conditions only from tender_lookup, list_conditions, amendment_changes or tender_brief, and cite the document and page each result gives (a link to the PDF page comes with it).
- Numbers about a bid come only from the tools: get_results, get_financials, check_tariff, check_bid, explain_generation. Do not estimate them.
- The bid lives on the server for this conversation: set_input changes it (list_inputs gives the keys), use_benchmarks fills empty inputs, run_optimizer sizes the plant with HiGHS (one to two minutes; if it answers "running", call sizing_status), then get_results and get_financials.
- check_bid tests a plant you specify instantly with a rule-based dispatch (no optimisation): use it for what-if questions.
- winning_bid explains how the auction's winners reached Rs 5.25/kWh.`;

// ---------------------------------------------------------------- data on the server

let PRICES;
/** The IEX hourly prices the app serves (public/market), for the costliest-hours plan and market sales. */
export function marketPrices() {
  if (PRICES === undefined) {
    try {
      PRICES = JSON.parse(readFileSync(path.join(process.cwd(), "public", "market", "iex_hourly_prices.json"), "utf8"));
    } catch {
      PRICES = null;
    }
  }
  return PRICES;
}
export function setMarketPrices(p) {
  PRICES = p;
}

const docFile = (title) => PACK.documents.find((d) => d.title === title || d.id === title)?.file || null;

/** Adds a link to the PDF page to every cited quote ({ document, page, quote }) in a result. */
export function withLinks(value, base) {
  if (!base) return value;
  if (Array.isArray(value)) return value.map((v) => withLinks(v, base));
  if (!value || typeof value !== "object") return value;
  const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withLinks(v, base)]));
  const file = typeof out.document === "string" && Number.isInteger(out.page) ? docFile(out.document) : null;
  if (file && typeof out.quote === "string") out.link = `${base}${PACK.folder}${encodeURIComponent(file)}#page=${out.page}`;
  return out;
}

// ---------------------------------------------------------------- sessions: one bid each

const SESSIONS = new Map();

/** The engine's sizing (POST /api/rtc/lp, NDJSON), as the browser's runSizing reads it. */
export async function sizeOnEngine(payload) {
  const res = await fetch(new URL("/api/rtc/lp", ENGINE_URL()), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`The engine answered ${res.status}`);
  const text = await res.text();
  let result = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const ev = JSON.parse(line);
    if (ev.type === "result") result = ev.result;
    else if (ev.type === "error") throw new Error(ev.error);
  }
  if (!result) throw new Error("The engine closed the connection before the sizing finished.");
  return result;
}

function newSession(id = randomUUID(), { size = sizeOnEngine } = {}) {
  const s = { id, state: defaultSeciState(), run: { active: false, error: null, promise: null }, hourly: null, seen: Date.now() };
  const terms = () => seciTerms(s.state.seci, marketPrices());
  s.terms = terms;
  s.startSizing = () => {
    if (s.run.active) return s.run.promise;
    const state = s.state;
    const t = terms();
    const payload = lpPayload(state, t, resourceProfiles(state), marketPrices());
    s.run = { active: true, error: null, started: Date.now(), promise: null };
    s.run.promise = size(payload).then((result) => {
      const { hourly, log, dispatch, ...lp } = result;
      s.hourly = hourly ? hourlyAtMeter(hourly, lp.evacuationEfficiency) : null;
      s.state = { ...s.state, lp, sizingSeed: sizingSeedOf(lp, payload.ctx.plantMw) || s.state.sizingSeed || null };
      s.run = { active: false, error: null, finished: Date.now(), seconds: Math.round((Date.now() - s.run.started) / 1000) };
      return lp;
    }, (err) => {
      s.run = { active: false, error: err.message || String(err) };
      return null;
    });
    return s.run.promise;
  };
  s.runner = createToolRunner({
    getState: () => s.state,
    apply: (fn) => { s.state = fn(s.state); },
    getTerms: terms,
    goto: () => {},
    highlight: () => {},
    runSizing: () => s.startSizing(),
    stopSizing: () => {},
    getRun: () => s.run,
    getHourly: () => s.hourly,
    showChart: () => {},
    showTrace: () => {},
  });
  return s;
}

/** The session's bid, made (or re-made after a restart) when needed. */
export function sessionFor(id, opts) {
  const now = Date.now();
  for (const [k, v] of SESSIONS) if (now - v.seen > SESSION_TTL_MS) SESSIONS.delete(k);
  let s = id ? SESSIONS.get(id) : null;
  if (!s) {
    if (SESSIONS.size >= MAX_SESSIONS) SESSIONS.delete([...SESSIONS.entries()].sort((a, b) => a[1].seen - b[1].seen)[0][0]);
    s = newSession(id || randomUUID(), opts);
    SESSIONS.set(s.id, s);
  }
  s.seen = now;
  return s;
}
export const dropSession = (id) => SESSIONS.delete(id);

// ---------------------------------------------------------------- the tools

const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const num = (description, extra = {}) => ({ type: "number", description, ...extra });
const schema = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const r = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  { name: "tender_brief", title: "Key bid conditions", annotations: READ, inputSchema: schema(),
    description: "The key bid conditions of SECI FDRE-RTC-V after its three amendments, in plain words: bid size, the supply rule per 15-minute block (Peak, Solar and Remaining Hours), Peak Hours, the penalty, storage, dates and money at stake." },
  { name: "tender_lookup", title: "Search the tender", annotations: READ, inputSchema: schema({ query: str("Words to search for, e.g. 'EMD', 'solar hours excess', 'net worth', 'connectivity', or an exact condition id") }, ["query"]),
    description: "Search the tender documents (RfS, Amendments 01-03, Clarifications-01, PSA): the conditions in force, what each amendment changed and SECI's clarifications, each with document, page, quote and a link to the PDF page." },
  { name: "list_conditions", title: "Conditions in force", annotations: READ,
    inputSchema: schema({ group: str("A group of conditions, or 'all'", { enum: ["all", ...new Set(PACK.conditions.map((c) => c.group))] }) }),
    description: "Every bid condition in force after the amendments in one group (or all): the rule, whether an amendment changed it (and what it was), and its source quote with page." },
  { name: "amendment_changes", title: "What an amendment changed", annotations: READ,
    inputSchema: schema({ amendment: str("Which amendment", { enum: PACK.documents.filter((d) => d.kind === "amendment").map((d) => d.id) }) }, ["amendment"]),
    description: "Clause by clause, what one amendment changed in the RfS: the clause, the wording before and after (quoted, with pages) and the effect. amd3 is Amendment-03 (25.06.2026): the renaming to FDRE-RTC-V and the Solar Hours." },
  { name: "get_status", title: "The bid as it stands", annotations: READ, inputSchema: schema(),
    description: "This conversation's bid: contracted MW, supply profile, Peak Hours plan, sources, inputs still empty, whether the plant is sized, the plant and the financials." },
  { name: "list_inputs", title: "Bid inputs", annotations: READ,
    inputSchema: schema({ part: str("Which inputs", { enum: ["bid", "sources", "forms", "all"] }) }),
    description: "The bid's inputs with their keys (for set_input), current values, units, ranges and benchmarks. Percent inputs are in percent." },
  { name: "set_input", title: "Change a bid input", annotations: WRITE,
    inputSchema: schema({ key: str("The input key from list_inputs, e.g. bidMw, profile, peakPlan, solar.capex, fin.targetEquityIrr, market.sell"), value: { type: ["string", "number", "boolean"], description: "The value: a number (percent inputs in percent: 14 means 14%), a choice key, a date YYYY-MM-DD, yes/no, or 'auto' for a size" } }, ["key", "value"]),
    description: "Change one input of the bid. Changing a sizing input clears the sizing until run_optimizer runs again." },
  { name: "use_benchmarks", title: "Fill inputs with benchmarks", annotations: WRITE, inputSchema: schema(),
    description: "Fill every empty sizing and financing input with industry benchmarks (CERC norms, 2025-26 prices)." },
  { name: "run_optimizer", title: "Size the plant (HiGHS)", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, inputSchema: schema(),
    description: "Size the least-tariff plant with the HiGHS optimiser: solar, wind and battery against every 15-minute block's floor for 25 years. Takes one to two minutes; if it is still running when this answers, call sizing_status." },
  { name: "sizing_status", title: "Sizing progress", annotations: READ, inputSchema: schema(),
    description: "Wait (up to three minutes) for a running sizing and return its results when done." },
  { name: "get_results", title: "The sized plant", annotations: READ, inputSchema: schema(),
    description: "The sized plant: solar, wind and battery, the sizing tariff, how often each floor is met in year 1, the shortfall, EMD, PBG, net worth needed and the dates." },
  { name: "get_financials", title: "Financial model", annotations: READ, inputSchema: schema(),
    description: "The 25-year financial model of the sized plant: the tariff for the target equity IRR, equity and project IRR, DSCR, project cost, debt and penalties." },
  { name: "check_tariff", title: "Check a quoted tariff", annotations: READ,
    inputSchema: schema({ tariff: num("Rs/kWh"), record: { type: "boolean", description: "Also record it as the tariff in the bid forms" } }, ["tariff"]),
    description: "What a tariff the bidder may quote earns on the sized plant: equity and project IRR against the target, with a warning when it is below the tariff the target needs." },
  { name: "explain_generation", title: "How the energy is worked out", annotations: READ,
    inputSchema: schema({ source: str("Which source", { enum: ["solar", "wind", "all"] }), year: { type: "integer", description: "PPA year (1 if not said)" }, month: { type: "integer", description: "1-12 for one month" }, their_mu: num("A figure in million units to check") }),
    description: "The sized plant's generation as a formula with the bid's own numbers (MW x CUF x 8,760 h, degradation, losses to the bus), by year or month, and what the dispatch did with it; checks a figure the user gives." },
  { name: "review_bid_forms", title: "Bid forms and checks", annotations: READ, inputSchema: schema(),
    description: "The bid forms: the particulars still empty, each RfS format the bid needs with its blanks left, and every check of the bid against the tender (capacity, tariff, storage, substation, net worth, experience, EMD, PBG, dates)." },
  { name: "check_bid", title: "What-if: test a plant instantly", annotations: READ,
    inputSchema: schema({
      contracted_mw: num("Contracted capacity bid, MW (50-500)"), solar_mwac: num("Solar, MWac"), wind_mw: num("Wind, MW"), bess_mw: num("Battery power, MW"), bess_hours: num("Battery duration, hours"),
      tariff: num("Tariff to test, Rs/kWh"), target_equity_irr_pct: num("Target equity IRR, %"),
      profile: str("Supply profile", { enum: Object.keys(PROFILES) }), peak_plan: str("Peak Hours plan", { enum: Object.keys(PEAK_PLANS) }), shortfall: str("Shortfall plan", { enum: Object.keys(SHORTFALL_MODES) }),
      sell_surplus: { type: "boolean", description: "Sell power above the contract" }, market_price: num("Market price for surplus, Rs/kWh"),
      solar_capex_cr_per_mwac: num("Solar capex, Rs crore/MWac"), wind_capex_cr_per_mw: num("Wind capex, Rs crore/MW"), bess_capex_cr_per_mwh: num("Battery capex, Rs crore/MWh"),
      interest_rate_pct: num("Debt interest, %"), debt_share_pct: num("Debt share of project cost, %"),
    }),
    description: "Test a plant you specify, instantly: an hourly rule-based dispatch of every PPA year against the tender's floors (no optimisation), then the 25-year model at the tariff. Returns equity, project and lender IRR, DSCR, LCOE, the tariff the target IRR needs, the floors met, the penalty and the tender checks. Unset inputs keep the What-if defaults (300 MW, 785 MWac solar, 440 MW wind, 635 MW x 4 h battery, Rs 7.00)." },
  { name: "winning_bid", title: "How the winners bid Rs 5.25", annotations: READ, inputSchema: schema(),
    description: "The auction result (Rs 5.25-5.26/kWh, 06.08.2026) and a bridge from TenderOS's benchmark Rs 6.50 to it, one change at a time (Amendment-03, green market, battery cost, selling surplus, finance, wind), with the plant per MW at each step, what a winner disclosed and what is not verified." },
];

const SIZING_TOOLS = new Set(["run_optimizer", "sizing_status"]);

/** Waits up to WAIT_MS for the session's sizing; the results when done, else a "running" note. */
async function awaitSizing(s) {
  if (!s.run.active) return null;
  const done = await Promise.race([s.run.promise.then(() => true), new Promise((res) => setTimeout(() => res(false), WAIT_MS()))]);
  if (!done) return { ok: true, status: "running", seconds: Math.round((Date.now() - s.run.started) / 1000), note: "HiGHS is still sizing the plant: call sizing_status again." };
  return null;
}

async function sizingTool(s, name) {
  if (name === "run_optimizer" && !s.run.active) {
    const missing = missingInputs(s.state, s.terms());
    if (missing.length) return { ok: false, error: `Inputs still empty: ${missing.slice(0, 8).join(", ")}. Ask for them or call use_benchmarks.` };
    s.startSizing();
  }
  if (name === "sizing_status" && !s.run.active && !s.state.lp) return { ok: false, error: s.run.error ? `The sizing failed: ${s.run.error}` : "No sizing has been started: call run_optimizer." };
  const waiting = await awaitSizing(s);
  if (waiting) return waiting;
  if (!s.state.lp) return { ok: false, error: s.run.error ? `The sizing failed: ${s.run.error}` : "The sizing did not finish." };
  return { ok: true, status: "done", ...(await s.runner("get_results")) };
}

function listConditions({ group = "all" } = {}) {
  const doc = (id) => PACK.documents.find((d) => d.id === id)?.title || id;
  return {
    conditions: PACK.conditions.filter((c) => group === "all" || c.group === group).map((c) => ({
      id: c.id, group: c.group, label: c.label, rule: c.value, status: c.status, ...(c.by ? { changedBy: doc(c.by) } : {}), ...(c.was ? { was: c.was } : {}),
      ...(c.flag ? { flag: c.flag } : {}), sources: c.sources.slice(0, 2).map((q) => ({ document: doc(q.doc), page: q.page, quote: q.quote })),
    })),
  };
}

function amendmentChanges({ amendment }) {
  const d = PACK.documents.find((x) => x.id === amendment && x.kind === "amendment");
  if (!d) return { ok: false, error: `Amendments: ${PACK.documents.filter((x) => x.kind === "amendment").map((x) => x.id).join(", ")}` };
  const doc = (id) => PACK.documents.find((x) => x.id === id)?.title || id;
  const cite = (q) => (q ? { document: doc(q.doc), page: q.page, quote: q.quote } : null);
  return {
    amendment: { title: d.title, ref: d.ref, date: d.date, summary: d.summary },
    changes: PACK.changes.filter((c) => c.doc === amendment).map((c) => ({ clause: `${c.document} ${c.clause}`, topic: c.topic, before: cite(c.before), after: cite(c.after), effect: c.effect })),
  };
}

/** The What-if model on the plant given (web/src/whatif/model.js). */
export function checkBid(a = {}) {
  const raw = {};
  const set = (k, v) => { if (v !== undefined && v !== null) raw[k] = v; };
  set("contractedMw", a.contracted_mw);
  set("solarMwac", a.solar_mwac);
  set("windMw", a.wind_mw);
  set("bessMw", a.bess_mw);
  set("bessHours", a.bess_hours);
  set("profile", a.profile);
  set("peakPlan", a.peak_plan);
  set("shortfall", a.shortfall);
  const fin = {};
  if (a.tariff != null) fin.tariff = a.tariff;
  if (a.target_equity_irr_pct != null) fin.targetEquityIrr = a.target_equity_irr_pct / 100;
  if (a.sell_surplus != null) fin.sellSurplus = Boolean(a.sell_surplus);
  if (a.market_price != null) fin.surplusPrice = a.market_price;
  if (a.interest_rate_pct != null) fin.interestRate = a.interest_rate_pct / 100;
  if (a.debt_share_pct != null) fin.debtFraction = a.debt_share_pct / 100;
  if (Object.keys(fin).length) raw.fin = fin;
  const costs = {};
  if (a.solar_capex_cr_per_mwac != null) costs.solarCrPerMwac = a.solar_capex_cr_per_mwac;
  if (a.wind_capex_cr_per_mw != null) costs.windCrPerMw = a.wind_capex_cr_per_mw;
  if (a.bess_capex_cr_per_mwh != null) costs.bessCrPerMwh = a.bess_capex_cr_per_mwh;
  if (Object.keys(costs).length) raw.costs = costs;
  for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && !(Number.isFinite(v) && v >= 0)) return { ok: false, error: `${k} must be a number of 0 or more` };
  const res = runWhatIf(raw, { prices: marketPrices() });
  const i = res.input;
  const y1 = res.year1;
  const pct = (v) => (Number.isFinite(v) ? r(v * 100, 2) : null);
  return {
    ok: true,
    method: "Rule-based hourly dispatch (battery held for the Peak Hours), not the HiGHS optimum; use run_optimizer for that.",
    plant: { contractedMw: i.contractedMw, solarMwac: i.solarMwac, solarMwp: r(i.solarMwac * i.dcAc, 0), windMw: i.windMw, bessMw: i.bessMw, bessMwh: r(i.bessMw * i.bessHours, 0) },
    terms: { profile: PROFILES[res.terms.profile].label, peakPlan: PEAK_PLANS[i.peakPlan]?.label, shortfall: SHORTFALL_MODES[i.shortfall]?.label, ...(res.terms.solar ? { solarHours: `${res.terms.solar.start}:00-${res.terms.solar.end}:00` } : {}) },
    verdict: { pass: "Meets every floor", penalty: "Meets the hard checks; some blocks short, penalty paid", fail: "Fails a tender check" }[res.verdict],
    atTariff: { tariff: res.fin.tariff, equityIrrPct: pct(res.finance.equityIrr), projectIrrPct: pct(res.finance.projectIrr), lenderIrrPct: pct(res.finance.lenderIrr),
      minDscr: r(res.finance.minDscr), avgDscr: r(res.finance.avgDscr), lcoe: r(res.finance.lcoe, 3), equityNpvCr: r(res.finance.equityNpv, 0), paybackYear: res.finance.payback ?? null,
      meetsTargetIrr: res.finance.meetsTarget, bankableAtMinDscr: res.finance.bankable },
    tariffForTargetIrr: r(res.finance.tariffNeeded, 3), targetEquityIrrPct: pct(res.fin.targetEquityIrr),
    year1: {
      deliveredMu: r(y1.deliveredMWh / 1000, 1), contractedMu: r(y1.demandMWh / 1000, 1), soldMu: r(y1.excessMWh / 1000, 1), toBuyerAtHalfTariffMu: r((res.ops[0].buyerExcessMWh || 0) / 1000, 1),
      curtailedMu: r(y1.curtailMWh / 1000, 1), shortOfFloorsMu: r(y1.blockShortfallMWh / 1000, 2), penaltyCr: r(res.penaltyY1, 2),
      floors: Object.entries(y1.rules).map(([k, x]) => ({ hours: k, hoursAtFloorPct: r(x.share * 100, 1), of: x.hours })),
    },
    projectCostCr: r(res.atBid.capex.total, 0),
    checks: res.checks.map((c) => ({ check: c.label, ok: c.ok, detail: c.detail })),
    limits: SECI_LIMITS,
  };
}

function winningBid() {
  const words = { base: "Benchmark", amd3: "Amendment-03", green: "Green buying", bess: "Battery", sell: "Sell surplus", finance: "Finance", wind: "Wind" };
  return {
    result: RESULT,
    bridge: BRIDGE.map((b, k) => ({ step: words[b.id] || b.id, change: b.step, tariff: b.tariff, delta: k ? r(b.tariff - BRIDGE[k - 1].tariff) : null,
      plantPerContractedMw: { solarMwac: b.plant.solar, windMw: b.plant.wind, bessMw: b.plant.bess, bessMwh: b.plant.bessMwh }, basis: b.basis, kind: b.kind })),
    anyOfTheSixteenHours: { tariff: ANY_SIX.tariff, note: "The last step with every hour of 18:00-10:00 held to 90%" },
    disclosed: DISCLOSED, levers: LEVERS.map(([what, size, why]) => ({ what, size, why })),
    comparable: COMPARABLE.map(([what, why]) => ({ what, why })), notVerified: NOT_VERIFIED,
  };
}

/** Runs one tool for a session; returns the tool's JSON result. */
export async function callTool(s, name, args = {}) {
  if (!TOOLS.some((t) => t.name === name)) return { ok: false, error: `Unknown tool ${name}` };
  if (SIZING_TOOLS.has(name)) return sizingTool(s, name);
  if (name === "list_conditions") return listConditions(args);
  if (name === "amendment_changes") return amendmentChanges(args);
  if (name === "check_bid") return checkBid(args);
  if (name === "winning_bid") return winningBid();
  if (name === "tender_lookup") {
    const hits = tenderLookup(String(args.query || ""), 6);
    return hits.length ? { matches: hits } : { matches: [], note: "Nothing in the tender documents matches: say so rather than guess." };
  }
  if (name === "explain_generation") return s.runner(name, { source: "all", year: 1, month: null, day: null, their_mu: null, ...args, show: false });
  if (name === "check_tariff") return s.runner(name, { record: false, ...args });
  if (name === "list_inputs") return s.runner(name, { part: "all", ...args });
  return s.runner(name, args);
}

// ---------------------------------------------------------------- JSON-RPC

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/**
 * Handles one JSON-RPC message for a session. Returns the response object, or null for a
 * notification. base: the site's address, for links to the PDF pages.
 */
export async function handleMessage(msg, s, { base = null } = {}) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid request");
  const isNote = msg.id === undefined || msg.id === null;
  const ok = (result) => (isNote ? null : { jsonrpc: "2.0", id: msg.id, result });
  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return ok({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      if (!TOOLS.some((t) => t.name === name)) return isNote ? null : rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      let out;
      try {
        out = withLinks(await callTool(s, name, args), base);
      } catch (err) {
        out = { ok: false, error: err?.message || String(err) };
      }
      return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 1) }], isError: out?.ok === false });
    }
    case "resources/list":
      return ok({ resources: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return isNote ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/**
 * The HTTP side: one POST body (a message or a batch) for the session named in the
 * Mcp-Session-Id header (a new one at initialize). Returns { status, body, sessionId }.
 */
export async function handlePost(body, sessionId, { base = null, size } = {}) {
  const batch = Array.isArray(body);
  const messages = batch ? body : [body];
  if (!messages.length) return { status: 400, body: rpcError(null, -32600, "Empty batch") };
  const init = messages.some((m) => m?.method === "initialize");
  const s = sessionFor(init ? null : sessionId, size ? { size } : undefined);
  const replies = [];
  for (const m of messages) {
    const reply = await handleMessage(m, s, { base });
    if (reply) replies.push(reply);
  }
  if (!replies.length) return { status: 202, body: null, sessionId: s.id };
  return { status: 200, body: batch ? replies : replies[0], sessionId: s.id };
}
