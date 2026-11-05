import React from "react";
import { ArrowRight, CheckCircle2, Sparkles, TriangleAlert, Zap } from "lucide-react";
import { Field, Section, SelectBox } from "../rtc/ui";
import * as E from "../rtc/engine";
import Cite from "./Cite.jsx";
import { cfdBessAug, fillBenchmarks, keyDates, missingInputs, patchCfdBess } from "./model.js";
import FinanceInputsV3 from "../rtc/FinanceInputsV3";
import { Fields, FillBar } from "./inputs.jsx";

/**
 * Step 06, the Finance team: capex and running costs, the tender's own costs, the financing terms
 * the strike price is solved for, then the enterprise terms the full financial model uses (debt
 * repayment and refinancing, construction and IDC, working capital and reserves) in state.fin and
 * state.costs; then "Size the plant" once every team's inputs are in.
 */
export default function FinanceInputsStep({ state, setState, setInput, lockProps, goto, startSizing, index = "5" }) {
  const missing = missingInputs(state);
  const fin = state.fin || {};
  const costs = state.costs || {};
  const setFin = (values) => setState((s) => ({ ...s, fin: { ...(s.fin || {}), ...values } }));
  const setCosts = (values) => setState((s) => ({ ...s, costs: { ...(s.costs || {}), ...values } }));
  const fillButton = (
    <button type="button" className="primary" onClick={() => setState((s) => fillBenchmarks(s))} data-testid="cfd-fill-finance">
      <Sparkles size={14} /> Fill up for me please
    </button>
  );
  return (
    <>
      <Section index={index} title="Costs" note="Capex, running costs and the tender's own costs">
        <FillBar state={state} setState={setState} missing={missing} />
        <Fields state={state} setInput={setInput} section="costs" lockProps={lockProps} />
        <p className="rtc-note">Exchange fees <Cite id="pxCharges" />, transmission to the Delivery Point <Cite id="ists" /> <Cite id="lineCost" />, the Letter of Credit <Cite id="lc" />, the bank guarantees and SECI's charges are yours. Augmentation replaces the battery's degraded MWh each year at the battery price, falling by the rate above.</p>
      </Section>

      <Section index={`${index}.1`} title="Financing" note="The strike price is solved for your target equity IRR">
        <Fields state={state} setInput={setInput} section="fin" lockProps={lockProps} />
      </Section>

      <Section index={`${index}.2`} title="Debt repayment and refinancing" note="How the debt is paid back, standard in the market; a refinancing once the plant has run">
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-debt-terms">
          <SelectBox label="Repayment" value={fin.repayment || "equal"} onChange={(v) => setFin({ repayment: v })} {...lockProps("fin.repayment")} options={Object.entries(E.REPAYMENT_METHODS).map(([k, m]) => [k, m.label])} hint={E.REPAYMENT_METHODS[fin.repayment || "equal"]?.detail} />
          <Field label="Principal moratorium" unit="years" value={fin.graceYears || 0} onChange={(v) => setFin({ graceYears: Math.max(0, Math.round(v)) })} {...lockProps("fin.graceYears")} step={1} min={0} max={5} hint="Within the tenor; interest is paid" />
          <SelectBox label="Instalments a year" value={String(fin.paymentsPerYear || 1)} onChange={(v) => setFin({ paymentsPerYear: Number(v) })} {...lockProps("fin.paymentsPerYear")} options={[["1", "Yearly"], ["2", "Half-yearly"], ["4", "Quarterly"], ["12", "Monthly"]]} hint={fin.repayment === "sculpted" ? "Sculpting is worked out yearly" : "Paying through the year lowers the interest"} />
          {fin.repayment === "sculpted" && <Field label="Target DSCR" unit="×" value={fin.targetDscr || 1.3} onChange={(v) => setFin({ targetDscr: v })} {...lockProps("fin.targetDscr")} step={0.05} min={1} max={3} hint="The principal each year keeps the DSCR here" />}
          {fin.repayment === "balloon" && <Field label="Balloon share" pct value={fin.balloonPct || 0} onChange={(v) => setFin({ balloonPct: v })} {...lockProps("fin.balloonPct")} step={5} min={0} max={100} hint="Repaid in the last year" />}
          {fin.repayment === "stepUp" && <Field label="Principal step-up" pct value={fin.stepUpPct || 0} onChange={(v) => setFin({ stepUpPct: v })} {...lockProps("fin.stepUpPct")} step={0.5} min={0} max={25} hint="per year" />}
          <Field label="Refinance at the end of year" unit="year" value={fin.refiYear || 0} onChange={(v) => setFin({ refiYear: Math.max(0, Math.round(v)) })} {...lockProps("fin.refiYear")} step={1} min={0} max={15} hint="0: never" />
          <Field label="New interest rate" pct value={fin.refiRate || 0} onChange={(v) => setFin({ refiRate: v })} {...lockProps("fin.refiRate")} disabled={!(fin.refiYear > 0)} step={0.05} min={0} max={25} />
          <Field label="New tenor" unit="years" value={fin.refiTenorYears || 0} onChange={(v) => setFin({ refiTenorYears: Math.max(1, Math.round(v)) })} {...lockProps("fin.refiTenorYears")} disabled={!(fin.refiYear > 0)} step={1} min={1} max={15} hint="From the refinancing year" />
          <Field label="Refinancing fee" pct value={fin.refiFeePct || 0} onChange={(v) => setFin({ refiFeePct: v })} {...lockProps("fin.refiFeePct")} disabled={!(fin.refiYear > 0)} step={0.1} min={0} max={5} hint="of the balance refinanced" />
        </div>
      </Section>

      <Section index={`${index}.3`} title="Construction and interest during construction" note="The battery, the line and the RE spent month by month, funded by equity and debt; the IDC is capitalised as debt">
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-construction">
          <Field label="Construction" unit="months" value={costs.constructionMonths || 0} onChange={(v) => setCosts({ constructionMonths: Math.max(0, Math.round(v)) })} {...lockProps("costs.constructionMonths")} step={1} min={0} max={36} hint={costs.constructionMonths > 0 ? "IDC worked out month by month on the Financial model step" : "0: the IDC is inside the pre-operative share"} />
          <SelectBox label="Drawdown profile" value={costs.drawdown || "linear"} onChange={(v) => setCosts({ drawdown: v })} {...lockProps("costs.drawdown")} options={Object.entries(E.DRAWDOWN_PROFILES).map(([k, d]) => [k, d.label])} hint={E.DRAWDOWN_PROFILES[costs.drawdown || "linear"]?.detail} />
          <SelectBox label="Funding order" value={costs.drawOrder || "proRata"} onChange={(v) => setCosts({ drawOrder: v })} {...lockProps("costs.drawOrder")} options={[["proRata", "Debt and equity pro rata"], ["equityFirst", "Equity first, then debt"]]} hint="Equity first lowers the IDC" />
        </div>
        <p className="rtc-note">The battery must be commissioned 15 months from the Effective Date <Cite id="essScd" />, the RE by 36 months <Cite id="reCod" />, with financial closure 6 months before the SCD <Cite id="finClose" />.</p>
      </Section>

      <Section index={`${index}.4`} title="Working capital and reserves" note="CERC norms: receivables, O&M in hand and spares; interest on the working capital; a debt service reserve">
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-working-capital">
          <Field label="Receivable days" unit="days" value={fin.receivableDays ?? 45} onChange={(v) => setFin({ receivableDays: v })} {...lockProps("fin.receivableDays")} step={5} min={0} max={180} hint="CfD settlement is monthly; CERC norm 45 days" />
          <Field label="O&M in hand" unit="months" value={fin.omStockMonths || 0} onChange={(v) => setFin({ omStockMonths: v })} {...lockProps("fin.omStockMonths")} step={0.5} min={0} max={6} hint="CERC norm: 1 month" />
          <Field label="Maintenance spares" pct value={fin.sparesPctOm || 0} onChange={(v) => setFin({ sparesPctOm: v })} {...lockProps("fin.sparesPctOm")} step={1} min={0} max={50} hint="of the year's O&M; CERC norm 15%" />
          <Field label="Interest on working capital" pct value={fin.wcInterestRate || 0} onChange={(v) => setFin({ wcInterestRate: v })} {...lockProps("fin.wcInterestRate")} step={0.05} min={0} max={25} hint="0: funded from equity cash" />
          <Field label="Debt service reserve" unit="months" value={fin.dsraMonths || 0} onChange={(v) => setFin({ dsraMonths: v })} {...lockProps("fin.dsraMonths")} step={1} min={0} max={12} hint="of the next year's debt service, from equity cash" />
        </div>
      </Section>

      <Section index={`${index}.4a`} title="Finance team's inputs" note="Timeline, phasing and part commissioning, generation cases and carbon, O&M splits, debt features, quasi-equity and mezzanine, guarantees, tax, returns and the auction sensitivities; every group off until filled">
        <FinanceInputsV3 fin={fin} costs={costs} bessAug={cfdBessAug(state)} patchFin={setFin} patchCosts={setCosts} patchBess={(values) => setState((s) => patchCfdBess(s, values))}
          codDefault={state.inputs?.effectiveDate ? keyDates(state.inputs.effectiveDate).scd : null} lockProps={lockProps} />
        <p className="rtc-note">The commercial operation date defaults to the battery's SCD, 15 months from the Effective Date <Cite id="essScd" />.</p>
      </Section>

      <section className="optimize-bar">
        <div>
          <span className="rtc-index">{index}.5</span>
          <h2>{missing.length ? `${missing.length} input${missing.length > 1 ? "s" : ""} still needed` : "Ready to size"}</h2>
          {missing.length
            ? <ul className="bid-warnings" data-testid="cfd-missing-finance">{missing.slice(0, 12).map((m) => <li key={m}><TriangleAlert size={12} /> {m}</li>)}{missing.length > 12 && <li>… and {missing.length - 12} more</li>}</ul>
            : <p><CheckCircle2 size={13} /> The Projects, Design and Finance inputs are in. The sizing finds the own RE that gives the lowest strike price with every day's supply met within the sourcing limits.</p>}
        </div>
        <div className="optimize-bar-actions">
          {missing.length > 0 && fillButton}
          <button type="button" className="primary optimize-go" disabled={missing.length > 0} onClick={() => { goto("size"); startSizing(); }} data-testid="cfd-size"><Zap size={16} /> Size the plant <ArrowRight size={14} /></button>
        </div>
      </section>
    </>
  );
}
