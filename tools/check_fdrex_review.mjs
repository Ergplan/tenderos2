// Checks for the SECI-FDRE-X Bid review (web/src/fdrex/review.js) and 15-minute dispatch
// (web/src/fdrex/dispatch15.js).
//
// The review, on three bids: the default filled bid (connectivity for the non-solar hours only, so
// the day's surplus solar is curtailed), one with too little solar and the penalty paid, and one
// with connectivity in the solar hours too. Every finding is well-formed (a severity, a title, a
// detail, a step of the tab and, where it cites, a term of terms.js) and none speaks of what this
// tender does not have (a strike price, the CfD Pool, Contract Weeks, group RE, RECs, a Letter of
// Credit).
//
// The dispatch, on FDRE-X models: 16 peak blocks a day inside 18:00 to 24:00, a day's blocks sum
// to the day's energy in the model's hourly record, every Contract Year's sums equal the model's,
// no block charges from own RE more than it generates, and nothing is injected between 06:00 and
// 18:00 when the bid has no connectivity in the solar hours.
// Run from the repository root:   node tools/check_fdrex_review.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TENDER } from "../web/src/fdrex/tender.js";
import { termById } from "../web/src/fdrex/terms.js";
import { defaultCfdState, fillBenchmarks, fillWinning, missingInputs, penaltyCr, runModel, simulate } from "../web/src/fdrex/model.js";
import { runCfdFinance } from "../web/src/fdrex/finance.js";
import { sizingChecks } from "../web/src/fdrex/checks.js";
import { peakAward, reviewBid } from "../web/src/fdrex/review.js";
import { BLOCKS_PER_DAY, BLOCK_COLUMNS, DT, SUMMARY_COLUMNS, blockContext, dayBlocks, dispatch15, splitHourly } from "../web/src/fdrex/dispatch15.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const pricerOf = (s) => (inputs, sim) => runCfdFinance({ ...s, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
const filled = (patch = {}) => { const s = fillWinning(fillBenchmarks(defaultCfdState())); return { ...s, inputs: { ...s.inputs, ...patch } }; };
const bidOf = (state) => {
  assert.deepEqual(missingInputs(state), [], "the bid is complete");
  const model = runModel(state, prices, { price: pricerOf(state) });
  assert.ok(model && model.sim && model.finance, "the bid runs through the full financial model");
  const finance = runCfdFinance(state, model);
  return { state, model, finance, out: reviewBid({ state, model, finance, prices }) };
};

// ---------------------------------------------------------------- the review

const STEPS = ["bid", "design", "financeInputs", "size", "whatif", "reference", "finance"]; // the tab's steps a finding may send the reader to
const NOT_THIS_TENDER = /strike price|\bCfD|\bPool\b|\bweek|group RE|group-company|\bRECs?\b|Letter of Credit|36 months|15 years|2 MWh/i;
const ids = (out) => out.findings.map((f) => f.id);
const find = (out, id) => out.findings.find((f) => f.id === id);
const sev = (out, id) => find(out, id)?.severity;
let findings = 0;
function wellFormed(out, name) {
  assert.ok(typeof out.summary === "string" && out.summary.length > 10, `${name}: a summary`);
  assert.equal(new Set(ids(out)).size, out.findings.length, `${name}: finding ids are unique`);
  for (const f of out.findings) {
    const where = `${name}, ${f.id}`;
    assert.ok(["block", "warn", "note"].includes(f.severity), `${where}: severity`);
    assert.ok(typeof f.title === "string" && f.title.length > 10 && typeof f.detail === "string" && f.detail.length > 10, `${where}: a title and a detail`);
    assert.ok(STEPS.includes(f.step), `${where}: step "${f.step}" is a step of the tab`);
    if (f.cite !== undefined) assert.ok(termById[f.cite], `${where}: cites "${f.cite}", which is not a term of terms.js`);
    const text = `${f.title} ${f.detail}`;
    assert.ok(!NOT_THIS_TENDER.test(text), `${where}: speaks of what FDRE-X does not have: "${text.match(NOT_THIS_TENDER)?.[0]}"`);
    assert.ok(!/undefined|NaN|₹–|–\/kWh|\[object/.test(text), `${where}: a number is missing: ${text}`);
    assert.ok(!text.includes("—"), `${where}: no em dash`);
    findings += 1;
  }
  const c = out.counts;
  assert.ok(c && c.block + c.warn + c.note === out.findings.length, `${name}: the counts add up`);
  for (const id of ["buyer-hours", "psm"]) assert.equal(sev(out, id), "note", `${name}: the "${id}" note is always there`);
}

const award = peakAward();
assert.ok(award && award.lo > 0 && award.hi >= award.lo && award.hi < 12 && /FDRE/.test(award.tender), "an FDRE peak-power award to compare with");

// ---- 1. the default filled bid: connectivity for the non-solar hours only
const plain = bidOf(filled());
{
  const { state, model, finance, out } = plain;
  wellFormed(out, "default bid");
  assert.equal(model.inputs.dayInjection, false, "the default bid has no connectivity in the solar hours");
  const checks = sizingChecks(model, state);
  assert.deepEqual(checks.map((c) => c.id), ["capacity", "ess", "market", "daily", "monthly"], "the tender's five checks");
  for (const c of checks) if (c.status !== "met") assert.ok(ids(out).includes(`tender-${c.id}`), `the "${c.id}" check that is not met is a finding`);
  // the day's surplus solar is curtailed, and the review says so and what would turn it into revenue
  const ops = model.sim.opYears;
  const gen = ops.reduce((a, o) => a + o.solarMwh + o.windMwh, 0);
  const curtailed = ops.reduce((a, o) => a + o.curtailedMwh, 0);
  assert.ok(curtailed > 0.1 * gen, `a material share of the own RE is curtailed (${(100 * curtailed / gen).toFixed(0)}%)`);
  assert.equal(sev(out, "no-day-connectivity"), "warn");
  const f = find(out, "no-day-connectivity");
  assert.equal(f.cite, "connectivityApplied");
  assert.ok(f.title.includes(`${(curtailed / ops.length / 1000).toFixed(1)} GWh a year`), `the curtailed energy a year is named: ${f.title}`);
  assert.match(f.detail, /Connectivity that covers the solar hours.*screening tariff would fall by ₹\d.*SECI buying it as excess generation at the tariff/, "both ways to turn it into revenue");
  assert.ok(!ids(out).includes("day-connectivity"), "no reliance on solar-hour connectivity to note");
  assert.match(find(out, "psm").title, /is taken: ₹0\.02\/kWh off every bill/);
  assert.match(find(out, "buyer-hours").title, /chooses the 4 hours each day; the model takes the 4 dearest hours of 18:00 to 24:00/);
  const drivers = find(out, "price-drivers");
  assert.ok(drivers && /capex ₹\d/.test(drivers.title) && drivers.detail.includes("PSM discount"), `what carries the tariff: ${drivers?.title}`);
  assert.ok(finance.tariff > award.hi && ["warn", "block"].includes(sev(out, "price-market")), "the tariff is set against the peak-power awards");
  assert.equal(sev(out, "price-market"), finance.tariff > 1.5 * award.hi ? "block" : "warn");
}

// ---- 2. too little solar, the penalty paid
const short = bidOf(filled({ solarMw: 60, shortfallPolicy: "pay" }));
{
  const { model, finance, out } = short;
  wellFormed(out, "too little solar");
  const years = model.sim.years;
  const months = years.reduce((a, y) => a + y.months.filter((w) => w.beyondMwh > 1e-6).length, 0);
  const penalty = years.reduce((a, y) => a + penaltyCr(y, finance.tariff), 0);
  assert.ok(months > 0 && penalty > 0, "billing months fall short beyond 10%");
  near(finance.rows.reduce((a, r) => a + (r.blockPenalty || 0), 0), penalty, 1e-6 * penalty + 1e-6, "the financial model's monthly penalty is 1.5 x the tariff on the months' energy short beyond 10%");
  const f = find(out, "monthly-penalty");
  assert.ok(f && f.severity === "warn" && f.cite === "shortfall", "the monthly penalty is a finding that carries cost");
  assert.ok(f.title.startsWith(`${months.toLocaleString("en-IN")} of `) && f.title.includes(`₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(penalty)} cr`), `the months and the penalty are the model's: ${f.title}`);
  assert.match(f.detail, /at 1\.5 × the tariff of ₹/);
  assert.equal(sev(out, "little-own-re"), "warn", "own RE cannot charge the battery and buying more is not open");
  assert.equal(find(out, "little-own-re").cite, "marketShare");
  assert.equal(sev(out, "market-limit"), "warn", "the 5% limit is reached and days fall short");
  assert.equal(sev(out, "pay-policy"), "note");
  assert.equal(sev(out, "solar-not-optimised"), "warn", "more solar lowers the tariff");
  assert.equal(sev(out, "price-market"), "block", "a tariff far above every peak-power award");
  assert.ok(out.counts.block >= 1 && out.counts.warn >= 4, JSON.stringify(out.counts));
}

// ---- 3. connectivity in the solar hours too: the surplus is sold
const day = bidOf(filled({ dayInjection: true }));
{
  const { model, finance, out } = day;
  wellFormed(out, "solar-hour connectivity");
  assert.equal(model.inputs.dayInjection, true);
  assert.ok(finance.tariff < plain.finance.tariff - 0.5, `selling the day's surplus lowers the tariff (₹${finance.tariff.toFixed(3)} against ₹${plain.finance.tariff.toFixed(3)})`);
  near(day.model.sim.opYears.reduce((a, o) => a + o.deliveredMwh, 0), plain.model.sim.opYears.reduce((a, o) => a + o.deliveredMwh, 0), 1e-6, "the supply is the same with and without it");
  assert.equal(sev(out, "day-connectivity"), "note", "the bid relies on connectivity the tender does not ask for");
  assert.equal(find(out, "day-connectivity").cite, "connectivityApplied");
  assert.match(find(out, "day-connectivity").detail, /Confirm that your connectivity grant covers injection in the solar hours\. Without it .* GWh a year is curtailed/);
  assert.ok(!ids(out).includes("no-day-connectivity"));
  const f = find(out, "surplus-re");
  assert.ok(f && f.cite === "excess" && /SECI's to buy first, at the tariff, if the Buying Entity consents/.test(f.detail), "the surplus sold and SECI's first right to it");
  assert.equal(sev(plain.out, "surplus-re"), undefined, "nothing material is sold without solar-hour connectivity and no wind");
}

// ---------------------------------------------------------------- the 15-minute dispatch

// ---- the split: energy kept, within [0, peak]
{
  const hours = [0, 0, 0, 0, 0, 0, 2, 10, 25, 40, 52, 58, 60, 57, 50, 38, 22, 8, 1, 0, 0, 0, 0, 0];
  const blocks = splitHourly(hours, 60);
  assert.equal(blocks.length, BLOCKS_PER_DAY);
  for (let h = 0; h < 24; h += 1) near((blocks[h * 4] + blocks[h * 4 + 1] + blocks[h * 4 + 2] + blocks[h * 4 + 3]) / 4, hours[h], 1e-9, `hour ${h} energy kept`);
  for (const v of blocks) assert.ok(v >= 0 && v <= 60 + 1e-9, "within [0, peak]");
}
assert.ok(!BLOCK_COLUMNS.some(([, head]) => NOT_THIS_TENDER.test(head)) && !SUMMARY_COLUMNS.some(([, head]) => NOT_THIS_TENDER.test(head)), "the column headings are this tender's");
assert.equal(TENDER.peakHours, 4);
const PEAK_BLOCKS = TENDER.peakHours * 4;
const SOLAR_FROM = 6 * 4; // 06:00
const SOLAR_TO = TENDER.peakStart * 4; // 18:00

/** The whole term of a bid in blocks against the model: every day, then every Contract Year. Returns what was seen. */
function checkDispatch(name, model) {
  const ctx = blockContext(model.inputs, model.sim);
  const X = model.inputs.contractedMw;
  const dayOn = model.inputs.dayInjection;
  const recs = []; // the model's hourly record of every day
  simulate(model.inputs, model.book, model.prof, { onDay: (k, rec) => { recs.push(rec); } });
  let days = 0;
  let daySold = 0; // MWh sold between 06:00 and 18:00 over the term
  const t0 = Date.now();
  const out = dispatch15(model, {
    onDay: (d) => {
      const rec = recs[days];
      const c = d.cols;
      const where = `${name}, day ${d.k}`;
      assert.equal(d.k, rec.k, `${where}: the days come in order`);
      let peaks = 0;
      let peakMwh = 0;
      let allMwh = 0;
      let dueMwh = 0;
      let soldMwh = 0;
      for (let b = 0; b < BLOCKS_PER_DAY; b += 1) {
        if (c.peak[b]) {
          peaks += 1;
          peakMwh += c.delivered[b] * DT;
          assert.ok(b >= SOLAR_TO && b < TENDER.peakEnd * 4, `${where}: a peak block outside 18:00 to 24:00`);
        }
        allMwh += c.delivered[b] * DT;
        dueMwh += c.required[b] * DT;
        soldMwh += c.sold[b] * DT;
        assert.ok(c.delivered[b] <= X + 1e-6, `${where}, block ${b}: more than 1 MWh per MW in an hour`);
        assert.ok(c.chargeOwn[b] <= c.solar[b] + c.wind[b] + 1e-6, `${where}, block ${b}: charges from own RE more than it generates`);
        assert.ok(c.curtailed[b] >= -1e-9 && c.stored[b] >= -1e-9 && c.soc[b] >= 0 && c.soc[b] <= 100 + 1e-9, `${where}, block ${b}: within bounds`);
        if (b >= SOLAR_FROM && b < SOLAR_TO) {
          assert.equal(c.delivered[b], 0, `${where}, block ${b}: supply in the solar hours`);
          if (!dayOn) assert.equal(c.sold[b], 0, `${where}, block ${b}: injected between 06:00 and 18:00 without connectivity in the solar hours`);
          daySold += c.sold[b] * DT;
        }
      }
      assert.equal(peaks, PEAK_BLOCKS, `${where}: ${PEAK_BLOCKS} peak blocks`);
      near(peakMwh, rec.delivered, 1e-6, `${where}: the peak blocks sum to the day's energy supplied`);
      near(allMwh, rec.delivered, 1e-6, `${where}: nothing is supplied outside the peak blocks`);
      near(dueMwh, X * TENDER.mwhPerMwDay, 1e-6, `${where}: the supply due is 4 MWh per MW`);
      near(soldMwh, rec.sale.reduce((a, v) => a + v, 0) * ctx.meter, 1e-6, `${where}: sold`);
      days += 1;
    },
  });
  const ms = Date.now() - t0;
  assert.equal(days, recs.length, `${name}: every day of the term`);
  assert.equal(out.blocks, days * BLOCKS_PER_DAY, `${name}: 96 blocks a day`);
  assert.equal(out.years.length, model.sim.years.length, `${name}: one summary per Contract Year`);
  for (const y of out.years) {
    const cy = model.sim.years.find((c) => c.index === y.cy);
    const where = `${name}, CY ${y.cy}`;
    assert.equal(y.blocks, cy.days * BLOCKS_PER_DAY, `${where}: blocks = days x 96`);
    assert.equal(y.peakBlocks, cy.days * PEAK_BLOCKS, `${where}: ${PEAK_BLOCKS} peak blocks a day`);
    assert.equal(y.peakBlocksFull + y.shortBlocks, y.peakBlocks, `${where}: every peak block is full or short`);
    near(y.deliveredMwh, cy.deliveredMwh, 1e-3, `${where} supplied`);
    near(y.requiredMwh, cy.requiredMwh, 1e-3, `${where} supply due`);
    near(y.chargeOwnMwh, cy.chargeOwnMwh, 1e-3, `${where} own charging`);
    near(y.chargeMarketMwh, cy.chargeMarketMwh, 1e-3, `${where} market charging`);
    near(y.soldMwh, cy.merchantMwh, 1e-3, `${where} sold`);
    near(y.solarMwh, cy.solarMwh, 1e-3, `${where} solar`);
    near(y.windMwh, cy.windMwh, 1e-3, `${where} wind`);
    near(y.curtailedMwh, cy.curtailedMwh, 1e-3, `${where} curtailed`);
    assert.equal(y.chargeGroupMwh, 0, `${where}: no group RE`);
    assert.ok(y.maxDischargeMw <= ctx.P + 1e-6, `${where}: discharge within the battery's power`);
    assert.ok(y.overPower <= 0.03 * y.blocks, `${where}: blocks charging over the battery's rating are few (${y.overPower} of ${y.blocks})`);
    for (const [key] of SUMMARY_COLUMNS) assert.ok(Number.isFinite(y[key]), `${where}: summary column ${key}`);
  }
  assert.ok(out.months.length >= 12 * (TENDER.termYears - 1), `${name}: months of every Contract Year`);
  return { days, blocks: out.blocks, ms, daySold, over: out.years.reduce((a, y) => a + y.overPower, 0), curtailed: out.years.reduce((a, y) => a + y.curtailedMwh, 0) };
}

// ---- a day against its hourly record, column by column
{
  const model = plain.model;
  const ctx = blockContext(model.inputs, model.sim);
  const k = 1200;
  const rec = simulate(model.inputs, model.book, model.prof, { record: [k] }).days[k];
  assert.ok(rec && rec.k === k && rec.chosen.length === TENDER.peakHours && Number.isFinite(rec.capFactor), "the day record carries its day, its four hours and the battery factor");
  const c = dayBlocks(rec, ctx).cols;
  for (const [key] of BLOCK_COLUMNS) assert.equal(c[key].length, BLOCKS_PER_DAY, `${key} has 96 blocks`);
  const sum = (arr) => arr.reduce((a, v) => a + v * DT, 0);
  near(sum(c.solar), rec.solar.reduce((a, v) => a + v, 0), 1e-6, "solar energy");
  near(sum(c.chargeOwn), rec.own.reduce((a, v) => a + v, 0), 1e-6, "own charging");
  near(sum(c.chargeMarket) * ctx.meter, rec.market.reduce((a, v) => a + v, 0), 1e-6, "market charging");
  near(sum(c.discharge), rec.essOut + rec.extraOut.reduce((a, v) => a + v, 0), 1e-6, "discharge");
  assert.equal(c.peak.reduce((a, v) => a + v, 0), PEAK_BLOCKS);
  assert.ok(Math.max(...c.stored) > 0.9 * rec.essOut, "the battery fills before the peak");
}

// ---- the whole term: the default bid (no injection in the solar hours), the same with solar-hour
// connectivity, and a bid with wind, an extra battery and no augmentation that falls short
const seen = [
  ["default bid", checkDispatch("default bid", plain.model)],
  ["solar-hour connectivity", checkDispatch("solar-hour connectivity", day.model)],
  ["wind, extra battery, no augmentation", checkDispatch("wind and extra battery", runModel(filled({ solarMw: 90, windMw: 60, extraEssMwhPerMw: 1, augmentation: "none", shortfallPolicy: "pay" }), prices))],
];
assert.equal(seen[0][1].daySold, 0, "the default bid injects nothing between 06:00 and 18:00");
assert.ok(seen[0][1].curtailed > 0 && seen[1][1].daySold > 0 && seen[1][1].curtailed < 0.01 * seen[0][1].curtailed, "with solar-hour connectivity the day's surplus is sold, not curtailed");

console.log(`OK  SECI-FDRE-X review and 15-minute dispatch: ${findings} findings on 3 bids, all with a step and existing term ids, none of CfD-I's wording; default bid ₹${plain.finance.tariff.toFixed(3)}/kWh (${plain.out.summary.replace(/\.$/, "")}; ${(plain.model.sim.opYears.reduce((a, o) => a + o.curtailedMwh, 0) / plain.model.sim.opYears.length / 1000).toFixed(1)} GWh a year curtailed), 60 MWac with the penalty paid ₹${short.finance.tariff.toFixed(3)} (${short.out.counts.block} blocking, ${short.out.counts.warn} that carry cost), with solar-hour connectivity ₹${day.finance.tariff.toFixed(3)} (${day.out.summary.replace(/\.$/, "")}); dispatch: ${seen.map(([n, r]) => `${n} ${r.blocks.toLocaleString("en-IN")} blocks over ${r.days} days in ${r.ms} ms, ${r.over} over the rating, ${(r.daySold / 1000).toFixed(0)} GWh sold 06:00 to 18:00`).join("; ")}; 16 peak blocks a day, each day's blocks sum to its energy, every Contract Year equals the model's`);
