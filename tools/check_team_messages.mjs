// Checks for team mode's @mentions (web/src/team/mentions.js): handles, which members a message
// mentions, the @word being typed, suggestions with the tab's owners first, and thread keys.
// Run from the repository root:   node tools/check_team_messages.mjs
import assert from "node:assert/strict";
import { handleOf, mentionAt, mentionedIn, suggest, threadKey, withHandles } from "../web/src/team/mentions.js";

const team = [
  { id: "a", name: "Tender manager", title: "Head of bids", tabs: ["seciRtc", "whatIf"] },
  { id: "b", name: "Finance desk", title: "CFO's office", tabs: ["whatIf"] },
  { id: "c", name: "Priya Sharma", title: "CFO", tabs: [] },
  { id: "d", name: "Priya  Sharma", title: "", tabs: [] },
  { id: "e", name: "Rénée O'Brien", title: "Legal", tabs: ["seciRtc"] },
];
assert.equal(handleOf("Finance desk"), "finance.desk");
assert.equal(handleOf("Rénée O'Brien"), "renee.o.brien");
assert.deepEqual(withHandles(team).map((m) => m.handle), ["tender.manager", "finance.desk", "priya.sharma", "priya.sharma.2", "renee.o.brien"]);
const who = (text) => mentionedIn(text, team).map((m) => m.id);
assert.deepEqual(who("@finance.desk please confirm"), ["b"]);
assert.deepEqual(who("cc @priya.sharma and @renee.o.brien."), ["c", "e"], "a full stop after a handle ends it");
assert.deepEqual(who("@priya.sharma.2 can you?"), ["d"], "the second Priya, not the first");
assert.deepEqual(who("mail finance.desk@x.com"), [], "an email address is not a mention");
assert.deepEqual(who("@finance.desks"), [], "a longer word is not the handle");
assert.deepEqual(mentionAt("ask @fin", 8), { query: "fin", start: 4 });
assert.equal(mentionAt("ask fin", 7), null);
assert.equal(mentionAt("a@b", 3), null, "an @ inside a word is not a mention");
assert.deepEqual(suggest(team, "", "whatIf").slice(0, 2).map((m) => m.id), ["b", "a"], "the tab's owners first");
assert.deepEqual(suggest(team, "cfo").map((m) => m.id).sort(), ["b", "c"], "by title too");
assert.equal(threadKey("whatIf", { testId: "seci-bid-mw" }), "whatIf:seci-bid-mw");
assert.equal(threadKey("whatIf", { section: "Your case", label: "Contracted capacity (bid)" }), "whatIf:your-case:contracted-capacity-bid");
console.log("Team messages checks passed");
