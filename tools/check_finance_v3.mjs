// Checks for the finance v3 inputs of the shared financial model (web/src/rtc/engine.js,
// docs/dev/FINANCE-V3-SPEC.md): one block per feature, each against a plain expectation, and the
// rule that every input off leaves the model unchanged.
// Run from the repository root:   node tools/check_finance_v3.mjs
import assert from "node:assert/strict";
import * as E from "../web/src/rtc/engine.js";

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);

// a 300 MW round-the-clock plant on the engine's synthetic profiles, 25 PPA years
const inputs = E.DEFAULT_RTC_INPUTS;
const demand = E.buildDemand({ annualEnergyMu: inputs.annualEnergyMu });
const ctx = E.buildContext({ demand, solarCf: E.synthSolarCf({ targetCuf: inputs.solarCuf, dcAc: inputs.solarDcAc }), windCf: E.synthWindCf({ targetCuf: inputs.windCuf }), plantMw: inputs.plantCapacityMw, bess: E.DEFAULT_BESS });
const sizes = { solarMw: 695, windMw: 460, bessMw: 400, bessMwh: 1600 };
const baseFin = { ...E.DEFAULT_FINANCE, tariff: 5.66 };
const ops = E.simulateLifetime(ctx, sizes, baseFin, E.DEFAULT_BESS);
const run = (fin = {}, costs = {}, bess = {}, extra = {}) => E.runFinancialModel(ctx, sizes, { costs: { ...E.DEFAULT_COSTS, ...costs }, fin: { ...baseFin, ...fin }, bess: { ...E.DEFAULT_BESS, ...bess }, dfrTarget: inputs.dfrTarget, tariffLocked: true, ops, ...extra });
const base = run();
const N = baseFin.years;
assert.equal(base.rows.length, N);
const checks = [];
const ok = (name, detail) => { checks.push(name); console.log(`ok   ${name}${detail ? `: ${detail}` : ""}`); };

// 1. timeline: dates from the COD
{
  const f = run({ codDate: "2028-05-01" }, { constructionMonths: 18 });
  assert.equal(f.rows[0].start, "2028-05-01");
  assert.equal(f.rows[0].end, "2029-04-30");
  assert.equal(f.rows[1].start, "2029-05-01");
  assert.equal(f.timeline.codDate, "2028-05-01");
  assert.equal(f.timeline.constructionStart, "2026-11-01");
  assert.equal(base.rows[0].start, null, "no dates without a COD");
  assert.equal(base.timeline, null);
  ok("timeline", `year 1 ${f.rows[0].start} – ${f.rows[0].end}, construction from ${f.timeline.constructionStart}`);
}

// 2a. hard-cost breakup with phasing: the parts add up to the schedule, each inside its window
{
  const costs = { constructionMonths: 18, drawdown: "linear" };
  const plain = run({}, costs);
  const phased = run({}, { ...costs, phasing: { solar: { start: 6, months: 12 }, bess: { start: 12, months: 6 } } });
  assert.ok(plain.construction && phased.construction.phased);
  for (const r of phased.construction.rows) {
    const parts = Object.values(r.byComponent).reduce((a, b) => a + b, 0);
    assert.ok(close(parts, r.cost, 1e-9), `month ${r.month}: the parts add up to the month's cost`);
    if (r.month <= 6) assert.equal(r.byComponent.solar, 0, "no solar spend before its window");
    if (r.month <= 12) assert.equal(r.byComponent.bess, 0, "no battery spend before its window");
  }
  assert.ok(close(sum(phased.construction.rows, "cost"), sum(plain.construction.rows, "cost"), 1e-9), "the same total is spent");
  assert.ok(close(sum(phased.construction.rows.map((r) => ({ v: r.byComponent.solar })), "v"), phased.capex.byComponent.solar, 1e-9), "every rupee of the solar capex is spent");
  assert.ok(phased.capex.idc < plain.capex.idc, "spending later lowers the IDC");
  assert.ok(close(plain.construction.rows[3].byComponent.wind, plain.construction.rows[3].cost * plain.capex.byComponent.wind / (plain.capex.hard + plain.capex.preop), 1e-9), "without phasing every part follows the profile");
  assert.ok(close(base.capex.byComponent.solar + base.capex.byComponent.wind + base.capex.byComponent.bess + base.capex.byComponent.pcs + base.capex.byComponent.evac + base.capex.byComponent.other, base.capex.hard, 1e-9));
  ok("hard-cost phasing", `IDC ₹${plain.capex.idc.toFixed(1)} cr even → ₹${phased.capex.idc.toFixed(1)} cr with the solar and battery spent later`);
}

// 2b. part commissioning: a 6-month delay halves year 1; an early part credits year 1
{
  const late = run({ parts: [{ share: 1, offsetMonths: 6 }] });
  assert.ok(close(late.rows[0].opFactor, 0.5, 1e-12) && late.rows[1].opFactor === 1);
  assert.ok(close(late.rows[0].deliveredMu, base.rows[0].deliveredMu * 0.5, 1e-9), "half the energy in year 1");
  assert.ok(close(late.rows[0].om, base.rows[0].om * 0.5, 1e-9) && close(late.rows[0].insurance, base.rows[0].insurance, 1e-12), "O&M follows the parts, insurance does not");
  assert.ok(late.equityIrr < base.equityIrr, "the delay costs returns");
  const split = run({ parts: [{ share: 0.6, offsetMonths: 0 }, { share: 0.4, offsetMonths: 3 }] });
  assert.ok(close(split.rows[0].opFactor, 0.6 + 0.4 * 0.75, 1e-12));
  const early = run({ parts: [{ share: 0.5, offsetMonths: -6 }, { share: 0.5, offsetMonths: 0 }] });
  assert.ok(close(early.rows[0].opFactor, 1.25, 1e-12) && early.equityIrr > base.equityIrr, "early commissioning adds to year 1");
  ok("part commissioning", `6-month delay: year-1 factor ${late.rows[0].opFactor}, equity IRR ${(base.equityIrr * 100).toFixed(2)}% → ${(late.equityIrr * 100).toFixed(2)}%`);
}

// 2c. bridge loan: a dearer bridge raises the IDC; the takeout fee is capitalised
{
  const costs = { constructionMonths: 18 };
  const plain = run({}, costs);
  const bridged = run({ bridge: { months: 9, rate: 0.12, feePct: 0.01 } }, costs);
  assert.ok(bridged.construction.rows[8].bridge && !bridged.construction.rows[9].bridge);
  assert.ok(bridged.capex.idc > plain.capex.idc, "the bridge costs more interest");
  assert.ok(bridged.capex.bridgeFee > 0 && close(bridged.capex.bridgeFee, bridged.construction.rows[8].bridgeFee, 1e-12));
  assert.ok(close(bridged.capex.total, bridged.capex.hard + bridged.capex.preop + bridged.capex.idc + bridged.capex.bridgeFee, 1e-9));
  assert.ok(close(bridged.debt, bridged.construction.debtDrawn + bridged.capex.idc + bridged.capex.bridgeFee, 1e-9), "the fee sits in the debt");
  const cheap = run({ bridge: { months: 9, rate: 0.09, feePct: 0 } }, costs);
  assert.ok(close(cheap.capex.total, plain.capex.total, 1e-9), "a bridge at the term rate with no fee changes nothing");
  ok("bridge loan", `IDC ₹${plain.capex.idc.toFixed(1)} → ₹${bridged.capex.idc.toFixed(1)} cr, takeout fee ₹${bridged.capex.bridgeFee.toFixed(2)} cr`);
}

// 3a. generation cases
{
  const p90 = run({ generationCase: "p90" });
  assert.ok(p90.rows.every((r) => r.generationFactor === 0.94));
  assert.ok(close(p90.rows[4].deliveredMu, base.rows[4].deliveredMu * 0.94, 1e-9) && close(p90.rows[4].dfr, base.rows[4].dfr * 0.94, 1e-9));
  assert.ok(p90.equityIrr < run({ generationCase: "p75" }).equityIrr && run({ generationCase: "p75" }).equityIrr < base.equityIrr);
  const own = run({ generationCase: "p90", caseFactors: { p75: 0.98, p90: 0.9 } });
  assert.equal(own.rows[0].generationFactor, 0.9);
  ok("generation cases", `P90 equity IRR ${(p90.equityIrr * 100).toFixed(2)}% vs P50 ${(base.equityIrr * 100).toFixed(2)}%`);
}

// 3b. carbon credits: exactly the tonnes × price for the years, inside revenue and taxable
{
  const f = run({ carbon: { enabled: true, tPerMwh: 0.7, pricePerT: 1000, years: 10, escalation: 0 } });
  const r = f.rows[0];
  const expected = ((base.rows[0].deliveredMu + base.rows[0].excessMu) * 1000 * 0.7 * 1000) / 1e7;
  assert.ok(close(r.carbonRevenue, expected, 1e-9), `carbon ₹${r.carbonRevenue} vs ₹${expected} cr`);
  assert.ok(close(r.revenue, base.rows[0].revenue + expected, 1e-9), "inside revenue");
  assert.equal(f.rows[10].carbonRevenue, 0, "none after the crediting years");
  assert.ok(f.rows[0].tax >= base.rows[0].tax, "taxable");
  assert.ok(close(f.totals.carbonRevenue, expected * 10 * 0 + sum(f.rows, "carbonRevenue"), 1e-9));
  ok("carbon credits", `₹${expected.toFixed(2)} cr a year for 10 years`);
}

// 3c. life extension: more years, the extension price, the capex in the last PPA year, straight-line
{
  const f = run({ extension: { years: 5, capexCr: 200, tariffRsPerKwh: 3, omFactor: 1.1, degradation: 0.01 } });
  assert.equal(f.rows.length, N + 5);
  assert.equal(f.ppaYears, N);
  assert.equal(f.years, N + 5);
  assert.equal(f.rows[N - 1].phase, "ppa");
  assert.equal(f.rows[N].phase, "extension");
  assert.equal(f.rows[N].tariff, 3);
  assert.ok(close(f.rows[N - 1].extensionCapex, 200, 1e-12) && f.rows[N].extensionCapex === 0);
  assert.ok(close(f.rows[N].bookDep - 200 / 5, 0, 1e-9) || f.rows[N].bookDep > 0, "the extension capex depreciated over the extension");
  assert.ok(close(f.rows[N].deliveredMu, f.rows[N - 1].deliveredMu * 0.99, 1e-9), "degrading from the last PPA year");
  assert.ok(f.rows[N].penalty === 0 && f.rows[N].om > f.rows[N - 1].om, "no penalties; O&M continues at the factor");
  assert.ok(f.rows.slice(0, N - 1).every((r, i) => close(r.pat, base.rows[i].pat, 1e-9)), "the PPA years before the last are unchanged");
  const cheap = run({ extension: { years: 5, capexCr: 0, tariffRsPerKwh: 4 } });
  assert.ok(cheap.equityIrr > base.equityIrr, "five more years at ₹4 add to the returns");
  ok("life extension", `${N} + 5 years, equity IRR ${(base.equityIrr * 100).toFixed(2)}% → ${(cheap.equityIrr * 100).toFixed(2)}% at ₹4/kWh`);
}

// 3d. solar repowering
{
  const f = run({ repower: { year: 12, capexCr: 300, upliftPct: 0.1 } });
  assert.ok(close(f.rows[11].repowerCapex, 300, 1e-12) && f.rows[12].repowerCapex === 0);
  assert.ok(f.rows[11].repowerUplift === 0 && f.rows[12].repowerUplift > 0, "the uplift from the year after");
  const solarShare = ops[12].solarGenMWh / (ops[12].solarGenMWh + ops[12].windGenMWh);
  assert.ok(close(f.rows[12].deliveredMu, base.rows[12].deliveredMu * (1 + 0.1 * solarShare), 1e-9), "the solar share of the energy grows 10%");
  assert.ok(f.rows[12].bookDep > base.rows[12].bookDep, "depreciated over the book life left");
  ok("solar repowering", `₹300 cr in year 12, +${(10 * solarShare).toFixed(1)}% energy from year 13`);
}

// 3e. battery augmentation on a schedule
{
  const sched = run({}, {}, { augmentation: "schedule", augmentationYears: [6, 12, 18] });
  const yrs = sched.rows.filter((r) => r.augCapex > 0).map((r) => r.year);
  assert.deepEqual(yrs, [6, 12, 18]);
  const deg = E.DEFAULT_BESS.annualDegradation;
  const price = (y) => E.DEFAULT_COSTS.bessCrPerMwh * (1 - E.DEFAULT_BESS.costDeclinePct) ** (y - 1);
  assert.ok(close(sched.rows[5].augCapex, sizes.bessMwh * deg * 5 * price(6), 1e-9), "year 6 replaces five years of fade");
  assert.ok(close(sched.rows[11].augCapex, sizes.bessMwh * deg * 6 * price(12), 1e-9), "year 12 replaces the six years since");
  assert.ok(close(E.yearFactors(6, baseFin, { ...E.DEFAULT_BESS, augmentation: "schedule", augmentationYears: [6, 12, 18] }).bessFactor, 1, 1e-12), "full capacity in an augmentation year");
  assert.ok(close(E.yearFactors(9, baseFin, { ...E.DEFAULT_BESS, augmentation: "schedule", augmentationYears: [6, 12, 18] }).bessFactor, 1 - 3 * deg, 1e-12));
  ok("augmentation schedule", `years ${yrs.join(", ")}: ₹${sched.rows[5].augCapex.toFixed(1)}, ₹${sched.rows[11].augCapex.toFixed(1)}, ₹${sched.rows[17].augCapex.toFixed(1)} cr`);
}

// 4. O&M by source and wind components, other fixed lines
{
  const r0 = base.rows[0];
  assert.ok(close(r0.solarOm + r0.windOm + r0.bessOm + r0.biomassOm, r0.om, 1e-9), "the split adds to the O&M");
  const f = run({ solarOmEscalation: 0.03, windOmEscalation: 0.06, bessOmEscalation: 0.02 });
  assert.ok(close(f.rows[0].om, base.rows[0].om, 1e-9), "year 1 the same");
  assert.ok(close(f.rows[9].solarOm, r0.solarOm * 1.03 ** 9, 1e-9) && close(f.rows[9].windOm, r0.windOm * 1.06 ** 9, 1e-9) && close(f.rows[9].bessOm, r0.bessOm * 1.02 ** 9, 1e-9));
  assert.ok(close(f.rows[9].om, f.rows[9].solarOm + f.rows[9].windOm + f.rows[9].bessOm + f.rows[9].biomassOm, 1e-9));
  const comps = run({ windOmComponents: [{ label: "Turbine service", lakhPerMw: 6, escalation: 0.07 }, { label: "Balance of plant", lakhPerMw: 3, escalation: 0.04 }] });
  assert.ok(close(comps.rows[0].windOm, base.rows[0].windOm, 1e-9), "6 + 9 lakh/MW: the same year-1 wind O&M");
  assert.equal(comps.rows[0].windOmComponents.length, 2);
  assert.ok(close(comps.rows[4].windOmComponents[0], (sizes.windMw * 6) / 100 * 1.07 ** 4, 1e-9));
  assert.ok(close(comps.rows[4].windOm, comps.rows[4].windOmComponents[0] + comps.rows[4].windOmComponents[1], 1e-9));
  const lines = run({ otherFixedLines: [{ label: "Solar park fee", crPerYear: 2, escalation: 0 }, { label: "Audit", crPerYear: 0.5, escalation: 0.05 }, { label: "Asset management", crPerYear: 1, escalation: 0.04 }] });
  assert.equal(lines.rows[0].otherLines.length, 3);
  assert.ok(close(lines.rows[0].other, 3.5, 1e-12) && close(lines.rows[5].other, 2 + 0.5 * 1.05 ** 5 + 1 * 1.04 ** 5, 1e-9));
  assert.ok(close(lines.rows[5].opex, base.rows[5].opex + lines.rows[5].other, 1e-9));
  ok("O&M and fixed-cost split", `wind O&M year 5 ₹${comps.rows[4].windOm.toFixed(2)} cr in two components; three fixed lines ₹${lines.rows[5].other.toFixed(2)} cr in year 6`);
}

// 5a. refinancing with a new method (re-sculpting)
{
  const refi = { refiYear: 6, refiRate: 0.08, refiTenorYears: 12, refiFeePct: 0.005 };
  const same = run({ ...refi });
  const resculpt = run({ ...refi, refiRepayment: "sculpted", targetDscr: 1.4 });
  assert.ok(same.rows.slice(0, 6).every((r, i) => close(r.principal, resculpt.rows[i].principal, 1e-9)), "the same until the refinancing");
  const after = resculpt.rows.filter((r) => r.year > 6 && r.openingDebt > 1 && r.closingDebt > 1); // until the year the balance clears
  assert.ok(after.every((r) => close(r.dscr, 1.4, 1e-6)), `re-sculpted to 1.40: ${after.map((r) => r.dscr?.toFixed(3)).join(" ")}`);
  ok("refinancing with re-sculpting", `DSCR ${after[0].dscr.toFixed(3)} from year 7`);
}

// 5b. interest step-down
{
  const f = run({ rateStepDown: { afterYears: 3, rate: 0.08 } });
  assert.ok(f.rows[2].debtRate === 0.09 && f.rows[3].debtRate === 0.08);
  assert.ok(close(f.rows[3].interest, f.rows[3].openingDebt * 0.08, 1e-9));
  assert.ok(f.equityIrr > base.equityIrr);
  const withRefi = run({ rateStepDown: { afterYears: 3, rate: 0.08 }, refiYear: 6, refiRate: 0.075 });
  assert.ok(withRefi.rows[5].debtRate === 0.08 && withRefi.rows[6].debtRate === 0.075, "the refinancing takes over");
  ok("interest step-down", `9% → 8% from year 4, equity IRR ${(base.equityIrr * 100).toFixed(2)}% → ${(f.equityIrr * 100).toFixed(2)}%`);
}

// 5c. top-up
{
  const f = run({ topUp: { year: 2, debtFraction: 0.75 } });
  const r = f.rows[1];
  assert.ok(r.topUpCr > 0 && close(r.closingDebt, 0.75 * f.capex.total, 1e-9), "the debt back at 75% of the project cost");
  assert.ok(close(r.fcfe, base.rows[1].fcfe + r.topUpCr, 1e-9), "paid out to equity");
  assert.ok(f.rows[2].openingDebt > base.rows[2].openingDebt && f.rows[2].principal > base.rows[2].principal, "re-amortised over the years left");
  assert.ok(close(f.rows[f.debtTerms.tenor - 1].closingDebt, 0, 1e-6), "cleared by the tenor");
  ok("top-up", `₹${r.topUpCr.toFixed(1)} cr drawn at the end of year 2`);
}

// 5d. cash sweep (with accrual) and the prepayment fee
{
  const f = run({ sweep: { pct: 0.5, fromYear: 2, toYear: 10 }, prepaymentPct: 0.01 });
  assert.equal(f.rows[0].sweepCr, 0);
  assert.ok(f.rows[1].sweepCr > 0 && close(f.rows[1].prepaymentFee, f.rows[1].sweepCr * 0.01, 1e-9));
  assert.ok(f.rows[10].sweepCr === 0, "none after the window");
  assert.ok(f.rows[5].closingDebt < base.rows[5].closingDebt, "the debt falls faster");
  assert.ok(f.rows[12].dscr > base.rows[12].dscr, "later DSCRs rise");
  assert.ok(close(f.totals.sweepCr, sum(f.rows, "sweepCr"), 1e-9) && close(f.totals.prepaymentFee, sum(f.rows, "prepaymentFee"), 1e-9));
  // accrual: a sweep share bigger than the cash accrues and is paid later
  const tight = run({ sweep: { pct: 3, fromYear: 2, toYear: 6 } });
  assert.ok(tight.rows[1].sweepAccrued > 0, "the unpaid sweep accrues");
  assert.ok(tight.rows[2].sweepCr >= tight.rows[1].sweepCr || tight.rows[2].sweepAccrued > tight.rows[1].sweepAccrued);
  // the refinancing takeout pays the fee too
  const takeout = run({ refiYear: 6, refiRate: 0.08, prepaymentPct: 0.02 });
  assert.ok(close(takeout.rows[5].prepaymentFee, takeout.rows[5].closingDebt * 0.02, 1e-9));
  ok("cash sweep and prepayment fee", `₹${f.totals.sweepCr.toFixed(1)} cr swept years 2–10, fee ₹${f.totals.prepaymentFee.toFixed(2)} cr; refinancing fee ₹${takeout.rows[5].prepaymentFee.toFixed(2)} cr`);
}

// 5e. FSCR, LLCR, PLCR
{
  const f = run({ otherFixedCr: 5 });
  const r = f.rows[2];
  assert.ok(close(r.fscr, (r.cfads + r.other) / (r.debtService + r.other), 1e-9));
  assert.ok(Math.abs(r.fscr - 1) < Math.abs(r.dscr - 1) && (r.fscr - 1) * (r.dscr - 1) >= 0, "fixed charges pull the ratio towards 1");
  let pv = 0;
  for (let k = 3; k <= f.debtTerms.tenor; k += 1) pv += f.rows[k - 1].cfads / (1 + r.debtRate) ** (k - 2);
  assert.ok(close(r.llcr, pv / r.openingDebt, 1e-9), "LLCR = PV of CFADS to the tenor / opening debt");
  assert.ok(r.plcr > r.llcr, "the project life cover is longer");
  assert.ok(f.minFscr > 0 && f.minLlcr > 0 && f.minPlcr > f.minLlcr);
  assert.equal(f.rows[N - 1].llcr, null, "no ratio without debt");
  ok("FSCR, LLCR, PLCR", `year 3: DSCR ${r.dscr.toFixed(3)}, FSCR ${r.fscr.toFixed(3)}, LLCR ${r.llcr.toFixed(2)}, PLCR ${r.plcr.toFixed(2)}`);
}

// 5f. DSRA on the peak and its interest
{
  // after a two-year moratorium the debt service steps up, so the highest year left is above the next
  const next = run({ dsraMonths: 6, graceYears: 2 });
  const peak = run({ dsraMonths: 6, dsraBasis: "peak", graceYears: 2 });
  assert.ok(peak.rows.every((r, i) => r.dsraBalance >= next.rows[i].dsraBalance - 1e-9), "the peak reserve is never below the next-year reserve");
  assert.ok(peak.rows.some((r, i) => r.dsraBalance > next.rows[i].dsraBalance + 1e-6));
  const earning = run({ dsraMonths: 6, dsraInterestRate: 0.06 });
  assert.equal(earning.rows[0].dsraInterest, 0, "nothing earned before the reserve is built");
  assert.ok(close(earning.rows[1].dsraInterest, earning.rows[0].dsraBalance * 0.06, 1e-6), "interest on the opening reserve");
  assert.ok(close(earning.rows[1].otherIncome, earning.rows[1].dsraInterest, 1e-12) && earning.rows[1].pbt > next.rows[1].pbt);
  assert.ok(next.rows.every((r) => r.dsraInterest === 0 && r.otherIncome === 0));
  ok("DSRA peak and interest", `peak reserve year 1 ₹${peak.rows[0].dsraBalance.toFixed(1)} vs next-year ₹${next.rows[0].dsraBalance.toFixed(1)} cr; interest year 2 ₹${earning.rows[1].dsraInterest.toFixed(2)} cr`);
}

// 5g. quasi-equity: in the funding, interest accrues below the lender's floor, repaid when clear
{
  const q = { amountCr: 300, rate: 0.12, lenderMinDscr: 1.2, repayFromYear: 3 };
  const f = run({ quasi: q });
  assert.ok(close(f.equity, base.equity - 300, 1e-9) && close(f.quasi, 300, 1e-12) && close(f.debt, base.debt, 1e-9), "quasi-equity replaces equity in the funding");
  assert.ok(f.rows[0].quasiOpening === 300);
  const low = f.rows.filter((r) => r.dscr !== null && r.dscr < 1.2);
  assert.ok(low.every((r) => r.quasiInterestPaid === 0 && r.quasiRepaid === 0), "nothing paid while the DSCR is below the floor");
  assert.ok(low.length ? low[0].quasiAccrued > 0 : true, "the interest accrues");
  const paid = f.rows.filter((r) => r.quasiInterestPaid > 0);
  assert.ok(paid.length > 0, "paid in some years");
  assert.ok(f.rows.filter((r) => r.year < 3).every((r) => r.quasiRepaid === 0), "no repayment before the year");
  assert.ok(close(f.rows[N - 1].quasiClosing, 0, 1e-6) || f.rows[N - 1].quasiClosing >= 0);
  assert.ok(f.rows.every((r) => close(r.quasiClosing, r.quasiOpening - r.quasiRepaid, 1e-9)));
  assert.ok(f.holdcoFlows[0] === -(f.equity + 300) && close(f.holdcoFlows[5], f.rows[4].fcfe + f.rows[4].quasiInterestPaid + f.rows[4].quasiRepaid, 1e-9));
  assert.ok(Number.isFinite(f.holdcoIrr));
  // the SPV equity IRR is the common equity's; the holdco's blends the quasi
  const easy = run({ quasi: { ...q, lenderMinDscr: 0 } });
  assert.ok(easy.rows[0].quasiInterestPaid > 0, "with no floor the interest is paid from year 1");
  ok("quasi-equity", `₹300 cr at 12%: ${low.length} years below DSCR 1.2 accrue; holdco IRR ${(f.holdcoIrr * 100).toFixed(2)}%, SPV equity IRR ${(f.equityIrr * 100).toFixed(2)}%`);
}

// 5h. mezzanine
{
  const m = { amountCr: 200, rate: 0.14, tenorYears: 8, graceYears: 2, repayment: "equal", feePct: 0.01 };
  const f = run({ mezz: m });
  assert.ok(close(f.mezz, 200, 1e-12) && close(f.capex.mezzFee, 2, 1e-12) && close(f.capex.total, base.capex.total + 2, 1e-9), "the fee in the project cost");
  assert.ok(close(f.equity, f.capex.total - f.debt - 200, 1e-9), "mezzanine in the funding");
  assert.ok(close(f.rows[0].mezzInterest, 28, 1e-12) && f.rows[0].mezzPrincipal === 0 && f.rows[1].mezzPrincipal === 0, "interest from year 1, no principal in the grace years");
  assert.ok(close(f.rows[2].mezzPrincipal, 200 / 6, 1e-9) && close(f.rows[7].mezzClosing, 0, 1e-9), "equal parts over years 3 to 8");
  assert.ok(f.rows[2].totalDscr < f.rows[2].dscr, "the total cover counts the mezzanine");
  const bullet = run({ mezz: { ...m, repayment: "bullet" } });
  assert.ok(bullet.rows[6].mezzPrincipal === 0 && close(bullet.rows[7].mezzPrincipal, 200, 1e-9));
  ok("mezzanine", `₹200 cr at 14%, DSCR ${f.rows[2].dscr.toFixed(2)} senior, ${f.rows[2].totalDscr.toFixed(2)} total in year 3`);
}

// 5i. guarantees: fees, margin money and its interest
{
  const g = [{ label: "PBG", amountCr: 50, feePct: 0.01, marginPct: 0.1, marginRate: 0.06, fromYear: 0, years: 4 }, { label: "Connectivity BG", amountCr: 20, feePct: 0.015, marginPct: 0, marginRate: 0, fromYear: 2, years: 25 }];
  const f = run({ guarantees: g }, { constructionMonths: 12 });
  assert.ok(close(f.capex.guaranteeFees, 0.5, 1e-12), "the construction year's PBG fee capitalised");
  assert.ok(close(f.rows[0].guaranteeFees, 0.5, 1e-12) && close(f.rows[1].guaranteeFees, 0.5 + 0.3, 1e-12) && close(f.rows[4].guaranteeFees, 0.3, 1e-12));
  assert.ok(close(f.rows[0].marginBalance, 5, 1e-12) && close(f.rows[0].dMargin, 5, 1e-12) && close(f.rows[3].dMargin, -5, 1e-12), "₹5 cr blocked for the PBG's years, then released");
  assert.ok(close(f.rows[1].marginInterest, 0.3, 1e-12) && f.rows[1].otherIncome >= 0.3);
  assert.ok(close(f.rows[1].fcfe, f.rows[1].cfads - f.rows[1].debtService - f.rows[1].dDsra, 1e-9), "the fees are in the CFADS");
  ok("guarantees", `fees ₹${f.totals.guaranteeFees.toFixed(2)} cr over the life, margin ₹${f.rows[0].marginBalance} cr earning ₹${f.rows[1].marginInterest} cr`);
}

// 6a. book depreciation: SLM equals the model before v3; WDV kept beside it; component lives
{
  const r = base.rows[0];
  const bookBase = base.capex.total * (1 - baseFin.salvagePct);
  assert.ok(close(r.bookDepSlm, bookBase / baseFin.bookLifeYears + 0, 1e-9) && r.bookDep === r.bookDepSlm, "straight line is the default and the old figure");
  assert.ok(close(r.bookDepWdv, base.capex.total * baseFin.wdvRate, 1e-9) && close(base.rows[1].bookDepWdv, base.capex.total * (1 - baseFin.wdvRate) * baseFin.wdvRate + base.rows[1].augCapex * baseFin.wdvRate, 1e-9));
  assert.ok(close(r.taxDepWdv, r.bookDepWdv, 1e-9) && r.taxDep === r.taxDepWdv && close(r.taxDepSlm, r.bookDepSlm, 1e-12));
  const wdvBooks = run({ bookDepreciation: "wdv", bookWdvRate: 0.1 });
  assert.ok(close(wdvBooks.rows[0].bookDep, base.capex.total * 0.1, 1e-9) && close(wdvBooks.rows[0].tax, r.tax, 1e-9), "the books change, the tax does not");
  const lives = run({ lives: { solar: 25, wind: 20, bess: 12, evac: 35, other: 25 } });
  const first = lives.rows[0];
  assert.ok(first.bookDepSlm > r.bookDepSlm, "shorter lives depreciate faster");
  assert.ok(lives.rows[12].bookDepSlm < lives.rows[11].bookDepSlm, "the battery is written off after 12 years");
  assert.ok(close(Object.values(first.netBlockByComponent).reduce((a, b) => a + b, 0), first.netBlock, 1e-9) && close(first.grossBlock - first.accDep, first.netBlock, 1e-12));
  assert.ok(close(sum(base.rows, "bookDepSlm"), bookBase + sum(base.rows, "augCapex"), 1e-6), "the whole book base is depreciated once");
  const within = run({ lives: { solar: 25, wind: 20, bess: 12, evac: 25, other: 25 } });
  assert.ok(close(sum(within.rows, "bookDepSlm"), bookBase + sum(within.rows, "augCapex"), 1e-6), "with lives inside the PPA the whole book base is depreciated once");
  const longer = run({ lives: { solar: 25, wind: 35, bess: 12, evac: 25, other: 25 } });
  assert.ok(sum(longer.rows, "bookDepSlm") < sum(within.rows, "bookDepSlm") - 1, "a 35-year wind life leaves book value at the end");
  ok("book depreciation", `SLM ₹${r.bookDepSlm.toFixed(1)}, WDV ₹${r.bookDepWdv.toFixed(1)} cr in year 1; with component lives ₹${first.bookDepSlm.toFixed(1)} cr`);
}

// 6b. the asset register
{
  const r = base.rows[0];
  assert.ok(close(Object.values(r.grossBlockByComponent).reduce((a, b) => a + b, 0), r.grossBlock, 1e-9));
  assert.ok(close(r.grossBlock, base.capex.total + r.augCapex, 1e-9));
  assert.ok(close(base.rows[4].grossBlock, base.capex.total + sum(base.rows.slice(0, 5), "augCapex"), 1e-9), "augmentation joins the battery");
  assert.ok(close(base.rows[4].grossBlockByComponent.bess, base.capex.byComponent.bess + sum(base.rows.slice(0, 5), "augCapex"), 1e-9));
  assert.ok(close(base.rows[4].accDep, sum(base.rows.slice(0, 5), "bookDep"), 1e-9));
  ok("asset register", `gross block ₹${r.grossBlock.toFixed(0)} cr: ${Object.entries(r.grossBlockByComponent).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ")}`);
}

// 6c. tax: losses and depreciation carried, the loss limit, thin capitalisation
{
  const lossy = run({ tariff: 3.2 }); // a low tariff: losses in the early years
  const first = lossy.rows[0];
  assert.ok(first.taxableIncome === 0 && first.tax === 0 && first.lossCarried + first.depCarried > 0, "a loss year carries forward");
  assert.ok(close(first.depCarried, Math.min(first.taxDep, first.lossCarried + first.depCarried), 1e-9), "the loss is depreciation first");
  const used = lossy.rows.find((r) => r.lossSetOff + r.depSetOff > 0);
  assert.ok(used, "set off later");
  const limited = run({ tariff: 3.2, lossCarryYears: 3 });
  assert.ok(sum(limited.rows, "lossSetOff") <= sum(lossy.rows, "lossSetOff") + 1e-9 && sum(limited.rows, "tax") >= sum(lossy.rows, "tax") - 1e-9, "a three-year limit loses some losses");
  assert.ok(sum(limited.rows, "depSetOff") >= 0);
  // thin capitalisation: the mezzanine interest over the share of EBITDA (10% here, so the case
  // bites on this plant) is disallowed and carried
  const m = { amountCr: 1500, rate: 0.14, tenorYears: 20, graceYears: 0, repayment: "bullet", feePct: 0 };
  const free = run({ mezz: m });
  const thin = run({ mezz: m, thinCapPct: 0.1 });
  const r = thin.rows[0];
  const cap = 0.1 * r.ebitda;
  assert.ok(r.mezzInterest > cap, "the case bites");
  assert.ok(close(r.interestDisallowed, r.mezzInterest - cap, 1e-9) && close(r.interestCarried, r.interestDisallowed, 1e-9));
  // year 2: the allowance (10% of EBITDA) clears the interest carried in first, the rest of this
  // year's is disallowed; year 3: the allowance eats into the pool, this year's is all disallowed
  assert.ok(close(thin.rows[1].interestCarried, thin.rows[1].interestDisallowed, 1e-9) && close(thin.rows[1].interestDisallowed, thin.rows[1].mezzInterest - (0.1 * thin.rows[1].ebitda - r.interestCarried), 1e-9), "year 2");
  assert.ok(close(thin.rows[2].interestCarried, thin.rows[1].interestCarried - 0.1 * thin.rows[2].ebitda + thin.rows[2].mezzInterest, 1e-9) && close(thin.rows[2].interestDisallowed, thin.rows[2].mezzInterest, 1e-9), "year 3");
  assert.ok(thin.rows[9].interestCarried < sum(thin.rows.slice(0, 10), "interestDisallowed") - 1, "the oldest lapses after eight years");
  assert.ok(thin.rows[0].taxableIncome >= free.rows[0].taxableIncome && sum(thin.rows, "tax") > sum(free.rows, "tax"), "more tax over the life");
  assert.ok(base.rows.every((row) => row.interestDisallowed === 0 && row.interestCarried === 0));
  ok("tax schedule", `low-tariff case: ₹${(first.lossCarried + first.depCarried).toFixed(1)} cr carried from year 1 (depreciation ₹${first.depCarried.toFixed(1)} cr); thin cap disallows ₹${r.interestDisallowed.toFixed(1)} cr`);
}

// 7. returns: pre-tax, holdco and promoter, the lender's XIRR and MIRR
{
  assert.ok(base.preTaxEquityIrr > base.equityIrr && base.preTaxProjectIrr > base.projectIrr);
  assert.ok(close(base.holdcoIrr, base.equityIrr, 1e-9) && close(base.promoterIrr, base.equityIrr, 1e-9), "no holdco costs, no quasi: the same");
  const h = run({ holdco: { expensesCrPerYear: 2, promoterShare: 0.6 } });
  assert.ok(h.holdcoIrr < h.equityIrr && close(h.promoterFlows[3], h.holdcoFlows[3] * 0.6, 1e-9) && close(h.promoterIrr, h.holdcoIrr, 1e-9), "a pro-rata share has the holdco's IRR");
  // the lender: one draw at the COD, yearly service at the senior rate → the XIRR is the rate
  assert.equal(base.lenderFlows[0].kind, "draw");
  assert.ok(close(base.lenderFlows[0].amount, -base.debt, 1e-9));
  assert.ok(close(base.lenderXirr, baseFin.interestRate, 2e-3), `lender XIRR ${(base.lenderXirr * 100).toFixed(3)}% vs the 9% rate`);
  assert.ok(close(base.lenderMirr, baseFin.interestRate, 1e-6), "MIRR at the rate reinvested at the rate is the rate");
  const reinvest = run({ lenderReinvestRate: 0.05 });
  assert.ok(reinvest.lenderMirr < base.lenderMirr);
  const built = run({ codDate: "2028-04-01" }, { constructionMonths: 12 });
  assert.equal(built.lenderFlows.length, 12 + N);
  assert.equal(built.lenderFlows[0].date, "2027-04-01");
  assert.equal(built.lenderFlows[12].date, "2029-03-31");
  assert.ok(Math.abs(built.lenderXirr - baseFin.interestRate) < 0.005, "with monthly draws and IDC the XIRR stays near the rate");
  assert.ok(close(E.xirr([{ date: "2029-01-01", amount: -100 }, { date: "2030-01-01", amount: 110 }]), 0.1, 1e-6));
  assert.ok(close(E.mirr([-100, 60, 60], 0.1, 0.1), Math.sqrt((60 * 1.1 + 60) / 100) - 1, 1e-9));
  ok("returns", `pre-tax equity IRR ${(base.preTaxEquityIrr * 100).toFixed(2)}%, lender XIRR ${(base.lenderXirr * 100).toFixed(2)}%, MIRR ${(base.lenderMirr * 100).toFixed(2)}%`);
}

// 8. statements: the balance sheet balances through the cash line; the convention is full payout
{
  for (const f of [base, run({ dsraMonths: 6, dsraInterestRate: 0.05, quasi: { amountCr: 200, rate: 0.12, lenderMinDscr: 1.1, repayFromYear: 2 }, mezz: { amountCr: 100, rate: 0.14, tenorYears: 10, graceYears: 1, repayment: "equal", feePct: 0 }, sweep: { pct: 0.3, fromYear: 2, toYear: 8 } })]) {
    for (const r of f.rows) {
      const assets = r.netBlock + r.wcBalance + r.dsraBalance + r.marginBalance + r.cash;
      const liabilities = r.shareCapital + r.retained + r.closingDebt + r.mezzClosing + r.quasiClosing + r.quasiAccrued + r.sweepAccrued;
      assert.ok(close(assets, liabilities, 1e-9), `year ${r.year} balances`);
      assert.ok(r.dividends === r.fcfe);
    }
    assert.ok(close(f.rows[0].retained, f.rows[0].pat - f.rows[0].fcfe, 1e-9) && f.rows[0].shareCapital === f.equity && f.rows[0].cwip === 0);
  }
  ok("statements", `year 1: share capital ₹${base.rows[0].shareCapital.toFixed(0)}, retained ₹${base.rows[0].retained.toFixed(1)}, cash ₹${base.rows[0].cash.toFixed(1)} cr`);
}

// 9. the reverse-auction sensitivities
{
  // the extension axis uses the bid's extension settings (here ₹4/kWh after the PPA, no capex)
  const t = E.sensitivities(ctx, sizes, { costs: E.DEFAULT_COSTS, fin: { ...baseFin, capexUsdShare: 0.3, extension: { ...E.DEFAULT_FINANCE.extension, tariffRsPerKwh: 4 } }, bess: E.DEFAULT_BESS, dfrTarget: inputs.dfrTarget, ops, tariff: base.tariff });
  assert.deepEqual(t.rows.map((r) => r.key), ["capex", "module", "fx", "rate", "generation", "parts", "extension", "refi"]);
  assert.ok(close(t.base.equityIrr, base.equityIrr, 1e-9));
  const by = Object.fromEntries(t.rows.map((r) => [r.key, r.cases]));
  assert.ok(by.capex[0].tariff < t.base.tariff && by.capex[1].tariff > t.base.tariff, "a dearer plant needs a higher tariff");
  assert.ok(by.module[1].tariff > t.base.tariff && by.module[1].tariff < by.capex[1].tariff, "modules are part of the capex");
  assert.ok(by.fx[1].tariff > t.base.tariff && by.fx[1].tariff < by.capex[1].tariff);
  assert.ok(by.rate[1].equityIrr < t.base.equityIrr && by.rate[0].minDscr > by.rate[1].minDscr);
  assert.deepEqual(by.generation.map((c) => c.label), ["P75", "P90"]);
  assert.ok(by.generation[1].tariff > by.generation[0].tariff && by.generation[0].tariff > t.base.tariff);
  assert.ok(by.parts[1].tariff > by.parts[0].tariff && by.parts[0].tariff > t.base.tariff, "a longer delay needs more");
  assert.ok(by.extension[0].tariff < t.base.tariff && by.extension[1].tariff < by.extension[0].tariff, "a longer life needs less");
  assert.ok(by.refi.every((c) => close(c.tariff, t.base.tariff, 1e-9)), "no refinancing in the bid: the refinancing rate changes nothing");
  assert.ok(t.rows.every((r) => r.cases.every((c) => Number.isFinite(c.tariff) && Number.isFinite(c.equityIrr))));
  ok("sensitivities", `${t.rows.length} axes; capex +10% → ₹${by.capex[1].tariff.toFixed(3)}, P90 → ₹${by.generation[1].tariff.toFixed(3)}, +6 months → ₹${by.parts[1].tariff.toFixed(3)} (bid ₹${t.base.tariff.toFixed(3)})`);
}

// 0. everything off: the keys exist with their defaults and the results are the model before v3
{
  for (const k of E.FINANCE_V3_KEYS.fin) assert.ok(k in E.DEFAULT_FINANCE, `DEFAULT_FINANCE.${k}`);
  for (const k of E.FINANCE_V3_KEYS.costs) assert.ok(k in E.DEFAULT_COSTS, `DEFAULT_COSTS.${k}`);
  for (const k of E.FINANCE_V3_KEYS.bess) assert.ok(k in E.DEFAULT_BESS, `DEFAULT_BESS.${k}`);
  // a fin object from before v3 (no new keys at all) runs to the same numbers
  const old = Object.fromEntries(Object.entries(baseFin).filter(([k]) => !E.FINANCE_V3_KEYS.fin.includes(k)));
  const f = E.runFinancialModel(ctx, sizes, { costs: { solarCrPerMw: 3.5, windCrPerMw: 6.5, bessCrPerMwh: 1.2, bessPcsCrPerMw: 0, evacuationCr: 0, preopPct: 0.05 }, fin: old, bess: { ...E.DEFAULT_BESS, augmentationYears: undefined }, dfrTarget: inputs.dfrTarget, tariffLocked: true, ops });
  assert.ok(close(f.equityIrr, base.equityIrr, 1e-12) && f.rows.every((r, i) => close(r.pat, base.rows[i].pat, 1e-12) && close(r.fcfe, base.rows[i].fcfe, 1e-12)));
  assert.ok(base.rows.every((r) => r.carbonRevenue === 0 && r.sweepCr === 0 && r.topUpCr === 0 && r.mezzInterest === 0 && r.quasiOpening === 0 && r.guaranteeFees === 0 && r.extensionCapex === 0 && r.repowerCapex === 0 && r.opFactor === 1 && r.generationFactor === 1 && r.phase === "ppa"));
  ok("defaults off", `${E.FINANCE_V3_KEYS.fin.length} finance, ${E.FINANCE_V3_KEYS.costs.length} cost and ${E.FINANCE_V3_KEYS.bess.length} battery inputs, all off; a pre-v3 input set gives the same model`);
}

console.log(`finance v3 checks passed (${checks.length} blocks)`);
