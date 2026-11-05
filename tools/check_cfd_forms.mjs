// Checks for the CfD bid forms (web/src/cfd/forms.js, formats.js, letters/*): every format's
// heading and every blank's context are quoted from the RfS at the page given (when the RfS text
// is at hand: CFD_RFS_TXT, a text dump with "=== page N ===" markers, else that check is skipped),
// every {{key}} of every template is a blank of its format, a filled bid leaves no blank or
// "undefined" in any letter, the formats this bid needs are counted right, and the checks pass a
// good bid and flag a bad one. Run from the repository root:   node tools/check_cfd_forms.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { FORMATS, applies, blankValue, formatGroups, formatStatus, formatsForPack, formatsSummary, modelValues } from "../web/src/cfd/formats.js";
import { FORM_FIELDS, bidChecks, bidPackRequest, formIssues, termProv, visibleFields } from "../web/src/cfd/forms.js";
import { TEMPLATES, letterHtml, letterOf, lettersForBid, parseTemplate } from "../web/src/cfd/letters/index.js";
import { letterPayload } from "../web/src/seci/letters/export.js";
import { defaultCfdState } from "../web/src/cfd/model.js";

const norm = (s) => String(s).replace(/-[ \t]*\n\s*/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').split(/\s+/).join(" ").trim();

// ---- the RfS text, page by page, when available
const txt = process.env.CFD_RFS_TXT || "/tmp/claude-0/-home-user/206714c7-b08b-50f6-8569-b5232efefcc0/scratchpad/cfd_amd/rfs.txt";
let pages = null;
if (existsSync(txt)) {
  pages = {};
  let cur = 0;
  for (const line of readFileSync(txt, "utf8").split("\n")) {
    const m = /^=== page (\d+) ===/.exec(line);
    if (m) { cur = Number(m[1]); pages[cur] = ""; continue; }
    if (cur) pages[cur] += `${line}\n`;
  }
}
const onPage = (page, quote) => (pages ? norm(pages[page] || "").includes(norm(quote)) : true);

// ---- formats: ids, pages, headings and blank contexts in the RfS
assert.equal(new Set(FORMATS.map((f) => f.id)).size, FORMATS.length, "unique format ids");
for (const f of FORMATS) {
  assert.ok(f.pages[0] >= 64 && f.pages[1] <= 100 && f.pages[0] <= f.pages[1], `${f.id}: pages within Section 7`);
  assert.ok(f.heading.page >= f.pages[0] && f.heading.page <= f.pages[1], `${f.id}: heading on its pages`);
  assert.ok(onPage(f.heading.page, f.heading.quote), `${f.id}: heading "${f.heading.quote}" on PDF page ${f.heading.page}`);
  assert.ok(["always", "consortium", "emd-bg", "emd-surety", "pbg-bg", "pbg-surety", "common-shareholding"].includes(f.applies), `${f.id}: applies`);
  assert.equal(new Set(f.fields.map((x) => x.key)).size, f.fields.length, `${f.id}: unique field keys`);
  for (const x of f.fields) {
    assert.ok(x.context.page >= f.pages[0] && x.context.page <= f.pages[1], `${f.id}.${x.key}: context on the format's pages`);
    assert.ok(onPage(x.context.page, x.context.quote), `${f.id}.${x.key}: context "${x.context.quote}" on PDF page ${x.context.page}`);
    if (x.kind === "choice") assert.ok(Array.isArray(x.options) && x.options.length >= 2, `${f.id}.${x.key}: options`);
  }
}
assert.equal(FORMATS.length, 17, "7.1 to 7.12, 7.3A-D, 7.8A and the annexure to 7.8");
console.log(pages ? `Quotes checked against the RfS text (${Object.keys(pages).length} pages)` : "RfS text not found: quote check skipped");

// ---- templates: every token is a blank of its format; every format has a template
const shared = new Set(FORM_FIELDS.map((x) => x.key));
for (const f of FORMATS) {
  const t = TEMPLATES[f.id];
  assert.ok(t, `${f.id}: template`);
  const keys = new Set(f.fields.map((x) => x.key));
  const text = t.text;
  for (const m of text.matchAll(/\{\{([A-Za-z0-9_]+)(?::\w+)?\}\}/g)) assert.ok(keys.has(m[1]), `${f.id}: {{${m[1]}}} is a blank of the format`);
  for (const m of text.matchAll(/\[\[([A-Za-z0-9_]+)=([^|\]]+)\|/g)) assert.ok(keys.has(m[1]), `${f.id}: [[${m[1]}]] is a blank`);
  for (const m of text.matchAll(/\[if ([A-Za-z0-9_]+)=([^\]]+)\]/g)) {
    assert.ok(keys.has(m[1]), `${f.id}: [if ${m[1]}] is a blank`);
    const field = f.fields.find((x) => x.key === m[1]);
    const opts = field.maps && shared.has(field.maps) ? FORM_FIELDS.find((x) => x.key === field.maps).options.map(([, l]) => l) : field.options;
    assert.ok(opts.includes(m[2].trim()), `${f.id}: [if ${m[1]}=${m[2]}] names an option (${opts.join(" | ")})`);
  }
  for (const m of text.matchAll(/\[\[([A-Za-z0-9_]+)=([^|\]]+)\|/g)) {
    const field = f.fields.find((x) => x.key === m[1]);
    const opts = field.maps && shared.has(field.maps) ? FORM_FIELDS.find((x) => x.key === field.maps).options.map(([, l]) => l) : field.options;
    assert.ok(opts.includes(m[2].trim()), `${f.id}: [[${m[1]}=${m[2]}]] names an option`);
  }
  const blocks = parseTemplate(text);
  assert.ok(blocks.length >= 2 && blocks[0].type === "heading", `${f.id}: parses to blocks headed by the format name`);
  for (const k of t.omit || []) assert.ok(keys.has(k), `${f.id}: omit ${k} is a field`);
}

// ---- a filled bid: no blank, no "undefined", every letter complete
const state = defaultCfdState();
state.inputs = { ...state.inputs, contractedMw: 100, solarMw: 120, windMw: 0, essMwPerMw: 1, essMwhPerMw: 2, effectiveDate: "2027-02-01", sellMarket: "DAM", gstRate: 0.18 };
state.forms = {
  bidder: "Arkaja Renewables Private Limited", bidderType: "company", address: "12 Energy Park\nPune 411001", contact: "Priya Sharma", email: "bids@arkaja.example", phone: "+91 20 1234 5678",
  commonShareholding: "no", signatory: "Priya Sharma, Director", letterDate: "2026-11-20", place: "Pune", bidDeadline: "2026-12-01", tariff: 6.25, emdForm: "bg",
  substation: "Bhadla-III PS (400 kV)", connectivity: "inPrinciple", site: "Ramgarh, Jaisalmer, Rajasthan", netWorthCr: 180, netWorthYear: "2025-26", liquidityRoute: "turnover", turnoverCr: 80,
};
const mv = modelValues(state);
assert.equal(mv.contractedMw, "100");
assert.equal(mv.bessMwh, "200");
assert.equal(mv.emdAmount, `INR ${(968000 * 120 + 240000 * 200).toLocaleString("en-IN")}`, "EMD on the installed capacity");
assert.equal(mv.pbgAmount, `INR ${(2420000 * 120 + 600000 * 200).toLocaleString("en-IN")}`, "PBG on the installed capacity");
assert.equal(mv.rfsNo, "SECI/C&P/IPP/13/0002/26-27");
for (const f of FORMATS) {
  for (const x of f.fields) {
    const b = blankValue(state, f, x);
    if (b.source === "own" && !b.value) state.forms[b.key] = x.kind === "date" ? "2026-11-15" : x.kind === "number" ? 10 : x.kind === "choice" ? x.options[0] : x.kind === "table" ? "Row one\nRow two" : `Test ${x.key}`;
  }
}
assert.deepEqual(formIssues(state), [], "every required particular is in");
// the consortium's formats and the surety bond are checked on a consortium bid with a surety bond and a common shareholder
const consortium = { ...state, forms: { ...state.forms, bidderType: "consortium", leadMember: "Arkaja Renewables Private Limited", emdForm: "surety", commonShareholding: "yes" } };
for (const f of FORMATS) {
  for (const x of f.fields) {
    const b = blankValue(consortium, f, x);
    if (b.source === "own" && !b.value) consortium.forms[b.key] = x.kind === "date" ? "2026-11-15" : x.kind === "number" ? 10 : x.kind === "choice" ? x.options[0] : x.kind === "table" ? "Row one\nRow two" : `Test ${x.key}`;
  }
}
for (const f of FORMATS) {
  const st = applies(state, f) === "no" ? consortium : state;
  const letter = letterOf(st, f);
  assert.ok(letter, `${f.id}: letter`);
  const html = letterHtml(letter);
  assert.ok(!html.includes("{{") && !html.includes("undefined"), `${f.id}: no token or undefined left in the letter`);
  assert.deepEqual(letter.missing, [], `${f.id}: nothing missing`);
  const payload = letterPayload(letter);
  assert.ok(payload.blocks.length >= 1 && payload.blocks.every((b) => b.type === "table" || Array.isArray(b.runs)), `${f.id}: Word payload`);
  if (f.id === "7.1") {
    const paras = letter.blocks.filter((b) => b.type === "para");
    assert.ok(paras.some((b) => b.struck && /Format 7.8A/.test(b.text)), "7.1: the 7.8A alternative is struck out for a bidder with no common shareholder");
    const emd = paras.find((b) => /enclosed EMD/.test(b.text));
    assert.ok(emd.segments.some((s) => s.alt?.option === "Insurance Surety Bond (Format 7.3B)" && s.struck) && emd.segments.some((s) => s.alt?.option === "Bank Guarantee (Format 7.3A)" && !s.struck), "7.1: the bank guarantee alternative is kept, the surety bond struck");
  }
  if (f.id === "7.4") {
    assert.ok(letter.blocks.some((b) => b.omitted && b.only === "consortium") && !letter.blocks.some((b) => b.omitted && b.only === "company"), "7.4: the consortium resolutions are left out for a company");
    const cl = letterOf(consortium, f);
    assert.ok(cl.blocks.some((b) => b.omitted && b.only === "company") && !cl.blocks.some((b) => b.omitted && b.only === "consortium") && cl.missing.length === 0, "7.4: a consortium's resolutions are in, with the equity share");
  }
  if (f.id === "7.6") {
    const paras = letter.blocks.filter((b) => b.type === "para" && b.cond);
    assert.ok(paras.some((b) => b.cond.value.startsWith("Annual turnover") && !b.struck) && paras.some((b) => b.cond.value.startsWith("PBDIT") && b.struck), "7.6: the turnover route is kept, PBDIT struck");
  }
}
// the letters of the bid: the EMD bank guarantee in, the surety bond, the consortium formats and 7.8A out, the PBG formats after the award
const ids = lettersForBid(state).map((l) => l.id);
assert.deepEqual(ids, ["7.1", "7.3A", "7.4", "7.6", "7.7", "7.8", "7.8-annex", "7.9", "7.10", "7.11", "7.12"], `the letters of a single-company bid with a bank guarantee: ${ids}`);
const sum = formatsSummary(state);
assert.deepEqual([sum.needed, sum.complete, sum.blanksLeft], [11, 11, 0], `summary ${JSON.stringify(sum)}`);
assert.equal(sum.reviewed, 0);
const groups = formatGroups(state);
assert.deepEqual(groups.map((g) => g.id), ["envelope1", "envelope2", "later", "na"]);
assert.deepEqual(groups.find((g) => g.id === "envelope2").list.map((f) => f.id), ["7.11"], "the financial envelope holds the financial bid letter");
assert.deepEqual(groups.find((g) => g.id === "later").list.map((f) => f.id), ["7.3C", "7.3D"]);
assert.deepEqual(groups.find((g) => g.id === "na").list.map((f) => f.id), ["7.2", "7.3B", "7.5", "7.8A"]);
assert.equal(formatsForPack(state).length, 13, "the pack: the needed formats and the ones after the award");
// a consortium with a surety bond and a common shareholder needs the other formats
const cons = consortium;
assert.deepEqual(lettersForBid(cons).map((l) => l.id).filter((id) => !ids.includes(id)), ["7.2", "7.3B", "7.5", "7.8A"]);
assert.equal(applies(cons, FORMATS.find((f) => f.id === "7.3A")), "no");
assert.ok(visibleFields(cons.forms).some((x) => x.key === "leadMember"), "the lead member is asked of a consortium");
assert.equal(applies({ ...state, forms: { ...state.forms, emdForm: null } }, FORMATS.find((f) => f.id === "7.3A")), "choose");
// review marks follow the values
const st0 = formatStatus(state, FORMATS[0]);
assert.equal(st0.reviewed, null);
const reviewed = { ...state, formsReview: { "7.1": { at: "2026-11-20T10:00:00Z", print: st0 && (await import("../web/src/cfd/formats.js")).formatPrint(state, FORMATS[0]) } } };
assert.equal(formatStatus(reviewed, FORMATS[0]).reviewed, "current");
assert.equal(formatStatus({ ...reviewed, forms: { ...reviewed.forms, bidder: "Other" } }, FORMATS[0]).reviewed, "changed", "an edit needs a new review");

// ---- the checks: a good bid passes, a bad one is flagged
const model = { bid: 6.2 };
const good = bidChecks(state, model);
assert.ok(good.length >= 11, "the checks");
for (const c of good) assert.ok(termProv(c.condition), `${c.id}: rests on a quoted term (${c.condition})`);
const emdOk = { ...state, forms: { ...state.forms, "7.1.emdValidUpTo": "2027-12-05" } };
const okChecks = bidChecks(emdOk, model);
assert.deepEqual(okChecks.filter((c) => c.status !== "ok").map((c) => c.id), [], `every check ok: ${okChecks.filter((c) => c.status !== "ok").map((c) => `${c.id}: ${c.detail}`).join("; ")}`);
assert.ok(okChecks.find((c) => c.id === "tariff").detail.includes("no ceiling"), "the ceiling's removal is said");
const bad = bidChecks({ ...emdOk, inputs: { ...state.inputs, contractedMw: 40, essMwhPerMw: 1.5 }, forms: { ...emdOk.forms, tariff: 5.123, netWorthCr: 10, turnoverCr: 1, "7.1.emdValidUpTo": "2027-06-01" } }, model);
assert.deepEqual(bad.filter((c) => c.status === "bad").map((c) => c.id), ["capacity", "tariff", "storage", "emdValidity", "networth", "liquidity"], bad.filter((c) => c.status === "bad").map((c) => c.id).join(","));
const low = bidChecks(emdOk, { bid: 6.5 }).find((c) => c.id === "tariff");
assert.equal(low.status, "warn", "a strike price below the target's is a warning");
const todo = bidChecks(defaultCfdState(), null);
for (const id of ["tariff", "site", "emdValidity", "networth", "liquidity", "validity", "dates"]) assert.equal(todo.find((c) => c.id === id).status, "todo", `an empty bid: ${id} to do`);
assert.equal(todo.find((c) => c.id === "capacity").status, "ok", "the default 100 MW bid is within 50 to 150 MW");
// the bid pack request
const pack = bidPackRequest(emdOk, model);
assert.equal(pack.bid.contractedMw, 100);
assert.equal(pack.bid.bessMwh, 200);
assert.equal(pack.dates.scd, "2028-05-01");
assert.ok(pack.checks.every((c) => c.source), "every check cites its clause");
assert.equal(pack.fileName, "SECI_CfD_I_bid_100MW");
assert.ok(!/undefined|NaN/.test(JSON.stringify(pack)));
console.log(`CfD bid forms checks passed (${FORMATS.length} formats, ${FORMATS.reduce((a, f) => a + f.fields.length, 0)} blanks, ${FORM_FIELDS.length} particulars, ${good.length} checks)`);
