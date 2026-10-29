// Evidence in the browser: the open tab's evidence by box key (items, sign-off, count), refreshed
// every 20 seconds, and the calls that attach, remove and sign off. Only for someone on the team.
import { useCallback, useEffect, useMemo, useState } from "react";

async function call(path, { method = "GET", body, form } = {}) {
  const res = await fetch(path, {
    method, credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function useEvidence(tab, enabled = true) {
  const [data, setData] = useState({ items: [], signoffs: {}, counts: {} });
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!tab || !enabled) return;
    try {
      setData(await call(`/api/evidence?tab=${encodeURIComponent(tab)}`));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [tab, enabled]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  /** Attach: { fieldKey, fieldLabel, place, valueAt, kind, url, note, file }. A file goes as multipart. */
  const add = useCallback(async (ev) => {
    let out;
    if (ev.kind === "file") {
      const form = new FormData();
      for (const k of ["fieldKey", "fieldLabel", "place", "valueAt", "kind"]) form.set(k, ev[k] ?? "");
      form.set("tab", tab);
      form.set("file", ev.file);
      out = await call("/api/evidence", { method: "POST", form });
    } else {
      out = await call("/api/evidence", { method: "POST", body: { ...ev, file: undefined, tab } });
    }
    await refresh();
    return out.item;
  }, [tab, refresh]);
  const remove = useCallback(async (id) => { await call(`/api/evidence/${id}`, { method: "DELETE" }); await refresh(); }, [refresh]);
  const signOff = useCallback(async ({ fieldKey, fieldLabel, valueAt, signed }) => {
    const out = await call("/api/evidence/signoff", { method: "POST", body: { tab, fieldKey, fieldLabel, valueAt, signed } });
    await refresh();
    return out.signoff;
  }, [tab, refresh]);

  const byKey = useMemo(() => {
    const m = {};
    for (const it of data.items || []) (m[it.field_key] ||= []).push(it);
    return m;
  }, [data.items]);
  return { items: data.items || [], byKey, signoffs: data.signoffs || {}, counts: data.counts || {}, error, refresh, add, remove, signOff };
}
