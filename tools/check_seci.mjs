// Checks for the SECI RTC tender tab (web/src/seci): the tender's terms and the HiGHS request they
// make, the dates and money at stake, the bid-form checks, and the bid agent's script and its
// understanding of spoken or typed answers. Run from the repository root:
//   node tools/check_seci.mjs
import assert from "node:assert/strict";
import * as E from "../web/src/rtc/engine.js";
import { BENCHMARKS, SOURCE_FIELDS, defaultLosses, fillBenchmarks, hourlyAtMeter, lossFactorsOf, lpPayload, missingInputs, modelInputs, resourceProfiles } from "../web/src/bid/model.js";
import { defaultSeciState } from "../web/src/seci/state.js";
import { hourCondition, hourFlows, hourSankeyHtml } from "../web/src/bid/hourSankey.js";
import { DEFAULT_SETTINGS, PACK, keyDates, moneyAtStake, prov, seciTerms } from "../web/src/seci/terms.js";
import { bidChecks, bidPackRequest, experienceTest, formIssues, parseExperience } from "../web/src/seci/forms.js";
import { buildScript, explainFinance, explainResults, financeOf, parseDate, parseNumber } from "../web/src/seci/voice.js";
import { defaultBidState } from "../web/src/bid/model.js";
import { quotedReturns } from "../web/src/bid/quote.js";
import { NOT_APPLICABLE, applies, blankValue, fieldApplies, formatGroups, formatStatus, formatsForPack, formatsSummary } from "../web/src/seci/formats.js";

// ---- the terms: Amendment-03's three time-block floors with the 1.5x penalty, peak hours as planned
const terms = seciTerms(DEFAULT_SETTINGS);
assert.deepEqual(terms.rules.map((r) => [r.id, r.basis, r.hours, r.target, r.penaltyMultiple]), [["peak", "block", "peak", 0.9, 1.5], ["solar", "block", "solar", 0.5, 1.5], ["remaining", "block", "remaining", 0.7, 1.5]]);
assert.deepEqual([terms.rules[1].max, terms.rules[1].excessTariffShare], [0.6, 0.5], "Solar Hours: at most 60%; above it the buyer's first right at 50% of the tariff");
assert.deepEqual([terms.solar.start, terms.solar.end, terms.solar.mask.reduce((a, v) => a + v, 0)], [8, 18, 3650], "Solar Hours 08:00-18:00 assumed");
assert.deepEqual([...seciTerms({ ...DEFAULT_SETTINGS, solarHours: { start: 7, end: 17 } }).solar.mask.slice(0, 24)].map((v, h) => (v ? h : null)).filter((h) => h !== null), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
const before = seciTerms({ ...DEFAULT_SETTINGS, profile: "amd1" });
assert.deepEqual(before.rules.map((r) => [r.id, r.hours, r.target]), [["peak", "peak", 0.9], ["offpeak", "offpeak", 0.7]], "before Amendment-03: 90% peak, 70% off-peak");
assert.equal(before.solar, null);
assert.deepEqual([terms.minBidMw, terms.maxBidMw, terms.baseMw, terms.partAllowed], [50, 500, 1000, true]);
assert.equal(terms.mandatory.bess, true, "storage is mandatory (Clarifications-01, query 13)");
assert.equal(terms.permitted.thermal, false, "RE only");
assert.equal(terms.sale, "allowed", "power above the contracted capacity may be sold (PSA 2.11.5)");
assert.equal(seciTerms({ ...DEFAULT_SETTINGS, shortfall: "hard" }).rules[0].penaltyMultiple, null, "meet every block: no penalty, a hard floor");
for (const [key, p] of Object.entries(terms.provenance)) if (p) assert.ok(p.located && (p.page || key === "years"), key);

// the request to HiGHS: block rules, the penalty, and the peak hours as planned
const state0 = { ...defaultBidState(), bid: { baseMw: 300, greenshoe: false }, sources: { solar: true, wind: true, hydro: false, biomass: false, thermal: false, bess: true } };
const filled = { ...fillBenchmarks(state0, terms), seci: { ...DEFAULT_SETTINGS }, forms: {} };
assert.deepEqual(missingInputs(filled, terms), [], "benchmarks complete the inputs");
const payload = lpPayload(filled, terms, resourceProfiles(filled));
assert.deepEqual(payload.compliance.map((c) => [c.id, c.basis, c.hours, c.target, c.penaltyMultiple, c.max, c.excessTariffShare]),
  [["peak", "block", "peak", 0.9, 1.5, undefined, undefined], ["solar", "block", "solar", 0.5, 1.5, 0.6, 0.5], ["remaining", "block", "remaining", 0.7, 1.5, undefined, undefined]]);
assert.equal(payload.solarMask.length, 8760);
assert.equal(payload.solarMask.reduce((a, v) => a + v, 0), 3650, "the Solar Hours go to HiGHS");
const beforePayload = lpPayload(filled, before, resourceProfiles(filled));
assert.equal(beforePayload.solarMask, undefined, "no Solar Hours before Amendment-03");
assert.deepEqual(beforePayload.compliance.map((c) => c.hours), ["peak", "offpeak"]);
const peakHoursOf = (mask) => [...new Set(Array.from(mask).map((v, t) => (v ? E.HOUR_OF_DAY[t] : null)).filter((h) => h !== null))].sort((a, b) => a - b);
assert.deepEqual(peakHoursOf(payload.peakMask), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 18, 19, 20, 21, 22, 23], "any 6 of 18:00-10:00: all 16 hours held to 90%");
const evening = lpPayload(filled, seciTerms({ ...DEFAULT_SETTINGS, peakPlan: "evening" }), resourceProfiles(filled));
assert.deepEqual(peakHoursOf(evening.peakMask), [18, 19, 20, 21, 22, 23], "evening plan: 18:00-24:00");
assert.equal(payload.ctx.demand[0], 300, "round the clock at the contracted capacity");
assert.equal(modelInputs(filled, terms).fin.blockPenaltyMultiple, 1.5, "the financial model charges 1.5x tariff on the shortfall");
assert.equal(modelInputs(filled, seciTerms({ ...DEFAULT_SETTINGS, shortfall: "hard" })).fin.blockPenaltyMultiple, 0);

// ---- losses to the billing meter: each technology's own transformer and cables after where its CUF is
// measured, the 33/220 kV transformer and the 220 kV line; none in Tender to Bid
assert.equal(payload.ctx.trafoLossPct, 0, "no losses without state.losses (Tender to Bid)");
assert.ok(defaultSeciState().losses, "the SECI tab starts with the losses");
const lossy = { ...filled, losses: defaultLosses() };
const lp0 = lpPayload(lossy, terms, resourceProfiles(lossy));
assert.equal(lp0.ctx.trafoLossPct, 0.004);
assert.equal(lp0.ctx.lineLossPct, 0.005);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const solarBus = (1 - 0.01) * (1 - 0.005); // inverter-duty transformer and 33 kV cables, after the inverter output
const windBus = (1 - 0.01) * (1 - 0.005); // WTG step-up transformer and 33 kV cables, after the turbine terminals
assert.ok(Math.abs(mean(lp0.ctx.solarCf) / mean(payload.ctx.solarCf) - solarBus) < 1e-4, "solar: the IDT and cable losses applied");
assert.ok(Math.abs(mean(lp0.ctx.windCf) / mean(payload.ctx.windCf) - windBus) < 1e-4, "wind: the WTG transformer and cable losses applied");
const rteBus = filled.src.bess.rte * ((1 - 0.008) * (1 - 0.003)) ** 2; // MV transformer and cables, both ways, after the PCS
assert.ok(Math.abs(lp0.bess.rte - rteBus) < 1e-9, "battery: the MV transformer and cables applied both ways");
assert.ok(Math.abs(lossFactorsOf(lossy).meter - 0.996 * 0.995) < 1e-12);
const atBus = lpPayload({ ...lossy, losses: { ...lossy.losses, solarFileAt: 4, windFileAt: 2, bessRteAt: 3 } }, terms, resourceProfiles(lossy));
assert.ok(Math.abs(mean(atBus.ctx.solarCf) - mean(payload.ctx.solarCf)) < 1e-6, "a CUF measured at the 33 kV bus loses nothing more before it");
// the sizing's hourly year 1: what reaches the meter at the meter, the losses between
const h = hourlyAtMeter({ demand: [302], direct: [200], discharge: [100], export: [10], charge: [5], solar: [400], curtail: [0] }, 0.99);
assert.deepEqual([h.demand[0], h.direct[0], h.discharge[0], h.export[0], h.charge[0], h.solar[0]].map((v) => Math.round(v * 100) / 100), [298.98, 198, 99, 9.9, 5, 400]);
assert.ok(Math.abs(h.evacLoss[0] - 3.1) < 1e-9 && hourlyAtMeter(h, 0.99) === h, "converted once");
// the hover Sankey of an hour: every MW from a source lands somewhere, and the delivery splits into
// the block's floor, what is above it, and what is short of it
// the LP's hour at the 33 kV bus: generation = direct + sold + charging + curtailment
const busUse = 200 + 20 + 50 + 10;
const hr = hourlyAtMeter({ demand: [300 / 0.991], direct: [200], discharge: [80], export: [20], charge: [50], curtail: [10], solar: [250], wind: [busUse - 250] }, 0.991);
const peakRules = terms.rules;
const fl = hourFlows(hr, 0, { gens: ["solar", "wind"], titles: { solar: "Solar", wind: "Wind" }, colors: { solar: "#f5b83d", wind: "#3fa7d6", bess: "#a98bff" }, rules: peakRules, peakHour: () => true });
const flowSum = (f) => fl.links.filter(f).reduce((a, l) => a + l.value, 0);
assert.ok(Math.abs(flowSum((l) => l.from === "solar" || l.from === "wind") - busUse) < 1e-6, "each source's output is all accounted for");
assert.ok(Math.abs(flowSum((l) => l.to === "ppa") - (hr.direct[0] + hr.discharge[0])) < 1e-6, "the PPA gets direct supply and the battery's discharge, at the meter");
assert.ok(Math.abs(fl.lossCheck.links - fl.lossCheck.series) < 1e-6, "the losses node equals the hour's transformer and line losses");
const cond = hourCondition(hr, 0, { rules: peakRules, peakHour: () => true });
assert.equal(cond.rule.id, "peak");
assert.ok(Math.abs(cond.met + cond.above - cond.delivered) < 1e-9 && cond.short === 0, "a peak hour above 90% is met");
const offShort = hourCondition({ demand: [300], direct: [150], discharge: [0] }, 0, { rules: peakRules, peakHour: () => false });
assert.equal(offShort.rule.id, "remaining");
assert.equal(Math.round(offShort.short), 60, "70% of 300 MW needs 210 MW: 60 MW short");
const solarShort = hourCondition({ demand: [300], direct: [100], discharge: [0] }, 0, { rules: peakRules, peakHour: () => false, solarHour: () => true });
assert.deepEqual([solarShort.rule.id, Math.round(solarShort.short)], ["solar", 50], "a Solar Hour needs 50%: 150 MW, 50 MW short");
assert.equal(hourCondition({ demand: [300], direct: [100], discharge: [0] }, 0, { rules: peakRules, peakHour: () => true, solarHour: () => true }).rule.id, "peak", "a Solar Hour picked as a Peak Hour is held to 90%");
assert.equal(hourCondition({ demand: [300], direct: [150], discharge: [0] }, 0, { rules: before.rules, peakHour: () => false }).rule.id, "offpeak");
assert.ok(/<svg[^>]*data-sankey/.test(hourSankeyHtml(hr, 0, { gens: ["solar", "wind"], titles: {}, colors: {}, rules: peakRules, peakHour: () => true, label: "Jan 10h" })));
// solar capex per MWac; per MWp follows from the DC:AC
assert.equal(SOURCE_FIELDS.solar.find((f) => f.key === "capex").unit, "₹ cr/MWac");
assert.ok(!SOURCE_FIELDS.solar.find((f) => f.key === "dcAc").profileOnly, "the DC:AC is asked even with an uploaded profile (MWp)");

// ---- dates and money at stake (Amendment-02's own example: PPA 07.06.2026 -> SCSD 07.06.2028)
assert.deepEqual(keyDates("2026-06-07"), { ppa: "2026-06-07", financialClosure: "2027-12-07", scsd: "2028-06-07", latestStart: "2028-12-07" });
assert.equal(keyDates(null), null);
const money = moneyAtStake({ solarMw: 600, windMw: 400, bessMw: 400, bessMwh: 1600 });
assert.equal(money.emdRs, 968000 * 600 + 1368000 * 400 + 240000 * 1600);
assert.equal(money.pbgRs, 2420000 * 600 + 3420000 * 400 + 600000 * 1600);
assert.equal(money.netWorthRs, 9680000 * 600 + 13680000 * 400 + 2400000 * 1600);
assert.equal(prov("emd").quote, "EMD amount = Rs. [9,68,000 * S + 13,68,000 * W + 2,40,000 * E]");

// ---- bid forms: required fields, the checks, and the 34.3 experience test
const lp = {
  sizes: { solarMw: 600, windMw: 400, bessMw: 400, bessMwh: 1600 }, tariff: 5.1, lowerBound: 5.0,
  perYear: [{ year: 1, rules: [{ id: "peak", basis: "block", hoursMet: 0.97, shortfallMu: 3, met: false }, { id: "offpeak", basis: "block", hoursMet: 1, shortfallMu: 0, met: true }], blockShortfallMu: 3 }],
  lifetime: Array.from({ length: 25 }, (_, i) => ({ year: i + 1, demandMwh: 300 * 8760, deliveredMwh: 0.86 * 300 * 8760, exportMwh: 2e5, blockShortfallMwh: 3000 })),
};
const sized = { ...filled, lp, seci: { ...DEFAULT_SETTINGS, ppaDate: "2026-06-07" }, forms: {} };
assert.ok(formIssues(sized).includes("Bidder's name"));
assert.ok(formIssues({ ...sized, forms: { bidderType: "consortium" } }).includes("Lead member (consortium)"), "a consortium names its lead member");
const forms = { bidder: "Acme Renewables Ltd", bidderType: "company", address: "New Delhi", contact: "A. Kumar", email: "bids@acme.example", tariff: 5.12,
  substation: "Bhadla-III", substationScd: "2027-12-31", connectivity: "other", bessWith: "solar", netWorthCr: 2000, experience: "Plant A, 250 MW, 2023-04-01\nPlant B, 120 MW",
  signatory: "A. Kumar, Director", letterDate: "2026-05-20", place: "New Delhi", commonShareholding: "no", emdForm: "bg" };
const checks = Object.fromEntries(bidChecks({ ...sized, forms }).map((c) => [c.id, c]));
assert.equal(formIssues({ ...sized, forms }).length, 0);
assert.equal(checks.capacity.status, "ok");
assert.equal(checks.substation.status, "ok");
assert.equal(checks.undertaking.status, "warn", "another entity's connectivity needs the Annexure-I undertaking");
assert.equal(checks.networth.status, "ok", "Rs 2,000 cr covers the Rs 1,512 cr needed");
assert.equal(bidChecks({ ...sized, forms: { ...forms, netWorthCr: 1000 } }).find((c) => c.id === "networth").status, "bad");
assert.equal(bidChecks({ ...sized, forms: { ...forms, substationScd: "2028-07-01" } }).find((c) => c.id === "substation").status, "bad", "SCD after 30.06.2028");
assert.ok(checks.experience.status === "ok" && /one plant of at least 240 MW/.test(checks.experience.detail) && /Not used/.test(checks.experience.detail));
assert.deepEqual(parseExperience("Plant A, 250 MW, 2023-04-01\nPlant B, 120 MW").map((p) => [p.name, p.mw, p.date]), [["Plant A", 250, "2023-04-01"], ["Plant B", 120, null]]);
assert.equal(experienceTest([{ mw: 150 }, { mw: 150 }], 300).how, "two plants of at least 150 MW each");
assert.equal(experienceTest([{ mw: 130 }, { mw: 125 }, { mw: 120 }], 300).how, "three plants of at least 120 MW each");
assert.equal(experienceTest([{ mw: 100 }], 300).met, false);
const pack = bidPackRequest({ ...sized, forms });
assert.equal(pack.bid.contractedMw, 300);
assert.ok(Math.abs(pack.bid.emdCr - money.emdRs / 1e7) < 1e-9);
assert.ok(pack.checks.every((c) => c.source && /p\. \d+/.test(c.source)), "every check names its page");
assert.equal(pack.fields.find((f) => f.label === "Connectivity").value, "Another entity's connectivity");

// ---- the agent's script: numbers and dates as spoken, and every question reads and sets its input
const cases = [["three hundred", 300], ["300 MW", 300], ["four point two five", 4.25], ["1.2 crore", 1.2e7], ["fifty", 50], ["two thousand five hundred", 2500],
  ["seventy five percent", 75], ["one lakh", 1e5], ["₹4.10", 4.1], ["twenty one", 21], ["a hundred and fifty", 150], ["no idea", null]];
for (const [text, want] of cases) assert.equal(parseNumber(text), want, text);
for (const [text, want] of [["7 June 2026", "2026-06-07"], ["June 7th, 2026", "2026-06-07"], ["07.06.2026", "2026-06-07"], ["2026-06-07", "2026-06-07"], ["sometime soon", null]]) assert.equal(parseDate(text), want, text);
{
  // the script's "fill" fills every empty input with benchmarks (market sale answered too)
  const blankState = { ...state0, seci: { ...DEFAULT_SETTINGS }, forms: {} };
  const fillItem = buildScript(blankState).find((i) => i.id === "fill");
  assert.deepEqual(missingInputs(fillItem.onYes(blankState, terms), terms), []);
  const sell = buildScript(blankState).find((i) => i.id === "market");
  assert.deepEqual([sell.onYes(blankState).market.sell, sell.onYes(blankState).market.source, sell.onNo(blankState).market.sell], [true, "GDAM", false]);
}
const script = buildScript(filled);
const ids = script.map((i) => i.id);
for (const id of ["intro", "c.dfr", "c.peak", "c.penalty", "bidMw", "peakPlan", "shortfall", "ppaDate", "fill", "market", "solar.cuf", "wind.capex", "bess.duration", "bess.capex", "fin.targetEquityIrr", "costs.preopPct", "size", "results", "finance", "forms"]) {
  assert.ok(ids.includes(id), id);
}
assert.ok(script.find((i) => i.id === "c.dfr").say.includes("90 percent") && script.find((i) => i.id === "c.dfr").say.includes("70 percent"));
let s = filled;
const answers = { bidMw: "four hundred", peakPlan: "evening only", shortfall: "meet every block", ppaDate: "7 June 2026", "solar.cuf": "26 percent", "solar.capex": "three point eight", "wind.cuf": "0.35",
  "bess.duration": "two hours", "bess.rte": "88", "fin.targetEquityIrr": "fifteen percent", "fin.tenorYears": "eighteen", "costs.evacuationCr": "120" };
for (const item of script) {
  if (!item.read) continue;
  assert.ok(item.ask.length > 10, item.id);
  if (!(item.id in answers)) continue;
  const v = item.read(answers[item.id]);
  assert.notEqual(v, null, `${item.id}: ${answers[item.id]}`);
  s = item.set(s, v);
}
assert.equal(s.bid.baseMw, 400);
assert.deepEqual([s.seci.peakPlan, s.seci.shortfall, s.seci.ppaDate], ["evening", "hard", "2026-06-07"]);
assert.deepEqual([s.src.solar.cuf, s.src.solar.capex, s.src.wind.cuf, s.src.bess.duration, s.src.bess.rte], [0.26, 3.8, 0.35, "2", 0.88]);
assert.deepEqual([s.fin.targetEquityIrr, s.fin.tenorYears, s.costs.evacuationCr], [0.15, 18, 120]);
assert.equal(s.filled["solar.cuf"], false, "a spoken value is the bidder's, not a benchmark");
assert.equal(script.find((i) => i.id === "bidMw").read("40"), null, "below 50 MW is refused");
assert.equal(script.find((i) => i.id === "solar.cuf").read("250"), null, "a CUF above 100% is refused");
const bench = script.find((i) => i.id === "wind.capex");
assert.equal(bench.set(s, bench.benchmark, true).filled["wind.capex"], true, "a benchmark stays marked");
assert.equal(bench.benchmark, BENCHMARKS.wind.capex);
assert.ok(SOURCE_FIELDS.bess.some((f) => f.key === "duration"));

// results and finance, in words
const res = explainResults({ ...sized, bid: { baseMw: 300 } });
assert.ok(/600 megawatts AC of solar, that is 840 megawatts peak/.test(res) && /400 megawatts of wind/.test(res) && /97 percent of the hours/.test(res) && /3 million units short/.test(res) && /EMD is 151 crore/.test(res) && /7 June 2028/.test(res), res);
const fin = financeOf(sized, terms);
assert.ok(fin && fin.rows[0].blockPenalty > 0, "the financial model charges the block shortfall");
assert.ok(Math.abs(fin.equityIrr - filled.fin.targetEquityIrr) < 1e-6);
// a quoted tariff against the target: the equity and project IRR the quote really earns
const atTarget = quotedReturns(sized, terms, Math.ceil(fin.tariff * 100) / 100);
assert.equal(atTarget.status, "ok", atTarget.message);
assert.ok(atTarget.equityIrr >= filled.fin.targetEquityIrr - 1e-6, "rounding the target tariff up keeps the target IRR");
assert.ok(Math.abs(atTarget.targetTariff - fin.tariff) < 1e-9);
const low = quotedReturns(sized, terms, Number((fin.tariff * 0.85).toFixed(2)));
assert.equal(low.status, "below", low.message);
assert.ok(low.equityIrr < filled.fin.targetEquityIrr && low.projectIrr < atTarget.projectIrr, "a lower tariff earns less on equity and on the project");
assert.ok(low.equityIrr > 0 && Number.isFinite(low.projectIrr));
assert.ok(/below the/.test(low.message) && /equity IRR is \d/.test(low.message) && /project IRR \d/.test(low.message), low.message);
const loss = quotedReturns(sized, terms, 1);
assert.equal(loss.status, "loss", loss.message);
assert.equal(quotedReturns({ ...sized, lp: null }, terms, 5), null, "no quote check before sizing");
assert.equal(quotedReturns(sized, terms, null), null);
const lowChecks = Object.fromEntries(bidChecks({ ...sized, forms: { ...forms, tariff: low.tariff } }, terms).map((c) => [c.id, c]));
assert.equal(lowChecks.tariff.status, "warn", "a quote below the target IRR tariff is flagged on the bid forms");
assert.ok(/project IRR/.test(lowChecks.tariff.detail), lowChecks.tariff.detail);
// ---- the RfS formats: which this bid needs, where each blank comes from, the bid pack
const fmt = (id) => PACK.formats.find((f) => f.id === id);
const company = { ...sized, forms: { ...forms, bidderType: "company", emdForm: "bg", commonShareholding: "no", connectivity: "final" } };
assert.equal(applies(company, fmt("7.1")), "yes");
assert.equal(applies(company, fmt("7.2")), "no", "Power of Attorney only for a consortium");
assert.equal(applies({ ...company, forms: { ...company.forms, bidderType: "consortium" } }, fmt("7.2")), "yes");
assert.deepEqual(["7.3A", "7.3B", "7.3C"].map((id) => applies(company, fmt(id))), ["yes", "no", "no"], "the EMD format follows the instrument chosen");
assert.equal(applies({ ...company, forms: { ...company.forms, emdForm: null } }, fmt("7.3B")), "choose");
assert.equal(applies(company, fmt("7.3D")), "later", "the PBG comes after the award");
assert.deepEqual([applies(company, fmt("7.8")), applies(company, fmt("7.8A"))], ["yes", "no"]);
assert.equal(applies({ ...company, forms: { ...company.forms, commonShareholding: "yes" } }, fmt("7.8A")), "yes");
assert.equal(applies(company, fmt("Annexure-I")), "no");
assert.equal(applies({ ...company, forms: { ...company.forms, connectivity: "other" } }, fmt("Annexure-I")), "yes", "another entity's connectivity needs its undertaking");
const capBlank = fmt("7.1").fields.find((x) => x.maps === "contractedMw");
assert.deepEqual(blankValue(company, fmt("7.1"), capBlank), { source: "model", key: "contractedMw", value: String(company.bid.baseMw) });
const bidderBlank = fmt("7.10").fields.find((x) => x.maps === "bidder");
assert.equal(blankValue(company, fmt("7.10"), bidderBlank).value, "Acme Renewables Ltd");
assert.equal(blankValue(company, fmt("7.1"), { maps: "connectivity", key: "c" }).value, "Final grant", "choices read as their labels");
assert.equal(blankValue(company, fmt("7.1"), { maps: "date", key: "d" }).value, "20.05.2026", "the letters' date");
// a consortium member's blanks of Format 7.4 (equity, other members, Consortium Agreement) are not
// asked of a single company: shown as not applicable, not counted as empty
const equity = fmt("7.4").fields.find((x) => x.key === "equityPct");
assert.equal(fieldApplies(company, equity), false);
assert.deepEqual(blankValue(company, fmt("7.4"), equity).value, NOT_APPLICABLE);
const consortium = { ...company, forms: { ...company.forms, bidderType: "consortium" } };
assert.equal(fieldApplies(consortium, equity), true);
assert.equal(formatStatus(consortium, fmt("7.4")).total - formatStatus(company, fmt("7.4")).total, 4, "four 7.4 blanks are a consortium's only");
assert.ok(!formatStatus(company, fmt("7.4")).missing.includes(equity.label));
const st71 = formatStatus(company, fmt("7.1"));
assert.ok(st71.total > 20 && st71.missing.length > 0 && st71.reviewed === null);
const sum = formatsSummary(company);
assert.ok(sum.needed >= 10 && sum.reviewed === 0 && sum.blanksLeft > 0, JSON.stringify(sum));
assert.deepEqual(formatGroups(company).map((g) => g.id), ["envelope1", "envelope2", "later", "na"]);
assert.ok(formatGroups(company).find((g) => g.id === "envelope2").list.some((f) => f.id === "7.10"), "the financial bid goes in Envelope II");
const packFormats = formatsForPack(company);
assert.ok(packFormats.some((f) => f.id === "7.1") && !packFormats.some((f) => f.id === "7.2"));
assert.ok(packFormats.find((f) => f.id === "7.10").fields.some((x) => x.value === "Acme Renewables Ltd"));
const words = explainFinance(sized, fin);
assert.ok(/rupees per unit/.test(words) && /Penalties come to/.test(words), words);

console.log(`SECI RTC tender checks passed (${PACK.conditions.length} conditions, ${script.length} script steps; year-1 block penalty ₹${fin.rows[0].blockPenalty.toFixed(2)} cr)`);
