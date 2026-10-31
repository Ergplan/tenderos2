"use client";
// Feedback on any section of any page (docs/TEAM.md "Feedback and change requests"): with feedback
// switched on in the sidebar, the section under the mouse is outlined; clicking it opens a note
// where the user writes what to change. The note is saved as a change request with where it was
// raised: the tab, the step (the active chip), the section (its index and title) and the boxes in
// it. The Change requests tab lists them. Escape or the sidebar button switches feedback off.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus, Send, X } from "lucide-react";
import "./feedback.css";

const TARGETS = "section.rtc-section, section.story-hero, nav.bid-steps, section.optimize-bar, .whatif-group, .chapter-group, .whatif-verdict, .whatif-seeded, .team-setup .rtc-section";
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

/** What a clicked element is: the section's index and title, the active step, the boxes in it. */
export function sectionInfo(el, tab, tabLabel) {
  const index = text(el.querySelector(".rtc-index"));
  const titleEl = el.querySelector(":scope > header h2") || el.querySelector("h2, h1, .rtc-subhead, .chapter-group-head span, .eyebrow");
  let title = text(titleEl);
  if (el.matches("nav.bid-steps")) title = "The steps";
  if (el.matches("section.story-hero")) title = text(el.querySelector("h1")) || "Page heading";
  if (!title) title = "Section";
  const chip = document.querySelector(".bid-step.active, .bid-step[aria-current]");
  const step = (chip?.dataset.testid || "").replace(/^(seci|bid)-step-/, "") || "";
  const stepLabel = text(chip?.querySelector("strong"));
  const boxes = [...el.querySelectorAll(".rtc-field-top > span, .rtc-field > label, th")].map(text).filter((b) => b && b.length < 80).slice(0, 40);
  return { tab, tabLabel, step, stepLabel, sectionIndex: index, sectionTitle: title, sectionKey: `${tab}:${step || "page"}:${slug(index ? `${index} ${title}` : title)}`, boxes };
}

function Composer({ info, anchor, onSend, onClose, busy, err }) {
  const [comment, setComment] = useState("");
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth || 420;
    const h = ref.current?.offsetHeight || 260;
    const left = Math.max(12, Math.min(anchor.x - 40, window.innerWidth - w - 12));
    const top = anchor.y + 12 + h > window.innerHeight - 12 ? Math.max(12, anchor.y - h - 12) : anchor.y + 12;
    setPos({ left, top });
    ref.current?.querySelector("textarea")?.focus();
  }, [anchor.x, anchor.y]);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div ref={ref} className="fb-pop" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label="Feedback on this section" data-testid="fb-pop" data-no-ping>
      <header>
        <div>
          <span className="rtc-index"><MessageSquarePlus size={11} /> {info.sectionIndex ? `${info.sectionIndex} ` : ""}{info.sectionTitle}</span>
          <small>{[info.tabLabel, info.stepLabel].filter(Boolean).join(" › ")}</small>
        </div>
        <button type="button" className="rtc-icon-btn" onClick={onClose} title="Close"><X size={14} /></button>
      </header>
      <textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What should change here? Say what you see, what you expect and why." data-testid="fb-text"
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && comment.trim()) onSend(comment.trim()); }} />
      {info.boxes.length > 0 && <small className="fb-boxes">In this section: {info.boxes.slice(0, 8).join(" · ")}{info.boxes.length > 8 ? " · …" : ""}</small>}
      {err && <p className="seci-flag">{err}</p>}
      <footer>
        <small>Saved as a change request; the super admin approves and exports it for jouleWise.</small>
        <button type="button" className="primary" disabled={busy || !comment.trim()} onClick={() => onSend(comment.trim())} data-testid="fb-send"><Send size={12} /> Send</button>
      </footer>
    </div>
  );
}

/**
 * on: feedback switched on; tab / tabLabel: the open tab; requests: useChangeRequests (raise);
 * onOff: switch it off; onSaved(item): a request was raised.
 */
export default function FeedbackMode({ on, tab, tabLabel, requests, onOff, onSaved }) {
  const [hover, setHover] = useState(null); // DOMRect of the section under the mouse
  const [open, setOpen] = useState(null); // { info, anchor }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const close = useCallback(() => { setOpen(null); setErr(""); }, []);
  useEffect(() => { if (!on) { setHover(null); close(); } }, [on, close]);
  useEffect(() => {
    if (!on) return undefined;
    const target = (e) => (e.target.closest?.(".fb-pop, .fb-banner, aside.sidebar") ? null : e.target.closest?.(TARGETS));
    const move = (e) => {
      if (open) return;
      const el = target(e);
      setHover(el ? el.getBoundingClientRect() : null);
    };
    const click = (e) => {
      if (e.target.closest?.(".fb-pop, .fb-banner, aside.sidebar")) return;
      const el = target(e);
      e.preventDefault();
      e.stopPropagation();
      if (!el) return;
      setErr("");
      setOpen({ info: sectionInfo(el, tab, tabLabel), anchor: { x: e.clientX, y: e.clientY } });
    };
    const esc = (e) => { if (e.key === "Escape" && !open) onOff(); };
    document.addEventListener("mousemove", move);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", esc);
    document.body.classList.add("fb-on");
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", esc);
      document.body.classList.remove("fb-on");
    };
  }, [on, open, tab, tabLabel, onOff]);
  if (!on || typeof document === "undefined") return null;
  const send = async (comment) => {
    setBusy(true);
    setErr("");
    try {
      const item = await requests.raise({ ...open.info, pageUrl: window.location.href, comment });
      close();
      onSaved?.(item);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return createPortal(
    <>
      <div className="fb-banner" data-testid="fb-banner">
        <MessageSquarePlus size={14} /> Feedback is on: click any section of the page to say what should change. <button type="button" onClick={onOff} data-testid="fb-off">Done</button>
      </div>
      {hover && !open && <div className="fb-outline" style={{ left: hover.left - 4, top: hover.top - 4, width: hover.width + 8, height: hover.height + 8 }} />}
      {open && <Composer info={open.info} anchor={open.anchor} onSend={send} onClose={close} busy={busy} err={err} />}
    </>,
    document.body,
  );
}
