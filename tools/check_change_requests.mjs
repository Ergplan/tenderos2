// Checks for the change-request prompt (web/src/feedback/prompt.js): the approved requests become
// one Markdown prompt with the instructions, every request's context, the comment as a quote and
// the code map. Run from the repository root:   node tools/check_change_requests.mjs
import assert from "node:assert/strict";
import { STEP_CODE, TAB_CODE, changeRequestPrompt, promptFileName } from "../web/src/feedback/prompt.js";

const reqs = [
  { seq: 7, tab: "seciRtc", tab_label: "SECI RTC tender", step: "financeInputs", step_label: "Finance inputs", section_key: "seciRtc:financeInputs:4-2-construction", section_index: "4.2", section_title: "Construction and interest during construction",
    boxes: ["Construction", "Drawdown profile", "Funding order"], page_url: "https://example.test/", comment: "Add a quarterly drawdown table\nand show the IDC per quarter.", by_name: "Priya Sharma", team: "finance", created_at: "2026-10-31T09:12:00Z", decided_at: "2026-10-31T10:00:00Z", decided_by_name: "Tender manager" },
  { seq: 9, tab: "whatIf", tab_label: "What-if analysis", step: "", step_label: "", section_key: "whatIf:page:tariff-levers", section_index: "3", section_title: "Tariff levers for bid day", boxes: [], page_url: "", comment: "Show the levers as a chart too.", by_name: "Dev Patel", team: "projects", created_at: "2026-10-31T11:40:00Z" },
];
const md = changeRequestPrompt(reqs, { site: "demo.test", version: "1.2.0", zone: "core", batch: "20261031-1200", exportedAt: "2026-10-31T12:00:00Z", branch: "main" });
assert.ok(md.startsWith("# TenderOS change requests · demo.test · batch 20261031-1200"));
assert.ok(md.includes("2 approved requests"), "the count");
assert.ok(md.includes("## Instructions for Claude Code") && md.includes("docs/dev/DEV-MANUAL.md") && md.includes("make check-web"), "the instructions");
assert.ok(md.includes("### CR-7 · SECI RTC tender › Finance inputs › 4.2 Construction and interest during construction"), "the heading names where");
assert.ok(md.includes("- Requested by: Priya Sharma (finance), 2026-10-31 09:12 UTC"), "who and when");
assert.ok(md.includes("- Approved: 2026-10-31 10:00 UTC by Tender manager"));
assert.ok(md.includes("- Boxes in the section: Construction, Drawdown profile, Funding order"));
assert.ok(md.includes("- Code: web/src/bid/FinanceInputsStep.jsx") && md.includes("web/src/seci (SeciTab.jsx"), "the code hints from the step and the tab");
assert.ok(md.includes("> Add a quarterly drawdown table\n> and show the IDC per quarter."), "the comment as a quote, line by line");
assert.ok(md.includes("### CR-9 · What-if analysis › 3 Tariff levers for bid day"), "no step: tab › section");
assert.ok(!md.includes("Boxes in the section: \n"), "no empty boxes line");
assert.ok(md.includes("## Code map") && md.includes("| whatIf | web/src/whatif"), "the code map");
assert.ok(Object.keys(TAB_CODE).length >= 7 && Object.keys(STEP_CODE).length >= 13);
assert.equal(promptFileName("20261031-1200"), "tenderos-change-requests-20261031-1200.md");
assert.ok(!/undefined|NaN/.test(md), "nothing undefined");
console.log(`Change request prompt checks passed (${md.split("\n").length} lines for ${reqs.length} requests)`);
