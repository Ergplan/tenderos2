import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Paperclip, Unlock, X } from "lucide-react";
import { nf, pf } from "../rtc/ui";
import { withCfdLever } from "./levers.js";

// Freezing a lever: the bidder is sure of a value (a signed quote, a term sheet, a board minute)
// and pins it, with the evidence attached. A frozen lever is written into the bid at that value,
// locked against the benchmark fill and the optimiser, and left alone by every later track: the
// next plan looks for the rest of the gap elsewhere. The record lives in state.frozen[key] and is
// saved with the bid; the evidence goes to the evidence register of the CfD tab (POST /api/evidence,
// box key "cfd:lever:<key>"), where the paperclip and the register CSV show it.

const fmtV = (st, v) => (st.pct ? pf(v, 2) : nf(v, (st.step ?? 1) < 0.01 ? 4 : (st.step ?? 1) < 1 ? 2 : 0));
const unitOf = (st) => (st.pct ? "" : ` ${st.unit || ""}`);

/** Freeze a lever at a value: the bid updated, locked, and the record kept. */
export function freezeLever(state, lever, value, record) {
  const s = withCfdLever(state, { key: lever.key, min: -Infinity, max: Infinity, int: Boolean(lever.int) }, value);
  return {
    ...s,
    locks: { ...(s.locks || {}), [lever.key]: true },
    frozen: { ...(s.frozen || {}), [lever.key]: { key: lever.key, label: lever.label, unit: lever.unit || "", pct: Boolean(lever.pct), step: lever.step ?? 1, value, at: new Date().toISOString(), ...record } },
  };
}

/** Unfreeze: the record and the lock go; the value stays as it is. */
export function unfreezeLever(state, key) {
  const frozen = { ...(state.frozen || {}) };
  delete frozen[key];
  const locks = { ...(state.locks || {}) };
  delete locks[key];
  return { ...state, frozen, locks };
}

/** Attach the evidence of a frozen value to the CfD tab's evidence register; null when nothing was given. */
async function attachEvidence({ lever, value, file, note, url }) {
  const base = { fieldKey: `cfd:lever:${lever.key}`, fieldLabel: lever.label, place: "CfD Bid › What-if › frozen lever", valueAt: String(value), tab: "cfd" };
  let res;
  if (file) {
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...base, kind: "file" })) form.set(k, v);
    form.set("file", file);
    res = await fetch("/api/evidence", { method: "POST", credentials: "same-origin", body: form });
  } else if (url) {
    res = await fetch("/api/evidence", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, kind: "link", url, note: note || "" }) });
  } else if (note) {
    res = await fetch("/api/evidence", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, kind: "note", note }) });
  } else {
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Evidence could not be attached (${res.status})`);
  return data.item || null;
}

/**
 * The freeze dialog: the value to freeze at (the move's, or the current), a note, a file or a link
 * as evidence, then Freeze. onFreeze(value, record) writes the bid.
 */
export function FreezeDialog({ lever, value: initial, me, onFreeze, onClose }) {
  const [value, setValue] = useState(initial);
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shown = lever.pct ? Math.round(value * 10000) / 100 : value;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    let evidence = null;
    let warning = "";
    try {
      evidence = await attachEvidence({ lever, value, file, note, url });
    } catch (err) {
      warning = err.message; // the freeze still happens; the evidence is noted as not attached
    }
    const record = {
      by: me?.name || "you",
      note: note || "",
      evidence: evidence
        ? { id: evidence.id, kind: evidence.kind, name: evidence.file_name || evidence.url || (evidence.kind === "note" ? "note" : ""), warning: "" }
        : file || url || note ? { id: null, kind: file ? "file" : url ? "link" : "note", name: file ? file.name : url || "note", warning: warning || "not in the register" } : null,
    };
    onFreeze(value, record);
    setBusy(false);
    onClose();
  };
  // through a portal on the body: the step's own containers would pin the dialog far down the page
  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal freeze-dialog" onSubmit={submit} data-testid="cfd-freeze-dialog">
        <div className="modal-head">
          <h3><Lock size={14} /> Freeze {lever.label}</h3>
          <button type="button" className="rtc-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p className="freeze-note">A frozen lever is written into the bid at this value, locked, and left alone by every later track: the next plan looks for the rest of the gap elsewhere. Attach what the value rests on: the quote, the term sheet, the board note.</p>
        <label>Value{lever.pct ? " (%)" : lever.unit ? ` (${lever.unit})` : ""}
          <input type="number" step="any" value={shown} onChange={(e) => setValue(lever.pct ? Number(e.target.value) / 100 : Number(e.target.value))} required data-testid="cfd-freeze-value" />
        </label>
        <label>Evidence file<input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="cfd-freeze-file" /></label>
        <label>Or a link<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label>
        <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who gave it, when, on what terms" maxLength={500} data-testid="cfd-freeze-note" /></label>
        {error && <div className="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !Number.isFinite(value)} data-testid="cfd-freeze-confirm"><Lock size={12} /> {busy ? "Freezing…" : `Freeze at ${fmtV(lever, value)}${unitOf(lever)}`}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/**
 * The frozen levers of the bid as a table, with the ground secured so far: the price before the
 * first freeze (`baseline`), the price now (`now`, the bid with the frozen values in it) and the
 * quote (`target`), so the bar reads "₹x of the ₹y gap found, ₹z still to find".
 */
export function FrozenPanel({ frozen, onUnfreeze, baseline = null, now = null, target = null }) {
  const list = Object.values(frozen || {}).sort((a, b) => (Number.isFinite(b.impact) ? b.impact : -Infinity) - (Number.isFinite(a.impact) ? a.impact : -Infinity) || String(b.at || "").localeCompare(String(a.at || "")));
  if (!list.length) return null;
  const gap = Number.isFinite(baseline) && Number.isFinite(target) ? baseline - target : null;
  const secured = Number.isFinite(baseline) && Number.isFinite(now) ? baseline - now : null;
  const left = Number.isFinite(now) && Number.isFinite(target) ? now - target : null;
  const share = gap > 0 && secured !== null ? Math.max(0, Math.min(1, secured / gap)) : null;
  const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
  return (
    <div className="frozen-panel" data-testid="cfd-frozen">
      <div className="frozen-head"><Lock size={13} /> <b>Frozen levers</b> <small>kept as they are in every track; unfreeze to let the plan move them again</small></div>
      {gap !== null && (
        <div className="frozen-progress" data-testid="cfd-frozen-progress">
          <div className="frozen-progress-bar"><i style={{ width: `${Math.round((share ?? 0) * 100)}%` }} /></div>
          <div className="frozen-progress-text">
            {secured >= 0
              ? <>The frozen values have brought the price from <b>₹{nf(baseline, 3)}</b> to <b>₹{nf(now, 3)}</b>: <b>₹{nf(secured, 3)}</b> of the ₹{nf(gap, 3)} gap to ₹{nf(target, 3)} is secured ({pf(share ?? 0, 0)}){left > 0.0005 ? <>; <b>₹{nf(left, 3)}</b> still to find, which the track below plans</> : <>; the quote is reached</>}.</>
              : <>The frozen values have raised the price from ₹{nf(baseline, 3)} to ₹{nf(now, 3)}; ₹{nf(left, 3)} to find for ₹{nf(target, 3)}.</>}
          </div>
        </div>
      )}
      <table className="frozen-table" data-testid="cfd-frozen-table">
        <thead><tr><th>Lever</th><th>Frozen at</th><th>Price impact</th><th>By · on</th><th>Evidence</th><th>Note</th><th /></tr></thead>
        <tbody>
          {list.map((f) => (
            <tr key={f.key} data-testid={`cfd-frozen-${f.key}`}>
              <td><b>{f.label}</b></td>
              <td><b>{fmtV(f, f.value)}</b>{unitOf(f)}</td>
              <td className={Number.isFinite(f.impact) && f.impact < 0 ? "bad" : ""}>{Number.isFinite(f.impact) ? `${f.impact >= 0 ? "−" : "+"}₹${nf(Math.abs(f.impact), 3)}` : "–"}</td>
              <td>{f.by || "you"} · {dateOf(f.at)}</td>
              <td className={f.evidence?.warning || !f.evidence ? "bad" : ""}>{f.evidence ? <><Paperclip size={11} /> {f.evidence.name}{f.evidence.warning ? ` (${f.evidence.warning})` : ""}</> : "none attached"}</td>
              <td>{f.note || ""}</td>
              <td><button type="button" className="secondary" onClick={() => onUnfreeze(f.key)} data-testid={`cfd-unfreeze-${f.key}`}><Unlock size={11} /> Unfreeze</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
