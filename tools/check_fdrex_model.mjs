// Checks for the SECI-FDRE-X bid model (web/src/fdrex/tender.js, model.js, finance.js, checks.js):
// the tender's numbers agree with the quoted terms; the inputs are this tender's; the dates follow
// the Effective Date of the PPA; the day-by-day operation supplies 4 MWh per MW in four evening
// hours, 1 MWh per MW in an hour, buys within 5% of the year's energy and counts each billing
// month's shortfall beyond 10%; the penalty is 1.5 x the tariff on it (the PPA's own example); the
// financial model solves the tariff for the target equity IRR with the PSM discount and the
// monthly penalty in it; the optimiser finds the own RE; the workbook request carries nothing of
// the CfD-I tender it was forked from. Run from the repository root:
//   node tools/check_fdrex_model.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TENDER } from "../web/src/fdrex/tender.js";
import * as M from "../web/src/fdrex/model.js";
import { cfdEngineInputs, cfdLiveRequest, cfdModelExport, quoteOf, runCfdFinance } from "../web/src/fdrex/finance.js";
import { sizingChecks } from "../web/src/fdrex/checks.js";
import { liveModelInput } from "../web/lib/liveModel.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
const DAY = 86400000;

// ---- the tender's numbers: the model's and the quoted terms' are the same figures
assert.ok(TENDER.mwhPerMwDay === 4 && TENDER.peakHours === 4 && TENDER.maxMwhPerMwHour === 1 && TENDER.termYears === 25 && TENDER.essScdMonths === 18);
assert.ok(TENDER.marketShare === 0.05 && TENDER.extraMarketShare === 0 && TENDER.groupShare === 0 && TENDER.shortfallTolerance === 0.1 && TENDER.penaltyMultiple === 1.5);
assert.ok(TENDER.bidMinMw === 50 && TENDER.bidMaxMw === 600 && TENDER.totalMw === 1200);
{
  // the model's own readings and the names it inherited, on the quoted terms' figures
  const T = (await import("../web/src/fdrex/terms.js")).TENDER;
  assert.ok(T.scdMonths === 18 && TENDER.reCodMonths === 18 && TENDER.loaToEdDays === T.intimationToEdDays && TENDER.loaToEdDays === 15 && TENDER.docsDueDays === 30);
  assert.ok(TENDER.cacLakhPerMw === T.successChargeLakhPerMw && TENDER.cacLakhPerMw === 1 && TENDER.pbgAfterScdMonths === 9 && TENDER.psmChargeRsPerKwh === 0.02);
  assert.ok(TENDER.peakStart === 18 && TENDER.peakEnd === 24 && TENDER.essHoursMin === 4 && T.essHoursMin === null && T.peakStart === null, "the evening window and the 4-hour battery are the model's reading, not the tender's");
}

// ---- the inputs are this tender's
{
  const keys = new Set(M.FIELDS.map((f) => f.key));
  for (const gone of ["reCodMonths", "groupPrice", "groupCharges", "recPrice", "lcCostPct"]) assert.ok(!keys.has(gone), `${gone} is not an input of this tender`);
  assert.ok(!("useGroup" in M.CHOICES) && "psm" in M.CHOICES && "dayInjection" in M.CHOICES);
  const f = (k) => M.FIELDS.find((x) => x.key === k);
  assert.ok(f("contractedMw").min === 50 && f("contractedMw").max === 600 && f("essMwhPerMw").min === 4 && f("tenorYears").max === 25);
  assert.equal(M.STORAGE_KEY, "fdre.fdrex.v1");
  const blank = M.defaultCfdState();
  assert.ok(M.missingInputs(blank).length > 20, "an empty bid lists what is needed");
  const filled = M.fillWinning(blank);
  assert.deepEqual(M.missingInputs(filled), [], "Fill up completes the bid");
  assert.equal(filled.inputs.dayInjection, false, "connectivity with non-solar-hour access only, as the tender asks, unless the bidder says otherwise");
  assert.ok(filled.inputs.essMwhPerMw === 4 && filled.inputs.psm === true && filled.inputs.tenorYears === 20 && filled.filled.tenorYears === "winning");
  const bad = (patch) => M.missingInputs({ ...filled, inputs: { ...filled.inputs, ...patch } });
  assert.ok(bad({ contractedMw: 49 }).some((m) => /50 to 600/.test(m)) && bad({ contractedMw: 601 }).length === 1 && bad({ contractedMw: 600 }).length === 0);
  assert.ok(bad({ essMwhPerMw: 3.5 }).some((m) => /at least 4 MWh/.test(m)), "the battery must carry the four hours");
  assert.ok(bad({ psm: null }).some((m) => /Payment Security/.test(m)), "the PSM choice is asked");
  assert.ok(bad({ dayInjection: null }).some((m) => /solar hours/.test(m)), "and whether the connectivity covers the solar hours");
}

// ---- dates from the Effective Date of the PPA
{
  const d = M.keyDates("2027-06-01");
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  assert.equal(iso(d.scd), "2028-12-01", "SCSD 18 months from the Effective Date");
  assert.equal(iso(d.end), "2053-12-01", "25 years from the SCSD");
  assert.equal(iso(d.loa), "2027-05-17", "SECI's intimation 15 days before the Effective Date");
  assert.equal(iso(d.docsDue), "2027-06-16", "documents, PBG and Success Charges within 30 days of the intimation");
  assert.equal(iso(d.finClose), "2028-06-01", "Financial Closure 6 months before the SCSD");
  assert.equal(iso(d.lastWithPenalty), "2029-06-01", "6 months of delay with the PBG encashed");
  assert.equal(iso(d.pbgUntil), "2029-09-01", "PBG valid to 9 months after the SCSD");
  assert.equal(d.reDeadline, d.scd, "one commissioning date for the whole Project");
  near(M.BG_YEARS.pbg, 27 / 12 + 15 / 365, 1e-12, "the PBG is held from 15 days after the Effective Date to 9 months after the SCSD, plus the claim period");
}

// ---- what the RfS asks of the bid
{
  const a = M.rfsAmounts({ contractedMw: 100, solarMw: 130, windMw: 20, essMwhPerMw: 4, essMwPerMw: 1, gstRate: 0.18 });
  near(a.emdCr, (130 * 9.68 + 20 * 13.68 + 400 * 2.4) / 100, 1e-12, "EMD on the installed capacities");
  near(a.pbgCr, (130 * 24.2 + 20 * 34.2 + 400 * 6) / 100, 1e-12, "PBG on the installed capacities");
  assert.equal(a.installedMw, 550, "installed capacity: the RE's MW and the battery's MWh (RfS 18.1)");
  near(a.cacCr, 5.5, 1e-12, "Success Charges of Rs 1 lakh on each");
  near(a.bidFeeCr, 0.2, 1e-12, "bid processing fee capped at Rs 20 lakh");
  near(a.seciChargesCr, (0.005 + 0.2 + 5.5) * 1.18, 1e-12, "SECI's charges with GST");
  near(a.turnoverCr, 78.7625, 1e-12, "turnover per contracted MW");
}

// ---- the PPA's own example of the penalty: (0.90 x 3 - 2) MU x Rs 2.7 x 1.5 = Rs 28.35 lakh
near(M.penaltyCr({ months: [{ beyondMwh: (0.9 * 3 - 2) * 1000 }] }, 2.7), 0.2835, 1e-12, "PPA 4.4.1.b's example");
assert.equal(M.lcCr(100, 5), 0, "no Letter of Credit in this tender");
assert.ok(M.psmDiscount({ psm: true }) === 0.02 && M.psmDiscount({ psm: false }) === 0);

// ---- the day-by-day operation
const base = M.fillWinning(M.defaultCfdState());
base.inputs = { ...base.inputs, contractedMw: 100, solarMw: 130 };
base.filled = { ...base.filled, solarMw: false };
const withInputs = (patch) => ({ ...base, inputs: { ...base.inputs, ...patch } });
const model = M.runModel(base, prices);
const X = 100;
{
  const { opYears, sim } = model;
  assert.equal(opYears.length, 25, "25 operating years");
  for (const y of opYears) {
    near(y.requiredMwh, X * 4 * y.days, 1e-12, `year ${y.index}: 4 MWh per MW a day`);
    assert.ok(y.deliveredMwh <= y.requiredMwh * base.inputs.availability + 1e-6, `year ${y.index}: no more than the mandate at the plant's availability`);
    assert.ok(y.chargeGroupMwh === 0 && y.groupCostCr === 0 && y.recMwh === 0, "no group RE and no RECs");
    // a month is counted in the year its last day falls in: 365-day years drift a day over each leap year
    assert.ok(Array.isArray(y.months) && y.months.length >= 11 && y.months.length <= 13 && y.weeks === undefined, `year ${y.index}: ${y.months?.length} billing months`);
  }
  assert.equal(sum(opYears, (y) => y.months.length), 300, "every billing month of the 25 years, once (December 2028 to November 2053)");
  near(sum(sim.years, (y) => sum(y.months, (m) => m.required)), sum(sim.years, (y) => y.requiredMwh), 1e-9, "the months carry the whole requirement");
  near(sum(sim.years, (y) => sum(y.months, (m) => m.supplied)), sum(sim.years, (y) => y.deliveredMwh), 1e-9, "and the whole supply");
  for (const y of sim.years) assert.ok(y.marketOfRequired <= TENDER.marketShare + 1e-9, `Contract Year ${y.index}: bought power ${(y.marketOfRequired * 100).toFixed(2)}% of the energy to be supplied, within 5%`);
  assert.ok(sim.years.some((y) => y.marketOfRequired > 0.01), "the green market is used where own RE is short");
  // a day's hours: four of 18:00 to 24:00, 1 MWh per MW in each at most
  const rec = M.simulate(model.inputs, model.book, model.prof, { record: [10, 200] }).days;
  for (const k of [10, 200]) {
    const d = rec[k];
    assert.ok(d.chosen.length === 4 && d.chosen.every((h) => h >= 18 && h < 24) && new Set(d.chosen).size === 4, "four evening hours");
    assert.ok(d.delivered <= X * 4 * base.inputs.availability + 1e-6 && d.essOut / 4 <= X + 1e-6, "1 MWh per MW in an hour at most");
    near(d.required, 400, 1e-12, "400 MWh for 100 MW");
    assert.ok(d.market.slice(18).every((v) => v === 0) && d.own.slice(18).every((v) => v === 0), "the battery charges before 18:00");
    assert.ok(d.sale.slice(6, 18).every((v) => v === 0), "non-solar-hour access: nothing is injected from 06:00 to 18:00");
  }
  // with connectivity in the solar hours too, the day's surplus is sold and the bid needs less
  const day = M.runModel(withInputs({ dayInjection: true }), prices);
  assert.ok(day.opYears[0].merchantMwh > opYears[0].merchantMwh + 1000 && day.opYears[0].curtailedMwh < opYears[0].curtailedMwh - 1000, `the surplus is sold, not curtailed: ${Math.round(day.opYears[0].merchantMwh)} MWh against ${Math.round(opYears[0].merchantMwh)}`);
  assert.ok(day.sp < model.sp - 0.3, `and the tariff is lower: ₹${day.sp.toFixed(3)} against ₹${model.sp.toFixed(3)}`);
  near(day.opYears[0].deliveredMwh, opYears[0].deliveredMwh, 1e-12, "the PPA supply is the same");
  // the dates the operation ran on
  assert.equal(sim.dates.reCod, sim.dates.scd, "the RE is on from the SCSD");
  // without the green market nothing is bought
  const own = M.runModel(withInputs({ useMarket: false }), prices);
  assert.equal(sum(own.opYears, (y) => y.chargeMarketMwh), 0);
  assert.ok(sum(own.opYears, (y) => y.shortDays) >= sum(opYears, (y) => y.shortDays), "and no fewer days fall short");
}

// ---- a short plant: the months' shortfall beyond 10% and the penalty on it
const short = M.runModel(withInputs({ solarMw: 60, shortfallPolicy: "pay", augmentation: "none" }), prices);
{
  for (const y of short.sim.years) assert.ok(y.marketOfRequired <= TENDER.marketShare + 1e-9, "a short year still buys within 5% of the energy required");
  assert.ok(short.sim.years.some((y) => y.marketOfRequired > 0.0499), "and uses the whole allowance");
  assert.equal(sizingChecks(short).find((c) => c.id === "market").status, "met");
  const months = short.sim.years.flatMap((y) => y.months);
  assert.ok(months.some((m) => m.beyondMwh > 0), "some months fall more than 10% short");
  for (const m of months) near(m.beyondMwh, Math.max(0, 0.9 * m.required - m.supplied), 1e-9, "a month's energy short beyond the 10%");
  assert.ok(months.some((m) => m.supplied < m.required - 1 && m.beyondMwh === 0), "a month short by less than 10% carries no penalty");
  const y = short.sim.years.find((c) => M.penaltyMwh(c) > 0);
  near(M.penaltyCr(y, 6), 1.5 * 6 * M.penaltyMwh(y) * 1e-4, 1e-12, "1.5 x the tariff on the energy short");
  const checks = sizingChecks(short);
  assert.deepEqual(checks.map((c) => c.id), ["capacity", "ess", "market", "daily", "monthly"]);
  assert.ok(checks.find((c) => c.id === "monthly").status === "info" && checks.find((c) => c.id === "daily").status === "info", "paying the penalty is the bidder's policy: to watch");
}
{
  const checks = sizingChecks(model);
  assert.ok(checks.find((c) => c.id === "capacity").status === "met" && checks.find((c) => c.id === "ess").status === "met" && checks.find((c) => c.id === "market").status === "met");
}

// ---- the financial model
const finance = runCfdFinance(base, model);
{
  assert.ok(finance.tariff > 3 && finance.tariff < 20, `the tariff: ₹${finance.tariff}`);
  near(finance.equityIrr, base.inputs.targetEquityIrr, 1e-6, "the equity IRR is the target at the solved tariff");
  assert.equal(finance.rows.length, 25);
  const eng = cfdEngineInputs(base, model);
  assert.ok(eng.fin.blockPenaltyMultiple === 1.5 && eng.fin.lcCostPct === 0 && eng.fin.cfdPenaltyMultiple === 0 && eng.fin.tariffEscalation === 0);
  assert.equal(eng.lateRe, undefined);
  const r = finance.rows[0];
  const o = model.opYears[0];
  near(r.energyRevenue, finance.tariff * o.deliveredMwh * 1e-4, 1e-9, "PPA revenue: the tariff on the energy supplied");
  near(r.pxFees, (0.02 * o.deliveredMwh + base.inputs.pxFee * o.merchantMwh) * 1e-4, 1e-9, "the PSM discount and the exchange fees on market sales");
  near(r.charging, o.marketCostCr, 1e-9, "charging power bought");
  assert.ok(finance.rows.every((x) => !(x.lcCost > 0) && !(x.cfdPenalty > 0)), "no Letter of Credit and no weekly penalty");
  near(finance.capex.total, finance.debt + finance.equity, 1e-9, "debt and equity make the project cost");
  // without the PSM the same bid needs Rs 0.02 less
  const noPsm = runCfdFinance(withInputs({ psm: false }), M.runModel(withInputs({ psm: false }), prices));
  near(finance.tariff - noPsm.tariff, 0.02, 0.15, "the PSM discount is in the tariff");
  assert.ok(finance.tariff > noPsm.tariff);
  // the screening model and the full model price the same bid within a rupee
  assert.ok(Math.abs(model.sp - finance.tariff) < 1, `screening ₹${model.sp.toFixed(3)} against ₹${finance.tariff.toFixed(3)}`);
  assert.equal(quoteOf(7.4321), 7.44);
  // the monthly penalty in the engine: 1.5 x the year's tariff on the energy short
  const fs = runCfdFinance(short.state || withInputs({ solarMw: 60, shortfallPolicy: "pay", augmentation: "none" }), short);
  const k = short.opYears.findIndex((y) => M.penaltyMwh(y) > 0);
  near(fs.rows[k].blockPenalty, 1.5 * fs.tariff * M.penaltyMwh(short.opYears[k]) * 1e-4, 1e-9, "the engine's monthly penalty");
  near(fs.rows[k].penalty, fs.rows[k].blockPenalty, 1e-12, "and nothing else in the penalty");
  // what the supply is worth on the exchange
  const worth = M.exchangeValue(model.sim, finance.tariff);
  const cy = model.sim.years[1];
  near(worth[1].netCr, cy.mcpDeliveredCr - finance.tariff * cy.deliveredMwh * 1e-4, 1e-12, "exchange value less the tariff paid");
  assert.ok(worth[1].mcpAvg > 2 && worth[1].mcpAvg < 15, `the evening exchange price of the hours supplied: ₹${worth[1].mcpAvg.toFixed(2)}`);
}

// ---- the optimiser: the own RE for the least tariff with every day met
{
  const pricer = (inputs, sim) => runCfdFinance({ ...base, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
  const start = M.runModel(base, prices, { price: pricer });
  const best = await M.optimiseOwnRe(base, prices, { price: pricer });
  assert.ok(best.ok && best.solarMw > 0 && best.sp <= start.sp + 1e-9, `solar ${best.solarMw} MWac at ₹${best.sp.toFixed(3)} (from ₹${start.sp.toFixed(3)} at ${base.inputs.solarMw} MWac)`);
  near(start.sp, finance.tariff, 1e-9, "the tab's price is the full model's");
}

// ---- the workbook request: this tender's, nothing of CfD-I
{
  const body = cfdModelExport({ state: base, model, finance });
  const text = JSON.stringify({ ...body, rows: null, live: { ...body.live, app: null } });
  const left = text.match(/CfD|strike price|Strike price|the Pool|Letter of Credit|weekly|Contract Week|group RE|RECs?\b/g);
  assert.equal(left, null, `the workbook request speaks of this tender only: ${left ? [...new Set(left)].join(", ") : ""}`);
  assert.ok(body.fileName === "SECI_FDRE-X_bid_100MW_financial_model" && body.tenderNumber === "SECI/C&P/IPP/13/0012/26-27");
  assert.ok(body.cover.outputs[0][0].startsWith("Tariff to bid") && body.cover.outputs[0][1] === quoteOf(finance.tariff));
  const live = liveModelInput(cfdLiveRequest({ state: base, model, finance }));
  assert.ok(live.labels && live.labels.blockPen === "Monthly shortfall penalty" && live.labels.pxFeeCost === "PSM discount and exchange fees", "the workbook's rows are named for this tender");
  assert.ok(live.ops.length === 25 && live.ops.every((o) => !(o.lcMw > 0) && !(o.penaltyWeeks || []).length), "no Letter of Credit or weekly penalty rows");
  assert.equal(live.fin.blockPenaltyMultiple, 1.5);
}

console.log(`OK  SECI-FDRE-X model: 100 MW with 130 MWac solar needs ₹${finance.tariff.toFixed(3)}/kWh (quote ₹${quoteOf(finance.tariff).toFixed(2)}); dates, sourcing within 5%, monthly penalty, PSM discount, optimiser, workbook request`);
