// The input boxes of the open tab, read from the page itself, so every box of every tab can be
// pinged without wiring each one: its label, the section and step it sits in, its value, and the
// thread key that names it (data-testid when the box has one, else section and label, numbered
// when two boxes share them). Also fills a box with a value as if typed, for "Fill in".
import { threadKey } from "./mentions";

const SKIP_TYPES = new Set(["hidden", "checkbox", "radio", "file", "range", "button", "submit", "reset", "color", "image"]);
const text = (el) => (el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : "");

/** Whether an element is a box that can be pinged. */
export function isBox(el) {
  if (!el || !el.matches?.("input, select, textarea")) return false;
  if (el.tagName === "INPUT" && SKIP_TYPES.has((el.type || "text").toLowerCase())) return false;
  if (el.closest("[data-no-ping], .ping-layer, .ping-pop, .team-inbox, .sidebar")) return false;
  return true;
}

function labelOf(el) {
  const field = el.closest(".rtc-field");
  if (field) {
    const t = text(field.querySelector(".rtc-field-top span, .rtc-field-top"));
    if (t) return t;
  }
  const label = el.closest("label") || el.labels?.[0];
  if (label) {
    const t = text(label.querySelector("span, strong, b")) || text(label).slice(0, 80);
    if (t) return t;
  }
  const aria = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder");
  if (aria) return aria.trim();
  const row = el.closest("tr");
  if (row) {
    const first = text(row.querySelector("th, td"));
    const cell = el.closest("td, th");
    const table = el.closest("table");
    const col = cell && table ? text(table.querySelectorAll("thead th")[cell.cellIndex]) : "";
    if (first || col) return [first, col].filter(Boolean).join(" · ");
  }
  const prev = el.previousElementSibling;
  if (prev && text(prev)) return text(prev).slice(0, 80);
  return el.name || "Input";
}

/** The section heading a box sits under, and the step of the tab that is open. */
function sectionOf(el) {
  const sec = el.closest("section");
  const h = sec?.querySelector("header h2, h2, h3");
  return text(h);
}
export function currentStep(root = document) {
  const cur = root.querySelector('main [aria-current="step"]');
  return cur ? text(cur.querySelector("strong") || cur).replace(/^\d+\s*/, "").slice(0, 80) : "";
}

function valueOf(el) {
  if (el.tagName === "SELECT") return text(el.selectedOptions?.[0]) || el.value || "";
  return String(el.value ?? "");
}

/** Everything a ping needs about a box: key, label, place (tab › step › section), value. */
export function boxInfo(el, tab, tabLabel, root = document) {
  const label = labelOf(el);
  const section = sectionOf(el);
  const testId = el.getAttribute("data-testid");
  let key = threadKey(tab, { testId, name: el.name || null, section, label });
  if (!testId) {
    // two boxes with the same section and label: number them in page order
    const same = [...root.querySelectorAll("main input, main select, main textarea")].filter((x) => isBox(x) && !x.getAttribute("data-testid")
      && threadKey(tab, { name: x.name || null, section: sectionOf(x), label: labelOf(x) }) === key);
    const i = same.indexOf(el);
    if (i > 0) key = `${key}~${i + 1}`;
  }
  const step = currentStep(root);
  return { key, label, section, step, place: [tabLabel, step, section].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" › "), value: valueOf(el) };
}

/** Every box on the page now, with its info. */
export function allBoxes(tab, tabLabel, root = document) {
  return [...root.querySelectorAll("main input, main select, main textarea")].filter(isBox)
    .map((el) => ({ el, ...boxInfo(el, tab, tabLabel, root) }));
}

/** Put a value in a box as if the user typed or chose it (React sees the change). */
export function fillBox(el, value) {
  const v = String(value);
  if (el.tagName === "SELECT") {
    const opt = [...el.options].find((o) => o.value === v) || [...el.options].find((o) => text(o).toLowerCase() === v.toLowerCase())
      || [...el.options].find((o) => text(o).toLowerCase().includes(v.toLowerCase()));
    if (!opt) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, opt.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const clean = el.type === "number" ? v.replace(/[^0-9.eE+-]/g, "") : v;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, clean);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); // React's onBlur
  return true;
}
