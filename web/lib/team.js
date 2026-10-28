// Team sharing on a saved bid. Server-only.
//
// The tender's team: one or more super admins (the tender manager) and members of the finance,
// procurement, legal and technical teams. Anyone on the team can assign a data point of a saved bid
// (a particular, a format's blank, a cost, a financing input, a format to sign, a tender condition)
// to a team or a person; the assignee answers with a value, a note or a file; a super admin accepts
// the answer (the browser writes it into the bid as a new saved version) or returns it. Every step
// is an assignment_events row, and people are told by email when SMTP is set (lib/mail.js).
//
// Who is acting: in demo mode (no sign-in) the visitor picks a member ("View as", a cookie); with
// sign-in, the member linked to the user (by id, else by email). An administrator who is not on the
// team yet is added as a super admin.
import { cookies } from "next/headers";
import { query, tx } from "./db";
import { HttpError } from "./auth";
import { DEMO_MODE } from "./demo";
import { mailMode, sendMail } from "./mail";
import { ALL_TAB_IDS } from "./tabs";

export const TEAMS = {
  management: "Tender management",
  finance: "Finance",
  procurement: "Procurement",
  legal: "Legal",
  technical: "Technical",
};
export const KINDS = ["field", "cost", "finance", "document", "condition"];
export const ACT_AS_COOKIE = "tenderos_member";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v, max = 2000) => String(v ?? "").slice(0, max);

export function assertUuid(id, what = "Not found.") {
  if (!UUID.test(String(id))) throw new HttpError(404, what);
}

// the demo's seats: one per team, each with a fictional address (.example is reserved, never
// delivered) so the demo outbox shows who would be emailed
const DEMO_SEATS = [
  { name: "Tender manager", team: "management", super_admin: true, email: "tender.manager@arkaja-renewables.example", title: "Head of bids", tabs: ALL_TAB_IDS },
  { name: "Finance desk", team: "finance", email: "finance@arkaja-renewables.example", title: "CFO's office", tabs: ["tenderBid", "rtc", "seciRtc", "cfd", "whatIf"] },
  { name: "Procurement desk", team: "procurement", email: "procurement@arkaja-renewables.example", title: "EPC and equipment costs", tabs: ["tenderBid", "rtc", "seciRtc", "bessTender", "whatIf"] },
  { name: "Legal desk", team: "legal", email: "legal@arkaja-renewables.example", title: "Contracts and tender conditions", tabs: ["tenderBid", "seciRtc", "bessTender", "recentTenders"] },
  { name: "Technical desk", team: "technical", email: "technical@arkaja-renewables.example", title: "Resource, design and grid", tabs: ["tenderBid", "rtc", "seciRtc", "bessTender", "whatIf"] },
];

const MEMBER_COLS = "id, name, email, team, super_admin, user_id, active, title, tabs, created_at";
const cleanTabs = (tabs) => (Array.isArray(tabs) ? ALL_TAB_IDS.filter((id) => tabs.includes(id)) : null);

export async function listMembers({ all = false } = {}) {
  const { rows } = await query(`SELECT ${MEMBER_COLS} FROM team_members ${all ? "" : "WHERE active"} ORDER BY super_admin DESC, team, name`);
  return rows;
}

async function seedDemo() {
  const { rows } = await query("SELECT count(*)::int AS n FROM team_members");
  if (rows[0].n === 0) {
    for (const s of DEMO_SEATS) {
      await query("INSERT INTO team_members (name, email, team, super_admin, title, tabs) VALUES ($1, $2, $3, $4, $5, $6)", [s.name, s.email, s.team, Boolean(s.super_admin), s.title, s.tabs]);
    }
    return;
  }
  // seats made before they had addresses get theirs (an address someone typed is kept)
  for (const s of DEMO_SEATS) {
    await query("UPDATE team_members SET email = $2 WHERE name = $1 AND team = $3 AND email = ''", [s.name, s.email, s.team]);
    // and a title and the tabs they cover (Team setup), unless someone set them
    await query("UPDATE team_members SET title = $2, tabs = $4 WHERE name = $1 AND team = $3 AND title = '' AND cardinality(tabs) = 0", [s.name, s.title, s.team, s.tabs]);
  }
}

/** The member the request acts as, or null (signed in but not on the team). */
export async function actingMember(user) {
  if (!user) return null;
  if (DEMO_MODE) {
    await seedDemo();
    const jar = await cookies();
    const id = jar.get(ACT_AS_COOKIE)?.value;
    if (id && UUID.test(id)) {
      const { rows } = await query(`SELECT ${MEMBER_COLS} FROM team_members WHERE id = $1 AND active`, [id]);
      if (rows[0]) return rows[0];
    }
    const { rows } = await query(`SELECT ${MEMBER_COLS} FROM team_members WHERE active AND super_admin ORDER BY created_at LIMIT 1`);
    return rows[0] || null;
  }
  const { rows } = await query(
    `SELECT ${MEMBER_COLS} FROM team_members WHERE active AND (user_id = $1 OR (user_id IS NULL AND lower(email) = lower($2))) ORDER BY (user_id = $1) DESC LIMIT 1`,
    [user.id, user.email],
  );
  if (rows[0]) {
    if (!rows[0].user_id) await query("UPDATE team_members SET user_id = $1 WHERE id = $2", [user.id, rows[0].id]);
    return rows[0];
  }
  if (user.role === "admin") {
    const ins = await query(`INSERT INTO team_members (name, email, team, super_admin, user_id) VALUES ($1, $2, 'management', true, $3) RETURNING ${MEMBER_COLS}`,
      [user.name || user.email, user.email, user.id]);
    return ins.rows[0];
  }
  return null;
}

export async function requireMember(user) {
  const me = await actingMember(user);
  if (!me) throw new HttpError(403, "You are not on the tender team yet: ask the tender's super admin to add you.");
  return me;
}

function requireSuper(me) {
  if (!me.super_admin) throw new HttpError(403, "Only the tender's super admin can do this.");
}

export async function addMember(me, { name, email = "", team, superAdmin = false, title = "", tabs = [] }) {
  requireSuper(me);
  if (!str(name).trim()) throw new HttpError(400, "Name is required.");
  if (!TEAMS[team]) throw new HttpError(400, "Unknown team.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That email address does not look right.");
  const { rows } = await query(`INSERT INTO team_members (name, email, team, super_admin, title, tabs) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${MEMBER_COLS}`,
    [str(name, 120).trim(), str(email, 200).trim(), team, Boolean(superAdmin), str(title, 120).trim(), cleanTabs(tabs) || []]);
  return rows[0];
}

export async function updateMember(me, id, { name, email, team, superAdmin, active, title, tabs }) {
  requireSuper(me);
  assertUuid(id, "Member not found.");
  if (team !== undefined && !TEAMS[team]) throw new HttpError(400, "Unknown team.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That email address does not look right.");
  if (id === me.id && (superAdmin === false || active === false)) throw new HttpError(400, "You cannot remove your own super admin rights.");
  const { rows } = await query(
    `UPDATE team_members SET name = COALESCE($2, name), email = COALESCE($3, email), team = COALESCE($4, team),
            super_admin = COALESCE($5, super_admin), active = COALESCE($6, active), title = COALESCE($7, title), tabs = COALESCE($8, tabs)
      WHERE id = $1 RETURNING ${MEMBER_COLS}`,
    [id, name === undefined ? null : str(name, 120).trim(), email === undefined ? null : str(email, 200).trim(), team ?? null,
      superAdmin === undefined ? null : Boolean(superAdmin), active === undefined ? null : Boolean(active),
      title === undefined ? null : str(title, 120).trim(), tabs === undefined ? null : cleanTabs(tabs)],
  );
  if (!rows[0]) throw new HttpError(404, "Member not found.");
  return rows[0];
}

// ---------------------------------------------------------------- assignments

const A_COLS = `a.id, a.scenario_id, a.target_kind, a.target_key, a.target_label, a.context, a.request, a.team, a.assignee_id,
  a.created_by, a.due_date, a.status, a.answer, a.file_id, a.accepted_version, a.created_at, a.updated_at,
  s.name AS scenario_name, am.name AS assignee_name, cm.name AS created_by_name, f.name AS file_name, f.size_bytes AS file_size`;
const A_FROM = `assignments a JOIN scenarios s ON s.id = a.scenario_id
  LEFT JOIN team_members am ON am.id = a.assignee_id LEFT JOIN team_members cm ON cm.id = a.created_by LEFT JOIN team_files f ON f.id = a.file_id`;

export async function listAssignments({ scenarioId = null, memberId = null } = {}) {
  const vals = [];
  const where = [];
  if (scenarioId) { assertUuid(scenarioId, "Bid not found."); vals.push(scenarioId); where.push(`a.scenario_id = $${vals.length}`); }
  if (memberId) { vals.push(memberId); where.push(`a.assignee_id = $${vals.length}`); }
  const { rows } = await query(`SELECT ${A_COLS} FROM ${A_FROM} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.updated_at DESC LIMIT 500`, vals);
  if (!rows.length) return rows;
  const ev = await query(
    `SELECT e.assignment_id, e.kind, e.note, e.created_at, m.name AS member_name FROM assignment_events e LEFT JOIN team_members m ON m.id = e.member_id
      WHERE e.assignment_id = ANY($1) ORDER BY e.created_at`,
    [rows.map((r) => r.id)],
  );
  const byId = Object.fromEntries(rows.map((r) => [r.id, { ...r, events: [] }]));
  for (const e of ev.rows) byId[e.assignment_id]?.events.push(e);
  return Object.values(byId).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

async function getAssignment(id) {
  assertUuid(id, "Assignment not found.");
  const { rows } = await query(`SELECT ${A_COLS} FROM ${A_FROM} WHERE a.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Assignment not found.");
  return rows[0];
}

async function event(client, assignmentId, memberId, kind, note = "") {
  await client.query("INSERT INTO assignment_events (assignment_id, member_id, kind, note) VALUES ($1, $2, $3, $4)", [assignmentId, memberId, kind, str(note)]);
}

/** Who to tell: the assignee, or everyone on the team when it is assigned to a team. */
async function recipients(a) {
  if (a.assignee_id) {
    const { rows } = await query("SELECT name, email FROM team_members WHERE id = $1 AND active AND email <> ''", [a.assignee_id]);
    return rows;
  }
  const { rows } = await query("SELECT name, email FROM team_members WHERE team = $1 AND active AND email <> ''", [a.team]);
  return rows;
}

async function superAdmins() {
  const { rows } = await query("SELECT name, email FROM team_members WHERE super_admin AND active AND email <> ''");
  return rows;
}

const link = (a) => `${(process.env.APP_URL || "").replace(/\/$/, "")}/?open=${a.scenario_id}&team=${a.id}`;

/**
 * Email people about an assignment. Every mail is composed the same way and kept in team_outbox:
 * sent through SMTP when it is set, or, on a demo deployment without SMTP, kept as the demo outbox
 * (shown in the Team panel, not sent). Each one is also an event in the assignment's history.
 */
async function notify(a, to, subject, lines) {
  const mode = mailMode();
  if (mode === "off" || !to.length) return;
  const text = [`Dear ${"{name}"},`, "", ...lines, "", `Bid: ${a.scenario_name}`,
    process.env.APP_URL ? `Open it in TenderOS: ${link(a)}` : "Open the bid in TenderOS and click Team.", "", "TenderOS"].join("\n");
  for (const r of to) {
    const body = text.replace("{name}", r.name);
    const res = mode === "smtp" ? await sendMail({ to: r.email, subject, text: body }) : { sent: false, error: null };
    const status = mode === "demo" ? "demo" : res.sent ? "sent" : "failed";
    await query("INSERT INTO team_outbox (assignment_id, scenario_id, to_name, to_email, subject, body, status, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [a.id, a.scenario_id, r.name, r.email, subject, body, status, res.error]);
    await query("INSERT INTO assignment_events (assignment_id, kind, note) VALUES ($1, $2, $3)",
      [a.id, status === "failed" ? "email_failed" : "emailed",
        status === "failed" ? `${r.email}: ${res.error}` : `${r.name} <${r.email}>: ${subject}${status === "demo" ? " (demo outbox)" : ""}`]);
  }
}

/** The emails composed for a saved bid, newest first. */
export async function listOutbox(scenarioId) {
  assertUuid(scenarioId, "Bid not found.");
  const { rows } = await query(
    `SELECT o.id, o.assignment_id, o.to_name, o.to_email, o.subject, o.body, o.status, o.error, o.created_at, a.target_label
       FROM team_outbox o LEFT JOIN assignments a ON a.id = o.assignment_id
      WHERE o.scenario_id = $1 ORDER BY o.created_at DESC LIMIT 300`,
    [scenarioId],
  );
  return rows;
}

export async function createAssignment(me, body) {
  const { scenarioId, targetKind, targetKey, targetLabel, context = {}, request = "", team, assigneeId = null, dueDate = null } = body || {};
  assertUuid(scenarioId, "Save the bid to the library first: assignments belong to a saved bid.");
  if (!KINDS.includes(targetKind)) throw new HttpError(400, "Unknown kind of data point.");
  if (!str(targetKey, 200).trim() || !str(targetLabel, 300).trim()) throw new HttpError(400, "Which data point?");
  if (!TEAMS[team]) throw new HttpError(400, "Choose a team.");
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new HttpError(400, "Due date must be a date.");
  const s = await query("SELECT id, name FROM scenarios WHERE id = $1 AND NOT archived", [scenarioId]);
  if (!s.rows[0]) throw new HttpError(404, "Bid not found.");
  if (assigneeId) {
    assertUuid(assigneeId, "Member not found.");
    const m = await query("SELECT team FROM team_members WHERE id = $1 AND active", [assigneeId]);
    if (!m.rows[0]) throw new HttpError(404, "Member not found.");
  }
  const open = await query("SELECT id FROM assignments WHERE scenario_id = $1 AND target_key = $2 AND status IN ('open', 'submitted', 'returned')", [scenarioId, targetKey]);
  if (open.rows[0]) throw new HttpError(409, "This data point is already assigned and not yet accepted.");
  const ctx = JSON.parse(JSON.stringify(context ?? {}));
  if (JSON.stringify(ctx).length > 20000) throw new HttpError(400, "Context too large.");
  const id = await tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO assignments (scenario_id, target_kind, target_key, target_label, context, request, team, assignee_id, created_by, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [scenarioId, targetKind, str(targetKey, 200), str(targetLabel, 300), ctx, str(request), team, assigneeId, me.id, dueDate],
    );
    await event(client, rows[0].id, me.id, "created", str(request));
    return rows[0].id;
  });
  const a = await getAssignment(id);
  await notify(a, await recipients(a), `TenderOS: ${a.target_label} (${s.rows[0].name})`, [
    `${me.name} asks ${a.assignee_name || TEAMS[a.team]} for: ${a.target_label}.`,
    a.request ? `Request: ${a.request}` : "",
    a.due_date ? `Due: ${String(a.due_date).slice(0, 10)}` : "",
  ].filter(Boolean));
  return a;
}

/** submit | accept | return | cancel | comment | reassign. */
export async function actOnAssignment(me, id, action, { value = null, note = "", fileId = null, version = null, assigneeId = null } = {}) {
  const a = await getAssignment(id);
  const mine = a.assignee_id ? a.assignee_id === me.id : a.team === me.team;
  const live = ["open", "returned"].includes(a.status);
  if (action === "submit") {
    if (!live) throw new HttpError(409, `This is ${a.status}: nothing to answer.`);
    if (!mine && !me.super_admin) throw new HttpError(403, "Only the person or team it is assigned to can answer it.");
    if (value === null && !str(note).trim() && !fileId) throw new HttpError(400, "Give a value, a note or a file.");
    if (a.target_kind === "document" && !fileId) throw new HttpError(400, "Upload the signed copy.");
    await tx(async (client) => {
      await client.query("UPDATE assignments SET status = 'submitted', answer = $2, file_id = COALESCE($3, file_id), updated_at = now() WHERE id = $1",
        [id, { value, note: str(note), by: me.name, at: new Date().toISOString() }, fileId]);
      await event(client, id, me.id, "submitted", str(note) || (value !== null ? `Value: ${str(value, 200)}` : "File uploaded"));
    });
    const b = await getAssignment(id);
    await notify(b, await superAdmins(), `TenderOS: answer to accept: ${b.target_label}`, [
      `${me.name} answered: ${b.target_label}.`, value !== null ? `Value: ${str(value, 500)}` : "", note ? `Note: ${note}` : "", b.file_name ? `File: ${b.file_name}` : "",
    ].filter(Boolean));
    return b;
  }
  if (action === "accept" || action === "return") {
    requireSuper(me);
    if (a.status !== "submitted") throw new HttpError(409, "Only a submitted answer can be accepted or returned.");
    if (action === "return" && !str(note).trim()) throw new HttpError(400, "Say what is needed.");
    await tx(async (client) => {
      await client.query("UPDATE assignments SET status = $2, accepted_version = $3, updated_at = now() WHERE id = $1",
        [id, action === "accept" ? "accepted" : "returned", action === "accept" && Number.isInteger(version) ? version : null]);
      await event(client, id, me.id, action === "accept" ? "accepted" : "returned", action === "accept" ? `${str(note) || "Accepted"}${Number.isInteger(version) ? ` · saved as version ${version}` : ""}` : str(note));
    });
    const b = await getAssignment(id);
    await notify(b, await recipients(b), `TenderOS: ${action === "accept" ? "accepted" : "returned"}: ${b.target_label}`, [
      `${me.name} ${action === "accept" ? "accepted" : "returned"} your answer for ${b.target_label}.`, note ? `Note: ${note}` : "",
    ].filter(Boolean));
    return b;
  }
  if (action === "cancel") {
    requireSuper(me);
    if (!["open", "submitted", "returned"].includes(a.status)) throw new HttpError(409, `This is already ${a.status}.`);
    await tx(async (client) => {
      await client.query("UPDATE assignments SET status = 'cancelled', updated_at = now() WHERE id = $1", [id]);
      await event(client, id, me.id, "cancelled", str(note));
    });
    return getAssignment(id);
  }
  if (action === "reassign") {
    requireSuper(me);
    if (!live) throw new HttpError(409, `This is ${a.status}.`);
    assertUuid(assigneeId, "Member not found.");
    const m = await query("SELECT id, name, team FROM team_members WHERE id = $1 AND active", [assigneeId]);
    if (!m.rows[0]) throw new HttpError(404, "Member not found.");
    await tx(async (client) => {
      await client.query("UPDATE assignments SET assignee_id = $2, team = $3, updated_at = now() WHERE id = $1", [id, assigneeId, m.rows[0].team]);
      await event(client, id, me.id, "reassigned", `To ${m.rows[0].name}`);
    });
    const b = await getAssignment(id);
    await notify(b, await recipients(b), `TenderOS: ${b.target_label} (${b.scenario_name})`, [`${me.name} assigned you: ${b.target_label}.`, b.request ? `Request: ${b.request}` : ""].filter(Boolean));
    return b;
  }
  if (action === "comment") {
    if (!str(note).trim()) throw new HttpError(400, "Write a comment.");
    await tx(async (client) => {
      await client.query("UPDATE assignments SET updated_at = now() WHERE id = $1", [id]);
      await event(client, id, me.id, "comment", str(note));
    });
    return getAssignment(id);
  }
  throw new HttpError(400, "Unknown action.");
}

/** A file on a saved bid's assignment may be read by anyone on the team. */
export async function fileRow(id) {
  assertUuid(id, "File not found.");
  const { rows } = await query("SELECT id, name, content_type, size_bytes, path FROM team_files WHERE id = $1", [id]);
  if (!rows[0]) throw new HttpError(404, "File not found.");
  return rows[0];
}

export async function teamState(user) {
  const me = await actingMember(user);
  const mode = mailMode();
  return { me, members: me ? await listMembers({ all: Boolean(me.super_admin) }) : [], teams: TEAMS, demo: DEMO_MODE, mail: mode === "smtp", mailMode: mode };
}
