// The tools of an input box, in a row in the box's header beside its lock: the lock (the box's own,
// or the general one below for boxes without), the send icon (team mode) and the paperclip
// (evidence). Send and paperclip appear only on boxes whose value usually comes from another team
// (crossFunctional), or that already have a thread or evidence; the lock on every box with a header.
//
// Boxes are found on the page as team mode finds them (./fields.js). A box's tools go in a
// <span class="fx-tools"> placed in its header: the .rtc-field-top of a field, or after the text of
// the <label> around it. A box with neither (a cell of a year-by-year table) has no tools.
import { useCallback, useEffect, useRef, useState } from "react";
import { allBoxes } from "./fields";

/**
 * The team a box's value usually comes from, by its label and section, or null for a choice the
 * bid team makes itself (the bid size, a switch, the step's own settings).
 */
const TEAMS = [
  ["Procurement", /capex|cost\b|costs\b|price of|epc|module|inverter|\bbos\b|cr\/mw|cr\/mwh|rs\/wp|₹\/wp|augmentation|replacement|spares/i],
  ["Resource assessment", /\bcuf\b|capacity factor|generation|p50|p75|p90|degradation|losses|loss\b|availability|round-trip|efficiency|fade|dc:ac|irradiance|wind speed|hub height/i],
  ["O&M", /o&m|o & m|opex|operation and maintenance|om cost/i],
  // the lenders' and the tax advisers' terms; the model's own structure (moratorium, instalments,
  // reserves, escalations) is the bid team's
  ["Finance", /interest rate|debt share|gearing|loan tenor|^tenor|equity irr|corporate tax|\bmat\b|insurance|exchange rate|guarantee fee|bank guarantee|upfront fee|commitment fee/i],
  ["Regulatory", /connectivity|transmission charge|ists|open access|deviation|dsm\b|land\b|lease|right of way|cess|duty|gst/i],
  ["Market", /market price|iex|exchange price|gdam|\bdam\b|\brtm\b|purchase charge|trading margin/i],
];
export function crossFunctional({ label = "", section = "" } = {}) {
  const text = `${label} ${section}`;
  // the bid team's own choices, even when a word above appears in them
  if (/bid size|contracted capacity|quoted tariff|your tariff|tariff guess|bid (mw|capacity)|number of|years? of|scenario|name\b/i.test(label)) return null;
  for (const [team, re] of TEAMS) if (re.test(label)) return team;
  for (const [team, re] of TEAMS) if (re.test(text) && /₹|rs|%|mw|mwh|year|month/i.test(label)) return team;
  return null;
}

/** The header a box's tools go in: its field's header, or its label's text; null when it has neither. */
export function headerOf(el) {
  const field = el.closest(".rtc-field");
  const top = field?.querySelector(":scope > .rtc-field-top");
  if (top) return { el: top, where: "end" };
  const label = el.closest("label");
  if (label) {
    const text = [...label.children].find((c) => c !== el && !c.contains(el) && c.matches("span, strong, b, em") && c.textContent.trim());
    if (text) return { el: text, where: "after" };
  }
  return null;
}

let nextId = 0;
/** The tools row of a box's header, made when it is first needed. */
export function toolHost(el) {
  const head = headerOf(el);
  if (!head) return null;
  const find = head.where === "end" ? head.el.querySelector(":scope > .fx-tools") : (head.el.nextElementSibling?.classList.contains("fx-tools") ? head.el.nextElementSibling : null);
  if (find) return find;
  const host = document.createElement("span");
  host.className = "fx-tools";
  host.setAttribute("data-no-ping", "");
  host.dataset.fxId = String((nextId += 1));
  if (head.where === "end") head.el.appendChild(host);
  else head.el.insertAdjacentElement("afterend", host);
  return host;
}

/** Whether the box's header already has its own lock (the model's locks of the RTC, SECI and CfD inputs). */
export function hasOwnLock(host) {
  return Boolean(host?.parentElement?.querySelector(":scope > .lock-btn"));
}

/**
 * The boxes of the open tab with their tools row: { key, label, section, step, place, value, el,
 * host, team }. One box per header (the first): a header with two boxes gets one row of tools.
 * Re-read when the page changes; the list only changes when a box, its header or its value does.
 */
export function useFieldHosts(tab, tabLabel, { values = false } = {}) {
  const [boxes, setBoxes] = useState([]);
  const sig = useRef("");
  const frame = useRef(0);
  const scan = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const seen = new Set();
      const list = [];
      for (const b of allBoxes(tab, tabLabel)) {
        const host = toolHost(b.el);
        if (!host || seen.has(host)) continue;
        seen.add(host);
        list.push({ ...b, tabLabel, host, team: crossFunctional(b) });
      }
      const s = list.map((b) => `${b.key}|${b.host.dataset.fxId}|${b.label}|${values ? b.value : ""}`).join("\n");
      if (s !== sig.current) { sig.current = s; setBoxes(list); }
    });
  }, [tab, tabLabel, values]);
  useEffect(() => {
    sig.current = "";
    scan();
    const main = document.querySelector("main");
    let t = 0;
    const later = () => { clearTimeout(t); t = setTimeout(scan, 150); };
    const mo = main ? new MutationObserver((records) => {
      // the tools rows' own buttons changing are not a change of the page
      if (records.every((r) => r.target.closest?.(".fx-tools") || (r.type === "childList" && [...r.addedNodes, ...r.removedNodes].every((n) => n.classList?.contains("fx-tools"))))) return;
      later();
    }) : null;
    mo?.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "disabled"] });
    if (values) { document.addEventListener("input", later, true); document.addEventListener("change", later, true); }
    return () => {
      mo?.disconnect(); clearTimeout(t); cancelAnimationFrame(frame.current);
      if (values) { document.removeEventListener("input", later, true); document.removeEventListener("change", later, true); }
    };
  }, [scan, values]);
  return boxes;
}

// ---------------------------------------------------------------- the general lock

const LOCK_KEY = (tab) => `tenderos.locks.${tab}`;
export function readLocks(tab) {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY(tab)) || "{}") || {}; } catch { return {}; }
}
export function saveLocks(tab, locks) {
  try { localStorage.setItem(LOCK_KEY(tab), JSON.stringify(locks)); } catch { /* private window */ }
}

/** A locked box takes no typing and no choice: read-only (a select: disabled) until unlocked. */
export function applyLock(el, locked) {
  if (!el) return;
  if (el.tagName === "SELECT") {
    if (locked) { el.dataset.fxLocked = "1"; el.disabled = true; } else if (el.dataset.fxLocked) { delete el.dataset.fxLocked; el.disabled = false; }
  } else if (locked) { el.dataset.fxLocked = "1"; el.readOnly = true; } else if (el.dataset.fxLocked) { delete el.dataset.fxLocked; el.readOnly = false; }
  el.closest(".rtc-field")?.classList.toggle("is-locked", Boolean(locked));
}
