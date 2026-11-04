import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { actingMember } from "@/lib/team";
import { checkSecret, cleanKey, clearSecret, keyDef, secretStatus, setSecret } from "@/lib/secrets";
import { logEvent } from "@/lib/activity";
import { ZONE } from "@/lib/zone";

export const dynamic = "force-dynamic";

// Administration › API keys: an administrator (or, on a demo, the tender's super admin) enters a
// provider key once; it is stored encrypted and never sent back. GET lists the keys without
// their values; PUT { name, value } checks the key with the provider and stores it; DELETE
// { name } removes it (the server's .env, if it has one, applies again).
async function keeper() {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role === "admin") return user;
  const me = await actingMember(user);
  if (me?.super_admin) return user;
  throw new HttpError(403, "Only an administrator or the tender's super admin can manage API keys.");
}

export const GET = handler(async () => {
  await keeper();
  return Response.json({ keys: await secretStatus(), zone: ZONE, cloud: ZONE !== "core" });
});

export const PUT = handler(async (req) => {
  const user = await keeper();
  if (ZONE === "core") throw new HttpError(403, "The core zone holds no cloud API keys: they belong to the intake zone (docs/enterprise/ARCHITECTURE.md).");
  const body = (await req.json().catch(() => null)) || {};
  const def = keyDef(String(body.name || ""));
  if (!def) throw new HttpError(400, "Unknown key.");
  const value = cleanKey(body.value);
  if (!value) throw new HttpError(400, "Paste the whole key: one line, 16 to 400 characters, no spaces.");
  if (def.prefix && !value.startsWith(def.prefix)) throw new HttpError(400, `A ${def.label} key starts with ${def.prefix}…`);
  const check = body.check === false ? { ok: null, reason: "" } : await checkSecret(def.name, value);
  if (check.ok === false) throw new HttpError(400, check.reason);
  await setSecret(def.name, value, user.name || user.email);
  await logEvent({ user, kind: "api_key", detail: { what: "set", name: def.name, checked: check.ok === true }, req });
  return Response.json({ keys: await secretStatus(), checked: check.ok === true, warning: check.ok === null ? check.reason : "" });
});

export const DELETE = handler(async (req) => {
  const user = await keeper();
  const body = (await req.json().catch(() => null)) || {};
  const def = keyDef(String(body.name || ""));
  if (!def) throw new HttpError(400, "Unknown key.");
  await clearSecret(def.name);
  await logEvent({ user, kind: "api_key", detail: { what: "remove", name: def.name }, req });
  return Response.json({ keys: await secretStatus() });
});
