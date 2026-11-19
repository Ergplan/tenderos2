// The amended documents in track-change form (web/src/tender/trackChanges.js): for each tender pack,
// each document an amendment changes is laid out with its changes, and every change row must be
// placed in the text (struck and replaced, or added after its clause) or listed with the reason.
// Fails when a pack's change is placed nowhere and not listed, when the text files are missing, or
// when fewer changes are placed than the floor below (so a rebuild of the text that loses them
// shows). Run: node tools/check_tracked_documents.mjs [--verbose]
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { documentFor, pieces, trackDocument } from "../web/src/tender/trackChanges.js";
import { PACK as FDREX } from "../web/src/fdrex/pack.js";
import { PACK as CFD } from "../web/src/cfd/pack.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECI = JSON.parse(readFileSync(join(ROOT, "web/src/seci/seci-rtc-tm-v.json"), "utf8"));
const verbose = process.argv.includes("--verbose");
let failed = 0;
const fail = (m) => { failed += 1; console.log(`FAIL ${m}`); };

// the share of each pack's changes (on documents in the pack) that must be placed in the text
const FLOOR = 0.8;

for (const pack of [SECI, CFD, FDREX]) {
  const groups = new Map();
  for (const c of pack.changes) {
    const doc = documentFor(pack.documents, c.document);
    const key = doc?.file ? doc.id : `(${c.document}: no PDF in the pack)`;
    if (!groups.has(key)) groups.set(key, { doc: doc?.file ? doc : null, rows: [] });
    groups.get(key).rows.push(c);
  }
  let placedAll = 0;
  let total = 0;
  for (const [key, { doc, rows }] of groups) {
    if (!doc) { console.log(`--   ${pack.short} ${key}: ${rows.length} change(s) not shown in the text`); continue; }
    const file = join(ROOT, "web/public", pack.folder, "text", doc.file.replace(/\.pdf$/i, ".json"));
    if (!existsSync(file)) { fail(`${pack.short} ${doc.title}: no text file ${file} (run python3 tools/build_tender_text.py)`); continue; }
    const { pages } = JSON.parse(readFileSync(file, "utf8"));
    const t = trackDocument(pages, rows, doc.id);
    if (t.placed.length + t.unplaced.length !== rows.length) fail(`${pack.short} ${doc.title}: ${rows.length} rows, ${t.placed.length} placed + ${t.unplaced.length} listed`);
    // every page still reads as its own text in "original" and "amended" keeps the inserted text
    t.edits.forEach((list, p) => {
      const orig = pieces(pages[p], list, "original").map((x) => x.text).join("");
      if (orig !== pages[p]) fail(`${pack.short} ${doc.title} page ${p + 1}: original view differs from the text`);
      const track = pieces(pages[p], list, "track");
      const kept = track.map((x) => x.text ?? x.del ?? "").join("");
      if (kept !== pages[p]) fail(`${pack.short} ${doc.title} page ${p + 1}: track view loses text`);
    });
    const how = {};
    for (const x of t.placed) how[x.how] = (how[x.how] || 0) + 1;
    placedAll += t.placed.length;
    total += rows.length;
    console.log(`ok   ${pack.short} ${doc.title}: ${t.placed.length} of ${rows.length} changes placed (${Object.entries(how).map(([k, v]) => `${k} ${v}`).join(", ")})${t.unplaced.length ? `; ${t.unplaced.length} listed at the top` : ""}`);
    if (verbose) for (const u of t.unplaced) console.log(`       not placed: ${u.change.id} (${u.change.clause}): ${u.reason}`);
    if (verbose) for (const x of t.placed) console.log(`       ${x.how.padEnd(6)} ${x.change.id} (${x.change.clause}) page ${x.page + 1}`);
  }
  if (total && placedAll / total < FLOOR) fail(`${pack.short}: only ${placedAll} of ${total} changes placed in the text (floor ${FLOOR * 100}%)`);
}
console.log(failed ? `${failed} failed` : "all tracked documents ok");
process.exit(failed ? 1 : 0);
