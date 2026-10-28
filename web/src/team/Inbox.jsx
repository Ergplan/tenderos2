"use client";
// The Messages drawer: the pings I was mentioned in and the replies in threads I am in, newest
// first. "Open field" goes to the tab, the step and the box, and opens its thread.
import React, { useState } from "react";
import { Inbox as InboxIcon, X } from "lucide-react";
import { TAB_CATALOG } from "../../lib/tabs";
import { Body } from "./FieldPings";
import { ActAs } from "./TeamSetup";

const tabLabel = (id) => TAB_CATALOG.find((t) => t.id === id)?.label || id;
const when = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Inbox({ team, onOpen, onClose }) {
  const [only, setOnly] = useState("unread");
  const list = (team.box?.notices || []).filter((n) => only === "all" || !n.read_at);
  return (
    <aside className="team-inbox" data-testid="team-inbox" aria-label="Messages">
      <header>
        <div><span className="rtc-index"><InboxIcon size={12} /> Messages</span><strong>{team.box?.unread || 0} unread</strong></div>
        <button type="button" className="rtc-icon-btn" onClick={onClose} title="Close"><X size={15} /></button>
      </header>
      <ActAs team={team} />
      <div className="team-inbox-tools">
        <div className="seg">
          {[["unread", "Unread"], ["all", "All"]].map(([k, l]) => <button key={k} type="button" className={only === k ? "active" : ""} onClick={() => setOnly(k)}>{l}</button>)}
        </div>
        {team.box?.unread > 0 && <button type="button" className="secondary" onClick={() => team.markRead({ ids: team.box.notices.filter((n) => !n.read_at).map((n) => n.id) })}>Mark all read</button>}
      </div>
      {!team.me && <p className="rtc-note">You are not on the tender team: ask its super admin to add you on Team setup.</p>}
      {team.me && list.length === 0 && <p className="rtc-note">{only === "unread" ? "Nothing unread." : "No messages yet."} Ping a teammate from any input box: the send icon at its corner.</p>}
      <ul>
        {list.map((n) => (
          <li key={n.id} className={n.read_at ? "" : "unread"} data-testid="inbox-item">
            <div className="team-inbox-head">
              <strong>{n.from_name || "Someone"}</strong>
              <span>{n.kind === "mention" ? "mentioned you" : "replied"}</span>
              <time>{when(n.created_at)}</time>
            </div>
            <div className="team-inbox-field"># {n.field_label} <small>{n.place || tabLabel(n.tab)}</small></div>
            {n.body && <p><Body text={n.body} /></p>}
            {n.value !== null && <p className="team-inbox-value">Value: <strong>{n.value}</strong></p>}
            <div className="team-inbox-actions">
              <button type="button" className="primary" data-testid="inbox-open" onClick={() => { team.markRead({ ids: [n.id] }); onOpen(n); }}>Open field</button>
              {!n.read_at && <button type="button" className="secondary" onClick={() => team.markRead({ ids: [n.id] })}>Mark read</button>}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
