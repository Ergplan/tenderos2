// The tender's conditions on a sized CfD plant, as plain data: the Size step shows them, the agent
// reads them, the Bid review and the Node checks use them. Plain JavaScript (no React): the
// formatters are the same as ../rtc/ui's.
import { TENDER } from "./terms.js";
import { bessCapFactor, essRequiredPerMw, fmtDate, penaltyCr, socWindow } from "./model.js";

const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "–" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v)));
const pf = (v, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "–");

/**
 * The tender's conditions on the sized plant: { id, label, status: met | failed | info, detail,
 * cite }. Plain data, so the agent reads the same list the screen shows.
 */
/**
 * What a fading battery means, in the two measures the tab shows: the tender's 2 MWh per MW (the
 * battery condition) and the daily supply at the plant's availability (when days start to count
 * as short, which is later when the availability is under 100%).
 */
/**
 * Why days fall short, from the model's operating years: in a year the battery (faded, where it is
 * not augmented) cannot carry the daily supply every day is short for that reason; the other short
 * days are for lack of charging power within the sourcing limits. Returns the two counts, the first
 * such year, and the sentence the tab shows.
 */
export function shortfallCauses(model) {
  const i = model.inputs;
  const X = i.contractedMw;
  const meter = i.loss?.meter ?? 1;
  const need = X * TENDER.mwhPerMwDay * i.availability;
  const can = (y) => X * i.essMwhPerMw * socWindow(i) * bessCapFactor(i, y) * meter + (i.windMw > 0 ? Infinity : 0); // wind in the peak hours adds to it
  let fadeDays = 0;
  let limitDays = 0;
  let fadeFrom = null;
  for (const y of model.opYears || []) {
    if (!y.shortDays) continue;
    if (can(y.index) < need - 1e-6) { fadeDays += y.shortDays; if (fadeFrom === null) fadeFrom = y.index; } else limitDays += y.shortDays;
  }
  const n = (v) => Math.round(v).toLocaleString("en-IN");
  const parts = [];
  if (fadeDays) parts.push(`from year ${fadeFrom} the battery has faded below the daily supply (${n(fadeDays)} days; augment it, or add capacity year by year)`);
  if (limitDays) parts.push(`on ${n(limitDays)} days the sourcing limits leave too little charging power (more own RE)`);
  return { fadeDays, limitDays, fadeFrom, text: parts.join("; ") };
}

export function fadeNote(need, availability) {
  if (!need?.shortYear) return null;
  const pc = Number.isFinite(availability) && availability < 1 ? `${+(availability * 100).toFixed(1)}%` : null;
  const supply = need.supplyShortYear
    ? need.supplyShortYear === need.shortYear ? "; days fall short from that year" : `, and below the daily supply${pc ? ` at your ${pc} availability` : ""} from year ${need.supplyShortYear}, when days start to fall short`
    : pc ? `; at your ${pc} availability the daily supply is still met to the end of the term` : "";
  return `as the battery fades the usable energy falls below 2 MWh per MW from year ${need.shortYear}${supply}`;
}

export function sizingChecks(model, state = { inputs: model.inputs, losses: null }) {
  if (!model) return [];
  const i = model.inputs;
  const sim = model.sim;
  const years = sim.years;
  const X = i.contractedMw;
  const after = years.filter((y) => y.start >= sim.dates.extraUntil);
  // the shares are measured on the energy supplied, as Amendment-02 reads them; the model budgets
  // the purchases day by day on the planned supply (the mandate at the plant's availability), so
  // on a year with short days the ex-post share can sit a few tenths of a point over the budget:
  // half a point of tolerance separates that from a real breach
  const TOL = 0.005;
  const marketOk = years.every((y) => {
    const extraDays = y.marketCapMwh / (X * TENDER.mwhPerMwDay * i.availability) - TENDER.marketShare * y.days;
    const cap = y.days ? (TENDER.marketShare * y.days + Math.max(0, extraDays)) / y.days : TENDER.marketShare;
    return y.shareMarket <= cap + TOL;
  });
  const groupOk = years.every((y) => y.shareGroup <= (y.days ? y.groupCapMwh / (y.requiredMwh * i.availability) : TENDER.groupShare) + TOL);
  const shortDays = years.reduce((a, y) => a + y.shortDays, 0);
  const penaltyWeeks = years.reduce((a, y) => a + y.weeks.filter((w) => w.beyondMwh > 1e-6).length, 0);
  const supply = years.reduce((a, y) => a + y.deliveredMwh, 0) / Math.max(1e-9, years.reduce((a, y) => a + y.requiredMwh, 0));
  const win = socWindow(i);
  const usable = i.essMwhPerMw * win;
  const need = essRequiredPerMw(state);
  const essOk = i.essMwhPerMw >= need.energy - 1e-9 && i.essMwPerMw >= need.power - 1e-9;
  const essNote = [
    win < 1 ? `${nf(X * usable)} MWh usable within the state-of-charge window` : null,
    need.meter < 1 ? `${((1 - need.meter) * 100).toFixed(1)}% lost from the battery to the meter` : null,
    essOk ? null : `${nf(need.energy, 2)} MWh and ${nf(need.power, 2)} MW per MW nameplate needed`,
    need.shortYear ? fadeNote(need, i.availability) : i.augmentation === "annual" ? "augmentation keeps the usable energy every year" : null,
  ].filter(Boolean).join("; ");
  const pay = i.shortfallPolicy === "pay";
  const penaltyTerm = model.sp ? years.reduce((a, y) => a + penaltyCr(y, model.sp), 0) : null;
  const reOk = i.reCodMonths <= TENDER.reCodMonths - TENDER.essScdMonths;
  return [
    { id: "capacity", label: "Contracted capacity", status: Number.isInteger(X) && X >= TENDER.bidMinMw && X <= TENDER.bidMaxMw ? "met" : "failed", detail: `${nf(X)} MW; ${TENDER.bidMinMw} to ${TENDER.bidMaxMw} MW in whole MW`, cite: "capacityBid" },
    { id: "ess", label: "Battery X MW / 2X MWh usable at the meter", status: essOk ? "met" : need.shortYear ? "info" : "failed", detail: `${nf(X * i.essMwPerMw)} MW / ${nf(X * i.essMwhPerMw)} MWh nameplate for ${nf(X)} MW${essNote ? `; ${essNote}` : ""}`, cite: "ess" },
    { id: "reCod", label: "RE online by month 36", status: reOk ? "met" : "failed", detail: `${nf(i.reCodMonths)} months after the SCD (${fmtDate(sim.dates.reCod)}); at most ${TENDER.reCodMonths - TENDER.essScdMonths}`, cite: "reCod" },
    { id: "market", label: "Green market within 25% (+75% until month 36)", status: marketOk ? "met" : "failed", detail: after.length ? `highest after month 36: ${pf(Math.max(...after.map((y) => y.shareMarket)), 1)}` : "no Contract Year after month 36", cite: "market25" },
    { id: "group", label: "Group RE within 50% after month 36", status: groupOk ? "met" : "failed", detail: after.length ? `highest: ${pf(Math.max(...after.map((y) => y.shareGroup)), 1)}` : "not used", cite: "group50" },
    { id: "daily", label: "2 MWh/MW every day", status: shortDays ? (pay ? "info" : "failed") : "met", detail: shortDays ? (pay ? `${nf(shortDays)} days short, ₹${nf(penaltyTerm ?? 0, 1)} cr of penalty over the term, allowed by your policy (pay the penalty); ${pf(supply, 1)} of the mandate supplied` : `${nf(shortDays)} days short (${pf(supply, 1)} of the mandate supplied): more own RE or charging power within the limits, or more battery or augmentation if the battery has faded; or set the policy to pay the penalty`) : `every day; ${pf(supply, 1)} of the mandate supplied`, cite: "mandate" },
    { id: "weekly", label: "Weekly shortfall within 10%", status: penaltyWeeks ? "info" : "met", detail: penaltyWeeks ? `${nf(penaltyWeeks)} weeks penalised at 1.5 × (highest evening MCP − SP)` : "no week below 90% of 14 MWh/MW", cite: "tolerance" },
  ];
}
