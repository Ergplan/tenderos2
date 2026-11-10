import React, { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, Info, Loader2, SearchCheck, TriangleAlert } from "lucide-react";
import { Section } from "../rtc/ui";
import Cite from "./Cite.jsx";
import { reviewBid } from "./review.js";

const ICON = { block: CircleAlert, warn: TriangleAlert, note: Info };
const WORD = { block: "Blocks the bid", warn: "Carries cost", note: "To note" };
const STEP_LABEL = { bid: "Bid inputs", design: "Design", financeInputs: "Finance inputs", size: "Size", whatif: "What-if", reference: "Reference bids", finance: "Financial model" };

/**
 * Section 6.6 of the Size step: why this bid is not optimal. Rule-based findings from review.js,
 * computed on request (the own-solar test re-simulates the term twice), each with where to fix it.
 */
export default function BidReview({ state, model, prices, goto }) {
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOut(null); }, [model]);
  const run = () => {
    setBusy(true);
    setTimeout(() => {
      try { setOut(reviewBid({ state, model, finance: model.finance || null, prices })); } finally { setBusy(false); }
    }, 30);
  };
  return (
    <Section index="6.6" title="Bid review: why this bid is not optimal" note="The tender's conditions, what the market has paid, the plant, the battery, the inputs against the benchmarks and the financing, as findings with where to fix each">
      <div className="cfd-d15-actions">
        <button type="button" className="primary" onClick={run} disabled={busy} data-testid="cfd-review-run">{busy ? <Loader2 size={12} className="spin" /> : <SearchCheck size={12} />} {busy ? "Reviewing the bid…" : out ? "Review again" : "Review the bid"}</button>
        {out && <span className="rtc-note" data-testid="cfd-review-summary">{out.summary}</span>}
      </div>
      {out && (
        <div className="bid-review" data-testid="cfd-review">
          {out.findings.length === 0 && <p className="rtc-note">Nothing to fix: the bid meets the tender, the plant is at its best for these inputs, and the inputs sit near the benchmarks.</p>}
          {["block", "warn", "note"].map((sev) => {
            const list = out.findings.filter((f) => f.severity === sev);
            if (!list.length) return null;
            const Icon = ICON[sev];
            return (
              <div key={sev} className={`review-group ${sev}`}>
                <h4><Icon size={14} /> {WORD[sev]} · {list.length}</h4>
                {list.map((f) => (
                  <div key={f.id} className={`review-item ${sev}`} data-testid={`cfd-review-${f.id}`}>
                    <div className="review-head"><b>{f.title}</b>{f.cite && <Cite id={f.cite} compact />}</div>
                    <p>{f.detail}</p>
                    {f.step && goto && <button type="button" className="secondary" onClick={() => goto(f.step)} data-testid={`cfd-review-goto-${f.id}`}>{STEP_LABEL[f.step] || f.step} <ArrowRight size={12} /></button>}
                  </div>
                ))}
              </div>
            );
          })}
          <p className="rtc-note">How to read it: a blocking finding fails the tender or cannot win the auction as it stands; a finding that carries cost names a cost the bidder can take out of the price; a note is worth knowing before bid day. The benchmarks are 2025–26 Indian prices and norms, not the tender's; an input far from them is not wrong, it needs evidence, which the What-if step's Freeze attaches.</p>
        </div>
      )}
    </Section>
  );
}
