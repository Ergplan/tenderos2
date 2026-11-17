// What the bid agent asks and says on the SECI-FDRE-X bid tab: the key conditions in plain words
// (the PPA and its tariff, the four hours the Buying Entity chooses, the 5% bought power, the
// monthly penalty, the connectivity, the bid), the inputs in the order of the steps and how each is asked
// (buildScript), and the sizing and the financial model put into words. Forked from the CfD tab's
// web/src/cfd/voice.js (export names kept: explainCfd now explains the FDRE-X product). Plain
// JavaScript with no browser APIs, used by agent.js. Numbers and dates are read with the SECI
// tab's readers (../seci/voice.js); the tender's numbers come from ./tender.js and the date of the
// RfS from ./pack.js.
import { parseDate, parseNumber } from "../seci/voice.js";
import { BENCHMARKS, CHOICES, FIELDS, fillBenchmarks, fmtDate, keyDates, psmDiscount, rfsAmounts } from "./model.js";
import { shortfallCauses, sizingChecks } from "./checks.js";
import { PACK } from "./pack.js";
import { TENDER } from "./tender.js";

export { parseDate, parseNumber };

const say = (v, d = 0) => (Number.isFinite(v) ? Number(v.toFixed(d)).toLocaleString("en-IN", { maximumFractionDigits: d }) : "not set");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const sayDate = (isoDate) => {
  if (!isoDate) return "not set";
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const crore = (cr) => `${say(cr, cr >= 100 ? 0 : 1)} crore rupees`;
const pctOf = (v, d = 0) => say(v * 100, d); // a share as percent
const paise = (rs) => say(rs * 100, 0); // rupees per unit as paise

// ---------------------------------------------------------------- the inputs as questions

/** The number inputs asked in the guided exercise, in order (the rest keep their benchmark). */
export const ASKED = {
  design: ["essMwhPerMw", "essMwPerMw", "rte", "essDegradation", "solarMw", "windMw", "availability", "solarCuf", "solarDegradation"],
  finance: ["essCrPerMwh", "solarCrPerMw", "evacuationCrPerMw", "essOmLakhPerMwh", "targetEquityIrr", "debtFraction", "interestRate", "tenorYears", "taxRate"],
};
const STEP_OF = { project: "design", resource: "design", sourcing: "bid", costs: "financeInputs", fin: "financeInputs" };
const unitWords = (f) => (f.pct ? "percent" : (f.unit || "")
  .replace("₹ cr/MWh", "crore rupees per megawatt hour").replace("₹ cr/MWac", "crore rupees per megawatt").replace("₹ cr/MW", "crore rupees per megawatt")
  .replace("₹ cr per contracted MW", "crore rupees per contracted megawatt").replace("₹ lakh/MWh/yr", "lakh rupees per megawatt hour a year")
  .replace("₹ lakh/MW/yr", "lakh rupees per megawatt a year").replace("₹ lakh per contracted MW/yr", "lakh rupees per contracted megawatt a year")
  .replace("₹/kWh", "rupees per unit").replace("MWh per contracted MW", "megawatt hours per contracted megawatt").replace("MW per contracted MW", "megawatts per contracted megawatt")
  .replace("MWac", "megawatts").replace("MW", "megawatts"));

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
      say: `Welcome. This is SECI's FDRE-X tender: assured peak supply of ${say(T.totalMw * T.mwhPerMwDay)} megawatt hours a day, that is ${say(T.totalMw)} megawatts for ${say(T.peakHours)} hours, from renewable projects with energy storage, sold to SECI under a ${say(T.termYears)}-year Power Purchase Agreement at one fixed tariff. I have read the RfS of ${sayDate(PACK.rfsDate)}, the standard PPA and PSA and Amendment 1. I will explain how the supply and the payment work, the key conditions, take your inputs one by one, size your own generation and explain the tariff.` },
    { id: "c.ppa", step: "explain", kind: "say",
      say: `You sign a Power Purchase Agreement with SECI, which sells the power on to the Buying Entities. You are paid the tariff you bid on every unit you supply in the Peak Hours, fixed for ${say(T.termYears)} years from the Scheduled Commencement of Supply Date. Exchange prices do not change what you are paid. If you opt for cover under SECI's Payment Security Mechanism, you give a discount of ${paise(T.psmChargeRsPerKwh)} paise per unit on every bill for the whole term.` },
    { id: "c.supply", step: "conditions", kind: "say",
      say: `Every day you must supply ${say(T.mwhPerMwDay)} megawatt hours per contracted megawatt, ${say(T.maxMwhPerMwHour)} megawatt hour per megawatt in any hour, in the ${say(T.peakHours)} hours the Buying Entity chooses from the non-solar hours between the evening and the next morning. It sends its schedule by 6 in the morning; if none comes, the previous day's hours apply. The supply is reconciled every billing month: a shortfall beyond ${pctOf(T.shortfallTolerance)} percent of the month's requirement is penalised at ${say(T.penaltyMultiple, 1)} times your tariff.` },
    { id: "c.plant", step: "conditions", kind: "say",
      say: `All the power must be renewable. Up to ${pctOf(T.marketShare)} percent of a year's energy may come from the green market or bilateral agreements, supplied directly or through the storage; beyond that the storage may not be charged from the grid. The RfS sets no minimum storage size; because the buyer names its hours each morning, this model sizes the battery to carry the whole ${say(T.mwhPerMwDay)} megawatt hours per megawatt. The grid connectivity the tender asks you to apply for is for the non-solar hours. The whole project must start supply ${say(T.essScdMonths)} months from the PPA's Effective Date, and a delay of up to ${say(T.delayMonthsMax)} months costs the performance guarantee pro rata. Outside the Peak Hours you may sell from the storage to others or on an exchange, once the PPA supply is met.` },
    { id: "c.bid", step: "conditions", kind: "say",
      say: `You bid one tariff in rupees per unit, to two decimals, for ${say(T.bidMinMw)} to ${say(T.bidMaxMw)} megawatts in whole megawatts. The RfS sets no ceiling tariff. After an e-reverse auction, the bidders within ${pctOf(T.eraRange)} percent of the lowest tariff win; the capacity awarded is at most ${pctOf(T.eraAwardShare)} percent of what the qualified bidders offered, and never more than ${say(T.totalMw)} megawatts. The EMD, the performance guarantee and the net worth you need are set on the installed solar, wind and storage capacities; I work them out from your design.` },
    { id: "contractedMw", step: "bid", kind: "number", target: "inputs.contractedMw",
      ask: `How many megawatts will you bid? Between ${say(T.bidMinMw)} and ${say(T.bidMaxMw)}, in whole megawatts.`,
      current: (s) => (s.inputs.contractedMw ? `${say(s.inputs.contractedMw)} megawatts` : null), benchmark: 100, benchmarkText: "100 megawatts",
      read: (text) => { const n = parseNumber(text); return n !== null && Number.isInteger(n) && n >= T.bidMinMw && n <= T.bidMaxMw ? n : null; },
      set: (s, v) => ({ ...s, inputs: { ...s.inputs, contractedMw: v } }) },
    { id: "effectiveDate", step: "bid", kind: "date", target: "inputs.effectiveDate",
      ask: `When do you expect the PPA's Effective Date, ${say(T.loaToEdDays)} days after SECI's intimation to sign it? The supply starts ${say(T.essScdMonths)} months later. Say a date like 1 June 2027.`,
      current: (s) => (s.inputs.effectiveDate ? sayDate(s.inputs.effectiveDate) : null), benchmark: BENCHMARKS.effectiveDate, benchmarkText: sayDate(BENCHMARKS.effectiveDate),
      read: (text) => parseDate(text),
      set: (s, v, fromBenchmark = false) => ({ ...s, inputs: { ...s.inputs, effectiveDate: v }, filled: { ...s.filled, effectiveDate: fromBenchmark } }) },
    choiceQuestion("sellMarket"),
    choiceQuestion("useMarket"),
    choiceQuestion("merchant"),
    // the connectivity in the solar hours, in plain words (the choice's own hint is written for the screen)
    { ...choiceQuestion("dayInjection"),
      ask: `Will you hold grid connectivity in the solar hours as well? The tender asks only for connectivity in the non-solar hours. Without it nothing can be injected between 6 in the morning and ${say(T.peakStart - 12)} in the evening, so the day's surplus solar is curtailed. With it the surplus is sold. Say yes or no.` },
    choiceQuestion("psm"),
    choiceQuestion("afterTerm"),
    { id: "fill", step: "design", kind: "yesno",
      ask: "Now your design and your costs. Shall I fill every empty input with industry benchmarks first, so you only change what differs? Say yes or no.",
      onYes: (s) => fillBenchmarks(s) },
    ...ASKED.design.map(fieldQuestion),
    choiceQuestion("augmentation"),
    ...ASKED.finance.map(fieldQuestion),
    { id: "size", step: "size", kind: "yesno", ask: "That is everything. Shall I size your own generation now? It tries solar and wind sizes for the lowest tariff with every day's supply met; it takes a minute or three.", onYes: "size" },
    { id: "results", step: "size", kind: "results" },
    { id: "finance", step: "finance", kind: "finance" },
    { id: "forms", step: "forms", kind: "say", say: "Finally, the bid forms: your company's particulars, the tariff you quote, the substation and your net worth. I check each against the tender and you review the letters on screen." },
  ].filter(Boolean);
  return items;
}

/** The key conditions, as the guide explains them. */
export function tenderBrief(state) {
  return buildScript(state).filter((i) => i.kind === "say" && i.id.startsWith("c.")).map((i) => i.say);
}

// ---------------------------------------------------------------- explaining results

/** The sizing, in words: the plant, the tariff, the conditions, the money at stake. */
export function explainResults(model) {
  if (!model) return "The plant is not sized yet: fill in the inputs first.";
  const i = model.inputs;
  const X = i.contractedMw;
  const years = model.sim.years;
  const shortDays = years.reduce((a, y) => a + y.shortDays, 0);
  const penaltyMonths = years.reduce((a, y) => a + y.months.filter((w) => w.beyondMwh > 1e-6).length, 0);
  // bought power against the limit, with the verdict the Size step shows (./checks.js)
  const bought = i.useMarket ? Math.max(0, ...years.map((y) => y.shareMarket)) : null;
  const boughtOk = sizingChecks(model).find((c) => c.id === "market")?.status === "met";
  const why = shortDays ? shortfallCauses(model) : null;
  const a = rfsAmounts(i);
  const d = keyDates(i.effectiveDate);
  const tol = pctOf(1 - TENDER.shortfallTolerance);
  // surplus own RE the plant cannot inject in the day: million units a year, over the operating years
  const ops = model.sim.opYears;
  const curtailed = ops.reduce((t, y) => t + y.curtailedMwh, 0) / Math.max(1, ops.length) / 1000;
  const parts = [
    `For ${say(X)} megawatts contracted, the plant has a battery of ${say(X * i.essMwPerMw)} megawatts and ${say(X * ((i.essMwhPerMw || 0) + (i.extraEssMwhPerMw || 0)))} megawatt hours, ${say(i.solarMw || 0)} megawatts of solar${i.windMw ? ` and ${say(i.windMw)} megawatts of wind` : ""}.`,
    model.sp ? `The tariff that earns your ${say(i.targetEquityIrr * 100, 1)} percent equity return is ${say(model.sp, 2)} rupees per unit; to quote, round it up to ${say(model.bid, 2)}.` : `No tariff up to 40 rupees reaches the target return: ${model.reason || "check the inputs"}.`,
    shortDays
      ? [
        `On ${say(shortDays)} days over the term the supply falls short of the ${say(TENDER.mwhPerMwDay)} megawatt hours per megawatt.`,
        why.fadeDays ? `On ${say(why.fadeDays)} of them, from year ${say(why.fadeFrom)}, the battery has faded below the daily supply: augment it or add capacity.` : "",
        why.limitDays ? `On ${say(why.limitDays)} of them your own generation and the ${pctOf(TENDER.marketShare)} percent bought power leave too little to charge the battery: more own generation is needed.` : "",
      ].filter(Boolean).join(" ")
      : "Every day's supply is met within the sourcing limit.",
    penaltyMonths ? `${say(penaltyMonths)} billing months fall below ${tol} percent of their requirement and are penalised at ${say(TENDER.penaltyMultiple, 1)} times the tariff.` : `No billing month falls below ${tol} percent of its requirement.`,
    bought === null ? "" : boughtOk
      ? `Bought green power stays within the ${pctOf(TENDER.marketShare)} percent of a year's energy the tender allows.`
      : `Bought green power reaches ${say(bought * 100, 1)} percent of a year's supply, above the ${pctOf(TENDER.marketShare)} percent the tender allows.`,
    i.merchant && !i.dayInjection && curtailed >= 0.05 ? `With connectivity in the non-solar hours only, about ${say(curtailed, curtailed >= 10 ? 0 : 1)} million units a year of surplus generation are curtailed in the day; connectivity in the solar hours would let you sell them.` : "",
    `On this plant the EMD is ${crore(a.emdCr)}, the performance guarantee ${crore(a.pbgCr)}, and you need a net worth of at least ${crore(a.netWorthCr)}.`,
    `Supply must start by ${fmtDate(d.scd)}, with financial closure by ${fmtDate(d.finClose)}; the PPA ends ${fmtDate(d.end)}.`,
  ];
  return parts.filter(Boolean).join(" ");
}

/** The financial model, in words (the bid model's own, or the shared engine's when given). */
export function explainFinance(model, finance = null) {
  if (!model?.sp) return "Size the plant first; then I can price the bid.";
  const f = finance || model.fin;
  const sp = finance?.tariff ?? model.sp;
  const capex = finance ? finance.capex.total : model.fin.capex.total;
  const debt = finance ? finance.debt : model.fin.capex.total * model.inputs.debtFraction;
  const psm = psmDiscount(model.inputs);
  return [
    `The ${finance ? "full " : ""}financial model over the ${TENDER.termYears}-year term prices the bid at ${say(sp, 3)} rupees per unit for a ${say((f.equityIrr ?? model.inputs.targetEquityIrr) * 100, 1)} percent equity return; the project return is ${say((f.projectIrr || 0) * 100, 1)} percent.`,
    `The project costs ${crore(capex)}, ${crore(debt)} of it debt.`,
    f.minDscr !== null && f.minDscr !== undefined ? `The lowest debt service cover is ${say(f.minDscr, 2)}${f.avgDscr ? `, the average ${say(f.avgDscr, 2)}` : ""}.` : "",
    psm > 0
      ? `The bid opts for cover under SECI's Payment Security Mechanism, so every bill is paid ${paise(psm)} paise per unit less than the tariff; the model counts that discount as a cost.`
      : "The bid does not opt for cover under SECI's Payment Security Mechanism, so no discount comes off the bills.",
    `To quote, round up to the paisa: ${say(Math.ceil(sp * 100) / 100, 2)} rupees per unit. The Excel model on the Financial model step has every number as a formula.`,
  ].filter(Boolean).join(" ");
}

/**
 * What SECI-FDRE-X asks and how the bidder is paid, in plain words, with this bid's tariff where
 * it has one. (The name is the CfD tab's, kept for the files that import it: this tender has a
 * PPA and a tariff, not a Contract for Difference.)
 */
export function explainCfd(model = null) {
  const T = TENDER;
  return [
    `SECI-FDRE-X buys assured peak power from renewable projects with energy storage. You sign a ${say(T.termYears)}-year Power Purchase Agreement with SECI, which sells the power on to the Buying Entities.`,
    `Each day the Buying Entity names ${say(T.peakHours)} hours out of the non-solar hours, from the evening to the next morning, and you supply ${say(T.mwhPerMwDay)} megawatt hours per contracted megawatt in them, ${say(T.maxMwhPerMwHour)} megawatt hour per megawatt in any hour.`,
    `You are paid the tariff you bid${model?.sp ? `, ${say(model.sp, 2)} rupees per unit on this plant,` : ""} on every unit supplied in those hours, fixed for the whole term. Exchange prices do not change what you are paid.`,
    `All the energy must be renewable; up to ${pctOf(T.marketShare)} percent of a year's energy may be bought from the green market or under bilateral agreements. For cover under SECI's Payment Security Mechanism you give a discount of ${paise(T.psmChargeRsPerKwh)} paise per unit on every bill.`,
    `Your risks are the plant itself: starting supply on time, having the storage charged for whichever hours the buyer names, and the penalty of ${say(T.penaltyMultiple, 1)} times the tariff when a billing month falls short by more than ${pctOf(T.shortfallTolerance)} percent.`,
  ].join(" ");
}
