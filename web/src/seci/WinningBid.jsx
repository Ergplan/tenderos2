"use client";
// The "Winning bid" step: how this tender's winners bid ₹5.25, as a bridge from the tab's benchmark
// tariff (winningBid.js), with this bid's own tariff beside it once the plant is sized.
import React, { useMemo } from "react";
import { ExternalLink, Trophy } from "lucide-react";
import { Section, nf } from "../rtc/ui";
import { LiveChart } from "../rtc/charts";
import { DATA_COLORS } from "../dataColors";
import { financeOf } from "./voice";
import { ANY_SIX, BRIDGE, COMPARABLE, DISCLOSED, LEVERS, NOT_VERIFIED, ONE_AT_A_TIME, RESULT } from "./winningBid";

const rs = (v, d = 2) => `₹${nf(v, d)}`;

// one plain label style (the theme's outlined labels read doubled at this size)
const LABEL = { show: true, color: "#9a9a92", textBorderWidth: 0, fontSize: 11 };

function bridgeChart(own) {
  const labels = BRIDGE.map((b, i) => (i === 0 ? "Benchmark" : b.id === "amd3" ? "Amendment-03" : b.id === "green" ? "Green buying" : b.id === "bess" ? "Battery" : b.id === "sell" ? "Sell surplus" : b.id === "finance" ? "Finance" : "Wind"));
  // a waterfall: an invisible base, then the step up (red) or down (green)
  const base = [];
  const up = [];
  const down = [];
  BRIDGE.forEach((b, i) => {
    if (i === 0) { base.push(0); up.push(null); down.push(null); return; }
    const prev = BRIDGE[i - 1].tariff;
    base.push(Math.min(prev, b.tariff));
    up.push(b.tariff > prev ? +(b.tariff - prev).toFixed(2) : null);
    down.push(b.tariff < prev ? +(prev - b.tariff).toFixed(2) : null);
  });
  const totals = BRIDGE.map((b, i) => (i === 0 ? b.tariff : null));
  labels.push("Winners");
  base.push(0); up.push(null); down.push(null); totals.push(5.25);
  const series = [
    { name: "base", type: "bar", stack: "w", itemStyle: { color: "transparent" }, data: base, tooltip: { show: false } },
    { name: "Tariff", type: "bar", stack: "w", data: totals, itemStyle: { color: DATA_COLORS.muted }, label: { ...LABEL, position: "top", formatter: (p) => (p.value ? rs(p.value) : "") } },
    { name: "Adds", type: "bar", stack: "w", data: up, itemStyle: { color: DATA_COLORS.unmet }, label: { ...LABEL, position: "top", formatter: (p) => (p.value ? `+${nf(p.value, 2)}` : "") } },
    { name: "Takes off", type: "bar", stack: "w", data: down, itemStyle: { color: DATA_COLORS.surplus }, label: { ...LABEL, position: "bottom", formatter: (p) => (p.value ? `−${nf(p.value, 2)}` : "") } },
  ];
  const marks = [{ yAxis: 5.25, name: "Winners" }];
  if (own) marks.push({ yAxis: +own.toFixed(2), name: `This bid ${rs(own)}` });
  series[1].markLine = { symbol: "none", data: marks, label: { ...LABEL, formatter: (p) => p.name, position: "insideStartTop" }, lineStyle: { type: "dashed" } };
  return {
    animation: false,
    grid: { left: 48, right: 24, top: 36, bottom: 40 },
    legend: { top: 0, data: ["Adds", "Takes off"] },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => (v === null || v === undefined ? "–" : rs(v)) },
    xAxis: { type: "category", data: labels, axisLabel: { interval: 0 } },
    yAxis: { type: "value", name: "₹/kWh", min: 0 },
    series,
  };
}

/** The Winning bid step. */
export default function WinningBid({ state, terms }) {
  const own = useMemo(() => {
    try { return financeOf(state, terms)?.tariff ?? null; } catch { return null; }
  }, [state, terms]);
  const option = useMemo(() => bridgeChart(own), [own]);
  const last = BRIDGE[BRIDGE.length - 1];
  return (
    <>
      <Section index="8" title="Winning bid" note={`${RESULT.name} · ${RESULT.auction}`}
        actions={<a className="secondary" href={RESULT.source} target="_blank" rel="noreferrer"><ExternalLink size={13} /> SECI's result</a>}>
        <div className="win-head" data-testid="win-head">
          <div><span className="rtc-index"><Trophy size={12} /> Winners</span><strong>{RESULT.winners}</strong></div>
          <div><span className="rtc-index">First round</span><strong>{RESULT.firstRound}</strong></div>
          <div><span className="rtc-index">This bid</span><strong>{own ? `${rs(own)}/kWh` : "Size the plant to compare"}</strong>
            {own && <small>{own > 5.25 ? `${rs(own - 5.25)} above the winners` : "at or below the winners"}</small>}</div>
        </div>
        <p className="rtc-note">
          The ₹5.25 auction is this tender: Amendment-03 (25.06.2026) renamed it FDRE-RTC-V and rewrote its supply profile,
          which this tab now sizes by default. The bridge below starts from the benchmark inputs on the terms before the amendment
          and changes one thing at a time, each a run of the same HiGHS sizing at 200 MW with the shortfall penalty allowed and the
          Peak Hours on the 6 costliest IEX hours of each day.
        </p>
        <LiveChart option={option} height={300} />
      </Section>

      <Section title="The bridge, step by step" note="Cumulative; plant per contracted MW">
        <div className="win-scroll"><table className="win-table" data-testid="win-bridge">
          <thead><tr><th>Step</th><th>Tariff</th><th>Change</th><th>Solar MWac</th><th>Wind MW</th><th>Battery MW / MWh</th><th>Basis</th></tr></thead>
          <tbody>
            {BRIDGE.map((b, i) => (
              <tr key={b.id} data-testid={`win-step-${b.id}`}>
                <td>{b.step}</td>
                <td><strong>{rs(b.tariff)}</strong></td>
                <td className={i === 0 ? "" : b.tariff > BRIDGE[i - 1].tariff ? "bad" : "ok"}>{i === 0 ? "–" : `${b.tariff > BRIDGE[i - 1].tariff ? "+" : "−"}${nf(Math.abs(b.tariff - BRIDGE[i - 1].tariff), 2)}`}</td>
                <td>{nf(b.plant.solar, 2)}</td>
                <td>{nf(b.plant.wind, 2)}</td>
                <td>{nf(b.plant.bess, 2)} / {nf(b.plant.bessMwh, 2)}</td>
                <td>{b.link ? <a href={b.link} target="_blank" rel="noreferrer">{b.basis}</a> : b.basis}{b.kind === "estimate" && <span className="seci-badge missing">estimate</span>}</td>
              </tr>
            ))}
            <tr className="win-alt">
              <td>The last step with every hour of 18:00–10:00 held to 90% (the buyer may pick any 6 of the 16)</td>
              <td><strong>{rs(ANY_SIX.tariff)}</strong></td>
              <td className="bad">+{nf(ANY_SIX.tariff - last.tariff, 2)}</td>
              <td>{nf(ANY_SIX.plant.solar, 2)}</td><td>{nf(ANY_SIX.plant.wind, 2)}</td><td>{nf(ANY_SIX.plant.bess, 2)} / {nf(ANY_SIX.plant.bessMwh, 2)}</td>
              <td>Our sizing</td>
            </tr>
          </tbody>
        </table></div>
        <p className="rtc-note" data-testid="win-bracket">
          {rs(last.tariff)} with the costliest hours and {rs(ANY_SIX.tariff)} with any 6 of the 16 bracket the winners' ₹5.25 and NTPC's ₹5.39.
          About ₹5.35 on the costliest hours needs the last step with an equity IRR near 13% (interpolated, not run).
        </p>
      </Section>

      <Section title="Against what a winner built">
        <table className="win-table" data-testid="win-disclosed">
          <thead><tr><th></th><th>Solar per MW</th><th>Wind per MW</th><th>Storage per MW</th></tr></thead>
          <tbody>
            <tr><td>The bridge's last step</td><td>{nf(last.plant.solar, 2)} MWac (about {nf(last.plant.solar * 1.4, 1)} MWp)</td><td>{nf(last.plant.wind, 2)} MW</td><td>{nf(last.plant.bessMwh, 1)} MWh</td></tr>
            <tr><td><a href={DISCLOSED.source} target="_blank" rel="noreferrer">{DISCLOSED.who}</a></td><td>{nf(DISCLOSED.plant.solarMwp, 2)} MWp</td><td>{nf(DISCLOSED.plant.wind, 2)} MW</td><td>{nf(DISCLOSED.plant.bessMwh, 1)} MWh</td></tr>
            <tr><td>This tab's benchmark design</td><td>{nf(BRIDGE[0].plant.solar, 2)} MWac</td><td>{nf(BRIDGE[0].plant.wind, 2)} MW</td><td>{nf(BRIDGE[0].plant.bessMwh, 1)} MWh</td></tr>
          </tbody>
        </table>
        <p className="rtc-note">{DISCLOSED.note}. Both point the same way: solar-heavy, little wind, 8–10 MWh of storage per contracted MW.</p>
      </Section>

      <Section title="The biggest levers">
        <div className="win-levers">
          {LEVERS.map(([what, size, why]) => (
            <article key={what}><strong>{what}</strong><span>{size}</span><p>{why}</p></article>
          ))}
        </div>
        <details className="win-more">
          <summary>Each change on its own, from ₹6.50 on the old terms</summary>
          <table className="win-table">
            <tbody>{ONE_AT_A_TIME.map(([what, d]) => <tr key={what}><td>{what}</td><td className={d > 0 ? "bad" : d < 0 ? "ok" : ""}>{d === 0 ? "₹0.00" : `${d > 0 ? "+" : "−"}₹${nf(Math.abs(d), 2)}`}</td></tr>)}</tbody>
          </table>
        </details>
      </Section>

      <Section title="Which results compare">
        <table className="win-table">
          <tbody>{COMPARABLE.map(([what, why]) => <tr key={what}><td><strong>{what}</strong></td><td>{why}</td></tr>)}</tbody>
        </table>
        <div className="win-caveat">
          <strong>Not verified</strong>
          <ul>{NOT_VERIFIED.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </Section>
    </>
  );
}
