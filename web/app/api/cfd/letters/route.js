import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { logEvent } from "@/lib/activity";
import { docxBuffer, docxResponse, pageBreak, runsPara, str, table } from "@/lib/docx";

export const dynamic = "force-dynamic";

// SECI CfD-I: the bid formats as full letters in one Word file, each from a new page. The browser
// sends each letter as it shows it (web/src/seci/letters/export.js letterPayload): the RfS wording
// in blocks of runs, the values from the blanks, the alternatives struck out and the bidder's own
// wording where they edited it. This route only lays them out on A4 (as app/api/seci/letters does).

const FONT = "Times New Roman";
const WIDTH = 9900; // A4 between the margins, in twips

function runsOf(runs, extra = {}) {
  return (Array.isArray(runs) ? runs : []).slice(0, 400).map((r) => [str(r.text, 8000), { font: FONT, size: 22, strike: Boolean(r.struck || extra.strike), ...extra.opts }]);
}

const lines = (b) => (Array.isArray(b.runs) ? b.runs : []).some((r) => String(r.text ?? "").includes("\n"));

function letterXml(letter) {
  const out = [];
  if (letter.letterhead && letter.bidder) {
    out.push(runsPara([[str(letter.bidder, 200), { font: FONT, bold: true, size: 28 }]], { align: "center", after: 0 }));
    out.push(runsPara([[str(letter.address, 400).replace(/\n/g, ", "), { font: FONT, size: 18, color: "555555" }]], { align: "center", after: 60 }));
    out.push(runsPara([["______________________________________________________________________________", { font: FONT, size: 18, color: "333333" }]], { align: "center", after: 200 }));
  } else if (letter.paper) {
    out.push(runsPara([[`[To be printed on: ${str(letter.paper, 200)}]`, { font: FONT, italic: true, size: 18, color: "666666" }]], { align: "center", after: 200 }));
  }
  for (const b of (Array.isArray(letter.blocks) ? letter.blocks : []).slice(0, 400)) {
    if (b.type === "table") {
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 60);
      const n = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
      const w = Math.floor(WIDTH / n);
      const header = rows.length > 1 && n > 2;
      const cells = rows.map((r) => Array.from({ length: n }, (_, i) => ({ runs: runsOf(r[i]).map(([t, o]) => [t, { ...o, size: 19 }]) })));
      const cols = Array.from({ length: n }, (_, i) => [header ? cells[0][i] : "", w]);
      out.push(table(cols, header ? cells.slice(1) : cells, { header, colOpts: [] }));
      out.push(runsPara([["", {}]], { after: 60 }));
      continue;
    }
    if (b.type === "heading") out.push(runsPara(runsOf(b.runs, { opts: { bold: true, size: 24 } }), { align: "center", after: 40 }));
    else if (b.type === "subheading") out.push(runsPara(runsOf(b.runs, { opts: { bold: true } }), { before: 160, after: 60 }));
    else if (b.type === "note") out.push(runsPara(runsOf(b.runs, { opts: { italic: true, color: "444444", size: 20 } }), { after: 120, align: lines(b) ? null : "both" }));
    else out.push(runsPara(runsOf(b.runs, { strike: b.struck }), { after: 140, align: lines(b) ? null : "both" }));
  }
  return out.join("");
}

export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !user.allowedTabs?.includes("cfd")) throw new HttpError(403, "No access to the CfD Bid tab.");
  const body = await req.json();
  const letters = (Array.isArray(body?.letters) ? body.letters : []).slice(0, 30);
  if (!letters.length) throw new HttpError(400, "No letters to write.");
  const xml = letters.map((l, i) => (i ? pageBreak() : "") + letterXml(l)).join("");
  const bidder = letters[0]?.bidder;
  const buffer = await docxBuffer({ title: `SECI CfD-I bid letters${bidder ? `: ${str(bidder, 120)}` : ""}`, author: str(bidder, 200) || user.name || user.email, body: xml });
  await logEvent({ user, kind: "export", detail: { what: "cfd-letters.docx", letters: letters.map((l) => str(l.id, 20)) }, req });
  return docxResponse(buffer, `${str(body.fileName, 100).replace(/[^\w.-]+/g, "_") || "bid_letters"}.docx`);
});
