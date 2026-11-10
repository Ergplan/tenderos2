import React from "react";
import { Sparkles, TriangleAlert } from "lucide-react";
import { Field, SelectBox } from "../rtc/ui";
import AssignButton from "../team/AssignButton";
import { BENCHMARK_NOTE, CHOICES, FIELDS, WINNING, fillWinning } from "./model.js";

/**
 * The input boxes of the CfD tab, shared by the Bid inputs, Design and Finance inputs steps. Every
 * box is a Field or SelectBox of ../rtc/ui, so the team's pings, the evidence paperclip and
 * feedback find it like any other box, and each number box carries an Assign button
 * (target key inputs.<key>, applied by CfdTab's acceptAnswer).
 */

/** Number inputs of one section (or only the keys listed); a benchmark value is marked until changed. */
export function Fields({ state, setInput, section, only, lockProps = null }) {
  const list = FIELDS.filter((f) => f.section === section && (!only || only.includes(f.key)));
  return (
    <div className="rtc-grid rtc-grid-4 cfd-fields">
      {list.map((f) => (
        <div key={f.key} className={`has-assign ${state.filled[f.key] ? "bid-benchmark" : ""}`} data-testid={`cfd-in-${f.key}`} data-voice={`inputs.${f.key}`}>
          <Field label={f.label} unit={f.pct ? undefined : f.unit} pct={Boolean(f.pct)} value={state.inputs[f.key]} step={f.step} min={f.min} max={f.max} allowEmpty={Boolean(f.optional)}
            onChange={(v) => setInput(f.key, v)} hint={[f.pct && f.unit !== "%" ? f.unit : null, state.filled[f.key] ? "benchmark" : null, f.hint].filter(Boolean).join(" · ")}
            {...(lockProps ? lockProps(`inputs.${f.key}`) : {})} />
          <AssignButton compact target={{ kind: f.section === "fin" ? "finance" : f.section === "costs" ? "cost" : "field", key: `inputs.${f.key}`, label: f.label, context: { unit: f.unit, pct: Boolean(f.pct), type: "number" } }} />
        </div>
      ))}
    </div>
  );
}

/** One choice of CHOICES as a select; yesNo turns a true/false/null choice into Yes / No. */
export function Choice({ state, setInput, k, yesNo = false, lockProps = null }) {
  const c = CHOICES[k];
  const value = state.inputs[k];
  const options = yesNo ? [["", "Choose"], ["yes", "Yes"], ["no", "No"]] : [["", "Choose"], ...c.options];
  const shown = yesNo ? (value === true ? "yes" : value === false ? "no" : "") : (value ?? "");
  return (
    <div className={state.filled[k] ? "bid-benchmark" : ""} data-testid={`cfd-in-${k}`} data-voice={`inputs.${k}`}>
      <SelectBox label={c.label} value={shown} options={options} hint={[state.filled[k] ? "benchmark" : null, c.hint].filter(Boolean).join(" · ")}
        onChange={(v) => setInput(k, yesNo ? (v === "yes" ? true : v === "no" ? false : null) : (v || null))} {...(lockProps ? lockProps(`inputs.${k}`) : {})} />
    </div>
  );
}

/** A date box in the same frame as a Field. */
export function DateBox({ label, value, onChange, hint, testId, voice }) {
  return (
    <div className="rtc-field" data-testid={testId} data-voice={voice}>
      <div className="rtc-field-top"><span>{label}</span></div>
      <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label} />
      {hint && <small>{hint}</small>}
    </div>
  );
}

/** "Fill up for me please" with what it does and how many inputs are still needed. */
export function FillBar({ state, setState, missing, optimise = null, testId = "cfd-fill" }) {
  const fill = () => {
    setState((s) => fillWinning(s));
    // the own RE sized for the least strike price once the fill is in (the tab reads the new state)
    if (optimise) setTimeout(() => optimise(), 120);
  };
  return (
    <div className="cfd-fill-bar">
      <button type="button" className="secondary" onClick={fill} data-testid={testId}>
        <Sparkles size={14} /> Fill up for me please
      </button>
      <span className="rtc-note">Puts a competitive bidder's value in every empty box (battery ₹{WINNING.essCrPerMwh} cr/MWh, solar ₹{WINNING.solarCrPerMw} cr/MWac, group RE at ₹{WINNING.groupPrice} after month 36, {Math.round(WINNING.targetEquityIrr * 100)}% equity, {(WINNING.interestRate * 100).toFixed(2)}% debt over {WINNING.tenorYears} years sculpted to the lender's DSCR, no extra battery, annual augmentation), the industry benchmark elsewhere, then sizes the own RE for the least strike price. Marked until your own figures replace them; the Reference bids step says why these win.</span>
      {missing.length > 0 && <span className="cfd-missing" data-testid="cfd-missing"><TriangleAlert size={12} /> {missing.length} input{missing.length > 1 ? "s" : ""} needed</span>}
    </div>
  );
}
