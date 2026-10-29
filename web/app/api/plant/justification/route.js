import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { requireTenderAccess } from "@/lib/tenders";
import { logEvent } from "@/lib/activity";
import { docxBuffer, docxResponse, para, str, table } from "@/lib/docx";

export const dynamic = "force-dynamic";

// The 25-year CUF justification as a Word file (.docx), a note for the bid pack. The browser sends
// the title and the paragraphs it shows (web/src/plant/justification.js) and the by-year CUF table;
// this route only lays them out: the title, the date, one heading and paragraph per section, and
// the table of one row per PPA year, A4 portrait.

const COLS = [
  ["Year", 1100],
  ["Degradation factor", 2200],
  ["CUF", 2000],
  ["Energy per MW (MWh)", 2300],
  ["Cumulative (MWh per MW)", 2306],
];

const fmt = (v, d) => (Number.isFinite(v) ? v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");

function bodyXml({ title, date, paragraphs, rows, source }) {
  const parts = [
    para(title, { bold: true, size: 26, after: 80 }),
    para(`${source ? `${source} · ` : ""}Prepared ${date}`, { italic: true, size: 18, color: "555555", after: 200 }),
  ];
  for (const p of paragraphs) {
    parts.push(para(p.heading, { bold: true, size: 22, before: 120, after: 60 }));
    parts.push(para(p.text, { after: 100 }));
  }
  if (rows.length) {
    parts.push(para("CUF by PPA year, as the model applies it", { bold: true, size: 22, before: 160, after: 80 }));
    parts.push(table(COLS, rows.map((r) => [String(r.year), fmt(r.factor, 3), `${fmt(r.cuf * 100, 2)}%`, fmt(r.mwhPerMw, 0), fmt(r.cumulative, 0)])));
    parts.push(para("", { after: 0 }));
  }
  return parts.join("");
}

export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  requireTenderAccess(user);
  const body = await req.json();
  const paragraphs = (Array.isArray(body?.paragraphs) ? body.paragraphs.slice(0, 20) : [])
    .map((p) => ({ heading: str(p?.heading, 200), text: str(p?.text, 6000) }))
    .filter((p) => p.heading || p.text);
  if (!paragraphs.length) throw new HttpError(400, "There is no justification text to write.");
  const rows = (Array.isArray(body?.rows) ? body.rows.slice(0, 40) : [])
    .map((r) => ({ year: Number(r?.year), factor: Number(r?.factor), cuf: Number(r?.cuf), mwhPerMw: Number(r?.mwhPerMw), cumulative: Number(r?.cumulative) }))
    .filter((r) => Number.isFinite(r.year));
  const kind = body?.kind === "wind" ? "wind" : "solar";
  const title = str(body?.title, 300) || `${kind === "wind" ? "Wind" : "Solar"} CUF: why one year's hourly profile is used for the PPA`;
  const date = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

  const buffer = await docxBuffer({
    title, author: user.name || user.email,
    body: bodyXml({ title, date, paragraphs, rows, source: str(body?.source, 300) }),
  });

  await logEvent({ user, kind: "export", detail: { what: `${kind}_cuf_justification.docx`, paragraphs: paragraphs.length, years: rows.length }, req });
  return docxResponse(buffer, `${kind}_cuf_justification.docx`);
});
