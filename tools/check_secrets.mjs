// Checks for the API-key store (web/lib/secretCodec.js): a value encrypts to something that does not
// contain it, decrypts back under the same SESSION_SECRET, is unreadable under another, and the
// screen gets only its last four characters. Run from the repository root:
//   node tools/check_secrets.mjs
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef-check";
const { API_KEYS, cleanKey, decrypt, encrypt, hintOf, keyDef } = await import("../web/lib/secretCodec.js");

const key = "sk-ant-api03-ExampleExampleExampleExample1234";
const stored = encrypt(key);
assert.ok(!stored.includes(key) && !Buffer.from(stored, "base64").toString("latin1").includes("Example"), "the stored text does not carry the key");
assert.notEqual(encrypt(key), stored, "a fresh nonce every write");
assert.equal(decrypt(stored), key, "round trip");
assert.equal(decrypt(stored.slice(0, -6) + "AAAAAA"), null, "a tampered text is refused");
process.env.SESSION_SECRET = "fedcba9876543210fedcba9876543210-other";
assert.equal(decrypt(stored), null, "unreadable under another SESSION_SECRET");
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef-check";

assert.equal(hintOf(key), "…1234", "only the last four characters reach the screen");
assert.equal(hintOf("short"), "");
assert.equal(cleanKey("  sk-proj-abcdefghijklmnop \n"), "sk-proj-abcdefghijklmnop");
assert.equal(cleanKey("sk-proj abcdefghijklmnop"), null, "no spaces inside");
assert.equal(cleanKey("tooshort"), null);
assert.equal(cleanKey("x".repeat(401)), null);
assert.deepEqual(API_KEYS.map((k) => k.name), ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LLAMA_CLOUD_API_KEY"]);
assert.equal(keyDef("OPENAI_API_KEY").check, "openai");
assert.equal(keyDef("SESSION_SECRET"), null, "only the provider keys can be stored");
console.log("Secret store checks passed");
