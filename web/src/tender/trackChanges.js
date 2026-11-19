// A tender document with its amendments in track-change form: the text an amendment replaces struck
// through where it stands in the document, the new text inserted after it, and a clause the
// amendment adds placed after the clause it belongs to. Plain JavaScript, importable in Node
// (tools/check_tracked_documents.mjs places every change of every tender pack and reports what it
// could not place).
//
// The document's text is page by page, from tools/build_tender_text.py
// (web/public/tenders/<tender>/text/<file>.json). A pack's change rows give the text before and
// after ({ doc, page, quote }, or a list of them); the quote before may come from the amendment's
// own reprint of the clause, so it is looked for in the document's text by its letters and digits
// alone (case, spacing, punctuation and quote marks set aside).

/** The quote's text: one quote, or the parts of a list joined. */
export function quoteText(q) {
  if (!q) return "";
  if (Array.isArray(q)) return q.map(quoteText).filter(Boolean).join("\n");
  return String(q.quote ?? q ?? "");
}
const quoteParts = (q) => (!q ? [] : Array.isArray(q) ? q.flatMap(quoteParts) : [quoteText(q)]).filter(Boolean);

/** The letters and digits of a text, lower case, with each one's index in the text. */
export function normalise(text) {
  const s = String(text || "");
  let norm = "";
  const map = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i].toLowerCase();
    if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) { norm += c; map.push(i); }
  }
  return { norm, map };
}

/** Each page normalised once. */
export function indexPages(pages) {
  return pages.map((text) => ({ text, ...normalise(text) }));
}

const EDGE = 60; // letters matched at each end of a quote that is not found whole

/**
 * Where a quote stands in the document: [{ page (0-based), start, end }] in the page's own text
 * (one range, or two when it runs over a page break), with how it was found ("exact", or "ends"
 * when only its first and last letters were found, the text between differing a little). Null when
 * it is not there. `near` (0-based) prefers the match closest to that page.
 */
export function locate(index, quote, near = null) {
  const key = normalise(quote).norm;
  if (key.length < 12) return null;
  const order = index.map((_, i) => i);
  if (near !== null) order.sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
  const range = (p, a, b) => ({ page: p, start: index[p].map[a], end: index[p].map[b - 1] + 1 });
  for (const p of order) {
    const at = index[p].norm.indexOf(key);
    if (at >= 0) return { how: "exact", ranges: [range(p, at, at + key.length)] };
  }
  // over a page break: the end of one page and the start of the next
  for (const p of order) {
    const a = index[p];
    const b = index[p + 1];
    if (!b) continue;
    for (let cut = Math.min(key.length - 12, a.norm.length); cut >= 12; cut -= 1) {
      if (a.norm.endsWith(key.slice(0, cut)) && b.norm.startsWith(key.slice(cut))) {
        return { how: "exact", ranges: [range(p, a.norm.length - cut, a.norm.length), range(p + 1, 0, key.length - cut)] };
      }
    }
  }
  if (key.length < EDGE * 2 + 20) return null;
  // the first and the last letters on the same page, in order and not too far apart
  const head = key.slice(0, EDGE);
  const tail = key.slice(-EDGE);
  for (const p of order) {
    const n = index[p].norm;
    const a = n.indexOf(head);
    if (a < 0) continue;
    const b = n.indexOf(tail, a + head.length);
    if (b >= 0 && b + EDGE - a <= key.length * 1.4) return { how: "ends", ranges: [range(p, a, b + EDGE)] };
  }
  return null;
}

/** The clause number a change names ("9.3.a.iv (addendum)" → "9.3", "6.1.7" → "6.1.7"). */
export function clauseNumber(clause) {
  const m = String(clause || "").match(/\d+(\.\d+)*/);
  return m ? m[0] : null;
}

/**
 * Where a clause starts and ends: the paragraph (line of the page's text) that begins with its
 * number (or "Annexure-X"), outside the contents pages; for a new clause not in the document, the
 * clause before it; null when none is found.
 */
export function locateClause(index, clause) {
  const annex = String(clause || "").match(/annexure\s*[-–]?\s*([A-Z0-9]+)/i);
  if (annex) return findLine(index, new RegExp(`^annexure\\s*[-–]?\\s*${annex[1]}\\b`, "i"));
  const num = clauseNumber(clause);
  if (!num) return null;
  const found = findLine(index, clauseLine(num));
  if (found || !/new/i.test(clause)) return found;
  // a new clause: after the one before it (1.76 after 1.75, or after 1.74 ...)
  const parts = num.split(".").map(Number);
  for (let k = 1; k <= 5 && parts[parts.length - 1] - k > 0; k += 1) {
    const prev = [...parts.slice(0, -1), parts[parts.length - 1] - k].join(".");
    const at = findLine(index, clauseLine(prev));
    if (at) return at;
  }
  return null;
}

const clauseLine = (num) => new RegExp(`^(Article\\s+|ARTICLE\\s+|Clause\\s+)?${num.replace(/\./g, "\\.")}\\.?(\\s|$)`);

/** The first paragraph that matches, outside the contents pages. */
function findLine(index, re) {
  for (let p = 0; p < index.length; p += 1) {
    const text = index[p].text;
    let at = 0;
    for (const line of text.split("\n")) {
      if (re.test(line) && !/\.{5,}|…{2,}/.test(line)) return { page: p, start: at, end: at + line.length };
      at += line.length + 1;
    }
  }
  return null;
}

/** The pack's document a change row amends ("RfS", "PPA", "PSA"), by id or title. */
export function documentFor(documents, name) {
  const n = String(name || "").toLowerCase();
  return documents.find((d) => d.id === n || String(d.title || "").toLowerCase() === n || String(d.title || "").toLowerCase().endsWith(` ${n}`)) || null;
}

/**
 * The document with its changes: for each page the edits on it ({ kind: "del", start, end, change }
 * or { kind: "ins", at, text, change }), the changes placed and those that could not be (listed
 * with the document instead, with the reason). `docId` is the document's id in the pack, so a
 * quote taken from it is looked for first on its own page.
 */
export function trackDocument(pages, changes, docId = null) {
  const index = indexPages(pages);
  const edits = pages.map(() => []);
  const placed = [];
  const unplaced = [];
  const taken = pages.map(() => []); // struck ranges, so a later amendment of the same text inserts beside it
  const overlaps = (r) => taken[r.page].some(([a, b]) => r.start < b && a < r.end);
  for (const change of changes) {
    const after = change.deleted ? "Deleted." : quoteText(change.after);
    const before = quoteParts(change.before);
    const near = [].concat(change.before || []).map((q) => (q?.doc && q.doc === docId ? q.page - 1 : null)).find((p) => p !== null && p !== undefined) ?? null;
    if (before.length) {
      const found = before.map((q) => locate(index, q, near));
      const hits = found.filter(Boolean);
      if (hits.length) {
        const ranges = hits.flatMap((h) => h.ranges);
        const fresh = ranges.filter((r) => !overlaps(r));
        for (const r of fresh) {
          edits[r.page].push({ kind: "del", start: r.start, end: r.end, change });
          taken[r.page].push([r.start, r.end]);
        }
        const last = ranges.reduce((m, r) => (r.page > m.page || (r.page === m.page && r.end > m.end) ? r : m));
        edits[last.page].push({ kind: "ins", at: last.end, text: after, change });
        placed.push({ change, page: ranges[0].page, how: hits.length < before.length ? "part" : hits.some((h) => h.how === "ends") ? "ends" : fresh.length < ranges.length ? "again" : "exact" });
        continue;
      }
    }
    // a clause added (or text not found): after the clause it names
    const at = locateClause(index, change.clause);
    if (at) {
      edits[at.page].push({ kind: "ins", at: at.end, text: after, change, added: !before.length });
      placed.push({ change, page: at.page, how: before.length ? "clause" : "added" });
    } else {
      unplaced.push({ change, reason: before.length ? "the original text was not found in the document" : `clause ${change.clause} was not found in the document` });
    }
  }
  for (const list of edits) list.sort((a, b) => (a.kind === "del" ? a.start : a.at) - (b.kind === "del" ? b.start : b.at) || (a.kind === "del" ? -1 : 1));
  return { edits, placed, unplaced };
}

/**
 * A page's text cut into pieces for display: { text } as it stands, { del, change } struck,
 * { ins, change } inserted. `mode` "track" shows both, "amended" drops what is struck, "original"
 * shows the page as printed.
 */
export function pieces(text, edits, mode = "track") {
  if (mode === "original" || !edits?.length) return [{ text }];
  const out = [];
  let pos = 0;
  const marks = [];
  for (const e of edits) {
    if (e.kind === "del") marks.push({ at: e.start, open: e }, { at: e.end, close: e });
    else marks.push({ at: e.at, ins: e });
  }
  marks.sort((a, b) => a.at - b.at || (a.close ? -1 : b.close ? 1 : 0) || (a.ins ? 1 : b.ins ? 1 : 0));
  const open = [];
  const push = (to) => {
    if (to <= pos) return;
    const t = text.slice(pos, to);
    if (open.length) { if (mode === "track") out.push({ del: t, change: open[open.length - 1].change }); } else out.push({ text: t });
    pos = to;
  };
  for (const m of marks) {
    push(m.at);
    if (m.open) open.push(m.open);
    else if (m.close) open.splice(open.indexOf(m.close), 1);
    else out.push({ ins: m.ins.text, change: m.ins.change, added: Boolean(m.ins.added) });
  }
  push(text.length);
  return out;
}
