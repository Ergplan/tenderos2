"use client";
// The amended document, whole, in track-change form: each document an amendment changes (the RfS,
// and the PPA or PSA when the pack has them), page by page, with the text an amendment replaces
// struck through and the new text inserted after it, labelled with the amendment and clause. Three
// readings: track changes, the amended text alone, the original as printed. Changes whose original
// wording is not in the document are listed above it. The text comes from
// web/public/tenders/<tender>/text/ (tools/build_tender_text.py); the placing from ./trackChanges.js.
import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileDiff, ListTree } from "lucide-react";
import { documentFor, pieces, quoteText, trackDocument } from "./trackChanges.js";
import "./tracked.css";

const MODES = [["track", "Track changes"], ["amended", "Amended text"], ["original", "Original"]];
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

/** The documents of a pack that an amendment changes and that are in the pack as a PDF, RfS first. */
export function amendedDocuments(pack) {
  const out = new Map();
  for (const c of pack.changes || []) {
    const doc = documentFor(pack.documents, c.document);
    if (!doc?.file || doc.kind === "amendment") continue;
    if (!out.has(doc.id)) out.set(doc.id, { doc, changes: [] });
    out.get(doc.id).changes.push(c);
  }
  return [...out.values()].sort((a, b) => (a.doc.id === "rfs" ? -1 : b.doc.id === "rfs" ? 1 : 0));
}

const textUrl = (pack, doc) => `${pack.folder}text/${doc.file.replace(/\.pdf$/i, ".json")}`;
const pdfUrl = (pack, doc, page) => `${pack.folder}${doc.file}#page=${page}`;

function Tag({ change, amendments }) {
  const a = amendments[change.doc];
  return <span className="trk-tag">{a?.title || change.doc}{a?.date ? ` · ${fmtDate(a.date)}` : ""} · {change.document} {change.clause}</span>;
}

export default function TrackedDocument({ pack }) {
  const docs = useMemo(() => amendedDocuments(pack), [pack]);
  const amendments = useMemo(() => Object.fromEntries(pack.documents.map((d) => [d.id, d])), [pack]);
  const [docId, setDocId] = useState(docs[0]?.doc.id || null);
  const [mode, setMode] = useState("track");
  const [pages, setPages] = useState(null);
  const [error, setError] = useState(null);
  const current = docs.find((d) => d.doc.id === docId) || docs[0] || null;

  useEffect(() => {
    if (!current) return undefined;
    let live = true;
    setPages(null);
    setError(null);
    fetch(textUrl(pack, current.doc))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (live) setPages(j.pages); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [pack, current]);

  const tracked = useMemo(() => (pages && current ? trackDocument(pages, current.changes, current.doc.id) : null), [pages, current]);

  if (!docs.length) {
    return <p className="rtc-note" data-testid="trk-none">No amendment changes the text of a document in this tender yet: when one is issued, the document appears here with the changes marked.</p>;
  }
  const jump = (id) => document.getElementById(`trk-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  const placedIds = new Set(tracked?.placed.map((p) => p.change.id) || []);

  return (
    <div className="trk" data-testid="trk">
      <div className="trk-bar">
        <div className="trk-docs" role="tablist" aria-label="Document">
          {docs.map(({ doc, changes }) => (
            <button key={doc.id} type="button" role="tab" aria-selected={doc.id === current.doc.id} className={doc.id === current.doc.id ? "active" : ""}
              onClick={() => setDocId(doc.id)} data-testid={`trk-doc-${doc.id}`}>
              <FileDiff size={13} /> {doc.title} <small>{changes.length} change{changes.length === 1 ? "" : "s"}</small>
            </button>
          ))}
        </div>
        <div className="trk-modes" role="radiogroup" aria-label="Reading">
          {MODES.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} className={mode === id ? "active" : ""} onClick={() => setMode(id)} data-testid={`trk-mode-${id}`}>{label}</button>
          ))}
        </div>
      </div>
      <p className="trk-legend">
        <del>Struck through</del>: text an amendment removes or replaces. <ins>Underlined</ins>: the amendment's text, in its place.
        Each change is labelled with the amendment and the clause; the amendment's own wording governs where this layout differs.
      </p>

      {tracked && (
        <details className="trk-index" open={false}>
          <summary><ListTree size={13} /> {tracked.placed.length} of {current.changes.length} changes marked in the text{tracked.unplaced.length ? `; ${tracked.unplaced.length} listed below as they could not be placed` : ""}: go to one</summary>
          <ol>
            {current.changes.map((c) => (
              <li key={c.id}>
                {placedIds.has(c.id)
                  ? <button type="button" className="link" onClick={() => jump(c.id)} data-testid={`trk-jump-${c.id}`}>{c.clause}</button>
                  : <span>{c.clause}</span>}
                {" "}<span className="trk-muted">{amendments[c.doc]?.title || c.doc}</span> {c.topic}
              </li>
            ))}
          </ol>
        </details>
      )}

      {tracked?.unplaced.length > 0 && mode !== "original" && (
        <div className="trk-unplaced" data-testid="trk-unplaced">
          <strong>Changes not placed in the text</strong>
          {tracked.unplaced.map(({ change, reason }) => (
            <div key={change.id} className="trk-unplaced-row" id={`trk-${change.id}`}>
              <Tag change={change} amendments={amendments} />
              {change.before && <p><del>{quoteText(change.before)}</del></p>}
              <p><ins>{change.deleted ? "Deleted." : quoteText(change.after)}</ins></p>
              <small className="trk-muted">Shown here because {reason}.</small>
            </div>
          ))}
        </div>
      )}

      {error && <p className="rtc-note">The document's text could not be loaded ({error}). Open the PDF instead: <a href={pdfUrl(pack, current.doc, 1)} target="_blank" rel="noreferrer">{current.doc.title}</a>.</p>}
      {!pages && !error && <p className="rtc-note">Loading {current.doc.title}…</p>}

      {tracked && (
        <div className="trk-pages" data-testid="trk-pages">
          {pages.map((text, p) => {
            const edits = tracked.edits[p];
            const changed = edits.length > 0 && mode !== "original";
            return (
              <section key={p} className={`trk-page ${changed ? "changed" : ""}`} data-testid={changed ? "trk-page-changed" : undefined}>
                <header>
                  <span>{current.doc.title} · PDF page {p + 1}</span>
                  <a href={pdfUrl(pack, current.doc, p + 1)} target="_blank" rel="noreferrer"><ExternalLink size={11} /> PDF</a>
                </header>
                <div className="trk-text">
                  {pieces(text, edits, mode).map((x, i) => {
                    if (x.text !== undefined) return <React.Fragment key={i}>{x.text}</React.Fragment>;
                    if (x.del !== undefined) return <del key={i} id={`trk-${x.change.id}`} title={`${amendments[x.change.doc]?.title || ""} · ${x.change.clause}: ${x.change.effect || ""}`}>{x.del}</del>;
                    return (
                      <ins key={i} id={x.del === undefined && !edits.some((e) => e.kind === "del" && e.change === x.change) ? `trk-${x.change.id}` : undefined}
                        className={x.added ? "added" : ""} title={x.change.effect || ""} data-testid="trk-ins">
                        {mode === "track" && <Tag change={x.change} amendments={amendments} />}
                        {x.added && mode === "track" ? " " : ""}{x.ins}
                      </ins>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
