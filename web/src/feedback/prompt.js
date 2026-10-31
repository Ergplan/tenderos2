// The change-request prompt (docs/TEAM.md "Feedback and change requests"): the approved requests
// as one Markdown file that jouleWise hands to Claude Code to implement. Pure: no DOM, no server,
// so the Node check (tools/check_change_requests.mjs) and the export route share it.

/** Where each tab's code lives, for the prompt's code map. */
export const TAB_CODE = {
  tenderBid: "web/src/bid (steps: TenderStep, DatesStep, CapacityStep, SourcesStep, SizeStep, FinanceStep)",
  rtc: "web/src/rtc (RtcTab.jsx, chapters.jsx, FinanceView.jsx, LossChain.jsx; model: engine.js)",
  seciRtc: "web/src/seci (SeciTab.jsx and the steps) with web/src/bid for the shared steps",
  bessTender: "web/src/bess (BessTab.jsx, chapters.jsx; model: engine.js)",
  cfd: "web/src/cfd (CfdTab.jsx; model: model.js)",
  whatIf: "web/src/whatif (WhatIfTab.jsx, LeverPanel.jsx; model: model.js, levers.js)",
  recentTenders: "web/src/market",
  teamSetup: "web/src/team/TeamSetup.jsx",
  changeRequests: "web/src/feedback",
};

/** Where each step's code lives (step ids as the chips carry them). */
export const STEP_CODE = {
  documents: "web/src/seci/DocumentsStep.jsx (pack: web/src/seci/seci-rtc-tm-v.json)",
  conditions: "web/src/seci/ConditionsStep.jsx",
  bid: "web/src/seci/BidStep.jsx",
  sources: "web/src/bid/SourcesStep.jsx, BidLosses.jsx, SiteSchematic.jsx; plant studios in web/src/plant",
  financeInputs: "web/src/bid/FinanceInputsStep.jsx; DSM in web/src/dsm; model in web/src/rtc/engine.js",
  size: "web/src/bid/SizeStep.jsx; sizing request web/src/bid/model.js lpPayload; engine/sizing/rtc_lp.py",
  finance: "web/src/bid/FinanceStep.jsx, web/src/rtc/FinanceView.jsx, ConstructionView.jsx; Excel web/lib/liveModel.js; trace web/src/model",
  whatif: "web/src/whatif/WhatIfTab.jsx, LeverPanel.jsx, model.js, levers.js",
  forms: "web/src/seci/BidForms.jsx, forms.js, formats.js, letters/",
  winning: "web/src/seci/WinningBid.jsx, winningBid.js",
  tender: "web/src/bid/TenderStep.jsx, TenderSet.jsx, readTender.js",
  dates: "web/src/bid/DatesStep.jsx",
  capacity: "web/src/bid/CapacityStep.jsx",
};

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso || "") : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
};
const place = (r) => [r.tab_label || r.tab, r.step_label, [r.section_index, r.section_title].filter(Boolean).join(" ")].filter(Boolean).join(" › ");

/**
 * The prompt for a batch of requests. meta: { site, version, zone, batch, exportedAt, branch }.
 * Returns Markdown.
 */
export function changeRequestPrompt(requests, meta = {}) {
  const site = meta.site || "TenderOS";
  const lines = [];
  lines.push(`# TenderOS change requests · ${site} · batch ${meta.batch || "?"}`);
  lines.push("");
  lines.push(`Exported ${when(meta.exportedAt || new Date().toISOString())} from version ${meta.version || "dev"}${meta.zone ? ` (${meta.zone} zone)` : ""}. ${requests.length} approved request${requests.length === 1 ? "" : "s"}.`);
  lines.push("");
  lines.push("## Instructions for Claude Code");
  lines.push("");
  lines.push(`You are working in the TenderOS Demo 2 repository (Ergplan/tenderos2${meta.branch ? `, branch ${meta.branch}` : ""}). Implement every change request below.`);
  lines.push("");
  lines.push("1. Read docs/dev/DEV-MANUAL.md first (the repository map, the state model, the conventions and the how-tos), then docs/DEMO2.md and docs/TEAM.md for the feature areas touched.");
  lines.push("2. For each request: open the screen it names (tab › step › section, with the code map below), make the change the comment asks for, and keep the behaviour of everything else. Every number on screen must stay a traceable formula in the Excel model (web/lib/liveModel.js) when the model changes.");
  lines.push("3. Keep the checks green: `make check-web`, `make test`, and the browser tests (`make e2e` against a running stack); add or extend a test for each request where one applies.");
  lines.push("4. Update the documents that describe what changed (docs/DEMO2.md, docs/TEAM.md, docs/enterprise/FEATURES.md through tools/build_enterprise_features.py).");
  lines.push("5. Commit one change per request, the message starting with the request's id (for example `CR-12: …`), and push to the branch. Do not commit secrets.");
  lines.push("6. If a request is unclear or conflicts with another, implement the clear part and list the question at the end of your report, quoting the request's id.");
  lines.push("");
  lines.push("## Requests");
  lines.push("");
  for (const r of requests) {
    lines.push(`### CR-${r.seq} · ${place(r)}`);
    lines.push("");
    lines.push(`- Requested by: ${r.by_name || "a team member"}${r.team ? ` (${r.team})` : ""}, ${when(r.created_at)}`);
    if (r.decided_at) lines.push(`- Approved: ${when(r.decided_at)}${r.decided_by_name ? ` by ${r.decided_by_name}` : ""}`);
    lines.push(`- Screen: tab \`${r.tab}\`${r.step ? `, step \`${r.step}\`` : ""}, section \`${r.section_key}\``);
    const boxes = Array.isArray(r.boxes) ? r.boxes.filter(Boolean) : [];
    if (boxes.length) lines.push(`- Boxes in the section: ${boxes.slice(0, 20).join(", ")}${boxes.length > 20 ? ", …" : ""}`);
    const code = [STEP_CODE[r.step], TAB_CODE[r.tab]].filter(Boolean);
    if (code.length) lines.push(`- Code: ${code.join("; ")}`);
    if (r.page_url) lines.push(`- Page: ${r.page_url}`);
    lines.push("");
    lines.push("> " + String(r.comment || "").trim().split(/\r?\n/).join("\n> "));
    lines.push("");
  }
  lines.push("## Code map");
  lines.push("");
  lines.push("| Tab | Code |");
  lines.push("| --- | --- |");
  for (const [id, code] of Object.entries(TAB_CODE)) lines.push(`| ${id} | ${code} |`);
  lines.push("");
  lines.push("Tests: tests/engine (unit), tools/check_*.mjs (model checks; LibreOffice recalculates the Excel), tests/e2e (browser), tests/deploy. The functional matrix is docs/dev/FUNCTIONAL-TESTS.md.");
  lines.push("");
  return lines.join("\n");
}

/** A file name for the batch. */
export const promptFileName = (batch) => `tenderos-change-requests-${batch}.md`;
