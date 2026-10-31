// Feedback and change requests (docs/TEAM.md). Server-only.
//
// Anyone on the tender team raises a change request on a section of any page: where (tab, step,
// section, the boxes in it), the comment, who and when. A super admin approves or rejects; the
// approved ones are exported as one Markdown prompt (src/feedback/prompt.js) and marked exported
// with the batch; after jouleWise ships the change a super admin marks them done.
import { query } from "./db";
import { HttpError } from "./auth";
import { TEAMS } from "./team";
import { ALL_TAB_IDS } from "./tabs";
import { changeRequestPrompt } from "../src/feedback/prompt.js";

export const STATUSES = ["open", "approved", "rejected", "exported", "done"];
const str = (v, max) => String(v ?? "").slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = [...ALL_TAB_IDS, "teamSetup", "changeRequests"];

const COLS = `r.id, r.seq, r.tab, r.tab_label, r.step, r.step_label, r.section_key, r.section_index, r.section_title, r.boxes, r.page_url, r.comment,
  r.requested_by, r.by_name, r.team, r.status, r.decided_by, r.decided_at, r.exported_at, r.export_batch, r.created_at, d.name AS decided_by_name`;
const FROM = "FROM change_requests r LEFT JOIN team_members d ON d.id = r.decided_by";

function requireSuper(me) {
  if (!me.super_admin) throw new HttpError(403, "Only the tender's super admin can do this.");
}

/** Every request, newest first; ?status= narrows. canDecide / canDelete for the caller. */
export async function listChangeRequests(me, { status = "" } = {}) {
  const where = status && STATUSES.includes(status) ? "WHERE r.status = $1" : "";
  const { rows } = await query(`SELECT ${COLS} ${FROM} ${where} ORDER BY r.created_at DESC`, where ? [status] : []);
  const counts = {};
  for (const s of STATUSES) counts[s] = 0;
  const all = where ? (await query("SELECT status, count(*)::int AS n FROM change_requests GROUP BY status")).rows : null;
  if (all) for (const a of all) counts[a.status] = a.n;
  else for (const r of rows) counts[r.status] += 1;
  return {
    items: rows.map((r) => ({ ...r, teamLabel: TEAMS[r.team] || r.team, canDecide: Boolean(me.super_admin), canDelete: Boolean(me.super_admin) || (r.requested_by === me.id && r.status === "open") })),
    counts,
  };
}

/** Raise a request: { tab, tabLabel, step, stepLabel, sectionKey, sectionIndex, sectionTitle, boxes, pageUrl, comment }. */
export async function addChangeRequest(me, body) {
  const tab = str(body.tab, 40);
  if (!TABS.includes(tab)) throw new HttpError(400, "Unknown tab.");
  const comment = str(body.comment, 6000).trim();
  if (!comment) throw new HttpError(400, "Write the comment.");
  const key = str(body.sectionKey, 200).trim() || `${tab}:page`;
  const boxes = (Array.isArray(body.boxes) ? body.boxes : []).map((b) => str(b, 120).trim()).filter(Boolean).slice(0, 40);
  const { rows } = await query(
    `INSERT INTO change_requests (tab, tab_label, step, step_label, section_key, section_index, section_title, boxes, page_url, comment, requested_by, by_name, team)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13) RETURNING id`,
    [tab, str(body.tabLabel, 80), str(body.step, 60), str(body.stepLabel, 120), key, str(body.sectionIndex, 20), str(body.sectionTitle, 200), JSON.stringify(boxes),
      str(body.pageUrl, 500), comment, me.id, str(me.name, 120), str(me.team, 40)],
  );
  return (await listChangeRequests(me)).items.find((r) => r.id === rows[0].id);
}

/** Approve, reject, reopen or mark done (super admin). */
export async function decideChangeRequest(me, id, status) {
  requireSuper(me);
  if (!UUID.test(String(id))) throw new HttpError(400, "Unknown request.");
  if (!["open", "approved", "rejected", "done"].includes(status)) throw new HttpError(400, "Unknown status.");
  const { rows } = await query(
    `UPDATE change_requests SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1 RETURNING id`, [id, status, me.id],
  );
  if (!rows.length) throw new HttpError(404, "Request not found.");
  return (await listChangeRequests(me)).items.find((r) => r.id === id);
}

/** Remove a request: its author while it is open, or a super admin. */
export async function deleteChangeRequest(me, id) {
  if (!UUID.test(String(id))) throw new HttpError(400, "Unknown request.");
  const { rows } = await query("SELECT requested_by, status FROM change_requests WHERE id = $1", [id]);
  if (!rows.length) throw new HttpError(404, "Request not found.");
  const own = rows[0].requested_by === me.id && rows[0].status === "open";
  if (!own && !me.super_admin) throw new HttpError(403, "Only the person who raised it (while open) or a super admin can remove it.");
  await query("DELETE FROM change_requests WHERE id = $1", [id]);
  return { ok: true };
}

/**
 * The approved requests as one Markdown prompt. mark: stamp them exported with a batch id. meta:
 * { site, version, zone, branch }. Returns { markdown, batch, count }.
 */
export async function exportChangeRequests(me, { mark = true, meta = {} } = {}) {
  requireSuper(me);
  const { rows } = await query(`SELECT ${COLS} ${FROM} WHERE r.status = 'approved' ORDER BY r.created_at`);
  if (!rows.length) throw new HttpError(400, "No approved requests to export: approve them first on Change requests.");
  const now = new Date();
  const batch = now.toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
  const markdown = changeRequestPrompt(rows, { ...meta, batch, exportedAt: now.toISOString() });
  if (mark) {
    await query("UPDATE change_requests SET status = 'exported', exported_at = $2, export_batch = $3 WHERE id = ANY($1::uuid[])", [rows.map((r) => r.id), now.toISOString(), batch]);
  }
  return { markdown, batch, count: rows.length };
}
