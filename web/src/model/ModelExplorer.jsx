"use client";
// The traceable financial model on screen: the Live model sheet as a grid where every number is a
// button. Selecting one shows its formula with each reference named and valued, the numbers it
// reads, the numbers that read it, and every input it finally rests on; any of those is a click away.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Calculator, Search, Sigma, X } from "lucide-react";
import { cellName, colName, formulaParts, inputsOf, traceModel } from "./trace";

const TraceContext = createContext(null);
export const useTrace = () => useContext(TraceContext);

const KIND = { input: "Input", opt: "Optimiser / simulation", calc: "Formula", app: "App result", value: "Value" };

/** A cell's value as the workbook formats it. */
export function fmtCell(c) {
  if (!c) return "";
  const v = c.value;
  if (v === null || v === undefined || v === "") return c.formula ? "–" : "";
  if (typeof v !== "number") return String(v);
  const f = c.fmt || "";
  const n = (d) => v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (f.includes("%")) return `${(v * 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  if (f.includes("×")) return `${n(2)}×`;
  if (f.includes("Year")) return `Year ${v}`;
  if (f === "0.000") return n(3);
  if (f === "0.0000") return n(4);
  if (f === "0") return n(0);
  if (f.startsWith("#,##0.0;")) return Math.abs(v) < 0.05 && v !== 0 ? n(2) : n(1);
  if (f.startsWith("#,##0.00")) return n(2);
  return Math.abs(v) >= 100 ? n(1) : n(3);
}

/**
 * Wraps a page whose numbers can be traced. getLive() returns the live-model request (the Excel
 * export's `live` block) for the page's current model; it is called only when the model opens.
 */
export function TraceProvider({ getLive, children }) {
  const [target, setTarget] = useState(null);
  const getRef = useRef(getLive);
  getRef.current = getLive;
  const openTrace = useCallback((t = {}) => setTarget({ ...t, at: Date.now() }), []);
  const value = useMemo(() => ({ openTrace, available: Boolean(getLive) }), [openTrace, getLive]);
  return (
    <TraceContext.Provider value={value}>
      {children}
      {target && <ModelExplorer getLive={() => getRef.current?.()} target={target} onClose={() => setTarget(null)} />}
    </TraceContext.Provider>
  );
}

/** A button that opens the traceable model (for a section's actions). */
export function TraceButton({ label = "Trace the model", target }) {
  const t = useTrace();
  if (!t?.available) return null;
  return (
    <button type="button" className="ghost trace-open" onClick={() => t.openTrace(target)} data-testid="trace-open">
      <Calculator size={14} /> {label}
    </button>
  );
}

function resolve(model, target) {
  if (!model || !target) return null;
  if (target.addr && model.cells[target.addr]) return target.addr;
  if (target.key && model.keys[target.key]) return model.keys[target.key];
  if (target.line && model.lines[target.line]) {
    const l = model.lines[target.line];
    if (l.addr) return l.addr;
    const a = `${colName(target.year === undefined || target.year === null ? 3 : 4 + target.year)}${l.row}`;
    return model.cells[a] ? a : null;
  }
  return model.keys.equityIrr || null;
}

/** Operators as a reader writes them; text in quotes is left alone. */
function readable(text) {
  return text.split(/("(?:[^"]|"")*")/).map((part) => (part.startsWith('"') ? part
    : part.replace(/\*/g, " × ").replace(/\//g, " ÷ ").replace(/\+/g, " + ").replace(/(?<=[\w)\s])-(?=[\w($\s])/g, " − ").replace(/<>/g, " ≠ ").replace(/>=/g, " ≥ ").replace(/<=/g, " ≤ "))).join("");
}

function Ref({ model, addr, onPick, compact = false }) {
  const c = model.cells[addr];
  if (!c) return <code>{addr}</code>;
  return (
    <button type="button" className={`trace-ref kind-${c.kind}`} onClick={() => onPick(addr)} title={`${cellName(model, addr)} (${addr})`}>
      <span>{compact ? (c.col >= 4 ? `${c.label} · ${c.column.replace("Year ", "Y")}` : c.label) : cellName(model, addr)}</span>
      <b>{fmtCell(c)}</b>
    </button>
  );
}

function Formula({ model, c, onPick }) {
  const parts = formulaParts(c.formula);
  return (
    <div className="trace-formula" data-testid="trace-formula">
      {parts.map((p, i) => {
        if (p.ref) return <Ref key={i} model={model} addr={p.ref} onPick={onPick} compact />;
        if (p.range) {
          const [a, b] = p.range;
          const ca = model.cells[a];
          const cb = model.cells[b];
          const name = ca && cb && ca.row === cb.row ? `${ca.label} · ${ca.column.replace("Year ", "Y")}–${cb.column.replace("Year ", "Y")}` : `${a}:${b}`;
          return <button key={i} type="button" className="trace-ref kind-range" onClick={() => onPick(a)} title={`${a}:${b}`}><span>{name}</span></button>;
        }
        return <span key={i} className="trace-op">{readable(p.text)}</span>;
      })}
    </div>
  );
}

function TracePanel({ model, addr, onPick, onBack, canBack }) {
  const c = model.cells[addr];
  const [showInputs, setShowInputs] = useState(false);
  const inputs = useMemo(() => (showInputs ? inputsOf(model, addr) : []), [model, addr, showInputs]);
  useEffect(() => setShowInputs(false), [addr]);
  if (!c) return null;
  return (
    <aside className="trace-panel" data-testid="trace-panel">
      <header>
        {canBack && <button type="button" className="rtc-icon-btn" onClick={onBack} aria-label="Back" title="Back"><ArrowLeft size={14} /></button>}
        <span className={`trace-kind kind-${c.kind}`}>{KIND[c.kind] || c.kind}</span>
        <code>{addr}</code>
      </header>
      <h3 data-testid="trace-name">{cellName(model, addr)}</h3>
      <div className="trace-value" data-testid="trace-value">{fmtCell(c)} {!/[%×]$/.test(fmtCell(c)) && <small>{c.unit}</small>}</div>
      {c.source && <p className="trace-source">Source: {c.source}</p>}
      {c.formula ? (
        <>
          <div className="trace-label"><Sigma size={12} /> How it is worked out</div>
          <Formula model={model} c={c} onPick={onPick} />
          <details className="trace-excel"><summary>Excel formula</summary><code>={c.formula}</code></details>
        </>
      ) : (
        <p className="rtc-note">{c.kind === "input" ? "An input: change it in the inputs of this tab (or in the Excel model) and every number that uses it moves." : c.kind === "opt" ? "From the dispatch (the HiGHS sizing or the hourly simulation), summed for the year." : "A value, not a formula."}</p>
      )}
      {c.refs.length > 0 && (
        <>
          <div className="trace-label">Reads ({c.refs.length})</div>
          <div className="trace-list">{c.refs.slice(0, 40).map((a) => <Ref key={a} model={model} addr={a} onPick={onPick} />)}</div>
          {c.refs.length > 40 && <small className="rtc-note">and {c.refs.length - 40} more</small>}
        </>
      )}
      <div className="trace-label">Used in ({c.usedBy.length})</div>
      {c.usedBy.length ? (
        <div className="trace-list" data-testid="trace-used">{c.usedBy.slice(0, 40).map((a) => <Ref key={a} model={model} addr={a} onPick={onPick} />)}</div>
      ) : <p className="rtc-note">Nothing reads it: it is a result.</p>}
      {c.formula && (
        <>
          <button type="button" className="ghost" onClick={() => setShowInputs((v) => !v)} data-testid="trace-inputs-toggle">
            {showInputs ? "Hide" : "Show"} every input it rests on
          </button>
          {showInputs && (
            <div className="trace-list" data-testid="trace-inputs">
              <small className="rtc-note">{inputs.length} inputs and dispatch numbers, through every formula in between</small>
              {inputs.map((a) => <Ref key={a} model={model} addr={a} onPick={onPick} />)}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

/** The model grid with its trace panel, over the page. */
export default function ModelExplorer({ getLive, target, onClose }) {
  const [model, error] = useMemo(() => {
    try {
      const live = getLive();
      if (!live) return [null, "There is no financial model yet: size the plant (or run the case) first."];
      return [traceModel(live), null];
    } catch (err) {
      return [null, err.message];
    }
    // the model is built once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.at]);
  const [sel, setSel] = useState(() => resolve(model, target));
  const [history, setHistory] = useState([]);
  const [query, setQuery] = useState("");
  const gridRef = useRef(null);
  const pick = useCallback((a) => {
    setSel((cur) => {
      if (cur && cur !== a) setHistory((h) => [...h.slice(-50), cur]);
      return a;
    });
  }, []);
  const back = () => setHistory((h) => {
    if (!h.length) return h;
    setSel(h[h.length - 1]);
    return h.slice(0, -1);
  });
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (!sel || !gridRef.current) return;
    const el = gridRef.current.querySelector(`[data-addr="${sel}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);

  const selCell = model?.cells[sel];
  const reads = useMemo(() => new Set(selCell?.refs || []), [selCell]);
  const users = useMemo(() => new Set(selCell?.usedBy || []), [selCell]);
  const cols = model ? Array.from({ length: 2 + model.N }, (_, i) => i + 3) : [];
  const q = query.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!model) return [];
    const rows = model.rows.filter((r) => r.row > model.yearRow - 1 && (r.label || r.row === model.yearRow));
    if (!q) return rows;
    return rows.filter((r) => r.section || r.label.toLowerCase().includes(q));
  }, [model, q]);

  return (
    <div className="trace-overlay" role="dialog" aria-modal="true" aria-label="Traceable financial model" data-testid="trace-explorer">
      <div className="trace-shell">
        <header className="trace-head">
          <div>
            <span className="rtc-index">Traceable model</span>
            <h2>{model?.title || "Financial model"}</h2>
            <p className="rtc-note">Every number is a formula on the inputs (blue) and the dispatch (green), the same as the Excel model. Click any number to see how it is worked out.</p>
          </div>
          <label className="trace-search"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a line" data-testid="trace-search" /></label>
          <button type="button" className="rtc-icon-btn" onClick={onClose} aria-label="Close the model"><X size={16} /></button>
        </header>
        {error && <div className="alert">{error}</div>}
        {model && (
          <div className="trace-body">
            <div className="trace-grid" ref={gridRef}>
              <table>
                <thead>
                  <tr>
                    <th className="sticky c0">Line</th>
                    <th className="sticky c1">Unit</th>
                    {cols.map((c) => <th key={c} className={c === 3 ? "sticky c2" : ""}>{c === 3 ? "Value / total" : c === 4 ? "Year 0" : `Y${c - 4}`}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    if (r.section) return <tr key={r.row} className="trace-section"><td colSpan={2 + cols.length}><span>{r.label}</span></td></tr>;
                    if (r.group) return <tr key={r.row} className="trace-group"><td colSpan={2 + cols.length}>{r.label}</td></tr>;
                    return (
                      <tr key={r.row}>
                        <td className="sticky c0" title={r.note || undefined}>{r.row === model.yearRow ? "Year" : r.label}</td>
                        <td className="sticky c1">{r.unit}</td>
                        {cols.map((col) => {
                          const a = Object.prototype.hasOwnProperty.call(model.cells, `${colName(col)}${r.row}`) ? `${colName(col)}${r.row}` : null;
                          const c = a ? model.cells[a] : null;
                          const cls = ["trace-cell", c ? `kind-${c.kind}` : "", a === sel ? "is-sel" : "", reads.has(a) ? "is-read" : "", users.has(a) ? "is-user" : "", col === 3 ? "sticky c2" : ""].join(" ");
                          return (
                            <td key={col} className={cls}>
                              {c ? <button type="button" data-addr={a} onClick={() => pick(a)}>{fmtCell(c)}</button> : null}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sel && <TracePanel model={model} addr={sel} onPick={pick} onBack={back} canBack={history.length > 0} />}
          </div>
        )}
        <footer className="trace-legend">
          <span className="kind-input">Input</span><span className="kind-opt">Dispatch</span><span className="kind-calc">Formula</span>
          <span className="is-read">Read by the selected number</span><span className="is-user">Uses the selected number</span>
        </footer>
      </div>
    </div>
  );
}
