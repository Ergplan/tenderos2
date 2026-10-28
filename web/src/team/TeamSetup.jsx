"use client";
// Team setup: who is on the tender team, their role (team and super admin), their title, the tabs
// they cover (they come first when someone types @ in those tabs) and their email for pings. A
// super admin changes it; everyone sees it. Demo deployments switch seats with "View as".
import React, { useEffect, useState } from "react";
import { Plus, Save, ShieldCheck, Users } from "lucide-react";
import { Section } from "../rtc/ui";
import { TAB_CATALOG } from "../../lib/tabs";
import { handleOf } from "./mentions";
import { readPingMode, savePingMode } from "./FieldPings";

/** Demo only: act as one of the seats, to show each role on one screen. */
export function ActAs({ team }) {
  if (!team?.demo || !team.members?.length) return null;
  return (
    <label className="team-actas" data-testid="team-actas">
      <span>View as</span>
      <select value={team.me?.id || ""} onChange={(e) => team.actAs(e.target.value)}>
        {team.members.filter((m) => m.active !== false).map((m) => <option key={m.id} value={m.id}>{m.name}{m.super_admin ? " (super admin)" : ""}</option>)}
      </select>
    </label>
  );
}

const ROLE_RIGHTS = [
  ["Super admin", "Manages the team and roles here, accepts or returns answers to assignments, and can ping and answer like anyone."],
  ["Member", "Pings teammates from any input box, answers pings and assignments for their team, and fills in values."],
];

function MemberRow({ m, team, editable }) {
  const [d, setD] = useState(m);
  const [msg, setMsg] = useState("");
  useEffect(() => setD(m), [m]);
  const dirty = JSON.stringify(d) !== JSON.stringify(m);
  const toggleTab = (id) => setD({ ...d, tabs: (d.tabs || []).includes(id) ? d.tabs.filter((t) => t !== id) : [...(d.tabs || []), id] });
  const save = async () => {
    setMsg("");
    try {
      await team.saveMember({ id: m.id, name: d.name, email: d.email, team: d.team, title: d.title, tabs: d.tabs, superAdmin: d.super_admin, active: d.active });
      setMsg("Saved");
    } catch (e) {
      setMsg(e.message);
    }
  };
  return (
    <tr className={d.active === false ? "inactive" : ""} data-testid={`setup-member-${handleOf(m.name)}`}>
      <td>
        {editable ? <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} aria-label="Name" data-no-ping /> : <strong>{d.name}</strong>}
        <small>@{m.handle}{team.me?.id === m.id ? " · you" : ""}</small>
      </td>
      <td>
        <select value={d.team} disabled={!editable} onChange={(e) => setD({ ...d, team: e.target.value })} aria-label="Team" data-no-ping data-testid="setup-team">
          {Object.entries(team.teams || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="team-admin"><input type="checkbox" checked={Boolean(d.super_admin)} disabled={!editable} onChange={(e) => setD({ ...d, super_admin: e.target.checked })} /> Super admin</label>
      </td>
      <td>{editable ? <input value={d.title || ""} placeholder="e.g. CFO" onChange={(e) => setD({ ...d, title: e.target.value })} aria-label="Title" data-no-ping /> : d.title}</td>
      <td>
        <div className="team-tabs">
          {TAB_CATALOG.map((t) => (
            <button key={t.id} type="button" disabled={!editable} className={(d.tabs || []).includes(t.id) ? "on" : ""} onClick={() => toggleTab(t.id)} data-testid={`setup-tab-${t.id}`}>{t.label}</button>
          ))}
        </div>
      </td>
      <td>{editable ? <input value={d.email || ""} placeholder="name@company.com" onChange={(e) => setD({ ...d, email: e.target.value })} aria-label="Email" data-no-ping /> : d.email}</td>
      <td>
        {editable && (
          <div className="team-row-actions">
            <label className="team-admin"><input type="checkbox" checked={d.active !== false} onChange={(e) => setD({ ...d, active: e.target.checked })} /> Active</label>
            <button type="button" className="primary" disabled={!dirty} onClick={save} data-testid="setup-save"><Save size={13} /> Save</button>
            {msg && <small>{msg}</small>}
          </div>
        )}
      </td>
    </tr>
  );
}

function AddMember({ team }) {
  const blank = { name: "", email: "", team: "finance", title: "", tabs: [], superAdmin: false };
  const [d, setD] = useState(blank);
  const [msg, setMsg] = useState("");
  const add = async () => {
    setMsg("");
    try {
      await team.saveMember(d);
      setMsg(`Added @${handleOf(d.name)}`);
      setD(blank);
    } catch (e) {
      setMsg(e.message);
    }
  };
  return (
    <div className="team-add" data-testid="setup-add">
      <input value={d.name} placeholder="Name, e.g. Priya Sharma" onChange={(e) => setD({ ...d, name: e.target.value })} data-no-ping data-testid="setup-add-name" />
      <select value={d.team} onChange={(e) => setD({ ...d, team: e.target.value })} data-no-ping data-testid="setup-add-team">
        {Object.entries(team.teams || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input value={d.title} placeholder="Title, e.g. CFO" onChange={(e) => setD({ ...d, title: e.target.value })} data-no-ping data-testid="setup-add-title" />
      <input value={d.email} placeholder="Email (for ping emails)" onChange={(e) => setD({ ...d, email: e.target.value })} data-no-ping />
      <label className="team-admin"><input type="checkbox" checked={d.superAdmin} onChange={(e) => setD({ ...d, superAdmin: e.target.checked })} /> Super admin</label>
      <button type="button" className="primary" disabled={!d.name.trim()} onClick={add} data-testid="setup-add-go"><Plus size={13} /> Add to team</button>
      {msg && <small>{msg}</small>}
    </div>
  );
}

export default function TeamSetup({ team }) {
  const [mode, setMode] = useState(readPingMode);
  if (!team) return null;
  const editable = Boolean(team.me?.super_admin);
  const members = team.members || [];
  const setPing = (m) => { savePingMode(m); setMode(m); window.dispatchEvent(new Event("tenderos-ping-mode")); };
  return (
    <div className="rtc story team-setup" data-testid="team-setup">
      <section className="story-hero"><div>
        <div className="eyebrow"><Users size={13} /> Team mode</div>
        <h1>Team setup</h1>
        <p>Who is on the tender team, their role and the tabs they cover. Anyone on the team can ping a teammate from any input box of any tab: the send icon at the box's corner opens its thread; type @ and a name. The people pinged see it under Messages and can answer with the value, which the asker fills in with one click.</p>
      </div></section>

      <Section index="1" title="The team" note={editable ? "You are a super admin: change roles and tabs, then Save on the row" : "Only a super admin changes roles"} actions={<ActAs team={team} />}>
        {team.error && <p className="seci-flag">{team.error}</p>}
        {!team.me && <p className="rtc-note">You are not on the tender team yet: ask its super admin to add you.</p>}
        <div className="team-table-wrap">
          <table className="team-table">
            <thead><tr><th>Person</th><th>Role</th><th>Title</th><th>Tabs they cover</th><th>Email</th><th /></tr></thead>
            <tbody>{members.map((m) => <MemberRow key={m.id} m={m} team={team} editable={editable} />)}</tbody>
          </table>
        </div>
        {editable && <AddMember team={team} />}
      </Section>

      <Section index="2" title="Who to ping for what" note="By tab: the people who cover it come first in the @ suggestions">
        <div className="team-cover">
          {TAB_CATALOG.map((t) => {
            const who = members.filter((m) => m.active !== false && (m.tabs || []).includes(t.id));
            return (
              <article key={t.id} data-testid={`cover-${t.id}`}>
                <strong>{t.label}</strong>
                {who.length ? <ul>{who.map((m) => <li key={m.id}><b>@{m.handle}</b> <small>{m.title || team.teams?.[m.team]}</small></li>)}</ul> : <small>Nobody yet</small>}
              </article>
            );
          })}
        </div>
      </Section>

      <Section index="3" title="Roles and pings">
        <div className="rtc-grid rtc-grid-2">
          <div className="team-rights">
            {ROLE_RIGHTS.map(([r, what]) => <p key={r}><ShieldCheck size={13} /> <strong>{r}.</strong> {what}</p>)}
            <p className="rtc-note">Teams: {Object.values(team.teams || {}).join(", ")}. Pings email the people mentioned when mail is set up (on a demo, they go to the demo outbox).</p>
          </div>
          <div>
            <span className="rtc-index">Send icons on input boxes</span>
            <div className="seci-choice" role="radiogroup" data-testid="ping-mode">
              {[["always", "On every box", "A faint send icon at the corner of every input box"], ["hover", "On hover", "Only on the box under the mouse, and on boxes with messages"]].map(([k, l, d]) => (
                <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? "active" : ""} onClick={() => setPing(k)}><strong>{l}</strong><small>{d}</small></button>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
