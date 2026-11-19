// Checks for the FDRE-X Bid tab (web/src/fdrex/FdrexBidTab.jsx), built on the Tender to Bid steps as
// the SECI RTC tab: the tender's terms (bidTerms.js), the HiGHS sizing request they make
// (web/src/bid/model.js lpPayload) and the financial model on the sizing's result (opsFromLp,
// runFinancialModel). The LP itself is checked in tests/engine/test_fdrex_lp.py.
//   1. the buyer's 4 hours a day (the costliest of the non-solar hours, or the evening), the monthly
//      rule (10% free and 1.5 × tariff beyond, or the whole month), bought power within 5% at the
//      GDAM price plus charges, no sale in the solar hours without that connectivity;
//   2. the sizing request: demand only in those hours, the rule's tolerance, the purchase and the
//      sale mask as chosen, solar, wind and the storage each sized by the optimizer or fixed;
//   3. the finance: power bought and the PSM discount as costs, the energy short beyond 10% at
//      1.5 × tariff, SECI's charges in the project cost, the workbook's names for those rows;
//   4. the dates, the money at stake and the view the bid forms read.
// Run from the repository root:  node tools/check_fdrex_bid.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "../web/src/rtc/engine.js";
import { DEFAULT_SETTINGS, TENDER, fdrexTerms, keyDates, moneyAtStake, nonSolarMask, seciChargesCr } from "../web/src/fdrex/bidTerms.js";
import { defaultFdrexBidState, formsView, fromSaved } from "../web/src/fdrex/bidState.js";
import { dsmFor, fillBenchmarks, lpPayload, missingInputs, modelInputs, opsFromLp, resourceProfiles } from "../web/src/bid/model.js";
import { liveModelRequest } from "../web/src/bid/liveModelRequest.js";
import { surfaceAxes, surfaceCell, surfaceSeed } from "../web/src/fdrex/surface.js";
import { FORMATS, formatPrint, formatStatus } from "../web/src/fdrex/formats.js";

const prices = JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url), "utf8"));
const count = (mask) => mask.reduce((a, v) => a + (v ? 1 : 0), 0);
const hourOf = (t) => t % 24;

// ---- 1. the terms
{
  const t = fdrexTerms(DEFAULT_SETTINGS, prices);
  assert.equal(count(t.supplyMask), 4 * 365, "4 hours every day");
  // each night's window runs from 18:00 to 06:00 the next morning (the last one wraps to 1 January)
  for (let d = 0; d < 365; d += 1) assert.equal(count(Array.from({ length: 12 }, (_, k) => t.supplyMask[(d * 24 + 18 + k) % 8760])), 4, `night ${d + 1}: 4 hours`);
  for (let i = 0; i < 8760; i += 1) if (t.supplyMask[i]) assert.ok(hourOf(i) >= 18 || hourOf(i) < 6, "only non-solar hours");
  assert.ok(t.peak.picked.pickedRsPerKwh > t.peak.picked.windowRsPerKwh, "the costliest hours of the window");
  const ev = fdrexTerms({ ...DEFAULT_SETTINGS, peakPlan: "evening" }, prices);
  for (let i = 0; i < 8760; i += 1) assert.equal(Boolean(ev.supplyMask[i]), hourOf(i) >= 18 && hourOf(i) < 22, "evening: 18:00–22:00");
  const pending = fdrexTerms(DEFAULT_SETTINGS, null);
  assert.ok(pending.peak.pricesPending && count(pending.supplyMask) === 1460, "without the prices: the evening hours, flagged");
  assert.deepEqual(t.rules, [{ id: "peak", label: t.rules[0].label, basis: "monthly", hours: "all", target: 1, penaltyMultiple: TENDER.penaltyMultiple, tolerance: TENDER.shortfallTolerance }]);
  const hard = fdrexTerms({ ...DEFAULT_SETTINGS, shortfall: "hard" }, prices);
  assert.equal(hard.rules[0].penaltyMultiple, undefined, "meet every month: no penalty, no tolerance");
  assert.equal(hard.rules[0].tolerance, undefined);
  assert.deepEqual({ ...t.purchase }, { enabled: true, maxShare: 0.05, market: "GDAM", chargesRsPerKwh: 0.3 });
  assert.equal(fdrexTerms({ ...DEFAULT_SETTINGS, buy: false }, prices).purchase.enabled, false);
  assert.equal(count(t.saleMask), 12 * 365, "sales in the non-solar hours only");
  assert.equal(fdrexTerms({ ...DEFAULT_SETTINGS, dayInjection: true }, prices).saleMask, null, "with solar-hour connectivity: sales at any hour");
  assert.equal(t.psmRsPerKwh, 0);
  assert.equal(fdrexTerms({ ...DEFAULT_SETTINGS, psm: true }, prices).psmRsPerKwh, 0.02);
  assert.ok(t.permitted.solar && t.permitted.wind && t.permitted.bess && t.mandatory.bess, "solar, wind and the mandatory storage");
  assert.equal(t.minBidMw, 50);
  assert.equal(t.maxBidMw, 600);
  assert.equal(t.years, 25);
  console.log(`ok   terms   4 hours a day (most often ${t.peak.picked.mostOften.join(", ")}:00, ₹${t.peak.picked.pickedRsPerKwh.toFixed(2)}/kWh against ₹${t.peak.picked.windowRsPerKwh.toFixed(2)} for the window); monthly 10% and 1.5×; 5% bought; sales in non-solar hours`);
}

// ---- 2. the sizing request
const base = () => {
  let st = defaultFdrexBidState();
  st.fdrex = { ...st.fdrex, ppaDate: "2027-03-01" };
  st = fillBenchmarks(st, fdrexTerms(st.fdrex, prices));
  st.market = { ...st.market, sell: true };
  return st;
};
{
  const st = base();
  const t = fdrexTerms(st.fdrex, prices);
  assert.deepEqual(missingInputs(st, t), [], "the benchmark bid is complete");
  assert.ok(st.sources.solar && st.sources.wind && st.sources.bess, "solar, wind and the storage on");
  const p = lpPayload(st, t, resourceProfiles(st), prices);
  for (let i = 0; i < 8760; i += 1) assert.equal(p.ctx.demand[i], t.supplyMask[i] ? 100 : 0, "the contracted MW in the buyer's hours, nothing else");
  assert.equal(p.compliance[0].tolerance, 0.1);
  assert.equal(p.compliance[0].penaltyMultiple, 1.5);
  assert.equal(p.purchase.maxShare, 0.05);
  assert.equal(p.purchase.prices.length, 8760);
  assert.ok(Math.abs(p.purchase.prices[12] - prices.markets.GDAM.hourlyRsPerMwh[12] / 1000) < 1e-3, "the GDAM price in Rs/kWh");
  assert.equal(p.purchase.chargesRsPerKwh, 0.3);
  assert.deepEqual(p.saleMask, Array.from(nonSolarMask()));
  for (const k of ["solarMw", "windMw", "bessMw"]) assert.equal(p.vars[k].locked, false, `${k}: the optimizer sizes it`);
  // a fixed size stays fixed (the optimizer switch)
  const fixed = { ...st, src: { ...st.src, wind: { ...st.src.wind, capacity: { mode: "fixed", mw: 50 } } } };
  const pf = lpPayload(fixed, t, resourceProfiles(fixed), prices);
  assert.deepEqual({ ...pf.vars.windMw }, { locked: true, value: 50 }, "a fixed wind size");
  // no purchase or sale mask when not chosen
  const noBuy = { ...st, fdrex: { ...st.fdrex, buy: false, dayInjection: true } };
  const pn = lpPayload(noBuy, fdrexTerms(noBuy.fdrex, prices), resourceProfiles(noBuy), prices);
  assert.equal(pn.purchase, undefined);
  assert.equal(pn.saleMask, undefined);
  const noSale = { ...st, market: { ...st.market, sell: false } };
  assert.equal(lpPayload(noSale, t, resourceProfiles(noSale), prices).saleMask, undefined, "no sale: no sale mask");
  console.log("ok   request demand in the 4 hours only, tolerance and penalty, purchase at GDAM + charges, sale mask, the optimizer's switches");
}

// ---- 3. the finance on a sizing result
{
  const st = base();
  const sizes = { solarMw: 21, windMw: 89, bessMw: 74, bessMwh: 297 };
  const life = Array.from({ length: 25 }, (_, k) => ({ year: k + 1, demandMwh: 146000, deliveredMwh: 133700, exportMwh: 82000, exportRevenueCr: 56, purchaseMwh: 7300, purchaseCostCr: 3.4, blockShortfallMwh: k > 20 ? 500 : 0 }));
  st.lp = { sizes, tariff: 8.9, lifetime: life, perYear: [{ year: 1, minMonthlyDfr: 0.9 }], market: "GDAM" };
  for (const psm of [false, true]) {
    const s2 = { ...st, fdrex: { ...st.fdrex, psm } };
    const t = fdrexTerms(s2.fdrex, prices);
    const { costs, fin, bess } = modelInputs(s2, t);
    assert.ok(Math.abs(costs.otherCapexCr - seciChargesCr(sizes, 100)) < 1e-9, "SECI's charges in the project cost");
    assert.equal(fin.blockPenaltyMultiple, 1.5, "the monthly penalty multiple");
    const ops = opsFromLp(s2.lp, fin, bess, dsmFor(s2));
    assert.equal(ops[0].chargingCostCr, 3.4, "power bought is a cost");
    assert.ok(Math.abs(ops[0].pxFeesCr - (psm ? 0.02 * 133700 * 1e-4 : 0)) < 1e-9, "the PSM discount on the energy delivered");
    const f = E.runFinancialModel(null, sizes, { costs, fin, bess, dfrTarget: 0, tariffLocked: false, ops, solveBy: "npv" });
    assert.ok(Math.abs(f.equityIrr - fin.targetEquityIrr) < 1e-6, "solved for the target IRR");
    assert.ok(Math.abs(f.rows[0].charging - 3.4) < 1e-9 && Math.abs(f.rows[0].pxFees - ops[0].pxFeesCr) < 1e-9);
    const y22 = f.rows[21];
    assert.ok(Math.abs(y22.penalty - 500 * 1.5 * y22.tariff * 1e-4) < 1e-6, "the energy short beyond 10% at 1.5 × the tariff");
    if (psm) {
      const live = liveModelRequest({ state: s2, lp: s2.lp, finance: f, costs, fin, bess, ops, dfrTarget: 0, labels: t.workbookLabels });
      assert.equal(live.costs.otherCapexCr, costs.otherCapexCr, "the workbook carries SECI's charges");
      assert.equal(live.labels.charging, "Power bought (green market, bilateral)");
      assert.equal(live.labels.pxFees, "PSM discount");
      assert.ok(live.ops[0].chargingCostCr === 3.4 && live.ops[0].pxFeesCr > 0, "the workbook's rows for both");
      console.log(`ok   finance ₹${f.tariff.toFixed(3)}/kWh with the PSM: power bought ₹3.4 cr a year, PSM ₹${ops[0].pxFeesCr.toFixed(3)} cr, SECI's charges ₹${costs.otherCapexCr.toFixed(2)} cr, penalty at 1.5 × tariff`);
    }
  }
}

// ---- 4. dates, money, the forms' view, a saved bid
{
  assert.deepEqual(keyDates("2027-03-01"), { ppa: "2027-03-01", financialClosure: "2028-03-01", scsd: "2028-09-01", latestStart: "2029-03-01" });
  const m = moneyAtStake({ solarMw: 200, windMw: 50, bessMwh: 450 });
  assert.equal(m.emdRs, (9.68 * 200 + 13.68 * 50 + 2.4 * 450) * 1e5);
  assert.equal(m.pbgRs, (24.2 * 200 + 34.2 * 50 + 6.0 * 450) * 1e5);
  assert.ok(Math.abs(m.successRs - 700 * 1e5 * 1.18) < 1e-6, "Success Charges on RE MW + storage MWh, with GST");
  const st = base();
  st.lp = { sizes: { solarMw: 21, windMw: 89, bessMw: 74, bessMwh: 297 }, tariff: 8.9 };
  st.fdrex.psm = true;
  const v = formsView(st);
  assert.deepEqual({ ...v.inputs }, { contractedMw: 100, effectiveDate: "2027-03-01", solarMw: 21, windMw: 89, essMwPerMw: 0.74, essMwhPerMw: 2.97, extraEssMwhPerMw: 0, psm: true, gstRate: 0.18 });
  const back = fromSaved(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(back.fdrex, st.fdrex, "a saved bid comes back");
  assert.equal(fromSaved({ inputs: { contractedMw: 50 } }).bid.baseMw, 100, "a bid of the earlier FDRE-X tab starts afresh");
  console.log("ok   dates, EMD / PBG / Success Charges, the bid forms' view, a saved bid");
}
// ---- the bid forms' review: stamped on the view the forms show, it holds (the tab's setForms)
{
  const st = base();
  st.lp = { sizes: { solarMw: 21, windMw: 89, bessMw: 74, bessMwh: 297 }, tariff: 8.9 };
  const fmt = FORMATS.find((f) => f.id === "7.1");
  const stamp = (on) => ({ ...st, formsReview: { "7.1": { at: "2026-11-19T00:00:00Z", print: formatPrint(on, fmt) } } });
  assert.equal(formatStatus(formsView(stamp(formsView(st))), fmt).reviewed, "current", "reviewed on the forms' view: current");
  assert.equal(formatStatus(formsView(stamp(st)), fmt).reviewed, "changed", "stamped on the raw bid it never matched (the bug fixed in FdrexBidTab's setForms)");
  console.log("ok   a format's review holds");
}

// ---- the tariff surface drawn while HiGHS sizes (surface.js)
{
  const st = base();
  const ax = surfaceAxes(st);
  assert.deepEqual(ax.solarGrid, [0, 20, 40, 60, 80, 100, 120]);
  assert.equal(ax.windGrid.length, 8);
  assert.equal(ax.windGrid.at(-1), 175);
  assert.deepEqual(ax.bessOptions, [70, 85, 100]);
  const fixed = { ...st, src: { ...st.src, wind: { ...st.src.wind, capacity: { mode: "fixed", mw: 90 } } } };
  assert.deepEqual(surfaceAxes(fixed).windGrid, [90], "a fixed size is one point");
  assert.deepEqual(surfaceAxes({ ...st, sources: { ...st.sources, solar: false } }).solarGrid, [0], "a source switched off is nought");
  const seed = surfaceSeed(st, prices);
  const t0 = Date.now();
  const good = surfaceCell(seed, ax, 1, 4, prices); // 20 MWac solar, 100 MW wind
  const ms = (Date.now() - t0) / 3;
  const none = surfaceCell(seed, ax, 0, 0, prices); // no generation at all
  assert.ok(good.feasible && good.z > 7 && good.z < 12, `20 MW solar + 100 MW wind: ₹${good.z}`);
  assert.equal(good.sizes.bessMwh, good.sizes.bessMw * 4);
  assert.equal(none.feasible, false, "no plant: off the surface");
  console.log(`ok   the tariff surface: ${ax.solarGrid.length} × ${ax.windGrid.length} mixes × ${ax.bessOptions.length} storage sizes, ${ms.toFixed(0)} ms a design; 20/100 MW needs ₹${good.z.toFixed(2)}`);
}
console.log("OK  FDRE-X Bid tab: the tender's terms, the HiGHS request and the financial model");
