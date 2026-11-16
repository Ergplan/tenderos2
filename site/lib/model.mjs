// The model runs behind the demo site: SECI CfD-I through the application's own code
// (web/src/cfd/*), nothing re-implemented here. The result is cached in
// site/data-src/model-cache.json because it is a few hundred full 15-year simulations;
// `node site/build.mjs --model` recomputes it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultCfdState, fillBenchmarks, fillWinning, modelInputs, priceBook, profiles, simulate, capShortfall, runModel } from "../../web/src/cfd/model.js";
import { runCfdFinance } from "../../web/src/cfd/finance.js";
import { eveningAverage, eveningMcp, poolTable, whatWins, cfdRisks } from "../../web/src/cfd/winning.js";
import { reviewBid } from "../../web/src/cfd/review.js";
import { sizingChecks } from "../../web/src/cfd/checks.js";
import { cfdLeverEffects } from "../../web/src/cfd/levers.js";
import { planTrack } from "../../web/src/cfd/track.js";
import { LEVER_NOTES } from "../../web/src/cfd/leverNotes.js";
import { blockContext, dayBlocks } from "../../web/src/cfd/dispatch15.js";

const r = (v, d = 3) => (Number.isFinite(v) ? +v.toFixed(d) : null);
const noTick = async () => {};

export async function computeModel(ROOT, log = () => {}) {
  const t0 = Date.now();
  let sims = 0, pricings = 0;
  const prices = JSON.parse(readFileSync(join(ROOT, "web/public/market/iex_hourly_prices.json"), "utf8"));
  const price = (st, inputs, sim) => { pricings += 1; return runCfdFinance({ ...st, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null }); };
  const pricerFor = (st) => (inputs, sim) => price(st, inputs, sim);

  // ---- the competitive bid: 100 MW, the values winning bidders show lenders
  const win = fillWinning(defaultCfdState());
  win.inputs.contractedMw = 100;
  const base = modelInputs(win);
  const book = priceBook(prices, base.sellMarket);
  const run = (inputs) => { sims += 1; return simulate(inputs, book, profiles(inputs)); };

  // the optimiser's scan: own solar 0 to 60 MWac
  const scan = [];
  for (let mw = 0; mw <= 60; mw += 2) {
    const inputs = { ...base, solarMw: mw };
    const sim = run(inputs);
    scan.push({ mw, sp: r(price(win, inputs, sim).tariff), shortMwh: Math.round(capShortfall(sim)) });
  }
  const best = scan.reduce((a, b) => (b.shortMwh === 0 && (a.shortMwh > 0 || b.sp < a.sp) ? b : a));
  win.inputs.solarMw = best.mw;
  const model = runModel(win, prices, { price: pricerFor(win) });
  sims += 1;
  const fin = runCfdFinance(win, model);
  log(`competitive bid: ${best.mw} MWac on 100 MW, ₹${fin.tariff.toFixed(3)}/kWh`);

  // ---- the design surface: own solar × own wind (re-simulated) × battery capex × equity IRR (re-priced)
  const G = { solar: Array.from({ length: 21 }, (_, k) => k * 2), wind: [0, 5, 10, 15, 20], ess: [0.65, 0.85, 1.05, 1.25], irr: [0.11, 0.13, 0.15, 0.17] };
  const sp = [], phys = [], capex = [];
  let checksMeta = null;
  for (const s of G.solar) {
    for (const w of G.wind) {
      const st = { ...win, inputs: { ...win.inputs, solarMw: s, windMw: w } };
      const inputs = modelInputs(st);
      const sim = run(inputs);
      const m = { inputs, sim, opYears: sim.opYears, book, prof: profiles(inputs) };
      const checks = sizingChecks(m, st);
      if (!checksMeta) checksMeta = checks.map((c) => ({ id: c.id, label: c.label }));
      const years = sim.years;
      const n = years.length;
      const sum = (k) => years.reduce((a, y) => a + (y[k] || 0), 0);
      phys.push({
        shortDays: sum("shortDays"), supply: r(sum("deliveredMwh") / Math.max(1e-9, sum("requiredMwh")), 4),
        checks: checks.map((c) => (c.status === "met" ? "m" : c.status === "failed" ? "f" : "i")).join(""),
        detail: checks.map((c) => c.detail),
        own: r(sum("chargeOwnMwh") / n / 1000, 2), market: r(sum("chargeMarketMwh") / n / 1000, 2), group: r(sum("chargeGroupMwh") / n / 1000, 2),
        windDirect: r(sum("windDirectMwh") / n / 1000, 2), delivered: r(sum("deliveredMwh") / n / 1000, 2),
      });
      for (const e of G.ess) {
        for (const q of G.irr) {
          const st2 = { ...st, inputs: { ...st.inputs, essCrPerMwh: e, targetEquityIrr: q } };
          const f = price(st2, { ...inputs, essCrPerMwh: e, targetEquityIrr: q }, sim);
          sp.push(r(f.tariff));
          if (q === G.irr[0]) capex.push(r(f.capex.total, 1));
        }
      }
    }
  }
  log(`design surface: ${G.solar.length * G.wind.length} plants simulated, ${sp.length} priced, ${Math.round((Date.now() - t0) / 1000)} s so far`);

  // ---- a day of operation after the RE is built, in hours and in 15-minute blocks
  const ctx = blockContext(model.inputs, model.sim);
  let day = null;
  simulate(model.inputs, model.book, model.prof, {
    onDay: (k, rec) => {
      if (day || k < 3 * 365 + 150) return;
      if (rec.delivered >= rec.required * model.inputs.availability - 0.01 && Math.max(...rec.solar) > 0.6 * best.mw) day = { rec, blocks: dayBlocks(rec, ctx) };
    },
  });
  sims += 1;
  const cols = day.blocks.cols || day.blocks;
  const arr = (k, d = 2) => Array.from(cols[k], (v) => r(v, d));
  const dayOut = {
    date: new Date(day.rec.date).toISOString().slice(0, 10), chosen: day.rec.chosen, delivered: r(day.rec.delivered, 1), required: day.rec.required, availability: model.inputs.availability,
    price: day.rec.price.map((v) => r(v, 2)),
    b: { solar: arr("solar"), own: arr("chargeOwn"), bought: Array.from(cols.chargeMarket, (v, k) => r(v + cols.chargeGroup[k], 2)), discharge: arr("discharge"), soc: arr("soc", 1), delivered: arr("delivered"), stored: arr("stored", 1) },
  };

  // ---- one whole year, hour by hour: the battery's net flow as a share of the contracted MW
  // (charging positive, supply negative), 8,760 letters from a (-9) to s (+9)
  let heat = "";
  simulate(model.inputs, model.book, model.prof, {
    onDay: (k, rec) => {
      if (k < 4 * 365 || k >= 5 * 365) return;
      for (let h = 0; h < 24; h += 1) {
        const charge = (rec.own[h] || 0) + (rec.market[h] || 0) + (rec.group[h] || 0);
        const out = rec.chosen.includes(h) ? rec.essOut / rec.chosen.length : 0;
        const v = Math.max(-9, Math.min(9, Math.round(((charge - out) / model.inputs.contractedMw) * 9)));
        heat += String.fromCharCode(106 + v);
      }
    },
  });
  sims += 1;

  // ---- the financial model year by year, and what carries the price
  const rows = fin.rows.map((x) => ({ year: x.year, revenue: r(x.revenue, 1), opex: r(x.opex, 1), charging: r(x.charging, 1), debtService: r(x.debtService || 0, 1), tax: r(x.tax || 0, 1), fcfe: r(x.fcfe || 0, 1), dscr: x.dscr && x.debtService > 5 ? r(x.dscr, 2) : null, closingDebt: r(x.closingDebt || 0, 1) }));
  const reviewWin = reviewBid({ state: win, model, finance: fin, prices });
  const drv = reviewWin.findings.find((f) => f.id === "price-drivers");
  const drivers = [];
  if (drv) {
    const list = drv.detail.split("): ")[1].split("; the rest")[0];
    for (const part of list.split("; ")) {
      const m = part.match(/^(less )?(.*) ₹([\d.]+)$/);
      if (m) drivers.push({ label: m[2].replace(/^the /, ""), value: (m[1] ? -1 : 1) * Number(m[3]) });
    }
    const rest = drv.detail.match(/the rest, ₹([\d.]+)/);
    if (rest) drivers.push({ label: "tax and the equity return above the discount rate", value: Number(rest[1]) });
    const total = drivers.reduce((a, d) => a + d.value, 0);
    if (Math.abs(total - fin.tariff) > 0.03) throw new Error(`price drivers do not add up: ${total} vs ${fin.tariff}`);
  }

  // ---- What-if: every lever one step up and down, and the track to a quote with levers turned down
  const eff = await cfdLeverEffects(win, model, prices, { target: null, tick: noTick });
  log(`levers: ${eff.levers.length}, ${Math.round((Date.now() - t0) / 1000)} s so far`);
  const levers = eff.levers.map((l) => ({ key: l.key, label: l.label, unit: l.unit, pct: l.pct, value: l.value, step: l.step, min: l.min, max: Number.isFinite(l.max) ? l.max : null, up: r(l.priceUp), down: r(l.priceDown), slope: l.slope, perStep: r(l.perStep, 4), operation: l.operation, what: (LEVER_NOTES[l.key] || LEVER_NOTES[l.key.replace(/^fin\./, "")] || {}).what || "", why: (LEVER_NOTES[l.key] || LEVER_NOTES[l.key.replace(/^fin\./, "")] || {}).why || "" }));
  const targets = [8.0, 7.75, 7.5];
  const DEPTH = 2, FAN = 4; // the demo lets a visitor turn down two levers, among a plan's first four moves
  const plans = {};
  const planKey = (target, rejected) => `${target.toFixed(2)}|${[...rejected].sort().join(",")}`;
  const slim = (p) => ({ reached: p.reached, chance: r(p.chance, 3), floor: r(p.floor), final: p.steps.length ? r(p.steps[p.steps.length - 1].price) : r(eff.base), steps: p.steps.map((x) => ({ key: x.key, label: x.label, unit: x.unit, pct: x.pct, from: x.from, to: x.to, p: r(x.p, 3), price: r(x.price), drop: r(x.drop), who: x.who || "", why: x.why || "" })) });
  for (const target of targets) {
    let frontier = [[]];
    for (let depth = 0; depth <= DEPTH; depth += 1) {
      const next = [];
      for (const rej of frontier) {
        const key = planKey(target, rej);
        if (plans[key]) continue;
        const st = { ...win, rejected: Object.fromEntries(rej.map((k) => [k, true])) };
        const tp = Date.now();
        const p = await planTrack({ state: st, model, prices, effects: eff, target, tick: noTick });
        if (process.env.SITE_DEBUG) log(`  track ${key}: ${p.steps.length} steps, ${Date.now() - tp} ms`);
        plans[key] = slim(p);
        for (const step of p.steps.slice(0, FAN)) next.push([...rej, step.key]);
      }
      frontier = next;
    }
  }
  log(`what-if: ${levers.length} levers, ${Object.keys(plans).length} tracks planned`);

  // ---- what wins, the review of this bid and of an over-built one
  const evening = { chosen: r(eveningMcp(model), 2), all: r(eveningAverage(model), 2) };
  const pool = poolTable(model, fin.tariff).map((x) => ({ sp: r(x.sp, 2), cr: r(x.allCr, 1), yours: Boolean(x.yours) }));
  const verdict = whatWins({ model, finance: fin });
  const risks = cfdRisks({ state: win, model, finance: fin }).map((x) => ({ id: x.id, title: x.title }));
  const high = fillBenchmarks(defaultCfdState());
  Object.assign(high.inputs, { contractedMw: 150, solarMw: 14, essSocMin: 0.05, essSocMax: 50, extraEssMwhPerMw: 1, essCrPerMwh: 1.2, targetEquityIrr: 0.16 });
  const highModel = runModel(high, prices, { price: pricerFor(high) });
  sims += 1;
  const highFin = runCfdFinance(high, highModel);
  const reviewHigh = reviewBid({ state: high, model: highModel, finance: highFin, prices });
  const findings = (rv) => rv.findings.map((f) => ({ id: f.id, severity: f.severity, title: f.title, detail: f.detail, step: f.step || null }));

  return {
    computedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 100) / 10, sims, pricings, daysPerSim: Math.round((model.sim.dates.end - model.sim.dates.scd) / 86400000),
    win: { contractedMw: 100, solarMw: best.mw, tariff: r(fin.tariff), equityIrr: r(fin.equityIrr, 4), projectIrr: r(fin.projectIrr, 4), minDscr: r(fin.minDscr, 2), avgDscr: r(fin.avgDscr, 2), payback: fin.payback, lcoe: r(fin.lcoe, 2), debt: r(fin.debt, 1), equity: r(fin.equity, 1), capex: { total: r(fin.capex.total, 1), ...Object.fromEntries(Object.entries(fin.capex.byComponent).map(([k, v]) => [k, r(v, 1)])) }, inputs: win.inputs },
    scan, best: best.mw, grid: { ...G, sp, phys, capex, checks: checksMeta }, day: dayOut, heat, rows, drivers,
    levers, tracks: { targets, plans, depth: DEPTH, fan: FAN }, evening, pool, verdict: { tone: verdict.tone, text: verdict.verdict }, risks,
    checks: sizingChecks(model, win).map((c) => ({ id: c.id, label: c.label, status: c.status, detail: c.detail })),
    review: { winning: { tariff: r(fin.tariff, 2), summary: reviewWin.summary, findings: findings(reviewWin) }, overbuilt: { tariff: r(highFin.tariff, 2), summary: reviewHigh.summary, findings: findings(reviewHigh), checks: sizingChecks(highModel, high).map((c) => ({ id: c.id, label: c.label, status: c.status, detail: c.detail })) } },
  };
}
