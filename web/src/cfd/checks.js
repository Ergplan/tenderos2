// The tender's conditions on a sized CfD plant, as plain data: the Size step shows them, the agent
// reads them, the Bid review and the Node checks use them. Plain JavaScript (no React): the
// formatters are the same as ../rtc/ui's.
import { TENDER } from "./terms.js";
import { essRequiredPerMw, fmtDate, penaltyCr, socWindow } from "./model.js";

const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "–" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v)));
const pf = (v, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "–");

/**
 * The tender's conditions on the sized plant: { id, label, status: met | failed | info, detail,
 * cite }. Plain data, so the agent reads the same list the screen shows.
 */
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
    need.shortYear ? `without augmentation the usable energy falls below the need from year ${need.shortYear}` : i.augmentation === "annual" ? "augmentation keeps the usable energy every year" : null,
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
