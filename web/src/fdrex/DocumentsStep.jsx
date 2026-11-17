// SECI-FDRE-X: the Tender & amendments step. The tender's documents, the dates (those the
// documents give and those only SECI's website gives, marked as such), how the bid goes, every
// row of Amendment-01 (each deleted clause as it stands in the PPA or the PSA, and the
// amendment's page), and the points to raise with SECI. It reads ./pack.js. Forked from the CfD-I
// step (web/src/cfd/DocumentsStep.jsx); class names and test ids are shared with it.
import React, { useState } from "react";
import { CalendarDays, FileText, MessageCircleQuestion } from "lucide-react";
import { Section } from "../rtc/ui";
import { PACK, docById, pageHref } from "./pack.js";
import { cite } from "./terms.js";
import "../cfd/pack.css";

const fmtDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "–");
// a quote that itself quotes a term (“PEAK HOURS” shall mean ...) reads with single marks inside the outer ones
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

/** A quote, or the parts of one that runs over a page break (each with its own page link). */
function Quotes({ quote }) {
  const parts = Array.isArray(quote) ? quote : [quote];
  return <>{parts.map((q, i) => <QuoteLink key={i} quote={q} />)}</>;
}

/** Links to the pages a quote (or its parts) stands on, without printing its text again. */
function PageLinks({ quote }) {
  const parts = Array.isArray(quote) ? quote : [quote];
  return <>{parts.map((q, i) => <React.Fragment key={i}>{i ? ", " : ""}<a className="seci-link" href={pageHref(q)} target="_blank" rel="noreferrer">p. {q.page}</a></React.Fragment>)}</>;
}

// where a date comes from: the tender documents, or SECI's website only (the RfS leaves it to the NIT on the portal)
const BASIS = {
  rfs: { cls: "unchanged", text: "RfS" },
  amendment: { cls: "amended", text: "Amendment" },
  notice: { cls: "amended", text: "SECI's notice" },
  website: { cls: "ambiguous", text: "SECI's website only" },
};

/** Step: the tender's documents, the dates, how the bid goes, the amendment row by row, and the points to raise. */
export default function DocumentsStep() {
  const [only, setOnly] = useState("all");
  const amendments = PACK.documents.filter((d) => d.kind === "amendment");
  const amended = [...new Set(PACK.changes.map((c) => c.document))];
  // one tab per amendment, then one per document it amends (the PPA and the PSA here)
  const filters = [["all", "All"], ...amendments.map((d) => [d.id, d.title]), ...amended.map((name) => [name.toLowerCase(), name])];
  const changes = PACK.changes.filter((c) => only === "all" || c.doc === only || c.document.toLowerCase() === only);
  const deleted = PACK.changes.filter((c) => c.deleted).length;
  return (
    <>
      <Section index="1" title="Documents" note={`${PACK.short} · RfS No. ${PACK.rfsNo} dated ${fmtDate(PACK.rfsDate)} · ISN-ETS ${PACK.searchCode}${PACK.tenderId ? ` · SECI tender ID ${PACK.tenderId}` : ""}`}>
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
        <p className="rtc-note">
          Amendment-01 changes no clause of the RfS: it deletes clauses of the PPA and the PSA, and the deleted wording is kept beside each condition on the next step.
          If the RfS and the PPA differ, the PPA read with the PSA prevails ({cite("precedence")}).
        </p>
      </Section>

      <Section index="1.1" title="Dates and how the bid goes" note="From registration on the portal to the SCSD, as the RfS sets it out">
        <ol className="seci-process" data-testid="cfd-schedule">
          {PACK.schedule.map((s) => {
            const b = BASIS[s.basis] || BASIS.rfs;
            return (
              <li key={s.id} data-testid={`cfd-date-${s.id}`}>
                <strong><CalendarDays size={12} /> {s.label}</strong>
                <span>
                  <b>{s.date ? `${fmtDate(s.date)}${s.time ? `, ${s.time}` : ""}` : "Not announced"}</b>{" "}
                  <span className={`seci-badge ${b.cls}`}>{b.text}</span>{" "}
                  {s.note}
                </span>
                {s.source && <QuoteLink quote={s.source} />}
              </li>
            );
          })}
        </ol>
        <p className="rtc-note">
          Dates marked “SECI's website only” were read on SECI's website on {fmtDate(PACK.websiteAsOf)}; the RfS leaves them to the NIT on the ISN-ETS portal. Check the portal before relying on them.
        </p>
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

      <Section index="1.2" title="What the amendment changed" note={`${PACK.changes.length} rows in ${amendments.length} amendment${amendments.length > 1 ? "s" : ""}${deleted === PACK.changes.length ? ", all deletions" : ""}: each clause as it stands in the agreement and what the amendment makes of it`}
        actions={(
          <div className="bid-filter" role="tablist">
            {filters.map(([id, label]) => (
              <button key={id} type="button" className={only === id ? "active" : ""} onClick={() => setOnly(id)} data-testid={`cfd-changes-${id}`}>{label}</button>
            ))}
          </div>
        )}>
        <div className="seci-changes" data-testid="cfd-changes">
          {changes.map((c) => (
            <div key={c.id} className="seci-change" data-testid={`cfd-change-${c.id}`}>
              <div className="seci-change-head">
                <strong>{c.topic}</strong>
                <small>{docById[c.doc].title} · row {c.sno} · {c.document} {c.clause}</small>
              </div>
              <div className="seci-quote before">
                <span className="seci-label">Was</span>
                {c.before ? <Quotes quote={c.before} /> : <em className="rtc-note">New text: nothing stood before</em>}
              </div>
              <div className="seci-quote after">
                <span className="seci-label">Now</span>
                {c.deleted && <span className="seci-badge removed">Deleted</span>}
                <Quotes quote={c.after} />
                {c.amendment && <small className="rtc-note">The amendment prints the clause as it stood on <PageLinks quote={c.amendment} />.</small>}
              </div>
              <div className="seci-effect">{c.effect}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section index="1.3" title="Clarifications" note="Bidders' queries and SECI's answers">
        <p className="rtc-note" data-testid="cfd-clarifications">
          {PACK.clarifications.length ? `${PACK.clarifications.length} clarifications.` : "None issued for this RfS so far: SECI answers queries at the pre-bid meeting and posts the compiled answers on the ISN-ETS portal (RfS 30.2); none is issued after the bid deadline. Check the portal before bidding."}
        </p>
      </Section>

      <Section index="1.4" title="Points to raise with SECI" note="Where the documents conflict or are unclear; each with the PDF page to cite">
        <ul className="seci-queries" data-testid="cfd-queries">
          {PACK.queries.map((q, i) => <li key={i}><MessageCircleQuestion size={13} /> <span>{q}</span></li>)}
        </ul>
      </Section>
    </>
  );
}
