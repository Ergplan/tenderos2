import React, { useState } from "react";
import { FileText, MessageCircleQuestion } from "lucide-react";
import { Section } from "../rtc/ui";
import { PACK, docById, pageHref } from "./pack.js";
import "./pack.css";

const fmtDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "–");
// a quote that itself quotes a term (“TERM AHEAD MARKET” means ...) reads with single marks inside the outer ones
const inner = (text) => String(text).replace(/[“"]([^”"]*)[”"]/g, "‘$1’");

/** A quote with a link to its page in the PDF (a citation only when the document is not provided). */
export function QuoteLink({ quote, label = null }) {
  const doc = docById[quote.doc];
  const href = pageHref(quote);
  return (
    <span className="seci-quote-link">
      <q>{inner(quote.quote)}</q>{" "}
      {href
        ? <a className="seci-link" href={href} target="_blank" rel="noreferrer">{label || doc.title}, p. {quote.page}</a>
        : <span className="seci-link">{label || doc?.title}, p. {quote.page}</span>}
    </span>
  );
}

const FILTERS = [["all", "All"], ["amd1", "Amendment-01"], ["amd2", "Amendment-02"], ["amd3", "Amendment-03"]];

/** A quote, or the parts of one that runs over a page break (each with its own page link). */
function Quotes({ quote }) {
  const parts = Array.isArray(quote) ? quote : [quote];
  return <>{parts.map((q, i) => <QuoteLink key={i} quote={q} />)}</>;
}

/** Step: the tender's documents, how the bid goes, the amendment trail clause by clause, and the points to raise. */
export default function DocumentsStep() {
  const [only, setOnly] = useState("all");
  const changes = PACK.changes.filter((c) => only === "all" || c.doc === only);
  const amendments = PACK.documents.filter((d) => d.kind === "amendment");
  return (
    <>
      <Section index="1" title="Documents" note={`${PACK.short} · RfS No. ${PACK.rfsNo} dated ${fmtDate(PACK.rfsDate)} · ISN-ETS ${PACK.searchCode}`}>
        <div className="seci-docs" data-testid="cfd-docs">
          {PACK.documents.map((d) => (
            <article key={d.id} className={`seci-doc ${d.file ? "" : "missing"}`} data-testid={`cfd-doc-${d.id}`}>
              <header>
                <strong><FileText size={13} /> {d.title}</strong>
                <span className={`seci-badge ${d.file ? (d.kind === "amendment" ? "amended" : "unchanged") : "missing"}`}>{d.file ? d.kind : "not provided"}</span>
              </header>
              <small>{d.ref}{d.date ? ` · ${fmtDate(d.date)}` : ""}{d.pages ? ` · ${d.printedPages || d.pages} pages` : ""}</small>
              <p>{d.summary}</p>
              {d.note && <p><em>{d.note}</em></p>}
              {d.file && <a href={`${PACK.folder}${d.file}`} target="_blank" rel="noreferrer">Open the PDF</a>}
            </article>
          ))}
        </div>
        <p className="rtc-note">Where an amendment changes the RfS or the CfDA, the amended rule applies; the original wording is kept beside each condition on the next step. If the RfS and the CfDA still differ, the CfDA prevails (CfDA 1.2.18).</p>
      </Section>

      <Section index="1.1" title="How the bid goes" note="From registration on the portal to the SCD, as the RfS sets it out">
        <ol className="seci-process" data-testid="cfd-process">
          {PACK.bidProcess.map((p, i) => (
            <li key={i}>
              <strong>{p.step}</strong>
              <span>{p.detail}</span>
              {p.sources.slice(0, 1).map((q, j) => <QuoteLink key={j} quote={q} />)}
            </li>
          ))}
        </ol>
      </Section>

      <Section index="1.2" title="What the amendments changed" note={`${PACK.changes.length} changes in ${amendments.length} amendments: each clause as it stood and as amended, quoted from the amendment`}
        actions={(
          <div className="bid-filter" role="tablist">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" className={only === id ? "active" : ""} onClick={() => setOnly(id)} data-testid={`cfd-changes-${id}`}>{label}</button>
            ))}
          </div>
        )}>
        <div className="seci-changes" data-testid="cfd-changes">
          {changes.map((c) => (
            <div key={c.id} className="seci-change" data-testid={`cfd-change-${c.id}`}>
              <div className="seci-change-head">
                <strong>{c.topic}</strong>
                <small>{docById[c.doc].title} · {c.document} {c.clause}</small>
              </div>
              <div className="seci-quote before">
                <span className="seci-label">Was</span>
                {c.before ? <Quotes quote={c.before} /> : <em className="rtc-note">{/addendum|new/i.test(c.clause) ? "New text: nothing stood before" : c.document === "CfDA" ? "The amendment restates the whole article; the original is in the standard CfDA (not provided)" : "The amendment restates the whole clause"}</em>}
              </div>
              <div className="seci-quote after">
                <span className="seci-label">Now</span>
                <Quotes quote={c.after} />
              </div>
              <div className="seci-effect">{c.effect}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section index="1.3" title="Clarifications" note="Bidders' queries and SECI's answers">
        <p className="rtc-note" data-testid="cfd-clarifications">
          {PACK.clarifications.length ? `${PACK.clarifications.length} clarifications.` : "None issued for this RfS so far: SECI answers queries at the pre-bid meeting and posts the compiled answers on the ISN-ETS portal (RfS 31.2). Check the portal before bidding."}
        </p>
      </Section>

      <Section index="1.4" title="Points to raise with SECI" note="Where the documents conflict or are unclear; each with the page to cite">
        <ul className="seci-queries" data-testid="cfd-queries">
          {PACK.queries.map((q, i) => <li key={i}><MessageCircleQuestion size={13} /> <span>{q}</span></li>)}
        </ul>
      </Section>
    </>
  );
}
