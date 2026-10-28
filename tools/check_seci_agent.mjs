// Checks for the SECI RTC bid agent (web/src/seci/agent.js): the tools run against a stand-in for
// the tab (the state, the steps shown, a sizing that returns a fixed plant), the guided order of
// questions, the tender lookup, and the GPT-Live event loop answering the backend's function calls.
// Run from the repository root:
//   node tools/check_seci_agent.mjs
import assert from "node:assert/strict";
import { AGENT_TOOLS, LiveEvents, agentInputs, createToolRunner, liveSessionConfig, nextQuestion, readValue, tenderLookup } from "../web/src/seci/agent.js";
import { DEFAULT_SETTINGS, seciTerms } from "../web/src/seci/terms.js";
import { CHART_KINDS, agentChart, floorsByHour } from "../web/src/seci/charts.js";
import * as E from "../web/src/rtc/engine.js";
import { defaultSeciState as defaultSeciStateForChecks } from "../web/src/seci/state.js";

// ---- a stand-in for the tab
let state = defaultSeciStateForChecks();
const shownSteps = [];
const highlighted = [];
const lp = {
  sizes: { solarMw: 610, windMw: 380, bessMw: 210, bessMwh: 840 }, tariff: 5.2, lowerBound: 5.1,
  perYear: [{ year: 1, rules: [{ id: "peak", basis: "block", hoursMet: 0.98, shortfallMu: 2, met: false }, { id: "offpeak", basis: "block", hoursMet: 1, shortfallMu: 0, met: true }], blockShortfallMu: 2 }],
  lifetime: Array.from({ length: 25 }, (_, i) => ({ year: i + 1, demandMwh: 200 * 8760, deliveredMwh: 0.86 * 200 * 8760, exportMwh: 1.5e5, blockShortfallMwh: 2000 })),
};
// a year-1 hourly dispatch: solar by day, wind all day, the battery at night
const hourly = (() => {
  const h = { demand: [], solar: [], wind: [], direct: [], charge: [], discharge: [], export: [] };
  for (let t = 0; t < E.HOURS; t += 1) {
    const hr = E.HOUR_OF_DAY[t];
    const solar = hr >= 7 && hr <= 17 ? 600 * Math.sin((Math.PI * (hr - 6)) / 12) : 0;
    const wind = 90;
    const direct = Math.min(200, solar + wind);
    h.demand.push(200); h.solar.push(solar); h.wind.push(wind); h.direct.push(direct);
    h.charge.push(Math.max(0, solar + wind - direct)); h.discharge.push(hr >= 18 || hr < 6 ? 95 : 0); h.export.push(0);
  }
  return h;
})();
let chartShown = null;
let traceShown = null;
let sized = 0;
const ctx = {
  getHourly: () => (state.lp ? hourly : null),
  showChart: (c) => { chartShown = c; },
  showTrace: (t) => { traceShown = t; },
  getState: () => state,
  apply: (fn) => { state = fn(state); },
  getTerms: () => seciTerms(state.seci),
  goto: (step) => { shownSteps.push(step); state = { ...state, step }; },
  highlight: (t) => highlighted.push(t),
  runSizing: async () => { sized += 1; return lp; },
  stopSizing: () => {},
  getRun: () => null,
};
const run = createToolRunner(ctx);
const r1 = (v) => Number(v.toFixed(1));

// ---- the tool list the session gets
const names = AGENT_TOOLS.map((t) => t.name);
for (const n of ["get_status", "tender_lookup", "next_question", "set_input", "run_optimizer", "get_results", "get_financials", "check_tariff", "review_bid_forms"]) assert.ok(names.includes(n), n);
for (const t of AGENT_TOOLS) assert.equal(t.parameters.type, "object", t.name);
const session = liveSessionConfig({ backendModel: "gpt-6-luna", voice: "marin" });
assert.equal(session.model, "gpt-live-1");
assert.equal(session.delegation.type, "responses");
assert.equal(session.delegation.responses.tools.length, AGENT_TOOLS.length);
assert.equal(session.audio.output.voice, "marin");

// ---- the guided order: the bid first, then the planning choices
let q = await run("next_question", { keep: null, keep_rest: false });
assert.equal(q.key, "bidMw", JSON.stringify(q));
assert.ok(/megawatts/.test(q.question));
assert.equal(shownSteps.at(-1), "bid", "the agent shows the step it asks about");
assert.equal(highlighted.at(-1), "bidMw");

// ---- setting inputs as spoken: words, percent, choices, dates; and refusals that say why
assert.deepEqual(await run("set_input", { key: "bidMw", value: "two hundred" }), { ok: true, key: "bidMw", value: 200 });
let bad = await run("set_input", { key: "bidMw", value: 650 });
assert.equal(bad.ok, false);
assert.ok(/outside 50 to 500/.test(bad.error), bad.error);
assert.equal((await run("set_input", { key: "peakPlan", value: "evening" })).value, "Evening 18:00–24:00");
assert.equal(state.seci.peakPlan, "evening");
assert.equal((await run("set_input", { key: "ppaDate", value: "7 June 2026" })).value, "2026-06-07");
bad = await run("set_input", { key: "use.bess", value: "no" });
assert.ok(!bad.ok && /mandatory/.test(bad.error), bad.error);
bad = await run("set_input", { key: "solar.nonsense", value: 1 });
assert.ok(!bad.ok && /list_inputs/.test(bad.error));
assert.equal((await run("set_input", { key: "use.wind", value: true })).ok, true);

// fill the rest with benchmarks, then change one in percent
const filled = await run("use_benchmarks");
assert.ok(filled.ok && filled.filled > 5, JSON.stringify(filled));
assert.deepEqual(filled.stillMissing, []);
assert.equal((await run("set_input", { key: "wind.cuf", value: 35 })).value, 35);
assert.equal(state.src.wind.cuf, 0.35, "percent inputs take percent");
assert.equal(readValue(agentInputs(state).find((x) => x.key === "fin.targetEquityIrr"), "fourteen point five"), 0.145);
assert.equal((await run("set_input", { key: "solar.size", value: "auto" })).value, "auto");
assert.equal((await run("set_input", { key: "market.sell", value: "no" })).value, false);

// the guided walk: answered inputs are done, the next is asked with its current value
q = await run("next_question", { keep: null, keep_rest: false });
assert.equal(q.key, "shortfall", JSON.stringify(q));
assert.equal(q.current, "Pay the penalty");
q = await run("next_question", { keep: "shortfall", keep_rest: false });
assert.equal(q.key, "solar.cuf", "the benchmarks were accepted with use_benchmarks, so the walk goes on to each value");
assert.equal(q.benchmark, 25);
q = await run("next_question", { keep: null, keep_rest: true });
assert.ok(q.done, JSON.stringify(q));

// ---- the optimizer, the results, the financials
const sizedRes = await run("run_optimizer");
assert.ok(sizedRes.ok, JSON.stringify(sizedRes));
assert.equal(sized, 1);
assert.equal(sizedRes.plant.solarMw, 610);
assert.ok(/For 200 megawatts/.test(sizedRes.summary), sizedRes.summary);
assert.deepEqual(sizedRes.year1Floors[0], { floor: "peak", hoursMetPct: 98, shortfallMu: 2 });
assert.equal(sizedRes.dates.scsd, "2028-06-07");
assert.ok(shownSteps.includes("size"));
const fin = await run("get_financials");
assert.ok(fin.bidTariff > 0 && Math.abs(fin.equityIrrPct - 14) < 0.01 && fin.projectIrrPct > 0, JSON.stringify(fin));

// ---- the CFO's check: the energy as MW × CUF × 365 × 24, a month, a day's 15-minute blocks
const gen = await run("explain_generation", { source: "solar", year: 1, month: null, day: null, their_mu: null, show: true });
assert.ok(gen.ok, JSON.stringify(gen));
const sol = gen.sources[0];
assert.equal(sol.mw, 610);
assert.match(sol.steps[0], /^610\.0 MW × [\d.]+% CUF × 365 × 24 ÷ 1,000 = [\d,.]+ MU$/);
const base = (610 * sol.cufPct / 100 * 8760) / 1000;
assert.ok(Math.abs(sol.generationMu - base) < 0.06, `year 1 is MW × CUF × 8,760: ${sol.generationMu} vs ${base}`);
assert.ok(Math.abs(sol.months.reduce((a, m) => a + m.mu, 0) - sol.atBusMu) < 0.6, "the months add up to the year");
assert.match(sol.excelCells.generation, /^'Live model'!E\d+$/);
assert.match(gen.spoken, /610 megawatts times [\d.]+ percent CUF times 365 days times 24 hours/);
assert.equal(shownSteps.at(-1), "finance");
assert.deepEqual(traceShown, { line: sol.atBusMu !== sol.generationMu ? "solarBus" : "solarGen", year: 1, drill: null });
// the CFO reads out a figure: the model's own matches; MW × CUF × 8,760 alone is explained
const mine = await run("explain_generation", { source: "solar", year: 1, month: null, day: null, their_mu: sol.atBusMu, show: false });
assert.ok(mine.check.matches, JSON.stringify(mine.check));
assert.ok(mine.spoken.startsWith("Your"), mine.spoken);
const y10 = await run("explain_generation", { source: "solar", year: 10, month: null, day: null, their_mu: r1(base), show: false });
assert.equal(y10.check.matches, false);
assert.match(y10.check.verdict, /degradation/, y10.check.verdict);
const june = await run("explain_generation", { source: "solar", year: 1, month: 6, day: 21, their_mu: null, show: true });
assert.equal(june.sources[0].month.month, "June");
assert.equal(june.sources[0].day.blocks, 96);
assert.equal(june.sources[0].day.date, "21 June");
assert.match(june.sources[0].day.peakBlock.steps, /610\.0 MW × [\d.]+ × 0\.25 h/);
assert.deepEqual(traceShown.drill, { month: 6, day: 21 });
const all = await run("explain_generation", { source: "all", year: 1, month: null, day: null, their_mu: null, show: false });
assert.equal(all.sources.length, 2);
assert.ok(Math.abs(all.dispatch.generatedAtBusMu - all.dispatch.deliveredMu - all.dispatch.soldMu - all.dispatch.notDeliveredOrSoldMu) < 0.2, JSON.stringify(all.dispatch));
assert.ok(!/solver/i.test(all.spoken));

// a change after sizing clears it and says so
const changed = await run("set_input", { key: "wind.capex", value: 6.8 });
assert.ok(changed.ok && /run the optimizer again/.test(changed.note), JSON.stringify(changed));
assert.equal(state.lp, null);
await run("run_optimizer");
assert.equal(sized, 2, "the optimizer runs again");

// ---- the tariff quoted: a low quote is warned with the IRRs it earns, and recorded
const target = (await run("get_financials")).bidTariff;
const low = await run("check_tariff", { tariff: Number((target - 0.6).toFixed(2)), record: true });
assert.equal(low.status, "below", JSON.stringify(low));
assert.ok(low.equityIrrPct < 14 && low.projectIrrPct < fin.projectIrrPct + 1e-9, JSON.stringify(low));
assert.ok(/below the/.test(low.message));
assert.equal(state.forms.tariff, Number((target - 0.6).toFixed(2)), "recorded as the tariff quoted");
const viaForm = await run("set_input", { key: "forms.tariff", value: Math.ceil(target * 100) / 100 });
assert.equal(viaForm.quote.status, "ok", JSON.stringify(viaForm));

// ---- the bid forms
const forms = await run("review_bid_forms");
assert.ok(forms.particularsStillEmpty.includes("Bidder's name"));
assert.ok(forms.checks.some((c) => c.check === "Net worth"));
assert.equal(shownSteps.at(-1), "forms");
assert.ok(forms.formats.needed >= 10 && forms.formats.reviewed === 0, JSON.stringify(forms.formats));
assert.ok(forms.formats.list.some((f) => f.id === "7.1") && !forms.formats.list.some((f) => f.id === "7.2"), "a single company needs no consortium Power of Attorney");
assert.equal((await run("set_input", { key: "forms.bidder", value: "Acme Renewables Ltd" })).value, "Acme Renewables Ltd");
assert.equal(highlighted.at(-1), "form.bidder");

// a format: its blanks with where each value comes from, filled by voice, reviewed on the bidder's word
const f71 = await run("open_format", { id: "Format 7.1" });
assert.equal(f71.id, "7.1");
assert.equal(state.formsView, "7.1", "the format is shown");
const blank = (label) => f71.blanks.find((b) => b.label === label);
assert.equal(blank("Bidding Company / Lead Member name").value, "Acme Renewables Ltd", "the particulars fill every format");
assert.equal(blank("Contracted capacity offered (MW, per project)").from, "the bid (not editable)");
assert.equal(blank("Contracted capacity offered (MW, per project)").value, "200");
assert.ok(/^610 MWac( \(\d+ MWp DC\))?$/.test(blank("Solar PV component (MWac, with its MWp)").value) && blank("RfS number").value === "SECI/C&P/IPP/13/0020/25-26");
assert.ok(/^INR /.test(blank("EMD amount (INR)").value), blank("EMD amount (INR)").value);
const ref = blank("Reference number");
assert.equal(ref.key, "forms.7.1.refNo");
assert.ok(ref.rfs.page === 68 && ref.rfs.words.length > 10);
assert.equal((await run("set_input", { key: ref.key, value: "ACME/SECI/2026/01" })).value, "ACME/SECI/2026/01");
assert.equal(state.forms["7.1.refNo"], "ACME/SECI/2026/01");
assert.equal((await run("open_format", { id: "7.1" })).blanks.find((b) => b.label === "Reference number").value, "ACME/SECI/2026/01");
assert.ok(!(await run("open_format", { id: "9.9" })).ok);
assert.equal((await run("mark_format_reviewed", { id: "7.1", reviewed: true })).ok, true);
assert.ok(state.formsReview["7.1"].print);
assert.equal((await run("review_bid_forms")).formats.list.find((f) => f.id === "7.1").reviewed, "current");
await run("set_input", { key: "forms.7.1.refNo", value: "ACME/SECI/2026/02" });
assert.equal((await run("review_bid_forms")).formats.list.find((f) => f.id === "7.1").reviewed, "changed", "an edit after the review shows");
assert.ok((await run("open_format", { id: "particulars" })).particulars.some((x) => x.key === "forms.signatory"));

// ---- charts: drawn from the bid, each with a summary for the agent to describe
assert.deepEqual(Object.keys(CHART_KINDS), ["peak_window", "typical_day", "monthly_energy", "irr_vs_tariff", "cash_flows", "money"]);
const floorsAny = floorsByHour({ bid: { baseMw: 200 }, seci: { peakPlan: "any" } });
assert.equal(floorsAny.filter((v) => v === 180).length, 16, "any 6 of 16: every window hour held at 90%");
assert.deepEqual([floorsAny[18], floorsAny[9], floorsAny[10], floorsAny[17], floorsAny[2]], [180, 180, 100, 100, 180], "Amendment-03: 50% in the Solar Hours (08-18) outside the window");
const floorsBefore = floorsByHour({ bid: { baseMw: 200 }, seci: { peakPlan: "any", profile: "amd1" } });
assert.deepEqual([floorsBefore[10], floorsBefore[17]], [140, 140], "before Amendment-03: 70% off-peak");
const floorsEve = floorsByHour({ bid: { baseMw: 200 }, seci: { peakPlan: "evening" } });
assert.equal(floorsEve.filter((v) => v === 180).length, 6);
const unsized = agentChart("peak_window", { state: { ...state, lp: null, seci: { ...state.seci, peakPlan: "evening" } }, terms: ctx.getTerms() });
assert.equal(unsized.summary.sized, false);
assert.equal(unsized.summary.hoursHeldToPeakFloor, 6);
assert.ok(unsized.option.series.some((x) => x.name === "Floor if a morning hour is picked"), "the evening plan shows the morning risk");
assert.throws(() => agentChart("typical_day", { state: { ...state, lp: null }, terms: ctx.getTerms() }), /Size the plant first/);
assert.throws(() => agentChart("nonsense", { state, terms: ctx.getTerms() }), /No chart/);
let shown = await run("show_chart", { kind: "peak_window", month: null, from: null, to: null });
assert.ok(shown.ok && chartShown.kind === "peak_window" && shown.summary.sized === true, JSON.stringify(shown).slice(0, 300));
assert.equal(chartShown.option.series[0].data.length, 24);
assert.ok(Array.isArray(shown.summary.hoursWhereTheWorstDayFallsBelowTheFloor));
shown = await run("show_chart", { kind: "typical_day", month: 6, from: null, to: null });
assert.ok(shown.ok && /Jun/.test(shown.shown) && shown.summary.solarPeak.hour === "12", JSON.stringify(shown.summary));
assert.equal(shown.summary.batteryDischargePeak.mw, 95);
shown = await run("show_chart", { kind: "monthly_energy", month: null, from: null, to: null });
assert.ok(shown.ok && shown.summary.deliveredMu > 1000 && chartShown.option.xAxis.data.length === 12, JSON.stringify(shown.summary));
shown = await run("show_chart", { kind: "irr_vs_tariff", month: null, from: null, to: null });
assert.ok(shown.ok && Math.abs(shown.summary.targetEquityIrrPct - 14) < 0.01 && shown.summary.quote?.equityIrrPct > 0, JSON.stringify(shown.summary));
const eq = chartShown.option.series[0].data;
assert.ok(eq.length >= 10 && eq.every((p, i) => i === 0 || p[1] >= eq[i - 1][1] - 1e-9), "the equity IRR rises with the tariff");
for (const kind of ["cash_flows", "money"]) {
  shown = await run("show_chart", { kind, month: null, from: null, to: null });
  assert.ok(shown.ok && chartShown.kind === kind, `${kind}: ${JSON.stringify(shown).slice(0, 200)}`);
}
assert.ok(shown.summary.EMD > 0 && shown.summary["Net worth needed"] > shown.summary.EMD);

// ---- status
const st = await run("get_status");
assert.equal(st.optimizer, "sized");
assert.equal(st.bid.contractedMw, 200);
assert.equal(st.quote.status, "ok");

// ---- the tender, with document and page
const emd = tenderLookup("EMD")[0];
assert.equal(emd.id, "emd", JSON.stringify(emd));
assert.ok(emd.sources[0].page > 0 && emd.sources[0].document);
assert.ok(tenderLookup("peak hours").some((x) => x.id === "peakHours"));
assert.equal(tenderLookup("dfrOffpeak")[0].id, "dfrOffpeak", "an exact id returns that condition");
const none = await run("tender_lookup", { query: "zzzz qqqq" });
assert.deepEqual(none.matches, []);
assert.ok((await run("tender_brief")).conditions.length >= 5);

// ---- the event loop: a backend function call is run and answered, then the response continues
const sent = [];
const seen = { heard: "", said: "", tools: [] };
let toolRuns = 0;
const loop = new LiveEvents({
  send: (o) => sent.push(o),
  runTool: async (name, args) => { toolRuns += 1; return run(name, args); },
  on: { heard: (t) => { seen.heard += t; }, said: (t) => { seen.said += t; }, tool: (n) => seen.tools.push(n) },
});
await loop.handle(JSON.stringify({ type: "session.started", session: { id: "live_1" } }));
assert.ok(loop.ready);
await loop.handle({ type: "session.input_transcript.delta", delta: "make the bid ", start_ms: 0, end_ms: 400 });
await loop.handle({ type: "session.input_transcript.delta", delta: "two fifty", start_ms: 400, end_ms: 800 });
assert.equal(seen.heard, "make the bid two fifty");
await loop.handle({ type: "session.delegation.created", delegation: { id: "item_1", type: "delegation", target: "responses" } });
await loop.handle({ type: "response.event", delegation_id: "item_1", event: { type: "response.created", response: { id: "resp_1" } } });
await loop.handle({ type: "response.event", delegation_id: "item_1", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "call_9", name: "set_input", arguments: JSON.stringify({ key: "bidMw", value: 250 }) } } });
assert.equal(sent.length, 0, "results wait for the response to complete");
await loop.handle({ type: "response.event", delegation_id: "item_1", event: { type: "response.completed", response: { id: "resp_1", output: [] } } });
assert.equal(toolRuns, 1);
assert.equal(state.bid.baseMw, 250, "the spoken change reached the screen");
assert.equal(sent.length, 2);
assert.equal(sent[0].type, "response.item.create");
assert.equal(sent[0].item.type, "function_call_output");
assert.equal(sent[0].item.call_id, "call_9");
assert.deepEqual(JSON.parse(sent[0].item.output), { ok: true, key: "bidMw", value: 250, note: "The sizing was cleared: run the optimizer again for new results." });
assert.equal(sent[1].type, "response.create");
assert.notEqual(sent[0].event_id, sent[1].event_id);
assert.deepEqual(seen.tools, ["set_input"]);
// a response with no calls sends nothing
await loop.handle({ type: "response.event", delegation_id: "item_2", event: { type: "response.created", response: { id: "resp_2" } } });
await loop.handle({ type: "response.event", delegation_id: "item_2", event: { type: "response.completed", response: { id: "resp_2", output: [] } } });
assert.equal(sent.length, 2);
await loop.handle({ type: "session.output_transcript.delta", delta: "Done: 250 megawatts." });
assert.equal(seen.said, "Done: 250 megawatts.");
let closed = null;
loop.on.closed = (u) => { closed = u; };
await loop.handle({ type: "session.closed", usage: { seconds: 42 } });
assert.deepEqual(closed, { seconds: 42 });
assert.equal(loop.ready, false);

console.log(`SECI bid agent checks passed (${AGENT_TOOLS.length} tools, ${agentInputs(state).length} inputs; next after the bid: ${nextQuestion(defaultSeciStateForChecks(), seciTerms(DEFAULT_SETTINGS), new Set(["bidMw"])).key})`);
