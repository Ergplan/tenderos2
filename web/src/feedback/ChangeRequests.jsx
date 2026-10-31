"use client";
// The Change requests tab: every comment raised with feedback, newest first: when, where (tab ›
// step › section), the comment, who (name and team) and the status. A super admin approves or
// rejects, exports the approved ones as one Markdown prompt file for jouleWise (they become
// "exported" with the batch) and marks them done once the change has shipped.
import React, { useMemo, useState } from "react";
import { Check, Download, FileText, MessageSquarePlus, RotateCcw, Trash2, X } from "lucide-react";
import { Section, Stat } from "../rtc/ui";
import { ActAs } from "../team/TeamSetup";

const STATUS = { open: "Open", approved: "Approved", rejected: "Rejected", exported: "Exported", done: "Done" };
const when = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function ChangeRequests({ team, requests, onFeedback }) {
  const [filter, setFilter] = useState("all");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const items = useMemo(() => (filter === "all" ? requests.items : requests.items.filter((r) => r.status === filter)), [requests.items, filter]);
  const counts = requests.counts || {};
  const canDecide = Boolean(team?.me?.super_admin);
  const run = async (fn, ok) => {
    setErr(""); setMsg("");
    try { const out = await fn(); setMsg(typeof ok === "function" ? ok(out) : ok); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="rtc story change-requests" data-testid="change-requests">
      <section className="story-hero"><div>
        <div className="eyebrow"><MessageSquarePlus size={13} /> Feedback</div>
        <h1>Change requests</h1>
        <p>Every comment the team raised on a section of the application, with where it was raised, by whom and when. The super admin approves the ones to build, exports them as one prompt file for jouleWise (mail it to us; we apply it with Claude Code and ship the change under the AMC), and marks them done when the change is in.</p>
      </div>
      <div className="story-hero-tools">
        <button type="button" className="primary" onClick={onFeedback} data-testid="cr-feedback"><MessageSquarePlus size={13} /> Give feedback on a page</button>
      </div></section>

      <section className="rtc-stats" data-testid="cr-counts">
        {Object.entries(STATUS).map(([k, l]) => <Stat key={k} label={l} value={String(counts[k] || 0)} detail={k === "approved" ? "ready to export" : k === "exported" ? "with jouleWise" : ""} />)}
      </section>

      <Section index="1" title="Requests" note={canDecide ? "Approve or reject each; export the approved ones as the prompt file" : "The super admin approves and exports"}
        actions={(
          <>
            <ActAs team={team} />
            <div className="seg" role="radiogroup" data-testid="cr-filter">
              {[["all", "All"], ...Object.entries(STATUS)].map(([k, l]) => <button key={k} type="button" className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
            {canDecide && <button type="button" className="primary" disabled={!(counts.approved > 0)} onClick={() => run(() => requests.exportPrompt(), (o) => `Exported ${o.count} request${o.count === 1 ? "" : "s"} as ${o.name}: mail it to jouleWise.`)} data-testid="cr-export"><Download size={13} /> Export approved as a prompt (.md)</button>}
          </>
        )}>
        {(msg || err || requests.error) && <p className={err || requests.error ? "seci-flag" : "alert ok"} data-testid="cr-message">{err || requests.error || msg}</p>}
        {!team?.me && <p className="rtc-note">You are not on the tender team: ask its super admin to add you on Team setup.</p>}
        {team?.me && items.length === 0 && <p className="rtc-note">{filter === "all" ? "No change requests yet. Switch feedback on (the button above, or Give feedback in the sidebar) and click any section of a page." : `Nothing ${STATUS[filter].toLowerCase()}.`}</p>}
        {items.length > 0 && (
          <div className="table-wrap">
            <table className="cr-table" data-testid="cr-table">
              <thead><tr><th>#</th><th>When</th><th>Where</th><th>Comment</th><th>Requested by</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className={`cr-${r.status}`} data-testid="cr-row" data-status={r.status}>
                    <td><strong>CR-{r.seq}</strong></td>
                    <td><time>{when(r.created_at)}</time></td>
                    <td className="cr-where">
                      <strong>{r.tab_label || r.tab}</strong>
                      {r.step_label && <span> › {r.step_label}</span>}
                      <small>{[r.section_index, r.section_title].filter(Boolean).join(" ")}</small>
                      {Array.isArray(r.boxes) && r.boxes.length > 0 && <small className="cr-boxes">{r.boxes.slice(0, 6).join(" · ")}{r.boxes.length > 6 ? " · …" : ""}</small>}
                    </td>
                    <td className="cr-comment"><p>{r.comment}</p></td>
                    <td><strong>{r.by_name}</strong><small>{r.teamLabel}</small></td>
                    <td>
                      <span className={`cr-status cr-status-${r.status}`}>{STATUS[r.status]}</span>
                      {r.export_batch && <small>batch {r.export_batch}</small>}
                      {r.decided_at && r.status !== "exported" && <small>{r.decided_by_name || "super admin"} · {when(r.decided_at)}</small>}
                    </td>
                    <td className="cr-actions">
                      {canDecide && r.status === "open" && <button type="button" className="primary" onClick={() => run(() => requests.decide(r.id, "approved"), `CR-${r.seq} approved.`)} data-testid="cr-approve"><Check size={12} /> Approve</button>}
                      {canDecide && r.status === "open" && <button type="button" className="secondary" onClick={() => run(() => requests.decide(r.id, "rejected"), `CR-${r.seq} rejected.`)} data-testid="cr-reject"><X size={12} /> Reject</button>}
                      {canDecide && (r.status === "approved" || r.status === "rejected") && <button type="button" className="secondary" onClick={() => run(() => requests.decide(r.id, "open"), `CR-${r.seq} reopened.`)} data-testid="cr-reopen"><RotateCcw size={12} /> Reopen</button>}
                      {canDecide && r.status === "exported" && <button type="button" className="secondary" onClick={() => run(() => requests.decide(r.id, "done"), `CR-${r.seq} done.`)} data-testid="cr-done"><FileText size={12} /> Mark done</button>}
                      {r.canDelete && <button type="button" className="rtc-icon-btn" title="Remove" onClick={() => run(() => requests.remove(r.id), `CR-${r.seq} removed.`)} data-testid="cr-delete"><Trash2 size={13} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section index="2" title="How a request becomes a change">
        <ol className="cr-steps">
          <li><strong>Raise.</strong> Anyone on the team switches feedback on, clicks the section and writes what should change. It appears here as Open, with the tab, step, section and the boxes in it.</li>
          <li><strong>Decide.</strong> The super admin approves or rejects. Approved requests wait for the next export.</li>
          <li><strong>Export.</strong> "Export approved as a prompt" downloads one Markdown file holding every approved request with its context and the code map; those requests become Exported with the batch id. Mail the file to jouleWise.</li>
          <li><strong>Ship.</strong> jouleWise applies the file with Claude Code, tests, and ships the change under the AMC; the super admin marks the requests Done.</li>
        </ol>
      </Section>
    </div>
  );
}
