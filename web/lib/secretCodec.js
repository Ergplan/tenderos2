// The API-key store's pure parts (web/lib/secrets.js holds the database side): the catalogue of
// keys the application can hold, AES-256-GCM encryption under a key derived from SESSION_SECRET,
// the hint the screen may show. No database, so tools/check_secrets.mjs can import it.
import crypto from "node:crypto";

/** The keys the application can hold, in the order the screen shows them. */
export const API_KEYS = [
  { name: "ANTHROPIC_API_KEY", label: "Anthropic", what: "Reads tender documents with the model (Tender to Bid, BESS Tender, the CERC order reader). Without it the engine reads tenders with the rule-based reader.", usedBy: "engine", prefix: "sk-ant-", check: "anthropic", zone: "intake" },
  { name: "OPENAI_API_KEY", label: "OpenAI", what: "The SECI RTC tab's voice bid agent (GPT-Live). Without it the tab offers only the browser-voice guide.", usedBy: "web", prefix: "sk-", check: "openai", zone: "intake" },
  { name: "LLAMA_CLOUD_API_KEY", label: "LlamaParse (LlamaIndex cloud)", what: "Reads scanned pages that have no text layer when a tender set is read. Optional.", usedBy: "engine", prefix: "llx-", check: null, zone: "intake" },
];
const BY_NAME = Object.fromEntries(API_KEYS.map((k) => [k.name, k]));

export function keyDef(name) {
  return BY_NAME[name] || null;
}

function cipherKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return crypto.createHash("sha256").update(`tenderos-secrets:${secret}`).digest();
}

export function encrypt(value) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cipherKey(), nonce);
  const body = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64");
}

/** The plain value, or null when the text was written under another SESSION_SECRET. */
export function decrypt(text) {
  try {
    const raw = Buffer.from(String(text), "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", cipherKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** What the screen may show of a key: its last four characters. */
export function hintOf(value) {
  const v = String(value || "");
  return v.length >= 8 ? `…${v.slice(-4)}` : "";
}

/** A key as typed: trimmed, one line, 16 to 400 characters, no spaces. */
export function cleanKey(value) {
  const v = String(value || "").trim();
  if (v.length < 16 || v.length > 400 || /\s/.test(v)) return null;
  return v;
}
