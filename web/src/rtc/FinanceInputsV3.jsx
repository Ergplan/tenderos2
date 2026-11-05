import React from "react";
import { Plus, X } from "lucide-react";
import { Field, SelectBox, SwitchBox } from "./ui";
import { GUARANTEE_PRESETS, PHASING_COMPONENTS, V3_COST_DEFAULTS, isoDateOf, longDate, v3Fin } from "./financeV3";

/**
 * The finance team's inputs (docs/dev/FINANCE-V3-SPEC.md §10), in closed groups, every one off
 * until a box is filled: the timeline, construction phasing and part commissioning, generation
 * cases and other revenue, operating-cost splits, the debt features, quasi-equity and mezzanine,
 * the guarantees, tax, returns and the reverse-auction sensitivity inputs.
 *
 * Props: fin, costs, bessAug ({ augmentation, augmentationYears }, the tab's battery augmentation
 * choice), patchFin(values), patchCosts(values), patchBess(values), codDefault (the tender's COD,
 * shown when fin.codDate is empty), lockProps(key) (optional), index (the section number shown).
 */
export default function FinanceInputsV3({ fin: rawFin, costs: rawCosts, bessAug = null, patchFin, patchCosts, patchBess = null, codDefault = null, lockProps = null, index = null }) {
  const fin = v3Fin(rawFin);
  const costs = { ...V3_COST_DEFAULTS, ...(rawCosts || {}) };
  const lp = (key) => (lockProps ? lockProps(key) : {});
  const sub = (key, values) => patchFin({ [key]: { ...fin[key], ...values } });
  const list = (key, rows) => patchFin({ [key]: rows });
  const partsTotal = fin.parts.reduce((a, p) => a + (Number(p.share) || 0), 0);
  const codShown = fin.codDate || isoDateOf(codDefault) || "";
  const months = Math.max(0, Math.round(costs.constructionMonths || 0));
  const phasing = costs.phasing || {};

  return (
    <div className="fin-v3" data-testid="fin-v3">
      {index && <div className="rtc-subhead">{index} More inputs (finance team)</div>}
      <p className="rtc-note">Each group below is off until you fill it; the model's numbers do not move before that. Open a group to see what it does.</p>

      <Group id="timeline" title="Timeline" note="Dates instead of Y1, Y2: each model year runs from the commercial operation date.">
        <div className="rtc-grid rtc-grid-4">
          <label className="rtc-field">
            <div className="rtc-field-top"><span>Commercial operation date</span></div>
            <input type="date" value={codShown} data-testid="fin-v3-cod" onChange={(e) => patchFin({ codDate: e.target.value || null })} />
            <small>{fin.codDate ? "Your date" : codDefault ? `From the tender: ${longDate(isoDateOf(codDefault))}` : "No tender date: enter the COD to label the years"}</small>
          </label>
          {fin.codDate && codDefault && <div className="rtc-field"><div className="rtc-field-top"><span>Tender's date</span></div><div className="rtc-field-input"><button type="button" className="secondary" onClick={() => patchFin({ codDate: null })}>Use {longDate(isoDateOf(codDefault))}</button></div></div>}
        </div>
      </Group>

      <Group id="construction" title="Construction and commissioning" note="Spend each component over its own months, commission the plant in parts, and bridge the debt before the term loan.">
        <div className="rtc-subhead">Hard-cost phasing{months ? ` (within ${months} months of construction)` : " (set the construction months on the step above first)"}</div>
        <table className="fin-v3-list" data-testid="fin-v3-phasing">
          <thead><tr><th>Component</th><th>Starts in month</th><th>Spent over months</th><th /></tr></thead>
          <tbody>
            {PHASING_COMPONENTS.map(([key, label]) => {
              const p = phasing[key];
              return (
                <tr key={key}>
                  <td>{label}</td>
                  <td><input type="number" min={0} max={months} step={1} value={p?.start ?? ""} placeholder="0" onChange={(e) => patchCosts({ phasing: { ...phasing, [key]: { start: Number(e.target.value) || 0, months: p?.months ?? months } } })} /></td>
                  <td><input type="number" min={1} max={months || 60} step={1} value={p?.months ?? ""} placeholder={months ? String(months) : "all"} onChange={(e) => patchCosts({ phasing: { ...phasing, [key]: { start: p?.start ?? 0, months: Number(e.target.value) || months } } })} /></td>
                  <td>{p && <button type="button" className="icon" title="Spend over the whole window" onClick={() => { const next = { ...phasing }; delete next[key]; patchCosts({ phasing: Object.keys(next).length ? next : null }); }}><X size={12} /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <small className="rtc-note">A component without a row is spent evenly over the whole construction window; the pre-operative cost always is.</small>

        <div className="rtc-subhead">Early and part commissioning</div>
        <table className="fin-v3-list" data-testid="fin-v3-parts">
          <thead><tr><th>Part</th><th>Share of the plant (%)</th><th>Months after the COD (negative: before)</th><th /></tr></thead>
          <tbody>
            {fin.parts.map((p, k) => (
              <tr key={k}>
                <td>Part {k + 1}</td>
                <td><input type="number" min={0} max={100} step={1} value={Math.round((p.share || 0) * 1000) / 10} onChange={(e) => list("parts", fin.parts.map((q, j) => (j === k ? { ...q, share: (Number(e.target.value) || 0) / 100 } : q)))} /></td>
                <td><input type="number" min={-24} max={36} step={1} value={p.offsetMonths ?? 0} onChange={(e) => list("parts", fin.parts.map((q, j) => (j === k ? { ...q, offsetMonths: Number(e.target.value) || 0 } : q)))} /></td>
                <td><button type="button" className="icon" onClick={() => list("parts", fin.parts.filter((_, j) => j !== k))}><X size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="fin-v3-row">
          <button type="button" className="secondary" data-testid="fin-v3-add-part" onClick={() => list("parts", [...fin.parts, { share: fin.parts.length ? 0 : 1, offsetMonths: 0 }])}><Plus size={12} /> Add a part</button>
          {fin.parts.length > 0 && <small className={Math.abs(partsTotal - 1) > 1e-6 ? "fin-v3-bad" : ""} data-testid="fin-v3-parts-sum">{Math.abs(partsTotal - 1) > 1e-6 ? `The shares add to ${(partsTotal * 100).toFixed(0)}%; they must add to 100%` : "The shares add to 100%"}</small>}
          {fin.parts.length === 0 && <small>No parts: the whole plant runs from the COD.</small>}
        </div>

        <div className="rtc-subhead">Prefinancing (bridge loan)</div>
        <div className="rtc-grid rtc-grid-4">
          <Field label="Bridge loan" unit="months" value={fin.bridge.months} onChange={(v) => sub("bridge", { months: Math.max(0, Math.round(v)) })} {...lp("fin.bridge.months")} step={1} min={0} max={months || 36} hint="The first months of construction are drawn on a bridge, then the term loan takes it out" />
          <Field label="Bridge rate" pct value={fin.bridge.rate ?? rawFin?.interestRate ?? 0} onChange={(v) => sub("bridge", { rate: v })} {...lp("fin.bridge.rate")} disabled={!(fin.bridge.months > 0)} step={0.05} min={0} max={25} hint={fin.bridge.rate === null ? "Same as the term loan until set" : "per year"} />
          <Field label="Take-out fee" pct value={fin.bridge.feePct} onChange={(v) => sub("bridge", { feePct: v })} {...lp("fin.bridge.feePct")} disabled={!(fin.bridge.months > 0)} step={0.1} min={0} max={5} hint="of the balance refinanced by the term loan, capitalised with the IDC" />
        </div>
      </Group>

      <Group id="generation" title="Generation and revenue" note="A P75 or P90 case, carbon credits, life beyond the PPA, solar repowering and battery augmentation on a schedule.">
        <div className="rtc-grid rtc-grid-4">
          <SelectBox label="Generation case" value={fin.generationCase} onChange={(v) => patchFin({ generationCase: v })} {...lp("fin.generationCase")} options={[["p50", "P50 (as modelled)"], ["p75", "P75"], ["p90", "P90"]]} hint="P75 and P90 scale the energy by the factors beside" />
          <Field label="P75 factor" value={fin.caseFactors.p75} onChange={(v) => sub("caseFactors", { p75: v })} {...lp("fin.caseFactors.p75")} step={0.01} min={0.5} max={1} digits={3} hint="of the P50 energy" />
          <Field label="P90 factor" value={fin.caseFactors.p90} onChange={(v) => sub("caseFactors", { p90: v })} {...lp("fin.caseFactors.p90")} step={0.01} min={0.5} max={1} digits={3} hint="of the P50 energy" />
        </div>
        <div className="rtc-subhead">Carbon credits</div>
        <div className="rtc-grid rtc-grid-4">
          <SwitchBox label="Carbon credit revenue" checked={fin.carbon.enabled} onChange={(v) => sub("carbon", { enabled: v })} {...lp("fin.carbon.enabled")} hint="On the energy delivered and sold" />
          <Field label="Emission factor" unit="t/MWh" value={fin.carbon.tPerMwh} onChange={(v) => sub("carbon", { tPerMwh: v })} {...lp("fin.carbon.tPerMwh")} disabled={!fin.carbon.enabled} step={0.01} min={0} max={2} digits={3} hint="Grid factor displaced" />
          <Field label="Credit price" unit="₹/t" value={fin.carbon.pricePerT} onChange={(v) => sub("carbon", { pricePerT: v })} {...lp("fin.carbon.pricePerT")} disabled={!fin.carbon.enabled} step={50} min={0} />
          <Field label="Years credited" unit="years" value={fin.carbon.years} onChange={(v) => sub("carbon", { years: Math.max(0, Math.round(v)) })} {...lp("fin.carbon.years")} disabled={!fin.carbon.enabled} step={1} min={0} max={25} />
          <Field label="Price escalation" pct value={fin.carbon.escalation} onChange={(v) => sub("carbon", { escalation: v })} {...lp("fin.carbon.escalation")} disabled={!fin.carbon.enabled} step={0.5} min={0} max={15} hint="per year" />
        </div>
        <div className="rtc-subhead">Life extension beyond the PPA</div>
        <div className="rtc-grid rtc-grid-4">
          <Field label="Extra years" unit="years" value={fin.extension.years} onChange={(v) => sub("extension", { years: Math.max(0, Math.round(v)) })} {...lp("fin.extension.years")} step={1} min={0} max={15} hint="0: the model ends with the PPA" />
          <Field label="Extension capex" unit="₹ cr" value={fin.extension.capexCr} onChange={(v) => sub("extension", { capexCr: v })} {...lp("fin.extension.capexCr")} disabled={!(fin.extension.years > 0)} step={5} min={0} hint="Spent in the last PPA year" />
          <Field label="Sale price after the PPA" unit="₹/kWh" value={fin.extension.tariffRsPerKwh ?? rawFin?.surplusPrice ?? 0} onChange={(v) => sub("extension", { tariffRsPerKwh: v })} {...lp("fin.extension.tariffRsPerKwh")} disabled={!(fin.extension.years > 0)} step={0.05} min={0} hint={fin.extension.tariffRsPerKwh === null ? "The surplus price until set" : "flat"} />
          <Field label="O&M factor" unit="×" value={fin.extension.omFactor} onChange={(v) => sub("extension", { omFactor: v })} {...lp("fin.extension.omFactor")} disabled={!(fin.extension.years > 0)} step={0.05} min={0.5} max={3} digits={2} hint="on the escalating O&M" />
          <Field label="Degradation after the PPA" pct value={fin.extension.degradation ?? rawFin?.solarDegradation ?? 0} onChange={(v) => sub("extension", { degradation: v })} {...lp("fin.extension.degradation")} disabled={!(fin.extension.years > 0)} step={0.05} min={0} max={5} hint={fin.extension.degradation === null ? "The solar degradation until set" : "per year"} />
        </div>
        <div className="rtc-subhead">Solar repowering</div>
        <div className="rtc-grid rtc-grid-4">
          <Field label="Repower in year" unit="year" value={fin.repower.year} onChange={(v) => sub("repower", { year: Math.max(0, Math.round(v)) })} {...lp("fin.repower.year")} step={1} min={0} max={25} hint="0: never" />
          <Field label="Repowering capex" unit="₹ cr" value={fin.repower.capexCr} onChange={(v) => sub("repower", { capexCr: v })} {...lp("fin.repower.capexCr")} disabled={!(fin.repower.year > 0)} step={5} min={0} />
          <Field label="Solar energy uplift" pct value={fin.repower.upliftPct} onChange={(v) => sub("repower", { upliftPct: v })} {...lp("fin.repower.upliftPct")} disabled={!(fin.repower.year > 0)} step={1} min={0} max={100} hint="from the year after" />
        </div>
        {bessAug && patchBess && (
          <>
            <div className="rtc-subhead">Battery augmentation on a schedule</div>
            <div className="rtc-grid rtc-grid-4">
              <SelectBox label="Augmentation" value={bessAug.augmentation || "none"} onChange={(v) => patchBess({ augmentation: v })} {...lp("bess.augmentation")} options={[["annual", "Every year to nameplate"], ["oneTime", "One-time restore"], ["schedule", "On a schedule (years below)"], ["none", "None"]]} />
              <label className="rtc-field">
                <div className="rtc-field-top"><span>Augmentation years</span></div>
                <input type="text" value={(bessAug.augmentationYears || []).join(", ")} disabled={bessAug.augmentation !== "schedule"} data-testid="fin-v3-aug-years" placeholder="6, 12, 18"
                  onChange={(e) => patchBess({ augmentationYears: e.target.value.split(/[,\s]+/).map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 1) })} />
                <small>In each year the capacity lost since the last augmentation is replaced at that year's battery price</small>
              </label>
            </div>
          </>
        )}
      </Group>

      <Group id="opex" title="Operating cost" note="O&M escalation by source, the wind O&M by component, and the other fixed costs as separate lines in the P&L.">
        <div className="rtc-grid rtc-grid-4">
          <Field label="Solar O&M escalation" pct value={fin.solarOmEscalation ?? rawFin?.omEscalation ?? 0} onChange={(v) => patchFin({ solarOmEscalation: v })} {...lp("fin.solarOmEscalation")} step={0.25} min={0} max={15} hint={fin.solarOmEscalation === null ? "The common escalation until set" : "per year"} />
          <Field label="Wind O&M escalation" pct value={fin.windOmEscalation ?? rawFin?.omEscalation ?? 0} onChange={(v) => patchFin({ windOmEscalation: v })} {...lp("fin.windOmEscalation")} step={0.25} min={0} max={15} hint={fin.windOmEscalation === null ? "The common escalation until set" : "per year"} />
          <Field label="Battery O&M escalation" pct value={fin.bessOmEscalation ?? rawFin?.omEscalation ?? 0} onChange={(v) => patchFin({ bessOmEscalation: v })} {...lp("fin.bessOmEscalation")} step={0.25} min={0} max={15} hint={fin.bessOmEscalation === null ? "The common escalation until set" : "per year"} />
        </div>
        <div className="rtc-subhead">Wind O&M by component</div>
        <LineList testid="fin-v3-wind-om" rows={fin.windOmComponents} onChange={(rows) => list("windOmComponents", rows)}
          columns={[["label", "Component", "text"], ["lakhPerMw", "₹ lakh/MW/yr", "number"], ["escalation", "Escalation %/yr", "pct"]]}
          blank={{ label: "Turbine service", lakhPerMw: 4, escalation: 0.04 }} addLabel="Add a component" empty="No components: the wind O&M per MW on the Design step is used as one line." />
        <div className="rtc-subhead">Other fixed costs</div>
        <LineList testid="fin-v3-other-fixed" rows={fin.otherFixedLines} onChange={(rows) => list("otherFixedLines", rows)}
          columns={[["label", "Line", "text"], ["crPerYear", "₹ cr/yr", "number"], ["escalation", "Escalation %/yr", "pct"]]}
          blank={{ label: "Solar park fees", crPerYear: 1, escalation: 0.04 }} addLabel="Add a line" empty="No lines: the single other fixed cost is used. Typical lines: solar park fees, audit fees, asset management fee, land lease." />
      </Group>

      <Group id="debt" title="Debt" note="An interest step-down after COD, a top-up loan, a prepayment penalty, a cash sweep, and the debt service reserve on the peak with interest.">
        <div className="rtc-grid rtc-grid-4">
          <SelectBox label="Repayment after refinancing" value={fin.refiRepayment || "same"} onChange={(v) => patchFin({ refiRepayment: v === "same" ? null : v })} {...lp("fin.refiRepayment")} options={[["same", "Same method"], ["equal", "Equal principal"], ["annuity", "Annuity"], ["sculpted", "Sculpted to the target DSCR"], ["balloon", "Balloon"], ["bullet", "Bullet"], ["stepUp", "Step-up"]]} hint="Re-sculpting applies from the refinancing year" />
          <Field label="Rate step-down after" unit="years" value={fin.rateStepDown.afterYears} onChange={(v) => sub("rateStepDown", { afterYears: Math.max(0, Math.round(v)) })} {...lp("fin.rateStepDown.afterYears")} step={1} min={0} max={25} hint="0: no step-down" />
          <Field label="Rate after the step-down" pct value={fin.rateStepDown.rate ?? rawFin?.interestRate ?? 0} onChange={(v) => sub("rateStepDown", { rate: v })} {...lp("fin.rateStepDown.rate")} disabled={!(fin.rateStepDown.afterYears > 0)} step={0.05} min={0} max={25} />
          <Field label="Top-up in year" unit="year" value={fin.topUp.year} onChange={(v) => sub("topUp", { year: Math.max(0, Math.round(v)) })} {...lp("fin.topUp.year")} step={1} min={0} max={25} hint="Usually 2 years after COD; 0: none" />
          <Field label="Debt share after the top-up" pct value={fin.topUp.debtFraction ?? rawFin?.debtFraction ?? 0} onChange={(v) => sub("topUp", { debtFraction: v })} {...lp("fin.topUp.debtFraction")} disabled={!(fin.topUp.year > 0)} step={1} min={0} max={95} hint="of the project cost; the new debt is paid out to equity" />
          <Field label="Prepayment penalty" pct value={fin.prepaymentPct} onChange={(v) => patchFin({ prepaymentPct: v })} {...lp("fin.prepaymentPct")} step={0.1} min={0} max={5} hint="on principal prepaid: refinancing take-out and cash sweep" />
          <Field label="Cash sweep" pct value={fin.sweep.pct} onChange={(v) => sub("sweep", { pct: v })} {...lp("fin.sweep.pct")} step={5} min={0} max={100} hint="of the free cash to equity, prepaying principal; unpaid amounts accrue" />
          <Field label="Sweep from year" unit="year" value={fin.sweep.fromYear} onChange={(v) => sub("sweep", { fromYear: Math.max(1, Math.round(v)) })} {...lp("fin.sweep.fromYear")} disabled={!(fin.sweep.pct > 0)} step={1} min={1} max={25} />
          <Field label="Sweep to year" unit="year" value={fin.sweep.toYear ?? rawFin?.tenorYears ?? 0} onChange={(v) => sub("sweep", { toYear: Math.max(1, Math.round(v)) })} {...lp("fin.sweep.toYear")} disabled={!(fin.sweep.pct > 0)} step={1} min={1} max={25} hint={fin.sweep.toYear === null ? "The tenor until set" : ""} />
          <SelectBox label="Debt service reserve basis" value={fin.dsraBasis} onChange={(v) => patchFin({ dsraBasis: v })} {...lp("fin.dsraBasis")} options={[["next", "Next year's debt service"], ["peak", "Peak of the years ahead"]]} hint="The swing each year is the amount put aside or released" />
          <Field label="Interest on the reserve" pct value={fin.dsraInterestRate} onChange={(v) => patchFin({ dsraInterestRate: v })} {...lp("fin.dsraInterestRate")} step={0.25} min={0} max={12} hint="booked in other income" />
        </div>
      </Group>

      <Group id="quasi" title="Quasi-equity and mezzanine" note="Promoter loans repaid when the lender's DSCR allows, with accrued interest; a mezzanine tranche with its own schedule. Both reduce the equity cheque.">
        <div className="rtc-subhead">Quasi-equity</div>
        <div className="rtc-grid rtc-grid-4">
          <Field label="Quasi-equity" unit="₹ cr" value={fin.quasi.amountCr} onChange={(v) => sub("quasi", { amountCr: v })} {...lp("fin.quasi.amountCr")} step={5} min={0} hint="Part of the funding, below the senior debt" />
          <Field label="Interest" pct value={fin.quasi.rate} onChange={(v) => sub("quasi", { rate: v })} {...lp("fin.quasi.rate")} disabled={!(fin.quasi.amountCr > 0)} step={0.25} min={0} max={25} hint="Accrues when the DSCR is below the lender's floor" />
          <Field label="Lender's minimum DSCR" unit="×" value={fin.quasi.lenderMinDscr} onChange={(v) => sub("quasi", { lenderMinDscr: v })} {...lp("fin.quasi.lenderMinDscr")} disabled={!(fin.quasi.amountCr > 0)} step={0.05} min={1} max={3} digits={2} hint="Interest and principal are paid only above it" />
          <Field label="Repay from year" unit="year" value={fin.quasi.repayFromYear} onChange={(v) => sub("quasi", { repayFromYear: Math.max(1, Math.round(v)) })} {...lp("fin.quasi.repayFromYear")} disabled={!(fin.quasi.amountCr > 0)} step={1} min={1} max={25} />
        </div>
        <div className="rtc-subhead">Mezzanine</div>
        <div className="rtc-grid rtc-grid-4">
          <Field label="Mezzanine" unit="₹ cr" value={fin.mezz.amountCr} onChange={(v) => sub("mezz", { amountCr: v })} {...lp("fin.mezz.amountCr")} step={5} min={0} hint="Part of the funding, below the senior debt" />
          <Field label="Interest" pct value={fin.mezz.rate} onChange={(v) => sub("mezz", { rate: v })} {...lp("fin.mezz.rate")} disabled={!(fin.mezz.amountCr > 0)} step={0.25} min={0} max={25} hint="Paid every year" />
          <Field label="Tenor" unit="years" value={fin.mezz.tenorYears} onChange={(v) => sub("mezz", { tenorYears: Math.max(1, Math.round(v)) })} {...lp("fin.mezz.tenorYears")} disabled={!(fin.mezz.amountCr > 0)} step={1} min={1} max={25} />
          <Field label="Moratorium" unit="years" value={fin.mezz.graceYears} onChange={(v) => sub("mezz", { graceYears: Math.max(0, Math.round(v)) })} {...lp("fin.mezz.graceYears")} disabled={!(fin.mezz.amountCr > 0)} step={1} min={0} max={10} />
          <SelectBox label="Repayment" value={fin.mezz.repayment} onChange={(v) => sub("mezz", { repayment: v })} {...lp("fin.mezz.repayment")} options={[["equal", "Equal principal"], ["bullet", "Bullet at the end"]]} />
          <Field label="Arrangement fee" pct value={fin.mezz.feePct} onChange={(v) => sub("mezz", { feePct: v })} {...lp("fin.mezz.feePct")} disabled={!(fin.mezz.amountCr > 0)} step={0.1} min={0} max={5} hint="of the amount, at drawdown" />
        </div>
      </Group>

      <Group id="guarantees" title="Guarantees" note="EMD, PBG, connectivity and statutory bank guarantees and surety bonds: their fees below EBITDA, the margin money blocked and the interest it earns.">
        <table className="fin-v3-list" data-testid="fin-v3-guarantee-list">
          <thead><tr><th>Guarantee</th><th>₹ cr</th><th>Fee %/yr</th><th>Margin %</th><th>Interest on margin %</th><th>From year (0: construction)</th><th>Years</th><th /></tr></thead>
          <tbody>
            {fin.guarantees.map((g, k) => {
              const upd = (values) => list("guarantees", fin.guarantees.map((q, j) => (j === k ? { ...q, ...values } : q)));
              return (
                <tr key={k}>
                  <td><input type="text" value={g.label || ""} onChange={(e) => upd({ label: e.target.value })} /></td>
                  <td><input type="number" min={0} step={0.5} value={g.amountCr ?? ""} onChange={(e) => upd({ amountCr: Number(e.target.value) || 0 })} /></td>
                  <td><input type="number" min={0} step={0.05} value={Math.round((g.feePct || 0) * 10000) / 100} onChange={(e) => upd({ feePct: (Number(e.target.value) || 0) / 100 })} /></td>
                  <td><input type="number" min={0} max={100} step={1} value={Math.round((g.marginPct || 0) * 1000) / 10} onChange={(e) => upd({ marginPct: (Number(e.target.value) || 0) / 100 })} /></td>
                  <td><input type="number" min={0} step={0.25} value={Math.round((g.marginRate || 0) * 10000) / 100} onChange={(e) => upd({ marginRate: (Number(e.target.value) || 0) / 100 })} /></td>
                  <td><input type="number" min={0} step={1} value={g.fromYear ?? 0} onChange={(e) => upd({ fromYear: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /></td>
                  <td><input type="number" min={1} step={1} value={g.years ?? 1} onChange={(e) => upd({ years: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /></td>
                  <td><button type="button" className="icon" onClick={() => list("guarantees", fin.guarantees.filter((_, j) => j !== k))}><X size={12} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="fin-v3-row">
          {GUARANTEE_PRESETS.map((p) => (
            <button key={p.id} type="button" className="secondary" data-testid={`fin-v3-guarantee-${p.id}`} onClick={() => list("guarantees", [...fin.guarantees, { label: p.label, amountCr: 0, feePct: p.feePct, marginPct: p.marginPct, marginRate: p.marginRate, fromYear: p.fromYear, years: p.years }])}><Plus size={12} /> {p.label}</button>
          ))}
        </div>
        {fin.guarantees.length === 0 && <small className="rtc-note">No guarantees in the model. Add the ones the tender asks for and fill the amounts.</small>}
      </Group>

      <Group id="tax" title="Tax and depreciation" note="Book depreciation on a straight line or on written-down value, component lives, thin capitalisation and the loss carry-forward.">
        <div className="rtc-grid rtc-grid-4">
          <SelectBox label="Book depreciation" value={fin.bookDepreciation} onChange={(v) => patchFin({ bookDepreciation: v })} {...lp("fin.bookDepreciation")} options={[["slm", "Straight line"], ["wdv", "Written-down value"]]} hint="Both are worked out; this one feeds the P&L and the net block" />
          <Field label="Thin capitalisation cap" pct value={fin.thinCapPct} onChange={(v) => patchFin({ thinCapPct: v })} {...lp("fin.thinCapPct")} step={5} min={0} max={100} hint="of EBITDA: interest on quasi-equity and mezzanine above it is carried forward; 0: off" />
          <Field label="Loss carry-forward" unit="years" value={fin.lossCarryYears} onChange={(v) => patchFin({ lossCarryYears: Math.max(0, Math.round(v)) })} {...lp("fin.lossCarryYears")} step={1} min={0} max={20} hint="Business losses lapse after; unabsorbed depreciation never does" />
        </div>
        <div className="rtc-subhead">Book life by component (years; empty: the book life above)</div>
        <div className="rtc-grid rtc-grid-4" data-testid="fin-v3-lives">
          {PHASING_COMPONENTS.map(([key, label]) => (
            <Field key={key} label={label} unit="years" value={fin.lives?.[key] ?? rawFin?.bookLifeYears ?? 25} onChange={(v) => patchFin({ lives: { ...(fin.lives || {}), [key]: Math.max(1, Math.round(v)) } })} {...lp(`fin.lives.${key}`)} step={1} min={1} max={40} hint={fin.lives?.[key] ? "" : "Book life until set"} />
          ))}
        </div>
      </Group>

      <Group id="returns" title="Returns" note="Returns at the holding company and the promoter, and the lender's XIRR and MIRR.">
        <div className="rtc-grid rtc-grid-4">
          <Field label="HoldCo expenses" unit="₹ cr/yr" value={fin.holdco.expensesCrPerYear} onChange={(v) => sub("holdco", { expensesCrPerYear: v })} {...lp("fin.holdco.expensesCrPerYear")} step={0.25} min={0} hint="The holding company funds the equity and the quasi-equity" />
          <Field label="Promoter's share of the HoldCo" pct value={fin.holdco.promoterShare} onChange={(v) => sub("holdco", { promoterShare: Math.min(1, Math.max(0, v)) })} {...lp("fin.holdco.promoterShare")} step={5} min={0} max={100} />
          <Field label="Lender's reinvestment rate" pct value={fin.lenderReinvestRate ?? rawFin?.interestRate ?? 0} onChange={(v) => patchFin({ lenderReinvestRate: v })} {...lp("fin.lenderReinvestRate")} step={0.25} min={0} max={25} hint={fin.lenderReinvestRate === null ? "The senior rate until set (for the MIRR)" : "for the MIRR"} />
        </div>
      </Group>

      <Group id="sensitivity" title="Sensitivity for the reverse auction" note="What the tariff needs when the capex, the module price, the exchange rate, the interest, the generation case, a commissioning delay, a longer life or the refinancing move.">
        <div className="rtc-grid rtc-grid-4">
          <Field label="Capex in foreign currency" pct value={fin.capexUsdShare} onChange={(v) => patchFin({ capexUsdShare: v })} {...lp("fin.capexUsdShare")} step={5} min={0} max={100} hint="of the hard cost, exposed to the exchange rate" />
          <Field label="Exchange rate" unit="₹/USD" value={fin.fxBase} onChange={(v) => patchFin({ fxBase: v })} {...lp("fin.fxBase")} step={0.5} min={1} digits={2} />
          <Field label="Modules in the solar capex" pct value={costs.moduleSharePct} onChange={(v) => patchCosts({ moduleSharePct: v })} {...lp("costs.moduleSharePct")} step={5} min={0} max={100} hint="the module-price axis moves this share" />
        </div>
        <small className="rtc-note">The table is on the Financial model step (F.8 Reverse-auction sensitivity).</small>
      </Group>
    </div>
  );
}

function Group({ id, title, note, children }) {
  return (
    <details className="fin-v3-group" data-testid={`fin-v3-${id}`}>
      <summary><strong>{title}</strong><span>{note}</span></summary>
      <div className="fin-v3-body">{children}</div>
    </details>
  );
}

/** A small editable list: one row per line, columns [key, heading, kind] with kind text | number | pct. */
function LineList({ rows, onChange, columns, blank, addLabel, empty, testid }) {
  const upd = (k, values) => onChange(rows.map((r, j) => (j === k ? { ...r, ...values } : r)));
  return (
    <>
      {rows.length > 0 && (
        <table className="fin-v3-list" data-testid={testid}>
          <thead><tr>{columns.map(([key, head]) => <th key={key}>{head}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, k) => (
              <tr key={k}>
                {columns.map(([key, , kind]) => (
                  <td key={key}>
                    {kind === "text" && <input type="text" value={r[key] ?? ""} onChange={(e) => upd(k, { [key]: e.target.value })} />}
                    {kind === "number" && <input type="number" step="any" value={r[key] ?? ""} onChange={(e) => upd(k, { [key]: e.target.value === "" ? null : Number(e.target.value) })} />}
                    {kind === "pct" && <input type="number" step={0.25} value={r[key] === null || r[key] === undefined ? "" : Math.round(r[key] * 10000) / 100} onChange={(e) => upd(k, { [key]: e.target.value === "" ? null : Number(e.target.value) / 100 })} />}
                  </td>
                ))}
                <td><button type="button" className="icon" onClick={() => onChange(rows.filter((_, j) => j !== k))}><X size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="fin-v3-row">
        <button type="button" className="secondary" data-testid={`${testid}-add`} onClick={() => onChange([...rows, { ...blank }])}><Plus size={12} /> {addLabel}</button>
        {rows.length === 0 && <small>{empty}</small>}
      </div>
    </>
  );
}
