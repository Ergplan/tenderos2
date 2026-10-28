// Team mode in the browser, for the whole workspace: who is acting, the team with handles, my
// inbox and its unread count, the message counts of the open tab's fields, and the calls that post,
// read and manage. Refreshes every 15 seconds.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { withHandles } from "./mentions";

export const TeamModeContext = createContext(null);
export const useTeamMode = () => useContext(TeamModeContext);

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method, credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function useTeamModeState(activeTab) {
  const [team, setTeam] = useState(null); // { me, members, teams, demo }
  const [box, setBox] = useState({ notices: [], unread: 0 });
  const [counts, setCounts] = useState({});
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const t = await call("/api/team");
      setTeam(t);
      if (t.me) {
        const [b, c] = await Promise.all([call("/api/team/messages?inbox=1"), activeTab ? call(`/api/team/messages?tab=${activeTab}`) : { counts: {} }]);
        setBox(b);
        setCounts(c.counts || {});
      }
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [activeTab]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const thread = useCallback(async (key) => (await call(`/api/team/messages?thread=${encodeURIComponent(key)}`)).messages, []);
  const post = useCallback(async (msg) => { const out = await call("/api/team/messages", { method: "POST", body: msg }); await refresh(); return out.message; }, [refresh]);
  const markRead = useCallback(async (what) => { await call("/api/team/messages/read", { method: "POST", body: what }); await refresh(); }, [refresh]);
  const actAs = useCallback(async (memberId) => { await call("/api/team/act-as", { method: "POST", body: { memberId } }); await refresh(); }, [refresh]);
  const saveMember = useCallback(async (m) => {
    if (m.id) await call(`/api/team/members/${m.id}`, { method: "PATCH", body: m });
    else await call("/api/team/members", { method: "POST", body: m });
    await refresh();
  }, [refresh]);

  const members = useMemo(() => withHandles(team?.members || []), [team]);
  const me = team?.me ? members.find((m) => m.id === team.me.id) || { ...team.me, handle: "" } : null;
  return { ...(team || {}), me, members, box, counts, error, refresh, thread, post, markRead, actAs, saveMember };
}
