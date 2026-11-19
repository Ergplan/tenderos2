// Checks the demo-licence rules (web/lib/workspace.js, docs/LICENCES.md): who is a client, which
// rows a viewer may see (the SQL condition and its parameter), a licence that is switched off or
// has ended, the licence's end from days or a date, the generated password, the migration that
// creates the licensing administrator, and the credentials text handed to a client.
// Run: node tools/check_licences.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { generatePassword, isAdmin, isClient, licenceEnd, licenceProblem, orgOf, visibleTo } from "../web/lib/workspace.js";

const admin = { id: "a", role: "admin", org: "" };
const team = { id: "t", role: "user", org: "" };
const client = { id: "c", role: "user", org: " Acme Renewables " };

// ---- who is who
assert.equal(isAdmin(admin), true);
assert.equal(isClient(admin), false, "an administrator is never a client");
assert.equal(isClient(team), false, "our own team (no workspace) is not a client");
assert.equal(isClient(client), true);
assert.equal(orgOf(client), "Acme Renewables", "the workspace is trimmed");

// ---- what a viewer sees
{
  const vals = ["x"];
  assert.equal(visibleTo(admin, "u", vals), "TRUE", "an administrator sees every workspace");
  assert.deepEqual(vals, ["x"], "and adds no parameter");
  const v2 = ["id"];
  assert.equal(visibleTo(client, "u", v2), "coalesce(u.org, '') = $2");
  assert.deepEqual(v2, ["id", "Acme Renewables"]);
  const v3 = [];
  assert.equal(visibleTo(team, "cu", v3, "p.seed_key"), "(p.seed_key IS NOT NULL OR coalesce(cu.org, '') = $1)", "built-in rows are seen by all");
  assert.deepEqual(v3, [""], "our team's workspace is ''");
  assert.throws(() => visibleTo(null, "u", []), /Sign in/);
}

// ---- licences that stop
const now = new Date("2026-11-19T12:00:00Z");
assert.equal(licenceProblem({ disabled: false, expires_at: null }, now), null, "no end date: signs in");
assert.equal(licenceProblem({ disabled: false, expires_at: "2026-12-01T00:00:00Z" }, now), null, "before its end: signs in");
assert.match(licenceProblem({ disabled: true, expires_at: null }, now), /switched off/);
assert.match(licenceProblem({ disabled: false, expires_at: "2026-11-18T18:29:59Z" }, now), /ended on 18 November 2026/, "ended: says when (India time)");
assert.match(licenceProblem({ disabled: false, expires_at: now.toISOString() }, now), /ended/, "its last moment counts as ended");

// ---- the licence's end
{
  const t0 = Date.now();
  const d30 = new Date(licenceEnd({ days: 30 })).getTime();
  assert.ok(Math.abs(d30 - (t0 + 30 * 86400000)) < 5000, "30 days from now");
  assert.equal(licenceEnd({ expiresAt: null }), null, "no end");
  assert.equal(licenceEnd({ expiresAt: "2027-01-31T23:59:59+05:30" }), "2027-01-31T18:29:59.000Z");
  assert.equal(licenceEnd({}), undefined, "not given: unchanged");
  assert.throws(() => licenceEnd({ days: 0 }), /between 1 and 3650/);
  assert.throws(() => licenceEnd({ expiresAt: "soon" }), /as a date/);
}

// ---- generated passwords
{
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const p = generatePassword(crypto.randomInt);
    assert.match(p, /^[a-km-zA-HJ-NP-Z2-9]{5}(-[a-km-zA-HJ-NP-Z2-9]{5}){3}$/, p);
    assert.ok(!/[01oOlI]/.test(p), "no look-alike characters");
    seen.add(p);
  }
  assert.equal(seen.size, 200, "no repeats");
}

// ---- the migration: the columns, and the administrator by hash only
{
  const sql = readFileSync(new URL("../web/db/migrations/021_licences.sql", import.meta.url), "utf8");
  for (const col of ["org text NOT NULL DEFAULT ''", "expires_at timestamptz", "disabled boolean NOT NULL DEFAULT false", "note text", "created_by uuid"]) assert.ok(sql.includes(col), col);
  const m = sql.match(/VALUES \('ergcon@joulewise\.com', 'Ergcon', '(scrypt\$[^$']+\$[^$']+)', 'admin'\)/);
  assert.ok(m, "the licensing administrator, as an administrator");
  assert.ok(/ON CONFLICT \(email\) DO NOTHING/.test(sql), "an existing account is left as it is");
  const [, salt, hash] = m[1].split("$");
  assert.equal(Buffer.from(salt, "base64").length, 16);
  assert.equal(Buffer.from(hash, "base64").length, 64, "a scrypt hash, not a password");
}

// ---- the credentials text (components/UserAdmin.jsx), without React
{
  const src = readFileSync(new URL("../web/components/UserAdmin.jsx", import.meta.url), "utf8");
  for (const line of ["Sign in at: ${origin}/login", "Email: ${user.email}", "Password: ${password}", "Tabs: ${tabs}", "Valid until:"]) assert.ok(src.includes(line), line);
}
console.log("Licence checks passed: workspaces, licence ends, generated passwords, the administrator's migration");
