// The Bid review: why a CfD bid is not optimal, as findings a reviewer can act on. Rule-based,
// from the bid state, the model (the day-by-day operation) and the full financial model; plain
// JavaScript so the Size step, the agent, the workbook and the Node checks read the same list.
//
// Each finding: { id, severity: "block" | "warn" | "note", title, detail, step, cite? }.
//   block  the bid fails the tender or cannot win as it stands
//   warn   the price carries a cost the bidder can take out
//   note   worth knowing before bid day; not a defect by itself
import { BENCHMARKS, FIELDS, essRequiredPerMw, poolFlows, runModel, socWindow } from "./model.js";
import { TENDER } from "./terms.js";
import { sizingChecks } from "./checks.js";
import { SECI_RESULTS, tariffRange } from "../market/seed.js";

const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "–" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v)));
const pf = (v, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "–");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Capital recovery factor: the annual payment that repays 1 over n years at rate r. */
const crf = (r, n) => (r > 0 ? (r * (1 + r) ** n) / ((1 + r) ** n - 1) : 1 / n);

/** The latest FDRE peak-power award (the closest product to the CfD) and its tariff range. */
export function peakAward() {
  const peak = SECI_RESULTS.filter((r) => r.product === "FDRE peak power");
  const latest = peak[0] || null;
  if (!latest) return null;
  const [lo, hi] = tariffRange(latest);
  return lo === null ? null : { tender: latest.tender.replace(/\(.*\)/, "").trim(), date: latest.auctionDate, lo, hi };
}

// cost-type inputs: above the benchmark they raise the price; return-type inputs raise it too
const RAISES_WHEN_ABOVE = new Set(["essCrPerMwh", "solarCrPerMw", "windCrPerMw", "evacuationCrPerMw", "preopPct", "essOmLakhPerMwh", "solarOmLakhPerMw", "windOmLakhPerMw", "otherFixedLakhPerMw", "insurancePct", "omEscalation", "marketCharges", "groupPrice", "groupCharges", "pxFee", "lcCostPct", "pbgCostPct", "targetEquityIrr", "interestRate", "essDegradation", "solarDegradation", "windDegradation"]);
// resource-type inputs: below the benchmark they raise the price
const RAISES_WHEN_BELOW = new Set(["solarCuf", "windCuf", "rte", "availability", "recPrice", "tenorYears", "debtFraction"]);

/**
 * Review a bid. `state` and `model` as the Size step has them (model.finance when priced through
 * the full model); `finance` the full financial model's result when available; `prices` the IEX
 * price year, needed only for the own-solar test (skipped without it).
 */
export function reviewBid({ state, model, finance = null, prices = null }) {
  const out = [];
  if (!model || !model.sim) return { findings: out, summary: "The bid is not modelled yet: complete the inputs." };
  const i = model.inputs;
  const X = i.contractedMw;
  const sim = model.sim;
  const years = sim.years;
  const ops = sim.opYears;
  const fin = finance || model.finance || null;
  const sp = fin?.tariff ?? model.sp ?? null;
  const add = (f) => out.push(f);

  // ---- 1. the tender's conditions
  for (const c of sizingChecks(model, state)) {
    if (c.status === "failed") add({ id: `tender-${c.id}`, severity: "block", title: `Tender condition not met: ${c.label}`, detail: c.detail, step: c.id === "capacity" || c.id === "reCod" ? "bid" : c.id === "ess" ? "design" : "size", cite: c.cite });
    else if (c.status === "info") add({ id: `tender-${c.id}`, severity: "note", title: `Tender condition to watch: ${c.label}`, detail: c.detail, step: "size", cite: c.cite });
  }

  // ---- 2. can it win: the price against what SECI has paid for peak power
  const award = peakAward();
  if (isNum(sp) && award) {
    const ratio = sp / award.hi;
    if (ratio > 1.5) add({ id: "price-market", severity: "block", title: `A strike price of ₹${nf(sp, 2)}/kWh is ${nf(ratio, 1)}× the highest FDRE peak-power award`, detail: `${award.tender} awarded ₹${nf(award.lo, 2)}–${nf(award.hi, 2)}/kWh for 4 hours of assured evening supply over 25 years. The CfD asks 2 hours for 15 years and pays through the market, so a quote far above those awards will not clear the auction. Find what carries the price in the findings below, then size again.`, step: "reference" });
    else if (sp > award.hi) add({ id: "price-market", severity: "warn", title: `₹${nf(sp, 2)}/kWh is above the highest FDRE peak-power award (₹${nf(award.hi, 2)})`, detail: `${award.tender}: ₹${nf(award.lo, 2)}–${nf(award.hi, 2)}/kWh for 4 hours a day over 25 years. A 2-hour CfD can sit above it, but the gap is what the auction will test.`, step: "reference" });
  }

  // ---- 2b. the award: what the CfD Pool pays at this price against its corpus (Amendment-04, RfS 42.2.b)
  if (isNum(sp) && years.length) {
    const flows = poolFlows(sim, sp);
    const payYear = flows.reduce((a, f) => a + Math.max(0, -f.netCr), 0) / flows.length; // ₹ cr a year the Pool pays this plant, net
    const perMw = payYear / X;
    const all = perMw * TENDER.totalMw;
    if (all > TENDER.poolCr) add({ id: "corpus-cap", severity: all > 3 * TENDER.poolCr ? "warn" : "note", title: `At ₹${nf(sp, 2)} the Pool pays about ₹${nf(payYear, 0)} cr a year for your ${nf(X)} MW; the full ${nf(TENDER.totalMw)} MW would need ₹${nf(all, 0)} cr a year against a ₹${nf(TENDER.poolCr)} cr corpus`, detail: `Amendment-04 (RfS 42.2.b) lets SECI restrict the capacity awarded to what the CfD corpus can carry at the discovered tariff. The Pool's pay-out is the strike price less the evening market price on every kWh settled (₹${nf(flows.reduce((a, f) => a + f.mcpAvg, 0) / flows.length, 2)}/kWh average MCP in your two best evening hours at the price year); the lower the strike price, the more of the 500 MW SECI can afford to award. A bid near the market price needs little from the Pool and is the one most likely to be awarded in full.`, step: "reference", cite: "corpusCap" });
  }

  // ---- 3. the plant: own RE not at its best
  const bought = ops.reduce((a, o) => a + o.marketCostCr + o.groupCostCr, 0);
  let moreSolarHelps = null; // null: not tested (no prices)
  if (prices && isNum(sp) && isNum(model.screening?.sp ?? model.sp)) {
    const step = Math.max(5, Math.round(0.1 * X));
    const priceAt = (solarMw) => {
      const m2 = runModel({ ...state, inputs: { ...state.inputs, solarMw }, filled: { ...(state.filled || {}), solarMw: false } }, prices);
      return m2 ? m2.sp : null;
    };
    const base = isNum(model.screening?.sp) ? model.screening.sp : model.sp; // the fast screening price: the same scale as priceAt
    const up = priceAt((i.solarMw || 0) + step);
    const down = i.solarMw >= step ? priceAt(i.solarMw - step) : null;
    moreSolarHelps = isNum(up) && up < base - 0.01;
    const best = [["more", up, (i.solarMw || 0) + step], ["less", down, (i.solarMw || 0) - step]].filter(([, p]) => isNum(p) && p < base - 0.01).sort((a, b) => a[1] - b[1])[0];
    if (best) add({ id: "solar-not-optimised", severity: "warn", title: `Own solar is not at its best: ${best[2]} MWac ${best[0] === "more" ? "instead of" : "rather than"} ${nf(i.solarMw || 0)} lowers the screening price by ₹${nf(base - best[1], 3)}/kWh`, detail: `The own-RE size was ${state.filled?.solarMw ? "a first guess" : "typed or left from an earlier run"}, not the optimiser's for these inputs. Run Optimise own RE on the Size step: it tries every size and keeps the one with the least strike price with every day met.${bought > 0 ? ` Charging bought over the term: ₹${nf(bought, 0)} cr.` : ""}`, step: "size" });
  }
  // little own RE is a finding only when more of it would lower the price: with cheap group RE or
  // dear solar, buying the charging power is the right call and the review says so instead
  if ((i.solarMw || 0) < 0.2 * X && (i.windMw || 0) === 0 && bought > 0) {
    if (moreSolarHelps !== false) add({ id: "little-own-re", severity: "warn", title: `Little own RE (${nf(i.solarMw || 0)} MWac for ${nf(X)} MW): nearly all charging power is bought`, detail: `₹${nf(bought, 0)} cr of charging power over the term at the green-market and group prices. Own solar charges the battery at what the plant costs you (about ₹2.2/kWh on the benchmarks) and sells its surplus; the optimiser finds the size where that beats buying.`, step: "size" });
    else add({ id: "bought-charging-is-right", severity: "note", title: `Buying the charging power is the right call here: more own solar would raise the price`, detail: `₹${nf(bought, 0)} cr of charging power over the term, mostly ${i.useGroup ? `group RE at ₹${nf(i.groupPrice, 2)}/kWh` : "green-market power"}; own solar at ₹${nf(i.solarCrPerMw, 2)} cr/MWac costs more per unit charged. The price is carried by the battery and the financing, not the sourcing.`, step: "size" });
  }

  // ---- what carries the price: an approximate split of the strike price by cost
  if (isNum(sp) && fin?.capex?.byComponent && Array.isArray(fin.rows) && fin.rows.length) {
    const n = fin.rows.length;
    const mwh = fin.rows.reduce((a, r) => a + (r.deliveredMu || 0) * 1000, 0) / n;
    if (mwh > 0) {
      const cr2kwh = (cr) => (cr * 1e4) / mwh; // ₹ cr a year over MWh a year → ₹/kWh
      const k = crf(i.discountRate || 0.1, TENDER.termYears);
      const bc = fin.capex.byComponent;
      const bess = cr2kwh(((bc.bess || 0) + (bc.pcs || 0)) * k);
      const re = cr2kwh(((bc.solar || 0) + (bc.wind || 0)) * k);
      const rest = cr2kwh(((bc.evac || 0) + (bc.other || 0) + (bc.preop || 0) + (bc.idc || 0)) * k);
      const mean = (key) => fin.rows.reduce((a, r) => a + (r[key] || 0), 0) / n;
      const opex = cr2kwh(mean("om") + mean("insurance") + mean("other") + mean("lcCost"));
      const charging = cr2kwh(mean("charging") + mean("pxFees"));
      const aug = cr2kwh(mean("augCapex"));
      const income = cr2kwh(mean("surplusRevenue"));
      const residual = sp - (bess + re + rest + opex + charging + aug - income);
      const parts = [["the battery's capex", bess], ["own RE capex", re], ["transmission, SECI's charges and pre-operative cost", rest], ["O&M, insurance, fixed costs and the LC", opex], ["charging power and exchange fees", charging], ["augmentation", aug]].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
      add({ id: "price-drivers", severity: "note", title: `What carries the ₹${nf(sp, 2)}: ${parts[0][0]} ₹${nf(parts[0][1], 2)}/kWh${parts[1] ? `, then ${parts[1][0]} ₹${nf(parts[1][1], 2)}` : ""}`, detail: `Capex annualised at ${pf(i.discountRate || 0.1, 0)} over ${TENDER.termYears} years, costs averaged over the term, all over the energy supplied (${nf(mwh / 1000, 1)} GWh a year): ${parts.map(([l, v]) => `${l} ₹${nf(v, 2)}`).join("; ")}; less surplus sales and RECs ₹${nf(income, 2)}; the rest, ₹${nf(residual, 2)}, is tax and the return above the discount rate (the ${pf(i.targetEquityIrr, 1)} equity target on ${pf(1 - (i.debtFraction || 0), 0)} equity at ${pf(i.interestRate, 2)} debt). The biggest line is where the price moves most.`, step: "whatif" });
    }
  }

  // ---- 4. the extra battery for evening sale
  if (isNum(i.extraEssMwhPerMw) && i.extraEssMwhPerMw > 0) {
    const mwh = X * i.extraEssMwhPerMw;
    const capexCr = mwh * (i.essCrPerMwh || 0);
    const annualCr = capexCr * crf(i.discountRate || 0.1, i.essLifeYears || 15) + (mwh * (i.essOmLakhPerMwh || 0)) / 100;
    const n = Math.max(1, ops.length);
    const earnsCr = ops.reduce((a, o) => a + (o.extraRevCr || 0) - (o.extraMarketCostCr || 0), 0) / n;
    if (earnsCr < annualCr) add({ id: "extra-battery", severity: "warn", title: `The extra battery for evening sale (${nf(i.extraEssMwhPerMw, 2)} MWh/MW, ${nf(mwh)} MWh) costs ₹${nf(annualCr, 1)} cr a year and earns ₹${nf(earnsCr, 1)} cr`, detail: `₹${nf(capexCr, 0)} cr of capex annualised at ${pf(i.discountRate || 0.1, 0)} over ${i.essLifeYears || 15} years plus O&M, against its evening sales net of charging (average over the term: ${nf(ops.reduce((a, o) => a + (o.extraSoldMwh || 0), 0) / n / 1000, 1)} GWh a year). It sells only once the day's commitment is met and within what the green-market limit leaves, which here is little. Set it to 0 unless the evening prices justify it.`, step: "bid" });
  }

  // ---- 5. the battery: nameplate, window, fade
  const need = essRequiredPerMw(state);
  const win = socWindow(i);
  if (win < 0.6) add({ id: "soc-window", severity: "note", title: `A narrow state-of-charge window (${pf(win, 0)}) makes the nameplate ${nf(need.energy, 2)} MWh per MW for the tender's 2 MWh usable`, detail: `Minimum ${pf(i.essSocMin || 0, 1)} to maximum ${pf(isNum(i.essSocMax) ? i.essSocMax : 1, 1)}. Suppliers quote usable energy at the rated window (typically 10–90% or wider), so check whether the 2 MWh per MW is already usable; if it is, leave the window empty and the nameplate falls to ${nf(2 / (need.meter || 1) <= 2 ? 2 : Math.ceil((2 / (need.meter || 1)) * 20) / 20, 2)} MWh per MW.`, step: "design" });
  if (isNum(i.essMwhPerMw) && i.essMwhPerMw > need.energy + 1e-9) add({ id: "battery-oversized", severity: "warn", title: `Battery energy ${nf(i.essMwhPerMw, 2)} MWh per MW is above the ${nf(need.energy, 2)} the tender needs`, detail: `${nf(X * (i.essMwhPerMw - need.energy))} MWh beyond the need at ₹${nf(i.essCrPerMwh || 0, 2)} cr/MWh is ₹${nf(X * (i.essMwhPerMw - need.energy) * (i.essCrPerMwh || 0), 0)} cr of capex that earns nothing on a normal day.`, step: "bid" });
  const last = ops[ops.length - 1];
  const faded = last && last.supplyShare < 0.9 && last.shortDays > 0;
  if (faded) {
    const firstShort = ops.find((o) => o.shortDays > 0 && o.reDays >= 0);
    add({ id: "battery-fade", severity: "warn", title: `The battery fades below the need: the last year supplies ${pf(last.supplyShare, 1)} of the mandate`, detail: `Augmentation is "${state.bess?.augmentation || i.augmentation}"${state.bess?.augmentationYears?.length ? ` in year${state.bess.augmentationYears.length > 1 ? "s" : ""} ${state.bess.augmentationYears.join(", ")}` : ""} with ${pf(i.essDegradation || 0, 1)} a year of fade; from operating year ${firstShort?.index ?? "?"} the usable energy no longer covers 2 MWh per MW. Augment every year, add years to the schedule, or size the nameplate for the last year. At a strike price above the evening market the weekly penalty is nil, but the energy not supplied earns nothing and the price must rise to pay the plant.`, step: "financeInputs" });
  }

  // ---- 6. charging within the limits
  const after = years.filter((y) => y.start >= sim.dates.extraUntil && y.reDays > 0);
  if (after.length) {
    const hi = Math.max(...after.map((y) => y.shareMarket));
    if (hi > 0.9 * TENDER.marketShare && hi <= TENDER.marketShare + 0.005) add({ id: "market-near-cap", severity: "note", title: `Green-market charging reaches ${pf(hi, 1)} of the supply after month 36 (limit ${pf(TENDER.marketShare, 0)})`, detail: "Close to the cap, a dear day or a thin GDAM leaves the battery short. More own RE, or group RE within its 50% limit, gives room.", step: "size", cite: "market25" });
  }

  // ---- 7. inputs far from the benchmarks
  const far = [];
  for (const f of FIELDS) {
    const b = BENCHMARKS[f.key];
    const v = i[f.key];
    if (!isNum(b) || !isNum(v) || b === 0) continue;
    if (state.filled?.[f.key] && Math.abs(v - b) < 1e-12) continue; // the benchmark itself
    const rel = (v - b) / Math.abs(b);
    if (Math.abs(rel) < 0.15) continue; // within 15% of the benchmark: not worth a line
    const raises = (rel > 0 && RAISES_WHEN_ABOVE.has(f.key)) || (rel < 0 && RAISES_WHEN_BELOW.has(f.key));
    far.push({ key: f.key, label: f.label, v, b, rel, raises, pct: Boolean(f.pct), unit: f.unit });
  }
  const fmtV = (x, pct) => (pct ? pf(x, 1) : nf(x, Math.abs(x) < 10 ? 2 : 0));
  const raising = far.filter((x) => x.raises);
  if (raising.length) add({ id: "inputs-above-benchmark", severity: "warn", title: `${raising.length} input${raising.length > 1 ? "s" : ""} far from the benchmark in the direction that raises the price`, detail: raising.map((x) => `${x.label}: ${fmtV(x.v, x.pct)}${x.pct ? "" : ` ${x.unit}`} against ${fmtV(x.b, x.pct)} (${x.rel > 0 ? "+" : "−"}${nf(Math.abs(x.rel) * 100, 0)}%)`).join("; ") + ". Each is yours to set; the What-if step says what each is worth on the price. Keep the ones you have evidence for and freeze them there.", step: "whatif" });
  const easing = far.filter((x) => !x.raises);
  if (easing.length) add({ id: "inputs-below-benchmark", severity: "note", title: `${easing.length} input${easing.length > 1 ? "s" : ""} far from the benchmark in the direction that lowers the price`, detail: easing.map((x) => `${x.label}: ${fmtV(x.v, x.pct)}${x.pct ? "" : ` ${x.unit}`} against ${fmtV(x.b, x.pct)}`).join("; ") + ". A lender or SECI's evaluators will ask for the evidence behind these.", step: "whatif" });

  // ---- 8. financing
  const fe = fin?.engine?.fin || null;
  if (fe?.refiYear === 1) add({ id: "refi-year-1", severity: "note", title: "The debt is refinanced at the end of year 1", detail: `A refinancing a year after the COD pays the fee (${pf(fe.refiFeePct || 0, 2)} of the balance) for the rate to move from ${pf(fe.interestRate, 2)} to ${pf(fe.refiRate, 2)}; lenders rarely offer it before the plant has a year of operating record. Years 3 to 5 are the usual window.`, step: "financeInputs" });
  if (isNum(fin?.minDscr) && isNum(fe?.lenderMinDscr) && fin.minDscr < fe.lenderMinDscr - 1e-6) add({ id: "dscr-below-lender", severity: "block", title: `Minimum DSCR ${nf(fin.minDscr, 2)}× is below the lender's ${nf(fe.lenderMinDscr, 2)}×`, detail: `The debt as structured does not finance in its weakest year. Sculpt the repayment to the lender's DSCR (Finance inputs › Repayment), take less debt or a longer tenor, or accept a higher price; the lender's minimum is ${nf(fe.lenderMinDscr, 2)}× and the model's lowest year gives ${nf(fin.minDscr, 2)}×.`, step: "financeInputs" });
  if (isNum(i.targetEquityIrr) && i.targetEquityIrr > 0.15) add({ id: "high-equity-target", severity: "note", title: `A ${pf(i.targetEquityIrr, 1)} equity IRR target is high for a contracted supply`, detail: `SECI's recent awards price at 13–15% equity returns; every point of equity IRR is on the strike price. The benchmark is ${pf(BENCHMARKS.targetEquityIrr, 0)}.`, step: "financeInputs" });

  // ---- 9. the policy and the shortfall
  const shortDays = years.reduce((a, y) => a + y.shortDays, 0);
  if (shortDays && i.shortfallPolicy === "pay") add({ id: "pay-policy", severity: "note", title: `${nf(shortDays)} days short under the "pay the penalty" policy`, detail: "The price carries the lost revenue and the weekly penalty of those days. Check that the weekly tolerance (10%) and SECI's view of a plant that plans to fall short are acceptable to you.", step: "design", cite: "tolerance" });

  const blocks = out.filter((f) => f.severity === "block").length;
  const warns = out.filter((f) => f.severity === "warn").length;
  const summary = !out.length
    ? "No finding: the bid meets the tender, the plant is at its best for these inputs, and the inputs sit near the benchmarks."
    : `${blocks ? `${blocks} blocking finding${blocks > 1 ? "s" : ""}` : "nothing blocking"}, ${warns} that carr${warns === 1 ? "ies" : "y"} cost, ${out.length - blocks - warns} to note.`;
  return { findings: out, summary, counts: { block: blocks, warn: warns, note: out.length - blocks - warns } };
}
