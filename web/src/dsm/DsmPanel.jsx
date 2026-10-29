import React, { useMemo } from "react";
import { Activity } from "lucide-react";
import { Field, SelectBox, Section, Stat, SwitchBox, nf, pf } from "../rtc/ui";
import { DSM_CATEGORIES, DSM_DEFAULTS, SIGMA_DEFAULT, dsmCategory, dsmNote, dsmUnitCharge, sigmaOf } from "./dsm";

/**
 * Deviation settlement (CERC DSM) norms and the forecast-error assumption, with what they cost
 * per MWh scheduled year by year. dsm: the settings (DSM_DEFAULTS); onChange(patch); sources: the
 * sources switched on (for the category and the battery's firming); tariff: the contract rate for
 * the readout; scheduledMu: year-1 energy scheduled, for the ₹ crore readout.
 */
export default function DsmPanel({ dsm, onChange, sources, tariff = 5, scheduledMu = null, index = "F.1d", lockProps = () => ({}) }) {
  const d = { ...DSM_DEFAULTS, ...dsm };
  const category = dsmCategory(d, sources);
  const hasStorage = Boolean(sources?.bess);
  const years = useMemo(() => [1, 2, 3, 4, 5, 6, 10].map((y) => ({ year: y, ...dsmUnitCharge({ dsm: d, category, hasStorage, year: y, contract: tariff }) })), [d, category, hasStorage, tariff]);
  const y1 = years[0];
  const sigma = sigmaOf(d, category, hasStorage);
  const setStep = (i, k, v) => onChange({ steps: d.steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  return (
    <Section index={index} title="Deviation settlement (CERC DSM)" note="What the plant pays when it injects more or less than its day-ahead schedule, from the forecast error, the tolerance band and the X factor of the year" className="dsm-panel">
      <div className="rtc-stats" data-testid="dsm-stats">
        <Stat label="Charge per MWh scheduled" value={d.on === false ? "off" : `₹${nf(y1.perMwh, 1)}`} detail={`year 1 (FY${y1.fy}) at ₹${nf(tariff, 2)}/kWh; year 6 ₹${nf(years[5].perMwh, 1)}`} />
        <Stat label="Blocks outside the band" value={pf(y1.outOfBand, 0)} detail={`error σ ${pf(sigma, 1)} of the schedule${hasStorage ? `, after the battery firms ${pf(d.storageFirming, 0)} of it` : ""}; band ±${pf(y1.tolerance, 0)}`} />
        <Stat label="X factor" value={pf(y1.x, 0)} detail={`FY${y1.fy}: the in-band share settled at the contract rate; ${pf(years[5].x, 0)} by FY${years[5].fy}`} />
        {scheduledMu !== null && <Stat label="Year-1 charge" value={d.on === false ? "₹0 cr" : `₹${nf((scheduledMu * y1.perMwh) / 1e4, 1)} cr`} detail={`${nf(scheduledMu, 0)} MU scheduled`} />}
      </div>
      <div className="rtc-grid rtc-grid-4">
        <SwitchBox label="Apply DSM charges" checked={d.on !== false} onChange={(v) => onChange({ on: v })} {...lockProps("dsm.on")} />
        <SelectBox label="Seller category" value={d.category || "auto"} onChange={(v) => onChange({ category: v })} {...lockProps("dsm.category")} options={[["auto", `By the sources (${DSM_CATEGORIES[category]})`], ...Object.entries(DSM_CATEGORIES)]} />
        <Field label="Forecast error (σ)" pct value={d.sigmaPct ?? SIGMA_DEFAULT[category]} onChange={(v) => onChange({ sigmaPct: v })} {...lockProps("dsm.sigmaPct")} step={0.5} min={0} max={40} hint="of the schedule in a 15-minute block, before the battery" />
        <Field label="Battery firming" pct value={d.storageFirming} onChange={(v) => onChange({ storageFirming: v })} {...lockProps("dsm.storageFirming")} step={5} min={0} max={90} hint={hasStorage ? "share of the error the battery takes out" : "no battery: not applied"} disabled={!hasStorage} />
        <Field label="Normal rate when short" unit="₹/kWh" value={d.normalUnder} onChange={(v) => onChange({ normalUnder: v })} {...lockProps("dsm.normalUnder")} step={0.1} min={0} hint="the market in the blocks the plant under-injects" />
        <Field label="Normal rate when long" unit="₹/kWh" value={d.normalOver} onChange={(v) => onChange({ normalOver: v })} {...lockProps("dsm.normalOver")} step={0.1} min={0} hint="the market in the blocks it over-injects" />
        <Field label="First year of operation" unit="FY" value={d.codFy} onChange={(v) => onChange({ codFy: Math.round(v) })} {...lockProps("dsm.codFy")} step={1} min={2025} max={2040} hint="FY2027-28 is 2028; sets the band and the X factor by year" />
      </div>
      <div className="table-wrap rtc-model fin-table dsm-steps">
        <table>
          <thead><tr><th>Beyond the tolerance band, in steps of the schedule</th><th>Step width</th><th>Under-injection charged at</th><th>Over-injection paid at</th></tr></thead>
          <tbody>
            {d.steps.map((s, i) => (
              <tr key={i}>
                <td>Step {i + 1}{i === d.steps.length - 1 ? " (and beyond)" : ""}</td>
                <td>{Number.isFinite(s.width) ? <input type="number" value={Math.round(s.width * 100)} min={1} max={100} step={1} onChange={(e) => setStep(i, "width", Number(e.target.value) / 100)} aria-label={`Step ${i + 1} width`} /> : "rest"}{Number.isFinite(s.width) ? " %" : ""}</td>
                <td><input type="number" value={Math.round(s.under * 100)} min={100} max={400} step={5} onChange={(e) => setStep(i, "under", Number(e.target.value) / 100)} aria-label={`Step ${i + 1} under-injection`} /> % of the contract rate</td>
                <td><input type="number" value={Math.round(s.over * 100)} min={0} max={100} step={5} onChange={(e) => setStep(i, "over", Number(e.target.value) / 100)} aria-label={`Step ${i + 1} over-injection`} /> % of the contract rate</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap rtc-model fin-table">
        <table>
          <thead><tr><th>Year</th><th>FY</th><th>Band</th><th>X</th><th>Outside the band</th><th>₹/MWh scheduled</th></tr></thead>
          <tbody>{years.map((y) => <tr key={y.year}><td>Y{y.year}</td><td>{y.fy}</td><td>±{pf(y.tolerance, 0)}</td><td>{pf(y.x, 0)}</td><td>{pf(y.outOfBand, 0)}</td><td>{nf(y.perMwh, 1)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="rtc-note"><Activity size={12} /> {dsmNote(d, category)}. The structure follows the CERC (Deviation Settlement and Related Matters) Regulations, 2024 and the April 2026 tightening (bands ±5% solar and hybrid, ±10% wind; X from 100% in FY2026-27 to 0 from FY2031-32); check the numbers against the notified text and the orders of the day. The error is taken as normal in each block; a battery that firms the schedule cuts it.</p>
    </Section>
  );
}
