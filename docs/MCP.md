# TenderOS in Claude: the MCP server and connector

TenderOS runs a remote MCP server (Model Context Protocol). Add its address to Claude as a custom
connector, and Claude can work a SECI FDRE-RTC-V bid in a chat:

* read the tender, citing the document and page, with a link to the PDF page;
* fill the bid model and size the plant with HiGHS;
* get the 25-year financial model and check a tariff the bidder may quote;
* test any plant instantly (What-if);
* explain how the auction's winners reached ₹5.25.

Every number comes from the app's own model, the same code the SECI tab runs.

* Code: `web/lib/mcp.js` (the server) and `web/app/api/mcp/[token]/route.js` (the address).
* Check: `tools/check_mcp.mjs`, part of `make check-web`.

## The tools

| Tool | What it does |
| --- | --- |
| `tender_brief` | The key bid conditions after the three amendments, in plain words |
| `tender_lookup` | Search the RfS, Amendments 01–03, Clarifications-01 and the PSA: conditions, changes and clarifications, each with document, page, quote and a link to the page |
| `list_conditions` | The conditions in force in one group (or all), with what an amendment changed |
| `amendment_changes` | What one amendment changed, clause by clause, before and after |
| `get_status`, `list_inputs`, `set_input`, `use_benchmarks` | The bid kept for this conversation: read it, change one input, fill the rest with benchmarks |
| `run_optimizer`, `sizing_status` | Size the least-tariff plant with HiGHS on the engine (about a minute; `run_optimizer` waits up to 3 minutes, `sizing_status` waits for one still running) |
| `get_results`, `get_financials` | The sized plant (floors met, EMD, PBG, net worth, dates) and the 25-year model (tariff for the target IRR, equity and project IRR, DSCR) |
| `check_tariff` | The equity and project IRR at a quoted tariff, with a warning below the target |
| `explain_generation` | Generation as a formula with the bid's numbers (MW × CUF × 8,760 h …); checks the user's own figure |
| `review_bid_forms` | The RfS formats the bid needs, blanks left, and every check against the tender |
| `check_bid` | What-if: any plant, any tariff, instantly (rule-based dispatch, no optimisation): IRRs, DSCR, LCOE, the tariff the target needs, floors met, penalty, tender checks |
| `winning_bid` | The auction result and the bridge from ₹6.50 to ₹5.25, step by step |

Each MCP session (one chat in Claude) has its own bid on the server. The bid starts as the SECI
tab's defaults: 300 MW, Amendment-03's profile, and the 6 costliest IEX hours as Peak Hours. It is
kept for 6 hours and lost on a restart; after that, Claude starts again from the defaults.

## Switch it on (the VM)

1. **Pick a token.** It is the only key, so keep the URL private. On the VM, in the Demo 2 folder:

   ```
   echo "MCP_TOKEN=$(openssl rand -hex 24)" >> .env
   grep MCP_TOKEN .env
   ```

2. **Update and restart.** This also routes `/api/mcp/*` to Demo 2 without the chooser cookie:

   ```
   git pull && docker compose build web && docker compose up -d web router
   ```

3. **HTTPS.** Claude reaches the server from Anthropic's cloud, so it needs a public HTTPS address.
   * Use Demo 2's router with HTTPS (`deploy/demo2/docker-compose.demo2-https.yml`): the address is
     `https://34-131-67-235.sslip.io`.
   * Port 443 must be open to Anthropic's outbound addresses, `160.79.104.0/21` (IPv4 only).
   * Or leave 443 open to everyone for the demo.

4. **Check it from your laptop.**

   ```
   curl -s -X POST https://<site>/api/mcp/<token> -H 'content-type: application/json' \
     -H 'accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
   ```

   The answer names the server `tenderos`. A wrong token gets 404, and a GET gets 405 (no event
   stream).

Without `MCP_TOKEN`, or with one shorter than 16 characters, the address answers 404: the server is
off.

## Add it to Claude

* **claude.ai or Claude Desktop (Pro, Max; Free allows one custom connector):**
  1. Go to Customize › Connectors and choose "Add custom connector".
  2. Name it TenderOS and enter the URL `https://<site>/api/mcp/<token>`.
  3. For authentication, choose "No sign-in".

  In a chat, turn it on under + › Connectors. A connector added on claude.ai also appears in the
  Desktop app.
* **Team or Enterprise:** an Owner adds it first, under Organization settings › Connectors › Add ›
  Custom. Each member then clicks Connect.
* **Claude Code:** `claude mcp add --transport http tenderos https://<site>/api/mcp/<token>`

A single tool call may take up to 240 seconds in claude.ai and Desktop, so the sizing fits.

## A demo script

Ask Claude, in this order:

1. "Using TenderOS, what did Amendment-03 change in the SECI tender? Cite the pages."
2. "What happens to power above 60% in the Solar Hours?" Claude cites cl. 8.3 with the link to page 4.
3. "Set the bid to 200 MW, fill the rest with benchmarks and size the plant." This takes about
   a minute and comes back at about ₹7.46/kWh: 443 MWac solar, 239 MW wind, 431 MW / 1,724 MWh
   battery.
4. "What tariff gives a 14% equity IRR? What if we quote ₹7.20?" Claude warns that ₹7.20 is ₹0.26
   below the target and earns 12.7% on equity.
5. "What if battery capex falls to ₹0.85 crore/MWh on a 300 MW plant with 785 MWac solar, 440 MW
   wind and 635 MW × 4 h of storage?" This uses `check_bid` and answers instantly.
6. "How did the winners get to ₹5.25?"

## How it is built

* **Transport.** Streamable HTTP, without event streams.
  * Each POST carries one JSON-RPC message, or a batch, and gets a plain JSON reply. Notifications
    get 202.
  * `initialize` gives an `Mcp-Session-Id`, which names the bid on the server.
  * An unknown session id, after a restart, starts a fresh bid rather than failing.
  * Supported protocol versions: 2025-06-18, 2025-03-26 and 2024-11-05.
* **Tools.** Most are the SECI voice agent's (`createToolRunner` in `web/src/seci/agent.js`), run
  against the bid kept on the server. `list_conditions`, `amendment_changes`, `check_bid`,
  `winning_bid` and `sizing_status` are the server's own.
* **Sizing.** `run_optimizer` builds the same request the tab sends (`lpPayload`) and posts it to the
  engine (`ENGINE_URL/api/rtc/lp`). The first sizing starts from the typical design.
* **Links.** Each cited quote gets a `link` to its PDF page, on the address the request came in on
  (or `PUBLIC_URL` if set). On the shared VM the chooser may show first; pick Demo 2 and the PDF
  opens.
* **Security.** The token in the path is the only key: there is no sign-in and no per-user access.
  Anyone with the URL can read the tender, run sizings and change the bid of their own session.
  The tools never touch the saved scenarios or other users' bids. For anything beyond a demo, add
  OAuth or put it behind the firewall's allowlist.

## Tested here

* `node tools/check_mcp.mjs` drives the server with a stand-in engine. It checks:
  * the handshake, versions, batches and notifications;
  * every tool's schema;
  * the tender tools with page links;
  * What-if under Amendment-03 and before it;
  * the winning-bid bridge;
  * a whole bid: benchmarks, sizing, financials, a quote below target, forms;
  * separate sessions, and a fresh one after a restart.
* The official MCP Python SDK (`mcp` 2.3.0, `streamable_http_client`) ran against the running app
  with the real engine. It covered the handshake, 17 tools, a lookup, What-if, a 200 MW sizing
  (52 s, ₹7.458/kWh), the financials and a ₹7.20 quote check.
* Not tested here: a real claude.ai or Claude Desktop connector. The sandbox has no public HTTPS
  address. Add the connector on the VM before the demo and run step 1 of the script once.
