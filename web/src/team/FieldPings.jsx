"use client";
// Team mode on the page: a send icon on every input box of the open tab (with the number of
// messages when the box has a thread, highlighted when one is unread for you). Clicking it opens
// the box's thread, Slack style: the messages, a composer that suggests teammates after @, and an
// optional value the asker can put in the box with "Fill in".
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AtSign, CornerDownLeft, Send, X } from "lucide-react";
import { allBoxes, boxInfo, currentStep, fillBox } from "./fields";
import { mentionAt, suggest } from "./mentions";
import "./teamMode.css";

const MODE_KEY = "tenderos.pingIcons";
export function readPingMode() {
  try { return localStorage.getItem(MODE_KEY) || "always"; } catch { return "always"; }
}
export function savePingMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* private window */ }
}

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString();
};
const initials = (name) => String(name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** A message's text with its @handles picked out. */
export function Body({ text }) {
  const parts = String(text || "").split(/(@[a-z0-9.]+[a-z0-9])/gi);
  return <>{parts.map((p, i) => (p.startsWith("@") ? <b key={i} className="ping-at">{p}</b> : <React.Fragment key={i}>{p}</React.Fragment>))}</>;
}

function Composer({ team, tab, onSend, busy, valueHint }) {
  const [text, setText] = useState("");
  const [value, setValue] = useState("");
  const [sug, setSug] = useState(null); // { list, start, i }
  const ref = useRef(null);
  const update = (t, caret) => {
    setText(t);
    const at = mentionAt(t, caret);
    const list = at ? suggest(team.members.filter((m) => m.id !== team.me?.id), at.query, tab) : [];
    setSug(at && list.length ? { list, start: at.start, i: 0 } : null);
  };
  const pick = (m) => {
    const caret = ref.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, sug.start)}@${m.handle} ${text.slice(caret)}`;
    setText(next);
    setSug(null);
    requestAnimationFrame(() => { ref.current?.focus(); const p = sug.start + m.handle.length + 2; ref.current?.setSelectionRange(p, p); });
  };
  const send = async () => {
    if (!text.trim() && !value.trim()) return;
    await onSend({ body: text.trim(), value: value.trim() || null });
    setText("");
    setValue("");
  };
  return (
    <div className="ping-compose">
      {sug && (
        <ul className="ping-sug" role="listbox" data-testid="ping-suggest">
          {sug.list.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === sug.i} className={i === sug.i ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); pick(m); }}>
              <span className="ping-avatar">{initials(m.name)}</span>
              <span><strong>@{m.handle}</strong><small>{[m.name, m.title || team.teams?.[m.team]].filter(Boolean).join(" · ")}</small></span>
              {(m.tabs || []).includes(tab) && <em>covers this tab</em>}
            </li>
          ))}
        </ul>
      )}
      <textarea ref={ref} rows={2} value={text} placeholder="Ask for it: type @ to ping a teammate" data-testid="ping-text"
        onChange={(e) => update(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (sug) {
            if (e.key === "ArrowDown") { e.preventDefault(); setSug({ ...sug, i: (sug.i + 1) % sug.list.length }); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setSug({ ...sug, i: (sug.i - 1 + sug.list.length) % sug.list.length }); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(sug.list[sug.i]); return; }
            if (e.key === "Escape") { e.stopPropagation(); setSug(null); return; }
          }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
        }} />
      <div className="ping-compose-row">
        <input className="ping-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder={valueHint ? `Value to fill in (now ${valueHint})` : "Value to fill in (optional)"} data-testid="ping-value"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }} />
        <button type="button" className="rtc-icon-btn" title="Mention someone" onClick={() => { const t = `${text}${text && !text.endsWith(" ") ? " " : ""}@`; update(t, t.length); ref.current?.focus(); }}><AtSign size={14} /></button>
        <button type="button" className="primary ping-send" disabled={busy || (!text.trim() && !value.trim())} onClick={send} data-testid="ping-send"><Send size={13} /> Send</button>
      </div>
    </div>
  );
}

function ThreadPop({ team, tab, box, anchor, onClose, elFor }) {
  const [messages, setMessages] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [filled, setFilled] = useState(null);
  const ref = useRef(null);
  const load = useCallback(async () => {
    try { setMessages(await team.thread(box.key)); } catch (e) { setErr(e.message); }
  }, [team, box.key]);
  useEffect(() => {
    load();
    team.markRead({ threadKey: box.key }).catch(() => {});
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [box.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.(".ping-dot")) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", out);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth || 380;
    const h = ref.current?.offsetHeight || 360;
    const left = Math.max(12, Math.min(anchor.x - w + 24, window.innerWidth - w - 12));
    const below = anchor.y + 16;
    const top = below + h > window.innerHeight - 12 ? Math.max(12, anchor.y - h - 24) : below;
    setPos({ left, top });
  }, [anchor.x, anchor.y, messages]);
  const send = async ({ body, value }) => {
    setBusy(true);
    setErr("");
    try {
      const el = elFor(box.key);
      const info = el ? boxInfo(el, tab, box.tabLabel) : box;
      await team.post({ threadKey: box.key, tab, fieldLabel: box.label, place: info.place, step: info.step, fieldValue: info.value, body, value });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const fill = (m) => {
    const el = elFor(box.key);
    if (el && fillBox(el, m.value)) {
      setFilled(m.id);
      el.classList.add("ping-flash");
      setTimeout(() => el.classList.remove("ping-flash"), 1600);
    } else {
      setErr(el ? `"${m.value}" is not one of this box's choices.` : "Open the step with this box to fill it in.");
    }
  };
  return (
    <div ref={ref} className="ping-pop" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label={`Messages about ${box.label}`} data-testid="ping-pop">
      <header>
        <div>
          <span className="rtc-index"># {box.label}</span>
          <small>{box.place}</small>
        </div>
        <button type="button" className="rtc-icon-btn" onClick={onClose} title="Close"><X size={14} /></button>
      </header>
      <div className="ping-now">Now in the box: <strong>{box.value === "" ? "empty" : box.value}</strong></div>
      <div className="ping-thread" data-testid="ping-thread">
        {messages === null && <p className="rtc-note">Loading…</p>}
        {messages?.length === 0 && <p className="rtc-note">No messages yet. Ask a teammate for this value: type @ and their name.</p>}
        {messages?.map((m) => (
          <article key={m.id} className={m.mine ? "mine" : ""}>
            <span className="ping-avatar">{initials(m.from_name)}</span>
            <div>
              <header><strong>{m.from_name || "Someone"}</strong>{m.from_handle && <small>@{m.from_handle}</small>}<time>{ago(m.created_at)}</time></header>
              {m.body && <p><Body text={m.body} /></p>}
              {m.value !== null && m.value !== undefined && (
                <div className="ping-offer">
                  <span>Value: <strong>{m.value}</strong></span>
                  <button type="button" className="secondary" onClick={() => fill(m)} data-testid="ping-fill">{filled === m.id ? "Filled in" : <><CornerDownLeft size={12} /> Fill in</>}</button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      {err && <p className="seci-flag ping-err">{err}</p>}
      {team.me ? <Composer team={team} tab={tab} onSend={send} busy={busy} valueHint={box.value} />
        : <p className="rtc-note">You are not on the tender team: ask its super admin to add you (Team setup).</p>}
    </div>
  );
}

/**
 * The layer over the open tab. focus: { key, step } from the inbox ("Open field"): the step is
 * opened, the box scrolled to and its thread shown; then onFocused().
 */
export default function FieldPings({ tab, tabLabel, team, focus = null, onFocused = () => {} }) {
  const [boxes, setBoxes] = useState([]);
  const [open, setOpen] = useState(null); // { key, label, place, value, anchor }
  const [mode, setMode] = useState(readPingMode);
  const [hot, setHot] = useState(null); // the key of the box under the mouse or with focus
  const els = useRef(new Map());
  const frame = useRef(0);

  const scan = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const list = allBoxes(tab, tabLabel);
      els.current = new Map(list.map((b) => [b.key, b.el]));
      setBoxes(list.map(({ el, ...b }) => {
        const r = el.getBoundingClientRect();
        return { ...b, tabLabel, x: r.right + window.scrollX, y: r.top + window.scrollY, visible: r.width > 0 && r.height > 0 };
      }));
    });
  }, [tab, tabLabel]);

  useEffect(() => {
    scan();
    const main = document.querySelector("main");
    let t = 0;
    const later = () => { clearTimeout(t); t = setTimeout(scan, 200); };
    const mo = main ? new MutationObserver(later) : null;
    mo?.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open", "disabled"] });
    window.addEventListener("resize", later);
    document.addEventListener("scroll", scan, true);
    const onMode = () => setMode(readPingMode());
    window.addEventListener("tenderos-ping-mode", onMode);
    return () => { mo?.disconnect(); clearTimeout(t); window.removeEventListener("resize", later); document.removeEventListener("scroll", scan, true); window.removeEventListener("tenderos-ping-mode", onMode); };
  }, [scan]);

  // the box under the mouse or with focus gets its icon at full strength
  useEffect(() => {
    const keyOf = (el) => [...els.current.entries()].find(([, v]) => v === el)?.[0] || null;
    // off a box (and off the icons), no icon takes clicks, so one never covers a button above a box
    const over = (e) => {
      const el = e.target.closest?.("input, select, textarea");
      if (el) setHot(keyOf(el));
      else if (!e.target.closest?.(".ping-dot, .ping-pop")) setHot(keyOf(document.activeElement));
    };
    const fin = (e) => { const k = keyOf(e.target); if (k) setHot(k); };
    document.addEventListener("mouseover", over);
    document.addEventListener("focusin", fin);
    return () => { document.removeEventListener("mouseover", over); document.removeEventListener("focusin", fin); };
  }, []);

  // "Open field" from the inbox: the step, then the box
  useEffect(() => {
    if (!focus || focus.tab !== tab) return;
    let tries = 0;
    let clicked = false;
    const timer = setInterval(() => {
      tries += 1;
      if (focus.step && !clicked && currentStep() !== focus.step) {
        const btn = [...document.querySelectorAll('main [data-testid*="step-"], main [aria-current]')].find((b) => b.textContent.replace(/\s+/g, " ").includes(focus.step));
        if (btn) { btn.click(); clicked = true; return; }
      }
      const list = allBoxes(tab, tabLabel);
      const hit = list.find((b) => b.key === focus.key);
      if (hit || tries > 25) {
        clearInterval(timer);
        if (hit) {
          hit.el.scrollIntoView({ block: "center", behavior: "smooth" });
          setTimeout(() => {
            const r = hit.el.getBoundingClientRect();
            hit.el.classList.add("ping-flash");
            setTimeout(() => hit.el.classList.remove("ping-flash"), 1600);
            setOpen({ ...hit, el: undefined, tabLabel, anchor: { x: r.right, y: r.top } });
          }, 450);
        }
        onFocused(hit ? null : `That box is not on the page now: open ${focus.place || "its step"}.`);
      }
    }, 160);
    return () => clearInterval(timer);
  }, [focus, tab, tabLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = team?.counts || {};
  const shown = useMemo(() => boxes.filter((b) => b.visible && (mode === "always" || b.key === hot || counts[b.key] || open?.key === b.key)), [boxes, mode, hot, counts, open]);
  if (!team?.me || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="ping-layer" aria-hidden={false}>
        {shown.map((b) => {
          const c = counts[b.key];
          return (
            <button key={b.key} type="button" className={`ping-dot ${c ? "has-thread" : ""} ${c?.unread ? "unread" : ""} ${b.key === hot || open?.key === b.key ? "hot" : ""}`}
              style={{ left: b.x - 10, top: b.y - 10 }} title={c ? `${c.messages} message${c.messages === 1 ? "" : "s"} about ${b.label}` : `Ping a teammate about ${b.label}`}
              data-testid="ping-dot" data-ping-key={b.key}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setOpen(open?.key === b.key ? null : { ...b, anchor: { x: r.right, y: r.bottom } }); }}>
              <Send size={10} />
              {c?.messages ? <span>{c.messages}</span> : null}
            </button>
          );
        })}
      </div>
      {open && <ThreadPop key={open.key} team={team} tab={tab} box={open} anchor={open.anchor} onClose={() => setOpen(null)} elFor={(k) => els.current.get(k) || allBoxes(tab, tabLabel).find((b) => b.key === k)?.el || null} />}
    </>,
    document.body,
  );
}
