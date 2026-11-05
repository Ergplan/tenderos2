import React, { useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, ClipboardList, Download, FileText, Loader2, RotateCcw, TriangleAlert, UserRound, XCircle } from "lucide-react";
import { Section, nf } from "../rtc/ui";
import { FORM_FIELDS, bidChecks, bidPackRequest, formIssues, termProv, visibleFields } from "./forms.js";
import { FORMATS, RFS_FILE, applies, blankValue, formatGroups, formatPrint, formatStatus, formatsForPack, formatsSummary } from "./formats.js";
import { SourceChip } from "../bid/RequirementsStep";
import LetterView from "../seci/LetterView";
import { TEMPLATES, letterOf, lettersForBid } from "./letters/index.js";
import { downloadLetters } from "./letters/export.js";
import AssignButton from "../team/AssignButton";

export { formIssues };

const ICON = { ok: CheckCircle2, bad: XCircle, warn: TriangleAlert, todo: CircleDashed };
const CLS = { ok: "ok", bad: "bad", warn: "warn", todo: "muted" };
const APPLIES = {
  yes: "Needed for this bid",
  no: "Not needed for this bid",
  later: "After the award, before the CfDA",
  choose: "Needed if you choose this EMD instrument (Your particulars)",
};

async function downloadPack(payload) {
  const res = await fetch("/api/cfd/forms", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${payload.fileName}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** One input of the shared particulars. */
function ParticularInput({ x, value, onChange }) {
  if (x.type === "select") {
    return (
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} data-testid={`cfd-form-field-${x.key}`}>
        <option value="">Choose…</option>
        {x.options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    );
  }
  if (x.type === "textarea") return <textarea rows={3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} data-testid={`cfd-form-field-${x.key}`} />;
  return (
    <input type={x.type} step={x.step} value={value ?? ""} data-testid={`cfd-form-field-${x.key}`}
      onChange={(e) => onChange(x.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} />
  );
}

/** The particulars every format draws on, asked once. */
function Particulars({ state, setField, model }) {
  const f = state.forms || {};
  const groups = [...new Set(FORM_FIELDS.map((x) => x.group))];
  const target = model?.bid ?? null;
  return (
    <div data-testid="cfd-particulars">
      <p className="rtc-note">Asked once and written into every format that needs them. The contracted MW, the plant, the EMD and PBG amounts and the RfS's own details come from the bid itself.</p>
      {groups.map((g) => (
        <div key={g}>
          <div className="seci-group-title">{g}</div>
          <div className="seci-forms">
            {visibleFields(f).filter((x) => x.group === g).map((x) => (
              <label key={x.key} data-voice={`form.${x.key}`}>
                <span>{x.label}{x.required ? " *" : ""} <AssignButton compact target={{ kind: "field", key: `forms.${x.key}`, label: x.label, context: { type: x.type === "number" ? "number" : "text", unit: x.unit || null } }} /></span>
                <ParticularInput x={x} value={f[x.key]} onChange={(v) => setField(x.key, v)} />
                {x.key === "tariff" && target !== null && (
                  <button type="button" className="rtc-reset" onClick={() => setField("tariff", Math.ceil(target * 100 - 1e-9) / 100)} data-testid="cfd-form-use-tariff">
                    Use ₹{nf(Math.ceil(target * 100 - 1e-9) / 100, 2)}/kWh (target IRR, rounded up)
                  </button>
                )}
                {x.key === "tariff" && typeof f.tariff === "number" && target !== null && (
                  <small className={f.tariff < target - 1e-9 ? "warn" : "ok"} data-testid="cfd-quote-check">
                    {f.tariff < target - 1e-9 ? `Below the ₹${target.toFixed(2)}/kWh your target equity IRR needs (Financial model)` : `At or above the ₹${target.toFixed(2)}/kWh your target equity IRR needs`}
                  </small>
                )}
                {x.hint && <small>{x.hint}</small>}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A blank of a format: its value (from the bid, the particulars or typed here) and where it sits in the RfS. */
function Blank({ state, format, field, setField, onFocusPage }) {
  const b = blankValue(state, format, field);
  const raw = state.forms?.[b.key];
  const testid = `cfd-blank-${format.id}-${field.key}`;
  let control;
  if (b.source === "na") {
    control = <div className="seci-blank-model na" data-testid={testid}>{b.value}</div>;
  } else if (b.source === "model") {
    control = <div className="seci-blank-model" data-testid={testid}>{b.value || <em>Enter the bid and the plant first</em>}</div>;
  } else if (b.source === "shared") {
    const x = FORM_FIELDS.find((y) => y.key === b.key);
    control = x
      ? <ParticularInput x={x} value={raw} onChange={(v) => setField(b.key, v)} />
      : <input value={raw ?? ""} onChange={(e) => setField(b.key, e.target.value)} data-testid={testid} />;
  } else if (field.kind === "choice") {
    control = (
      <select value={raw ?? ""} onChange={(e) => setField(b.key, e.target.value || null)} data-testid={testid}>
        <option value="">Choose…</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (field.kind === "textarea" || field.kind === "table") {
    control = <textarea rows={field.kind === "table" ? 4 : 2} value={raw ?? ""} onChange={(e) => setField(b.key, e.target.value)} placeholder={field.kind === "table" ? "One row per line, or 'attached as Exhibit …'" : ""} data-testid={testid} />;
  } else {
    control = <input type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"} value={raw ?? ""} data-testid={testid}
      onChange={(e) => setField(b.key, field.kind === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} />;
  }
  const empty = !b.value && field.kind !== "table";
  return (
    <div className={`seci-blank ${empty ? "empty" : ""}`} data-voice={`form.${b.key}`} onFocus={() => onFocusPage(field.context.page)}>
      <div className="seci-blank-head">
        <span>{field.label}{(b.source === "own" || b.source === "shared") && (
          <AssignButton compact target={{ kind: "field", key: `forms.${b.key}`, label: `Format ${format.id}: ${field.label}`, context: { type: field.kind === "number" ? "number" : "text", quote: field.context.quote, page: field.context.page } }} />
        )}</span>
        <em>{b.source === "na" ? "consortium only" : b.source === "model" ? "from your bid" : b.source === "shared" ? "your particulars" : field.kind === "table" ? "schedule, optional" : "this format"}</em>
      </div>
      {control}
      <button type="button" className="seci-blank-ctx" onClick={() => onFocusPage(field.context.page)} title="Show this place in the RfS">
        <q>{field.context.quote}</q> p. {field.context.page}
      </button>
    </div>
  );
}

/** One format: what it is, its blanks beside the RfS page, the enclosures, and the review mark. */
function FormatView({ state, setState, format, setField, onPrev, onNext }) {
  const [page, setPage] = useState(format.pages[0]);
  const mode = TEMPLATES[format.id] && state.formsMode === "letter" ? "letter" : "blanks";
  const setMode = (m) => setState((st) => ({ ...st, formsMode: m }));
  const s = formatStatus(state, format);
  const pages = [];
  for (let p = format.pages[0]; p <= format.pages[1]; p += 1) pages.push(p);
  const markReviewed = (on) => setState((st) => {
    const next = { ...(st.formsReview || {}) };
    if (on) next[format.id] = { at: new Date().toISOString(), print: formatPrint(st, format) };
    else delete next[format.id];
    return { ...st, formsReview: next };
  });
  return (
    <div className="seci-format" data-testid={`cfd-form-${format.id}`}>
      <header className="seci-format-head">
        <div>
          <small>Format {format.id.replace("7.8-annex", "7.8 annexure")}</small>
          <h3>{format.title}</h3>
          <p>{format.purpose}</p>
        </div>
        <span className={`seci-badge ${s.applies === "yes" ? "unchanged" : s.applies === "no" ? "removed" : "amended"}`} data-testid="cfd-format-applies">{APPLIES[s.applies]}</span>
      </header>
      <div className="team-format-row">
        {state.signed?.[format.id]
          ? <a className="team-chip accepted" href={`/api/team/files/${state.signed[format.id].fileId}`} data-testid="cfd-format-signed"><CheckCircle2 size={11} /> Signed copy: {state.signed[format.id].name}{state.signed[format.id].by ? ` · ${state.signed[format.id].by}` : ""}</a>
          : null}
        <AssignButton target={{ kind: "document", key: `format.${format.id}`, label: `Format ${format.id}: ${format.title} (signed copy)`, context: { paper: format.paper, signer: format.submittedBy, page: format.pages[0] } }} />
      </div>
      <dl className="seci-format-meta">
        <div><dt>Signed by</dt><dd>{format.submittedBy}</dd></div>
        <div><dt>On</dt><dd>{format.paper}</dd></div>
        <div><dt>Goes in</dt><dd>{format.envelope}</dd></div>
        <div><dt>When</dt><dd>{format.when}</dd></div>
        <div><dt>In the RfS</dt><dd><a className="seci-link" href={`${RFS_FILE}#page=${format.pages[0]}`} target="_blank" rel="noreferrer">PDF pp. {format.pages[0]}–{format.pages[1]}</a></dd></div>
      </dl>
      {TEMPLATES[format.id] && (
        <div className="seci-format-modes" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "blanks"} className={mode === "blanks" ? "active" : ""} onClick={() => setMode("blanks")} data-testid="cfd-format-mode-blanks">Blanks beside the RfS</button>
          <button type="button" role="tab" aria-selected={mode === "letter"} className={mode === "letter" ? "active" : ""} onClick={() => setMode("letter")} data-testid="cfd-format-mode-letter">The letter</button>
        </div>
      )}
      {mode === "letter" ? <LetterView state={state} setState={setState} format={format} letterOf={letterOf} download={downloadLetters} testid="cfd-letter" /> : (
      <div className="seci-format-body">
        <div className="seci-blanks">
          <div className="seci-group-title">{s.total ? `${s.filled} of ${s.total} blanks filled` : "Nothing to fill: sign and stamp the RfS document"}</div>
          {format.fields.map((x) => <Blank key={x.key} state={state} format={format} field={x} setField={setField} onFocusPage={setPage} />)}
          {(format.attachments || []).length > 0 && (
            <>
              <div className="seci-group-title">Enclose</div>
              {format.attachments.map((a, i) => (
                <div key={i} className="seci-attach">
                  <input type="checkbox" id={`cfd-att-${format.id}-${i}`} checked={Boolean(state.forms?.[`${format.id}.att.${i}`])} onChange={(e) => setField(`${format.id}.att.${i}`, e.target.checked || null)} data-testid={`cfd-attach-${format.id}-${i}`} />
                  <label htmlFor={`cfd-att-${format.id}-${i}`}>{a.label}</label>
                  <button type="button" className="seci-blank-ctx inline" onClick={() => setPage(a.context.page)}>p. {a.context.page}</button>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="seci-rfs-view">
          <div className="seci-rfs-pages">
            {pages.map((p) => <button key={p} type="button" className={p === page ? "active" : ""} onClick={() => setPage(p)}>p. {p}</button>)}
          </div>
          <iframe title={`RfS page ${page}`} src={`${RFS_FILE}#page=${page}&view=FitH`} data-testid="cfd-rfs-frame" />
        </div>
      </div>
      )}
      <footer className="seci-format-foot">
        <button type="button" className="secondary" onClick={onPrev} disabled={!onPrev}><ChevronLeft size={14} /> Previous</button>
        {s.reviewed === "current" ? (
          <span className="bid-check ok" data-testid="cfd-form-reviewed"><CheckCircle2 size={14} /> Reviewed {new Date(s.reviewedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            <button type="button" className="rtc-reset" onClick={() => markReviewed(false)}><RotateCcw size={12} /> Undo</button></span>
        ) : (
          <button type="button" className="primary" onClick={() => markReviewed(true)} data-testid="cfd-form-review">
            <CheckCircle2 size={14} /> {s.reviewed === "changed" ? "Changed since review: mark reviewed again" : s.missing.length ? `Mark reviewed (${s.missing.length} blank${s.missing.length > 1 ? "s" : ""} empty)` : "Mark reviewed"}
          </button>
        )}
        <button type="button" className="secondary" onClick={onNext} disabled={!onNext}>Next <ChevronRight size={14} /></button>
      </footer>
    </div>
  );
}

function navBadge(st) {
  if (st.applies === "no") return <em className="muted">not needed</em>;
  if (st.applies === "later") return <em className="muted">after award</em>;
  if (st.reviewed === "current") return <em className="ok"><CheckCircle2 size={11} /> reviewed</em>;
  if (st.reviewed === "changed") return <em className="warn">changed</em>;
  return st.missing.length ? <em className="warn">{st.missing.length} to fill</em> : <em>to review</em>;
}

/**
 * The CfD bid forms: the particulars once, then every RfS format this bid needs, reviewed one by
 * one, and the checks against the tender. model: the CfD model (runModel) once it has run, for the
 * strike price the target IRR needs; index: the section number on the step.
 */
export default function BidForms({ state, setState, goto, model = null, index = "10" }) {
  const [saving, setSaving] = useState(false);
  const [lettersBusy, setLettersBusy] = useState("");
  const [error, setError] = useState("");
  const view = state.formsView || "particulars"; // in the tab's state, so the voice agent can open a format
  const setView = (id) => setState((s) => ({ ...s, formsView: id }));
  const setField = (key, value) => setState((s) => ({ ...s, forms: { ...(s.forms || {}), [key]: value } }));
  const checks = bidChecks(state, model);
  const issues = formIssues(state);
  const groups = formatGroups(state);
  const sum = formatsSummary(state);
  const order = groups.filter((g) => g.id !== "na").flatMap((g) => g.list);
  const format = FORMATS.find((f) => f.id === view) || null;
  const at = format ? order.findIndex((f) => f.id === format.id) : -1;
  const modelReady = Boolean(model);

  return (
    <>
      <Section index={index} title="Bid forms" note={`${sum.needed} RfS formats for this bid · ${sum.reviewed} reviewed · ${sum.blanksLeft} blanks to fill`}
        actions={(
          <>
          {["word", "pdf"].map((kind) => (
            <button key={kind} type="button" className="secondary" disabled={Boolean(lettersBusy)} data-testid={`cfd-letters-${kind === "word" ? "docx" : "pdf"}`}
              title="Every format this bid needs, as its full letter in the RfS wording with your blanks and edits"
              onClick={async () => {
                setLettersBusy(kind); setError("");
                try { await downloadLetters(lettersForBid(state), kind); } catch (err) { setError(err.message); } finally { setLettersBusy(""); }
              }}>
              {lettersBusy === kind ? <Loader2 className="spin" size={14} /> : <FileText size={14} />} All letters ({kind === "word" ? "Word" : "PDF"})
            </button>
          ))}
          <button type="button" className="primary" disabled={saving} data-testid="cfd-forms-download"
            onClick={async () => {
              setSaving(true); setError("");
              try { await downloadPack({ ...bidPackRequest(state, model), formats: formatsForPack(state) }); } catch (err) { setError(err.message); } finally { setSaving(false); }
            }}>
            {saving ? <Loader2 className="spin" size={14} /> : <Download size={14} />} Download bid pack (Word)
          </button>
          </>
        )}>
        {error && <div className="alert"><TriangleAlert size={14} /> {error}</div>}
        <div className="seci-forms-layout" data-testid="cfd-forms">
          <nav className="seci-forms-nav" aria-label="Bid formats" data-testid="cfd-forms-nav">
            <button type="button" className={view === "particulars" ? "active" : ""} onClick={() => setView("particulars")} data-testid="cfd-formsnav-particulars">
              <UserRound size={13} /> <span>Your particulars</span> {issues.length ? <em className="warn">{issues.length} to fill</em> : <em className="ok"><CheckCircle2 size={11} /> done</em>}
            </button>
            {groups.map((g) => (
              <div key={g.id}>
                <div className="seci-group-title">{g.title}</div>
                {g.list.map((f) => (
                  <button key={f.id} type="button" className={`${view === f.id ? "active" : ""} ${g.id === "na" ? "na" : ""}`} onClick={() => setView(f.id)} data-testid={`cfd-formsnav-${f.id}`}>
                    <FileText size={13} /> <span><b>{f.id.replace("7.8-annex", "7.8 ann.")}</b> {f.title}</span> {navBadge(formatStatus(state, f))}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="seci-forms-main">
            {format
              ? <FormatView key={format.id} state={state} setState={setState} format={format} setField={setField}
                  onPrev={at > 0 ? () => setView(order[at - 1].id) : null} onNext={at >= 0 && at < order.length - 1 ? () => setView(order[at + 1].id) : null} />
              : <Particulars state={state} setField={setField} model={model} />}
          </div>
        </div>
      </Section>

      <Section index={`${index}.1`} title="Checks" note={issues.length ? `${issues.length} required particular${issues.length > 1 ? "s" : ""} still empty` : "Every required particular is filled"}>
        {!modelReady && <p className="rtc-note">Run the model first (Size): the strike price check needs the price your target IRR requires. <button type="button" className="rtc-reset" onClick={() => goto("size")}>Go to Size</button></p>}
        <div className="seci-checks" data-testid="cfd-forms-checks">
          {checks.map((c) => {
            const Icon = ICON[c.status];
            return (
              <div key={c.id} data-testid={`cfd-check-${c.id}`}>
                <strong>{c.label}</strong>
                <span>{c.detail} <SourceChip source={termProv(c.condition)} compact /></span>
                <span className={`bid-check ${CLS[c.status]}`}><Icon size={14} /> {{ ok: "OK", bad: "Not met", warn: "Check", todo: "To do" }[c.status]}</span>
              </div>
            );
          })}
          <div data-testid="cfd-check-formats">
            <strong>RfS formats</strong>
            <span>{sum.reviewed} of {sum.needed} reviewed; {sum.blanksLeft} blanks empty. <ClipboardList size={12} /> Print each on the paper it names and sign it.</span>
            <span className={`bid-check ${sum.reviewed === sum.needed && sum.blanksLeft === 0 ? "ok" : "muted"}`}>{sum.reviewed === sum.needed && sum.blanksLeft === 0 ? <><CheckCircle2 size={14} /> OK</> : <><CircleDashed size={14} /> To do</>}</span>
          </div>
        </div>
        <p className="rtc-note">SECI CfD-I: bidders within L1 + 2% of the lowest strike price win, up to 80% of the qualified capacity (at most 500 MW); the strike price is fixed for the 15-year term and settled every 15-minute block against the market price.</p>
      </Section>
    </>
  );
}
