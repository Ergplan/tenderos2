// API keys entered in the application (Administration › API keys), stored encrypted in
// app_secrets and read by the server only. A key set here wins over the same variable in .env;
// a key in .env is used when none is stored. Server-only.
//
// Encryption: AES-256-GCM under sha256("tenderos-secrets:" + SESSION_SECRET), a fresh 12-byte
// nonce per write; the stored text is base64(nonce | tag | ciphertext). Changing SESSION_SECRET
// makes the stored keys unreadable (the screen then says so and asks for them again).
import { query } from "./db.js";
import { API_KEYS, cleanKey, decrypt, encrypt, hintOf, keyDef } from "./secretCodec.js";

export { API_KEYS, cleanKey, decrypt, encrypt, hintOf, keyDef };

/** The value to use: the one stored in the application, else the server's environment, else "". */
export async function getSecret(name) {
  if (!keyDef(name)) return "";
  try {
    const { rows } = await query("SELECT ciphertext FROM app_secrets WHERE name = $1", [name]);
    if (rows[0]) {
      const v = decrypt(rows[0].ciphertext);
      if (v) return v;
    }
  } catch {
    // no table yet (first start before the migration): the environment still works
  }
  return (process.env[name] || "").trim();
}

/** The keys the application holds, without their values: { name, label, what, set, source, hint, updatedAt, updatedBy, unreadable }. */
export async function secretStatus() {
  const { rows } = await query("SELECT name, ciphertext, hint, updated_at, updated_by FROM app_secrets");
  const stored = Object.fromEntries(rows.map((r) => [r.name, r]));
  return API_KEYS.map((k) => {
    const row = stored[k.name];
    const inEnv = Boolean((process.env[k.name] || "").trim());
    const readable = row ? decrypt(row.ciphertext) !== null : false;
    const source = row && readable ? "app" : inEnv ? "env" : "none";
    return {
      name: k.name, label: k.label, what: k.what, usedBy: k.usedBy, canCheck: Boolean(k.check),
      set: source !== "none", source, hint: source === "app" ? row.hint : source === "env" ? hintOf(process.env[k.name].trim()) : "",
      updatedAt: row ? row.updated_at : null, updatedBy: row ? row.updated_by : "", unreadable: Boolean(row) && !readable,
    };
  });
}

export async function setSecret(name, value, who = "") {
  if (!keyDef(name)) throw new Error(`Unknown key ${name}`);
  await query(
    "INSERT INTO app_secrets (name, ciphertext, hint, updated_at, updated_by) VALUES ($1, $2, $3, now(), $4) ON CONFLICT (name) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, hint = EXCLUDED.hint, updated_at = now(), updated_by = EXCLUDED.updated_by",
    [name, encrypt(value), hintOf(value), String(who || "").slice(0, 200)],
  );
}

export async function clearSecret(name) {
  await query("DELETE FROM app_secrets WHERE name = $1", [name]);
}

/**
 * Ask the provider whether the key works (a request that lists its models; nothing is generated).
 * Returns { ok: true } | { ok: false, reason } | { ok: null, reason } when the provider could not be
 * reached (the key is then saved with a warning).
 */
export async function checkSecret(name, value) {
  const def = keyDef(name);
  if (!def?.check) return { ok: null, reason: "" };
  const url = def.check === "anthropic"
    ? `${(process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "")}/v1/models?limit=1`
    : `${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")}/models`;
  const headers = def.check === "anthropic" ? { "x-api-key": value, "anthropic-version": "2023-06-01" } : { authorization: `Bearer ${value}` };
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  } catch (err) {
    return { ok: null, reason: `${def.label} could not be reached from this server (${err.name === "TimeoutError" ? "timed out" : err.message}).` };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: `${def.label} refused the key (HTTP ${res.status}): check it and try again.` };
  return { ok: null, reason: `${def.label} answered HTTP ${res.status}; the key was saved unchecked.` };
}

// the engine keys and the header each rides on (engine/extraction/keys.py HEADERS)
const ENGINE_KEYS = [["ANTHROPIC_API_KEY", "x-tenderos-key-anthropic"], ["LLAMA_CLOUD_API_KEY", "x-tenderos-key-llama"]];

/**
 * Headers for a call from the web app to the engine: the keys entered under Administration ›
 * API keys (or in the environment), plus the marker that tells the engine's middleware this
 * call speaks for the application (a call without the marker, such as the health probe, leaves
 * the engine's keys as they are; a call with it and without a key clears that key).
 */
export async function engineKeyHeaders() {
  const headers = { "x-tenderos-keys": "web" };
  for (const [name, header] of ENGINE_KEYS) {
    const value = await getSecret(name);
    if (value) headers[header] = value;
  }
  return headers;
}
