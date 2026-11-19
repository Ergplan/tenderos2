"use client";
// Administration › Users: give demo licences and manage accounts (docs/LICENCES.md). A licence is
// an account with a company workspace, the tabs it may open and an end date; its password is
// generated on the server and shown once here, in a card to copy and hand over.
import { useState } from "react";
import { CalendarPlus, Check, Copy, KeyRound, Mail, Power, Trash2, UserPlus, X } from "lucide-react";
import { when } from "./ScenarioLibrary";
import TabAccess from "./TabAccess";
import { TAB_CATALOG } from "@/lib/tabs";

async function call(path, method, body) {
  const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const DURATIONS = [["7", "7 days"], ["14", "14 days"], ["30", "30 days"], ["60", "60 days"], ["90", "90 days"], ["date", "Until a date"], ["none", "No end date"]];
const day = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const tabName = (id) => TAB_CATALOG.find((t) => t.id === id)?.label || id;
const tabsOf = (u) => {
  if (u.role === "admin") return "Every tab";
  if (!Array.isArray(u.tab_access)) return "The default tabs";
  if (!u.tab_access.length) return "None";
  return u.tab_access.length === TAB_CATALOG.length ? "Every tab" : u.tab_access.map(tabName).join(", ");
};

/** The licence's state: { cls, text }. */
function licenceState(u) {
  if (u.disabled) return { cls: "off", text: "Switched off" };
  if (u.expires_at && new Date(u.expires_at) <= new Date()) return { cls: "ended", text: `Ended ${day(u.expires_at)}` };
  if (u.expires_at) {
    const left = Math.ceil((new Date(u.expires_at) - Date.now()) / 86400000);
    return { cls: left <= 7 ? "soon" : "on", text: `Until ${day(u.expires_at)} · ${left} day${left === 1 ? "" : "s"} left` };
  }
  return { cls: "on", text: u.role === "admin" ? "Administrator" : "No end date" };
}

/** The text handed to the client: where to sign in, the account, its tabs and its end. */
export function credentialsText({ user, password, origin }) {
  const tabs = user.role === "admin" ? "every tab (administrator)" : Array.isArray(user.tab_access) ? user.tab_access.map(tabName).join(", ") : "the default tabs";
  return [
    `TenderOS 2 · ${user.role === "admin" ? "administrator account" : `demo licence${user.org ? ` for ${user.org}` : ""}`}`,
    "",
    `Sign in at: ${origin}/login`,
    `Email: ${user.email}`,
    `Password: ${password}`,
    `Tabs: ${tabs}`,
    `Valid until: ${user.expires_at ? day(user.expires_at) : "no end date"}`,
    "",
    "Please change the password after you sign in (your name at the bottom of the sidebar › Account).",
  ].join("\n");
}

function Credentials({ creds, onClose }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const text = credentialsText({ ...creds, origin });
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); }
  };
  const mail = `mailto:${encodeURIComponent(creds.user.email)}?subject=${encodeURIComponent("Your TenderOS 2 demo licence")}&body=${encodeURIComponent(text)}`;
  return (
    <section className="panel licence-card" data-testid="licence-credentials" role="dialog" aria-label="Sign-in details">
      <header>
        <strong><KeyRound size={14} /> {creds.fresh ? "Licence given" : "New password"}: copy these details now</strong>
        <button type="button" className="rtc-icon-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </header>
      <p className="rtc-note">The password is shown only now; TenderOS keeps only its hash. If it is lost, give a new password.</p>
      <pre data-testid="licence-text">{text}</pre>
      <div className="licence-card-actions">
        <button type="button" className="primary" onClick={copy} data-testid="licence-copy">{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</button>
        <a className="secondary licence-mail" href={mail} data-testid="licence-mail"><Mail size={14} /> Write an email</a>
      </div>
    </section>
  );
}

const EMPTY = { email: "", name: "", org: "", internal: false, role: "user", duration: "30", until: "", tabs: ["fdrex"], note: "" };

export default function UserAdmin({ me, initial, defaultTabs }) {
  const [users, setUsers] = useState(initial);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [creds, setCreds] = useState(null); // { user, password, fresh }
  const [busy, setBusy] = useState(false);
  const set = (v) => setForm((f) => ({ ...f, ...v }));
  const replace = (u) => setUsers((list) => list.map((x) => (x.id === u.id ? u : x)));

  async function run(fn, ok) {
    setError("");
    setMsg("");
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (err) {
      setError(err.message);
    }
  }

  async function give(e) {
    e.preventDefault();
    setBusy(true);
    await run(async () => {
      const admin = form.role === "admin";
      if (!admin && !form.tabs.length) throw new Error("Choose at least one tab.");
      const body = {
        email: form.email, name: form.name, role: form.role, note: form.note,
        org: admin || form.internal ? "" : form.org, internal: form.internal,
        tabAccess: admin ? null : form.tabs,
        ...(admin || form.duration === "none" ? { expiresAt: null } : form.duration === "date" ? { expiresAt: form.until ? `${form.until}T23:59:59+05:30` : undefined } : { days: Number(form.duration) }),
      };
      if (!admin && form.duration === "date" && !form.until) throw new Error("Choose the licence's last day.");
      const { user, password } = await call("/api/users", "POST", body);
      setUsers((list) => [...list, user]);
      setCreds({ user, password, fresh: true });
      setForm(EMPTY);
    }, "");
    setBusy(false);
  }

  const toggleTab = (id) => set({ tabs: form.tabs.includes(id) ? form.tabs.filter((t) => t !== id) : TAB_CATALOG.map((t) => t.id).filter((t) => t === id || form.tabs.includes(t)) });
  const admin = form.role === "admin";

  return (
    <>
      <form className="panel licence-form" onSubmit={give} data-testid="licence-form">
        <h3><UserPlus size={15} /> Give a demo licence</h3>
        <div className="licence-grid">
          <label>Email<input type="email" required value={form.email} onChange={(e) => set({ email: e.target.value })} data-testid="licence-email" autoComplete="off" /></label>
          <label>Name<input value={form.name} onChange={(e) => set({ name: e.target.value })} data-testid="licence-name" /></label>
          <label>Company (its workspace)
            <input value={form.org} onChange={(e) => set({ org: e.target.value })} disabled={admin || form.internal} required={!admin && !form.internal} data-testid="licence-org" placeholder="e.g. the client's company" />
            <small><input type="checkbox" checked={form.internal} disabled={admin} onChange={(e) => set({ internal: e.target.checked })} data-testid="licence-internal" /> One of our team: shares our workspace</small>
          </label>
          <label>Role
            <select value={form.role} onChange={(e) => set({ role: e.target.value })} data-testid="licence-role"><option value="user">User</option><option value="admin">Administrator (every tab, every workspace)</option></select>
          </label>
          {!admin && (
            <label>Valid for
              <select value={form.duration} onChange={(e) => set({ duration: e.target.value })} data-testid="licence-duration">{DURATIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              {form.duration === "date" && <input type="date" value={form.until} min={new Date().toISOString().slice(0, 10)} onChange={(e) => set({ until: e.target.value })} data-testid="licence-until" />}
            </label>
          )}
          <label className="licence-note">Note (for us)<input value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. the deal, the contact" data-testid="licence-note" /></label>
        </div>
        {!admin && (
          <fieldset className="licence-tabs" data-testid="licence-tabs">
            <legend>Tabs they can open <button type="button" className="rtc-link" onClick={() => set({ tabs: TAB_CATALOG.map((t) => t.id) })}>all</button> <button type="button" className="rtc-link" onClick={() => set({ tabs: [] })}>none</button></legend>
            {TAB_CATALOG.map((t) => (
              <label key={t.id} className={form.tabs.includes(t.id) ? "on" : ""}>
                <input type="checkbox" checked={form.tabs.includes(t.id)} onChange={() => toggleTab(t.id)} data-testid={`licence-tab-${t.id}`} /> {t.label}
              </label>
            ))}
          </fieldset>
        )}
        <div className="licence-submit">
          <span className="rtc-note">The password is generated for you and shown once, to copy and send.</span>
          <button type="submit" className="primary" disabled={busy} data-testid="licence-give"><UserPlus size={14} /> {admin ? "Add administrator" : "Give the licence"}</button>
        </div>
      </form>

      {creds && <Credentials creds={creds} onClose={() => setCreds(null)} />}
      {msg && <div className="loading">{msg}</div>}
      {error && <div className="alert" data-testid="licence-error">{error}</div>}

      <div className="table-wrap licence-table" style={{ marginTop: 18 }}>
        <table data-testid="licence-users">
          <thead><tr><th>Name / email</th><th>Workspace</th><th>Tabs</th><th>Licence</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>
            {users.map((u) => {
              const st = licenceState(u);
              const self = u.id === me.id;
              const client = u.role !== "admin";
              return (
                <tr key={u.id} data-testid={`licence-row-${u.email}`} className={st.cls === "off" || st.cls === "ended" ? "is-off" : ""}>
                  <td><strong>{u.name || "–"}</strong>{self && <span className="tag">you</span>}<small>{u.email}</small>{u.note && <small className="licence-note-text">{u.note}</small>}</td>
                  <td>{u.role === "admin" ? "Administrator" : u.org || "Our team"}</td>
                  <td className="licence-tabs-cell">{tabsOf(u)}</td>
                  <td><span className={`licence-state ${st.cls}`} data-testid={`licence-state-${u.email}`}>{st.text}</span></td>
                  <td>{when(u.last_login_at)}</td>
                  <td className="lib-actions">
                    {!self && (
                      <button type="button" className="rtc-link" data-testid={`licence-reset-${u.email}`}
                        onClick={() => { if (window.confirm(`Give ${u.email} a new password? The old one stops working and their sessions end.`)) run(async () => { const { user, password } = await call(`/api/users/${u.id}`, "PATCH", { resetPassword: true }); replace(user); setCreds({ user, password, fresh: false }); }); }}>
                        <KeyRound size={12} /> New password
                      </button>
                    )}
                    {client && !self && (
                      <button type="button" className="rtc-link" data-testid={`licence-extend-${u.email}`}
                        onClick={() => run(async () => {
                          const from = u.expires_at && new Date(u.expires_at) > new Date() ? new Date(u.expires_at) : new Date();
                          const { user } = await call(`/api/users/${u.id}`, "PATCH", { expiresAt: new Date(from.getTime() + 30 * 86400000).toISOString() });
                          replace(user);
                        }, `Extended ${u.email} by 30 days.`)}>
                        <CalendarPlus size={12} /> +30 days
                      </button>
                    )}
                    {!self && (
                      <button type="button" className={`rtc-link ${u.disabled ? "" : "danger"}`} data-testid={`licence-toggle-${u.email}`}
                        onClick={() => run(async () => { const { user } = await call(`/api/users/${u.id}`, "PATCH", { disabled: !u.disabled }); replace(user); }, u.disabled ? `${u.email} can sign in again.` : `${u.email} is switched off and signed out.`)}>
                        <Power size={12} /> {u.disabled ? "Switch on" : "Switch off"}
                      </button>
                    )}
                    {!self && (
                      <button type="button" className="rtc-link danger" data-testid={`licence-remove-${u.email}`}
                        onClick={() => { if (window.confirm(`Remove ${u.email}? Their saved bids are kept (they pass to our team's workspace).`)) run(async () => { await call(`/api/users/${u.id}`, "DELETE"); setUsers(users.filter((x) => x.id !== u.id)); }, "User removed."); }}>
                        <Trash2 size={12} /> Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3 className="licence-subhead">Change the tabs of an account</h3>
      <TabAccess users={users} setUsers={setUsers} initialDefault={defaultTabs} />
    </>
  );
}
