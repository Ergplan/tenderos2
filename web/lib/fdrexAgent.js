// The bid analyst of the SECI-FDRE-X tab (POST /api/fdrex/agent): Claude, with the bid's own model
// as its tools. A question such as "what if we add 60 MWac and a battery every year from year 5?"
// is answered by running those cases: the day-by-day operation and the financial model of the
// saved bid (web/src/fdrex/upside.js through web/lib/fdrexUpside.js), not by estimating.
// Forked from web/lib/cfdAgent.js: the loop, the request and the settings are the same (the model
// and the effort are read from CFD_AGENT_MODEL and CFD_AGENT_EFFORT, as the CfD tab's analyst
// reads them); the instructions, the tools' wording and what get_bid reports are this tender's:
// a 25-year PPA at a fixed tariff for 4 MWh per MW a day in the four hours the Buying Entity
// chooses, with 5% bought power, a monthly penalty, the PSM discount and the bid's choice of
// connectivity in the solar hours (which the cases follow unless a stress sets it).
//
// The loop runs here, on the application's server, through the Messages API: the request carries
// the conversation and the tools, Claude asks for simulations, this module runs them on the bid
// state the browser sent and returns the numbers, until Claude answers. Nothing is kept by the
// model's provider between requests beyond its standard retention, and the route refuses to run in
// the core zone (web/lib/zone.js), where no cloud model reaches the bid workspace.
//
// Facts come only from the tools: the bid's numbers from its model, the tender from its terms
// (document, clause, page). The analyst proposes plans; it changes nothing in the bid.
import Anthropic from "@anthropic-ai/sdk";
import { augmentationText, fmtDate, keyDates, psmDiscount } from "../src/fdrex/model.js";
import { TENDER } from "../src/fdrex/tender.js";
import { PACK } from "../src/fdrex/pack.js";
import { tenderLookup } from "../src/fdrex/agent.js";
import { cleanPlan, planLabel, upsideSettings } from "../src/fdrex/upside.js";
import { runUpsideCase, runUpsideSweep, upsideContextOf } from "./fdrexUpside.js";

export const AGENT_MODEL = () => process.env.CFD_AGENT_MODEL || "claude-opus-5-5";
const EFFORT = () => (["low", "medium", "high", "xhigh", "max"].includes(process.env.CFD_AGENT_EFFORT) ? process.env.CFD_AGENT_EFFORT : "medium");
const MAX_TURNS = 10; // requests to the model in one answer
const MAX_TOOL_CALLS = 16; // simulations in one answer
const YEARS = TENDER.termYears; // operating years of the PPA: a battery tranche may be added in any of them
const pctOfTender = (v) => Math.round(v * 100);

export const AGENT_SYSTEM = `You are the bid analyst inside TenderOS, working on one bid for SECI's FDRE-X tender: assured peak supply of ${TENDER.mwhPerMwDay} MWh per contracted MW a day, in the ${TENDER.peakHours} hours the Buying Entity chooses each day from the non-solar hours, for ${YEARS} years, from energy storage charged with renewable power, paid at the bid's tariff under a Power Purchase Agreement with SECI.

Your job is to find and explain ways to raise the return of this bid, mainly through capacity added behind the same grid connection: more own solar, and battery added at the start or in later years at a falling price. What an addition does not use to charge the bid's battery it sells on the power exchange: surplus solar in the day, the added battery in the evening hours outside the buyer's hours. The connection, the line and the bay are paid for by the bid, so an addition carries none of that cost.

What the model takes from the tender, for you to check with tender_lookup before you rely on it in an answer
- The peak supply earns the tariff, fixed for the term. Exchange prices move only what the addition sells in the market and what bought charging power costs. There is no settlement against exchange prices in this tender.
- Bought green-market or bilateral power is limited to ${pctOfTender(TENDER.marketShare)} percent of a year's energy, so more own solar is what charges the battery on thin days.
- A billing month short by more than ${pctOfTender(TENDER.shortfallTolerance)} percent of its requirement is penalised at ${TENDER.penaltyMultiple} times the tariff. Selling to others while the PPA supply is short is penalised on top, so the model sells nothing on a day the peak supply is short.
- The model takes the buyer to choose its four dearest evening hours (18:00 to 24:00). Hours chosen in the morning need the same stored energy, and would change which evening hours are left for the added battery to sell in.
- Excess energy beyond the peak supply may be sold to others only once SECI has refused it; SECI buys it at the tariff if the Buying Entity consents. The cases sell surplus at exchange prices and do not count on SECI buying it.
- The RfS asks for connectivity with injection rights in the non-solar hours. Whether the bid also holds connectivity in the solar hours is the bidder's choice, and get_bid reports it: without it nothing is injected in the day and the day's surplus solar is curtailed, with it the surplus is sold. Every case follows the bid's choice unless you set day_injection for that case.

How you work
- Every number you state comes from a tool result in this conversation. Call get_bid first when you have not seen the bid. Run the cases you need; do not estimate a result you could run. If a tool fails, say what failed.
- run_upside_sweep walks the solar sizes, the year a battery tranche starts to pay, a ladder of yearly tranches, and stresses the best plan. evaluate_plan prices one plan you choose, with optional stresses. Use the sweep for an open question and evaluate_plan to follow up or to test what the user proposes.
- All cases hold the bid's tariff and use one year of IEX prices held flat for the term unless a stress says otherwise. Say so when it matters to the conclusion.
- Judge an addition on three things: what it does to the equity IRR of the whole bid, what it returns on its own cost (the addition alone), and how it stands under the stresses: no injection in solar hours, midday prices falling, the addition paid from equity. When the bid has no connectivity in the solar hours, more own solar can only charge the battery: say what connectivity in the solar hours would add (day_injection true) and that it is a separate connectivity to obtain. A late, small battery tranche can return well on its own cash and still barely move the blended IRR: report both.
- A higher IRR at the bid's tariff and a lower tariff at the bid's IRR are the same gain. When more own solar raises the IRR, say what tariff it would allow instead (ask evaluate_plan for lower_bid).
- For anything about what the tender allows, call tender_lookup and cite the document, clause and page it returns. Do not state a tender condition from memory.
- You propose; you do not change the bid. The user applies a plan on the Upside step.

How you write
- Plain text, no Markdown syntax: no asterisks, no pound signs, no tables with pipes. Short paragraphs; a list as lines starting with a dash.
- Lead with the answer and its number. Then the reason, then the risks, then what to check next.
- Indian units as the tools give them: rupees crore, MU, MWac, MWh, rupees per kWh. Percentages to one decimal.
- Be direct about what does not pay, and about what the model does not cover.`;

const num = (min, max, description) => ({ type: "number", minimum: min, maximum: max, description });
const SETTINGS_PROPS = {
  battery_price_fall_pct: num(0, 50, "The battery price falls this many percent a year (default 10). A tranche bought in year y costs today's price times (1 - fall)^(y - 1)."),
  debt_share_on_addition_pct: num(0, 90, "Debt on the addition's cost at the SCSD, percent. Default: the bid's own debt share. 0 means the addition is paid from equity."),
  day_injection: { type: "boolean", description: "Whether surplus own solar may be injected and sold in the solar hours. Leave it out to follow the bid's own choice of connectivity in the solar hours (get_bid: connectivity_in_solar_hours). Set it to stress a case: false models connectivity in the non-solar hours only, which is what the RfS asks the bidder to apply for (the day's surplus is curtailed); true models connectivity in the solar hours as well. When set, the bid's own case and the tariff the cases hold are worked with the same setting, so the plan is compared like for like." },
};
/** The tools: name, description, JSON schema. The order is fixed (it is part of the cached prefix). */
export const AGENT_TOOLS = [
  {
    name: "get_bid",
    description: "The bid as it stands: its plant, tariff, returns, costs, sourcing (own RE, bought power, market sales), whether it holds connectivity in the solar hours, the Payment Security Mechanism choice, and the defaults of the Upside settings. Call this first.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_upside_sweep",
    description: "Run the Upside sweep on the bid: solar additions in steps, a battery tranche added in different years on the best solar, a ladder of yearly tranches from the first year one pays, the stresses of the best plan, and the tariff the best solar would allow at the bid's target IRR. Takes ten seconds or more. Returns every case with its equity IRR and the addition's own returns.",
    input_schema: {
      type: "object",
      properties: {
        ...SETTINGS_PROPS,
        tranche_mwh: num(1, 5000, "One battery tranche, MWh (default 0.5 MWh per contracted MW)."),
        max_solar_add_mw: num(1, 5000, "The largest solar addition to try, MWac (default: the contracted MW)."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "evaluate_plan",
    description: "Price one plan at the bid's tariff: solar added to the bid's own solar, and battery tranches by operating year (year 1 starts at the SCSD). Optional stresses apply to this case only. Returns the bid's own case and the plan's: equity IRR, project IRR, cost, the addition's own returns, energy sold and bought, minimum DSCR.",
    input_schema: {
      type: "object",
      properties: {
        solar_add_mw: num(0, 5000, "Own solar added, MWac."),
        battery: { type: "array", maxItems: YEARS, description: "Battery tranches added.", items: { type: "object", properties: { year: { type: "integer", minimum: 1, maximum: YEARS, description: "Operating year the tranche is added at the start of (1: the SCSD)." }, mwh: num(1, 5000, "Tranche size, MWh.") }, required: ["year", "mwh"], additionalProperties: false } },
        ...SETTINGS_PROPS,
        midday_price_change_pct_per_year: num(-30, 30, "Stress: midday (charging and day-sale) prices move this many percent a year on top of the bid's price path, e.g. -5."),
        lower_bid: { type: "boolean", description: "Also solve the tariff the bid's target equity IRR would need with this plan's solar." },
      },
      required: ["solar_add_mw"],
      additionalProperties: false,
    },
  },
  {
    name: "tender_lookup",
    description: "Look up what the tender says (RfS, standard PPA, standard PSA, Amendment-01): returns matching conditions with the document, clause, page and a quote. Use for connectivity, use of the storage outside the Peak Hours, the 5% bought power, excess energy and SECI's first right, sale to third parties, the shortfall penalty.",
    input_schema: { type: "object", properties: { query: { type: "string", maxLength: 200, description: "Words to look for, e.g. 'connectivity non-solar hours' or 'excess energy'." } }, required: ["query"], additionalProperties: false },
  },
].map((t) => ({ ...t, eager_input_streaming: true }));

/** Validate a tool input against its schema (objects of numbers, booleans, strings, one array of objects). Returns an error text, or null. */
export function inputError(schema, value, at = "input") {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${at} must be an object`;
    for (const k of schema.required || []) if (!(k in value)) return `${at}.${k} is required`;
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (!sub) return `${at}.${k} is not a known field`;
      const e = inputError(sub, v, `${at}.${k}`);
      if (e) return e;
    }
    return null;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return `${at} must be a list`;
    if (schema.maxItems && value.length > schema.maxItems) return `${at} has more than ${schema.maxItems} entries`;
    for (let i = 0; i < value.length; i += 1) { const e = inputError(schema.items, value[i], `${at}[${i}]`); if (e) return e; }
    return null;
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${at} must be a number`;
    if (schema.type === "integer" && !Number.isInteger(value)) return `${at} must be a whole number`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${at} is below ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${at} is above ${schema.maximum}`;
    return null;
  }
  if (schema.type === "boolean") return typeof value === "boolean" ? null : `${at} must be true or false`;
  if (schema.type === "string") return typeof value !== "string" ? `${at} must be text` : schema.maxLength && value.length > schema.maxLength ? `${at} is too long` : null;
  return null;
}

const settingsOf = (input, base = {}) => upsideSettings({
  ...base,
  ...(typeof input.battery_price_fall_pct === "number" ? { batteryDecline: input.battery_price_fall_pct / 100 } : {}),
  ...(typeof input.debt_share_on_addition_pct === "number" ? { debtShare: input.debt_share_on_addition_pct / 100 } : {}),
  ...(typeof input.day_injection === "boolean" ? { dayInjection: input.day_injection } : {}),
});
/** The day injection a case ran with: the setting as the Upside resolved it (it follows the bid's connectivity choice unless set). */
const dayInjectionOf = (settings) => (typeof settings?.dayInjection === "boolean" ? settings.dayInjection : "the bid's connectivity choice");
const r = (v, d = 2) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const pct = (v, d = 2) => (typeof v === "number" && Number.isFinite(v) ? Number((v * 100).toFixed(d)) : null);
/** A case in the few numbers the analyst reads (percentages as percent). */
const brief = (c) => (c ? {
  plan: c.label, equity_irr_pct: pct(c.equityIrr), change_in_equity_irr_points: pct(c.dEquityIrr), project_irr_pct: pct(c.projectIrr),
  added_cost_at_scd_cr: r(c.addCostCr, 1), later_tranches_cost_cr: r(c.laterCapexCr, 1), project_cost_cr: r(c.costCr, 1), debt_cr: r(c.debtCr, 1), equity_cr: r(c.equityCr, 1),
  addition_alone_project_irr_pct: pct(c.addProjectIrr), addition_alone_equity_irr_pct: pct(c.addEquityIrr),
  ...(c.stepEquityIrr !== null && c.stepEquityIrr !== undefined ? { last_tranche_alone_equity_irr_pct: pct(c.stepEquityIrr), last_tranche_alone_project_irr_pct: pct(c.stepProjectIrr) } : {}),
  equity_value_at_target_irr_cr: r(c.equityNpvCr, 1), min_dscr: r(c.minDscr), min_dscr_year: c.minDscrYear, days_short_of_supply: c.shortDays,
  day_sale_mu_per_year: r(c.daySoldMuYr, 1), day_sale_price_rs_per_kwh: r(c.dayPrice), battery_sale_mu_per_year: r(c.batterySoldMuYr, 1), battery_sale_price_rs_per_kwh: r(c.batteryPrice),
  charging_power_bought_cr_per_year: r(c.boughtCrYr, 1), curtailed_mu_per_year: r(c.curtailedMuYr, 1),
} : null);

/**
 * The tools run on one bid state. Returns { run(name, input) → result object, plans }: `plans`
 * collects every plan priced (label and plan), for the screen to offer.
 */
export function createAgentTools(stateIn) {
  const contexts = new Map(); // settings → the shared context (the bid's own case is computed once)
  const ctxOf = (settings) => {
    const key = JSON.stringify(settings);
    if (!contexts.has(key)) contexts.set(key, upsideContextOf(stateIn, settings));
    return contexts.get(key);
  };
  const plans = [];
  const note = (plan) => { const p = cleanPlan(plan); if (p.solarMw > 0 || p.battery.length) { const label = planLabel(p); if (!plans.some((x) => x.label === label)) plans.push({ label, plan: p }); } };
  const tools = {
    get_bid() {
      const ctx = ctxOf(upsideSettings({}));
      const i = ctx.base.model.inputs;
      const f = ctx.base.finance;
      const d = keyDates(i.effectiveDate);
      return {
        tender: `SECI-FDRE-X, RfS ${PACK.rfsNo}`,
        contracted_mw: i.contractedMw, battery_mwh: r(ctx.X * ((i.essMwhPerMw || 0) + (i.extraEssMwhPerMw || 0)), 1), battery_mw: r(ctx.X * i.essMwPerMw, 1), own_solar_mwac: i.solarMw || 0, own_wind_mw: i.windMw || 0,
        daily_supply_mwh: ctx.X * TENDER.mwhPerMwDay, effective_date: fmtDate(d.ed), scsd: fmtDate(d.scd), term_ends: fmtDate(d.end), term_years: YEARS,
        tariff_rs_per_kwh: r(ctx.tariff, 4), target_equity_irr_pct: pct(i.targetEquityIrr), equity_irr_pct: pct(f.equityIrr), project_irr_pct: pct(f.projectIrr),
        project_cost_cr: r(f.capex.total, 1), debt_cr: r(f.debt, 1), equity_cr: r(f.equity, 1), debt_share_pct: pct(i.debtFraction, 0), interest_rate_pct: pct(i.interestRate),
        battery_price_cr_per_mwh: i.essCrPerMwh, solar_price_cr_per_mwac: i.solarCrPerMw, line_cost_cr: r(ctx.X * (i.evacuationCrPerMw || 0), 1),
        battery_fade_pct_per_year: pct(i.essDegradation), battery_augmentation: augmentationText(ctx.state), round_trip_pct: pct(i.rte, 0), solar_cuf_pct: pct(i.solarCuf, 1),
        market_prices_from: i.sellMarket, buys_green_market_power: Boolean(i.useMarket), bought_power_limit_pct_of_year: pct(TENDER.marketShare, 0), sells_surplus_re: Boolean(i.merchant), connectivity_in_solar_hours: Boolean(i.dayInjection),
        psm_cover: Boolean(i.psm), psm_discount_rs_per_kwh: psmDiscount(i), shortfall_policy: i.shortfallPolicy || "meet", price_scenario: i.priceScenario || "flat",
        the_bid_now: brief(ctx.base),
        upside_defaults: { battery_price_fall_pct: 10, debt_share_on_addition_pct: pct(i.debtFraction, 0), day_injection: dayInjectionOf(ctx.settings), tranche_mwh: 0.5 * ctx.X, max_solar_add_mw: ctx.X },
        notes: [
          "Cases hold this tariff and one IEX price year flat for the term.",
          "A battery added after the SCSD is paid from the project's cash in its year and fades from that year.",
          "The Buying Entity is taken to choose its four dearest evening hours (18:00 to 24:00) every day; the added battery sells in the evening hours outside them.",
          "Nothing is sold on a day the peak supply is short: the PPA supply comes first.",
          "Day injection follows the bid's connectivity choice unless a case sets it: without connectivity in the solar hours nothing is injected from 06:00 to 18:00 and the day's surplus is curtailed.",
        ],
      };
    },
    async run_upside_sweep(input) {
      const X = ctxOf(upsideSettings({})).X;
      const settings = settingsOf(input, { ...(typeof input.tranche_mwh === "number" ? { trancheMwhPerMw: input.tranche_mwh / X } : {}), ...(typeof input.max_solar_add_mw === "number" ? { maxSolarPerMw: input.max_solar_add_mw / X } : {}) });
      const s = await runUpsideSweep(stateIn, settings);
      for (const c of [s.bestSolar, s.best, s.ladderPlan, s.bestValue]) if (c) note(c.plan);
      const stress = {};
      for (const [k, v] of Object.entries(s.stress)) stress[k === "bestSolar" ? "best_solar" : "best_battery_plan"] = Object.fromEntries(Object.entries(v).map(([n, c]) => [{ noDayInjection: "no_injection_in_solar_hours", middayPrices: `midday_prices_${Math.round(s.settings.middayStress * 100)}pct_a_year`, fromEquity: "addition_paid_from_equity" }[n] || n, brief(c)]));
      return {
        tariff_rs_per_kwh: s.tariff, target_equity_irr_pct: pct(s.targetIrr), settings: { battery_price_fall_pct: pct(s.settings.batteryDecline, 0), debt_share_on_addition_pct: s.settings.debtShare === null ? "the bid's" : pct(s.settings.debtShare, 0), day_injection: dayInjectionOf(s.settings), tranche_mwh: r(s.settings.trancheMwhPerMw * s.contractedMw, 0) },
        the_bid_now: brief(s.base), solar_only: s.solar.map(brief), battery_tranche_by_year_on_best_solar: s.timing.map(brief), battery_ladder: s.ladder.map(brief),
        best_by_equity_irr: s.best?.label, best_solar: s.bestSolar?.label ?? null, most_value_at_target_irr: s.bestValue?.label ?? null, battery_ladder_plan: s.ladderPlan?.label ?? null,
        stress, bid_lower_instead: s.lowerBid ? { with_solar_add_mw: s.lowerBid.solarMw, tariff_rs_per_kwh: r(s.lowerBid.tariff, 4), change_rs_per_kwh: r(s.lowerBid.change, 4) } : null,
        findings: s.suggestions.map((x) => `${x.kind}: ${x.title}`),
      };
    },
    evaluate_plan(input) {
      const settings = settingsOf(input);
      const plan = { solarMw: input.solar_add_mw, battery: input.battery || [] };
      const out = runUpsideCase(stateIn, settings, plan, { middayPerYear: typeof input.midday_price_change_pct_per_year === "number" ? input.midday_price_change_pct_per_year / 100 : 0 }, { ctx: ctxOf(settings), lowerBid: Boolean(input.lower_bid) });
      note(plan);
      return {
        tariff_rs_per_kwh: out.tariff, target_equity_irr_pct: pct(out.targetIrr),
        settings: { battery_price_fall_pct: pct(settings.batteryDecline, 0), debt_share_on_addition_pct: settings.debtShare === null ? "the bid's" : pct(settings.debtShare, 0), day_injection: dayInjectionOf(out.settings ?? settings), midday_price_change_pct_per_year: input.midday_price_change_pct_per_year ?? 0 },
        the_bid_now: brief(out.base), the_plan: brief(out.case),
        bid_lower_instead: out.lowerBid ? { tariff_rs_per_kwh: out.lowerBid.tariff, change_rs_per_kwh: out.lowerBid.change } : null,
      };
    },
    tender_lookup(input) {
      const found = tenderLookup(input.query, 6);
      return found.length ? { conditions: found } : { conditions: [], note: "Nothing in the tender's terms matches these words." };
    },
  };
  return {
    plans,
    async run(name, input) {
      const def = AGENT_TOOLS.find((t) => t.name === name);
      if (!def) return { error: `There is no tool named ${name}.` };
      const bad = inputError(def.input_schema, input ?? {});
      if (bad) return { error: `Invalid input: ${bad}.` };
      try {
        return await tools[name](input ?? {});
      } catch (err) {
        if (err?.status && err.status < 500) return { error: err.message }; // the bid is incomplete, a size out of range: the analyst can say so
        throw err;
      }
    },
  };
}

/** The conversation the browser sent, as Messages API turns: text only, user first and last. */
export function cleanMessages(raw) {
  const out = [];
  for (const m of Array.isArray(raw) ? raw.slice(-30) : []) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    const text = typeof m?.content === "string" ? m.content.trim().slice(0, 8000) : "";
    if (!role || !text) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  while (out.length && out[out.length - 1].role !== "user") out.pop();
  return out;
}

const toolLabel = (name, input) => {
  if (name === "get_bid") return "Reading the bid";
  if (name === "run_upside_sweep") return "Running the Upside sweep";
  if (name === "evaluate_plan") return `Pricing ${planLabel({ solarMw: input?.solar_add_mw, battery: input?.battery })}${input?.day_injection === false ? ", no day injection" : input?.day_injection === true ? ", with day injection" : ""}${input?.midday_price_change_pct_per_year ? `, midday ${input.midday_price_change_pct_per_year}% a year` : ""}${input?.debt_share_on_addition_pct === 0 ? ", from equity" : ""}`;
  if (name === "tender_lookup") return `Looking up the tender: ${String(input?.query || "").slice(0, 60)}`;
  return name;
};

/**
 * One answer of the analyst. `send(event)` receives what the screen shows as it happens:
 *   { type: "text", delta }             the answer as it is written
 *   { type: "tool", id, name, label }   a simulation started
 *   { type: "tool_done", id, ok, ms }   and finished
 * Resolves with { text, plans, model, usage, stop }: the whole answer, the plans it priced, the
 * model that served it, the tokens used and why it stopped. Throws the SDK's typed errors.
 * `client` is an Anthropic client (the route builds it with the application's key).
 */
export async function runBidAgent({ client, state, messages: raw, send = () => {}, signal = undefined }) {
  const history = cleanMessages(raw);
  if (!history.length) throw Object.assign(new Error("A question is required."), { status: 400 });
  const tools = createAgentTools(state);
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let text = "";
  let served = AGENT_MODEL();
  let calls = 0;
  let jsonRetries = 0;
  let stop = "end_turn";
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const stream = client.beta.messages.stream({
      model: AGENT_MODEL(),
      max_tokens: 16000,
      // on a safety decline the request is re-run on the fallback model the API chooses
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT() },
      // the instructions and the tools do not change between requests: cached
      system: [{ type: "text", text: AGENT_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: AGENT_TOOLS,
      messages,
    }, { signal });
    let wrote = "";
    stream.on("text", (delta) => { wrote += delta; send({ type: "text", delta }); });
    let message;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // a tool input that could not be parsed, or a dropped connection: the turn is asked again;
      // the API's own errors go to the caller
      if (err instanceof Anthropic.APIError || signal?.aborted || jsonRetries >= 2) throw err;
      jsonRetries += 1;
      if (wrote) send({ type: "retract", length: wrote.length });
      continue;
    }
    text += wrote;
    served = message.model || served;
    for (const k of Object.keys(usage)) usage[k] += message.usage?.[k] || 0;
    stop = message.stop_reason;
    if (stop === "refusal") break; // never run that turn's tools
    if (stop === "pause_turn") { messages.push({ role: "assistant", content: message.content }); continue; }
    const asks = message.content.filter((b) => b.type === "tool_use");
    if (!asks.length || stop === "max_tokens") break;
    messages.push({ role: "assistant", content: message.content });
    const results = [];
    for (const ask of asks) {
      calls += 1;
      if (calls > MAX_TOOL_CALLS) { results.push({ type: "tool_result", tool_use_id: ask.id, is_error: true, content: "The limit of simulations for one answer is reached. Answer with what you have." }); continue; }
      send({ type: "tool", id: ask.id, name: ask.name, label: toolLabel(ask.name, ask.input) });
      const t0 = Date.now();
      const out = await tools.run(ask.name, ask.input);
      send({ type: "tool_done", id: ask.id, ok: !out?.error, ms: Date.now() - t0 });
      results.push({ type: "tool_result", tool_use_id: ask.id, ...(out?.error ? { is_error: true } : {}), content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
    if (text && !text.endsWith("\n")) { text += "\n\n"; send({ type: "text", delta: "\n\n" }); }
  }
  return { text: text.trim(), plans: tools.plans, model: served, usage, stop, toolCalls: calls };
}

/** What to tell the user when the model's service fails: [status, message]. Most specific first. */
export function agentErrorOf(err) {
  if (err instanceof Anthropic.AuthenticationError) return [502, "The Anthropic key on this server was refused. Check it under Administration › API keys."];
  if (err instanceof Anthropic.PermissionDeniedError) return [502, "The Anthropic key on this server may not use this model."];
  if (err instanceof Anthropic.NotFoundError) return [502, `The model ${AGENT_MODEL()} was not found for this key (CFD_AGENT_MODEL).`];
  if (err instanceof Anthropic.RateLimitError) return [429, "The model's rate limit is reached. Try again in a minute."];
  if (err instanceof Anthropic.BadRequestError) return [502, `The model refused the request: ${String(err.message).slice(0, 200)}`];
  if (err instanceof Anthropic.APIConnectionError) return [502, "The model's service could not be reached from this server."];
  if (err instanceof Anthropic.APIError) return [502, `The model's service failed (${err.status ?? "no status"}). Try again.`];
  if (err?.status && err.status < 500) return [err.status, err.message];
  return [500, "The analyst failed on this server."];
}
