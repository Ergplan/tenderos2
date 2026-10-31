"use client";
// Feedback on anything on any page (docs/TEAM.md "Feedback and change requests"): with feedback
// switched on in the sidebar, the element under the mouse is outlined, down to a button, an input
// box, a select, a table cell, a stat tile or a step chip, with its section behind it; clicking it
// opens a note where the user writes what to change. The note is saved as a change request with
// where it was raised: the tab, the step (the active chip), the section (its index and title), the
// element (kind, label, value now, data-testid) and the boxes in the section. The Change requests
// tab lists them. Escape or the sidebar button switches feedback off.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus, Send, X } from "lucide-react";
import { boxInfo } from "../team/fields";
import "./feedback.css";

const TARGETS = "section.rtc-section, section.story-hero, nav.bid-steps, section.optimize-bar, .whatif-group, .chapter-group, .whatif-verdict, .whatif-seeded, .team-setup .rtc-section";
// the element-level targets, innermost first: a box (its field wrapper), a stat, a step chip, a cell, a button, a link, a choice
const ELEMENTS = ".rtc-field, .rtc-stat, .bid-step, td, th, button, a[href], [role=radio], [role=tab], summary";
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

/** The element under a click, if it is one worth naming: kind, label, value now, data-testid. */
export function elementInfo(target, tab, tabLabel) {
  const el = target.closest?.(ELEMENTS);
  if (!el) return null;
  const testId = el.getAttribute("data-testid") || el.querySelector?.("[data-testid]")?.getAttribute("data-testid") || "";
  const clip = (v, n = 160) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
  if (el.matches(".rtc-field")) {
    const input = el.querySelector("input, select, textarea");
    const info = input ? boxInfo(input, tab, tabLabel) : null;
    const label = info?.label || text(el.querySelector(".rtc-field-top span")) || "Box";
    return { kind: input?.tagName === "SELECT" ? "select" : "box", label, value: clip(info?.value ?? ""), testId: input?.getAttribute("data-testid") || testId };
  }
  if (el.matches(".rtc-stat")) return { kind: "stat", label: text(el.querySelector("span")), value: clip(text(el.querySelector("strong"))), testId: el.getAttribute("data-trace") ? `trace:${el.getAttribute("data-trace")}` : testId };
  if (el.matches(".bid-step")) return { kind: "step", label: text(el.querySelector("strong")), value: clip(text(el.querySelector("em"))), testId };
  if (el.matches("td, th")) {
    const row = el.closest("tr");
    const table = el.closest("table");
    const col = [...(row?.children || [])].indexOf(el);
    const head = table ? text(table.querySelector("thead tr")?.children?.[col]) : "";
    const rowLabel = row ? text(row.children[0]) : "";
    const label = [rowLabel, head].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ") || "Cell";
    return { kind: el.matches("th") ? "column" : "cell", label: clip(label, 120), value: clip(text(el)), testId };
  }
  if (el.matches("summary")) return { kind: "disclosure", label: clip(text(el), 120), value: "", testId };
  if (el.matches("[role=radio], [role=tab]")) return { kind: "choice", label: clip(text(el.querySelector("strong") || el), 120), value: el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true" ? "chosen" : "", testId };
  if (el.matches("a[href]")) return { kind: "link", label: clip(text(el), 120), value: el.getAttribute("href") || "", testId };
  return { kind: "button", label: clip(text(el) || el.getAttribute("title") || el.getAttribute("aria-label"), 120), value: el.disabled ? "disabled" : "", testId };
}

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

function Composer({ info, anchor, onSend, onClose, busy, err, teams, myTeam }) {
  const [comment, setComment] = useState("");
  const [forTeam, setForTeam] = useState(myTeam || Object.keys(teams || {})[0] || "");
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
          <span className="rtc-index"><MessageSquarePlus size={11} /> {info.element ? `${info.element.kind}: ${info.element.label}` : `${info.sectionIndex ? `${info.sectionIndex} ` : ""}${info.sectionTitle}`}</span>
          <small>{[info.tabLabel, info.stepLabel, info.element ? `${info.sectionIndex ? `${info.sectionIndex} ` : ""}${info.sectionTitle}` : ""].filter(Boolean).join(" › ")}{info.element?.value ? ` · now: ${info.element.value}` : ""}</small>
        </div>
        <button type="button" className="rtc-icon-btn" onClick={onClose} title="Close"><X size={14} /></button>
      </header>
      <textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What should change here? Say what you see, what you expect and why." data-testid="fb-text"
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && comment.trim()) onSend(comment.trim(), forTeam); }} />
      <label className="fb-for">
        <span>Department that needs this change</span>
        <select value={forTeam} onChange={(e) => setForTeam(e.target.value)} data-testid="fb-for-team" data-no-ping>
          {Object.entries(teams || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {info.boxes.length > 0 && <small className="fb-boxes">In this section: {info.boxes.slice(0, 8).join(" · ")}{info.boxes.length > 8 ? " · …" : ""}</small>}
      {err && <p className="seci-flag">{err}</p>}
      <footer>
        <small>Saved as a change request; the super admin approves and exports it for jouleWise.</small>
        <button type="button" className="primary" disabled={busy || !comment.trim()} onClick={() => onSend(comment.trim(), forTeam)} data-testid="fb-send"><Send size={12} /> Send</button>
      </footer>
    </div>
  );
}

/**
 * on: feedback switched on; tab / tabLabel: the open tab; requests: useChangeRequests (raise);
 * onOff: switch it off; onSaved(item): a request was raised.
 */
export default function FeedbackMode({ on, tab, tabLabel, requests, team, onOff, onSaved }) {
  const [hover, setHover] = useState(null); // { el: DOMRect of the element under the mouse, sec: its section's }
  const [open, setOpen] = useState(null); // { info, anchor }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const close = useCallback(() => { setOpen(null); setErr(""); }, []);
  useEffect(() => { if (!on) { setHover(null); close(); } }, [on, close]);
  useEffect(() => {
    if (!on) return undefined;
    const target = (e) => (e.target.closest?.(".fb-pop, .fb-banner, aside.sidebar") ? null : e.target.closest?.(TARGETS));
    const inner = (e) => (e.target.closest?.(".fb-pop, .fb-banner, aside.sidebar") ? null : e.target.closest?.(ELEMENTS));
    const move = (e) => {
      if (open) return;
      const el = target(e);
      const item = el ? inner(e) : null;
      setHover(el ? { sec: el.getBoundingClientRect(), el: item && el.contains(item) ? item.getBoundingClientRect() : null } : null);
    };
    const click = (e) => {
      if (e.target.closest?.(".fb-pop, .fb-banner, aside.sidebar")) return;
      const el = target(e);
      e.preventDefault();
      e.stopPropagation();
      if (!el) return;
      setErr("");
      const element = elementInfo(e.target, tab, tabLabel);
      setOpen({ info: { ...sectionInfo(el, tab, tabLabel), element: element && el.contains(e.target.closest(ELEMENTS)) ? element : null }, anchor: { x: e.clientX, y: e.clientY } });
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
  const send = async (comment, forTeam) => {
    setBusy(true);
    setErr("");
    try {
      const item = await requests.raise({ ...open.info, pageUrl: window.location.href, comment, forTeam });
      close();
      onSaved?.(item);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return createPortal(
    <>
      <div className="fb-banner" data-testid="fb-banner">
        <MessageSquarePlus size={14} /> Feedback is on: click any section of the page to say what should change. <button type="button" onClick={onOff} data-testid="fb-off">Done</button>
      </div>
      {hover && !open && <div className="fb-outline fb-outline-section" style={{ left: hover.sec.left - 4, top: hover.sec.top - 4, width: hover.sec.width + 8, height: hover.sec.height + 8 }} />}
      {hover?.el && !open && <div className="fb-outline fb-outline-el" style={{ left: hover.el.left - 3, top: hover.el.top - 3, width: hover.el.width + 6, height: hover.el.height + 6 }} />}
      {open && <Composer info={open.info} anchor={open.anchor} onSend={send} onClose={close} busy={busy} err={err} teams={team?.teams} myTeam={team?.me?.team} />}
    </>,
    document.body,
  );
}
