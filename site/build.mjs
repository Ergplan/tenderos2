// Builds the public demo site for TenderOS (tenderos.joulewise.tech) into site/public/.
//
//   node site/build.mjs          then   node site/render.mjs   (the deck PDF and the share image)
//
// Every number on the page comes from the application's own code and data, run here:
//   SECI auction results      web/src/market/seed.js (SECI's result notices)
//   the CfD-I tender set      web/src/cfd/pack.js (documents, amendment changes with quotes)
//   the tender's conditions   web/src/cfd/terms.js
//   the model                 web/src/cfd/model.js, finance.js, winning.js, review.js
//   open SECI tenders         site/data-src/seci-open.json, a scan by engine/market/seci_tenders.py
// so the page cannot drift from the product. The page is static HTML (readable without
// JavaScript, for search engines and language models); site/src/app.js animates the simulation.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SECI_RESULTS, SECI_SITE, TRADING_MARGIN_NOTE, tariffRange, weightedTariff } from "../web/src/market/seed.js";
import { PACK } from "../web/src/cfd/pack.js";
import { TERMS, termById } from "../web/src/cfd/terms.js";
import { defaultCfdState, fillBenchmarks, fillWinning, modelInputs, priceBook, profiles, simulate, capShortfall, runModel } from "../web/src/cfd/model.js";
import { runCfdFinance } from "../web/src/cfd/finance.js";
import { eveningAverage, eveningMcp, poolTable, whatWins } from "../web/src/cfd/winning.js";
import { reviewBid } from "../web/src/cfd/review.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, "public");
const SITE = "https://tenderos.joulewise.tech";
const CONTACT_URL = "https://www.joulewise.tech/contact";
const CONTACT_EMAIL = "sales@joulewise.com"; // jouleWise's published sales address (www.joulewise.tech)
const BUILT = new Date().toISOString().slice(0, 10);

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n, d = 2) => (n == null || !Number.isFinite(n) ? "–" : n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const int = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-IN"));
const dateWords = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–");
const write = (rel, text) => { const p = join(OUT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const log = (...a) => console.log("site:", ...a);

// ------------------------------------------------------------------ the model, run as the app runs it
const prices = JSON.parse(readFileSync(join(ROOT, "web/public/market/iex_hourly_prices.json"), "utf8"));
const pricerFor = (st) => (inputs, sim) => runCfdFinance({ ...st, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });

const win = fillWinning(defaultCfdState());
win.inputs.contractedMw = 100;
const base = modelInputs(win);
const book = priceBook(prices, base.sellMarket);
const scan = [];
for (let mw = 0; mw <= 60; mw += 2) {
  const inputs = { ...base, solarMw: mw };
  const sim = simulate(inputs, book, profiles(inputs));
  scan.push({ mw, sp: +pricerFor(win)(inputs, sim).tariff.toFixed(3), shortMwh: Math.round(capShortfall(sim)) });
}
const best = scan.reduce((a, b) => (b.shortMwh === 0 && (a.shortMwh > 0 || b.sp < a.sp) ? b : a));
win.inputs.solarMw = best.mw;
const model = runModel(win, prices, { price: pricerFor(win) });
const fin = runCfdFinance(win, model);
const evening = { chosen: eveningMcp(model), all: eveningAverage(model) };
const pool = poolTable(model, fin.tariff).map((r) => ({ sp: +r.sp.toFixed(2), cr: +r.allCr.toFixed(1), yours: Boolean(r.yours) }));
const verdict = whatWins({ model, finance: fin });
const reviewWin = reviewBid({ state: win, model, finance: fin, prices });
log(`winning case: ${best.mw} MWac solar on 100 MW, ₹${fin.tariff.toFixed(2)}/kWh`);

// an over-built bid: the shape of a real upload (SoC window 0.05–50 %, extra battery, dear capex, 16 % equity)
const high = fillBenchmarks(defaultCfdState());
Object.assign(high.inputs, { contractedMw: 150, solarMw: 14, essSocMin: 0.05, essSocMax: 50, extraEssMwhPerMw: 1, essCrPerMwh: 1.2, targetEquityIrr: 0.16 });
const highModel = runModel(high, prices, { price: pricerFor(high) });
const highFin = runCfdFinance(high, highModel);
const reviewHigh = reviewBid({ state: high, model: highModel, finance: highFin, prices });
log(`over-built case: ₹${highFin.tariff.toFixed(2)}/kWh, ${reviewHigh.findings.length} findings`);

// a day of operation after the RE is built (operating year 4 onward) with the full supply met
let day = null;
simulate(model.inputs, model.book, model.prof, {
  onDay: (k, rec) => {
    if (day || k < 3 * 365 + 150) return;
    if (rec.delivered >= rec.required * model.inputs.availability - 0.01 && Math.max(...rec.solar) > 0.6 * best.mw) day = rec;
  },
});
const dayOut = day && {
  date: new Date(day.date).toISOString().slice(0, 10),
  chosen: day.chosen,
  solar: day.solar.map((v) => +v.toFixed(2)),
  charge: Array.from({ length: 24 }, (_, h) => +((day.own[h] || 0) + (day.market[h] || 0) + (day.group[h] || 0)).toFixed(2)),
  own: day.own.slice(0, 24).map((v) => +v.toFixed(2)),
  bought: Array.from({ length: 24 }, (_, h) => +((day.market[h] || 0) + (day.group[h] || 0)).toFixed(2)),
  discharge: Array.from({ length: 24 }, (_, h) => (day.chosen.includes(h) ? +(day.essOut / day.chosen.length + (Array.isArray(day.windDirect) ? day.windDirect[h] || 0 : 0)).toFixed(2) : 0)),
  price: day.price.map((v) => +v.toFixed(2)),
  delivered: +day.delivered.toFixed(1),
  required: day.required,
  availability: model.inputs.availability,
};

// ------------------------------------------------------------------ the tender set and its conditions
const docs = PACK.documents.map((d) => ({ id: d.id, title: d.title, kind: d.kind, date: d.date, pages: d.pages, summary: d.summary }));
const totalPages = docs.reduce((a, d) => a + d.pages, 0);
const quoteOf = (q) => (Array.isArray(q) ? q.map((x) => x.quote).join(" ") : q?.quote) || null;
const pageOf = (q) => (Array.isArray(q) ? q[0]?.page : q?.page) ?? null;
const SHOW_CHANGES = ["a2-rfs-4.3", "a3-rfs-40.3", "a3-rfs-9.3.a.iv", "a4-rfs-42.2.b"];
const changes = SHOW_CHANGES.map((id) => PACK.changes.find((c) => c.id === id)).filter(Boolean).map((c) => ({
  id: c.id, doc: PACK.documents.find((d) => d.id === c.doc)?.title, document: c.document, clause: c.clause, topic: c.topic,
  before: quoteOf(c.before), after: quoteOf(c.after), page: pageOf(c.after), effect: c.effect,
}));
const groups = {};
for (const t of TERMS) groups[t.group] = (groups[t.group] || 0) + 1;
const docTitle = (id) => PACK.documents.find((d) => d.id === id)?.title || id;
const SHOW_TERMS = ["scheme", "bid", "ceiling", "spFixed", "seciHours4", "declareAvail", "tamShare", "dsmOnRpd", "corpusCap"];
const terms = SHOW_TERMS.map((id) => termById[id]).filter(Boolean).map((t) => ({ id: t.id, group: t.group, label: t.label, display: t.display, doc: docTitle(t.doc), clause: t.clause, page: t.page, quote: t.quote }));

// ------------------------------------------------------------------ SECI results and open tenders
const results = SECI_RESULTS.map((r) => {
  const [lo, hi] = tariffRange(r);
  return {
    id: r.id, agency: r.agency, product: r.product, tender: r.tender, rfsNo: r.rfsNo, rfsDate: r.rfsDate, auctionDate: r.auctionDate, loaDate: r.loaDate,
    tenderedMw: r.tenderedMw, storageMwh: r.storageMwh ?? null, awardedMw: r.awardedMw, tariffUnit: r.tariffUnit,
    tariffLow: lo, tariffHigh: hi, tariffWeighted: weightedTariff(r) == null ? null : +weightedTariff(r).toFixed(3),
    winners: r.winners.map((w) => ({ name: w.name, bidMw: w.bidMw ?? null, awardedMw: w.mw ?? null, tariff: w.tariff })),
    notAwarded: (r.others || []).map((w) => ({ name: w.name, bidMw: w.bidMw ?? null, tariff: w.tariff ?? null })),
    note: r.note || null, sources: r.sources || [],
  };
}).sort((a, b) => String(b.auctionDate).localeCompare(String(a.auctionDate)));
const open = JSON.parse(readFileSync(join(HERE, "data-src/seci-open.json"), "utf8"));
const scannedDay = open.scannedAt.slice(0, 10);
const openRows = open.tenders.filter((t) => t.facts.category !== "admin").sort((a, b) => String(a.bidDeadline).localeCompare(String(b.bidDeadline)));

// ------------------------------------------------------------------ the data files (open to anyone)
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const resultsCsv = [["auction_id", "product", "tender", "rfs_no", "auction_date", "tendered_mw", "storage_mwh", "awarded_mw", "bidder", "bid_mw", "awarded_mw_bidder", "tariff_inr_per_kwh", "awarded", "source"]]
  .concat(results.flatMap((r) => [
    ...r.winners.map((w) => [r.id, r.product, r.tender, r.rfsNo, r.auctionDate, r.tenderedMw, r.storageMwh, r.awardedMw, w.name, w.bidMw, w.awardedMw, w.tariff, "yes", r.sources[0]?.url]),
    ...r.notAwarded.map((w) => [r.id, r.product, r.tender, r.rfsNo, r.auctionDate, r.tenderedMw, r.storageMwh, r.awardedMw, w.name, w.bidMw, 0, w.tariff, "no", r.sources[0]?.url]),
  ])).map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
const dataset = {
  name: "SECI renewable energy auction results, 2025–2026",
  description: "Every bidder awarded and not awarded, with capacity bid, capacity awarded and final tariff, in eight Solar Energy Corporation of India (SECI) e-reverse auctions from May 2025 to August 2026: FDRE peak power, FDRE round-the-clock, wind, solar with storage and RTC.",
  publisher: "jouleWise (TenderOS)", source: SECI_SITE, note: TRADING_MARGIN_NOTE, updated: BUILT, license: "Facts from SECI's public result notices; cite SECI and link the notice.",
  auctions: results,
};
write("data/seci-results.json", JSON.stringify(dataset, null, 1));
write("data/seci-results.csv", resultsCsv);
write("data/seci-open-tenders.json", JSON.stringify({ ...open, note: "SECI's tender list and each tender's details page, read without opening any document; summaries by rules." }, null, 1));
const demo = {
  tender: { short: PACK.short, title: PACK.title, rfsNo: PACK.rfsNo, tenderedMw: PACK.tenderedMw, documents: docs, totalPages, conditions: TERMS.length, groups, changesQuoted: PACK.changes.length },
  changes, terms,
  winning: { contractedMw: 100, solarMwac: best.mw, tariff: +fin.tariff.toFixed(3), equityIrr: +fin.equityIrr.toFixed(4), projectIrr: +fin.projectIrr.toFixed(4), minDscr: +fin.minDscr.toFixed(2), inputs: win.inputs },
  scan, day: dayOut, evening: { chosen: +evening.chosen.toFixed(2), all: +evening.all.toFixed(2) }, pool, verdict: { tone: verdict.tone, text: verdict.verdict },
  review: {
    winning: { tariff: +fin.tariff.toFixed(2), summary: reviewWin.summary, findings: reviewWin.findings.map((f) => ({ severity: f.severity, title: f.title })) },
    overbuilt: { tariff: +highFin.tariff.toFixed(2), summary: reviewHigh.summary, findings: reviewHigh.findings.map((f) => ({ severity: f.severity, title: f.title })) },
  },
};
write("data/cfd-demo.json", JSON.stringify(demo, null, 1));

// ------------------------------------------------------------------ page pieces
const W = demo.winning;
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const productOrder = [...new Set(results.map((r) => r.product))];
const resultsTable = `
<div class="table-wrap"><table class="results" id="results-table">
<caption>SECI e-reverse auction results, latest first. Tariffs as discovered, ₹/kWh. ${esc(TRADING_MARGIN_NOTE.split(". ")[1] || "")}</caption>
<thead><tr><th scope="col">Auction</th><th scope="col">Product</th><th scope="col" class="num">Tendered</th><th scope="col" class="num">Awarded</th><th scope="col" class="num">Tariff range</th><th scope="col" class="num">Weighted</th><th scope="col">Auction date</th><th scope="col">Source</th></tr></thead>
<tbody>
${results.map((r) => `<tr data-product="${esc(r.product)}">
<th scope="row"><details><summary>${esc(r.tender)}</summary>
<div class="winners"><p class="muted">RfS ${esc(r.rfsNo)} · LoA ${dateWords(r.loaDate)}${r.note ? ` · ${esc(r.note)}` : ""}</p>
<table><thead><tr><th>Awarded</th><th class="num">Bid MW</th><th class="num">Awarded MW</th><th class="num">₹/kWh</th></tr></thead><tbody>
${r.winners.map((w) => `<tr><td>${esc(w.name)}</td><td class="num">${int(w.bidMw)}</td><td class="num">${int(w.awardedMw)}</td><td class="num">${fmt(w.tariff)}</td></tr>`).join("")}
</tbody></table>
${r.notAwarded.length ? `<p class="muted small">Not awarded: ${r.notAwarded.map((w) => `${esc(w.name)}${w.tariff != null ? ` (₹${fmt(w.tariff)})` : ""}`).join("; ")}</p>` : ""}
</div></details></th>
<td><span class="pill p-${esc(r.product.toLowerCase().replace(/[^a-z]+/g, "-"))}">${esc(r.product)}</span></td>
<td class="num">${int(r.tenderedMw)} MW${r.storageMwh ? `<br><span class="muted small">${int(r.storageMwh)} MWh</span>` : ""}</td>
<td class="num">${int(r.awardedMw)} MW</td>
<td class="num"><b>${fmt(r.tariffLow)}–${fmt(r.tariffHigh)}</b></td>
<td class="num">${fmt(r.tariffWeighted, 3)}</td>
<td><time datetime="${esc(r.auctionDate)}">${dateWords(r.auctionDate)}</time></td>
<td>${r.sources.map((s) => `<a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.label.replace("SECI ", ""))}</a>`).join("<br>")}</td>
</tr>`).join("\n")}
</tbody></table></div>`;

// tariff range strip chart (server-rendered SVG)
const rangeChart = (() => {
  const w = 720, rowH = 30, top = 26, left = 250, right = 30, n = results.length, h = top + n * rowH + 28;
  const lo = 2.5, hi = 6.75, x = (v) => left + ((v - lo) / (hi - lo)) * (w - left - right);
  const ticks = [3, 4, 5, 6];
  return `<svg class="range-chart" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="rc-t rc-d"><title id="rc-t">Discovered tariffs by auction</title><desc id="rc-d">${results.map((r) => `${r.tender}: ₹${fmt(r.tariffLow)} to ₹${fmt(r.tariffHigh)} per kWh`).join("; ")}</desc>
${ticks.map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 8}" y2="${h - 24}" class="grid"/><text x="${x(t)}" y="${h - 8}" class="tick" text-anchor="middle">₹${t}</text>`).join("")}
${results.map((r, i) => { const y = top + i * rowH + rowH / 2; const short = r.tender.replace(/\s*\(SECI-[^)]+\)/, "").replace(/ISTS-connected /i, ""); const code = (r.tender.match(/\((SECI-[^)]+)\)/) || [])[1] || r.id; return `<g class="rc-row" data-product="${esc(r.product)}"><text x="${left - 10}" y="${y - 2}" text-anchor="end" class="rc-label">${esc(code)}</text><text x="${left - 10}" y="${y + 11}" text-anchor="end" class="rc-sub">${esc(r.product)} · ${dateWords(r.auctionDate)}</text><line x1="${x(r.tariffLow) - 3}" x2="${x(r.tariffHigh) + 3}" y1="${y}" y2="${y}" class="rc-bar"/><text x="${x(r.tariffHigh) + 12}" y="${y + 4}" class="rc-val">₹${fmt(r.tariffLow)}${r.tariffHigh !== r.tariffLow ? `–${fmt(r.tariffHigh)}` : ""}</text></g>`; }).join("\n")}
</svg>`;
})();

const openTable = `<div class="table-wrap"><table class="open-tenders"><thead><tr><th scope="col">Tender</th><th scope="col">What it is</th><th scope="col">Bids due</th></tr></thead><tbody>
${openRows.map((t) => `<tr><th scope="row"><a href="${esc(t.url)}" rel="noopener" target="_blank">${esc(t.title.length > 110 ? `${t.title.slice(0, 108)}…` : t.title)}</a><br><span class="muted small">${esc(t.ref)}</span></th><td>${esc(t.summary.split(" Bids are due")[0])}</td><td><time datetime="${esc(t.bidDeadline)}">${dateWords(t.bidDeadline)}</time></td></tr>`).join("\n")}
</tbody></table></div>`;

const MODULES = [
  ["tender", "Tender to Bid", "Upload an RfS with its amendments, clarifications and PPA/PSA (up to 20 files). TenderOS reads them, applies every amendment, quotes each change was/now, and gives every value its document and page. A reviewer confirms the reading before it reaches the bid."],
  ["rtc", "SECI FDRE-RTC tender", "The 1,000 MW firm and dispatchable round-the-clock tender worked end to end: block-wise supply floors, storage, penalties at multiples of the tariff, the bid forms in SECI's own wording, and how the winners reached ₹5.25/kWh."],
  ["cfd", "CfD bid (SECI CfD-I)", `A Contract for Difference explained in plain words; the RfS and four amendments with ${PACK.changes.length} changes quoted; ${TERMS.length} conditions with their pages; own solar sized for the least strike price; the Pool and Amendment-04's corpus test; the 17 formats as letters.`],
  ["bess", "BESS tenders", "Standalone battery tenders: capacity and energy, round-trip efficiency, cycles and augmentation, availability and the payment by the buying utility."],
  ["optimiser", "Plant sizing optimiser", "HiGHS optimisation sizes solar, wind and storage against every block floor, storage mandate and sale rule, hour by hour over every year of the contract, minimising the tariff for the target equity IRR."],
  ["dispatch", "15-minute dispatch", "Every day of the term in 96 time blocks (the Grid Code's scheduling block): charging, discharge, state of charge, supply due and delivered, surplus sold. Downloadable per Contract Year as CSV or a streaming Excel file."],
  ["finance", "Financial model and Excel twin", "A 25-year model from construction: IDC, six repayment methods, refinancing, working capital, DSRA, tax with losses carried, DSCR/LLCR. One click gives the live Excel workbook, every number a formula, recalculated in tests against the application."],
  ["whatif", "What-if and tariff levers", "Set the price you want to quote and the levers table shows, input by input, what moves the tariff and how far. Freeze a lever with evidence, reject one so the model searches others. Contract size is never offered as a lever."],
  ["review", "Bid review", "Why a bid is not optimal: tender conditions failed, prices far above recent awards, a plant not at its best size, a battery that fades below the need, inputs far from benchmarks, a DSCR the lender will not accept. Each finding says where to fix it."],
  ["new", "New tenders radar", "Scans SECI's tender list and details pages, never the documents, and writes a summary per tender: what it is, who may bid, the dates. New, changed and closed tenders are marked at every scan."],
  ["recent", "Recent results", "SECI's e-reverse auction results: every bidder awarded and not, capacity and final tariff, linked to SECI's notices. The reference for what wins."],
  ["agent", "Voice agent and Claude connector", "Ask the tender by voice or chat, or connect Claude through MCP (18 tools): look up a condition with its page, set an input, run the optimiser, read the financials, explain what wins."],
  ["team", "Team, evidence and sign-off", "Steps by team (Projects, Design, Finance), a paperclip for evidence on every input, sign-off that turns amber when a value changes, pings and threads, saved bids with versions, an activity log."],
  ["enterprise", "Runs on your infrastructure", "Docker on any cloud or on-premises. The enterprise edition splits an intake zone (documents and cloud models) from a core zone where the bid, the costs and the model live with no cloud client. Signed patches under the AMC."],
];
const ICONS = {
  tender: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  rtc: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  cfd: '<path d="M4 17l5-5 4 3 7-8"/><path d="M4 7h4M16 17h4"/>',
  bess: '<rect x="4" y="7" width="15" height="10" rx="1.5"/><path d="M19 10h2v4h-2M8 12h4"/>',
  optimiser: '<path d="M4 18c3-9 5-12 8-12s5 3 8 12"/><circle cx="12" cy="6" r="1.6"/>',
  dispatch: '<path d="M4 20V10M8 20V6M12 20v-8M16 20V8M20 20v-5"/>',
  finance: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 9v11M14 9v11"/>',
  whatif: '<path d="M5 6h14M5 12h14M5 18h14"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  review: '<path d="M11 4a7 7 0 105 12l4 4"/><path d="M8 11l2 2 4-4"/>',
  new: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/>',
  recent: '<path d="M4 20h16M7 16V9M12 16V5M17 16v-4"/>',
  agent: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0012 0M12 17v4"/>',
  team: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6M15 14c3 0 6 1.5 6 5"/>',
  enterprise: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" class="ic">${ICONS[k] || ""}</svg>`;

const FAQ = [
  ["What is TenderOS?", `TenderOS is a bid workspace for renewable power tenders in India, made by jouleWise. It reads a tender and its amendments with every value tied to its page, sizes the plant against the tender's conditions, prices the bid for the equity return you target, and produces the bid pack: the financial model as a live Excel workbook, the tender's formats and letters, and the sensitivities for bid day.`],
  ["Which tenders does it handle?", "Firm and dispatchable renewable energy (FDRE) and round-the-clock tenders, assured peak supply, Contracts for Difference (SECI CfD-I), standalone battery storage, and solar or wind with storage, from SECI, NHPC, NTPC and state utilities. A new tender type is added as a tender pack."],
  ["Does the AI decide the bid?", "No. Language models read documents and draft summaries; every value they read carries its document, page and quote, and a person confirms it before it reaches the bid. Sizing, dispatch and the financial model are deterministic code (HiGHS optimisation and a formula model), and the Excel twin shows every formula."],
  ["How accurate is the financial model?", "The model is exported as a live Excel workbook in which every number is a formula on the blue input cells. The product's own tests recalculate that workbook in LibreOffice and compare it with the application's numbers, so the workbook a lender reads and the application agree."],
  ["Where does the SECI auction data come from?", `From SECI's own result notices (${SECI_SITE}), linked per auction. The dataset is free to download as CSV or JSON from this page. Tariffs are as discovered in the e-reverse auction; SECI sells on to the buying utilities at the tariff plus its trading margin.`],
  ["What did the model find for SECI CfD-I?", `With competitive inputs for a 100 MW bid, the optimiser keeps ${W.solarMwac} MWac of own solar and buys the rest of the charging power, for a strike price of ₹${fmt(W.tariff)}/kWh at a 13% equity IRR. The two dearest evening hours averaged ₹${fmt(demo.evening.chosen)}/kWh in the price year, so a quote near that leaves SECI's CfD Pool about neutral, which matters because Amendment-04 lets SECI cut the award to what its ₹76 crore corpus can carry.`],
  ["Can it run on our own servers?", "Yes. TenderOS installs with Docker on any cloud or on-premises. The enterprise edition separates an intake zone (tender documents and cloud models) from a core zone on your network where bids, costs and the model live with no cloud client."],
  ["How do we get access?", `Ask jouleWise for a walkthrough on your own tender: ${CONTACT_URL} or ${CONTACT_EMAIL}.`],
];

const jsonLd = [
  { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "TenderOS", applicationCategory: "BusinessApplication", operatingSystem: "Web, Docker (any cloud or on-premises)", url: SITE, image: `${SITE}/og.jpg`,
    description: "Bid workspace for Indian renewable energy tenders: reads the RfS and amendments with page-level evidence, sizes solar, wind and battery plants against the tender's conditions, prices the bid for a target equity IRR, and produces the financial model as a live Excel workbook and the bid pack.",
    publisher: { "@type": "Organization", name: "jouleWise", url: "https://www.joulewise.tech" },
    featureList: MODULES.map((m) => m[1]), offers: { "@type": "Offer", availability: "https://schema.org/InStock", url: CONTACT_URL, description: "Licence with installation and annual maintenance (AMC); priced per engagement" } },
  { "@context": "https://schema.org", "@type": "Organization", name: "jouleWise", url: "https://www.joulewise.tech", email: CONTACT_EMAIL, sameAs: ["https://www.linkedin.com/company/joulewiseadvisoryservices/"] },
  { "@context": "https://schema.org", "@type": "Dataset", name: dataset.name, description: dataset.description, url: `${SITE}/#results`, creator: { "@type": "Organization", name: "jouleWise" }, isBasedOn: SECI_SITE, dateModified: BUILT, temporalCoverage: "2025-05/2026-08", spatialCoverage: "India",
    distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/data/seci-results.csv` }, { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/data/seci-results.json` }],
    variableMeasured: ["Tendered capacity (MW)", "Awarded capacity (MW)", "Discovered tariff (INR/kWh)", "Bidder"] },
  { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
];

const STAGES = [
  ["upload", "Tender in", "Six documents of SECI CfD-I"],
  ["read", "Read with evidence", "Every value with its page and quote"],
  ["amend", "Amendments applied", "Was / now, quoted"],
  ["conditions", "Conditions", `${TERMS.length} conditions in ${Object.keys(groups).length} groups`],
  ["inputs", "Inputs by team", "Fill with competitive values"],
  ["size", "Size the plant", "Least strike price, every day met"],
  ["dispatch", "Dispatch", "Hour by hour, 15-minute blocks"],
  ["finance", "Financial model", "Tariff for the target IRR"],
  ["wins", "What wins", "The CfD Pool and the corpus"],
  ["review", "Bid review", "Why a bid is not optimal"],
  ["pack", "Bid pack", "Excel, letters, dispatch files"],
];

const desc = `TenderOS by jouleWise turns an Indian renewable energy tender into a bid: it reads the RfS and amendments with page-level evidence, sizes solar, wind and battery against every condition, prices the bid for your target IRR and builds the Excel model and bid pack. Live demo with SECI auction results.`;

const page = `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TenderOS: from tender PDF to winning bid for Indian renewable energy tenders | jouleWise</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#141517" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f7f5f0" media="(prefers-color-scheme: light)">
<meta name="color-scheme" content="dark light">
<script>try{var t=localStorage.getItem("tos-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter+Tight:wght@400;500;600;700&display=swap">
<meta property="og:type" content="website">
<meta property="og:site_name" content="TenderOS by jouleWise">
<meta property="og:title" content="TenderOS: from tender PDF to winning bid">
<meta property="og:description" content="Watch a SECI tender become a bid: read with page evidence, amendments applied, plant sized, model priced, bid reviewed. With SECI's recent auction results.">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/og.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:locale" content="en_IN">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="TenderOS: from tender PDF to winning bid">
<meta name="twitter:description" content="Bid workspace for Indian RE tenders: evidence-linked reading, plant sizing, financial model, bid review. Demo and SECI auction data.">
<meta name="twitter:image" content="${SITE}/og.jpg">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/plain" href="/llms.txt" title="LLM summary">
<link rel="alternate" type="text/csv" href="/data/seci-results.csv" title="SECI auction results (CSV)">
<link rel="stylesheet" href="/assets/styles.css">
${jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap nav">
    <a href="/" class="brand" aria-label="TenderOS home"><span class="w1">Tender</span><span class="w2">OS</span><span class="by">by jouleWise</span></a>
    <nav aria-label="Sections"><a href="#simulation">Demo</a><a href="#what">Modules</a><a href="#results">SECI results</a><a href="#faq">FAQ</a></nav>
    <a class="btn small" href="/TenderOS-deck.pdf" download>Deck (PDF)</a>
    <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to day mode" title="Day mode"><svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg></button>
  </div>
</header>

<main id="main">
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">For bid teams at renewable energy developers in India</p>
      <h1>From the tender PDF to a winning bid, <em>with every number traceable</em>.</h1>
      <p class="lede">TenderOS reads a SECI, NHPC or NTPC tender and its amendments, ties every value to its page, sizes the solar, wind and battery plant against each condition, prices the bid for your target equity return and builds the bid pack, including the financial model as a live Excel workbook.</p>
      <div class="cta-row"><a class="btn" href="#simulation">Watch a tender become a bid</a><a class="btn ghost" href="/TenderOS-deck.pdf" download>Download the deck (PDF)</a></div>
      <p class="muted small">The demo below runs on SECI's CfD-I tender (bids due 20 Nov 2026) and the product's own model. Nothing on this page is a mock-up number.</p>
    </div>
    <div class="hero-card" aria-label="Key results of the demo">
      <div class="kpi"><span class="k">${TERMS.length}</span><span class="l">tender conditions read, each with its page and quote</span></div>
      <div class="kpi"><span class="k">${PACK.changes.length}</span><span class="l">amendment changes applied across 4 amendments</span></div>
      <div class="kpi"><span class="k">₹${fmt(W.tariff)}</span><span class="l">strike price found for a 100 MW bid at a 13% equity IRR</span></div>
      <div class="kpi"><span class="k">96</span><span class="l">15-minute blocks a day, dispatched for every day of the 15-year term</span></div>
    </div>
  </div>
</section>

<section class="band" id="sell">
  <div class="wrap three">
    <div><h2 class="h3">The problem</h2><p>A tender set runs to hundreds of pages and keeps changing: CfD-I had four amendments in four months, and one removed the ceiling tariff. Bid teams rebuild spreadsheets each time, and nobody can say which page a number came from.</p></div>
    <div><h2 class="h3">What TenderOS does</h2><p>It reads the tender once with evidence, keeps the amendments applied, sizes the plant and prices the bid under the tender's own rules, then reviews the bid against those rules and recent awards before you submit.</p></div>
    <div><h2 class="h3">What you get</h2><p>The application on your infrastructure, the Excel workbook of every bid, the bid forms and letters, a 15-minute compliance file, and patches and new tender packs under an annual maintenance contract.</p></div>
  </div>
</section>

<section id="simulation" class="sim-section">
  <div class="wrap">
    <p class="eyebrow">Live simulation</p>
    <h2>Watch SECI CfD-I become a bid, in eleven steps</h2>
    <p class="lede narrow">Press play, or click any step. Each screen shows what the application does and the numbers it produced on this tender. Amendment quotes are SECI's own words, with the page they come from.</p>
    <div class="sim" id="sim">
      <ol class="sim-rail" role="tablist" aria-label="Simulation steps">
${STAGES.map(([id, t, s], i) => `        <li><button role="tab" id="tab-${id}" aria-controls="st-${id}" aria-selected="${i === 0}" data-stage="${i}"><span class="n">${i + 1}</span><span class="t">${esc(t)}</span><span class="s">${esc(s)}</span></button></li>`).join("\n")}
      </ol>
      <div class="sim-screen">
        <div class="sim-bar"><span class="dots"><i></i><i></i><i></i></span><span class="sim-title" id="sim-title">TenderOS · SECI CfD-I</span><span class="sim-ctl"><button id="sim-prev" aria-label="Previous step">‹</button><button id="sim-play" aria-label="Play">▶ Play</button><button id="sim-next" aria-label="Next step">›</button></span></div>
        <div class="sim-progress"><i id="sim-progress"></i></div>

        <div class="stage" id="st-upload" role="tabpanel" aria-labelledby="tab-upload">
          <h3>1 · Tender in: the RfS, the agreement and four amendments</h3>
          <p class="muted">The set is dropped in at once; each file is identified and counted. Later amendments override earlier text, and the agreement prevails over the RfS where they differ.</p>
          <ul class="files">
${docs.map((d) => `            <li class="file" data-kind="${d.kind}"><span class="fi">PDF</span><span class="fn"><b>${esc(d.title)}</b><span class="muted small">${d.pages} pages${d.date ? ` · ${dateWords(d.date)}` : ""}</span></span><span class="tag">${esc(d.kind)}</span></li>`).join("\n")}
          </ul>
          <p class="foot">${totalPages} pages in the set · RfS ${esc(PACK.rfsNo)}</p>
        </div>

        <div class="stage" id="st-read" role="tabpanel" aria-labelledby="tab-read" hidden>
          <h3>2 · Read with evidence: every value carries its page</h3>
          <div class="meter"><span>Reading pages</span><b id="read-count">0</b><span>/ ${totalPages}</span></div>
          <ul class="terms">
${terms.map((t) => `            <li><div class="tl"><b>${esc(t.label)}</b><span class="cite">${esc(t.doc)} · ${esc(t.clause)} · p.${t.page}</span></div><p>${esc(t.display)}</p><blockquote>“${esc(t.quote.length > 220 ? `${t.quote.slice(0, 218)}…` : t.quote)}”</blockquote></li>`).join("\n")}
          </ul>
        </div>

        <div class="stage" id="st-amend" role="tabpanel" aria-labelledby="tab-amend" hidden>
          <h3>3 · Amendments applied: what changed, in SECI's words</h3>
          <div class="changes">
${changes.map((c) => `            <article class="change"><header><b>${esc(c.topic)}</b><span class="cite">${esc(c.doc)} · ${esc(c.document)} ${esc(c.clause)} · p.${c.page}</span></header>
              ${c.before ? `<p class="was"><span>Was</span>${esc(c.before.length > 260 ? `${c.before.slice(0, 258)}…` : c.before)}</p>` : `<p class="was none"><span>Was</span>(new clause)</p>`}
              <p class="now"><span>Now</span>${esc(c.after.length > 300 ? `${c.after.slice(0, 298)}…` : c.after)}</p>
              <p class="effect">${esc(c.effect)}</p></article>`).join("\n")}
          </div>
        </div>

        <div class="stage" id="st-conditions" role="tabpanel" aria-labelledby="tab-conditions" hidden>
          <h3>4 · ${TERMS.length} conditions, grouped, as a checklist against the bid</h3>
          <div class="groups">
${Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g, n]) => `            <div class="grp"><span class="gl">${esc(g)}</span><span class="gb"><i style="--w:${((n / 44) * 100).toFixed(1)}%"></i></span><span class="gn">${n}</span></div>`).join("\n")}
          </div>
          <p class="foot">Each condition is tested against the sized plant: met, failed or pending. Supply floors, storage, sourcing limits, penalties, guarantees and dates.</p>
        </div>

        <div class="stage" id="st-inputs" role="tabpanel" aria-labelledby="tab-inputs" hidden>
          <h3>5 · Inputs by team, filled with what winning bidders show lenders</h3>
          <p class="muted">Projects, Design and Finance each own a step. “Fill for me” puts competitive values in the empty boxes, marked until someone replaces them with their own and attaches the evidence.</p>
          <table class="inputs"><thead><tr><th>Input</th><th>Team</th><th class="num">Value</th><th>Source</th></tr></thead><tbody>
            <tr><td>Contracted capacity</td><td>Projects</td><td class="num">100 MW</td><td><span class="tag you">Your input</span></td></tr>
            <tr><td>Battery, all-in capex</td><td>Design</td><td class="num">₹${fmt(win.inputs.essCrPerMwh)} cr/MWh</td><td><span class="tag win">Competitive</span></td></tr>
            <tr><td>Solar, all-in capex</td><td>Design</td><td class="num">₹${fmt(win.inputs.solarCrPerMw)} cr/MWac</td><td><span class="tag win">Competitive</span></td></tr>
            <tr><td>Group RE price for charging</td><td>Projects</td><td class="num">₹${fmt(win.inputs.groupPrice)}/kWh</td><td><span class="tag win">Competitive</span></td></tr>
            <tr><td>Target equity IRR</td><td>Finance</td><td class="num">${pct(win.inputs.targetEquityIrr)}</td><td><span class="tag win">Competitive</span></td></tr>
            <tr><td>Interest rate · tenor</td><td>Finance</td><td class="num">${pct(win.inputs.interestRate)} · ${win.inputs.tenorYears} yrs</td><td><span class="tag win">Competitive</span></td></tr>
            <tr><td>Repayment</td><td>Finance</td><td class="num">Sculpted, DSCR 1.20</td><td><span class="tag win">Competitive</span></td></tr>
          </tbody></table>
        </div>

        <div class="stage" id="st-size" role="tabpanel" aria-labelledby="tab-size" hidden>
          <h3>6 · Size the plant: the optimiser tries every solar size</h3>
          <p class="muted">For each size the model runs all 15 years, day by day, and prices the bid through the full financial model. Below ${best.mw} MWac some days fall short of 2 MWh per MW; above it, solar costs more than the charging power it replaces.</p>
          <div class="chart" id="chart-scan" role="img" aria-label="Strike price against own solar size: lowest at ${best.mw} MWac, ₹${fmt(W.tariff)} per kWh"></div>
          <p class="foot" id="scan-readout">Own solar ${best.mw} MWac · strike price ₹${fmt(W.tariff)}/kWh · every day met</p>
        </div>

        <div class="stage" id="st-dispatch" role="tabpanel" aria-labelledby="tab-dispatch" hidden>
          <h3>7 · Dispatch: one day of the plant, ${dayOut ? dateWords(dayOut.date) : ""}</h3>
          <p class="muted">The battery charges from own solar and from group renewable power bought at the planned price, then supplies in the two dearest evening hours. The model does this for every day; the 15-minute file splits each hour into four Grid Code blocks.</p>
          <div class="chart" id="chart-day" role="img" aria-label="Hourly charging, discharge and market price for one day"></div>
          <p class="legend"><span class="sw s-solar"></span>Own solar charging <span class="sw s-bought"></span>Bought RE charging <span class="sw s-dis"></span>Battery supply <span class="sw s-price"></span>Exchange price ₹/kWh</p>
          <p class="foot">${dayOut ? `Supplied ${fmt(dayOut.delivered, 0)} MWh in the hours from ${dayOut.chosen.map((h) => `${h}:00`).join(" and ")}: the ${fmt(dayOut.required, 0)} MWh due a day at the ${Math.round(dayOut.availability * 100)}% availability the bidder declares (Amendment-04), so the day is met` : ""}</p>
        </div>

        <div class="stage" id="st-finance" role="tabpanel" aria-labelledby="tab-finance" hidden>
          <h3>8 · The financial model: the strike price for the target return</h3>
          <div class="tiles">
            <div class="tile"><span class="l">Strike price</span><b data-count="${W.tariff}" data-dec="2" data-pre="₹">₹${fmt(W.tariff)}</b><span class="s">per kWh, fixed for 15 years</span></div>
            <div class="tile"><span class="l">Equity IRR</span><b data-count="${(W.equityIrr * 100).toFixed(1)}" data-dec="1" data-suf="%">${pct(W.equityIrr)}</b><span class="s">the target, met</span></div>
            <div class="tile"><span class="l">Project IRR</span><b data-count="${(W.projectIrr * 100).toFixed(1)}" data-dec="1" data-suf="%">${pct(W.projectIrr)}</b><span class="s">pre-financing</span></div>
            <div class="tile"><span class="l">Minimum DSCR</span><b data-count="${W.minDscr}" data-dec="2" data-suf="×">${fmt(W.minDscr)}×</b><span class="s">sculpted to the lender</span></div>
          </div>
          <p class="foot">Click any number in the application to open its formula and the inputs it rests on. The same model downloads as a live Excel workbook: Live model, Construction, P&amp;L, Cash flow, Balance sheet, Debt, Tax, Working capital, Sensitivity and dispatch sheets.</p>
        </div>

        <div class="stage" id="st-wins" role="tabpanel" aria-labelledby="tab-wins" hidden>
          <h3>9 · What wins: will SECI's CfD Pool carry this price?</h3>
          <p class="muted">Under the CfD the bidder sells in the evening market and SECI's Pool pays (or collects) the difference to the strike price. Amendment-04 lets SECI award only what its ₹76 crore corpus can carry. Net Pool pay-out a year for the full 500 MW:</p>
          <div class="chart" id="chart-pool" role="img" aria-label="CfD Pool net flow per year against strike price"></div>
          <p class="verdict">${esc(verdict.verdict)}</p>
        </div>

        <div class="stage" id="st-review" role="tabpanel" aria-labelledby="tab-review" hidden>
          <h3>10 · Bid review: the same tender, two bids</h3>
          <div class="review-cols">
            <div class="rv good"><header><b>Competitive bid · ₹${fmt(demo.review.winning.tariff)}</b><span>${esc(demo.review.winning.summary)}</span></header><ul>${demo.review.winning.findings.map((f) => `<li class="${f.severity}"><span>${f.severity === "block" ? "Blocks" : f.severity === "warn" ? "Cost" : "Note"}</span>${esc(f.title)}</li>`).join("")}</ul></div>
            <div class="rv bad"><header><b>Over-built bid · ₹${fmt(demo.review.overbuilt.tariff)}</b><span>${esc(demo.review.overbuilt.summary)}</span></header><ul>${demo.review.overbuilt.findings.slice(0, 8).map((f) => `<li class="${f.severity}"><span>${f.severity === "block" ? "Blocks" : f.severity === "warn" ? "Cost" : "Note"}</span>${esc(f.title)}</li>`).join("")}</ul></div>
          </div>
          <p class="foot">The over-built case is a pattern bid teams fall into: a battery used only between 0.05% and 50% charge, an extra battery for evening sale, dear battery capex and a 16% equity target. The review names each cost and where to fix it${demo.review.overbuilt.findings.length > 8 ? ` (8 of ${demo.review.overbuilt.findings.length} findings shown)` : ""}.</p>
        </div>

        <div class="stage" id="st-pack" role="tabpanel" aria-labelledby="tab-pack" hidden>
          <h3>11 · The bid pack, ready for the bid committee</h3>
          <ul class="pack">
            <li><b>Financial model, Excel</b><span>Live workbook, every number a formula on the blue inputs; Goal Seek the tariff</span></li>
            <li><b>17 RfS formats as letters</b><span>Filled from the bid in SECI's own wording; Word and PDF</span></li>
            <li><b>15-minute dispatch</b><span>96 blocks a day for 15 years, one file per Contract Year</span></li>
            <li><b>Conditions checklist</b><span>${TERMS.length} conditions, met / failed / pending, each with its page</span></li>
            <li><b>Pre-bid queries</b><span>The points to raise with SECI, drafted from the tender's gaps</span></li>
            <li><b>Evidence register</b><span>Every input, who set it, the evidence attached and the sign-off</span></li>
          </ul>
          <div class="cta-row"><a class="btn" href="${CONTACT_URL}">Book a walkthrough on your tender</a></div>
        </div>
      </div>
    </div>
    <noscript><p class="muted">The simulation animates with JavaScript; all its content is shown above as text.</p></noscript>
  </div>
</section>

<section id="what" class="band">
  <div class="wrap">
    <p class="eyebrow">Everything in the application</p>
    <h2>Fourteen modules, one bid</h2>
    <div class="modules">
${MODULES.map(([k, t, d]) => `      <article class="mod">${icon(k)}<h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join("\n")}
    </div>
    <div class="ask">
      <div class="ask-q"><span class="who">Bid manager</span>Can SECI award us less than we bid for?</div>
      <div class="ask-a"><span class="who">TenderOS</span>${esc(termById.corpusCap?.display || "")} <span class="cite">Amendment-04 · ${esc(termById.corpusCap?.clause || "")} · p.${termById.corpusCap?.page}</span></div>
    </div>
  </div>
</section>

<section class="wrap teams" aria-labelledby="teams-h">
  <h2 id="teams-h">Built for the whole bid team</h2>
  <div class="table-wrap"><table><thead><tr><th>Team</th><th>What TenderOS gives them</th></tr></thead><tbody>
    <tr><th>Tender and legal</th><td>The tender and amendments reconciled, every condition with its page and quote, the formats and letters in the RfS's wording, a pre-bid query list</td></tr>
    <tr><th>Projects</th><td>Capacity, dates, supply profile, sourcing and market sale in one place; the sized plant and its compliance block by block</td></tr>
    <tr><th>Design</th><td>Solar, wind and battery studios, hourly profiles, losses to the billing meter, pooling stations, deviation settlement per CERC norms</td></tr>
    <tr><th>Finance</th><td>Financing terms, construction and IDC, repayment methods, refinancing, working capital, DSRA, the 25-year model and its Excel twin</td></tr>
    <tr><th>Management</th><td>The tariff for the target IRR, the levers for bid day, what wins, sign-off per input, the audit trail</td></tr>
  </tbody></table></div>
</section>

<section id="results" class="band">
  <div class="wrap">
    <p class="eyebrow">Open data</p>
    <h2>SECI's recent auction results</h2>
    <p class="lede narrow">Eight SECI e-reverse auctions from May 2025 to August 2026, read from SECI's result notices: every bidder awarded with the capacity it bid and won at its final tariff. Open a row for the bidders. Free to reuse: <a href="/data/seci-results.csv" download>CSV</a> · <a href="/data/seci-results.json">JSON</a>.</p>
    <div class="filters" role="group" aria-label="Filter by product"><button class="chip on" data-filter="all">All</button>${productOrder.map((p) => `<button class="chip" data-filter="${esc(p)}">${esc(p)}</button>`).join("")}</div>
    ${rangeChart}
    ${resultsTable}
    <div class="insights">
      <div><b>Firm power carries a clear premium.</b> Wind cleared at ₹3.67–3.85 and solar with storage at ₹2.86–3.13, while four hours of assured peak supply cleared at ₹5.99–6.28 and round-the-clock FDRE at ₹5.25–5.26: storage and firmness, not energy, set the price.</div>
      <div><b>Storage costs keep falling.</b> Assured peak supply dropped from ₹6.27–6.28 (FDRE-VII, Feb 2026) to ₹5.99–6.00 (FDRE-IX, Aug 2026) for the same four-hour product.</div>
      <div><b>Bids cluster tightly.</b> In most auctions the awarded tariffs sit within one to seven paise of each other, because bidders match the lowest price to win capacity. Bidding the right price matters more than bidding low.</div>
    </div>
  </div>
</section>

<section id="open" class="wrap">
  <p class="eyebrow">New tenders radar</p>
  <h2>Open at SECI, scanned ${dateWords(scannedDay)}</h2>
  <p class="lede narrow">TenderOS reads SECI's tender list and each tender's details page (${open.found} listed, ${open.documentsOpened} documents opened) and writes what each tender is, who may bid and when bids are due. In the application the scan runs on demand and marks what is new or changed.</p>
  ${openTable}
</section>

<section class="band" id="trust">
  <div class="wrap three">
    <div><h2 class="h3">Traceable, not a black box</h2><p>Every figure opens its formula and inputs in the application and in the Excel workbook, which the product's tests recalculate against the application.</p></div>
    <div><h2 class="h3">The tender's rules, as written</h2><p>Time-block floors, sourcing limits, penalties at multiples of the tariff, storage mandates and SECI's designated hours are modelled as the tender and its amendments write them.</p></div>
    <div><h2 class="h3">Your secrets stay inside</h2><p>Costs, bids and the model can live in a core zone on your network with no cloud client. Only the tender documents meet cloud models, in a separate intake zone.</p></div>
  </div>
</section>

<section id="faq" class="wrap faq">
  <h2>Questions</h2>
${FAQ.map(([q, a]) => `  <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
</section>

<section class="cta-band">
  <div class="wrap cta-inner">
    <div><h2>See it on your next tender</h2><p>A walkthrough on a live SECI, NHPC or NTPC tender with your team's own inputs. Installed on your infrastructure, with patches and new tender packs under an annual contract.</p></div>
    <div class="cta-row"><a class="btn" href="${CONTACT_URL}">Contact jouleWise</a><a class="btn ghost light" href="mailto:${CONTACT_EMAIL}?subject=TenderOS%20walkthrough">${CONTACT_EMAIL}</a><a class="btn ghost light" href="/TenderOS-deck.pdf" download>Deck (PDF)</a></div>
  </div>
</section>
</main>

<footer class="wrap foot-site">
  <p><span class="brand sm"><span class="w1">Tender</span><span class="w2">OS</span></span> is a product of <a href="https://www.joulewise.tech">jouleWise</a>. Auction data from <a href="${SECI_SITE}" rel="noopener">SECI's result notices</a>; tender quotes from the SECI CfD-I RfS and its amendments. Model figures from the application's own code, built ${dateWords(BUILT)}.</p>
  <p class="small"><a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a> · <a href="/data/seci-results.csv">SECI results (CSV)</a> · <a href="/data/cfd-demo.json">demo data (JSON)</a> · <a href="/sitemap.xml">sitemap</a></p>
</footer>
<script id="demo-data" type="application/json">${JSON.stringify({ scan, day: dayOut, pool, best: best.mw, tariff: W.tariff, evening: demo.evening }).replace(/</g, "\\u003c")}</script>
<script src="/assets/app.js" defer></script>
</body>
</html>
`;
write("index.html", page);

// ------------------------------------------------------------------ the deck (rendered to PDF by render.mjs)
const slide = (cls, inner) => `<section class="slide ${cls}">${inner}<footer><span class="brand sm"><span class="w1">Tender</span><span class="w2">OS</span></span><span>tenderos.joulewise.tech</span></footer></section>`;
const topResults = results.slice(0, 8);
const deck = `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><title>TenderOS deck</title><meta name="robots" content="noindex"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter+Tight:wght@400;500;600;700&display=swap"><link rel="stylesheet" href="/assets/deck.css"></head><body>
${slide("cover", `<div class="cv"><p class="eyebrow">jouleWise</p><h1><span class="w1">Tender</span><span class="w2">OS</span></h1><p class="big">From the tender PDF to a winning bid,<br>with every number traceable.</p><p class="muted">Bid workspace for renewable energy tenders in India · ${dateWords(BUILT)}</p></div>`)}
${slide("", `<h2>The problem</h2><div class="cols3"><div><b>Hundreds of pages, always changing</b><p>SECI CfD-I: an RfS of 129 pages, a 69-page agreement and four amendments in four months. One removed the ceiling tariff; one let SECI cut the award to its corpus.</p></div><div><b>Spreadsheets rebuilt every time</b><p>Each amendment sends the bid team back to its model. Nobody can say which page a number came from or which input moved the tariff.</p></div><div><b>Bids lost on the price</b><p>Awarded tariffs cluster within paise. An over-built battery or a high return target puts a bid out of the auction before it starts.</p></div></div>`)}
${slide("", `<h2>What TenderOS does</h2><ol class="flow">${STAGES.map(([, t, s]) => `<li><b>${esc(t)}</b><span>${esc(s)}</span></li>`).join("")}</ol>`)}
${slide("", `<h2>Read with evidence</h2><p class="sub">Every value carries its document, page and quote. A person confirms it before it reaches the bid.</p><div class="cols2"><div><div class="stat"><b>${TERMS.length}</b><span>conditions in ${Object.keys(groups).length} groups</span></div><div class="stat"><b>${PACK.changes.length}</b><span>amendment changes, was / now, quoted</span></div><div class="stat"><b>${totalPages}</b><span>pages in the CfD-I set</span></div></div><div>${changes.slice(0, 3).map((c) => `<div class="qc"><b>${esc(c.topic)}</b><span class="cite">${esc(c.doc)} · ${esc(c.clause)} · p.${c.page}</span><p>${esc(c.effect)}</p></div>`).join("")}</div></div>`)}
${slide("", `<h2>Size the plant, price the bid</h2><p class="sub">SECI CfD-I, 100 MW, competitive inputs. Every candidate size is run for 15 years, day by day, through the full financial model.</p><div class="cols2"><div><svg viewBox="0 0 460 250" class="dk-chart">${(() => { const xs = (mw) => 40 + (mw / 60) * 400; const ys = (sp) => 220 - ((sp - 8) / 1.6) * 190; return `<line x1="40" y1="220" x2="440" y2="220" class="ax"/><line x1="40" y1="20" x2="40" y2="220" class="ax"/>${[8, 8.5, 9, 9.5].map((v) => `<text x="34" y="${ys(v) + 4}" text-anchor="end">₹${v}</text>`).join("")}${[0, 20, 40, 60].map((v) => `<text x="${xs(v)}" y="238" text-anchor="middle">${v} MWac</text>`).join("")}<polyline class="ln" points="${scan.map((p) => `${xs(p.mw)},${ys(p.sp)}`).join(" ")}"/>${scan.filter((p) => p.shortMwh > 0).map((p) => `<circle cx="${xs(p.mw)}" cy="${ys(p.sp)}" r="3.5" class="short"/>`).join("")}<circle cx="${xs(best.mw)}" cy="${ys(W.tariff)}" r="6" class="best"/>`; })()}</svg><p class="small muted">Red: some days short of 2 MWh/MW. Gold: the optimum.</p></div><div><div class="stat"><b>${best.mw} MWac</b><span>own solar; the rest of the charging power bought</span></div><div class="stat"><b>₹${fmt(W.tariff)}/kWh</b><span>strike price at ${pct(W.equityIrr)} equity IRR</span></div><div class="stat"><b>${fmt(W.minDscr)}×</b><span>minimum DSCR, sculpted</span></div></div></div>`)}
${slide("", `<h2>What wins, and why a bid is not optimal</h2><div class="cols2"><div><b>The CfD Pool at each strike price (500 MW, ₹ cr a year)</b><table class="dk-t">${pool.map((p) => `<tr class="${p.yours ? "yours" : ""}"><td>₹${fmt(p.sp)}</td><td class="num">${p.cr > 0 ? "pays" : "collects"} ${fmt(Math.abs(p.cr), 1)}</td></tr>`).join("")}</table><p class="small muted">Evening market in the two chosen hours: ₹${fmt(demo.evening.chosen)}/kWh. Corpus ₹76 cr.</p></div><div><b>Bid review</b><div class="rvd good"><b>₹${fmt(demo.review.winning.tariff)}</b> ${esc(demo.review.winning.summary)}</div><div class="rvd bad"><b>₹${fmt(demo.review.overbuilt.tariff)}</b> ${esc(demo.review.overbuilt.summary)}</div><ul class="small">${demo.review.overbuilt.findings.filter((f) => f.severity !== "note").slice(0, 5).map((f) => `<li>${esc(f.title)}</li>`).join("")}</ul></div></div>`)}
${slide("", `<h2>SECI's recent auctions</h2><table class="dk-t wide"><thead><tr><th>Auction</th><th>Product</th><th class="num">MW</th><th class="num">₹/kWh</th><th>Date</th></tr></thead><tbody>${topResults.map((r) => `<tr><td>${esc(r.tender.replace(/^.*\((SECI-[^)]+)\).*$/, "$1"))}</td><td>${esc(r.product)}</td><td class="num">${int(r.awardedMw)}</td><td class="num">${fmt(r.tariffLow)}–${fmt(r.tariffHigh)}</td><td>${dateWords(r.auctionDate)}</td></tr>`).join("")}</tbody></table><p class="small muted">From SECI's result notices. Full dataset with every bidder: tenderos.joulewise.tech/data/seci-results.csv</p>`)}
${slide("", `<h2>Everything in the application</h2><div class="mods">${MODULES.map(([, t, d]) => { const f = d.split(". ")[0].split(": ")[0]; return `<div><b>${esc(t)}</b><p>${esc(f.length > 120 ? `${f.slice(0, f.lastIndexOf(" ", 117))}…` : `${f}.`)}</p></div>`; }).join("")}</div>`)}
${slide("", `<h2>Why teams trust it</h2><div class="cols3"><div><b>Traceable</b><p>Every number opens its formula and inputs. The Excel twin is recalculated in the product's tests against the application.</p></div><div><b>Deterministic where it counts</b><p>Language models read and summarise; they never set a value. Sizing is HiGHS optimisation, the model is formulas, the review is rules.</p></div><div><b>Your secrets stay inside</b><p>Bids, costs and the model can live in a core zone on your network with no cloud client; documents meet cloud models in a separate intake zone.</p></div></div>`)}
${slide("", `<h2>How we work with you</h2><div class="cols2"><div><b>You receive</b><ul><li>The application installed on your cloud or on-premises (Docker)</li><li>Tender packs for the tenders you bid</li><li>The Excel workbook and bid pack of every bid</li><li>Documentation, test matrix and installation guide</li></ul></div><div><b>Under the annual contract</b><ul><li>Signed patches and new tender packs</li><li>Change requests raised in the application, implemented and shipped</li><li>Support on installation and upgrades</li></ul></div></div>`)}
${slide("cover", `<div class="cv"><h2>See it on your next tender</h2><p class="big">${CONTACT_EMAIL}</p><p>${CONTACT_URL.replace("https://", "")}</p><p class="muted">Live demo and SECI auction data: tenderos.joulewise.tech</p></div>`)}
</body></html>`;
write("deck/index.html", deck);

// ------------------------------------------------------------------ LLM and crawler files
const llms = `# TenderOS by jouleWise

> TenderOS is a bid workspace for renewable energy tenders in India (SECI, NHPC, NTPC, state utilities). It reads a tender and its amendments with every value tied to its document, page and quote; sizes solar, wind and battery plants against the tender's conditions with HiGHS optimisation; prices the bid for a target equity IRR through a 25-year financial model exported as a live Excel workbook; reviews the bid against the tender and recent awards; and produces the bid pack. It runs on the client's own infrastructure.

Key facts:
- Maker: jouleWise (https://www.joulewise.tech). Contact: ${CONTACT_EMAIL}, ${CONTACT_URL}
- Tender types: FDRE round-the-clock, assured peak supply, Contract for Difference (SECI CfD-I), standalone BESS, solar or wind with storage.
- Language models read documents and draft summaries only; a person confirms every value. Sizing, dispatch, the financial model and the bid review are deterministic code.
- Demo result on SECI CfD-I (RfS ${PACK.rfsNo}, 500 MW × 2 h, bids due 20 Nov 2026): ${TERMS.length} conditions with pages, ${PACK.changes.length} amendment changes quoted; for a 100 MW bid with competitive inputs the optimiser keeps ${best.mw} MWac of own solar and prices the strike at ₹${fmt(W.tariff)}/kWh at a ${pct(W.equityIrr)} equity IRR (minimum DSCR ${fmt(W.minDscr)}).

## Pages
- [Demo and product overview](${SITE}/): the eleven-step simulation, the modules, SECI results, open SECI tenders, FAQ
- [Deck (PDF)](${SITE}/TenderOS-deck.pdf)
- [Full text for language models](${SITE}/llms-full.txt)

## Data
- [SECI auction results, CSV](${SITE}/data/seci-results.csv): one row per bidder in eight SECI e-reverse auctions (May 2025 – Aug 2026), awarded or not, with bid MW, awarded MW and final tariff, and the SECI notice
- [SECI auction results, JSON](${SITE}/data/seci-results.json)
- [Open SECI tenders, JSON](${SITE}/data/seci-open-tenders.json): scanned ${dateWords(scannedDay)} from www.seci.co.in/tenders
- [CfD-I demo numbers, JSON](${SITE}/data/cfd-demo.json): the optimiser scan, a day's dispatch, the Pool table, bid-review findings
`;
write("llms.txt", llms);
const llmsFull = `${llms}
## What a bid team gets
${MODULES.map(([, t, d]) => `- **${t}**: ${d}`).join("\n")}

## The demo, step by step (SECI CfD-I)
${STAGES.map(([, t, s], i) => `${i + 1}. ${t}: ${s}`).join("\n")}

### The tender set
${docs.map((d) => `- ${d.title} (${d.pages} pages${d.date ? `, ${d.date}` : ""}): ${d.summary}`).join("\n")}

### Conditions by group (${TERMS.length})
${Object.entries(groups).map(([g, n]) => `- ${g}: ${n}`).join("\n")}

### Sample conditions with evidence
${terms.map((t) => `- ${t.label}: ${t.display} [${t.doc}, ${t.clause}, page ${t.page}] Quote: "${t.quote}"`).join("\n")}

### Amendment changes (sample)
${changes.map((c) => `- ${c.topic} (${c.doc}, ${c.document} ${c.clause}, page ${c.page}): ${c.effect}`).join("\n")}

### Sizing scan (100 MW, competitive inputs): own solar MWac → strike price ₹/kWh (days short)
${scan.map((p) => `${p.mw} → ${fmt(p.sp, 3)}${p.shortMwh ? ` (short ${int(p.shortMwh)} MWh over the term)` : ""}`).join("; ")}

### Financial result
Strike price ₹${fmt(W.tariff, 3)}/kWh; equity IRR ${pct(W.equityIrr)}; project IRR ${pct(W.projectIrr)}; minimum DSCR ${fmt(W.minDscr)}. Evening market in the two chosen hours ₹${fmt(demo.evening.chosen)}/kWh, all evening hours ₹${fmt(demo.evening.all)}/kWh.

### What wins: CfD Pool net flow a year for 500 MW (positive = the Pool pays)
${pool.map((p) => `₹${fmt(p.sp)} → ₹${fmt(p.cr, 1)} cr`).join("; ")}. ${verdict.verdict}

### Bid review
- Competitive bid ₹${fmt(demo.review.winning.tariff)}: ${demo.review.winning.summary} ${demo.review.winning.findings.map((f) => `[${f.severity}] ${f.title}`).join("; ")}
- Over-built bid ₹${fmt(demo.review.overbuilt.tariff)}: ${demo.review.overbuilt.summary} ${demo.review.overbuilt.findings.map((f) => `[${f.severity}] ${f.title}`).join("; ")}

## SECI auction results (₹/kWh as discovered; ${TRADING_MARGIN_NOTE})
| Auction | Product | Tendered MW | Awarded MW | Tariff range | Weighted | Auction date | Winners | Source |
|---|---|---|---|---|---|---|---|---|
${results.map((r) => `| ${r.tender} | ${r.product} | ${r.tenderedMw}${r.storageMwh ? ` (${r.storageMwh} MWh)` : ""} | ${r.awardedMw} | ${fmt(r.tariffLow)}–${fmt(r.tariffHigh)} | ${fmt(r.tariffWeighted, 3)} | ${r.auctionDate} | ${r.winners.map((w) => `${w.name} ${int(w.awardedMw)} MW @ ${fmt(w.tariff)}`).join("; ")} | ${r.sources[0]?.url || ""} |`).join("\n")}

## Open SECI tenders (scanned ${open.scannedAt}, no documents opened)
${openRows.map((t) => `- ${t.title} (${t.ref}), bids due ${t.bidDeadline}: ${t.summary}`).join("\n")}

## FAQ
${FAQ.map(([q, a]) => `### ${q}\n${a}`).join("\n\n")}
`;
write("llms-full.txt", llmsFull);
write("robots.txt", `# TenderOS public demo: crawlers and AI agents welcome
User-agent: *
Allow: /
Disallow: /deck/

User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["/", "/TenderOS-deck.pdf", "/llms.txt", "/llms-full.txt", "/data/seci-results.csv", "/data/seci-results.json", "/data/seci-open-tenders.json"].map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${BUILT}</lastmod></url>`).join("\n")}
</urlset>
`);
write("vercel.json", JSON.stringify({
  cleanUrls: true,
  headers: [
    { source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=3600" }] },
    { source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] },
    { source: "/data/(.*)", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
    { source: "/TenderOS-deck.pdf", headers: [{ key: "Content-Disposition", value: "attachment; filename=\"TenderOS-deck.pdf\"" }] },
  ],
}, null, 2));
mkdirSync(join(OUT, "assets"), { recursive: true });
for (const f of ["styles.css", "app.js", "deck.css"]) copyFileSync(join(HERE, "src", f), join(OUT, "assets", f));
copyFileSync(join(HERE, "src/favicon.svg"), join(OUT, "favicon.svg"));
log(`wrote ${OUT}`);
