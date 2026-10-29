import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Crosshair, Loader2, SlidersHorizontal } from "lucide-react";
import { Field, Section, nf, pf } from "../rtc/ui";
import { LEVERS, leverEffects, withLever } from "./levers";

const fmtV = (v, l) => (l.pct ? pf(v, 2) : nf(v, l.step < 0.01 ? 4 : l.step < 1 ? 2 : 0));

/**
 * Bid day: which levers move the tariff, by how much, and how far each would have to move on its
 * own to reach the tariff the bidder wants to quote. Every row is two runs of the model (the
 * lever a step up and a step down); "Apply" moves the case's input to the reach value.
 */
export default function LeverPanel({ state, setState, prices, base, index = "4" }) {
  const [target, setTarget] = useState(() => Number((base * 0.95).toFixed(2)));
  const [computed, setComputed] = useState(null); // { key, result }
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => JSON.stringify([state, target]), [state, target]);
  const stale = !computed || computed.key !== key;
  const compute = () => {
    setBusy(true);
    // let the button repaint before the runs (about a second for every lever)
    setTimeout(() => {
      try { setComputed({ key, result: leverEffects(state, { prices, target, base }) }); } finally { setBusy(false); }
    }, 20);
  };
  const res = computed?.result;
  const apply = (row) => {
    const lever = LEVERS.find((l) => l.id === row.id);
    if (lever && row.reachable) setState(withLever(state, lever, row.reach));
  };
  return (
    <Section index={index} title="Tariff levers for bid day" note="What moves the tariff you need, and how far each lever alone would have to go to reach the tariff you want to quote" className="lever-panel">
      <div className="lever-head">
        <Field label="Tariff you want to quote" unit="₹/kWh" value={target} onChange={(v) => setTarget(v)} step={0.01} min={0} digits={3} hint={`the model needs ₹${nf(base, 3)} for the target IRR: ${target < base ? `₹${nf(base - target, 3)} to find` : "already there"}`} />
        <button type="button" className="primary" onClick={compute} disabled={busy} data-testid="lever-compute">
          {busy ? <Loader2 className="spin" size={14} /> : <SlidersHorizontal size={14} />} {res && !stale ? "Levers up to date" : res ? "Recompute the levers" : "Compute the levers"}
        </button>
        {res && stale && <small className="lever-stale">The case changed: recompute</small>}
      </div>
      {res && (
        <div className="table-wrap rtc-model fin-table lever-table">
          <table data-testid="lever-table">
            <thead><tr><th>Lever</th><th>Now</th><th>One step</th><th>Tariff if up</th><th>Tariff if down</th><th>₹/kWh per step</th><th>To reach ₹{nf(target, 3)} alone</th><th /></tr></thead>
            <tbody>
              {res.levers.map((row) => {
                const lever = LEVERS.find((l) => l.id === row.id);
                const helps = (target - res.base) * row.slope; // the direction that moves the tariff toward the target
                return (
                  <tr key={row.id} data-testid={`lever-${row.id}`}>
                    <td>{row.label} <small>{row.unit}</small></td>
                    <td>{fmtV(row.value, lever)}</td>
                    <td>±{fmtV(row.step, lever)}</td>
                    <td>{nf(row.tariffUp, 3)} {row.tariffUp > res.base ? <ArrowUp size={11} className="bad" /> : <ArrowDown size={11} className="good" />}</td>
                    <td>{nf(row.tariffDown, 3)} {row.tariffDown > res.base ? <ArrowUp size={11} className="bad" /> : <ArrowDown size={11} className="good" />}</td>
                    <td className={Math.abs(row.perStep) >= 0.05 ? "lever-big" : ""}>{row.perStep >= 0 ? "+" : "−"}{nf(Math.abs(row.perStep), 4)}</td>
                    <td>{row.reach === null ? "–" : row.reachable ? <span>{fmtV(row.reach, lever)} <small>({helps < 0 ? "down" : "up"} {fmtV(Math.abs(row.reach - row.value), lever)})</small></span> : <small>not within its range</small>}</td>
                    <td>{row.reachable && Math.abs(row.reach - row.value) > 1e-9 && <button type="button" className="secondary" onClick={() => apply(row)} data-testid={`lever-apply-${row.id}`}><Crosshair size={11} /> Apply</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="rtc-note">Each row is the model run with that input one step up and one step down, everything else as in the case; the reach is the straight-line move of that lever alone, so use it as a direction, then recompute. Levers that cannot move in this case (a source not in the plant) are left out.</p>
        </div>
      )}
    </Section>
  );
}
