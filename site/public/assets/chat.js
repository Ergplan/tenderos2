// The chat box in the corner of the site: a visitor asks a question or leaves a note, and what
// they write is saved for the jouleWise team (POST /api/chat, src/api/chat.js). Common questions
// get an automatic answer taken from the page's own FAQ, marked as automatic; there is no language
// model here and nobody is pretending to be a person. The conversation is kept in this tab
// (sessionStorage) so a reload does not lose it, and the whole of it is sent on every message,
// so a save that failed is made good by the next one.
(() => {
  "use strict";
  const root = document.getElementById("chat"), opener = document.getElementById("chat-open"), dataEl = document.getElementById("chat-data");
  if (!root || !opener || !dataEl) return;
  const DATA = JSON.parse(dataEl.textContent);
  const $ = (s) => root.querySelector(s);
  const log = $(".chat-log"), chips = $(".chat-chips"), form = $(".chat-form"), box = $(".chat-form textarea"), trap = $(".chat-form .hp"), who = $(".chat-who"), status = $(".chat-status");
  const track = (name, data, once) => window.TOSTrack?.(name, data, once);
  const KEY = "tos-chat";
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const keep = () => { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* this page view only */ } };
  let S = null;
  try { S = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { S = null; }
  if (!S || !S.id || !Array.isArray(S.lines)) S = { id: hex(16), started: Date.now(), lines: [], contact: {}, asked: false };

  const bubble = (l) => {
    const d = document.createElement("div");
    d.className = `chat-line ${l.by}`;
    if (l.by === "helper") { const t = document.createElement("small"); t.textContent = "Automatic reply"; d.appendChild(t); }
    const p = document.createElement("p"); p.textContent = l.text; d.appendChild(p);
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  };
  const say = (by, text) => { const l = { by, text, at: Date.now() }; S.lines.push(l); keep(); bubble(l); };
  const setStatus = (text, bad) => { status.textContent = text; status.classList.toggle("bad", Boolean(bad)); };

  // every message the visitor has written, their contact details and their label, in one request
  async function save() {
    setStatus("Saving…");
    const body = { id: S.id, started: S.started, ref: window.TOSTrack?.ref?.() || "", page: window.location.pathname, contact: S.contact, website: trap.value,
      messages: S.lines.filter((l) => l.by === "you").map((l) => ({ at: l.at, text: l.text })) };
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || r.status);
      setStatus("Saved for the jouleWise team.");
      return true;
    } catch (e) {
      setStatus(`Not saved: the message did not reach us. Send again, or call ${DATA.phone}.`, true);
      return false;
    }
  }

  const topicFor = (text) => {
    const t = ` ${text.toLowerCase()} `;
    let best = null, score = 0;
    for (const topic of DATA.topics) { const s = topic.keys.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0); if (s > score) { best = topic; score = s; } }
    return best;
  };
  const hasContact = () => Boolean(S.contact.reach);
  let busy = false;
  async function send(text, viaChip) {
    const said = text.trim();
    if (!said || busy) return;
    busy = true;
    say("you", said);
    box.value = "";
    track("Chat", { step: viaChip ? "asked a suggested question" : "wrote a message" });
    const ok = await save();
    // a long message is a note for the team, not a question the FAQ answers
    const topic = viaChip || said.length <= 90 ? topicFor(said) : null;
    if (topic) say("helper", topic.a);
    if (ok && !topic) say("helper", hasContact() ? DATA.noted : DATA.notedAsk);
    else if (ok && topic && !hasContact() && !S.asked) say("helper", DATA.ask);
    if (ok && !hasContact()) { S.asked = true; keep(); who.hidden = false; }
    busy = false;
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); send(box.value, false); });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(box.value, false); } });
  DATA.topics.filter((t) => t.chip).forEach((t) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = t.chip;
    b.addEventListener("click", () => send(t.chip, true));
    chips.appendChild(b);
  });
  who.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(who);
    S.contact = { name: String(f.get("name") || "").trim(), company: String(f.get("company") || "").trim(), reach: String(f.get("reach") || "").trim() };
    if (!S.contact.reach) return;
    keep();
    track("Chat", { step: "left contact details" }, true);
    if (await save()) { who.hidden = true; say("helper", DATA.thanks); }
  });

  const open = (on) => {
    root.hidden = !on; opener.hidden = on; opener.setAttribute("aria-expanded", String(on));
    if (on) { track("Chat", { step: "opened" }, true); log.scrollTop = log.scrollHeight; box.focus({ preventScroll: true }); } else opener.focus({ preventScroll: true });
  };
  opener.addEventListener("click", () => open(true));
  $(".chat-x").addEventListener("click", () => open(false));
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") open(false); });

  bubble({ by: "helper", text: DATA.hello });
  S.lines.forEach(bubble);
  if (S.asked && !hasContact()) who.hidden = false;
})();
