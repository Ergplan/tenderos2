// A word-level diff of a clause as it stood and as amended, as HTML: <del> for words removed,
// <ins> for words added, long unchanged runs folded to their first and last words. Longest common
// subsequence on words; the clauses are a few hundred words at most.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const KEEP = 14; // words of unchanged text kept on each side of a change

export function wordDiff(before, after) {
  const a = before ? before.split(/\s+/).filter(Boolean) : [];
  const b = after ? after.split(/\s+/).filter(Boolean) : [];
  if (!a.length) return { html: `<ins>${esc(b.join(" "))}</ins>`, added: b.length, removed: 0, isNew: true };
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const runs = [];
  const push = (kind, w) => { const last = runs[runs.length - 1]; if (last && last.kind === kind) last.words.push(w); else runs.push({ kind, words: [w] }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]); i += 1; j += 1; } else if (L[i + 1][j] >= L[i][j + 1]) { push("del", a[i]); i += 1; } else { push("ins", b[j]); j += 1; }
  }
  while (i < n) { push("del", a[i]); i += 1; }
  while (j < m) { push("ins", b[j]); j += 1; }
  let added = 0, removed = 0;
  const html = runs.map((r, k) => {
    if (r.kind === "del") { removed += r.words.length; return `<del>${esc(r.words.join(" "))}</del>`; }
    if (r.kind === "ins") { added += r.words.length; return `<ins>${esc(r.words.join(" "))}</ins>`; }
    const w = r.words;
    const first = k === 0, last = k === runs.length - 1;
    if (w.length <= KEEP * 2 + 6) return esc(w.join(" "));
    const head = first ? [] : w.slice(0, KEEP), tail = last ? [] : w.slice(-KEEP);
    return `${esc(head.join(" "))} <span class="fold">… ${w.length - head.length - tail.length} words unchanged …</span> ${esc(tail.join(" "))}`;
  }).join(" ");
  return { html, added, removed, isNew: false };
}
