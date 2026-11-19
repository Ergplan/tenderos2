// Workspaces and licences (docs/LICENCES.md). Server-only.
//
// Who sees what: an administrator sees everything. Every other user sees what people of their own
// workspace (users.org) made, plus built-in content (rows with a seed_key). The operator's own team
// has org '' and shares one workspace, as before; a client licence carries its company as org, so
// a client never sees another client's or the operator's saved bids, tender readings or profiles.
// Client users are not on the tender team (team panel, messages, feedback), which spans the
// installation.
import { HttpError } from "./httpError.js";

export const orgOf = (user) => String(user?.org || "").trim();
export const isAdmin = (user) => user?.role === "admin";
/** A client's licence: not an administrator, and a workspace of its own. */
export const isClient = (user) => Boolean(user) && !isAdmin(user) && orgOf(user) !== "";

/**
 * SQL condition: a row made by the user joined as `alias` (the users table) is visible to the
 * viewer. Pushes its parameter onto vals. seedCol: the row's seed_key column, visible to all when set.
 */
export function visibleTo(viewer, alias, vals, seedCol = null) {
  if (!viewer) throw new HttpError(401, "Sign in required.");
  if (isAdmin(viewer)) return "TRUE";
  vals.push(orgOf(viewer));
  const own = `coalesce(${alias}.org, '') = $${vals.length}`;
  return seedCol ? `(${seedCol} IS NOT NULL OR ${own})` : own;
}

/** Why a licence no longer signs in, or null when it does. */
export function licenceProblem(user, now = new Date()) {
  if (!user) return "Sign in required.";
  if (user.disabled) return "This account is switched off.";
  if (user.expires_at && new Date(user.expires_at) <= now) {
    const day = new Date(user.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
    return `This demo licence ended on ${day}.`;
  }
  return null;
}

/** The columns of an account the administration screen shows. */
export const USER_COLS = "id, email, name, role, tab_access, org, expires_at, disabled, note, created_at, last_login_at";

/** The licence's end from { days: n } or { expiresAt: date | null }; undefined when neither is given. */
export function licenceEnd(body) {
  if (body.days !== undefined && body.days !== null) {
    const d = Number(body.days);
    if (!(d > 0 && d <= 3650)) throw new HttpError(400, "Days must be between 1 and 3650.");
    return new Date(Date.now() + d * 86400000).toISOString();
  }
  if (body.expiresAt === null) return null;
  if (body.expiresAt !== undefined) {
    const t = new Date(body.expiresAt);
    if (Number.isNaN(t.getTime())) throw new HttpError(400, "Give the licence's end as a date.");
    return t.toISOString();
  }
  return undefined;
}

/** A password to hand over: four groups of five letters and digits (no 0/O, 1/l/I), about 114 bits. */
export function generatePassword(randomInt) {
  const alpha = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const group = () => Array.from({ length: 5 }, () => alpha[randomInt(alpha.length)]).join("");
  return [group(), group(), group(), group()].join("-");
}
