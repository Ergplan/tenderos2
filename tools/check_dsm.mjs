// Checks for the deviation settlement model (web/src/dsm/dsm.js): the charge per MWh scheduled is
// a line in the contract rate, the bands and the X factor follow the year, a battery firms the
// schedule, the steps beyond the band cost what the norms say, and the financial model carries
// the year's charge as a cost of operation that moves with the tariff.
// Run from the repository root:   node tools/check_dsm.mjs
import assert from "node:assert/strict";
import * as D from "../web/src/dsm/dsm.js";
import * as E from "../web/src/rtc/engine.js";
import { defaultBidState, dsmFor, modelInputs, opsFromLp } from "../web/src/bid/model.js";

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// one block: in-band deviation at X = 1 costs nothing; beyond the band the steps apply
{
  const norms = { tolerance: 0.05, x: 1, steps: D.DSM_DEFAULTS.steps, normalUnder: 6, normalOver: 2.5 };
  assert.deepEqual(D.chargePerMwh(-0.04, norms), { a: 0, b: 0 });
  assert.deepEqual(D.chargePerMwh(0.05, norms), { a: 0, b: 0 });
  // 12% short: 5% in band, 5% at 110% (costs 10%), 2% at 150% (costs 50%) → 0.05×0.1 + 0.02×0.5 = 0.015 of the contract per kWh scheduled
  const u = D.chargePerMwh(-0.12, norms);
  assert.ok(close(u.a, 0.015 * 1000) && u.b === 0, JSON.stringify(u));
  // 30% long: 5% in band, 5% paid at 90% (loses 10%), 10% at 50% (loses 50%), 10% at 0 (loses all)
  const o = D.chargePerMwh(0.3, norms);
  assert.ok(close(o.a, (0.05 * 0.1 + 0.1 * 0.5 + 0.1 * 1) * 1000), JSON.stringify(o));
  // X = 0: the in-band short is settled at the dear normal rate, the in-band long at the cheap one
  const x0 = D.chargePerMwh(-0.03, { ...norms, x: 0 });
  assert.ok(close(x0.a, -0.03 * 1000) && close(x0.b, 0.03 * 6 * 1000));
  const x0o = D.chargePerMwh(0.03, { ...norms, x: 0 });
  assert.ok(close(x0o.a, 0.03 * 1000) && close(x0o.b, -0.03 * 2.5 * 1000));
}

// the year: bands tighten from FY2026-27, X winds down to 0 by FY2031-32
assert.equal(D.toleranceOf("solar", 1, 2026), 0.10);
assert.equal(D.toleranceOf("solar", 1, 2027), 0.05);
assert.equal(D.toleranceOf("wind", 1, 2027), 0.10);
assert.equal(D.xFactor(1, 2026), 1);
assert.equal(D.xFactor(1, 2028), 0.95);
assert.equal(D.xFactor(4, 2028), 0.35);
assert.equal(D.xFactor(5, 2028), 0);
assert.equal(D.dsmCategory({}, { solar: true, wind: true, bess: true }), "hybrid");
assert.equal(D.dsmCategory({}, { wind: true }), "wind");
assert.equal(D.dsmCategory({ category: "solar" }, { wind: true }), "solar");

// the expected charge: more error, more charge; a battery cuts it; off is zero; it rises with the
// X factor winding down (the dear normal rate when short outweighs the cheap one when long)
{
  const u = (over = {}, year = 1, hasStorage = false) => D.dsmUnitCharge({ dsm: over, category: "hybrid", hasStorage, year, contract: 5 });
  assert.ok(u({ sigmaPct: 0.12 }).perMwh > u({ sigmaPct: 0.06 }).perMwh, "more error, more charge");
  assert.ok(u({}, 1, true).perMwh < u({}, 1, false).perMwh, "a battery firms the schedule");
  assert.equal(u({ on: false }).perMwh, 0);
  assert.ok(u({}, 6).perMwh > u({}, 1).perMwh, "X winding down raises the charge");
  assert.ok(u({}).outOfBand > 0.3 && u({}).outOfBand < 0.6, `out of band ${u({}).outOfBand}`);
  const line = u({}, 3);
  assert.ok(close(line.perMwh, line.a * 5 + line.b), "a line in the contract rate");
  assert.ok(D.dsmChargeCr({ dsm: {}, category: "wind", hasStorage: false, year: 1, contract: 5, scheduledMwh: 1e6 }) > 1, "₹ crore a year on a TWh");
  assert.ok(/tolerance ±5%/.test(D.dsmNote({}, "solar")));
}

// the financial model: the ops carry the lines, the cost is in the operating cost and moves with the tariff
{
  const s = defaultBidState();
  s.bid = { baseMw: 300, greenshoe: false };
  s.sources = { solar: true, wind: true, hydro: false, biomass: false, thermal: false, bess: true };
  s.src.solar = { capacity: { mode: "optimise", mw: 2000 }, cuf: 0.25, dcAc: 1.4, degradation: 0.005, capex: 4, om: 4 };
  s.src.wind = { capacity: { mode: "optimise", mw: 1000 }, cuf: 0.33, capex: 6.5, om: 9 };
  s.src.bess = { capacity: { mode: "optimise", mw: 600 }, duration: "4", rte: 0.87, minSoc: 0.05, maxSoc: 0.95, degradation: 0.02, augmentation: "annual", capex: 1.2, om: 1.2 };
  s.costs = { preopPct: 0.05, evacuationCr: 120 };
  const m = modelInputs(s, { years: 25, sale: "allowed", rules: [] });
  const sizes = { solarMw: 785, windMw: 439, bessMw: 634, bessMwh: 2538 };
  const lifetime = Array.from({ length: 25 }, (_, i) => ({ year: i + 1, demandMwh: 300 * 8760, deliveredMwh: 0.89 * 300 * 8760, exportMwh: 1e4 }));
  const lp = { sizes, tariff: 7, perYear: [{ year: 1, minMonthlyDfr: 0.8 }], lifetime };
  const run = (dsm) => {
    const ops = opsFromLp(lp, m.fin, m.bess, dsmFor({ ...s, dsm }));
    return E.runFinancialModel(null, sizes, { costs: m.costs, fin: m.fin, bess: m.bess, dfrTarget: 0.85, tariffLocked: false, ops, solveBy: "npv" });
  };
  const on = run({ ...D.DSM_DEFAULTS });
  const off = run({ ...D.DSM_DEFAULTS, on: false });
  const r = on.rows[0];
  assert.ok(r.dsm > 0 && off.rows[0].dsm === 0, "the DSM charge is a cost of the year");
  const scheduled = (r.deliveredMu + r.excessMu) * 1000;
  const u = D.dsmUnitCharge({ dsm: D.DSM_DEFAULTS, category: "hybrid", hasStorage: true, year: 1, contract: r.tariff });
  assert.ok(close(r.dsm, (scheduled * u.perMwh) / 1e7, 1e-9), `year 1: ${r.dsm} vs ${(scheduled * u.perMwh) / 1e7}`);
  assert.ok(close(r.opex, r.om + r.insurance + r.other + r.fuel + r.dsm, 1e-9), "in the operating cost");
  assert.ok(on.tariff > off.tariff, `the tariff carries the DSM charge: ${on.tariff} vs ${off.tariff}`);
  assert.ok(on.rows[8].dsm > on.rows[0].dsm, "the charge grows as X winds down");
  const ops = opsFromLp(lp, m.fin, m.bess, null);
  assert.ok(ops[0].dsmA === undefined && ops[0].dsmChargeCr === undefined, "no DSM when not asked for");
  console.log(`DSM checks passed (year-1 charge ₹${r.dsm.toFixed(2)} cr on ${(scheduled / 1000).toFixed(0)} MU, ₹${u.perMwh.toFixed(1)}/MWh; tariff ₹${on.tariff.toFixed(4)} with DSM, ₹${off.tariff.toFixed(4)} without)`);
}
