// Evidence on every input (E-01, E-02). Server-only.
//
// Anyone on the tender team attaches evidence to any input box of any tab: a file (stored like the
// assignments' files, lib/files.js), a link or a note, with the box's value at the time. A super
// admin signs off a box's value; the sign-off keeps that value, so a later change of the box shows
// as signed off at an older value. Boxes are named by the key team mode gives them (data-testid,
// else section and label: src/team/mentions.js threadKey).
import { query } from "./db";
import { HttpError } from "./auth";
import { saveUpload } from "./files";
import { ALL_TAB_IDS } from "./tabs";
import { registerCsv } from "../src/evidence/register.js";

export const KINDS = ["file", "link", "note"];
const str = (v, max) => String(v ?? "").slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLS = `e.id, e.field_key, e.tab, e.field_label, e.place, e.kind, e.file_id, e.url, e.note, e.value_at, e.uploaded_by, e.created_at,
  f.name AS file_name, f.size_bytes AS file_size, m.name AS by_name,
  s.value_at AS signed_value_at, s.signed_at, s.signed_by, sm.name AS signed_by_name`;
const FROM = `FROM evidence e LEFT JOIN team_files f ON f.id = e.file_id LEFT JOIN team_members m ON m.id = e.uploaded_by
  LEFT JOIN field_signoff s ON s.tab = e.tab AND s.field_key = e.field_key LEFT JOIN team_members sm ON sm.id = s.signed_by`;

function checkKey(key, tab) {
  const k = str(key, 200);
  if (!/^[a-zA-Z]+:[\w.:~-]{1,190}$/.test(k)) throw new HttpError(400, "Unknown field.");
  if (!ALL_TAB_IDS.includes(tab) || !k.startsWith(`${tab}:`)) throw new HttpError(400, "Unknown tab.");
  return k;
}
function checkTab(tab) {
  if (!ALL_TAB_IDS.includes(tab)) throw new HttpError(400, "Unknown tab.");
  return tab;
}
function checkUrl(url) {
  const u = str(url, 2000).trim();
  let parsed;
  try { parsed = new URL(u); } catch { throw new HttpError(400, "Give a full link, starting with http:// or https://."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new HttpError(400, "Links must start with http:// or https://.");
  return u;
}

/**
 * Attach evidence to a box: { fieldKey, tab, fieldLabel, place, kind, file | url | note, valueAt }.
 * file is a File from formData (saved with the same type and size checks as the team's uploads).
 */
export async function addEvidence(me, { fieldKey, tab, fieldLabel, place, kind, file = null, url = null, note = null, valueAt = "" }) {
  const t = str(tab, 40);
  const key = checkKey(fieldKey, t);
  if (!KINDS.includes(kind)) throw new HttpError(400, "Evidence is a file, a link or a note.");
  const label = str(fieldLabel, 200).trim() || "A field";
  let fileId = null;
  let link = null;
  let text = null;
  if (kind === "file") {
    if (!file || typeof file !== "object" || !file.size) throw new HttpError(400, "Choose a file.");
    fileId = (await saveUpload(file, me.id)).id;
  } else if (kind === "link") {
    link = checkUrl(url);
  } else {
    text = str(note, 4000).trim();
    if (!text) throw new HttpError(400, "Write the note.");
  }
  const { rows } = await query(
    `INSERT INTO evidence (field_key, tab, field_label, place, kind, file_id, url, note, value_at, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [key, t, label, str(place, 300), kind, fileId, link, text, str(valueAt, 500), me.id],
  );
  return getEvidence(me, rows[0].id);
}

const shape = (me) => (r) => ({ ...r, mine: r.uploaded_by === me.id, canDelete: Boolean(me.super_admin) || r.uploaded_by === me.id });

async function getEvidence(me, id) {
  const { rows } = await query(`SELECT ${COLS} ${FROM} WHERE e.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Evidence not found.");
  return shape(me)(rows[0]);
}

/**
 * A tab's evidence: every item (oldest first), the sign-off of each box, and per box the count
 * and the sign-off: { items, signoffs: { key: {...} }, counts: { key: { items, signoff } } }.
 */
export async function listEvidence(me, tab) {
  const t = checkTab(str(tab, 40));
  const [ev, so] = await Promise.all([
    query(`SELECT ${COLS} ${FROM} WHERE e.tab = $1 ORDER BY e.created_at LIMIT 2000`, [t]),
    query(`SELECT s.tab, s.field_key, s.field_label, s.value_at, s.signed_at, s.signed_by, m.name AS signed_by_name
             FROM field_signoff s LEFT JOIN team_members m ON m.id = s.signed_by WHERE s.tab = $1`, [t]),
  ]);
  const items = ev.rows.map(shape(me));
  const signoffs = Object.fromEntries(so.rows.map((r) => [r.field_key, r]));
  const counts = {};
  for (const it of items) counts[it.field_key] = { items: (counts[it.field_key]?.items || 0) + 1, signoff: signoffs[it.field_key] || null };
  for (const [k, s] of Object.entries(signoffs)) if (!counts[k]) counts[k] = { items: 0, signoff: s };
  return { items, signoffs, counts };
}

/** Delete an item: its owner, or a super admin. The file row stays (another item may share it). */
export async function deleteEvidence(me, id) {
  if (!UUID.test(String(id))) throw new HttpError(404, "Evidence not found.");
  const { rows } = await query("SELECT uploaded_by FROM evidence WHERE id = $1", [id]);
  if (!rows[0]) throw new HttpError(404, "Evidence not found.");
  if (!me.super_admin && rows[0].uploaded_by !== me.id) throw new HttpError(403, "Only who attached it, or a super admin, can remove evidence.");
  await query("DELETE FROM evidence WHERE id = $1", [id]);
  return { ok: true };
}

/** Sign off a box's value ({ signed: true }, keeps the value) or clear it ({ signed: false }). Super admin only. */
export async function signOff(me, { tab, fieldKey, fieldLabel = "", valueAt = "", signed = true }) {
  if (!me.super_admin) throw new HttpError(403, "Only a super admin signs off a value.");
  const t = str(tab, 40);
  const key = checkKey(fieldKey, t);
  if (!signed) {
    await query("DELETE FROM field_signoff WHERE tab = $1 AND field_key = $2", [t, key]);
    return { signoff: null };
  }
  const { rows } = await query(
    `INSERT INTO field_signoff (tab, field_key, field_label, signed_by, signed_at, value_at) VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (tab, field_key) DO UPDATE SET field_label = EXCLUDED.field_label, signed_by = EXCLUDED.signed_by, signed_at = now(), value_at = EXCLUDED.value_at
     RETURNING tab, field_key, field_label, value_at, signed_at, signed_by`,
    [t, key, str(fieldLabel, 200).trim(), me.id, str(valueAt, 500)],
  );
  return { signoff: { ...rows[0], signed_by_name: me.name } };
}

/** The evidence register of a tab (or of every tab) as CSV. */
export async function registerCsvFor(tab = null) {
  const t = tab ? checkTab(str(tab, 40)) : null;
  const { rows } = await query(
    `SELECT ${COLS} ${FROM} ${t ? "WHERE e.tab = $1" : ""} ORDER BY e.tab, e.place, e.field_label, e.created_at LIMIT 10000`,
    t ? [t] : [],
  );
  return registerCsv(rows);
}
