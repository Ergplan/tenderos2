import crypto from "node:crypto";
import { query } from "@/lib/db";
import { handler, hashPassword, HttpError, requireUser, validatePassword } from "@/lib/auth";
import { DEMO_MODE } from "@/lib/demo";
import { cleanTabList } from "@/lib/tabs";
import { generatePassword, licenceEnd, USER_COLS } from "@/lib/workspace";
import { logEvent } from "@/lib/activity";

// Admins can change anyone's name, role, password, tabs, workspace and licence (its end, on or
// off, the note); users can change their own name and password. { resetPassword: true } (admins)
// generates a new password and returns it once, to hand over.
export const PATCH = handler(async (req, { params }) => {
  if (DEMO_MODE) throw new HttpError(403, "Accounts cannot be changed in demo mode.");
  const me = await requireUser();
  const { id } = await params;
  const isSelf = me.id === id;
  if (!isSelf && me.role !== "admin") throw new HttpError(403, "Administrator access required.");
  const body = await req.json().catch(() => ({}));
  const { name, role, tabAccess, org, disabled, note, resetPassword } = body;
  let { password } = body;
  const licenceKeys = ["org", "disabled", "note", "resetPassword", "days", "expiresAt"].filter((k) => body[k] !== undefined);
  if (licenceKeys.length && me.role !== "admin") throw new HttpError(403, "Only administrators can change a licence.");
  if (resetPassword) password = generatePassword(crypto.randomInt);
  const sets = [];
  const vals = [];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (name !== undefined) set("name", String(name).trim());
  if (role !== undefined) {
    if (me.role !== "admin") throw new HttpError(403, "Only administrators can change roles.");
    if (!["admin", "user"].includes(role)) throw new HttpError(400, "Invalid role.");
    if (isSelf && role !== "admin") throw new HttpError(400, "You cannot remove your own administrator role.");
    set("role", role);
  }
  if (tabAccess !== undefined) {
    // null = follow the deployment default; a list = exactly these tabs
    if (me.role !== "admin") throw new HttpError(403, "Only administrators can change tab access.");
    const clean = tabAccess === null ? null : cleanTabList(tabAccess);
    if (tabAccess !== null && !clean) throw new HttpError(400, "tabAccess must be a list of tab ids or null.");
    set("tab_access", clean === null ? null : JSON.stringify(clean));
  }
  if (org !== undefined) set("org", String(org).trim().slice(0, 120));
  if (note !== undefined) set("note", String(note).slice(0, 500));
  const end = licenceEnd(body);
  if (end !== undefined) {
    if (isSelf) throw new HttpError(400, "Your own account has no licence end.");
    set("expires_at", end);
  }
  if (disabled !== undefined) {
    if (isSelf) throw new HttpError(400, "You cannot switch off your own account.");
    set("disabled", Boolean(disabled));
    // switching off signs the user out at once
    if (disabled) sets.push("session_epoch = session_epoch + 1");
  }
  if (password !== undefined) {
    const bad = validatePassword(password);
    if (bad) throw new HttpError(400, bad);
    set("password_hash", await hashPassword(password));
    // signs out other sessions of this user (the current cookie is re-issued on next login)
    if (!isSelf) sets.push("session_epoch = session_epoch + 1");
  }
  if (!sets.length) throw new HttpError(400, "Nothing to update.");
  vals.push(id);
  const { rows } = await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING ${USER_COLS}`, vals);
  if (!rows[0]) throw new HttpError(404, "User not found.");
  if (me.role === "admin" && !isSelf) await logEvent({ user: me, kind: "licence_changed", detail: { email: rows[0].email, changed: Object.keys(body).filter((k) => k !== "password") }, req });
  return Response.json({ user: rows[0], ...(resetPassword ? { password } : {}) });
});

export const DELETE = handler(async (_req, { params }) => {
  const me = await requireUser({ admin: true });
  const { id } = await params;
  if (me.id === id) throw new HttpError(400, "You cannot delete your own account.");
  const { rowCount } = await query("DELETE FROM users WHERE id = $1", [id]);
  if (!rowCount) throw new HttpError(404, "User not found.");
  return Response.json({ ok: true });
});
