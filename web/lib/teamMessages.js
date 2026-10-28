// Team mode: pings on any input box of any tab. Server-only.
//
// Anyone on the tender team can open the thread of an input box (the send icon beside it), write a
// message that mentions teammates with @handle, and offer a value in reply. The people mentioned,
// and on a reply the others already in the thread, get a notice in their inbox (team_notices), and
// those mentioned get an email when mail is on (kept in team_outbox like the assignments' emails).
import { query } from "./db";
import { HttpError } from "./auth";
import { listMembers } from "./team";
import { mailMode, sendMail } from "./mail";
import { DEMO_MODE } from "./demo";
import { ALL_TAB_IDS } from "./tabs";
import { mentionedIn, withHandles } from "../src/team/mentions.js";

const str = (v, max) => String(v ?? "").slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MSG_COLS = `m.id, m.thread_key, m.tab, m.field_label, m.place, m.step, m.field_value, m.from_id, m.body, m.value, m.created_at,
  f.name AS from_name, f.team AS from_team, f.title AS from_title`;

function checkKey(key) {
  const k = str(key, 200);
  if (!/^[a-zA-Z]+:[\w.:-]{1,190}$/.test(k)) throw new HttpError(400, "Unknown field.");
  return k;
}

/** Post a message in a field's thread; returns it with the people told. */
export async function postMessage(me, body) {
  const key = checkKey(body?.threadKey);
  const tab = str(body?.tab, 40);
  if (!ALL_TAB_IDS.includes(tab) || !key.startsWith(`${tab}:`)) throw new HttpError(400, "Unknown tab.");
  const text = str(body?.body, 4000).trim();
  const value = body?.value === undefined || body?.value === null || String(body.value).trim() === "" ? null : str(body.value, 500).trim();
  if (!text && value === null) throw new HttpError(400, "Write a message or a value.");
  const label = str(body?.fieldLabel, 200).trim() || "A field";
  const members = await listMembers();
  const mentioned = mentionedIn(text, members).filter((m) => m.id !== me.id);
  const { rows } = await query(
    `INSERT INTO team_messages (thread_key, tab, field_label, place, step, field_value, from_id, body, value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`,
    [key, tab, label, str(body?.place, 300), str(body?.step, 120), str(body?.fieldValue, 300), me.id, text, value],
  );
  const msg = rows[0];
  // a reply also reaches the others already in the thread (who wrote or were mentioned)
  const prior = await query(
    `SELECT DISTINCT x.id FROM (
       SELECT from_id AS id FROM team_messages WHERE thread_key = $1 AND id <> $2
       UNION SELECT n.member_id FROM team_notices n JOIN team_messages t ON t.id = n.message_id WHERE t.thread_key = $1 AND t.id <> $2
     ) x WHERE x.id IS NOT NULL`,
    [key, msg.id],
  );
  const told = new Map(mentioned.map((m) => [m.id, "mention"]));
  for (const r of prior.rows) if (r.id !== me.id && !told.has(r.id) && members.some((m) => m.id === r.id)) told.set(r.id, "reply");
  for (const [memberId, kind] of told) {
    await query("INSERT INTO team_notices (message_id, member_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [msg.id, memberId, kind]);
  }
  await emailMentioned(me, { id: msg.id, label, place: str(body?.place, 300), text, value }, mentioned);
  return { id: msg.id, createdAt: msg.created_at, mentioned: mentioned.map((m) => ({ id: m.id, name: m.name, handle: m.handle })), told: told.size };
}

async function emailMentioned(me, msg, mentioned) {
  const mode = mailMode();
  if (mode === "off") return;
  const app = (process.env.APP_URL || "").replace(/\/$/, "");
  for (const m of mentioned) {
    if (!m.email) continue;
    const subject = `${me.name} needs "${msg.label}" in TenderOS`;
    const text = [`Dear ${m.name},`, "", `${me.name} pinged you about "${msg.label}" (${msg.place || "TenderOS"}):`, "", msg.text,
      ...(msg.value !== null ? ["", `Value offered: ${msg.value}`] : []), "",
      app ? `Open TenderOS and click Messages to answer: ${app}/` : "Open TenderOS and click Messages to answer.", "", "TenderOS"].join("\n");
    let status = "demo";
    let error = null;
    if (mode === "smtp") {
      const res = await sendMail({ to: m.email, subject, text });
      status = res.sent ? "sent" : "failed";
      error = res.error;
    } else if (!DEMO_MODE) {
      continue;
    }
    await query("INSERT INTO team_outbox (message_id, to_name, to_email, subject, body, status, error) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [msg.id, m.name, m.email, subject, text, status, error]);
  }
}

/** A field's thread, oldest first, each message with who wrote it and who it mentions. */
export async function listThread(me, key) {
  const k = checkKey(key);
  const { rows } = await query(`SELECT ${MSG_COLS} FROM team_messages m LEFT JOIN team_members f ON f.id = m.from_id WHERE m.thread_key = $1 ORDER BY m.created_at LIMIT 300`, [k]);
  const members = withHandles(await listMembers());
  const handle = Object.fromEntries(members.map((m) => [m.id, m.handle]));
  return rows.map((r) => ({ ...r, from_handle: handle[r.from_id] || null, mine: r.from_id === me.id }));
}

/** How many messages each field of a tab has, and how many of them are unread for me. */
export async function threadCounts(me, tab) {
  if (!ALL_TAB_IDS.includes(tab)) throw new HttpError(400, "Unknown tab.");
  const { rows } = await query(
    `SELECT m.thread_key, count(*)::int AS messages,
            count(n.message_id) FILTER (WHERE n.read_at IS NULL)::int AS unread
       FROM team_messages m LEFT JOIN team_notices n ON n.message_id = m.id AND n.member_id = $2
      WHERE m.tab = $1 GROUP BY m.thread_key`,
    [tab, me.id],
  );
  return Object.fromEntries(rows.map((r) => [r.thread_key, { messages: r.messages, unread: r.unread }]));
}

/** My inbox: the messages I was mentioned in or that answered a thread I am in, newest first. */
export async function inbox(me) {
  const { rows } = await query(
    `SELECT ${MSG_COLS}, n.kind, n.read_at FROM team_notices n JOIN team_messages m ON m.id = n.message_id
       LEFT JOIN team_members f ON f.id = m.from_id WHERE n.member_id = $1 ORDER BY m.created_at DESC LIMIT 200`,
    [me.id],
  );
  return { notices: rows, unread: rows.filter((r) => !r.read_at).length };
}

/** Mark messages read: by id, or every message of a thread. */
export async function markRead(me, { ids = null, threadKey = null } = {}) {
  if (threadKey) {
    await query(`UPDATE team_notices n SET read_at = now() FROM team_messages m
                  WHERE m.id = n.message_id AND n.member_id = $1 AND m.thread_key = $2 AND n.read_at IS NULL`, [me.id, checkKey(threadKey)]);
  } else if (Array.isArray(ids) && ids.length) {
    const good = ids.filter((id) => UUID.test(String(id))).slice(0, 500);
    if (good.length) await query("UPDATE team_notices SET read_at = now() WHERE member_id = $1 AND message_id = ANY($2) AND read_at IS NULL", [me.id, good]);
  }
  return { ok: true };
}
