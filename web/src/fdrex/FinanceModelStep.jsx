import React, { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Download, Info, Loader2, TriangleAlert } from "lucide-react";
import FinanceView from "../rtc/FinanceView";
import { LiveChart } from "../rtc/charts";
import { Section, Stat, nf, pf } from "../rtc/ui";
import { TraceButton, TraceProvider } from "../model/ModelExplorer";
import Cite from "./Cite.jsx";
import MarketPrices from "./MarketPrices.jsx";
import { TENDER } from "./tender.js";
import { cfdBessAug, exchangeValue, fmtDate, keyDates, patchCfdBess, psmDiscount, rfsAmounts } from "./model.js";
import { modelNotesOf, cfdLiveRequest, cfdModelExport, downloadCfdModel, downloadCfdModel15, quoteOf, quotedStrikeReturns, runCfdFinance } from "./finance.js";
import "../cfd/finance.css";

// The Financial model step of the SECI-FDRE-X tab (forked from the CfD-I tab's
// web/src/cfd/FinanceModelStep.jsx). Revenue here is the PPA tariff on the energy supplied in the
// buyer's four hours; there is no settlement against exchange prices, no CfD Pool and no Letter of
// Credit from the developer, so those sections are gone. In their place: the monthly shortfall
// penalty, the tariff received after the PSM discount, and what the same energy costs the buyer on
// the exchange (context for the auction, not a payment).

// this tender's lines the shared financial view adds after "Other fixed" in the year-by-year table
const EXTRA_LINES = [["Charging power (green market)", "charging", 1, -1], ["PSM discount and exchange fees", "pxFees", 1, -1]];
// the engine's finance keys that live among the bid's inputs (F.1 edits them there)
const FIN_TO_INPUT = { targetEquityIrr: "targetEquityIrr", debtFraction: "debtFraction", interestRate: "interestRate", tenorYears: "tenorYears", taxRate: "taxRate", omEscalation: "omEscalation", insurancePct: "insurancePct", discountRate: "discountRate", solarOmLakhPerMw: "solarOmLakhPerMw", windOmLakhPerMw: "windOmLakhPerMw", bessOmLakhPerMwh: "essOmLakhPerMwh", solarDegradation: "solarDegradation" };
const IGNORED_FIN = new Set(["years", "tariffEscalation", "surplusPrice", "shortfallPenalty", "windDegradation", "extraExportMw"]);

/** Revenue by stream and year: the PPA tariff on the energy supplied, the energy sold in the market, the monthly penalty; the operating cost as a line. */
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
        { name: "PPA revenue (tariff × energy supplied)", type: "bar", stack: "rev", data: rows.map((r) => r1(r.energyRevenue)), itemStyle: { color: "#a98bff" } },
        { name: "Sold in the market", type: "bar", stack: "rev", data: rows.map((r, k) => r1(ops[k]?.merchantRevenueCr ?? r.surplusRevenue)), itemStyle: { color: "#f2b84b" } },
        { name: "Monthly shortfall penalty", type: "bar", stack: "rev", data: rows.map((r) => r1(-r.penalty)), itemStyle: { color: "#ff6b5f" } },
        { name: "Operating cost", type: "line", data: rows.map((r) => r1(r.opex)), symbol: "none", lineStyle: { color: "#f4f4f1", type: "dashed", width: 1 }, itemStyle: { color: "#f4f4f1" } },
      ],
    };
  }, [finance]);
  return <LiveChart option={option} height={300} />;
}

/**
 * The exchange beside the tariff, by Contract Year: the average exchange price of the hours
 * supplied (what the same energy costs the buyer there) against the fixed tariff, and the
 * difference on the year's energy (+ = the PPA costs the buyer less than the exchange would).
 */
function ExchangeChart({ exch, tariff, market }) {
  const option = useMemo(() => ({
    animation: false,
    grid: { left: 64, right: 56, top: 34, bottom: 40 },
    legend: { top: 0, right: 0 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: exch.map((p) => `CY ${p.cy}`) },
    yAxis: [{ type: "value", name: "₹ cr" }, { type: "value", name: "₹/kWh", min: 0, splitLine: { show: false } }],
    series: [
      { name: "Exchange value less the tariff paid (− = the PPA costs the buyer more)", type: "bar", data: exch.map((p) => Number(p.netCr.toFixed(2))), itemStyle: { color: (q) => (q.value < 0 ? "#ff8a5f" : "#7ddc9a") } },
      { name: `Average ${market} price in the buyer's ${TENDER.peakHours} hours`, type: "line", yAxisIndex: 1, symbol: "none", data: exch.map((p) => Number(p.mcpAvg.toFixed(2))), lineStyle: { color: "#3fa7d6" }, itemStyle: { color: "#3fa7d6" } },
      { name: "Your tariff", type: "line", yAxisIndex: 1, symbol: "none", data: exch.map(() => Number(tariff.toFixed(2))), lineStyle: { color: "#a98bff", type: "dashed" }, itemStyle: { color: "#a98bff" } },
    ],
  }), [exch, tariff, market]);
  return <LiveChart option={option} height={280} />;
}

/** The tariff the bidder will quote, against the solved one: what it earns, with a warning below the target. */
function QuoteBox({ state, model, finance, quote, onChange }) {
  const q = useMemo(() => quotedStrikeReturns(state, model, finance, quote), [state, model, finance, quote]);
  const irrText = (v) => (Number.isFinite(v) ? pf(v, 2) : "none");
  return (
    <div className={`quote-check ${q?.status || ""}`} data-testid="cfd-quote">
      <div className="rtc-grid rtc-grid-4">
        <label className="rtc-field" data-voice="quoteStrikePrice">
          <div className="rtc-field-top"><span>Tariff you will quote</span><em>₹/kWh</em></div>
          <input type="number" step={0.01} min={0} value={quote ?? ""} data-testid="cfd-quote-input" disabled={!onChange}
            onChange={(e) => onChange?.(e.target.value === "" ? null : Number(e.target.value))} />
          <small>{q ? `The model needs ₹${nf(q.targetTariff, 3)} for the target IRR; two decimals count (RfS 39.3)` : "Enter a tariff to see what it earns"}</small>
        </label>
        <Stat label="Equity IRR at this tariff" value={q ? irrText(q.equityIrr) : "–"} detail={q ? `target ${pf(q.targetEquityIrr, 2)}` : ""} tone={q && q.status !== "ok" ? "bad" : undefined} />
        <Stat label="Project IRR at this tariff" value={q ? irrText(q.projectIrr) : "–"} detail={q ? `${irrText(q.targetProjectIrr)} at the solved tariff` : ""} tone={q && q.status !== "ok" ? "bad" : undefined} />
        <Stat label="Difference" value={q ? `${q.gap >= 0 ? "+" : "−"}₹${nf(Math.abs(q.gap), 3)}` : "–"} detail={q ? `${q.gap >= 0 ? "above" : "below"} the solved tariff (${pf(Math.abs(q.gapPct), 1)})${Number.isFinite(q.minDscr) ? ` · min DSCR ${nf(q.minDscr, 2)}` : ""}` : ""} tone={q && q.status !== "ok" ? "bad" : undefined} />
      </div>
      {q && q.status !== "ok" && <div className="alert" data-testid="cfd-quote-warning"><TriangleAlert size={14} /> {q.message}{q.status === "loss" ? " The equity loses money at this tariff." : ""}</div>}
      {q && q.status === "ok" && <div className="quote-line ok" data-testid="cfd-quote-ok"><CheckCircle2 size={13} /> <span>{q.message}</span></div>}
    </div>
  );
}

/**
 * The Financial model step of the SECI-FDRE-X bid: the tariff solved by the shared financial
 * engine on the day-by-day operation, the quote check, the money at stake, the revenue stack,
 * the exchange price of the hours supplied beside the tariff, then the full model (F.1
 * assumptions to the year-by-year table) with the trace explorer and the workbook.
 * Props: state, setState, patch(section, values), set(key, value), lockProps(key), isLocked, goto,
 * prices, model (runModel), quoteTariff / onQuoteTariff (the tariff the bidder will quote),
 * traceRequest (from the agent), sizeStep (the id of the step that sizes the plant).
 */
export default function FinanceModelStep({ state, setState, setInput, patch, set, lockProps, isLocked, goto, prices, model, quoteTariff, onQuoteTariff, traceRequest = null, sizeStep = "size" }) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [ownQuote, setOwnQuote] = useState(null);
  const finance = useMemo(() => (model?.sim ? runCfdFinance(state, model) : null), [model, state.fin, state.costs, state.tariffLocked]); // eslint-disable-line react-hooks/exhaustive-deps
  // the shared view edits state.fin / state.costs; the bid's inputs it shows live in state.inputs
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
        <p className="rtc-note">Size the plant first: the financial model prices the own RE and the battery that meet every day's supply at the lowest tariff.</p>
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
  const n = finance.rows.length;
  // the monthly shortfall penalty over the term: 1.5 × the tariff on each billing month's energy short beyond 10%
  const penaltyTerm = finance.rows.reduce((a, r) => a + (r.blockPenalty || 0), 0);
  // the PSM discount (₹/kWh off every bill when the bid opts for the cover) and what it comes to over the term
  const psm = psmDiscount(i);
  const psmTerm = eng.ops.reduce((a, o) => a + (o.psmDiscountCr || 0), 0);
  // what the same energy costs the buyer on the exchange: the first full Contract Year stands for a year
  const exch = exchangeValue(sim, finance.tariff);
  const exYear = exch.find((p) => p.cy === 2) || exch[0];
  const gap = finance.tariff - exYear.mcpAvg; // ₹/kWh the tariff sits above (+) or below (−) the exchange price of those hours
  const market = i.sellMarket || "exchange";
  const soldTerm = finance.rows.reduce((a, r) => a + r.surplusRevenue, 0);
  // surplus RE that is not sold: all of the day's surplus when the bid has no connectivity in the solar hours
  const dayOn = Boolean(i.dayInjection);
  const curtailedTerm = finance.rows.reduce((a, r) => a + (r.curtailMu || 0), 0);
  const noDay = dayOn ? "" : " (nothing is injected from 06:00 to 18:00 without connectivity in the solar hours)";
  const quoteValue = quoteTariff !== undefined ? quoteTariff : ownQuote;
  const setQuote = onQuoteTariff || setOwnQuote;
  const viewState = { ...state, fin: eng.fin, costs: { ...(state.costs || {}), ...eng.costs }, dsm: undefined, sources: undefined };
  const getLive = () => cfdLiveRequest({ state, model, finance });

  return (
    <TraceProvider getLive={getLive} request={traceRequest}>
      <Section index="5" title="Bid tariff" note={finance.tariffLocked ? `Returns at the tariff you fixed (F.1)` : `The tariff that gives a ${pf(eng.fin.targetEquityIrr, 1)} equity IRR on the sized plant, from the full financial model`}
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
            <button type="button" disabled={saving} data-testid="cfd-download-15min" title="The same financial model with the 15-minute dispatch of every day of the term behind the contracted, supplied and sold energy (a larger file)"
              onClick={async () => {
                setSaving(true); setSaveError("");
                try { await downloadCfdModel15(cfdModelExport({ state, model, finance }), state); } catch (err) { setSaveError(err.message); } finally { setSaving(false); }
              }}>
              {saving ? <Loader2 className="spin" size={14} /> : <Download size={14} />} With the 15-minute dispatch (Excel)
            </button>
          </>
        )}>
        {saveError && <div className="alert"><TriangleAlert size={14} /> {saveError}</div>}
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-finance">
          <Stat label={finance.tariffLocked ? "Tariff (fixed)" : "Tariff to bid"} value={`₹${quote.toFixed(2)}/kWh`} detail={`₹${nf(finance.tariff, 4)} exact, rounded up; one tariff for ${TENDER.termYears} years · fast screening ₹${nf(model.screening?.sp ?? model.sp, 3)}`} trace={{ key: "tariff" }} />
          <Stat label="Equity IRR" value={pf(finance.equityIrr, 2)} detail={finance.tariffLocked ? `target ${pf(eng.fin.targetEquityIrr, 2)}` : "the target, by construction"} trace={{ key: "equityIrr" }} />
          <Stat label="Project IRR" value={pf(finance.projectIrr, 2)} detail="post-tax, unlevered" trace={{ key: "projectIrr" }} />
          <Stat label="Minimum DSCR" value={nf(finance.minDscr, 2)} detail={`average ${nf(finance.avgDscr, 2)}`} tone={finance.minDscr !== null && finance.minDscr < (state.fin?.lenderMinDscr ?? 1.1) ? "bad" : undefined} trace={{ key: "minDscr" }} />
          <Stat label="Project cost" value={`₹${nf(finance.capex.total, 0)} cr`} detail={`₹${nf(finance.capex.total / X, 2)} cr per contracted MW · LCOE ₹${nf(finance.lcoe, 3)}/kWh at ${pf(eng.fin.discountRate, 1)}`} trace={{ key: "capexTotal" }} />
          <Stat label="Year-1 supply" value={`${nf(y1.deliveredMu, 1)} MU`} detail={`${pf(y1.dfr, 1)} of ${TENDER.mwhPerMwDay} MWh/MW a day`} trace={{ line: "delivered", year: 1 }} />
          <Stat label="Year-1 operating cost" value={`₹${nf(y1.opex, 1)} cr`} detail={`charging power ₹${nf(y1.charging, 1)} cr · O&M ₹${nf(y1.om, 1)} cr`} trace={{ line: "opex", year: 1 }} />
          {psm > 0
            ? <Stat label="Tariff received after the PSM discount" value={`₹${(quote - psm).toFixed(2)}/kWh`} detail={`₹${nf(psm, 2)}/kWh off every bill for cover under SECI's Payment Security Mechanism: ₹${nf(psmTerm, 1)} cr over the term, inside the tariff solved`} trace={{ line: "pxFeesCr", year: 1 }} />
            : <Stat label="Payment Security Mechanism" value="not taken" detail={`the full tariff is received; taking the cover costs ₹${nf(TENDER.psmChargeRsPerKwh, 2)}/kWh on every bill for the whole term`} />}
          <Stat label={`${market} price of the hours supplied`} value={`₹${nf(exYear.mcpAvg, 2)}/kWh`} detail={`what the same energy costs the buyer on the exchange (CY ${exYear.cy}); your tariff is ₹${nf(Math.abs(gap), 2)} ${gap >= 0 ? "above" : "below"} it`} />
          <Stat label="Monthly shortfall penalty" value={`₹${nf(penaltyTerm, 2)} cr`} detail={penaltyTerm > 0 ? `over the term: ${nf(TENDER.penaltyMultiple, 1)} × this tariff on the energy short beyond ${pf(TENDER.shortfallTolerance, 0)} of a billing month` : `none: every billing month within ${pf(TENDER.shortfallTolerance, 0)} of its requirement`} tone={penaltyTerm > 0 ? "bad" : undefined} trace={{ line: "blockPenCr", year: 1 }} />
          <Stat label="Charging power over the term" value={`₹${nf(finance.totals.charging, 0)} cr`} detail={i.useMarket ? `bought in the green market, within ${pf(TENDER.marketShare, 0)} of a year's energy` : "no bought power"} trace={{ line: "chargingCr", year: 1 }} />
          <Stat label="Equity payback" value={finance.payback ? `year ${finance.payback}` : "beyond the term"} trace={{ key: "payback" }} />
        </div>
        <p className="rtc-note">{modelNotesOf(i)[0]} {modelNotesOf(i)[2]}</p>
      </Section>

      <Section index="5.0" title="Your quote" note="The tariff you will quote, against the tariff your target equity IRR needs">
        <QuoteBox state={state} model={model} finance={finance} quote={quoteValue} onChange={setQuote} />
      </Section>

      <Section index="5.1" title="Money at stake" note="Capex by component and what the RfS asks for; the guarantees on the installed capacities">
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-money">
          <Stat label="Battery capex" value={`₹${nf(eng.sizes.bessMwh * eng.costs.bessCrPerMwh, 0)} cr`} detail={`${nf(eng.sizes.bessMw, 0)} MW / ${nf(eng.sizes.bessMwh, 0)} MWh`} />
          <Stat label="Own RE capex" value={`₹${nf(eng.sizes.solarMw * eng.costs.solarCrPerMw + eng.sizes.windMw * eng.costs.windCrPerMw, 0)} cr`} detail={`solar ${nf(eng.sizes.solarMw, 0)} MWac${eng.sizes.windMw ? `, wind ${nf(eng.sizes.windMw, 0)} MW` : ""}; the whole Project by the SCSD, ${fmtDate(sim.dates.scd)}`} />
          <Stat label="Line and SECI's charges" value={`₹${nf(eng.costs.evacuationCr + eng.costs.otherCapexCr, 1)} cr`} detail={`line ₹${nf(eng.costs.evacuationCr, 1)} cr · RfS cost, bid processing fee and Success Charges with GST, and the guarantees' cost ₹${nf(eng.costs.otherCapexCr, 2)} cr`} />
          <Stat label="Bid security (EMD)" value={`₹${nf(rfs.emdCr, 2)} cr`} detail={`bank guarantee, Payment on Order Instrument or surety bond with the bid, valid ${TENDER.emdValidityMonths} months from the bid deadline (RfS 16)`} />
          <Stat label="Performance guarantee (PBG)" value={`₹${nf(rfs.pbgCr, 2)} cr`} detail={`within ${TENDER.docsDueDays} days of SECI's intimation to sign the PPA; valid to ${TENDER.pbgAfterScdMonths} months after the SCSD (RfS 17.1, 20.4)`} />
          <Stat label="Net worth required" value={`₹${nf(rfs.netWorthCr, 1)} cr`} detail={`turnover ₹${nf(rfs.turnoverCr, 1)} cr, or PBDIT ₹${nf(rfs.pbditCr, 1)} cr, or a line of credit ₹${nf(rfs.lineOfCreditCr, 1)} cr (RfS 36)`} />
          <Stat label="Equity" value={`₹${nf(finance.equity, 0)} cr`} detail={`debt ₹${nf(finance.debt, 0)} cr${finance.capex.idc > 0 ? ` incl. IDC ₹${nf(finance.capex.idc, 1)} cr` : ""}`} trace={{ key: "equity" }} />
          <Stat label="Success Charges" value={`₹${nf(rfs.cacCr, 2)} cr`} detail={`₹${nf(TENDER.cacLakhPerMw)} lakh per MW of Installed Capacity (the battery in MWh) + GST: half within 30 days of the LoA, the rest with the PBG (RfS 18.1). The model counts ${nf(rfs.installedMw)} MW, own RE and the battery's power; the RfS names the storage by its MWh, so confirm the basis with SECI`} />
        </div>
      </Section>

      <Section index="5.2" title="Revenue stack" note="The PPA tariff on the energy supplied, the energy sold in the market (the day's surplus only with connectivity in the solar hours) and the monthly penalty, year by year">
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-revenue">
          <Stat label="PPA revenue, year 1" value={`₹${nf(y1.energyRevenue, 1)} cr`} detail={`${nf(y1.deliveredMu, 1)} MU supplied at the tariff of ₹${nf(finance.tariff, 3)}/kWh${psm > 0 ? `; the PSM discount of ₹${nf(eng.ops[0]?.psmDiscountCr || 0, 2)} cr comes off the bill (a cost line in the model)` : ""}`} trace={{ line: "ppaRev", year: 1 }} />
          <Stat label="Sold in the market, year 1" value={`₹${nf(y1.surplusRevenue, 1)} cr`} detail={`${y1.excessMu > 0 ? `${nf(y1.excessMu, 1)} MU of surplus RE${i.extraEssMwhPerMw > 0 ? " and the extra battery's energy" : ""} at exchange prices` : "nothing sold"}; ${nf(y1.curtailMu, 1)} MU curtailed${noDay}`} tone={!dayOn && y1.curtailMu > y1.excessMu ? "bad" : undefined} trace={{ line: "mktRev", year: 1 }} />
          <Stat label={`Sold in the market, ${n} years`} value={`₹${nf(soldTerm, 0)} cr`} detail={`${pf(soldTerm / Math.max(1e-9, finance.totals.revenue), 1)} of all revenue; ${nf(curtailedTerm, 0)} MU curtailed over the same years`} />
          <Stat label={`Total revenue, ${n} years`} value={`₹${nf(finance.totals.revenue, 0)} cr`} detail={`after ₹${nf(finance.totals.penalty, 1)} cr of monthly penalty`} trace={{ key: "revenueTotal" }} />
        </div>
        <RevenueStack finance={finance} />
      </Section>

      <Section index="5.3" title="The exchange beside your tariff" note="What the same energy costs the buyer on the exchange: context for the auction; it does not change what you are paid">
        <div className="bid-mode" data-testid="cfd-pool">
          <Info size={14} />
          <span>
            In the {TENDER.peakHours} hours the buyer is taken to choose, the {market} averages <strong>₹{nf(exYear.mcpAvg, 2)}/kWh</strong> in Contract Year {exYear.cy} (the IEX price year, moved along your price path).
            Your tariff of ₹{nf(finance.tariff, 3)}/kWh is ₹{nf(Math.abs(gap), 2)}/kWh {gap >= 0 ? "above" : "below"} that: on a year's supply the PPA costs the buyer ₹{nf(Math.abs(exYear.netCr), 1)} crore {exYear.netCr < 0 ? "more" : "less"} than the exchange would, before SECI's trading margin of ₹{nf(TENDER.tradingMarginRsPerKwh, 2)}/kWh, which the buyer also pays.
            {" "}You are paid the tariff on every kWh supplied in the buyer's hours, fixed for {TENDER.termYears} years <Cite id="tariffFixed" />; nothing is settled against exchange prices. The exchange price matters to you only for the surplus RE {dayOn ? "you sell" : "(sold only outside 06:00 to 18:00 here: without connectivity in the solar hours the day's surplus is curtailed)"} and the extra battery's sale, and for the years after the term.
          </span>
        </div>
        <ExchangeChart exch={exch} tariff={finance.tariff} market={market} />
        <p className="rtc-note">{modelNotesOf(i)[3]} {modelNotesOf(i)[4]}</p>
      </Section>

      <div className="story-divider"><span>Financial model · {finance.rows.length} years</span></div>
      <FinanceView state={viewState} patch={viewPatch} set={setFn} lockProps={locks} finance={finance} sizes={eng.sizes} extraLines={EXTRA_LINES}
        codDefault={i.effectiveDate ? keyDates(i.effectiveDate).scd : null} bessAug={cfdBessAug(state)} augYears={TENDER.termYears} patchBess={(values) => setAll((s) => patchCfdBess(s, values))}
        modelArgs={{ ctx: null, sizes: eng.sizes, args: { costs: eng.costs, fin: eng.fin, bess: eng.bess, dfrTarget: 0, tariffLocked: false, ops: eng.ops, solveBy: "npv" } }} />
      {setInput && <MarketPrices state={state} setInput={setInput} prices={prices} model={model} />}
    </TraceProvider>
  );
}
