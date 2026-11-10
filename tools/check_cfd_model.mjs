// Checks for the CfD bid model (web/src/cfd): the tender's terms and dates, the RfS's bid securities,
// charges and eligibility amounts, the day-by-day operation within the sourcing limits, the weekly
// penalty, the Letter of Credit, and the financial model's strike price. Run from the repository root:   node tools/check_cfd_model.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOCUMENTS, TENDER, TERMS, termById } from "../web/src/cfd/terms.js";
import { exampleMw, workedExample } from "../web/src/cfd/example.js";
import {
  BG_YEARS, addMonths, capex as capexOf, capShortfall, contractYears, defaultCfdState, fillBenchmarks, financials, keyDates, lcCr, missingInputs, modelInputs,
  optimiseOwnRe, parseDate, penaltyCr, poolFlows, priceBook, profiles, rfsAmounts, runModel, simulate, solveStrikePrice,
} from "../web/src/cfd/model.js";

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// ---- terms: every one quoted, with document and page; the amended terms are the ones applied
assert.equal(new Set(TERMS.map((t) => t.id)).size, TERMS.length, "unique term ids");
for (const t of TERMS) {
  const doc = DOCUMENTS.find((d) => d.id === t.doc);
  assert.ok(doc && Number.isInteger(t.page) && t.page >= 1 && t.page <= doc.pages, `${t.id}: page within ${t.doc}`);
  assert.ok(t.quote.split(" ").length >= 6 && t.display && t.label, `${t.id}: quote and display`);
}
assert.deepEqual(TERMS.filter((t) => t.status === "replaced").map((t) => t.id), ["ceiling", "slabs", "essThirdParty", "rfsTerm12", "over10", "rfsSlabs", "rfsScd15", "emdShortfall"]);
for (const t of TERMS.filter((t) => t.status === "replaced")) assert.ok(["amd2", "amd3"].includes(t.by), `${t.id}: which amendment replaced it`);
assert.deepEqual(TERMS.filter((t) => t.status === "conflict").map((t) => t.id), ["existingProjects", "essRemote", "essRecognised"], "where the RfS and the CfDA (or the RfS and Amendment-02) still differ");
assert.ok(TERMS.length >= 240, "the audit against the RfS and the three amendments");
assert.ok(TERMS.filter((t) => t.doc === "amd1").length >= 2 && DOCUMENTS.some((d) => d.id === "amd1"), "Amendment-01 is in the pack");
assert.equal(DOCUMENTS.find((d) => d.id === "cfda").file, null, "the CfDA is not provided with the build");
assert.ok(TERMS.filter((t) => t.doc === "rfs").length >= 150, "the RfS is loaded");
assert.equal(DOCUMENTS.find((d) => d.id === "rfs").pdfOffset, 1, "RfS pages are the printed numbers; the PDF has a cover first");
assert.equal(termById.term.doc, "amd3", "the 15-year term is Amendment-03's");
assert.equal(termById.settlement.doc, "amd3", "full CfD settlement is Amendment-03's");
assert.equal(termById.ess.doc, "amd2", "the mandatory X MW / 2X MWh battery is Amendment-02's");
assert.deepEqual([TENDER.mwhPerMwDay, TENDER.peakStart, TENDER.peakEnd, TENDER.termYears, TENDER.essScdMonths, TENDER.reCodMonths], [2, 18, 24, 15, 15, 36]);

// ---- dates
assert.equal(iso(addMonths(parseDate("2027-01-31"), 1)), "2027-02-28", "month end");
const d = keyDates("2027-02-01");
assert.deepEqual(["finClose", "scd", "lastWithPenalty", "reDeadline", "end"].map((k) => iso(d[k])), ["2027-11-01", "2028-05-01", "2028-08-01", "2030-02-01", "2043-05-01"]);
assert.deepEqual(["loa", "docsDue", "pbgUntil"].map((k) => iso(d[k])), ["2027-01-02", "2027-01-22", "2028-11-01"], "LoA = ED − 30 days; PBG and charges 20 days after it; PBG valid to SCD + 6 months");
const cys = contractYears(d.scd, d.end);
assert.equal(cys.length, 16);
assert.deepEqual([cys[0].days, iso(cys[1].start), cys[15].days], [335, "2029-04-01", 30], "Contract Years run April to March");
assert.equal(cys.reduce((a, c) => a + c.days, 0), Math.round((d.end - d.scd) / 86400000));

// ---- the Letter of Credit and the weekly penalty
near(lcCr(100, 5), (2000 * 100 * 5 * 30) / 1e7, 1e-12, "LC = 2000 × MW × (10 − SP) × 30");
assert.equal(lcCr(100, 12), 0, "no LC above ₹10");
near(penaltyCr({ weeks: [{ ref: 10, beyondMwh: 100 }] }, 6), 1.5 * 4 * 100 * 1e-4, 1e-12, "1.5 × (ref − SP) × MWh beyond 10%");
assert.equal(penaltyCr({ weeks: [{ ref: 5, beyondMwh: 100 }] }, 6), 0, "no penalty when the reference is below SP");

// ---- the RfS's amounts for 100 MW contracted with 100 MW solar and 200 MWh of battery
const a = rfsAmounts({ contractedMw: 100, solarMw: 100, windMw: 0, essMwhPerMw: 2, gstRate: 0.18 });
near(a.emdCr, (968000 * 100 + 240000 * 200) / 1e7, 1e-9, "EMD = 9.68 lakh/MW solar + 2.40 lakh/MWh");
near(a.pbgCr, (2420000 * 100 + 600000 * 200) / 1e7, 1e-9, "PBG = 24.20 lakh/MW solar + 6.00 lakh/MWh");
near(rfsAmounts({ contractedMw: 100, solarMw: 0, windMw: 50, essMwhPerMw: 2 }).pbgCr, (3420000 * 50 + 600000 * 200) / 1e7, 1e-9, "PBG: 34.20 lakh/MW wind");
near(a.netWorthCr, (9680000 * 100 + 2400000 * 200) / 1e7, 1e-9, "net worth");
near(a.turnoverCr, 4236900 * 100 / 1e7, 1e-9, "turnover 42,36,900/MW");
near(a.cacCr, 1, 1e-12, "Contract Administration Charges ₹1 lakh/MW");
near(a.bidFeeCr, 0.2, 1e-12, "bid fee ₹20,000/MW");
near(rfsAmounts({ contractedMw: 150 }).bidFeeCr, 0.2, 1e-12, "bid fee at most ₹20 lakh");
near(a.seciChargesCr, (0.005 + 0.2 + 1) * 1.18, 1e-12, "SECI's charges with GST");
near(BG_YEARS.pbg, 21 / 12 + 40 / 365, 1e-12, "PBG held from LoA + 20 days to SCD + 6 months, + 30 days' claim");

// ---- inputs: empty until filled; the benchmarks complete them
assert.ok(missingInputs(defaultCfdState()).includes("Effective Date of the CfDA"));
const st = fillBenchmarks(defaultCfdState());
assert.deepEqual(missingInputs(st), []);
assert.equal(st.filled.solarCuf, true);
assert.equal(st.inputs.contractedMw, 100, "the bid capacity is prefilled");
for (const mw of [49, 151, 99.5]) assert.ok(missingInputs({ ...st, inputs: { ...st.inputs, contractedMw: mw } }).some((m) => /50 to 150 MW/.test(m)), `${mw} MW is not a valid bid (RfS 6.1)`);
assert.deepEqual(missingInputs({ ...st, inputs: { ...st.inputs, contractedMw: 150 } }), []);

// ---- operation on synthetic prices: cheap midday, dear evening
const flat = (fn) => Array.from({ length: 8760 }, (_, t) => fn(t % 24));
const synth = { markets: Object.fromEntries(["DAM", "GDAM", "RTM"].map((m) => [m, { hourlyRsPerMwh: flat((h) => (h >= 9 && h < 16 ? 2500 : h >= 18 ? 9000 : 5000)), hourOfDayMeanRsPerMwh: Array.from({ length: 24 }, (_, h) => (h >= 18 ? 9000 : 4000)) }])) };
const inputs = { ...modelInputs(st), solarMw: 60 };
const book = priceBook(synth, inputs.sellMarket);
assert.deepEqual(book.peakOrder[10].slice(0, 2), [18, 19], "ties: the earlier evening hours");
const sim = simulate(inputs, book, profiles(inputs));
for (const y of sim.years) {
  assert.ok(y.deliveredMwh <= y.requiredMwh + 1e-6, `CY ${y.index}: no more than 2 MWh/MW a day`);
  assert.ok(y.chargeMarketMwh * inputs.rte <= y.marketCapMwh + 1e-6, `CY ${y.index}: green market within its limit`);
  assert.equal(y.chargeGroupMwh, 0, "no group RE when not chosen");
  if (y.end <= sim.dates.reCod) assert.equal(y.chargeOwnMwh, 0, "no own RE before it is commissioned");
}
const late = sim.years.filter((y) => y.start >= sim.dates.extraUntil);
assert.ok(late.every((y) => y.shareMarket <= TENDER.marketShare + 1e-6), "after month 36: green market ≤ 25%");
assert.equal(capShortfall(sim), 0, "60 MW of solar is enough");
near(sim.years[3].deliveredMwh, sim.years[3].requiredMwh * inputs.availability, 1e-6, "supply = 2 MWh/MW × availability");
// too little own RE: the 25% limit binds and days fall short, penalised weekly
const thin = simulate({ ...inputs, solarMw: 5 }, book, profiles(inputs));
assert.ok(capShortfall(thin) > 0 && thin.years[5].shortDays > 0, "5 MW of solar cannot cover 75% of supply");

// ---- finance: the strike price earns exactly the target equity IRR
const s = solveStrikePrice(inputs, sim);
near(s.fin.equityIrr, inputs.targetEquityIrr, 1e-4, "equity IRR at the target");
near(s.fin.equityNpv, 0, 1e-3, "equity NPV at the target is nil");
assert.ok(s.bid >= s.sp && s.bid - s.sp < 0.01, "bid rounded up to two decimals");
near(s.fin.rows[2].cfdRevenue, s.sp * sim.years[1].deliveredMwh * 1e-4, 1e-9, "CfD revenue = SP × energy supplied");
const dearer = solveStrikePrice({ ...inputs, essCrPerMwh: inputs.essCrPerMwh * 1.2 }, sim);
assert.ok(dearer.sp > s.sp, "a dearer battery needs a higher strike price");
const fin = financials(inputs, sim, s.sp);
const capex = fin.rows.reduce((a, r) => a + (r.capex || 0), 0);
near(capex, fin.capex.total, 1e-6, "all capex is spent");
near(capexOf(inputs).seci, rfsAmounts(inputs).seciChargesCr, 1e-12, "SECI's charges are in the project cost");
near(fin.rows[0].bgCost, inputs.pbgCostPct * (fin.emdCr * BG_YEARS.emd + fin.pbgCr * BG_YEARS.pbg), 1e-12, "bank guarantee cost over their validity");
near(fin.pbgCr, (24.2 * inputs.solarMw + 6 * inputs.contractedMw * inputs.essMwhPerMw) / 100, 1e-9, "the PBG follows the plant");
near(fin.rows.at(-1).debtClosing, 0, 1e-6, "debt repaid within the term");
const pool = poolFlows(sim, s.sp);
near(pool[1].netCr, sim.years[1].mcpDeliveredCr - s.sp * sim.years[1].deliveredMwh * 1e-4, 1e-12, "Pool: (MCP − SP) × energy");

// ---- the real IEX price year: the model solves and the optimiser meets every day's supply
const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));

// ---- the worked example: every evening ends at SP × energy; the Pool settles the gap; the week's penalty
const x = workedExample({ mw: 100, sp: 9, prices, market: "DAM", rte: 0.87, solarCuf: 0.25 });
assert.deepEqual([x.commit.dailyMwh, x.commit.weeklyMwh, x.commit.weeklyMinMwh, x.commit.yearlyMwh, x.commit.batteryMwh], [200, 1400, 1260, 73000, 200]);
for (const e of Object.values(x.evenings)) {
  near(e.exchangeLakh + e.poolLakh, e.youLakh, 1e-9, "exchange + Pool = what you keep");
  near(e.youLakh, (9 * 200 * 1000) / 1e5, 1e-9, "you keep SP × 2 MWh/MW");
  assert.ok(e.hours.every((h) => h >= 18 && h < 24) && e.hours.length === 2, "2 hours between 18:00 and 24:00");
}
assert.ok(x.evenings.low.poolLakh > 0 && x.evenings.low.avg <= x.evenings.middle.avg && x.evenings.middle.avg <= x.evenings.high.avg, "cheap evening: the Pool pays");
near(x.charging.solarAlone, (0.75 * 73000) / 0.87 / (8760 * 0.25), 1e-9, "own solar for 75% of the energy");
near(x.charging.solarWithGroup, (0.25 * 73000) / 0.87 / (8760 * 0.25), 1e-9, "own solar for 25% with group RE");
assert.equal(new Date(x.week.start).getUTCDay(), 1, "a Contract Week starts on Monday");
near(x.week.penalisedMwh, 200 - 140, 1e-9, "a missed evening: 200 MWh short, 140 MWh free");
near(x.week.penaltyLakh, (1.5 * Math.max(0, x.week.refPrice - 9) * 60 * 1000) / 1e5, 1e-9, "penalty 1.5 × (ref − SP)");
near(x.year.exchangeCr + x.year.poolCr, x.year.youCr, 1e-9, "a year: exchange + Pool = SP × energy");
assert.equal(x.year.daysPoolPays + x.year.daysYouPay <= 365, true);
assert.equal(workedExample({ mw: 150, sp: 10.5, prices, market: "DAM" }).year.daysYouPay, 0, "above the year's highest price the Pool pays every evening");
assert.equal(exampleMw({ inputs: { contractedMw: 120 } }), 120);
assert.equal(exampleMw({ inputs: { contractedMw: 500 } }), 100, "an invalid bid falls back to 100 MW");
assert.equal(exampleMw({ inputs: { contractedMw: 120 }, example: { mw: 60 } }), 60);
const real = runModel(st, prices);
assert.ok(real.sp > 0 && Number.isFinite(real.fin.equityIrr));
const best = await optimiseOwnRe(st, prices);
assert.ok(best.ok && best.solarMw > 0, "a feasible own-RE size");
const opt = runModel({ ...st, inputs: { ...st.inputs, solarMw: best.solarMw } }, prices);
assert.ok(opt.sp <= real.sp + 1e-9, "the optimised size is no dearer");
assert.equal(capShortfall(opt.sim), 0);

console.log(`CfD model checks passed (strike price ₹${opt.bid.toFixed(2)}/kWh with ${best.solarMw} MW of solar on the benchmark inputs)`);

// ---- market price paths (F.9): two bands, the scenarios, the bidder's own path, the GDAM depth cap
{
  const { PRICE_SCENARIOS, priceBands, pricePathOf, smoothPath } = await import("../web/src/cfd/model.js");
  const base = fillBenchmarks(defaultCfdState());
  base.inputs.contractedMw = 100;
  base.inputs.effectiveDate = base.inputs.effectiveDate || "2026-12-01";
  const real = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
  const run = (patch) => runModel({ ...base, inputs: { ...base.inputs, ...patch } }, real);
  const flat = run({ priceScenario: "flat" });
  const flood = run({ priceScenario: "storageFlood" });
  const tight = run({ priceScenario: "tightGrid" });
  assert.ok(Object.keys(PRICE_SCENARIOS).length === 4, "four scenarios");
  const path = pricePathOf({ priceEscalation: 0.02, priceScenario: "storageFlood" }, 4);
  assert.ok(Math.abs(path.midday[1] - 1.05) < 1e-9 && Math.abs(path.evening[1] - 0.99) < 1e-9, "the scenario adds its slope to the escalation per band");
  assert.ok(flood.sim.years[0].marketCostCr >= flat.sim.years[0].marketCostCr - 1e-9 && flood.sim.years[2].marketCostCr > flat.sim.years[2].marketCostCr, "dearer midday power costs more to charge");
  // the benchmark bid sells its surplus solar at midday: dearer midday prices lower the strike price
  // through the merchant sales more than they raise it through the charging; with no merchant sales
  // only the charging cost is left and the strike price rises
  const sumOf = (m, k) => m.sim.years.slice(0, 15).reduce((a, y) => a + (y[k] || 0), 0);
  assert.ok(sumOf(flood, "merchantRevCr") > sumOf(flat, "merchantRevCr") && sumOf(flood, "marketCostCr") > sumOf(flat, "marketCostCr"), "a storage flood lifts both the merchant revenue and the charging cost");
  assert.ok(flood.sp < flat.sp, "with surplus solar sold, a storage flood lowers the strike price");
  const floodNoSale = run({ priceScenario: "storageFlood", merchant: false });
  const flatNoSale = run({ priceScenario: "flat", merchant: false });
  assert.ok(floodNoSale.sp > flatNoSale.sp, "without merchant sales, a storage flood raises it (charging dearer)");
  assert.ok(flatNoSale.sp > flat.sp + 2, "the benchmark bid leans on merchant sales for several rupees of its strike price");
  assert.ok(Math.abs(tight.sp - flat.sp) < 0.05, "a tight grid (evening only) barely moves a solar-only bid");
  const own = run({ priceScenario: "custom", pricePath: { midday: [1, 1.5, 2], evening: [1, 1, 1] } });
  assert.ok(own.sim.years[1].marketCostCr > flat.sim.years[1].marketCostCr && Math.abs(own.sim.years[0].marketCostCr - flat.sim.years[0].marketCostCr) < 1e-6, "the bidder's own path applies per year, the last value carrying on");
  const sm = smoothPath([1, 1, 4, 1, 1]);
  assert.ok(sm[0] === 1 && sm[4] === 1 && sm[2] < 4 && sm[2] > sm[1] && sm[1] > 1 && Math.abs(sm[1] - sm[3]) < 1e-9, `smoothing evens a spike, the ends kept (${sm.join(", ")})`);
  const bands = priceBands(flat.book);
  assert.ok(bands.midday > 1 && bands.midday < 3 && bands.evening > 7 && bands.evening < 10, `the bands read in rupees (${bands.midday.toFixed(2)}, ${bands.evening.toFixed(2)})`);
  const capped = run({ gdamShareCap: 0.001 });
  assert.ok(capped.sim.years[0].chargeMarketMwh < flat.sim.years[0].chargeMarketMwh * 0.2 && capped.sim.years[0].shortMwh > flat.sim.years[0].shortMwh, "a tiny GDAM depth cap starves market charging");
  const wide = run({ gdamShareCap: 0 });
  assert.ok(Math.abs(wide.sp - flat.sp) < 1e-9, "0 = no cap; 20% does not bind for 100 MW");
  console.log(`CfD market price paths: flat ₹${flat.sp.toFixed(3)}, storage flood ₹${flood.sp.toFixed(3)}, tight grid ₹${tight.sp.toFixed(3)}; bands ₹${bands.midday.toFixed(2)} midday, ₹${bands.evening.toFixed(2)} evening`);
}

// ---- what a unit of own RE costs (the "Own RE at cost" column of the Contract Years table)
{
  const { ownReCostRsPerKwh } = await import("../web/src/cfd/model.js");
  const s = fillBenchmarks(defaultCfdState());
  const c = ownReCostRsPerKwh(s.inputs);
  assert.ok(c > 1.8 && c < 2.8, `own solar on the benchmarks costs about ₹2.3/kWh (${c.toFixed(3)})`);
  assert.ok(ownReCostRsPerKwh({ ...s.inputs, discountRate: 0.14 }) > c, "a higher discount rate makes it dearer");
  assert.equal(ownReCostRsPerKwh({ ...s.inputs, solarMw: 0, windMw: 0 }), null, "no RE, no cost");
}

// ---- the extra battery for evening sale (Design: "Extra battery for evening sale")
{
  const { essTotalMwhPerMw } = await import("../web/src/cfd/model.js");
  const base = fillBenchmarks(defaultCfdState());
  base.inputs.contractedMw = 100;
  base.inputs.effectiveDate = base.inputs.effectiveDate || "2026-12-01";
  const real = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
  const run = (patch) => runModel({ ...base, inputs: { ...base.inputs, ...patch } }, real);
  const none = run({ extraEssMwhPerMw: 0 });
  const plain = run({});
  assert.ok(Math.abs(none.sp - plain.sp) < 1e-9 && none.sim.years.every((y) => y.extraSoldMwh === 0), "no extra battery: nothing changes");
  const extra = run({ extraEssMwhPerMw: 2 });
  assert.equal(essTotalMwhPerMw(extra.inputs), 4, "the whole battery is the tender's 2 MWh plus the extra");
  const y3 = extra.sim.years[2];
  assert.ok(y3.extraSoldMwh > 100 * 2 * 300 * 0.8, `the extra discharges most evenings (${Math.round(y3.extraSoldMwh)} MWh in CY3)`);
  assert.ok(y3.extraRevCr > 0 && y3.merchantRevCr > plain.sim.years[2].merchantRevCr, "its sale adds to the merchant revenue");
  assert.ok(y3.extraChargeOwnMwh + y3.extraChargeMarketMwh > 0.9 * y3.extraSoldMwh / extra.inputs.rte, "it is charged for what it sells");
  assert.ok(capexOf(extra.inputs).ess > capexOf(plain.inputs).ess * 1.9, "its capex is in the project cost");
  assert.ok(rfsAmounts(extra.inputs).emdCr > rfsAmounts(plain.inputs).emdCr, "the EMD and PBG cover the installed battery, the extra included");
  const y1 = extra.sim.years[0];
  assert.ok(y1.shortMwh <= plain.sim.years[0].shortMwh + 1e-6, "the day's commitment is charged first; the extra never starves it");
  // every evening hour injects at most the contracted MW: the extra fills the connection outside the peak hours
  const rec = simulate(extra.inputs, extra.book, extra.prof, { record: [800] }).days[800];
  for (let h = TENDER.peakStart; h < TENDER.peakEnd; h += 1) {
    const inj = (rec.windDirect[h] || 0) + (rec.chosen.includes(h) ? rec.essOut / rec.chosen.length : 0) + rec.extraOut[h] + (rec.sale[h] - rec.extraOut[h]);
    assert.ok(inj <= 100 + 1e-6, `hour ${h} injects within the connection (${inj.toFixed(1)} MW)`);
    if (rec.chosen.includes(h)) assert.ok(rec.extraOut[h] === 0, "the extra is not sold in the peak hours");
  }
  console.log(`CfD extra battery: 2 MWh/MW more sells ${Math.round(y3.extraSoldMwh / 1000)} GWh in CY3 for ₹${y3.extraRevCr.toFixed(1)} cr; strike price ₹${plain.sp.toFixed(3)} → ₹${extra.sp.toFixed(3)}`);
}

// ---- the Design step's plant detail: losses to the billing meter, the battery's state-of-charge
// window, the bid's own hourly profiles (an upload, the monthly redraw, the DC:AC ratio) and the
// shortfall policy
{
  const { BENCHMARKS, lossFactorsOfCfd, profileSourcesOf, designProfiles, socWindow, essTotalMwhPerMw } = await import("../web/src/cfd/model.js");
  const { defaultLosses } = await import("../web/src/bid/model.js");
  const base = fillBenchmarks(defaultCfdState());
  base.inputs.contractedMw = 100;
  base.inputs.effectiveDate = base.inputs.effectiveDate || "2026-12-01";
  base.inputs.solarMw = 30;
  const run = (state) => runModel(state, prices);
  const sum = (sim, k) => sim.years.reduce((a, y) => a + y[k], 0);

  // (a) losses: none set leaves every figure; set, less reaches the meter and the price rises
  const plain = run(base);
  assert.equal(plain.sim.loss, null, "no losses modelled: the factors are off");
  assert.equal(lossFactorsOfCfd(base), null);
  const lossy = run(fillBenchmarks({ ...base, losses: defaultLosses() })); // Fill up grows the battery to what the losses need
  const lf = lossy.sim.loss;
  assert.ok(lf && lf.solar < 1 && lf.meter < 1 && lf.rteBus <= base.inputs.rte + 1e-9, `loss factors applied (solar ${lf.solar.toFixed(4)}, meter ${lf.meter.toFixed(4)}, RTE at bus ${lf.rteBus.toFixed(4)})`);
  assert.ok(sum(lossy.sim, "deliveredMwh") <= sum(plain.sim, "deliveredMwh") + 1e-6, "no more energy reaches the meter with losses");
  assert.ok(sum(lossy.sim, "merchantMwh") < sum(plain.sim, "merchantMwh"), "less surplus is sold at the meter");
  assert.ok(sum(lossy.sim, "chargeMarketMwh") + sum(lossy.sim, "shortMwh") > sum(plain.sim, "chargeMarketMwh") + sum(plain.sim, "shortMwh") - 1e-6, "more is bought, or falls short, to fill the same 2 MWh per MW at the meter");
  assert.ok(lossy.sp > plain.sp, `losses raise the strike price (₹${plain.sp.toFixed(4)} → ₹${lossy.sp.toFixed(4)})`);
  const same = run({ ...base, losses: null });
  near(same.sp, plain.sp, 1e-12, "losses null: the figures stay");

  // (b) the state-of-charge window: usable = (max − min) × nameplate; the tender's 2 MWh per MW must be usable
  assert.equal(socWindow({}), 1, "no window entered: the nameplate is usable");
  near(socWindow({ essSocMin: 0.1, essSocMax: 0.9 }), 0.8, 1e-12, "10% to 90%: 80% usable");
  const windowed = { ...base, inputs: { ...base.inputs, essSocMin: 0.1, essSocMax: 0.9 } };
  const warn = missingInputs(windowed).find((m) => /Battery energy/.test(m));
  assert.ok(warn && /2\.50 MWh per MW nameplate/.test(warn), `the Size check demands 2 / 0.8 = 2.5 MWh per MW nameplate: ${warn}`);
  assert.equal(run(windowed), null, "the bid is not complete until the nameplate covers the window");
  const wi = { ...modelInputs({ ...windowed, inputs: { ...windowed.inputs, essMwhPerMw: 2.5 } }), essMwhPerMw: 2 };
  const wSim = simulate(wi, plain.book, profiles(wi));
  assert.equal(wSim.socWindow, 0.8);
  assert.ok(sum(wSim, "deliveredMwh") < sum(plain.sim, "deliveredMwh") - 1, "2 MWh per MW nameplate with 80% usable delivers less than the mandate");
  const sized = run({ ...windowed, inputs: { ...windowed.inputs, essMwhPerMw: 2.5 } });
  assert.deepEqual(missingInputs({ ...windowed, inputs: { ...windowed.inputs, essMwhPerMw: 2.5 } }).filter((m) => /Battery energy/.test(m)), []);
  near(sum(sized.sim, "deliveredMwh"), sum(plain.sim, "deliveredMwh"), 1e-6, "2.5 MWh nameplate at 80% usable delivers what 2 MWh fully usable does");
  assert.ok(sized.sp > plain.sp, "and costs more: the nameplate is bought");
  assert.equal(essTotalMwhPerMw(sized.inputs), 2.5, "capex and EMD follow the nameplate");

  // (c) an uploaded 8,760-hour profile is the shape profiles() uses, scaled to the CUF, with the monthly redraw
  const morning = Array.from({ length: 8760 }, (_, t) => { const h = t % 24; return h >= 6 && h < 18 ? 0.6 : 0; }); // a flat day block, as no typical shape is
  const up = { ...base, solarUpload: { name: "site-2024.csv", values: morning } };
  assert.ok(profileSourcesOf(base) === null && profileSourcesOf(up)?.solarShape === morning, "the upload is the solar shape");
  const pu = designProfiles(up);
  const cufOf = (cf) => cf.reduce((a, v) => a + v, 0) / cf.length;
  near(cufOf(pu.solar), base.inputs.solarCuf, 1e-9, "scaled to the bid's CUF");
  assert.ok(pu.solar[19] === 0 && pu.solar[5] === 0 && pu.solar[8] > 0 && Math.abs(pu.solar[8] - pu.solar[15]) < 1e-9, "the upload's shape (a flat block from 06:00 to 18:00), not the typical day");
  assert.ok(Math.abs(pu.solar[8] - designProfiles(base).solar[8]) > 1e-6, "which differs from the typical shape");
  const uJan = designProfiles({ ...up, solarMonthScale: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
  near(cufOf(uJan.solar), base.inputs.solarCuf, 1e-9, "the redraw keeps the CUF");
  const jan = (cf) => cf.slice(0, 31 * 24).reduce((a, v) => a + v, 0) / cf.reduce((a, v) => a + v, 0);
  assert.ok(jan(uJan.solar) > jan(pu.solar) * 1.5, "January's share rises with the monthly redraw");
  const sUp = run(up);
  assert.ok(sUp.prof.solar[19] === 0 && Math.abs(sUp.prof.solar[8] - sUp.prof.solar[15]) < 1e-9 && Math.abs(sUp.sp - plain.sp) > 1e-6, "the model prices the uploaded shape");

  // (d) the DC:AC ratio: it is read by profiles() and sets the MWp and the capex per MWp; at the same
  // AC CUF the hourly shape is the same whatever the ratio, because the typical profile is a site
  // irradiance scaled and clipped to the CUF, and only the product (irradiance × DC:AC) is pinned by
  // the CUF: a plant at 1.2 with the same CUF as one at 1.4 sits on a sunnier site and clips as much.
  // (The engine's synthSolarCf multiplies the irradiance by dcAc before that scaling, so its dcAc has
  // no effect on the shape either; the RTC tab's hint that it does is corrected here.)
  const p12 = designProfiles({ ...base, inputs: { ...base.inputs, solarDcAc: 1.2 } });
  const p14 = designProfiles({ ...base, inputs: { ...base.inputs, solarDcAc: 1.4 } });
  near(cufOf(p12.solar), cufOf(p14.solar), 1e-9, "same CUF");
  assert.ok(p12.solar.every((v, t) => Math.abs(v - p14.solar[t]) < 1e-9), "the same hourly shape at the same AC CUF, whatever the ratio");
  near(cufOf(designProfiles(base).solar), cufOf(p14.solar), 1e-12, "1.4 is the ratio used when none is entered");
  assert.equal(BENCHMARKS.solarDcAc, 1.4);
  near(capexOf({ ...base.inputs, solarMw: 10, solarDcAc: 1.2 }).solar, 10 * base.inputs.solarCrPerMw, 1e-9, "the capex is per MWac; 10 MWac at 1.2 is 12 MWp, so ₹/MWp = ₹/MWac ÷ 1.2 (the Design card's note)");

  // (e) the shortfall policy: "meet" keeps only plants that meet every day; "pay" prices the penalty
  const small = { ...base, inputs: { ...base.inputs, solarMw: 5, useMarket: false } };
  const sSmall = run(small);
  assert.ok(capShortfall(sSmall.sim) > 0 && sum(sSmall.sim, "shortDays") > 0, "5 MW of solar without market power falls short");
  const pen = sSmall.sim.years.reduce((a, y) => a + penaltyCr(y, sSmall.sp), 0);
  assert.ok(pen > 0, `the weekly penalty is charged (₹${pen.toFixed(1)} cr over the term)`);
  assert.ok(financials(sSmall.inputs, sSmall.sim, sSmall.sp).rows.some((r) => r.penalty > 0), "and sits in the financial model's rows");
  const meet = await optimiseOwnRe({ ...small, inputs: { ...small.inputs, shortfallPolicy: "meet" } }, prices);
  const pay = await optimiseOwnRe({ ...small, inputs: { ...small.inputs, shortfallPolicy: "pay" } }, prices);
  assert.equal(meet.policy, "meet");
  assert.equal(pay.policy, "pay");
  assert.ok(meet.ok || meet.short <= pay.short + 1e-6, "meet: a plant that meets every day, else the least short");
  assert.ok(pay.sp <= meet.sp + 1e-9, `pay: no dearer than the meet plant (₹${pay.sp.toFixed(4)} vs ₹${meet.sp.toFixed(4)})`);
  if (pay.short > 1e-6) assert.ok(pay.solarMw < meet.solarMw, "a smaller plant whose penalty is cheaper than more solar");
  console.log(`CfD design checks passed: losses ₹${plain.sp.toFixed(4)} → ₹${lossy.sp.toFixed(4)}; SoC 10–90% needs 2.5 MWh/MW nameplate; policy meet ${meet.solarMw} MW (${meet.ok ? "every day met" : `${Math.round(meet.short)} MWh short`}) vs pay ${pay.solarMw} MW (${Math.round(pay.short)} MWh short, ₹${pay.sp.toFixed(4)})`);
}

// ---- the battery the tender's 2 MWh per MW needs once the SoC window and the losses are in; Fill up sets it
{
  const { essRequiredPerMw } = await import("../web/src/cfd/model.js");
  const { defaultLosses } = await import("../web/src/bid/model.js");
  const base = fillBenchmarks(defaultCfdState());
  base.inputs.contractedMw = 100;
  base.inputs.effectiveDate = base.inputs.effectiveDate || "2026-12-01";
  assert.equal(essRequiredPerMw(base).energy, 2, "no window, no losses: 2 MWh per MW");
  const win = { ...base, inputs: { ...base.inputs, essSocMin: 0.1, essSocMax: 1 } };
  assert.ok(missingInputs(win).some((m) => /2\.25 MWh per MW/.test(m)), `the window asks for 2.25 MWh per MW (${missingInputs(win).join(" | ")})`);
  const filled = fillBenchmarks(win);
  assert.ok(Math.abs(filled.inputs.essMwhPerMw - 2.25) < 1e-9 && filled.filled.essMwhPerMw && missingInputs(filled).length === 0, "Fill up sets the nameplate and nothing is missing");
  const lossy = { ...filled, losses: defaultLosses() };
  const need = essRequiredPerMw(lossy);
  assert.ok(need.meter < 1 && need.energy >= 2.25 && need.power > 1, `losses to the meter raise the need (${need.energy} MWh, ${need.power} MW per MW)`);
  const filled2 = fillBenchmarks(lossy);
  assert.ok(filled2.inputs.essMwhPerMw >= need.energy - 1e-9 && filled2.inputs.essMwPerMw >= need.power - 1e-9 && missingInputs(filled2).length === 0, "Fill up covers the losses too");
  const noAug = { ...base, inputs: { ...base.inputs, augmentation: "none", essDegradation: 0.02 } };
  assert.ok(essRequiredPerMw(noAug).shortYear === 2, `without augmentation a 2 MWh per MW battery falls short from year 2 (${essRequiredPerMw(noAug).shortYear})`);
  console.log(`CfD battery need: window 90% → ${essRequiredPerMw(win).energy} MWh/MW; with losses → ${need.energy} MWh and ${need.power} MW per MW; no augmentation at 2%/yr → short from year ${essRequiredPerMw(noAug).shortYear}`);
}

// ---- the finance team's augmentation schedule reaches the day-by-day operation: the battery's usable
// capacity is restored in the scheduled years (the shared engine's convention), not faded from year 1
{
  const { bessCapFactor } = await import("../web/src/cfd/model.js");
  const base = { essDegradation: 0.02, augmentation: "none" };
  near(bessCapFactor(base, 1), 1, 1e-12, "year 1 at nameplate");
  near(bessCapFactor(base, 6), 0.9, 1e-12, "no augmentation: faded from year 1");
  near(bessCapFactor({ ...base, augmentation: "annual" }, 10), 1, 1e-12, "annual: kept");
  const sched = { ...base, augmentationMode: "schedule", augmentationYears: [4, 8] };
  near(bessCapFactor(sched, 3), 0.96, 1e-12, "schedule: fading before the first augmentation");
  near(bessCapFactor(sched, 4), 1, 1e-12, "schedule: restored in the augmentation year");
  near(bessCapFactor(sched, 7), 0.94, 1e-12, "schedule: fading since year 4");
  near(bessCapFactor(sched, 9), 0.98, 1e-12, "schedule: fading since year 8");
  near(bessCapFactor({ ...base, augmentationMode: "oneTime", augmentationYear: 5 }, 5), 1, 1e-12, "one-time: restored in its year");
  near(bessCapFactor({ ...base, augmentationMode: "oneTime", augmentationYear: 5 }, 4), 0.94, 1e-12, "one-time: faded before it");
  const st = fillBenchmarks(defaultCfdState());
  st.inputs.solarMw = 160;
  st.bess = { augmentation: "schedule", augmentationYears: [4] };
  const mi = modelInputs(st);
  assert.equal(mi.augmentationMode, "schedule");
  assert.deepEqual(mi.augmentationYears, [4]);
  console.log("CfD battery augmentation schedule reaches the operation: ok");
}
