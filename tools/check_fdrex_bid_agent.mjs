// Checks for the FDRE-X Bid tab's voice agent (web/src/fdrex/bidAgent.js): the tools run against a
// stand-in for the tab (the state, the steps shown, a sizing that returns a fixed FDRE-X plant), the
// guided order of questions, the tender's brief and lookup with their pages, the results with the
// monthly rule and the bought power, the financials, the quote, the instant what-if, the bid forms,
// and the GPT-Live event loop answering the backend's function calls. Run from the repository root:
//   node tools/check_fdrex_bid_agent.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_TOOLS, GREETING, STEPS, agentInputs, createToolRunner, liveSessionConfig, nextQuestion, tenderBrief } from "../web/src/fdrex/bidAgent.js";
import { LiveEvents } from "../web/src/seci/agent.js";
import { STEP_IDS, defaultFdrexBidState } from "../web/src/fdrex/bidState.js";
import { fdrexTerms, seciChargesCr } from "../web/src/fdrex/bidTerms.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));

// ---- a stand-in for the tab
let state = defaultFdrexBidState();
const shown = [];
const highlighted = [];
const lp = {
  sizes: { solarMw: 21, windMw: 89, bessMw: 74, bessMwh: 297 }, tariff: 8.927, lowerBound: 8.9, market: "GDAM", flatPrice: null,
  perYear: [{ year: 1, rules: [{ id: "peak", basis: "monthly", tolerance: 0.1, withinTolerance: false, penaltyMultiple: 1.5 }] }],
  lifetime: Array.from({ length: 25 }, (_, i) => ({ year: i + 1, demandMwh: 146000, deliveredMwh: 133560 - i * 20, exportMwh: 82230, exportRevenueCr: 56.36, monthlyPenaltyMwh: 120 + i * 10, blockShortfallMwh: 120 + i * 10, purchaseMwh: 7300, purchaseCostCr: 3.36 })),
};
let sized = 0;
let traceShown = null;
const ctx = {
  getState: () => state,
  apply: (fn) => { state = fn(state); },
  getTerms: () => fdrexTerms(state.fdrex, prices),
  getPrices: () => prices,
  goto: (step) => { shown.push(step); state = { ...state, step }; },
  highlight: (t) => highlighted.push(t),
  runSizing: async () => { sized += 1; return lp; },
  stopSizing: () => {},
  getRun: () => null,
  showTrace: (t) => { traceShown = t; },
};
const run = createToolRunner(ctx);

// ---- the tool list and the session
const names = AGENT_TOOLS.map((t) => t.name);
for (const n of ["get_status", "tender_brief", "tender_lookup", "list_conditions", "amendment_changes", "next_question", "list_inputs", "set_input", "use_benchmarks", "go_to_step",
  "run_optimizer", "stop_optimizer", "get_results", "get_financials", "check_tariff", "what_if", "explain_generation", "review_bid_forms", "open_format", "mark_format_reviewed"]) assert.ok(names.includes(n), n);
assert.equal(new Set(names).size, names.length, "no tool twice");
for (const t of AGENT_TOOLS) {
  assert.equal(t.parameters.type, "object", t.name);
  assert.equal(t.parameters.additionalProperties, false, t.name);
  // strict-style schemas: every property is required (nullable where optional)
  assert.deepEqual([...t.parameters.required].sort(), Object.keys(t.parameters.properties).sort(), t.name);
}
assert.deepEqual(STEPS, STEP_IDS, "the agent's steps are the tab's");
const session = liveSessionConfig({ backendModel: "gpt-6-luna", voice: "marin", greeting: GREETING });
assert.equal(session.model, "gpt-live-1");
assert.equal(session.delegation.type, "responses");
assert.equal(session.delegation.responses.tools, AGENT_TOOLS);
assert.ok(/FDRE-X/.test(session.instructions) && /4,800|4800/.test(session.instructions));
assert.ok(!/strike price/i.test(session.instructions), "the voice never speaks of a strike price");
assert.ok(/no Contract for Difference/.test(session.delegation.responses.instructions));

// ---- the tender: the brief and the lookup carry their pages
const brief = tenderBrief();
assert.ok(brief.length >= 4);
for (const b of brief) {
  assert.ok(b.say.length > 40);
  assert.ok(b.sources.length > 0 && b.sources.every((q) => q.page > 0 && q.quote), "every paragraph rests on a quoted page");
}
const hits = await run("tender_lookup", { query: "monthly shortfall penalty" });
assert.ok(hits.matches.length > 0 && hits.matches[0].page > 0);
const none = await run("tender_lookup", { query: "zzzz qqqq" });
assert.equal(none.matches.length, 0);
assert.ok(none.note);
const groups = await run("list_conditions", { group: null });
assert.ok(groups.groups.includes("Daily supply"));
const daily = await run("list_conditions", { group: "Daily supply" });
assert.ok(daily.conditions.length > 0 && daily.conditions.every((c) => c.group === "Daily supply"));
const amd = await run("amendment_changes", { amendment: "all" });
assert.ok(amd.amendments.length === 1 && amd.amendments[0].changes.length === 12, "Amendment-01's twelve rows");

// ---- the guided order
const terms0 = fdrexTerms(state.fdrex, prices);
const order = [];
const confirmed = new Set();
for (let q = nextQuestion(state, terms0, confirmed); q && order.length < 20; q = nextQuestion(state, terms0, confirmed)) { order.push(q.key); confirmed.add(q.key); }
assert.deepEqual(order.slice(0, 11), ["bidMw", "peakPlan", "shortfall", "buy", "buyCharges", "dayInjection", "market.sell", "market.source", "psm", "ppaDate", "fill"]);
// the sale is a bid input, and its market is offered only when selling
{
  const sell = agentInputs(state).find((x) => x.key === "market.sell");
  assert.equal(sell.step, "bid");
  const off = { ...state, market: { ...state.market, sell: false } };
  assert.ok(!agentInputs(off).some((x) => x.key === "market.source"), "no market without a sale");
}
const first = await run("next_question", { keep: null, keep_rest: false });
assert.equal(first.key, "bidMw");
assert.equal(first.current, 100);
assert.equal(shown.at(-1), "bid");

// ---- inputs
let res = await run("set_input", { key: "bidMw", value: "two hundred" });
assert.deepEqual(res, { ok: true, key: "bidMw", value: 200 });
assert.equal(state.bid.baseMw, 200);
res = await run("set_input", { key: "bidMw", value: 700 });
assert.equal(res.ok, false, "beyond 600 MW refused");
res = await run("set_input", { key: "peakPlan", value: "Evening 18:00–22:00" });
assert.equal(state.fdrex.peakPlan, "evening");
res = await run("set_input", { key: "shortfall", value: "hard" });
assert.equal(state.fdrex.shortfall, "hard");
res = await run("set_input", { key: "buy", value: "no" });
assert.equal(state.fdrex.buy, false);
assert.ok(!agentInputs(state).some((x) => x.key === "buyCharges"), "no charges without buying");
await run("set_input", { key: "buy", value: "yes" });
res = await run("set_input", { key: "buyCharges", value: 0.45 });
assert.equal(state.fdrex.buyCharges, 0.45);
res = await run("set_input", { key: "ppaDate", value: "2027-06-01" });
assert.equal(state.fdrex.ppaDate, "2027-06-01");
assert.equal(res.dates.scsd, "2028-12-01", "supply 18 months from the Effective Date");
res = await run("set_input", { key: "use.bess", value: false });
assert.equal(res.ok, false, "storage is mandatory");
res = await run("set_input", { key: "wind.size", value: "120" });
assert.deepEqual(state.src.wind.capacity, { mode: "fixed", mw: 120 });
res = await run("set_input", { key: "wind.size", value: "auto" });
assert.equal(state.src.wind.capacity.mode, "optimise");
const listed = await run("list_inputs", { part: "bid" });
assert.ok(listed.inputs.some((x) => x.key === "psm" && x.value === false));

// ---- sizing, results, financials
await run("set_input", { key: "shortfall", value: "penalty" });
await run("set_input", { key: "bidMw", value: 100 });
res = await run("run_optimizer", {});
assert.equal(res.ok, false, "inputs empty: the optimizer asks for them first");
res = await run("use_benchmarks", {});
assert.ok(res.ok && res.stillMissing.length === 0, `still missing: ${res.stillMissing}`);
res = await run("run_optimizer", {});
assert.equal(sized, 1);
assert.ok(res.ok);
assert.equal(res.plant.windMw, 89);
assert.equal(res.year1.boughtPct, 5);
assert.equal(res.year1.penalisedMu, 0.12);
assert.equal(res.monthlyRule.tolerancePct, 10);
assert.equal(res.year1.saleMarket, "IEX GDAM", "the market the surplus is sold on");
assert.ok(Math.abs(res.seciChargesCr - Number(seciChargesCr(lp.sizes, 100).toFixed(2))) < 1e-9);
assert.equal(res.dates.scsd, "2028-12-01");
assert.equal(shown.at(-1), "size");
const status = await run("get_status", {});
assert.match(status.bid.sellSurplus, /^yes, on IEX GDAM/);
assert.equal(status.optimizer, "sized");
assert.equal(status.bid.buyersHours, "Evening 18:00–22:00");
const fin = await run("get_financials", {});
assert.ok(fin.bidTariff > 6 && fin.bidTariff < 14, `tariff ${fin.bidTariff}`);
assert.ok(Math.abs(fin.equityIrrPct - 14) < 0.05, "the tariff is the one for the target IRR");
assert.ok(fin.powerBoughtOverTermCr > 0, "the bought power's cost");
assert.equal(fin.psmDiscountOverTermCr, 0);
assert.ok(fin.quoteRoundedUp >= fin.bidTariff - 5e-4 && fin.quoteRoundedUp < fin.bidTariff + 0.0105, "the quote rounded up to the paisa");

// ---- the quote
res = await run("check_tariff", { tariff: fin.bidTariff - 0.5, record: false });
assert.ok(res.ok && res.equityIrrPct < 14 && /below|short/i.test(`${res.status} ${res.message}`), "a quote below the target warns");
res = await run("check_tariff", { tariff: fin.quoteRoundedUp, record: true });
assert.ok(res.recorded && state.forms.tariff === fin.quoteRoundedUp);

// ---- the what-if
res = await run("what_if", { solarMw: null, windMw: null, storageMw: null, storageHours: null, solarCapex: null, windCapex: null, storageCapex: null, targetEquityIrrPct: null, tariff: null, show: false });
assert.ok(res.ok && Math.abs(res.change) < 1e-9, "unchanged: the same tariff as sized");
const asSized = res.tariffNeeded;
res = await run("what_if", { solarMw: null, windMw: null, storageMw: null, storageHours: null, solarCapex: null, windCapex: null, storageCapex: 0.6, targetEquityIrrPct: null, tariff: null, show: true });
assert.ok(res.tariffNeeded < asSized, "cheaper storage, a lower tariff");
assert.equal(shown.at(-1), "whatif");
res = await run("what_if", { solarMw: null, windMw: null, storageMw: null, storageHours: null, solarCapex: null, windCapex: null, storageCapex: null, targetEquityIrrPct: 12, tariff: null, show: false });
assert.ok(res.tariffNeeded < asSized, "a lower target IRR, a lower tariff");
assert.ok(res.year1.boughtPct <= 5 + 1e-9);

// ---- the energy, traced
res = await run("explain_generation", { source: "wind", year: 1, month: null, day: null, their_mu: null, show: true });
assert.ok(res.ok, res.error);
assert.ok(traceShown, "the traceable model opened");

// ---- the bid forms
res = await run("review_bid_forms", {});
assert.ok(res.particularsStillEmpty.length > 0);
assert.ok(res.formats.needed > 0 && res.formats.list.length > 0);
assert.ok(res.checks.some((c) => /capacity/i.test(c.check)));
res = await run("open_format", { id: "particulars" });
assert.ok(res.particulars.some((p) => p.key === "forms.bidder"));
res = await run("set_input", { key: "forms.bidder", value: "Example Renewables Private Limited" });
assert.ok(res.ok);
res = await run("open_format", { id: "7.1" });
assert.equal(state.formsView, "7.1");
assert.ok(res.blanks.length > 0 && res.blanks.every((b) => b.rfs.page > 0));
const own = res.blanks.find((b) => b.key && b.key.startsWith("forms.7.1."));
if (own) {
  res = await run("set_input", { key: own.key, value: "SECI/FDRE-X/001" });
  assert.ok(res.ok, res.error);
}
res = await run("mark_format_reviewed", { id: "7.1", reviewed: true });
assert.ok(res.ok && state.formsReview["7.1"]);
res = await run("open_format", { id: "Format 9.9" });
assert.equal(res.ok, false);

// ---- unknown tools and steps
assert.equal((await run("no_such_tool", {})).ok, false);
assert.equal((await run("go_to_step", { step: "explain" })).ok, false);
assert.equal((await run("go_to_step", { step: "whatif" })).ok, true);

// ---- the GPT-Live loop answers the backend's call on this tab's state
const sent = [];
const loop = new LiveEvents({ send: (o) => sent.push(o), runTool: (name, args) => run(name, args) });
await loop.handle({ type: "session.started", session: { id: "live_1" } });
await loop.handle({ type: "response.event", delegation_id: "d1", event: { type: "response.created", response: { id: "r1" } } });
await loop.handle({ type: "response.event", delegation_id: "d1", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "set_input", arguments: JSON.stringify({ key: "psm", value: "yes" }) } } });
await loop.handle({ type: "response.event", delegation_id: "d1", event: { type: "response.completed", response: { id: "r1", output: [] } } });
assert.equal(state.fdrex.psm, true, "the spoken change reached the screen");
assert.equal(state.lp, null, "and cleared the sizing");
assert.equal(sent[0].item.call_id, "c1");
assert.equal(JSON.parse(sent[0].item.output).ok, true);
assert.equal(sent[1].type, "response.create");

// the curtailed energy, from the year-1 hourly dispatch on screen
{
  const hourly = { curtail: Array.from({ length: 8760 }, (_, t) => (t % 24 === 12 ? 100 : 0)) };
  state = { ...state, lp };
  const run2 = createToolRunner({ ...ctx, getHourly: () => hourly });
  const r2 = await run2("get_results", {});
  assert.equal(r2.year1.curtailedMu, 36.5, "365 days × 100 MWh");
}
console.log(`FDRE-X bid agent checks passed (${AGENT_TOOLS.length} tools, ${agentInputs(state).length} inputs; guided order ${order.slice(0, 11).join(" → ")})`);
