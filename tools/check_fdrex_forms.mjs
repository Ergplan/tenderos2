// Checks for the SECI-FDRE-X bid forms (web/src/fdrex/formats.js, forms.js, letters/*): every
// format has its letter, every {{key}} of every template is a blank of its format and every
// blank has its place, each alternative names an option; the letters' wording is the RfS's own
// (each stretch of text between two blanks is found on the format's PDF pages, letters and digits
// compared; skipped with a message when python3 or PyMuPDF is missing); a filled bid leaves no
// blank or "undefined" in any letter; the formats this bid needs are counted right for each EMD
// and PBG instrument; and the checks pass a good bid and flag a bad one.
// The data itself (headings, blank contexts, pages) is checked by tools/check_fdrex_content.mjs.
// Run from the repository root:   node tools/check_fdrex_forms.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORMATS, RFS_FILE, TENDER, applies, blankValue, formatGroups, formatName, formatPrint, formatStatus, formatsForPack, formatsSummary, modelValues } from "../web/src/fdrex/formats.js";
import { FORM_FIELDS, INSTRUMENTS, bidChecks, bidPackRequest, formIssues, termProv, visibleFields } from "../web/src/fdrex/forms.js";
import { TEMPLATES, letterHtml, letterOf, lettersForBid, parseTemplate } from "../web/src/fdrex/letters/index.js";
import { FILE_PREFIX, LETTERS_ROUTE } from "../web/src/fdrex/letters/export.js";
import { inlineOf, segments, tokensOf } from "../web/src/seci/letters/index.js";
import { letterPayload } from "../web/src/seci/letters/export.js";
import { defaultCfdState, keyDates, rfsAmounts } from "../web/src/fdrex/model.js";
import { PACK } from "../web/src/fdrex/pack.js";
import { RFS, TERMS, cite, termById } from "../web/src/fdrex/terms.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const byId = (id) => FORMATS.find((f) => f.id === id);
const shared = new Set(FORM_FIELDS.map((x) => x.key));
/** The options a choice blank shows: the particular's labels when it maps to one, else its own. */
const optionsOf = (field) => (field.maps && shared.has(field.maps) ? FORM_FIELDS.find((x) => x.key === field.maps).options.map(([, l]) => l) : field.options);

// ---- templates: one per format; every token a blank, every blank placed, every alternative an option
assert.equal(FORMATS.length, 23, "Formats 7.1 to 7.12 (7.3A to F, 7.8A, the annexure to 7.8) and Annexures A, C, K, H");
assert.deepEqual(Object.keys(TEMPLATES).sort(), FORMATS.map((f) => f.id).sort(), "a letter for every format, and no other");
let tokens = 0;
for (const f of FORMATS) {
  const t = TEMPLATES[f.id];
  const keys = new Set(f.fields.map((x) => x.key));
  const blocks = parseTemplate(t.text);
  assert.ok(blocks.length >= 2 && blocks[0].type === "heading", `${f.id}: parses to blocks headed by the format name`);
  const used = new Set();
  for (const b of blocks) {
    const texts = b.type === "table" ? b.rows.flat() : [b.text];
    for (const text of texts) for (const k of tokensOf(text)) {
      assert.ok(keys.has(k), `${f.id}: {{${k}}} is a blank of the format`);
      used.add(k);
      tokens += 1;
    }
    for (const alt of [...(b.cond ? [{ key: b.cond.key, option: b.cond.value }] : []), ...texts.flatMap((text) => inlineOf(text))]) {
      const field = f.fields.find((x) => x.key === alt.key);
      assert.ok(field && field.kind === "choice", `${f.id}: the alternative on ${alt.key} is a choice blank`);
      assert.ok(optionsOf(field).includes(alt.option), `${f.id}: ${alt.key}=${alt.option} names an option (${optionsOf(field).join(" | ")})`);
      used.add(alt.key);
    }
  }
  const omit = new Set(t.omit || []);
  for (const k of omit) assert.ok(keys.has(k), `${f.id}: omit ${k} is a field`);
  for (const x of f.fields) assert.ok(used.has(x.key) || omit.has(x.key) || x.kind === "choice", `${f.id}: blank ${x.key} has a place in the letter`);
}
// the options the letters and the particulars share are spelt the same in the data and in the particulars
assert.deepEqual(byId("7.1").fields.find((x) => x.key === "emdForm").options, INSTRUMENTS.emd.map(([, l]) => l), "7.1: the three EMD instruments");
assert.deepEqual(byId("7.6").fields.find((x) => x.key === "liquidityRoute").options, FORM_FIELDS.find((x) => x.key === "liquidityRoute").options.map(([, l]) => l), "7.6: the three liquidity routes");
assert.equal(RFS_FILE, `${PACK.folder}RfS.pdf`);
assert.equal(LETTERS_ROUTE, "/api/fdrex/letters");

// ---- the letters' wording is the RfS's: each stretch between blanks stands on the format's pages
const DUMP = ["import json, sys", "try:", "    import pymupdf", "except ImportError:", "    import fitz as pymupdf",
  "print(json.dumps([p.get_text('text') for p in pymupdf.open(sys.argv[1])]))"].join("\n");
let rfsPages = null;
let skipped = "";
try {
  rfsPages = JSON.parse(execFileSync("python3", ["-I", "-c", DUMP, path.join(ROOT, "web", "public", RFS_FILE)], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
} catch (err) {
  skipped = `Wording check skipped: ${err.code === "ENOENT" ? "python3 is not installed" : /No module named/.test(String(err.stderr)) ? "PyMuPDF is not installed (pip install pymupdf)" : String(err.stderr || err.message).trim().split("\n").pop()}`;
}
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
// Two things a letter prints that its own page does not, both values rather than wording:
// SECI's address where the format says "(Enter Address of SECI)" (as Format 7.1 prints it, PDF p. 66),
// and the unit "Crore" after an amount the bid holds in ₹ crore (Format 7.6 leaves the unit open).
const SECI_ADDRESS = "To\nSolar Energy Corporation of India Limited\n6th Floor, Plate-B, NBCC Office Block Tower-2,\nEast Kidwai Nagar, New Delhi - 110 023";
let stretches = 0;
const notRfs = [];
if (rfsPages) {
  assert.equal(rfsPages.length, PACK.documents.find((d) => d.id === "rfs").pages, "the RfS PDF of the pack");
  assert.ok(squash(rfsPages[65]).includes(squash(SECI_ADDRESS)), "SECI's address as Format 7.1 prints it");
  // a page without its running header ("RfS for assured Peak Supply ... Page 65 of 138"), so text runs on over a page break
  const body = (p) => rfsPages[p - 1].replace(/^[\s\S]*?Page\s+\d+\s+of\s+\d+/, "");
  for (const f of FORMATS) {
    const pages = [];
    for (let p = f.pages[0]; p <= f.pages[1]; p += 1) pages.push(p);
    // an annexure returned as it is printed is introduced by the clause that asks for it (its attachment's or note's page)
    const cited = [...(f.attachments || []), ...(f.notes || [])].map((a) => a.context.page).filter((p) => !pages.includes(p));
    const hay = squash(pages.map(body).join(" ")) + cited.map((p) => ` ${squash(body(p))}`).join("");
    const addressAsked = /Enter Address of SECI/.test(pages.map(body).join(" "));
    for (const b of parseTemplate(TEMPLATES[f.id].text)) {
      for (const text of b.type === "table" ? b.rows.flat() : [b.text]) {
        // the wording without the template's own marks: the inline alternatives keep their text, the blanks cut it
        const plain = text.replace(/\[\[[A-Za-z0-9_]+=[^|\]]+\|([^\]]*)\]\]/g, "$1");
        for (const part of plain.split(/\{\{[A-Za-z0-9_:]+\}\}/)) {
          const stretch = (addressAsked ? part.replace(SECI_ADDRESS, "") : part).replace(/^ Crore\b/, "");
          if (squash(stretch).length < 24) continue; // too short to tell: "Date:", "MW", "Dated the"
          const found = hay.includes(squash(stretch)) || stretch.split("\n").every((line) => squash(line).length < 24 || hay.includes(squash(line)));
          if (!found) notRfs.push(`${f.id} (PDF pp. ${f.pages.join("-")}): "${stretch.trim().slice(0, 160)}"`);
          stretches += 1;
        }
      }
    }
  }
  assert.deepEqual(notRfs, [], `not the RfS's wording:\n${notRfs.join("\n")}`);
}

// ---- a filled bid: no blank, no "undefined", every letter complete
const state = defaultCfdState();
state.inputs = { ...state.inputs, contractedMw: 100, solarMw: 400, windMw: 0, essMwPerMw: 1, essMwhPerMw: 4, extraEssMwhPerMw: 0, effectiveDate: "2027-06-01", sellMarket: "DAM", psm: true, gstRate: 0.18 };
state.forms = {
  bidder: "Arkaja Renewables Private Limited", bidderType: "company", address: "12 Energy Park\nPune 411001", contact: "Priya Sharma", email: "bids@arkaja.example", phone: "+91 20 1234 5678",
  commonShareholding: "no", signatory: "Priya Sharma, Director", letterDate: "2026-11-25", place: "Pune", bidDeadline: "2026-12-01", tariff: 5.25, emdForm: "bg",
  substation: "Bhadla-III PS (400 kV)", connectivity: "applied", connectivityBy: "own", site: "Ramgarh, Jaisalmer, Rajasthan", netWorthCr: 520, netWorthYear: "2025-26", liquidityRoute: "turnover", turnoverCr: 90,
};
const mv = modelValues(state);
assert.equal(mv.contractedMw, "100");
assert.equal(mv.bessMw, "100");
assert.equal(mv.bessMwh, "400", "4 MWh per contracted MW");
assert.equal(mv.emdAmount, `INR ${(968000 * 400 + 240000 * 400).toLocaleString("en-IN")}`, "EMD on the installed capacity (RfS 16)");
assert.equal(mv.pbgAmount, `INR ${(2420000 * 400 + 600000 * 400).toLocaleString("en-IN")}`, "PBG on the installed capacity (RfS 17.1)");
assert.equal(mv.cacAmount, `INR ${(100000 * 800).toLocaleString("en-IN")}`, "Success Charges: INR 1 lakh per MW of Installed Capacity, the storage counted in MWh (400 MW solar + 400 MWh storage, RfS 18.1)");
assert.equal(mv.rfsNo, PACK.rfsNo);
assert.equal(mv.rfsDate, "07.10.2026");
assert.equal(mv.title, RFS.title);
assert.match(mv.psm, /^Accepted/, "the bid opts for cover under the Payment Security Mechanism");
assert.match(modelValues({ ...state, inputs: { ...state.inputs, psm: false } }).psm, /^Not accepted/);
assert.equal(modelValues({ ...state, inputs: { ...state.inputs, psm: null } }).psm, "", "no answer until the bid chooses");
assert.equal(modelValues({ ...state, inputs: { ...state.inputs, extraEssMwhPerMw: 1 } }).bessMwh, "500", "the extra battery counts in the storage the EMD is worked on");
assert.equal(blankValue(state, byId("7.1"), byId("7.1").fields.find((x) => x.key === "psmRebate")).source, "model", "7.1 para 5 takes the bid's choice");
assert.equal(blankValue(state, byId("H"), byId("H").fields.find((x) => x.key === "successChargesAmount")).value, mv.cacAmount, "Annexure-H carries the Success Charges");
const fill = (st) => {
  for (const f of FORMATS) {
    for (const x of f.fields) {
      const b = blankValue(st, f, x);
      if (b.source === "own" && !b.value) st.forms[b.key] = x.kind === "date" ? "2026-11-15" : x.kind === "number" ? 10 : x.kind === "choice" ? x.options[0] : x.kind === "table" ? "Row one\nRow two" : `Test ${x.key}`;
    }
  }
  return st;
};
fill(state);
assert.deepEqual(formIssues(state), [], "every required particular is in");
// the consortium's formats, the surety bond, the common shareholder and another entity's connectivity are checked on such a bid
const consortium = fill({ ...state, forms: { ...state.forms, bidderType: "consortium", leadMember: "Arkaja Renewables Private Limited", emdForm: "surety", commonShareholding: "yes", connectivityBy: "other" } });
// and the Payment on Order Instrument on a bid that chooses it for the EMD and the PBG
const poi = fill({ ...state, forms: { ...state.forms, emdForm: "poi", pbgForm: "poi" } });
for (const f of FORMATS) {
  const st = applies(state, f) !== "no" ? state : applies(consortium, f) !== "no" ? consortium : poi;
  assert.notEqual(applies(st, f), "no", `${f.id}: needed by one of the three test bids`);
  const letter = letterOf(st, f);
  assert.ok(letter, `${f.id}: letter`);
  const html = letterHtml(letter);
  assert.ok(!html.includes("{{") && !html.includes("undefined") && !html.includes("[["), `${f.id}: no token or undefined left in the letter`);
  assert.deepEqual(letter.missing, [], `${f.id}: nothing missing`);
  assert.ok(!letter.blocks.some((b) => b.choose), `${f.id}: no alternative left to choose`);
  const payload = letterPayload(letter);
  assert.ok(payload.blocks.length >= 1 && payload.blocks.every((b) => b.type === "table" || Array.isArray(b.runs)), `${f.id}: Word payload`);
  assert.equal(letter.letterhead, /letter\s*head/i.test(f.paper), `${f.id}: letterhead as the format's paper says`);
  if (f.id === "7.1") {
    const paras = letter.blocks.filter((b) => b.type === "para");
    assert.ok(paras.some((b) => b.struck && /Format 7.8A/.test(b.text)), "7.1: the 7.8A alternative is struck out for a bidder with no common shareholder");
    const emd = paras.find((b) => /enclosed EMD/.test(b.text));
    const kept = emd.segments.filter((s) => s.alt && !s.struck).map((s) => s.alt.option);
    const struck = [...new Set(emd.segments.filter((s) => s.alt && s.struck).map((s) => s.alt.option))];
    assert.deepEqual([...new Set(kept)], ["Bank Guarantee (Format 7.3A)"], "7.1: the bank guarantee is kept");
    assert.deepEqual(struck, ["Payment on Order Instrument (Format 7.3B)", "Insurance Surety Bond (Format 7.3C)"], "7.1: the POI and the surety bond are struck");
    assert.ok(html.includes("INR 48,32,00,000"), "7.1: the EMD amount");
    const psmPara = (st2) => letterOf(st2, f).blocks.find((b) => b.type === "para" && /rebate of Rs\. 0\.02\/kWh/.test(b.text));
    assert.ok(!psmPara(state).struck && !psmPara(state).choose, "7.1: para 5 stands when the bid opts for the cover");
    assert.ok(psmPara({ ...state, inputs: { ...state.inputs, psm: false } }).struck, "7.1: para 5 is struck out when the bid does not opt for it");
    assert.ok(psmPara({ ...state, inputs: { ...state.inputs, psm: null } }).choose, "7.1: para 5 is still to choose until the bid says");
    assert.ok(paras.some((b) => /already been commissioned/.test(b.text) && b.struck), "7.1: para 4 is struck out for a new project");
    const poiEmd = letterOf(poi, f).blocks.find((b) => b.type === "para" && /enclosed EMD/.test(b.text));
    assert.deepEqual([...new Set(poiEmd.segments.filter((s) => s.alt && !s.struck).map((s) => s.alt.option))], ["Payment on Order Instrument (Format 7.3B)"], "7.1: a POI bid keeps the POI");
  }
  if (f.id === "7.4") {
    assert.ok(letter.blocks.some((b) => b.omitted && b.only === "consortium") && !letter.blocks.some((b) => b.omitted && b.only === "company"), "7.4: the consortium resolutions are left out for a company");
    const cl = letterOf(consortium, f);
    assert.ok(cl.blocks.some((b) => b.omitted && b.only === "company") && !cl.blocks.some((b) => b.omitted && b.only === "consortium") && cl.missing.length === 0, "7.4: a consortium's resolutions are in, with the equity share");
  }
  if (f.id === "7.6") {
    const paras = letter.blocks.filter((b) => b.type === "para" && b.cond);
    assert.ok(paras.some((b) => b.cond.value.startsWith("Annual turnover") && !b.struck) && paras.some((b) => b.cond.value.startsWith("PBDIT") && b.struck), "7.6: the turnover route is kept, PBDIT struck");
    const loc = letterOf({ ...state, forms: { ...state.forms, liquidityRoute: "loc", lineOfCreditCr: 25 } }, f);
    assert.ok(loc.blocks.filter((b) => b.type === "para" && b.cond).every((b) => b.struck) && loc.missing.length === 0, "7.6: on the line-of-credit route both paragraphs are struck out");
    assert.ok(letterOf(consortium, f).blocks.some((b) => b.only === "consortium" && !b.omitted), "7.6: a consortium's Exhibit (ii) is in");
  }
  if (f.id === "H") assert.ok(html.includes("INR 8,00,00,000"), "Annexure-H: the Success Charges amount (400 MW and 400 MWh installed)");
}
// the letters of the bid: the EMD bank guarantee in; the POI, the surety bond, the consortium formats, 7.8A and Annexure-K out; the PBG formats and Annexure-H after the award
const ids = lettersForBid(state).map((l) => l.id);
assert.deepEqual(ids, ["7.1", "7.3A", "7.4", "7.6", "7.7", "7.8", "7.8-annex", "7.9", "7.10", "A", "C", "7.11", "7.12"], `the letters of a single-company bid with a bank guarantee: ${ids}`);
const sum = formatsSummary(state);
assert.deepEqual([sum.needed, sum.complete, sum.blanksLeft], [13, 13, 0], `summary ${JSON.stringify(sum)}`);
assert.equal(sum.reviewed, 0);
const groups = formatGroups(state);
const group = (gs, id) => (gs.find((g) => g.id === id)?.list || []).map((f) => f.id);
assert.deepEqual(groups.map((g) => g.id), ["envelope1", "envelope2", "later", "na"]);
assert.deepEqual(group(groups, "envelope1"), ["7.1", "7.3A", "7.4", "7.6", "7.7", "7.8", "7.8-annex", "7.9", "7.10", "A", "C"]);
assert.deepEqual(group(groups, "envelope2"), ["7.11", "7.12"], "the financial envelope holds the financial bid letter and the cost estimate (RfS 26.2)");
assert.deepEqual(group(groups, "later"), ["7.3D", "7.3E", "7.3F", "H"], "until the PBG instrument is chosen, all three PBG formats wait, with Annexure-H");
assert.deepEqual(group(groups, "na"), ["7.2", "7.3B", "7.3C", "7.5", "7.8A", "K"]);
assert.equal(formatsForPack(state).length, 17, "the pack: the needed formats and the ones after the award");
assert.equal(formatsForPack(state).find((f) => f.id === "7.11").notes.length, 4, "the pack carries the RfS's notes on how the tariff is quoted");
assert.ok(formatsForPack(state).every((f) => Array.isArray(f.notes) && f.notes.every((n) => n.label && n.quote && n.page)));
assert.equal(formatStatus(state, byId("7.11")).notes, 4);
// the EMD instrument: one of three, to choose first
assert.equal(applies({ ...state, forms: { ...state.forms, emdForm: null } }, byId("7.3A")), "choose");
assert.deepEqual(["7.3A", "7.3B", "7.3C"].map((id) => applies(poi, byId(id))), ["no", "yes", "no"], "a POI for the EMD");
assert.deepEqual(["7.3A", "7.3B", "7.3C"].map((id) => applies(consortium, byId(id))), ["no", "no", "yes"], "a surety bond for the EMD");
// the PBG instrument: after the award; once chosen the other two formats are not needed
assert.deepEqual(group(formatGroups(poi), "later"), ["7.3E", "H"], "a POI for the PBG: Format 7.3E and Annexure-H after the award");
assert.deepEqual(["7.3D", "7.3F"].map((id) => applies(poi, byId(id))), ["no", "no"]);
assert.deepEqual(lettersForBid(poi).map((l) => l.id).filter((id) => !ids.includes(id)), ["7.3B"]);
// a consortium with a surety bond, a common shareholder and another entity's connectivity needs the other formats
assert.deepEqual(lettersForBid(consortium).map((l) => l.id).filter((id) => !ids.includes(id)), ["7.2", "7.3C", "7.5", "7.8A", "K"]);
assert.equal(applies(consortium, byId("7.8")), "no", "Format 7.8A stands in place of Format 7.8 for a bidder with a common shareholder (RfS 5.1 note)");
assert.ok(!lettersForBid(consortium).some((l) => l.id === "7.8"));
assert.equal(applies(state, byId("K")), "no", "Annexure-K only when the connectivity is another entity's");
assert.equal(applies(state, byId("H")), "later");
assert.ok(visibleFields(consortium.forms).some((x) => x.key === "leadMember"), "the lead member is asked of a consortium");
assert.equal(formatName("7.1"), "Format 7.1");
assert.equal(formatName("7.8-annex"), "Format 7.8 annexure");
assert.equal(formatName("K"), "Annexure-K");
// review marks follow the values
const st0 = formatStatus(state, FORMATS[0]);
assert.equal(st0.reviewed, null);
const reviewed = { ...state, formsReview: { "7.1": { at: "2026-11-25T10:00:00Z", print: formatPrint(state, FORMATS[0]) } } };
assert.equal(formatStatus(reviewed, FORMATS[0]).reviewed, "current");
assert.equal(formatStatus({ ...reviewed, forms: { ...reviewed.forms, bidder: "Other" } }, FORMATS[0]).reviewed, "changed", "an edit needs a new review");
assert.equal(formatStatus({ ...reviewed, inputs: { ...reviewed.inputs, psm: false } }, FORMATS[0]).reviewed, "changed", "a change of the PSM choice needs a new review of the Covering Letter");

// ---- the checks: a good bid passes, a bad one is flagged
const model = { bid: 5.2 };
const good = bidChecks(state, model);
assert.ok(good.length >= 13, "the checks");
for (const c of good) assert.ok(termProv(c.condition), `${c.id}: rests on a quoted term of terms.js (${c.condition})`);
const emdOk = { ...state, forms: { ...state.forms, "7.1.emdValidUpTo": "2027-12-05" } };
const okChecks = bidChecks(emdOk, model);
assert.deepEqual(okChecks.filter((c) => c.status !== "ok").map((c) => c.id), [], `every check ok: ${okChecks.filter((c) => c.status !== "ok").map((c) => `${c.id}: ${c.detail}`).join("; ")}`);
const detail = (cs, id) => cs.find((c) => c.id === id).detail;
assert.ok(detail(okChecks, "tariff").includes("no ceiling") && detail(okChecks, "tariff").includes(`${TENDER.termYears}-year`), "the tariff: no ceiling, fixed for the term");
const amounts = rfsAmounts(state.inputs);
assert.ok(detail(okChecks, "emd").includes(`₹${amounts.emdCr.toFixed(2)} crore`) && detail(okChecks, "emd").includes("bank guarantee (7.3A)"), detail(okChecks, "emd"));
assert.ok(detail(bidChecks(poi, model), "emd").includes("Payment on Order Instrument of REC or PFC (7.3B)"), detail(bidChecks(poi, model), "emd"));
assert.ok(detail(okChecks, "pbg").includes(`₹${amounts.pbgCr.toFixed(2)} crore`) && detail(okChecks, "pbg").includes(`Success Charges ₹${amounts.cacCr.toFixed(2)} crore`), detail(okChecks, "pbg"));
assert.ok(detail(okChecks, "networth").includes(`₹${amounts.netWorthCr.toFixed(2)} cr`));
assert.ok(detail(okChecks, "liquidity").includes(`₹${amounts.turnoverCr.toFixed(2)} cr`));
assert.equal(TENDER.turnoverLakhPerMw, 78.7625, "turnover: INR 78,76,250 per contracted MW (RfS 36.2.i)");
assert.ok(Math.abs(amounts.turnoverCr - 78.7625) < 1e-9, "turnover for 100 MW, in crore");
const bad = bidChecks({ ...emdOk, inputs: { ...state.inputs, contractedMw: 40 }, forms: { ...emdOk.forms, tariff: 5.123, connectivity: "none", netWorthCr: 10, turnoverCr: 1, "7.1.emdValidUpTo": "2027-06-01" } }, model);
assert.deepEqual(bad.filter((c) => c.status === "bad").map((c) => c.id), ["capacity", "tariff", "connectivity", "emdValidity", "networth", "liquidity"], bad.filter((c) => c.status === "bad").map((c) => c.id).join(","));
assert.equal(bidChecks({ ...emdOk, inputs: { ...state.inputs, contractedMw: 601 } }, model).find((c) => c.id === "capacity").status, "bad", "above 600 MW");
assert.equal(bidChecks({ ...emdOk, inputs: { ...state.inputs, contractedMw: 600 } }, model).find((c) => c.id === "capacity").status, "ok", "600 MW is the most one bidder may bid");
assert.equal(bidChecks({ ...emdOk, inputs: { ...state.inputs, contractedMw: 100.5 } }, model).find((c) => c.id === "capacity").status, "bad", "whole MW only");
assert.equal(bidChecks({ ...emdOk, inputs: { ...state.inputs, essMwhPerMw: 3 } }, model).find((c) => c.id === "storage").status, "warn", "storage below 4 MWh per MW is the model's warning, not the RfS's bar");
assert.equal(bidChecks(emdOk, { bid: 5.5 }).find((c) => c.id === "tariff").status, "warn", "a tariff below the target's is a warning");
for (const [route, key, need] of [["pbdit", "pbditCr", TENDER.pbditLakhPerMw], ["loc", "lineOfCreditCr", TENDER.lineOfCreditLakhPerMw]]) {
  const c = bidChecks({ ...emdOk, forms: { ...emdOk.forms, liquidityRoute: route, [key]: need } }, model).find((x) => x.id === "liquidity");
  assert.equal(c.status, "ok", `${route}: ₹${need} crore is enough for 100 MW (INR ${need} lakh per contracted MW)`);
  assert.equal(bidChecks({ ...emdOk, forms: { ...emdOk.forms, liquidityRoute: route, [key]: need - 0.01 } }, model).find((x) => x.id === "liquidity").status, "bad");
}
const todo = bidChecks(defaultCfdState(), null);
for (const id of ["tariff", "site", "connectivity", "emdValidity", "networth", "liquidity", "psm", "validity", "dates"]) assert.equal(todo.find((c) => c.id === id).status, "todo", `an empty bid: ${id} to do`);
assert.equal(todo.find((c) => c.id === "capacity").status, "ok", "the default 100 MW bid is within 50 to 600 MW");
// the bid pack request
const pack = bidPackRequest(emdOk, model);
assert.equal(pack.tender.short, "SECI-FDRE-X");
assert.equal(pack.tender.rfsNo, PACK.rfsNo);
assert.equal(pack.bid.contractedMw, 100);
assert.equal(pack.bid.bessMwh, 400);
assert.equal(pack.bid.installedMw, 800); // 400 MW of solar and 400 MWh of storage (RfS 18.1)
assert.equal(pack.bid.psm, true);
assert.equal(pack.bid.termYears, 25);
assert.equal(pack.bid.emdForm, "Bank Guarantee (Format 7.3A)");
assert.equal(pack.dates.effective, "2027-06-01");
assert.equal(pack.dates.scd, "2028-12-01", "SCSD 18 months from the Effective Date");
assert.equal(pack.dates.finClose, "2028-06-01", "financial closure 6 months before the SCSD");
assert.equal(pack.dates.pbgUntil, new Date(keyDates("2027-06-01").pbgUntil).toISOString().slice(0, 10));
assert.ok(pack.checks.every((c) => c.source), "every check cites its clause");
assert.equal(pack.fileName, "SECI_FDRE_X_bid_100MW");
assert.equal(FILE_PREFIX, "SECI_FDRE_X");
assert.ok(!/undefined|NaN/.test(JSON.stringify(pack)));
assert.ok(pack.fields.some((x) => x.label.startsWith("EMD instrument") && x.value === "Bank Guarantee (Format 7.3A)"));

// ---- what the Documents and Conditions steps read beside the pack
assert.equal(cite("precedence").slice(0, 3), "PPA", "the Documents step cites the term on which document prevails");
assert.ok(PACK.schedule.every((s) => ["rfs", "amendment", "notice", "website"].includes(s.basis)), "every date's basis has a badge on the Documents step");
const deletions = TERMS.filter((t) => t.doc === "amd1" && termById[t.id.replace(/Deleted$/, "")]?.status === "replaced");
assert.equal(deletions.length, PACK.changes.filter((c) => c.deleted).length, "the Conditions step shows the clause as issued under each of the amendment's deletions");

if (skipped) console.log(skipped);
// the RfS's note on a blank ("[Insert name of the Bidder]") goes once the blank is filled, stays while it is empty
{
  const t = "In consideration of the {{bidder}} [Insert name of the Bidder] (hereinafter referred to as 'Bidder')";
  const filled = segments(t, { bidder: "Example Renewables Private Limited" }).map((x) => x.text).join("");
  assert.equal(filled, "In consideration of the Example Renewables Private Limited (hereinafter referred to as 'Bidder')");
  assert.match(segments(t, {}).map((x) => x.text).join(""), /\[Insert name of the Bidder\]/);
  const read = (x, v) => segments(x, v).map((y) => y.text).join("");
  // after a unit, in round brackets, and the RfS's unclosed bracket (cut at its comma, nothing more)
  assert.equal(read("is {{mw}} MW [Insert cumulative Contracted Capacity proposed]. (Strike off)", { mw: "150" }), "is 150 MW. (Strike off)");
  assert.equal(read("as on {{d}} [Insert last date of bid submission, M/s {{b}} (insert name of the Bidder) & any", { d: "01.12.2026", b: "X Ltd" }), "as on 01.12.2026 M/s X Ltd & any");
  assert.equal(read("M/s {{p}} (enter name of the Promoter/Promoters) is", { p: "Y Ltd" }), "M/s Y Ltd is");
  assert.equal(read("the {{b}} [Insert name of the Bidder] (hereinafter) [Where applicable, evidence]", { b: "X Ltd" }), "the X Ltd (hereinafter) [Where applicable, evidence]");
  const bid = { ...defaultCfdState(), forms: { bidder: "Example Renewables Private Limited", address: "1 Example Road", rfsDate: "2026-10-07" } };
  const left = Object.keys(TEMPLATES).flatMap((id) => {
    const l = letterOf(bid, FORMATS.find((f) => f.id === id) || { id, fields: [] });
    const text = l ? letterHtml(l).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") : "";
    return [{ names: (text.match(/Example Renewables Private Limited/g) || []).length, notes: (text.match(/Example Renewables Private Limited\s*\[Insert name of the Bidder\]/g) || []).length }];
  });
  assert.ok(left.reduce((a, x) => a + x.names, 0) > 20, "the bidder's name printed in the letters");
  assert.equal(left.reduce((a, x) => a + x.notes, 0), 0, "a filled bidder's name still followed by its note");
}

console.log(`OK fdrex bid forms: ${FORMATS.length} formats and letters, ${FORMATS.reduce((a, f) => a + f.fields.length, 0)} blanks (${tokens} places in the letters), ${FORM_FIELDS.length} particulars, ${good.length} checks; ${rfsPages ? `${stretches} stretches of the letters' wording found on the RfS pages` : "wording not checked"}`);
