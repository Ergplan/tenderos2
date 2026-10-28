// Checks for the plant studios (web/src/plant/solar.js, wind.js): the solar layout follows the
// string voltage and the inverter blocks, the cost build-up adds up and converts between ₹/Wp,
// ₹ cr/MWp and ₹ cr/MWac, string and central inverters differ where they should; the wind
// turbines' curves and capacity factors behave, and the farm's cost adds up.
// Run from the repository root:   node tools/check_plant.mjs
import assert from "node:assert/strict";
import { INVERTERS, MODULES, defaultSolarStudio, inverterComparison, solarCost, solarDesign } from "../web/src/plant/solar.js";
import { TURBINES, powerCurve, turbineComparison, turbineYield, windCost, windFarm } from "../web/src/plant/wind.js";

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---- solar layout: the coldest-morning string voltage stays under 1500 V, one module more would not
for (const m of MODULES) {
  const d = solarDesign({ module: m.id, minTempC: 0 });
  assert.ok(d.stringVoc <= 1500, `${m.id}: ${d.stringVoc} V`);
  assert.ok(d.vocCold * (d.modulesPerString + 1) > 1500, `${m.id}: the string is as long as it can be`);
  assert.ok(d.dcMw >= 300 * 1.4 - 1e-9 && d.dcMw < 300 * 1.4 + (m.wp * d.modulesPerString) / 1e6 + 1e-9, "DC capacity rounded up to whole strings");
}
const fixed = solarDesign({});
const sat = solarDesign({ structure: "sat" });
assert.ok(sat.acresPerMwp > fixed.acresPerMwp, "trackers need more land per MWp (lower GCR)");
assert.ok(fixed.acresPerMwp > 2.5 && fixed.acresPerMwp < 4.5, `fixed tilt ${fixed.acresPerMwp} acres/MWp`);
const str = solarDesign({ inverter: "string" });
const cen = solarDesign({ inverter: "central" });
assert.equal(str.inverters, Math.ceil(300 / INVERTERS[0].unitMw));
assert.equal(cen.inverters, Math.ceil(300 / INVERTERS[1].unitMw));
assert.equal(str.idts, str.blocks, "string plants have an IDT per block");
assert.equal(cen.idts, 0, "central stations carry their MV transformer");

// ---- solar cost: lines add up; units convert; a price change moves the total by price × quantity
const c = solarCost({});
const sumLines = c.lines.reduce((a, l) => a + l.cr, 0);
assert.ok(close(sumLines, c.total, 1e-9), `${sumLines} vs ${c.total}`);
assert.ok(close(c.perWp, (c.total * 1e7) / (c.design.dcMw * 1e6)));
assert.ok(close(c.crPerMwp * 10, c.perWp), "₹ cr/MWp × 10 = ₹/Wp");
assert.ok(close(c.crPerMwac, c.crPerMwp * c.design.dcAc), "per MWac = per MWp × DC:AC");
const up = solarCost({ price: { modulePerWp: defaultSolarStudio().price.modulePerWp + 1 } });
const extraBase = (c.design.dcMw * 1e6) / 1e7; // ₹1/Wp on the DC watts, in ₹ crore
const factor = (1 + 0.06) * (1 + 0.03) * (1 + c.gstRate);
assert.ok(close(up.total - c.total, extraBase * factor, 1e-9), "₹1/Wp on modules carries margin, contingency and GST");
assert.ok(c.perWp > 22 && c.perWp < 40, `₹${c.perWp}/Wp`);
const cmp = inverterComparison({});
assert.equal(cmp.length, 2);
assert.ok(cmp.every((x) => x.cost.crPerMwac > 3 && x.cost.crPerMwac < 6));
assert.ok(cmp[0].cost.lines.some((l) => l.key === "idt") && !cmp[1].cost.lines.some((l) => l.key === "idt"));

// ---- wind: curves rise to rated and stop at cut-out; capacity factors rise with the wind
for (const t of TURBINES) {
  const pc = powerCurve(t);
  const at = (v) => pc.find(([x]) => x === v)[1];
  assert.equal(at(2), 0);
  assert.ok(at(14) > t.mw * 1000 * 0.97 && at(14) <= t.mw * 1000 + 1e-6, `${t.id} near rated at 14 m/s`);
  for (let i = 1; i < pc.length && pc[i][0] <= t.cutOut; i += 1) assert.ok(pc[i][1] >= pc[i - 1][1] - 1e-6, `${t.id} monotone`);
  assert.equal(at(25), 0, "cut out");
  const lo = turbineYield({ meanWindMs: 5.5 }, t.id).netCf;
  const hi = turbineYield({ meanWindMs: 7.5 }, t.id).netCf;
  assert.ok(hi > lo && lo > 0.1 && hi < 0.6, `${t.id}: ${lo} → ${hi}`);
}
// lower specific power, higher CUF at the same site
const all = turbineComparison({});
const v155 = all.find((x) => x.turbine.id === "vestas-v155-3.3");
const v150 = all.find((x) => x.turbine.id === "vestas-v150-4.2");
assert.ok(v155.specificPower < v150.specificPower && v155.netCf > v150.netCf);
const f = windFarm({ farmMw: 300, turbine: "suzlon-s144" });
assert.equal(f.count, Math.ceil(300 / 3.15));
assert.ok(close(f.energyMu, (f.netCf * f.mw * 8760) / 1000));
const w = windCost({ farmMw: 300 });
assert.ok(close(w.lines.reduce((a, l) => a + l.cr, 0), w.total));
assert.ok(w.crPerMw > 5 && w.crPerMw < 9, `₹${w.crPerMw} cr/MW`);
console.log(`Plant checks passed (solar ₹${c.perWp.toFixed(2)}/Wp = ₹${c.crPerMwac.toFixed(3)} cr/MWac; wind ${f.count} × S144, CUF ${(f.netCf * 100).toFixed(1)}%, ₹${w.crPerMw.toFixed(3)} cr/MW)`);
