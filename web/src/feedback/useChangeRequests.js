// Change requests in the browser: the list with counts by status, refreshed every 20 seconds, and
// the calls that raise, decide, remove and export. Only for someone on the team.
import { useCallback, useEffect, useState } from "react";

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(path, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function useChangeRequests(enabled = true) {
  const [data, setData] = useState({ items: [], counts: {} });
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try { setData(await call("/api/change-requests")); setError(""); } catch (err) { setError(err.message); }
  }, [enabled]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 20_000);
    return () => clearInterval(timer);
  }, [refresh]);
  const raise = useCallback(async (body) => { const out = await call("/api/change-requests", { method: "POST", body }); await refresh(); return out.item; }, [refresh]);
  const decide = useCallback(async (id, status) => { const out = await call(`/api/change-requests/${id}`, { method: "PATCH", body: { status } }); await refresh(); return out.item; }, [refresh]);
  const remove = useCallback(async (id) => { await call(`/api/change-requests/${id}`, { method: "DELETE" }); await refresh(); }, [refresh]);
  /** Download the approved requests as the prompt file; they are marked exported. */
  const exportPrompt = useCallback(async () => {
    const res = await fetch("/api/change-requests/export", { credentials: "same-origin" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Export failed (${res.status})`); }
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "tenderos-change-requests.md";
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    await refresh();
    return { name, count: Number(res.headers.get("x-change-requests") || 0) };
  }, [refresh]);
  return { items: data.items || [], counts: data.counts || {}, error, refresh, raise, decide, remove, exportPrompt };
}
