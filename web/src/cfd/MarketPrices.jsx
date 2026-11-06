import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, Waves } from "lucide-react";
import { Section, Stat, nf, pf } from "../rtc/ui";
import { PRICE_SCENARIOS, priceBands, pricePathOf, runModel, smoothPath } from "./model.js";
import { quoteOf, runCfdFinance } from "./finance.js";
import { TENDER } from "./terms.js";

// F.9 of the CfD Financial model step: the market price path and what it does to the bid.
//
// The CfD fixes the revenue on the contracted supply at the strike price, so the exchange price
// only reaches the bidder where it buys (charging power from the GDAM, all of it until the own RE
// is in, then within the 25% limit) or sells outside the CfD (surplus own RE in the GDAM), and in
// the penalty reference (the week's highest evening price). Two bands carry that: the midday band
// (the charging hours before 18:00) and the evening band (the peak hours). Each is a multiplier
// per model year on the IEX price year; the dots can be dragged, smoothed, or set from a scenario,
// and every change re-runs the full financial model.

const YEARS = TENDER.termYears;
const W = 760;
const H = 300;
const PAD = { l: 52, r: 16, t: 14, b: 30 };
const Y_MIN = 0.25; // multipliers the chart spans
const Y_MAX = 2.5;

const BANDS = [
  { key: "midday", label: "Midday (charging) band", colour: "var(--accent, #f5b942)", note: "the cheapest charging hours before 18:00" },
  { key: "evening", label: "Evening (selling) band", colour: "var(--good, #4cc38a)", note: "the two dearest hours of 18:00–24:00 in the market you sell in" },
];

function yOf(mult) {
  const clamped = Math.min(Y_MAX, Math.max(Y_MIN, mult));
  return PAD.t + (H - PAD.t - PAD.b) * (1 - (clamped - Y_MIN) / (Y_MAX - Y_MIN));
}
function multOf(y) {
  const f = 1 - (y - PAD.t) / (H - PAD.t - PAD.b);
  return Math.min(Y_MAX, Math.max(Y_MIN, Y_MIN + f * (Y_MAX - Y_MIN)));
}
function xOf(k) {
  return PAD.l + ((W - PAD.l - PAD.r) * k) / (YEARS - 1);
}

/** Charging cost, merchant revenue and the penalty reference per year of the term, from a model run. */
function yearRows(model) {
  const years = model?.sim?.years || [];
  return years.slice(0, YEARS).map((y, k) => ({
    year: k + 1,
    chargeRs: y.chargeMarketMwh > 0 ? (y.marketCostCr * 1e7) / (y.chargeMarketMwh * 1000) : null,
    marketMwh: y.chargeMarketMwh || 0,
    marketCr: y.marketCostCr || 0,
    merchantCr: y.merchantRevCr || 0,
    ref: y.weeks?.length ? y.weeks.reduce((a, w) => a + w.ref, 0) / y.weeks.length : null,
  }));
}

/** What the strike price rests on: the shares of the bid's first three years' cost and the merchant revenue in it. */
function summary(model, finance) {
  const rows = yearRows(model);
  const first3 = rows.slice(0, 3);
  const charge3 = first3.reduce((a, r) => a + r.marketCr, 0);
  const merchant = rows.reduce((a, r) => a + r.merchantCr, 0);
  const supplied = (model?.sim?.years || []).slice(0, YEARS).reduce((a, y) => a + (y.deliveredMwh || 0), 0);
  const revenue = supplied * (model?.sp || 0) * 1e-4; // ₹ cr at the strike price
  return {
    strike: model?.sp ?? null,
    bid: quoteOf(model?.sp ?? null),
    equityIrr: finance?.equityIrr ?? model?.fin?.equityIrr ?? null,
    minDscr: finance?.minDscr ?? model?.fin?.minDscr ?? null,
    charge3,
    chargeRs3: first3.some((r) => r.marketMwh > 0) ? (charge3 * 1e7) / (first3.reduce((a, r) => a + r.marketMwh, 0) * 1000) : null,
    merchant,
    merchantShare: revenue > 0 ? merchant / revenue : null,
    rows,
  };
}

export default function MarketPrices({ state, setInput, prices, model }) {
  const scenario = PRICE_SCENARIOS[state.inputs.priceScenario] ? state.inputs.priceScenario : "flat";
  const bands = useMemo(() => (model?.book ? priceBands(model.book) : null), [model?.book]);
  const basePath = useMemo(() => pricePathOf(state.inputs, YEARS), [state.inputs]);
  const [drag, setDrag] = useState(null); // { band, k, path } while a dot is held
  const [table, setTable] = useState(null);
  const [running, setRunning] = useState(false);
  const svgRef = useRef(null);

  const pricer = useCallback((inputs, sim) => {
    try {
      return runCfdFinance({ ...state, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
    } catch {
      return null;
    }
  }, [state.fin, state.costs]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = drag ? drag.path : { midday: basePath.midday, evening: basePath.evening };

  // the current bid under the path in force: the tab's model already carries it
  const finance = useMemo(() => (model?.sim ? runCfdFinance({ ...state, tariffLocked: false }, model) : null), [model, state.fin, state.costs]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = useMemo(() => (model ? summary(model, finance) : null), [model, finance]);

  const commit = useCallback((path) => {
    setInput("pricePath", { midday: path.midday.map((v) => Math.round(v * 1000) / 1000), evening: path.evening.map((v) => Math.round(v * 1000) / 1000) });
    setInput("priceScenario", "custom");
  }, [setInput]);

  const onPointerDown = (band, k) => (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ band, k, path: { midday: [...shown.midday], evening: [...shown.evening] } });
  };
  const onPointerMove = (e) => {
    if (!drag || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const path = { ...drag.path, [drag.band]: drag.path[drag.band].map((v, i) => (i === drag.k ? Math.round(multOf(y) * 100) / 100 : v)) };
    setDrag({ ...drag, path });
  };
  const onPointerUp = () => {
    if (!drag) return;
    commit(drag.path);
    setDrag(null);
  };
  const smooth = () => commit({ midday: smoothPath(shown.midday), evening: smoothPath(shown.evening) });
  const pick = (key) => {
    setInput("priceScenario", key);
    if (key !== "custom") setInput("pricePath", null);
  };

  // the scenario table: the bid under each named path and the bidder's own, through the full model
  const runScenarios = async () => {
    if (!prices || running) return;
    setRunning(true);
    const out = [];
    const keys = ["flat", "storageFlood", "tightGrid", ...(state.inputs.pricePath ? ["custom"] : [])];
    for (const key of keys) {
      await new Promise((r) => { setTimeout(r, 0); });
      const s = { ...state, inputs: { ...state.inputs, priceScenario: key } };
      try {
        const m = runModel(s, prices, { price: pricer });
        out.push({ key, label: PRICE_SCENARIOS[key].label, note: PRICE_SCENARIOS[key].note, ...summary(m, m.finance) });
      } catch (err) {
        out.push({ key, label: PRICE_SCENARIOS[key].label, note: String(err?.message || err), strike: null });
      }
      setTable([...out]);
    }
    setRunning(false);
  };
  useEffect(() => { setTable(null); }, [state.inputs.contractedMw, state.inputs.solarMw, state.inputs.windMw, state.inputs.priceEscalation, state.inputs.gdamShareCap, state.fin, state.costs]);

  if (!model || !bands) return null;
  const years = Array.from({ length: YEARS }, (_, k) => k);
  const gridMults = [0.5, 1, 1.5, 2, 2.5];

  return (
    <Section index="F.9" title="Market prices: the path and the bid" note="The exchange price reaches you only where you buy charging power, sell surplus RE or pay a penalty; drag a dot to change a year, Smooth to even the path, and the model re-runs">
      <div className="cfd-price" data-testid="cfd-price-path">
      <div className="cfd-price-scenarios">
        {Object.entries(PRICE_SCENARIOS).map(([key, sc]) => (
          <button type="button" key={key} className={scenario === key ? "primary" : "secondary"} onClick={() => pick(key)} disabled={key === "custom" && !state.inputs.pricePath} title={sc.note} data-testid={`cfd-price-scenario-${key}`}>{sc.label}</button>
        ))}
        <button type="button" className="secondary" onClick={smooth} data-testid="cfd-price-smooth"><Waves size={12} /> Smooth</button>
        {scenario === "custom" && <button type="button" className="secondary" onClick={() => pick("flat")} data-testid="cfd-price-reset"><RotateCcw size={12} /> Back to flat</button>}
        <span className="cfd-price-note">{PRICE_SCENARIOS[scenario].note}</span>
      </div>
      <div className="cfd-price-chart-wrap">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="cfd-price-chart" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} data-testid="cfd-price-chart">
          {gridMults.map((m) => (
            <g key={m}>
              <line x1={PAD.l} x2={W - PAD.r} y1={yOf(m)} y2={yOf(m)} className="grid" />
              <text x={PAD.l - 6} y={yOf(m) + 4} textAnchor="end" className="axis">{nf(m * 100, 0)}%</text>
            </g>
          ))}
          {years.map((k) => (
            <text key={k} x={xOf(k)} y={H - 8} textAnchor="middle" className="axis">Y{k + 1}</text>
          ))}
          {BANDS.map((band) => {
            const vals = shown[band.key];
            const d = vals.map((v, k) => `${k === 0 ? "M" : "L"}${xOf(k).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
            return (
              <g key={band.key}>
                <path d={d} fill="none" stroke={band.colour} strokeWidth={2} />
                {vals.map((v, k) => (
                  <g key={k}>
                    <circle cx={xOf(k)} cy={yOf(v)} r={6} fill={band.colour} stroke="var(--bg, #111)" strokeWidth={1.5} className="dot" onPointerDown={onPointerDown(band.key, k)} data-testid={`cfd-price-dot-${band.key}-${k + 1}`} />
                    <title>{`${band.label}, year ${k + 1}: ${nf(v * 100, 0)}% of today = ₹${nf(bands[band.key] * v, 2)}/kWh`}</title>
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
        <div className="cfd-price-legend">
          {BANDS.map((band) => (
            <div key={band.key}><i style={{ background: band.colour }} /> <b>{band.label}</b>: today ₹{nf(bands[band.key], 2)}/kWh ({band.note}); year 1 {nf(shown[band.key][0] * 100, 0)}%, year {YEARS} {nf(shown[band.key][YEARS - 1] * 100, 0)}%</div>
          ))}
        </div>
      </div>

      {now && (
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-price-now">
          <Stat label="Strike price on this path" value={now.strike === null ? "–" : `₹${nf(now.strike, 3)}/kWh`} detail={now.bid === null ? "" : `quote ₹${nf(now.bid, 2)}`} />
          <Stat label="Equity IRR" value={now.equityIrr === null ? "–" : pf(now.equityIrr, 2)} detail={`minimum DSCR ${now.minDscr === null ? "–" : nf(now.minDscr, 2)}`} />
          <Stat label="Charging bought, first 3 years" value={`₹${nf(now.charge3, 1)} cr`} detail={now.chargeRs3 === null ? "no market charging" : `₹${nf(now.chargeRs3, 2)}/kWh bought, charges included`} />
          <Stat label="Merchant sales in the bid" value={now.merchantShare === null ? "–" : pf(now.merchantShare, 1)} detail={`₹${nf(now.merchant, 1)} cr of surplus RE over the term; the bid leans on it`} tone={now.merchantShare > 0.15 ? "bad" : undefined} />
        </div>
      )}

      <div className="cfd-price-run">
        <button type="button" className="primary" onClick={runScenarios} disabled={running} data-testid="cfd-price-run">
          {running ? <Loader2 size={13} className="spin" /> : null} {running ? "Running the scenarios…" : "Compare the scenarios"}
        </button>
        <span className="cfd-price-note">Each scenario sizes nothing: the plant stays as sized; the strike price for your target equity IRR is solved again through the full financial model.</span>
      </div>
      {table && (
        <div className="table-wrap">
          <table className="cfd-settle-table cfd-price-table" data-testid="cfd-price-table">
            <thead>
              <tr><th>Scenario</th><th>Strike price</th><th>vs flat</th><th>Equity IRR at the quote</th><th>Min DSCR</th><th>Charging bought, years 1–3</th><th>Merchant sales in the bid</th><th>What it assumes</th></tr>
            </thead>
            <tbody>
              {table.map((r) => {
                const flat = table.find((x) => x.key === "flat");
                const gap = r.strike !== null && flat?.strike !== null && flat?.strike !== undefined ? r.strike - flat.strike : null;
                return (
                  <tr key={r.key} data-testid={`cfd-price-row-${r.key}`}>
                    <td><b>{r.label}</b></td>
                    <td>{r.strike === null ? "–" : `₹${nf(r.strike, 3)}`}</td>
                    <td>{gap === null ? "–" : `${gap >= 0 ? "+" : "−"}₹${nf(Math.abs(gap), 3)}`}</td>
                    <td>{r.equityIrr === null || r.equityIrr === undefined ? "–" : pf(r.equityIrr, 2)}</td>
                    <td>{r.minDscr === null || r.minDscr === undefined ? "–" : nf(r.minDscr, 2)}</td>
                    <td>{r.charge3 === undefined ? "–" : `₹${nf(r.charge3, 1)} cr${r.chargeRs3 ? ` · ₹${nf(r.chargeRs3, 2)}/kWh` : ""}`}</td>
                    <td>{r.merchantShare === null || r.merchantShare === undefined ? "–" : `${pf(r.merchantShare, 1)} · ₹${nf(r.merchant, 1)} cr`}</td>
                    <td className="cfd-price-note">{r.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {now?.rows?.length > 0 && (
        <div className="table-wrap">
          <table className="cfd-settle-table cfd-price-table" data-testid="cfd-price-years">
            <thead><tr><th>Year</th>{now.rows.map((r) => <th key={r.year}>Y{r.year}</th>)}</tr></thead>
            <tbody>
              <tr><td>Midday band, % of today</td>{now.rows.map((r, k) => <td key={r.year}>{nf(shown.midday[k] * 100, 0)}%</td>)}</tr>
              <tr><td>Evening band, % of today</td>{now.rows.map((r, k) => <td key={r.year}>{nf(shown.evening[k] * 100, 0)}%</td>)}</tr>
              <tr><td>Charging bought, ₹/kWh</td>{now.rows.map((r) => <td key={r.year}>{r.chargeRs === null ? "–" : nf(r.chargeRs, 2)}</td>)}</tr>
              <tr><td>Charging bought, ₹ cr</td>{now.rows.map((r) => <td key={r.year}>{nf(r.marketCr, 1)}</td>)}</tr>
              <tr><td>Surplus RE sold, ₹ cr</td>{now.rows.map((r) => <td key={r.year}>{nf(r.merchantCr, 1)}</td>)}</tr>
              <tr><td>Penalty reference, ₹/kWh</td>{now.rows.map((r) => <td key={r.year}>{r.ref === null ? "–" : nf(r.ref, 2)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="cfd-price-note">
        The strike price itself does not move with the market: Amendment-03 pays it on every kWh. The first three years carry the exposure, when the battery may be charged entirely from the
        green market; after month 36 bought power is capped at 25% of the energy. The GDAM depth cap on the Bid inputs step limits what you can buy in an hour to a share of the cleared volume.
      </p>
      </div>
    </Section>
  );
}
