import React, { useMemo } from "react";
import { LiveChart } from "./charts";
import { DATA_COLORS } from "../chartTheme";
import { Section, Stat, nf, pf } from "./ui";

/**
 * The construction phase month by month (rtc/engine.js constructionSchedule): the cost drawn,
 * how equity and debt fund it, and the interest during construction that is capitalised as debt.
 * The Excel workbook's Construction sheet holds the same table as formulas.
 */
export default function ConstructionView({ finance, index = "F.3b" }) {
  const c = finance.construction;
  const option = useMemo(() => {
    const r1 = (v) => Number(v.toFixed(2));
    return {
      animation: false,
      grid: { left: 60, right: 56, top: 36, bottom: 30 },
      legend: { top: 0, right: 0 },
      tooltip: { trigger: "axis", valueFormatter: (v) => `₹${nf(v, 2)} cr` },
      xAxis: { type: "category", data: c.rows.map((r) => `M${r.month}`) },
      yAxis: [{ type: "value", name: "₹ cr in the month" }, { type: "value", name: "Debt (₹ cr)", splitLine: { show: false } }],
      series: [
        { name: "Equity drawn", type: "bar", stack: "fund", data: c.rows.map((r) => r1(r.equity)), itemStyle: { color: DATA_COLORS.surplus } },
        { name: "Debt drawn", type: "bar", stack: "fund", data: c.rows.map((r) => r1(r.debt)), itemStyle: { color: DATA_COLORS.solar } },
        { name: "IDC", type: "bar", stack: "fund", data: c.rows.map((r) => r1(r.idc)), itemStyle: { color: DATA_COLORS.demand } },
        { name: "Debt outstanding", type: "line", yAxisIndex: 1, data: c.rows.map((r) => r1(r.closingDebt)), lineStyle: { color: DATA_COLORS.wind }, itemStyle: { color: DATA_COLORS.wind }, symbol: "none" },
      ],
    };
  }, [c]);
  if (!c) return null;
  const base = finance.capex.hard + finance.capex.preop;
  return (
    <Section index={index} title={`Construction: ${c.months} months, month by month`} note={`${c.profile === "sCurve" ? "S-curve" : c.profile === "front" ? "Front-loaded" : c.profile === "back" ? "Back-loaded" : "Even"} drawdown, ${c.order === "equityFirst" ? "equity first" : "debt and equity pro rata"}; the interest during construction is capitalised as debt`} className="rtc-construction">
      <div className="rtc-stats">
        <Stat label="Cost before IDC" value={`₹${nf(base, 0)} cr`} detail={`hard ₹${nf(finance.capex.hard, 0)} cr + pre-operative ₹${nf(finance.capex.preop, 0)} cr`} />
        <Stat label="Interest during construction" value={`₹${nf(c.idc, 1)} cr`} detail={`${pf(c.idc / base, 2)} of the cost before IDC`} trace={{ key: "capexTotal" }} />
        <Stat label="Debt at COD" value={`₹${nf(finance.debt, 0)} cr`} detail={`${pf(finance.debt / finance.capex.total, 1)} of the project cost incl. IDC`} />
        <Stat label="Equity put in" value={`₹${nf(finance.equity, 0)} cr`} detail={c.order === "equityFirst" ? "drawn before the first rupee of debt" : "drawn with the debt, month by month"} />
      </div>
      <LiveChart option={option} height={280} />
      <div className="table-wrap rtc-model fin-table">
        <table>
          <thead><tr><th>Month</th><th>Share</th><th>Cost drawn</th><th>Equity</th><th>Debt drawn</th><th>Opening debt</th><th>IDC</th><th>Closing debt</th></tr></thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.month}><td>M{r.month}</td><td>{pf(r.share, 2)}</td><td>{nf(r.cost, 2)}</td><td>{nf(r.equity, 2)}</td><td>{nf(r.debt, 2)}</td><td>{nf(r.openingDebt, 2)}</td><td>{nf(r.idc, 2)}</td><td>{nf(r.closingDebt, 2)}</td></tr>
            ))}
            <tr className="rtc-model-total"><td>Total</td><td>100%</td><td>{nf(base, 2)}</td><td>{nf(c.equity, 2)}</td><td>{nf(c.debtDrawn, 2)}</td><td /><td>{nf(c.idc, 2)}</td><td>{nf(finance.debt, 2)}</td></tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}
