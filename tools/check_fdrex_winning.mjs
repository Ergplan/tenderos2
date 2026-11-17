// Checks for the two teaching steps of the SECI-FDRE-X tab: the worked example of step 01
// (web/src/fdrex/example.js) and "what wins" with the risks of step 11 (web/src/fdrex/winning.js).
// The example: the four evening hours a buyer would choose, read from the IEX price file; the PPA
// arithmetic (the tariff on the energy supplied, whatever the exchange price); a short billing
// month's penalty equal to the PPA's own formula and to Annexure-G of the RfS. What wins: the
// exchange price of the four hours supplied, the comparison with SECI's earlier peak awards, the
// auction arithmetic (80% of the qualified capacity, the highest first-round bidder dropped,
// L1 + 2%, the part award) on the RfS's own scenarios and on SECI's result notices, the
// solar-hour connectivity choice, the risks list, every cited term present in terms.js, and no
// text that speaks of a strike price, the CfD Pool or a Contract for Difference (the fork's
// source, CfD-I, has them; this tender does not). Run from the repository root:
//   node tools/check_fdrex_winning.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultCfdState, fillBenchmarks, runModel } from "../web/src/fdrex/model.js";
import { runCfdFinance } from "../web/src/fdrex/finance.js";
import { TENDER } from "../web/src/fdrex/tender.js";
import { termById } from "../web/src/fdrex/terms.js";
import { EXAMPLE_DEFAULTS, evenings, exampleMw, priceDate, shortfallPenaltyLakh, workedExample } from "../web/src/fdrex/example.js";
import { awardCapacity, awardList, cfdRisks, dayHighAverage, eveningAverage, eveningMcp, h1Dropped, peakAwards, rangeTop, surplusOf, tariffAt, tariffTable, whatWins } from "../web/src/fdrex/winning.js";
import { SECI_RESULTS } from "../web/src/market/seed.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const f = (v, d = 2) => Number(v).toFixed(d);

// ================================================================ the worked example (step 01)
const sp0 = EXAMPLE_DEFAULTS.sp;
assert.ok(sp0 >= 9.5 && sp0 <= 10, `the example tariff is in the band the model prices a benchmark bid at without solar-hour connectivity: ₹${sp0}`);
const x = workedExample({ mw: 100, sp: sp0, prices, market: "DAM", rte: 0.87, solarCuf: 0.25 });
assert.deepEqual([x.commit.dailyMwh, x.commit.hourlyMwh, x.commit.monthlyMwh, x.commit.monthlyMinMwh, x.commit.yearlyMwh, x.commit.batteryMw, x.commit.batteryMwh], [400, 100, 12000, 10800, 146000, 100, 400], "4 MWh per MW a day, 1 MWh per MW an hour, 90% of a 30-day month, a 4-hour battery");
near(x.commit.share, 100 / TENDER.totalMw, 1e-12, "share of the 1200 MW");
// the worked day: four evening hours of the price file, the dearest of the six, in clock order
const ev = evenings(prices, "DAM");
const series = prices.markets.DAM.hourlyRsPerMwh;
assert.equal(ev.length, 365);
for (const e of ev) {
  assert.equal(e.hours.length, 4, "four hours a day");
  assert.ok(e.hours.every((h, k) => h >= 18 && h < 24 && (k === 0 || h > e.hours[k - 1])), "evening hours in clock order");
  e.hours.forEach((h, k) => near(e.prices[k], series[e.d * 24 + h] / 1000, 1e-12, "the price file's price of that hour"));
  const rest = [18, 19, 20, 21, 22, 23].filter((h) => !e.hours.includes(h)).map((h) => series[e.d * 24 + h] / 1000);
  assert.ok(Math.min(...e.prices) >= Math.max(...rest) - 1e-12, "the four dearest of the six evening hours");
}
// the PPA arithmetic: the tariff on the energy supplied, whatever the exchange price
for (const e of Object.values(x.evenings)) {
  assert.equal(e.energyMwh, 400);
  near(e.youLakh, sp0 * 400 / 100, 1e-9, "SECI pays tariff x 400 MWh");
  near(e.exchangeLakh, e.prices.reduce((a, p) => a + p * 100 / 100, 0), 1e-9, "the same hours at the exchange price");
  near(e.gapLakh, e.youLakh - e.exchangeLakh, 1e-9, "the tariff against the exchange");
  near(e.buyerLakh, (sp0 + TENDER.tradingMarginRsPerKwh) * 400 / 100, 1e-9, "the buyer pays the tariff plus SECI's margin");
  assert.equal(new Date(e.date).getTime(), priceDate(prices, "DAM", e.d), "a real date of the price year");
}
assert.ok(x.evenings.low.avg <= x.evenings.middle.avg && x.evenings.middle.avg <= x.evenings.high.avg, "cheapest, middle, dearest");
assert.equal(x.evenings.low.youLakh, x.evenings.high.youLakh, "the bill does not move with the exchange price");
// own RE on energy: all of the year through the battery, or 95% with the 5% bought
near(x.charging.solarAlone, 146000 / 0.87 / (8760 * 0.25), 1e-9, "own solar for all the energy");
near(x.charging.solarWithMarket, (0.95 * 146000) / 0.87 / (8760 * 0.25), 1e-9, "own solar with 5% bought");
near(x.charging.boughtMwhYear, 0.05 * 146000, 1e-9, "5% of the year's energy");
// a short month: the PPA's formula (0.90 x required - supplied) x tariff x 1.5
near(shortfallPenaltyLakh(3000, 2000, 2.7), 28.35, 1e-9, "the PPA's example: Rs 28.35 lakh");
near(shortfallPenaltyLakh(31 * 400, 10820, 2.75), 14.025, 1e-9, "Annexure-G, January: Rs 14.025 lakh");
near(shortfallPenaltyLakh(31 * 400, 11020, 2.75), 5.775, 1e-9, "Annexure-G, March: Rs 5.775 lakh");
near(shortfallPenaltyLakh(30 * 400, 10800, 2.75), 0, 1e-12, "Annexure-G, April: at 90%, no penalty");
const m = x.month;
assert.equal(new Date(m.start).getUTCDate(), 1, "the billing month is read as the calendar month");
assert.equal((m.end - m.start) / 86400000 + 1, m.days);
assert.ok(m.outageFrom >= m.start && m.outageTo <= m.end && (m.outageTo - m.outageFrom) / 86400000 + 1 === m.outageDays, "the outage lies inside the month");
near(m.requiredMwh, 400 * m.days, 1e-9, "the month's requirement");
near(m.shortMwh, 400 * EXAMPLE_DEFAULTS.outageDays, 1e-9, "the days missed");
near(m.penaltyLakh, (0.9 * m.requiredMwh - m.suppliedMwh) * sp0 * 1.5 / 100, 1e-9, "the example month's penalty is the PPA's formula");
near(m.penaltyLakh, m.penalisedMwh * m.penaltyRate / 100, 1e-9, "penalised energy x 1.5 x tariff");
near(m.lostLakh, m.shortMwh * sp0 / 100, 1e-9, "the tariff not earned");
assert.equal(workedExample({ mw: 100, sp: sp0, prices, outageDays: 1 }).month.penaltyLakh, 0, "one missed evening is inside the 10%");
// a year: exchange + gap = tariff x energy; at a tariff above the year's highest price the exchange is cheaper every evening
near(x.year.exchangeCr + x.year.gapCr, x.year.youCr, 1e-9, "a year");
near(x.year.youCr, sp0 * 146000 * 1e-4, 1e-9, "the year's revenue");
near(x.year.psmCr, TENDER.psmChargeRsPerKwh * 146000 * 1e-4, 1e-9, "the PSM discount");
assert.equal(x.year.series.length, 365);
assert.equal(workedExample({ mw: 150, sp: 10.5, prices }).year.daysPpaCheaper, 0);
assert.equal(exampleMw({ inputs: { contractedMw: 120 } }), 120);
assert.equal(exampleMw({ inputs: { contractedMw: 600 } }), 600);
assert.equal(exampleMw({ inputs: { contractedMw: 700 } }), 100, "an invalid bid falls back to 100 MW");
assert.equal(exampleMw({ inputs: { contractedMw: 120 }, example: { mw: 60 } }), 60);

// ================================================================ the auction arithmetic (RfS 40.2, 41.2, 41.4)
assert.equal(awardCapacity(1000), 800, "80% of the qualified capacity");
assert.equal(awardCapacity(1500), 1200, "1500 MW must qualify for the full 1200 MW");
assert.equal(awardCapacity(2750), 1200, "at most 1200 MW");
// the RfS's own two scenarios of Clause 40.2
const scenario1 = [[600, 3.1], [300, 3.2], [300, 3.3], [250, 3.3], [300, 3.43], [500, 3.6], [200, 3.65], [300, 3.7]].map(([bidMw, tariff]) => ({ bidMw, tariff }));
assert.equal(scenario1.reduce((a, b) => a + b.bidMw, 0), 2750);
assert.equal(h1Dropped(scenario1), true, "Scenario-1: 8 bidders, 2750 MW: the highest is dropped");
const scenario2 = [[400, 3.1], [550, 3.2], [350, 3.3], [200, 3.4]].map(([bidMw, tariff]) => ({ bidMw, tariff }));
assert.equal(h1Dropped(scenario2), false, "Scenario-2: 1500 MW: 80% is 1200 MW, nobody is dropped");
assert.equal(h1Dropped([...scenario1.slice(0, 7), { bidMw: 300, tariff: 3.65 }]), false, "two bidders share the highest tariff: nobody is dropped");
assert.equal(h1Dropped([{ bidMw: 600, tariff: 3 }, { bidMw: 600, tariff: 3.1 }, { bidMw: 600, tariff: 3.2 }]), false, "fewer than 3 would remain");
assert.equal(h1Dropped([{ bidMw: 500, tariff: 3 }, { bidMw: 500, tariff: 3.1 }, { bidMw: 300, tariff: 3.2 }, { bidMw: 300, tariff: 3.3 }]), false, "80% of the rest would not exceed 1200 MW");
// L1 + 2% in whole paise
assert.equal(rangeTop(3.5), 3.57, "2% of Rs 3.50 is 7 paise (the RfS's illustration prints Rs 3.55)");
assert.equal(rangeTop(5.99), 6.1); assert.equal(rangeTop(6), 6.12); assert.equal(rangeTop(6.27), 6.39);
// the award list replays SECI's two peak-power notices: the same winners, the same part award
for (const r of SECI_RESULTS.filter((q) => q.product === "FDRE peak power")) {
  const quotes = [...r.winners, ...r.others].map((w) => ({ bidMw: w.bidMw, tariff: w.tariff }));
  const list = awardList(quotes, r.awardedMw);
  near(list.reduce((a, q) => a + q.mw, 0), r.awardedMw, 1e-9, `${r.id}: the capacity awarded`);
  r.winners.forEach((w, k) => { assert.equal(list[k].mw, w.mw, `${r.id}: winner ${k + 1} is awarded ${w.mw} MW`); assert.equal(list[k].tariff, w.tariff); });
  assert.ok(list.slice(r.winners.length).every((q) => q.mw === 0), `${r.id}: nobody else`);
  assert.ok(list.some((q) => q.inRange && q.mw === 0), `${r.id}: bidders inside L1 + 2% who get nothing`);
}
const tail = awardList([{ bidMw: 300, tariff: 6 }, { bidMw: 200, tariff: 6.01 }, { bidMw: 300, tariff: 6.05 }, { bidMw: 100, tariff: 6.2 }], 540);
assert.deepEqual(tail.map((q) => q.mw), [300, 200, 0, 0], "a part under 50 MW is not awarded; outside the range nothing");
assert.deepEqual(awardList([{ bidMw: 300, tariff: 6 }, { bidMw: 300, tariff: 6.05 }], 400).map((q) => [q.mw, q.part, q.mayRefuse]), [[300, false, false], [100, true, true]], "a part under half the bid may be refused");

// ================================================================ SECI's earlier peak awards
const awards = peakAwards();
assert.deepEqual(awards.map((a) => a.short), ["SECI-FDRE-IX", "SECI-FDRE-VII"], "latest first");
assert.deepEqual(awards.map((a) => [a.lo, a.hi]), [[5.99, 6], [6.27, 6.28]]);
assert.deepEqual(awards.map((a) => a.mwhPerMwDay), [TENDER.mwhPerMwDay, TENDER.mwhPerMwDay], "the same energy per MW a day as this tender");
assert.deepEqual(awards[0].partAward, { bidMw: 750, mw: 300, share: 0.4 });
for (const a of awards) { assert.ok(a.quotedMw > 3 * a.tenderedMw, "several times oversubscribed"); assert.equal(a.quotes.length, a.bidders); assert.ok(a.inRangeUnawarded >= 1); }

// ================================================================ what wins, on a real bid
const priced = (dayInjection) => {
  const s = fillBenchmarks(defaultCfdState());
  s.inputs.solarMw = 112; // the own solar the optimiser finds for 100 MW on the benchmarks
  s.inputs.dayInjection = dayInjection;
  const pricer = (inputs, sim) => runCfdFinance({ ...s, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
  const model = runModel(s, prices, { price: pricer });
  return { s, model, finance: runCfdFinance(s, model) };
};
const { s, model, finance } = priced(false); // the tender's connectivity: non-solar hours only
const withDay = priced(true);
const mcp = eveningMcp(model);
const avg = eveningAverage(model);
const dayHigh = dayHighAverage(model);
assert.ok(mcp > 5 && mcp < 12, `the four evening hours supplied average a plausible price: ₹${mcp}`);
near(mcp, ev.reduce((a, e) => a + e.avg, 0) / 365, 0.01, "the model's evening price is the example's four dearest hours, on the same price year (the model weights the days of its Contract Years)");
assert.ok(avg < mcp, "every evening hour averages less than the four dearest");
assert.ok(dayHigh >= mcp && dayHigh <= 20, "the day's highest rate across the three markets");
// the buyer's side: it pays the tariff plus the margin; it saves below the exchange price, pays more above; monotonic
const margin = TENDER.tradingMarginRsPerKwh;
const at = [5, 6, 7, 8, 9, 10].map((t) => tariffAt(model, t));
for (let k = 1; k < at.length; k += 1) assert.ok(at[k].savesCr < at[k - 1].savesCr, "the buyer saves less as the tariff rises");
assert.ok(tariffAt(model, mcp - margin - 1).savesCr > 0 && tariffAt(model, mcp - margin + 1).savesCr < 0, "saves below the exchange price, pays more above it");
near(tariffAt(model, mcp - margin).savesCr, 0, 0.01 * Math.abs(tariffAt(model, mcp - margin + 1).savesCr) + 1e-6, "neutral at the exchange price less the margin");
near(tariffAt(model, 7).allCr, tariffAt(model, 7).perMwCr * TENDER.totalMw, 1e-9, "the whole tender scales per MW");
near(tariffAt(model, 7).vsExchange, 7 + margin - mcp, 1e-12, "tariff + margin against the exchange");
// solar-hour connectivity: without it the surplus is curtailed and the tariff is higher
const cut = surplusOf(model, finance.tariff);
const sold = surplusOf(withDay.model, withDay.finance.tariff);
assert.equal(cut.dayInjection, false); assert.equal(sold.dayInjection, true);
assert.ok(cut.curtailedMwh > 10 * Math.max(1, sold.curtailedMwh) && sold.soldMwh > 10 * Math.max(1, cut.soldMwh), "non-solar-hour access curtails what solar-hour connectivity sells");
assert.ok(finance.tariff > withDay.finance.tariff + 0.5, `the tariff carries the surplus: ₹${f(finance.tariff, 3)} against ₹${f(withDay.finance.tariff, 3)}`);
assert.ok(finance.tariff > 9 && finance.tariff < 10.5 && withDay.finance.tariff > 7 && withDay.finance.tariff < 9, "in the bands the example tariff is taken from");
// the table: around the awards, the exchange price and the quote
const win = whatWins({ model, finance });
const rows = tariffTable(model, win.quote);
assert.ok(rows.length >= 8 && rows.filter((r) => r.yours).length === 1, "a table with the quote marked");
for (let k = 1; k < rows.length; k += 1) assert.ok(rows[k].sp > rows[k - 1].sp, "sorted by tariff");
assert.ok(rows.some((r) => /SECI-FDRE-IX/.test(r.label || "")) && rows.some((r) => /exchange/.test(r.label || "")) && rows.some((r) => /your quote/.test(r.label || "")), "the awards, the exchange price and the quote are rows");
// the verdict at three quotes, and on the bid's own
const low = whatWins({ model, finance: { tariff: 5.9 } });
const mid = whatWins({ model, finance: { tariff: 6.2 } });
const high = whatWins({ model, finance: { tariff: 9.5 } });
assert.equal(low.tone, "good"); assert.ok(/at or below the latest award/.test(low.verdict) && /saves/.test(low.verdict), low.verdict);
assert.equal(mid.tone, "warn"); assert.ok(/inside what SECI has awarded/.test(mid.verdict), mid.verdict);
assert.equal(high.tone, "bad"); assert.ok(/above the highest tariff SECI has awarded/.test(high.verdict) && /more on your/.test(high.verdict), high.verdict);
assert.ok(/non-solar hours only/.test(high.verdict) && /curtailed/.test(high.verdict), "a high quote is told about solar-hour connectivity");
assert.ok(/solar hours too/.test(whatWins({ model: withDay.model, finance: { tariff: 9.5 } }).verdict), "and a bid that counts on it is told so");
near(mid.l1Floor, Math.ceil((6.2 / 1.02) * 100) / 100, 1e-9, "the lowest L1 that keeps the quote in the range");
assert.ok(rangeTop(mid.l1Floor) >= 6.2 - 1e-9 && rangeTop(mid.l1Floor - 0.01) < 6.2, "and no lower");
assert.deepEqual([low.replay.rank, low.replay.inRange, low.replay.mw], [1, true, 100], "at Rs 5.90 the bid would lead the latest auction's quotes and be awarded in full");
assert.deepEqual([high.replay.rank, high.replay.of, high.replay.inRange, high.replay.mw], [17, 17, false, 0], "at Rs 9.50 it would be last and outside the range");
assert.equal(win.tone, "bad", "the benchmark bid stands above every earlier award");
near(win.vsLatest, win.quote - 6, 1e-9, "against the latest award");
// the risks: every one complete, cited from terms.js, with no placeholder in its text
const risks = cfdRisks({ state: s, model, finance });
const ids = risks.map((r) => r.id);
for (const id of ["hours", "monthly", "thirdParty", "connectivity", "bought", "fade", "availability", "dsm", "delay", "award", "offtake", "buyer", "market"]) assert.ok(ids.includes(id), `risk ${id}`);
assert.equal(new Set(ids).size, ids.length, "unique ids");
for (const r of [...risks, ...cfdRisks({ state: withDay.s, model: withDay.model, finance: withDay.finance })]) {
  assert.ok(r.title && r.detail && r.cite, `${r.id} complete`);
  assert.ok(termById[r.cite], `${r.id}: cite "${r.cite}" is a term of terms.js`);
  assert.ok(r.cr === null || Number.isFinite(r.cr), `${r.id}: sized or null`);
  assert.ok(!/undefined|NaN|–|Infinity/.test(r.title + r.detail), `${r.id}: ${r.title}`);
}
const dsm = risks.find((r) => r.id === "dsm");
const revenue = finance.tariff * model.sim.opYears[1].deliveredMwh * 1e-4;
assert.ok(dsm.cr > 0 && dsm.cr < 0.1 * revenue && /DSM/.test(dsm.title), `the DSM charge is sized and small against revenue: ₹${f(dsm.cr)} cr`);
near(risks.find((r) => r.id === "offtake").cr, TENDER.offtakeCompensationHours * 100 * finance.tariff * 1e-4, 1e-9, "175 hours at the contracted MW");
assert.ok(/curtailed/.test(risks.find((r) => r.id === "connectivity").detail) && /depend on it/.test(cfdRisks({ state: withDay.s, model: withDay.model, finance: withDay.finance }).find((r) => r.id === "connectivity").title), "the connectivity risk follows the bid's choice");

// ================================================================ the cited terms and the wording of the six files
const FILES = ["ExplainStep.jsx", "ExampleStep.jsx", "example.js", "VisualModel.jsx", "ReferenceBids.jsx", "winning.js"];
const cited = new Set();
for (const name of FILES) {
  const src = readFileSync(new URL(`../web/src/fdrex/${name}`, import.meta.url), "utf8");
  for (const hit of src.matchAll(/<Cite id="([^"]+)"/g)) cited.add(hit[1]);
  for (const hit of src.matchAll(/cite: "([^"]+)"/g)) cited.add(hit[1]);
  for (const hit of src.matchAll(/(?:ids=\{|cites: |cites=\{)\[([^\]]*)\]/g)) for (const q of hit[1].matchAll(/"([^"]+)"/g)) cited.add(q[1]);
  // what the screen says (comments set aside: they may contrast this tender with CfD-I, the fork's source)
  const shown = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  const bad = shown.match(/strike price|Contract for Difference|CfD|\bPool\b|\bREC\b|Contract Week/);
  assert.equal(bad, null, `${name}: the text speaks of "${bad?.[0]}"`);
}
assert.ok(cited.size > 100, `the two steps cite their clauses: ${cited.size} terms`);
for (const id of cited) assert.ok(termById[id], `cited term "${id}" is in terms.js`);
for (const t of [win.verdict, low.verdict, mid.verdict, high.verdict, ...risks.map((r) => `${r.title} ${r.detail}`), ...rows.map((r) => r.label || "")]) assert.ok(!/strike price|Contract for Difference|CfD|\bPool\b/.test(t), t);

console.log(`OK  check_fdrex_winning: example ₹${f(sp0)} on 100 MW (a ${m.outageDays}-day outage in a ${m.days}-day month costs ₹${f(m.penaltyLakh)} lakh); the four evening hours ₹${f(mcp)}/kWh on the exchange (all six ₹${f(avg)}); benchmark bid ₹${f(finance.tariff, 3)} with non-solar-hour access (₹${f(withDay.finance.tariff, 3)} with solar-hour connectivity too), ${f(cut.curtailedMwh / 1000, 1)} GWh of surplus solar curtailed a year; awards ₹${f(awards[0].lo)}–${f(awards[0].hi)} (${awards[0].short}) and ₹${f(awards[1].lo)}–${f(awards[1].hi)} (${awards[1].short}); ${risks.length} risks, ${cited.size} cited terms, all in terms.js`);
