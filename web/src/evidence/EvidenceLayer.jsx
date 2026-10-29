"use client";
// Evidence on every input (E-01, E-02): a paperclip beside every input box of the open tab, to the
// left of team mode's send icon. Faint when the box has no evidence, solid with a count when it
// has, a green tick when a super admin signed off the box at its current value, amber when the
// sign-off is at an older value. Clicking it opens the box's evidence: the items (a file to
// download, a link, a note; who and when), a form to attach more, and for a super admin the
// sign-off. Boxes are found on the page the way team mode finds them (../team/fields.js).
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Download, FileText, Link as LinkIcon, Paperclip, ShieldCheck, StickyNote, Trash2, X } from "lucide-react";
import { allBoxes, boxInfo } from "../team/fields";
import { readPingMode } from "../team/FieldPings";
import useEvidence from "./useEvidence";
import "./evidence.css";

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString();
};
const same = (a, b) => String(a ?? "") === String(b ?? "");

/** "signed" when the box's sign-off is at its current value, "stale" when at an older one, "" when none. */
export function signState(signoff, value) {
  if (!signoff) return "";
  return same(signoff.value_at, value) ? "signed" : "stale";
}

function AddForm({ onAdd, busy }) {
  const [kind, setKind] = useState("note");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef(null);
  const ready = kind === "note" ? note.trim() : kind === "link" ? url.trim() : true;
  const submit = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0] || null;
    if (kind === "file" && !file) return;
    const ok = await onAdd({ kind, url: url.trim(), note: note.trim(), file });
    if (ok) {
      setUrl("");
      setNote("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  return (
    <form className="ev-add" onSubmit={submit}>
      <div className="ev-kinds" role="radiogroup" aria-label="Kind of evidence">
        {[["note", StickyNote, "Note"], ["link", LinkIcon, "Link"], ["file", FileText, "File"]].map(([k, Icon, l]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)} data-testid={`ev-kind-${k}`}><Icon size={12} /> {l}</button>
        ))}
      </div>
      {kind === "note" && <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where this value comes from: a quote, a call, a report…" data-testid="ev-note" />}
      {kind === "link" && <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" data-testid="ev-url" />}
      {kind === "file" && <input type="file" ref={fileRef} accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx" data-testid="ev-file" />}
      <button type="submit" className="primary ev-attach" disabled={busy || !ready} data-testid="ev-add"><Paperclip size={12} /> Attach</button>
    </form>
  );
}

function EvidencePop({ tab, box, items, signoff, me, evidence, anchor, onClose, elFor }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef(null);
  // the box's value now, read when the popover opens and again on each action
  const [value, setValue] = useState(box.value);
  const live = useCallback(() => { const el = elFor(box.key); return el ? boxInfo(el, tab, box.tabLabel) : box; }, [elFor, box, tab]);
  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.(".ev-dot")) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", out);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth || 400;
    const h = ref.current?.offsetHeight || 360;
    const left = Math.max(12, Math.min(anchor.x - w + 24, window.innerWidth - w - 12));
    const below = anchor.y + 16;
    const top = below + h > window.innerHeight - 12 ? Math.max(12, anchor.y - h - 24) : below;
    setPos({ left, top });
  }, [anchor.x, anchor.y, items.length]);
  const run = async (fn) => {
    setBusy(true);
    setErr("");
    try { await fn(); return true; } catch (e) { setErr(e.message); return false; } finally { setBusy(false); }
  };
  const add = (ev) => run(async () => {
    const info = live();
    setValue(info.value);
    await evidence.add({ fieldKey: box.key, fieldLabel: box.label, place: info.place, valueAt: info.value, ...ev });
  });
  const sign = (signed) => run(async () => {
    const info = live();
    setValue(info.value);
    await evidence.signOff({ fieldKey: box.key, fieldLabel: box.label, valueAt: info.value, signed });
  });
  const state = signState(signoff, value);
  return (
    <div ref={ref} className="ev-pop" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label={`Evidence for ${box.label}`} data-testid="ev-pop" data-no-ping>
      <header>
        <div>
          <span className="rtc-index"><Paperclip size={11} /> {box.label}</span>
          <small>{box.place}</small>
        </div>
        <a className="rtc-icon-btn ev-register" href={`/api/evidence/register?tab=${encodeURIComponent(tab)}`} download title={`The evidence register of ${box.tabLabel || "this tab"} as CSV`} data-testid="ev-register"><Download size={13} /> Register (CSV)</a>
        <button type="button" className="rtc-icon-btn" onClick={onClose} title="Close"><X size={14} /></button>
      </header>
      <div className="ev-now">Now in the box: <strong>{value === "" ? "empty" : value}</strong></div>
      {signoff && (
        <div className={`ev-state ${state}`} data-testid="ev-state">
          {state === "signed" ? <Check size={13} /> : <ShieldCheck size={13} />}
          <span>
            {state === "signed" ? "Signed off at this value" : <>Signed off at an older value: <strong>{signoff.value_at === "" ? "empty" : signoff.value_at}</strong></>}
            <small>{signoff.signed_by_name || "a super admin"} · {ago(signoff.signed_at)}</small>
          </span>
        </div>
      )}
      <ul className="ev-list" data-testid="ev-list">
        {items.length === 0 && <li className="rtc-note">No evidence yet. Attach the quote, the report or the note this value rests on.</li>}
        {items.map((it) => (
          <li key={it.id} data-testid="ev-item" data-kind={it.kind}>
            <span className="ev-icon">{it.kind === "file" ? <FileText size={13} /> : it.kind === "link" ? <LinkIcon size={13} /> : <StickyNote size={13} />}</span>
            <div>
              {it.kind === "file" && (it.file_id ? <a href={`/api/team/files/${it.file_id}`} download>{it.file_name || "File"}</a> : <em>File removed</em>)}
              {it.kind === "link" && <a href={it.url} target="_blank" rel="noreferrer noopener">{it.url}</a>}
              {it.kind === "note" && <p>{it.note}</p>}
              <small>{it.by_name || "Someone"} · {ago(it.created_at)}{it.value_at !== "" && <> · value then: {it.value_at}</>}</small>
            </div>
            {it.canDelete && <button type="button" className="rtc-icon-btn" title="Remove" disabled={busy} onClick={() => run(() => evidence.remove(it.id))} data-testid="ev-delete"><Trash2 size={13} /></button>}
          </li>
        ))}
      </ul>
      {err && <p className="seci-flag ev-err">{err}</p>}
      <AddForm onAdd={add} busy={busy} />
      {me?.super_admin && (
        <div className="ev-sign">
          {state === "signed"
            ? <button type="button" className="secondary" disabled={busy} onClick={() => sign(false)} data-testid="ev-signoff">Clear sign-off</button>
            : <button type="button" className="secondary" disabled={busy} onClick={() => sign(true)} data-testid="ev-signoff"><ShieldCheck size={12} /> {state === "stale" ? "Sign off this value instead" : "Sign off this value"}</button>}
          {state === "stale" && <button type="button" className="rtc-link" disabled={busy} onClick={() => sign(false)} data-testid="ev-signoff-clear">Clear sign-off</button>}
        </div>
      )}
    </div>
  );
}

/** The layer over the open tab: a paperclip at the top-right corner of every box, left of the send icon. */
export default function EvidenceLayer({ tab, tabLabel, team }) {
  const evidence = useEvidence(tab, Boolean(team?.me));
  const [boxes, setBoxes] = useState([]);
  const [open, setOpen] = useState(null); // { key, label, place, value, anchor }
  const [mode, setMode] = useState(readPingMode);
  const [hot, setHot] = useState(null);
  const els = useRef(new Map());
  const frame = useRef(0);

  const scan = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const list = allBoxes(tab, tabLabel);
      els.current = new Map(list.map((b) => [b.key, b.el]));
      setBoxes(list.map(({ el, ...b }) => {
        const r = el.getBoundingClientRect();
        return { ...b, tabLabel, x: r.right + window.scrollX, y: r.top + window.scrollY, visible: r.width > 0 && r.height > 0 };
      }));
    });
  }, [tab, tabLabel]);

  useEffect(() => {
    scan();
    const main = document.querySelector("main");
    let t = 0;
    const later = () => { clearTimeout(t); t = setTimeout(scan, 200); };
    const mo = main ? new MutationObserver(later) : null;
    mo?.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open", "disabled"] });
    window.addEventListener("resize", later);
    document.addEventListener("scroll", scan, true);
    // a value typed in a box changes its sign-off state (current or older value)
    document.addEventListener("input", later, true);
    document.addEventListener("change", later, true);
    const onMode = () => setMode(readPingMode());
    window.addEventListener("tenderos-ping-mode", onMode);
    return () => {
      mo?.disconnect(); clearTimeout(t); window.removeEventListener("resize", later); document.removeEventListener("scroll", scan, true);
      document.removeEventListener("input", later, true); document.removeEventListener("change", later, true); window.removeEventListener("tenderos-ping-mode", onMode);
    };
  }, [scan]);

  // the box under the mouse or with focus gets its icon at full strength and takes clicks
  useEffect(() => {
    const keyOf = (el) => [...els.current.entries()].find(([, v]) => v === el)?.[0] || null;
    const over = (e) => {
      const el = e.target.closest?.("input, select, textarea");
      if (el && !el.closest(".ev-pop")) setHot(keyOf(el));
      else if (!e.target.closest?.(".ev-dot, .ev-pop, .ping-dot, .ping-pop")) setHot(keyOf(document.activeElement));
    };
    const fin = (e) => { const k = keyOf(e.target); if (k) setHot(k); };
    document.addEventListener("mouseover", over);
    document.addEventListener("focusin", fin);
    return () => { document.removeEventListener("mouseover", over); document.removeEventListener("focusin", fin); };
  }, []);

  const { counts, byKey, signoffs } = evidence;
  const shown = useMemo(() => boxes.filter((b) => b.visible && (mode === "always" || b.key === hot || counts[b.key] || open?.key === b.key)), [boxes, mode, hot, counts, open]);
  if (!team?.me || typeof document === "undefined") return null;
  const elFor = (k) => els.current.get(k) || allBoxes(tab, tabLabel).find((b) => b.key === k)?.el || null;
  return createPortal(
    <>
      <div className="ev-layer">
        {shown.map((b) => {
          const n = counts[b.key]?.items || 0;
          const state = signState(signoffs[b.key], b.value);
          const title = [n ? `${n} piece${n === 1 ? "" : "s"} of evidence for ${b.label}` : `Attach evidence for ${b.label}`,
            state === "signed" ? "signed off at this value" : state === "stale" ? "signed off at an older value" : ""].filter(Boolean).join("; ");
          return (
            <button key={b.key} type="button" className={`ev-dot ${n ? "has" : ""} ${state} ${b.key === hot || open?.key === b.key ? "hot" : ""}`}
              style={{ left: b.x - 34, top: b.y - 10 }} title={title} data-testid="ev-dot" data-ev-key={b.key} data-ev-count={n} data-ev-state={state || "none"}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setOpen(open?.key === b.key ? null : { ...b, anchor: { x: r.right, y: r.bottom } }); }}>
              <Paperclip size={10} />
              {n ? <span>{n}</span> : null}
              {state && <i className="ev-tick" aria-hidden="true"><Check size={8} /></i>}
            </button>
          );
        })}
      </div>
      {open && (
        <EvidencePop key={open.key} tab={tab} box={open} items={byKey[open.key] || []} signoff={signoffs[open.key] || null} me={team.me} evidence={evidence}
          anchor={open.anchor} onClose={() => setOpen(null)} elFor={elFor} />
      )}
    </>,
    document.body,
  );
}
