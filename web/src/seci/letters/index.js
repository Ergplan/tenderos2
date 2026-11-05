// The SECI RTC-TM-V bid formats as full letters: the RfS wording of each format with its blanks
// filled from the bid, for the in-app letter view (BidForms.jsx), the Word file
// (app/api/seci/letters) and the PDF (engine /api/bid/document/pdf).
//
// A template (./<format id>.js) exports { text, omit }. `text` is the RfS wording, one block per
// paragraph (blocks are separated by a blank line; a single line break stays a line break):
//   # Heading            a centred bold line
//   ## Sub-heading       a bold line
//   > Note               an italic instruction line, as the RfS prints it
//   | a | b |            a table row (the first row of a table is its header); "\n" in a cell
//                        is a line break
//   [if key=Option] ...  one of the RfS's alternatives ("strike out whichever is not
//                        applicable"): printed struck through unless the blank `key` holds Option
//   [only consortium] ... a paragraph for one kind of bidder ([only company] for a single
//                        company): left out of the letter for the other kind
//   {{key}}              a blank of the format (its field key in seci-rtc-tm-v.json), filled
//                        with the value the blank shows on the format
//   {{key:num}}          an amount's figures only, grouped the Indian way ("INR 1283350009" ->
//                        "1,28,33,50,009")
//   {{key:words}}        an amount in words, Indian style ("One Hundred Twenty-Eight Crore ...")
//   {{key:crore}}        an amount in rupees as crore ("18500000000" -> "1,850.00")
//   [[key=Option|text]]  an alternative inside a sentence: the text is struck through unless the
//                        blank `key` holds Option
// `omit` lists field keys that are not a blank of the letter (a schedule kept beside it).
import { PACK } from "../terms.js";
import { blankValue } from "../formats.js";
import f71 from "./7.1.js";
import f72 from "./7.2.js";
import f73a from "./7.3A.js";
import f73b from "./7.3B.js";
import f73c from "./7.3C.js";
import f73d from "./7.3D.js";
import f73e from "./7.3E.js";
import f73f from "./7.3F.js";
import f74 from "./7.4.js";
import f75 from "./7.5.js";
import f76 from "./7.6.js";
import f77 from "./7.7.js";
import f78 from "./7.8.js";
import f78a from "./7.8A.js";
import f78annex from "./7.8-annex.js";
import f79 from "./7.9.js";
import f710 from "./7.10.js";
import f711 from "./7.11.js";
import fAnnexB from "./Annexure-B.js";
import fAnnexI from "./Annexure-I.js";

export const TEMPLATES = {
  "7.1": f71, "7.2": f72, "7.3A": f73a, "7.3B": f73b, "7.3C": f73c, "7.3D": f73d, "7.3E": f73e, "7.3F": f73f,
  "7.4": f74, "7.5": f75, "7.6": f76, "7.7": f77, "7.8": f78, "7.8A": f78a, "7.8-annex": f78annex, "7.9": f79,
  "7.10": f710, "7.11": f711, "Annexure-B": fAnnexB, "Annexure-I": fAnnexI,
};

const TOKEN = /\{\{([A-Za-z0-9_]+)(?::(num|words|crore))?\}\}/g;
const INLINE = /\[\[([A-Za-z0-9_]+)=([^|\]]+)\|([^\]]*)\]\]/g;
const COND = /^\[if ([A-Za-z0-9_]+)=([^\]]+)\]\s*/;
const ONLY = /^\[only (consortium|company)\]\s*/;
export const EMPTY = "____________";

/** The blocks of a template text: { type: heading|note|para|table, text | rows, cond }. */
export function parseTemplate(text) {
  const blocks = [];
  for (const chunk of String(text).replace(/\r/g, "").split(/\n\s*\n/)) {
    const raw = chunk.replace(/^\n+|\s+$/g, "");
    if (!raw.trim()) continue;
    const lines = raw.split("\n");
    if (lines.every((l) => l.trim().startsWith("|"))) {
      const rows = lines.map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\\n/g, "\n")));
      blocks.push({ type: "table", rows });
      continue;
    }
    // headings and notes are single-line blocks; consecutive heading lines stay one block each
    if (lines.every((l) => l.startsWith("## "))) {
      for (const l of lines) blocks.push({ type: "subheading", text: l.slice(3).trim() });
      continue;
    }
    if (lines.every((l) => l.startsWith("# "))) {
      for (const l of lines) blocks.push({ type: "heading", text: l.slice(2).trim() });
      continue;
    }
    if (lines.every((l) => l.startsWith("> "))) {
      blocks.push({ type: "note", text: lines.map((l) => l.slice(2)).join("\n") });
      continue;
    }
    const only = raw.match(ONLY);
    const rest = only ? raw.slice(only[0].length) : raw;
    const cond = rest.match(COND);
    blocks.push({ type: "para", text: cond ? rest.slice(cond[0].length) : rest, cond: cond ? { key: cond[1], value: cond[2].trim() } : null, only: only ? only[1] : null });
  }
  return blocks.map((b, i) => ({ ...b, index: i }));
}

/** Every {{key}} of a text, in order. */
export function tokensOf(text) {
  return [...String(text).matchAll(TOKEN)].map((m) => m[1]);
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const under100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));
const under1000 = (n) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", under100(n % 100)].filter(Boolean).join(" ");

/** A whole number of rupees in words, Indian style: crore, lakh, thousand. */
export function rupeesInWords(n) {
  let rest = Math.round(Number(n));
  if (!Number.isFinite(rest) || rest < 0) return "";
  if (rest === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(rest / 1e7);
  rest %= 1e7;
  if (crore) parts.push(`${crore >= 1000 ? rupeesInWords(crore) : under1000(crore)} Crore`);
  for (const [size, name] of [[1e5, "Lakh"], [1e3, "Thousand"]]) {
    const k = Math.floor(rest / size);
    rest %= size;
    if (k) parts.push(`${under100(k)} ${name}`);
  }
  if (rest) parts.push(under1000(rest));
  return parts.join(" ");
}

/** 1283350009 -> "1,28,33,50,009" (Indian grouping), decimals kept. */
export function indianNumber(n, decimals = 0) {
  const [whole, frac] = Math.abs(Number(n)).toFixed(decimals).split(".");
  const head = whole.length > 3 ? `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${whole.slice(-3)}` : whole;
  return `${Number(n) < 0 ? "-" : ""}${head}${frac ? `.${frac}` : ""}`;
}

function filtered(value, filter) {
  if (!value || !filter) return value;
  const digits = String(value).replace(/^[^\d]*/, "").replace(/[^\d,.].*$/, "");
  const n = Number(digits.replace(/,/g, ""));
  if (!digits || !Number.isFinite(n)) return filter === "num" ? value : "";
  if (filter === "num") return indianNumber(n, Number.isInteger(n) ? 0 : 2);
  if (filter === "crore") return indianNumber(n / 1e7, 2);
  return rupeesInWords(n);
}

/** Text with its inline alternatives resolved: [{ text, struck, key, option }] pieces. */
function inlinePieces(text, values) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(INLINE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), struck: false });
    const chosen = values[m[1]];
    out.push({ text: m[3], struck: Boolean(chosen && chosen !== m[2].trim()), key: m[1], option: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < String(text).length) out.push({ text: text.slice(last), struck: false });
  return out;
}

/** Text split into plain and value segments: [{ text, struck }, { key, text, missing, struck }]. */
export function segments(text, values) {
  const out = [];
  inlinePieces(text, values).forEach((piece, n) => {
    const part = piece.text;
    // segments of an inline alternative carry it, so an edited paragraph keeps the alternative
    const alt = piece.key ? { piece: n, key: piece.key, option: piece.option } : null;
    let last = 0;
    for (const m of part.matchAll(TOKEN)) {
      if (m.index > last) out.push({ text: part.slice(last, m.index), struck: piece.struck, alt });
      const v = filtered(values[m[1]], m[2]);
      out.push({ key: m[1], filter: m[2] || null, text: v ? String(v) : EMPTY, missing: !v, struck: piece.struck, alt });
      last = m.index + m[0].length;
    }
    if (last < part.length) out.push({ text: part.slice(last), struck: piece.struck, alt });
  });
  return out;
}

/** The inline alternatives of a text: [{ key, option }]. */
export function inlineOf(text) {
  return [...String(text).matchAll(INLINE)].map((m) => ({ key: m[1], option: m[2].trim() }));
}

export function formatById(id) {
  return PACK.formats.find((f) => f.id === id) || null;
}

/** The values of a format's blanks as the letter prints them (field key -> text). */
export function letterValues(state, format) {
  const out = {};
  for (const field of format.fields) {
    const b = blankValue(state, format, field);
    out[field.key] = b.source === "na" ? "" : b.value;
  }
  return out;
}

/**
 * A format as a letter: { id, title, paper, letterhead, bidder, address, blocks, missing, edited }.
 * Each block carries its segments (tables: rows of cells of segments), whether it is struck
 * out (an alternative not chosen), whether the alternative is still to choose, and whether the
 * bidder edited its wording (state.letters[format id][block index], the edited template text).
 */
export function letterOf(state, format) {
  const template = TEMPLATES[format.id];
  if (!template) return null;
  return letterFrom(state, format, template, letterValues(state, format));
}

/**
 * A letter from any tender pack's template and blank values (the CfD tab's letters use this with
 * their own formats): the same blocks, struck alternatives, omitted paragraphs and edits.
 */
export function letterFrom(state, format, template, values) {
  const edits = state.letters?.[format.id] || {};
  const kind = state.forms?.bidderType === "consortium" ? "consortium" : "company";
  const blocks = parseTemplate(template.text).map((b) => {
    const editedText = typeof edits[b.index] === "string" ? edits[b.index] : null;
    const text = editedText ?? b.text;
    const chosen = b.cond ? values[b.cond.key] : null;
    const base = { index: b.index, type: b.type, edited: editedText !== null, original: b.text ?? null };
    if (b.type === "table") return { ...base, rows: b.rows.map((row) => row.map((cell) => segments(cell, values))) };
    return {
      ...base,
      text,
      segments: segments(text, values),
      cond: b.cond,
      only: b.only,
      // a paragraph for the other kind of bidder is left out of the letter
      omitted: Boolean(b.only && b.only !== kind),
      struck: Boolean(b.cond && chosen && chosen !== b.cond.value),
      choose: Boolean(b.cond && !chosen),
    };
  });
  const used = new Set();
  for (const b of blocks) {
    const segs = b.type === "table" ? b.rows.flat(2) : b.segments;
    for (const s of segs) if (s.key && !s.struck && !b.struck && !b.omitted) used.add(s.key);
  }
  const missing = [...used].filter((k) => !values[k]);
  const f = state.forms || {};
  return {
    id: format.id,
    title: format.title,
    pages: format.pages,
    paper: format.paper,
    letterhead: /letter\s*head/i.test(format.paper || ""),
    bidder: f.bidder || "",
    address: f.address || "",
    blocks,
    missing: missing.map((k) => format.fields.find((x) => x.key === k)?.label || k),
    edited: blocks.filter((b) => b.edited).length,
  };
}

/** The letters of every format this bid needs (the formats' "applies"), in pack order. */
export function lettersForBid(state, applies) {
  return PACK.formats.filter((f) => TEMPLATES[f.id] && ["yes", "choose"].includes(applies(state, f))).map((f) => letterOf(state, f));
}

/** A template text from an edited block's DOM: text, line breaks, and value chips as {{key}}. */
export function textFromNodes(node) {
  let out = "";
  for (const child of node.childNodes) {
    if (child.nodeType === 3) out += child.nodeValue;
    else if (child.nodeType === 1) {
      if (child.dataset?.altKey) out += `[[${child.dataset.altKey}=${child.dataset.altOption}|${textFromNodes(child)}]]`;
      else if (child.dataset?.key) out += `{{${child.dataset.key}${child.dataset.filter ? `:${child.dataset.filter}` : ""}}}`;
      else if (child.tagName === "BR") out += "\n";
      else if (child.tagName === "DIV" || child.tagName === "P") out += (out && !out.endsWith("\n") ? "\n" : "") + textFromNodes(child);
      else out += textFromNodes(child);
    }
  }
  return out.replace(/ /g, " ");
}

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const segHtml = (segs) => segs.map((s) => {
  const h = escHtml(s.text).replace(/\n/g, "<br>");
  return s.struck ? `<s>${h}</s>` : h;
}).join("").replace(/₹/g, "Rs. ");

/** One letter as HTML for the PDF (PyMuPDF Story): letterhead, blocks, struck alternatives. */
export function letterHtml(letter) {
  const parts = [];
  if (letter.letterhead && letter.bidder) {
    parts.push(`<p style="text-align:center;font-weight:bold;font-size:13pt;margin:0">${escHtml(letter.bidder)}</p>`
      + `<p style="text-align:center;font-size:8.5pt;color:#555;margin:0 0 4pt 0">${escHtml(letter.address).replace(/\n/g, ", ")}</p><hr>`);
  }
  for (const b of letter.blocks.filter((x) => !x.omitted)) {
    if (b.type === "heading") parts.push(`<p style="text-align:center;font-weight:bold;font-size:12pt;margin:2pt 0">${segHtml(b.segments)}</p>`);
    else if (b.type === "subheading") parts.push(`<p style="font-weight:bold;margin:8pt 0 3pt 0">${segHtml(b.segments)}</p>`);
    else if (b.type === "note") parts.push(`<p style="font-style:italic;color:#444">${segHtml(b.segments)}</p>`);
    else if (b.type === "table") {
      const rows = b.rows.map((row, r) => `<tr>${row.map((cell) => `<${r === 0 && b.rows.length > 1 && b.rows[0].length > 2 ? "th" : "td"}>${segHtml(cell)}</${r === 0 && b.rows.length > 1 && b.rows[0].length > 2 ? "th" : "td"}>`).join("")}</tr>`);
      parts.push(`<table>${rows.join("")}</table>`);
    } else {
      const body = segHtml(b.segments);
      parts.push(`<p>${b.struck ? `<s>${body}</s>` : body}</p>`);
    }
  }
  return parts.join("\n");
}

export const LETTER_CSS = "body{font-family:serif;font-size:10.5pt;line-height:1.35} p{margin:0 0 6pt 0;text-align:justify} "
  + "table{border-collapse:collapse;width:100%;margin:2pt 0 8pt 0} td,th{border:1px solid #777;padding:3pt;font-size:9pt;vertical-align:top} "
  + "th{background:#e8e8e8;font-weight:bold} hr{border:0;border-top:1px solid #333}";
