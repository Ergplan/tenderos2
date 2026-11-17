// Checks for the SECI-FDRE-X bid agents: the voice agent (web/src/fdrex/agent.js, voice.js) and the
// written bid analyst (web/lib/fdrexAgent.js, over web/lib/fdrexUpside.js).
//   agent.js   every input round-trips through set, get and shown and is checked against its range;
//              the removed CfD inputs are gone, `psm` and `dayInjection` (connectivity in the solar
//              hours) are yes/no choices; the guided sequence takes an empty bid to a complete one;
//              status and checkTariff on a modelled bid (the tariff, the billing months penalised,
//              bought power within 5%, the surplus curtailed without solar-hour connectivity; a
//              quoted tariff on the full financial model, as the Financial model step has it:
//              at the quote the target is met, a paisa under it is below); the tender lookup finds the
//              terms of web/src/fdrex/terms.js with their pages; the amendment's twelve deleted
//              rows; the tool list; and the tool runner through a scripted session.
//   voice.js   the script asks every input once, in the order of the steps, and its own readers
//              complete a bid; what it says is about the tariff and the PPA, with nothing of the
//              CfD-I tender it was forked from.
//   the lib    the tools' schemas and input validation, each tool on the modelled bid, and the loop
//              against a stand-in for the model: the request it sends, parallel simulations
//              answered in one message, a refusal that runs no tool, an invalid input returned as
//              an error, a turn asked again, the limit of simulations, the service's errors.
// The bid is fillWinning(defaultCfdState()): 100 MW with the competitive bidder's values and
// connectivity in the non-solar hours only, priced by the full financial model as the tab prices it. The optimiser itself is run by
// tools/check_fdrex_model.mjs; here the sizing is a stand-in that sets 130 MWac of own solar.
// No call is made to any service: fetch is replaced by a counter that must stay at zero.
// Run from the repository root:   node tools/check_fdrex_agent.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENT_TOOLS, BACKEND_INSTRUCTIONS, CFD_GREETING, LIVE_INSTRUCTIONS, LIVE_MODEL, STEPS, agentInputs, amendmentChanges, checkTariff, createToolRunner, liveSessionConfig, nextQuestion, readValue, shown, status, tenderLookup } from "../web/src/fdrex/agent.js";
import { ASKED, buildScript, explainCfd, explainFinance, explainResults, tenderBrief } from "../web/src/fdrex/voice.js";
import { CHOICES, FIELDS, capShortfall, defaultCfdState, fillWinning, missingInputs, penaltyCr, rfsAmounts, runModel } from "../web/src/fdrex/model.js";
import { quotedStrikeReturns, runCfdFinance } from "../web/src/fdrex/finance.js";
import { PACK } from "../web/src/fdrex/pack.js";
import { DOCUMENTS, RFS, TERMS, TERM_GROUPS, termById } from "../web/src/fdrex/terms.js";
import { TENDER } from "../web/src/fdrex/tender.js";
import { AGENT_MODEL, AGENT_SYSTEM, AGENT_TOOLS as ANALYST_TOOLS, agentErrorOf, cleanMessages, createAgentTools, inputError, runBidAgent } from "../web/lib/fdrexAgent.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);

// nothing here may reach a service
let fetched = 0;
globalThis.fetch = async () => { fetched += 1; throw new Error("This check makes no network call."); };

// what must not be left of the CfD-I tab the files were forked from
const BANNED = /strike price|CfD Pool|Contract for Difference|Letter of Credit|weekly|group/i;
const clean = (text, what) => assert.ok(!BANNED.test(text), `${what}: ${(String(text).match(BANNED) || [])[0]}`);
const said = []; // every text checked, for the count in the last line

// the bid of the check, as the tab models it: the tariff is the full financial model's
const pricerOf = (st) => (inputs, sim) => runCfdFinance({ ...st, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
const modelOf = (st) => runModel(st, prices, { price: pricerOf(st) });
const withInputs = (st, values) => ({ ...st, inputs: { ...st.inputs, ...values }, filled: { ...st.filled, ...Object.fromEntries(Object.keys(values).map((k) => [k, false])) } });
const empty = { ...defaultCfdState(), forms: {}, quoteTariff: null };
const bid = { ...fillWinning(defaultCfdState()), forms: {}, quoteTariff: null };
assert.deepEqual(missingInputs(bid), [], "fillWinning completes the default bid");
assert.ok(bid.inputs.contractedMw === 100 && bid.inputs.psm === true && bid.inputs.dayInjection === false && bid.inputs.effectiveDate === "2027-06-01");

// ================================================================ agent.js: the inputs

const inputs = agentInputs(empty);
const byKey = Object.fromEntries(inputs.map((x) => [x.key, x]));
assert.ok(inputs.length >= 60, `inputs on screen: ${inputs.length}`);
assert.equal(new Set(inputs.map((x) => x.key)).size, inputs.length, "unique keys");
for (const x of inputs) assert.ok(STEPS.includes(x.step) && x.label && ["number", "choice", "boolean", "date"].includes(x.kind), `${x.key}: step ${x.step}, kind ${x.kind}`);
for (const f of FIELDS) assert.ok(byKey[f.key], `the field ${f.key} is an input`);
for (const key of Object.keys(CHOICES)) assert.ok(byKey[key], `the choice ${key} is an input`);
for (const gone of ["reCodMonths", "groupPrice", "groupCharges", "useGroup", "recPrice", "lcCostPct"]) assert.ok(!byKey[gone], `${gone} is not an input of this tender`);
assert.ok(byKey.psm.kind === "boolean" && byKey.psm.step === "bid" && byKey.psm.label === CHOICES.psm.label && byKey.psm.benchmark === true, "psm is a yes/no of the bid");
assert.ok(byKey.dayInjection.kind === "boolean" && byKey.dayInjection.step === "bid" && byKey.dayInjection.label === CHOICES.dayInjection.label && byKey.dayInjection.benchmark === false, "connectivity in the solar hours is a yes/no of the bid, no by default");
assert.ok(inputs.findIndex((x) => x.key === "dayInjection") === inputs.findIndex((x) => x.key === "merchant") + 1, "listed after the sale of surplus");
assert.ok(byKey.useMarket.kind === "boolean" && byKey.merchant.kind === "boolean" && byKey.sellMarket.kind === "choice" && byKey.effectiveDate.kind === "date");
assert.equal(byKey.effectiveDate.label, "Effective Date of the PPA");
assert.ok(byKey.contractedMw.min === TENDER.bidMinMw && byKey.contractedMw.max === TENDER.bidMaxMw);
assert.ok(byKey.tenorYears.max === TENDER.termYears && byKey["fin.refiYear"].max === TENDER.termYears && byKey["fin.refiTenorYears"].max === TENDER.termYears, "loans within the 25-year term");
assert.ok(!byKey.merchantYears, "years after the term are asked only when the bid sells on after it");
const sellsOn = withInputs(empty, { afterTerm: "merchant" });
const allInputs = agentInputs(sellsOn);
assert.equal(allInputs.length, inputs.length + 1);

// every input: set, read back, shown, and its limits
let roundTrips = 0;
for (const x of allInputs) {
  const back = (given, stored, seen) => {
    const s = x.set(sellsOn, readValue(x, given));
    assert.deepEqual(x.get(s), stored, `${x.key}: ${JSON.stringify(given)} is stored`);
    assert.deepEqual(shown(x, x.get(s)), seen, `${x.key}: ${JSON.stringify(given)} is shown`);
    assert.notEqual(s, sellsOn, `${x.key}: set returns a new state`);
    roundTrips += 1;
    return s;
  };
  if (x.kind === "boolean") {
    back("yes", true, true);
    back("no", false, false);
    back(true, true, true);
    assert.throws(() => readValue(x, "perhaps"), /say yes or no/, x.key);
  } else if (x.kind === "choice") {
    assert.ok(x.options.length >= 2, `${x.key}: options`);
    for (const [k, label] of x.options) { back(k, k, label); back(label, k, label); }
    assert.throws(() => readValue(x, "zzzz"), /choose one of/, x.key);
  } else if (x.kind === "date") {
    back("1 June 2027", "2027-06-01", "2027-06-01");
    back("2028-02-29", "2028-02-29", "2028-02-29");
    assert.throws(() => readValue(x, "soon"), /give a date/, x.key);
  } else {
    assert.ok(Number.isFinite(x.min) && Number.isFinite(x.max) && x.min < x.max, `${x.key}: a range`);
    const v = Math.min(x.max, Math.max(x.min, Math.round((x.min + x.max) / 2))); // a whole number inside the range
    const stored = x.pct ? v / 100 : v;
    const s = back(v, stored, v);
    back(String(v), stored, v);
    if (!x.key.includes(".") && x.key !== "quoteTariff") assert.ok(!s.filled?.[x.key], `${x.key}: a set value is not marked as a benchmark`);
    assert.throws(() => readValue(x, x.max + 1), /outside/, `${x.key}: above ${x.max}`);
    assert.throws(() => readValue(x, x.min - 1), /outside/, `${x.key}: below ${x.min}`);
    assert.throws(() => readValue(x, "plenty"), /give a number/, x.key);
  }
  if (x.benchmark !== null && x.benchmark !== undefined) assert.ok(shown(x, x.benchmark) !== null, `${x.key}: its benchmark can be read out`);
}
assert.throws(() => byKey.contractedMw.set(empty, 120.5), /whole megawatts/);
assert.equal(byKey.solarCuf.get(byKey.solarCuf.set(empty, readValue(byKey.solarCuf, 24))), 0.24, "percent inputs take percent");
assert.equal(byKey.sellMarket.set(empty, readValue(byKey.sellMarket, "green")).inputs.sellMarket, "GDAM", "a choice by part of its label");
assert.equal(byKey["fin.paymentsPerYear"].set(empty, readValue(byKey["fin.paymentsPerYear"], "Quarterly")).fin.paymentsPerYear, 4, "instalments are stored as a number");
assert.equal(byKey["costs.constructionMonths"].set(empty, readValue(byKey["costs.constructionMonths"], "14.6")).costs.constructionMonths, 15, "whole months");
{
  const s = byKey.quoteTariff.set(empty, readValue(byKey.quoteTariff, "7.018"));
  assert.ok(s.quoteTariff === 7.02 && s.forms.tariff === 7.02, "the quote is kept to the paisa and goes into the forms");
}

// ================================================================ voice.js: the script

const script = buildScript(empty);
const ids = script.map((i) => i.id);
assert.equal(new Set(ids).size, ids.length, "nothing is said or asked twice");
assert.deepEqual(ids.slice(0, 5), ["intro", "c.ppa", "c.supply", "c.plant", "c.bid"]);
assert.deepEqual(ids.slice(-4), ["size", "results", "finance", "forms"]);
const asked = script.filter((i) => i.kind === "number" || i.kind === "choice" || i.kind === "date");
// what a bid needs before the benchmarks can fill the rest: the capacity, the date and the choices
const required = ["contractedMw", "effectiveDate", "sellMarket", "useMarket", "merchant", "dayInjection", "psm", "afterTerm", "augmentation"];
for (const key of [...required, ...ASKED.design, ...ASKED.finance]) assert.equal(ids.filter((id) => id === key).length, 1, `${key} is asked once`);
assert.deepEqual(asked.map((i) => i.id).sort(), [...new Set([...required, ...ASKED.design, ...ASKED.finance])].sort(), "the script asks these and nothing else");
for (const item of asked) assert.ok(byKey[item.id] && item.read && item.set && item.current && item.ask.length > 10 && item.target === `inputs.${item.id}` && STEPS.includes(item.step), `${item.id} is an input that reads and sets`);
for (const gone of ["useGroup", "reCodMonths", "c.cfd"]) assert.ok(!ids.includes(gone), `${gone} is not in the script`);
assert.equal(ids.indexOf("dayInjection"), ids.indexOf("merchant") + 1, "the connectivity is asked right after the sale of surplus");
{
  // in plain words: what the tender asks, and what a no and a yes mean; nothing of the screen's hint
  const q = script.find((i) => i.id === "dayInjection");
  assert.match(q.ask, /^Will you hold grid connectivity in the solar hours as well\? The tender asks only for connectivity in the non-solar hours\. Without it nothing can be injected between 6 in the morning and 6 in the evening, so the day's surplus solar is curtailed\. With it the surplus is sold\. Say yes or no\.$/);
  assert.ok(q.kind === "choice" && q.step === "bid" && q.benchmark === false && q.benchmarkText === "no" && q.read("no, only the non-solar hours") === false && q.read("yes") === true && q.read("perhaps") === null);
  assert.ok(q.set(empty, true).inputs.dayInjection === true && q.current(q.set(empty, false)) === "no");
}
assert.ok(ids.indexOf("contractedMw") < ids.indexOf("psm") && ids.indexOf("psm") < ids.indexOf("fill") && ids.indexOf("fill") < ids.indexOf("essMwhPerMw") && ids.indexOf("essMwhPerMw") < ids.indexOf("essCrPerMwh") && ids.indexOf("taxRate") < ids.indexOf("size"), "the bid, then the design, then the costs and financing, then the sizing");
assert.ok(ids.indexOf("augmentation") > ids.indexOf("fill"), "the battery's augmentation is asked with the design");
assert.equal(script.find((i) => i.id === "rte").read("eighty seven percent"), 0.87);
assert.equal(script.find((i) => i.id === "psm").read("no thanks"), false);
assert.equal(script.find((i) => i.id === "psm").read("yes please"), true);
assert.equal(script.find((i) => i.id === "contractedMw").read("forty"), null, "below the 50 MW a bid may be");
assert.equal(script.find((i) => i.id === "contractedMw").read("six hundred"), 600);
assert.equal(script.find((i) => i.id === "essMwhPerMw").read("three"), null, "below the four hours' battery");
assert.equal(script.find((i) => i.id === "sellMarket").read("the real-time market, rtm"), "RTM");
{
  // the script's own readers and setters take an empty bid to a complete one: yes to the benchmarks,
  // then every question answered with its benchmark (the own solar, which has none, with 130)
  let s = empty;
  let answered = 0;
  for (const item of script) {
    if (item.id === "fill") { s = item.onYes(s); continue; }
    if (!item.read) continue;
    const b = item.benchmark;
    const text = b === null || b === undefined ? "130" : typeof b === "boolean" ? (b ? "yes" : "no") : typeof b === "number" ? (FIELDS.find((f) => f.key === item.id)?.pct ? `${+(b * 100).toFixed(4)} percent` : String(b)) : item.kind === "choice" ? item.benchmarkText : b;
    const v = item.read(text);
    assert.ok(v !== null && v !== undefined, `${item.id}: "${text}" is read`);
    s = item.set(s, v);
    assert.ok(item.current(s), `${item.id}: its value can be read back`);
    answered += 1;
  }
  assert.equal(answered, asked.length);
  assert.deepEqual(missingInputs(s), [], "the script completes the bid");
  assert.ok(s.inputs.psm === true && s.inputs.dayInjection === false && s.inputs.solarMw === 130 && s.inputs.effectiveDate === "2027-06-01");
}
const brief = tenderBrief(empty);
assert.equal(brief.length, 4);
const briefText = brief.join(" ");
for (const [what, re] of [["the PPA", /Power Purchase Agreement/], ["the tariff", /tariff/], ["four hours", /in the 4 hours the Buying Entity chooses/], ["4 MWh per MW", /4 megawatt hours per contracted megawatt/], ["5% bought power", /5 percent of a year's energy/],
  ["the monthly penalty", /billing month.*10 percent.*1\.5 times your tariff/], ["the PSM discount", /Payment Security Mechanism.*2 paise per unit/], ["25 years", /25 years/], ["18 months", /18 months/], ["the connectivity", /grid connectivity the tender asks you to apply for is for the non-solar hours/], ["the bid size", /50 to 600 megawatts/], ["the award", /within 2 percent of the lowest tariff.*80 percent/]]) assert.match(briefText, re, `the key conditions speak of ${what}`);
assert.match(script[0].say, /SECI's FDRE-X tender.*4,800 megawatt hours a day.*1,200 megawatts for 4 hours.*25-year Power Purchase Agreement.*RfS of 7 October 2026.*Amendment 1/);
for (const item of script) for (const text of [item.say, item.ask].filter(Boolean)) { clean(text, `script ${item.id}`); assert.ok(!/undefined|NaN|not set|—/.test(text), `script ${item.id}: ${text}`); said.push(text); }

// ================================================================ agent.js: the guided sequence

{
  // an empty bid to a complete one: the bid's own questions answered with their benchmarks, yes to
  // "fill" (what use_benchmarks does), then every value kept
  let s = empty;
  const confirmed = new Set();
  const order = [];
  for (let q = nextQuestion(s, confirmed); q; q = nextQuestion(s, confirmed)) {
    assert.ok(!order.includes(q.key), `${q.key} is asked once`);
    order.push(q.key);
    assert.ok(q.question.length > 10 && q.kind, `${q.key}: a question`);
    clean(q.question, `question ${q.key}`);
    if (q.key === "fill") {
      assert.ok(q.kind === "yesno" && /use_benchmarks/.test(q.hint));
      s = fillWinning(s);
    } else {
      const x = Object.fromEntries(agentInputs(s).map((i) => [i.key, i]))[q.key];
      assert.ok(STEPS.includes(q.step) && q.step === x.step, `${q.key}: shown on ${q.step}`);
      if (q.current === null) {
        assert.ok(q.benchmark !== null, `${q.key}: an empty input comes with a benchmark`);
        s = x.set(s, readValue(x, q.benchmark)); // the benchmark as it is read out: a label, a percent, a date
      }
      assert.deepEqual(nextQuestion(s, confirmed).current, shown(x, x.get(s)), `${q.key}: the question carries the current value`);
    }
    confirmed.add(q.key);
  }
  assert.deepEqual(order, ["contractedMw", "effectiveDate", "sellMarket", "useMarket", "merchant", "dayInjection", "psm", "afterTerm", "fill", ...ASKED.design, "augmentation", ...ASKED.finance], "the order of the guided exercise");
  assert.deepEqual(missingInputs(s), [], "the guided exercise completes the bid");
  assert.deepEqual(s.inputs, bid.inputs, "and gives the bid of fillWinning(defaultCfdState())");
  assert.equal(nextQuestion(s, confirmed), null);
  assert.equal(nextQuestion(bid, new Set(["contractedMw"])).key, "effectiveDate", "a filled value is still put to the bidder until kept");
  assert.equal(nextQuestion(bid, new Set(required)).key, "essMwhPerMw", "no offer to fill once nothing is missing");
}

// ================================================================ agent.js: a modelled bid

const guess = modelOf(bid); // the own solar is the fill's first guess (100 MWac): some days short
const sized = withInputs(bid, { solarMw: 130 });
const model = modelOf(sized);
assert.ok(model?.sp > 0 && model.finance && guess?.sp > 0, "the bid has a tariff from the full financial model");
const monthsOf = (m) => sum(m.sim.years, (y) => y.months.filter((w) => w.beyondMwh > 1e-6).length);
const daysOf = (m) => sum(m.sim.years, (y) => y.shortDays);
const boughtOf = (m) => Math.max(...m.sim.years.map((y) => y.shareMarket));
assert.ok(daysOf(model) === 0 && monthsOf(model) === 0, "130 MWac meets every day");
assert.ok(daysOf(guess) > 0 && monthsOf(guess) > 0, "100 MWac leaves days short and billing months penalised");
assert.ok(boughtOf(model) > 0 && boughtOf(model) <= TENDER.marketShare, `bought power within 5%: ${(boughtOf(model) * 100).toFixed(2)}%`);
// the day's surplus: curtailed with connectivity in the non-solar hours only, sold with the solar hours too
const muOf = (m, key) => sum(m.sim.opYears, (y) => y[key]) / m.sim.opYears.length / 1000;
const open = withInputs(sized, { dayInjection: true });
const openModel = modelOf(open);
assert.ok(muOf(model, "curtailedMwh") > 50 && muOf(model, "merchantMwh") < 1 && muOf(openModel, "merchantMwh") > 50 && muOf(openModel, "curtailedMwh") < 1, "the day's surplus is curtailed, or sold");
assert.ok(openModel.sp < model.sp - 0.5 && daysOf(openModel) === 0, `selling the day's surplus lowers the tariff: ₹${openModel.sp.toFixed(3)} against ₹${model.sp.toFixed(3)}`);
{
  const st = status(sized, model);
  assert.equal(st.inputsMissing, "none");
  assert.deepEqual(Object.keys(st.bid), ["contractedMw", "effectiveDate", "sellMarket", "useMarket", "merchant", "dayInjection", "psm", "afterTerm"]);
  assert.equal(st.bid.dayInjection, false);
  assert.deepEqual(st.plant, { bessMw: 100, bessMwh: 400, solarMw: 130, windMw: 0 });
  assert.ok(st.tariff.forTargetIrr === Number(model.sp.toFixed(3)) && st.tariff.quoteRoundedUp === model.bid && st.tariff.quoteRoundedUp >= st.tariff.forTargetIrr && st.tariff.quoteRoundedUp - st.tariff.forTargetIrr < 0.01);
  near(st.tariff.equityIrrPct, bid.inputs.targetEquityIrr * 100, 0.01, "the tariff earns the target equity IRR");
  assert.ok(st.quote === "no tariff quoted yet" && /run_optimizer/.test(st.next) && st.optimizer === "not running" && !("strikePrice" in st));
  assert.equal(status(sized, model, { active: true, done: 3, total: 62 }).optimizer, "running (3/62)");
  const none = status(empty, null);
  assert.ok(Array.isArray(none.inputsMissing) && none.inputsMissing.includes("Effective Date of the PPA") && none.inputsMissing.includes(CHOICES.psm.label) && none.tariff === null && /next_question/.test(none.next));
  const quoted = status({ ...sized, quoteTariff: 1 }, model).quote;
  assert.ok(quoted.tariff === 1 && quoted.status === "below target" && quoted.basis === "the full financial model");
  assert.equal(status({ ...sized, quoteTariff: model.bid }, model).quote.status, "at or above target");
}
{
  // a tariff the bidder may quote, on the full financial model: the figures are the Financial model
  // step's (finance.js quotedStrikeReturns), against the tariff the target equity IRR needs
  assert.equal(checkTariff(null, 7, sized), null);
  assert.equal(checkTariff(model, 0, sized), null);
  assert.equal(checkTariff(model, Number.NaN, sized), null);
  const pc2 = (v) => Number((v * 100).toFixed(2));
  const same = (c, quote, what) => {
    const q = quotedStrikeReturns(sized, model, model.finance, quote);
    assert.deepEqual([c.equityIrrPct, c.projectIrrPct, c.targetEquityIrrPct, c.targetProjectIrrPct, c.minDscr, c.targetTariff, c.gapRsPerKwh],
      [pc2(q.equityIrr), pc2(q.projectIrr), pc2(q.targetEquityIrr), pc2(q.targetProjectIrr), Number(q.minDscr.toFixed(2)), Number(q.targetTariff.toFixed(3)), Number(q.gap.toFixed(3))], `${what}: the numbers are quotedStrikeReturns'`);
    assert.equal(c.basis, "the full financial model", what);
    return q;
  };
  const paisaBelow = Math.round(model.bid * 100 - 1) / 100;
  const at = checkTariff(model, model.bid, sized);
  const qAt = same(at, model.bid, "at the quote");
  near(qAt.targetTariff, model.sp, 1e-9, "the target is the tariff on screen");
  assert.ok(at.status === "at or above target" && qAt.status === "ok" && qAt.equityIrr >= qAt.targetEquityIrr && at.equityIrrPct >= at.targetEquityIrrPct && at.gapRsPerKwh >= 0 && at.gapRsPerKwh < 0.01, `at the quote the equity IRR is at or above the target: ${at.equityIrrPct}% against ${at.targetEquityIrrPct}%`);
  assert.ok(at.message === qAt.message && at.message.includes(`At ₹${model.bid.toFixed(2)}/kWh the equity IRR is`), "in the Financial model step's own words");
  const under = checkTariff(model, paisaBelow, sized);
  const qUnder = same(under, paisaBelow, "a paisa below the quote");
  assert.ok(under.status === "below target" && qUnder.equityIrr < qUnder.targetEquityIrr && under.equityIrrPct <= under.targetEquityIrrPct && under.gapRsPerKwh <= 0 && under.gapRsPerKwh >= -0.01, `a paisa below the quote is below the target: ${qUnder.equityIrr} against ${qUnder.targetEquityIrr}`);
  assert.ok(new RegExp(`^₹${paisaBelow.toFixed(2)}/kWh is ₹0\\.0\\d\\d below the ₹${model.sp.toFixed(3)}/kWh your 13(\\.0)?% target equity IRR needs\\. At this price the equity IRR is `).test(under.message), under.message);
  const low = checkTariff(model, model.bid - 1, sized);
  const high = checkTariff(model, model.bid + 1, sized);
  const qLow = same(low, model.bid - 1, "a rupee below");
  same(high, model.bid + 1, "a rupee above");
  assert.ok(high.status === "at or above target" && low.status === "below target" && low.message === qLow.message);
  assert.ok(low.equityIrrPct < under.equityIrrPct && under.equityIrrPct <= at.equityIrrPct && at.equityIrrPct < high.equityIrrPct && low.projectIrrPct < high.projectIrrPct && low.minDscr <= high.minDscr, "a higher tariff earns more");
  assert.ok(at.targetEquityIrrPct === 13 && at.psmDiscountRsPerKwh === TENDER.psmChargeRsPerKwh && at.monthlyPenaltyOverTermCr === 0);
  assert.ok(checkTariff(model, 1, sized).status === "below target" && checkTariff(model, 1, sized).equityIrrPct < 0);
  assert.ok(!("lcCr" in at) && !("targetStrikePrice" in at));
  // the same answer when the model does not carry the full finance result (it is computed), and
  // when the tariff is locked on the Financial model step (the target is still the solved one)
  const screen = runModel(sized, prices);
  assert.ok(!screen.finance && Math.abs(screen.sp - model.sp) > 0.05, "the screening model solves another tariff");
  assert.deepEqual(checkTariff(screen, model.bid, sized), at);
  assert.deepEqual(checkTariff(model, model.bid, { ...sized, tariffLocked: true, fin: { ...sized.fin, tariff: 5 } }), at);
  // without the bid state only the bid model's own screening can answer: it says so, and is held
  // to its own solved tariff
  const own = checkTariff(screen, screen.bid);
  assert.ok(own.basis === "the bid model's own screening" && own.status === "at or above target" && own.equityIrrPct >= own.targetEquityIrrPct && own.targetTariff === Number(screen.sp.toFixed(3)));
  assert.deepEqual(checkTariff(model, screen.bid), own, "on a model priced by the full model too");
  assert.equal(checkTariff(screen, Math.round(screen.bid * 100 - 1) / 100).status, "below target");
  // the monthly penalty at 1.5 x the quoted tariff on the energy short beyond 10% of a billing month
  const beyond = sum(guess.sim.years, (y) => sum(y.months, (w) => w.beyondMwh));
  const pen = checkTariff(guess, 8, bid);
  near(pen.monthlyPenaltyOverTermCr, TENDER.penaltyMultiple * 8 * beyond * 1e-4, 0.006, "1.5 x the tariff on the energy short beyond 10% of a billing month");
  near(pen.monthlyPenaltyOverTermCr, sum(guess.sim.years, (y) => penaltyCr(y, 8)), 0.006, "the model's penalty");
  assert.ok(pen.monthlyPenaltyOverTermCr > 0 && checkTariff(guess, 4, bid).monthlyPenaltyOverTermCr < pen.monthlyPenaltyOverTermCr, "the penalty moves with the tariff");
  const noPsm = withInputs(sized, { psm: false });
  assert.equal(checkTariff(modelOf(noPsm), 7, noPsm).psmDiscountRsPerKwh, 0);
}

// ================================================================ agent.js: the tender

for (const t of TERMS) {
  const hit = tenderLookup(t.id);
  assert.ok(hit.length === 1 && hit[0].id === t.id && hit[0].page === t.page && hit[0].clause === t.clause && hit[0].quote === t.quote && hit[0].document && hit[0].condition === t.label, `${t.id}: found by its id`);
}
const found = (query, id, clause, doc) => {
  const hits = tenderLookup(query);
  const hit = hits.find((t) => t.id === id);
  assert.ok(hit, `"${query}" finds ${id}: ${hits.map((t) => t.id).join(", ")}`);
  assert.ok(hit.clause === clause && hit.page === termById[id].page && hit.page > 0 && hit.document === DOCUMENTS.find((d) => d.id === doc).title && hit.quote.length > 20 && hit.status === "in force", `${id}: ${hit.document}, ${hit.clause}, p. ${hit.page}`);
  for (const t of hits) assert.ok(t.document && t.clause && t.page > 0 && t.quote && t.group && t.condition && t.rule, `"${query}": ${t.id} with document, clause, page and quote`);
  return hits;
};
found("four hours buying entity", "fourHours", "8.1.a", "rfs"); // the buyer's four hours
found("peak hours chosen", "hoursArePeak", "8.1.a", "rfs");
found("energy to supply every day", "mandate", "8.1.b", "rfs"); // 4 MWh per MW
assert.equal(found("5% green market", "marketShare", "8.1.e", "rfs")[0].id, "marketShare", "the 5% bought power comes first");
found("5% green market", "marketSharePpa", "4.4.1(b)", "ppa");
found("monthly shortfall penalty", "shortfall", "8.2.a", "rfs"); // 1.5 x the tariff
found("monthly shortfall penalty", "shortfallMonthly", "4.4.1(b)", "ppa");
found("monthly shortfall penalty", "shortfallBeyond", "8.2.b", "rfs"); // beyond 10%
assert.equal(found("Success Charges", "successCharges", "18.1", "rfs")[0].id, "successCharges", "the Success Charges come first");
found("payment security mechanism discount", "psm", "18.4", "rfs");
found("term 25 years", "term", termById.term.clause, termById.term.doc);
assert.equal(tenderLookup("zzzz qqqq").length, 0);
assert.equal(tenderLookup("").length, 0);
assert.ok(tenderLookup("penalty").length === 6 && tenderLookup("penalty", 3).length === 3, "at most six, or the limit asked");

{
  const rows = PACK.changes.filter((c) => c.doc === "amd1");
  const amd = amendmentChanges("amd1");
  assert.equal(amd.length, 1);
  assert.ok(amd[0].amendment === "Amendment-01" && amd[0].date === "2026-10-29" && amd[0].summary.length > 50);
  assert.equal(amd[0].changes.length, 12, "the twelve rows of Amendment-01");
  assert.deepEqual(amd[0].changes.map((c) => `${c.document} ${c.clause}`), ["PPA 6.1.6", "PPA 6.1.7", "PPA 6.1.8", "PPA 6.1.9", "PPA 6.1.10", "PPA 6.1.11", "PSA Recital XVI", "PSA Recital XVII", "PSA 2.11.7", "PSA 2.11.8", "PSA 2.11.9", "PSA 2.11.10"]);
  amd[0].changes.forEach((c, k) => {
    const row = rows[k];
    const before = Array.isArray(row.before) ? row.before[0] : row.before;
    assert.ok(c.change === "Deleted" && c.topic === row.topic && c.effect === row.effect && c.effect.length > 20, `${c.document} ${c.clause}: deleted, with its effect`);
    assert.ok(c.before.page === before.page && c.before.document === (c.document === "PPA" ? "Standard PPA" : "Standard PSA") && before.quote.startsWith(c.before.quote.replace(/…$/, "")) && c.before.quote.length <= 321 && c.amendmentPage >= 1 && c.amendmentPage <= 7, `${c.document} ${c.clause}: where it stood, and the amendment's page`);
  });
  assert.ok(amd[0].now.length === 12 && amd[0].now.every((t) => termById[t.id].doc === "amd1" && t.status === "in force"), "the terms that quote the amendment");
  assert.ok(amd[0].replaced.length === 12 && amd[0].replaced.every((t) => termById[t.id].by === "amd1" && t.status === "replaced"), "the terms it deleted");
  for (const which of ["all", "Amendment-01", "amendment 1", "1", "AMD1"]) assert.deepEqual(amendmentChanges(which), amd, `amendmentChanges("${which}")`);
  assert.deepEqual(amendmentChanges(), amd);
  for (const which of ["amd2", "amd4", "rfs", "ppa"]) assert.deepEqual(amendmentChanges(which), [], `${which} is not an amendment of this tender`);
  assert.ok(JSON.stringify(amd).length < 30000, "in a size the backend can read");
}

// ================================================================ agent.js: the tools and the session

const TOOL_NAMES = ["get_status", "explain_cfd", "tender_brief", "tender_lookup", "list_conditions", "amendment_changes", "next_question", "list_inputs", "set_input", "use_benchmarks", "go_to_step", "run_optimizer", "stop_optimizer", "get_results", "get_financials", "review_bid", "check_tariff"];
assert.deepEqual(AGENT_TOOLS.map((t) => t.name), TOOL_NAMES);
const REQUIRED = { tender_lookup: ["query"], list_conditions: ["group"], amendment_changes: ["amendment"], next_question: ["keep", "keep_rest"], list_inputs: ["part"], set_input: ["key", "value"], go_to_step: ["step"], check_tariff: ["tariff", "record"] };
for (const t of AGENT_TOOLS) {
  assert.ok(t.type === "function" && t.description.length > 20 && t.parameters.type === "object" && t.parameters.additionalProperties === false, t.name);
  assert.deepEqual(t.parameters.required, REQUIRED[t.name] || [], `${t.name}: required`);
  assert.deepEqual(Object.keys(t.parameters.properties), t.parameters.required, `${t.name}: every parameter is required`);
}
const toolByName = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t]));
assert.deepEqual(toolByName.amendment_changes.parameters.properties.amendment.enum, ["amd1", "all"]);
assert.deepEqual(toolByName.go_to_step.parameters.properties.step.enum, STEPS);
assert.deepEqual(STEPS, ["explain", "documents", "conditions", "bid", "design", "financeInputs", "size", "finance", "whatif", "forms", "reference", "upside"]);
assert.deepEqual(toolByName.list_inputs.parameters.properties.part.enum, ["bid", "design", "financeInputs", "finance", "all"]);
// two tools name what this tender does not have, to keep the backend off it: explain_cfd keeps the
// CfD tab's name and says so; list_conditions narrows by the conditions' groups
const NOT_A_CFD = "(The tool keeps its name from another tab: this tender has a PPA and a tariff, not a Contract for Difference.)";
assert.ok(/connectivity in the solar hours/.test(toolByName.get_status.description) && /no connectivity in the solar hours/.test(toolByName.get_results.description) && /connectivity in the non-solar hours only/.test(toolByName.use_benchmarks.description) && /full financial model/.test(toolByName.check_tariff.description) && /no connectivity in the solar hours/.test(BACKEND_INSTRUCTIONS), "the tools and the instructions carry the connectivity choice");
assert.ok(toolByName.explain_cfd.description.includes(NOT_A_CFD) && /Payment Security Mechanism/.test(toolByName.use_benchmarks.description) && /25-year term/.test(toolByName.get_financials.description) && /billing months penalised/.test(toolByName.get_results.description));
for (const t of AGENT_TOOLS) { const text = t.name === "explain_cfd" ? t.description.replace(NOT_A_CFD, "") : t.name === "list_conditions" ? t.description.replace(/\bgroups?\b/g, "") : t.description; clean(text, `tool ${t.name}`); said.push(text); }

// the instructions of the live session and of its backend
const NO_CFD = "There is no Contract for Difference, no strike price and no settlement against exchange prices in this tender: say tariff and PPA.";
assert.ok(BACKEND_INSTRUCTIONS.includes(NO_CFD), "the backend is told once what this tender does not have");
for (const [what, text] of [["the greeting", CFD_GREETING], ["the live instructions", LIVE_INSTRUCTIONS], ["the backend instructions", BACKEND_INSTRUCTIONS.replace(NO_CFD, "")]]) { clean(text, what); assert.ok(!/undefined|NaN|—/.test(text), what); said.push(text); }
assert.match(LIVE_INSTRUCTIONS, /SECI's FDRE-X tender: assured peak supply of 4,800 MWh a day \(1,200 MW for 4 hours\).*one fixed tariff under a 25-year Power Purchase Agreement/);
assert.match(BACKEND_INSTRUCTIONS, /SECI-FDRE-X bid model.*4 MWh a day in the 4 hours the Buying Entity chooses.*for 25 years/s);
for (const name of ["explain_cfd", "tender_brief", "tender_lookup", "list_conditions", "amendment_changes", "get_status", "get_results", "get_financials", "check_tariff", "set_input", "use_benchmarks", "next_question", "run_optimizer", "go_to_step", "list_inputs"]) assert.ok(BACKEND_INSTRUCTIONS.includes(name), `the backend instructions name ${name}`);
assert.ok(/billing months penalised/.test(BACKEND_INSTRUCTIONS) && /5% limit/.test(BACKEND_INSTRUCTIONS) && /Payment Security Mechanism/.test(BACKEND_INSTRUCTIONS) && /FDRE-X tender/.test(CFD_GREETING) && /tariff/.test(CFD_GREETING));
{
  const cfg = liveSessionConfig({ backendModel: "backend", voice: "marin", greeting: CFD_GREETING });
  assert.ok(cfg.model === LIVE_MODEL && cfg.instructions === LIVE_INSTRUCTIONS && cfg.audio.output.voice === "marin" && cfg.input[0].role === "developer" && cfg.input[0].content[0].text === CFD_GREETING);
  assert.deepEqual(cfg.delegation, { type: "responses", responses: { model: "backend", instructions: BACKEND_INSTRUCTIONS, tools: AGENT_TOOLS, tool_choice: "auto", parallel_tool_calls: false } });
  const bare = liveSessionConfig({ backendModel: "backend" });
  assert.ok(!("audio" in bare) && !("input" in bare));
}

// a scripted session on the tab's own context: the state, the steps shown, the model of the state
// as it stands (kept while the inputs do not change, as the tab keeps it)
let state = empty;
const gone = [];
const lit = [];
let sizings = 0;
let kept = { inputs: null, fin: null, costs: null, model: null };
const current = () => {
  if (kept.inputs !== state.inputs || kept.fin !== state.fin || kept.costs !== state.costs) kept = { inputs: state.inputs, fin: state.fin, costs: state.costs, model: missingInputs(state).length ? null : modelOf(state) };
  return kept.model;
};
const run = createToolRunner({
  getState: () => state, apply: (fn) => { state = fn(state); }, goto: (step) => gone.push(step), highlight: (target) => lit.push(target),
  // the optimiser's stand-in: 130 MWac of own solar, put on screen as the tab does, and its result
  runSizing: async () => { sizings += 1; state = withInputs(state, { solarMw: 130 }); const m = current(); return { solarMw: 130, windMw: 0, sp: m.sp, ok: capShortfall(m.sim) < 1e-3 * m.inputs.contractedMw }; },
  stopSizing: () => { sizings -= 100; }, getRun: () => null, getModel: current, getPrices: () => prices,
});
for (const name of TOOL_NAMES) assert.equal(typeof (await createToolRunner({ getState: () => empty, apply: () => {}, goto: () => {}, getModel: () => null })(name, name === "set_input" ? { key: "x", value: 1 } : name === "go_to_step" ? { step: "bid" } : name === "check_tariff" ? { tariff: 5, record: false } : name === "tender_lookup" ? { query: "term" } : {})), "object", `${name} answers on an empty bid`);

let out = await run("get_status");
assert.ok(Array.isArray(out.inputsMissing) && out.inputsMissing.length === 12 && out.tariff === null && out.plant.solarMw === null && /next_question/.test(out.next));
out = await run("explain_cfd");
assert.ok(/Power Purchase Agreement/.test(out.explanation) && out.rfs === RFS.number && out.documents.length === 4 && out.documents[0] === DOCUMENTS[0].title && gone.at(-1) === "explain");
out = await run("tender_brief");
assert.deepEqual(out.conditions, brief);
out = await run("next_question", { keep: null, keep_rest: false });
assert.ok(out.key === "contractedMw" && out.current === 100 && out.benchmark === 100 && out.unit === "MW" && gone.at(-1) === "bid" && lit.at(-1) === "inputs.contractedMw");
assert.match((await run("run_optimizer")).error, /Inputs still empty: Effective Date of the PPA/);
assert.match((await run("get_results")).error, /not complete/);
assert.match((await run("get_financials")).error, /not complete/);
assert.match((await run("check_tariff", { tariff: 7, record: true })).error, /not complete/);
assert.equal(state.quoteTariff, null, "nothing is recorded on an incomplete bid");
for (const [key, value, seen, stored] of [["contractedMw", "100", 100, 100], ["effectiveDate", "1 June 2027", "2027-06-01", "2027-06-01"], ["psm", "yes", true, true], ["sellMarket", "DAM", "DAM", "DAM"]]) {
  out = await run("set_input", { key, value });
  assert.ok(out.ok && out.key === key && out.value === seen && state.inputs[key] === stored && lit.at(-1) === `inputs.${key}` && gone.at(-1) === "bid", `set ${key}: ${JSON.stringify(out)}`);
}
out = await run("next_question", { keep: null, keep_rest: false });
assert.equal(out.key, "useMarket", "inputs set count as answered");
assert.ok((await run("set_input", { key: "useMarket", value: true })).ok && (await run("set_input", { key: "merchant", value: "yes" })).ok && (await run("set_input", { key: "afterTerm", value: "Nothing (value ends with the term)" })).ok);
assert.equal(state.inputs.afterTerm, "none", "a choice by its label");
out = await run("next_question", { keep: null, keep_rest: false });
assert.ok(out.key === "dayInjection" && out.kind === "boolean" && out.current === null && out.benchmark === false && /connectivity in the solar hours/.test(out.question) && lit.at(-1) === "inputs.dayInjection", "the connectivity in the solar hours is asked");
out = await run("set_input", { key: "dayInjection", value: "no" });
assert.ok(out.ok && out.value === false && state.inputs.dayInjection === false);
out = await run("next_question", { keep: null, keep_rest: false });
assert.ok(out.key === "fill" && out.kind === "yesno");
// what the agent refuses, each with a message it can say
for (const [args, re] of [[{ key: "useGroup", value: true }, /No input "useGroup"/], [{ key: "reCodMonths", value: 12 }, /No input/], [{ key: "contractedMw", value: 49 }, /outside 50 to 600 MW/], [{ key: "contractedMw", value: 601 }, /outside/], [{ key: "contractedMw", value: 120.5 }, /whole megawatts/],
  [{ key: "essMwhPerMw", value: 3 }, /outside 4 to 12/], [{ key: "psm", value: "maybe" }, /say yes or no/], [{ key: "sellMarket", value: "bilateral" }, /choose one of/], [{ key: "effectiveDate", value: "soon" }, /give a date/]]) {
  out = await run("set_input", args);
  assert.ok(out.ok === false && re.test(out.error), `set_input ${JSON.stringify(args)}: ${out.error}`);
}
assert.equal(state.inputs.contractedMw, 100, "a refused value changes nothing");
out = await run("use_benchmarks");
assert.ok(out.ok && out.filled > 20 && out.stillMissing.length === 0 && gone.at(-1) === "design");
assert.deepEqual(state.inputs, bid.inputs, "the session's bid is fillWinning(defaultCfdState())");
assert.ok(state.filled.essCrPerMwh === "winning" && state.fin.repayment === "sculpted", "with the competitive bidder's values marked");
out = await run("next_question", { keep: null, keep_rest: false });
assert.ok(out.key === "essMwhPerMw" && out.current === 4 && out.benchmark === 4 && gone.at(-1) === "design", "the benchmarks answer the offer to fill");
assert.equal((await run("next_question", { keep: "essMwhPerMw", keep_rest: false })).key, "essMwPerMw");
out = await run("next_question", { keep: null, keep_rest: true });
assert.ok(out.done === true && /tariff is on screen/.test(out.note), "keep the rest finishes the exercise");

out = await run("get_status");
assert.ok(out.inputsMissing === "none" && out.tariff.forTargetIrr === Number(guess.sp.toFixed(3)) && out.plant.solarMw === 100);
out = await run("get_results"); // the first guess of the own solar: days short
assert.ok(out.supply.daysShort === daysOf(guess) && out.supply.billingMonthsPenalised === monthsOf(guess) && out.supply.penaltyOverTermCr > 0 && out.conditions.find((c) => /every day/.test(c.condition)).status === "failed");
assert.ok(out.supply.boughtPowerWithinLimit === true && out.supply.boughtPowerLimitPct === 5 && out.supply.boughtPowerHighestYearPct <= 5.5, "bought power within 5% (to the half point the Size step allows on a year with short days)");
out = await run("run_optimizer");
assert.ok(out.ok && sizings === 1 && gone.includes("size") && state.inputs.solarMw === 130);
assert.deepEqual(out.best, { solarMw: 130, windMw: 0, tariff: Number(model.sp.toFixed(3)), everyDayMet: true });
const results = await run("get_results");
assert.deepEqual({ ...out, ok: undefined, best: undefined }, { ...results, ok: undefined, best: undefined }, "the optimiser returns the results");
assert.deepEqual(results.plant, { contractedMw: 100, bessMw: 100, bessMwh: 400, solarMw: 130, windMw: 0 });
assert.deepEqual(results.tariff, { forTargetIrr: Number(model.sp.toFixed(3)), quoteRoundedUp: model.bid });
assert.deepEqual(results.supply, { daysShort: 0, billingMonthsPenalised: 0, penaltyOverTermCr: 0, boughtPowerHighestYearPct: Number((boughtOf(model) * 100).toFixed(1)), boughtPowerLimitPct: 5, boughtPowerWithinLimit: true });
assert.ok(results.supply.boughtPowerHighestYearPct <= 5, "bought power within 5% of the year's energy");
assert.ok(results.conditions.length === 5 && results.conditions.every((c) => c.status === "met" && c.condition && c.detail), "the tender's conditions on the sized plant, all met");
assert.deepEqual(results.surplus, { connectivityInSolarHours: false, sellsSurplus: true, soldMuPerYear: Number(muOf(model, "merchantMwh").toFixed(1)), curtailedMuPerYear: Number(muOf(model, "curtailedMwh").toFixed(1)) }, "the day's surplus is curtailed without connectivity in the solar hours");
{
  const a = rfsAmounts(model.inputs);
  assert.ok(results.emdCr === Number(a.emdCr.toFixed(2)) && results.pbgCr === Number(a.pbgCr.toFixed(2)) && results.netWorthNeededCr === Number(a.netWorthCr.toFixed(2)) && results.successChargesCr === Number(a.cacCr.toFixed(2)));
  near(results.emdCr, (TENDER.emdLakh.solarMw * 130 + TENDER.emdLakh.essMwh * 400) / 100, 0.006, "the EMD on 130 MWac and 400 MWh");
  near(results.successChargesCr, (TENDER.cacLakhPerMw * (130 + 400)) / 100, 0.006, "the Success Charges on the installed 130 MW and 400 MWh (RfS 18.1)");
}
assert.deepEqual(results.dates, { seciIntimationToSignPpa: "2027-05-17", documentsPbgAndSuccessChargesDue: "2027-06-16", effectiveDate: "2027-06-01", financialClosure: "2028-06-01", scsd: "2028-12-01", lastSupplyDateWithPbgEncashed: "2029-06-01", pbgValidUntil: "2029-09-01", ppaEnds: "2053-12-01" });
assert.equal(results.summary, explainResults(model));

const fin = await run("get_financials");
assert.ok(fin.tariff === results.tariff.forTargetIrr && fin.quoteRoundedUp === model.bid && fin.model === "the full financial model (shared engine)" && gone.at(-1) === "finance", "one tariff on every step: the full model's");
near(fin.equityIrrPct, fin.targetEquityIrrPct, 0.01, "at the target equity IRR");
assert.ok(fin.targetEquityIrrPct === 13 && fin.projectIrrPct > 5 && fin.minDscr >= 1.19 && fin.avgDscr >= fin.minDscr && fin.projectCostCr > 500 && fin.debtCr === Math.round(model.finance.debt) && fin.psmDiscountRsPerKwh === 0.02 && fin.monthlyPenaltyOverTermCr === 0);
assert.ok(!("letterOfCreditCr" in fin) && !("strikePrice" in fin));
assert.match(fin.summary, /full financial model over the 25-year term.*rupees per unit.*opts for cover under SECI's Payment Security Mechanism.*2 paise per unit less than the tariff/);

out = await run("check_tariff", { tariff: fin.quoteRoundedUp, record: true });
assert.ok(out.ok && out.recorded && out.status === "at or above target" && out.targetTariff === fin.tariff && state.quoteTariff === fin.quoteRoundedUp && state.forms.tariff === fin.quoteRoundedUp && gone.at(-1) === "finance" && lit.at(-1) === "quoteTariff", "the quote is recorded and goes into the forms");
assert.equal((await run("get_status")).quote.tariff, fin.quoteRoundedUp);
out = await run("check_tariff", { tariff: 1, record: false });
assert.ok(out.ok && out.status === "below target" && out.recorded === false && state.quoteTariff === fin.quoteRoundedUp, "a tariff only tried is not recorded");
assert.match((await run("check_tariff", { tariff: 0, record: true })).error, /above zero/);
const cheap = Number((fin.tariff - 0.5).toFixed(2));
out = await run("set_input", { key: "quoteTariff", value: cheap });
assert.ok(out.ok && out.quote.status === "below target" && out.quote.basis === "the full financial model" && out.quote.targetTariff === fin.tariff && state.quoteTariff === cheap && state.forms.tariff === cheap, "a quote set as an input is checked too");
assert.equal((await run("check_tariff", { tariff: Math.round(fin.quoteRoundedUp * 100 - 1) / 100, record: false })).status, "below target", "a paisa below the quote");
near((await run("check_tariff", { tariff: fin.quoteRoundedUp, record: false })).equityIrrPct, fin.equityIrrPct, 0.05, "the IRR at the quote is the financial model's");

out = await run("review_bid");
assert.ok(typeof out.summary === "string" && out.findings.length > 0 && out.findings.every((f) => ["block", "warn", "note"].includes(f.severity) && f.title && f.detail), "the bid review reads the same bid");
assert.ok(!out.findings.some((f) => /^Tender condition not met/.test(f.title)) && ["block", "warn", "note"].every((k) => (out.counts[k] || 0) === out.findings.filter((f) => f.severity === k).length), "the sized plant meets the tender's conditions; the counts are the findings'");
out = await run("list_inputs", { part: "bid" });
assert.ok(out.inputs.some((x) => x.key === "psm" && x.value === true && x.benchmark === true) && out.inputs.some((x) => x.key === "contractedMw" && x.min === 50 && x.max === 600 && x.unit === "MW") && !out.inputs.some((x) => /group|reCod/i.test(x.key)));
assert.equal((await run("list_inputs", { part: "all" })).inputs.length, inputs.length);
assert.ok((await run("list_inputs", { part: "design" })).inputs.find((x) => x.key === "solarMw").value === 130 && (await run("list_inputs", { part: "finance" })).inputs[0].key === "quoteTariff");
out = await run("list_conditions", { group: "Dates" });
assert.ok(out.conditions.length >= 8 && out.conditions.every((c) => c.group === "Dates" && c.page > 0) && out.conditions.some((c) => c.id === "scsd") && gone.at(-1) === "conditions");
assert.deepEqual(out.groups, TERM_GROUPS);
assert.equal((await run("list_conditions", { group: null })).conditions.length, TERMS.length);
out = await run("amendment_changes", { amendment: "all" });
assert.ok(out.amendments.length === 1 && out.amendments[0].changes.length === 12 && gone.at(-1) === "documents");
out = await run("tender_lookup", { query: "Success Charges" });
assert.equal(out.matches[0].id, "successCharges");
out = await run("tender_lookup", { query: "zzzz qqqq" });
assert.ok(out.matches.length === 0 && /rather than guess/.test(out.note));
assert.ok((await run("go_to_step", { step: "forms" })).ok && gone.at(-1) === "forms");
assert.match((await run("go_to_step", { step: "pool" })).error, /Steps: explain/);
assert.ok((await run("stop_optimizer")).ok && sizings === -99);
assert.match((await run("settle_cfd")).error, /Unknown tool settle_cfd/);

// with connectivity in the solar hours too the day's surplus is sold: a lower tariff
out = await run("set_input", { key: "dayInjection", value: "yes" });
assert.ok(out.ok && out.value === true && lit.at(-1) === "inputs.dayInjection" && gone.at(-1) === "bid");
out = await run("get_results");
assert.deepEqual(out.surplus, { connectivityInSolarHours: true, sellsSurplus: true, soldMuPerYear: Number(muOf(openModel, "merchantMwh").toFixed(1)), curtailedMuPerYear: Number(muOf(openModel, "curtailedMwh").toFixed(1)) });
assert.ok(out.tariff.forTargetIrr === Number(openModel.sp.toFixed(3)) && out.tariff.forTargetIrr < results.tariff.forTargetIrr && !/curtailed/.test(out.summary) && (await run("get_status")).bid.dayInjection === true);
assert.ok((await run("set_input", { key: "dayInjection", value: false })).ok && (await run("get_status")).tariff.forTargetIrr === fin.tariff, "and back");
// without cover under the Payment Security Mechanism the bills carry no discount: a lower tariff
out = await run("set_input", { key: "psm", value: "no" });
assert.ok(out.ok && out.value === false && state.inputs.psm === false);
const bare = await run("get_financials");
assert.ok(bare.psmDiscountRsPerKwh === 0 && /does not opt for cover/.test(bare.summary));
assert.ok(fin.tariff - bare.tariff > 0.015 && fin.tariff - bare.tariff < 0.03, `the 2 paise of the PSM discount are in the tariff: ₹${fin.tariff} with, ₹${bare.tariff} without`);
// a larger battery and own wind change the plant the agent reads back
assert.ok((await run("set_input", { key: "essMwhPerMw", value: 5 })).ok && (await run("set_input", { key: "windMw", value: 20 })).ok);
assert.deepEqual((await run("get_status")).plant, { bessMw: 100, bessMwh: 500, solarMw: 130, windMw: 20 });
out = await run("get_results");
assert.ok(out.plant.windMw === 20 && out.plant.bessMwh === 500 && out.tariff.forTargetIrr > 0 && /and 20 megawatts of wind/.test(out.summary), "the benchmarks cover the wind's CUF, capex and O&M: the bid is modelled again");

// ================================================================ voice.js: the results in words

{
  const finance = model.finance;
  const noPsm = modelOf(withInputs(sized, { psm: false }));
  const keeps = modelOf(withInputs(sized, { merchant: false }));
  const texts = { explainCfd: explainCfd(null), explainCfdBid: explainCfd(model), explainResults: explainResults(model), explainResultsShort: explainResults(guess), explainResultsOpen: explainResults(openModel), explainResultsKeeps: explainResults(keeps), explainFinance: explainFinance(model), explainFinanceFull: explainFinance(model, finance), explainFinanceNoPsm: explainFinance(noPsm, noPsm.finance) };
  for (const [what, text] of Object.entries(texts)) { clean(text, what); assert.ok(text.length > 100 && !/undefined|NaN|not set|null|—/.test(text), `${what}: ${text}`); said.push(text); }
  assert.match(texts.explainCfd, /25-year Power Purchase Agreement with SECI.*names 4 hours out of the non-solar hours.*4 megawatt hours per contracted megawatt.*paid the tariff you bid on every unit.*fixed for the whole term.*5 percent of a year's energy.*Payment Security Mechanism.*2 paise per unit.*1\.5 times the tariff.*billing month.*10 percent/);
  assert.ok(texts.explainCfdBid.includes(`the tariff you bid, ${model.sp.toFixed(2)} rupees per unit on this plant,`), "with this bid's tariff");
  assert.match(texts.explainResults, /For 100 megawatts contracted, the plant has a battery of 100 megawatts and 400 megawatt hours, 130 megawatts of solar\. The tariff that earns your 13 percent equity return is .* rupees per unit; to quote, round it up to .*Every day's supply is met.*No billing month falls below 90 percent.*within the 5 percent of a year's energy the tender allows.*EMD.*performance guarantee.*net worth.*Supply must start by 01 Dec 2028, with financial closure by 01 Jun 2028; the PPA ends 01 Dec 2053\./);
  // one sentence when the day's surplus is curtailed for lack of connectivity in the solar hours
  const curtailedSentence = `With connectivity in the non-solar hours only, about ${Math.round(muOf(model, "curtailedMwh"))} million units a year of surplus generation are curtailed in the day; connectivity in the solar hours would let you sell them.`;
  assert.ok(texts.explainResults.includes(curtailedSentence) && texts.explainResults.split("curtailed").length === 2, curtailedSentence);
  assert.ok(/curtailed in the day/.test(texts.explainResultsShort) && !/curtailed/.test(texts.explainResultsOpen) && !/curtailed/.test(texts.explainResultsKeeps), "not said when the surplus is sold, or when the bid does not sell surplus at all");
  assert.ok(texts.explainResultsOpen.includes(`is ${openModel.sp.toFixed(2)} rupees per unit`));
  assert.ok(texts.explainResultsShort.includes(`On ${daysOf(guess)} days over the term the supply falls short of the 4 megawatt hours per megawatt.`) && texts.explainResultsShort.includes(`${monthsOf(guess)} billing months fall below 90 percent of their requirement and are penalised at 1.5 times the tariff.`) && /more own generation is needed/.test(texts.explainResultsShort));
  assert.match(texts.explainFinanceFull, /^The full financial model over the 25-year term prices the bid at .* rupees per unit for a 13 percent equity return.*crore rupees.*debt service cover.*every bill is paid 2 paise per unit less than the tariff.*round up to the paisa/);
  assert.match(texts.explainFinance, /^The financial model over the 25-year term/);
  assert.ok(/does not opt for cover under SECI's Payment Security Mechanism/.test(texts.explainFinanceNoPsm) && !/2 paise/.test(texts.explainFinanceNoPsm));
  assert.equal(explainResults(null), "The plant is not sized yet: fill in the inputs first.");
  assert.equal(explainFinance(null), "Size the plant first; then I can price the bid.");
}

// ================================================================ the analyst (web/lib/fdrexAgent.js)

process.chdir(fileURLToPath(new URL("../web/", import.meta.url))); // the price year is read from the web app's folder
// the SDK as the analyst's module loads it (its ES module build: the error classes must be the same ones)
const { default: Anthropic } = await import(new URL("../web/node_modules/@anthropic-ai/sdk/index.mjs", import.meta.url));

// ---- the tools' definitions and the instructions
assert.equal(AGENT_MODEL(), process.env.CFD_AGENT_MODEL || "claude-opus-5-5");
assert.deepEqual(ANALYST_TOOLS.map((t) => t.name), ["get_bid", "run_upside_sweep", "evaluate_plan", "tender_lookup"]);
for (const t of ANALYST_TOOLS) { assert.ok(t.description.length > 40 && t.input_schema.type === "object" && t.input_schema.additionalProperties === false && t.eager_input_streaming === true, t.name); clean(JSON.stringify(t), `analyst tool ${t.name}`); said.push(t.description); }
assert.ok(!/[*#|]/.test(AGENT_SYSTEM.replace(/FDRE-X|RfS/g, "")) && AGENT_SYSTEM.length > 1500, "the instructions use no Markdown");
for (const name of ["get_bid", "run_upside_sweep", "evaluate_plan", "tender_lookup"]) assert.ok(AGENT_SYSTEM.includes(name), `the instructions name ${name}`);
clean(AGENT_SYSTEM, "the analyst's instructions");
said.push(AGENT_SYSTEM);
assert.ok(!/CfD|\bSCD\b|15 years|2 MWh|undefined|NaN|—/.test(AGENT_SYSTEM + JSON.stringify(ANALYST_TOOLS)), "this tender only");
assert.match(AGENT_SYSTEM, /SECI's FDRE-X tender: assured peak supply of 4 MWh per contracted MW a day, in the 4 hours the Buying Entity chooses each day from the non-solar hours, for 25 years.*paid at the bid's tariff under a Power Purchase Agreement with SECI/);
assert.match(AGENT_SYSTEM, /limited to 5 percent of a year's energy[\s\S]*more than 10 percent of its requirement is penalised at 1\.5 times the tariff[\s\S]*only once SECI has refused it[\s\S]*injection rights in the non-solar hours[\s\S]*Every case follows the bid's choice unless you set day_injection for that case[\s\S]*cite the document, clause and page/);
for (const t of [ANALYST_TOOLS[1], ANALYST_TOOLS[2]]) assert.match(t.input_schema.properties.day_injection.description, /Leave it out to follow the bid's own choice of connectivity in the solar hours.*Set it to stress a case/, `${t.name}: day injection follows the bid unless a stress sets it`);
assert.match(ANALYST_TOOLS[0].description, /whether it holds connectivity in the solar hours/);
const plan = ANALYST_TOOLS[2].input_schema;
assert.deepEqual(plan.required, ["solar_add_mw"]);
assert.ok(plan.properties.battery.maxItems === TENDER.termYears && plan.properties.battery.items.properties.year.maximum === TENDER.termYears, "a tranche in any of the 25 years");
assert.equal(inputError(plan, { solar_add_mw: 50, battery: [{ year: 20, mwh: 75 }], day_injection: false }), null);
assert.equal(inputError(ANALYST_TOOLS[0].input_schema, {}), null);
assert.equal(inputError(ANALYST_TOOLS[1].input_schema, { tranche_mwh: 50, max_solar_add_mw: 100, battery_price_fall_pct: 8 }), null);
assert.match(inputError(plan, {}), /solar_add_mw is required/);
assert.match(inputError(plan, { solar_add_mw: "50" }), /must be a number/);
assert.match(inputError(plan, { solar_add_mw: 50, battery: [{ year: 5.5, mwh: 75 }] }), /whole number/);
assert.match(inputError(plan, { solar_add_mw: 50, battery: [{ year: 26, mwh: 75 }] }), /above 25/);
assert.match(inputError(plan, { solar_add_mw: 50, battery: [{ year: 0, mwh: 75 }] }), /below 1/);
assert.match(inputError(plan, { solar_add_mw: 50, battery: [{ year: 3 }] }), /mwh is required/);
assert.match(inputError(plan, { solar_add_mw: 50, extra: 1 }), /not a known field/);
assert.match(inputError(plan, { solar_add_mw: 50, battery: {} }), /must be a list/);
assert.match(inputError(plan, { solar_add_mw: 50, day_injection: "no" }), /true or false/);
assert.match(inputError(plan, null), /must be an object/);
assert.match(inputError(ANALYST_TOOLS[3].input_schema, { query: "x".repeat(201) }), /too long/);
assert.match(inputError(ANALYST_TOOLS[0].input_schema, { state: {} }), /not a known field/);

// ---- the tools on the modelled bid
const tools = createAgentTools(sized);
const got = await tools.run("get_bid", {});
assert.ok(got.tender === `SECI-FDRE-X, RfS ${RFS.number}` && got.contracted_mw === 100 && got.battery_mwh === 400 && got.battery_mw === 100 && got.own_solar_mwac === 130 && got.daily_supply_mwh === 400 && got.term_years === 25, JSON.stringify(got).slice(0, 300));
assert.ok(got.effective_date === "01 Jun 2027" && got.scsd === "01 Dec 2028" && got.term_ends === "01 Dec 2053");
near(got.tariff_rs_per_kwh, model.sp, 1e-4, "the analyst reads the tariff the tab shows");
near(got.equity_irr_pct, got.target_equity_irr_pct, 0.01, "at the target equity IRR");
assert.ok(got.psm_cover === true && got.psm_discount_rs_per_kwh === 0.02 && got.bought_power_limit_pct_of_year === 5 && got.buys_green_market_power === true && got.sells_surplus_re === true && got.connectivity_in_solar_hours === false && got.market_prices_from === "DAM" && got.shortfall_policy === "meet");
assert.ok(got.the_bid_now.plan === "The bid as it stands" && got.the_bid_now.days_short_of_supply === 0 && got.upside_defaults.tranche_mwh === 50 && got.upside_defaults.max_solar_add_mw === 100 && got.notes.length === 5);
assert.ok(got.upside_defaults.day_injection === false && got.the_bid_now.day_sale_mu_per_year < 1 && got.the_bid_now.curtailed_mu_per_year > 50 && /follows the bid's connectivity choice/.test(got.notes[4]), "day injection follows the bid: none, the day's surplus curtailed");
{
  const there = await createAgentTools(open).run("get_bid", {});
  assert.ok(there.connectivity_in_solar_hours === true && there.upside_defaults.day_injection === true && there.the_bid_now.day_sale_mu_per_year > 50 && there.the_bid_now.curtailed_mu_per_year < 1, "and with connectivity in the solar hours: sold");
  near(there.tariff_rs_per_kwh, openModel.sp, 1e-4, "at that bid's own tariff");
}
for (const key of ["strike_price_rs_per_kwh", "uses_group_re", "group_re_price_rs_per_kwh", "own_re_commissioned_months_after_scd", "scd", "sells_in"]) assert.ok(!(key in got), `get_bid has no ${key}`);
clean(JSON.stringify(got), "get_bid");
const one = await tools.run("evaluate_plan", { solar_add_mw: 50, battery: [{ year: 6, mwh: 75 }], lower_bid: true });
assert.ok(one.the_plan.plan === "+50 MWac solar, +75 MWh battery in year 6" && one.the_plan.later_tranches_cost_cr > 20 && one.the_plan.added_cost_at_scd_cr > 150 && typeof one.the_plan.equity_irr_pct === "number" && one.bid_lower_instead.tariff_rs_per_kwh > 0 && one.tariff_rs_per_kwh === got.tariff_rs_per_kwh && one.settings.day_injection === false, JSON.stringify(one).slice(0, 400));
near(one.the_plan.change_in_equity_irr_points, one.the_plan.equity_irr_pct - one.the_bid_now.equity_irr_pct, 0.011, "the change against the bid");
const late = await tools.run("evaluate_plan", { solar_add_mw: 0, battery: [{ year: 20, mwh: 50 }] });
assert.equal(late.the_plan.plan, "+50 MWh battery in year 20", "a tranche late in the 25-year term");
const stressed = await tools.run("evaluate_plan", { solar_add_mw: 50, day_injection: false, debt_share_on_addition_pct: 0, midday_price_change_pct_per_year: -5 });
assert.ok(stressed.the_plan.debt_cr === one.the_bid_now.debt_cr && stressed.the_plan.day_sale_mu_per_year < 0.5 && stressed.settings.day_injection === false && stressed.settings.midday_price_change_pct_per_year === -5, "the stresses reach the case");
// a stress the other way: connectivity in the solar hours for this case, the bid's own case and the tariff held with it
const sunny = await tools.run("evaluate_plan", { solar_add_mw: 50, day_injection: true });
assert.ok(sunny.settings.day_injection === true && sunny.the_plan.day_sale_mu_per_year > 50 && sunny.the_bid_now.day_sale_mu_per_year > 50 && sunny.the_bid_now.curtailed_mu_per_year < 1 && sunny.the_plan.curtailed_mu_per_year < got.the_bid_now.curtailed_mu_per_year / 2, "day injection set for a case");
near(sunny.tariff_rs_per_kwh, openModel.sp, 1e-4, "like for like: the tariff of the bid with that connectivity");
assert.deepEqual(tools.plans.map((p) => p.label), ["+50 MWac solar, +75 MWh battery in year 6", "+50 MWh battery in year 20", "+50 MWac solar"], "the plans priced are kept for the screen");
const sweep = await tools.run("run_upside_sweep", { battery_price_fall_pct: 10 });
assert.ok(sweep.tariff_rs_per_kwh === got.tariff_rs_per_kwh && sweep.solar_only.length >= 2 && sweep.battery_tranche_by_year_on_best_solar.length >= 3 && sweep.findings.length >= 3 && sweep.best_by_equity_irr && sweep.settings.tranche_mwh === 50 && sweep.settings.day_injection === false && JSON.stringify(sweep).length < 40000, "the sweep in a size the model can read");
clean(JSON.stringify(sweep), "the sweep");
const law = await tools.run("tender_lookup", { query: "connectivity non-solar hours" });
assert.ok(law.conditions.length > 0 && law.conditions.every((c) => c.clause && c.page > 0 && c.document && c.quote) && law.conditions.some((c) => c.id === "substation"), "tender terms with clause and page");
assert.match((await tools.run("tender_lookup", { query: "zzzz qqqq" })).note, /Nothing in the tender's terms/);
assert.match((await tools.run("evaluate_plan", { solar_add_mw: -5 })).error, /below 0/);
assert.match((await tools.run("evaluate_plan", { solar_add_mw: 2500 })).error, /beyond 20 MWac per contracted MW/);
assert.match((await tools.run("launch", {})).error, /no tool named/);
assert.match((await createAgentTools({ inputs: {} }).run("get_bid", {})).error, /not complete/, "an incomplete bid is said, not thrown");

// ---- the conversation the browser sends
assert.deepEqual(cleanMessages([{ role: "assistant", content: "hello" }, { role: "user", content: " a " }, { role: "user", content: "b" }, { role: "system", content: "x" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }, { role: "assistant", content: "e" }]),
  [{ role: "user", content: "a\n\nb" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }]);
assert.deepEqual(cleanMessages("x"), []);

// ---- the loop, against a stand-in for the model
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 };
function standIn(steps) {
  const seen = [];
  return {
    seen,
    beta: { messages: { stream(params, opts) {
      seen.push({ params: JSON.parse(JSON.stringify(params)), opts });
      const step = steps[seen.length - 1];
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
  const answer = await runBidAgent({ client, state: sized, messages: [{ role: "user", content: "What does 25 MWac more do?" }], send: (e) => events.push(e) });
  const p = client.seen[0].params;
  assert.ok(p.model === AGENT_MODEL() && p.fallbacks === "default" && p.betas.includes("server-side-fallback-2026-07-01") && p.thinking.type === "adaptive" && ["low", "medium", "high", "xhigh", "max"].includes(p.output_config.effort) && p.max_tokens >= 16000, "the request: the model, its fallback, adaptive thinking, effort set");
  assert.ok(p.system[0].cache_control.type === "ephemeral" && p.system[0].text === AGENT_SYSTEM && p.tools.length === 4 && !("temperature" in p) && !("tool_choice" in p), "cached instructions, the four tools, no sampling or forced tool");
  assert.deepEqual(p.messages, [{ role: "user", content: "What does 25 MWac more do?" }]);
  const second = client.seen[1].params.messages;
  assert.equal(second.length, 3);
  assert.deepEqual(second[1].content.map((b) => b.type), ["thinking", "text", "tool_use", "tool_use"], "the assistant's turn goes back whole, thinking included");
  assert.deepEqual(second[2].content.map((b) => [b.type, b.tool_use_id, Boolean(b.is_error)]), [["tool_result", "t1", false], ["tool_result", "t2", false]], "both results in one user message");
  const first = JSON.parse(second[2].content[0].content);
  near(first.tariff_rs_per_kwh, model.sp, 1e-4, "the simulation ran on the fdrex model of the bid");
  assert.ok(first.tender === got.tender && first.term_years === 25);
  assert.equal(JSON.parse(second[2].content[1].content).the_plan.plan, "+25 MWac solar");
  assert.deepEqual(events.filter((e) => e.type !== "text").map((e) => `${e.type}:${e.id}`), ["tool:t1", "tool_done:t1", "tool:t2", "tool_done:t2"]);
  assert.equal(events.find((e) => e.type === "tool" && e.id === "t1").label, "Reading the bid");
  assert.equal(events.find((e) => e.type === "tool" && e.id === "t2").label, "Pricing +25 MWac solar");
  assert.equal(events.filter((e) => e.type === "text").map((e) => e.delta).join(""), "Let me run that.\n\nAdding 25 MWac changes the equity IRR as shown.");
  assert.ok(answer.text === "Let me run that.\n\nAdding 25 MWac changes the equity IRR as shown." && answer.stop === "end_turn" && answer.toolCalls === 2 && answer.usage.input_tokens === 200 && answer.usage.cache_read_input_tokens === 100 && answer.plans[0].label === "+25 MWac solar" && answer.model === "claude-opus-5-5");
}
{
  // a refusal: nothing is run, the reason is returned
  const client = standIn([{ stop: "refusal", content: [{ type: "tool_use", id: "t1", name: "get_bid", input: {} }] }]);
  const events = [];
  const answer = await runBidAgent({ client, state: sized, messages: [{ role: "user", content: "x" }], send: (e) => events.push(e) });
  assert.ok(answer.stop === "refusal" && answer.toolCalls === 0 && events.length === 0 && client.seen.length === 1);
}
{
  // an input that does not fit the schema goes back as an error for the model to correct
  const client = standIn([{ stop: "tool_use", content: [{ type: "tool_use", id: "t1", name: "evaluate_plan", input: { solar_add_mw: 50, battery: [{ year: 99, mwh: 10 }] } }] }, { stop: "end_turn", content: [{ type: "text", text: "ok" }] }]);
  await runBidAgent({ client, state: sized, messages: [{ role: "user", content: "x" }] });
  const back = client.seen[1].params.messages[2].content[0];
  assert.ok(back.is_error === true && /above 25/.test(back.content));
}
{
  // a tool input that cannot be parsed (not an API error): the turn is asked again, twice at most
  const client = standIn([{ fail: new SyntaxError("Unexpected end of JSON input") }, { stop: "end_turn", content: [{ type: "text", text: "done" }] }]);
  const answer = await runBidAgent({ client, state: sized, messages: [{ role: "user", content: "x" }] });
  assert.ok(answer.text === "done" && client.seen.length === 2 && client.seen[1].params.messages.length === 1);
  const always = standIn([1, 2, 3, 4].map(() => ({ fail: new SyntaxError("bad") })));
  await assert.rejects(runBidAgent({ client: always, state: sized, messages: [{ role: "user", content: "x" }] }), SyntaxError);
  assert.equal(always.seen.length, 3);
  // the service's own errors are not retried here
  const apiErr = new Anthropic.APIError(500, { type: "error" }, "boom", new Headers());
  const failing = standIn([{ fail: apiErr }]);
  await assert.rejects(runBidAgent({ client: failing, state: sized, messages: [{ role: "user", content: "x" }] }), (e) => e === apiErr);
  assert.equal(failing.seen.length, 1);
}
{
  // the limit of simulations in one answer
  const many = Array.from({ length: 18 }, (_, k) => ({ type: "tool_use", id: `t${k}`, name: "tender_lookup", input: { query: "storage" } }));
  const client = standIn([{ stop: "tool_use", content: many }, { stop: "end_turn", content: [{ type: "text", text: "enough" }] }]);
  const answer = await runBidAgent({ client, state: sized, messages: [{ role: "user", content: "x" }] });
  const back = client.seen[1].params.messages[2].content;
  assert.ok(back.length === 18 && back.filter((b) => b.is_error).length === 2 && answer.toolCalls === 18, "every call answered, the ones over the limit as errors");
}
await assert.rejects(runBidAgent({ client: standIn([]), state: sized, messages: [] }), /question is required/);

// ---- the service's errors, most specific first
const H = new Headers();
assert.match(agentErrorOf(new Anthropic.AuthenticationError(401, {}, "no", H))[1], /key on this server was refused/);
assert.deepEqual(agentErrorOf(new Anthropic.RateLimitError(429, {}, "slow", H))[0], 429);
assert.ok(agentErrorOf(new Anthropic.NotFoundError(404, {}, "nf", H))[1].includes(`${AGENT_MODEL()} was not found`));
assert.match(agentErrorOf(new Anthropic.BadRequestError(400, { message: "bad thing" }, "bad thing", H))[1], /bad thing/);
assert.match(agentErrorOf(new Anthropic.APIConnectionError({ message: "down" }))[1], /could not be reached/);
assert.match(agentErrorOf(new Anthropic.APIError(529, {}, "over", H))[1], /529/);
assert.deepEqual(agentErrorOf(Object.assign(new Error("The bid is not complete."), { status: 400 })), [400, "The bid is not complete."]);
assert.equal(agentErrorOf(new Error("x"))[0], 500);

assert.equal(fetched, 0, "no network call was made");
console.log(`OK  SECI-FDRE-X agents: ${allInputs.length} inputs (${roundTrips} round trips), ${script.length} script items (${asked.length} asked), ${AGENT_TOOLS.length} voice tools through a scripted session, ${TERMS.length} terms looked up, ${amendmentChanges("all")[0].changes.length} amendment rows; 100 MW with 130 MWac needs ₹${model.sp.toFixed(3)}/kWh (quote ₹${model.bid.toFixed(2)} at or above the target on the full model, a paisa less below it; ₹${bare.tariff.toFixed(3)} without the PSM discount; ₹${openModel.sp.toFixed(3)} with connectivity in the solar hours), bought power ${(boughtOf(model) * 100).toFixed(1)}%, ${Math.round(muOf(model, "curtailedMwh"))} MU a year curtailed; analyst: ${ANALYST_TOOLS.length} tools on the bid, the loop against a stand-in model; ${said.length} texts free of the CfD-I wording; no network call`);
