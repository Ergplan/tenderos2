// Checks for the CfD Bid review (web/src/cfd/review.js): the uploaded 150 MW bid of 10 Nov 2026
// draws the findings its inputs deserve (the price against the peak-power awards, own solar not at
// its best, the extra battery that does not pay, the battery's window and fade, inputs far from
// the benchmarks, the year-1 refinancing); the benchmark bid, optimised, draws none of them but
// the price gap; the tender checks live in a plain module. Run from the repository root:
//   node tools/check_cfd_review.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultCfdState, fillBenchmarks, optimiseOwnRe, runModel } from "../web/src/cfd/model.js";
import { runCfdFinance } from "../web/src/cfd/finance.js";
import { sizingChecks } from "../web/src/cfd/checks.js";
import { peakAward, reviewBid } from "../web/src/cfd/review.js";
import { defaultLosses } from "../web/src/bid/model.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const pricerOf = (s) => (inputs, sim) => runCfdFinance({ ...s, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
const ids = (out) => out.findings.map((f) => f.id);
const sev = (out, id) => out.findings.find((f) => f.id === id)?.severity;

// ---- the uploaded bid
{
  const d = defaultCfdState();
  const s = fillBenchmarks({ ...d, losses: { ...defaultLosses(), lineLossPct: 0.01 }, inputs: { ...d.inputs, contractedMw: 150, effectiveDate: "2027-04-01", essSocMin: 0.0005, essSocMax: 0.5, rte: 0.85 } });
  s.inputs = { ...s.inputs, extraEssMwhPerMw: 2, solarMw: 14, useGroup: true, marketCharges: 0.65, groupPrice: 2.5, groupCharges: 0, gdamShareCap: 0, recPrice: 360, essCrPerMwh: 1.2, essOmLakhPerMwh: 2, solarOmLakhPerMw: 2, interestRate: 0.095, targetEquityIrr: 0.16 };
  for (const k of ["solarMw", "marketCharges", "groupPrice", "groupCharges", "gdamShareCap", "recPrice", "essCrPerMwh", "essOmLakhPerMwh", "solarOmLakhPerMw", "interestRate", "targetEquityIrr", "rte"]) s.filled[k] = false; // typed, as in the app
  s.bess = { augmentation: "schedule", augmentationYears: [4] };
  s.fin = { ...s.fin, repayment: "sculpted", targetDscr: 1.25, refiYear: 1, refiRate: 0.08, refiTenorYears: 12, refiFeePct: 0.002, rateStepDown: { afterYears: 2, rate: 0.085 }, dsraMonths: 6 };
  const model = runModel(s, prices, { price: pricerOf(s) });
  const finance = runCfdFinance(s, model);
  const checks = sizingChecks(model, s);
  assert.ok(checks.length >= 7 && checks.every((c) => ["met", "failed", "info"].includes(c.status)), "the tender checks as plain data");
  const out = reviewBid({ state: s, model, finance, prices });
  console.log(`uploaded bid: ${out.summary}\n  ${out.findings.map((f) => `[${f.severity}] ${f.title}`).join("\n  ")}`);
  const award = peakAward();
  assert.ok(award && award.hi > 0 && award.hi < 12, "a peak-power award to compare with");
  assert.equal(sev(out, "price-market"), "block", "₹26 is far above every peak-power award");
  // more own solar raises this bid's price (group RE at ₹2.5 beats solar at ₹4 cr/MWac), so the
  // review says buying is right rather than asking for solar
  assert.ok(!ids(out).includes("solar-not-optimised") && !ids(out).includes("little-own-re"), "the solar is not the lever of this bid");
  assert.equal(sev(out, "bought-charging-is-right"), "note");
  const drivers = out.findings.find((f) => f.id === "price-drivers");
  assert.ok(drivers && /battery's capex ₹\d/.test(drivers.title), `the battery's capex named first: ${drivers?.title}`);
  assert.equal(sev(out, "extra-battery"), "warn", "the extra battery does not pay");
  assert.equal(sev(out, "soc-window"), "warn", "the 50% window looks mistyped: a warning, not a note");
  assert.equal(sev(out, "battery-fade"), "warn", "augmentation in year 4 only leaves the last years short");
  assert.equal(sev(out, "inputs-above-benchmark"), "warn");
  const above = out.findings.find((f) => f.id === "inputs-above-benchmark").detail;
  assert.ok(above.includes("Charges on green-market power") && above.includes("Battery capex"), `market charges and battery capex named among the inputs above the benchmark: ${above}`);
  assert.equal(sev(out, "refi-year-1"), "note");
  assert.equal(sev(out, "high-equity-target"), "note");
  assert.ok(out.counts.block >= 1 && out.counts.warn >= 3, JSON.stringify(out.counts));
  for (const f of out.findings) assert.ok(f.title && f.detail && f.step, `${f.id} complete`);
}

// ---- the benchmark bid, optimised: the plant findings go; the price gap to the awards stays
{
  const s = fillBenchmarks(defaultCfdState());
  const best = await optimiseOwnRe(s, prices, { price: pricerOf(s) });
  s.inputs = { ...s.inputs, solarMw: best.solarMw, windMw: best.windMw };
  s.filled = { ...s.filled, solarMw: false };
  const model = runModel(s, prices, { price: pricerOf(s) });
  const finance = runCfdFinance(s, model);
  const out = reviewBid({ state: s, model, finance, prices });
  console.log(`benchmark bid (solar ${best.solarMw} MWac, ₹${finance.tariff.toFixed(3)}): ${out.summary}\n  ${out.findings.map((f) => `[${f.severity}] ${f.title}`).join("\n  ")}`);
  for (const id of ["solar-not-optimised", "little-own-re", "bought-charging-is-right", "extra-battery", "battery-oversized", "battery-fade", "inputs-above-benchmark", "inputs-below-benchmark", "refi-year-1", "high-equity-target"]) {
    assert.ok(!ids(out).includes(id), `the optimised benchmark bid has no "${id}" finding`);
  }
  // the benchmark bid's equal repayment at 75% debt does not finance (min DSCR under the lender's): a real finding
  assert.ok(out.findings.every((f) => f.severity !== "block" || ["price-market", "dscr-below-lender"].includes(f.id)), `nothing blocks but the market gap and the DSCR: ${ids(out)}`);
  assert.equal(sev(out, "dscr-below-lender"), "block");
}
console.log("check_cfd_review: ok");
