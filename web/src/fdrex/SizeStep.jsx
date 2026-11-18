import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Clock3, FileArchive, FileSpreadsheet, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { Section, Stat, nf, pf } from "../rtc/ui";
import { LiveChart } from "../rtc/charts";
import Cite from "./Cite.jsx";
import { TENDER } from "./tender.js";
import { capShortfall, fmtDate, missingInputs, ownReCostRsPerKwh, penaltyCr, penaltyMwh, rfsAmounts, simulate } from "./model.js";
import { shortfallCauses, sizingChecks } from "./checks.js";
import BidReview from "./BidReview.jsx";
import { BLOCKS_PER_DAY, blockContext, blockTime, dayBlocks, dispatch15, peakOutput } from "./dispatch15.js";
import { downloadFile } from "./finance.js";
import { OptimiseBar } from "./DesignStep.jsx";

// The Size step of the SECI-FDRE-X tab (forked from the CfD-I tab's web/src/cfd/SizeStep.jsx): the
// plant sized for the least tariff, the tender's conditions on it, and its operation over the
// 25-year term by Contract Year, by day and in 15-minute blocks.
const COLORS = { own: "#7ddc9a", market: "#3fa7d6", sale: "#f2b84b", ess: "#a98bff", price: "#ff8a5f", wind: "#5fb3ff", lost: "#8a8f98" };
const FULL_PCT = Math.round((1 - TENDER.shortfallTolerance) * 100); // a peak block counts as full from this share of the supply due
const hh = (h) => `${String(h).padStart(2, "0")}:00`;
/** "18:00, 19:00, 21:00 and 22:00": the day's peak hours in clock order. */
const hoursText = (hours) => { const t = [...hours].sort((a, b) => a - b).map(hh); return t.length > 1 ? `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}` : t.join(""); };

function SourcesChart({ years }) {
  const option = useMemo(() => ({
    animation: false,
    grid: { left: 64, right: 16, top: 34, bottom: 40 },
    legend: { top: 0, right: 0 },
    tooltip: { trigger: "axis", valueFormatter: (v) => `${nf(v, 0)} MWh` },
    xAxis: { type: "category", data: years.map((y) => `CY ${y.index}`) },
    yAxis: { type: "value", name: "MWh supplied" },
    series: [
      { name: "Own RE", type: "bar", stack: "s", data: years.map((y) => Math.round(y.ownSuppliedMwh)), itemStyle: { color: COLORS.own } },
      { name: "Green market", type: "bar", stack: "s", data: years.map((y) => Math.round(y.shareMarket * y.deliveredMwh)), itemStyle: { color: COLORS.market } },
      { name: `Required (${TENDER.mwhPerMwDay} MWh/MW a day)`, type: "line", step: "middle", data: years.map((y) => Math.round(y.requiredMwh)), symbol: "none", lineStyle: { color: "#f4f4f1", type: "dashed", width: 1 }, itemStyle: { color: "#f4f4f1" } },
    ],
  }), [years]);
  return <LiveChart option={option} height={300} />;
}

/** The day in 96 blocks: the same series as the hourly chart, plus the battery's stored energy. */
function BlockChart({ blocks, meter }) {
  const option = useMemo(() => {
    if (!blocks) return null;
    const c = blocks.cols;
    const labels = Array.from({ length: BLOCKS_PER_DAY }, (_, b) => blockTime(b));
    const r = (arr, f = 1) => Array.from(arr, (v) => Number((v * f).toFixed(2)));
    return {
      animation: false,
      grid: { left: 56, right: 112, top: 34, bottom: 40 },
      legend: { top: 0, right: 0 },
      tooltip: { trigger: "axis", valueFormatter: (v) => (typeof v === "number" ? nf(v, 2) : v) },
      xAxis: { type: "category", data: labels, axisLabel: { interval: 7 } },
      yAxis: [{ type: "value", name: "MW" }, { type: "value", name: "₹/kWh", min: 0, splitLine: { show: false } }, { type: "value", name: "MWh stored", min: 0, offset: 56, splitLine: { show: false } }],
      series: [
        { name: "Solar + wind output", type: "line", areaStyle: { opacity: 0.18, color: COLORS.own }, lineStyle: { width: 1, color: COLORS.own }, symbol: "none", itemStyle: { color: COLORS.own }, data: Array.from(c.solar, (v, b) => Number((v + c.wind[b]).toFixed(2))),
          markArea: { silent: true, itemStyle: { color: "rgba(212,255,63,0.07)" }, data: [[{ xAxis: labels[18 * 4] }, { xAxis: labels[95] }]] } },
        { name: "Charging from own RE", type: "bar", stack: "c", barCategoryGap: "10%", data: r(c.chargeOwn, -1), itemStyle: { color: COLORS.own } },
        { name: "Charging from green market", type: "bar", stack: "c", data: r(c.chargeMarket, -meter), itemStyle: { color: COLORS.market } },
        { name: "Supply under the PPA", type: "bar", data: r(c.delivered), itemStyle: { color: COLORS.ess } },
        { name: "Sold in the market", type: "bar", data: r(c.sold), itemStyle: { color: COLORS.sale } },
        { name: "Curtailed", type: "bar", data: r(c.curtailed), itemStyle: { color: COLORS.lost } },
        { name: "Battery energy stored", type: "line", yAxisIndex: 2, symbol: "none", step: "end", data: r(c.stored), lineStyle: { color: "#f4f4f1", width: 1.2, type: "dotted" }, itemStyle: { color: "#f4f4f1" } },
        { name: "Exchange price", type: "line", yAxisIndex: 1, symbol: "none", data: r(c.sellPrice), lineStyle: { color: COLORS.price, width: 1.4 }, itemStyle: { color: COLORS.price } },
        { name: "GDAM price (charging)", type: "line", yAxisIndex: 1, symbol: "none", data: r(c.buyPrice), lineStyle: { color: COLORS.market, width: 1, type: "dashed" }, itemStyle: { color: COLORS.market } },
      ],
    };
  }, [blocks, meter]);
  if (!blocks) return null;
  return <LiveChart option={option} height={340} />;
}

/** The 15-minute dispatch's totals by Contract Year. */
function Dispatch15Table({ out }) {
  const gwh = (v) => nf(v / 1000, 2);
  return (
    <div className="cfd-statements" data-testid="cfd-d15-table">
      <table>
        <thead>
          <tr><th>Contract Year</th><th>Blocks</th><th>Peak blocks</th><th>At {FULL_PCT}% or more of the supply due</th><th>Below {FULL_PCT}%</th><th>Supplied GWh</th><th>Charged own RE GWh</th><th>Green market GWh</th><th>Sold in the market GWh</th><th>Curtailed GWh</th><th>Highest charging MW</th><th>Over the rating</th><th>State of charge</th></tr>
        </thead>
        <tbody>
          {out.years.map((y) => (
            <tr key={y.cy} className={y.shortBlocks ? "bad" : ""}>
              <td>CY {y.cy} <small>{fmtDate(y.start)} · {y.days} days</small></td>
              <td>{nf(y.blocks)}</td><td>{nf(y.peakBlocks)}</td><td>{pf(y.peakFullShare, 1)}</td><td>{nf(y.shortBlocks)}</td>
              <td>{gwh(y.deliveredMwh)}</td><td>{gwh(y.chargeOwnMwh)}</td><td>{gwh(y.chargeMarketMwh)}</td><td>{gwh(y.soldMwh)}</td><td>{gwh(y.curtailedMwh)}</td>
              <td>{nf(y.maxChargeMw, 1)}</td><td>{nf(y.overPower)}</td><td>{nf(y.minSoc, 0)}–{nf(y.maxSoc, 0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayChart({ day, ctx }) {
  const option = useMemo(() => {
    if (!day) return null;
    const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
    const meter = ctx.meter;
    const battery = peakOutput(day, ctx); // the battery's output in each of the buyer's hours, at the bus
    const out = Array.from({ length: 24 }, (_, h) => (day.chosen.includes(h) ? (day.windDirect[h] || 0) + battery[h] * meter : 0)); // at the meter
    // own RE neither charged, supplied directly nor sold in the hour: curtailed (all of the day's
    // surplus between 06:00 and 18:00 when the bid has no connectivity in the solar hours)
    const lost = Array.from({ length: 24 }, (_, h) => Math.max(0, day.solar[h] + day.wind[h] - (day.own[h] || 0) - (day.windDirect[h] || 0) / meter - ((day.sale[h] || 0) - (day.extraOut?.[h] || 0))));
    return {
      animation: false,
      grid: { left: 56, right: 56, top: 34, bottom: 40 },
      legend: { top: 0, right: 0 },
      tooltip: { trigger: "axis", valueFormatter: (v) => (typeof v === "number" ? nf(v, 1) : v) },
      xAxis: { type: "category", data: labels, axisLabel: { interval: 2 } },
      yAxis: [{ type: "value", name: "MW" }, { type: "value", name: "₹/kWh", min: 0, splitLine: { show: false } }],
      series: [
        { name: "Solar + wind output", type: "line", areaStyle: { opacity: 0.18, color: COLORS.own }, lineStyle: { width: 1, color: COLORS.own }, symbol: "none", itemStyle: { color: COLORS.own }, data: day.solar.map((v, h) => Number((v + day.wind[h]).toFixed(1))),
          markArea: { silent: true, itemStyle: { color: "rgba(212,255,63,0.07)" }, data: [[{ xAxis: labels[18] }, { xAxis: labels[23] }]] } },
        { name: "Charging from own RE", type: "bar", stack: "c", data: day.own.map((v) => -Number(v.toFixed(1))), itemStyle: { color: COLORS.own } },
        { name: "Charging from green market", type: "bar", stack: "c", data: day.market.map((v) => -Number(v.toFixed(1))), itemStyle: { color: COLORS.market } },
        { name: "Supply under the PPA", type: "bar", data: out.map((v) => Number(v.toFixed(1))), itemStyle: { color: COLORS.ess } },
        { name: "Sold in the market", type: "bar", data: day.sale.map((v) => Number(v.toFixed(1))), itemStyle: { color: COLORS.sale } },
        { name: "Curtailed", type: "bar", data: lost.map((v) => Number(v.toFixed(1))), itemStyle: { color: COLORS.lost } },
        { name: "Exchange price", type: "line", yAxisIndex: 1, symbol: "none", data: day.price.map((v) => Number(v.toFixed(2))), lineStyle: { color: COLORS.price, width: 1.4 }, itemStyle: { color: COLORS.price } },
        { name: "GDAM price (charging)", type: "line", yAxisIndex: 1, symbol: "none", data: day.buyPrice.map((v) => Number(v.toFixed(2))), lineStyle: { color: COLORS.market, width: 1, type: "dashed" }, itemStyle: { color: COLORS.market } },
      ],
    };
  }, [day, ctx]);
  if (!day) return null;
  return <LiveChart option={option} height={320} />;
}

/**
 * The first full Contract Year's energy (April to March; the first Contract Year runs only from
 * the SCSD to 31 March): where the supplied energy came from and what the own RE did.
 */
function EnergyMix({ model }) {
  const dayOn = Boolean(model.inputs.dayInjection); // connectivity in the solar hours too
  const y1 = model.sim.years.find((y) => y.days >= 365) || model.sim.years[0];
  const own = y1.ownSuppliedMwh;
  const market = y1.shareMarket * y1.deliveredMwh;
  const penalised = y1.months.filter((w) => w.beyondMwh > 1e-6).length;
  const gen = y1.solarMwh + y1.windMwh;
  const gwh = (v) => `${nf(v / 1000, 1)} GWh`;
  return (
    <div className="rtc-grid rtc-grid-4" data-testid="cfd-energy-mix">
      <Stat label={`Supplied, CY ${y1.index}`} value={gwh(y1.deliveredMwh)} detail={`${pf(y1.supplyShare, 1)} of ${gwh(y1.requiredMwh)} required`} />
      <Stat label="From own RE" value={gwh(own)} detail={`${pf(y1.shareOwn, 1)} of the supply: ${gwh(y1.windDirectMwh)} wind in the buyer's hours, the rest through the battery`} />
      <Stat label="From the green market" value={gwh(market)} detail={`${pf(y1.shareMarket, 1)} of the supply (limit ${pf(TENDER.marketShare, 0)}) · ₹${nf(y1.marketCostCr, 1)} cr of charging power`} />
      <Stat label="Short of the daily supply" value={gwh(y1.shortMwh)} detail={y1.shortDays ? `${nf(y1.shortDays)} days short; ${penalised} billing month${penalised === 1 ? "" : "s"} beyond the ${pf(TENDER.shortfallTolerance, 0)} allowed` : "no day short"} tone={y1.shortDays ? "bad" : undefined} />
      <Stat label="Own generation" value={gwh(gen)} detail={`${gwh(y1.solarMwh)} solar, ${gwh(y1.windMwh)} wind`} />
      <Stat label="Charged from own RE" value={gwh(y1.chargeOwnMwh)} detail={`${pf(gen > 0 ? y1.chargeOwnMwh / gen : 0, 1)} of the generation`} />
      <Stat label="Sold in the market" value={gwh(y1.merchantMwh)} detail={`₹${nf(y1.merchantRevCr, 1)} cr at exchange prices: surplus RE${dayOn ? "" : " outside 06:00 to 18:00 only (no connectivity in the solar hours)"}${y1.extraSoldMwh > 0 ? ` and ${gwh(y1.extraSoldMwh)} from the extra battery` : ""}`} />
      <Stat label="Curtailed" value={gwh(y1.curtailedMwh)} detail={gen > 0 ? `${pf(y1.curtailedMwh / gen, 1)} of the generation${dayOn ? "" : ": nothing is injected from 06:00 to 18:00 without connectivity in the solar hours"}` : ""} tone={gen > 0 && y1.curtailedMwh / gen > 0.3 ? "bad" : undefined} />
    </div>
  );
}

/**
 * Step 07, the Projects team: the sizing of this tender, which is the own RE that gives the lowest
 * tariff with every day's 4 MWh per MW met within the 5% limit on bought power; then the plant,
 * the tender's conditions on it, a year's energy and the day-by-day operation over the term.
 */
export default function SizeStep({ state, setState, model, prices, optimise, optimising, stopOptimise, goto }) {
  const [k, setK] = useState(200);
  const [blockView, setBlockView] = useState(false);
  const [d15, setD15] = useState(null); // the 15-minute dispatch's totals, computed on request
  const [d15Busy, setD15Busy] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const missing = missingInputs(state);
  const sim = model?.sim;
  const totalDays = sim ? Math.round((sim.dates.end - sim.dates.scd) / 86400000) : 0;
  const day = useMemo(() => (model ? simulate(model.inputs, model.book, model.prof, { record: [Math.min(k, totalDays - 1)] }).days[Math.min(k, totalDays - 1)] : null), [model, k, totalDays]);
  const ctx = useMemo(() => (model ? blockContext(model.inputs, model.sim) : null), [model]);
  const blocks = useMemo(() => (ctx && day && blockView ? dayBlocks(day, ctx) : null), [ctx, day, blockView]);
  useEffect(() => { setD15(null); }, [model]); // a new plant: the totals are computed again on request
  const runD15 = () => {
    setD15Busy(true);
    setTimeout(() => { // off the click, so the button shows it is working
      try { setD15(dispatch15(model)); } finally { setD15Busy(false); }
    }, 30);
  };
  const download = async (format) => {
    setDownloading(format);
    setDownloadError("");
    try {
      await downloadFile("/api/fdrex/dispatch15", { state, format }, format === "xlsx" ? `fdrex-dispatch-15min-${TENDER.termYears}-years.xlsx` : `fdrex-dispatch-15min-${TENDER.termYears}-years.zip`);
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setDownloading("");
    }
  };
  if (!model) {
    return (
      <Section index="6" title="Size" note="The own RE sized for the lowest tariff">
        <p className="rtc-note" data-testid="cfd-size-waiting">{missing.length ? `${missing.length} input${missing.length > 1 ? "s are" : " is"} still needed before the plant can be sized: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}.` : "Loading the market prices…"}</p>
        <button type="button" className="secondary" onClick={() => goto(missing.some((m) => /capex|O&M|IRR|Debt|Interest|tenor|tax|Insurance|escalation|Pre-operative|fee|Discount|depreciation|guarantee|GST|Transmission/i.test(m)) ? "financeInputs" : "design")}>Go to the inputs <ArrowRight size={14} /></button>
      </Section>
    );
  }
  const i = model.inputs;
  const X = i.contractedMw;
  const ownCost = ownReCostRsPerKwh(i);
  const years = sim.years;
  const sp = model.sp;
  const checks = sizingChecks(model, state);
  const failed = checks.filter((c) => c.status === "failed").length;
  const a = rfsAmounts(i);
  const shortMwh = capShortfall(sim);
  const penalty = years.reduce((s, y) => s + (sp ? penaltyCr(y, sp) : 0), 0); // the monthly shortfall penalty over the term, ₹ cr
  const penaltyGwh = years.reduce((s, y) => s + penaltyMwh(y), 0) / 1000;
  const ICON = { met: CheckCircle2, failed: XCircle, info: TriangleAlert };
  return (
    <>
      <Section index="6" title="Plant" note="The own RE that gives the lowest tariff with every day's supply met; the battery that carries the buyer's four hours"
        actions={<button type="button" className="secondary" onClick={() => goto("finance")} data-testid="cfd-to-finance-model">Financial model <ArrowRight size={14} /></button>}>
        <OptimiseBar missing={missing} optimise={optimise} optimising={optimising} stopOptimise={stopOptimise} state={state} setState={setState} policy={state.inputs?.shortfallPolicy || "meet"} />
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-plant">
          <Stat label="Contracted" value={`${nf(X)} MW`} detail={`${nf(X * TENDER.mwhPerMwDay)} MWh a day in the ${TENDER.peakHours} hours the buyer chooses`} />
          <Stat label="Battery" value={`${nf(X * i.essMwPerMw)} MW / ${nf(X * (i.essMwhPerMw + (i.extraEssMwhPerMw || 0)))} MWh`} detail={`${nf(i.essMwhPerMw, 2)} MWh per MW for the buyer's ${TENDER.peakHours} hours${i.extraEssMwhPerMw ? ` + ${nf(i.extraEssMwhPerMw, 2)} for evening sale` : ""}; round trip ${pf(i.rte, 1)}`} />
          <Stat label="Own solar" value={`${nf(i.solarMw || 0)} MWac`} detail={`${nf((i.solarMw || 0) / X, 2)} × contracted; CUF ${pf(i.solarCuf, 1)}`} />
          <Stat label="Own wind" value={`${nf(i.windMw || 0)} MW`} detail={i.windMw ? `${nf(i.windMw / X, 2)} × contracted; CUF ${pf(i.windCuf, 1)}` : "none"} />
          <Stat label="Tariff to bid" value={sp ? `₹${nf(sp, 3)}/kWh` : "–"} detail={sp ? `quote ₹${nf(model.bid, 2)} (rounded up to the paisa), fixed for ${TENDER.termYears} years; equity IRR ${pf(i.targetEquityIrr, 1)}${model.finance ? ` · the full financial model, as on step 08 and in the workbook${model.screening?.sp ? `; fast screening ₹${nf(model.screening.sp, 3)}` : ""}` : ""}` : model.reason || ""} tone={sp ? undefined : "bad"} />
          <Stat label="Days short of the daily supply" value={nf(years.reduce((s, y) => s + y.shortDays, 0))} detail={shortMwh > 1e-3 * X ? `${nf(shortMwh, 0)} MWh over the term: ${shortfallCauses(model).text || "the 5% limit on bought power binds, or the battery has faded below the need"}` : "none"} tone={shortMwh > 1e-3 * X ? "bad" : undefined} />
          <Stat label="Monthly shortfall penalty" value={`₹${nf(penalty, 2)} cr`} detail={penalty > 0 ? `over the term: ${nf(TENDER.penaltyMultiple, 1)} × the tariff of ₹${nf(sp, 2)} on ${nf(penaltyGwh, 1)} GWh short beyond ${pf(TENDER.shortfallTolerance, 0)} of a billing month` : `no billing month below ${FULL_PCT}% of its requirement`} tone={penalty > 0 ? "bad" : undefined} />
          <Stat label="EMD and PBG" value={`₹${nf(a.emdCr, 2)} cr / ₹${nf(a.pbgCr, 2)} cr`} detail={`net worth ₹${nf(a.netWorthCr, 1)} cr`} />
        </div>
        {optimising && <p className="rtc-note"><Loader2 className="spin" size={12} /> The optimiser is trying own-RE sizes; the numbers above are the case as it stands.</p>}
      </Section>

      <Section index="6.1" title="Tender conditions" note={failed ? `${failed} not met` : "Every condition met on this plant"}>
        <div className="cfd-checks" data-testid="cfd-checks">
          {checks.map((c) => {
            const Icon = ICON[c.status];
            return (
              <div key={c.id} className={`cfd-check ${c.status}`} data-testid={`cfd-check-${c.id}`} data-status={c.status}>
                <Icon size={14} />
                <span><strong>{c.label}</strong><small>{c.detail}</small></span>
                <Cite id={c.cite} compact />
              </div>
            );
          })}
        </div>
      </Section>

      <Section index="6.2" title="A year's energy" note="Where the supplied energy came from in the first full Contract Year (April to March), and what the own RE did">
        <EnergyMix model={model} />
      </Section>

      <Section index="6.3" title="Operations over the term" note={`Day by day from the SCSD (${fmtDate(sim.dates.scd)}) to the end of the term (${fmtDate(sim.dates.end)}), with the IEX prices of the price year`}>
        <SourcesChart years={years} />
        <div className="cfd-table" data-testid="cfd-ops-table">
          <div className="cfd-row head"><span>Contract Year</span><span>Supplied</span><span>Own RE</span><span>Green market</span><span>Charging bought</span><span>Own RE at cost</span><span>Sold in the market</span><span>Curtailed</span><span>Months penalised</span></div>
          {years.map((y) => {
            const cap = TENDER.marketShare; // of the year's energy, counted on the energy discharged
            const marketOk = y.shareMarket <= cap + 0.005; // the same half point the tender check allows on a year with short days
            const gen = y.solarMwh + y.windMwh;
            const penalised = y.months.filter((w) => w.beyondMwh > 1e-6).length;
            return (
              <div key={y.index} className={`cfd-row ${y.shortDays ? "bad" : ""}`}>
                <span><strong>CY {y.index}</strong><small>{fmtDate(y.start)} · {y.days} days</small></span>
                <span>{pf(y.supplyShare, 1)}<small>{nf(y.deliveredMwh / 1000, 1)} GWh</small></span>
                <span>{pf(y.shareOwn, 1)}</span>
                <span className={marketOk ? "ok" : "bad"}>{marketOk ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {pf(y.shareMarket, 1)}<small>limit {pf(cap, 0)}</small></span>
                <span>₹{nf(y.marketCostCr, 2)} cr<small>paid to the market</small></span>
                <span data-testid={`cfd-own-cost-${y.index}`}>₹{nf(ownCost === null ? 0 : (y.chargeOwnMwh * ownCost) / 1e4, 2)} cr<small>total ₹{nf(y.marketCostCr + (ownCost === null ? 0 : (y.chargeOwnMwh * ownCost) / 1e4), 1)} cr</small></span>
                <span>{nf(y.merchantMwh / 1000, 1)} GWh<small>₹{nf(y.merchantRevCr, 1)} cr</small></span>
                <span>{nf(y.curtailedMwh / 1000, 1)} GWh<small>{gen > 0 ? `${pf(y.curtailedMwh / gen, 0)} of the generation` : ""}</small></span>
                <span>{penalised} of {y.months.length}{penalised && sp ? <small>₹{nf(penaltyCr(y, sp), 2)} cr of penalty</small> : null}{y.shortDays ? <small><TriangleAlert size={11} /> {y.shortDays} days short</small> : null}</span>
              </div>
            );
          })}
        </div>
        <p className="rtc-note">Limits: power bought from the green market or under a bilateral agreement, up to {pf(TENDER.marketShare, 0)} of a year's energy, counted on the energy discharged <Cite id="marketShare" />; a billing month's shortfall beyond {pf(TENDER.shortfallTolerance, 0)} is penalised at {nf(TENDER.penaltyMultiple, 1)} × the tariff <Cite id="tolerance" /> <Cite id="shortfall" />. {i.dayInjection
          ? <> With connectivity in the solar hours too, surplus RE is sold at exchange prices on days the supply is met; the tender asks only for non-solar-hour access <Cite id="connectivityApplied" />, so confirm the grant covers those hours.</>
          : <> The tender asks for connectivity with non-solar-hour access <Cite id="connectivityApplied" />: without more, nothing is injected from 06:00 to 18:00, the day's surplus solar is curtailed, and only what is spare outside those hours is sold.</>}
          {" "}SECI has the first right to buy excess energy at the tariff <Cite id="excess" />, which the model does not count on.
          {ownCost !== null && <> Own RE is not free: its charging is valued at what the plant costs you, ₹{nf(ownCost, 2)}/kWh (the RE capex annualised at the discount rate over its life, plus O&amp;M, over the energy it makes); that cost sits in the depreciation, interest and O&amp;M lines of the financial model, not in a bill for bought power.</>}
        </p>
      </Section>

      <Section index="6.4" title="A day of operation" note={`Pick any day of the term: the ${TENDER.peakHours} hours the buyer is taken to choose, the charging before them, the surplus sold or curtailed; by the hour or in 15-minute blocks`}>
        <div className="cfd-day-pick">
          <input type="range" min="0" max={Math.max(0, totalDays - 1)} value={Math.min(k, totalDays - 1)} onChange={(e) => setK(Number(e.target.value))} aria-label="Day of the term" data-testid="cfd-day" />
          {day && <span><strong>{fmtDate(day.date)}</strong> · supplied {nf(day.delivered, 0)} of {nf(day.required, 0)} MWh in the hours from {hoursText(day.chosen)}</span>}
          <div className="seg" role="group" aria-label="Resolution">
            <button type="button" className={blockView ? "" : "active"} onClick={() => setBlockView(false)} data-testid="cfd-day-hourly">Hourly</button>
            <button type="button" className={blockView ? "active" : ""} onClick={() => setBlockView(true)} data-testid="cfd-day-blocks">15-minute blocks</button>
          </div>
        </div>
        {blockView ? <BlockChart blocks={blocks} meter={sim.loss?.meter ?? 1} /> : <DayChart day={day} ctx={ctx} />}
        <p className="rtc-note">The Buying Entity names its {TENDER.peakHours} hours each day by 06:00, from the non-solar hours of the evening to the next morning <Cite id="fourHours" /> <Cite id="scheduleBy6" />. The model takes them to be the {TENDER.peakHours} dearest hours of {hh(TENDER.peakStart)} to {hh(TENDER.peakEnd)} in the {i.sellMarket} that day (the orange line): a buyer schedules where power is dearest. A choice in the morning hours needs the same stored energy.</p>
        {blockView && <p className="rtc-note">Each hour of the day's plan is split into four blocks that keep its energy: solar and wind along the hour's trend, own-RE charging following the generation, bought charging and the discharge even over the hour (the IEX prices are hourly). The dotted line is the battery's stored energy, block by block.</p>}
      </Section>

      <Section index="6.5" title={`15-minute dispatch, ${TENDER.termYears} years`} note={`Every day of the term in 96 blocks: ${nf(totalDays * BLOCKS_PER_DAY)} blocks, the scheduling resolution of the grid code`}>
        <p className="rtc-note">The same operation as above, block by block for the whole term: in every block the generation, the charging by source, the battery's discharge and stored energy, what is supplied under the PPA against the supply due, what is sold in the market or curtailed, the prices. The totals of every Contract Year equal the model's; what the blocks add is the shape within the hour (where the battery runs at full power, how the state of charge builds, how the solar ramps sit against the charging). The files carry one row per block: a ZIP with one CSV per Contract Year and the summaries, or one Excel workbook (About, Summary, Monthly, one sheet per Contract Year; a large file that takes a while to build).</p>
        <div className="cfd-d15-actions">
          <button type="button" className="secondary" onClick={runD15} disabled={d15Busy} data-testid="cfd-d15-run">{d15Busy ? <Loader2 size={12} className="spin" /> : <Clock3 size={12} />} {d15Busy ? "Dispatching every block…" : d15 ? "Compute again" : "Compute the 15-minute dispatch"}</button>
          <button type="button" className="primary" onClick={() => download("zip")} disabled={Boolean(downloading)} data-testid="cfd-d15-zip">{downloading === "zip" ? <Loader2 size={12} className="spin" /> : <FileArchive size={12} />} {downloading === "zip" ? "Building the ZIP…" : "Download 15-minute dispatch (ZIP of CSV, one per Contract Year)"}</button>
          <button type="button" className="primary" onClick={() => download("xlsx")} disabled={Boolean(downloading)} data-testid="cfd-d15-xlsx">{downloading === "xlsx" ? <Loader2 size={12} className="spin" /> : <FileSpreadsheet size={12} />} {downloading === "xlsx" ? "Building the workbook…" : `Download ${TENDER.termYears}-year dispatch workbook (Excel)`}</button>
          {downloadError && <span className="bad"><XCircle size={12} /> {downloadError}</span>}
        </div>
        {d15 && (
          <>
            <div className="rtc-grid rtc-grid-4" data-testid="cfd-d15-tiles">
              <Stat label="Blocks dispatched" value={nf(d15.blocks)} detail={`${nf(d15.years.reduce((a, y) => a + y.days, 0))} days in ${d15.years.length} Contract Years`} />
              <Stat label={`Peak blocks at ${FULL_PCT}% or more`} value={pf(d15.years.reduce((a, y) => a + y.peakBlocksFull, 0) / Math.max(1, d15.years.reduce((a, y) => a + y.peakBlocks, 0)), 1)} detail={`${nf(d15.years.reduce((a, y) => a + y.shortBlocks, 0))} of ${nf(d15.years.reduce((a, y) => a + y.peakBlocks, 0))} peak blocks below ${FULL_PCT}% of the supply due`} tone={d15.years.some((y) => y.shortBlocks) ? "bad" : "good"} />
              <Stat label="Highest charging" value={`${nf(Math.max(...d15.years.map((y) => y.maxChargeMw)), 1)} MW`} detail={`battery rated ${nf(d15.ctx.P)} MW; ${nf(d15.years.reduce((a, y) => a + y.overPower, 0))} blocks over it on steep ramps`} />
              <Stat label="State of charge" value={`${nf(Math.min(...d15.years.map((y) => y.minSoc)), 0)}–${nf(Math.max(...d15.years.map((y) => y.maxSoc)), 0)}%`} detail={`window ${pf(d15.ctx.socMin, 0)} to ${pf(d15.ctx.socMin + d15.ctx.window, 0)} of the nameplate`} />
            </div>
            <Dispatch15Table out={d15} />
          </>
        )}
      </Section>

      <BidReview state={state} model={model} prices={prices} goto={goto} />
    </>
  );
}
