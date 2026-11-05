import React, { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { LiveChart } from "./charts";
import { DATA_COLORS } from "../chartTheme";
import { Field, SelectBox, Section, Stat, SwitchBox, downloadText, nf, pf } from "./ui";
import { TraceButton, useTrace } from "../model/ModelExplorer";
import { DRAWDOWN_PROFILES, REPAYMENT_METHODS } from "./engine";
import ConstructionView from "./ConstructionView";
import DsmPanel from "../dsm/DsmPanel";
import { DSM_DEFAULTS } from "../dsm/dsm";
import FinanceInputsV3 from "./FinanceInputsV3";
import { ReturnsSection, SensitivitySection, StatementsSection, TaxSection } from "./FinanceStatements";
import { rowsHave, v3Fin, yearLabel } from "./financeV3";

// the financial model's rows → the lines of the traceable model (web/lib/liveModel.js keys)
const TRACE_LINE = {
  demandMu: "demand", deliveredMu: "delivered", dfr: "dfr", excessMu: "excess", shortfallMu: "shortfall", tariff: "trf",
  energyRevenue: "ppaRev", surplusRevenue: "mktRev", revenue: "revenue", insurance: "insuranceCr", other: "otherCr", opex: "opex",
  ebitda: "ebitda", bookDep: "bookDep", interest: "interest", principal: "principal", pbt: "pbt", taxDep: "taxDep", tax: "tax", pat: "pat",
  dWc: "dWc", augCapex: "aug", cfads: "cfads", debtService: "debtService", fcfe: "fcfe", cumEquity: "cumEq", projectCf: "projCf",
  openingDebt: "openDebt", closingDebt: "closeDebt", dscr: "dscr", receivables: "recv",
  wcInterest: "wcInt", refiFee: "refiFeeCr", dDsra: "dDsra", dsraBalance: "dsra", omStock: "omStock", spares: "spares", wcBalance: "wcBal", dsm: "dsmCr", debtRate: "rateY",
  // the finance team's lines (docs/dev/FINANCE-V3-SPEC.md)
  opFactor: "opFactor", generationFactor: "genFactor", carbonRevenue: "carbonRev", solarOm: "solarOmCr", windOm: "windOmCr", bessOm: "bessOmCr", biomassOm: "biomassOmCr",
  guaranteeFees: "bgFees", dsraInterest: "dsraInt", marginInterest: "marginInt", marginBalance: "marginBal", prepaymentFee: "prepayFee", sweepCr: "sweep", sweepAccrued: "sweepAccr", topUpCr: "topUp",
  quasiOpening: "quasiOpen", quasiInterestPaid: "quasiInt", quasiAccrued: "quasiAccr", quasiRepaid: "quasiRepay", quasiClosing: "quasiClose",
  mezzOpening: "mezzOpen", mezzInterest: "mezzInt", mezzPrincipal: "mezzPrin", mezzClosing: "mezzClose", repowerCapex: "repower", extensionCapex: "extCapex",
  fscr: "fscr", llcr: "llcr", plcr: "plcr", totalDscr: "totalDscr",
};
// rows shown only when some year has them
const OPTIONAL_LINES = ["buyerRevenue", "dsm", "wcInterest", "refiFee", "dDsra", "dsraBalance", "omStock", "spares",
  "opFactor", "generationFactor", "carbonRevenue", "solarOm", "windOm", "bessOm", "biomassOm", "guaranteeFees", "dsraInterest", "marginInterest", "marginBalance", "prepaymentFee",
  "sweepCr", "sweepAccrued", "topUpCr", "quasiOpening", "quasiInterestPaid", "quasiAccrued", "quasiRepaid", "quasiClosing", "mezzOpening", "mezzInterest", "mezzPrincipal", "mezzClosing",
  "repowerCapex", "extensionCapex", "fscr", "llcr", "plcr", "totalDscr"];
// the sources' O&M lines are shown only when more than one source has one (else "O&M" is the line)
const OM_SPLIT = ["solarOm", "windOm", "bessOm", "biomassOm"];

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
  ["Operating share of the year (part commissioning)", "opFactor", "pct"],
  ["Generation case factor", "generationFactor", "pct"],
  ["Profit & loss (₹ cr)", null],
  ["Energy revenue", "energyRevenue", 1],
  ["Surplus revenue", "surplusRevenue", 1],
  ["Excess sold to the buyer", "buyerRevenue", 1],
  ["Shortfall penalty", "penalty", 1, -1],
  ["Carbon credits", "carbonRevenue", 1],
  ["Total revenue", "revenue", 1, 1, true],
  ["O&M", "om", 1, -1],
  ["O&M · solar", "solarOm", 1, -1],
  ["O&M · wind", "windOm", 1, -1],
  ["O&M · battery", "bessOm", 1, -1],
  ["O&M · biomass", "biomassOm", 1, -1],
  ["Insurance", "insurance", 1, -1],
  ["Other fixed", "other", 1, -1],
  ["Deviation settlement charges (CERC DSM)", "dsm", 1, -1],
  ["EBITDA", "ebitda", 1, 1, true],
  ["Book depreciation", "bookDep", 1, -1],
  ["Interest", "interest", 1, -1],
  ["Interest on working capital", "wcInterest", 1, -1],
  ["Guarantee fees", "guaranteeFees", 1, -1],
  ["Mezzanine interest", "mezzInterest", 1, -1],
  ["Quasi-equity interest paid", "quasiInterestPaid", 1, -1],
  ["Interest on the debt service reserve", "dsraInterest", 1],
  ["Interest on margin money", "marginInterest", 1],
  ["Refinancing fee", "refiFee", 1, -1],
  ["Prepayment penalty", "prepaymentFee", 1, -1],
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
  ["Solar repowering", "repowerCapex", 1, -1],
  ["Life-extension capex", "extensionCapex", 1, -1],
  ["Guarantee fees", "guaranteeFees", 1, -1],
  ["CFADS", "cfads", 1, 1, true],
  ["Debt service", "debtService", 1, -1],
  ["Cash sweep prepayment", "sweepCr", 1, -1],
  ["Prepayment penalty", "prepaymentFee", 1, -1],
  ["Refinancing fee", "refiFee", 1, -1],
  ["Top-up debt paid to equity", "topUpCr", 1],
  ["Mezzanine interest", "mezzInterest", 1, -1],
  ["Mezzanine principal", "mezzPrincipal", 1, -1],
  ["Quasi-equity interest paid", "quasiInterestPaid", 1, -1],
  ["Quasi-equity repaid", "quasiRepaid", 1, -1],
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
  ["DSCR on senior and mezzanine", "totalDscr", 2],
  ["FSCR", "fscr", 2],
  ["LLCR", "llcr", 2],
  ["PLCR", "plcr", 2],
  ["Debt service reserve held", "dsraBalance", 1],
  ["Cash sweep accrued", "sweepAccrued", 1],
  ["Quasi-equity and mezzanine (₹ cr)", null],
  ["Quasi-equity opening", "quasiOpening", 1],
  ["Quasi-equity interest accrued", "quasiAccrued", 1],
  ["Quasi-equity closing", "quasiClosing", 1],
  ["Mezzanine opening", "mezzOpening", 1],
  ["Mezzanine closing", "mezzClosing", 1],
  ["Margin money on guarantees", "marginBalance", 1],
];

/**
 * codDefault: the tender's commercial operation date (seeds the timeline when fin.codDate is empty);
 * modelArgs: { ctx, sizes, args } as given to runFinancialModel, for the F.8 sensitivities;
 * bessAug / patchBess: the tab's battery augmentation choice for the schedule option.
 */
export default function FinanceView({ state, patch, set, lockProps, finance, sizes, extraLines = null, energyLines = null, actions = null, codDefault = null, modelArgs = null, bessAug = null, patchBess = null }) {
  const { fin } = state;
  const finV3 = useMemo(() => v3Fin(fin), [fin]);
  const [moreInputs, setMoreInputs] = useState(false);
  // extraLines: [label, key, fmt, sign] rows a caller adds after "Other fixed" (Tender to Bid: biomass fuel);
  // energyLines: rows added before "Delivered" (Round the clock: the 33 kV bus to the 220 kV meter);
  // actions: buttons beside Export CSV (Round the clock: the Excel workbook)
  const lines = useMemo(() => {
    // the rows a bid may not have (the Solar Hours excess to the buyer, DSM, working-capital
    // interest, refinancing, the reserve) only when some year has them
    const has = (key) => rowsHave(finance.rows, key);
    const omSplit = OM_SPLIT.filter(has).length > 1;
    let out = FIN_LINES.filter((l) => !OPTIONAL_LINES.includes(l[1]) || (has(l[1]) && (!OM_SPLIT.includes(l[1]) || omSplit)));
    // the other fixed costs as the finance team's lines, when they split them
    const otherLines = finance.rows.find((r) => Array.isArray(r.otherLines) && r.otherLines.length)?.otherLines;
    if (otherLines?.length && Array.isArray(fin.otherFixedLines) && fin.otherFixedLines.length === otherLines.length) {
      const at = out.findIndex((l) => l[1] === "other") + 1;
      out = [...out.slice(0, at), ...fin.otherFixedLines.map((l, k) => [`Other fixed · ${l.label || `line ${k + 1}`}`, (r) => r.otherLines?.[k], 1, -1]), ...out.slice(at)];
    }
    const windParts = finance.rows.find((r) => Array.isArray(r.windOmComponents) && r.windOmComponents.length)?.windOmComponents;
    if (windParts?.length && Array.isArray(fin.windOmComponents) && fin.windOmComponents.length === windParts.length) {
      const at = out.findIndex((l) => l[1] === "windOm");
      if (at >= 0) out = [...out.slice(0, at + 1), ...fin.windOmComponents.map((c, k) => [`O&M · wind · ${c.label || `component ${k + 1}`}`, (r) => r.windOmComponents?.[k], 1, -1]), ...out.slice(at + 1)];
    }
    if (energyLines?.length) {
      const at = out.findIndex((l) => l[1] === "deliveredMu");
      out = [...out.slice(0, at), ...energyLines, ["Delivered to the customer at the meter (MU)", "deliveredMu", 1], ...out.slice(at + 1)];
    }
    if (extraLines?.length) {
      const at = out.findIndex((l) => l[1] === "other") + 1;
      out = [...out.slice(0, at), ...extraLines, ...out.slice(at)];
    }
    return out;
  }, [extraLines, energyLines, finance.rows, fin.otherFixedLines, fin.windOmComponents]);
  const rows = finance.rows;
  const years = rows.map((r) => `Y${r.year}`);
  const yearHeads = rows.map((r) => yearLabel(r));
  const cell = (r, key) => (typeof key === "function" ? key(r) : r[key]);
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
    const head = ["Line item", "Y0", ...yearHeads.map((y) => `"${y}"`)];
    const csv = [head.join(",")];
    if (rows[0]?.start) csv.push(["Year starts", "", ...rows.map((r) => r.start || "")].join(","));
    const y0 = { "Free cash to equity": -finance.equity, "Project cash flow (unlevered)": -finance.capex.total, "Closing balance": finance.debt };
    for (const [label, key] of lines) {
      if (!key) { csv.push(`"${label}"`); continue; }
      csv.push([`"${label}"`, y0[label] ?? "", ...rows.map((r) => { const v = cell(r, key); return v === null || v === undefined ? "" : Number(v).toFixed(4); })].join(","));
    }
    const extra = [["Equity IRR pre-tax", "preTaxEquityIrr"], ["Project IRR pre-tax", "preTaxProjectIrr"], ["HoldCo IRR", "holdcoIrr"], ["Promoter IRR", "promoterIrr"], ["Lender XIRR", "lenderXirr"], ["Lender MIRR", "lenderMirr"], ["Min DSCR", "minDscr"], ["Min FSCR", "minFscr"], ["Min LLCR", "minLlcr"], ["Min PLCR", "minPlcr"], ["Mezzanine cr", "mezz"], ["Quasi-equity cr", "quasi"]];
    for (const [label, key] of extra) if (Number.isFinite(finance[key])) csv.push(`"${label}",${Number(finance[key]).toFixed(5)}`);
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
        <div className="fin-v3-toggle">
          <button type="button" className={moreInputs ? "primary" : "secondary"} onClick={() => setMoreInputs((v) => !v)} data-testid="fin-v3-toggle" aria-expanded={moreInputs}>
            {moreInputs ? "Hide the finance team's inputs" : "More inputs (finance team)"}
          </button>
          {!moreInputs && <small className="rtc-note">Timeline, phasing and part commissioning, generation cases and carbon, O&M splits, debt features, quasi-equity and mezzanine, guarantees, tax, returns and the auction sensitivities</small>}
        </div>
        {moreInputs && (
          <FinanceInputsV3 fin={fin} costs={state.costs} bessAug={bessAug} patchFin={(values) => patch("fin", values)} patchCosts={(values) => patch("costs", values)} patchBess={patchBess}
            codDefault={codDefault} lockProps={lockProps} />
        )}
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

      <Section index="F.4" title={`${rows.length}-year financial model${finance.ppaYears && rows.length > finance.ppaYears ? ` (${finance.ppaYears} PPA years + ${rows.length - finance.ppaYears} of extension)` : ""}`} note={`Project cost ₹${nf(finance.capex.total, 1)} cr (hard ₹${nf(finance.capex.hard, 1)} + pre-op ₹${nf(finance.capex.preop, 1)}${finance.capex.idc > 0 ? ` + IDC ₹${nf(finance.capex.idc, 1)}` : ""})`} actions={<><TraceButton />{actions}<button type="button" className="secondary" onClick={exportCsv}><Download size={14} /> Export CSV</button></>}>
        {traceable && <p className="rtc-note">Click any number to see its formula and every input behind it.</p>}
        <div className="table-wrap rtc-model fin-table">
          <table>
            <thead>
              <tr><th>Line item</th><th>Y0</th>{yearHeads.map((y) => <th key={y}>{y}</th>)}</tr>
            </thead>
            <tbody>
              {lines.map(([label, key, fmt, sign, strong], i) => {
                if (!key) return <tr key={i} className="rtc-model-group"><td colSpan={years.length + 2}>{label}</td></tr>;
                const y0 = label === "Free cash to equity" ? -finance.equity : label === "Project cash flow (unlevered)" ? -finance.capex.total : label === "Closing balance" ? finance.debt : null;
                return (
                  <tr key={i} className={strong ? "rtc-model-total" : ""}>
                    <td>{label}</td>
                    <td>{y0 === null ? "" : fmtCell(y0, fmt)}</td>
                    {rows.map((r) => (traceable && typeof key === "string" && TRACE_LINE[key]
                      ? <td key={r.year} className="is-traceable" onClick={() => trace.openTrace({ line: TRACE_LINE[key], year: r.year })} title="Show how this number is worked out">{fmtCell(cell(r, key), fmt, sign)}</td>
                      : <td key={r.year}>{fmtCell(cell(r, key), fmt, sign)}</td>))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <ReturnsSection finance={finance} fin={finV3} />
      <TaxSection finance={finance} fin={finV3} />
      <StatementsSection finance={finance} />
      <SensitivitySection finance={finance} modelArgs={modelArgs} />
    </>
  );
}

