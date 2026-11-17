// Checks for the SECI FDRE-X content modules (web/src/fdrex/pack.js and formatsData.js): ids are
// unique and the keys the screens read are present; the documents' page counts and the printed
// "Page N of M" footers agree with pages, printedPages and pdfOffset; and every quote (the pack's
// amendment rows, dates and bid process, and every format's heading, blank contexts, attachments
// and notes) stands word for word on the PDF page it cites.
//
// The page texts come from the PDFs in web/public/tenders/seci-fdre-x/ through PyMuPDF
// (python3 -I -c ...): the repository has no PDF reader on the Node side. When python3 or PyMuPDF
// is missing the quote checks are skipped with a message and the structure checks still run.
// Both sides are whitespace-normalised as tests/engine/test_cfd_terms.py's _norm does (a hyphen
// at a line end joins the next line; any run of whitespace is one space).
// Run from the repository root:   node tools/check_fdrex_content.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACK, docById, pageHref } from "../web/src/fdrex/pack.js";
import { APPLIES, FORMATS, FORMAT_PAGES, RFS_FILE } from "../web/src/fdrex/formatsData.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "web", "public");

const norm = (s) => String(s).replace(/-[ \t]*\n\s*/g, "-").split(/\s+/).filter(Boolean).join(" ");
const list = (q) => (q ? (Array.isArray(q) ? q : [q]) : []);

// ---- the page texts of every document of the pack, when PyMuPDF is at hand
const files = Object.fromEntries(PACK.documents.filter((d) => d.file).map((d) => [d.id, path.join(PUBLIC, PACK.folder, d.file)]));
for (const [id, file] of Object.entries(files)) assert.ok(existsSync(file), `${id}: ${file} is in the repository`);
const DUMP = [
  "import json, sys",
  "try:",
  "    import pymupdf",
  "except ImportError:",
  "    import fitz as pymupdf",
  "print(json.dumps({k: [p.get_text('text') for p in pymupdf.open(v)] for k, v in json.loads(sys.argv[1]).items()}))",
].join("\n");
let pages = null;
let skipped = "";
try {
  const out = execFileSync("python3", ["-I", "-c", DUMP, JSON.stringify(files)], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  pages = JSON.parse(out);
} catch (err) {
  const why = err.code === "ENOENT" ? "python3 is not installed" : /No module named/.test(String(err.stderr)) ? "PyMuPDF is not installed (pip install pymupdf)" : String(err.stderr || err.message).trim().split("\n").pop();
  skipped = `Quote checks skipped: ${why}`;
}
const normPages = pages && Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, v.map(norm)]));

let quotes = 0;
/** A quote { doc, page, quote } is a document of the pack, on one of its pages, word for word. */
function checkQuote(q, where) {
  assert.ok(q && typeof q.quote === "string" && q.quote.trim().length > 0, `${where}: a quote`);
  const doc = docById[q.doc];
  assert.ok(doc, `${where}: document "${q.doc}" is in the pack`);
  assert.ok(Number.isInteger(q.page) && q.page >= 1 && q.page <= doc.pages, `${where}: page ${q.page} is within ${doc.title} (${doc.pages} pages)`);
  assert.equal(q.quote, q.quote.trim(), `${where}: no space around the quote`);
  if (normPages) {
    assert.ok(normPages[q.doc][q.page - 1].includes(norm(q.quote)), `${where}: "${q.quote.slice(0, 90)}" is not on PDF page ${q.page} of ${doc.title}`);
    quotes += 1;
  }
}

// ---- the pack: keys, documents and their page counting
for (const k of ["id", "short", "title", "issuer", "rfsNo", "rfsDate", "searchCode", "tenderedMw", "folder", "documents", "changes", "schedule", "bidProcess", "clarifications", "queries"]) {
  assert.ok(PACK[k] !== undefined && PACK[k] !== null && PACK[k] !== "", `PACK.${k}`);
}
assert.equal(PACK.id, "seci-fdre-x");
assert.equal(PACK.short, "SECI FDRE-X");
assert.equal(PACK.folder, "/tenders/seci-fdre-x/");
assert.equal(PACK.tenderedMw, 1200);
assert.match(PACK.rfsDate, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(RFS_FILE, `${PACK.folder}${docById.rfs.file}`, "RFS_FILE is the pack's RfS");
assert.deepEqual(PACK.documents.map((d) => d.id), ["rfs", "ppa", "psa", "amd1"], "the four documents");
assert.equal(Object.keys(docById).length, PACK.documents.length, "unique document ids");
for (const d of PACK.documents) {
  for (const k of ["id", "kind", "title", "ref", "file", "pages", "printedPages", "summary"]) assert.ok(d[k], `${d.id}.${k}`);
  assert.ok(["tender", "agreement", "amendment"].includes(d.kind), `${d.id}: kind`);
  assert.ok(Number.isInteger(d.pdfOffset) && d.pdfOffset >= 0, `${d.id}: pdfOffset`);
  assert.equal(d.pages, d.printedPages + d.pdfOffset, `${d.id}: pages = printed pages + offset`);
  assert.ok(d.summary.length > 120, `${d.id}: a paragraph of summary`);
  if (!pages) continue;
  assert.equal(pages[d.id].length, d.pages, `${d.id}: ${d.pages} PDF pages`);
  // every printed footer is "Page (PDF page - offset) of printedPages"; a cover or a schedule page may carry none
  let footers = 0;
  pages[d.id].forEach((text, i) => {
    const found = [...text.matchAll(/Page\s+(\d+)\s+of\s+(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    if (!found.length) return;
    assert.ok(found.some(([n, of]) => n === i + 1 - d.pdfOffset && of === d.printedPages), `${d.id}: PDF page ${i + 1} is printed "Page ${i + 1 - d.pdfOffset} of ${d.printedPages}"`);
    footers += 1;
  });
  assert.ok(footers >= d.printedPages - 1, `${d.id}: the printed footers were read (${footers} of ${d.printedPages})`);
}
if (normPages) {
  // the cover of the RfS carries the title, the number, the date and the search code
  const cover = normPages.rfs[0];
  assert.ok(cover.includes(norm(PACK.title)), "the title is the one on the RfS cover");
  assert.ok(cover.includes(`RfS No. ${PACK.rfsNo} dated ${PACK.rfsDate.split("-").reverse().join(".")}`), "the RfS number and date are those on the cover");
  assert.ok(cover.includes(`Tender Search Code on ISN-ETS: ${PACK.searchCode}`), "the search code is the one on the cover");
}

// ---- the amendment rows
assert.equal(new Set(PACK.changes.map((c) => c.id)).size, PACK.changes.length, "unique change ids");
for (const c of PACK.changes) {
  for (const k of ["id", "doc", "sno", "document", "clause", "topic", "after", "effect"]) assert.ok(c[k], `${c.id}.${k}`);
  assert.ok("before" in c, `${c.id}.before (a quote, quotes or null)`);
  assert.equal(docById[c.doc]?.kind, "amendment", `${c.id}: doc is an amendment`);
  assert.ok(["RfS", "PPA", "PSA"].includes(c.document), `${c.id}: document`);
  list(c.before).forEach((q, i) => checkQuote(q, `${c.id}.before[${i}]`));
  list(c.amendment).forEach((q, i) => checkQuote(q, `${c.id}.amendment[${i}]`));
  list(c.after).forEach((q, i) => checkQuote(q, `${c.id}.after[${i}]`));
  assert.ok(list(c.after).every((q) => q.doc === c.doc), `${c.id}: the amended text is quoted from the amendment`);
  assert.ok(pageHref(list(c.after)[0]).startsWith(`${PACK.folder}${docById[c.doc].file}#page=`), `${c.id}: a link to the amendment's page`);
  if (c.deleted) {
    // a deleted clause: quoted where it stands in the agreement, and the same words in the amendment's row
    assert.ok(list(c.before).length && list(c.before).every((q) => q.doc === c.document.toLowerCase()), `${c.id}: the clause as it stands in the ${c.document}`);
    assert.ok(list(c.amendment).length && list(c.amendment).every((q) => q.doc === c.doc), `${c.id}: the amendment's row`);
    assert.equal(list(c.after).map((q) => q.quote).join(" "), "Deleted.", `${c.id}: amended to "Deleted."`);
    const bare = (qs) => list(qs).map((q) => q.quote).join("").replace(/\s+/g, "");
    assert.equal(bare(c.amendment), bare(c.before), `${c.id}: the amendment prints the clause as it stands in the ${c.document}`);
  }
}
const a1 = PACK.changes.filter((c) => c.doc === "amd1");
assert.deepEqual(a1.filter((c) => c.document === "PPA").map((c) => c.clause), ["6.1.6", "6.1.7", "6.1.8", "6.1.9", "6.1.10", "6.1.11"], "Amendment-01, PPA rows");
assert.deepEqual(a1.filter((c) => c.document === "PSA").map((c) => c.clause), ["Recital XVI", "Recital XVII", "2.11.7", "2.11.8", "2.11.9", "2.11.10"], "Amendment-01, PSA rows");
assert.deepEqual(a1.map((c) => c.sno), [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6], "Amendment-01, row numbers");
if (normPages) {
  // no row of the amendment is left out: it prints "Deleted." once per row, and nothing else is amended
  const deletions = normPages.amd1.join(" ").split("Deleted.").length - 1;
  assert.equal(deletions, a1.length, "every row of Amendment-01");
}

// ---- the dates and the bid process
assert.equal(new Set(PACK.schedule.map((s) => s.id)).size, PACK.schedule.length, "unique schedule ids");
for (const s of PACK.schedule) {
  for (const k of ["id", "label", "status", "basis", "note"]) assert.ok(s[k], `schedule ${s.id}.${k}`);
  assert.ok(["rfs", "amendment", "notice", "website"].includes(s.basis), `schedule ${s.id}: basis`);
  assert.ok(s.date === null || /^\d{4}-\d{2}-\d{2}$/.test(s.date), `schedule ${s.id}: date`);
  assert.ok(s.time === null || /^\d{2}:\d{2}$/.test(s.time), `schedule ${s.id}: time`);
  if (s.basis === "website") assert.match(s.note, /website/, `schedule ${s.id}: a website-only date says so`);
  if (s.source) checkQuote(s.source, `schedule ${s.id}`);
}
PACK.bidProcess.forEach((p, i) => {
  assert.ok(p.step && p.detail && Array.isArray(p.sources) && p.sources.length, `bidProcess[${i}]: step, detail, sources`);
  p.sources.forEach((q, j) => checkQuote(q, `bidProcess[${i}] "${p.step}" source ${j}`));
});
assert.ok(Array.isArray(PACK.clarifications), "clarifications");
assert.ok(PACK.queries.length && PACK.queries.every((q) => typeof q === "string" && q.length > 40), "queries");

// ---- the formats
const MAPS = new Set(["contractedMw", "solarMw", "windMw", "otherReMw", "bessMw", "bessMwh", "emdAmount", "pbgAmount", "cacAmount", "rfsNo", "rfsDate", "title",
  "bidder", "leadMember", "address", "contact", "email", "phone", "signatory", "date", "place", "bidDeadline", "tariff", "emdForm", "substation", "site",
  "netWorthCr", "netWorthYear", "liquidityRoute", "turnoverCr", "pbditCr", "lineOfCreditCr",
  "psm"]); // psm: the bid's choice of cover under the Payment Security Mechanism (the model's input)
const KINDS = new Set(["text", "textarea", "number", "date", "choice", "table"]);
assert.equal(new Set(FORMATS.map((f) => f.id)).size, FORMATS.length, "unique format ids");
let blanks = 0;
let own = 0;
let extras = 0;
for (const f of FORMATS) {
  for (const k of ["id", "title", "pages", "applies", "submittedBy", "paper", "envelope", "when", "purpose", "heading", "fields"]) assert.ok(f[k], `${f.id}.${k}`);
  assert.ok(APPLIES.includes(f.applies), `${f.id}: applies "${f.applies}"`);
  assert.ok(["techno-commercial", "financial", "after the award"].includes(f.envelope), `${f.id}: envelope`);
  assert.ok(f.pages[0] >= FORMAT_PAGES[0] && f.pages[1] <= FORMAT_PAGES[1] && f.pages[0] <= f.pages[1], `${f.id}: pages within Section 7 and the annexures`);
  assert.ok(f.heading.page >= f.pages[0] && f.heading.page <= f.pages[1], `${f.id}: heading on its pages`);
  checkQuote(f.heading, `${f.id} heading`);
  assert.equal(new Set(f.fields.map((x) => x.key)).size, f.fields.length, `${f.id}: unique field keys`);
  for (const x of f.fields) {
    assert.ok(x.key && x.label && KINDS.has(x.kind), `${f.id}.${x.key}: key, label, kind`);
    assert.ok(x.maps === null || MAPS.has(x.maps), `${f.id}.${x.key}: maps "${x.maps}" is a name the formats logic knows`);
    assert.ok(x.context.page >= f.pages[0] && x.context.page <= f.pages[1], `${f.id}.${x.key}: context on the format's pages`);
    checkQuote(x.context, `${f.id}.${x.key}`);
    if (x.kind === "choice") assert.ok(Array.isArray(x.options) && x.options.length >= 2, `${f.id}.${x.key}: options`);
    if (x.when) assert.equal(x.when, "consortium", `${f.id}.${x.key}: when`);
    blanks += 1;
    if (x.maps === null) own += 1;
  }
  for (const a of [...(f.attachments || []), ...(f.notes || [])]) {
    assert.ok(a.label, `${f.id}: attachment or note label`);
    checkQuote(a.context, `${f.id} "${a.label.slice(0, 40)}"`);
    extras += 1;
  }
}
const ids = FORMATS.map((f) => f.id);
for (const id of ["7.1", "7.2", "7.3A", "7.3B", "7.3C", "7.3D", "7.3E", "7.3F", "7.4", "7.5", "7.6", "7.7", "7.8", "7.8A", "7.8-annex", "7.9", "7.10", "7.11", "7.12"]) {
  assert.ok(ids.includes(id), `Format ${id} of Section 7`);
}
if (normPages) {
  // no format of Section 7 is left out: every "Format 7.x" heading printed at the top of a page is here
  for (let p = FORMAT_PAGES[0]; p <= 108; p += 1) {
    const m = /Page \d+ of \d+ (?:SECTION 7\. .*?)?((?:Annexure to )?Format 7\.\d+ ?[A-F]?(?:\/7\.8A)?) [A-Z]{4}/.exec(normPages.rfs[p - 1]);
    if (m) assert.ok(FORMATS.some((f) => f.heading.page === p && norm(f.heading.quote).startsWith(m[1])), `PDF page ${p}: "${m[1]}" is among the formats`);
  }
}
for (const f of FORMATS.filter((x) => x.envelope === "financial")) assert.ok(["7.11", "7.12"].includes(f.id), `${f.id}: the financial envelope holds 7.11 and 7.12`);
assert.match(FORMATS.find((f) => f.id === "7.11").purpose, /single tariff.*two decimals.*39\.3/, "7.11: how the tariff is quoted, with the clause");

// ---- plain text: no em dash in what the screens show
const shown = JSON.stringify([PACK, FORMATS], (k, v) => (k === "quote" ? undefined : v));
assert.ok(!shown.includes("—"), "no em dash outside the quotes");

if (skipped) console.log(skipped);
console.log(`OK fdrex content: ${PACK.documents.length} documents, ${PACK.changes.length} amendment rows, ${PACK.schedule.length} dates, ${PACK.bidProcess.length} bid steps, ${PACK.queries.length} queries; ${FORMATS.length} formats, ${blanks} blanks (${own} of their own), ${extras} attachments and notes; ${pages ? `${quotes} quotes found on their PDF pages` : "quotes not checked"}`);
