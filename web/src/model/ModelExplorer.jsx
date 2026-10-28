"use client";
// The traceable financial model on screen: the Live model sheet as a grid where every number is a
// button. Selecting one shows its formula with each reference named and valued, the numbers it
// reads, the numbers that read it, and every input it finally rests on; any of those is a click away.
import { createPortal } from "react-dom";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Calculator, Search, Sigma, X } from "lucide-react";
import { cellName, colName, formulaParts, inputsOf, traceModel } from "./trace";
import { MONTHS, dayLabel, quarterHours } from "./generation";
import { MONTH_DAYS } from "../rtc/engine";

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
export function TraceProvider({ getLive, request = null, children }) {
  const [target, setTarget] = useState(null);
  const getRef = useRef(getLive);
  getRef.current = getLive;
  const openTrace = useCallback((t = {}) => setTarget({ ...t, at: Date.now() }), []);
  // a request from outside (the voice agent): open at its line, year and drill-down
  useEffect(() => { if (request) openTrace(request); }, [request, openTrace]);
  const value = useMemo(() => ({ openTrace, available: Boolean(getLive) }), [openTrace, getLive]);
  return (
    <TraceContext.Provider value={value}>
      {children}
      {target && <ModelExplorer key={target.at} getLive={() => getRef.current?.()} target={target} onClose={() => setTarget(null)} />}
    </TraceContext.Provider>
  );
}

/** A button that opens the traceable model (for a section's actions). */
export function TraceButton({ label = "Trace the model", target }) {
  const t = useTrace();
  if (!t?.available) return null;
  return (
    <button type="button" className="secondary trace-open" onClick={() => t.openTrace(target)} data-testid="trace-open">
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

// the dispatch's lines that a CFO reads as "what happened to the generation"
const DISPATCH_WORDS = {
  delivered: "the energy the procurer received",
  excess: "the energy sold in the market",
  demand: "the energy the contract asks for: the contracted MW in every hour of the year",
  blockShort: "the energy short of each hour's floor (peak and off-peak blocks)",
};

/** A dispatch number in plain words, with the generation formula it is drawn from. */
function DispatchNote({ model, c, onPick }) {
  const key = model.rowKey?.[c.row];
  const year = c.col >= 5 ? c.col - 4 : null;
  const at = (k) => {
    const l = model.lines[k];
    if (!l) return null;
    const a = l.addr || `${colName(year ? 4 + year : 3)}${l.row}`;
    return model.cells[a] ? a : null;
  };
  const gen = at("genBus");
  const unused = at("unused");
  const who = model.engine === "simulation" ? "the hourly simulation" : "the HiGHS optimiser";
  if (key === "demand") return <p className="rtc-note">An input of the tender: {DISPATCH_WORDS.demand}.</p>;
  return (
    <div className="trace-dispatch" data-testid="trace-dispatch">
      <p className="rtc-note">
        {DISPATCH_WORDS[key] ? `This is ${DISPATCH_WORDS[key]}, ` : "This is "}
        added up over the {year ? "year's" : "PPA's"} hours. The plant&apos;s generation is a plain formula (MW × CUF × 365 days × 24 hours);
        what {who} decides is only where each hour&apos;s energy goes: first to the procurer, then into the battery,
        then sold, and the rest curtailed.
      </p>
      {gen && (
        <>
          <div className="trace-label">The generation it comes from</div>
          <div className="trace-list"><Ref model={model} addr={gen} onPick={onPick} />{unused && <Ref model={model} addr={unused} onPick={onPick} />}</div>
        </>
      )}
    </div>
  );
}

const nf = (v, d = 1) => (Number.isFinite(v) ? v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
const pctf = (v, d = 2) => `${nf(v * 100, d)}%`;
const hhmm = (q) => `${String(Math.floor(q / 4)).padStart(2, "0")}:${String((q % 4) * 15).padStart(2, "0")}`;

/**
 * From a year of solar or wind to its months and its 15-minute blocks, with the arithmetic in
 * each line: the year is MW × CUF × 365 × 24, a month MW × its CUF × its days × 24, a block
 * MW × its capacity factor × ¼ hour (the hour split the way the 15-minute dispatch splits it).
 */
function GenDrill({ model, c, drill = null }) {
  const key = model.rowKey?.[c.row] || "";
  const hit = /^(solar|wind)(Gen|Bus|Cuf|DegF|MuYear|CufM(\d+)|MuM(\d+))$/.exec(key);
  const tech = hit?.[1];
  const g = tech ? model.gen?.[tech] : null;
  const year = c.col >= 5 && c.col <= 4 + model.N ? c.col - 4 : 1;
  const startMonth = () => Number(drill?.month || hit?.[4] || hit?.[5] || 1) - 1;
  const [month, setMonth] = useState(startMonth);
  const [day, setDay] = useState(() => (drill?.day ? drill.day - 1 : 0));
  useEffect(() => { setMonth(startMonth()); setDay(drill?.day ? drill.day - 1 : 0); }, [c.addr, drill]); // eslint-disable-line react-hooks/exhaustive-deps
  const mwCell = tech ? model.cells[model.lines[`${tech}Mw`]?.addr] : null;
  const mw = mwCell?.value || 0;
  const deg = g ? (1 - g.degradation) ** (year - 1) : 1;
  const bus = hit?.[2] === "Bus" ? 1 - g.toBus : 1;
  const monthDay0 = MONTH_DAYS.slice(0, month).reduce((a, d) => a + d, 0);
  const blocks = useMemo(() => (g ? quarterHours(g.hourly, (monthDay0 + day) * 24, (monthDay0 + day + 1) * 24) : []), [g, monthDay0, day]);
  const yearBlocks = useMemo(() => (g ? quarterHours(g.hourly).reduce((a, v) => a + v, 0) : 0), [g]);
  if (!g) return null;
  const name = tech === "solar" ? "Solar" : "Wind";
  const where = bus < 1 ? "at the 33 kV bus" : `at the ${g.cufAt || "point its CUF is measured"}`;
  const busTxt = bus < 1 ? ` × (1 − ${pctf(g.toBus)} to the bus)` : "";
  const degTxt = year > 1 ? ` × ${nf(deg, 4)} degradation` : "";
  const yearMu = (mw * g.cuf * 365 * 24 / 1000) * deg * bus;
  const monthMu = (m) => (mw * g.monthCuf[m] * MONTH_DAYS[m] * 24 / 1000) * deg * bus;
  const dayCuf = blocks.reduce((a, v) => a + v, 0) / blocks.length;
  const blockMwh = (v) => mw * v * deg * bus * 0.25;
  return (
    <section className="gen-drill" data-testid="gen-drill">
      <div className="trace-label">{name}, year {year}: from the year to the 15-minute blocks</div>
      <p className="gen-line" data-testid="gen-year">
        <b>Year {year}</b> {nf(mw)} MW × {pctf(g.cuf)} CUF × 365 days × 24 h ÷ 1,000{degTxt}{busTxt} = <b>{nf(yearMu)} MU</b> {where}
      </p>
      {g.monthCuf && (
        <table className="gen-table" data-testid="gen-months">
          <thead><tr><th>Month</th><th>CUF</th><th>MW × CUF × days × 24 h</th><th>MU</th></tr></thead>
          <tbody>
            {g.monthCuf.map((cu, m) => (
              <tr key={m} className={m === month ? "is-sel" : ""} onClick={() => { setMonth(m); setDay(0); }}>
                <td><button type="button" className="link">{MONTHS[m].slice(0, 3)}</button></td>
                <td>{pctf(cu, 1)}</td>
                <td>{nf(mw, 0)} × {pctf(cu, 1)} × {MONTH_DAYS[m]} × 24</td>
                <td>{nf(monthMu(m))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3}>Twelve months (days-weighted CUF {pctf(g.cuf)})</td><td><b>{nf(g.monthCuf.reduce((a, _, m) => a + monthMu(m), 0))}</b></td></tr></tfoot>
        </table>
      )}
      <div className="gen-day">
        <label>
          15-minute blocks of
          <select value={day} onChange={(e) => setDay(Number(e.target.value))} data-testid="gen-day">
            {Array.from({ length: MONTH_DAYS[month] }, (_, d) => <option key={d} value={d}>{dayLabel(monthDay0 + d)}</option>)}
          </select>
        </label>
        <span className="rtc-note">Day: {nf(mw, 0)} MW × {pctf(dayCuf)} × 24 h{degTxt}{busTxt} = <b>{nf(blocks.reduce((a, v) => a + blockMwh(v), 0), 0)} MWh</b></span>
      </div>
      <div className="gen-blocks" data-testid="gen-blocks">
        <table className="gen-table">
          <thead><tr><th>Block</th><th>Capacity factor</th><th>MW × factor × ¼ h</th><th>MWh</th></tr></thead>
          <tbody>
            {blocks.map((v, q) => (
              <tr key={q} className={v > 0 ? "" : "is-zero"}>
                <td>{hhmm(q)}–{hhmm(q + 1)}</td>
                <td>{nf(v, 3)}</td>
                <td>{nf(mw, 0)} × {nf(v, 3)} × 0.25</td>
                <td>{nf(blockMwh(v), 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rtc-note" data-testid="gen-all-blocks">
        All 35,040 blocks of the year together: {nf(mw, 0)} MW × {pctf(yearBlocks / 35040)} × 8,760 h ÷ 1,000{degTxt}{busTxt} = <b>{nf((mw * (yearBlocks / 4) / 1000) * deg * bus)} MU</b>, the year above.
        Each hour of the {name.toLowerCase()} profile is split into four blocks along its trend, keeping the hour&apos;s energy, as the 15-minute dispatch does.
      </p>
    </section>
  );
}

/**
 * A year total of a dispatch sheet ("Dispatch Y1"): any day's 24 hours, each column worked out as
 * in the Excel sheet, the optimiser's choices (charge, discharge, sold) in green.
 */
function DispatchDrill({ model, c }) {
  const [day, setDay] = useState(0);
  const info = c.dispatch && model.dispatch ? model.dispatch : null;
  if (!info) return null;
  const d = info.data;
  const y = d.byYear.find((b) => b.year === c.dispatch.year);
  const v = info.years?.[c.dispatch.year]?.values;
  if (!y || !v) return null;
  const hours = Array.from({ length: 24 }, (_, h) => day * 24 + h);
  const cols = [
    ["gen", "Generation", (t) => v.gen[t]],
    ["charge", "Charge", (t) => y.charge[t], true],
    ["discharge", "Discharge", (t) => y.discharge[t], true],
    ...(d.sell ? [["sold", "Sold", (t) => y.sold[t], true]] : []),
    ["direct", "Direct", (t) => v.direct[t]],
    ["delivered", "Delivered (meter)", (t) => v.delivered[t]],
    ...(d.blocks ? [["floor", "Floor", (t) => v.floor[t]], ["short", "Short", (t) => v.short[t]]] : []),
  ];
  const sel = c.dispatch.key;
  return (
    <section className="gen-drill" data-testid="dispatch-drill">
      <div className="trace-label">Year {y.year}, hour by hour (sheet Dispatch Y{y.year} of the Excel model)</div>
      <p className="rtc-note">
        Generation = MW × the hour&apos;s capacity factor × the year&apos;s degradation · direct = MIN(contract − discharge, generation − charge{d.sell ? " − sold" : ""}) ·
        delivered = (direct + discharge) × {nf(d.poi * 100, 2)}% to the meter{d.blocks ? " · short = MAX(0, floor − delivered)" : ""}. Green: the optimiser&apos;s choice each hour.
      </p>
      <div className="gen-day">
        <label>
          Day
          <select value={day} onChange={(e) => setDay(Number(e.target.value))} data-testid="dispatch-day">
            {Array.from({ length: 365 }, (_, k) => <option key={k} value={k}>{dayLabel(k)}</option>)}
          </select>
        </label>
      </div>
      <div className="gen-blocks" data-testid="dispatch-hours">
        <table className="gen-table">
          <thead><tr><th>Hour</th>{cols.map(([k, label]) => <th key={k} className={k === sel ? "is-sel" : ""}>{label}</th>)}</tr></thead>
          <tbody>
            {hours.map((t) => (
              <tr key={t} className={d.blocks && d.peak[t] ? "is-peak" : ""}>
                <td>{String(t % 24).padStart(2, "0")}:00{d.blocks && d.peak[t] ? " ★" : ""}</td>
                {cols.map(([k, , get, opt]) => <td key={k} className={`${k === sel ? "is-sel" : ""} ${opt ? "is-opt" : ""}`}>{nf(get(t), 1)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.blocks && <p className="rtc-note">★ a Peak Hour: its floor is {nf(d.peakFloor * 100, 0)}% of the contracted {nf(d.contract, 0)} MW; every other hour {nf(d.offFloor * 100, 0)}%.</p>}
    </section>
  );
}

function TracePanel({ model, addr, onPick, onBack, canBack, drill = null }) {
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
        c.kind === "opt" ? <DispatchNote model={model} c={c} onPick={onPick} />
          : <p className="rtc-note">{c.kind === "input" ? "An input: change it in the inputs of this tab (or in the Excel model) and every number that uses it moves." : "A value, not a formula."}</p>
      )}
      <GenDrill model={model} c={c} drill={drill} />
      <DispatchDrill model={model} c={c} />
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
  const [first] = useState(sel); // the number it opened at keeps the request's month and day
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
    createPortal(
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
            {sel && <TracePanel model={model} addr={sel} onPick={pick} onBack={back} canBack={history.length > 0} drill={sel === first ? target.drill : null} />}
          </div>
        )}
        <footer className="trace-legend">
          <span className="kind-input">Input</span><span className="kind-opt">Dispatch</span><span className="kind-calc">Formula</span>
          <span className="is-read">Read by the selected number</span><span className="is-user">Uses the selected number</span>
        </footer>
      </div>
    </div>,
    document.body,
    )
  );
}
