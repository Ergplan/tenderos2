import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Crosshair, Download, HelpCircle, Loader2, Lock, Route, SlidersHorizontal, Square } from "lucide-react";
import { Field, Section, Stat, nf, pf } from "../rtc/ui";
import { cfdModelExport, downloadCfdModel, quoteOf, quotedStrikeReturns, runCfdFinance } from "./finance.js";
import { runModel } from "./model.js";
import { useTeamContext } from "../team/useTeam";
import { FreezeDialog, FrozenPanel, freezeLever, unfreezeLever } from "./Freeze.jsx";
import { cfdLeverEffects, withCfdLever } from "./levers.js";
import { LEVER_NOTES, explainLever } from "./leverNotes.js";
import { planTrack } from "./track.js";
import TrackView from "./TrackView.jsx";
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
  const [track, setTrack] = useState(null); // { key, result }
  const [tracking, setTracking] = useState(null);
  const [freezing, setFreezing] = useState(null); // { lever, value }
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const teamCtx = useTeamContext();
  const me = teamCtx?.team?.me || null;
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
      return result;
    } catch (err) {
      if (!/Stopped/.test(err.message)) window.alert(err.message);
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  }
  const res = computed?.result;
  const trackStale = !track || track.key !== caseKey;

  async function plot() {
    if (progress || tracking) return;
    let effects = !stale ? res : null;
    if (!effects) effects = await compute();
    if (!effects) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setTracking({ done: 0, total: 1 });
    try {
      const result = await planTrack({ state, model, prices, effects, target, signal: abort.signal, onProgress: (done, total) => setTracking({ done, total }) });
      setTrack({ key: caseKey, result });
    } catch (err) {
      if (!/Stopped/.test(err.message)) window.alert(err.message);
    } finally {
      setTracking(null);
      abortRef.current = null;
    }
  }
  const applyTrack = (steps) => setState((s) => steps.reduce((acc, st) => withCfdLever(acc, { key: st.key, min: -Infinity, max: Infinity, int: st.int }, st.to), s));
  const frozen = state.frozen || {};
  // the price before the first freeze is kept, so the panel can say how much of the gap the frozen values secured
  const onFreeze = (value, record) => {
    if (!freezing) return;
    const lv = freezing.lever;
    let impact = null; // ₹/kWh the price falls by at this value (a rise is negative)
    if (Number.isFinite(freezing.drop) && Number.isFinite(freezing.from) && Number.isFinite(freezing.to) && Math.abs(freezing.to - freezing.from) > 1e-12) impact = freezing.drop * ((value - freezing.from) / (freezing.to - freezing.from));
    else if (Number.isFinite(lv.slope)) impact = -(lv.slope * (value - lv.value));
    setState((s) => {
      const first = !Object.keys(s.frozen || {}).length;
      const next = freezeLever(s, lv, value, { ...record, impact });
      return first || !Number.isFinite(s.frozenBaseline?.price) ? { ...next, frozenBaseline: { price: base, at: new Date().toISOString() } } : next;
    });
  };
  const onUnfreeze = (key) => setState((s) => {
    const next = unfreezeLever(s, key);
    return Object.keys(next.frozen || {}).length ? next : { ...next, frozenBaseline: null };
  });

  // the What-if case as a workbook: the bid with the track's moves applied, priced through the full
  // model, with a What-if track sheet (the moves, their chances, the frozen levers)
  async function downloadWhatIf() {
    if (downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const t = track?.result || { steps: [], target, base, reached: base <= target, final: base, floor: null, chance: 1 };
      const s2 = t.steps.reduce((acc, st) => withCfdLever(acc, { key: st.key, min: -Infinity, max: Infinity, int: st.int }, st.to), state);
      const pricer = (inputs, sim) => runCfdFinance({ ...s2, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
      const m2 = t.steps.length ? runModel(s2, prices, { price: pricer }) : model;
      const f2 = runCfdFinance({ ...s2, tariffLocked: false }, m2);
      const payload = cfdModelExport({ state: s2, model: m2, finance: f2 });
      const verdict = document.querySelector("[data-testid=cfd-track-verdict]")?.textContent || (Object.keys(frozen).length ? `The bid with ${Object.keys(frozen).length} frozen levers: the model needs ₹${nf(base, 3)}/kWh.` : "");
      payload.fileName = `${payload.fileName}_what-if_${String(t.target).replace(".", "p")}`;
      payload.title = `${payload.title} · What-if case at ₹${nf(t.target, 2)}/kWh`;
      payload.whatIf = {
        title: `The track to ₹${nf(t.target, 3)}/kWh`, verdict, base: t.base, target: t.target, final: t.reached ? t.final : t.floor, reached: t.reached, chance: t.chance,
        steps: t.steps.map((st) => ({ label: st.label, from: st.from, to: st.to, unit: st.pct ? "%" : st.unit, p: st.p, price: st.price, cum: st.cum, who: st.who, why: st.why, frozen: frozen[st.key] ? `yes · ${frozen[st.key].evidence?.name || "no evidence"}` : "" })),
        frozen: Object.values(frozen).sort((a, b) => (b.impact ?? -1e9) - (a.impact ?? -1e9)).map((f) => ({ label: f.label, value: f.value, unit: f.pct ? "%" : f.unit, impact: f.impact ?? null, at: f.at?.slice(0, 10), by: f.by, evidence: f.evidence?.name || "", note: f.note || "" })),
      };
      await downloadCfdModel(payload);
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setDownloading(false);
    }
  }
  const [open, setOpen] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const toggle = (key) => setOpen((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const noteOf = (key) => LEVER_NOTES[key] || LEVER_NOTES[key.replace(/^fin\./, "")] || null;
  const apply = (row) => { if (row.reachable) setState((s) => withCfdLever(s, row, row.reach)); };
  const irrText = (v) => (Number.isFinite(v) ? pf(v, 2) : "none");

  return (
    <div data-testid="cfd-whatif">
      <Section index="6" title="Returns at a strike price" note="What a price earns on the sized bid, against the price the target equity IRR needs">
        <div className="rtc-grid rtc-grid-4">
          <Field label="Strike price to try" unit="₹/kWh" value={tried ?? quoteOf(base)} onChange={(v) => setTried(v)} step={0.01} min={0} digits={3} hint={`the model needs ₹${nf(base, 3)} for a ${pf(finance.engine.fin.targetEquityIrr, 1)} equity IRR`} />
          <Stat label="Equity IRR" value={quoted ? irrText(quoted.equityIrr) : pf(finance.equityIrr, 2)} detail={quoted ? `target ${pf(quoted.targetEquityIrr, 2)}` : "at the solved price"} tone={quoted && quoted.status !== "ok" ? "bad" : undefined} />
          <Stat label="Project IRR" value={quoted ? irrText(quoted.projectIrr) : pf(finance.projectIrr, 2)} detail="post-tax, unlevered" tone={quoted && quoted.status !== "ok" ? "bad" : undefined} />
          <Stat label="Minimum DSCR" value={quoted ? nf(quoted.minDscr, 2) : nf(finance.minDscr, 2)} detail={quoted ? `${quoted.gap >= 0 ? "+" : "−"}₹${nf(Math.abs(quoted.gap), 3)} against the solved price` : `average ${nf(finance.avgDscr, 2)}`} tone={(quoted ? quoted.minDscr : finance.minDscr) < (state.fin?.lenderMinDscr ?? 1.1) ? "bad" : undefined} />
        </div>
      </Section>

      <Section index="6.0" title="The track to the price you want to quote" note="Which levers to turn, how far, in what order, and the chance of each move happening; a quote no lever can reach is said so" className="lever-panel">
        <div className="lever-head">
          <Field label="Strike price you want to quote" unit="₹/kWh" value={target ?? 0} onChange={(v) => setTarget(v)} step={0.01} min={0} digits={3} hint={`the model needs ₹${nf(base, 3)}/kWh for your ${pf(finance.engine.fin.targetEquityIrr, 1)} equity IRR${target !== null && target < base ? `; to quote ₹${nf(target, 3)} the levers must find ₹${nf(base - target, 3)}` : target !== null ? "; your quote is above it, so the equity earns more than its target" : ""}`} />
          <button type="button" className="primary" onClick={plot} disabled={Boolean(progress || tracking)} data-testid="cfd-track-run">
            {progress || tracking ? <Loader2 className="spin" size={14} /> : <Route size={14} />} {progress ? `Measuring the levers ${progress.done} of ${progress.total}` : tracking ? `Pricing the moves ${tracking.done} of ${tracking.total}` : track && !trackStale ? "Track up to date" : track ? "Plot the track again" : "Plot the track"}
          </button>
          {(progress || tracking) && <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}><Square size={12} /> Stop</button>}
          {track && trackStale && !progress && !tracking && <small className="lever-stale">The case changed: plot again</small>}
        </div>
        <FrozenPanel frozen={frozen} onUnfreeze={onUnfreeze} baseline={state.frozenBaseline?.price ?? null} now={base} target={target} />
        {track && <TrackView track={track.result} targetIrr={finance.engine.fin.targetEquityIrr} onApply={applyTrack} frozen={frozen} onFreeze={(st) => setFreezing({ lever: st, value: st.to, drop: st.drop, from: st.from, to: st.to })} onDownload={downloadWhatIf} downloading={downloading} />}
        {(!track || track.result.above || !track.result.steps.length) && (
          <div className="track-actions" data-testid="cfd-whatif-download-row">
            <button type="button" className="primary" onClick={downloadWhatIf} disabled={downloading} data-testid="cfd-whatif-download"><Download size={12} /> {downloading ? "Building the workbook…" : "Download What-if model (Excel)"}</button>
            <small>{Object.keys(frozen).length ? "The bid with the frozen values, priced through the full model, with the What-if track sheet listing them." : "The bid as it stands, priced through the full model; plot a track first to carry its moves."}</small>
          </div>
        )}
        {downloadError && <div className="alert">{downloadError}</div>}
        {freezing && <FreezeDialog lever={freezing.lever} value={freezing.value} me={me} onFreeze={onFreeze} onClose={() => setFreezing(null)} />}
        <details className="lever-details" data-testid="cfd-levers-details">
          <summary>Every lever, one step at a time: the measurements behind the track, the levers it did not pick, and Apply or Freeze by hand</summary>
        <div className="lever-head">
          <button type="button" className="primary" onClick={compute} disabled={Boolean(progress)} data-testid="cfd-levers-run">
            {progress ? <Loader2 className="spin" size={14} /> : <SlidersHorizontal size={14} />} {progress ? `Computing ${progress.done} of ${progress.total}` : res && !stale ? "Levers up to date" : res ? "Recompute the levers" : "Compute the levers"}
          </button>
          {progress && <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}><Square size={12} /> Stop</button>}
          {res && stale && !progress && <small className="lever-stale">The case changed: recompute</small>}
        </div>
        {res && (
          <div className="lever-guide" data-testid="cfd-lever-guide">
            <p><b>How to read the table.</b> The model needs <b>₹{nf(res.base, 3)}/kWh</b> on this bid to give the equity its {pf(finance.engine.fin.targetEquityIrr, 1)} IRR. Each row takes one input, moves it one step up and one step down with everything else as in the bid, and solves the price again.</p>
            <ul>
              <li><b>Now</b>: the input's value in the bid. <b>One step</b>: the move tried in each direction.</li>
              <li><b>Price if up / if down</b>: the strike price the model needs after that one move. A green arrow is a lower price (good for winning), a red arrow a higher one.</li>
              <li><b>₹/kWh per step</b>: how much one step moves the price; a plus sign means raising the input raises the price. The bold rows are the levers that matter.</li>
              <li><b>To reach ₹{nf(target, 3)} alone</b>: how far that one lever would have to go, on its own, to bring the price to your quote, if its effect stayed in a straight line; "not within its range" means it cannot get there alone. <b>Apply</b> sets the input there, then recompute.</li>
              <li><b>re-simulated</b>: the lever changes the day-by-day operation (charging, surplus, shortfalls), so every day of the term is run again before pricing; after applying one, size the own RE again.</li>
            </ul>
            <button type="button" className="secondary" onClick={() => setShowAll((v) => !v)} data-testid="cfd-lever-explain-all">{showAll ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {showAll ? "Hide the explanations" : "Explain every lever"}</button>
          </div>
        )}
        {res && (
          <div className="table-wrap rtc-model fin-table lever-table">
            <table data-testid="cfd-lever-table">
              <thead><tr><th>Lever</th><th>Now</th><th>One step</th><th>Price if up</th><th>Price if down</th><th>₹/kWh per step</th><th>To reach ₹{nf(target, 3)} alone</th><th /></tr></thead>
              <tbody>
                {res.levers.map((row) => {
                  const helps = (target - res.base) * row.slope;
                  const note = noteOf(row.key);
                  const isOpen = showAll || open.has(row.key);
                  return (
                    <React.Fragment key={row.key}>
                    <tr data-testid={`cfd-lever-${row.key}`}>
                      <td><button type="button" className="lever-why" onClick={() => toggle(row.key)} title="What this lever is and why it moves the price" data-testid={`cfd-lever-why-${row.key}`}><HelpCircle size={12} /></button> {row.label} <small>{row.unit}{row.operation ? " · re-simulated" : ""}</small></td>
                      <td>{fmtV(row.value, row)}</td>
                      <td>±{fmtV(row.step, row)}</td>
                      <td>{nf(row.priceUp, 3)} {row.priceUp > res.base ? <ArrowUp size={11} className="bad" /> : <ArrowDown size={11} className="good" />}</td>
                      <td>{nf(row.priceDown, 3)} {row.priceDown > res.base ? <ArrowUp size={11} className="bad" /> : <ArrowDown size={11} className="good" />}</td>
                      <td className={Math.abs(row.perStep) >= 0.05 ? "lever-big" : ""}>{row.perStep >= 0 ? "+" : "−"}{nf(Math.abs(row.perStep), 4)}</td>
                      <td>{row.reach === null ? "–" : row.reachable ? <span>{fmtV(row.reach, row)} <small>({helps < 0 ? "down" : "up"} {fmtV(Math.abs(row.reach - row.value), row)})</small></span> : <small>not within its range</small>}</td>
                      <td>
                        {frozen[row.key] ? <span className="frozen-mark" title="Frozen: left alone by the track"><Lock size={11} /> frozen</span> : (
                          <>
                            {row.reachable && Math.abs(row.reach - row.value) > 1e-9 && <button type="button" className="secondary" onClick={() => apply(row)} data-testid={`cfd-lever-apply-${row.key}`}><Crosshair size={11} /> Apply</button>}
                            {" "}<button type="button" className="secondary freeze-btn" onClick={() => setFreezing({ lever: row, value: row.value })} title="Freeze this lever at a value you are sure of, with the evidence" data-testid={`cfd-lever-freeze-${row.key}`}><Lock size={11} /> Freeze</button>
                          </>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="lever-note" data-testid={`cfd-lever-note-${row.key}`}>
                        <td colSpan={8}>
                          <div className="lever-note-body">
                            {note && <p><b>What it is.</b> {note.what}</p>}
                            {note && <p><b>Why it moves the price.</b> {note.why}</p>}
                            <p><b>In this bid.</b> {explainLever(row, res, target)}</p>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            <p className="rtc-note">Each row is the model run with that input one step up and one step down, everything else as in the bid; the reach is the straight-line move of that lever alone, so use it as a direction, then recompute. Levers that cannot move in this bid (no wind, no group RE) are left out. A lever marked re-simulated changes the day-by-day operation; after applying one, size the plant again for the least-price own RE.</p>
          </div>
        )}
        </details>
      </Section>

    </div>
  );
}
