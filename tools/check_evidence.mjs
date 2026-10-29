// Checks for the evidence register (web/src/evidence/register.js): grouping by tab and box, what
// each item is named, the sign-off state of an item and the CSV. Run from the repository root:
//   node tools/check_evidence.mjs
import assert from "node:assert/strict";
import { REGISTER_COLUMNS, evidenceRegister, itemName, registerCsv, signedState } from "../web/src/evidence/register.js";

const t0 = "2026-10-29T10:00:00.000Z";
const t1 = "2026-10-29T11:00:00.000Z";
const items = [
  { id: "1", tab: "whatIf", field_key: "whatIf:your-case:contracted-capacity-bid", field_label: "Contracted capacity (bid)", place: "What-if analysis › Your case",
    kind: "note", note: "Board minute of 12 Oct", value_at: "320", by_name: "Tender manager", created_at: t0,
    signed_value_at: "320", signed_by_name: "Tender manager", signed_at: t1 },
  { id: "2", tab: "whatIf", field_key: "whatIf:your-case:contracted-capacity-bid", field_label: "Contracted capacity (bid)", place: "What-if analysis › Your case",
    kind: "link", url: "https://example.com/board?x=1,2", value_at: "300", by_name: "Finance desk", created_at: t1,
    signed_value_at: "320", signed_by_name: "Tender manager", signed_at: t1 },
  { id: "3", tab: "whatIf", field_key: "whatIf:your-case:solar-capex", field_label: "Solar capex", place: "What-if analysis › Your case",
    kind: "file", file_id: "f1", file_name: "EPC quote \"final\".pdf", value_at: "3.6", by_name: "Procurement desk", created_at: t0, signed_at: null },
  { id: "4", tab: "cfd", field_key: "cfd:strike", field_label: "Strike price", place: "CfD Bid", kind: "file", file_id: null, value_at: "", by_name: null, created_at: t0 },
];

assert.equal(itemName(items[0]), "Board minute of 12 Oct");
assert.equal(itemName(items[1]), "https://example.com/board?x=1,2");
assert.equal(itemName(items[2]), 'EPC quote "final".pdf');
assert.equal(itemName(items[3]), "file (removed)", "a file row that was deleted");
assert.equal(signedState(items[0]), "current", "signed off at the value the note was attached at");
assert.equal(signedState(items[1]), "older value", "the link was attached at another value");
assert.equal(signedState(items[2]), "", "no sign-off");

const reg = evidenceRegister(items);
assert.deepEqual(reg.map((t) => [t.tab, t.tabLabel, t.fields.length]), [["whatIf", "What-if analysis", 2], ["cfd", "CfD Bid", 1]], "grouped by tab in order of first appearance");
const cap = reg[0].fields[0];
assert.equal(cap.label, "Contracted capacity (bid)");
assert.equal(cap.place, "What-if analysis › Your case");
assert.deepEqual(cap.signoff, { valueAt: "320", by: "Tender manager", at: t1 });
assert.deepEqual(cap.items.map((i) => [i.kind, i.name, i.valueAt, i.by, i.signed]), [
  ["note", "Board minute of 12 Oct", "320", "Tender manager", "current"],
  ["link", "https://example.com/board?x=1,2", "300", "Finance desk", "older value"],
]);
assert.equal(reg[0].fields[1].signoff, null);
assert.equal(reg[1].fields[0].items[0].by, "", "no uploader (member removed)");
assert.deepEqual(evidenceRegister([]), []);
assert.deepEqual(evidenceRegister(undefined), []);

const csv = registerCsv(items);
const lines = csv.split("\r\n");
assert.equal(lines[0], REGISTER_COLUMNS.join(","));
assert.equal(lines.length, 1 + items.length + 1, "a header, one line per item, a final newline");
assert.equal(lines[1], `What-if analysis,Contracted capacity (bid),What-if analysis › Your case,320,note,Board minute of 12 Oct,Tender manager,${t0},current,320,Tender manager,${t1}`);
assert.ok(lines[2].includes('"https://example.com/board?x=1,2"'), "a comma in a value is quoted");
assert.ok(lines[2].endsWith(`,older value,320,Tender manager,${t1}`));
assert.ok(lines[3].includes('"EPC quote ""final"".pdf"'), "quotes are doubled");
assert.ok(lines[3].endsWith(",no,,,"), "no sign-off");
assert.ok(lines[4].startsWith("CfD Bid,Strike price,CfD Bid,,file,file (removed),,"));
assert.equal(registerCsv([]), `${REGISTER_COLUMNS.join(",")}\r\n`);
console.log("Evidence register checks passed");
