// What the bid agent asks and says on the CfD bid tab: the key conditions in plain words, the
// inputs in the order of the steps and how each is asked (buildScript), and the sizing and the
// financial model put into words. Plain JavaScript with no browser APIs, used by agent.js and
// checked in Node by tools/check_cfd_agent.mjs. Numbers and dates are read with the SECI tab's
// readers (../seci/voice.js).
import { parseDate, parseNumber } from "../seci/voice.js";
import { BENCHMARKS, CHOICES, FIELDS, fillBenchmarks, fmtDate, keyDates, lcCr, rfsAmounts } from "./model.js";
import { RFS, TENDER } from "./terms.js";

export { parseDate, parseNumber };

const say = (v, d = 0) => (Number.isFinite(v) ? Number(v.toFixed(d)).toLocaleString("en-IN", { maximumFractionDigits: d }) : "not set");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const sayDate = (isoDate) => {
  if (!isoDate) return "not set";
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const crore = (cr) => `${say(cr, cr >= 100 ? 0 : 1)} crore rupees`;

// ---------------------------------------------------------------- the inputs as questions

/** The number inputs asked in the guided exercise, in order (the rest keep their benchmark). */
export const ASKED = {
  design: ["essMwhPerMw", "essMwPerMw", "rte", "essDegradation", "solarMw", "windMw", "reCodMonths", "availability", "solarCuf", "solarDegradation"],
  finance: ["essCrPerMwh", "solarCrPerMw", "evacuationCrPerMw", "essOmLakhPerMwh", "targetEquityIrr", "debtFraction", "interestRate", "tenorYears", "taxRate"],
};
const STEP_OF = { project: "design", resource: "design", sourcing: "bid", costs: "financeInputs", fin: "financeInputs" };
const unitWords = (f) => (f.pct ? "percent" : (f.unit || "")
  .replace("₹ cr/MWh", "crore rupees per megawatt hour").replace("₹ cr/MWac", "crore rupees per megawatt").replace("₹ cr/MW", "crore rupees per megawatt")
  .replace("₹ cr per contracted MW", "crore rupees per contracted megawatt").replace("₹ lakh/MWh/yr", "lakh rupees per megawatt hour a year")
  .replace("₹ lakh/MW/yr", "lakh rupees per megawatt a year").replace("₹ lakh per contracted MW/yr", "lakh rupees per contracted megawatt a year")
  .replace("₹/kWh", "rupees per unit").replace("MWh per contracted MW", "megawatt hours per contracted megawatt").replace("MW per contracted MW", "megawatts per contracted megawatt")
  .replace("months after the SCD", "months after the SCD").replace("MWac", "megawatts").replace("MW", "megawatts"));

/** One number input as a question. */
export function fieldQuestion(key) {
  const f = FIELDS.find((x) => x.key === key);
  if (!f) return null;
  const unit = unitWords(f);
  const bench = BENCHMARKS[key];
  const show = (v) => (v === null || v === undefined ? null : `${f.pct ? say(v * 100, 2) : say(v, 2)}${f.pct ? " percent" : unit ? ` ${unit}` : ""}`);
  return {
    id: key, step: STEP_OF[f.section] || "design", kind: "number", target: `inputs.${key}`,
    ask: `${f.label}${unit ? `, in ${unit}` : ""}.${f.hint ? ` ${f.hint}.` : ""}`,
    benchmark: bench ?? null, benchmarkText: bench === null || bench === undefined ? "none" : show(bench),
    current: (s) => show(s.inputs[key]),
    read: (text) => {
      const n = parseNumber(text);
      if (n === null) return null;
      const v = f.pct ? (n > 1 || /percent|%/.test(String(text)) ? n / 100 : n) : n;
      const lo = f.min !== undefined ? (f.pct ? f.min / 100 : f.min) : -Infinity;
      const hi = f.max !== undefined ? (f.pct ? f.max / 100 : f.max) : Infinity;
      return v >= lo - 1e-9 && v <= hi + 1e-9 ? v : null;
    },
    set: (s, v, fromBenchmark = false) => ({ ...s, inputs: { ...s.inputs, [key]: v }, filled: { ...s.filled, [key]: fromBenchmark } }),
  };
}

const YES = /^(yes|yeah|yep|sure|ok|okay|please|do|true|y)\b/i;
const NO = /^(no|nope|not|don'?t|false|n)\b/i;

/** A choice of CHOICES as a question (yes/no choices read yes or no). */
export function choiceQuestion(key) {
  const c = CHOICES[key];
  if (!c) return null;
  const yesNo = !c.options;
  const bench = BENCHMARKS[key];
  const label = (v) => (yesNo ? (v === true ? "yes" : v === false ? "no" : null) : c.options.find(([k]) => k === v)?.[1] || (v ?? null));
  return {
    id: key, step: "bid", kind: "choice", target: `inputs.${key}`,
    options: yesNo ? [["yes", "Yes"], ["no", "No"]] : c.options,
    ask: yesNo ? `${c.label}? ${c.hint ? `${c.hint}. ` : ""}Say yes or no.` : `${c.label}: ${c.options.map(([, l]) => l).join(", or ")}?${c.hint ? ` ${c.hint}.` : ""}`,
    benchmark: bench ?? null, benchmarkText: label(bench) || "none",
    current: (s) => label(s.inputs[key]),
    read: (text) => {
      const t = String(text || "").trim().toLowerCase();
      if (yesNo) return YES.test(t) ? true : NO.test(t) ? false : null;
      const hit = c.options.find(([k, l]) => t === k.toLowerCase() || t.includes(l.toLowerCase().split(" (")[0]) || t.includes(k.toLowerCase()));
      return hit ? hit[0] : null;
    },
    set: (s, v, fromBenchmark = false) => ({ ...s, inputs: { ...s.inputs, [key]: v }, filled: { ...s.filled, [key]: fromBenchmark } }),
  };
}

// ---------------------------------------------------------------- the script

/** The script for the state as it stands: what to say and what to ask, in order of the steps. */
export function buildScript(state) {
  const T = TENDER;
  const items = [
    { id: "intro", step: "explain", kind: "say",
      say: `Welcome. This is SECI's CfD-I tender: assured peak supply of ${say(T.totalMw * T.mwhPerMwDay)} megawatt hours a day, that is ${say(T.totalMw)} megawatts for 2 hours, from renewable projects with storage, sold through the power exchanges under a Contract for Difference. I have read the RfS of ${RFS.date}, the CfD Agreement and Amendments 1 to 4. I will explain how a CfD works, the key conditions, take your inputs one by one, size your own generation and explain the strike price.` },
    { id: "c.cfd", step: "explain", kind: "say",
      say: `In a CfD you sell your power on the exchange at whatever the market pays, and SECI's pool settles the difference to your strike price every 15 minutes. If the market pays less, the pool tops you up; if it pays more, you hand the excess to the pool. Since Amendment 3 you keep no gain and bear no loss: you earn the strike price on every unit supplied, for 15 years.` },
    { id: "c.supply", step: "conditions", kind: "say",
      say: `Every day you must sell ${say(T.mwhPerMwDay)} megawatt hours per contracted megawatt in any 2 hours you choose between 6 in the evening and midnight, a day ahead. Only volume that clears on the exchange counts. A week below 90 percent of the mandate is penalised at one and a half times the gap between the highest evening market price and your strike price.` },
    { id: "c.plant", step: "conditions", kind: "say",
      say: `Amendment 2 makes the battery mandatory: X megawatts and 2X megawatt hours for X megawatts contracted, owned by you and co-located with your generation. The battery must be running 15 months from the Effective Date; your own solar or wind by 36 months. Until then you may charge it with up to 75 percent green market power on top of the 25 percent allowed for the whole term; after month 36, up to 50 percent may come from your group companies' projects.` },
    { id: "c.bid", step: "conditions", kind: "say",
      say: `You bid one strike price in rupees per unit for ${say(T.bidMinMw)} to ${say(T.bidMaxMw)} megawatts, with no ceiling since Amendment 3. Bidders within 2 percent of the lowest price win, in an e-reverse auction; since Amendment 4 SECI may award less than the 500 megawatts if the discovered price asks more of the CfD corpus than it holds. Every day you declare your availability by 6 in the morning the day before, and SECI may set the blocks, price and quantum you offer. The EMD, the performance guarantee and the net worth you need are set on the installed solar, wind and battery capacities; I work them out from your design.` },
    { id: "contractedMw", step: "bid", kind: "number", target: "inputs.contractedMw",
      ask: `How many megawatts will you bid? Between ${say(T.bidMinMw)} and ${say(T.bidMaxMw)}, in whole megawatts.`,
      current: (s) => (s.inputs.contractedMw ? `${say(s.inputs.contractedMw)} megawatts` : null), benchmark: 100, benchmarkText: "100 megawatts",
      read: (text) => { const n = parseNumber(text); return n !== null && Number.isInteger(n) && n >= T.bidMinMw && n <= T.bidMaxMw ? n : null; },
      set: (s, v) => ({ ...s, inputs: { ...s.inputs, contractedMw: v } }) },
    { id: "effectiveDate", step: "bid", kind: "date", target: "inputs.effectiveDate",
      ask: "When do you expect the CfD Agreement's Effective Date, the 30th day after the Letter of Award? Say a date like 1 February 2027.",
      current: (s) => (s.inputs.effectiveDate ? sayDate(s.inputs.effectiveDate) : null), benchmark: BENCHMARKS.effectiveDate, benchmarkText: sayDate(BENCHMARKS.effectiveDate),
      read: (text) => parseDate(text),
      set: (s, v, fromBenchmark = false) => ({ ...s, inputs: { ...s.inputs, effectiveDate: v }, filled: { ...s.filled, effectiveDate: fromBenchmark } }) },
    choiceQuestion("sellMarket"),
    choiceQuestion("useMarket"),
    choiceQuestion("useGroup"),
    choiceQuestion("merchant"),
    choiceQuestion("afterTerm"),
    { id: "fill", step: "design", kind: "yesno",
      ask: "Now your design and your costs. Shall I fill every empty input with industry benchmarks first, so you only change what differs? Say yes or no.",
      onYes: (s) => fillBenchmarks(s) },
    ...ASKED.design.map(fieldQuestion),
    choiceQuestion("augmentation"),
    ...ASKED.finance.map(fieldQuestion),
    { id: "size", step: "size", kind: "yesno", ask: "That is everything. Shall I size your own generation now? It tries solar and wind sizes for the lowest strike price with every day's supply met; it takes a minute or three.", onYes: "size" },
    { id: "results", step: "size", kind: "results" },
    { id: "finance", step: "finance", kind: "finance" },
    { id: "forms", step: "forms", kind: "say", say: "Finally, the bid forms: your company's particulars, the strike price you quote, the substation and your net worth. I check each against the tender and you review the letters on screen." },
  ].filter(Boolean);
  return items;
}

/** The key conditions, as the guide explains them. */
export function tenderBrief(state) {
  return buildScript(state).filter((i) => i.kind === "say" && i.id.startsWith("c.")).map((i) => i.say);
}

// ---------------------------------------------------------------- explaining results

/** The sizing, in words: the plant, the strike price, the conditions, the money at stake. */
export function explainResults(model) {
  if (!model) return "The plant is not sized yet: fill in the inputs first.";
  const i = model.inputs;
  const X = i.contractedMw;
  const years = model.sim.years;
  const shortDays = years.reduce((a, y) => a + y.shortDays, 0);
  const penaltyWeeks = years.reduce((a, y) => a + y.weeks.filter((w) => w.beyondMwh > 1e-6).length, 0);
  const after = years.filter((y) => y.start >= model.sim.dates.extraUntil);
  const own = after.length ? Math.min(...after.map((y) => y.shareOwn)) : null;
  const a = rfsAmounts(i);
  const d = keyDates(i.effectiveDate);
  const parts = [
    `For ${say(X)} megawatts contracted, the plant has a battery of ${say(X * i.essMwPerMw)} megawatts and ${say(X * i.essMwhPerMw)} megawatt hours, ${say(i.solarMw || 0)} megawatts of solar${i.windMw ? ` and ${say(i.windMw)} megawatts of wind` : ""}.`,
    model.sp ? `The strike price that earns your ${say(i.targetEquityIrr * 100, 1)} percent equity return is ${say(model.sp, 2)} rupees per unit; to quote, round it up to ${say(model.bid, 2)}.` : `No strike price up to 40 rupees reaches the target return: ${model.reason || "check the inputs"}.`,
    shortDays ? `On ${say(shortDays)} days the battery cannot be charged within the sourcing limits: more own generation is needed.` : "Every day's supply is met within the sourcing limits.",
    penaltyWeeks ? `${say(penaltyWeeks)} weeks fall below 90 percent of the mandate and are penalised.` : "No week falls below 90 percent of the mandate.",
    own !== null ? `After month 36, at least ${say(own * 100, 0)} percent of the supply comes from your own generation.` : "",
    `On this plant the EMD is ${crore(a.emdCr)}, the performance guarantee ${crore(a.pbgCr)}, and you need a net worth of at least ${crore(a.netWorthCr)}.`,
    `The battery must run by ${fmtDate(d.scd)}, with financial closure by ${fmtDate(d.finClose)}; the term ends ${fmtDate(d.end)}.`,
  ];
  return parts.filter(Boolean).join(" ");
}

/** The financial model, in words (the CfD model's own, or the shared engine's when given). */
export function explainFinance(model, finance = null) {
  if (!model?.sp) return "Size the plant first; then I can price the bid.";
  const f = finance || model.fin;
  const sp = finance?.tariff ?? model.sp;
  const capex = finance ? finance.capex.total : model.fin.capex.total;
  const debt = finance ? finance.debt : model.fin.capex.total * model.inputs.debtFraction;
  return [
    `The ${finance ? "full" : ""} financial model over the ${TENDER.termYears}-year term prices the bid at ${say(sp, 3)} rupees per unit for a ${say((f.equityIrr ?? model.inputs.targetEquityIrr) * 100, 1)} percent equity return; the project return is ${say((f.projectIrr || 0) * 100, 1)} percent.`,
    `The project costs ${crore(capex)}, ${crore(debt)} of it debt.`,
    f.minDscr !== null && f.minDscr !== undefined ? `The lowest debt service cover is ${say(f.minDscr, 2)}${f.avgDscr ? `, the average ${say(f.avgDscr, 2)}` : ""}.` : "",
    `The Letter of Credit to SECI is ${crore(lcCr(model.inputs.contractedMw, sp))} at this strike price.`,
    `To quote, round up to the paisa: ${say(Math.ceil(sp * 100) / 100, 2)} rupees per unit. The Excel model on the Financial model step has every number as a formula.`,
  ].filter(Boolean).join(" ");
}

/** What a CfD is, in plain words, with this bid's numbers where it has them. */
export function explainCfd(model = null) {
  const sp = model?.sp ? say(model.sp, 2) : "your strike price";
  return [
    "A Contract for Difference is a price guarantee, not a power purchase agreement. You build the plant, sell its power yourself on the power exchange every evening, and get paid the market price.",
    `SECI's CfD pool then settles the difference to the strike price you bid${model?.sp ? `, ${sp} rupees per unit,` : ""} for every 15-minute block: when the market paid less, the pool pays you the gap; when it paid more, you pay the gap into the pool.`,
    "Since Amendment 3 the whole difference is settled, so you neither gain nor lose from the market price: you earn exactly the strike price on every unit you supply, up to 2 megawatt hours per contracted megawatt a day, for 15 years from your commissioning date.",
    "Your risks are the plant itself: building it on time, charging the battery within the sourcing limits, clearing your volume on the exchange, and the weekly penalty if you fall below 90 percent of the mandate.",
  ].join(" ");
}
