import React, { useState } from "react";
import { FileSearch, MessageSquareQuote, TriangleAlert } from "lucide-react";
import AssignButton from "../team/AssignButton";
import { Section } from "../rtc/ui";
import { DOCUMENTS, TERMS, docById, termById } from "./terms.js";
import { PACK } from "./pack.js";
import "./pack.css";

// the groups in reading order: the scheme, the bid, the money, then the plant and its operation
const ORDER = ["Scheme and bid", "Bid documents", "Eligibility", "Auction", "Bid security and charges", "Dates", "Plant", "Energy sourcing", "Daily supply", "CfD settlement", "Penalties and security"];
// the amended term each replaced (original) term belongs under, for "as issued" beside the rule in force
const WAS = { bid: ["ceiling"], settlement: ["slabs", "rfsSlabs", "over10"], essOwned: ["essThirdParty"], term: ["rfsTerm12"], essScd: ["rfsScd15"], emdValidityAmd: ["emdShortfall"] };
const AMENDMENTS = new Set(["amd1", "amd2", "amd3", "amd4"]);
const clauseOf = (t) => t.clause.replace(/ \((amended|original.*|addendum.*)\)$/, "");

function badge(t) {
  if (t.status === "replaced") return { cls: "replaced", text: `Replaced${t.by ? ` · ${docById[t.by].short}` : ""}` };
  if (t.status === "conflict") return { cls: "conflict", text: "Documents differ" };
  if (AMENDMENTS.has(t.doc)) return { cls: "amended", text: `Amended · ${docById[t.doc].short}` };
  if (t.doc === "cfda") return { cls: "cfda", text: "CfDA" };
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

/** Step: every bid condition now in force (after the three amendments), with its quote, page and history. */
export default function ConditionsStep({ state = null }) {
  const [only, setOnly] = useState("all");
  const groups = [...new Set(TERMS.map((t) => t.group))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const count = (f) => TERMS.filter(f).length;
  const shown = (t) => only === "all" || (only === "amended" && (AMENDMENTS.has(t.doc) || t.status === "replaced")) || (only === "conflict" && t.status === "conflict") || (only === "rfs" && t.doc === "rfs" && !t.status) || (only === "cfda" && t.doc === "cfda");
  const provided = DOCUMENTS.filter((d) => d.file).map((d) => d.short).join(", ");
  return (
    <Section index="2" title="Bid conditions" note="The RfS and the CfDA as they stand after Amendments 01 to 04"
      actions={(
        <div className="cfd-cond-filter" role="tablist">
          {[["all", "All"], ["amended", "Amended"], ["conflict", "Differ"], ["rfs", "RfS"], ["cfda", "CfDA"]].map(([id, label]) => (
            <button key={id} type="button" className={only === id ? "active" : ""} onClick={() => setOnly(id)} data-testid={`cfd-cond-filter-${id}`}>{label}</button>
          ))}
        </div>
      )}>
      <p className="rtc-note" data-testid="cfd-cond-summary">
        {TERMS.length} conditions: {count((t) => AMENDMENTS.has(t.doc))} from the amendments, {count((t) => t.status === "replaced")} replaced, {count((t) => t.status === "conflict")} where the documents differ. Each is quoted word for word with its page; the quotes from the {provided} link to the PDF page. Under a rule an amendment changed, “As issued” shows the original wording.
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
                      {t.status === "conflict" && <span className="seci-flag"><TriangleAlert size={12} /> The RfS and the CfDA differ here; the CfDA prevails. Raise it with SECI.</span>}
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
