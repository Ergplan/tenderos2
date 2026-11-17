// POST /api/chat: keeps what a visitor wrote in the site's chat box.
//
// The chat box (src/chat.js) sends the whole conversation each time the visitor writes: an id made
// in their browser, their messages, the contact details they chose to leave, and their personal
// link's label if they came through one. It is written as one readable text file per conversation
// to a private Vercel Blob store, chat/<date>/<label or visitor>-<id>.txt, replaced on every
// message. Nothing else is kept: no address of the visitor's machine, only the country.
//
// Each time a conversation is saved the sales team is told by email, sent through Resend
// (resend.com) when the project has a RESEND_API_KEY: the latest message first, then the whole
// conversation, with the visitor's own address as the reply-to if they left one. CHAT_ALERT_TO
// (one address or several, comma-separated) and CHAT_ALERT_FROM override who it goes to and
// from. A mail that fails never fails the save: the visitor's message is already kept.
//
// record() and alertMail() are the parts with no storage or network in them, so the tests run
// them as they are.

const MAX_MESSAGES = 30, MAX_TEXT = 1500, MAX_FIELD = 160, MAX_BODY = 60000, DAY = 864e5;
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, n);
const label = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 48);
const india = (ms, opts) => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });

export function record(body, meta = {}, now = Date.now()) {
  if (!body || typeof body !== "object") return { error: "no body" };
  if (body.website) return { spam: true }; // a field no person sees or fills
  const id = String(body.id || "");
  if (!/^[a-f0-9]{24,40}$/.test(id)) return { error: "bad id" };
  const near = (t) => (Math.abs(Number(t) - now) < 2 * DAY ? Number(t) : now);
  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(0, MAX_MESSAGES)
    .map((m) => ({ at: near(m?.at), text: clean(m?.text, MAX_TEXT) })).filter((m) => m.text);
  if (!messages.length) return { error: "no message" };
  const started = near(body.started), who = label(body.ref), c = body.contact || {};
  const row = (k, v) => (v ? `${k.padEnd(10)}${v}\n` : "");
  const text = "TenderOS site: a visitor's message\n\n"
    + row("Started", `${india(started, { dateStyle: "medium", timeStyle: "short" })} IST`)
    + row("Label", who ? `${who} (came through a personal link)` : "none (an anonymous visitor)")
    + row("Name", clean(c.name, MAX_FIELD)) + row("Company", clean(c.company, MAX_FIELD)) + row("Reach at", clean(c.reach, MAX_FIELD))
    + row("Page", clean(body.page, MAX_FIELD)) + row("Country", clean(meta.country, 8))
    + row("Messages", String(messages.length))
    + "\n" + messages.map((m) => `[${india(m.at, { timeStyle: "short" })}] ${m.text}`).join("\n\n") + "\n";
  // the date in India of the first message, so a day's conversations sit together
  const day = new Date(started + 5.5 * 3600e3).toISOString().slice(0, 10);
  return { path: `chat/${day}/${who || "visitor"}-${id.slice(0, 16)}.txt`, text, messages: messages.length,
    id, who, name: clean(c.name, MAX_FIELD), company: clean(c.company, MAX_FIELD), reach: clean(c.reach, MAX_FIELD), latest: messages[messages.length - 1].text };
}

// the alert for one saved conversation, as Resend's API takes it. The subject stays the same for
// the whole conversation, and every mail refers to the same made-up first message, so a mail
// program shows the conversation as one thread.
export function alertMail(rec, env = {}) {
  const to = String(env.CHAT_ALERT_TO || "sales@joulewise.com").split(",").map((s) => s.trim()).filter(Boolean);
  const from = env.CHAT_ALERT_FROM || "TenderOS site <chat@tenderos.joulewise.tech>";
  const whoLine = [rec.name, rec.company].filter(Boolean).join(", ") || (rec.who ? `personal link ${rec.who}` : "an anonymous visitor");
  const thread = `<chat-${rec.id.slice(0, 16)}@tenderos.joulewise.tech>`;
  const mail = (rec.reach.match(/[^\s<>,;]+@[^\s<>,;]+\.[a-z]{2,}/i) || [])[0];
  return {
    from, to,
    subject: `TenderOS site chat: ${whoLine} (${rec.id.slice(0, 6)})`,
    text: `A visitor wrote in the chat box on tenderos.joulewise.tech.\n\nLatest message (${rec.messages} so far):\n\n    ${rec.latest.replace(/\n/g, "\n    ")}\n\n`
      + `${rec.reach ? `Reply to them at: ${rec.reach}` : "They have not left a phone number or email yet."}\n\n`
      + `---------- the whole conversation ----------\n\n${rec.text}\nAlso kept in Vercel Storage, store tenderos-site-chat, as ${rec.path}\n`,
    headers: { "In-Reply-To": thread, References: thread },
    ...(mail ? { reply_to: mail } : {}),
  };
}

async function alert(rec) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return "off";
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(alertMail(rec, process.env)), signal: AbortSignal.timeout(6000) });
    if (r.ok) return "sent";
    console.error("chat: the alert was not sent:", r.status, (await r.text()).slice(0, 200));
  } catch (e) { console.error("chat: the alert was not sent:", e?.message || e); }
  return "failed";
}

const json = (o, status = 200) => Response.json(o, { status, headers: { "Cache-Control": "no-store" } });

export default {
  async fetch(request) {
    if (request.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
    // from this site's own pages only
    const origin = request.headers.get("origin");
    if (origin) {
      let from = "";
      try { from = new URL(origin).host; } catch (e) { from = ""; }
      if (![request.headers.get("host"), request.headers.get("x-forwarded-host")].includes(from)) return json({ ok: false, error: "another site" }, 403);
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ ok: false, error: "too long" }, 413);
    let body = null;
    try { body = JSON.parse(raw); } catch (e) { return json({ ok: false, error: "not JSON" }, 400); }
    const rec = record(body, { country: request.headers.get("x-vercel-ip-country") || "" });
    if (rec.spam) return json({ ok: true });
    if (rec.error) return json({ ok: false, error: rec.error }, 400);
    try {
      const { put } = await import("@vercel/blob");
      await put(rec.path, rec.text, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "text/plain; charset=utf-8" });
    } catch (e) {
      console.error("chat: the conversation was not saved:", e?.message || e);
      return json({ ok: false, error: "not saved" }, 500);
    }
    return json({ ok: true, messages: rec.messages, alert: await alert(rec) });
  },
};
