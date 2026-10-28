"use client";
// What-if analysis: enter a plant, its costs, the financing and a bid tariff; see at once what
// equity, project and lender's IRR the bid earns, the tariff the target IRR would need, and
// whether the plant meets the SECI RTC-TM-V supply floors and limits. Every return opens the
// traceable model; the solar and wind studios fill the costs.
import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FlaskConical, LayoutGrid, RotateCcw, TriangleAlert, XCircle } from "lucide-react";
import { Field, Section, SelectBox, Stat, SwitchBox, nf, pf } from "../rtc/ui";
import { LiveChart } from "../rtc/charts";
import { DATA_COLORS } from "../chartTheme";
import * as E from "../rtc/engine";
import { TraceButton, TraceProvider } from "../model/ModelExplorer";
import SolarStudio from "../plant/SolarStudio";
import WindStudio from "../plant/WindStudio";
import { PEAK_PLANS, SHORTFALL_MODES } from "../seci/terms";
import { SECI_LIMITS, WHATIF_NOTE, defaultWhatIf, runWhatIf } from "./model";

const KEY = "tenderos-whatif";

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

const VERDICT = {
  pass: { icon: CheckCircle2, cls: "good", text: "Meets the tender: inside the bid range, storage in place, every peak and off-peak block at its floor in year 1." },
  penalty: { icon: TriangleAlert, cls: "warn", text: "Meets the tender's limits; some blocks fall below their floor and are paid at 1.5 × the tariff (the tender allows this)." },
  fail: { icon: XCircle, cls: "bad", text: "Does not meet the tender: see the checks below." },
};

/** A week of the year-1 dispatch against the block floors. */
function weekOption(y1, week, contracted) {
  const H = y1.hourly;
  const start = Math.min(E.HOURS - 168, week * 168);
  const idx = Array.from({ length: 168 }, (_, i) => start + i);
  const r = (v) => Number(v.toFixed(1));
  const areas = [];
  for (let i = 0; i < 168; i += 1) if (H.peak[idx[i]] && (i === 0 || !H.peak[idx[i - 1]])) {
    let j = i;
    while (j < 168 && H.peak[idx[j]]) j += 1;
    areas.push([{ xAxis: i }, { xAxis: j - 1 }]);
  }
  const stack = (name, data, color) => ({ name, type: "line", stack: "s", areaStyle: { color, opacity: 0.8 }, lineStyle: { width: 0 }, symbol: "none", itemStyle: { color }, data });
  return {
    animation: false,
    grid: { left: 52, right: 16, top: 30, bottom: 36 },
    legend: { top: 0, right: 0 },
    tooltip: { trigger: "axis", valueFormatter: (v) => `${nf(v, 0)} MW` },
    xAxis: { type: "category", data: idx.map((t) => `D${Math.floor((t - start) / 24) + 1} ${String(E.HOUR_OF_DAY[t]).padStart(2, "0")}h`), axisLabel: { interval: 23 } },
    yAxis: { type: "value", name: "MW at the meter" },
    series: [
      { ...stack("Solar", idx.map((t) => r(H.solar[t])), DATA_COLORS.solar), markArea: { silent: true, itemStyle: { color: "rgba(212,255,63,0.07)" }, data: areas } },
      stack("Wind", idx.map((t) => r(H.wind[t])), DATA_COLORS.wind),
      stack("Battery", idx.map((t) => r(H.discharge[t])), DATA_COLORS.bess),
      { name: "Block floor", type: "line", step: "middle", symbol: "none", data: idx.map((t) => r(H.floor[t])), lineStyle: { color: "#ff6b5f", type: "dashed", width: 1.2 }, itemStyle: { color: "#ff6b5f" } },
      { name: "Contracted", type: "line", symbol: "none", data: idx.map(() => r(contracted)), lineStyle: { color: "#f4f4f1", type: "dotted", width: 1 }, itemStyle: { color: "#f4f4f1" } },
    ],
  };
}

/** Equity IRR against the tariff, with the target and the bid. */
function irrCurve(res) {
  const { fin, atBid } = res;
  const lo = Math.max(1, res.needed.tariff * 0.7);
  const hi = res.needed.tariff * 1.3;
  const pts = [];
  for (let k = 0; k <= 24; k += 1) {
    const t = lo + ((hi - lo) * k) / 24;
    const f = E.runFinancialModel(null, res.sizes, { costs: res.costs, fin: { ...fin, tariff: t }, bess: res.bess, dfrTarget: 0, tariffLocked: true, ops: res.ops, solveBy: "npv" });
    pts.push([Number(t.toFixed(3)), Number.isFinite(f.equityIrr) ? Number((f.equityIrr * 100).toFixed(2)) : null, Number.isFinite(f.projectIrr) ? Number((f.projectIrr * 100).toFixed(2)) : null]);
  }
  return {
    animation: false,
    grid: { left: 52, right: 16, top: 30, bottom: 40 },
    legend: { top: 0, right: 0 },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v === null ? "–" : `${nf(v, 2)}%`) },
    xAxis: { type: "value", name: "₹/kWh", min: Number(lo.toFixed(2)), max: Number(hi.toFixed(2)) },
    yAxis: { type: "value", name: "IRR %" },
    series: [
      { name: "Equity IRR", type: "line", showSymbol: false, data: pts.map((p) => [p[0], p[1]]), lineStyle: { color: DATA_COLORS.signal, width: 2 }, itemStyle: { color: DATA_COLORS.signal },
        markLine: { silent: true, symbol: "none", data: [{ yAxis: fin.targetEquityIrr * 100, label: { formatter: "target", color: "#86867f" }, lineStyle: { color: "#86867f", type: "dashed" } }, { xAxis: Number(fin.tariff.toFixed(3)), label: { formatter: "your bid", color: "#f4f4f1" }, lineStyle: { color: "#f4f4f1", type: "dotted" } }] } },
      { name: "Project IRR", type: "line", showSymbol: false, data: pts.map((p) => [p[0], p[2]]), lineStyle: { color: DATA_COLORS.wind, width: 1.4 }, itemStyle: { color: DATA_COLORS.wind } },
    ],
    _atBid: atBid.equityIrr,
  };
}

export default function WhatIfTab() {
  const [state, setState] = useState(() => defaultWhatIf());
  const [loaded, setLoaded] = useState(false);
  const [studio, setStudio] = useState(null); // "solar" | "wind"
  const [week, setWeek] = useState(28);
  useEffect(() => { const v = load(); if (v) setState((s) => ({ ...s, ...v, bess: { ...s.bess, ...(v.bess || {}) }, costs: { ...s.costs, ...(v.costs || {}) }, om: { ...s.om, ...(v.om || {}) }, fin: { ...s.fin, ...(v.fin || {}) } })); setLoaded(true); }, []);
  useEffect(() => { if (!loaded) return; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage off: the case lasts for the page */ } }, [state, loaded]);
  const res = useMemo(() => runWhatIf(state), [state]);
  const set = (v) => setState((s) => ({ ...s, ...v }));
  const setIn = (part, v) => setState((s) => ({ ...s, [part]: { ...s[part], ...v } }));
  const curve = useMemo(() => irrCurve(res), [res]);
  const week1 = useMemo(() => weekOption(res.year1, week, state.contractedMw), [res, week, state.contractedMw]);
  const f = res.finance;
  const V = VERDICT[res.verdict];
  const VIcon = V.icon;
  const y1 = res.year1;
  const capex = res.atBid.capex;
  const rows = res.atBid.rows;

  return (
    <TraceProvider getLive={() => res.live}>
      <div className="rtc story bid whatif">
        <section className="story-hero">
          <div>
            <div className="eyebrow"><FlaskConical size={13} /> What-if analysis · SECI RTC-TM-V supply floors</div>
            <h1>What if</h1>
            <p>Enter a plant, its costs, the financing and the tariff you would bid. The model dispatches every PPA year against the tender&apos;s peak and off-peak floors, runs the 25-year financial model at your tariff and tells you the equity, project and lender&apos;s returns, and whether the size meets the tender.</p>
          </div>
          <div className="story-hero-tools">
            <button type="button" className="rtc-reset" onClick={() => setState(defaultWhatIf())} data-testid="whatif-reset"><RotateCcw size={13} /> Reset inputs</button>
          </div>
        </section>

        <div className={`whatif-verdict tone-${V.cls}`} data-testid="whatif-verdict" data-verdict={res.verdict}>
          <VIcon size={18} />
          <div>
            <b>{res.verdict === "pass" ? "Compliant" : res.verdict === "penalty" ? "Compliant, with block penalties" : "Not compliant"}</b>
            <span>{V.text}</span>
          </div>
          <div className="whatif-verdict-fin">
            <b className={f.meetsTarget ? "good" : "bad"}>{f.meetsTarget ? "Meets" : "Below"} the target equity IRR</b>
            <span>{f.bankable ? "DSCR at or above" : "DSCR below"} the lender&apos;s {nf(state.fin.minDscr, 2)}×</span>
          </div>
        </div>

        <Section index="1" title="Returns at your bid tariff" note={WHATIF_NOTE} actions={<TraceButton />}>
          <div className="whatif-tariff">
            <Field label="Bid tariff" unit="₹/kWh" value={state.fin.tariff} onChange={(v) => setIn("fin", { tariff: v })} step={0.01} min={0} digits={3} />
            <div className="whatif-needed" data-testid="whatif-needed">
              <span>Tariff for a {pf(state.fin.targetEquityIrr, 1)} equity IRR</span>
              <b>₹{nf(f.tariffNeeded, 3)}/kWh</b>
              <small>{state.fin.tariff >= f.tariffNeeded ? `your bid is ₹${nf(state.fin.tariff - f.tariffNeeded, 3)} above it` : `your bid is ₹${nf(f.tariffNeeded - state.fin.tariff, 3)} below it`}</small>
              <button type="button" className="secondary" onClick={() => setIn("fin", { tariff: Number(f.tariffNeeded.toFixed(3)) })} data-testid="whatif-use-needed">Bid at this tariff</button>
            </div>
          </div>
          <div className="rtc-grid rtc-grid-4" data-testid="whatif-returns">
            <Stat label="Equity IRR" value={pf(f.equityIrr, 2)} detail={`target ${pf(state.fin.targetEquityIrr, 1)} · NPV ₹${nf(f.equityNpv, 0)} cr`} tone={f.meetsTarget ? "good" : "bad"} trace={{ key: "equityIrr" }} />
            <Stat label="Project IRR" value={pf(f.projectIrr, 2)} detail="post-tax, unlevered" trace={{ key: "projectIrr" }} />
            <Stat label="Lender's IRR (debt)" value={pf(f.lenderIrr, 2)} detail={`₹${nf(res.atBid.debt, 0)} cr over ${state.fin.tenorYears} years`} />
            <Stat label="DSCR min / average" value={`${nf(f.minDscr, 2)} / ${nf(f.avgDscr, 2)}`} detail={`lender's minimum ${nf(state.fin.minDscr, 2)}×`} tone={f.bankable ? undefined : "bad"} trace={{ key: "minDscr" }} />
            <Stat label="Project cost" value={`₹${nf(capex.total, 0)} cr`} detail={`debt ₹${nf(res.atBid.debt, 0)} cr · equity ₹${nf(res.atBid.equity, 0)} cr`} trace={{ key: "capexTotal" }} />
            <Stat label="LCOE" value={`₹${nf(f.lcoe, 3)}`} detail={`at ${pf(state.fin.discountRate, 1)} discount`} trace={{ key: "lcoe" }} />
            <Stat label="Year-1 supply" value={`${nf(y1.deliveredMWh / 1000, 0)} MU`} detail={`${pf(y1.deliveredMWh / y1.demandMWh, 1)} of the ${nf(y1.demandMWh / 1000, 0)} MU contracted`} trace={{ line: "delivered", year: 1 }} />
            <Stat label="Equity payback" value={f.payback ? `year ${f.payback}` : "beyond term"} trace={{ key: "payback" }} />
          </div>
          <div className="rtc-grid rtc-grid-2">
            <div><div className="rtc-subhead">Equity and project IRR against the tariff</div><LiveChart option={curve} height={280} /></div>
            <div>
              <div className="rtc-subhead">Year 1, one week: supply against the block floors <input type="range" min={0} max={51} value={week} onChange={(e) => setWeek(Number(e.target.value))} aria-label="Week" /> week {week + 1}</div>
              <LiveChart option={week1} height={280} />
            </div>
          </div>
        </Section>

        <Section index="2" title="Tender compliance" note="SECI RTC-TM-V: the bid range, storage, and the floors in every Peak and off-peak block">
          <table className="studio-cost whatif-checks" data-testid="whatif-checks">
            <thead><tr><th /><th>Condition</th><th>This plant</th></tr></thead>
            <tbody>
              {res.checks.map((c) => (
                <tr key={c.id} className={c.ok ? "" : "is-bad"} data-testid={`whatif-check-${c.id}`}>
                  <td>{c.ok ? <CheckCircle2 size={14} className="good" /> : <XCircle size={14} className="bad" />}</td>
                  <td>{c.label}{!c.hard && <small>shortfall allowed, paid at 1.5 × tariff</small>}</td>
                  <td>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rtc-grid rtc-grid-4">
            <Stat label="Peak blocks at the floor, year 1" value={pf(y1.rules.peak.share, 1)} detail={`${nf(y1.rules.peak.met, 0)} of ${nf(y1.rules.peak.hours, 0)} hours`} tone={y1.rules.peak.share >= 0.999 ? "good" : undefined} />
            <Stat label="Off-peak blocks at the floor" value={pf(y1.rules.offpeak.share, 1)} detail={`${nf(y1.rules.offpeak.met, 0)} of ${nf(y1.rules.offpeak.hours, 0)} hours`} tone={y1.rules.offpeak.share >= 0.999 ? "good" : undefined} />
            <Stat label="Short of the floors, year 1" value={`${nf(y1.blockShortfallMWh / 1000, 1)} MU`} detail={`penalty ₹${nf(res.penaltyY1, 1)} cr at 1.5 × tariff`} trace={{ line: "blockPenCr", year: 1 }} />
            <Stat label="Surplus sold / curtailed" value={`${nf(y1.excessMWh / 1000, 0)} / ${nf(y1.curtailMWh / 1000, 0)} MU`} detail={state.fin.sellSurplus ? `at ₹${nf(state.fin.surplusPrice, 2)}/kWh` : "sale switched off"} />
          </div>
        </Section>

        <Section index="3" title="Your case" note="Change any input: the results above follow at once">
          <div className="whatif-inputs">
            <div className="whatif-group">
              <div className="rtc-subhead">Tender and plan</div>
              <div className="rtc-grid rtc-grid-2">
                <Field label="Contracted capacity (bid)" unit="MW" value={state.contractedMw} onChange={(v) => set({ contractedMw: v })} step={10} min={0} hint={`The tender takes ${SECI_LIMITS.minBidMw}–${SECI_LIMITS.maxBidMw} MW from one bidder`} />
                <SelectBox label="Peak Hours plan" value={state.peakPlan} onChange={(v) => set({ peakPlan: v })} options={Object.entries(PEAK_PLANS).map(([k, p]) => [k, p.label])} hint={PEAK_PLANS[state.peakPlan]?.detail} />
                <SelectBox label="Shortfall below a floor" value={state.shortfall} onChange={(v) => set({ shortfall: v })} options={Object.entries(SHORTFALL_MODES).map(([k, p]) => [k, p.label])} hint={SHORTFALL_MODES[state.shortfall]?.detail} />
              </div>
            </div>
            <div className="whatif-group">
              <div className="rtc-subhead">Size</div>
              <div className="rtc-grid rtc-grid-2">
                <Field label="Solar" unit="MWac" value={state.solarMwac} onChange={(v) => set({ solarMwac: v })} step={10} min={0} hint={`${nf(state.solarMwac * state.dcAc, 0)} MWp at DC:AC ${nf(state.dcAc, 2)}`} />
                <Field label="DC:AC ratio" unit="MWp/MWac" value={state.dcAc} onChange={(v) => set({ dcAc: v })} step={0.05} min={1} max={2.5} />
                <Field label="Wind" unit="MW" value={state.windMw} onChange={(v) => set({ windMw: v })} step={10} min={0} />
                <Field label="Battery power" unit="MW" value={state.bessMw} onChange={(v) => set({ bessMw: v })} step={10} min={0} />
                <Field label="Battery duration" unit="hours" value={state.bessHours} onChange={(v) => set({ bessHours: v })} step={0.5} min={0} max={10} hint={`${nf(state.bessMw * state.bessHours, 0)} MWh`} />
              </div>
            </div>
            <div className="whatif-group">
              <div className="rtc-subhead">Resource and losses</div>
              <div className="rtc-grid rtc-grid-2">
                <Field label="Solar CUF (AC)" pct value={state.solarCuf} onChange={(v) => set({ solarCuf: v })} step={0.1} min={5} max={45} />
                <Field label="Wind CUF" pct value={state.windCuf} onChange={(v) => set({ windCuf: v })} step={0.1} min={10} max={60} />
                <Field label="Power transformer loss" pct value={state.trafoLossPct} onChange={(v) => set({ trafoLossPct: v })} step={0.05} min={0} max={5} />
                <Field label="Line loss to the meter" pct value={state.lineLossPct} onChange={(v) => set({ lineLossPct: v })} step={0.05} min={0} max={5} />
                <Field label="Battery round-trip efficiency" pct value={state.bess.rte} onChange={(v) => setIn("bess", { rte: v })} step={0.5} min={50} max={100} />
                <Field label="Battery fade" pct value={state.bess.annualDegradation} onChange={(v) => setIn("bess", { annualDegradation: v })} step={0.25} min={0} max={10} hint="per year, made good by annual augmentation" />
              </div>
            </div>
            <div className="whatif-group">
              <div className="rtc-subhead">Costs
                <button type="button" className="secondary" onClick={() => setStudio("solar")} data-testid="whatif-solar-studio"><LayoutGrid size={12} /> Solar studio</button>
                <button type="button" className="secondary" onClick={() => setStudio("wind")} data-testid="whatif-wind-studio"><LayoutGrid size={12} /> Wind studio</button>
              </div>
              <div className="rtc-grid rtc-grid-2">
                <Field label="Solar capex" unit="₹ cr/MWac" value={state.costs.solarCrPerMwac} onChange={(v) => setIn("costs", { solarCrPerMwac: v })} step={0.05} min={0} hint={`= ₹${nf(state.costs.solarCrPerMwac / state.dcAc, 3)} cr/MWp`} />
                <Field label="Wind capex" unit="₹ cr/MW" value={state.costs.windCrPerMw} onChange={(v) => setIn("costs", { windCrPerMw: v })} step={0.05} min={0} />
                <Field label="Battery energy" unit="₹ cr/MWh" value={state.costs.bessCrPerMwh} onChange={(v) => setIn("costs", { bessCrPerMwh: v })} step={0.05} min={0} />
                <Field label="Battery power conversion" unit="₹ cr/MW" value={state.costs.bessPcsCrPerMw} onChange={(v) => setIn("costs", { bessPcsCrPerMw: v })} step={0.05} min={0} hint="0 when in the energy price" />
                <Field label="Evacuation / pooling" unit="₹ cr" value={state.costs.evacuationCr} onChange={(v) => setIn("costs", { evacuationCr: v })} step={5} min={0} />
                <Field label="Pre-operative and IDC" pct value={state.costs.preopPct} onChange={(v) => setIn("costs", { preopPct: v })} step={0.5} min={0} max={30} />
                <Field label="Solar O&M" unit="₹ lakh/MWac/yr" value={state.om.solarLakhPerMwac} onChange={(v) => setIn("om", { solarLakhPerMwac: v })} step={0.1} min={0} />
                <Field label="Wind O&M" unit="₹ lakh/MW/yr" value={state.om.windLakhPerMw} onChange={(v) => setIn("om", { windLakhPerMw: v })} step={0.1} min={0} />
                <Field label="Battery O&M" unit="₹ lakh/MWh/yr" value={state.om.bessLakhPerMwh} onChange={(v) => setIn("om", { bessLakhPerMwh: v })} step={0.1} min={0} />
                <Field label="O&M escalation" pct value={state.fin.omEscalation} onChange={(v) => setIn("fin", { omEscalation: v })} step={0.25} min={0} max={15} />
              </div>
            </div>
            <div className="whatif-group">
              <div className="rtc-subhead">Financing and tax</div>
              <div className="rtc-grid rtc-grid-2">
                <Field label="Debt share" pct value={state.fin.debtFraction} onChange={(v) => setIn("fin", { debtFraction: v })} step={1} min={0} max={95} />
                <Field label="Interest rate" pct value={state.fin.interestRate} onChange={(v) => setIn("fin", { interestRate: v })} step={0.05} min={0} max={25} />
                <Field label="Loan tenor" unit="years" value={state.fin.tenorYears} onChange={(v) => setIn("fin", { tenorYears: Math.max(1, Math.round(v)) })} step={1} min={1} max={25} />
                <SelectBox label="Repayment" value={state.fin.repayment} onChange={(v) => setIn("fin", { repayment: v })} options={[["equal", "Equal principal"], ["annuity", "Annuity"]]} />
                <Field label="Lender's minimum DSCR" unit="×" value={state.fin.minDscr} onChange={(v) => setIn("fin", { minDscr: v })} step={0.05} min={1} max={2} />
                <Field label="Target equity IRR" pct value={state.fin.targetEquityIrr} onChange={(v) => setIn("fin", { targetEquityIrr: v })} step={0.25} min={0} max={40} />
                <Field label="Discount rate (LCOE, NPV)" pct value={state.fin.discountRate} onChange={(v) => setIn("fin", { discountRate: v })} step={0.25} min={0} max={30} />
                <Field label="Tariff escalation" pct value={state.fin.tariffEscalation} onChange={(v) => setIn("fin", { tariffEscalation: v })} step={0.1} min={0} max={10} />
                <Field label="Corporate tax" pct value={state.fin.taxRate} onChange={(v) => setIn("fin", { taxRate: v })} step={0.01} min={0} max={50} digits={5} />
                <SelectBox label="Tax depreciation" value={state.fin.taxDepreciation} onChange={(v) => setIn("fin", { taxDepreciation: v })} options={[["wdv", "WDV"], ["slm", "Straight line"]]} />
                <Field label="WDV rate" pct value={state.fin.wdvRate} onChange={(v) => setIn("fin", { wdvRate: v })} step={1} min={0} max={100} />
                <Field label="Insurance" pct value={state.fin.insurancePct} onChange={(v) => setIn("fin", { insurancePct: v })} step={0.05} min={0} max={3} hint="of hard cost a year" />
                <SwitchBox label="Sell surplus in the market" checked={state.fin.sellSurplus} onChange={(v) => setIn("fin", { sellSurplus: v })} />
                <Field label="Surplus sale price" unit="₹/kWh" value={state.fin.surplusPrice} onChange={(v) => setIn("fin", { surplusPrice: v })} step={0.05} min={0} />
              </div>
            </div>
          </div>
        </Section>

        <Section index="4" title="Year by year" note="Click a number for its formula; the full model shows every line" actions={<TraceButton label="Open the full model" />}>
          <div className="table-wrap rtc-model">
            <table data-testid="whatif-years">
              <thead><tr><th>₹ crore</th>{rows.map((r) => <th key={r.year}>Y{r.year}</th>)}</tr></thead>
              <tbody>
                {[["Delivered (MU)", "deliveredMu", 0], ["Short of the floors (MU)", "blockShortfallMu", 1], ["PPA revenue", "energyRevenue", 1], ["Surplus sale", "surplusRevenue", 1], ["Block penalty", "blockPenalty", 1], ["Operating cost", "opex", 1], ["EBITDA", "ebitda", 1], ["Interest", "interest", 1], ["Principal", "principal", 1], ["Tax", "tax", 1], ["Free cash to equity", "fcfe", 1], ["DSCR", "dscr", 2]].map(([label, k, d]) => (
                  <tr key={k}><td>{label}</td>{rows.map((r) => <td key={r.year}>{r[k] === null || r[k] === undefined ? "–" : nf(r[k], d)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {studio === "solar" && (
          <SolarStudio studio={state.solarStudio} acMw={state.solarMwac} fixedCuf={state.solarCuf} onChange={(v) => set({ solarStudio: v })} onClose={() => setStudio(null)}
            onApply={({ capex: c, dcAc, studio: v }) => { setState((s) => ({ ...s, solarStudio: v, dcAc: dcAc || s.dcAc, costs: { ...s.costs, solarCrPerMwac: c } })); setStudio(null); }} />
        )}
        {studio === "wind" && (
          <WindStudio studio={state.windStudio} farmMw={state.windMw} onChange={(v) => set({ windStudio: v })} onClose={() => setStudio(null)}
            onApply={({ capex: c, cuf, studio: v }) => { setState((s) => ({ ...s, windStudio: v, windCuf: cuf || s.windCuf, costs: { ...s.costs, windCrPerMw: c } })); setStudio(null); }} />
        )}
      </div>
    </TraceProvider>
  );
}
