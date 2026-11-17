// Builds the public demo site for TenderOS (tenderos.joulewise.tech) into site/public/.
//
//   node site/build.mjs [--model] [--pages]     then     node site/render.mjs
//
// Every number on the page comes from the application's own code and data, run here:
//   the CfD model            site/lib/model.mjs runs web/src/cfd/* (cached in data-src/model-cache.json;
//                            --model recomputes: about 140 full 15-year simulations, 1,700 pricings)
//   the tender set           web/src/cfd/pack.js and terms.js (documents, amendment quotes, conditions)
//   the tender's pages       site/pages.py renders the PDF pages and places every quote on its page
//                            (cached in public/pages and data-src/pages.json; --pages re-renders)
//   SECI auction results     web/src/market/seed.js (SECI's result notices)
//   FDRE-RTC and BESS        web/src/seci/winningBid.js and web/src/bess/engine.js
//   tenders on the market    data-src/market-scan.json, written daily by site/scan.py (SECI and NHPC)
//   the tour's narration     src/narration.json, recorded by site/voice.mjs into public/audio
// The page is static HTML (readable without JavaScript); site/src/app.js runs the guided tour and
// the interactive studio from public/data/demo.json.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SECI_RESULTS, SECI_SITE, TRADING_MARGIN_NOTE, tariffRange, weightedTariff } from "../web/src/market/seed.js";
import { PACK } from "../web/src/cfd/pack.js";
import { TERMS, TENDER, termById } from "../web/src/cfd/terms.js";
import { RESULT as RTC_RESULT, BRIDGE as RTC_BRIDGE } from "../web/src/seci/winningBid.js";
import * as BESS from "../web/src/bess/engine.js";
import { computeModel } from "./lib/model.mjs";
import { wordDiff } from "./lib/diff.mjs";
import "./src/iso.js";

const ISO = globalThis.TOSIso;
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, "public");
const SITE = "https://tenderos.joulewise.tech";
const CONTACT_URL = "https://www.joulewise.tech/contact";
const CONTACT_EMAIL = "sales@joulewise.com"; // jouleWise's published sales address (www.joulewise.tech)
const PHONE = "+91 87967 92724", TEL = "+918796792724"; // the number to call about TenderOS
const BUILT = new Date().toISOString().slice(0, 10);
const ARGS = new Set(process.argv.slice(2));

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n, d = 2) => (n == null || !Number.isFinite(n) ? "–" : n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const int = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-IN"));
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const dateWords = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–");
const write = (rel, text) => { const p = join(OUT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const log = (...a) => console.log("site:", ...a);
const cut = (s, n) => (s.length > n ? `${s.slice(0, s.lastIndexOf(" ", n - 1))}…` : s);

// ------------------------------------------------------------------ the model (cached)
const CACHE = join(HERE, "data-src/model-cache.json");
let M;
if (ARGS.has("--model") || !existsSync(CACHE)) {
  M = await computeModel(ROOT, (s) => log(s));
  writeFileSync(CACHE, JSON.stringify(M));
} else {
  M = JSON.parse(readFileSync(CACHE, "utf8"));
}
const W = M.win;
log(`model: ₹${W.tariff}/kWh at ${W.solarMw} MWac; ${M.sims} simulations and ${M.pricings} pricings in ${M.seconds} s (${M.computedAt.slice(0, 10)})`);

// ------------------------------------------------------------------ the tender set
const docs = PACK.documents.map((d) => ({ id: d.id, title: d.title, kind: d.kind, date: d.date, pages: d.pages, summary: d.summary }));
const totalPages = docs.reduce((a, d) => a + d.pages, 0);
const docTitle = (id) => PACK.documents.find((d) => d.id === id)?.title || id;
const docFile = (id) => { const d = PACK.documents.find((x) => x.id === id); return d?.file ? join(ROOT, "web/public", PACK.folder, d.file) : null; };
const many = (q) => (q ? (Array.isArray(q) ? q : [q]) : []);
const groups = {};
for (const t of TERMS) groups[t.group] = (groups[t.group] || 0) + 1;

const EV_IDS = ["capacityBid", "bid", "ceiling", "emd", "pbg", "seciHours4", "declareAvail", "tamShare", "corpusCap"];
const ev = EV_IDS.map((id) => termById[id]).filter((t) => t && docFile(t.doc)).map((t) => ({ id: t.id, group: t.group, label: t.label, display: t.display, doc: docTitle(t.doc), clause: t.clause, page: t.page, quote: t.quote }));

const AMD = { amd1: 1, amd2: 2, amd3: 3, amd4: 4 };
const changes = PACK.changes.map((c) => {
  const before = many(c.before).map((q) => q.quote).join(" ") || null;
  const after = many(c.after).map((q) => q.quote).join(" ");
  const d = wordDiff(before, after);
  return { id: c.id, amd: AMD[c.doc], amdTitle: docTitle(c.doc), document: c.document, clause: c.clause, topic: c.topic, effect: c.effect, page: many(c.after)[0].page, diff: d.html, added: d.added, removed: d.removed, isNew: d.isNew };
});
// what the tender is today against the tender as issued: the changes that move the bid
const NET = [
  ["Term of the agreement", "12 years", "15 years", "a3-rfs-2.3"],
  ["Ceiling tariff", "₹5.80/kWh", "None", "a3-rfs-40.3"],
  ["Battery", "Optional, may be a third party's", "Mandatory X MW / 2X MWh, owned", "a2-rfs-4.3"],
  ["Commissioning", "Whole project by month 15", "Battery by month 15, RE by month 36", "a2-rfs-10.2.a"],
  ["Charging power", "25% from the green market", "+75% until month 36, then +50% group RE", "a2-rfs-9.1.d"],
  ["Settlement", "Gains and losses shared in slabs", "Full pass-through at the strike price", "a3-rfs-9.3.a.iv"],
  ["CfD Pool", "A fund of ₹76 crore", "SECI replenishes it for the whole term", "a1-rfs-1.9"],
  ["Markets", "DAM, RTM, GDAM, HP-DAM", "+ TAM and G-TAM", "a3-rfs-9.2.b"],
  ["Peak hours", "The bidder's choice", "SECI may designate them, day-ahead", "a4-rfs-9.2.c"],
  ["Award", "500 MW", "What the CfD corpus can carry", "a4-rfs-42.2.b"],
].map(([label, was, now, change]) => { const c = changes.find((x) => x.id === change); if (!c) throw new Error(`no change ${change}`); return { label, was, now, change, amd: c.amd }; });

// ------------------------------------------------------------------ the tender's pages, with every quote placed
const PAGES_JSON = join(HERE, "data-src/pages.json");
if (ARGS.has("--pages") || !existsSync(PAGES_JSON) || !existsSync(join(OUT, "pages"))) {
  const reqs = [];
  for (const c of PACK.changes) for (const [kind, q] of [["was", c.before], ["now", c.after]]) for (const x of many(q)) { const f = docFile(x.doc); if (f) reqs.push({ id: c.id, file: f, page: x.page, quote: x.quote, kind }); }
  // a condition cites the printed page; the RfS PDF has a cover first (pdfOffset)
  for (const t of EV_IDS.map((id) => termById[id])) { const f = docFile(t.doc); if (f) reqs.push({ id: `ev-${t.id}`, file: f, page: t.page + (PACK.documents.find((d) => d.id === t.doc)?.pdfOffset || 0), quote: t.quote, kind: "value" }); }
  const reqFile = join(HERE, "data-src/.page-requests.json");
  writeFileSync(reqFile, JSON.stringify(reqs));
  log(execFileSync("python3", ["-W", "ignore", join(HERE, "pages.py"), reqFile, join(OUT, "pages"), PAGES_JSON], { encoding: "utf8" }).trim());
  rmSync(reqFile);
}
const pageData = JSON.parse(readFileSync(PAGES_JSON, "utf8"));

// ------------------------------------------------------------------ SECI results, comparables, open tenders
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
const codeOf = (r) => (r.tender.match(/\((SECI-[^)]+)\)/) || [])[1] || r.id;
const BUYS = { "FDRE peak power": "4 h of assured peak supply a day", "FDRE-RTC": "firm supply round the clock", "Wind": "wind energy as generated", "Solar + ESS": "solar with storage", "RTC (round-the-clock RE)": "round-the-clock RE" };
const comps = results.map((r) => ({ code: codeOf(r), product: r.product, lo: r.tariffLow, hi: r.tariffHigh, date: r.auctionDate, buys: BUYS[r.product] || r.product }));
const market = JSON.parse(readFileSync(join(HERE, "data-src/market-scan.json"), "utf8"));
const scannedDay = market.scannedAt.slice(0, 10);
const stillOpen = (t) => t.daysToBid == null || t.daysToBid >= 0;
const openRows = market.tenders.filter((t) => stillOpen(t) && t.category !== "admin").sort((a, b) => Number(b.ipp) - Number(a.ipp) || String(a.bidDeadline).localeCompare(String(b.bidDeadline)));
// the landing page's first drawing: the developer tenders on the market today, the newest news first
const DRAWN = new Set(["cfd", "bess", "wind", "solar", "solar+ess", "peak", "fdre", "rtc", "hybrid"]);
const rank = { new: 0, amended: 1, open: 2 };
const heroTenders = market.tenders.filter((t) => t.ipp && stillOpen(t) && DRAWN.has(t.category) && (t.capacity?.mw || t.capacity?.mwh)).sort((a, b) => rank[a.status] - rank[b.status] || String(a.bidDeadline).localeCompare(String(b.bidDeadline))).slice(0, 8)
  .map((t) => ({ source: t.source, id: t.id, name: t.scheme || `${t.source} ${t.categoryLabel}`, title: t.title, what: t.summary.split(";")[0], category: t.category, capacity: t.capacity, bidDeadline: t.bidDeadline, status: t.status, lastAmendment: t.lastAmendment, url: t.url }));
const heroCap = (t) => `<span class="tag live">On the market now</span> <b>${esc(t.name)}</b> <span class="hc-what">${esc(t.what)}</span> <span class="hc-due">bids due ${dateWords(t.bidDeadline)}</span>${t.status === "new" ? ' <span class="tag new">New</span>' : t.status === "amended" ? ` <span class="tag amended">Amended ${dateWords(t.lastAmendment).replace(/ \d{4}$/, "")}</span>` : ""}`;
const narration = JSON.parse(readFileSync(join(HERE, "src/narration.json"), "utf8"));
const voiceFile = existsSync(join(HERE, "data-src/voice.json")) ? JSON.parse(readFileSync(join(HERE, "data-src/voice.json"), "utf8")) : { clips: {} };
const narr = Object.fromEntries(Object.entries(narration.clips).map(([id, text]) => { const c = voiceFile.clips[id]; return [id, { text, src: c && existsSync(join(OUT, "audio", c.file)) ? `/audio/${c.file}` : null, seconds: c?.seconds || Math.round(text.split(" ").length / 2.6) }]; }));

// ------------------------------------------------------------------ the other tender types, from the app's own modules
const bridgeLabel = { base: "Benchmark inputs, the terms before Amendment-03", amd3: "Amendment-03's supply profile", green: "+ 5% bought on the green market", bess: "+ battery at ₹0.85 cr/MWh, 89% round trip", sell: "+ sell the Solar Hours surplus", finance: "+ debt at 8.5% for 18 years, equity IRR 12%", wind: "+ new-generation wind, CUF 37%" };
const rtc = { result: RTC_RESULT, bridge: RTC_BRIDGE.map((b) => ({ id: b.id, label: bridgeLabel[b.id] || b.step, tariff: b.tariff, kind: b.kind, plant: b.plant })) };
const rtcPlant = rtc.bridge[rtc.bridge.length - 1].plant; // per contracted MW
const bo = BESS.optimize(BESS.DEFAULT_REQ, BESS.DEFAULT_TECH, BESS.DEFAULT_COSTS, BESS.DEFAULT_FIN);
const bess = {
  req: BESS.DEFAULT_REQ, charge: +bo.best.chargeLakh.toFixed(2), equityIrr: +bo.best.equityIrr.toFixed(3), strategy: bo.best.strategy, evals: bo.evals,
  cohorts: bo.best.plan.cohorts.map((c) => ({ year: c.year, mwh: +c.mwh.toFixed(1), kind: c.kind })),
  compliance: BESS.compliance(BESS.DEFAULT_REQ, BESS.DEFAULT_TECH, bo.best).map((c) => ({ label: c.label, required: c.required, design: c.design, ok: c.ok })),
};
log(`other tenders: FDRE-RTC bridge ₹${rtc.bridge[0].tariff} → ₹${rtc.bridge[rtc.bridge.length - 1].tariff}; BESS ₹${bess.charge} lakh/MW/month (${bess.evals} plans tried)`);

// ------------------------------------------------------------------ data files (open to anyone)
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
write("data/market-scan.json", JSON.stringify({ note: "Open tenders at SECI and NHPC and what changed, read daily from their public tender lists and details pages without opening any document.", ...market }, null, 1));
const LEVERS_SHOWN = 12;
const demo = {
  built: BUILT,
  tender: { short: PACK.short, title: PACK.title, rfsNo: PACK.rfsNo, tenderedMw: PACK.tenderedMw, totalPages, conditions: TERMS.length, groups, changes: changes.length, formats: 17, bidSteps: PACK.bidProcess.length, queries: PACK.queries.length, corpusCr: TENDER.poolCr },
  docs, ev, changes, net: NET, pages: pageData.pages, marks: pageData.marks,
  stats: { sims: M.sims, pricings: M.pricings, seconds: M.seconds, daysPerSim: M.daysPerSim },
  win: W, scan: M.scan, best: M.best, grid: M.grid, day: M.day, heat: M.heat, rows: M.rows, drivers: M.drivers,
  levers: M.levers.slice(0, LEVERS_SHOWN), tracks: M.tracks, evening: M.evening, pool: M.pool, verdict: M.verdict, risks: M.risks,
  checks: { win: M.checks, over: M.review.overbuilt.checks }, review: { winning: M.review.winning, overbuilt: M.review.overbuilt }, comps,
  rtc, bess,
  narration: narr, market: { scannedAt: market.scannedAt, hero: heroTenders.map((t) => ({ ...t, cap: heroCap(t) })) },
};
write("data/demo.json", JSON.stringify(demo));
write("data/cfd-demo.json", JSON.stringify({ note: "SECI CfD-I through the TenderOS model: the optimiser's scan, the design surface, a day's dispatch, the levers, the Pool, the bid review.", ...demo, pages: undefined, marks: undefined, heat: undefined, narration: undefined, market: undefined }, null, 1));

// ------------------------------------------------------------------ page pieces
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

const rangeChart = (() => {
  const w = 720, rowH = 30, top = 26, left = 250, right = 30, n = results.length, h = top + n * rowH + 28;
  const lo = 2.5, hi = 6.75, x = (v) => left + ((v - lo) / (hi - lo)) * (w - left - right);
  return `<svg class="range-chart" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="rc-t rc-d"><title id="rc-t">Discovered tariffs by auction</title><desc id="rc-d">${results.map((r) => `${r.tender}: ₹${fmt(r.tariffLow)} to ₹${fmt(r.tariffHigh)} per kWh`).join("; ")}</desc>
${[3, 4, 5, 6].map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 8}" y2="${h - 24}" class="grid"/><text x="${x(t)}" y="${h - 8}" class="tick" text-anchor="middle">₹${t}</text>`).join("")}
${results.map((r, i) => { const y = top + i * rowH + rowH / 2; return `<g class="rc-row" data-product="${esc(r.product)}"><text x="${left - 10}" y="${y - 2}" text-anchor="end" class="rc-label">${esc(codeOf(r))}</text><text x="${left - 10}" y="${y + 11}" text-anchor="end" class="rc-sub">${esc(r.product)} · ${dateWords(r.auctionDate)}</text><line x1="${x(r.tariffLow) - 3}" x2="${x(r.tariffHigh) + 3}" y1="${y}" y2="${y}" class="rc-bar"/><text x="${x(r.tariffHigh) + 12}" y="${y + 4}" class="rc-val">₹${fmt(r.tariffLow)}${r.tariffHigh !== r.tariffLow ? `–${fmt(r.tariffHigh)}` : ""}</text></g>`; }).join("\n")}
</svg>`;
})();

const badge = (t) => (t.status === "new" ? ' <span class="tag new">New</span>' : t.status === "amended" ? ` <span class="tag amended">Amended ${dateWords(t.lastAmendment).replace(/ \d{4}$/, "")}</span>` : "");
const openTable = `<div class="table-wrap"><table class="open-tenders"><thead><tr><th scope="col">Tender</th><th scope="col">What it is</th><th scope="col">Bids due</th></tr></thead><tbody>
${openRows.map((t) => `<tr${t.ipp ? "" : ' class="not-ipp"'}><th scope="row"><span class="src src-${t.source.toLowerCase()}">${t.source}</span> <a href="${esc(t.url)}" rel="noopener" target="_blank">${esc(cut(t.title, 110))}</a>${badge(t)}<br><span class="muted small">${esc(t.ref || "")}</span></th><td>${esc(t.summary.split(" Bids are due")[0])}</td><td><time datetime="${esc(t.bidDeadline)}">${dateWords(t.bidDeadline)}</time>${t.daysToBid != null ? `<br><span class="muted small">${t.daysToBid === 0 ? "today" : `in ${t.daysToBid} day${t.daysToBid === 1 ? "" : "s"}`}</span>` : ""}</td></tr>`).join("\n")}
</tbody></table></div>`;
const KIND = { "new tender": "New tender", amendment: "Amendment", "deadline moved": "Deadline moved", closed: "Closed", "result notice": "Result" };
const eventsList = market.events.length ? `<ol class="events">${market.events.slice(0, 10).map((e) => `<li><time datetime="${e.date}">${dateWords(e.date).replace(/ \d{4}$/, "")}</time><span class="src src-${e.source.toLowerCase()}">${e.source}</span><span class="ek ek-${e.kind.replace(/ /g, "-")}">${KIND[e.kind] || e.kind}</span><span class="et"><a href="${esc(e.url)}" rel="noopener" target="_blank">${esc(e.tender)}</a><small>${esc(cut(e.detail, 110))}</small></span></li>`).join("")}</ol>` : "";

const ICONS = {
  tender: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>', rtc: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  cfd: '<path d="M4 17l5-5 4 3 7-8"/><path d="M4 7h4M16 17h4"/>', bess: '<rect x="4" y="7" width="15" height="10" rx="1.5"/><path d="M19 10h2v4h-2M8 12h4"/>',
  optimiser: '<path d="M4 18c3-9 5-12 8-12s5 3 8 12"/><circle cx="12" cy="6" r="1.6"/>', dispatch: '<path d="M4 20V10M8 20V6M12 20v-8M16 20V8M20 20v-5"/>',
  finance: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 9v11M14 9v11"/>', whatif: '<path d="M5 6h14M5 12h14M5 18h14"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  review: '<path d="M11 4a7 7 0 105 12l4 4"/><path d="M8 11l2 2 4-4"/>', radar: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/>',
  recent: '<path d="M4 20h16M7 16V9M12 16V5M17 16v-4"/>', agent: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0012 0M12 17v4"/>',
  team: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6M15 14c3 0 6 1.5 6 5"/>', shield: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>',
  studio: '<path d="M3 17l6-3 6 3 6-3M3 12l6-3 6 3 6-3"/><path d="M9 4l3-1.5L15 4l-3 1.5z"/>', save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/>', clip: '<path d="M8 12l6-6a3 3 0 014 4l-8 8a5 5 0 01-7-7l7-7"/>',
  check: '<path d="M5 12l4 4 10-10"/>', key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l9-8M16 6l3 3"/>', server: '<rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="14" width="16" height="6" rx="1"/><path d="M8 7h.01M8 17h.01"/>',
};
const icon = (k, cls = "ic") => `<svg viewBox="0 0 24 24" aria-hidden="true" class="${cls}">${ICONS[k] || ""}</svg>`;

const MODULES = [
  ["tender", "Tender to Bid", "Upload an RfS with its amendments, clarifications and PPA/PSA (up to 20 files). Every value read carries its document, page and quote; a reviewer confirms the reading before it reaches the bid."],
  ["rtc", "SECI FDRE-RTC tender", "The 1,000 MW round-the-clock tender worked end to end: block-wise floors, storage, penalties, the bid forms in SECI's wording, and the bridge to the ₹5.25 the winners bid."],
  ["cfd", "CfD bid (SECI CfD-I)", `A Contract for Difference in plain words; four amendments with ${changes.length} changes quoted; ${TERMS.length} conditions with their pages; own RE sized for the least strike price; the Pool and the corpus test.`],
  ["bess", "BESS tenders", "Standalone battery tenders read from the document: oversizing against augmentation, cycles, round-trip efficiency and availability, priced as a capacity charge per MW per month."],
  ["studio", "Solar and wind studios", "Solar: module class, fixed tilt or tracker, string or central inverters, DC:AC ratio, cost built up in ₹/Wp. Wind: ten turbines by make, hub height, wind regime, losses, spacing."],
  ["optimiser", "Plant sizing optimiser", "Linear optimisation with HiGHS over every hour of the year, against every block floor, storage rule and sale rule, minimising the tariff for the target equity IRR."],
  ["dispatch", "15-minute dispatch", "Every day of the term in 96 time blocks: charging, discharge, state of charge, supply due and delivered. One file per Contract Year, CSV or Excel."],
  ["finance", "Financial model, Excel twin", "A 25-year model from construction: IDC, six repayment methods, refinancing, working capital, DSRA, tax. One click gives a live Excel workbook, every number a formula."],
  ["whatif", "What-if and the track to a quote", "Every lever's effect on the tariff, the surest route to the price you want to quote with the chance of each move, levers frozen with evidence or turned down."],
  ["review", "Bid review", "Why a bid is not optimal: conditions failed, a price far above recent awards, a plant not at its best size, a battery that fades, a DSCR the lender will not accept."],
  ["save", "Saved bids and scenarios", "Every save is a named scenario with versions kept; restore any version; compare up to 12 scenarios side by side."],
  ["team", "Team, evidence, sign-off", "Steps by team, a paperclip for evidence on every input, pings and threads, assignments with email, sign-off that turns amber when the value changes, an activity log."],
  ["radar", "New tenders radar", "Scans SECI's tender list and details pages, never the documents, and summarises each tender: what it is, who may bid, the dates. New and changed tenders are marked."],
  ["recent", "Recent results", "SECI's e-reverse auction results, every bidder awarded and not, with capacity and final tariff, linked to SECI's notices."],
  ["agent", "Voice agent, MCP connectors", "Ask the tender by voice or chat. MCP connectors are available on subscription: connect Claude or another MCP client (18 tools) to look up a condition with its page, set an input, run the optimiser and read the financials."],
  ["shield", "On your premises", "Docker on any cloud or on-premises. A DMZ reads the tender; the bid, the costs and the model stay in a core zone with no route to the internet."],
];

// the time it takes: by hand (indicative) and in TenderOS (from the product's own documentation)
const SCALE = ["minutes", "hours", "days", "weeks"];
const TIME = [
  ["Read the tender set and reconcile every amendment", "weeks", "minutes", "1 to 4 minutes a tender, up to 10 for a set; then a reviewer confirms"],
  ["List every condition with its page and clause", "days", "minutes", `${TERMS.length} conditions on CfD-I, part of the reading`],
  ["Size solar, wind and storage against every block floor", "weeks", "minutes", "1 to 2 minutes an optimisation, a 25-year case on 4 cores"],
  ["Build the financial model lenders will read", "weeks", "minutes", "the model is the product; the Excel twin is one click"],
  ["Prove compliance in 15-minute blocks", "weeks", "minutes", "96 blocks a day for the whole term, about 90 seconds for year 1"],
  ["Bid-day sensitivities and the route to a quote", "days", "minutes", "what-if is instant; the levers and the track take seconds"],
  ["Fill the tender's formats and letters", "days", "hours", "filled in hours from the bid, in the RfS's wording, Word and PDF*"],
  ["Absorb a new amendment a week before the deadline", "weeks", "hours", "read the amendment, re-run, review: the same afternoon"],
];

const SECURITY = [
  ["server", "Two zones, by design", "A DMZ (the intake zone) holds only the tender documents and their reading. The core zone holds the bid: inputs, evidence, profiles, sizing, the financial model, the forms and the team."],
  ["lock", "The core has no route to the internet", "No cloud keys, no cloud client. It reaches only your own mail server and directory; everything else outbound is blocked, DNS included. The optimiser runs on internal-only container networks."],
  ["shield", "The core refuses to read tenders", "The tender-reading routes answer 403 in the core zone. Parsing happens in the DMZ; the reviewed reading moves inward, one way."],
  ["tender", "Or read with no cloud at all", "A rule-based reader extracts the headline fields with page and quote without any language model, for sites that allow none."],
  ["key", "Secrets and sign-in", "Passwords hashed with scrypt, sessions in httpOnly cookies, sign-in throttled after ten failures. Provider keys encrypted with AES-256-GCM and shown masked."],
  ["team", "Who sees what", "Administrator and user roles, access granted tab by tab, an activity log kept for 400 days."],
  ["save", "Backups and updates", "Database and files backed up, the newest 14 kept. Updates arrive as bundles signed with an EC P-256 key; the patch tool verifies, backs up, applies and health-checks."],
  ["optimiser", "Modest hardware", "One 4-vCPU, 16 GB server on Ubuntu or Debian with Docker: AWS, Azure, GCP or your own rack. HTTPS only, firewall rules per zone."],
  ["agent", "MCP connectors, on subscription", "Connect Claude or another MCP client to TenderOS: 18 tools to look up a condition with its page, set an input, run the optimiser and read the financials. In the two-zone deployment the connectors live in the intake zone, where they reach the tender's reading only, and are switched off in the core."],
];

const FAQ = [
  ["What is TenderOS?", `TenderOS is a bid workspace for renewable power tenders in India, made by jouleWise. It reads a tender and its amendments with every value tied to its page, sizes the plant against the tender's conditions, prices the bid for the equity return you target, reviews the bid against the tender and recent awards, and produces the bid pack: the financial model as a live Excel workbook, the tender's formats and letters, and the 15-minute compliance files.`],
  ["How can months of work become hours?", "Reading and reconciling a tender set, sizing a plant against block-wise floors, building a lender-grade model and proving compliance in 15-minute blocks each take a bid team days or weeks in spreadsheets, and an amendment restarts them. TenderOS reads a tender in minutes, optimises a 25-year case in one to two minutes and regenerates the model, the dispatch and the forms from the same bid, so the team's time goes to judgement: checking the reading, choosing inputs, deciding the price."],
  ["Which tenders does it handle?", "Firm and dispatchable renewable energy (FDRE) and round-the-clock tenders, assured peak supply, Contracts for Difference (SECI CfD-I), standalone battery storage, and solar or wind with storage, from SECI, NHPC, NTPC and state utilities. A new tender arrives as a tender pack."],
  ["Does the AI decide the bid?", "No. Language models read documents and draft summaries; every value they read carries its document, page and quote, and a person confirms it before it reaches the bid. Sizing is linear optimisation (HiGHS), the financial model is formulas, and the bid review is rules. The Excel twin shows every formula."],
  ["Does our bid data leave our premises?", "No. In the enterprise deployment the bid, the costs, the profiles and the model live in a core zone on your network that has no route to the internet. Only the tender documents, which are public, are read in a separate DMZ, with cloud models or with the rule-based reader that uses none."],
  ["What makes the optimiser state of the art?", "It is a linear programme solved with HiGHS, the leading open-source solver, over every hour of the year for the years that bind (or all 25). It chooses solar, wind and battery power and energy together, honours every floor the tender sets by block, month and year, and minimises the tariff for your target equity IRR. A 25-year case takes one to two minutes on four cores, and each run starts from the last."],
  ["Are MCP connectors available?", "Yes, on subscription. An MCP connector lets Claude or another MCP client work with TenderOS through 18 tools: look up a tender condition with its page, list what an amendment changed, set an input, run the optimiser, read the results and the financials. In the two-zone deployment the connectors run in the intake zone and are switched off in the core zone, so the bid's costs and model stay out of reach of any cloud client."],
  ["Can several people work on one bid?", "Yes. Inputs are split into steps by team (Projects, Design, Finance). Anyone can ping a colleague from any input, attach evidence, assign a question and fill in the answer; a super admin signs off each input and the sign-off turns amber if the value later changes. Saves are per user, with versions; an activity log records who did what."],
  ["Are scenarios saved?", "Yes. Every save is a named scenario; each further save is a new version, earlier versions are kept and can be restored, and up to 12 scenarios can be compared side by side."],
  ["How accurate is the financial model?", "The model is exported as a live Excel workbook in which every number is a formula on the blue input cells. The product's own tests recalculate that workbook in LibreOffice and compare it with the application's numbers."],
  ["Where does the SECI auction data come from?", `From SECI's own result notices (${SECI_SITE}), linked per auction. The dataset is free to download as CSV or JSON from this page. Tariffs are as discovered in the e-reverse auction; SECI sells on to the buying utilities at the tariff plus its trading margin.`],
  ["Is the price in the tour the price to bid?", `No. The tour is a worked example on illustrative inputs for a 100 MW bid on SECI CfD-I. Every bid is tender-specific: the price follows your own costs, sites, financing and return. What the example shows is the method: a little own solar beats buying all the charging power, wind raises the price on this tender, and because Amendment-04 lets SECI cut the award to what its ₹${TENDER.poolCr} crore corpus can carry, the bid is tested against the Pool as well as the model.`],
  ["Does the tour have a voice-over?", "Yes. Press Play with voice and each screen is narrated while the cursor drives it; the same words appear as captions, and the Voice button turns the sound off. The narration is an AI-generated voice."],
  ["How does it keep up with new tenders and amendments?", "Every day the tender lists of SECI and NHPC and each open tender's page are read, without opening a document, and compared with the day before: a new tender, an amendment or corrigendum, a moved deadline or a result notice is reported, and the drawing at the top of this page is redrawn from the tenders open that day."],
  ["How do we get access?", `Book a TenderOS demo on this page (${SITE}/#demo): a working session on a tender of your choice. Or call ${PHONE}, or write to ${CONTACT_EMAIL}.`],
];

// the chat box: the automatic answers are the FAQ's own, picked by the words in the question
const faq = (q) => { const hit = FAQ.find(([x]) => x === q); if (!hit) throw new Error(`chat: no FAQ entry "${q}"`); return hit[1]; };
const CHAT = {
  phone: PHONE,
  hello: "Ask a question about TenderOS or leave a note for the jouleWise team. What you write here is saved so the team can read it and reply.",
  ask: "To hear back from a person, leave a name and a phone number or email below.",
  noted: "Thank you. That is with the jouleWise team, who will reply to you.",
  notedAsk: "Thank you. That is saved for the jouleWise team. To get a reply, leave a name and a phone number or email below.",
  thanks: `Thank you. The jouleWise team will get back to you. For anything urgent, call ${PHONE}.`,
  topics: [
    { chip: "What is TenderOS?", keys: ["what is tenderos", "what does it do", "what do you do", "about tenderos", "overview", "what is this"], a: faq("What is TenderOS?") },
    { chip: "Does our data leave our premises?", keys: ["our data", "my data", "data leave", "data stay", "premises", "on-prem", "on prem", "security", "secure", "confidential", "dmz", "hosted", "cloud"], a: faq("Does our bid data leave our premises?") },
    { chip: "Which tenders does it cover?", keys: ["which tender", "what tender", "tender type", "kind of tender", "fdre", "bess", "cfd", "round the clock", "rtc", "nhpc", "ntpc", "state utilit"], a: faq("Which tenders does it handle?") },
    { chip: "What does it cost?", keys: ["cost", "pricing", "price of", "licence", "license", "subscription", "how much", "fee", "commercial", "quote for"], a: "TenderOS is supplied under an annual contract: the application installed on your own cloud or servers, tender packs for the tenders you bid, signed patches and support. The team quotes it for your case: leave your contact details here, or book a demo." },
    { chip: "Book a demo", keys: ["demo", "walkthrough", "walk-through", "trial", "meeting", "call me", "call back", "contact me", "talk to", "speak to"], a: "A demo is a working session with the jouleWise team on a live tender of your choice. Leave your name and a phone number or email here and the team will arrange it, or use the form at the bottom of the page." },
    { keys: ["optimi", "highs", "sizing", "size the plant", "solver", "linear program"], a: faq("What makes the optimiser state of the art?") },
    { keys: [" ai ", " ai?", "llm", "language model", "artificial intelligence", "hallucinat"], a: faq("Does the AI decide the bid?") },
    { keys: ["mcp", "connector", "claude"], a: faq("Are MCP connectors available?") },
    { keys: ["excel", "financial model", "workbook", "accura"], a: faq("How accurate is the financial model?") },
    { keys: ["several people", "collaborat", "multiple users", "team work", "sign-off", "sign off", "roles"], a: faq("Can several people work on one bid?") },
  ],
};

const desc = `TenderOS by jouleWise turns months of bid work into hours: it reads an Indian renewable energy tender and its amendments with page-level evidence, sizes solar, wind and battery with a HiGHS optimiser, prices the bid and builds the Excel model and bid pack, on your premises.`;
const jsonLd = [
  { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "TenderOS", applicationCategory: "BusinessApplication", operatingSystem: "Web, Docker (any cloud or on-premises)", url: SITE, image: `${SITE}/og.jpg`, description: desc,
    publisher: { "@type": "Organization", name: "jouleWise", url: "https://www.joulewise.tech" }, featureList: MODULES.map((m) => m[1]),
    offers: { "@type": "Offer", availability: "https://schema.org/InStock", url: `${SITE}/#demo`, description: "Licence with installation and annual maintenance (AMC); priced per engagement" } },
  { "@context": "https://schema.org", "@type": "Organization", name: "jouleWise", url: "https://www.joulewise.tech", email: CONTACT_EMAIL, telephone: TEL, contactPoint: { "@type": "ContactPoint", telephone: TEL, contactType: "sales", areaServed: "IN" }, sameAs: ["https://www.linkedin.com/company/joulewiseadvisoryservices/"] },
  { "@context": "https://schema.org", "@type": "Dataset", name: dataset.name, description: dataset.description, url: `${SITE}/#results`, creator: { "@type": "Organization", name: "jouleWise" }, isBasedOn: SECI_SITE, dateModified: BUILT, temporalCoverage: "2025-05/2026-08", spatialCoverage: "India",
    distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/data/seci-results.csv` }, { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/data/seci-results.json` }],
    variableMeasured: ["Tendered capacity (MW)", "Awarded capacity (MW)", "Discovered tariff (INR/kWh)", "Bidder"] },
  { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
];

const STAGES = [
  ["upload", "Tender in", "Six documents, classified"],
  ["read", "Evidence", "Every value on its page"],
  ["amend", "Amendments", `${changes.length} changes, word by word`],
  ["conditions", "Conditions", `${TERMS.length}, tested on the bid`],
  ["team", "Team inputs", "Pings, evidence, sign-off"],
  ["studio", "Design studio", "Move the plant, watch the price"],
  ["size", "Optimise", "Least price, every day met"],
  ["dispatch", "Dispatch", "15-minute blocks, 15 years"],
  ["finance", "Finance", "The model behind the price"],
  ["whatif", "What-if", "Levers and the track to a quote"],
  ["wins", "What wins", "The Pool and the corpus"],
  ["review", "Bid review", "Against rules and the market"],
  ["pack", "Bid pack", "Excel, letters, files"],
];

// ---- isometric plants, drawn at build time so they are in the HTML
const isoHero = ISO.plant({ kind: "cfd", solarMw: 24, windMw: 15, bessMwh: 200, text: { title: "A hybrid plant: solar, wind, battery, substation, grid, power exchange and SECI's CfD Pool", solar: "Solar", wind: "Wind", pool: "CfD Pool", poolSub: "" } });
const isoCfd = ISO.plant({ kind: "cfd", solarMw: W.solarMw, windMw: 0, bessMwh: 200, text: { title: "SECI CfD-I plant for a 100 MW bid", bessSub: "100 MW / 200 MWh" } });
const rtcMw = 200;
const isoFdre = ISO.plant({ kind: "fdre", solarMw: Math.round(rtcPlant.solar * rtcMw), windMw: Math.round(rtcPlant.wind * rtcMw), bessMwh: Math.round(rtcPlant.bessMwh * rtcMw), mwPerTable: 25, mwPerTurbine: 33, mwhPerContainer: 140, text: { title: "FDRE round-the-clock plant for a 200 MW bid", buyer: "SECI", buyerSub: "to the discoms, 24 h", bessSub: `${Math.round(rtcPlant.bess * rtcMw)} MW / ${int(rtcPlant.bessMwh * rtcMw)} MWh` } });
const isoBess = ISO.plant({ kind: "bess", bessMwh: bess.req.energyMwh, mwhPerContainer: 28, text: { title: "Standalone battery of 250 MW / 500 MWh", buyer: "Buying utility", buyerSub: "charges and dispatches", bessSub: `${bess.req.powerMw} MW / ${bess.req.energyMwh} MWh` } });

const bridgeChart = (() => {
  const b = rtc.bridge, w = 560, h = 250, L = 16, R = 16, T = 26, B = 22, bw = (w - L - R) / (b.length + 1);
  const y = (v) => T + (1 - (v - 4.6) / (7.8 - 4.6)) * (h - T - B);
  let s = "";
  b.forEach((st, k) => {
    const prev = k ? b[k - 1].tariff : 4.6, top = Math.min(y(prev), y(st.tariff)), hh = Math.max(2, Math.abs(y(prev) - y(st.tariff)));
    const cls = k === 0 ? "wf-base" : st.tariff > prev ? "wf-up" : "wf-down";
    s += `<rect class="${cls}${st.kind === "estimate" ? " est" : ""}" x="${L + k * bw + 5}" y="${k === 0 ? y(st.tariff) : top}" width="${bw - 10}" height="${k === 0 ? y(4.6) - y(st.tariff) : hh}"/><text class="wf-v" x="${L + k * bw + bw / 2}" y="${Math.min(y(prev), y(st.tariff)) - 5}" text-anchor="middle">₹${fmt(st.tariff)}</text><text class="wf-n" x="${L + k * bw + bw / 2}" y="${h - 6}" text-anchor="middle">${k + 1}</text>`;
  });
  const k = b.length;
  s += `<rect class="wf-win" x="${L + k * bw + 5}" y="${y(5.26)}" width="${bw - 10}" height="${y(4.6) - y(5.26)}"/><text class="wf-v" x="${L + k * bw + bw / 2}" y="${y(5.26) - 5}" text-anchor="middle">₹5.25</text><text class="wf-n" x="${L + k * bw + bw / 2}" y="${h - 6}" text-anchor="middle">won</text>`;
  return `<svg class="mini-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="From ₹${fmt(b[0].tariff)} on benchmark inputs to ₹${fmt(b[b.length - 1].tariff)}, against the ₹5.25 to 5.26 the winners bid">${s}</svg>`;
})();
const augChart = (() => {
  const c = bess.cohorts, w = 560, h = 190, L = 16, R = 16, T = 22, B = 22, bw = (w - L - R) / c.length, max = c[0].mwh;
  return `<svg class="mini-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Battery installed on day one and added each year">${c.map((x, k) => { const hh = Math.max(2, (x.mwh / max) * (h - T - B)); return `<rect class="${k ? "wf-down" : "wf-base"}" x="${L + k * bw + 4}" y="${h - B - hh}" width="${bw - 8}" height="${hh}"/><text class="wf-v" x="${L + k * bw + bw / 2}" y="${h - B - hh - 5}" text-anchor="middle">${int(x.mwh)}</text><text class="wf-n" x="${L + k * bw + bw / 2}" y="${h - 6}" text-anchor="middle">${x.year}</text>`; }).join("")}</svg>`;
})();

const stepper = STAGES.map(([id, t, s], i) => `<li><button role="tab" id="tab-${id}" aria-controls="st-${id}" aria-selected="${i === 0}" data-stage="${i}"><span class="n">${i + 1}</span><span class="t">${esc(t)}</span><span class="s">${esc(s)}</span></button></li>`).join("\n");
const stage = (id, k, title, lede, body, hidden = true) => `
        <div class="stage" id="st-${id}" role="tabpanel" aria-labelledby="tab-${id}"${hidden ? " hidden" : ""}>
          <header class="stage-head"><h3><span class="sn">${k}</span>${title}</h3><p>${lede}</p></header>
${body}
        </div>`;
const pageview = (id, caption) => `<figure class="pageview" id="${id}"><figcaption>${caption}</figcaption><div class="pv-scroll"><div class="pv-sheet"><img alt="" loading="lazy" decoding="async"><div class="pv-marks"></div></div></div></figure>`;
const TEAM_INPUTS = [
  ["Projects", [["contractedMw", "Contracted capacity", "100 MW", "you"], ["groupPrice", "Group RE price for charging", `₹${fmt(W.inputs.groupPrice)}/kWh`, "win"], ["availability", "Plant availability declared", pct(W.inputs.availability, 0), "win"]]],
  ["Design", [["essCrPerMwh", "Battery capex, all-in", `₹${fmt(W.inputs.essCrPerMwh)} cr/MWh`, "win"], ["solarCrPerMw", "Solar capex, all-in", `₹${fmt(W.inputs.solarCrPerMw)} cr/MWac`, "win"], ["rte", "Battery round trip", pct(W.inputs.rte, 0), "win"]]],
  ["Finance", [["targetEquityIrr", "Target equity IRR", pct(W.inputs.targetEquityIrr), "win"], ["interestRate", "Interest · tenor", `${pct(W.inputs.interestRate, 2)} · ${W.inputs.tenorYears} years`, "win"], ["repayment", "Repayment", "Sculpted, DSCR 1.20", "win"]]],
];
const findingLi = (f) => `<li class="${f.severity}"><span>${f.severity === "block" ? "Blocks" : f.severity === "warn" ? "Cost" : "Note"}</span>${esc(f.title)}</li>`;

const stagesHtml = [
  stage("upload", 1, "Tender in: the whole set at once", "Drop the RfS, the agreement and every amendment. Each file is identified, dated and ordered: later amendments override earlier text, and the agreement prevails over the RfS where they differ.", `
          <div class="up-grid">
            <div class="dropzone" id="dropzone"><p class="dz-hint">${icon("tender", "ic sm")} SECI-CfD-I tender set · 6 files</p>
              <ul class="files">
${docs.map((d) => `                <li class="file" data-kind="${d.kind}"><span class="fi">PDF</span><span class="fn"><b>${esc(d.title)}</b><span class="muted small">${d.pages} pages${d.date ? ` · ${dateWords(d.date)}` : ""}</span></span><span class="tag">${esc(d.kind)}</span></li>`).join("\n")}
              </ul></div>
            <div class="up-side">
              <div class="meter"><span>Pages read</span><b id="read-count" data-total="${totalPages}">${totalPages}</b><span>/ ${totalPages}</span></div>
              <ul class="extract">
                <li><b data-n="${TERMS.length}">${TERMS.length}</b><span>conditions, each with its page and quote</span></li>
                <li><b data-n="${changes.length}">${changes.length}</b><span>amendment changes, was and now</span></li>
                <li><b data-n="17">17</b><span>formats to submit, as letters</span></li>
                <li><b data-n="${PACK.bidProcess.length}">${PACK.bidProcess.length}</b><span>steps of the bid process, in order</span></li>
                <li><b data-n="${PACK.queries.length}">${PACK.queries.length}</b><span>pre-bid queries drafted from gaps in the text</span></li>
              </ul>
              <p class="foot">RfS ${esc(PACK.rfsNo)} · ${PACK.tenderedMw} MW × 2 h of assured peak supply</p>
            </div>
          </div>`, false),
  stage("read", 2, "Evidence: every value sits on its page", "Click a value and the tender opens at the page, with the sentence it was read from highlighted. This is the real page of SECI's document, not a summary.", `
          <div class="ev-grid">
            <ul class="ev-list" id="ev-list">
${ev.map((t, k) => `              <li><button type="button" data-ev="${t.id}" class="${k === 0 ? "on" : ""}"><span class="ev-l">${esc(t.label)}</span><span class="ev-v">${esc(cut(t.display, 120))}</span><span class="cite">${esc(t.doc)} · ${esc(t.clause)} · p.${t.page}</span></button></li>`).join("\n")}
            </ul>
            ${pageview("ev-page", "The tender's page")}
          </div>`),
  stage("amend", 3, "Amendments: what changed, word by word", `Four amendments in four months changed ${changes.length} clauses. Each is shown as it stood and as amended, with the words removed and added, the page of SECI's amendment, and what it does to the bid.`, `
          <div class="am-net" id="am-net" aria-label="The tender today against the tender as issued">
${NET.map((n) => `            <button type="button" data-change="${n.change}"><span class="l">${esc(n.label)}</span><span class="was">${esc(n.was)}</span><span class="now">${esc(n.now)}</span><span class="by">A${n.amd}</span></button>`).join("\n")}
          </div>
          <div class="am-grid">
            <div class="am-nav">
              <ol class="am-line" id="am-line">
                <li><span class="node rfs"></span><b>RfS</b><span>${dateWords(PACK.rfsDate)}</span></li>
${[1, 2, 3, 4].map((a) => { const d = PACK.documents.find((x) => x.id === `amd${a}`); return `                <li><button type="button" data-amd="${a}"><span class="node"></span><b>Amendment-0${a}</b><span>${dateWords(d.date)} · ${changes.filter((c) => c.amd === a).length} changes</span></button></li>`; }).join("\n")}
              </ol>
              <ul class="am-list" id="am-list"></ul>
            </div>
            <div class="am-body" id="am-body"><p class="muted">Pick a change.</p></div>
            ${pageview("am-page", "SECI's amendment")}
          </div>`),
  stage("conditions", 4, `${TERMS.length} conditions, and the ones a plant can fail`, "Every condition is kept with its clause. The ones that depend on the plant are tested on every sizing, so a bid that breaks the tender says so before the bid committee sees it.", `
          <div class="cond-grid">
            <div class="groups">
${Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g, n]) => `              <div class="grp"><span class="gl">${esc(g)}</span><span class="gb"><i style="--w:${((n / 44) * 100).toFixed(1)}%"></i></span><span class="gn">${n}</span></div>`).join("\n")}
            </div>
            <div class="cond-test">
              <div class="seg" id="cond-toggle" role="group" aria-label="Which bid"><button type="button" data-bid="win" class="on">Competitive bid · ₹${fmt(M.review.winning.tariff)}</button><button type="button" data-bid="over">Over-built bid · ₹${fmt(M.review.overbuilt.tariff)}</button></div>
              <p class="cond-note">“Met” means met as the tender measures it. The daily 2 MWh per MW is due at the availability the bidder declares (97% here, under Amendment-04), so 194 MWh a day on 100 MW is full compliance; the battery's 200 MWh is nameplate, kept usable at the meter by augmentation.</p>
              <ul class="checks" id="cond-list">
${M.checks.map((c) => `                <li class="${c.status}"><span class="st">${c.status === "met" ? "Met" : c.status === "failed" ? "Failed" : "Watch"}</span><b>${esc(c.label)}</b><span class="d">${esc(c.detail)}</span></li>`).join("\n")}
              </ul>
            </div>
          </div>`),
  stage("team", 5, "Team inputs: one bid, three teams", "Projects, Design and Finance each own a step. Empty boxes fill with the values winning bidders show lenders, marked until someone replaces them. Any box can carry a question, the evidence and a sign-off.", `
          <div class="team-grid">
            <div class="team-cols">
              <div class="team-bar"><button type="button" class="btn small" id="team-fill">Fill for me</button><span class="muted small">Names and messages below are illustrative; the values are the model's.</span></div>
${TEAM_INPUTS.map(([team, rows]) => `              <div class="tcol"><h4>${team}</h4>${rows.map(([k, l, v, src]) => `<div class="tin" data-k="${k}"><span class="tl">${esc(l)}</span><span class="tv" data-v="${esc(v)}">${esc(v)}</span><span class="tag ${src}">${src === "you" ? "Your input" : "Competitive"}</span><span class="tmarks"><i class="clip" title="Evidence">${icon("clip", "ic xs")}</i><i class="so" title="Sign-off">${icon("check", "ic xs")}</i></span></div>`).join("")}</div>`).join("\n")}
            </div>
            <aside class="thread" id="team-thread" aria-label="A thread on Battery capex">
              <h4>Battery capex, all-in <span class="cite">Design · 1 thread</span></h4>
              <div class="msg" data-m="1"><span class="who fin">Finance lead</span><p><b>@design</b> is ₹0.85 cr/MWh backed by an offer for 2028 delivery? The lender will ask.</p></div>
              <div class="msg" data-m="2"><span class="who des">Design engineer</span><p>Yes: supplier offer attached, valid to March. DC block, PCS, EMS and installation.</p><span class="chip">${icon("clip", "ic xs")} Supplier offer (PDF)</span> <button type="button" class="chip act" id="team-fillin">Fill in 0.85</button></div>
              <div class="msg sys" data-m="3"><span class="who adm">Bid head</span><p>${icon("check", "ic xs")} Signed off at ₹0.85 cr/MWh.</p></div>
              <div class="msg sys amber" data-m="4"><span class="who des">Design engineer</span><p>Changed to ₹0.82 cr/MWh. The sign-off turns amber: signed off at an older value.</p></div>
            </aside>
          </div>`),
  stage("studio", 6, "Design studio: move the plant, watch the price", `Drag the sliders. Each plant size is a full run of the model, ${int(M.daysPerSim)} days of operation priced through the financial model; the tender's conditions are tested as you move.`, `
          <div class="sd-grid">
            <form class="sd-controls" id="sd-form" onsubmit="return false">
              <label><span>Own solar <b id="sd-solar-v">${W.solarMw} MWac</b></span><input type="range" id="sd-solar" min="0" max="40" step="2" value="${W.solarMw}"></label>
              <label><span>Own wind <b id="sd-wind-v">0 MW</b></span><input type="range" id="sd-wind" min="0" max="20" step="5" value="0"></label>
              <label><span>Battery capex <b id="sd-ess-v">₹${fmt(W.inputs.essCrPerMwh)} cr/MWh</b></span><input type="range" id="sd-ess" min="0.65" max="1.25" step="0.01" value="${W.inputs.essCrPerMwh}"></label>
              <label><span>Target equity IRR <b id="sd-irr-v">${pct(W.inputs.targetEquityIrr)}</b></span><input type="range" id="sd-irr" min="11" max="17" step="0.25" value="${W.inputs.targetEquityIrr * 100}"></label>
              <div class="sd-actions"><button type="button" class="btn small" id="sd-opt">${icon("optimiser", "ic xs")} Optimise own solar</button><button type="button" class="btn small ghost" id="sd-save">${icon("save", "ic xs")} Save scenario</button></div>
              <div class="saved" id="sd-saved" hidden><h4>Saved scenarios</h4><table><thead><tr><th>Name</th><th class="num">Solar</th><th class="num">Wind</th><th class="num">₹/kWh</th><th class="num">vs base</th></tr></thead><tbody></tbody></table></div>
            </form>
            <div class="sd-view">
              <div class="sd-iso" id="sd-iso">${isoCfd}</div>
              <div class="sd-read">
                <div class="sd-price"><span class="l">Strike price</span><b id="sd-sp">₹${fmt(W.tariff)}</b><span class="s" id="sd-vs">at the evening market</span></div>
                <div class="sd-kv"><span class="l">Project cost</span><b id="sd-capex">₹${int(W.capex.total)} cr</b></div>
                <div class="sd-kv"><span class="l">Days short in 15 years</span><b id="sd-short">0</b></div>
                <div class="sd-kv wide"><span class="l">Where the charging power comes from</span><div class="mix" id="sd-mix"></div></div>
              </div>
              <ul class="sd-checks" id="sd-checks">${M.grid.checks.map((c) => `<li class="met" title="${esc(c.label)}">${esc(c.label.replace(/ \(.*\)/, ""))}</li>`).join("")}</ul>
            </div>
          </div>
          <p class="foot">Behind the sliders: ${M.grid.solar.length * M.grid.wind.length} plants simulated day by day for 15 years and ${int(M.grid.sp.length)} financial models, computed in ${Math.round(M.seconds)} seconds. Plant sizes snap to simulated points; cost and return are interpolated between them.</p>`),
  stage("size", 7, "Optimise: every plant tried, and why one wins", `Each candidate is run for the whole term and priced through the financial model. Too little solar and evenings fall short; too much and it costs more than the power it replaces; wind raises the price on this tender.`, `
          <div class="opt2">
            <div><h4>The search: strike price against own solar</h4><div class="chart" id="chart-scan" role="img" aria-label="Strike price against own solar size, lowest where every day is first met"></div>
              <p class="foot" id="scan-readout">Every day met from ${M.best} MWac; the price rises on either side.</p></div>
            <div><h4>All ${M.grid.solar.length * M.grid.wind.length} plants: own solar across, own wind up, ₹/kWh</h4><div class="chart" id="chart-surface" role="img" aria-label="Strike price for every combination of own solar and own wind"></div>
              <p class="legend"><span class="sw s-low"></span>Lower price <span class="sw s-high"></span>Higher <span class="sw s-fail"></span>Breaks a tender condition <span class="sw s-best"></span>The optimum</p>
              <h4 class="h4b">Why: where the charging power comes from as solar grows, GWh a year</h4><div class="chart" id="chart-mix" role="img" aria-label="Own solar replaces bought charging power as the plant grows"></div>
              <p class="legend"><span class="sw s-solar"></span>Own solar <span class="sw s-bought"></span>Green market <span class="sw s-dis"></span>Group RE</p></div>
          </div>`),
  stage("dispatch", 8, "Dispatch: 96 blocks a day, every day of 15 years", `The battery charges from own solar and bought renewable power, then supplies the two dearest evening hours. Below, ${dateWords(M.day.date)} in 15-minute blocks, and a whole year hour by hour.`, `
          <div class="dp-grid">
            <div><div class="chart" id="chart-day" role="img" aria-label="One day in 15-minute blocks: charging, supply, state of charge and price"></div>
              <p class="legend"><span class="sw s-solar"></span>Own solar charging <span class="sw s-bought"></span>Bought RE charging <span class="sw s-dis"></span>Battery supply <span class="sw s-soc"></span>State of charge <span class="sw s-price"></span>Exchange price</p></div>
            <div class="heat"><canvas id="heat" width="730" height="240" role="img" aria-label="A year of battery operation: each column a day, each row an hour"></canvas>
              <p class="legend"><span class="sw s-solar"></span>Charging <span class="sw s-dis"></span>Supplying · 365 days across, 24 hours down</p>
              <div class="dp-stats"><div><b>${int(M.daysPerSim)}</b><span>days simulated</span></div><div><b>${int(M.daysPerSim * 96)}</b><span>15-minute blocks</span></div><div><b>${fmt(M.day.delivered, 0)} MWh</b><span>supplied on this day, of ${fmt(M.day.required * M.day.availability, 0)} due</span></div></div>
            </div>
          </div>`),
  stage("finance", 9, "Finance: the model behind the price", "The strike price is the one at which equity earns its target over the whole term: construction, debt sculpted to the lender's cover ratio, tax, working capital. Every figure opens its formula.", `
          <div class="tiles">
            <div class="tile" id="fin-sp"><span class="l">Strike price</span><b data-count="${W.tariff}" data-dec="2" data-pre="₹">₹${fmt(W.tariff)}</b><span class="s">per kWh, fixed 15 years</span></div>
            <div class="tile"><span class="l">Equity IRR</span><b data-count="${(W.equityIrr * 100).toFixed(1)}" data-dec="1" data-suf="%">${pct(W.equityIrr)}</b><span class="s">the target, met</span></div>
            <div class="tile"><span class="l">Project IRR</span><b data-count="${(W.projectIrr * 100).toFixed(1)}" data-dec="1" data-suf="%">${pct(W.projectIrr)}</b><span class="s">before financing</span></div>
            <div class="tile"><span class="l">Minimum DSCR</span><b data-count="${W.minDscr}" data-dec="2" data-suf="×">${fmt(W.minDscr)}×</b><span class="s">sculpted</span></div>
            <div class="tile"><span class="l">Project cost</span><b data-count="${Math.round(W.capex.total)}" data-dec="0" data-pre="₹" data-suf=" cr">₹${int(W.capex.total)} cr</b><span class="s">debt ₹${int(W.debt)} cr · equity ₹${int(W.equity)} cr</span></div>
          </div>
          <div class="fin-grid">
            <div><h4>Where each year's revenue goes, ₹ crore</h4><div class="chart" id="chart-cash" role="img" aria-label="Revenue each year split into running costs, debt service, tax and cash to equity"></div>
              <p class="legend"><span class="sw s-opex"></span>Running costs <span class="sw s-debt"></span>Debt service <span class="sw s-tax"></span>Tax <span class="sw s-eq"></span>Cash to equity</p></div>
            <div><h4>What carries the ₹${fmt(W.tariff)}</h4><div class="chart" id="chart-drivers" role="img" aria-label="${esc(M.drivers.map((d) => `${d.label} ₹${fmt(d.value)}`).join(", "))}"></div></div>
          </div>
          <div class="trace" id="fin-trace" hidden><b>Strike price ₹${fmt(W.tariff, 3)}/kWh</b> = the price at which the equity IRR is ${pct(W.equityIrr)} · rests on: battery capex ₹${fmt(W.inputs.essCrPerMwh)} cr/MWh, solar ₹${fmt(W.inputs.solarCrPerMw)} cr/MWac, debt ${pct(W.inputs.debtFraction, 0)} at ${pct(W.inputs.interestRate, 2)} for ${W.inputs.tenorYears} years, tax ${pct(W.inputs.taxRate, 2)}, ${int(M.daysPerSim)} days of dispatch</div>
          <p class="foot">The same model downloads as a live Excel workbook: Live model, Construction, Profit and loss, Cash flow, Balance sheet, Debt, Tax, Working capital, Sensitivity, Bid review and the dispatch sheets. The product's tests recalculate it in LibreOffice against the application.</p>`),
  stage("whatif", 10, "What-if: the levers, and the track to a quote", "Choose the price you want to quote. The model shows what each input is worth, then plans the surest route there, with the chance of each move. Turn a lever down and it finds another way.", `
          <div class="wi-grid">
            <div><h4>What one step of each lever does to the price</h4><div class="chart" id="chart-tornado" role="img" aria-label="${esc(M.levers.slice(0, 8).map((l) => `${l.label}: ₹${fmt(l.down, 3)} to ₹${fmt(l.up, 3)}`).join("; "))}"></div></div>
            <div class="wi-plan">
              <div class="seg" id="wi-targets" role="group" aria-label="The price to quote"><span class="seg-l">Quote</span>${M.tracks.targets.map((t, k) => `<button type="button" data-t="${t.toFixed(2)}" class="${k === 0 ? "on" : ""}">₹${fmt(t)}</button>`).join("")}</div>
              <ol class="track" id="wi-track"></ol>
              <p class="wi-out" id="wi-out"></p>
              <div class="wi-rej" id="wi-rej" hidden></div>
              <button type="button" class="btn small ghost" id="wi-save">${icon("save", "ic xs")} Save as scenario</button>
            </div>
          </div>`),
  stage("wins", 11, "What wins: will SECI's CfD Pool carry this price?", `The bidder sells in the evening market and SECI's Pool pays, or collects, the difference to the strike price. Amendment-04 lets SECI award only what its ₹${TENDER.poolCr} crore corpus can carry.`, `
          <div class="wins-grid">
            <div><h4>The Pool's net pay-out a year for the full ${PACK.tenderedMw} MW, ₹ crore</h4><div class="chart" id="chart-pool" role="img" aria-label="CfD Pool net flow per year against strike price"></div>
              <p class="verdict">${esc(M.verdict.text)}</p></div>
            <div><h4>The risks the bidder keeps</h4><ul class="risks">${M.risks.map((r) => `<li>${esc(r.title)}</li>`).join("")}</ul></div>
          </div>`),
  stage("review", 12, "Bid review: against the rules and the market", "Before the bid goes to the committee it is reviewed against the tender's conditions, the benchmarks, the lender's ratios and what the market has paid. Two bids for the same tender:", `
          <div class="rv-grid">
            <div class="rv-col">
              <div class="seg" id="rv-toggle" role="group" aria-label="Which bid"><button type="button" data-bid="winning" class="on">Competitive · ₹${fmt(M.review.winning.tariff)}</button><button type="button" data-bid="overbuilt">Over-built · ₹${fmt(M.review.overbuilt.tariff)}</button></div>
              <p class="rv-sum" id="rv-sum">${esc(M.review.winning.summary)}</p>
              <ul class="rv-list" id="rv-list">${M.review.winning.findings.map(findingLi).join("")}</ul>
            </div>
            <div class="rv-col"><h4>Market comparables: what SECI's auctions and the exchange have paid, ₹/kWh</h4><div class="chart" id="chart-comps" role="img" aria-label="${esc(comps.map((c) => `${c.code} ₹${fmt(c.lo)} to ${fmt(c.hi)}`).join("; "))}; evening market ₹${fmt(M.evening.all)} to ₹${fmt(M.evening.chosen)}"></div>
              <p class="foot">SECI awards from its result notices. The CfD asks 2 hours for 15 years and is paid through the market, so the evening price, not an FDRE award, is its nearest comparable.</p></div>
          </div>`),
  stage("pack", 13, "The bid pack, ready for the committee", "Everything the tender asks to be submitted, and everything the bid committee asks to see, generated from the same bid.", `
          <ul class="pack">
            <li>${icon("finance")}<b>Financial model, Excel</b><span>A live workbook, every number a formula on the blue inputs; Goal Seek the tariff</span></li>
            <li>${icon("tender")}<b>17 RfS formats as letters</b><span>Filled from the bid in SECI's own wording; Word and PDF; signed copies accepted back</span></li>
            <li>${icon("dispatch")}<b>15-minute dispatch</b><span>96 blocks a day for 15 years, one file per Contract Year</span></li>
            <li>${icon("check")}<b>Conditions checklist</b><span>${TERMS.length} conditions, met, failed or pending, each with its page</span></li>
            <li>${icon("agent")}<b>Pre-bid queries</b><span>${PACK.queries.length} points to raise with SECI, drafted from gaps in the text</span></li>
            <li>${icon("clip")}<b>Evidence register</b><span>Every input, who set it, the evidence attached and the sign-off</span></li>
          </ul>
          <div class="cta-row"><a class="btn" href="#demo">Book a TenderOS demo</a><a class="btn ghost" href="tel:${TEL}">Call ${PHONE}</a><a class="btn ghost" href="/TenderOS-deck.pdf" download>Download the deck</a></div>`),
].join("\n");

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter+Tight:wght@400;500;600;700&display=swap">';
const scaleX = (s) => (SCALE.indexOf(s) / (SCALE.length - 1)) * 100;

const page = `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TenderOS: the platform every IPP was waiting for. Months of bid work, done in hours | jouleWise</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#141517" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f7f5f0" media="(prefers-color-scheme: light)">
<meta name="color-scheme" content="dark light">
<script>try{var t=localStorage.getItem("tos-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
${FONTS}
<meta property="og:type" content="website">
<meta property="og:site_name" content="TenderOS by jouleWise">
<meta property="og:title" content="TenderOS: the platform every IPP was waiting for">
<meta property="og:description" content="Watch a SECI tender become a bid: read with page evidence, amendments word by word, plant sized by a HiGHS optimiser, model priced, bid reviewed. On your premises.">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/og.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:locale" content="en_IN">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="TenderOS: the platform every IPP was waiting for">
<meta name="twitter:description" content="Bid workspace for Indian RE tenders: evidence-linked reading, plant optimiser, financial model, bid review. Live demo and SECI auction data.">
<meta name="twitter:image" content="${SITE}/og.jpg">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/plain" href="/llms.txt" title="LLM summary">
<link rel="alternate" type="text/csv" href="/data/seci-results.csv" title="SECI auction results (CSV)">
<link rel="stylesheet" href="/assets/styles.css">
<link rel="stylesheet" href="/assets/iso.css">
${jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap nav">
    <a href="/" class="brand" aria-label="TenderOS home"><span class="w1">Tender</span><span class="w2">OS</span><span class="by">by jouleWise</span></a>
    <nav aria-label="Sections"><a href="#tour">Tour</a><a href="#tenders">Tenders</a><a href="#optimiser">Optimiser</a><a href="#security">Security</a><a href="#results">SECI data</a></nav>
    <a class="nav-tel" href="tel:${TEL}">${PHONE}</a>
    <a class="btn small" href="#demo">Book a demo</a>
    <a class="btn small ghost" href="/TenderOS-deck.pdf" download>Deck</a>
    <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to day mode" title="Day mode"><svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg></button>
  </div>
</header>

<main id="main">
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">Bid workspace for renewable energy tenders · India</p>
      <p class="kicker">The platform every IPP was waiting for</p>
      <h1>Months of bid work. <em>Done in hours.</em></h1>
      <p class="lede">TenderOS reads the tender and every amendment, sizes the solar, wind and battery plant against each condition, prices the bid for your target return and builds the bid pack. Every number traces to its page or its formula, and all of it runs on your premises.</p>
      <div class="cta-row"><a class="btn" href="#tour">Watch a tender become a bid</a><a class="btn ghost" href="#demo">Book a TenderOS demo</a><a class="btn ghost" href="/TenderOS-deck.pdf" download>Deck (PDF)</a></div>
      <p class="muted small">Call <a href="tel:${TEL}">${PHONE}</a> · The tour below runs on SECI's CfD-I tender with example inputs; its figures show the product at work, they are not a price to bid.</p>
    </div>
    <div class="hero-stats">
      <div><b>${totalPages}</b><span>pages of tender, read with page and quote</span></div>
      <div><b>${TERMS.length}</b><span>conditions and ${changes.length} amendment changes kept current</span></div>
      <div><b>25 years</b><span>of a PPA optimised and modelled, hour by hour and year by year</span></div>
      <div><b>Yours</b><span>every price is tender-specific: your costs, your sites, your return</span></div>
    </div>
  </div>
  <div class="wrap"><div class="hero-iso" id="hero-iso"><p class="hero-cap" id="hero-cap">${heroTenders.length ? heroCap(heroTenders[0]) : ""}</p><div class="hero-draw" id="hero-draw" aria-hidden="true">${heroTenders.length ? ISO.forTender(heroTenders[0]) : isoHero}</div><div class="hero-dots" id="hero-dots" role="tablist" aria-label="Tenders on the market">${heroTenders.map((t, k) => `<button type="button" role="tab" aria-selected="${k === 0}" aria-label="${esc(t.name)}" data-k="${k}"></button>`).join("")}</div><p class="iso-key"><span class="k-charge"></span>charging from own solar <span class="k-wind"></span>and wind <span class="k-bought"></span>bought renewable power <span class="k-supply"></span>evening supply <span class="k-money"></span>settlement</p><p class="hero-scan">Drawn from the tenders open at SECI and NHPC, scanned ${dateWords(scannedDay)}. The picture changes as tenders are issued, amended and closed.</p></div></div>
</section>

<section id="time" class="band">
  <div class="wrap">
    <p class="eyebrow">Why bid teams use it</p>
    <h2>Where the months go, and what is left of them</h2>
    <p class="lede narrow">A tender set runs to hundreds of pages and keeps changing: CfD-I had four amendments in four months, and one removed the ceiling tariff. Each step below is weeks of spreadsheet work that an amendment sends back to the start.</p>
    <p class="time-key"><span><i class="dot hand"></i><b>Grey:</b> indicative effort for a bid team working from PDFs and spreadsheets.</span><span><i class="dot tos"></i><b>Green:</b> TenderOS, from the product's documentation and tests.</span><span class="rest">What remains is judgement: confirming the reading, choosing the inputs, deciding the price.</span></p>
    <div class="time" role="table" aria-label="Time by hand and in TenderOS">
      <div class="time-head" role="row"><span role="columnheader">The work</span><span class="time-axis" role="columnheader">${SCALE.map((s) => `<i style="left:${scaleX(s)}%">${s}</i>`).join("")}</span><span role="columnheader">In TenderOS</span></div>
${TIME.map(([task, hand, tos, note]) => `      <div class="time-row" role="row"><span class="tt" role="cell">${esc(task)}</span><span class="time-bar" role="cell" aria-label="By hand: ${hand}. In TenderOS: ${tos}."><i class="span" style="left:${scaleX(tos)}%;width:${scaleX(hand) - scaleX(tos)}%"></i><i class="dot tos" style="left:${scaleX(tos)}%"></i><i class="dot hand" style="left:${scaleX(hand)}%"></i></span><span class="tn" role="cell">${esc(note)}</span></div>`).join("\n")}
    </div>
    <p class="muted small">* The formats and letters are filled from the bid in hours. The legal documents behind them (board resolutions, powers of attorney, bank guarantees, signed and stamped copies) depend on your organisation's readiness.</p>
  </div>
</section>

<section id="tour" class="sim-section">
  <div class="wrap">
    <p class="eyebrow">Guided product tour</p>
    <h2>Watch SECI CfD-I become a bid</h2>
    <p class="lede narrow">Thirteen screens of the application, narrated and driven for you. Take the mouse at any time: every slider, tab and button below works, on real results of the model.</p>
    <div class="seg" id="tour-routes" role="group" aria-label="How much of the tour"><span class="seg-l">Watch</span><button type="button" data-route="short">90-second overview · 5 screens</button><button type="button" data-route="full" class="on">Full tour · 13 screens</button></div>
    <p class="example-note">A worked example on illustrative inputs for a 100 MW bid. The prices it shows demonstrate the method; your own depend on your costs, sites and return.</p>
    <div class="sim" id="sim">
      <div class="sim-bar"><span class="dots"><i></i><i></i><i></i></span><span class="sim-title" id="sim-title">TenderOS · SECI CfD-I · 100 MW bid</span><span class="sim-mode" id="sim-mode" hidden>You have the controls</span><span class="sim-ctl"><button id="sim-voice" class="voice" aria-pressed="false" aria-label="Voice-over" title="Voice-over"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path class="wave" d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/><path class="mute" d="M16 9l5 6M21 9l-5 6"/></svg><span>Voice</span></button><button id="sim-prev" aria-label="Previous screen">‹</button><button id="sim-play" aria-label="Play the tour">▶ Play with voice</button><button id="sim-next" aria-label="Next screen">›</button></span></div>
      <div class="sim-progress"><i id="sim-progress"></i></div>
      <ol class="sim-rail" role="tablist" aria-label="Screens of the tour">
${stepper}
      </ol>
      <div class="sim-screen" id="sim-screen">
${stagesHtml}
        <div class="cursor" id="cursor" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.5L10 19z"/></svg><i></i></div>
      </div>
      <div class="sim-caption" id="sim-caption" hidden aria-live="polite"><span class="cc" title="The narration is an AI-generated voice">AI voice</span><p id="sim-caption-text"></p></div>
    </div>
    <noscript><p class="muted">The tour animates with JavaScript; its content is shown above as text.</p></noscript>
  </div>
</section>

<section id="tenders" class="band">
  <div class="wrap">
    <p class="eyebrow">One workspace, every kind of tender</p>
    <h2>Each tender has its own plant, rules and price</h2>
    <p class="lede narrow">The same reading, sizing, model and review, with the rules of the tender in front of you. Three kinds the application works today:</p>
    <div class="seg big" id="tt-tabs" role="tablist" aria-label="Tender type"><button type="button" role="tab" data-tt="cfd" class="on" aria-selected="true">Contract for Difference</button><button type="button" role="tab" data-tt="fdre" aria-selected="false">FDRE round the clock</button><button type="button" role="tab" data-tt="bess" aria-selected="false">Standalone battery</button></div>
    <div class="tt" id="tt-cfd" role="tabpanel">
      <div class="tt-iso">${isoCfd}</div>
      <div class="tt-text">
        <div><h3>SECI CfD-I: 500 MW × 2 h of evening supply, sold on the exchange</h3>
        <dl><dt>The tender asks</dt><dd>2 MWh per MW every evening for 15 years, from a battery you own, charged from own RE, the green market (25%) and group RE (50% after month 36). SECI's Pool settles each block to the strike price.</dd>
        <dt>TenderOS does</dt><dd>Sizes own solar and wind for the least strike price with every day met, tests the sourcing limits year by year, and sizes the Pool's pay-out against the ₹${TENDER.poolCr} crore corpus.</dd></dl></div>
        <div><p class="tt-note">On this tender wind raises the price and a little own solar lowers it: the studio in the tour above lets you try both. A bid at the evening market's price leaves the Pool neutral, which is what Amendment-04 makes decisive.</p><div class="tt-kpi"><div><b>${TERMS.length}</b><span>conditions, each on its page</span></div><div><b>${changes.length}</b><span>amendment changes applied</span></div><div><b>₹${TENDER.poolCr} crore</b><span>the corpus the award must fit</span></div></div></div>
      </div>
    </div>
    <div class="tt" id="tt-fdre" role="tabpanel" hidden>
      <div class="tt-iso">${isoFdre}</div>
      <div class="tt-text">
        <div><h3>SECI FDRE-RTC-V: 1,000 MW firm, round the clock</h3>
        <dl><dt>The tender asks</dt><dd>Supply in every block of the day against floors by hour band (Solar Hours 50 to 60%, the remaining hours 70%, Peak Hours 90%), with penalties at a multiple of the tariff for what is short.</dd>
        <dt>TenderOS does</dt><dd>Optimises solar, wind and battery together over every hour of the year, then bridges its benchmark tariff to the auction's result, lever by lever. Hatched steps are estimates, as the application marks them.</dd></dl>
        <div class="tt-kpi"><div><b>₹${fmt(rtc.bridge[rtc.bridge.length - 1].tariff)}</b><span>the bridge ends here</span></div><div><b>₹5.25–5.26</b><span>the seven winners bid</span></div><div><b>${fmt(rtcPlant.solar)} · ${fmt(rtcPlant.wind)} · ${fmt(rtcPlant.bessMwh)}</b><span>MWac solar · MW wind · MWh battery per contracted MW</span></div></div></div>
        <div>${bridgeChart}
        <ol class="bridge-key">${rtc.bridge.map((b) => `<li${b.kind === "estimate" ? ' class="est"' : ""}>${esc(b.label)}</li>`).join("")}</ol></div>
      </div>
    </div>
    <div class="tt" id="tt-bess" role="tabpanel" hidden>
      <div class="tt-iso">${isoBess}</div>
      <div class="tt-text">
        <div><h3>Standalone battery: ${bess.req.powerMw} MW / ${bess.req.energyMwh} MWh for ${bess.req.contractYears} years</h3>
        <dl><dt>The tender asks</dt><dd>${bess.req.cyclesPerDay} cycles a day, ${pct(bess.req.availability, 0)} availability, a round trip of at least ${pct(bess.req.minRte, 0)}, and the full energy at the delivery point every year of the contract. (The application's example tender; yours is read from its document.)</dd>
        <dt>TenderOS does</dt><dd>Tries ${bess.evals} plans of oversizing against augmentation and keeps the one with the least capacity charge for the target return. Here: ${int(bess.cohorts[0].mwh)} MWh installed on day one, then a top-up every year.</dd></dl>
        <div class="tt-kpi"><div><b>₹${fmt(bess.charge)} lakh</b><span>per MW per month</span></div><div><b>${pct(bess.equityIrr, 0)}</b><span>equity IRR, the target</span></div><div><b>${bess.compliance.filter((c) => c.ok).length} of ${bess.compliance.length}</b><span>tender conditions met</span></div></div></div>
        <div>${augChart}<p class="muted small">MWh of battery installed in each contract year: oversized on day one, topped up every year so the full energy is there at the delivery point.</p></div>
      </div>
    </div>
  </div>
</section>

<section id="optimiser">
  <div class="wrap opt-grid">
    <div>
      <p class="eyebrow">The engine</p>
      <h2>A state-of-the-art optimiser, not a goal-seek</h2>
      <p class="lede">A spreadsheet tries a handful of plants. TenderOS states the tender as a linear programme and solves it with HiGHS, the leading open-source solver: solar, wind and battery power and energy chosen together, for the lowest tariff that still earns your return.</p>
      <ul class="ticks">
        <li><b>Every hour of the year.</b> 8,760 hours for the years that bind, or all 25: generation, charging, discharge, state of charge, sale and shortfall in each.</li>
        <li><b>The tender's own floors.</b> By block, month and year; peak, off-peak and solar hours; ramp limits; the state-of-charge window; penalties at a multiple of the tariff or hard floors.</li>
        <li><b>Real plants.</b> Degradation, battery fade and augmentation, separate sites each with its battery, one or two pooling stations, losses to the billing meter.</li>
        <li><b>Minutes, not days.</b> One to two minutes for a 25-year case on four cores, and each run starts from the last, so a changed input re-solves faster.</li>
        <li><b>Then proved in 15-minute blocks.</b> 35,040 blocks a year, the compliance workbook the tender's scheduling rules ask for.</li>
      </ul>
    </div>
    <div class="opt-card">
      <div class="opt-stat"><b>8,760</b><span>hours a year, each with its own balance</span></div>
      <div class="opt-stat"><b>1–2 min</b><span>a 25-year case, 4 CPU cores</span></div>
      <div class="opt-stat"><b>93 → 53 s</b><span>re-solve after a 5% change in wind cost, starting from the last solution</span></div>
      <div class="opt-stat"><b>${bess.evals}</b><span>battery plans compared for one BESS bid</span></div>
      <div class="opt-stat"><b>${int(M.sims)}</b><span>full-term CfD simulations behind this page</span></div>
    </div>
  </div>
</section>

<section id="team" class="band">
  <div class="wrap">
    <p class="eyebrow">Built for the whole bid team</p>
    <h2>Cross-functional team, one platform</h2>
    <div class="three">
      <div class="card">${icon("team")}<h3>Work together</h3><p>Steps by team. Ping a colleague from any input with an @mention, keep the thread on the box, assign a question and fill in the answer from the reply. Email for mentions and assignments.</p></div>
      <div class="card">${icon("clip")}<h3>Evidence and sign-off</h3><p>A paperclip on every input for the quote, report or data sheet behind it. A super admin signs off; change the value later and the tick turns amber. An evidence register and an activity log for the audit.</p></div>
      <div class="card">${icon("save")}<h3>Scenarios are saved</h3><p>Every save is a named scenario. Each further save is a new version; earlier versions are kept and can be restored. Compare up to 12 scenarios side by side on bid day.</p></div>
    </div>
    <div class="table-wrap"><table class="teams"><thead><tr><th>Team</th><th>What TenderOS gives them</th></tr></thead><tbody>
      <tr><th>Tender and legal</th><td>The tender and amendments reconciled, every condition with its page and quote, the formats and letters in the RfS's wording, a pre-bid query list</td></tr>
      <tr><th>Projects</th><td>Capacity, dates, supply profile, sourcing and market sale in one place; the sized plant and its compliance block by block</td></tr>
      <tr><th>Design</th><td>Solar and wind studios, hourly profiles, losses to the billing meter, pooling stations, deviation settlement per CERC norms</td></tr>
      <tr><th>Finance</th><td>Financing terms, construction and IDC, repayment methods, refinancing, working capital, DSRA, the 25-year model and its Excel twin</td></tr>
      <tr><th>Management</th><td>The tariff for the target IRR, the levers for bid day, what wins, sign-off per input, the audit trail</td></tr>
    </tbody></table></div>
  </div>
</section>

<section id="security">
  <div class="wrap">
    <p class="eyebrow">Cybersecurity</p>
    <h2>Your bid never leaves your premises</h2>
    <p class="lede narrow">TenderOS is installed on your infrastructure. The tender, which is a public document, is parsed in a DMZ. Everything that is yours, the costs, the profiles, the model and the price, is worked in a core zone that has no route to the internet.</p>
    <div class="sec-draw">${ISO.security()}</div>
    <p class="iso-key sec-key"><span class="k-charge"></span>tender documents in <span class="k-bought"></span>document text to cloud models, optional <span class="k-supply"></span>allowed, inside your perimeter <span class="k-money"></span>signed patch bundles, carried in <span class="k-block"></span>blocked</p>
    <div class="sec-legend">
      <div><h3>Internet</h3><ol><li value="1">Tender portals: SECI, NHPC and others, public tender PDFs</li><li value="2">Cloud language models, optional: read the tender's text and scanned pages</li></ol></div>
      <div><h3>DMZ · intake zone</h3><ol><li value="3">Intake application: upload, review and confirm the reading</li><li value="4">Reader: cloud models, or the rule-based reader with no cloud at all</li><li value="5">MCP connectors and the voice agent, on subscription: here only, never in the core</li><li value="6">Tender documents, the reading with page and quote, the search index</li></ol></div>
      <div><h3>Core zone · your network</h3><ol><li value="7">Bid workspace: inputs, costs, evidence, forms</li><li value="8">Optimiser and dispatch, on internal-only container networks</li><li value="9">Financial model and the Excel workbook</li><li value="10">Team, scenarios, sign-off, activity log</li><li value="11">Database and files; provider keys under AES-256-GCM</li><li value="12">Backups: database and files, the newest 14 kept</li></ol></div>
      <div><h3>Around the core</h3><ol><li value="13">Your bid team, over HTTPS only: roles, access tab by tab</li><li value="14">Your own mail server and directory: the core's only outbound route</li><li value="15">jouleWise patch bundles, signed (EC P-256): verified, backed up, applied, health-checked</li></ol></div>
    </div>
    <div class="sec-cross"><p><b>Crosses into the core:</b> the tender documents and their reviewed reading, one way; signed patch bundles.</p><p><b>Never leaves the core:</b> your costs, profiles, sizing, the financial model, the scenarios and the price.</p></div>
    <div class="table-wrap"><table class="modes"><caption>Which AI features run where</caption><thead><tr><th>Deployment</th><th>Tender reading</th><th>Voice agent and MCP connectors</th><th>What a cloud model can see</th></tr></thead><tbody>
      <tr><th>Two zones, on your premises</th><td>In the DMZ: cloud models, or the rule-based reader with none</td><td>In the DMZ only, on the tender's reading; switched off in the core</td><td>The tender documents, which are public. Never the bid, the costs or the model</td></tr>
      <tr><th>Single installation</th><td>Cloud models from the same installation, or the rule-based reader</td><td>On, across the workspace, for the users you allow</td><td>The tender documents, and what a connected assistant is asked to read or change through its tools</td></tr>
    </tbody></table></div>
    <div class="sec-grid">
${SECURITY.map(([k, t, d]) => `      <article class="mod">${icon(k)}<h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join("\n")}
    </div>
    <p class="muted small">On the roadmap, not in the current release: single sign-on, and a cryptographically signed transfer package between the zones.</p>
  </div>
</section>

<section id="what" class="band">
  <div class="wrap">
    <p class="eyebrow">Everything in the application</p>
    <h2>Sixteen modules, one bid</h2>
    <div class="modules">
${MODULES.map(([k, t, d]) => `      <article class="mod">${icon(k)}<h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join("\n")}
    </div>
    <div class="ask">
      <div class="ask-q"><span class="who">Bid manager</span>Can SECI award us less than we bid for?</div>
      <div class="ask-a"><span class="who">TenderOS</span>${esc(termById.corpusCap?.display || "")} <span class="cite">Amendment-04 · ${esc(termById.corpusCap?.clause || "")} · p.${termById.corpusCap?.page}</span></div>
    </div>
  </div>
</section>

<section id="results">
  <div class="wrap">
    <p class="eyebrow">Open data</p>
    <h2>SECI's recent auction results</h2>
    <p class="lede narrow">Eight SECI e-reverse auctions from May 2025 to August 2026, read from SECI's result notices: every bidder awarded with the capacity it bid and won at its final tariff. Open a row for the bidders. Free to reuse: <a href="/data/seci-results.csv" download>CSV</a> · <a href="/data/seci-results.json">JSON</a>.</p>
    <div class="filters" role="group" aria-label="Filter by product"><button class="chip on" data-filter="all">All</button>${productOrder.map((p) => `<button class="chip" data-filter="${esc(p)}">${esc(p)}</button>`).join("")}</div>
    ${rangeChart}
    ${resultsTable}
    <div class="insights">
      <div><b>Firm power carries a clear premium.</b> Wind cleared at ₹3.67–3.85 and solar with storage at ₹2.86–3.13, while four hours of assured peak supply cleared at ₹5.99–6.28 and round-the-clock FDRE at ₹5.25–5.26: storage and firmness, not energy, set the price.</div>
      <div><b>Assured-peak tariffs have eased.</b> The same four-hour product cleared at ₹6.27–6.28 (FDRE-VII, Feb 2026) and at ₹5.99–6.00 (FDRE-IX, Aug 2026). Two auctions do not isolate a cause: battery prices, financing, tender terms and competition all moved.</div>
      <div><b>Bids cluster tightly.</b> In most auctions the awarded tariffs sit within one to seven paise of each other, because bidders match the lowest price to win capacity. Bidding the right price matters more than bidding low.</div>
    </div>
  </div>
</section>

<section id="open" class="band">
  <div class="wrap">
    <p class="eyebrow">New tenders radar</p>
    <h2>Open at SECI and NHPC, scanned ${dateWords(scannedDay)}</h2>
    <p class="lede narrow">Every day TenderOS reads the tender lists of SECI and NHPC and each open tender's page (${market.counts.tenders} tenders, ${market.counts.ipp} for developers, ${market.documentsOpened} documents opened) and reports what is new: a tender issued, an amendment or corrigendum posted, a deadline moved, a result published.</p>
    ${eventsList ? `<h3 class="h3">What changed lately</h3>${eventsList}` : ""}
    <h3 class="h3">Open now${market.counts.nhpc ? "" : " (no developer tender is open at NHPC today)"}</h3>
    ${openTable}
  </div>
</section>

<section id="faq" class="wrap faq">
  <h2>Questions</h2>
${FAQ.map(([q, a]) => `  <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
</section>

<section id="buy" class="band">
  <div class="wrap">
    <p class="eyebrow">How you buy and deploy it</p>
    <h2>From a walkthrough to your own installation</h2>
    <div class="steps4">
      <div><span>1</span><h3>Walkthrough on your tender</h3><p>One tender you are bidding: its conditions and amendments, a sized plant, the tariff and what carries it, the review. You see your own case, not a canned one.</p></div>
      <div><span>2</span><h3>What you supply</h3><p>A server (4 vCPU, 16 GB, Docker) on your cloud or premises, the tender documents, and your team's inputs: costs, sites, profiles, financing terms.</p></div>
      <div><span>3</span><h3>What you receive</h3><p>The application installed and running, tender packs for the tenders you bid, the Excel workbook and bid pack of every bid, documentation, a test matrix and an installation guide.</p></div>
      <div><span>4</span><h3>Under the annual contract</h3><p>Signed patches, new tender packs as tenders are issued and amended, support on installation and upgrades, and the change requests your team raises in the application, implemented and shipped.</p></div>
    </div>
    <p class="muted small">Licence with installation and an annual maintenance contract, priced per engagement. Ask for the commercial terms with your demo.</p>
  </div>
</section>

<section id="demo" class="cta-band">
  <div class="wrap demo-grid">
    <div>
      <p class="eyebrow">Book a TenderOS demo</p>
      <h2>See it on your next tender</h2>
      <p>A working session with the jouleWise team on a live SECI, NHPC or NTPC tender of your choice. In it you will see:</p>
      <ul class="ticks"><li>the tender read with page evidence, and what each amendment changed</li><li>the plant sized against its conditions, and the conditions it meets or fails</li><li>the tariff for your return, what carries it and which levers move it</li><li>the review of the bid and the outputs: Excel model, formats, 15-minute dispatch</li></ul>
      <p class="demo-direct">Prefer to talk first? Call <a href="tel:${TEL}">${PHONE}</a> or write to <a href="mailto:${CONTACT_EMAIL}?subject=TenderOS%20demo">${CONTACT_EMAIL}</a>.</p>
    </div>
    <form class="demo-form" id="demo-form" data-to="${CONTACT_EMAIL}" action="mailto:${CONTACT_EMAIL}?subject=TenderOS%20demo%20request" method="post" enctype="text/plain">
      <label>Name<input name="name" autocomplete="name" required></label>
      <label>Company<input name="company" autocomplete="organization" required></label>
      <label>Work email<input name="email" type="email" autocomplete="email" required></label>
      <label>Phone <span class="opt">optional</span><input name="phone" type="tel" autocomplete="tel"></label>
      <label>Your role<select name="role"><option>Bidding</option><option>Engineering and design</option><option>Finance</option><option>Legal and contracts</option><option>Management</option></select></label>
      <label>Tender type or reference<input name="tender" placeholder="e.g. FDRE, CfD, BESS, or the RfS number"></label>
      <label class="wide">What you want to evaluate<textarea name="goal" rows="3" placeholder="e.g. sizing against the block floors, the effect of the latest amendment, the Excel model"></textarea></label>
      <label class="wide">Preferred time <span class="opt">optional</span><input name="when" placeholder="e.g. weekday afternoons, India time"></label>
      <button class="btn wide" type="submit">Request the demo</button>
      <p class="wide muted small" id="demo-sent" hidden>Your mail application has opened with the request addressed to ${CONTACT_EMAIL}: send it from there. If nothing opened, call ${PHONE}.</p>
      <p class="wide muted small">This opens your own mail with the details filled in; nothing you type here is stored or sent by this page. <a href="/privacy">Privacy</a>.</p>
    </form>
  </div>
</section>
</main>

<footer class="wrap foot-site">
  <p><span class="brand sm"><span class="w1">Tender</span><span class="w2">OS</span></span> is a product of <a href="https://www.joulewise.tech">jouleWise</a>. Call <a href="tel:${TEL}">${PHONE}</a> or write to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. Auction data from <a href="${SECI_SITE}" rel="noopener">SECI's result notices</a>; tender pages and quotes from the SECI CfD-I RfS and its amendments, SECI's documents, shown to illustrate the reading. Model figures from the application's own code, built ${dateWords(BUILT)}.</p>
  <p class="small"><a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a> · <a href="/data/seci-results.csv">SECI results (CSV)</a> · <a href="/data/cfd-demo.json">demo data (JSON)</a> · <a href="/sitemap.xml">sitemap</a> · <a href="/privacy">privacy</a></p>
</footer>
<button class="sticker" id="chat-open" type="button" aria-expanded="false" aria-controls="chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8a2.5 2.5 0 01-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 014 13.5z"/><path d="M8 8h8M8 11.5h5"/></svg><span><b>Message the jouleWise team</b><small>Ask a question, leave a note</small></span></button>
<div class="chat" id="chat" role="dialog" aria-label="Message the jouleWise team" hidden>
  <header><div><b>Message the jouleWise team</b><small>Saved for the team. Quick answers are automatic.</small></div><button type="button" class="chat-x" aria-label="Close the chat">×</button></header>
  <div class="chat-log" aria-live="polite"></div>
  <div class="chat-chips" aria-label="Common questions"></div>
  <form class="chat-who" hidden>
    <input name="name" placeholder="Your name" autocomplete="name" aria-label="Your name" maxlength="160">
    <input name="company" placeholder="Company" autocomplete="organization" aria-label="Company" maxlength="160">
    <input class="wide" name="reach" placeholder="Phone or email, for the reply" aria-label="Phone or email" maxlength="160" required>
    <button class="btn small wide" type="submit">Send my details</button>
  </form>
  <form class="chat-form">
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <textarea rows="2" maxlength="1500" placeholder="Type your message" aria-label="Your message" required></textarea>
    <button class="btn small" type="submit">Send</button>
  </form>
  <p class="chat-status" role="status"></p>
  <p class="chat-foot">Or call <a href="tel:${TEL}">${PHONE}</a>. What you write here is kept so the team can reply: <a href="/privacy">privacy</a>.</p>
</div>
<script type="application/json" id="chat-data">${JSON.stringify(CHAT).replace(/</g, "\\u003c")}</script>
<script src="/assets/track.js" defer></script>
<script src="/assets/iso.js" defer></script>
<script src="/assets/app.js" defer></script>
<script src="/assets/chat.js" defer></script>
</body>
</html>
`;
write("index.html", page);

// ------------------------------------------------------------------ the privacy notice
write("privacy/index.html", `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy | TenderOS by jouleWise</title>
<meta name="description" content="What the TenderOS site counts about a visit, what a personal link is, and how to turn both off.">
<link rel="canonical" href="${SITE}/privacy">
<meta name="color-scheme" content="dark light">
<script>try{var t=localStorage.getItem("tos-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
${FONTS}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
<header class="top"><div class="wrap nav"><a href="/" class="brand" aria-label="TenderOS home"><span class="w1">Tender</span><span class="w2">OS</span><span class="by">by jouleWise</span></a><nav aria-label="Sections"><a href="/">Back to the site</a></nav><a class="nav-tel" href="tel:${TEL}">${PHONE}</a></div></header>
<main id="main" class="wrap prose">
  <p class="eyebrow">Privacy</p>
  <h1>What this site counts</h1>
  <p>This notice covers the public site ${SITE.replace("https://", "")}. The TenderOS application itself runs on your own premises and sends jouleWise nothing.</p>
  <h2>Visits</h2>
  <p>Visits are counted with Vercel Web Analytics, a service of our hosting provider. It sets no cookies and keeps no advertising profile. For each page view it records the page, the site you came from, the country, and the kind of device and browser. Visitors are told apart by a hash that is reset every day, so a visit today cannot be joined to a visit tomorrow.</p>
  <p>The site also records what was used: that the guided tour was started and which screens were reached, that the deck was downloaded, that the phone number or the demo button was pressed, which sections were read and roughly how long the page stayed open. Nothing you type is recorded: not the design studio's numbers, and not the demo request, which opens in your own mail application and is sent from there.</p>
  <h2>Messages</h2>
  <p>The chat box in the corner of the site is for writing to the jouleWise team. What you write there, and the name, company and phone number or email you choose to leave, is saved on our hosting provider's storage and sent to the team by email, so that they can read it and reply to you. With it we keep the time, the page you were on, your country and your personal link's label if you came through one. The quick answers in the chat are automatic: they are taken from the questions and answers on the site, and no language model reads your message.</p>
  <h2>Personal links</h2>
  <p>If jouleWise sent you a link of the form <code>${SITE.replace("https://", "")}/for/a-name</code>, that name is a label for you or your company. It is kept in your browser for 90 days and attached to the events above, so that we know the person we wrote to has looked at the site and what interested them. We use it to follow up with you and for nothing else. A visit without such a link carries no label.</p>
  <h2>Your choice</h2>
  <p id="track-state" class="note" aria-live="polite"></p>
  <p class="cta-row"><button class="btn ghost" type="button" data-track="forget">Forget my personal link</button><button class="btn ghost" type="button" data-track="off">Stop counting my visits</button><button class="btn ghost" type="button" data-track="on">Count my visits again</button></p>
  <p>These switches act on this browser only. To have your messages or what was recorded under your personal link deleted, or to ask anything else, write to <a href="mailto:${CONTACT_EMAIL}?subject=TenderOS%20privacy">${CONTACT_EMAIL}</a> or call <a href="tel:${TEL}">${PHONE}</a>.</p>
  <p class="small muted">jouleWise · last changed ${dateWords(BUILT)}</p>
</main>
<script src="/assets/track.js" defer></script>
</body>
</html>
`);

// ------------------------------------------------------------------ the sales team's link maker (not linked from the site)
write("links/index.html", `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Personal links | TenderOS</title>
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark light">
<script>try{var t=localStorage.getItem("tos-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
${FONTS}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
<header class="top"><div class="wrap nav"><a href="/" class="brand" aria-label="TenderOS home"><span class="w1">Tender</span><span class="w2">OS</span><span class="by">by jouleWise</span></a><nav aria-label="Sections"><a href="/">Back to the site</a></nav></div></header>
<main id="main" class="wrap prose">
  <p class="eyebrow">For the jouleWise sales team</p>
  <h1>Make a personal link</h1>
  <p>Give each prospect their own link. Their visits and what they used on the site are then recorded under that label, in Vercel Analytics, for as long as their browser keeps it (90 days from the last time they open the link).</p>
  <form class="demo-form" id="link-form" onsubmit="return false">
    <label class="wide">Company, and the person if you want to tell colleagues apart<input id="link-name" placeholder="e.g. Acme Renewables, bid team" autocomplete="off" required></label>
    <label class="wide">Their link<input id="link-out" readonly></label>
    <button class="btn wide" type="button" id="link-copy">Copy the link</button>
    <p class="wide muted small" id="link-note">The label is visible to the prospect in the address bar: use a company name or initials, nothing you would not show them. Open links you are only testing in a private window, or your own browser will carry the label.</p>
  </form>
  <h2>Where to see who came</h2>
  <p>In this site's Vercel Analytics. Under Pages, a personal visit shows as <code>/for/the-label</code>. Under Events, open any event (Personal link, Tour screen, Deck downloaded, Call tapped) and break it down by <code>ref</code>.</p>
</main>
<script>
(function () {
  var name = document.getElementById("link-name"), out = document.getElementById("link-out"), copy = document.getElementById("link-copy");
  var slug = function (s) { return s.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 48); };
  var make = function () { var t = slug(name.value); out.value = t ? "${SITE}/for/" + t : ""; };
  name.addEventListener("input", make);
  copy.addEventListener("click", function () { if (!out.value) { name.focus(); return; } out.select(); (navigator.clipboard ? navigator.clipboard.writeText(out.value) : Promise.reject()).then(function () { copy.textContent = "Copied ✓"; }, function () { document.execCommand("copy"); copy.textContent = "Copied ✓"; }); setTimeout(function () { copy.textContent = "Copy the link"; }, 1800); });
})();
</script>
</body>
</html>
`);

// ------------------------------------------------------------------ the deck (rendered to PDF by render.mjs)
const slide = (cls, inner) => `<section class="slide ${cls}">${inner}<footer><span class="brand sm"><span class="w1">Tender</span><span class="w2">OS</span></span><span>tenderos.joulewise.tech</span></footer></section>`;
const deckPage = (() => {
  const c = changes.find((x) => x.id === "a3-rfs-40.3"), marks = pageData.marks[c.id] || [], key = marks[0]?.page, pg = pageData.pages[key];
  if (!pg) return "";
  return `<div class="dk-page"><img src="${pg.src}" alt="">${marks.filter((m) => m.page === key).flatMap((m) => m.rects.map(([x, y, w, h]) => `<i class="${m.kind}" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%"></i>`)).join("")}</div>`;
})();
const scanSvg = (() => { const xs = (mw) => 40 + (mw / 60) * 400, ys = (sp) => 220 - ((sp - 8) / 1.6) * 190; return `<svg viewBox="0 0 460 250" class="dk-chart"><line x1="40" y1="220" x2="440" y2="220" class="ax"/><line x1="40" y1="20" x2="40" y2="220" class="ax"/>${[8, 8.5, 9, 9.5].map((v) => `<text x="34" y="${ys(v) + 4}" text-anchor="end">₹${v}</text>`).join("")}${[0, 20, 40, 60].map((v) => `<text x="${xs(v)}" y="238" text-anchor="middle">${v} MWac</text>`).join("")}<polyline class="ln" points="${M.scan.map((p) => `${xs(p.mw)},${ys(p.sp)}`).join(" ")}"/>${M.scan.filter((p) => p.shortMwh > 0).map((p) => `<circle cx="${xs(p.mw)}" cy="${ys(p.sp)}" r="3.5" class="short"/>`).join("")}<circle cx="${xs(M.best)}" cy="${ys(W.tariff)}" r="6" class="best"/></svg>`; })();
const compRows = [...comps.slice(0, 4).map((c) => [c.code, c.buys, `₹${fmt(c.lo)}–${fmt(c.hi)}`]), ["Evening market, the two dearest hours", "IEX price year", `₹${fmt(M.evening.chosen)}`], ["Evening market, all hours 18:00–24:00", "IEX price year", `₹${fmt(M.evening.all)}`]];
const plan750 = M.tracks.plans["7.50|"];
const lv = (s, v) => (s.pct ? `${(v * 100).toFixed(2).replace(/\.?0+$/, "")}%` : `${+v.toFixed(3)}`);
const deck = `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><title>TenderOS deck</title><meta name="robots" content="noindex">${FONTS}<link rel="stylesheet" href="/assets/deck.css"><link rel="stylesheet" href="/assets/iso.css"></head><body>
${slide("cover", `<div class="cv"><p class="eyebrow">jouleWise</p><h1><span class="w1">Tender</span><span class="w2">OS</span></h1><p class="kick">The platform every IPP was waiting for</p><p class="big">Months of bid work. Done in hours.</p><p class="muted">Bid workspace for renewable energy tenders in India · ${dateWords(BUILT)}</p></div>`)}
${slide("", `<h2>Where the months go</h2><p class="sub">Each step is weeks of spreadsheet work that an amendment sends back to the start.</p><table class="dk-t wide"><thead><tr><th>The work</th><th>By hand</th><th>In TenderOS</th></tr></thead><tbody>${TIME.map(([t, hand, , note]) => `<tr><td>${esc(t)}</td><td class="hand">${hand}</td><td>${esc(note)}</td></tr>`).join("")}</tbody></table><p class="small muted">By hand: indicative, for a team working from PDFs and spreadsheets. TenderOS: from the product's documentation and tests. * Legal documents depend on your organisation's readiness.</p>`)}
${slide("", `<h2>From tender PDF to bid pack</h2><ol class="flow">${STAGES.map(([, t, s]) => `<li><b>${esc(t)}</b><span>${esc(s)}</span></li>`).join("")}</ol>`)}
${slide("", `<h2>Read with evidence, amendments word by word</h2><div class="cols2"><div><div class="stats2"><div class="stat"><b>${TERMS.length}</b><span>conditions, each with page and quote</span></div><div class="stat"><b>${changes.length}</b><span>amendment changes, was and now</span></div></div><table class="dk-t">${NET.slice(0, 5).map((n) => `<tr><td>${esc(n.label)}</td><td class="hand">${esc(n.was)}</td><td>${esc(n.now)}</td></tr>`).join("")}</table></div><div>${deckPage}<p class="small muted">SECI's Amendment-03, page 4: the ₹5.80 ceiling removed. Red: as it stood. Green: as amended.</p></div></div>`)}
${slide("", `<h2>Design the plant, see the price</h2><p class="sub">SECI CfD-I, 100 MW, illustrative inputs. ${M.grid.solar.length * M.grid.wind.length} plants simulated for 15 years, ${int(M.grid.sp.length)} financial models, ${Math.round(M.seconds)} seconds.</p><div class="dk-iso wide">${isoCfd}</div><div class="cols2 low"><div>${scanSvg}</div><div><div class="stat"><b>${M.best} MWac · ₹${fmt(W.tariff)}/kWh</b><span>the optimum: every day met, ${pct(W.equityIrr)} equity IRR, DSCR ${fmt(W.minDscr)}×</span></div><p>Move own solar, wind, battery cost and the equity return: the strike price, the project cost, the days short and the tender's conditions follow. Below ${M.best} MWac days fall short; above it solar costs more than the power it replaces.</p></div></div>`)}
${slide("", `<h2>Every kind of tender</h2><div class="isorows"><div><div class="dk-iso">${isoCfd}</div><div><b>Contract for Difference</b><p>SECI CfD-I: 2 h of evening supply through the exchange, settled by SECI's Pool. Strike price ₹${fmt(W.tariff)} on 100 MW with ${W.solarMw} MWac of own solar.</p></div></div><div><div class="dk-iso">${isoFdre}</div><div><b>FDRE round the clock</b><p>SECI FDRE-RTC-V: floors in every block of the day. The bridge runs from ₹${fmt(rtc.bridge[0].tariff)} to ₹${fmt(rtc.bridge[rtc.bridge.length - 1].tariff)}; the winners bid ₹5.25.</p></div></div><div><div class="dk-iso">${isoBess}</div><div><b>Standalone battery</b><p>${bess.req.powerMw} MW / ${bess.req.energyMwh} MWh, ${bess.req.cyclesPerDay} cycles a day: ₹${fmt(bess.charge)} lakh per MW per month at a ${pct(bess.equityIrr, 0)} IRR, ${bess.evals} plans compared.</p></div></div></div>`)}
${slide("", `<h2>A state-of-the-art optimiser</h2><p class="sub">The tender stated as a linear programme, solved with HiGHS: the lowest tariff that still earns your return.</p><div class="cols2"><ul><li><b>Every hour of the year</b>: 8,760 hours for the years that bind, or all 25</li><li><b>The tender's own floors</b>: by block, month and year; peak, off-peak, solar hours; penalties</li><li><b>Real plants</b>: degradation, fade, augmentation, separate sites, losses to the meter</li><li><b>Proved in 15-minute blocks</b>: 35,040 a year</li></ul><div><div class="stat"><b>1–2 min</b><span>a 25-year case on four cores</span></div><div class="stat"><b>93 → 53 s</b><span>re-solve from the last solution</span></div><div class="stat"><b>${int(M.daysPerSim * 96)}</b><span>15-minute blocks in a CfD term</span></div></div></div>`)}
${slide("", `<h2>What-if: the track to a quote</h2><p class="sub">From ₹${fmt(W.tariff)} to a quote of ₹7.50: the surest route, each move with its chance. Turn a lever down and the model finds another.</p><div class="cols2"><table class="dk-t"><thead><tr><th>Lever, one step</th><th class="num">down</th><th class="num">up</th></tr></thead>${M.levers.slice(0, 8).map((l) => `<tr><td>${esc(l.label)}</td><td class="num">₹${fmt(l.down, 3)}</td><td class="num">₹${fmt(l.up, 3)}</td></tr>`).join("")}</table><div>${plan750 ? `<table class="dk-t"><thead><tr><th>Move</th><th class="num">chance</th><th class="num">price after</th></tr></thead>${plan750.steps.map((s) => `<tr><td>${esc(s.label)}: ${lv(s, s.from)} → ${lv(s, s.to)}</td><td class="num">${Math.round(s.p * 100)}%</td><td class="num">₹${fmt(s.price, 3)}</td></tr>`).join("")}</table>` : ""}<p class="small muted">Scenarios are saved with versions; up to 12 compared side by side.</p></div></div>`)}
${slide("", `<h2>Bid review, with market comparables</h2><div class="cols2"><div><div class="rvd good"><b>₹${fmt(M.review.winning.tariff)}</b> ${esc(M.review.winning.summary)}</div><div class="rvd bad"><b>₹${fmt(M.review.overbuilt.tariff)}</b> ${esc(M.review.overbuilt.summary)}</div><ul class="small">${M.review.overbuilt.findings.filter((f) => f.severity !== "note").slice(0, 5).map((f) => `<li>${esc(f.title)}</li>`).join("")}</ul></div><div><table class="dk-t"><thead><tr><th>Comparable</th><th>What it buys</th><th class="num">₹/kWh</th></tr></thead>${compRows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="num">${r[2]}</td></tr>`).join("")}</table><p class="small muted">The Pool is about neutral at the evening price; SECI may cut the award to its ₹${TENDER.poolCr} crore corpus.</p></div></div>`)}
${slide("", `<h2>Your bid never leaves your premises</h2><div class="dk-iso sec">${ISO.security()}</div><div class="dk-zones"><div><b>Internet</b><p>Tender portals. Cloud language models, optional.</p></div><div class="dmz"><b>DMZ · intake zone</b><p>Tender documents, their reading with page and quote, a reviewer's confirmation. Or the rule-based reader, with no cloud at all.</p></div><div class="core"><b>Core zone · your network</b><p>Inputs, costs, evidence, optimiser, financial model, team, scenarios, bid pack. No route to the internet.</p></div></div><div class="cols3 tight"><div><b>Secrets</b><p>scrypt passwords, httpOnly sessions, throttled sign-in, keys in AES-256-GCM.</p></div><div><b>Control</b><p>Roles, access tab by tab, an activity log for 400 days, backups.</p></div><div><b>Updates and connectors</b><p>Signed patch bundles, verified before applying. MCP connectors on subscription, in the intake zone only.</p></div></div>`)}
${slide("", `<h2>Cross-functional team, one platform</h2><div class="cols3"><div><b>Work together</b><p>Steps by team. Pings with @mentions and threads on any input, assignments, email, answers filled in from the reply.</p></div><div><b>Evidence and sign-off</b><p>A paperclip on every input. Sign-off turns amber if the value changes. Evidence register and activity log.</p></div><div><b>Scenarios are saved</b><p>Named scenarios with versions, restored at will, up to 12 compared side by side.</p></div></div>`)}
${slide("", `<h2>SECI's recent auctions</h2><table class="dk-t wide"><thead><tr><th>Auction</th><th>Product</th><th class="num">MW</th><th class="num">₹/kWh</th><th>Date</th></tr></thead><tbody>${results.map((r) => `<tr><td>${esc(codeOf(r))}</td><td>${esc(r.product)}</td><td class="num">${int(r.awardedMw)}</td><td class="num">${fmt(r.tariffLow)}–${fmt(r.tariffHigh)}</td><td>${dateWords(r.auctionDate)}</td></tr>`).join("")}</tbody></table><p class="small muted">From SECI's result notices. Every bidder: tenderos.joulewise.tech/data/seci-results.csv</p>`)}
${slide("", `<h2>Everything in the application</h2><div class="mods">${MODULES.map(([, t, d]) => { const f1 = d.split(". ")[0].split(": ")[0]; return `<div><b>${esc(t)}</b><p>${esc(f1.length > 110 ? cut(f1, 108) : `${f1}.`)}</p></div>`; }).join("")}</div>`)}
${slide("", `<h2>How we work with you</h2><div class="cols2"><div><b>You receive</b><ul><li>The application installed on your cloud or on-premises (Docker)</li><li>Tender packs for the tenders you bid</li><li>The Excel workbook and bid pack of every bid</li><li>Documentation, test matrix and installation guide</li></ul></div><div><b>Under the annual contract</b><ul><li>Signed patches and new tender packs</li><li>Change requests raised in the application, implemented and shipped</li><li>Support on installation and upgrades</li></ul></div></div>`)}
${slide("cover", `<div class="cv"><h2>See it on your next tender</h2><p class="big">${PHONE}</p><p>${CONTACT_EMAIL} · tenderos.joulewise.tech/#demo</p><p class="muted">Live tour and SECI auction data: tenderos.joulewise.tech</p></div>`)}
</body></html>`;
write("deck/index.html", deck);

// ------------------------------------------------------------------ LLM and crawler files
const llms = `# TenderOS by jouleWise

> TenderOS is a bid workspace for renewable energy tenders in India (SECI, NHPC, NTPC, state utilities) that turns months of bid work into hours. It reads a tender and its amendments with every value tied to its document, page and quote; sizes solar, wind and battery plants against the tender's conditions with a HiGHS linear optimiser; prices the bid for a target equity IRR through a 25-year financial model exported as a live Excel workbook; reviews the bid against the tender and recent awards; and produces the bid pack. It runs on the client's premises: the tender is parsed in a DMZ, the bid stays in a core zone with no route to the internet.

Key facts:
- Maker: jouleWise (https://www.joulewise.tech). Book a demo: ${SITE}/#demo. Contact: ${PHONE}, ${CONTACT_EMAIL}
- Tender types: Contract for Difference (SECI CfD-I), FDRE round-the-clock (SECI FDRE-RTC-V), assured peak supply, standalone BESS, solar or wind with storage.
- Language models read documents and draft summaries only; a person confirms every value. Sizing (HiGHS linear programming), dispatch, the financial model and the bid review are deterministic code.
- Speed, from the product's documentation: a tender read in 1 to 4 minutes; a 25-year optimisation in 1 to 2 minutes on 4 cores; what-if instant.
- MCP connectors are available on subscription (18 tools for Claude or another MCP client); in the two-zone deployment they run in the intake zone only.
- Collaboration: steps by team, pings and threads, evidence on every input, sign-off, activity log. Scenarios are saved with versions; up to 12 compared side by side.
- Worked example on SECI CfD-I (RfS ${PACK.rfsNo}, 500 MW × 2 h): ${TERMS.length} conditions with pages, ${changes.length} amendment changes quoted. On illustrative inputs for a 100 MW bid the optimiser keeps ${W.solarMw} MWac of own solar and prices the strike at ₹${fmt(W.tariff)}/kWh at a ${pct(W.equityIrr)} equity IRR. This shows the method, not a price to bid: every bid is tender-specific.
- Market watch: the tender lists of SECI and NHPC are scanned daily for new tenders, amendments, moved deadlines and result notices.

## Pages
- [Product tour and overview](${SITE}/): the thirteen-screen tour, tender types, the optimiser, security, SECI results, open SECI tenders, FAQ
- [Deck (PDF)](${SITE}/TenderOS-deck.pdf)
- [Full text for language models](${SITE}/llms-full.txt)

## Data
- [SECI auction results, CSV](${SITE}/data/seci-results.csv): one row per bidder in eight SECI e-reverse auctions (May 2025 – Aug 2026), awarded or not, with bid MW, awarded MW and final tariff, and the SECI notice
- [SECI auction results, JSON](${SITE}/data/seci-results.json)
- [Open tenders at SECI and NHPC and what changed, JSON](${SITE}/data/market-scan.json): scanned daily, last on ${dateWords(scannedDay)}
- [CfD-I demo numbers, JSON](${SITE}/data/cfd-demo.json): the amendments with diffs, the design surface, a day's dispatch, the levers and tracks, the Pool, the bid review
`;
write("llms.txt", llms);
const g = M.grid;
const spAt = (s, w, e, q) => g.sp[((s * g.wind.length + w) * g.ess.length + e) * g.irr.length + q];
const llmsFull = `${llms}
## Months of work in hours
${TIME.map(([t, hand, tos, note]) => `- ${t}: by hand, ${hand} (indicative); in TenderOS, ${tos} (${note})`).join("\n")}

## Modules
${MODULES.map(([, t, d]) => `- **${t}**: ${d}`).join("\n")}

## Security and deployment
${SECURITY.map(([, t, d]) => `- **${t}**: ${d}`).join("\n")}
- Roadmap, not in the current release: single sign-on; a cryptographically signed transfer package between the zones.

## The optimiser
A linear programme solved with HiGHS over every hour of the year (8,760) for the years that bind or all 25. It chooses solar, wind and battery power and energy together; honours floors by block, month and year over peak, off-peak and solar hours, ramp limits, the state-of-charge window, penalties or hard floors, separate sites and pooling stations; and minimises the tariff for the target equity IRR. One to two minutes for a 25-year case on four cores; re-runs start from the last solution (93 s to 53 s after a 5% change in wind cost). A 15-minute dispatch (35,040 blocks a year) proves compliance.

## Tender types
- Contract for Difference, SECI CfD-I: strike price ₹${fmt(W.tariff)}/kWh on 100 MW with ${W.solarMw} MWac own solar and a 100 MW / 200 MWh battery.
- FDRE round the clock, SECI FDRE-RTC-V (${rtc.result.winners}): the application's bridge, ${rtc.bridge.map((b) => `${b.label} ₹${fmt(b.tariff)}${b.kind === "estimate" ? " (estimate)" : ""}`).join(" → ")}. Plant at the last step per contracted MW: ${fmt(rtcPlant.solar)} MWac solar, ${fmt(rtcPlant.wind)} MW wind, ${fmt(rtcPlant.bess)} MW / ${fmt(rtcPlant.bessMwh)} MWh battery.
- Standalone battery (the application's example, ${bess.req.powerMw} MW / ${bess.req.energyMwh} MWh, ${bess.req.contractYears} years, ${bess.req.cyclesPerDay} cycles a day): capacity charge ₹${fmt(bess.charge)} lakh per MW per month at a ${pct(bess.equityIrr, 0)} equity IRR; ${int(bess.cohorts[0].mwh)} MWh installed on day one, augmented every year.

## The tour, screen by screen (SECI CfD-I)
${STAGES.map(([, t, s], i) => `${i + 1}. ${t}: ${s}`).join("\n")}

### The tender set
${docs.map((d) => `- ${d.title} (${d.pages} pages${d.date ? `, ${d.date}` : ""}): ${d.summary}`).join("\n")}

### The tender today against the tender as issued
${NET.map((n) => `- ${n.label}: ${n.was} → ${n.now} (Amendment-0${n.amd})`).join("\n")}

### All ${changes.length} amendment changes
${changes.map((c) => `- ${c.amdTitle}, ${c.document} ${c.clause}, page ${c.page} — ${c.topic}: ${c.effect}`).join("\n")}

### Conditions by group (${TERMS.length})
${Object.entries(groups).map(([k, n]) => `- ${k}: ${n}`).join("\n")}

### Sample conditions with evidence
${ev.map((t) => `- ${t.label}: ${t.display} [${t.doc}, ${t.clause}, page ${t.page}] Quote: "${t.quote}"`).join("\n")}

### Conditions tested on the competitive bid
${M.checks.map((c) => `- ${c.label}: ${c.status} (${c.detail})`).join("\n")}

### Design surface (100 MW; battery ₹0.85 cr/MWh, 13% equity IRR): own solar MWac → strike price ₹/kWh at 0 MW wind [days short in 15 years]
${g.solar.map((s, k) => `${s} → ${fmt(spAt(k, 0, 1, 1), 3)} [${g.phys[k * g.wind.length].shortDays}]`).join("; ")}
With 10 MW of own wind at 10 MWac solar: ₹${fmt(spAt(5, 2, 1, 1), 3)} (wind raises the price on this tender).

### Financial result
Strike price ₹${fmt(W.tariff, 3)}/kWh; equity IRR ${pct(W.equityIrr)}; project IRR ${pct(W.projectIrr)}; minimum DSCR ${fmt(W.minDscr)}; project cost ₹${int(W.capex.total)} crore (debt ₹${int(W.debt)} crore, equity ₹${int(W.equity)} crore). What carries the price: ${M.drivers.map((d) => `${d.label} ₹${fmt(d.value)}`).join("; ")}.

### What-if levers (one step down / up, ₹/kWh)
${M.levers.slice(0, LEVERS_SHOWN).map((l) => `- ${l.label} (now ${lv(l, l.value)}${l.pct ? "" : ` ${l.unit}`}, step ${lv(l, l.step)}): ₹${fmt(l.down, 3)} / ₹${fmt(l.up, 3)}`).join("\n")}
Tracks: ${M.tracks.targets.map((t) => { const p = M.tracks.plans[`${t.toFixed(2)}|`]; return `to ₹${fmt(t)}: ${p.steps.map((s) => `${s.label} ${lv(s, s.from)}→${lv(s, s.to)}`).join(", ")} (chance ${Math.round(p.chance * 100)}%)`; }).join("; ")}.

### What wins: CfD Pool net flow a year for 500 MW (positive = the Pool pays)
${M.pool.map((p) => `₹${fmt(p.sp)} → ₹${fmt(p.cr, 1)} cr`).join("; ")}. ${M.verdict.text}

### Bid review
- Competitive bid ₹${fmt(M.review.winning.tariff)}: ${M.review.winning.summary} ${M.review.winning.findings.map((f) => `[${f.severity}] ${f.title}`).join("; ")}
- Over-built bid ₹${fmt(M.review.overbuilt.tariff)}: ${M.review.overbuilt.summary} ${M.review.overbuilt.findings.map((f) => `[${f.severity}] ${f.title}`).join("; ")}
- Market comparables: ${comps.map((c) => `${c.code} (${c.buys}) ₹${fmt(c.lo)}–${fmt(c.hi)}`).join("; ")}; evening market ₹${fmt(M.evening.chosen)} in the two dearest hours, ₹${fmt(M.evening.all)} over all evening hours.

## SECI auction results (₹/kWh as discovered; ${TRADING_MARGIN_NOTE})
| Auction | Product | Tendered MW | Awarded MW | Tariff range | Weighted | Auction date | Winners | Source |
|---|---|---|---|---|---|---|---|---|
${results.map((r) => `| ${r.tender} | ${r.product} | ${r.tenderedMw}${r.storageMwh ? ` (${r.storageMwh} MWh)` : ""} | ${r.awardedMw} | ${fmt(r.tariffLow)}–${fmt(r.tariffHigh)} | ${fmt(r.tariffWeighted, 3)} | ${r.auctionDate} | ${r.winners.map((w) => `${w.name} ${int(w.awardedMw)} MW @ ${fmt(w.tariff)}`).join("; ")} | ${r.sources[0]?.url || ""} |`).join("\n")}

## Open tenders at SECI and NHPC (scanned ${market.scannedAt}, no documents opened)
${openRows.map((t) => `- [${t.source}] ${t.title} (${t.ref || ""}), bids due ${t.bidDeadline}${t.status !== "open" ? `, ${t.status}` : ""}: ${t.summary}`).join("\n")}

### What changed lately
${market.events.slice(0, 20).map((e) => `- ${e.date} ${e.source} ${e.kind}: ${e.tender} — ${e.detail}`).join("\n")}

## The tour's narration
${Object.entries(narration.clips).map(([id, t]) => `- ${id}: ${t}`).join("\n")}

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
${["/", "/privacy", "/TenderOS-deck.pdf", "/llms.txt", "/llms-full.txt", "/data/seci-results.csv", "/data/seci-results.json", "/data/market-scan.json", "/data/cfd-demo.json"].map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${BUILT}</lastmod></url>`).join("\n")}
</urlset>
`);
write("vercel.json", JSON.stringify({
  cleanUrls: true,
  // a personal link, /for/<tag>, is the home page: src/track.js reads the tag from the path
  rewrites: [{ source: "/for/:tag", destination: "/" }],
  headers: [
    { source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=600" }] },
    { source: "/pages/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }, { key: "X-Robots-Tag", value: "noindex" }] },
    { source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] },
    { source: "/for/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    { source: "/links", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    { source: "/data/(.*)", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
    { source: "/TenderOS-deck.pdf", headers: [{ key: "Content-Disposition", value: "attachment; filename=\"TenderOS-deck.pdf\"" }] },
  ],
}, null, 2));
mkdirSync(join(OUT, "assets"), { recursive: true });
for (const f of ["styles.css", "iso.css", "app.js", "iso.js", "track.js", "chat.js", "deck.css"]) copyFileSync(join(HERE, "src", f), join(OUT, "assets", f));
copyFileSync(join(HERE, "src/favicon.svg"), join(OUT, "favicon.svg"));
// the one server function, POST /api/chat, and the package file that gives it its storage library
mkdirSync(join(OUT, "api"), { recursive: true });
copyFileSync(join(HERE, "src/api/chat.js"), join(OUT, "api/chat.js"));
write("package.json", `${JSON.stringify({ name: "tenderos-site", private: true, type: "module", dependencies: { "@vercel/blob": "^2.9.0" } }, null, 2)}\n`);
log(`wrote ${OUT} (index.html ${Math.round(page.length / 1024)} KB, demo.json ${Math.round(JSON.stringify(demo).length / 1024)} KB)`);
