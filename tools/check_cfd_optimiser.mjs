// Checks for the CfD bid's own-RE optimiser (web/src/cfd/model.js searchSize, optimiseOwnRe), the
// same search as the FDRE-X tab's:
//   1. the search on 400 synthetic curves of the shape the bids give (short days that never rise
//      with more solar and may never reach zero; a price with humps): it finds the exhaustive best,
//      under "meet" and "pay", every time;
//   2. on real 50 MW bids, combinations of what charges the battery (no green market, group RE at
//      Rs 1, group RE as a bilateral agreement in the first 36 months, an existing plant, surplus sale
//      on and off, the RE at the SCD or month 21, both policies): the optimiser's size is the best of
//      every whole MW of solar from 0 to 4 × the contracted capacity, priced through the full model;
//   3. the short days never rise with more solar on those bids (what the bisection relies on);
//   4. a locked solar size is kept; "every day met" means no short day as the Size step counts it.
// The audit behind it ran 432 combinations at 50, 100 and 150 MW and the client's 150 MW bid
// (docs/CFD.md, "The own-RE optimiser"). Run from the repository root:
//   node tools/check_cfd_optimiser.mjs        (about four minutes)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../web/src/cfd/model.js";
import { runCfdFinance } from "../web/src/cfd/finance.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const bestOf = (curve, policy) => {
  if (policy === "pay") return curve.reduce((a, b) => (b.sp < a.sp - 1e-9 ? b : a));
  const least = Math.min(...curve.map((p) => p.shortDays));
  return curve.filter((p) => p.shortDays === least).reduce((a, b) => (b.sp < a.sp - 1e-9 ? b : a));
};

// ---- 1. synthetic curves
{
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let n = 0;
  for (let k = 0; k < 400; k += 1) {
    const hi = 20 + Math.floor(rnd() * 580);
    // short days: a falling step function; a quarter of the curves never reach zero
    const steps = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => Math.floor(rnd() * hi)).sort((a, b) => a - b);
    const floor = rnd() < 0.25 ? 1 + Math.floor(rnd() * 50) : 0;
    const shortAt = (x) => floor + steps.filter((s) => x < s).length * 30;
    // the price: a trend, a broad hump or dip or two (wider than a tenth of the range), and the short days' cost
    const humps = Array.from({ length: Math.floor(rnd() * 3) }, () => ({ c: rnd() * hi, w: hi * (0.1 + rnd() * 0.3), h: (rnd() - 0.5) * 2 }));
    const a = 5 + rnd() * 5;
    const b = (rnd() - 0.4) * 4 / hi;
    const curve = Array.from({ length: hi + 1 }, (_, x) => ({ mw: x, shortDays: shortAt(x), sp: a + b * x + humps.reduce((s, h) => s + h.h * Math.exp(-(((x - h.c) / h.w) ** 2)), 0) + 0.002 * shortAt(x) }));
    for (const policy of ["meet", "pay"]) {
      const { best } = await M.searchSize({ evaluate: (mw) => curve[mw], hi, policy });
      const truth = bestOf(curve, policy);
      assert.ok(Math.abs(best.sp - truth.sp) < 1e-9 && best.shortDays === truth.shortDays, `curve ${k} (${policy}, 0–${hi} MW): ${best.mw} MW at ${best.sp} against ${truth.mw} at ${truth.sp}`);
      n += 1;
    }
  }
  console.log(`ok   search  ${n} synthetic searches: the exhaustive best every time`);
}

// ---- 2 and 3. real 50 MW bids
const base = M.fillWinning(M.defaultCfdState());
const bidOf = (patch) => {
  const s = { ...base, inputs: { ...base.inputs, contractedMw: 50, augmentation: "annual", ...patch }, filled: { ...base.filled, solarMw: false } };
  return s;
};
const pricerOf = (s) => (inputs, sim) => runCfdFinance({ ...s, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
const CASES = [
  ["no green market, group RE at Rs 1, surplus sold", { useMarket: false, useGroup: true, groupPrice: 1, groupCharges: 0, merchant: true, reCodMonths: 0 }],
  ["no green market, group RE at Rs 1, RE at month 21: nothing meets every day", { useMarket: false, useGroup: true, groupPrice: 1, groupCharges: 0, merchant: true, reCodMonths: 21 }],
  ["green market and group RE as a bilateral agreement in the first 36 months", { useMarket: true, useGroup: true, groupPrice: 1, groupCharges: 0, bilateralMonths: 21, bilateralPrice: 1, bilateralCharges: 0, bilateralUse: "first", merchant: true }],
  ["an existing plant for 24 months, no green market, no surplus sale", { useMarket: false, useGroup: true, groupPrice: 2.5, groupCharges: 0.3, bilateralMonths: 24, bilateralPrice: 1, bilateralMw: 70, merchant: false, reCodMonths: 0 }],
  ["green market only, surplus sold, the penalty paid", { useMarket: true, useGroup: false, merchant: true, shortfallPolicy: "pay" }],
  ["no green market, group RE at Rs 1, the penalty paid", { useMarket: false, useGroup: true, groupPrice: 1, groupCharges: 0, merchant: true, shortfallPolicy: "pay" }],
];
for (const [name, patch] of CASES) {
  const s = bidOf(patch);
  const inputs = M.modelInputs(s);
  const book = M.priceBook(prices, inputs.sellMarket);
  const price = pricerOf(s);
  const curve = [];
  for (let mw = 0; mw <= 200; mw += 1) {
    const i2 = { ...inputs, solarMw: mw };
    const sim = M.simulate(i2, book, M.profiles(i2));
    curve.push({ mw, sp: price(i2, sim).tariff, shortDays: sim.opYears.reduce((a, y) => a + y.shortDays, 0) });
  }
  assert.ok(curve.every((p, k) => k === 0 || p.shortDays <= curve[k - 1].shortDays), `${name}: the short days never rise with more solar`);
  const policy = s.inputs.shortfallPolicy === "pay" ? "pay" : "meet";
  const truth = bestOf(curve, policy);
  const got = await M.optimiseOwnRe(s, prices, { price });
  assert.ok(got.solarMw === truth.mw || Math.abs(got.sp - truth.sp) < 1e-9, `${name}: the optimiser's ${got.solarMw} MWac at ₹${got.sp.toFixed(4)} against the best ${truth.mw} MWac at ₹${truth.sp.toFixed(4)}`);
  assert.equal(got.shortDays, truth.shortDays, `${name}: short days`);
  assert.equal(got.ok, got.shortDays === 0, `${name}: "every day met" is no short day`);
  console.log(`ok   bid     ${name}: ${got.solarMw} MWac, ₹${got.sp.toFixed(3)}/kWh, ${got.shortDays} short days, the best of 201 sizes`);
}

// ---- 4. a locked solar size is kept
{
  const s = { ...bidOf({ useMarket: true, solarMw: 37 }), locks: { solarMw: true } };
  const got = await M.optimiseOwnRe(s, prices, { price: pricerOf(s) });
  assert.equal(got.solarMw, 37, "a locked solar size is kept");
}
console.log("OK  CfD own-RE optimiser: the exhaustive best on synthetic curves and on real bids, in whole MW");
