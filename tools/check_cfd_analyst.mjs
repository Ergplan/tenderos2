// Checks for the CfD bid analyst (web/lib/cfdAgent.js): the tools' schemas and input validation,
// each tool against a modelled bid, the conversation clean-up, and the loop itself run against a
// stand-in for the model: the request it sends (model, fallbacks, adaptive thinking, cached
// instructions, the tools), parallel simulations answered in one message, a refusal that runs no
// tool, an invalid input returned as an error, a turn asked again when a tool input cannot be
// parsed, the limit of simulations, and the messages for the service's errors.
// No call is made to the model's service. Run from the repository root:
//   node tools/check_cfd_analyst.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { defaultCfdState, fillBenchmarks, fillWinning } from "../web/src/cfd/model.js";
import { AGENT_MODEL, AGENT_SYSTEM, AGENT_TOOLS, agentErrorOf, cleanMessages, createAgentTools, inputError, runBidAgent } from "../web/lib/cfdAgent.js";

process.chdir(fileURLToPath(new URL("../web/", import.meta.url))); // the price year is read from the web app's folder
// the SDK as the analyst's module loads it (its ES module build: the error classes must be the same ones)
const { default: Anthropic } = await import(new URL("../web/node_modules/@anthropic-ai/sdk/index.mjs", import.meta.url));

const state = fillWinning(fillBenchmarks(defaultCfdState()));
state.inputs = { ...state.inputs, contractedMw: 150, effectiveDate: "2027-02-01", solarMw: 15, useGroup: true, groupPrice: 2.5, essCrPerMwh: 0.7, augmentation: "annual" };
state.filled = { ...state.filled, solarMw: false };

// ---- the tools' definitions
assert.equal(AGENT_MODEL(), "claude-opus-5-5");
assert.deepEqual(AGENT_TOOLS.map((t) => t.name), ["get_bid", "run_upside_sweep", "evaluate_plan", "tender_lookup"]);
for (const t of AGENT_TOOLS) assert.ok(t.description.length > 40 && t.input_schema.type === "object" && t.input_schema.additionalProperties === false && t.eager_input_streaming === true, t.name);
assert.ok(!/[*#|]/.test(AGENT_SYSTEM.replace(/CfD-I|RfS/g, "")) && AGENT_SYSTEM.includes("tender_lookup") && AGENT_SYSTEM.length > 1500, "the instructions name the tools and use no Markdown");
const plan = AGENT_TOOLS[2].input_schema;
assert.equal(inputError(plan, { solar_add_mw: 50, battery: [{ year: 5, mwh: 75 }], day_injection: false }), null);
assert.match(inputError(plan, {}), /solar_add_mw is required/);
assert.match(inputError(plan, { solar_add_mw: "50" }), /must be a number/);
assert.match(inputError(plan, { solar_add_mw: 50, battery: [{ year: 5.5, mwh: 75 }] }), /whole number/);
assert.match(inputError(plan, { solar_add_mw: 50, battery: [{ year: 20, mwh: 75 }] }), /above 15/);
assert.match(inputError(plan, { solar_add_mw: 50, extra: 1 }), /not a known field/);
assert.match(inputError(plan, { solar_add_mw: 50, battery: {} }), /must be a list/);
assert.match(inputError(plan, null), /must be an object/);

// ---- the tools on a modelled bid
const tools = createAgentTools(state);
const bid = await tools.run("get_bid", {});
assert.ok(bid.contracted_mw === 150 && bid.own_solar_mwac === 15 && bid.strike_price_rs_per_kwh > 3 && Math.abs(bid.equity_irr_pct - bid.target_equity_irr_pct) < 0.01 && bid.the_bid_now.plan === "The bid as it stands", JSON.stringify(bid).slice(0, 300));
const one = await tools.run("evaluate_plan", { solar_add_mw: 50, battery: [{ year: 6, mwh: 75 }], lower_bid: true });
assert.ok(one.the_plan.plan === "+50 MWac solar, +75 MWh battery in year 6" && one.the_plan.later_tranches_cost_cr > 20 && one.the_plan.added_cost_at_scd_cr > 150 && typeof one.the_plan.equity_irr_pct === "number" && one.bid_lower_instead.strike_price_rs_per_kwh > 0, JSON.stringify(one).slice(0, 400));
const stressed = await tools.run("evaluate_plan", { solar_add_mw: 50, day_injection: false, debt_share_on_addition_pct: 0, midday_price_change_pct_per_year: -5 });
assert.ok(stressed.the_plan.debt_cr === one.the_bid_now.debt_cr && stressed.the_plan.day_sale_mu_per_year < 0.5 && stressed.settings.day_injection === false, "the stresses reach the case");
assert.deepEqual(tools.plans.map((p) => p.label), ["+50 MWac solar, +75 MWh battery in year 6", "+50 MWac solar"], "the plans priced are kept for the screen");
const sweep = await tools.run("run_upside_sweep", { battery_price_fall_pct: 10 });
assert.ok(sweep.solar_only.length >= 2 && sweep.battery_tranche_by_year_on_best_solar.length >= 3 && sweep.findings.length >= 3 && sweep.best_by_equity_irr && JSON.stringify(sweep).length < 30000, "the sweep in a size the model can read");
const law = await tools.run("tender_lookup", { query: "connectivity non-solar hours" });
assert.ok(law.conditions.length > 0 && law.conditions.every((c) => c.clause && c.page > 0), "tender terms with clause and page");
assert.match((await tools.run("evaluate_plan", { solar_add_mw: -5 })).error, /below 0/);
assert.match((await tools.run("launch", {})).error, /no tool named/);
assert.match((await createAgentTools({ inputs: {} }).run("get_bid", {})).error, /not complete/, "an incomplete bid is said, not thrown");

// ---- the conversation the browser sends
assert.deepEqual(cleanMessages([{ role: "assistant", content: "hello" }, { role: "user", content: " a " }, { role: "user", content: "b" }, { role: "system", content: "x" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }, { role: "assistant", content: "e" }]),
  [{ role: "user", content: "a\n\nb" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }]);
assert.deepEqual(cleanMessages("x"), []);

// ---- the loop, against a stand-in for the model
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 };
function standIn(script) {
  const seen = [];
  return {
    seen,
    beta: { messages: { stream(params, opts) {
      seen.push({ params: JSON.parse(JSON.stringify(params)), opts });
      const step = script[seen.length - 1];
      let onText = null;
      return {
        on(name, cb) { if (name === "text") onText = cb; return this; },
        async finalMessage() {
          if (step.fail) throw step.fail;
          for (const b of step.content) if (b.type === "text" && onText) for (const part of b.text.match(/.{1,12}/gs)) onText(part);
          return { model: "claude-opus-5-5", stop_reason: step.stop, content: step.content, usage };
        },
      };
    } } },
  };
}
{
  const client = standIn([
    { stop: "tool_use", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "Let me run that." }, { type: "tool_use", id: "t1", name: "get_bid", input: {} }, { type: "tool_use", id: "t2", name: "evaluate_plan", input: { solar_add_mw: 25 } }] },
    { stop: "end_turn", content: [{ type: "text", text: "Adding 25 MWac changes the equity IRR as shown." }] },
  ]);
  const events = [];
  const out = await runBidAgent({ client, state, messages: [{ role: "user", content: "What does 25 MWac more do?" }], send: (e) => events.push(e) });
  const p = client.seen[0].params;
  assert.ok(p.model === "claude-opus-5-5" && p.fallbacks === "default" && p.betas.includes("server-side-fallback-2026-07-01") && p.thinking.type === "adaptive" && p.output_config.effort === "medium" && p.max_tokens >= 16000, "the request: the model, its fallback, adaptive thinking, effort set");
  assert.ok(p.system[0].cache_control.type === "ephemeral" && p.system[0].text === AGENT_SYSTEM && p.tools.length === 4 && !("temperature" in p) && !("tool_choice" in p), "cached instructions, the four tools, no sampling or forced tool");
  const second = client.seen[1].params.messages;
  assert.equal(second.length, 3);
  assert.deepEqual(second[1].content.map((b) => b.type), ["thinking", "text", "tool_use", "tool_use"], "the assistant's turn goes back whole, thinking included");
  assert.deepEqual(second[2].content.map((b) => [b.type, b.tool_use_id, Boolean(b.is_error)]), [["tool_result", "t1", false], ["tool_result", "t2", false]], "both results in one user message");
  assert.equal(JSON.parse(second[2].content[1].content).the_plan.plan, "+25 MWac solar");
  assert.deepEqual(events.filter((e) => e.type !== "text").map((e) => `${e.type}:${e.id}`), ["tool:t1", "tool_done:t1", "tool:t2", "tool_done:t2"]);
  assert.equal(events.find((e) => e.type === "tool" && e.id === "t2").label, "Pricing +25 MWac solar");
  assert.equal(events.filter((e) => e.type === "text").map((e) => e.delta).join(""), "Let me run that.\n\nAdding 25 MWac changes the equity IRR as shown.");
  assert.ok(out.text === "Let me run that.\n\nAdding 25 MWac changes the equity IRR as shown." && out.stop === "end_turn" && out.toolCalls === 2 && out.usage.input_tokens === 200 && out.usage.cache_read_input_tokens === 100 && out.plans[0].label === "+25 MWac solar");
}
{
  // a refusal: nothing is run, the reason is returned
  const client = standIn([{ stop: "refusal", content: [{ type: "tool_use", id: "t1", name: "get_bid", input: {} }] }]);
  const events = [];
  const out = await runBidAgent({ client, state, messages: [{ role: "user", content: "x" }], send: (e) => events.push(e) });
  assert.ok(out.stop === "refusal" && out.toolCalls === 0 && events.length === 0 && client.seen.length === 1);
}
{
  // an input that does not fit the schema goes back as an error for the model to correct
  const client = standIn([{ stop: "tool_use", content: [{ type: "tool_use", id: "t1", name: "evaluate_plan", input: { solar_add_mw: 50, battery: [{ year: 99, mwh: 10 }] } }] }, { stop: "end_turn", content: [{ type: "text", text: "ok" }] }]);
  await runBidAgent({ client, state, messages: [{ role: "user", content: "x" }] });
  const back = client.seen[1].params.messages[2].content[0];
  assert.ok(back.is_error === true && /above 15/.test(back.content));
}
{
  // a tool input that cannot be parsed (not an API error): the turn is asked again, twice at most
  const client = standIn([{ fail: new SyntaxError("Unexpected end of JSON input") }, { stop: "end_turn", content: [{ type: "text", text: "done" }] }]);
  const out = await runBidAgent({ client, state, messages: [{ role: "user", content: "x" }] });
  assert.ok(out.text === "done" && client.seen.length === 2 && client.seen[1].params.messages.length === 1);
  const always = standIn([1, 2, 3, 4].map(() => ({ fail: new SyntaxError("bad") })));
  await assert.rejects(runBidAgent({ client: always, state, messages: [{ role: "user", content: "x" }] }), SyntaxError);
  assert.equal(always.seen.length, 3);
  // the service's own errors are not retried here
  const apiErr = new Anthropic.APIError(500, { type: "error" }, "boom", new Headers());
  const failing = standIn([{ fail: apiErr }]);
  await assert.rejects(runBidAgent({ client: failing, state, messages: [{ role: "user", content: "x" }] }), (e) => e === apiErr);
  assert.equal(failing.seen.length, 1);
}
{
  // the limit of simulations in one answer
  const many = Array.from({ length: 18 }, (_, k) => ({ type: "tool_use", id: `t${k}`, name: "tender_lookup", input: { query: "battery" } }));
  const client = standIn([{ stop: "tool_use", content: many }, { stop: "end_turn", content: [{ type: "text", text: "enough" }] }]);
  const out = await runBidAgent({ client, state, messages: [{ role: "user", content: "x" }] });
  const back = client.seen[1].params.messages[2].content;
  assert.ok(back.length === 18 && back.filter((b) => b.is_error).length === 2 && out.toolCalls === 18, "every call answered, the ones over the limit as errors");
}
await assert.rejects(runBidAgent({ client: standIn([]), state, messages: [] }), /question is required/);

// ---- the service's errors, most specific first
const H = new Headers();
assert.match(agentErrorOf(new Anthropic.AuthenticationError(401, {}, "no", H))[1], /key on this server was refused/);
assert.deepEqual(agentErrorOf(new Anthropic.RateLimitError(429, {}, "slow", H))[0], 429);
assert.match(agentErrorOf(new Anthropic.NotFoundError(404, {}, "nf", H))[1], /claude-opus-5-5 was not found/);
assert.match(agentErrorOf(new Anthropic.BadRequestError(400, { message: "bad thing" }, "bad thing", H))[1], /bad thing/);
assert.match(agentErrorOf(new Anthropic.APIConnectionError({ message: "down" }))[1], /could not be reached/);
assert.match(agentErrorOf(new Anthropic.APIError(529, {}, "over", H))[1], /529/);
assert.deepEqual(agentErrorOf(Object.assign(new Error("The bid is not complete."), { status: 400 })), [400, "The bid is not complete."]);
assert.equal(agentErrorOf(new Error("x"))[0], 500);
console.log("CfD analyst checks passed (4 tools on a modelled bid; the loop against a stand-in model: parallel simulations, refusal, invalid input, retry, limit; error messages)");
