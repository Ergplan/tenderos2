// Visit analytics for the TenderOS site: Vercel Web Analytics (no cookies) plus personal links.
//
// Every visit is counted by Vercel's script. On top of that this file sends named events (what a
// visitor did: watched the tour, reached a screen, downloaded the deck, tapped the phone number)
// and handles personal links: a link of the form /for/<tag> (or /?ref=<tag>) that the sales team
// gives to one prospect. The tag is kept in this browser for 90 days and attached to every event,
// so a prospect's visits can be told apart from the anonymous ones. Nothing typed into the page
// is ever sent. A visitor can turn all of this off on /privacy.
//
// window.TOSTrack(name, data, once) is what the rest of the site calls; window.TOSTrack.log holds
// what was sent in this page view (the tests read it).
(() => {
  "use strict";
  const REF = "tos-ref", OFF = "tos-notrack", KEEP_DAYS = 90, DAY = 864e5;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: this page view only */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nothing kept */ } },
  };
  const clean = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 48);
  const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return ""; } };
  const off = store.get(OFF) === "1";

  // ---- the personal link
  const url = new URL(window.location.href);
  const inPath = url.pathname.match(/^\/for\/([^/]+)\/?$/);
  const fromLink = clean(inPath ? decode(inPath[1]) : url.searchParams.get("ref"));
  let ref = "", via = "";
  if (!off) {
    let kept = null;
    try { kept = JSON.parse(store.get(REF) || "null"); } catch (e) { kept = null; }
    if (kept && (!kept.tag || Date.now() - kept.at > KEEP_DAYS * DAY)) { kept = null; store.del(REF); }
    if (fromLink) { ref = fromLink; via = kept && kept.tag === fromLink ? "opened the link again" : "opened the link"; store.set(REF, JSON.stringify({ tag: ref, at: Date.now() })); }
    else if (kept) { ref = clean(kept.tag); via = "came back without the link"; }
    // /?ref=<tag> becomes /for/<tag> before the visit is counted, so the tag shows in the page
    // path of the visit as well as in the events
    if (fromLink && !inPath && url.pathname === "/") {
      url.searchParams.delete("ref");
      try { window.history.replaceState(null, "", `/for/${encodeURIComponent(ref)}${url.search}${url.hash}`); } catch (e) { /* the events still carry the tag */ }
    }
  }

  // ---- Vercel Web Analytics: the queue its script reads, then the script itself
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  window.va = window.va || function va() { (window.vaq = window.vaq || []).push(arguments); };
  if (!off && !local) {
    const s = document.createElement("script");
    s.defer = true; s.src = "/_vercel/insights/script.js";
    document.head.appendChild(s);
  }

  const log = [], sent = new Set();
  // one detail per event at most: with the personal tag that makes two properties, which every
  // paid Vercel plan accepts
  function track(name, data, once) {
    if (off) return;
    const d = {};
    for (const [k, v] of Object.entries(data || {}).slice(0, 1)) d[k] = String(v).slice(0, 120);
    if (once) { const key = `${name}|${JSON.stringify(d)}`; if (sent.has(key)) return; sent.add(key); }
    if (ref) d.ref = ref;
    log.push({ name, data: d });
    window.va("event", { name, data: d });
  }
  track.log = log;
  track.ref = () => ref;
  track.off = () => off;
  window.TOSTrack = track;

  if (ref) track("Personal link", { visit: via }, true);

  const start = () => {
    const where = (el) => (el.closest("#chat") ? "chat box" : el.closest(".sticker") ? "floating button" : el.closest("header") ? "header" : el.closest("footer") ? "footer" : el.closest("section[id]")?.id || el.closest("section")?.className.split(" ")[0] || "page");
    const BUTTONS = { "sd-opt": ["Design studio", "optimise"], "sd-save": ["Scenario saved", "design studio"], "wi-save": ["Scenario saved", "what-if"], "theme-toggle": ["Day or night mode", "switched"] };
    // only the visitor's own clicks count: the guided tour's cursor presses buttons too
    document.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      const el = e.target.closest?.("a, button");
      if (!el) return;
      const href = el.getAttribute("href") || "";
      if (href.startsWith("tel:")) track("Call tapped", { where: where(el) });
      else if (href.startsWith("mailto:")) track("Email tapped", { where: where(el) });
      else if (/TenderOS-deck\.pdf$/.test(href)) track("Deck downloaded", { where: where(el) });
      else if (href === "#demo") track("Book a demo clicked", { where: where(el) });
      else if (href === "#tour") track("Watch the tour clicked", { where: where(el) });
      else if (/^\/(data\/|llms)/.test(href)) track("Data file opened", { file: href });
      else if (/^https?:\/\//.test(href) && new URL(href).host !== window.location.host) track("Outbound link", { to: new URL(href).host });
      else if (el.dataset.tt) track("Tender type opened", { type: el.dataset.tt }, true);
      else if (BUTTONS[el.id]) track(BUTTONS[el.id][0], { what: BUTTONS[el.id][1] });
    }, { capture: true, passive: true });
    document.addEventListener("input", (e) => { if (e.isTrusted && /^sd-/.test(e.target.id || "")) track("Design studio", { what: `moved ${e.target.id.slice(3)}` }, true); }, { capture: true, passive: true });

    // the demo request: that the form was started and sent, never what was typed into it
    const form = document.getElementById("demo-form");
    if (form) {
      form.addEventListener("focusin", () => track("Demo form", { step: "started" }, true));
      form.addEventListener("submit", () => track("Demo form", { step: "sent to mail" }));
    }

    // which sections were read: one event when a section has held the middle of the screen for a second
    if ("IntersectionObserver" in window) {
      const timers = new Map();
      const io = new IntersectionObserver((es) => es.forEach((en) => {
        const id = en.target.id;
        if (en.isIntersecting && !timers.has(id)) timers.set(id, setTimeout(() => { track("Section read", { section: id }, true); io.unobserve(en.target); }, 1000));
        else if (!en.isIntersecting && timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); }
      }), { rootMargin: "-45% 0px -45% 0px" });
      document.querySelectorAll("main section[id]").forEach((s) => io.observe(s));
    }

    // time on the page, counted only while the tab is in front
    const MARKS = [[30, "30 seconds"], [120, "2 minutes"], [300, "5 minutes"], [600, "10 minutes"], [1200, "20 minutes"]];
    let seconds = 0, next = 0;
    const clock = setInterval(() => {
      if (document.hidden) return;
      seconds += 5;
      if (seconds >= MARKS[next][0]) { track("Time on page", { reached: MARKS[next][1] }, true); next += 1; if (next >= MARKS.length) clearInterval(clock); }
    }, 5000);

    // /privacy: the visitor's own switches
    const state = document.getElementById("track-state");
    const say = () => { if (state) state.textContent = store.get(OFF) === "1" ? "Counting is off in this browser." : store.get(REF) ? "Counting is on, and this browser holds a personal link." : "Counting is on. This browser holds no personal link."; };
    say();
    document.querySelectorAll("[data-track]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.track === "forget") store.del(REF);
      if (b.dataset.track === "off") { store.set(OFF, "1"); store.del(REF); }
      if (b.dataset.track === "on") store.del(OFF);
      say();
    }));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
