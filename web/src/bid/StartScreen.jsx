import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, FileSearch, FolderOpen, Gavel, Loader2, PlayCircle, Upload } from "lucide-react";
import { nf } from "../rtc/ui";
import { MAX_SET_BYTES, MAX_UPLOAD_BYTES, getJson } from "./readTender";

// the tender the prefilled simulation opens: the WBSEDCL RE-RTC RfQ/RfP reading built into the app
export const PREFILLED_TENDER = "wbsedcl-re-rtc-2026-01";

export const TYPE_LABEL = {
  auto: "Detect from the document",
  fdre: "FDRE (firm and dispatchable)",
  re_rtc: "RE round the clock (RE-RTC)",
  bess: "Battery storage (BESS)",
  cfd: "Contract for Difference (CfD)",
  hybrid: "Wind-solar hybrid",
  solar: "Solar",
  wind: "Wind",
  transmission: "Transmission",
  epc: "EPC",
  generation: "Generation",
  ipp: "IPP",
};

/**
 * The start of the Tender to Bid journey: upload any tender (it is then read on the scan
 * screen), run the prefilled simulation on a tender already read, continue the tender in
 * progress, or open one read before.
 */
export default function StartScreen({ current, onUpload, onOpenSaved, onContinue, error }) {
  const [status, setStatus] = useState(null);
  const [recent, setRecent] = useState(null);
  const [files, setFiles] = useState([]);
  const [type, setType] = useState("auto");
  const [mode, setMode] = useState("auto");
  const [opening, setOpening] = useState("");
  const [localError, setLocalError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    getJson("/api/bid/tender/status").then(setStatus).catch(() => setStatus({ llm_available: false, types: Object.keys(TYPE_LABEL).filter((t) => t !== "auto"), unavailable: true }));
    getJson("/api/tenders").then((d) => setRecent(d.tenders || [])).catch(() => setRecent([]));
  }, []);

  const prefilled = recent?.find((t) => t.seed_key === PREFILLED_TENDER) || null;
  const others = (recent || []).filter((t) => t.seed_key !== PREFILLED_TENDER).slice(0, 6);
  const currentNumber = current?.tender?.result?.values?.["core.identity.tender_number"] || current?.tender?.name;

  // one file is read as a tender; several as a tender set (the RfS with its amendments,
  // clarifications and agreements), the amendments applied to the RfS
  function choose(list) {
    setLocalError("");
    const picked = Array.from(list || []);
    if (!picked.length) return;
    if (picked.some((f) => f.size > MAX_UPLOAD_BYTES)) { setLocalError("Each file must be at most 60 MB."); return; }
    if (picked.reduce((n, f) => n + f.size, 0) > MAX_SET_BYTES) { setLocalError("The set is larger than 120 MB."); return; }
    if (picked.length > (status?.set?.max_files || 20)) { setLocalError(`A tender set takes at most ${status?.set?.max_files || 20} files.`); return; }
    setFiles(picked);
  }
  const file = files[0] || null;
  const isSet = files.length > 1;
  const totalMb = files.reduce((n, f) => n + f.size, 0) / 1024 / 1024;

  async function open(item, how) {
    setOpening(item.id);
    setLocalError("");
    try {
      await onOpenSaved(item, how);
    } catch (err) {
      setLocalError(err.message);
      setOpening("");
    }
  }

  return (
    <div className="bid-start" data-testid="bid-start">
      <section className="story-hero">
        <div>
          <div className="eyebrow"><Gavel size={13} /> TenderOS · Tender to bid</div>
          <h1>Start with a tender</h1>
          <p>Upload any power tender (RfS, RfQ, RfP or NIT) and TenderOS reads it: every date, condition and figure, each with the page it is printed on. Add its amendments, clarifications and draft PPA/PSA and the amendments are applied to the RfS. Or run the prefilled simulation on a tender that has already been read.</p>
        </div>
      </section>

      {current?.tender && (
        <button type="button" className="bid-start-continue" onClick={onContinue} data-testid="start-continue">
          <span><small>Continue where you left off</small><strong>{currentNumber}</strong></span>
          <ArrowRight size={16} />
        </button>
      )}

      <div className="bid-start-grid">
        <section className="bid-start-card upload" data-testid="start-upload">
          <span className="bid-start-tag">New tender</span>
          <h2>Upload a tender</h2>
          <button type="button" className="bid-drop" onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer.files); }}>
            <Upload size={24} />
            <strong>{isSet ? `${files.length} documents: a tender set` : file ? file.name : "Choose the RfS / RfP, with its amendments"}</strong>
            <small>{file ? `${nf(totalMb, 1)} MB` : "or drop them here · one tender, or the RfS with its amendments, clarifications and PPA/PSA · PDF, Word or text"}</small>
          </button>
          <input ref={inputRef} type="file" accept=".pdf,.docx,.txt" multiple hidden data-testid="bid-file"
            onChange={(e) => { choose(e.target.files); e.target.value = ""; }} />
          {isSet && (
            <ul className="bid-set-files" data-testid="start-set-files">
              {files.map((f) => <li key={f.name}>{f.name} <small>{nf(f.size / 1024 / 1024, 1)} MB</small></li>)}
            </ul>
          )}
          <div className="bid-start-options">
            <label className="rtc-field">
              <div className="rtc-field-top"><span>Tender type</span></div>
              <select value={type} onChange={(e) => setType(e.target.value)} data-testid="start-type">
                {["auto", ...(status?.types || [])].map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
              </select>
            </label>
            <label className="rtc-field">
              <div className="rtc-field-top"><span>Reading</span></div>
              <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={!status?.llm_available || status?.require_llm}>
                <option value="auto">{status?.llm_available ? "Full reading by the tender engine's model" : "Rule-based reading (no model key on this server)"}</option>
                {status?.llm_available && !status?.require_llm && <option value="rules">Rule-based reading only (seconds)</option>}
              </select>
            </label>
          </div>
          <button type="button" className="primary" disabled={!file} onClick={() => onUpload(isSet ? files : file, { type, mode })} data-testid="bid-read">
            <FileSearch size={15} /> {isSet ? `Read the tender set (${files.length})` : "Read tender"}
          </button>
          <p className="rtc-note">Solar, wind, hybrid, FDRE, RE-RTC, battery storage, transmission, EPC and other power tenders.</p>
        </section>

        <section className="bid-start-card prefilled" data-testid="start-prefilled">
          <span className="bid-start-tag">Prefilled simulation</span>
          {recent === null && <p className="rtc-note"><Loader2 className="spin" size={13} /> Loading</p>}
          {recent && !prefilled && <p className="rtc-note">The prefilled tender is not available on this server.</p>}
          {prefilled && (
            <>
              <h2>{prefilled.tender_number || prefilled.file_name}</h2>
              <p className="bid-start-issuer">{prefilled.issuer}</p>
              {prefilled.title && <p className="bid-start-title">{prefilled.title}</p>}
              <dl className="bid-start-facts">
                {prefilled.capacity_mw && <div><dt>Capacity</dt><dd>{nf(prefilled.capacity_mw, 0)} MW</dd></div>}
                {prefilled.pages && <div><dt>Pages</dt><dd>{nf(prefilled.pages, 0)}</dd></div>}
                {prefilled.found !== null && <div><dt>Fields read</dt><dd>{prefilled.found}</dd></div>}
              </dl>
              <button type="button" className="primary" onClick={() => open(prefilled, "prefilled")} disabled={Boolean(opening)} data-testid="start-run-prefilled">
                {opening === prefilled.id ? <Loader2 className="spin" size={15} /> : <PlayCircle size={15} />} Run the simulation
              </button>
              <p className="rtc-note">Already read: opens straight in the workflow, from the tender's requirements to the bid's financial model.</p>
            </>
          )}
        </section>
      </div>

      {(localError || error) && <div className="alert">{localError || error}</div>}

      {others.length > 0 && (
        <section className="bid-start-recent">
          <h3>Read before</h3>
          <div className="bid-recent" role="table" data-testid="start-recent">
            {others.map((t) => (
              <div key={t.id} className="bid-recent-row start" role="row">
                <span><strong>{t.tender_number || t.file_name}</strong><small>{t.title || t.file_name}</small></span>
                <span>{t.issuer || "–"}</span>
                <span>{t.capacity_mw ? `${nf(t.capacity_mw, 0)} MW` : "–"}</span>
                <span><small>{t.pages ? `${t.pages} pages` : ""}</small><small>{new Date(t.created_at).toLocaleDateString()}</small></span>
                <span><button type="button" className="secondary" onClick={() => open(t, "saved")} disabled={Boolean(opening)}>{opening === t.id ? <Loader2 className="spin" size={13} /> : <FolderOpen size={13} />} Open</button></span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
