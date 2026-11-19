import crypto from "node:crypto";
import { query } from "@/lib/db";
import { handler, hashPassword, HttpError, requireUser, validatePassword } from "@/lib/auth";
import { DEMO_MODE } from "@/lib/demo";
import { cleanTabList } from "@/lib/tabs";
import { generatePassword, licenceEnd, USER_COLS } from "@/lib/workspace";
import { logEvent } from "@/lib/activity";

export const GET = handler(async () => {
  await requireUser({ admin: true });
  const { rows } = await query(`SELECT ${USER_COLS} FROM users ORDER BY created_at`);
  return Response.json({ users: rows });
});

/**
 * A new account (a client's demo licence, or one of the team): { email, name, org, internal, role,
 * tabAccess, days | expiresAt, note, password? }. Without a password one is generated; it is
 * returned once, here, to hand over, and only its hash is kept.
 */
export const POST = handler(async (req) => {
  if (DEMO_MODE) throw new HttpError(403, "Accounts cannot be added in demo mode.");
  const me = await requireUser({ admin: true });
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new HttpError(400, "Enter a valid email.");
  const role = body.role || "user";
  if (!["admin", "user"].includes(role)) throw new HttpError(400, "Invalid role.");
  const org = String(body.org || "").trim().slice(0, 120);
  // a client's account needs its own workspace; only one of the operator's team shares the team's
  if (role === "user" && !org && !body.internal) throw new HttpError(400, "Enter the client's company: its workspace keeps its bids apart from everyone else's.");
  const tabs = body.tabAccess === undefined || body.tabAccess === null ? null : cleanTabList(body.tabAccess);
  if (body.tabAccess !== undefined && body.tabAccess !== null && !tabs?.length) throw new HttpError(400, "Choose at least one tab.");
  const password = body.password ? String(body.password) : generatePassword(crypto.randomInt);
  const bad = validatePassword(password);
  if (bad) throw new HttpError(400, bad);
  const expiresAt = licenceEnd(body) ?? null;
  try {
    const { rows } = await query(
      `INSERT INTO users (email, name, password_hash, role, org, tab_access, expires_at, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${USER_COLS}`,
      [email, String(body.name || "").trim().slice(0, 120), await hashPassword(password), role, role === "admin" ? "" : org,
        tabs ? JSON.stringify(tabs) : null, expiresAt, String(body.note || "").slice(0, 500), me.id],
    );
    await logEvent({ user: me, kind: "licence_given", detail: { email, org, tabs, expiresAt, role }, req });
    return Response.json({ user: rows[0], password }, { status: 201 });
  } catch (err) {
    if (err.code === "23505") throw new HttpError(409, "A user with that email already exists.");
    throw err;
  }
});
