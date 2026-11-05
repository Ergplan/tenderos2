import React, { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Download, Loader2, TriangleAlert } from "lucide-react";
import FinanceView from "../rtc/FinanceView";
import { LiveChart } from "../rtc/charts";
import { Section, Stat, nf, pf } from "../rtc/ui";
import { TraceButton, TraceProvider } from "../model/ModelExplorer";
import Cite from "./Cite.jsx";
import { TENDER } from "./terms.js";
import { fmtDate, lcCr, poolFlows, rfsAmounts } from "./model.js";
import { MODEL_NOTES, cfdLiveRequest, cfdModelExport, downloadCfdModel, quoteOf, quotedStrikeReturns, runCfdFinance } from "./finance.js";
import "./finance.css";

// the CfD lines the shared financial view adds after "Other fixed" in the year-by-year table
const EXTRA_LINES = [["Charging power (green market, group RE)", "charging", 1, -1], ["Exchange fees", "pxFees", 1, -1], ["Letter of Credit to SECI", "lcCost", 1, -1]];
// the engine's finance keys that live among the CfD inputs (F.1 edits them there)
const FIN_TO_INPUT = { targetEquityIrr: "targetEquityIrr", debtFraction: "debtFraction", interestRate: "interestRate", tenorYears: "tenorYears", taxRate: "taxRate", omEscalation: "omEscalation", insurancePct: "insurancePct", discountRate: "discountRate", solarOmLakhPerMw: "solarOmLakhPerMw", windOmLakhPerMw: "windOmLakhPerMw", bessOmLakhPerMwh: "essOmLakhPerMwh", solarDegradation: "solarDegradation" };
const IGNORED_FIN = new Set(["years", "tariffEscalation", "surplusPrice", "shortfallPenalty", "windDegradation", "extraExportMw"]);

/** Revenue by stream and year: the CfD revenue, the surplus RE sold, the RECs, the penalty; the operating cost as a line. */
function RevenueStack({ finance }) {
  const option = useMemo(() => {
    const rows = finance.rows;
    const ops = finance.engine?.ops || [];
    const r1 = (v) => Number((v || 0).toFixed(2));
    return {
      animation: false,
      grid: { left: 64, right: 16, top: 36, bottom: 40 },
      legend: { top: 0, right: 0 },
      tooltip: { trigger: "axis", valueFormatter: (v) => `₹${nf(v, 2)} cr` },
      xAxis: { type: "category", data: rows.map((r) => `Y${r.year}`) },
      yAxis: { type: "value", name: "₹ cr" },
      series: [
        { name: "CfD revenue (strike price × supply)", type: "bar", stack: "rev", data: rows.map((r) => r1(r.energyRevenue)), itemStyle: { color: "#a98bff" } },
        { name: "Surplus RE sold", type: "bar", stack: "rev", data: rows.map((r, k) => r1(ops[k]?.merchantRevenueCr ?? r.surplusRevenue)), itemStyle: { color: "#f2b84b" } },
        { name: "RECs (your 50%)", type: "bar", stack: "rev", data: rows.map((r, k) => r1(ops[k]?.recRevenueCr ?? 0)), itemStyle: { color: "#7ddc9a" } },
        { name: "Weekly shortfall penalty", type: "bar", stack: "rev", data: rows.map((r) => r1(-r.penalty)), itemStyle: { color: "#ff6b5f" } },
        { name: "Operating cost", type: "line", data: rows.map((r) => r1(r.opex)), symbol: "none", lineStyle: { color: "#f4f4f1", type: "dashed", width: 1 }, itemStyle: { color: "#f4f4f1" } },
      ],
    };
  }, [finance]);
  return <LiveChart option={option} height={300} />;
}

/** The project's net pay-in to the CfD Pool by Contract Year at the strike price (+ into the Pool). */
function PoolChart({ pool }) {
  const option = useMemo(() => ({
    animation: false,
    grid: { left: 64, right: 56, top: 34, bottom: 40 },
    legend: { top: 0, right: 0 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: pool.map((p) => `CY ${p.cy}`) },
    yAxis: [{ type: "value", name: "₹ cr" }, { type: "value", name: "₹/kWh", min: 0, splitLine: { show: false } }],
    series: [
      { name: "Net into the Pool (− = the Pool pays you)", type: "bar", data: pool.map((p) => Number(p.netCr.toFixed(2))), itemStyle: { color: (q) => (q.value < 0 ? "#ff8a5f" : "#7ddc9a") } },
      { name: "Average market price in your 2 hours", type: "line", yAxisIndex: 1, symbol: "none", data: pool.map((p) => Number(p.mcpAvg.toFixed(2))), lineStyle: { color: "#3fa7d6" }, itemStyle: { color: "#3fa7d6" } },
    ],
  }), [pool]);
  return <LiveChart option={option} height={280} />;
}

/** The strike price the bidder will quote, against the solved one: what it earns, with a warning below the target. */
function QuoteBox({ state, model, finance, quote, onChange }) {
  const q = useMemo(() => quotedStrikeReturns(state, model, finance, quote), [state, model, finance, quote]);
  const irrText = (v) => (Number.isFinite(v) ? pf(v, 2) : "none");
  return (
    <div className={`quote-check ${q?.status || ""}`} data-testid="cfd-quote">
      <div className="rtc-grid rtc-grid-4">
        <label className="rtc-field" data-voice="quoteStrikePrice">
          <div className="rtc-field-top"><span>Strike price you will quote</span><em>₹/kWh</em></div>
          <input type="number" step={0.01} min={0} value={quote ?? ""} data-testid="cfd-quote-input" disabled={!onChange}
            onChange={(e) => onChange?.(e.target.value === "" ? null : Number(e.target.value))} />
          <small>{q ? `The model needs ₹${nf(q.targetTariff, 3)} for the target IRR; two decimals count (RfS 40.3)` : "Enter a price to see what it earns"}</small>
        </label>
        <Stat label="Equity IRR at this price" value={q ? irrText(q.equityIrr) : "–"} detail={q ? `target ${pf(q.targetEquityIrr, 2)}` : ""} tone={q && q.status !== "ok" ? "bad" : undefined} />
        <Stat label="Project IRR at this price" value={q ? irrText(q.projectIrr) : "–"} detail={q ? `${irrText(q.targetProjectIrr)} at the solved price` : ""} tone={q && q.status !== "ok" ? "bad" : undefined} />
        <Stat label="Difference" value={q ? `${q.gap >= 0 ? "+" : "−"}₹${nf(Math.abs(q.gap), 3)}` : "–"} detail={q ? `${q.gap >= 0 ? "above" : "below"} the solved price (${pf(Math.abs(q.gapPct), 1)})${Number.isFinite(q.minDscr) ? ` · min DSCR ${nf(q.minDscr, 2)}` : ""}` : ""} tone={q && q.status !== "ok" ? "bad" : undefined} />
      </div>
      {q && q.status !== "ok" && <div className="alert" data-testid="cfd-quote-warning"><TriangleAlert size={14} /> {q.message}{q.status === "loss" ? " The equity loses money at this price." : ""}</div>}
      {q && q.status === "ok" && <div className="quote-line ok" data-testid="cfd-quote-ok"><CheckCircle2 size={13} /> <span>{q.message}</span></div>}
    </div>
  );
}

/**
 * The Financial model step of the CfD bid: the strike price solved by the shared financial
 * engine on the day-by-day operation, the quote check, the money at stake, the revenue stack,
 * the CfD Pool, then the full model (F.1 assumptions to the year-by-year table) with the trace
 * explorer and the nine-sheet workbook.
 * Props: state, setState, patch(section, values), set(key, value), lockProps(key), isLocked, goto,
 * prices, model (runModel), quoteTariff / onQuoteTariff (the price the bidder will quote),
 * traceRequest (from the agent), sizeStep (the id of the step that sizes the plant).
 */
export default function FinanceModelStep({ state, setState, patch, set, lockProps, isLocked, goto, prices, model, quoteTariff, onQuoteTariff, traceRequest = null, sizeStep = "size" }) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [ownQuote, setOwnQuote] = useState(null);
  const finance = useMemo(() => (model?.sim ? runCfdFinance(state, model) : null), [model, state.fin, state.costs, state.tariffLocked]); // eslint-disable-line react-hooks/exhaustive-deps
  // the shared view edits state.fin / state.costs; the CfD inputs it shows live in state.inputs
  const setAll = setState || (() => {});
  const patchFn = patch || ((section, values) => setAll((s) => ({ ...s, [section]: { ...(s[section] || {}), ...values } })));
  const setFn = set || ((key, value) => setAll((s) => ({ ...s, [key]: value })));
  const locks = lockProps || ((key) => ({ locked: Boolean(state.locks?.[key]), onLock: () => setAll((s) => ({ ...s, locks: { ...(s.locks || {}), [key]: !s.locks?.[key] } })) }));
  const X = model?.inputs?.contractedMw || state.inputs.contractedMw || 1;
  const viewPatch = (section, values) => {
    if (section === "fin") {
      const inputs = {};
      const fin = {};
      for (const [k, v] of Object.entries(values)) {
        if (IGNORED_FIN.has(k)) continue;
        if (k === "sellSurplus") inputs.merchant = Boolean(v);
        else if (k === "otherFixedCr") inputs.otherFixedLakhPerMw = (v * 100) / X;
        else if (FIN_TO_INPUT[k]) inputs[FIN_TO_INPUT[k]] = v;
        else fin[k] = v;
      }
      setAll((s) => {
        const filled = { ...(s.filled || {}) };
        for (const k of Object.keys(inputs)) delete filled[k];
        return { ...s, inputs: { ...s.inputs, ...inputs }, fin: { ...(s.fin || {}), ...fin }, filled };
      });
      return;
    }
    if (section === "costs") {
      const inputs = {};
      const costs = {};
      for (const [k, v] of Object.entries(values)) {
        if (k === "preopPct") inputs.preopPct = v;
        else if (k === "evacuationCr") inputs.evacuationCrPerMw = v / X;
        else costs[k] = v;
      }
      setAll((s) => ({ ...s, inputs: { ...s.inputs, ...inputs }, costs: { ...(s.costs || {}), ...costs } }));
      return;
    }
    patchFn(section, values);
  };

  if (!model || !model.sim) {
    return (
      <Section index="5" title="Financial model">
        <p className="rtc-note">Size the plant first: the financial model prices the own RE and the battery that meet every day's supply at the lowest strike price.</p>
        <button type="button" className="primary" onClick={() => goto?.(sizeStep)} data-testid="cfd-go-size">Go to sizing <ArrowRight size={14} /></button>
      </Section>
    );
  }
  if (!finance) return null;
  const { inputs: i, sim } = model;
  const eng = finance.engine;
  const quote = quoteOf(finance.tariff);
  const y1 = finance.rows[0];
  const rfs = rfsAmounts(i);
  const lc = lcCr(X, finance.tariff);
  const pool = poolFlows(sim, finance.tariff);
  const poolYear = pool.find((p) => p.cy === 2) || pool[0];
  const scale = TENDER.totalMw / X;
  const drain = poolYear.netCr < 0 ? (TENDER.poolCr / (-poolYear.netCr * scale)) * 12 : null;
  const quoteValue = quoteTariff !== undefined ? quoteTariff : ownQuote;
  const setQuote = onQuoteTariff || setOwnQuote;
  const viewState = { ...state, fin: eng.fin, costs: { ...(state.costs || {}), ...eng.costs }, dsm: undefined, sources: undefined };
  const getLive = () => cfdLiveRequest({ state, model, finance });

  return (
    <TraceProvider getLive={getLive} request={traceRequest}>
      <Section index="5" title="Bid strike price" note={finance.tariffLocked ? `Returns at the strike price you fixed (F.1)` : `The strike price that gives a ${pf(eng.fin.targetEquityIrr, 1)} equity IRR on the sized plant, from the full financial model`}
        actions={(
          <>
            <TraceButton />
            <button type="button" className="primary" disabled={saving} data-testid="cfd-download"
              onClick={async () => {
                setSaving(true); setSaveError("");
                try { await downloadCfdModel(cfdModelExport({ state, model, finance })); } catch (err) { setSaveError(err.message); } finally { setSaving(false); }
              }}>
              {saving ? <Loader2 className="spin" size={14} /> : <Download size={14} />} Download financial model (Excel)
            </button>
          </>
        )}>
        {saveError && <div className="alert"><TriangleAlert size={14} /> {saveError}</div>}
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-finance">
          <Stat label={finance.tariffLocked ? "Strike price (fixed)" : "Strike price to bid"} value={`₹${quote.toFixed(2)}/kWh`} detail={`₹${nf(finance.tariff, 4)} exact, rounded up · fast screening ₹${nf(model.screening?.sp ?? model.sp, 3)}`} trace={{ key: "tariff" }} />
          <Stat label="Equity IRR" value={pf(finance.equityIrr, 2)} detail={finance.tariffLocked ? `target ${pf(eng.fin.targetEquityIrr, 2)}` : "the target, by construction"} trace={{ key: "equityIrr" }} />
          <Stat label="Project IRR" value={pf(finance.projectIrr, 2)} detail="post-tax, unlevered" trace={{ key: "projectIrr" }} />
          <Stat label="Minimum DSCR" value={nf(finance.minDscr, 2)} detail={`average ${nf(finance.avgDscr, 2)}${y1.dfr < 0.5 && (i.reCodMonths || 0) > 0 ? " · year 1 runs on bought power until the RE is in" : ""}`} tone={finance.minDscr !== null && finance.minDscr < 1.1 ? "bad" : undefined} trace={{ key: "minDscr" }} />
          <Stat label="Project cost" value={`₹${nf(finance.capex.total, 0)} cr`} detail={`₹${nf(finance.capex.total / X, 2)} cr per contracted MW · LCOE ₹${nf(finance.lcoe, 3)}/kWh at ${pf(eng.fin.discountRate, 1)}`} trace={{ key: "capexTotal" }} />
          <Stat label="Year-1 supply" value={`${nf(y1.deliveredMu, 1)} MU`} detail={`${pf(y1.dfr, 1)} of 2 MWh/MW a day`} trace={{ line: "delivered", year: 1 }} />
          <Stat label="Year-1 operating cost" value={`₹${nf(y1.opex, 1)} cr`} detail={`charging power ₹${nf(y1.charging, 1)} cr · O&M ₹${nf(y1.om, 1)} cr`} trace={{ line: "opex", year: 1 }} />
          <Stat label="Letter of Credit to SECI" value={`₹${nf(lc, 2)} cr`} detail={lc > 0 ? `2000 × MW × (₹10 − SP) × 30; costs ₹${nf(y1.lcCost, 2)} cr a year` : "nil: the strike price is above ₹10/kWh"} trace={{ line: "lcCostCr", year: 1 }} />
          <Stat label="CfD Pool, a year" value={`${poolYear.netCr < 0 ? "−" : "+"}₹${nf(Math.abs(poolYear.netCr), 1)} cr`} detail={poolYear.netCr < 0 ? "the Pool pays you (market below the strike price)" : "you pay into the Pool"} />
          <Stat label="Weekly shortfall penalty" value={`₹${nf(finance.totals.cfdPenalty, 2)} cr`} detail={finance.totals.cfdPenalty > 0 ? "over the term, at this strike price" : "none: supply within 10% every week"} trace={{ line: "cfdPenCr", year: 1 }} />
          <Stat label="Charging power over the term" value={`₹${nf(finance.totals.charging, 0)} cr`} detail={i.useMarket ? "green market and group RE" : "no bought power"} trace={{ line: "chargingCr", year: 1 }} />
          <Stat label="Equity payback" value={finance.payback ? `year ${finance.payback}` : "beyond the term"} trace={{ key: "payback" }} />
        </div>
        <p className="rtc-note">{MODEL_NOTES[0]} {MODEL_NOTES[2]}</p>
      </Section>

      <Section index="5.0" title="Your quote" note="The strike price you will quote, against the price your target equity IRR needs">
        <QuoteBox state={state} model={model} finance={finance} quote={quoteValue} onChange={setQuote} />
      </Section>

      <Section index="5.1" title="Money at stake" note="Capex by component and what the RfS asks for; the guarantees on the installed capacities">
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-money">
          <Stat label="Battery capex" value={`₹${nf(eng.sizes.bessMwh * eng.costs.bessCrPerMwh, 0)} cr`} detail={`${nf(eng.sizes.bessMw, 0)} MW / ${nf(eng.sizes.bessMwh, 0)} MWh`} />
          <Stat label="Own RE capex" value={`₹${nf(eng.sizes.solarMw * eng.costs.solarCrPerMw + eng.sizes.windMw * eng.costs.windCrPerMw, 0)} cr`} detail={`solar ${nf(eng.sizes.solarMw, 0)} MWac${eng.sizes.windMw ? `, wind ${nf(eng.sizes.windMw, 0)} MW` : ""}; online ${fmtDate(sim.dates.reCod)}`} />
          <Stat label="Line and SECI's charges" value={`₹${nf(eng.costs.evacuationCr + eng.costs.otherCapexCr, 1)} cr`} detail={`line ₹${nf(eng.costs.evacuationCr, 1)} cr · RfS cost, bid fee, CAC with GST and the guarantees' cost ₹${nf(eng.costs.otherCapexCr, 2)} cr`} />
          <Stat label="Bid security (EMD)" value={`₹${nf(rfs.emdCr, 2)} cr`} detail="bank guarantee or surety bond with the bid (RfS 17)" />
          <Stat label="Performance guarantee (PBG)" value={`₹${nf(rfs.pbgCr, 2)} cr`} detail="within 20 days of the LoA, to 6 months after the SCD (RfS 18.1)" />
          <Stat label="Net worth required" value={`₹${nf(rfs.netWorthCr, 1)} cr`} detail={`turnover ₹${nf(rfs.turnoverCr, 1)} cr, or PBDIT ₹${nf(rfs.pbditCr, 1)} cr, or a line of credit ₹${nf(rfs.lineOfCreditCr, 1)} cr (RfS 37)`} />
          <Stat label="Equity" value={`₹${nf(finance.equity, 0)} cr`} detail={`debt ₹${nf(finance.debt, 0)} cr${finance.capex.idc > 0 ? ` incl. IDC ₹${nf(finance.capex.idc, 1)} cr` : ""}`} trace={{ key: "equity" }} />
          <Stat label="Contract Administration Charges" value={`₹${nf(rfs.cacCr, 2)} cr`} detail="₹1 lakh per contracted MW + GST, within 20 days of the LoA (RfS 19.1)" />
        </div>
      </Section>

      <Section index="5.2" title="Revenue stack" note="CfD revenue, the surplus RE sold, your half of the RECs and the weekly penalty, year by year">
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-revenue">
          <Stat label="CfD revenue, year 1" value={`₹${nf(y1.energyRevenue, 1)} cr`} detail={`${nf(y1.deliveredMu, 1)} MU at ₹${nf(finance.tariff, 3)}/kWh`} trace={{ line: "ppaRev", year: 1 }} />
          <Stat label="Surplus RE and RECs, year 1" value={`₹${nf(y1.surplusRevenue, 1)} cr`} detail={y1.excessMu > 0 ? `${nf(y1.excessMu, 1)} MU sold in the market` : "nothing sold (own RE not yet online)"} trace={{ line: "mktRev", year: 1 }} />
          <Stat label={`Surplus RE and RECs, ${finance.rows.length} years`} value={`₹${nf(finance.rows.reduce((a, r) => a + r.surplusRevenue, 0), 0)} cr`} detail={`${pf(finance.rows.reduce((a, r) => a + r.surplusRevenue, 0) / Math.max(1e-9, finance.totals.revenue), 1)} of all revenue`} />
          <Stat label={`Total revenue, ${finance.rows.length} years`} value={`₹${nf(finance.totals.revenue, 0)} cr`} detail={`penalties ₹${nf(finance.totals.penalty, 1)} cr`} trace={{ key: "revenueTotal" }} />
        </div>
        <RevenueStack finance={finance} />
      </Section>

      <Section index="5.3" title="The CfD Pool at your strike price" note="Your payment security is the Pool itself; the market price only moves money between you and it">
        <div className={`bid-mode ${poolYear.netCr < 0 ? "rules" : ""}`} data-testid="cfd-pool">
          <TriangleAlert size={14} />
          <span>
            At ₹{quote.toFixed(2)}/kWh and 2025–26 prices (₹{nf(poolYear.mcpAvg, 2)}/kWh in your best 2 evening hours), your project {poolYear.netCr < 0 ? "draws" : "pays into"} the Pool <strong>₹{nf(Math.abs(poolYear.netCr), 1)} crore a year</strong>.
            {drain
              ? ` If all ${TENDER.totalMw} MW were awarded at this price, the ₹${TENDER.poolCr} crore Pool would last about ${nf(drain, 0)} months before payments to developers depend on new inflows; SECI has undertaken to replenish it.`
              : ` If all ${TENDER.totalMw} MW were awarded at this price, the Pool would grow by about ₹${nf(poolYear.netCr * scale, 0)} crore a year.`}
            {" "}SECI's obligation is limited to the settlement and the Pool is the payment security <Cite id="poolSecurity" /> <Cite id="seciLimited" />.
          </span>
        </div>
        <PoolChart pool={pool} />
      </Section>

      <div className="story-divider"><span>Financial model · {finance.rows.length} years</span></div>
      <FinanceView state={viewState} patch={viewPatch} set={setFn} lockProps={locks} finance={finance} sizes={eng.sizes} extraLines={EXTRA_LINES} />
    </TraceProvider>
  );
}
