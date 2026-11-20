"use client";
// The bid against the market, on the Financial model step: what the earlier auctions of the same
// product discovered, this bid's tariff beside them, the bridge from the older benchmark inputs to
// those results (each step a run of this tab's sizing), and a button that puts the market case's
// inputs in the bid. Data and sources: ./marketCase.js.
import React, { useMemo } from "react";
import { ExternalLink, Scale, Wand2 } from "lucide-react";
import { Section, nf } from "../rtc/ui";
import { LiveChart } from "../rtc/charts";
import { DATA_COLORS } from "../dataColors";
import { BEFORE_FIX, BENCHMARK_SOURCES, BRIDGE, LATEST, MARKET_CASE, NOT_VERIFIED, RESULTS, againstMarket, applyMarketCase } from "./marketCase.js";

const rs = (v, d = 2) => `₹${nf(v, d)}`;
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const LABEL = { show: true, color: "#9a9a92", textBorderWidth: 0, fontSize: 11 };

function bridgeChart(own) {
  const labels = BRIDGE.map((b) => b.label);
  const base = [];
  const down = [];
  BRIDGE.forEach((b, i) => {
    if (i === 0) { base.push(0); down.push(null); return; }
    base.push(b.tariff);
    down.push(+(BRIDGE[i - 1].tariff - b.tariff).toFixed(2));
  });
  const totals = BRIDGE.map((b, i) => (i === 0 ? b.tariff : null));
  labels.push(LATEST.tender.replace("SECI-", ""));
  base.push(0); down.push(null); totals.push(LATEST.high);
  const series = [
    { name: "base", type: "bar", stack: "w", itemStyle: { color: "transparent" }, data: base, tooltip: { show: false } },
    { name: "Tariff", type: "bar", stack: "w", data: totals, itemStyle: { color: DATA_COLORS.muted }, label: { ...LABEL, position: "top", formatter: (p) => (p.value ? rs(p.value) : "") } },
    { name: "Takes off", type: "bar", stack: "w", data: down, itemStyle: { color: DATA_COLORS.surplus }, label: { ...LABEL, position: "top", formatter: (p) => (p.value ? `−${nf(p.value, 2)}` : "") } },
  ];
  const marks = [{ yAxis: LATEST.high, name: `${LATEST.tender} ${rs(LATEST.high)}` }];
  if (own) marks.push({ yAxis: +own.toFixed(2), name: `This bid ${rs(own)}` });
  series[1].markLine = { symbol: "none", data: marks, label: { ...LABEL, formatter: (p) => p.name, position: "insideStartTop" }, lineStyle: { type: "dashed" } };
  return {
    animation: false,
    grid: { left: 48, right: 24, top: 24, bottom: 40 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => (v === null || v === undefined ? "–" : rs(v)) },
    xAxis: { type: "category", data: labels, axisLabel: { interval: 0 } },
    yAxis: { type: "value", name: "₹/kWh", min: 0 },
    series,
  };
}

/** tariff: this bid's financial-model tariff (₹/kWh), or null before it is sized. */
export default function MarketCheck({ tariff = null, state, setState, goto, index = "7.5" }) {
  const option = useMemo(() => bridgeChart(tariff), [tariff]);
  const where = againstMarket(tariff);
  const last = BRIDGE[BRIDGE.length - 1];
  const irr = state?.fin?.targetEquityIrr;
  const apply = () => {
    setState((s) => applyMarketCase(s));
    goto("size");
  };
  return (
    <>
      <Section index={index} title="Against the market" note="The earlier auctions of the same product: 4 MWh per contracted MW a day in four peak hours, 25 years"
        actions={<a className="secondary" href={LATEST.source} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {LATEST.tender}'s result</a>}>
        <div className="win-head" data-testid="fdrex-market-head">
          <div><span className="rtc-index"><Scale size={12} /> This bid</span><strong data-testid="fdrex-market-own">{tariff ? `${rs(tariff, 3)}/kWh` : "Size the plant to compare"}</strong>
            {where && <small data-testid="fdrex-market-gap">{where.words}{Number.isFinite(irr) ? ` · at your ${nf(irr * 100, 1)}% equity IRR` : ""}</small>}</div>
          <div><span className="rtc-index">{LATEST.tender} · {fmtDate(LATEST.auction)}</span><strong>{rs(LATEST.low)}–{rs(LATEST.high)}/kWh</strong><small>{LATEST.note}</small></div>
          <div><span className="rtc-index">This model on the market case</span><strong>{rs(last.tariff)}/kWh</strong>
            <small>battery ₹0.80 cr/MWh, debt 75% at 8.5% for 18 years, equity IRR 12%, wind 37% CUF: the last step of the bridge below</small></div>
        </div>
        <div className="mkt-scroll"><table className="win-table mkt-table" data-testid="fdrex-market-results">
          <thead><tr><th>Auction</th><th>Quantity</th><th>e-reverse auction</th><th>Tariff discovered</th><th>Note</th><th>Source</th></tr></thead>
          <tbody>
            {RESULTS.map((r) => (
              <tr key={r.id}>
                <td><b>{r.tender}</b></td><td>{r.quantity}</td><td>{fmtDate(r.auction)}</td>
                <td>{r.low === r.high ? rs(r.low) : `${rs(r.low)}–${rs(r.high)}`}/kWh</td><td>{r.note}</td>
                <td><a href={r.source} target="_blank" rel="noreferrer">result <ExternalLink size={10} /></a></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="rtc-note">
          The discovered tariff fell from ₹8.50 to ₹6.00 in twenty months, as battery prices fell and bidders came to count on selling
          the surplus. A tariff from this tab is the one your inputs need for your equity IRR: on cautious inputs it is above the auctions, on the
          inputs the winners appear to use it is at their level. The bridge shows which input moves it by how much.
        </p>
      </Section>

      <Section title="From the older benchmarks to the market" note="Cumulative, on a 100 MW bid; each step a run of this tab's HiGHS sizing priced by the financial model"
        actions={<button type="button" className="primary" onClick={apply} data-testid="fdrex-market-apply"><Wand2 size={13} /> Use the market case in this bid</button>}>
        <LiveChart option={option} height={280} />
        <div className="mkt-scroll"><table className="win-table mkt-table" data-testid="fdrex-market-bridge">
          <thead><tr><th>Step</th><th>Tariff</th><th>Change</th><th>Plant per contracted MW</th><th>Days met, year 1</th><th>Basis</th></tr></thead>
          <tbody>
            {BRIDGE.map((b, i) => (
              <tr key={b.id} className={b.filled ? "is-filled" : ""}>
                <td>{b.step}{b.kind === "estimate" && <em className="win-est"> estimate</em>}</td>
                <td><b>{rs(b.tariff)}</b></td>
                <td className={i ? "ok" : ""}>{i ? `−${nf(BRIDGE[i - 1].tariff - b.tariff, 2)}` : "–"}</td>
                <td>{nf(b.plant.solar, 2)} MWac solar · {nf(b.plant.wind, 2)} MW wind · {nf(b.plant.bess, 2)} MW / {nf(b.plant.bessMwh, 2)} MWh</td>
                <td>{b.metDays} of 365</td>
                <td>{b.link ? <a href={b.link} target="_blank" rel="noreferrer">{b.basis} <ExternalLink size={10} /></a> : b.basis}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="rtc-note">
          "Fill up for me please" now fills the third row's inputs (battery ₹0.80 cr/MWh, debt 75% for 18 years) with a 14% equity IRR: about {rs(BRIDGE[2].tariff)} on this bid.
          "Use the market case" puts the last row's inputs in your bid (battery ₹{nf(MARKET_CASE.src.bess.capex, 2)} cr/MWh, wind {nf(MARKET_CASE.src.wind.cuf * 100, 0)}% CUF at ₹{nf(MARKET_CASE.src.wind.capex, 1)} cr/MW,
          debt {nf(MARKET_CASE.fin.debtFraction * 100, 0)}% at {nf(MARKET_CASE.fin.interestRate * 100, 1)}% for {MARKET_CASE.fin.tenorYears} years, equity IRR {nf(MARKET_CASE.fin.targetEquityIrr * 100, 0)}%) and takes you to Size.
          Until 20.11.2026 this tab showed {rs(BEFORE_FIX.tariff)} on the older benchmarks: it {BEFORE_FIX.note}.
        </p>
        <ul className="win-notes" data-testid="fdrex-market-notes">
          {BENCHMARK_SOURCES.map((b) => <li key={b.what}><b>{b.what}.</b> {b.basis} <a href={b.link} target="_blank" rel="noreferrer">source <ExternalLink size={10} /></a></li>)}
          {NOT_VERIFIED.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </Section>
    </>
  );
}
