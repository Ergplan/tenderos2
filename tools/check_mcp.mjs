// Checks for TenderOS's MCP server (web/lib/mcp.js): the JSON-RPC handshake and tool list, each
// tool's schema, the tender tools with their page links, the What-if check, the winning-bid
// bridge, and a whole bid in one session (benchmarks, sizing on a stand-in engine, results,
// financials, a quoted tariff). Run from the repository root:   node tools/check_mcp.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOLS, handlePost, setMarketPrices } from "../web/lib/mcp.js";

setMarketPrices(JSON.parse(readFileSync(new URL("../web/public/market/iex_hourly_prices.json", import.meta.url))));
const base = "https://demo.example";
let sized = 0;
// a stand-in for the engine: a plant shaped like the default Amendment-03 sizing (200 MW)
const lpOf = (payload) => {
  sized += 1;
  const mw = payload.ctx.plantMw;
  return {
    ok: true, tariff: 7.46, sizes: { solarMw: 2.217 * mw, windMw: 1.193 * mw, bessMw: 2.155 * mw, bessMwh: 8.622 * mw }, evacuationEfficiency: 0.991,
    perYear: [{ year: 1, rules: [{ id: "peak", basis: "block", hoursMet: 0.91, shortfallMu: 20, met: false }, { id: "solar", basis: "block", hoursMet: 0.99, shortfallMu: 0.5, met: false },
      { id: "remaining", basis: "block", hoursMet: 0.91, shortfallMu: 29, met: false }], blockShortfallMu: 49.9 }],
    lifetime: Array.from({ length: 25 }, (_, i) => ({ year: i + 1, demandMwh: mw * 8760, deliveredMwh: (6363.5 - 6.4 * i) * mw, exportMwh: 0, exportRevenueCr: 0, blockShortfallMwh: 250 * mw })),
  };
};
const size = async (payload) => { await new Promise((r) => setTimeout(r, 20)); return lpOf(payload); };
let id = 0;
const rpc = (method, params) => ({ jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) });
const post = (body, session) => handlePost(body, session, { base, size });
const call = async (session, name, args = {}) => {
  const out = await post(rpc("tools/call", { name, arguments: args }), session);
  assert.equal(out.status, 200, name);
  return { ...JSON.parse(out.body.result.content[0].text), isError: out.body.result.isError };
};

// ---- the handshake: a session id, the protocol version asked for, tools only
const init = await post(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check", version: "1" } }));
assert.equal(init.status, 200);
assert.equal(init.body.result.protocolVersion, "2025-06-18");
assert.ok(init.body.result.capabilities.tools && /FDRE-RTC-V/.test(init.body.result.instructions));
const sid = init.sessionId;
assert.ok(sid && sid.length > 20);
assert.equal((await post(rpc("initialize", { protocolVersion: "1999-01-01" }))).body.result.protocolVersion, "2025-06-18", "an unknown version gets ours");
assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sid)).status, 202, "a notification gets 202, no body");
assert.equal((await post(rpc("nope"), sid)).body.error.code, -32601);
const batch = await post([rpc("ping"), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("tools/list")], sid);
assert.ok(Array.isArray(batch.body) && batch.body.length === 2, "a batch: a reply per request");

// ---- the tools: names, titles, object schemas whose required keys exist
const list = (await post(rpc("tools/list"), sid)).body.result.tools;
assert.deepEqual(list.map((t) => t.name), TOOLS.map((t) => t.name));
for (const t of list) {
  assert.ok(/^[a-z_]{3,40}$/.test(t.name) && t.title && t.description.length > 40, t.name);
  assert.equal(t.inputSchema.type, "object", t.name);
  for (const k of t.inputSchema.required || []) assert.ok(k in t.inputSchema.properties, `${t.name}.${k}`);
  assert.equal(typeof t.annotations.readOnlyHint, "boolean", t.name);
}

// ---- the tender, with links to the PDF pages
const hit = await call(sid, "tender_lookup", { query: "solar hours excess half tariff" });
assert.ok(hit.matches.length > 0);
const cited = JSON.stringify(hit);
assert.ok(cited.includes(`${base}/tenders/seci-rtc-tm-v/Amendment-03.pdf#page=`), "a cited quote links to its page");
const conds = await call(sid, "list_conditions", { group: "Supply" });
assert.ok(conds.conditions.some((c) => c.id === "dfrSolar" && /50%/.test(c.rule) && c.sources[0].link.endsWith("#page=3")));
const amd3 = await call(sid, "amendment_changes", { amendment: "amd3" });
assert.equal(amd3.amendment.title, "Amendment-03");
assert.equal(amd3.changes.length, 8);
assert.ok((await call(sid, "amendment_changes", { amendment: "amd9" })).isError);
assert.ok((await call(sid, "tender_brief")).conditions.some((t) => /solar hours/i.test(t)));

// ---- What-if and the winning bid: instant, no session state
const what = await call(sid, "check_bid", { contracted_mw: 300, tariff: 7, solar_mwac: 785, wind_mw: 440, bess_mw: 635, bess_hours: 4 });
assert.ok(what.ok && what.atTariff.equityIrrPct > 0 && what.tariffForTargetIrr > 5 && what.checks.length >= 4, JSON.stringify(what).slice(0, 300));
assert.deepEqual(what.year1.floors.map((f) => f.hours), ["peak", "solar", "remaining"], "Amendment-03 by default");
const before = await call(sid, "check_bid", { profile: "amd1" });
assert.deepEqual(before.year1.floors.map((f) => f.hours), ["peak", "offpeak"]);
const cheaper = await call(sid, "check_bid", { bess_capex_cr_per_mwh: 0.85 });
assert.ok(cheaper.tariffForTargetIrr < what.tariffForTargetIrr, "cheaper storage, lower tariff");
assert.ok((await call(sid, "check_bid", { contracted_mw: -5 })).isError);
const win = await call(sid, "winning_bid");
assert.equal(win.bridge[0].tariff, 6.5);
assert.equal(win.bridge[1].step, "Amendment-03");
assert.ok(/5\.25/.test(win.result.winners));

// ---- a whole bid in this session: inputs, sizing, results, financials, a quote
assert.ok((await call(sid, "run_optimizer")).isError, "inputs missing: refuses to size");
assert.ok((await call(sid, "set_input", { key: "bidMw", value: 200 })).ok);
assert.ok((await call(sid, "use_benchmarks")).ok);
const st = await call(sid, "get_status");
assert.equal(st.bid.contractedMw, 200);
assert.equal(st.inputsMissing, "none");
const run = await call(sid, "run_optimizer");
assert.ok(run.ok && run.status === "done" && run.plant.solarMw === 443 && run.sizingTariff === 7.46, JSON.stringify(run).slice(0, 300));
assert.equal(sized, 1);
const fin = await call(sid, "get_financials");
assert.ok(fin.bidTariff > 0 && fin.equityIrrPct > 0 && fin.minDscr > 0, JSON.stringify(fin));
const quote = await call(sid, "check_tariff", { tariff: Math.floor(fin.bidTariff * 100) / 100 - 0.2 });
assert.ok(quote.ok && quote.status === "below" && quote.equityIrrPct < fin.equityIrrPct);
const gen = await call(sid, "explain_generation", { source: "solar" });
assert.ok(gen.ok !== false, JSON.stringify(gen).slice(0, 200));
const forms = await call(sid, "review_bid_forms");
assert.ok(forms.checks.length > 5);

// another session has its own bid; an unknown session id (a restart) starts a fresh one
const other = (await post(rpc("initialize", { protocolVersion: "2025-03-26" }))).sessionId;
assert.notEqual(other, sid);
assert.equal((await call(other, "get_status")).optimizer, "not run");
assert.equal((await call("gone-after-restart", "get_status")).optimizer, "not run");
assert.equal((await call(sid, "get_status")).optimizer, "sized", "the first session keeps its sizing");

console.log(`MCP checks passed (${list.length} tools; sized once; ${hit.matches.length} tender matches with page links)`);
