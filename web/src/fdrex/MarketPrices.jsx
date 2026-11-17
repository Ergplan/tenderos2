import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, Waves } from "lucide-react";
import { Section, Stat, nf, pf } from "../rtc/ui";
import { PRICE_SCENARIOS, priceBands, pricePathOf, runModel, smoothPath } from "./model.js";
import { quoteOf, runCfdFinance } from "./finance.js";
import { TENDER } from "./tender.js";

// F.9 of the SECI-FDRE-X Financial model step: the market price path and what it does to the bid
// (forked from the CfD-I tab's web/src/cfd/MarketPrices.jsx; the mechanics are the same).
//
// The PPA pays the tariff on every kWh supplied in the buyer's four hours, fixed for 25 years, so
// the exchange price reaches the bidder only where it buys (charging power from the GDAM, within
// 5% of a year's energy) or sells outside the PPA (surplus own RE, the extra battery's evening
// sale, and the supply itself in the years after the term). Two bands carry that:
//   the midday band   the hours before 18:00: the bought charging power and, only when the bid
//                     holds connectivity in the solar hours (inputs.dayInjection), the surplus RE
//                     sold; without it the day's surplus is curtailed and this band reaches the
//                     bid through the bought charging power alone (surplus sold after 18:00
//                     follows the evening band)
//   the evening band  18:00 to 24:00: the extra battery's sale and the years after the term (and
//                     the exchange price of the hours supplied, shown beside the tariff)
// Neither moves the PPA revenue or the monthly penalty (1.5 x the tariff, no market reference).
// Each band is a multiplier per model year (365 days from the SCSD) on the IEX price year; the
// dots can be dragged, smoothed, or set from a scenario, and every change re-runs the full
// financial model.

const YEARS = TENDER.termYears;
const W = 760;
const H = 300;
const PAD = { l: 52, r: 16, t: 14, b: 30 };
const Y_MIN = 0.25; // multipliers the chart spans
const Y_MAX = 2.5;

const BANDS = [
  { key: "midday", label: "Midday band", colour: "var(--accent, #f5b942)", note: "the cheapest charging hours before 18:00; it prices the charging power you buy and, with connectivity in the solar hours, the surplus RE you sell" },
  { key: "evening", label: "Evening band", colour: "var(--good, #4cc38a)", note: `the ${TENDER.peakHours} dearest hours of 18:00–24:00 in the exchange chosen for market prices; it prices the extra battery's sale and the years after the term, not the PPA supply` },
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

/**
 * What the market prices do in each model year (365 days from the SCSD, the years the bands are
 * set for), from a model run: the charging power bought, the surplus RE and the extra battery's
 * energy sold, and the exchange price of the hours supplied (what the buyer would pay there).
 */
function yearRows(model) {
  const years = model?.sim?.opYears || [];
  return years.slice(0, YEARS).map((y, k) => ({
    year: k + 1,
    chargeRs: y.chargeMarketMwh > 0 ? (y.marketCostCr * 1e7) / (y.chargeMarketMwh * 1000) : null,
    marketMwh: y.chargeMarketMwh || 0,
    marketCr: y.marketCostCr || 0,
    surplusCr: (y.merchantRevCr || 0) - (y.extraRevCr || 0),
    curtailedGwh: (y.curtailedMwh || 0) / 1000,
    extraCr: y.extraRevCr || 0,
    suppliedMwh: y.deliveredMwh || 0,
    exchangeRs: y.deliveredMwh > 0 ? (y.mcpDeliveredCr * 1e4) / y.deliveredMwh : null,
  }));
}

/** What the tariff rests on in the market: the charging power bought over the term and the market sales against the PPA revenue. */
function summary(model, finance) {
  const rows = yearRows(model);
  const charge = rows.reduce((a, r) => a + r.marketCr, 0);
  const chargeMwh = rows.reduce((a, r) => a + r.marketMwh, 0);
  const surplus = rows.reduce((a, r) => a + r.surplusCr, 0);
  const extra = rows.reduce((a, r) => a + r.extraCr, 0);
  const curtailedGwh = rows.reduce((a, r) => a + r.curtailedGwh, 0);
  const revenue = rows.reduce((a, r) => a + r.suppliedMwh, 0) * (model?.sp || 0) * 1e-4; // ₹ cr of PPA revenue at the tariff
  return {
    tariff: model?.sp ?? null, // the tariff solved on this path
    bid: quoteOf(model?.sp ?? null),
    equityIrr: finance?.equityIrr ?? model?.fin?.equityIrr ?? null,
    minDscr: finance?.minDscr ?? model?.fin?.minDscr ?? null,
    charge,
    chargeRs: chargeMwh > 0 ? (charge * 1e7) / (chargeMwh * 1000) : null,
    surplus,
    extra,
    curtailedGwh,
    dayOn: Boolean(model?.inputs?.dayInjection), // connectivity in the solar hours too: the day's surplus is sold
    merchant: surplus + extra,
    merchantShare: revenue > 0 ? (surplus + extra) / revenue : null,
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
    const keys = [...Object.keys(PRICE_SCENARIOS).filter((key) => key !== "custom"), ...(state.inputs.pricePath ? ["custom"] : [])];
    for (const key of keys) {
      await new Promise((r) => { setTimeout(r, 0); });
      const s = { ...state, inputs: { ...state.inputs, priceScenario: key } };
      try {
        const m = runModel(s, prices, { price: pricer });
        out.push({ key, label: PRICE_SCENARIOS[key].label, note: PRICE_SCENARIOS[key].note, ...summary(m, m.finance) });
      } catch (err) {
        out.push({ key, label: PRICE_SCENARIOS[key].label, note: String(err?.message || err), tariff: null });
      }
      setTable([...out]);
    }
    setRunning(false);
  };
  useEffect(() => { setTable(null); }, [state.inputs.contractedMw, state.inputs.solarMw, state.inputs.windMw, state.inputs.extraEssMwhPerMw, state.inputs.afterTerm, state.inputs.merchantYears, state.inputs.dayInjection, state.inputs.priceEscalation, state.inputs.gdamShareCap, state.fin, state.costs]);

  if (!model || !bands) return null;
  const years = Array.from({ length: YEARS }, (_, k) => k);
  const gridMults = [0.5, 1, 1.5, 2, 2.5];

  return (
    <Section index="F.9" title="Market prices: the path and the bid" note="The exchange price reaches you only where you buy charging power or sell outside the PPA (surplus RE, in the solar hours only with connectivity for them; the extra battery; the years after the term); the PPA revenue and the monthly penalty do not move with it. Drag a dot to change a year, Smooth to even the path, and the model re-runs">
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
          <Stat label="Tariff on this path" value={now.tariff === null ? "–" : `₹${nf(now.tariff, 3)}/kWh`} detail={now.bid === null ? "" : `quote ₹${nf(now.bid, 2)}`} />
          <Stat label="Equity IRR" value={now.equityIrr === null ? "–" : pf(now.equityIrr, 2)} detail={`minimum DSCR ${now.minDscr === null ? "–" : nf(now.minDscr, 2)}`} />
          <Stat label="Charging bought over the term" value={`₹${nf(now.charge, 1)} cr`} detail={now.chargeRs === null ? "no market charging" : `₹${nf(now.chargeRs, 2)}/kWh bought, charges included; within ${pf(TENDER.marketShare, 0)} of a year's energy`} />
          <Stat label="Market sales against the PPA revenue" value={now.merchantShare === null ? "–" : pf(now.merchantShare, 1)} detail={`₹${nf(now.surplus, 1)} cr of surplus RE${now.extra > 0 ? ` and ₹${nf(now.extra, 1)} cr from the extra battery` : ""} sold at exchange prices over the term; ${nf(now.curtailedGwh, 0)} GWh curtailed${now.dayOn ? "" : " (no connectivity in the solar hours)"}`} tone={now.merchantShare > 0.15 ? "bad" : undefined} />
        </div>
      )}

      <div className="cfd-price-run">
        <button type="button" className="primary" onClick={runScenarios} disabled={running} data-testid="cfd-price-run">
          {running ? <Loader2 size={13} className="spin" /> : null} {running ? "Running the scenarios…" : "Compare the scenarios"}
        </button>
        <span className="cfd-price-note">Each scenario sizes nothing: the plant stays as sized; the tariff for your target equity IRR is solved again through the full financial model.</span>
      </div>
      {table && (
        <div className="table-wrap">
          <table className="cfd-settle-table cfd-price-table" data-testid="cfd-price-table">
            <thead>
              <tr><th>Scenario</th><th>Tariff</th><th>vs flat</th><th>Equity IRR</th><th>Min DSCR</th><th>Charging bought over the term</th><th>Market sales against the PPA revenue</th><th>Curtailed over the term</th><th>What it assumes</th></tr>
            </thead>
            <tbody>
              {table.map((r) => {
                const flat = table.find((x) => x.key === "flat");
                const gap = r.tariff !== null && flat?.tariff !== null && flat?.tariff !== undefined ? r.tariff - flat.tariff : null;
                return (
                  <tr key={r.key} data-testid={`cfd-price-row-${r.key}`}>
                    <td><b>{r.label}</b></td>
                    <td>{r.tariff === null ? "–" : `₹${nf(r.tariff, 3)}`}</td>
                    <td>{gap === null ? "–" : `${gap >= 0 ? "+" : "−"}₹${nf(Math.abs(gap), 3)}`}</td>
                    <td>{r.equityIrr === null || r.equityIrr === undefined ? "–" : pf(r.equityIrr, 2)}</td>
                    <td>{r.minDscr === null || r.minDscr === undefined ? "–" : nf(r.minDscr, 2)}</td>
                    <td>{r.charge === undefined ? "–" : `₹${nf(r.charge, 1)} cr${r.chargeRs ? ` · ₹${nf(r.chargeRs, 2)}/kWh` : ""}`}</td>
                    <td>{r.merchantShare === null || r.merchantShare === undefined ? "–" : `${pf(r.merchantShare, 1)} · ₹${nf(r.merchant, 1)} cr`}</td>
                    <td>{r.curtailedGwh === undefined ? "–" : `${nf(r.curtailedGwh, 0)} GWh`}</td>
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
              <tr><td>Surplus RE sold, ₹ cr</td>{now.rows.map((r) => <td key={r.year}>{nf(r.surplusCr, 1)}</td>)}</tr>
              <tr><td>Surplus RE curtailed, GWh</td>{now.rows.map((r) => <td key={r.year}>{nf(r.curtailedGwh, 1)}</td>)}</tr>
              {now.extra > 0 && <tr><td>Extra battery's energy sold, ₹ cr</td>{now.rows.map((r) => <td key={r.year}>{nf(r.extraCr, 1)}</td>)}</tr>}
              <tr><td>Exchange price of the hours supplied, ₹/kWh</td>{now.rows.map((r) => <td key={r.year}>{r.exchangeRs === null ? "–" : nf(r.exchangeRs, 2)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="cfd-price-note">
        The tariff itself does not move with the market: the PPA pays it on every kWh supplied in the buyer's hours, fixed for {YEARS} years, and the monthly penalty is {nf(TENDER.penaltyMultiple, 1)} × that tariff.
        The midday band prices the charging power you buy, which the tender holds to {pf(TENDER.marketShare, 0)} of a year's energy for the whole term.
        {model.inputs.dayInjection
          ? " With connectivity in the solar hours it also prices the surplus RE you sell, which SECI may take at the tariff instead (PPA 9.3)."
          : " The tender asks for connectivity with non-solar-hour access (RfS 7.2) and this bid holds no more, so the day's surplus RE is curtailed, not sold: the midday band reaches the bid through the bought charging power alone."}
        {model.inputs.windMw > 0 ? " Surplus wind sold after 18:00 follows the evening band." : ""}{" "}
        The evening band prices only the extra battery's sale and the years after the term; the last row shows what the hours you supply would cost the buyer on the exchange.
        The GDAM depth cap on the Bid inputs step limits what you can buy in an hour to a share of the cleared volume.
      </p>
      </div>
    </Section>
  );
}
