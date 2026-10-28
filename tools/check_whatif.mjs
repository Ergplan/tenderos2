// Checks for the What-if analysis (web/src/whatif/model.js): the dispatch keeps its energy books,
// the battery is held for the peak, the floors are counted hour by hour, the returns move the
// right way with the tariff and the size, the tariff the target IRR needs gives that IRR, the
// tender checks catch a plant the tender would refuse, and the traceable model agrees.
// Run from the repository root:   node tools/check_whatif.mjs
import assert from "node:assert/strict";
import * as E from "../web/src/rtc/engine.js";
import { defaultWhatIf, dispatchYear, profilesFor, runWhatIf } from "../web/src/whatif/model.js";
import { traceModel } from "../web/src/model/trace.js";

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const base = defaultWhatIf();
const t0 = Date.now();
const r = runWhatIf(base);
const ms = Date.now() - t0;

// energy books for year 1, at the bus: generation = served + charged + sold + curtailed
const y1 = r.year1;
const poi = (1 - base.trafoLossPct) * (1 - base.lineLossPct);
const gen = y1.solarGenMWh + y1.windGenMWh;
const servedBus = y1.injectedMWh - y1.excessMWh / poi - y1.dischargeMWh / poi; // direct renewable energy at the bus
assert.ok(close(gen, servedBus + y1.chargeMWh + y1.excessMWh / poi + y1.curtailMWh, 1e-6), "generation is served, stored, sold or curtailed");
assert.ok(y1.deliveredMWh <= y1.demandMWh + 1e-6, "never more than the contract");
assert.ok(close(y1.demandMWh, base.contractedMw * 8760));
assert.ok(close(y1.meterMWh, y1.injectedMWh * poi));
// the floors are counted over every hour, peak and off-peak
assert.equal(y1.rules.peak.hours + y1.rules.offpeak.hours, 8760);
assert.equal(y1.rules.peak.hours, 16 * 365, "any 6 of 16 hours: all 16 held to the peak floor");
const ev = runWhatIf({ ...base, peakPlan: "evening" });
assert.equal(ev.year1.rules.peak.hours, 6 * 365);
assert.ok(ev.year1.rules.peak.share >= r.year1.rules.peak.share, "a shorter peak is easier to meet");

// the battery is held for the peak: more of its discharge lands in Peak Hours than their share of the day
const H = y1.hourly;
let disPeak = 0;
let disAll = 0;
for (let h = 0; h < 8760; h += 1) { disAll += H.discharge[h]; if (H.peak[h]) disPeak += H.discharge[h]; }
assert.ok(disPeak / disAll > 16 / 24, `${(disPeak / disAll * 100).toFixed(1)}% of discharge in the peak`);

// returns move the right way
const up = runWhatIf({ ...base, fin: { ...base.fin, tariff: base.fin.tariff + 0.5 } });
assert.ok(up.finance.equityIrr > r.finance.equityIrr && up.finance.projectIrr > r.finance.projectIrr);
const cheap = runWhatIf({ ...base, costs: { ...base.costs, solarCrPerMwac: base.costs.solarCrPerMwac - 0.5 } });
assert.ok(cheap.finance.tariffNeeded < r.finance.tariffNeeded, "cheaper solar, lower tariff needed");
// the tariff the target needs gives the target
const atNeed = runWhatIf({ ...base, fin: { ...base.fin, tariff: r.finance.tariffNeeded } });
assert.ok(Math.abs(atNeed.finance.equityIrr - base.fin.targetEquityIrr) < 5e-4, `${atNeed.finance.equityIrr}`);
assert.ok(atNeed.finance.meetsTarget || Math.abs(atNeed.finance.equityIrr - base.fin.targetEquityIrr) < 5e-4);
// the lender earns the interest rate on equal repayment with no fees
assert.ok(Math.abs(r.finance.lenderIrr - base.fin.interestRate) < 1e-6, `${r.finance.lenderIrr}`);
// more battery, more peak blocks met
const bigB = runWhatIf({ ...base, bessMw: base.bessMw * 1.5 });
assert.ok(bigB.year1.rules.peak.share > r.year1.rules.peak.share);

// the tender's checks
assert.equal(runWhatIf({ ...base, bessMw: 0 }).verdict, "fail", "storage is mandatory");
assert.equal(runWhatIf({ ...base, contractedMw: 20 }).verdict, "fail", "below the bid range");
assert.equal(runWhatIf({ ...base, contractedMw: 20 }).checks.find((c) => c.id === "capacity").ok, false);
const hard = runWhatIf({ ...base, shortfall: "hard" });
assert.equal(hard.verdict, hard.year1.rules.peak.share >= 1 && hard.year1.rules.offpeak.share >= 1 ? "pass" : "fail", "meet-every-block mode refuses a short block");
assert.equal(hard.fin.blockPenaltyMultiple, 0);
const tiny = runWhatIf({ ...base, contractedMw: 60 });
assert.equal(tiny.verdict, "pass", "a small contract on the same plant meets every floor");

// the penalty in the model is the energy short × 1.5 × the tariff
const row1 = r.atBid.rows[0];
assert.ok(close(row1.blockPenalty, (y1.blockShortfallMWh * 1.5 * base.fin.tariff) / 1e4, 1e-9));

// the traceable model rebuilds the same returns
const m = traceModel(r.live);
assert.ok(Math.abs(m.cells[m.keys.equityIrr].value - r.finance.equityIrr) < 1e-6);
assert.ok(Math.abs(m.cells[m.keys.projectIrr].value - r.finance.projectIrr) < 1e-6);
assert.ok(Math.abs(m.cells[m.keys.minDscr].value - r.finance.minDscr) < 1e-6);
// the profiles are cached and at the CUF asked for
const p = profilesFor(base);
assert.ok(Math.abs(E.mean(p.solarCf) - base.solarCuf) < 1e-6 && Math.abs(E.mean(p.windCf) - base.windCuf) < 1e-6);
assert.ok(dispatchYear(base, p, E.yearFactors(1, { years: 25 }, E.DEFAULT_BESS)).deliveredMWh > 0);
console.log(`What-if checks passed (${ms} ms a run; equity IRR ${(r.finance.equityIrr * 100).toFixed(2)}% at ₹${base.fin.tariff}, ₹${r.finance.tariffNeeded.toFixed(3)} for ${(base.fin.targetEquityIrr * 100).toFixed(0)}%; peak blocks met ${(y1.rules.peak.share * 100).toFixed(1)}%)`);
