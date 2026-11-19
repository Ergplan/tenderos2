"use client";
// The Tender & amendments step with two views: the documents and the amendment row by row (the
// tab's own step), and the amended documents whole, in track-change form (TrackedDocument).
import React, { useState } from "react";
import { FileDiff, FileStack } from "lucide-react";
import TrackedDocument, { amendedDocuments } from "./TrackedDocument.jsx";

export default function DocumentsView({ pack, children }) {
  const [view, setView] = useState("documents");
  const docs = amendedDocuments(pack);
  const names = docs.map((d) => d.doc.title.replace(/^Standard\s+/i, "")).join(" & ");
  return (
    <>
      <div className="trk-views" role="tablist" aria-label="View">
        <button type="button" role="tab" aria-selected={view === "documents"} className={view === "documents" ? "active" : ""} onClick={() => setView("documents")} data-testid="trk-view-documents">
          <FileStack size={14} /> Documents and amendments
        </button>
        <button type="button" role="tab" aria-selected={view === "tracked"} className={view === "tracked" ? "active" : ""} onClick={() => setView("tracked")} data-testid="trk-view-tracked" disabled={!docs.length}>
          <FileDiff size={14} /> {docs.length ? `Amended ${names}: track changes` : "No amended document yet"}
        </button>
      </div>
      {view === "tracked" ? <TrackedDocument pack={pack} /> : children}
    </>
  );
}
