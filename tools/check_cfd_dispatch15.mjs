// Checks for the CfD 15-minute dispatch (web/src/cfd/dispatch15.js): the hour-to-block split keeps
// the energy and stays within bounds; a day's 96 blocks reconcile with the model's hourly day; the
// term's blocks reconcile with every Contract Year's totals; the battery never leaves its window; and
// the files (web/lib/cfdDispatch.js) hold what they claim. Run from the repository root:
//   node tools/check_cfd_dispatch15.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TENDER } from "../web/src/cfd/terms.js";
import { defaultCfdState, fillBenchmarks, runModel, simulate } from "../web/src/cfd/model.js";
import { BLOCKS_PER_DAY, BLOCK_COLUMNS, DT, blockContext, blockTime, dayBlocks, dispatch15, splitHourly } from "../web/src/cfd/dispatch15.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));

// ---- the split: energy kept, within [0, peak], follows the trend
{
  const hours = [0, 0, 0, 0, 0, 0, 2, 10, 25, 40, 52, 58, 60, 57, 50, 38, 22, 8, 1, 0, 0, 0, 0, 0];
  const blocks = splitHourly(hours, 60);
  assert.equal(blocks.length, 96);
  for (let h = 0; h < 24; h += 1) {
    const sum = blocks[h * 4] + blocks[h * 4 + 1] + blocks[h * 4 + 2] + blocks[h * 4 + 3];
    near(sum / 4, hours[h], 1e-9, `hour ${h} energy kept`);
  }
  for (const v of blocks) assert.ok(v >= 0 && v <= 60 + 1e-9, "within [0, peak]");
  assert.ok(blocks[8 * 4] < blocks[8 * 4 + 3], "a rising hour rises within the hour");
  assert.ok(blocks[15 * 4] > blocks[15 * 4 + 3], "a falling hour falls within the hour");
  assert.equal(blockTime(0), "00:00"); assert.equal(blockTime(5), "01:15"); assert.equal(blockTime(95), "23:45");
}

// ---- the benchmark bid: a day's blocks reconcile with its hourly record
const state = fillBenchmarks(defaultCfdState());
state.inputs.solarMw = 160;
const model = runModel(state, prices);
assert.ok(model && model.sim, "the benchmark bid runs");
const ctx = blockContext(model.inputs, model.sim);
{
  const k = 1200; // a day with the RE online
  const rec = simulate(model.inputs, model.book, model.prof, { record: [k] }).days[k];
  assert.ok(rec && rec.k === k && Number.isFinite(rec.capFactor) && rec.cy >= 1, "the day record carries its day, year and battery factor");
  const d = dayBlocks(rec, ctx);
  const c = d.cols;
  for (const [key] of BLOCK_COLUMNS) assert.equal(c[key].length, BLOCKS_PER_DAY, `${key} has 96 blocks`);
  const sum = (arr) => arr.reduce((a, v) => a + v * DT, 0);
  near(sum(c.solar), rec.solar.reduce((a, v) => a + v, 0), 1e-6, "solar energy");
  near(sum(c.wind), rec.wind.reduce((a, v) => a + v, 0), 1e-6, "wind energy");
  near(sum(c.chargeOwn), rec.own.reduce((a, v) => a + v, 0), 1e-6, "own charging");
  near(sum(c.chargeMarket) * ctx.meter, rec.market.reduce((a, v) => a + v, 0), 1e-6, "market charging");
  near(sum(c.chargeGroup) * ctx.meter, rec.group.reduce((a, v) => a + v, 0), 1e-6, "group charging");
  near(sum(c.delivered), rec.delivered, 1e-6, "delivered");
  near(sum(c.sold), rec.sale.reduce((a, v) => a + v, 0) * ctx.meter, 1e-6, "sold");
  near(sum(c.required), rec.required, 1e-6, "supply due is 2 MWh per MW");
  assert.equal(c.peak.reduce((a, v) => a + v, 0), TENDER.peakHours * 4, "eight peak blocks");
  for (let b = 0; b < BLOCKS_PER_DAY; b += 1) {
    assert.ok(c.chargeOwn[b] <= c.solar[b] + c.wind[b] + 1e-6, `block ${b}: own charging within the generation`);
    assert.ok(c.stored[b] >= -1e-9 && c.soc[b] >= 0 && c.soc[b] <= 100 + 1e-9, `block ${b}: state of charge within bounds`);
    assert.ok(c.curtailed[b] >= -1e-9, "curtailment is not negative");
  }
  assert.ok(Math.max(...c.stored) > 0.9 * rec.essOut, "the battery fills before the peak");
  assert.ok(c.stored[95] < 1e-6 || c.discharge.some((v) => v > 0), "the battery is run down in the evening");
}

// ---- the whole term: blocks per Contract Year, totals equal the model's
{
  const t0 = Date.now();
  let days = 0;
  const out = dispatch15(model, { onDay: () => { days += 1; } });
  const ms = Date.now() - t0;
  assert.equal(out.years.length, model.sim.years.length, "one summary per Contract Year");
  assert.equal(out.blocks, days * BLOCKS_PER_DAY, "96 blocks a day");
  for (const y of out.years) {
    const cy = model.sim.years.find((c) => c.index === y.cy);
    assert.equal(y.blocks, cy.days * BLOCKS_PER_DAY, `CY ${y.cy}: blocks = days × 96`);
    near(y.deliveredMwh, cy.deliveredMwh, 1e-3, `CY ${y.cy} delivered`);
    near(y.requiredMwh, cy.requiredMwh, 1e-3, `CY ${y.cy} supply due`);
    near(y.chargeOwnMwh, cy.chargeOwnMwh, 1e-3, `CY ${y.cy} own charging`);
    near(y.chargeMarketMwh, cy.chargeMarketMwh, 1e-3, `CY ${y.cy} market charging`);
    near(y.chargeGroupMwh, cy.chargeGroupMwh, 1e-3, `CY ${y.cy} group charging`);
    near(y.soldMwh, cy.merchantMwh, 1e-3, `CY ${y.cy} sold`);
    near(y.solarMwh, cy.solarMwh, 1e-3, `CY ${y.cy} solar`);
    assert.ok(y.maxDischargeMw <= ctx.P + 1e-6, `CY ${y.cy}: discharge within the battery's power`);
    assert.ok(y.overPower <= 0.01 * y.blocks, `CY ${y.cy}: blocks over the battery's rating are rare (${y.overPower})`);
    assert.ok(y.minSoc >= 0 && y.maxSoc <= 100 + 1e-9, `CY ${y.cy}: state of charge within bounds`);
  }
  assert.ok(out.months.length >= 12 * (TENDER.termYears - 1), "months of every Contract Year");
  console.log(`dispatch15: ${out.blocks.toLocaleString()} blocks over ${days} days in ${ms} ms; CY2 ${out.years[1].peakFullShare.toFixed(3)} of peak blocks at full supply; blocks charging over the rating ${out.years.reduce((a, y) => a + y.overPower, 0)}`);
}

console.log("check_cfd_dispatch15: ok");
