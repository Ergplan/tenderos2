import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Crosshair, Loader2, SlidersHorizontal, Square } from "lucide-react";
import { Field, Section, Stat, nf, pf } from "../rtc/ui";
import { quoteOf, quotedStrikeReturns, runCfdFinance } from "./finance.js";
import { cfdLeverEffects, withCfdLever } from "./levers.js";
import "./finance.css";

const fmtV = (v, l) => (l.pct ? pf(v, 2) : nf(v, l.step < 0.01 ? 4 : l.step < 1 ? 2 : 0));

/**
 * The What-if step of the CfD bid, for bid day: the returns at a strike price you type, and the
 * levers: every input moved one step up and one step down, the strike price the target equity
 * IRR then needs, and how far that lever alone would have to move to reach the price you want to
 * quote. Operation levers (sizes, resource, sourcing prices) re-run the day-by-day operation;
 * cost and financing levers re-price the same operation. "Apply" writes the input into the bid.
 * Props: state, setState, model (runModel), prices, goto.
 */
export default function WhatIfStep({ state, setState, model, prices, goto }) {
  const finance = useMemo(() => (model?.sim ? runCfdFinance({ ...state, tariffLocked: false }, model) : null), [model, state.fin, state.costs]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = finance?.tariff ?? null;
  const [target, setTarget] = useState(null);
  const [tried, setTried] = useState(null);
  const [computed, setComputed] = useState(null); // { key, result }
  const [progress, setProgress] = useState(null);
  const abortRef = useRef(null);
  useEffect(() => { if (base !== null && target === null) setTarget(Number((quoteOf(base) * 0.95).toFixed(2))); }, [base, target]);
  const caseKey = useMemo(() => JSON.stringify([state.inputs, state.fin, state.costs, target]), [state.inputs, state.fin, state.costs, target]);
  const stale = !computed || computed.key !== caseKey;
  const quoted = useMemo(() => (finance && tried !== null ? quotedStrikeReturns(state, model, finance, tried) : null), [state, model, finance, tried]);

  if (!model?.sim || !finance) {
    return (
      <Section index="6" title="What-if">
        <p className="rtc-note">Size the plant first: the levers move the strike price of the sized bid.</p>
        <button type="button" className="primary" onClick={() => goto?.("size")}>Go to sizing</button>
      </Section>
    );
  }

  async function compute() {
    if (progress) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setProgress({ done: 0, total: 1 });
    try {
      const result = await cfdLeverEffects(state, model, prices, { target, signal: abort.signal, onProgress: (done, total) => setProgress({ done, total }) });
      setComputed({ key: caseKey, result });
    } catch (err) {
      if (!/Stopped/.test(err.message)) window.alert(err.message);
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  }
  const res = computed?.result;
  const apply = (row) => { if (row.reachable) setState((s) => withCfdLever(s, row, row.reach)); };
  const irrText = (v) => (Number.isFinite(v) ? pf(v, 2) : "none");

  return (
    <div data-testid="cfd-whatif">
      <Section index="6" title="Returns at a strike price" note="What a price earns on the sized bid, against the price the target equity IRR needs">
        <div className="rtc-grid rtc-grid-4">
          <Field label="Strike price to try" unit="₹/kWh" value={tried ?? quoteOf(base)} onChange={(v) => setTried(v)} step={0.01} min={0} digits={3} hint={`the model needs ₹${nf(base, 3)} for a ${pf(finance.engine.fin.targetEquityIrr, 1)} equity IRR`} />
          <Stat label="Equity IRR" value={quoted ? irrText(quoted.equityIrr) : pf(finance.equityIrr, 2)} detail={quoted ? `target ${pf(quoted.targetEquityIrr, 2)}` : "at the solved price"} tone={quoted && quoted.status !== "ok" ? "bad" : undefined} />
          <Stat label="Project IRR" value={quoted ? irrText(quoted.projectIrr) : pf(finance.projectIrr, 2)} detail="post-tax, unlevered" tone={quoted && quoted.status !== "ok" ? "bad" : undefined} />
          <Stat label="Minimum DSCR" value={quoted ? nf(quoted.minDscr, 2) : nf(finance.minDscr, 2)} detail={quoted ? `${quoted.gap >= 0 ? "+" : "−"}₹${nf(Math.abs(quoted.gap), 3)} against the solved price` : `average ${nf(finance.avgDscr, 2)}`} tone={(quoted ? quoted.minDscr : finance.minDscr) < 1.1 ? "bad" : undefined} />
        </div>
      </Section>

      <Section index="6.1" title="Strike-price levers for bid day" note="What moves the strike price you need, and how far each lever alone would have to go to reach the price you want to quote" className="lever-panel">
        <div className="lever-head">
          <Field label="Strike price you want to quote" unit="₹/kWh" value={target ?? 0} onChange={(v) => setTarget(v)} step={0.01} min={0} digits={3} hint={`the model needs ₹${nf(base, 3)}: ${target !== null && target < base ? `₹${nf(base - target, 3)} to find` : "already there"}`} />
          <button type="button" className="primary" onClick={compute} disabled={Boolean(progress)} data-testid="cfd-levers-run">
            {progress ? <Loader2 className="spin" size={14} /> : <SlidersHorizontal size={14} />} {progress ? `Computing ${progress.done} of ${progress.total}` : res && !stale ? "Levers up to date" : res ? "Recompute the levers" : "Compute the levers"}
          </button>
          {progress && <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}><Square size={12} /> Stop</button>}
          {res && stale && !progress && <small className="lever-stale">The case changed: recompute</small>}
        </div>
        {res && (
          <div className="table-wrap rtc-model fin-table lever-table">
            <table data-testid="cfd-lever-table">
              <thead><tr><th>Lever</th><th>Now</th><th>One step</th><th>Price if up</th><th>Price if down</th><th>₹/kWh per step</th><th>To reach ₹{nf(target, 3)} alone</th><th /></tr></thead>
              <tbody>
                {res.levers.map((row) => {
                  const helps = (target - res.base) * row.slope;
                  return (
                    <tr key={row.key} data-testid={`cfd-lever-${row.key}`}>
                      <td>{row.label} <small>{row.unit}{row.operation ? " · re-simulated" : ""}</small></td>
                      <td>{fmtV(row.value, row)}</td>
                      <td>±{fmtV(row.step, row)}</td>
                      <td>{nf(row.priceUp, 3)} {row.priceUp > res.base ? <ArrowUp size={11} className="bad" /> : <ArrowDown size={11} className="good" />}</td>
                      <td>{nf(row.priceDown, 3)} {row.priceDown > res.base ? <ArrowUp size={11} className="bad" /> : <ArrowDown size={11} className="good" />}</td>
                      <td className={Math.abs(row.perStep) >= 0.05 ? "lever-big" : ""}>{row.perStep >= 0 ? "+" : "−"}{nf(Math.abs(row.perStep), 4)}</td>
                      <td>{row.reach === null ? "–" : row.reachable ? <span>{fmtV(row.reach, row)} <small>({helps < 0 ? "down" : "up"} {fmtV(Math.abs(row.reach - row.value), row)})</small></span> : <small>not within its range</small>}</td>
                      <td>{row.reachable && Math.abs(row.reach - row.value) > 1e-9 && <button type="button" className="secondary" onClick={() => apply(row)} data-testid={`cfd-lever-apply-${row.key}`}><Crosshair size={11} /> Apply</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="rtc-note">Each row is the model run with that input one step up and one step down, everything else as in the bid; the reach is the straight-line move of that lever alone, so use it as a direction, then recompute. Levers that cannot move in this bid (no wind, no group RE) are left out. A lever marked re-simulated changes the day-by-day operation; after applying one, size the plant again for the least-price own RE.</p>
          </div>
        )}
      </Section>
    </div>
  );
}
