// What the bid agent asks and says, for the SECI RTC tender tab: the order of the inputs and how
// each is asked (buildScript), reading spoken numbers and dates, and the sizing and the financial
// model put into words. Plain JavaScript with no browser APIs, used by agent.js and checked in Node
// by tools/check_seci.mjs and tools/check_seci_agent.mjs.
import * as E from "../rtc/engine.js";
import { BENCHMARKS, FINANCE_FIELDS, SOURCE_FIELDS, fillBenchmarks, modelInputs, opsFromLp, dsmFor } from "../bid/model.js";
import { PACK, keyDates, moneyAtStake } from "./terms.js";

// ---------------------------------------------------------------- understanding answers

const SMALL = { zero: 0, oh: 0, nil: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, a: 1 };
const SCALE = { hundred: 100, thousand: 1000, lakh: 1e5, lakhs: 1e5, lac: 1e5, million: 1e6, crore: 1e7, crores: 1e7 };
const DIGIT = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };

/** Words to a number ("three hundred and fifty", "four point two five", "1.2"); null if none. */
export function parseNumber(text) {
  const s = String(text || "").toLowerCase().replace(/[₹,]/g, " ").replace(/-/g, " ");
  const digits = s.match(/-?\d+(?:\.\d+)?/);
  if (digits) {
    let v = Number(digits[0]);
    const after = s.slice(digits.index + digits[0].length);
    const scale = after.match(/^\s*(hundred|thousand|lakhs?|lac|million|crores?)\b/);
    if (scale) v *= SCALE[scale[1]];
    return v;
  }
  const words = s.split(/\s+/).filter((w) => w && w !== "and");
  let total = 0;
  let current = 0;
  let seen = false;
  let i = 0;
  for (; i < words.length; i += 1) {
    const w = words[i];
    if (w in SMALL && !(w === "a" && !(words[i + 1] in SCALE))) { current += SMALL[w]; seen = true; } else if (w === "hundred") { current = (current || 1) * 100; seen = true; } else if (w in SCALE) { total += (current || 1) * SCALE[w]; current = 0; seen = true; } else if (w === "point" || w === "decimal") break;
    else if (seen) break;
  }
  let value = total + current;
  if (words[i] === "point" || words[i] === "decimal") {
    const decimals = [];
    for (let k = i + 1; k < words.length && words[k] in DIGIT; k += 1) decimals.push(DIGIT[words[k]]);
    if (decimals.length) { value += Number(`0.${decimals.join("")}`); seen = true; }
  }
  return seen ? value : null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A date ("7 June 2026", "June 7th 2026", "07.06.2026", "2026-06-07"); ISO or null. */
export function parseDate(text) {
  const s = String(text || "").toLowerCase().trim();
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  if (m) return iso(+m[3], +m[2], +m[1]);
  const month = MONTHS.findIndex((name) => s.includes(name) || s.includes(name.slice(0, 3) + " "));
  const year = /(20\d\d)/.exec(s);
  if (month >= 0 && year) {
    const day = /(\d{1,2})(?:st|nd|rd|th)?\b(?!\d)/.exec(s.replace(year[1], ""));
    return iso(+year[1], month + 1, day ? +day[1] : 1);
  }
  return null;
}

function iso(y, mo, d) {
  if (!(y > 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- speaking numbers

const say = (v, d = 0) => (Number.isFinite(v) ? Number(v.toFixed(d)).toLocaleString("en-IN", { maximumFractionDigits: d }) : "not set");
const sayDate = (isoDate) => {
  if (!isoDate) return "not set";
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1].replace(/^./, (c) => c.toUpperCase())} ${y}`;
};
const crore = (rs) => `${say(rs / 1e7, rs >= 1e9 ? 0 : 1)} crore rupees`;

// ---------------------------------------------------------------- the script

const SOURCE_ASKS = {
  solar: ["cuf", "capex", "om", "degradation"],
  wind: ["cuf", "capex", "om"],
  bess: ["duration", "rte", "capex", "om"],
};
const SOURCE_NAMES = { solar: "Solar", wind: "Wind", bess: "The battery" };
const FIN_ASKS = ["targetEquityIrr", "debtFraction", "interestRate", "tenorYears", "taxRate", "preopPct", "evacuationCr"];

/** One input as a question: where it lives, how it is asked, read, set and defaulted. */
function sourceQuestion(id, f) {
  const path = `${id}.${f.key}`;
  const unit = f.pct ? "percent" : (f.unit || "").replace("₹ cr/MW", "crore rupees per megawatt").replace("₹ cr/MWh", "crore rupees per megawatt hour")
    .replace("₹ lakh/MW/yr", "lakh rupees per megawatt a year").replace("₹ lakh/MWh/yr", "lakh rupees per megawatt hour a year").replace("%/yr", "percent a year");
  const bench = BENCHMARKS[id]?.[f.key];
  return {
    id: path, step: "sources", kind: f.options ? "choice" : "number", options: f.options || null,
    ask: `${SOURCE_NAMES[id]}: ${f.label.toLowerCase()}${unit && !f.options ? `, in ${unit}` : ""}.`,
    benchmark: bench, benchmarkText: f.options ? (f.options.find(([k]) => k === bench)?.[1] || String(bench)) : `${f.pct ? say(bench * 100, 2) : say(bench, 2)} ${f.pct ? "percent" : ""}`.trim(),
    current: (s) => {
      const v = s.src[id][f.key];
      if (v === null || v === undefined) return null;
      return f.options ? (f.options.find(([k]) => k === v)?.[1] || String(v)) : `${f.pct ? say(v * 100, 2) : say(v, 2)}${f.pct ? " percent" : ""}`;
    },
    read: (text) => {
      if (f.options) {
        const t = String(text).toLowerCase();
        const n = parseNumber(t);
        const hit = f.options.find(([k, label]) => t.includes(label.toLowerCase()) || (n !== null && String(n) === k) || (k === "free" && /optimi[sz]|free|choose/.test(t)));
        return hit ? hit[0] : null;
      }
      const n = parseNumber(text);
      if (n === null) return null;
      const v = f.pct ? (n > 1 || /percent|%/.test(String(text)) ? n / 100 : n) : n;
      const lo = f.min !== undefined ? (f.pct ? f.min / 100 : f.min) : -Infinity;
      const hi = f.max !== undefined ? (f.pct ? f.max / 100 : f.max) : Infinity;
      return v >= lo - 1e-9 && v <= hi + 1e-9 ? v : null;
    },
    set: (s, v, fromBenchmark = false) => ({ ...s, src: { ...s.src, [id]: { ...s.src[id], [f.key]: v } }, filled: { ...s.filled, [path]: fromBenchmark }, lp: null }),
  };
}

function financeQuestion(f) {
  const path = `${f.section}.${f.key}`;
  const bench = BENCHMARKS[f.section]?.[f.key];
  const unit = f.pct ? "percent" : f.unit === "years" ? "years" : f.unit === "₹ cr" ? "crore rupees" : "";
  return {
    id: path, step: "sources", kind: "number",
    ask: `${f.label}${unit ? `, in ${unit}` : ""}.`,
    benchmark: bench, benchmarkText: `${f.pct ? say(bench * 100, 2) : say(bench, 2)} ${unit}`.trim(),
    current: (s) => {
      const v = s[f.section][f.key];
      return v === null || v === undefined ? null : `${f.pct ? say(v * 100, 2) : say(v, 2)} ${unit}`.trim();
    },
    read: (text) => {
      const n = parseNumber(text);
      if (n === null) return null;
      const v = f.pct ? (n > 1 || /percent|%/.test(String(text)) ? n / 100 : n) : n;
      const lo = f.min !== undefined ? (f.pct ? f.min / 100 : f.min) : -Infinity;
      const hi = f.max !== undefined ? (f.pct ? f.max / 100 : f.max) : Infinity;
      return v >= lo - 1e-9 && v <= hi + 1e-9 ? v : null;
    },
    set: (s, v, fromBenchmark = false) => ({ ...s, [f.section]: { ...s[f.section], [f.key]: v }, filled: { ...s.filled, [path]: fromBenchmark }, lp: null }),
  };
}

/** The script for the state as it stands: what to say and what to ask, in order. */
export function buildScript(state) {
  const m = PACK.model;
  const amended = PACK.conditions.filter((c) => c.status === "amended").length;
  const items = [
    { id: "intro", step: "documents", kind: "say",
      say: `Welcome. This is ${PACK.short}: ${PACK.issuer.replace(/ \(SECI\)/, "")} is buying ${say(PACK.tenderedMw)} megawatts of firm and dispatchable round-the-clock power from renewable projects. Amendment 3 renamed it from round-the-clock thermal mimic. I have read the RfS, Amendments 1, 2 and 3, the clarifications and the power sale agreement. ${amended} conditions were changed by the amendments. I will explain the key conditions, take your inputs one by one, size the plant and explain the results.` },
    { id: "c.size", step: "conditions", kind: "say",
      say: `What you bid: between ${m.minBidMw} and ${m.maxBidMw} megawatts of contracted capacity, one tariff fixed for the whole term. Amendment 1 lowered the minimum from 100 to 50 megawatts. Bidders within two percent of the lowest tariff win.` },
    { id: "c.dfr", step: "conditions", kind: "say",
      say: `The supply rule is per 15-minute block, not an annual average. Amendment 3 splits the day three ways. In every block of the peak hours you must supply at least ${say(m.peakFloor * 100)} percent of contracted capacity. In the solar hours, which the grid operator sets for your state, at least ${say(m.solarFloor * 100)} and at most ${say(m.solarMax * 100)} percent; above that the buyer may take the power at half the tariff, and only if it declines may you sell it elsewhere. In the remaining hours at least ${say(m.remainingFloor * 100)} percent.` },
    { id: "c.peak", step: "conditions", kind: "say",
      say: "The buyer picks 6 peak hours each day, a day ahead, anywhere between 6 in the evening and 10 the next morning. Since you only learn them the day before, the safe plan holds 90 percent through all sixteen of those hours." },
    { id: "c.penalty", step: "conditions", kind: "say",
      say: "A block below its floor is penalised at one and a half times the tariff on the energy short, settled every month. Missing the floors for two consecutive contract years is an event of default." },
    { id: "c.plant", step: "conditions", kind: "say",
      say: "Storage is mandatory and must charge from renewable power only. A battery must sit with solar or wind generation. Power above your contracted capacity can be sold to anyone, except the solar hours excess, which goes first to the buyer at half the tariff. Supply starts 24 months after the PPA, with financial closure six months before that." },
    { id: "c.money", step: "conditions", kind: "say",
      say: "The EMD, the performance guarantee and the net worth you need are all set on your installed solar megawatts, wind megawatts and storage megawatt hours, not on the contracted capacity. I will work them out once the plant is sized." },
    { id: "bidMw", step: "bid", kind: "number", target: "bidMw",
      ask: `How many megawatts will you bid? Between ${m.minBidMw} and ${m.maxBidMw}.`,
      current: (s) => (s.bid.baseMw ? `${say(s.bid.baseMw)} megawatts` : null), benchmark: 300, benchmarkText: "300 megawatts",
      read: (text) => { const n = parseNumber(text); return n !== null && n >= m.minBidMw && n <= m.maxBidMw ? n : null; },
      set: (s, v) => ({ ...s, bid: { ...s.bid, baseMw: v, greenshoe: false }, lp: null }) },
    { id: "peakPlan", step: "bid", kind: "choice", target: "peakPlan",
      ask: "Which Peak Hours shall I plan for? The six costliest market hours of each day, which a buyer would most likely pick; any six of the sixteen window hours, which is the safest; or the evening only, from 6 to midnight, which is cheapest but risky. Say costliest, any, or evening.",
      current: (s) => (s.seci.peakPlan === "evening" ? "evening only" : s.seci.peakPlan === "any" ? "any six hours" : "the six costliest hours"), benchmark: "price", benchmarkText: "the six costliest hours",
      read: (text) => { const t = String(text).toLowerCase(); return /cost|price|expens|market|iex|high/.test(t) ? "price" : /even|night|six to|18/.test(t) ? "evening" : /any|all|safe|sixteen|16|window/.test(t) ? "any" : null; },
      set: (s, v) => ({ ...s, seci: { ...s.seci, peakPlan: v }, lp: null }) },
    { id: "shortfall", step: "bid", kind: "choice", target: "shortfall",
      ask: "If a block falls short, shall the plant pay the penalty when that is cheaper, or must it meet every block? Say penalty, or every block.",
      current: (s) => (s.seci.shortfall === "hard" ? "meet every block" : "pay the penalty"), benchmark: "penalty", benchmarkText: "pay the penalty",
      read: (text) => (/meet|every|hard|never|no short/.test(String(text).toLowerCase()) ? "hard" : /penal|pay|cheap|allow/.test(String(text).toLowerCase()) ? "penalty" : null),
      set: (s, v) => ({ ...s, seci: { ...s.seci, shortfall: v }, lp: null }) },
    { id: "ppaDate", step: "bid", kind: "date", target: "ppaDate",
      ask: "When do you expect the PPA to be signed? Say a date like 7 June 2026, or skip.",
      current: (s) => (s.seci.ppaDate ? sayDate(s.seci.ppaDate) : null), benchmark: null,
      read: (text) => parseDate(text),
      set: (s, v) => ({ ...s, seci: { ...s.seci, ppaDate: v } }) },
    { id: "fill", step: "sources", kind: "yesno",
      ask: "Now your sources: solar, wind and a battery. Shall I fill every empty input with industry benchmarks first, so you only change what differs? Say yes or no.",
      onYes: (s, terms) => fillBenchmarks(s, terms) },
    { id: "market", step: "sources", kind: "yesno",
      ask: "Power above your contracted capacity may be sold to anyone. Shall the plant sell its surplus on the exchange at Green Day-Ahead Market prices? Say yes or no.",
      onYes: (s) => ({ ...s, market: { ...s.market, sell: true, source: "GDAM" }, filled: { ...s.filled, "market.sell": false }, lp: null }),
      onNo: (s) => ({ ...s, market: { ...s.market, sell: false }, filled: { ...s.filled, "market.sell": false }, lp: null }) },
  ];
  for (const id of ["solar", "wind", "bess"]) {
    if (!state.sources[id]) continue;
    for (const key of SOURCE_ASKS[id]) {
      const f = SOURCE_FIELDS[id].find((x) => x.key === key);
      if (f) items.push(sourceQuestion(id, f));
    }
  }
  for (const key of FIN_ASKS) {
    const f = FINANCE_FIELDS.find((x) => x.key === key);
    if (f) items.push(financeQuestion(f));
  }
  items.push(
    { id: "size", step: "size", kind: "yesno", ask: "That is everything. Shall I size the plant now? HiGHS checks every hour of the year against the floors; it takes a few minutes.", onYes: "size" },
    { id: "results", step: "size", kind: "results" },
    { id: "finance", step: "finance", kind: "finance" },
    { id: "forms", step: "forms", kind: "say", say: "Finally, the bid forms: your company's particulars, the tariff you quote, the substation and your net worth. I check each against the tender and give you the bid pack as a Word file. You can fill them on screen now." },
  );
  return items;
}

// ---------------------------------------------------------------- explaining results

/** The financial model of the sized plant, as on Financials. */
export function financeOf(state, terms) {
  if (!state.lp) return null;
  const { costs, fin, bess } = modelInputs(state, terms);
  const ops = opsFromLp(state.lp, fin, bess, dsmFor(state));
  return E.runFinancialModel(null, state.lp.sizes, { costs, fin, bess, dfrTarget: 0, tariffLocked: state.tariffLocked, ops, solveBy: "npv" });
}

/** The sizing, in words: the plant, the tariff, the floors and the money at stake. */
export function explainResults(state) {
  const lp = state.lp;
  if (!lp) return "The plant is not sized yet.";
  const z = lp.sizes;
  const mw = state.bid.baseMw;
  const y1 = lp.perYear?.[0] || {};
  const rules = Object.fromEntries((y1.rules || []).map((r) => [r.id, r]));
  const worstShort = Math.max(0, ...(lp.perYear || []).map((r) => r.blockShortfallMu || 0));
  const money = moneyAtStake(z);
  const hours = (r) => (r ? `${say(r.hoursMet * 100, 1)} percent of the hours` : "every hour");
  const parts = [
    `For ${say(mw)} megawatts, the least-tariff plant has ${say(z.solarMw)} megawatts AC of solar, that is ${say(z.solarMw * (state.src.solar.dcAc || 1))} megawatts peak of panels, ${say(z.windMw)} megawatts of wind, and a battery of ${say(z.bessMw)} megawatts and ${say(z.bessMwh)} megawatt hours.`,
    `That is ${say(z.solarMw / mw, 1)} times the contracted capacity in solar and ${say(z.windMw / mw, 1)} times in wind.`,
    `The sizing tariff is ${say(lp.tariff, 2)} rupees per unit.`,
    rules.solar || rules.remaining
      ? `In year 1 the plant meets the peak floor in ${hours(rules.peak)}, the Solar Hours floor in ${hours(rules.solar)} and the Remaining Hours floor in ${hours(rules.remaining)}.`
      : `In year 1 the plant meets the peak floor in ${hours(rules.peak)} and the off-peak floor in ${hours(rules.offpeak)}.`,
    worstShort > 0.005 ? `It falls ${say(worstShort, 1)} million units short of the floors in the worst modelled year, paid at one and a half times the tariff: cheaper than the plant that would cover it.` : "It meets every block's floor.",
    `On this plant the EMD is ${crore(money.emdRs)}, the performance guarantee ${crore(money.pbgRs)}, and you need a net worth of at least ${crore(money.netWorthRs)}.`,
  ];
  const dates = keyDates(state.seci?.ppaDate);
  if (dates) parts.push(`Supply must start by ${sayDate(dates.scsd)}, with financial closure by ${sayDate(dates.financialClosure)}.`);
  return parts.join(" ");
}

/** The financial model, in words. */
export function explainFinance(state, finance) {
  if (!finance) return "Size the plant first; then I can price the bid.";
  const t = finance.tariff;
  return [
    `The full 25-year financial model prices the bid at ${say(t, 3)} rupees per unit for your ${say(finance.equityIrr * 100, 1)} percent equity return.`,
    `The project costs ${say(finance.capex.total)} crore rupees, ${say(finance.debt)} crore of it debt.`,
    finance.minDscr !== null ? `The lowest debt service cover is ${say(finance.minDscr, 2)}, the average ${say(finance.avgDscr, 2)}.` : "",
    `Penalties come to ${say(finance.totals.penalty)} crore rupees over the term.`,
    `To quote, round it up: ${say(Math.ceil(t * 100) / 100, 2)} rupees per unit. The Excel model on this step has every number as a formula you can change.`,
  ].filter(Boolean).join(" ");
}

