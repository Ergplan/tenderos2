// @mentions in team messages, shared by the browser and the server: each member's handle (their
// name in lower case, words joined by dots: "Finance desk" -> @finance.desk), the handles a
// message mentions, and the field a message is about. Plain JavaScript (tools/check_team_messages.mjs).

/** A member's handle: the name in lower case, letters and digits, words joined by dots. */
export function handleOf(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "member";
}

/** Handles for a list of members, unique (a second "Priya" becomes priya.2). */
export function withHandles(members) {
  const seen = new Map();
  return members.map((m) => {
    const base = handleOf(m.name);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { ...m, handle: n === 1 ? base : `${base}.${n}` };
  });
}

/** The members a message mentions with @handle (a handle followed by anything but a letter, digit or dot). */
export function mentionedIn(body, members) {
  const text = String(body || "").toLowerCase();
  const out = [];
  for (const m of withHandles(members)) {
    const re = new RegExp(`(^|[^a-z0-9.])@${m.handle.replace(/\./g, "\\.")}(?![a-z0-9]|\\.[a-z0-9])`);
    if (re.test(text)) out.push(m);
  }
  return out;
}

/** The @word being typed at the caret (for the suggestion list), or null. */
export function mentionAt(text, caret) {
  const before = String(text).slice(0, caret);
  const m = /(^|\s)@([a-z0-9.]*)$/i.exec(before);
  return m ? { query: m[2].toLowerCase(), start: caret - m[2].length - 1 } : null;
}

/** Members matching what is typed after @: tab owners first, then by handle. */
export function suggest(members, query, tab = null, limit = 6) {
  const q = String(query || "").toLowerCase();
  return withHandles(members)
    .filter((m) => !q || m.handle.includes(q) || String(m.name).toLowerCase().includes(q) || String(m.title || "").toLowerCase().includes(q))
    .sort((a, b) => Number((b.tabs || []).includes(tab)) - Number((a.tabs || []).includes(tab)) || a.handle.localeCompare(b.handle))
    .slice(0, limit);
}

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** A field's thread key: the tab and the input's test id, else its section and label. */
export function threadKey(tab, { testId = null, name = null, section = "", label = "" }) {
  if (testId) return `${tab}:${testId}`;
  return `${tab}:${slug(section) || "page"}:${slug(name || label) || "field"}`;
}
