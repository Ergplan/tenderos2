"use client";
import { useState } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck, Trash2, X } from "lucide-react";
import { when } from "./ScenarioLibrary";

async function call(method, body) {
  const res = await fetch("/api/settings/api-keys", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const SOURCE = {
  app: "Set in the application",
  env: "From the server's .env",
  none: "Not set",
};

/**
 * One row per provider key. The value is typed once, checked with the provider and stored
 * encrypted; afterwards the row shows only that it is set, its last four characters, who set it
 * and when. Replace types a new one; Remove deletes it (a key in .env then applies again).
 */
export default function ApiKeysAdmin({ initial, zone }) {
  const [keys, setKeys] = useState(initial);
  const [editing, setEditing] = useState(null); // key name whose input is open
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const core = zone === "core";

  function open(name) {
    setEditing(name);
    setValue("");
    setShow(false);
    setMsg("");
    setError("");
  }

  async function save(name) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const data = await call("PUT", { name, value });
      setKeys(data.keys);
      setEditing(null);
      setValue("");
      const label = data.keys.find((k) => k.name === name)?.label || name;
      setMsg(data.checked ? `${label} key saved: the provider accepted it. It is now hidden.` : data.warning ? `${label} key saved and hidden. ${data.warning}` : `${label} key saved and hidden.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(name, label) {
    if (!window.confirm(`Remove the ${label} key from the application? A key in the server's .env, if any, applies again.`)) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const data = await call("DELETE", { name });
      setKeys(data.keys);
      setMsg(`${label} key removed.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="api-keys">
      <p className="muted" style={{ maxWidth: 760 }}>
        Each key is typed once, checked with its provider and stored encrypted on this server. It is never shown again or sent to the browser:
        the row shows only that it is set and its last four characters. A key set here is used instead of the same variable in the server&apos;s .env.
      </p>
      {core && <div className="alert" data-testid="api-keys-core">This is the core zone: it holds no cloud API keys. Enter them on the intake-zone installation (docs/enterprise/ARCHITECTURE.md).</div>}
      {msg && <div className="loading" data-testid="api-keys-msg">{msg}</div>}
      {error && <div className="alert" data-testid="api-keys-error">{error}</div>}
      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table className="api-keys-table">
          <thead><tr><th>Key</th><th>Used for</th><th>Status</th><th /></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.name} data-testid={`api-key-${k.name}`} data-source={k.source}>
                <td>
                  <strong>{k.label}</strong>
                  <div className="muted mono" style={{ fontSize: 11 }}>{k.name} · {k.usedBy === "engine" ? "engine" : "web server"}</div>
                </td>
                <td>{k.what}</td>
                <td>
                  <span className={`tag tag-key-${k.source}`} data-testid={`api-key-status-${k.name}`}>{k.set ? "Set" : "Not set"}</span>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {SOURCE[k.source]}{k.hint ? ` · ends ${k.hint}` : ""}
                    {k.source === "app" && k.updatedAt ? ` · ${k.updatedBy || "unknown"}, ${when(k.updatedAt)}` : ""}
                    {k.unreadable ? " · stored under an earlier SESSION_SECRET and unreadable: enter it again" : ""}
                  </div>
                </td>
                <td className="lib-actions">
                  {editing === k.name ? (
                    <form className="api-key-form" onSubmit={(e) => { e.preventDefault(); save(k.name); }} data-testid={`api-key-form-${k.name}`}>
                      <div className="api-key-input">
                        <input type={show ? "text" : "password"} value={value} onChange={(e) => setValue(e.target.value)} placeholder={`Paste the ${k.label} key`} autoComplete="off" autoFocus spellCheck={false} data-testid="api-key-value" />
                        <button type="button" className="rtc-link" onClick={() => setShow(!show)} aria-label={show ? "Hide the key while typing" : "Show the key while typing"}>{show ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                      </div>
                      <button type="submit" className="primary" disabled={busy || !value.trim()} data-testid="api-key-save"><ShieldCheck size={13} /> {busy ? "Checking…" : "Check and save"}</button>
                      <button type="button" className="rtc-link" onClick={() => setEditing(null)} disabled={busy}><X size={12} /> Cancel</button>
                    </form>
                  ) : (
                    <>
                      <button type="button" className="rtc-link" disabled={core || busy} onClick={() => open(k.name)} data-testid={`api-key-edit-${k.name}`}><KeyRound size={12} /> {k.source === "app" ? "Replace" : "Add key"}</button>
                      {k.source === "app" && <button type="button" className="rtc-link danger" disabled={busy} onClick={() => remove(k.name, k.label)} data-testid={`api-key-remove-${k.name}`}><Trash2 size={12} /> Remove</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
        Checking means one request that lists the provider&apos;s models; nothing is generated and nothing is billed. If the provider cannot be reached
        from this server the key is saved unchecked and the first real call tells. Removing a key here never touches the server&apos;s .env.
      </p>
    </div>
  );
}
