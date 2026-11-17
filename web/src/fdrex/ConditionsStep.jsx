// SECI-FDRE-X: the Bid conditions step. Every condition of the RfS, the standard PPA and the
// standard PSA as it stands after Amendment-01 (./terms.js), quoted with its page; under a clause
// the amendment deleted, the wording as issued. Forked from the CfD-I step
// (web/src/cfd/ConditionsStep.jsx); class names and test ids are shared with it.
import React, { useState } from "react";
import { FileSearch, MessageSquareQuote, TriangleAlert } from "lucide-react";
import AssignButton from "../team/AssignButton";
import { Section } from "../rtc/ui";
import { DOCUMENTS, TERMS, docById, termById } from "./terms.js";
import { PACK } from "./pack.js";
import "../cfd/pack.css";

// the groups in reading order: the scheme, the bid, the money, then the plant, its operation and what it is paid
const ORDER = ["Scheme and bid", "Bid documents", "Eligibility", "Auction", "Bid security and charges", "Dates", "Plant", "Energy sourcing", "Daily supply", "Tariff and payment", "Penalties and security"];
const place = (g) => (ORDER.includes(g) ? ORDER.indexOf(g) : ORDER.length); // a group not listed here goes last
const AMENDMENTS = new Set(DOCUMENTS.filter((d) => /^amd/.test(d.id)).map((d) => d.id));
const AGREEMENTS = new Set(["ppa", "psa"]);
// the term in force each replaced (original) term belongs under, for "as issued" beside it: here the
// amendment's deletion "<id>Deleted" stands over the deleted clause "<id>" of the PPA or the PSA
const WAS = Object.fromEntries(TERMS.filter((t) => AMENDMENTS.has(t.doc) && termById[t.id.replace(/Deleted$/, "")]?.status === "replaced")
  .map((t) => [t.id, [t.id.replace(/Deleted$/, "")]]));
const isDeletion = (t) => AMENDMENTS.has(t.doc) && /\(deleted\)$/i.test(t.clause);
const clauseOf = (t) => t.clause.replace(/ \((amended|original.*|addendum.*)\)$/, "");

function badge(t) {
  if (t.status === "replaced") return { cls: "replaced", text: `${termById[`${t.id}Deleted`] ? "Deleted" : "Replaced"}${t.by ? ` · ${docById[t.by].short}` : ""}` };
  if (t.status === "conflict") return { cls: "conflict", text: t.badge || "Documents differ" };
  if (AMENDMENTS.has(t.doc)) return { cls: "amended", text: `${isDeletion(t) ? "Deleted" : "Amended"} · ${docById[t.doc].short}` };
  if (AGREEMENTS.has(t.doc)) return { cls: "cfda", text: docById[t.doc].short };
  return { cls: "unchanged", text: "As issued" };
}

/** A term's citation: document, clause and page, linked to the PDF page where the document is provided. */
export function TermCite({ id }) {
  const t = termById[id];
  if (!t) return null;
  const doc = docById[t.doc];
  const pdfPage = t.page + (doc.pdfOffset || 0);
  const href = doc.file ? `${PACK.folder}${doc.file}#page=${pdfPage}` : null;
  const text = `${doc.short} ${clauseOf(t)}, p. ${t.page}`;
  return (
    <span className="cfd-cond-cite" title={doc.title}>
      <FileSearch size={10} />
      {href ? <a href={href} target="_blank" rel="noreferrer">{text}</a> : <span>{text}</span>}
    </span>
  );
}

/** Step: every bid condition now in force (after Amendment-01), with its quote, page and history. */
export default function ConditionsStep({ state = null }) {
  const [only, setOnly] = useState("all");
  const groups = [...new Set(TERMS.map((t) => t.group))].sort((a, b) => place(a) - place(b));
  const count = (f) => TERMS.filter(f).length;
  const shown = (t) => only === "all" || (only === "amended" && (AMENDMENTS.has(t.doc) || t.status === "replaced")) || (only === "conflict" && t.status === "conflict") || (only === "rfs" && t.doc === "rfs" && !t.status) || (only === "cfda" && AGREEMENTS.has(t.doc));
  const provided = DOCUMENTS.filter((d) => d.file).map((d) => d.short).join(", ");
  return (
    <Section index="2" title="Bid conditions" note="The RfS, the PPA and the PSA as they stand after Amendment-01"
      actions={(
        <div className="cfd-cond-filter" role="tablist">
          {[["all", "All"], ["amended", "Amended"], ["conflict", "Differ"], ["rfs", "RfS"], ["cfda", "PPA / PSA"]].map(([id, label]) => (
            <button key={id} type="button" className={only === id ? "active" : ""} onClick={() => setOnly(id)} data-testid={`cfd-cond-filter-${id}`}>{label}</button>
          ))}
        </div>
      )}>
      <p className="rtc-note" data-testid="cfd-cond-summary">
        {TERMS.length} conditions: {count((t) => AMENDMENTS.has(t.doc))} from Amendment-01, {count((t) => t.status === "replaced")} clauses it deleted, {count((t) => t.status === "conflict")} where the documents differ or are unclear. Each is quoted word for word with its page; the quotes from the {provided} link to the PDF page. Under a clause the amendment deleted, “As issued” shows the original wording.
      </p>
      {groups.map((g) => {
        const terms = TERMS.filter((t) => t.group === g && shown(t));
        if (!terms.length) return null;
        return (
          <div key={g}>
            <div className="seci-group-title">{g} · {terms.length}</div>
            <div className="seci-conds">
              {terms.map((t) => {
                const b = badge(t);
                const was = (WAS[t.id] || []).map((id) => termById[id]).filter(Boolean);
                const reading = state?.clarifications?.[t.id];
                return (
                  <div key={t.id} className={`seci-cond ${t.status || ""}`} data-testid={`cfd-term-${t.id}`}>
                    <strong>{t.label}</strong>
                    <div className="seci-cond-body">
                      <b>{t.display}</b>
                      {t.status === "conflict" && <span className="seci-flag"><TriangleAlert size={12} /> {t.flag || "The documents differ here; the PPA read with the PSA prevails over the RfS. Raise it with SECI."}</span>}
                      <span className="seci-quote-link"><q>{t.quote}</q> <TermCite id={t.id} /></span>
                      {reading && (
                        <div className="team-clarified" data-testid={`cfd-term-clarified-${t.id}`}>
                          <MessageSquareQuote size={12} /> <b>Our reading{reading.by ? ` (${reading.by})` : ""}:</b> {reading.text}
                          {reading.fileId && <a href={`/api/team/files/${reading.fileId}`}> {reading.fileName}</a>}
                        </div>
                      )}
                      <AssignButton target={{ kind: "condition", key: `condition.${t.id}`, label: t.label, context: { quote: t.quote, page: t.page, value: t.display } }} />
                      {was.length > 0 && (
                        <details className="seci-rfs-orig">
                          <summary>As issued</summary>
                          {was.map((w) => <p key={w.id}>{w.display} <span className="seci-quote-link"><q>{w.quote}</q> <TermCite id={w.id} /></span></p>)}
                        </details>
                      )}
                    </div>
                    <span className={`seci-badge ${b.cls}`}>{b.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </Section>
  );
}
