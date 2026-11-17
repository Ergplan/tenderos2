// The Bid review of the SECI-FDRE-X tab: why a bid for the assured peak supply is not optimal, as
// findings a reviewer can act on. Rule-based, from the bid state, the model (the day-by-day
// operation) and the full financial model; plain JavaScript so the Size step, the agent, the
// workbook and the Node checks read the same list. Forked from the CfD-I tab's review
// (web/src/cfd/review.js): the findings that belonged to the CfD (the CfD Pool's corpus, group
// RE, the first 36 months' market share, RECs) are gone; in their place are this tender's own:
// the 5% limit on bought power, the monthly shortfall penalty at 1.5 x the tariff, the surplus
// RE (curtailed in the solar hours unless the bid holds connectivity for them, sold otherwise,
// with SECI's first right to it), the buyer choosing the four hours, and the PSM discount.
//
// Each finding: { id, severity: "block" | "warn" | "note", title, detail, step, cite? }.
//   block  the bid fails the tender or cannot win as it stands
//   warn   the price carries a cost the bidder can take out
//   note   worth knowing before bid day; not a defect by itself
import { BENCHMARKS, FIELDS, augmentationText, bessCapFactor, capShortfall, essRequiredPerMw, penaltyCr, penaltyMwh, psmDiscount, runModel, socWindow, socWindowWarning } from "./model.js";
import { TENDER } from "./tender.js";
import { sizingChecks } from "./checks.js";
import { SECI_RESULTS, tariffRange } from "../market/seed.js";

const nf = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "–" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v)));
const pf = (v, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "–");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Capital recovery factor: the annual payment that repays 1 over n years at rate r. */
const crf = (r, n) => (r > 0 ? (r * (1 + r) ** n) / ((1 + r) ** n - 1) : 1 / n);

/** The latest FDRE peak-power award (the same product: 4 hours of assured peak supply a day for 25 years) and its tariff range. */
export function peakAward() {
  const peak = SECI_RESULTS.filter((r) => r.product === "FDRE peak power");
  const latest = peak[0] || null;
  if (!latest) return null;
  const [lo, hi] = tariffRange(latest);
  const code = latest.tender.match(/\(([^()]*)\)\s*$/); // the tender's short name, in the last brackets
  const what = latest.tender.replace(/\(.*\)/, "").trim();
  return lo === null ? null : { tender: code ? `${code[1]} (${what})` : what, date: latest.auctionDate, lo, hi };
}

// cost-type inputs: above the benchmark they raise the price; return-type inputs raise it too
const RAISES_WHEN_ABOVE = new Set(["essCrPerMwh", "solarCrPerMw", "windCrPerMw", "evacuationCrPerMw", "preopPct", "essOmLakhPerMwh", "solarOmLakhPerMw", "windOmLakhPerMw", "otherFixedLakhPerMw", "insurancePct", "omEscalation", "marketCharges", "pxFee", "pbgCostPct", "targetEquityIrr", "interestRate", "essDegradation", "solarDegradation", "windDegradation"]);
// resource-type inputs: below the benchmark they raise the price
const RAISES_WHEN_BELOW = new Set(["solarCuf", "windCuf", "rte", "availability", "tenorYears", "debtFraction"]);

/**
 * Review a bid. `state` and `model` as the Size step has them (model.finance when priced through
 * the full model); `finance` the full financial model's result when available; `prices` the IEX
 * price year, needed only for the own-solar test and the other connectivity case (skipped without it).
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
  const n = Math.max(1, ops.length); // operating years, for averages a year
  const screenSp = isNum(model.screening?.sp) ? model.screening.sp : model.sp; // the fast screening tariff: the scale of the re-runs below

  // ---- 1. the tender's conditions
  for (const c of sizingChecks(model, state)) {
    if (c.status === "failed") add({ id: `tender-${c.id}`, severity: "block", title: `Tender condition not met: ${c.label}`, detail: c.detail, step: c.id === "capacity" ? "bid" : c.id === "ess" ? "design" : "size", cite: c.cite });
    else if (c.status === "info") add({ id: `tender-${c.id}`, severity: "note", title: `Tender condition to watch: ${c.label}`, detail: c.detail, step: "size", cite: c.cite });
  }

  // ---- 2. can it win: the tariff against what SECI has awarded for the same peak supply
  const award = peakAward();
  if (isNum(sp) && award) {
    const ratio = sp / award.hi;
    const range = `Only the bids within ${pf(TENDER.eraRange, 0)} of the lowest tariff are awarded here.`;
    if (ratio > 1.5) add({ id: "price-market", severity: "block", title: `A tariff of ₹${nf(sp, 2)}/kWh is ${nf(ratio, 1)}× the highest FDRE peak-power award`, detail: `${award.tender} awarded ₹${nf(award.lo, 2)}–${nf(award.hi, 2)}/kWh for ${TENDER.peakHours} hours of assured peak supply a day over ${TENDER.termYears} years, the supply this tender asks. ${range} A quote far above those awards will not clear the auction. Find what carries the price in the findings below, then size again.`, step: "reference", cite: "range" });
    else if (sp > award.hi) add({ id: "price-market", severity: "warn", title: `₹${nf(sp, 2)}/kWh is above the highest FDRE peak-power award (₹${nf(award.hi, 2)})`, detail: `${award.tender}: ₹${nf(award.lo, 2)}–${nf(award.hi, 2)}/kWh for the same ${TENDER.peakHours} hours a day over ${TENDER.termYears} years. Costs move from one auction to the next, but the gap is what this auction will test. ${range}`, step: "reference", cite: "range" });
  }

  // ---- 3. the plant: own RE not at its best
  const bought = ops.reduce((a, o) => a + o.marketCostCr, 0);
  if (prices && isNum(sp) && isNum(screenSp)) {
    const step = Math.max(5, Math.round(0.1 * X));
    // as the optimiser judges a size: under "meet every day" one that leaves more energy short is
    // not better, whatever its price (inside the monthly tolerance a short day costs no penalty)
    const shortNow = capShortfall(sim);
    const priceAt = (solarMw) => {
      const m2 = runModel({ ...state, inputs: { ...state.inputs, solarMw }, filled: { ...(state.filled || {}), solarMw: false } }, prices);
      if (!m2) return null;
      return i.shortfallPolicy !== "pay" && capShortfall(m2.sim) > Math.max(shortNow, 1e-3 * X) ? null : m2.sp;
    };
    const base = screenSp; // the same scale as priceAt
    const up = priceAt((i.solarMw || 0) + step);
    const down = i.solarMw >= step ? priceAt(i.solarMw - step) : null;
    const best = [["more", up, (i.solarMw || 0) + step], ["less", down, (i.solarMw || 0) - step]].filter(([, p]) => isNum(p) && p < base - 0.01).sort((a, b) => a[1] - b[1])[0];
    if (best) add({ id: "solar-not-optimised", severity: "warn", title: `Own solar is not at its best: ${best[2]} MWac ${best[0] === "more" ? "instead of" : "rather than"} ${nf(i.solarMw || 0)} lowers the screening tariff by ₹${nf(base - best[1], 3)}/kWh`, detail: `The own-RE size was ${state.filled?.solarMw ? "a first guess" : "typed or left from an earlier run"}, not the optimiser's for these inputs. Run Optimise own RE on the Size step: it tries every size and keeps the one with the least tariff with every day met.${bought > 0 ? ` Charging bought over the term: ₹${nf(bought, 0)} cr.` : ""}`, step: "size" });
  }
  // why days fall short, by operating year: in a year the battery alone (faded, where it is not
  // augmented) cannot carry the daily supply, its fade is the cause (wind in the buyer's hours, if
  // any, covers part of it on some days); in the other years it is charging power, which bought
  // power cannot make up beyond 5% of a year's energy
  const win = socWindow(i);
  const dailyNeed = X * TENDER.mwhPerMwDay * i.availability;
  const batteryCan = (year) => X * i.essMwhPerMw * win * bessCapFactor(i, year) * (i.loss?.meter ?? 1);
  const fadeYears = ops.filter((o) => o.shortDays > 0 && batteryCan(o.index) < dailyNeed - 1e-6);
  const causes = { fadeDays: fadeYears.reduce((a, o) => a + o.shortDays, 0), fadeFrom: fadeYears[0]?.index ?? null };
  causes.limitDays = ops.reduce((a, o) => a + o.shortDays, 0) - causes.fadeDays;
  causes.text = [
    causes.fadeDays ? `from year ${causes.fadeFrom} the battery has faded below the daily supply (${nf(causes.fadeDays)} days)` : null,
    causes.limitDays ? `on ${nf(causes.limitDays)} days own RE and the ${pf(TENDER.marketShare, 0)} bought-power limit leave too little charging power` : null,
  ].filter(Boolean).join("; ");
  if (causes.limitDays) add({ id: "little-own-re", severity: "warn", title: `Own RE (${nf(i.solarMw || 0)} MWac solar${i.windMw ? `, ${nf(i.windMw)} MW wind` : ""} for ${nf(X)} MW) leaves the battery short of charge on ${nf(causes.limitDays)} days`, detail: `On those days own RE and the bought power the limit allows do not fill the battery for the ${TENDER.peakHours} hours. Buying more is not open: at most ${pf(TENDER.marketShare, 0)} of a year's energy may come from the green market or a bilateral agreement, and the battery may not be charged from the grid beyond that. More own solar or wind is the remedy; Optimise own RE on the Size step finds the size.`, step: "size", cite: "marketShare" });

  // ---- 4. the 5% limit on bought power: the Contract Years that use (nearly) all of it
  const atLimit = years.filter((y) => y.marketCapMwh > 0 && y.shareMarket * y.deliveredMwh >= 0.9 * y.marketCapMwh);
  if (atLimit.length) {
    const hi = Math.max(...atLimit.map((y) => y.shareMarket));
    const shortThere = atLimit.reduce((a, y) => a + y.shortDays, 0);
    add({ id: "market-limit", severity: shortThere ? "warn" : "note", title: `Bought power reaches the ${pf(TENDER.marketShare, 0)} limit in ${atLimit.length} of ${years.length} Contract Years (highest ${pf(hi, 1)} of the energy supplied)`, detail: `Up to ${pf(TENDER.marketShare, 0)} of a year's energy may come from the green market or a bilateral agreement, counted on the energy discharged. Energy from bought power beyond the limit earns no tariff and does not count as supply, and its cost stays with you. ${shortThere ? `In those years ${nf(shortThere)} days fall short: once the limit is used, only own RE can charge the battery.` : "No day falls short for it, but a year that uses the whole limit has nothing in hand for a poor solar month or a thin GDAM."} More own RE gives room.`, step: "size", cite: "marketShare" });
  }

  // ---- 5. the monthly shortfall penalty: 1.5 x the tariff on a billing month's energy short beyond 10%
  const shortDays = years.reduce((a, y) => a + y.shortDays, 0);
  const penalMonths = years.reduce((a, y) => a + y.months.filter((w) => w.beyondMwh > 1e-6).length, 0);
  const penalMwh = years.reduce((a, y) => a + penaltyMwh(y), 0);
  const penalCr = isNum(sp) ? years.reduce((a, y) => a + penaltyCr(y, sp), 0) : null;
  if (penalMonths) {
    const months = years.reduce((a, y) => a + y.months.length, 0);
    const lostCr = isNum(sp) ? (sp - psmDiscount(i)) * penalMwh * 1e-4 : null;
    add({ id: "monthly-penalty", severity: "warn", title: `${nf(penalMonths)} of ${nf(months)} billing months fall short by more than ${pf(TENDER.shortfallTolerance, 0)}${penalCr !== null ? `: ₹${nf(penalCr, 1)} cr of penalty over the term` : ""}`, detail: `The energy short beyond ${pf(TENDER.shortfallTolerance, 0)} of those months' requirement is ${nf(penalMwh / 1000, 1)} GWh${penalCr !== null ? `; at ${nf(TENDER.penaltyMultiple, 1)} × the tariff of ₹${nf(sp, 2)}/kWh that is ₹${nf(penalCr, 1)} cr, on top of the ₹${nf(lostCr, 1)} cr of tariff that energy does not earn` : ""}. The penalty moves with the tariff: a higher quote to pay for it raises it again. ${causes.text ? `Why days fall short: ${causes.text}.` : ""}`, step: "size", cite: "shortfall" });
  } else if (shortDays && i.shortfallPolicy !== "pay") {
    add({ id: "monthly-penalty", severity: "note", title: `${nf(shortDays)} days fall short, each billing month within the ${pf(TENDER.shortfallTolerance, 0)} allowed: no penalty`, detail: `The shortfall is reconciled by billing month and penalised only beyond ${pf(TENDER.shortfallTolerance, 0)} of the month's requirement, at ${nf(TENDER.penaltyMultiple, 1)} × the tariff. Within it there is no penalty, but the energy not supplied earns no tariff.`, step: "size", cite: "tolerance" });
  }

  // ---- 6. surplus RE. The tender asks for connectivity with non-solar-hour access, so without
  // more (inputs.dayInjection) nothing is injected from 06:00 to 18:00 and the day's surplus is
  // curtailed; with it the surplus is sold at exchange prices. SECI has the first right to it.
  const gen = ops.reduce((a, o) => a + o.solarMwh + o.windMwh, 0);
  const soldOf = (rows) => rows.reduce((a, o) => a + o.merchantMwh - (o.extraSoldMwh || 0), 0);
  const soldCrOf = (rows) => rows.reduce((a, o) => a + o.merchantRevCr - (o.extraRevCr || 0), 0);
  const soldMwh = soldOf(ops);
  const soldCr = soldCrOf(ops);
  const curtailed = ops.reduce((a, o) => a + o.curtailedMwh, 0);
  const dayOn = Boolean(i.dayInjection);
  const seci = "Excess generation is SECI's to buy first, at the tariff, if the Buying Entity consents; it may be sold to anyone else only when SECI refuses it.";
  const perYear = (mwh) => nf(mwh / n / 1000, 1); // GWh a year
  // the same bid with the other connectivity, for what the solar hours are worth (screening tariff)
  let other = null;
  if (prices && gen > 0 && i.merchant && isNum(screenSp)) {
    const m2 = runModel({ ...state, inputs: { ...state.inputs, dayInjection: !dayOn } }, prices);
    if (m2 && isNum(m2.sp)) other = { sp: m2.sp, soldMwh: soldOf(m2.sim.opYears), soldCr: soldCrOf(m2.sim.opYears) };
  }
  if (gen > 0 && !dayOn && curtailed > 0.01 * gen) {
    const worth = other ? ` for about ₹${nf((other.soldCr - soldCr) / n, 1)} cr a year, and the screening tariff would fall by ₹${nf(screenSp - other.sp, 2)}/kWh` : "";
    add({ id: "no-day-connectivity", severity: curtailed >= 0.1 * gen ? "warn" : "note", title: `${pf(curtailed / gen, 0)} of the own generation is curtailed (${perYear(curtailed)} GWh a year): the bid has no connectivity in the solar hours`, detail: `Own RE makes ${perYear(gen)} GWh a year. The tender asks for connectivity with non-solar-hour access, and this bid holds no more: nothing is injected from 06:00 to 18:00, so the solar the battery does not need is lost${soldMwh > 0.001 * gen ? ` (${perYear(soldMwh)} GWh a year is sold outside those hours)` : ""}.${i.merchant ? "" : " Selling surplus RE is also switched off in the Bid inputs."} Two things would turn it into revenue. Connectivity that covers the solar hours: the surplus would sell in the GDAM${worth}. Or SECI buying it as excess generation at the tariff, if the Buying Entity consents${isNum(sp) ? ` (up to ₹${nf((sp * curtailed * 1e-4) / n, 1)} cr a year at ₹${nf(sp, 2)}/kWh)` : ""}; that energy too has to reach the grid in the solar hours. Until one of them is secured the tariff carries the plant behind the curtailed energy.`, step: "bid", cite: "connectivityApplied" });
  }
  if (gen > 0 && dayOn) {
    const lose = other ? ` Without it ${perYear(soldMwh - other.soldMwh)} GWh a year is curtailed, ₹${nf((soldCr - other.soldCr) / n, 1)} cr a year of sales go and the screening tariff rises by ₹${nf(other.sp - screenSp, 2)}/kWh.` : " Without it the day's surplus is curtailed and the tariff must rise.";
    add({ id: "day-connectivity", severity: "note", title: "The bid relies on connectivity in the solar hours, which the tender does not ask for", detail: `The RfS asks bidders to apply for connectivity with non-solar-hour access. This bid injects from 06:00 to 18:00 as well${i.merchant && soldMwh > 0 ? `: ${perYear(soldMwh)} GWh a year of surplus RE is sold for ₹${nf(soldCr / n, 1)} cr` : ""}. Confirm that your connectivity grant covers injection in the solar hours.${lose}`, step: "bid", cite: "connectivityApplied" });
  }
  // what is sold (with solar-hour connectivity the day's surplus; without it only what is spare outside 06:00 to 18:00)
  if (gen > 0 && (dayOn ? soldMwh + curtailed > 0.01 * gen : soldMwh > 0.01 * gen)) {
    const lost = dayOn && curtailed > 0.3 * gen;
    add({ id: "surplus-re", severity: lost ? "warn" : "note", title: lost
      ? `${pf(curtailed / gen, 0)} of the own generation is curtailed (${perYear(curtailed)} GWh a year)`
      : `${pf((soldMwh + (dayOn ? curtailed : 0)) / gen, 0)} of the own generation is ${dayOn ? `surplus: ${perYear(soldMwh)} GWh a year sold, ${perYear(curtailed)} GWh curtailed` : `sold in the market outside the solar hours (${perYear(soldMwh)} GWh a year)`}`,
    detail: `Own RE makes ${perYear(gen)} GWh a year. ${i.merchant
      ? `What the battery does not need is sold in the GDAM within the ${nf(X)} MW connection on days the supply is met${dayOn ? "" : ", outside 06:00 to 18:00 only"} (${perYear(soldMwh)} GWh a year${soldMwh > 0 ? ` for ₹${nf(soldCr / n, 1)} cr, ₹${nf((soldCr * 1e4) / soldMwh, 2)}/kWh on average` : ""}); the rest is curtailed (${perYear(curtailed)} GWh a year). ${seci} The model prices what is sold at the exchange and does not count on SECI${isNum(sp) && soldMwh > 0 ? `; at the tariff the energy sold would earn ₹${nf((sp * soldMwh * 1e-4) / n, 1)} cr a year` : ""}. Sale to others while the day's supply is short is penalised at ${nf(TENDER.thirdPartyPenaltyMultiple, 1)} × the day's highest exchange rate, so the model sells only on days the supply is met.`
      : `What the battery does not need is curtailed (${perYear(curtailed)} GWh a year): selling surplus RE is switched off in the Bid inputs, so the bid earns nothing on it. ${seci}`}${lost ? " Capacity whose output is curtailed is capex that earns nothing: less own RE, or more of it sold, lowers the tariff." : ""}`, step: i.merchant ? "size" : "bid", cite: "excess" });
  }

  // ---- 7. the buyer chooses the hours: the model's evening assumption
  {
    const windDirect = ops.reduce((a, o) => a + o.windDirectMwh, 0);
    const extraSold = ops.reduce((a, o) => a + (o.extraSoldMwh || 0), 0);
    const hh = (h) => `${String(h).padStart(2, "0")}:00`;
    const depends = [
      windDirect > 0 ? `the wind supplied directly in those hours (${nf(windDirect / n / 1000, 1)} GWh a year): other hours have other wind` : null,
      extraSold > 0 ? `the extra battery's sale, which the model places in the other evening hours (${nf(extraSold / n / 1000, 1)} GWh a year)` : null,
    ].filter(Boolean);
    add({ id: "buyer-hours", severity: "note", title: `The Buying Entity chooses the ${TENDER.peakHours} hours each day; the model takes the ${TENDER.peakHours} dearest hours of ${hh(TENDER.peakStart)} to ${hh(TENDER.peakEnd)}`, detail: `The hours are named by 06:00 each day from the Peak Hours (the non-solar hours from the evening to the next morning), at least 1 hour of them continuous; with no schedule the previous day's applies. The model reads the dearest ${TENDER.peakHours} evening hours of the ${i.sellMarket || "exchange"} prices as the buyer's choice. A choice in the morning needs the same stored energy, held overnight. ${depends.length ? `In this bid the choice moves ${depends.join(", and ")}.` : "This bid supplies the hours from the battery alone, so its energy and tariff do not depend on which hours are named."} The battery must hold the whole ${TENDER.mwhPerMwDay} MWh per MW before the first hour the buyer may name.`, step: "bid", cite: "fourHours" });
  }

  // ---- 8. the Payment Security Mechanism: the discount taken or not
  {
    const disc = psmDiscount(i);
    const mwh = ops.reduce((a, o) => a + o.deliveredMwh, 0) / n;
    if (disc > 0) add({ id: "psm", severity: "note", title: `Cover under the Payment Security Mechanism is taken: ₹${nf(disc, 2)}/kWh off every bill${isNum(sp) ? `, so ₹${nf(sp - disc, 2)}/kWh is received on a tariff of ₹${nf(sp, 2)}` : ""}`, detail: `The discount is about ₹${nf(disc * mwh * 1e-4, 2)} cr a year on ${nf(mwh / 1000, 1)} GWh supplied, for the whole term; the tariff solved already carries it. The choice is made in the Covering Letter and cannot be changed after: without it the project is not covered by the mechanism for the whole term.`, step: "bid", cite: "psm" });
    else add({ id: "psm", severity: "note", title: "Cover under the Payment Security Mechanism is not taken", detail: `The bid keeps the full tariff and gives up the mechanism's cover for the whole term. Taking it costs a discount of ₹${nf(TENDER.psmChargeRsPerKwh, 2)}/kWh on every bill (about ₹${nf(TENDER.psmChargeRsPerKwh * mwh * 1e-4, 2)} cr a year here). The choice is made in the Covering Letter and cannot be changed after; a lender may ask for the cover.`, step: "bid", cite: "psm" });
  }

  // ---- what carries the price: an approximate split of the tariff by cost
  if (isNum(sp) && fin?.capex?.byComponent && Array.isArray(fin.rows) && fin.rows.length) {
    const rows = fin.rows.length;
    const mwh = fin.rows.reduce((a, r) => a + (r.deliveredMu || 0) * 1000, 0) / rows;
    if (mwh > 0) {
      const cr2kwh = (cr) => (cr * 1e4) / mwh; // ₹ cr a year over MWh a year → ₹/kWh
      const k = crf(i.discountRate || 0.1, TENDER.termYears);
      const bc = fin.capex.byComponent;
      const bess = cr2kwh(((bc.bess || 0) + (bc.pcs || 0)) * k);
      const re = cr2kwh(((bc.solar || 0) + (bc.wind || 0)) * k);
      const rest = cr2kwh(((bc.evac || 0) + (bc.other || 0) + (bc.preop || 0) + (bc.idc || 0)) * k);
      const mean = (key) => fin.rows.reduce((a, r) => a + (r[key] || 0), 0) / rows;
      const opex = cr2kwh(mean("om") + mean("insurance") + mean("other"));
      const charging = cr2kwh(mean("charging") + mean("pxFees"));
      const aug = cr2kwh(mean("augCapex"));
      const penalty = cr2kwh(mean("blockPenalty"));
      const income = cr2kwh(mean("surplusRevenue"));
      const residual = sp - (bess + re + rest + opex + charging + aug + penalty - income);
      const parts = [["the battery's capex", bess], ["own RE capex", re], ["transmission, SECI's charges and pre-operative cost", rest], ["O&M, insurance and fixed costs", opex], [`charging power, ${psmDiscount(i) > 0 ? "the PSM discount and " : ""}exchange fees`, charging], ["augmentation", aug], ["the monthly shortfall penalty", penalty]].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
      if (parts.length) add({ id: "price-drivers", severity: "note", title: `What carries the ₹${nf(sp, 2)}: ${parts[0][0]} ₹${nf(parts[0][1], 2)}/kWh${parts[1] ? `, then ${parts[1][0]} ₹${nf(parts[1][1], 2)}` : ""}`, detail: `Capex annualised at ${pf(i.discountRate || 0.1, 0)} over ${TENDER.termYears} years, costs averaged over the term, all over the energy supplied (${nf(mwh / 1000, 1)} GWh a year): ${parts.map(([l, v]) => `${l} ₹${nf(v, 2)}`).join("; ")}; less sales in the market ₹${nf(income, 2)}; the rest, ₹${nf(residual, 2)}, is tax and the return above the discount rate (the ${pf(i.targetEquityIrr, 1)} equity target on ${pf(1 - (i.debtFraction || 0), 0)} equity at ${pf(i.interestRate, 2)} debt). The biggest line is where the tariff moves most.`, step: "whatif" });
    }
  }

  // ---- 9. the extra battery for evening sale
  if (isNum(i.extraEssMwhPerMw) && i.extraEssMwhPerMw > 0) {
    const mwh = X * i.extraEssMwhPerMw;
    const life = i.essLifeYears || TENDER.termYears;
    const capexCr = mwh * (i.essCrPerMwh || 0);
    const annualCr = capexCr * crf(i.discountRate || 0.1, life) + (mwh * (i.essOmLakhPerMwh || 0)) / 100;
    const earnsCr = ops.reduce((a, o) => a + (o.extraRevCr || 0) - (o.extraMarketCostCr || 0), 0) / n;
    if (earnsCr < annualCr) add({ id: "extra-battery", severity: "warn", title: `The extra battery for evening sale (${nf(i.extraEssMwhPerMw, 2)} MWh/MW, ${nf(mwh)} MWh) costs ₹${nf(annualCr, 1)} cr a year and earns ₹${nf(earnsCr, 1)} cr`, detail: `₹${nf(capexCr, 0)} cr of capex annualised at ${pf(i.discountRate || 0.1, 0)} over ${life} years plus O&M, against its evening sales net of bought charging (average over the term: ${nf(ops.reduce((a, o) => a + (o.extraSoldMwh || 0), 0) / n / 1000, 1)} GWh a year). It may sell only outside the buyer's ${TENDER.peakHours} hours, within the ${nf(X)} MW connection and once the day's supply is met; the model places it in the ${TENDER.peakEnd - TENDER.peakStart - TENDER.peakHours} evening hours the buyer is not taken to choose, charged from spare own RE and then from what the ${pf(TENDER.marketShare, 0)} limit leaves. Set it to 0 unless the evening prices justify it.`, step: "bid", cite: "essOtherUse" });
  }

  // ---- 10. the battery: nameplate, window, fade
  const need = essRequiredPerMw(state);
  const socWarn = socWindowWarning(i);
  const usableNeed = TENDER.essHoursMin; // MWh per MW the buyer's four hours need, usable at the meter
  if (socWarn) add({ id: "soc-window", severity: "warn", title: `The state-of-charge window looks mistyped: ${pf(i.essSocMin || 0, 2)} to ${pf(isNum(i.essSocMax) ? i.essSocMax : 1, 0)} makes the nameplate ${nf(need.energy, 2)} MWh per MW`, detail: socWarn.text, step: "design" });
  else if (win < 0.6) add({ id: "soc-window", severity: "note", title: `A narrow state-of-charge window (${pf(win, 0)}) makes the nameplate ${nf(need.energy, 2)} MWh per MW for the ${nf(usableNeed)} MWh usable the ${TENDER.peakHours} hours need`, detail: `Minimum ${pf(i.essSocMin || 0, 1)} to maximum ${pf(isNum(i.essSocMax) ? i.essSocMax : 1, 1)}. Suppliers quote usable energy at the rated window (typically 10–90% or wider), so check whether the ${nf(usableNeed)} MWh per MW is already usable; if it is, leave the window empty and the nameplate falls to ${nf(usableNeed / (need.meter || 1) <= usableNeed ? usableNeed : Math.ceil((usableNeed / (need.meter || 1)) * 20) / 20, 2)} MWh per MW.`, step: "design" });
  if (isNum(i.essMwhPerMw) && i.essMwhPerMw > need.energy + 1e-9) add({ id: "battery-oversized", severity: "warn", title: `Battery energy ${nf(i.essMwhPerMw, 2)} MWh per MW is above the ${nf(need.energy, 2)} the ${TENDER.peakHours} hours need`, detail: `${nf(X * (i.essMwhPerMw - need.energy))} MWh beyond the need at ₹${nf(i.essCrPerMwh || 0, 2)} cr/MWh is ₹${nf(X * (i.essMwhPerMw - need.energy) * (i.essCrPerMwh || 0), 0)} cr of capex that earns nothing on a normal day.`, step: "bid" });
  if (causes.fadeDays) {
    const last = ops[ops.length - 1];
    add({ id: "battery-fade", severity: "warn", title: `The battery fades below the daily supply from year ${causes.fadeFrom}: the last year supplies ${pf(last.supplyShare, 1)} of the mandate`, detail: `Augmentation is ${augmentationText(state)}, with ${pf(i.essDegradation || 0, 1)} a year of fade; from operating year ${causes.fadeFrom} the usable energy no longer covers the ${TENDER.mwhPerMwDay} MWh per MW a day at your availability (${nf(causes.fadeDays)} days short in those years${i.windMw > 0 ? "; wind in the buyer's hours covers part of the gap on some days" : ""}). Augment every year, add years to the schedule or capacity to the year-by-year table, or size the nameplate for the last year. The energy not supplied earns no tariff, and a billing month short by more than ${pf(TENDER.shortfallTolerance, 0)} pays ${nf(TENDER.penaltyMultiple, 1)} × the tariff on the rest.`, step: "financeInputs", cite: "shortfall" });
  }

  // ---- 11. inputs far from the benchmarks
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
  if (raising.length) add({ id: "inputs-above-benchmark", severity: "warn", title: `${raising.length} input${raising.length > 1 ? "s" : ""} far from the benchmark in the direction that raises the tariff`, detail: raising.map((x) => `${x.label}: ${fmtV(x.v, x.pct)}${x.pct ? "" : ` ${x.unit}`} against ${fmtV(x.b, x.pct)} (${x.rel > 0 ? "+" : "−"}${nf(Math.abs(x.rel) * 100, 0)}%)`).join("; ") + ". Each is yours to set; the What-if step says what each is worth on the tariff. Keep the ones you have evidence for and freeze them there.", step: "whatif" });
  const easing = far.filter((x) => !x.raises);
  if (easing.length) add({ id: "inputs-below-benchmark", severity: "note", title: `${easing.length} input${easing.length > 1 ? "s" : ""} far from the benchmark in the direction that lowers the tariff`, detail: easing.map((x) => `${x.label}: ${fmtV(x.v, x.pct)}${x.pct ? "" : ` ${x.unit}`} against ${fmtV(x.b, x.pct)}`).join("; ") + ". A lender or SECI's evaluators will ask for the evidence behind these.", step: "whatif" });

  // ---- 12. financing
  const fe = fin?.engine?.fin || null;
  if (fe?.refiYear === 1) add({ id: "refi-year-1", severity: "note", title: "The debt is refinanced at the end of year 1", detail: `A refinancing a year after the start of supply pays the fee (${pf(fe.refiFeePct || 0, 2)} of the balance) for the rate to move from ${pf(fe.interestRate, 2)} to ${pf(fe.refiRate, 2)}; lenders rarely offer it before the plant has a year of operating record. Years 3 to 5 are the usual window.`, step: "financeInputs" });
  if (isNum(fin?.minDscr) && isNum(fe?.lenderMinDscr) && fin.minDscr < fe.lenderMinDscr - 1e-6) add({ id: "dscr-below-lender", severity: "block", title: `Minimum DSCR ${nf(fin.minDscr, 2)}× is below the lender's ${nf(fe.lenderMinDscr, 2)}×`, detail: `The debt as structured does not finance in its weakest year. Sculpt the repayment to the lender's DSCR (Finance inputs › Repayment), take less debt or a longer tenor, or accept a higher tariff; the lender's minimum is ${nf(fe.lenderMinDscr, 2)}× and the model's lowest year gives ${nf(fin.minDscr, 2)}×.`, step: "financeInputs" });
  if (isNum(i.targetEquityIrr) && i.targetEquityIrr > 0.15) add({ id: "high-equity-target", severity: "note", title: `A ${pf(i.targetEquityIrr, 1)} equity IRR target is high for a contracted supply`, detail: `SECI's recent awards price at 13–15% equity returns; every point of equity IRR is on the tariff. The benchmark is ${pf(BENCHMARKS.targetEquityIrr, 0)}.`, step: "financeInputs" });

  // ---- 13. the policy and the shortfall
  if (shortDays && i.shortfallPolicy === "pay") add({ id: "pay-policy", severity: "note", title: `${nf(shortDays)} days short under the "pay the penalty" policy`, detail: `The tariff carries the revenue those days do not earn${penalCr ? ` and ₹${nf(penalCr, 1)} cr of monthly penalty over the term` : ""}. The supply is to be met every day and is reconciled by billing month: check that the monthly tolerance (${pf(TENDER.shortfallTolerance, 0)}) and SECI's view of a plant that plans to fall short are acceptable to you.`, step: "bid", cite: "tolerance" });

  const blocks = out.filter((f) => f.severity === "block").length;
  const warns = out.filter((f) => f.severity === "warn").length;
  const summary = `${blocks ? `${blocks} blocking finding${blocks > 1 ? "s" : ""}` : "nothing blocking"}, ${warns} that carr${warns === 1 ? "ies" : "y"} cost, ${out.length - blocks - warns} to note.`;
  return { findings: out, summary, counts: { block: blocks, warn: warns, note: out.length - blocks - warns } };
}
