// Downloading the letters: Word from the web server (app/api/seci/letters), PDF from the engine
// (POST /api/bid/document/pdf, PyMuPDF). Both take the letters as rendered here, so the files
// hold exactly what the letter view shows: the values, the struck alternatives and the edits.
import { LETTER_CSS, letterHtml } from "./index.js";

/** A letter as the Word route reads it: blocks of runs (text, value, missing, struck). */
export function letterPayload(letter) {
  const run = (s) => ({ text: s.text, value: Boolean(s.key), missing: Boolean(s.missing), struck: Boolean(s.struck) });
  return {
    id: letter.id,
    title: letter.title,
    paper: letter.paper,
    letterhead: letter.letterhead,
    bidder: letter.bidder,
    address: letter.address,
    blocks: letter.blocks.filter((b) => !b.omitted).map((b) => (b.type === "table"
      ? { type: "table", rows: b.rows.map((row) => row.map((cell) => cell.map(run))) }
      : { type: b.type, struck: Boolean(b.struck), runs: b.segments.map(run) })),
  };
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      const data = await res.json();
      msg = data.error || data.detail || msg;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.blob();
}

export function letterFileName(letters, bidder, prefix = "SECI_RTC_TM_V") {
  const who = String(bidder || "Bidder").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  const what = letters.length === 1 ? `Format_${letters[0].id.replace(/[^A-Za-z0-9.-]+/g, "_")}` : "Bid_letters";
  return `${prefix}_${what}_${who}`;
}

/**
 * Download the letters as one Word file ("word") or one PDF ("pdf"), each letter from a new page.
 * route: the Word route of the tender pack (the CfD tab's is /api/cfd/letters); prefix: the file name's.
 */
export async function downloadLetters(letters, kind, { route = "/api/seci/letters", prefix = "SECI_RTC_TM_V" } = {}) {
  const name = letterFileName(letters, letters[0]?.bidder, prefix);
  if (kind === "pdf") {
    const blob = await post("/api/bid/document/pdf", { title: name.replace(/_/g, " "), css: LETTER_CSS, parts: letters.map(letterHtml) });
    save(blob, `${name}.pdf`);
    return;
  }
  const blob = await post(route, { fileName: name, letters: letters.map(letterPayload) });
  save(blob, `${name}.docx`);
}
