import React, { useState } from "react";
import { FileText, MessageCircleQuestion } from "lucide-react";
import { Section } from "../rtc/ui";
import { PACK } from "./terms";

const fmtDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "–");
const docOf = (id) => PACK.documents.find((d) => d.id === id);
// a quote that itself quotes a term ("SOLAR HOURS" shall mean ...) reads with single marks inside the outer ones
const inner = (text) => String(text).replace(/"([^"]*)"/g, "‘$1’");

/** A quote with a link to its page in the PDF. */
export function QuoteLink({ quote, label = null }) {
  const doc = docOf(quote.doc);
  return (
    <span className="seci-quote-link">
      <q>{inner(quote.quote)}</q>{" "}
      {doc?.file
        ? <a className="seci-link" href={`${PACK.folder}${doc.file}#page=${quote.page}`} target="_blank" rel="noreferrer">{label || doc.title}, p. {quote.page}</a>
        : <span className="seci-link">{doc?.title}</span>}
    </span>
  );
}

/** Step 1: the tender's documents, the amendment trail clause by clause, and SECI's clarifications. */
export default function DocumentsStep() {
  const [only, setOnly] = useState("all");
  const changes = PACK.changes.filter((c) => only === "all" || c.doc === only);
  return (
    <>
      <Section index="1" title="Documents" note={`${PACK.short} · RfS No. ${PACK.rfsNo} dated ${fmtDate(PACK.rfsDate)}`}>
        <div className="seci-docs" data-testid="seci-docs">
          {PACK.documents.map((d) => (
            <article key={d.id} className={`seci-doc ${d.file ? "" : "missing"}`} data-testid={`seci-doc-${d.id}`}>
              <header>
                <strong><FileText size={13} /> {d.title}</strong>
                <span className={`seci-badge ${d.file ? (d.kind === "amendment" ? "amended" : "unchanged") : "missing"}`}>{d.file ? d.kind : "not provided"}</span>
              </header>
              <small>{d.ref}{d.date ? ` · ${fmtDate(d.date)}` : ""}{d.pages ? ` · ${d.pages} pages` : ""}</small>
              <p>{d.summary || d.note}</p>
              {d.file && <a href={`${PACK.folder}${d.file}`} target="_blank" rel="noreferrer">Open the PDF</a>}
            </article>
          ))}
        </div>
        <p className="rtc-note">Where an amendment or a clarification changes the RfS, the amended rule applies; the RfS's original wording is kept beside each condition.</p>
      </Section>

      <Section index="1.1" title="How the bid goes" note="From registration on the portal to the PPA, as the RfS sets it out">
        <ol className="seci-process" data-testid="seci-process">
          {PACK.bidProcess.map((p, i) => (
            <li key={i}>
              <strong>{p.step}</strong>
              <span>{p.detail}</span>
              {p.sources.slice(0, 1).map((q, j) => <QuoteLink key={j} quote={q} />)}
            </li>
          ))}
        </ol>
      </Section>

      <Section index="1.2" title="What the amendments changed" note="Each clause as it stood and as amended, quoted from the documents"
        actions={(
          <div className="bid-filter" role="tablist">
            {[["all", "All"], ["amd1", "Amendment-01"], ["amd2", "Amendment-02"]].map(([id, label]) => (
              <button key={id} type="button" className={only === id ? "active" : ""} onClick={() => setOnly(id)}>{label}</button>
            ))}
          </div>
        )}>
        <div className="seci-changes" data-testid="seci-changes">
          {changes.map((c) => (
            <div key={c.id} className="seci-change" data-testid={`seci-change-${c.id}`}>
              <div className="seci-change-head">
                <strong>{c.topic}</strong>
                <small>{docOf(c.doc).title} · {c.document} {c.clause}</small>
              </div>
              <div className="seci-quote before">
                <span className="seci-label">Was</span>
                {c.before ? <QuoteLink quote={c.before} /> : <em className="rtc-note">Not quoted in the amendment</em>}
              </div>
              <div className="seci-quote after">
                <span className="seci-label">Now</span>
                {c.after ? <QuoteLink quote={c.after} /> : null}
              </div>
              <div className="seci-effect">{c.effect}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section index="1.3" title="Clarifications-01" note="Bidders' queries and SECI's answers (27.04.2026)">
        <div className="seci-changes" data-testid="seci-clarifications">
          {PACK.clarifications.map((c) => (
            <div key={c.no} className="seci-change">
              <div className="seci-change-head">
                <strong>Query {c.no}: {c.topic}</strong>
                <small>{c.clause}</small>
              </div>
              <div className="seci-quote"><span className="seci-label">Asked</span>{c.request}</div>
              <div className="seci-quote">
                <span className="seci-label">SECI</span>
                <b className={/unchanged/i.test(c.response) ? "seci-flag" : ""}>{c.response}</b>
                <QuoteLink quote={c.quote} label="Clarifications-01" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section index="1.4" title="Points to raise with SECI" note="Where the documents conflict or are unclear; each with the page to cite">
        <ul className="seci-queries" data-testid="seci-queries">
          {PACK.queries.map((q, i) => <li key={i}><MessageCircleQuestion size={13} /> <span>{q}</span></li>)}
        </ul>
      </Section>
    </>
  );
}
