import React, { useMemo } from "react";
import { Download } from "lucide-react";
import { LiveChart } from "./charts";
import { DATA_COLORS } from "../chartTheme";
import { Field, SelectBox, Section, Stat, SwitchBox, downloadText, nf, pf } from "./ui";
import { TraceButton, useTrace } from "../model/ModelExplorer";
import { DRAWDOWN_PROFILES, REPAYMENT_METHODS } from "./engine";
import ConstructionView from "./ConstructionView";
import DsmPanel from "../dsm/DsmPanel";
import { DSM_DEFAULTS } from "../dsm/dsm";

// the financial model's rows → the lines of the traceable model (web/lib/liveModel.js keys)
const TRACE_LINE = {
  demandMu: "demand", deliveredMu: "delivered", dfr: "dfr", excessMu: "excess", shortfallMu: "shortfall", tariff: "trf",
  energyRevenue: "ppaRev", surplusRevenue: "mktRev", revenue: "revenue", insurance: "insuranceCr", other: "otherCr", opex: "opex",
  ebitda: "ebitda", bookDep: "bookDep", interest: "interest", principal: "principal", pbt: "pbt", taxDep: "taxDep", tax: "tax", pat: "pat",
  dWc: "dWc", augCapex: "aug", cfads: "cfads", debtService: "debtService", fcfe: "fcfe", cumEquity: "cumEq", projectCf: "projCf",
  openingDebt: "openDebt", closingDebt: "closeDebt", dscr: "dscr", receivables: "recv",
  wcInterest: "wcInt", refiFee: "refiFeeCr", dDsra: "dDsra", dsraBalance: "dsra", omStock: "omStock", spares: "spares", wcBalance: "wcBal", dsm: "dsmCr", debtRate: "rateY",
};
// rows shown only when some year has them
const OPTIONAL_LINES = ["buyerRevenue", "dsm", "wcInterest", "refiFee", "dDsra", "dsraBalance", "omStock", "spares"];

// ---------------------------------------------------------------- 06 financial model

const FIN_LINES = [
  ["Operations", null],
  ["Demand (MU)", "demandMu", 1],
  ["Delivered (MU)", "deliveredMu", 1],
  ["DFR", "dfr", "pct"],
  ["Surplus sold (MU)", "excessMu", 1],
  ["Curtailed (MU)", "curtailMu", 1],
  ["Shortfall vs target (MU)", "shortfallMu", 1],
  ["Solar output factor", "solarFactor", "pct"],
  ["BESS capacity factor", "bessFactor", "pct"],
  ["Tariff (₹/kWh)", "tariff", 3],
  ["Profit & loss (₹ cr)", null],
  ["Energy revenue", "energyRevenue", 1],
  ["Surplus revenue", "surplusRevenue", 1],
  ["Excess sold to the buyer", "buyerRevenue", 1],
  ["Shortfall penalty", "penalty", 1, -1],
  ["Total revenue", "revenue", 1, 1, true],
  ["O&M", "om", 1, -1],
  ["Insurance", "insurance", 1, -1],
  ["Other fixed", "other", 1, -1],
  ["Deviation settlement charges (CERC DSM)", "dsm", 1, -1],
  ["EBITDA", "ebitda", 1, 1, true],
  ["Book depreciation", "bookDep", 1, -1],
  ["Interest", "interest", 1, -1],
  ["Interest on working capital", "wcInterest", 1, -1],
  ["Refinancing fee", "refiFee", 1, -1],
  ["Profit before tax", "pbt", 1, 1, true],
  ["Tax depreciation", "taxDep", 1],
  ["Tax", "tax", 1, -1],
  ["Profit after tax", "pat", 1, 1, true],
  ["Working capital (₹ cr)", null],
  ["Receivables", "receivables", 1],
  ["O&M in hand", "omStock", 1],
  ["Maintenance spares", "spares", 1],
  ["Working capital held", "wcBalance", 1, 1, true],
  ["Cash flow (₹ cr)", null],
  ["EBITDA", "ebitda", 1],
  ["Tax paid", "tax", 1, -1],
  ["Working capital change", "dWc", 1, -1],
  ["Interest on working capital", "wcInterest", 1, -1],
  ["BESS augmentation", "augCapex", 1, -1],
  ["CFADS", "cfads", 1, 1, true],
  ["Debt service", "debtService", 1, -1],
  ["Refinancing fee", "refiFee", 1, -1],
  ["Debt service reserve put aside (released)", "dDsra", 1, -1],
  ["Free cash to equity", "fcfe", 1, 1, true],
  ["Cumulative equity cash", "cumEquity", 1],
  ["Project cash flow (unlevered)", "projectCf", 1],
  ["Debt (₹ cr)", null],
  ["Opening balance", "openingDebt", 1],
  ["Interest rate", "debtRate", "pct"],
  ["Interest", "interest", 1],
  ["Principal", "principal", 1],
  ["Closing balance", "closingDebt", 1],
  ["Debt service", "debtService", 1],
  ["DSCR", "dscr", 2],
  ["Debt service reserve held", "dsraBalance", 1],
];

export default function FinanceView({ state, patch, set, lockProps, finance, sizes, extraLines = null, energyLines = null, actions = null }) {
  const { fin } = state;
  // extraLines: [label, key, fmt, sign] rows a caller adds after "Other fixed" (Tender to Bid: biomass fuel);
  // energyLines: rows added before "Delivered" (Round the clock: the 33 kV bus to the 220 kV meter);
  // actions: buttons beside Export CSV (Round the clock: the Excel workbook)
  const lines = useMemo(() => {
    // the rows a bid may not have (the Solar Hours excess to the buyer, DSM, working-capital
    // interest, refinancing, the reserve) only when some year has them
    const has = (key) => finance.rows.some((r) => Math.abs(r[key] || 0) > 1e-9);
    let out = FIN_LINES.filter((l) => !OPTIONAL_LINES.includes(l[1]) || has(l[1]));
    if (energyLines?.length) {
      const at = out.findIndex((l) => l[1] === "deliveredMu");
      out = [...out.slice(0, at), ...energyLines, ["Delivered to the customer at the meter (MU)", "deliveredMu", 1], ...out.slice(at + 1)];
    }
    if (extraLines?.length) {
      const at = out.findIndex((l) => l[1] === "other") + 1;
      out = [...out.slice(0, at), ...extraLines, ...out.slice(at)];
    }
    return out;
  }, [extraLines, energyLines, finance.rows]);
  const rows = finance.rows;
  const years = rows.map((r) => `Y${r.year}`);
  const trace = useTrace();
  const traceable = Boolean(trace?.available);
  const plOption = useMemo(() => ({
    animation: false,
    grid: { left: 60, right: 56, top: 36, bottom: 64 },
    legend: { top: 0, right: 0 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: years },
    yAxis: [{ type: "value", name: "₹ cr" }, { type: "value", name: "DSCR", splitLine: { show: false }, min: 0 }],
    dataZoom: [{ type: "inside" }, { type: "slider", bottom: 10, height: 18 }],
    series: [
      { name: "Revenue", type: "bar", data: rows.map((r) => Number(r.revenue.toFixed(1))), itemStyle: { color: "#3a3a3a" } },
      { name: "EBITDA", type: "bar", data: rows.map((r) => Number(r.ebitda.toFixed(1))), itemStyle: { color: DATA_COLORS.wind } },
      { name: "PAT", type: "bar", data: rows.map((r) => Number(r.pat.toFixed(1))), itemStyle: { color: DATA_COLORS.surplus } },
      { name: "Debt service", type: "line", data: rows.map((r) => Number(r.debtService.toFixed(1))), lineStyle: { color: DATA_COLORS.solar }, itemStyle: { color: DATA_COLORS.solar } },
      { name: "DSCR", type: "line", yAxisIndex: 1, data: rows.map((r) => (r.dscr === null ? null : Number(r.dscr.toFixed(2)))), lineStyle: { color: DATA_COLORS.demand, type: "dashed" }, itemStyle: { color: DATA_COLORS.demand } },
    ],
  }), [rows]);
  const cashOption = useMemo(() => ({
    animation: false,
    grid: { left: 60, right: 56, top: 36, bottom: 30 },
    legend: { top: 0, right: 0 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: ["Y0", ...years] },
    yAxis: [{ type: "value", name: "₹ cr" }, { type: "value", name: "DFR %", min: 0, max: 100, splitLine: { show: false } }],
    series: [
      { name: "Closing debt", type: "line", data: [finance.debt, ...rows.map((r) => r.closingDebt)].map((v) => Number(v.toFixed(1))), areaStyle: { color: "rgba(245,184,61,0.10)" }, lineStyle: { color: DATA_COLORS.solar }, itemStyle: { color: DATA_COLORS.solar } },
      { name: "Cumulative equity cash", type: "line", data: [-finance.equity, ...rows.map((r) => r.cumEquity)].map((v) => Number(v.toFixed(1))), lineStyle: { color: DATA_COLORS.surplus }, itemStyle: { color: DATA_COLORS.surplus } },
      { name: "DFR", type: "line", yAxisIndex: 1, data: [null, ...rows.map((r) => Number((r.dfr * 100).toFixed(2)))], lineStyle: { color: DATA_COLORS.demand, type: "dashed" }, itemStyle: { color: DATA_COLORS.demand } },
    ],
  }), [rows, finance.debt, finance.equity]);

  function exportCsv() {
    const head = ["Line item", "Y0", ...years];
    const csv = [head.join(",")];
    const y0 = { "Free cash to equity": -finance.equity, "Project cash flow (unlevered)": -finance.capex.total, "Closing balance": finance.debt };
    for (const [label, key] of lines) {
      if (!key) { csv.push(`"${label}"`); continue; }
      csv.push([`"${label}"`, y0[label] ?? "", ...rows.map((r) => (r[key] === null ? "" : Number(r[key]).toFixed(4)))].join(","));
    }
    csv.push("");
    csv.push(`"Solar MW",${sizes.solarMw}`, `"Wind MW",${sizes.windMw}`, `"BESS MW",${sizes.bessMw}`, `"BESS MWh",${sizes.bessMwh}`);
    csv.push(`"Project cost cr",${finance.capex.total.toFixed(2)}`, `"Tariff Rs/kWh",${finance.tariff.toFixed(4)}`, `"Equity IRR",${finance.equityIrr.toFixed(5)}`, `"Project IRR",${finance.projectIrr.toFixed(5)}`);
    downloadText("rtc_financial_model_25y.csv", csv.join("\n"));
  }

  const fmtCell = (v, fmt, sign = 1) => {
    if (v === null || v === undefined) return "–";
    if (fmt === "pct") return pf(v, 1);
    const n = Number(v) * (sign === -1 && Number(v) !== 0 ? -1 : 1);
    return n < 0 ? `(${nf(Math.abs(n), fmt)})` : nf(n, fmt);
  };

  return (
    <>
      <section className="rtc-stats" data-testid="rtc-finance-stats">
        <Stat label={finance.tariffLocked ? "Tariff (fixed)" : "Tariff for target IRR"} value={`₹${nf(finance.tariff, 3)}`} detail={fin.tariffEscalation ? `levelised ₹${nf(finance.levelisedTariff, 3)}` : "flat, ₹/kWh"} trace={{ key: "tariff" }} />
        <Stat label="LCOE" value={`₹${nf(finance.lcoe, 3)}`} detail={`@ ${pf(fin.discountRate, 1)} discount`} trace={{ key: "lcoe" }} />
        <Stat label="Equity IRR" value={pf(finance.equityIrr, 2)} detail={`NPV @ target ₹${nf(finance.equityNpv, 0)} cr`} tone={finance.equityIrr >= fin.targetEquityIrr - 1e-4 ? "good" : "bad"} trace={{ key: "equityIrr" }} />
        <Stat label="Project IRR" value={pf(finance.projectIrr, 2)} detail="post-tax, unlevered" trace={{ key: "projectIrr" }} />
        <Stat label="DSCR min / avg" value={`${nf(finance.minDscr, 2)} / ${nf(finance.avgDscr, 2)}`} detail={`${fin.tenorYears}-yr ${(REPAYMENT_METHODS[fin.repayment] || REPAYMENT_METHODS.equal).label.toLowerCase()}${fin.graceYears > 0 ? `, ${fin.graceYears}-yr moratorium` : ""}${finance.debtTerms?.refi ? `, refinanced in year ${finance.debtTerms.refiYear}` : ""}`} tone={finance.minDscr !== null && finance.minDscr < 1.1 ? "bad" : undefined} trace={{ key: "minDscr" }} />
        <Stat label="Equity payback" value={finance.payback ? `Year ${finance.payback}` : "–"} detail={`equity ₹${nf(finance.equity, 0)} cr · debt ₹${nf(finance.debt, 0)} cr`} trace={{ key: "payback" }} />
      </section>

      <Section index="F.1" title="Assumptions" note="Unlock the tariff to solve it for the target equity IRR; lock it to compute returns at a fixed tariff">
        <div className="rtc-subhead">Tariff & returns</div>
        <div className="rtc-grid rtc-grid-4">
          <Field label="Tariff" unit="₹/kWh" value={finance.tariffLocked ? fin.tariff : finance.tariff} onChange={(v) => patch("fin", { tariff: v })} locked={state.tariffLocked} onLock={() => { if (!state.tariffLocked) patch("fin", { tariff: Number(finance.tariff.toFixed(3)) }); set("tariffLocked", !state.tariffLocked); }} disabled={!state.tariffLocked} lockDisables={false} step={0.01} min={0} hint={state.tariffLocked ? "Fixed: IRR is computed" : "Solved for the target IRR"} />
          <Field label="Target equity IRR" pct value={fin.targetEquityIrr} onChange={(v) => patch("fin", { targetEquityIrr: v })} {...lockProps("fin.targetEquityIrr")} disabled={state.tariffLocked} step={0.25} min={0} max={40} />
          <Field label="Tariff escalation" pct value={fin.tariffEscalation} onChange={(v) => patch("fin", { tariffEscalation: v })} {...lockProps("fin.tariffEscalation")} step={0.1} min={0} max={10} hint="per year" />
          <Field label="Discount rate (LCOE / NPV)" pct value={fin.discountRate} onChange={(v) => patch("fin", { discountRate: v })} {...lockProps("fin.discountRate")} step={0.25} min={0} max={30} />
          <Field label="PPA term" unit="years" value={fin.years} onChange={(v) => patch("fin", { years: Math.max(5, Math.min(35, Math.round(v))) })} {...lockProps("fin.years")} step={1} min={5} max={35} />
          <SwitchBox label="Sell surplus energy" checked={fin.sellSurplus} onChange={(v) => patch("fin", { sellSurplus: v })} {...lockProps("fin.sellSurplus")} />
          <Field label="Surplus price" unit="₹/kWh" value={fin.surplusPrice} onChange={(v) => patch("fin", { surplusPrice: v })} {...lockProps("fin.surplusPrice")} disabled={!fin.sellSurplus} step={0.05} min={0} />
          <Field label="Shortfall penalty" unit="₹/kWh" value={fin.shortfallPenalty} onChange={(v) => patch("fin", { shortfallPenalty: v })} {...lockProps("fin.shortfallPenalty")} step={0.05} min={0} hint="on energy below DFR × demand" />
        </div>
        <div className="rtc-subhead">Financing</div>
        <div className="rtc-grid rtc-grid-4">
          <Field label="Debt share" pct value={fin.debtFraction} onChange={(v) => patch("fin", { debtFraction: v })} {...lockProps("fin.debtFraction")} step={1} min={0} max={95} />
          <Field label="Interest rate" pct value={fin.interestRate} onChange={(v) => patch("fin", { interestRate: v })} {...lockProps("fin.interestRate")} step={0.05} min={0} max={25} />
          <Field label="Loan tenor" unit="years" value={fin.tenorYears} onChange={(v) => patch("fin", { tenorYears: Math.max(1, Math.round(v)) })} {...lockProps("fin.tenorYears")} step={1} min={1} max={25} />
          <SelectBox label="Repayment" value={fin.repayment} onChange={(v) => patch("fin", { repayment: v })} {...lockProps("fin.repayment")} options={Object.entries(REPAYMENT_METHODS).map(([k, m]) => [k, m.label])} hint={REPAYMENT_METHODS[fin.repayment]?.detail} />
          <Field label="Principal moratorium" unit="years" value={fin.graceYears || 0} onChange={(v) => patch("fin", { graceYears: Math.max(0, Math.round(v)) })} {...lockProps("fin.graceYears")} step={1} min={0} max={5} hint="Within the tenor; interest is paid" />
          <SelectBox label="Instalments a year" value={String(fin.paymentsPerYear || 1)} onChange={(v) => patch("fin", { paymentsPerYear: Number(v) })} {...lockProps("fin.paymentsPerYear")} options={[["1", "Yearly"], ["2", "Half-yearly"], ["4", "Quarterly"], ["12", "Monthly"]]} hint={fin.repayment === "sculpted" ? "Sculpting is worked out yearly" : "Paying through the year lowers the interest"} />
          {fin.repayment === "sculpted" && <Field label="Target DSCR" unit="×" value={fin.targetDscr || 1.3} onChange={(v) => patch("fin", { targetDscr: v })} {...lockProps("fin.targetDscr")} step={0.05} min={1} max={3} hint="The principal each year keeps the DSCR here" />}
          {(fin.repayment === "balloon") && <Field label="Balloon share" pct value={fin.balloonPct || 0} onChange={(v) => patch("fin", { balloonPct: v })} {...lockProps("fin.balloonPct")} step={5} min={0} max={100} hint="Repaid in the last year" />}
          {fin.repayment === "stepUp" && <Field label="Principal step-up" pct value={fin.stepUpPct || 0} onChange={(v) => patch("fin", { stepUpPct: v })} {...lockProps("fin.stepUpPct")} step={0.5} min={0} max={25} hint="per year" />}
        </div>
        <div className="rtc-subhead">Refinancing</div>
        <div className="rtc-grid rtc-grid-4">
          <Field label="Refinance at the end of year" unit="year" value={fin.refiYear || 0} onChange={(v) => patch("fin", { refiYear: Math.max(0, Math.round(v)) })} {...lockProps("fin.refiYear")} step={1} min={0} max={25} hint="0: never" />
          <Field label="New interest rate" pct value={fin.refiRate || 0} onChange={(v) => patch("fin", { refiRate: v })} {...lockProps("fin.refiRate")} disabled={!(fin.refiYear > 0)} step={0.05} min={0} max={25} />
          <Field label="New tenor" unit="years" value={fin.refiTenorYears || 0} onChange={(v) => patch("fin", { refiTenorYears: Math.max(1, Math.round(v)) })} {...lockProps("fin.refiTenorYears")} disabled={!(fin.refiYear > 0)} step={1} min={1} max={25} hint="From the refinancing year" />
          <Field label="Refinancing fee" pct value={fin.refiFeePct || 0} onChange={(v) => patch("fin", { refiFeePct: v })} {...lockProps("fin.refiFeePct")} disabled={!(fin.refiYear > 0)} step={0.1} min={0} max={5} hint="of the balance refinanced" />
        </div>
        <div className="rtc-subhead">Working capital and reserves</div>
        <div className="rtc-grid rtc-grid-4">
          <Field label="Receivable days" unit="days" value={fin.receivableDays} onChange={(v) => patch("fin", { receivableDays: v })} {...lockProps("fin.receivableDays")} step={5} min={0} max={180} />
          <Field label="O&M in hand" unit="months" value={fin.omStockMonths || 0} onChange={(v) => patch("fin", { omStockMonths: v })} {...lockProps("fin.omStockMonths")} step={0.5} min={0} max={6} hint="CERC norm: 1 month" />
          <Field label="Maintenance spares" pct value={fin.sparesPctOm || 0} onChange={(v) => patch("fin", { sparesPctOm: v })} {...lockProps("fin.sparesPctOm")} step={1} min={0} max={50} hint="of the year's O&M; CERC norm 15%" />
          <Field label="Interest on working capital" pct value={fin.wcInterestRate || 0} onChange={(v) => patch("fin", { wcInterestRate: v })} {...lockProps("fin.wcInterestRate")} step={0.05} min={0} max={25} hint="0: funded from equity cash" />
          <Field label="Debt service reserve" unit="months" value={fin.dsraMonths || 0} onChange={(v) => patch("fin", { dsraMonths: v })} {...lockProps("fin.dsraMonths")} step={1} min={0} max={12} hint="of the next year's debt service, from equity cash" />
        </div>
        <div className="rtc-subhead">Tax & depreciation</div>
        <div className="rtc-grid rtc-grid-4">
          <Field label="Corporate tax" pct value={fin.taxRate} onChange={(v) => patch("fin", { taxRate: v })} {...lockProps("fin.taxRate")} step={0.01} min={0} max={50} digits={5} />
          <SelectBox label="Tax depreciation" value={fin.taxDepreciation} onChange={(v) => patch("fin", { taxDepreciation: v })} {...lockProps("fin.taxDepreciation")} options={[["wdv", "WDV"], ["slm", "Straight line (= book)"]]} />
          <Field label="WDV rate" pct value={fin.wdvRate} onChange={(v) => patch("fin", { wdvRate: v })} {...lockProps("fin.wdvRate")} disabled={fin.taxDepreciation !== "wdv"} step={1} min={0} max={100} />
          <Field label="Book life" unit="years" value={fin.bookLifeYears} onChange={(v) => patch("fin", { bookLifeYears: Math.max(1, Math.round(v)) })} {...lockProps("fin.bookLifeYears")} step={1} min={1} max={40} />
          <Field label="Salvage value" pct value={fin.salvagePct} onChange={(v) => patch("fin", { salvagePct: v })} {...lockProps("fin.salvagePct")} step={1} min={0} max={30} />
        </div>
        <div className="rtc-subhead">Construction and project costs</div>
        <div className="rtc-grid rtc-grid-4">
          <Field label="Construction" unit="months" value={state.costs.constructionMonths || 0} onChange={(v) => patch("costs", { constructionMonths: Math.max(0, Math.round(v)) })} {...lockProps("costs.constructionMonths")} step={1} min={0} max={60} hint={state.costs.constructionMonths > 0 ? "IDC worked out month by month" : "0: IDC inside the pre-operative share"} />
          <SelectBox label="Drawdown profile" value={state.costs.drawdown || "linear"} onChange={(v) => patch("costs", { drawdown: v })} {...lockProps("costs.drawdown")} options={Object.entries(DRAWDOWN_PROFILES).map(([k, d]) => [k, d.label])} hint={DRAWDOWN_PROFILES[state.costs.drawdown || "linear"]?.detail} />
          <SelectBox label="Funding order" value={state.costs.drawOrder || "proRata"} onChange={(v) => patch("costs", { drawOrder: v })} {...lockProps("costs.drawOrder")} options={[["proRata", "Debt and equity pro rata"], ["equityFirst", "Equity first, then debt"]]} hint="Equity first lowers the IDC" />
          <Field label={state.costs.constructionMonths > 0 ? "Pre-operative cost" : "Pre-operative & IDC"} pct value={state.costs.preopPct} onChange={(v) => patch("costs", { preopPct: v })} {...lockProps("costs.preopPct")} step={0.5} min={0} max={30} hint="of hard cost" />
          <Field label="Evacuation / pooling" unit="₹ cr" value={state.costs.evacuationCr} onChange={(v) => patch("costs", { evacuationCr: v })} {...lockProps("costs.evacuationCr")} step={5} min={0} hint="Lump sum" />
          <Field label="O&M escalation" pct value={fin.omEscalation} onChange={(v) => patch("fin", { omEscalation: v })} {...lockProps("fin.omEscalation")} step={0.25} min={0} max={15} hint="Solar, wind and BESS O&M are set in their chapters" />
          <Field label="Insurance" pct value={fin.insurancePct} onChange={(v) => patch("fin", { insurancePct: v })} {...lockProps("fin.insurancePct")} step={0.05} min={0} max={3} hint="of hard cost / yr" />
          <Field label="Other fixed cost" unit="₹ cr/yr" value={fin.otherFixedCr} onChange={(v) => patch("fin", { otherFixedCr: v })} {...lockProps("fin.otherFixedCr")} step={0.5} min={0} hint="Land lease, SLDC, overheads" />
        </div>
      </Section>

      <div className="rtc-grid rtc-grid-2 rtc-flush">
        <Section index="F.2" title="Earnings & coverage">
          <LiveChart option={plOption} height={330} />
        </Section>
        <Section index="F.3" title="Debt, equity cash & DFR">
          <LiveChart option={cashOption} height={330} />
        </Section>
      </div>

      {(state.dsm || state.sources) && <DsmPanel index="F.3a" dsm={state.dsm || DSM_DEFAULTS} onChange={(v) => patch("dsm", v)} sources={state.sources} tariff={finance.tariff} scheduledMu={finance.rows[0] ? finance.rows[0].deliveredMu + finance.rows[0].excessMu : null} lockProps={lockProps} />}
      {finance.construction && <ConstructionView index="F.3b" finance={finance} />}

      <Section index="F.4" title={`${fin.years}-year financial model`} note={`Project cost ₹${nf(finance.capex.total, 1)} cr (hard ₹${nf(finance.capex.hard, 1)} + pre-op ₹${nf(finance.capex.preop, 1)}${finance.capex.idc > 0 ? ` + IDC ₹${nf(finance.capex.idc, 1)}` : ""})`} actions={<><TraceButton />{actions}<button type="button" className="secondary" onClick={exportCsv}><Download size={14} /> Export CSV</button></>}>
        {traceable && <p className="rtc-note">Click any number to see its formula and every input behind it.</p>}
        <div className="table-wrap rtc-model fin-table">
          <table>
            <thead>
              <tr><th>Line item</th><th>Y0</th>{years.map((y) => <th key={y}>{y}</th>)}</tr>
            </thead>
            <tbody>
              {lines.map(([label, key, fmt, sign, strong], i) => {
                if (!key) return <tr key={i} className="rtc-model-group"><td colSpan={years.length + 2}>{label}</td></tr>;
                const y0 = label === "Free cash to equity" ? -finance.equity : label === "Project cash flow (unlevered)" ? -finance.capex.total : label === "Closing balance" ? finance.debt : null;
                return (
                  <tr key={i} className={strong ? "rtc-model-total" : ""}>
                    <td>{label}</td>
                    <td>{y0 === null ? "" : fmtCell(y0, fmt)}</td>
                    {rows.map((r) => (traceable && TRACE_LINE[key]
                      ? <td key={r.year} className="is-traceable" onClick={() => trace.openTrace({ line: TRACE_LINE[key], year: r.year })} title="Show how this number is worked out">{fmtCell(r[key], fmt, sign)}</td>
                      : <td key={r.year}>{fmtCell(r[key], fmt, sign)}</td>))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

