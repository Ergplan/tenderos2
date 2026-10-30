# TenderOS Demo 2: developer manual

For the team that takes over the code: what TenderOS is, how it is built, how a request travels
through it, where state lives, what each module does, the conventions, and the how-tos. Every
statement here was checked against the code on branch `claude/laughing-pascal-7akw12` (commit
`ca6d923`); file paths are given so you can check again. Installing it on another cloud is
`INSTALL-ANY-CLOUD.md`.

## 1. What TenderOS is

TenderOS is a workspace for bidding Indian renewable power tenders. A tender PDF goes in; the
app reads what the tender requires (every value with its page and quote), the bidder enters the
sources and costs, a linear programme (HiGHS) sizes the least-tariff plant that meets every
tender condition, and the app produces the bid's 25-year financial model, in the browser and as
an Excel workbook whose "Live model" sheet is the whole model as formulas. Demo 2 adds a
traceable model (click any number, see its formula), plant studios, What-if analysis, team mode,
evidence on every input, a Claude MCP connector and the enterprise two-zone deployment.

One web app with seven sidebar tabs (`web/lib/tabs.js` `TAB_CATALOG`, `web/src/main.jsx` `TABS`):

| Tab (id) | What it does | Engine route families it may call | Code |
| --- | --- | --- | --- |
| Tender to Bid (`tenderBid`) | Upload any tender (or a set: RfS + amendments + clarifications + PPA/PSA), scan screen, reading with page and quote, key dates, bid capacity, supply sources, HiGHS sizing with the tender conditions, 15-minute dispatch, financials, Excel model, pre-bid queries | `bid`, `rtc` | `web/src/bid/`, `docs/TENDER_TO_BID.md` |
| Round the Clock (`rtc`) | RTC / FDRE sizing and finance from your own inputs; in-browser optimiser (Web Worker) plus the engine's HiGHS LP; same workbook | `rtc` | `web/src/rtc/` |
| SECI RTC tender (`seciRtc`) | SECI FDRE-RTC-V (issued as RTC-TM-V): a curated tender pack with the RfS, 3 amendments, clarifications and PSA; ten steps by team from documents to bid forms, letters, the bid pack, the winning-bid bridge and a GPT-Live voice bid agent | `rtc`, `bid` | `web/src/seci/`, `docs/SECI_RTC.md` |
| BESS Tender (`bessTender`) | Standalone battery tenders: read the tender, size the battery, capacity charge for the target IRR | `bess` | `web/src/bess/`, `engine/bess/` |
| CfD Bid (`cfd`) | SECI CfD-I strike price, computed in the browser | none | `web/src/cfd/`, `docs/CFD.md` |
| What-if analysis (`whatIf`) | Your sizes, costs, financing and tariff in; IRRs, DSCR, LCOE, the tariff the target IRR needs, tender checks, tariff levers; rule-based hourly dispatch, no optimisation | none | `web/src/whatif/` |
| Recent tenders (`recentTenders`) | SECI auction results as reported; CERC tariff-adoption orders uploaded and read by the engine | none (`/api/bid/cerc-order` goes through the `bid` family from this tab's upload) | `web/src/market/`, `engine/market/` |

Across the tabs:

* **Team mode** (`docs/TEAM.md`): a send icon on every input box opens a thread with `@handle`
  mentions and a value to "Fill in"; assignments on a saved SECI bid; Team setup; Messages inbox.
* **Evidence**: a paperclip on every input box holds files, links and notes, a super admin's
  sign-off, and a CSV register.
* **MCP connector** (`docs/MCP.md`): a remote MCP server at `/api/mcp/<MCP_TOKEN>` that lets Claude
  search the tender, size a bid, read financials, run What-if and explain the winning bid.
* **Enterprise zones** (`docs/enterprise/ARCHITECTURE.md`): `TENDEROS_ZONE=intake` (tender reading
  with cloud models, a DMZ), `core` (the bid workspace with no cloud client) or `all` (one
  installation, the demos). `deploy/enterprise/` holds the signed offline bundle, its installer
  and the `tenderos-patch` tool.
* **Users and tab access**: an administrator creates users and grants tabs; demo mode
  (`DEMO_MODE=1`) signs every visitor in as one shared user with every tab.
* **Saved scenarios**: every tab except Tender to Bid, CfD, What-if and Recent tenders saves to a
  library with versions (`/scenarios`); Tender to Bid saves its readings (`tender_reads`).

## 2. Stack and versions

Taken from `web/package.json`, `engine/requirements.txt`, `engine/requirements-dev.txt`,
`web/Dockerfile`, `deploy/engine.Dockerfile` and `docker-compose.yml`. (The brief for this manual
said "Next.js 14"; the code is on Next.js 16.)

| Part | Technology | Version pinned | Where |
| --- | --- | --- | --- |
| Web app | Next.js (App Router, `output: "standalone"`), React | `next ^16.3.6` (16.3.6 installed), `react`/`react-dom ^19.3.0` | `web/package.json`, `web/next.config.mjs` |
| Web runtime | Node | `node:22-alpine` | `web/Dockerfile` |
| Web libraries | `exceljs ^4.4.0` (workbooks), `jose ^6.2.12` (session JWT), `jszip ^3.10.2`, `lucide-react ^0.468.0` (icons), `nodemailer ^6.10.1` (team mail), `pg ^8.23.0` (Postgres), `echarts ^6.1.0` (charts), `energy-flow-chart` (vendored in `web/vendor/`) | | `web/package.json` |
| Engine | Python, FastAPI, uvicorn, Pydantic 2 | `python:3.12-slim`; `fastapi>=0.115,<1`, `uvicorn>=0.30,<1`, `pydantic>=2.8,<3` | `deploy/engine.Dockerfile`, `engine/requirements.txt` |
| Sizing | HiGHS through `highspy>=1.10`, `numpy>=1.26`, `scipy>=1.11` | | `engine/sizing/` |
| Documents | `pymupdf>=1.24` (PDF text, page renders, HTML to PDF), `python-docx>=1.1`, `XlsxWriter>=3.2,<4` (25-year dispatch workbook), `PyYAML`, `rapidfuzz>=3.10,<4` (quote resolver) | | `engine/extraction/`, `engine/documents/` |
| Tender reading | `anthropic>=1.0,<2` (model `claude-fable-5-1`), `httpx` (docling-serve, LlamaParse clients), `haystack-ai>=2.10,<3` (BM25 search over a tender set) | | `engine/extraction/llm.py`, `engine/extraction/tenderset/` |
| Table reader | docling-serve (IBM Docling), CPU image | `quay.io/docling-project/docling-serve-cpu:v1.35.0` | `docker-compose.yml` |
| Database | PostgreSQL | `postgres:16-alpine` | `docker-compose.yml` |
| TLS | Caddy | `caddy:2.8-alpine` | `deploy/docker-compose.vm.yml`, `deploy/enterprise/docker-compose.enterprise.yml` |
| Tests | `pytest>=8.0`, `playwright>=1.47` (browser e2e), `ruff>=0.6`, `openpyxl>=3.1,<4`; Node checks in `tools/check_*.mjs`; LibreOffice (`soffice`) for formula recalculation | | `engine/requirements-dev.txt`, `pyproject.toml`, `Makefile` |
| Voice agent | OpenAI GPT-Live (`gpt-live-1`, backend `gpt-6-luna`, voice `marin` by default) through the web server | | `web/app/api/seci/live/route.js`, `web/src/seci/agent.js` |

Local development needs Python 3.12, Node 22 and a Postgres (`Makefile` header, `README.md`).

## 3. Repository map

### Top level

| Path | What it is |
| --- | --- |
| `Makefile` | `install`, `build`, `test`, `test-slow`, `check-web`, `e2e`, `demo`, `lint`, `dev`, `stop`, `up`, `down` (section 8) |
| `docker-compose.yml` | The base stack: `db`, `engine`, `docling`, `web`; only `web` is published (`WEB_PORT`, default 3000) |
| `.env.example` | Every environment variable with a comment (section 9); copy to `.env`, never commit |
| `pyproject.toml` | pytest (`slow` marker, `testpaths = tests`) and ruff (line length 140; `E4, E7, E9, F, I`; `E702`, `E731` ignored for the compact sizing code) |
| `README.md` | Overview, compose and local run, tests, status |
| `web/` | The Next.js app (section 3.2) |
| `engine/` | The FastAPI engine (section 3.3) |
| `deploy/` | VM deployment: `bootstrap.sh`, `update.sh`, `backup.sh`, `gcp-create-vm.sh`, `Caddyfile`, `docker-compose.vm.yml`, `engine.Dockerfile`; `demo2/` and `shared-vm/` (the chooser router beside Demo 1 and the old app); `enterprise/` (signed bundle, installer, patch tool, overlay, Caddyfile for a provided certificate) |
| `tests/` | `engine/` (unit and API tests, fixtures), `e2e/` (Playwright browser tests and the NHPC end-to-end reading), `deploy/` (the patch tool's verify path), `test_seci_pack.py` (every quote of the SECI pack printed on its page) |
| `tools/` | `check_*.mjs` model checks in Node (section 7), `dev.sh` (local processes), `demo_run.py` / `demo_report.py` (the clicked-through demo and its PDF report), builders (`build_seci_letters.py`, `build_enterprise_features.py`, `build_features_split.py`, `build_profile_library.mjs`, `build_solar_seed.mjs`) |
| `docs/` | One document per feature area (`ARCHITECTURE.md`, `TENDER_TO_BID.md`, `SECI_RTC.md`, `DEMO2.md`, `TEAM.md`, `MCP.md`, `EXTRACTION.md`, `CFD.md`, `E2E-NHPC.md`, `DEPLOY.md`), `enterprise/` (architecture, feature list, workbooks), `dev/` (this handover) |
| `samples/tenders/nhpc-fdre-ii/` | The NHPC FDRE-II RfS (264 pages) and its reviewed reading, used by `make test` and the e2e runs |
| `demo/arkaja-seci-rtc-tm-v/` | A recorded demo run: report PDF, bid pack, letters, models, screenshots (`demo/README.md`) |
| `.dockerignore` | Keeps `web`, `samples`, `tests`, `docs`, `tools` and `.env*` out of the engine's build context |

### `web/`

| Path | What it is |
| --- | --- |
| `app/layout.js`, `app/page.js` | The root layout (inlines the theme pre-paint script) and the dashboard page: loads the user and an optional `?open=<scenario>&v=<version>`, mounts `components/DashboardClient.jsx`, which loads `src/main.jsx` client-side only |
| `app/login`, `app/setup`, `app/account`, `app/admin/users`, `app/admin/activity`, `app/scenarios[/[id]|/compare]` | Server-rendered pages: sign-in, first-run setup, the account page, user administration, the activity dashboard, the scenario library, one scenario, compare |
| `app/api/` | The API routes (next table) |
| `proxy.js` | Next 16's request proxy (the former middleware): sends signed-out visitors of pages to `/login`, or to `/api/auth/demo` in demo mode; `/api/*` is excluded so uploads are not buffered |
| `instrumentation.js` | On server start: run migrations, seed resource profiles and built-in tender readings, purge old activity (retries 30 times, 2 s apart) |
| `lib/` | Server-only modules (next table) |
| `src/` | The browser app (table after) |
| `components/` | Server-page components: `AuthForm`, `AccountForm`, `UserAdmin`, `TabAccess`, `ActivityAdmin`, `ActivityPing`, `ScenarioLibrary`, `ScenarioDetail`, `ScenarioCompare`, `PageShell`, `SignOutButton`, `DashboardClient` |
| `db/migrations/*.sql` | 001 users, scenarios, scenario_versions · 002 tab_access, app_settings · 003 resource_profiles · 004 user_sessions, activity_log · 005 scenarios module `bess` · 006 tender_reads · 007 scenarios module `seci` · 008 team_members, team_files, assignments, assignment_events · 009 team_outbox · 010 market_orders · 011 team_messages, team_notices, member title and tabs · 012 evidence, field_signoff |
| `db/seed/` | Built-in resource profiles (Beed PVsyst solar, Maharashtra WRPC wind) and a built-in tender reading (WBSEDCL RE-RTC) loaded on start |
| `public/tenders/seci-rtc-tm-v/` | The six SECI documents (RfS, Amendments 01–03, Clarifications-01, Standard PSA) served behind the login |
| `public/market/iex_hourly_prices.json` | One year of IEX hourly prices for the costliest-hours Peak plan and market sales |
| `vendor/energy-flow-chart` | The Sankey chart, vendored and transpiled |
| `Dockerfile`, `next.config.mjs`, `jsconfig.json` (`@/*` alias) | Build |

`web/lib/` (server-only unless noted):

| File | What it does |
| --- | --- |
| `auth.js` | scrypt password hashing, `currentUser()` (session re-checked against `users.session_epoch`), `currentUserWithAccess()` (adds `allowedTabs`, admin contacts, demo flag), `requireUser({admin})`, `HttpError`, `handler()` (wraps a route: JSON errors, 401/403) |
| `session.js` | HS256 JWT in cookie `tenderos_session`, 14 days, `SESSION_SECRET` of 32+ characters, `COOKIE_SECURE`; importable from `proxy.js` (no database) |
| `tabs.js` | `TAB_CATALOG`, `resolveTabs()`, `mayCallEngine(tabIds, family)`; shared with the browser |
| `zone.js` | `ZONE`, `zoneAllowsEngine(path)`, `CLOUD_AGENTS`, `zoneInfo()` |
| `db.js` | `pg` pool, `query`, `tx`, `migrate()` (section 8.3) |
| `demo.js` | `DEMO_MODE`, the shared demo user's email, `APP_SWITCH_URL` |
| `settings.js` | `app_settings` key/value (`default_tabs`) |
| `scenarios.js` | Scenario library: list, get (a version), create, add version, restore, meta, delete |
| `activity.js` | Sign-in sessions and the activity log (`logEvent`, usage summary; 400-day retention) |
| `tenders.js`, `profiles.js` | Saved tender readings; the resource-profile library and its seeding |
| `modelWorkbook.js` | The bid workbook (cover, Live model, conditions, inputs, plant and capex, yearly tables); `buildModelWorkbook`, `workbookResponse` |
| `liveModel.js` | The Live model sheet: the 25-year model as Excel formulas; `addLiveModel`, `liveModelInput` (sanitises the request) |
| `dispatchSheets.js` | "Dispatch Y1" / "Dispatch Y25" sheets, 8,760 rows of formulas each |
| `docx.js` | A minimal Word writer (paragraphs, tables) for queries, the bid pack, the letters, the justification |
| `xlsxToCsv.js` | Excel profile uploads to CSV for the browser parser |
| `team.js`, `teamMessages.js`, `mail.js`, `files.js` | Team sharing: members, assignments and their rules; pings and the inbox; SMTP mail and the outbox; uploaded files under `FILES_DIR` |
| `evidence.js` | Evidence items, sign-offs, the register CSV |
| `market.js` | CERC orders (`market_orders`) and their PDFs |
| `mcp.js` | The MCP server: tools, sessions, JSON-RPC handling, sizing on the engine (not server-only: imports browser model modules) |
| `summaryFields.js`, `json.js` | Reading summaries for the library; `plain()` for server-to-client props |

`web/app/api/` routes (from the tree; the engine pass-through is last):

| Route | Methods | What it does |
| --- | --- | --- |
| `auth/setup` | GET, POST | `needsSetup`; create the first administrator (only when `users` is empty; off in demo mode) |
| `auth/login`, `auth/logout`, `auth/me` | POST, POST, GET | Sign in (10 failures per email+IP per 15 minutes → 429), sign out, who am I |
| `auth/demo` | GET | Demo mode only: sign in as the shared demo user and redirect |
| `users`, `users/[id]` | GET, POST; PATCH, DELETE | Administration of users (admins); own name and password |
| `settings/tabs` | GET, PUT | Default tabs for users without their own list |
| `activity` | POST, GET | Browser heartbeat and events; admin usage summary (`format=csv`) |
| `scenarios`, `scenarios/[id]`, `scenarios/[id]/restore`, `scenarios/export` | GET, POST; GET, PUT (new version), PATCH (meta), DELETE; POST; GET | The scenario library |
| `tenders`, `tenders/[id]` | GET, POST; GET | Saved tender readings |
| `profiles`, `profiles/[id]`, `profiles/convert` | GET, POST; GET, DELETE; POST | Resource-profile library; xlsx → CSV |
| `bid/model`, `rtc/model`, `cfd/model` | POST | The Excel workbooks (Tender to Bid / SECI, Round the clock, CfD), built with exceljs |
| `bid/queries` | POST | Pre-bid queries as a Word file |
| `seci/forms`, `seci/letters` | POST | The SECI bid pack and the letters as Word files |
| `seci/live` | GET, POST | Whether the voice agent is set up; create the GPT-Live session from the browser's WebRTC offer (`OPENAI_API_KEY` stays on the server) |
| `plant/justification` | POST | The 25-year CUF justification as a Word file |
| `team`, `team/members`, `team/members/[id]`, `team/act-as`, `team/assignments`, `team/assignments/[id]`, `team/files/[id]`, `team/outbox`, `team/messages`, `team/messages/read` | see `docs/TEAM.md` | Team state, members, demo "View as", assignments and actions, file download, outbox, pings and the inbox |
| `evidence`, `evidence/[id]`, `evidence/signoff`, `evidence/register` | GET, POST; DELETE; POST; GET | Evidence on boxes, sign-off, the CSV register |
| `market`, `market/[id]`, `market/files/[id]` | GET, POST; PATCH, DELETE; GET | CERC orders and their PDFs |
| `health` | GET | `{web, database, engine, zone, version}`; 503 when the database is not ok |
| `mcp/[token]` | POST, GET (405), DELETE | The MCP server (section 4.6) |
| `[...path]` | GET, POST, PUT, PATCH, DELETE | Everything else under `/api/` is forwarded to the engine (section 4.2) |

`web/src/` (the browser app):

| Directory | What it does |
| --- | --- |
| `main.jsx` | The workspace shell: sidebar, tab routing, tab access, zone badge, team layers (`FieldPings`, `EvidenceLayer`), inbox, Team setup |
| `bid/` | Tender to Bid: `BidTab.jsx` (steps `tender, dates, capacity, sources, size, finance`), `model.js` (state, inputs, `lpPayload`, `runSizing`, benchmarks), `tenderMap.js` (reading → terms), `readTender.js` (jobs and polling), `useSizing.js` (shared sizing hook), `quote.js` (returns at a quoted tariff), `exportModel.js` + `liveModelRequest.js` (workbook request), `SiteSchematic.jsx`, `Dispatch15.jsx`, `FinanceInputsStep.jsx`, `TenderSet.jsx`, `ScanStage.jsx`, `scanAgents.js`, `preBidQueries.js`, `hourSankey.js` |
| `rtc/` | Round the clock: `engine.js` (the pure financial and dispatch engine, section 6.2), `RtcTab.jsx`, `optimizer.worker.js`, `exportModel.js`, `FinanceView.jsx`, `ConstructionView.jsx`, `LossChain.jsx`, `MeterView.jsx`, `ProfileLibrary.jsx`, `charts.jsx`, `Theatre.jsx` (the solver theatre) |
| `seci/` | SECI RTC tender: `SeciTab.jsx` (`SECI_STEPS`), `terms.js` (`seciTerms`), `seci-rtc-tm-v.json` (the pack), `state.js`, `formats.js`, `forms.js`, `letters/` (one template per format, `export.js`), `agent.js` + `voice.js` + `LiveAgent.jsx` (the voice agent), `peakPrices.js`, `winningBid.js` + `WinningBid.jsx`, `charts.js`, the step components |
| `bess/`, `cfd/` | The BESS tender and CfD bid models and tabs |
| `whatif/` | `model.js` (`runWhatIf`, `whatIfFromBid`), `levers.js`, `WhatIfTab.jsx`, `LeverPanel.jsx` |
| `model/` | The traceable model: `trace.js`, `ModelExplorer.jsx`, `generation.js`, `explainGeneration.js` |
| `plant/` | Solar and wind studios (`solar.js`, `wind.js`), `ProfileView.jsx`, `cufFile.js`, `justification.js` |
| `dsm/` | Deviation settlement (`dsm.js`, `DsmPanel.jsx`) |
| `market/` | Recent tenders (`RecentTendersTab.jsx`, `seed.js`) |
| `team/` | Team mode and assignments: `useTeamMode.js`, `FieldPings.jsx`, `fields.js`, `mentions.js`, `Inbox.jsx`, `TeamSetup.jsx`, `useTeam.js`, `AssignButton.jsx`, `TeamPanel.jsx`, `apply.js` |
| `evidence/` | `EvidenceLayer.jsx`, `useEvidence.js`, `register.js` |
| `scenarios/` | `client.js` (`scenarioApi`, `authApi`), `SaveDialog.jsx` |
| `theme.js`, `themeScript.js`, `themeColors.js`, `chartTheme.js`, `dataColors.js`, `styles.css`, `*.css` | Day and night mode, tokens, chart colours |
| `activity.js`, `handoff.js`, `Brand.jsx`, `ThemeToggle.jsx` | Usage heartbeat; the file handed from Tender to Bid to the BESS tab; the logo; the mode switch |

### `engine/`

| Path | What it does |
| --- | --- |
| `app.py` | The FastAPI app and every route (section 4.3) |
| `extraction/` | The tender reader ported from `Ergplan/tender_engine` (commit `5c29b4e`): `extract.py` (`read_tender`, `detect_tender_type`, modes), `llm.py` (the only module that calls a model), `rules_reader.py` (the rule-based reader), `schema.py` (compiles a tender type from the YAML packs), `resolver.py` (locates quotes on pages), `rules.py`, `values.py`, `pages.py` (PyMuPDF text), `section_map.py`, `preview.py` (scan-screen lines), `jobs.py` (file-backed jobs), `lexicon.py`; `packs/` (core and power YAMLs with versioned prompts); `tenderset/` (sets of documents: `read_set.py`, `documents.py`, `changes.py`, `clarifications.py`, `consolidate.py`, `formats.py`, `process.py`, `layout.py`, `docling.py`, `llamaparse.py`, `search.py`) |
| `sizing/` | `rtc_lp.py` (`solve`: the least-tariff LP, Dinkelbach iterations on HiGHS, seeds), `dispatch15.py` (15-minute dispatch of every PPA year, one LP per year; `start`/`get`/`zip_file`/`xlsx_file`), `dispatch_workbook.py` (the 25-year dispatch workbook with XlsxWriter) |
| `bess/requirements.py` | The BESS tab's adapter over the extraction result |
| `market/cerc_order.py` | A CERC tariff-adoption order read into facts with quotes (rules, no model) |
| `documents/pdf.py` | HTML parts laid out as one A4 PDF (PyMuPDF), the SECI letters |

### `tools/check_*.mjs` and `tests/`

The Node checks import the browser modules directly (they are plain JavaScript without DOM
access) and assert on their numbers; `make check-web` runs every one except `check_nhpc_terms`
(which needs a reading on disk). Each file opens with a comment saying what it checks:
`check_bess_engine`, `check_bid_model` (terms, HiGHS request, seeds, pooling stations),
`check_cfd_model`, `check_cuf_file`, `check_dispatch_sheets` (LibreOffice), `check_dsm`,
`check_evidence`, `check_generation`, `check_live_model` (LibreOffice), `check_market`,
`check_mcp` (the MCP server with a stand-in engine), `check_nhpc_terms`, `check_peak_prices`,
`check_plant`, `check_rtc_engine`, `check_scan_agents`, `check_seci`, `check_seci_agent`,
`check_seci_letters`, `check_team`, `check_team_messages`, `check_theme`, `check_trace`,
`check_whatif`.

`tests/engine/`: `test_rtc_lp.py`, `test_bid_lp.py`, `test_split_sites.py`, `test_block_rules.py`,
`test_dispatch15.py`, `test_extraction.py` (model mode against a fake SDK, no network),
`test_tenderset.py` (Docling fixtures in `fixtures/docling/`), `test_preview.py`,
`test_cerc_order.py`, `test_cfd_terms.py`, `test_document_pdf.py`. `tests/e2e/`:
`test_nhpc_tender.py` (the reading end to end, in `make test`), and the browser tests
`test_tender_to_bid.py`, `test_round_the_clock.py`, `test_seci_tab.py`, `test_team.py`,
`test_team_mode.py`, `test_evidence.py`, `test_theme.py`, `test_demo2.py`, `test_mcp.py`,
`test_click_tour.py` (all `slow`, need a running stack). `tests/deploy/test_patch_tool.py`: the
patch tool's `verify` with a test keypair and tampered bundles. `tests/test_seci_pack.py`: the
SECI pack's quotes.

## 4. Request flow

```mermaid
flowchart LR
  B[Browser<br/>web/src] -->|cookie tenderos_session| P[web/proxy.js<br/>page gate]
  P --> R[Next.js API routes<br/>web/app/api]
  R -->|lib/auth.js handler, requireUser<br/>lib/tabs.js mayCallEngine<br/>lib/zone.js zoneAllowsEngine| F["web/app/api/[...path]/route.js<br/>node:http forward"]
  F -->|ENGINE_URL /api/...| E[engine/app.py FastAPI]
  E --> H[sizing/rtc_lp.py HiGHS<br/>NDJSON stream]
  E --> D[sizing/dispatch15.py<br/>job, poll, zip, xlsx]
  E --> X[extraction/ read_tender<br/>job, poll]
  R --> W[lib/modelWorkbook.js + liveModel.js<br/>+ dispatchSheets.js → .xlsx]
  R --> M["api/mcp/[token] → lib/mcp.js"]
  M -->|ENGINE_URL/api/rtc/lp| E
  R --> DB[(Postgres)]
```

### 4.1 Sign-in, session and tab access

1. `web/proxy.js` runs on every page request (not `/api/*`): with no valid `tenderos_session`
   cookie it redirects to `/login` (or `/api/auth/demo` when `DEMO_MODE=1`), keeping `next=`.
2. `POST /api/auth/login` verifies the scrypt hash (`web/lib/auth.js` `verifyPassword`), starts an
   activity session and sets the cookie: an HS256 JWT signed with `SESSION_SECRET`, subject the
   user id, `epoch` the user's `session_epoch` (`web/lib/session.js`). A password reset bumps the
   epoch, so old cookies die (`currentUser()` compares them).
3. Every API route is wrapped in `handler()` and calls `requireUser()` /
   `currentUserWithAccess()`. `allowedTabs` comes from `resolveTabs(user, defaultTabs)`
   (`web/lib/tabs.js`): admins get every tab; others their own `users.tab_access`, else the
   deployment default (`app_settings.default_tabs`), else all.
4. The dashboard (`app/page.js`) passes the user and `allowedTabs` to `src/main.jsx`, which locks
   the sidebar entries the user may not open.

### 4.2 The engine pass-through

`web/app/api/[...path]/route.js` forwards any `/api/<path>` no Next route handles:

* 401 without a user; 403 unless `mayCallEngine(user.allowedTabs, path[0])` (the first segment is
  the route family: `bid`, `rtc`, `bess`; `health` for any signed-in user);
* 403 in the `core` zone for the tender-reading paths (`bid/tender/read`, `bid/tender/read-set`,
  `bid/cerc-order`, `bess/parse`; `web/lib/zone.js` `INTAKE_ENGINE`);
* the body is buffered and sent with `node:http` (not `fetch`) so a long sizing is not cut off;
  timeout `ENGINE_TIMEOUT_MS` (default 30 minutes); the response is streamed back with
  `content-type`, `content-disposition`, `content-length`, `cache-control`;
* non-GET calls are logged to `activity_log` as kind `engine` with path, status and wall time.

The engine has no published port (compose publishes `web` only) and holds the only copy of
`ANTHROPIC_API_KEY`.

### 4.3 The engine (`engine/app.py`)

| Route | What it does |
| --- | --- |
| `GET /api/health` | `{status, tender_reading: {llm_available, provider, model, default_mode, require_llm, types, extraction, set: {docling, llamaparse, search, max_files}}}` |
| `GET /api/{bid\|rtc}/tender/status`, `…/catalog?tender_type=` | Reader status; the sections and fields of a type |
| `POST …/tender/read` | Body `{file: {name, content_base64}, tender_type, mode}` (auto/llm/rules). 202 `{job_id, status, mode}`; `?sync=1` returns the result inline. 60 MB limit |
| `GET …/tender/read/{job_id}` | The job: `status`, `progress`, `preview` (the scan screen's lines, about a second in), then `result` |
| `POST …/tender/read-set` | Up to 20 files, 120 MB: the RfS with amendments applied, changes, clarifications, formats, bid process, search passages |
| `GET …/tender/search?job_id=&q=&k=&role=&doc=` | BM25 over a finished set read |
| `POST /api/bess/parse` | The BESS tab's adapter |
| `POST /api/bid/cerc-order` | A CERC order's facts with quotes |
| `POST /api/rtc/lp` | The HiGHS sizing. Streams NDJSON lines `{type: "log"|"progress"|"result"|"error", …}` (`StreamingResponse`, `x-accel-buffering: no`). At most two solves at once (`_LP_SLOTS`, a semaphore; a third waits and says so in its log) |
| `POST /api/bid/dispatch15`, `GET …/{job_id}`, `…/zip`, `…/xlsx` | The 15-minute dispatch job: start (`{payload, sizes, tariff, years?}` → `{job_id}`), poll, download the CSV ZIP or the workbook; runs are kept 24 hours |
| `POST /api/bid/document/pdf` | `{parts, css, title}` → one A4 PDF |

It runs under uvicorn with 2 workers (`deploy/engine.Dockerfile`), so jobs are file-backed:
extraction jobs in `EXTRACTION_JOBS_DIR` (`/data/extraction_jobs`, a volume), dispatch jobs in
`DISPATCH15_JOBS_DIR` (default `<tmp>/tenderos_dispatch15`), any worker can answer a poll. The
engine keeps no other state.

### 4.4 Jobs and polling in the browser

* **Tender reading**: `web/src/bid/readTender.js` `readTenderFile` posts the file as base64,
  then polls `GET /api/bid/tender/read/{id}` every 600 ms (`readTenderSet`: 800 ms), handing every
  poll to the scan screen (`preview`) until `result` arrives. The reading is then saved for the
  team with `POST /api/tenders`.
* **Sizing**: `web/src/bid/useSizing.js` builds the request with `lpPayload(state, terms,
  resourceProfiles(state), prices)` and calls `runSizing` (`web/src/bid/model.js`), which reads the
  NDJSON stream with `res.body.getReader()` and dispatches `log`, `progress`, `result`, `error`
  events. The result's hourly dispatch is kept in memory (`keepDispatch` / `dispatchFor`, a
  WeakMap keyed by the result) and never saved. A sizing survives switching tabs through the
  caller's `session` object.
* **15-minute dispatch**: `startDispatch15` posts `dispatch15Request(payload, lp)` and polls
  `GET /api/bid/dispatch15/{id}` until done; the ZIP and workbook links are the engine's.
* **Financial model**: `runFinancialModel` (`web/src/rtc/engine.js`) runs in the browser on the
  sizing's energy by year (`opsFromLp` in `bid/model.js`).

### 4.5 The Excel workbook route

`POST /api/bid/model` (Tender to Bid and SECI) and `POST /api/rtc/model` (Round the clock) are
Next routes, not engine routes. The browser computes the model and sends it
(`web/src/bid/exportModel.js` `modelExport` with `liveModelRequest.js`; `web/src/rtc/exportModel.js`
`rtcModelExport`). The route calls `buildModelWorkbook` (`web/lib/modelWorkbook.js`), which lays
out the cover, calls `addLiveModel` (`web/lib/liveModel.js`) for the Live model sheet (every number
a formula on the blue inputs and the green optimiser energy, with a cached value for viewers that
do not recalculate), `addDispatchSheet` (`web/lib/dispatchSheets.js`) for the modelled years when
the sizing returned its hours, the Construction sheet, and the app's own numbers for reference;
`workbookResponse` streams the `.xlsx`. `POST /api/cfd/model` does the same for the CfD tab.

### 4.6 The MCP route

`POST /api/mcp/<token>` (`web/app/api/mcp/[token]/route.js`) compares the token with `MCP_TOKEN`
in constant time (404 unless the token is set and at least 16 characters), parses one JSON-RPC
message or a batch and hands it to `handlePost` (`web/lib/mcp.js`). `initialize` creates a server
session (an in-memory `Map`, 6-hour TTL, keyed by the `Mcp-Session-Id` header) holding a bid in the
SECI tab's default state; `tools/call` goes through `callTool`, which runs most tools through the
voice agent's `createToolRunner` (`web/src/seci/agent.js`) against that state, and the server's own
`list_conditions`, `amendment_changes`, `check_bid`, `winning_bid`, `sizing_status`.
`run_optimizer` builds the same `lpPayload` and posts it straight to `ENGINE_URL/api/rtc/lp`
(`sizeOnEngine`), waiting up to `MCP_SIZING_WAIT_MS` (180 s). GET answers 405 (no event stream);
DELETE drops the session. Links to PDF pages use `PUBLIC_URL` or the request's host. The route
does not check the zone; in a core installation leave `MCP_TOKEN` empty.

### 4.7 The voice agent

`POST /api/seci/live` creates a GPT-Live session with OpenAI from the browser's WebRTC offer, using
`OPENAI_API_KEY` on the server; audio and events then flow between the browser and OpenAI, and the
backend model's function calls are run in the browser by `createToolRunner` against the tab's
state (`docs/ARCHITECTURE.md`, "The bid agent"). `GET /api/seci/live` says whether it is set up
(`available` is false without a key or in the core zone).

## 5. The state model

| State | Where it lives | Notes |
| --- | --- | --- |
| A tab's inputs, step and results | React state in the tab component, saved to `localStorage` on change | Keys: `fdre.bid.v4` (Tender to Bid), `tenderos.seci.v1` (SECI), `fdre.rtc.v1` (Round the clock), `fdre.bess.v1` (BESS), `fdre.cfd.v1` (CfD), `tenderos-whatif` (What-if). The What-if step inside the SECI flow (`embedded`) does not write the key. `BidTab` and `SeciTab` also keep a module-level `sessionState`/`sessionView` so switching sidebar tabs does not reset the step |
| Hour-by-hour dispatch of a sizing | Memory only (`keepDispatch`, `web/src/bid/model.js`) | A bid opened from a save shows yearly values until sized again; `sizingSeed` (the last design) is kept in state to start the next solve |
| Per-browser conveniences | `localStorage` | `tenderos-theme` (day/night, `web/src/themeScript.js`), `tenderos.pingIcons` (send icons always or on hover, `web/src/team/FieldPings.jsx`) |
| Saved scenarios and versions | `scenarios` (module `rtc`, `fdre`, `bess`, `seci`; `created_by`, `archived`) and `scenario_versions` (inputs and results as jsonb, one row per version) | Save: `POST /api/scenarios` (version 1) or `PUT /api/scenarios/[id]` (new version); open: `/?open=<id>&v=<n>` (`app/page.js` → `MODULE_TAB` in `main.jsx` picks the tab); restore and compare in `/scenarios`. The SECI tab keeps `linked = {id, name, version}` and accepting a team answer writes a new version with a note |
| Tender readings | `tender_reads` | `POST /api/tenders` after each read; the start screen lists them; a built-in WBSEDCL reading is seeded |
| Resource profiles | `resource_profiles` | Uploaded solar/wind profiles and the two seeded ones |
| Users, access, settings | `users` (`role`, `tab_access`, `session_epoch`), `app_settings` | |
| Activity | `user_sessions`, `activity_log` | Heartbeat and events from `web/src/activity.js`; engine calls from the pass-through; purged after 400 days |
| Team | `team_members` (team, super admin, title, tabs, email, optional user link), `assignments`, `assignment_events`, `team_files` (metadata; bytes under `FILES_DIR`), `team_outbox`, `team_messages`, `team_notices` | Who is acting: the member linked to the signed-in user, or in demo mode the seat in cookie `tenderos_member` (`POST /api/team/act-as`) |
| Evidence | `evidence` (one row per item, `file_id` into `team_files`), `field_signoff` (one per `tab` + `field_key`, with `value_at`) | A box's key is its `data-testid`, else its section heading and label (`web/src/team/fields.js`); renaming a label starts a new key |
| CERC orders | `market_orders` and the PDF under `FILES_DIR` | |
| MCP bids | Memory in the web process (`SESSIONS` in `web/lib/mcp.js`), 6 hours | Lost on restart; a stale id starts a fresh bid |
| Engine jobs | Files (section 4.3) | 24 hours |

Team hand-offs between tabs are in memory only: `web/src/handoff.js` carries a file from Tender
to Bid to the BESS tab; "Open field" from Messages switches the tab, opens the step and scrolls
to the box (`focus` in `main.jsx`).

## 6. Module guide

Each entry names the entry points a developer needs. Module headers carry the long explanation.

### 6.1 Sizing request: `web/src/bid/model.js` `lpPayload`

`lpPayload(state, terms, {solarCf, windCf}, prices)` builds the request `rtc_lp.solve` takes: the
sources switched on with their costs, limits and fixed sizes; the hourly profiles scaled to the
CUF entered (`scaleToCuf`); the losses to the billing meter (`lossFactorsOf`, `siteFactors` for
separate sites with their own pooling station and line); the tender's supply rules from `terms`
(annual, monthly, block floors, peak hours as a mask from `peakMask`/`anyMask`, shortfall penalty);
market sale series (`marketSeries`); financing; and a `seed` (`seedFor`, the last sizing scaled to
the bid size, or the pack's typical design). `missingInputs` refuses a sizing until each source
has all its inputs; `fillBenchmarks` fills what is empty from `BENCHMARKS`, marked as benchmarks.
`opsFromLp` turns the result into the year-by-year energy the financial model reads. The same
payload is used by the SECI tab (terms from `seciTerms`), the MCP server and the 15-minute
dispatch (`dispatch15Request`). Check: `tools/check_bid_model.mjs`.

### 6.2 Finance: `web/src/rtc/engine.js`

A pure ES module (no DOM) shared by the browser, the optimiser worker and Node.
`DEFAULT_FINANCE`, `DEFAULT_COSTS`, `DEFAULT_BESS` hold every input with its default and a comment.
`runFinancialModel(ctx, sizes, {costs, fin, bess, dfrTarget, tariffLocked, ops, solveBy})` solves
the tariff for the target equity IRR by bisection (or prices a locked tariff) and returns the
25-year table; `cashflows(ops, sizes, costs, fin, bess, dfrTarget, tariff)` is one run of the
model: revenue and penalties, O&M, insurance, DSM, working capital (`receivableDays`,
`omStockMonths`, `sparesPctOm`, `wcInterestRate`), depreciation (WDV/SLM), tax with loss
carry-forward, debt by `debtTerms(fin, years)` and `principalOf(method, …)` (`REPAYMENT_METHODS`:
equal, annuity, sculpted, balloon, bullet, stepUp; moratorium; instalments a year; refinancing),
DSRA, DSCR, IRRs. `constructionSchedule(baseCostCr, costs, fin)` builds the month-by-month
drawdown and IDC (`DRAWDOWN_PROFILES`); `capexCr` the project cost. `simulate`, `optimize`,
`highsPayload` are the Round the clock tab's own dispatch and optimiser. `yearFactors` gives the
degradation per year. Checks: `tools/check_rtc_engine.mjs`, `check_live_model.mjs`.

### 6.3 The Excel twin: `web/lib/liveModel.js`, `modelWorkbook.js`, `dispatchSheets.js`

`addLiveModel(wb, m, …)` writes the Live model sheet line by line through a small builder
(`S.one` for an input cell, `S.series` for a 25-year line with a formula `f(y)` and a value `v(y)`),
so the sheet reproduces `cashflows` as formulas, including the generation build-up (MW × CUF ×
365 × 24), construction and IDC, every repayment method (a side tax chain keeps sculpting free of
circular references), working capital and DSRA. `liveModelInput(raw)` whitelists and sanitises
the request. `addDispatchSheet` writes a modelled year's 8,760 hours as formulas; the Live model's
energy lines sum them. `buildModelWorkbook` composes the file. Checks: `tools/check_live_model.mjs`
and `check_dispatch_sheets.mjs` recalculate every formula with LibreOffice and compare with the app.


Beside the Live model, `addScheduleSheets` (called at the end of `addLiveModel`) writes the
**Debt schedule**, **Depreciation and tax** and **Working capital** sheets, and
`addConstructionSheet` the **Construction** sheet: every cell there is a formula on the Live model
(`'Live model'!E120`) or on the sheet's own rows, so the Live model stays the single place the
model is computed. `SCHEDULE_SHEETS` lists them; `tools/check_live_model.mjs` recalculates them
with LibreOffice like the Live model.

### 6.4 The traceable model: `web/src/model/trace.js`

`traceModel(live)` runs the same Live model builder into an in-memory grid; `formulaRefs`,
`formulaParts`, `cellName`, `inputsOf(model, addr)` give a cell's formula with named references,
its precedents and dependents, and every input it rests on. `ModelExplorer.jsx` shows it;
`generation.js` (`genSource`, `monthlyCuf`, `quarterHours`) drills a generation number down to
months and 15-minute blocks; `explainGeneration.js` is the agent's tool. Check:
`tools/check_trace.mjs`, `check_generation.mjs`.

### 6.5 Deviation settlement: `web/src/dsm/dsm.js`

`DSM_DEFAULTS`, `TOLERANCE` and `X_TRAJECTORY` (CERC DSM Regulations 2024 structure, editable
inputs); `chargePerMwh`, `dsmUnitCharge` (a line in the contract rate, a × tariff + b), `dsmChargeCr`,
`dsmByYear`, `dsmNote`. `dsmFor(state)` in `bid/model.js` feeds it to `opsFromLp`. Check:
`tools/check_dsm.mjs`.

### 6.6 What-if and levers: `web/src/whatif/model.js`, `levers.js`

`defaultWhatIf()`, `runWhatIf(input)` (a rule-based hourly dispatch of every PPA year with the
battery held for the Peak Hours, then the 25-year model at the bid tariff; returns IRRs, DSCR,
LCOE, the tariff the target needs, floors met, penalty and the SECI checks `SECI_LIMITS`),
`whatIfFromBid(state, terms)` (the What-if step after a sizing). `LEVERS`, `leverEffects(state, …)`
(each lever a step up and down, ₹/kWh per step, the move to reach a wanted tariff). Check:
`tools/check_whatif.mjs`.

### 6.7 Site schematic: `web/src/bid/SiteSchematic.jsx`, `siteFactors`

An SVG single-line diagram of the plant: one 33 kV bus, pooling station and 220 kV line, or one
set per site. `siteFactors(state)` (`bid/model.js`) gives each site's transformer and line factors;
`lpPayload` scales the solar profile by the ratio of the two so each site carries its own losses.
`splitSitesOn(state)` says whether sites are separate. Check: `tools/check_bid_model.mjs`.

### 6.8 The SECI pack: `web/src/seci/terms.js`, `seci-rtc-tm-v.json`

The JSON pack holds the tender's identity, 6 documents, 63 conditions, 31 amendment changes, 9
clarifications, 20 formats with their blanks, 14 bid-process steps and 19 queries, each with
document, page and quote. `seciTerms(settings, prices)` turns it into the terms `lpPayload` takes
(`PEAK_PLANS`, `SHORTFALL_MODES`, `PROFILES` before/after Amendment-03, `solarMask`, the typical
seed); `keyDates`, `moneyAtStake`, `condition(id)`, `prov(id)` cite the pack. `formats.js` and
`forms.js` fill the formats and the bid pack; `letters/<format>.js` are the letter templates
(drafted by `tools/build_seci_letters.py`). Checks: `tests/test_seci_pack.py` (every quote on its
page), `tools/check_seci.mjs`, `check_seci_letters.mjs`, `check_seci_agent.mjs`.

### 6.9 Forms and letters

Word files are written by `web/lib/docx.js` from the browser's own rendering: the bid pack
(`POST /api/seci/forms`, `forms.js` `bidPackRequest`), the letters (`POST /api/seci/letters`,
`letters/export.js` `letterPayload`), the pre-bid queries (`POST /api/bid/queries`), the CUF
justification (`POST /api/plant/justification`). PDFs of the letters come from the engine
(`POST /api/bid/document/pdf`).

### 6.10 Team: `web/lib/team.js`, `teamMessages.js`

`team.js`: `TEAMS`, `KINDS` (field, cost, finance, document, condition), `actingMember(user)`,
`requireMember`, `listMembers`, `addMember`, `updateMember`, `listAssignments`,
`createAssignment`, `actOnAssignment(me, id, action, …)` (submit, accept, return, cancel, comment,
reassign; the rules are in the header), `teamState`. `teamMessages.js`: `postMessage`,
`listThread`, `threadCounts`, `inbox`, `markRead`. Browser: `useTeamMode.js` refreshes every 15 s;
`apply.js` says where each kind of data point lives in the SECI state and writes an accepted
answer. Checks: `tools/check_team.mjs`, `check_team_messages.mjs`; e2e `test_team.py`,
`test_team_mode.py`.

### 6.11 Evidence: `web/lib/evidence.js`

`addEvidence`, `listEvidence(me, tab)`, `deleteEvidence`, `signOff`, `registerCsvFor(tab)`;
`web/src/evidence/register.js` is shared with the browser. Check: `tools/check_evidence.mjs`;
e2e `test_evidence.py`.

### 6.12 MCP: `web/lib/mcp.js`

`TOOLS` (name, title, annotations, `inputSchema`, description), `callTool`, `handleMessage`,
`handlePost`, `sessionFor`, `sizeOnEngine`, `withLinks`, `checkBid`. Protocol versions 2025-06-18,
2025-03-26, 2024-11-05. Check: `tools/check_mcp.mjs`; e2e `tests/e2e/test_mcp.py`.

### 6.13 Zone: `web/lib/zone.js`

`ZONE`, `zoneAllowsEngine(path)`, `CLOUD_AGENTS`, `zoneInfo()`; used by the pass-through,
`/api/health`, `/api/seci/live` and the sidebar's zone badge.

### 6.14 Extraction: `engine/extraction`

`read_tender(name, payload, tender_type, mode)` (`extract.py`): pages → section map → one model
call per section (at most 40 pages, `EXTRACTION_CONCURRENCY` sections in parallel) or the rules
reader → every quote located on its page (`resolver.py`, threshold 85) → type coercion, range and
cross-field rules → a status per field (`validated`, `needs_review`, `not_found`, `rejected`,
`withdrawn`). `llm.py` is the only module that calls the model (`claude-fable-5-1`, versioned
prompt files, no fallback model). `schema.py` `compile_type` builds a tender type from
`packs/core/common.yaml` + `packs/power/pack.yaml` + `packs/power/<type>.yaml` + `packs/overlay.yaml`;
`TENDER_TYPES` is the list of type YAMLs. `tenderset/read_set.py` reads a set (Docling or PyMuPDF
tables, LlamaParse for scans, BM25 search). `docs/EXTRACTION.md` has the full account.

## 7. Conventions

* **Comment style.** Every module opens with a prose header: what it does, its units, which check
  covers it, and where it came from when ported (`tender_engine`, `FDRE`). Functions get one
  sentence before them, not JSDoc tags. Comments say *why* and cite the tender clause or the
  regulation where a number comes from. Read the headers before the code.
* **Naming.** JavaScript: camelCase, `UPPER_SNAKE` for catalogues (`FINANCE_FIELDS`,
  `REPAYMENT_METHODS`, `TOOLS`), one `default…()` factory per piece of state and a `merge…(saved)`
  to read an old save. Files: `*.jsx` only where there is JSX; model code is `*.js` so Node can
  import it. Python: `snake_case`, module docstrings, ruff with line length 140 and import sorting.
  Server-only modules say "Server-only." in their header and never reach the browser bundle.
* **Model code is pure.** `web/src/rtc/engine.js`, `bid/model.js`, `whatif/model.js`,
  `model/trace.js`, `dsm/dsm.js`, `plant/*.js`, `seci/*.js`, `team/apply.js`,
  `evidence/register.js` have no DOM access, so `tools/check_*.mjs` import and test them in Node.
  Keep new model code that way; put browser APIs in the `.jsx` next to it.
* **Where checks live.** Model checks are `tools/check_<area>.mjs`, run from the repository root
  with `node`, exit non-zero on a failure, and are listed in `make check-web`. The two that build
  workbooks (`check_live_model`, `check_dispatch_sheets`) have LibreOffice (`soffice`) recalculate
  every formula from no stored value and compare with the app; without `soffice` they report those
  steps as not run. Engine logic has pytest tests in `tests/engine/`; browser journeys have
  Playwright tests in `tests/e2e/`, marked `slow`.
* **Every Excel number is a formula.** On the Live model, Construction and Dispatch sheets the only
  constants are the inputs (blue on yellow) and the optimiser's own choices (green). Add a line as
  a formula with its cached value (`S.series(..., { f, v })`) and extend the LibreOffice check.
* **Backwards-compatible defaults.** Saved bids and `localStorage` from older versions must load:
  state factories spread saved values over defaults (`mergeBidState`, `defaultSeciState`, the
  `saved.step` fallback in `SeciTab`), `liveModelInput` whitelists keys and substitutes defaults,
  the LP ignores a seed that does not fit, migrations are additive. A new input gets a default
  that reproduces the old behaviour (for example `constructionMonths: 0` keeps IDC as a share).
* **`data-testid` for e2e.** Every control a test or team mode needs carries a stable
  `data-testid` (416 occurrences in `web/src` and `web/components`). The id is also the box's key
  for pings, evidence and sign-offs, so do not rename one lightly.
* **Evidence first.** A tender value is shown only with its page and quote; a term whose quote is
  not located is not applied until the reviewer ticks it (`tenderMap.js`). Nothing is estimated
  for the bidder: benchmarks are marked as benchmarks.
* **No secrets in git.** `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `*.pem`,
  `*.key`; the enterprise private key is a placeholder file. Keys are read from the environment at
  call time (`process.env` on the server, `os.environ` on the engine) and never sent to the browser
  (`seci/live`, `mcp`), never printed by the installers.
* **Documentation moves with the code.** Each feature has its `docs/*.md`; `README.md` and
  `docs/ARCHITECTURE.md` list the tabs and tests; the feature list is generated
  (`tools/build_enterprise_features.py`).

## 8. How-tos

### 8.1 Run locally

With Docker (the reference way):

```
cp .env.example .env          # set POSTGRES_PASSWORD and SESSION_SECRET (openssl rand -hex 32)
docker compose up -d --build  # or: make up
open http://localhost:3000     # first visit: create the administrator
docker compose logs -f web engine
```

As local processes (`Makefile`, `tools/dev.sh`):

```
make install                  # python3.12 venv with engine/requirements-dev.txt; cd web && npm ci
make build                    # next build (tools/dev.sh runs `next start`, so build first)
export DATABASE_URL=postgres://user:pass@127.0.0.1:5432/tenderos
export SESSION_SECRET=$(openssl rand -hex 32)
make dev                      # uvicorn engine.app:app on :8000, next start on :3000
                              # logs: /tmp/tenderos-engine.log, /tmp/tenderos-web.log
make stop
```

For hot reload of the web app, run `cd web && ENGINE_URL=http://127.0.0.1:8000 npm run dev` with
the same `DATABASE_URL` and `SESSION_SECRET` in the environment, and the engine with
`.venv/bin/python -m uvicorn engine.app:app --reload --port 8000`.

### 8.2 Run each test level

| Level | Command | Needs |
| --- | --- | --- |
| Engine unit and API tests, the SECI pack, the NHPC reading | `make test` (`pytest -m "not slow" tests/engine tests/test_seci_pack.py tests/e2e/test_nhpc_tender.py`) | the venv; about 15 minutes |
| The slow sizing tests | `make test-slow` (`pytest -m slow tests/engine`) | several minutes each |
| One test | `.venv/bin/python -m pytest -q tests/engine/test_rtc_lp.py -k seed` | |
| Model checks in Node | `make check-web` (every `tools/check_*.mjs` except `nhpc`) or `node tools/check_whatif.mjs` | Node 22; LibreOffice for the two workbook checks |
| Browser tests | `TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 make e2e`, or with `TENDEROS_EMAIL` and `TENDEROS_PASSWORD` instead of `TENDEROS_DEMO` | a running stack; `playwright install chromium` or `PLAYWRIGHT_CHROMIUM=/path/to/chromium`; `MCP_TOKEN=<the server's token>` for `test_mcp.py`; `SCREENSHOTS`/`E2E_SHOTS` optional. `test_team.py`, `test_team_mode.py`, `test_evidence.py` need demo mode (they switch seats with View as) |
| Click tour | `pytest -m slow tests/e2e/test_click_tour.py` with the same variables | |
| Deploy tooling | `.venv/bin/python -m pytest tests/deploy` | openssl |
| Lint | `make lint` (ruff over `engine`, `tests`, the demo tools) | |
| The whole demo clicked through, with its PDF | `make demo` (`tools/demo_run.py`, `tools/demo_report.py`) | a running stack in demo mode |

### 8.3 Add a migration

1. Add `web/db/migrations/013_<name>.sql` (three-digit prefix; files are applied in name order).
   Write it idempotently like the others (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … DROP
   CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`), one transaction per file.
2. `migrate()` in `web/lib/db.js` runs on every web start (`web/instrumentation.js`): it takes
   advisory lock `727401`, creates `schema_migrations`, and applies each `.sql` not yet recorded,
   recording the file name. It looks in `db/migrations` (the container: `web/Dockerfile` copies
   `db/`) or `web/db/migrations` (local).
3. Locally restart the web app; in compose `docker compose build web && docker compose up -d web`.
   Check with `docker compose exec db psql -U tenderos -d tenderos -c "select * from schema_migrations"`.
4. Add the server code in `web/lib/<area>.js` and its routes; never write SQL in a route.

### 8.4 Add a tender pack

There are two kinds.

**A tender type for the reader** (`engine/extraction/packs/power/`): copy `re_rtc.yaml` to
`<type>.yaml` with `type`, `pack: power`, `includes` (the core and power sections it uses),
its own `sections` (label, prompt, `prompt_version`, roles, `section_kinds`, keywords) and
`fields` (`sector.power.<type>.<field>` with section, label, type, unit, min/max, help). Put the
prompt at `packs/power/prompts/extract/<section>/v1.md` (a header between `---` lines may say
`extends: extract/v2`). `TENDER_TYPES` is read from the YAML files (`schema.py`); add the type's
keywords to `TYPE_KEYWORDS` in `extract.py` for auto-detection, and a rules extractor in
`rules_reader.py` if the headline fields should work without a key. Map the new fields to terms
in `web/src/bid/tenderMap.js` (`buildProposals`). Test with `tests/engine/test_extraction.py` (fake
SDK) and a sample under `samples/tenders/`.

**A curated pack like SECI's** (`web/src/seci/`): put the PDFs under `web/public/tenders/<id>/`,
write `<id>.json` with the same shape as `seci-rtc-tm-v.json` (conditions, changes,
clarifications, formats with blanks, bid process, queries, every item with document, page and
quote), add a `terms.js` that maps the conditions to sizing terms, letter templates under
`letters/`, and a `tests/test_<id>_pack.py` modelled on `tests/test_seci_pack.py` so every quote is
proved on its page. The SECI tab is the template for the tab itself.

### 8.5 Add a finance input end to end

Example: a new yearly cost input `fin.<key>`.

1. **State and engine.** Add the default with a comment to `DEFAULT_FINANCE` in
   `web/src/rtc/engine.js`; use it in `cashflows()` (and `constructionSchedule`/`debtTerms` if it
   is a financing term). The default must reproduce today's numbers (0 or "off").
2. **Inputs on screen.** Tender to Bid and SECI: add a `FINANCE_FIELDS` entry in
   `web/src/bid/model.js` (section, key, label, unit, `pct`, min, max, step) or a `<Field>` in
   `web/src/bid/FinanceInputsStep.jsx` with `lockProps("fin.<key>")`; Round the clock:
   `web/src/rtc/FinanceView.jsx`. A `data-testid` on the box gives team mode and evidence a stable
   key. Add a benchmark to `BENCHMARKS` if one exists; old saves get the default through
   `mergeBidState`.
3. **What-if.** Add it to `defaultWhatIf()` and to the `pick(fin, [...])` list in
   `whatIfFromBid` (`web/src/whatif/model.js`) so the What-if step carries it from the bid.
4. **Workbook request.** Add the key to `LIVE_FIN_KEYS` and the inputs table in
   `web/src/rtc/exportModel.js` (both tabs' requests pass through `liveResults`/`liveModelRequest`),
   and to the whitelist in `liveModelInput()` (`web/lib/liveModel.js`), otherwise the server drops it.
5. **Live model.** In `addLiveModel`, add the input cell (`S.one("<name>", "<label>", "<unit>",
   { v, kind: "input", fmt, source })`) in the inputs block and the formula lines that read it
   (`S.series(..., { f: (y) => ..., v: (y) => ... })`), mirroring `cashflows` line for line. The
   trace (`web/src/model/trace.js`) and the explorer pick it up from the sheet, nothing to add.
6. **Checks.** Extend a case in `tools/check_live_model.mjs` (the app-to-sheet mapping near line
   142 and the cases) so LibreOffice proves the formula; `check_trace.mjs` and `check_whatif.mjs`
   if the number has its own line; `check_bid_model.mjs` for the request. Run `make check-web`.
7. **Agent and MCP.** If the voice agent or Claude should set it, add it to `agentInputs` in
   `web/src/seci/agent.js` (the MCP `list_inputs`/`set_input` tools read the same list) and to
   `tools/check_seci_agent.mjs` / `check_mcp.mjs`.
8. **Docs.** The finance table in `docs/DEMO2.md` and the feature row in
   `docs/enterprise/FEATURES.md` (through `tools/build_enterprise_features.py`).

### 8.6 Add an MCP tool

1. Add an entry to `TOOLS` in `web/lib/mcp.js`: `name`, `title`, `annotations` (`READ` or
   `WRITE`), `inputSchema: schema({...}, [required])`, `description`.
2. Implement it: a server function dispatched in `callTool` (like `checkBid`), or, if the voice
   agent should have it too, a tool in `AGENT_TOOLS` and `createToolRunner` in
   `web/src/seci/agent.js` (then `callTool` falls through to `s.runner(name, args)`).
3. Give cited quotes a page link with `withLinks(value, base)`.
4. Add a case to `tools/check_mcp.mjs` (schemas are checked there) and, if it touches the engine,
   to `tests/e2e/test_mcp.py`; document it in the table in `docs/MCP.md`.

### 8.7 Add a sidebar tab

1. `web/lib/tabs.js`: add `{ id, label, engine: [...families] }` to `TAB_CATALOG`. This drives
   the pass-through's access check, the admin's tab-access form and `allowedTabs`.
2. `web/src/main.jsx`: add the tab to `TABS` with its icon, and a render branch
   `{canView && activeTab === "<id>" && <MyTab />}`. `FieldPings` and `EvidenceLayer` cover the
   new tab automatically because boxes are read from the page.
3. If it saves to the library: a migration extending `scenarios_module_check` (as 005 and 007
   did), the module in `MODULE_TAB` (`main.jsx`) and in `SaveDialog`/`scenarioApi` calls.
4. Give its inputs `data-testid`s, add a `tools/check_<tab>.mjs` for its model and a
   `tests/e2e/test_<tab>.py`; list the tab in `README.md` and `docs/ARCHITECTURE.md`.

### 8.8 Debug the engine

* Logs: `docker compose logs -f engine` (uvicorn, 2 workers); locally `/tmp/tenderos-engine.log`.
* The engine is not published. Its OpenAPI page is at `http://engine:8000/docs` inside the
  compose network (`docker compose exec web wget -qO- http://engine:8000/api/health`), or at
  `http://127.0.0.1:8000/docs` when run locally. `/api/bid/tender/status` reports whether the
  model, Docling and LlamaParse are available.
* A sizing streams its HiGHS log as NDJSON `log` lines; the browser shows them in the solver
  theatre. Reproduce one in Python with `engine.sizing.rtc_lp.solve(payload)` using a payload
  captured from the browser's network tab, or run `tests/engine/test_rtc_lp.py`.
* Extraction jobs are JSON files in `EXTRACTION_JOBS_DIR` (`/data/extraction_jobs` in the
  container); a job whose file is untouched for an hour is reported as lost. Dispatch jobs are in
  `DISPATCH15_JOBS_DIR`.
* Model reading without a key falls back to the rules reader; `EXTRACTION_REQUIRE_LLM=1` makes
  that an error instead. `tests/engine/test_extraction.py` exercises model mode with a fake SDK.

### 8.9 Rotate the MCP token

```
cd <install folder>
sed -i "s/^MCP_TOKEN=.*/MCP_TOKEN=$(openssl rand -hex 24)/" .env   # or edit .env by hand
docker compose up -d web            # recreates web with the new environment
grep -c MCP_TOKEN .env              # confirm it is set; never print the value in a shared log
```

The old URL answers 404 at once. Update the custom connector in Claude (claude.ai, Desktop or
`claude mcp add --transport http tenderos https://<site>/api/mcp/<new token>`). Setting
`MCP_TOKEN` empty, or shorter than 16 characters, switches the server off.

## 9. Environment variables

From `.env.example`, `docker-compose.yml`, the overlays and the code (`process.env.*` in `web/`,
`os.environ` in `engine/`). "Required" means the stack will not start without it.

| Variable | Used by | Purpose | Required |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | db, web (`DATABASE_URL`) | Database password | yes (compose refuses to start) |
| `SESSION_SECRET` | web | Signs the session cookie; 32+ characters (`openssl rand -hex 32`) | yes |
| `DATABASE_URL` | web | Postgres connection string; set by compose, needed for local runs | yes |
| `ENGINE_URL` | web | The engine's address; `http://engine:8000` in compose, `http://127.0.0.1:8000` locally | default |
| `WEB_PORT` | compose | The published web port (base compose only; the VM and enterprise overlays unpublish it) | default 3000 |
| `COOKIE_SECURE` | web | `true` behind HTTPS (the overlays set it) | default false |
| `ANTHROPIC_API_KEY` | engine | Model reading of tenders; without it the rules reader | no |
| `EXTRACTION_MODEL` | engine | Model id override (default `claude-fable-5-1`) | no |
| `EXTRACTION_REQUIRE_LLM` | engine | `1`: a read without the model fails instead of falling back | no |
| `EXTRACTION_CONCURRENCY`, `EXTRACTION_TIMEOUT_SECONDS`, `EXTRACTION_JOBS_DIR` | engine | Sections in parallel (4), per-request timeout (300), job folder (`/data/extraction_jobs` in the image) | no |
| `DOCLING_URL`, `DOCLING_TIMEOUT_SECONDS` | engine | docling-serve for a set's tables (`http://docling:5001` in compose); empty = PyMuPDF only; timeout 900 | no |
| `LLAMA_CLOUD_API_KEY`, `LLAMA_CLOUD_BASE_URL`, `LLAMAPARSE_TIMEOUT_SECONDS` | engine | LlamaParse for scanned pages | no |
| `DISPATCH15_JOBS_DIR` | engine | 15-minute dispatch job folder (default `<tmp>/tenderos_dispatch15`) | no |
| `OPENAI_API_KEY`, `OPENAI_LIVE_BACKEND_MODEL`, `OPENAI_LIVE_VOICE`, `OPENAI_BASE_URL` | web | The SECI voice agent (defaults `gpt-6-luna`, `marin`, `https://api.openai.com/v1`) | no |
| `MCP_TOKEN`, `MCP_SIZING_WAIT_MS`, `PUBLIC_URL` | web | The MCP server (off when empty or under 16 characters); how long `run_optimizer` waits (180000); the site address for page links | no |
| `FILES_DIR` | web | Uploaded files (`/data/files`, the `team_files` volume) | default |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `MAIL_FROM`, `APP_URL` | web | Team email (off without a host); `APP_URL` links each mail to the bid | no |
| `TENDEROS_ZONE`, `TENDEROS_VERSION` | web, engine (enterprise overlay) | `intake`, `core` or anything else = all; the release version shown in `/api/health` | default all / dev |
| `ENGINE_TIMEOUT_MS` | web | Pass-through timeout (30 minutes) | no |
| `DEMO_MODE`, `APP_SWITCH_URL` | web | No sign-in, one shared user (set by `deploy/demo2` and `deploy/shared-vm`, not in `.env.example`); link to the app chooser | no |
| `SITE_ADDRESS`, `COMPOSE_FILE`, `COMPOSE_PROJECT_NAME`, `COMPOSE_PROFILES` | caddy, compose | The host name for TLS; which compose files `docker compose` reads; project name; `intake` starts Docling in the enterprise overlay | VM/enterprise |
| `TENDEROS_ENGINE_INTERNAL`, `HTTPS_PORT`, `HTTP_PORT`, `TENDEROS_CADDYFILE`, `TENDEROS_CERTS_DIR` | enterprise overlay | Whether the engine has a route out (`false` in intake); Caddy's ports and files | enterprise |
| `TENDEROS_HOME`, `TENDEROS_RELEASE_PUB`, `TENDEROS_HEALTH_WAIT` | `tenderos-patch` | Install folder; the release public key; health wait (300 s) | enterprise |
| `ROUTER_PORT`, `DEMO1_NETWORK`, `OLD_APP_NETWORK` | `deploy/demo2` | The chooser router beside Demo 1 | shared VM |

## 10. Known gaps and what is not built

From `docs/enterprise/FEATURES.md` (status Build or Extend) and the "not yet" notes in the docs:

| Area | Gap | Source |
| --- | --- | --- |
| TI-16 Review before transfer | A reviewer confirming the whole reading before it is packaged for the core; today the reviewer ticks unlocated values in the workflow | Build, P1 |
| TI-17 Transfer package to the core | The signed, checksummed tender package exported from the intake zone and imported in the core | Build, P1 |
| BW-07 Sign-off per step and submission lock | Sign-off is per box (evidence); no per-step gate, no frozen submission version | Build, P2 |
| W-03 Sensitivity table | One-way and two-way sensitivities | Build, P2 |
| P-02 Enterprise sign-in (SSO) | SAML/OIDC or LDAP; today local accounts only | Build, P2 |
| TI-13 Tender questions by voice | The GPT-Live agent also drives the bid; a tender-only mode for the DMZ | Extend, P2 |
| TI-15 Claude connector | Limit to the tender (no bid data) in the enterprise edition; off (404) in the core zone (`web/app/api/mcp/[token]/route.js` checks `ZONE`) | Extend, P3 |
| W-04 Scenario compare | Compare exists for saved bids, not for What-if cases | Extend, P2 |
| E-06 Audit log export | Activity log exists; export to build | Extend, P2 |
| F-06, F-09, F-12, F-13 notes | Capex phasing by package and commissioning in parts; DSM/penalty reserve and letter-of-credit cost; prepayment cost (use the fee); covenant list | notes in the Live rows |
| Team (`docs/TEAM.md`) | Assignments only on the SECI tab; one team per server; assignments need a saved bid; no due-date reminders; no e-signature | "Not yet" |
| Model reading | Not yet run against a real tender with a key in this repository; tests use a fake SDK (`README.md`, `docs/DEPLOY.md` §4) | |
| Deployment | `gcp-create-vm.sh`, a real Let's Encrypt issuance and the Docker install on a fresh VM were not run here; `build-bundle.sh`, `install.sh`, `tenderos-patch apply`/`rollback` were not run against a Docker daemon (`docs/DEPLOY.md` "Tested", `deploy/enterprise/README.md` "Not run here") | |
| MCP | Not tested with a real claude.ai or Desktop connector; token in the URL is the only key | `docs/MCP.md` |
| Releases | No git tag, `VERSION` or `CHANGELOG.md` in the repository yet; `build-bundle.sh` falls back to `git describe --always` and a "no changelog" note | checked with `git tag -l`, `ls` |
| Reader | The review workflow (approvals, canonical facts, corrigendum versions) stays in `tender_engine`; this app stores readings only | `README.md` Status |
