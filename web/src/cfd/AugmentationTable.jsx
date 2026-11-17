import React from "react";
import { SelectBox, nf, pf } from "../rtc/ui";
import { TENDER } from "./terms.js";
import { CHOICES, augmentationByYear, impliedAugmentation, patchCfdBess } from "./model.js";

const LABELS = {
  annual: "Augment every year (keep the MWh)",
  none: "No augmentation (capacity fades)",
  byYear: "Year by year (the table below)",
  oneTime: "One-time restore (year on the Finance inputs)",
  schedule: "On a schedule (years on the Finance inputs)",
};

/**
 * "Battery capacity over the term" on the Design step: the choice, and under it the augmentation
 * of every operating year as an input. The table always shows what the bid's present choice does
 * each year (the capacity added, its MWh and cost, the usable capacity that results); typing a
 * year's capacity or cost makes the choice "Year by year", starting from additions that keep the
 * capacity the present choice keeps. The same table is on the Finance inputs (battery
 * augmentation); both write state.bess, which the day-by-day operation and the financial model read.
 * Props: state, setState, lockProps.
 */
export default function AugmentationTable({ state, setState, lockProps = null }) {
  const chosen = state.bess?.augmentation || state.inputs?.augmentation || "";
  const lock = lockProps ? lockProps("inputs.augmentation") : {};
  const years = TENDER.termYears;
  const rows = augmentationByYear(state, years);
  const byYear = chosen === "byYear";
  const ready = Boolean(chosen) && state.inputs?.contractedMw > 0 && state.inputs?.essMwhPerMw > 0;
  const options = [["", "Choose"], ...["annual", "none", "byYear"].map((k) => [k, LABELS[k]]), ...(["oneTime", "schedule"].includes(chosen) ? [[chosen, LABELS[chosen]]] : [])];
  const choose = (v) => setState((s) => (v ? patchCfdBess(s, { augmentation: v, ...(v === "byYear" && !(s.bess?.augmentationPct || []).some((x) => x > 0) ? { augmentationPct: impliedAugmentation(s, years), augmentationCr: [] } : {}) }) : { ...s, inputs: { ...s.inputs, augmentation: null }, bess: { ...(s.bess || {}), augmentation: null } }));
  // a year typed: the choice becomes "year by year", from the additions that keep the present capacity
  const setYear = (key, year, text, scale) => setState((s) => {
    const seed = s.bess?.augmentation === "byYear" ? null : impliedAugmentation(s, years);
    const pct = (seed || s.bess?.augmentationPct || []).slice();
    const cr = (seed ? [] : s.bess?.augmentationCr || []).slice();
    const arr = key === "augmentationPct" ? pct : cr;
    while (arr.length <= year) arr.push(0);
    const v = Number(text);
    arr[year] = text === "" || !Number.isFinite(v) || v < 0 ? 0 : v * scale;
    return patchCfdBess(s, { augmentation: "byYear", augmentationPct: pct.map((x) => x || 0), augmentationCr: cr.map((x) => x || 0) });
  });
  const shown = (v, scale, digits) => (v > 0 ? String(Number((v / scale).toFixed(digits))) : "");
  const total = rows.reduce((a, r) => a + r.costCr, 0);
  const firstShort = rows.find((r) => r.short);

  return (
    <div className="aug-table" data-testid="cfd-augmentation">
      <div className="rtc-grid rtc-grid-4 cfd-fields">
        <div className={state.filled?.augmentation && !state.bess?.augmentation ? "bid-benchmark" : ""} data-testid="cfd-in-augmentation" data-voice="inputs.augmentation">
          <SelectBox label={CHOICES.augmentation.label} value={chosen} options={options} onChange={choose} {...lock}
            hint={[state.filled?.augmentation && !state.bess?.augmentation ? "benchmark" : null, byYear ? "each year is yours to set" : "type in a year below to set it year by year"].filter(Boolean).join(" · ")} />
        </div>
      </div>
      {ready && (
        <>
          <div className="table-wrap aug-table-wrap">
            <table data-testid="cfd-augmentation-table">
              <thead><tr><th>Operating year</th>{rows.map((r) => <th key={r.year}>{r.year}</th>)}<th>Term</th></tr></thead>
              <tbody>
                <tr>
                  <th>Capacity added at the start of the year, % of nameplate</th>
                  {rows.map((r) => (
                    <td key={r.year}>{r.year < 2 ? <span className="aug-na">plant</span> : (
                      <input type="number" min="0" max="100" step="0.5" disabled={lock.locked} value={shown(r.pct, 0.01, 2)} placeholder="0" aria-label={`Capacity added in year ${r.year}, percent of nameplate`}
                        data-testid={`cfd-aug-pct-${r.year}`} onChange={(e) => setYear("augmentationPct", r.year, e.target.value, 0.01)} />
                    )}</td>
                  ))}
                  <td>{pf(rows.reduce((a, r) => a + r.pct, 0), 1)}</td>
                </tr>
                <tr>
                  <th>MWh added</th>
                  {rows.map((r) => <td key={r.year}>{r.mwh > 0.05 ? nf(r.mwh, r.mwh < 10 ? 1 : 0) : "–"}</td>)}
                  <td>{nf(rows.reduce((a, r) => a + r.mwh, 0), 0)}</td>
                </tr>
                <tr>
                  <th>Cost, ₹ cr <small>(blank: the MWh at that year's battery price)</small></th>
                  {rows.map((r) => (
                    <td key={r.year}>{r.year < 2 ? <span className="aug-na">capex</span> : (
                      <input type="number" min="0" step="0.1" disabled={lock.locked} value={r.entered ? shown(r.costCr, 1, 2) : ""} placeholder={r.costCr > 0.005 ? nf(r.costCr, 2) : "0"} aria-label={`Augmentation cost in year ${r.year}, rupees crore`}
                        data-testid={`cfd-aug-cr-${r.year}`} onChange={(e) => setYear("augmentationCr", r.year, e.target.value, 1)} />
                    )}</td>
                  ))}
                  <td>₹{nf(total, 1)}</td>
                </tr>
                <tr>
                  <th>Usable capacity in the year, % of nameplate</th>
                  {rows.map((r) => <td key={r.year} className={r.short ? "aug-short" : undefined} title={r.short ? "Below the daily supply at your availability: days fall short" : undefined} data-testid={`cfd-aug-cap-${r.year}`}>{pf(r.factor, 1)}</td>)}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <small className="aug-note" data-testid="cfd-augmentation-note">
            {byYear
              ? "Each addition fades from the year it is added, like the nameplate, so the capacity can stand above 100%. A cost typed for a year is used as it is; a cost without a capacity is spent and adds no MWh."
              : `What "${LABELS[chosen] || chosen}" does each year. Typing a capacity or a cost switches to Year by year, starting from the additions that keep this capacity (each addition fades from its own year, so keeping the capacity takes a little more each year than the fade).`}
            {firstShort ? ` From year ${firstShort.year} the usable capacity is below the daily supply at your availability (marked): days fall short from then.` : ""}
            {" "}The day-by-day operation and the financial model both run on these years; the grey cost is at the battery price falling {pf(state.inputs?.augDecline || 0, 1)} a year (Costs, below).
          </small>
        </>
      )}
    </div>
  );
}
