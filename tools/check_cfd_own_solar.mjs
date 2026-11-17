// Checks for the CfD Own Solar tab (web/src/cfd/ownSolar.js, and what it switches on in
// model.js and finance.js): an existing plant under a bilateral agreement charges the battery at
// its fixed price for the first months only and inside the CfDA's bought-power allowance; own RE
// commissioned after the SCD has its cost spent, and its debt drawn, in the year it is
// commissioned; with the RE ready at the SCD the tab's bid is the CfD Bid tab's bid to the paisa;
// a bid's summary, the comparison of the two and the copy of one into the other.
// Run from the repository root:
//   node tools/check_cfd_own_solar.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultCfdState, fillBenchmarks, fillWinning, runModel } from "../web/src/cfd/model.js";
import { cfdEngineInputs, runCfdFinance } from "../web/src/cfd/finance.js";
import { OWN_SOLAR_DEFAULTS, OWN_SOLAR_KEYS, bidSummary, compareBids, copyBid, hasBilateral } from "../web/src/cfd/ownSolar.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);

// the bid both tabs start from: little own solar, charging power bought from the green market
const base = fillWinning(fillBenchmarks(defaultCfdState()));
base.inputs = { ...base.inputs, contractedMw: 150, effectiveDate: "2027-02-01", solarMw: 60, reCodMonths: 0, useMarket: true, augmentation: "annual" };
base.filled = { ...base.filled, solarMw: false };
const withInputs = (s, patch) => ({ ...s, inputs: { ...s.inputs, ...patch } });
const run = (s) => { const model = runModel(s, prices); return { state: s, model, finance: runCfdFinance(s, model) }; };

// ---- the tab's inputs
assert.deepEqual(OWN_SOLAR_KEYS, ["reCostAtCod", "bilateralMonths", "bilateralPrice", "bilateralCharges", "bilateralMw", "bilateralUse"]);
assert.equal(OWN_SOLAR_DEFAULTS.reCostAtCod, true, "own RE's cost when commissioned is the tab's default");
assert.equal(hasBilateral(OWN_SOLAR_DEFAULTS), false);
assert.equal(hasBilateral({ bilateralMonths: 12, bilateralPrice: 2.3 }), true);
assert.equal(hasBilateral({ bilateralMonths: 12, bilateralPrice: null }), false, "no price, no plant");
assert.equal(hasBilateral({ bilateralMonths: 0, bilateralPrice: 2.3 }), false);

// ---- with the RE ready at the SCD and no existing plant, the tab's bid is the CfD Bid tab's bid
const std = run(base);
{
  const own = run(withInputs(base, { ...OWN_SOLAR_DEFAULTS }));
  assert.equal(cfdEngineInputs(own.state, own.model).lateRe, null, "nothing is late");
  near(own.finance.tariff, std.finance.tariff, 1e-12, "the same strike price");
  near(own.finance.equityIrr, std.finance.equityIrr, 1e-12, "the same equity IRR");
  near(own.finance.capex.total, std.finance.capex.total, 1e-12, "the same project cost");
  assert.deepEqual(own.model.opYears.map((r) => r.chargeMarketMwh), std.model.opYears.map((r) => r.chargeMarketMwh), "the same operation");
  assert.equal(sum(own.model.opYears, "chargeBilateralMwh"), 0);
}

// ---- an existing plant for the first 12 months: charges the battery at its price, then stops
const PRICE = 2.3;
const CHARGES = 0.3;
const bil = run(withInputs(base, { reCodMonths: 12, bilateralMonths: 12, bilateralPrice: PRICE, bilateralCharges: CHARGES }));
const late = run(withInputs(base, { reCodMonths: 12 })); // the same bid without the plant
{
  const ops = bil.model.opYears;
  assert.ok(ops[0].chargeBilateralMwh > 1000, `the plant charges the battery in year 1: ${ops[0].chargeBilateralMwh} MWh`);
  assert.ok(ops.slice(1).every((r) => !(r.chargeBilateralMwh > 0)), "and not after its 12 months");
  near(ops[0].bilateralCostCr, (ops[0].chargeBilateralMwh * (PRICE + CHARGES)) / 1e4, 1e-9, "paid at its price with the charges on it");
  assert.ok(ops[0].chargeBilateralMwh <= ops[0].chargeMarketMwh + 1e-6 && ops[0].bilateralCostCr <= ops[0].marketCostCr + 1e-9, "it is part of the bought power");
  // inside the allowance the CfDA gives the green market and bilateral power together
  for (const r of ops) assert.ok(!(r.marketCapMwh > 0) || r.marketUsedMwh === undefined || r.marketUsedMwh <= r.marketCapMwh + 1e-6, `year ${r.year}: within the allowance`);
  // a firm supply is taken before the market, so it lowers the bid only where it is the cheaper:
  // at the benchmark prices the green market's midday hours are below ₹2.60, so this plant costs more
  const y1 = (m) => (m.opYears[0].marketCostCr * 1e4) / Math.max(1, m.opYears[0].chargeMarketMwh);
  assert.ok(y1(late.model) < PRICE + CHARGES, `the market's charging hours are below the plant's price here: ₹${y1(late.model).toFixed(2)}`);
  assert.ok(y1(bil.model) > y1(late.model) && bil.finance.tariff > late.finance.tariff, "so the firm plant costs more than the market would");
  const cheap = run(withInputs(base, { reCodMonths: 12, bilateralMonths: 12, bilateralPrice: 1, bilateralCharges: 0 }));
  assert.ok(y1(cheap.model) < y1(late.model), `a plant below the market makes year 1's bought power cheaper: ₹${y1(cheap.model).toFixed(2)} against ₹${y1(late.model).toFixed(2)}`);
  assert.ok(cheap.finance.tariff < late.finance.tariff, `and the strike price lower: ${cheap.finance.tariff} against ${late.finance.tariff}`);
  near(cheap.model.opYears[1].marketCostCr, late.model.opYears[1].marketCostCr, 1e-9, "year 2 is untouched by it");
  // taken only where it is the cheaper, the same plant never costs more than the market alone
  const pick = run(withInputs(base, { reCodMonths: 12, bilateralMonths: 12, bilateralPrice: PRICE, bilateralCharges: CHARGES, bilateralUse: "cheapest" }));
  assert.ok(pick.model.opYears[0].chargeBilateralMwh < ops[0].chargeBilateralMwh, "taken only where cheaper, it gives less than as a firm supply");
  assert.ok(pick.finance.tariff <= late.finance.tariff + 1e-6, `and the bid is no dearer for it: ${pick.finance.tariff} against ${late.finance.tariff}`);
  // without the green market switched on, the plant alone still supplies (its own allowance)
  const only = run(withInputs(base, { useMarket: false, reCodMonths: 12, bilateralMonths: 12, bilateralPrice: PRICE }));
  assert.ok(only.model.opYears[0].chargeBilateralMwh > 1000, "the plant supplies with the green market off");
  near(only.model.opYears[0].chargeBilateralMwh, only.model.opYears[0].chargeMarketMwh, 1e-9, "and is all of the bought power then");
  assert.equal(sum(only.model.opYears.slice(1), "chargeMarketMwh"), 0, "nothing is bought after it");
}

// ---- the plant's MW limits what it gives; "cheapest" takes it only where it is the cheaper
{
  const small = run(withInputs(base, { reCodMonths: 12, bilateralMonths: 12, bilateralPrice: PRICE, bilateralMw: 10 }));
  const big = run(withInputs(base, { reCodMonths: 12, bilateralMonths: 12, bilateralPrice: PRICE, bilateralMw: 200 }));
  const of = (r) => r.model.opYears[0].chargeBilateralMwh;
  assert.ok(of(small) > 0 && of(small) < of(big), `a 10 MW plant gives less than a 200 MW one: ${of(small)} against ${of(big)}`);
  assert.ok(of(small) <= 10 * 8784 * 0.35, "and no more than a 10 MW solar plant makes in a year");
  const dear = run(withInputs(base, { reCodMonths: 12, bilateralMonths: 12, bilateralPrice: 40, bilateralUse: "cheapest" }));
  assert.equal(of(dear), 0, "a plant dearer than every market hour is not used when only the cheaper is taken");
  const firm = run(withInputs(base, { reCodMonths: 12, bilateralMonths: 12, bilateralPrice: 40, bilateralUse: "first" }));
  assert.ok(of(firm) > 0, "and is used first when it is a firm supply");
  const six = run(withInputs(base, { reCodMonths: 12, bilateralMonths: 6, bilateralPrice: PRICE }));
  assert.ok(of(six) > 0 && of(six) < of(bil) * 0.75, `six months give about half of twelve: ${of(six)} against ${of(bil)}`);
}

// ---- own RE commissioned after the SCD: the cost is spent, and its debt drawn, when it is built
{
  const own = run(withInputs(base, { reCodMonths: 12, reCostAtCod: true }));
  const eng = cfdEngineInputs(own.state, own.model);
  const l = eng.lateRe;
  assert.ok(l && l.year === 1 && l.capexCr > 0, "the RE's cost is spent in operating year 1");
  near(l.capexCr, l.hardCr + l.preopCr + l.idcCr, 1e-12, "its cost with the pre-operative share and its IDC");
  near(l.hardCr, base.inputs.solarMw * base.inputs.solarCrPerMw, 1e-9, "the solar at the bid's cost per MW");
  near(own.finance.capex.total + l.hardCr + l.preopCr, late.finance.capex.total - (late.finance.capex.idc - own.finance.capex.idc), 0.01, "the same plant: the project cost at the SCD is less by the RE");
  const row = own.finance.rows[l.year - 1];
  near(row.fundedCapex, l.capexCr, 1e-9, "spent as funded capital in that year");
  near(row.topUpCr - (row.refiTopUpCr || 0), l.debtShare * l.capexCr, 1e-4, "the bid's debt share of it drawn that year");
  assert.ok(own.finance.rows.every((r, k) => k === l.year - 1 || !(r.fundedCapex > 0)), "and in no other year");
  assert.ok(own.finance.equity < late.finance.equity - 1, `less equity at the SCD: ${own.finance.equity} against ${late.finance.equity}`);
  assert.ok(own.finance.tariff < late.finance.tariff, `spending when it is built is the cheaper: ${own.finance.tariff} against ${late.finance.tariff}`);
  assert.ok(own.finance.tariff > std.finance.tariff, "and a year without own RE still costs more than having it at the SCD");
  assert.deepEqual(own.model.opYears.map((r) => r.chargeMarketMwh), late.model.opYears.map((r) => r.chargeMarketMwh), "the operation is the same: only the money moves");
  // the tender's last date, 21 months after the SCD: in operating year 2
  const y2 = run(withInputs(base, { reCodMonths: 21, reCostAtCod: true }));
  assert.equal(cfdEngineInputs(y2.state, y2.model).lateRe.year, 2);
  assert.ok(y2.finance.rows[1].fundedCapex > 0 && !(y2.finance.rows[0].fundedCapex > 0), "spent in year 2");
  assert.equal(runModel(withInputs(base, { reCodMonths: 30 }), prices), null, "later than the tender allows is not modelled");
  // switched off, the cost is carried from the SCD as on the CfD Bid tab
  const off = run(withInputs(base, { reCodMonths: 12, reCostAtCod: false }));
  near(off.finance.tariff, late.finance.tariff, 1e-12, "switched off: the CfD Bid tab's model");
}

// ---- a bid's summary and the comparison of the two tabs
{
  const a = bidSummary(std.state, std.model, std.finance);
  // the tab's bid: the RE 12 months after the SCD with its cost then, and the existing plant meanwhile
  const tab = run(withInputs(base, { ...OWN_SOLAR_DEFAULTS, reCodMonths: 12, bilateralMonths: 12, bilateralPrice: PRICE, bilateralCharges: CHARGES }));
  const b = bidSummary(tab.state, tab.model, tab.finance);
  near(a.tariff, std.finance.tariff, 1e-12, "the summary's strike price");
  assert.equal(a.lateReCr, 0);
  assert.equal(a.lateReYear, null);
  near(a.totalCostCr, std.finance.capex.total, 1e-12, "all the capital is at the SCD on the CfD Bid tab");
  assert.equal(b.lateReYear, 1);
  near(b.totalCostCr, tab.finance.capex.total + b.lateReCr, 1e-12, "capital in all: at the SCD and when the RE is built");
  near(b.debtCr + b.equityCr, b.totalCostCr, 1e-6, "debt and equity in all make the capital");
  near(b.year1BilateralMu, tab.model.opYears[0].chargeBilateralMwh / 1000, 1e-12, "the plant's energy in year 1");
  assert.ok(b.year1BoughtPrice > PRICE && b.year1BoughtPrice < 6, `year 1's bought power at ₹${b.year1BoughtPrice}`);
  assert.equal(a.year1BilateralMu, 0);
  const rows = compareBids(a, b);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  near(byKey.tariff.diff, b.tariff - a.tariff, 1e-12, "the difference is this tab's less the CfD Bid tab's");
  assert.equal(byKey.tariff.better, "low");
  assert.equal(byKey.equityIrr.better, "high");
  assert.equal(byKey.solarMw.diff, 0);
  assert.ok(rows.every((r) => r.label && r.unit && ("a" in r) && ("b" in r)), "every row is labelled");
  assert.equal(compareBids({ ...a, minDscr: null }, b).find((r) => r.key === "minDscr").diff, null, "no difference without both numbers");
}

// ---- the CfD Bid tab's bid copied in: its numbers, this tab's own inputs kept
{
  const into = { ...defaultCfdState(), forms: { kept: true }, inputs: { ...defaultCfdState().inputs, ...OWN_SOLAR_DEFAULTS, bilateralMonths: 12, bilateralPrice: 2.3, contractedMw: 50 } };
  const from = { ...base, locks: { "inputs.solarMw": true }, tariffLocked: true, quoteTariff: 7.4 };
  const out = copyBid(from, into);
  assert.equal(out.inputs.contractedMw, 150, "the bid's inputs come over");
  assert.equal(out.inputs.solarMw, 60);
  assert.ok(out.inputs.bilateralMonths === 12 && out.inputs.bilateralPrice === 2.3 && out.inputs.reCostAtCod === true, "this tab's own inputs stay");
  assert.deepEqual(out.forms, { kept: true }, "the forms stay with the tab");
  assert.deepEqual(out.locks, {}, "locks are not copied");
  assert.ok(out.tariffLocked === true && out.quoteTariff === 7.4, "a frozen strike price comes over");
  out.inputs.solarMw = 1;
  out.fin.x = 1;
  assert.ok(from.inputs.solarMw === 60 && from.fin.x === undefined, "a copy, not a reference");
  // a bid never opened on this tab: the tab's defaults
  const fresh = copyBid(from, { inputs: {} });
  for (const k of OWN_SOLAR_KEYS) assert.equal(fresh.inputs[k], OWN_SOLAR_DEFAULTS[k], k);
  // the copied bid, as this tab models it, is the source bid when nothing is late
  const copied = run(copyBid(base, { inputs: {} }));
  near(copied.finance.tariff, std.finance.tariff, 1e-12, "copied in with nothing late: the same strike price");
}

console.log("OK  CfD Own Solar: existing plant for the first months, own RE's cost when commissioned, summary, comparison and copy");
