// Checks for the CfD bid agent (web/src/cfd/agent.js, voice.js): every input the agent can set
// round-trips through set and get, values are read and checked, the guided script walks the steps
// in order, the tools answer against a modelled bid. Run from the repository root:
//   node tools/check_cfd_agent.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_TOOLS, STEPS, agentInputs, amendmentChanges, createToolRunner, liveSessionConfig, nextQuestion, readValue, shown, status, tenderLookup } from "../web/src/cfd/agent.js";
import { ASKED, buildScript, explainCfd, explainFinance, explainResults, tenderBrief } from "../web/src/cfd/voice.js";
import { defaultCfdState, fillBenchmarks, missingInputs, runModel } from "../web/src/cfd/model.js";
import { TERMS } from "../web/src/cfd/terms.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const base = { ...defaultCfdState(), fin: {}, costs: {}, forms: {}, quoteTariff: null };

// ---- the inputs
const inputs = agentInputs(base);
assert.ok(inputs.length >= 55, `inputs on screen: ${inputs.length}`);
assert.equal(new Set(inputs.map((x) => x.key)).size, inputs.length, "unique keys");
for (const x of inputs) assert.ok(STEPS.includes(x.step), `${x.key}: step ${x.step}`);
const byKey = Object.fromEntries(inputs.map((x) => [x.key, x]));
let s = byKey.contractedMw.set(base, readValue(byKey.contractedMw, "120"));
assert.equal(byKey.contractedMw.get(s), 120);
assert.throws(() => byKey.contractedMw.set(base, 120.5), /whole megawatts/);
assert.throws(() => readValue(byKey.contractedMw, "600"), /outside/);
s = byKey.solarCuf.set(s, readValue(byKey.solarCuf, 24));
assert.equal(byKey.solarCuf.get(s), 0.24, "percent inputs take percent");
assert.equal(shown(byKey.solarCuf, 0.24), 24);
s = byKey.useMarket.set(s, readValue(byKey.useMarket, "yes"));
assert.equal(s.inputs.useMarket, true);
s = byKey.sellMarket.set(s, readValue(byKey.sellMarket, "green"));
assert.equal(s.inputs.sellMarket, "GDAM", "a choice by part of its label");
s = byKey.effectiveDate.set(s, readValue(byKey.effectiveDate, "1 February 2027"));
assert.equal(s.inputs.effectiveDate, "2027-02-01");
s = byKey["fin.repayment"].set(s, readValue(byKey["fin.repayment"], "annuity"));
assert.equal(s.fin.repayment, "annuity");
s = byKey["fin.paymentsPerYear"].set(s, readValue(byKey["fin.paymentsPerYear"], "Quarterly"));
assert.equal(s.fin.paymentsPerYear, 4, "instalments are stored as a number");
s = byKey["costs.constructionMonths"].set(s, readValue(byKey["costs.constructionMonths"], "14.6"));
assert.equal(s.costs.constructionMonths, 15, "whole months");
s = byKey.quoteTariff.set(s, readValue(byKey.quoteTariff, "5.678"));
assert.equal(s.quoteTariff, 5.68, "the quote is kept to the paisa");
assert.equal(s.forms.tariff, 5.68, "and goes into the forms");

// ---- the script and the guided sequence
const script = buildScript(base);
const ids = script.map((i) => i.id);
assert.deepEqual(ids.slice(0, 5), ["intro", "c.cfd", "c.supply", "c.plant", "c.bid"]);
assert.ok(ids.indexOf("contractedMw") < ids.indexOf("fill") && ids.indexOf("fill") < ids.indexOf("essMwhPerMw") && ids.indexOf("targetEquityIrr") < ids.indexOf("size"), "bid, then design, then finance, then size");
for (const key of [...ASKED.design, ...ASKED.finance]) assert.ok(byKey[key], `${key} asked is an input`);
for (const item of script) if (item.kind === "number" || item.kind === "choice" || item.kind === "date") assert.ok(item.read && item.set && item.current, `${item.id} reads and sets`);
assert.equal(script.find((i) => i.id === "rte").read("eighty seven percent"), 0.87);
assert.equal(script.find((i) => i.id === "merchant").read("no thanks"), false);
assert.equal(tenderBrief(base).length, 4);
const q1 = nextQuestion(base);
assert.equal(q1.key, "contractedMw");
const confirmed = new Set(["contractedMw", "effectiveDate", "sellMarket", "useMarket", "useGroup", "merchant", "afterTerm"]);
assert.equal(nextQuestion(base, confirmed).key, "fill", "offers the benchmarks before the design numbers");
const filled = fillBenchmarks({ ...base, inputs: { ...base.inputs, effectiveDate: "2027-02-01" } });
assert.equal(missingInputs(filled).length, 0, "benchmarks complete the inputs");
assert.equal(nextQuestion(filled, new Set([...confirmed, "fill"])).key, "essMwhPerMw");

// ---- the tender
assert.ok(tenderLookup("net worth").some((t) => t.id === "netWorth"));
assert.equal(tenderLookup("ess")[0].id, "ess", "an exact id first");
assert.ok(tenderLookup("peak hours penalty").length >= 2);
assert.equal(tenderLookup("zzzz qqqq").length, 0);
const amd = amendmentChanges("amd3");
assert.equal(amd.length, 1);
assert.ok(amd[0].now.some((t) => t.id === "settlement") && amd[0].now.some((t) => t.id === "term"), "Amendment-03: full settlement and the 15-year term");
assert.ok(amendmentChanges("all").length >= 2 && amendmentChanges("all").every((a) => a.amendment && Array.isArray(a.now)), "every amendment in the pack");

// ---- the tools against a modelled bid
const model = runModel(filled, prices);
assert.ok(model && model.sp > 0, "the benchmark bid has a strike price");
let state = filled;
const gone = [];
const run = createToolRunner({
  getState: () => state, apply: (fn) => { state = fn(state); }, goto: (st) => gone.push(st), highlight: () => {},
  runSizing: async () => ({ solarMw: 150, windMw: 0, sp: model.sp, ok: true }), stopSizing: () => {}, getRun: () => null,
  getModel: () => runModel(state, prices), getPrices: () => prices,
});
const st = await run("get_status");
assert.equal(st.inputsMissing, "none");
assert.ok(st.strikePrice.forTargetIrr > 0);
const res = await run("get_results");
assert.ok(res.summary.includes("rupees per unit") && res.emdCr > 0 && res.dates.scd === "2028-05-01", JSON.stringify(res.dates));
const fin = await run("get_financials");
assert.ok(fin.strikePrice > 0 && fin.equityIrrPct > 0 && fin.summary.length > 50);
const low = await run("check_tariff", { tariff: 1, record: true });
assert.equal(low.status, "below target");
assert.equal(state.quoteTariff, 1);
const setr = await run("set_input", { key: "windMw", value: 50 });
assert.equal(setr.ok, true);
assert.equal(state.inputs.windMw, 50);
const bad = await run("set_input", { key: "nope", value: 1 });
assert.equal(bad.ok, false);
const opt = await run("run_optimizer");
assert.equal(opt.ok, true);
assert.ok(gone.includes("size"));
const look = await run("tender_lookup", { query: "letter of credit" });
assert.ok(look.matches.some((m) => m.id === "lc"));
const cond = await run("list_conditions", { group: "Dates" });
assert.ok(cond.conditions.length >= 8 && cond.conditions.every((c) => c.group === "Dates"));
const ex = await run("explain_cfd");
assert.ok(ex.explanation.includes("strike price") && explainCfd(null).includes("price guarantee"));
assert.ok(explainResults(model).includes("megawatts contracted") && explainFinance(model).includes("rupees per unit"));
const nq = await run("next_question", { keep: null, keep_rest: true });
assert.equal(nq.done, true, "keep the rest finishes the exercise");

// ---- the session
const cfg = liveSessionConfig({ backendModel: "backend", voice: "marin", greeting: "hi" });
assert.equal(cfg.delegation.responses.tools.length, AGENT_TOOLS.length);
assert.ok(cfg.instructions.includes("Contract for Difference") && cfg.delegation.responses.instructions.includes("check_tariff"));
assert.ok(AGENT_TOOLS.every((t) => t.parameters.additionalProperties === false));
console.log(`CfD agent checks passed (${inputs.length} inputs, ${script.length} script items, ${AGENT_TOOLS.length} tools, SP ₹${model.sp.toFixed(3)})`);
