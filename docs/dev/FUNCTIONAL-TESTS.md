# TenderOS Demo 2: functional test matrix

What is tested at each layer, how to run it, what the latest run reported, how to read a failure,
and what no automated test covers. The manual counterpart, click by click, is `CLICK-TESTS.md`.

## The layers

| Layer | Where | Runs | Needs | Time |
| --- | --- | --- | --- | --- |
| Engine unit and API tests | `tests/engine/*.py`, `tests/test_seci_pack.py`, `tests/e2e/test_nhpc_tender.py` | `make test` (`pytest -m "not slow"`) | Python 3.12 venv (`engine/requirements-dev.txt`), highspy, pymupdf, node for two tests; no services | 3–5 min |
| Slow sizing tests | `tests/engine` marked `slow` | `make test-slow` | highspy | 10–20 min (split-site solves 2–3 min each) |
| Model checks (browser code, no browser) | `tools/check_*.mjs` | `make check-web` (`node tools/check_*.mjs`, the NHPC one excepted) | Node 22; LibreOffice (`soffice`) for the Excel recalculation steps | 2–4 min |
| Browser end to end | `tests/e2e/*.py` | `make e2e` (`pytest -m slow`) against a running stack | Playwright + Chromium, the stack in demo mode, `MCP_TOKEN` for the MCP test, LibreOffice optional | 6–7 min (23 tests); plus the click tour, about 1 min |
| Deploy tests | `tests/deploy/test_patch_tool.py` | `pytest tests/deploy` (not part of `make test`) | openssl, python3; no Docker | 2 s |
| Instance checks | by hand against a started instance | once per release | an instance with `TENDEROS_ZONE=core` | minutes |
| Demo run with report | `tools/demo_run.py`, `tools/demo_report.py` | `make demo` | the stack; every long job is run | 40–60 min |

## Engine unit and API tests (`tests/engine`)

One row per file; the feature is the one in `docs/enterprise/FEATURES.md`.

| File | Tests | What it asserts | Feature |
| --- | --- | --- | --- |
| `test_extraction.py` | 21 | The tender schema compiles with unique paths and registered prompts; value coercion; cross-field rules; the quote resolver (exact, fuzzy, reordered, miss); rules-mode reading of the NHPC RfS, the BESS sample and the WBSEDCL RfP; the pre-bid queries quote the RfP word for word; model mode against a fake SDK, its fallback to rules when every call fails, the real SDK over a mock transport, refusal and truncation fail the call; withdrawn provisions are located findings without a value; derived sections are not read from pages; the jobs store rejects bad ids and cleans up; the API's status, catalog and read; a text upload; a value must be printed in its quote; `require_llm` never falls back | TI-01, TI-03, TI-12 |
| `test_tenderset.py` | 21 | The SECI set (RfS, two amendments, clarifications, PSA): document roles and order; clause labels; Docling-read changes cover the hand-checked pack with every quote located; change kinds and effects; the PyMuPDF fallback reads the same schedules; clarifications' verdicts and links; the clause index; amendments applied with history; an amended field that cannot be reread is flagged; a deleted clause withdraws its field; the model reread; the 20 formats and the bid process match the pack; read-set end to end; search; the Docling client polls; the layout falls back when Docling is down; LlamaParse fills only scanned pages; a prose amendment read by the model; the API's read-set then search, and bad requests refused | TI-02, TI-04 to TI-10 |
| `test_preview.py` | 6 | The scan screen's lines are the document's own text on its page; hits mark the phrases; an agent with nothing gets an empty list; headings rank below body text; text uploads have a preview; a read job shows the preview before the result | TI-03 (scan screen) |
| `test_rtc_lp.py` | 7 (2 slow) | The sizing LP: representative years, tax losses carried forward, tariff weights reduce to discounting, the LP meets the DFR and matches the engine's dispatch, bills at the 220 kV meter after transformer and line losses, a seed reaches the same optimum in fewer solves, the dispatch sheets' formulas give the LP's energy | S-01, S-05, D-07 |
| `test_bid_lp.py` | 19 | Tender supply rules with a peak window; biomass sized by its fuel limit and ramp rate; fuel cost raises the tariff; the RTC payload is unchanged; rules validated; flat and hourly market prices, market depth, PPA first versus diverting PPA energy, solar-only sales; the peak floor in any hour the procurer may pick; hydro by CUF and monthly CUF; the green share caps non-RE; non-RE never sold; plant costs reach the tariff; plant ids checked | S-02, S-03, D-01 |
| `test_block_rules.py` | 6 (2 slow) | Time-block floors (SECI Amendment-01 cl. 8.1): hard floors hold in every hour; a penalty lets the plant fall short when cheaper; inputs checked; the 15-minute dispatch holds the floors and writes the workbook; Amendment-03 caps the Solar Hours and prices their excess | S-02, S-04 |
| `test_dispatch15.py` | 8 | The 15-minute dispatch: the hourly split keeps each hour's energy; the battery keeps charge and delivery; never charges and discharges together; ramp, minimum and floors held; a floor the plant cannot meet is reported, not failed; requests checked; the battery charges from renewables only when thermal supplies; losses reported at the meter | S-04 |
| `test_split_sites.py` | 4 (slow) | Separate sites: split off is the co-located model; each battery charges from its own site only; separate sites cost no less; a transmission charge from an older request is ignored | D-08, D-09 |
| `test_cerc_order.py` | 4 | The CERC order reader: petition, date, petitioner, capacity and bidders with page and quote; long dates and no bidders; the route and a scan refused with a reason | TI-14 |
| `test_cfd_terms.py` | 1 | Every CfD term in `web/src/cfd/terms.js` is quoted word for word on its page (skipped unless the CfD documents are present: `CFD_DOCS_DIR`) | CfD tab |
| `test_document_pdf.py` | 6 | The PDF writer behind the letters: each part starts a page, long parts flow, struck text and tables kept, images and scripts not loaded, limits, the endpoint | BW-08 |
| `tests/test_seci_pack.py` | 6 | The SECI pack JSON: every quote on its page in its document; conditions have sources; the sizing terms match the conditions; documents in date order and served; the RfS answers the gaps; the formats cover section 7 | TI-11 |
| `tests/e2e/test_nhpc_tender.py` | 4 (no browser) | The NHPC RfS read in rules mode: FDRE, 264 pages, every finding located; agrees with the reviewed reading; key terms have the printed values; the Tender to Bid terms are proved by located quotes (`tools/check_nhpc_terms.mjs`) | TI-03, BW-05 |

## Model checks (`tools/check_*.mjs`)

Node scripts over the browser's own modules (`web/src`, `web/lib`), with `node:assert`. `make
check-web` runs every one except `check_nhpc_terms.mjs`, which takes a reading file and is run by
`test_nhpc_tender.py`.

| Script | What it asserts | Feature |
| --- | --- | --- |
| `check_rtc_engine.mjs` | The RTC engine: synthetic profiles calibrated to their CUF; the demand sums to the annual energy; generation, delivery and curtailment balances; the battery discharge bounded by its RTE; no export when sales are off, and sold + curtailed = surplus when on; the CSV profile parser | S-01, D-04 |
| `check_bid_model.mjs` | Tender to Bid: the terms from the built-in WBSEDCL reading, the inputs the bidder must give, the HiGHS request and the financial-model inputs | BW-03, BW-04 |
| `check_seci.mjs` | The SECI tab: Amendment-03's three time-block floors with the 1.5× penalty, the HiGHS request, the dates and money at stake, the bid-form checks, the bid agent's script and its reading of spoken or typed answers | TI-11, F-15, BW-08 |
| `check_seci_agent.mjs` | The bid agent's tools against a stand-in tab, the guided order of questions, the tender lookup, the GPT-Live event loop answering the backend's function calls | TI-13 |
| `check_seci_letters.mjs` | Every letter template places every blank of its format, no stray placeholder, every alternative on a choice blank; a filled bid renders every letter it needs with no blank left | BW-08 |
| `check_peak_prices.mjs` | The "6 costliest hours" plan on the served IEX file: six Peak Hours in each day's 18:00–10:00 window, the highest priced, reaching the sizing mask, the agent's charts and the What-if dispatch | S-02 |
| `check_scan_agents.mjs` | The scan screen's five agents on the WBSEDCL reading: every finding is a field with its page, sections map to agents, an unread agent says so | TI-03 |
| `check_live_model.mjs` | The Live model sheet rebuilds the app's 25-year model as formulas on three bids that use every branch (six sources with a flat market price, WDV tax and annual augmentation; separate sites with hourly market revenue, balloon repayment with quarterly instalments refinanced in year 6, straight-line tax, one-time augmentation, escalation, a shortfall penalty and tax losses, working capital and DSRA, DSM; solar alone with no debt): (1) the sheet's values match the app; (2) **LibreOffice recalculates every formula** to the value each cell carries, with no error; (3) a changed input (tariff, capex) recalculates to the app run on the changed input, so the sheet is live. Steps 2 and 3 are reported "not run" without `soffice` | F-02, F-05, F-06, F-07, F-09, F-10, F-12, F-14 |
| `check_dispatch_sheets.mjs` | The hour-by-hour dispatch sheets of the workbook: the energy by PPA year is formulas on the modelled years' 17,520 hours, they carry the app's values, and **LibreOffice recalculates every formula** to the same numbers | S-05 |
| `check_trace.mjs` | The traceable model: the in-app grid is the Live model sheet; every reference resolves; every key result traces back to inputs; precedents and dependents mirror each other | F-04 |
| `check_generation.mjs` | Generation as MW × CUF × 365 × 24 equals the hourly dispatch year by year; the annual CUF is the days-weighted mean of the months; the twelve months add to year 1; the 15-minute blocks keep each hour's energy | F-04 (CFO's check) |
| `check_whatif.mjs` | The What-if model: energy books balance, the battery is held for the peak, floors counted hour by hour, the returns move the right way with tariff and size, the tariff for the target IRR gives that IRR, the tender checks catch a refused plant, the levers (`levers.js`), the trace agrees | W-01, W-02 |
| `check_dsm.mjs` | Deviation settlement: the charge per MWh scheduled is a line in the contract rate; bands and X factor follow the year; a battery firms the schedule; the steps beyond the band cost what the norms say; the model carries the year's charge as an operating cost | D-11, F-14 |
| `check_plant.mjs` | The solar studio's layout (string voltage, inverter blocks), cost build-up and unit conversions (₹/Wp, ₹ cr/MWp, ₹ cr/MWac), string versus central inverters; the wind turbines' curves and capacity factors; the farm's cost | D-02, D-03 |
| `check_cuf_file.mjs` | The CUF file download (8,760 rows, header comments, the profile's and the uploaded file's values), the by-year CSV with the degradation factor, the 25-year justification's headings, year-25 CUF, P90 and ranges | D-05, D-06 |
| `check_evidence.mjs` | The evidence register: grouping by tab and box, item names, the sign-off state of an item, the CSV | E-02 |
| `check_team.mjs` | Team sharing: where each kind of data point lives in the bid and how an accepted answer is written into it | E-03 |
| `check_team_messages.mjs` | @mentions: handles, who a message mentions, the word being typed, suggestions with the tab's owners first, thread keys | E-04 |
| `check_market.mjs` | The SECI results in Recent tenders add up the way an e-reverse auction does and point at their notice | TI-14 |
| `check_mcp.mjs` | The MCP server: the JSON-RPC handshake and tool list, each tool's schema, the tender tools with their page links, the What-if check, the winning-bid bridge, and a whole bid in one session on a stand-in engine | TI-15 |
| `check_theme.mjs` | Day mode's chart colours (night untouched; ink and greys flip, the lime signal turns olive, data hues darken) and the hour Sankey in each mode | P-07 |
| `check_cfd_model.mjs` | The CfD model: terms and dates with quotes, the RfS's securities and amounts, the day-by-day operation within the sourcing limits, the weekly penalty, the Letter of Credit, the strike price | CfD tab |
| `check_bess_engine.mjs` | The BESS engine: every strategy keeps the contracted energy every year; oversize 0 is just enough for year 1; the optimizer's answer is no worse than any strategy on its grid | BESS tab |
| `check_nhpc_terms.mjs` | The Tender to Bid terms derived from an NHPC reading are each proved by a located quote (run by `test_nhpc_tender.py`) | BW-05 |

## Browser end to end (`tests/e2e`)

Playwright in Chromium, 1500 × 1000, against a running stack in demo mode (`TENDEROS_DEMO=1`), or
with a login (`TENDEROS_EMAIL`, `TENDEROS_PASSWORD`). Every test fails on any uncaught page error
(`page.on("pageerror")`).

| File :: test | The flow | Feature |
| --- | --- | --- |
| `test_tender_to_bid.py::test_nhpc_tender_to_bid` | Upload the NHPC RfS; the scan screen (five agents, every scrolled line on its page, the key dates with their page, "264 pages"); capacity 600 MW in the 50–600 range; sources solar, wind, battery; benchmarks; HiGHS sizing; every tender condition Met (the two 2-hour windows held in each of the 10 hours); Financials: tariff, equity IRR 14%, DSCR; the Excel downloads and its Live model matches before and after LibreOffice recalculates it | TI-01, TI-03, BW-04, BW-05, S-01, F-02, F-03, F-05 |
| `::test_prefilled_simulation` | The prefilled WBSEDCL tender opens straight in the workflow; 1,500 MW; back to the start screen which offers Continue | BW-01 |
| `::test_skip_and_reduced_motion` (×2) | Skip and `prefers-reduced-motion` both reach the workflow without the animation | TI-03 |
| `::test_tender_set` | The five SECI documents uploaded at once: amendments applied (100 → 50 MW), Documents, Changes with the target filter and a change's detail, Clarifications, Formats with a detail, Process, Search | TI-02, TI-06 to TI-10 |
| `::test_bess_tender_goes_to_the_bess_tab` | A standalone battery RfS: the scope notice and the hand-off to the BESS tab, which reads it | TI-01, BESS tab |
| `test_seci_tab.py::test_documents_and_conditions` | Six documents, the process, the queries, the changes with the Amendment-02 filter, a quote's PDF link opens its page, 50+ conditions with the RfS's original wording, specific conditions' texts | TI-11 |
| `::test_bid_on_screen` | 200 MW, costliest-hours Peak, penalty, Amendment-03 profile, the PPA date's derived dates; benchmarks; the loss-kind tabs; the one-line schematic; the steps' teams; Finance inputs (debt terms, construction, DSM); HiGHS sizing; the compliance table and the hour Sankey; the agent's charts and the typed energy check with the trace; money at stake; the quote check below target; the particulars; Format 7.1 beside the RfS, blanks, context page, review and re-review; 7.10, 7.2 not needed; the letter with an edit, revert, Word and PDF (single and all); the bid pack; the Excel with the dispatch sheets, read back in the trace; the What-if step seeded from the sizing with the levers; the 15-minute dispatch of 25 years and its workbook; saved and reopened from the library with the letter edit | BW-01 to BW-05, BW-08, D-07, D-09, D-10, F-01 to F-05, F-14, S-04, S-06, W-01, W-02 |
| `::test_agent_panel` | The GPT-Live panel: without a key it says how to set it up and Start is disabled; with one, Start sends the WebRTC offer and shows the voice service's answer | TI-13 |
| `test_round_the_clock.py::test_rtc_workbook` | The RTC tab's default plant: tariff and equity IRR read, the Excel's Live model matches before and after LibreOffice | F-05 |
| `::test_rtc_separate_sites` | Separate sites in the Battery chapter: nothing to enter, each battery from its own site, the split shown; the workbook still matches | D-08, D-09 |
| `test_demo2.py::test_traceable_model_round_the_clock` | Equity IRR opens the trace with `IRR(`; follow a reference and back; every input under it; a cell of the 25-year table opens at its year | F-04 |
| `::test_plant_studios_fill_the_bid` | The solar studio's module price moves the cost and Apply writes the capex; the wind studio's turbine writes the CUF; the profile on screen | D-02, D-03, D-04 |
| `::test_what_if` | Bid at the needed tariff gives the 14% IRR; no battery fails the storage check; Reset; a return opens the trace | W-01 |
| `::test_generation_traces_to_15_minutes` | Delivered → bus total → solar's year as MW × CUF × 365 × 24 → months → 21 June's 96 blocks → 35,040 blocks | F-04 |
| `::test_recent_tenders_and_cerc_upload` | The SECI results; a synthetic CERC order uploaded, read into petition, date, petitioner and winners; checked; the PDF served; deleted | TI-14 |
| `::test_winning_bid_step` | The bridge of 8 rows from ₹6.50 to ₹5.25, the head, the disclosed winners | BW-09 |
| `test_team.py::test_assign_answer_accept_and_return` | A saved bid; three assignments (capex to procurement, Format 7.1 to finance, a condition to legal); each desk answers (value, signed PDF, note) from its own View as; accept, return with a note, answer again, accept; each acceptance a saved version; the demo outbox; the answers in the bid; the server's 404s | E-03, E-07, BW-06 |
| `test_team_mode.py::test_ping_a_teammate_for_a_box_and_fill_in_the_answer` | The send icon on a What-if box; @finance.desk suggested; the ping; the Finance desk's inbox, Open field, a reply with 320; Fill in as the manager; Team setup's seats and a saved title | E-04, E-05 |
| `test_evidence.py::test_attach_evidence_sign_off_and_download_the_register` | A note and a link on a box (count 2); sign-off green; a changed value amber; the note removed; the register CSV; the demo left as it was | E-01, E-02 |
| `test_theme.py::test_day_and_night` | Night by default; day mode: background, logo, the chart's fills; kept across a reload and on the library pages; night again | P-07 |
| `::test_switch_redraws_open_charts` | Switching with a chart on screen redraws it at once | P-07 |
| `test_mcp.py::test_mcp_server` | Initialize, tools/list, `tender_lookup` with an Amendment-03 page link, `check_bid`, a wrong token 404, a GET 405 (needs `MCP_TOKEN`) | TI-15 |
| `test_click_tour.py` (6 tests, about 1 min) | The fast tour: every sidebar tab, the zone badge, day/night; Tender to Bid's six steps on the prefilled tender with Fill up, One site / Separate sites, the before-sizing states; the SECI tab's ten steps with their teams, the amendment filter, the RfS wording, the bid choices, Fill up, the loss-kind tabs, the schematic on one and two sites, the solar studio, the repayment methods, construction months, the drawdown profile, the DSM switch, the What-if levers, the formats and the letter view, the winning bid, the Save dialog, the agent panel, the paperclip and the send icon on a box, Reset; the standalone What-if (Bid at this tariff, levers, trace, Reset); Round the Clock's chapters, separate sites, the repayment select, the construction view; BESS chapters; CfD steps with Fill up and the worked example; Recent tenders; Team setup; Messages. No long job; no 5xx from the API; no page error | the quick path of every feature above |

## Deploy tests (`tests/deploy`)

| Test | What it asserts |
| --- | --- |
| `test_patch_tool.py` (9) | The enterprise patch tool's verify path without Docker: the manifest lists every file with its sha256; tamper and stray files are reported; the changelog section; the manifest CLI; `tenderos-patch verify` accepts a good bundle and rejects a tampered file, a file outside the manifest, a bad signature and a manifest edited after signing (a test keypair made with openssl) |

## Instance checks (by hand, once per release)

| Check | How | Expected |
| --- | --- | --- |
| Core zone | Start an instance with `TENDEROS_ZONE=core`; call the voice agent, a tender-read route and a sizing | The voice agent 403; the tender-reading routes (`bid/tender/read`, `read-set`, `bid/cerc-order`, `bess/parse`) 403 with "Not in the core zone…"; sizing allowed; the badge reads "Core zone" |
| `next build` | `make build` | Builds with no error |

## How to run each level

```
# unit and API tests (3–5 min; no services)
make test                      # .venv/bin/python -m pytest -q -m "not slow" tests/engine tests/test_seci_pack.py tests/e2e/test_nhpc_tender.py
make test-slow                 # the slow sizing LPs (10–20 min)
.venv/bin/python -m pytest -q tests/deploy      # the patch tool (2 s)
make lint                      # ruff over engine, tests and the two demo tools

# model checks (2–4 min; LibreOffice for the recalculation steps)
make check-web                 # node tools/check_*.mjs, except the NHPC one
node tools/check_live_model.mjs            # one of them on its own

# the browser suite (6–7 min) against a running stack
bash tools/dev.sh              # or docker compose up -d; DEMO_MODE=1 for the demo
TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 MCP_TOKEN=<the server's> make e2e
# one file, with a Chromium binary and screenshots
TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  SCREENSHOTS=/tmp/shots .venv/bin/python -m pytest -q -m slow tests/e2e/test_click_tour.py -p no:cacheprovider

# the whole demo with the PDF report (40–60 min; every long job)
make demo
```

Environment variables:

| Variable | Used by | Meaning |
| --- | --- | --- |
| `TENDEROS_URL` | e2e | The web app (`http://127.0.0.1:3000`) |
| `TENDEROS_DEMO=1` | e2e | A demo deployment: no sign-in; the team's seats are switched with View as (the team, evidence and click-tour tests need it) |
| `TENDEROS_EMAIL`, `TENDEROS_PASSWORD` | e2e | A sign-in instead of demo mode, for the tests that do not need View as |
| `MCP_TOKEN` | `test_mcp.py` | The server's token; without it the MCP test is skipped |
| `PLAYWRIGHT_CHROMIUM` | e2e | A Chromium binary when Playwright's own is not installed |
| `E2E_SHOTS`, `SCREENSHOTS` | e2e | Folders for screenshots (the journey tests; the team, evidence and click-tour tests) |
| `E2E_IGNORE_HTTPS_ERRORS=1` | e2e | A self-signed certificate (Caddy on localhost) |
| `CFD_DOCS_DIR` | `test_cfd_terms.py` | The CfD Agreement and amendments (not in the repository) |
| `EXTRACTION_WBSEDCL_RFP` | `test_extraction.py` | The WBSEDCL RfP when it is not in `samples/` |
| `TENDEROS_ZONE=core` | the instance check | A core-zone instance |

Markers: `slow` = needs the running stack (browser) or takes minutes (the sizing LPs). `make test`
deselects it; `make e2e` and `make test-slow` select it.

## Latest results

As reported by the latest full run on the demo VM:

| Level | Result |
| --- | --- |
| `next build` | OK |
| `make test` (unit suite) | 691 passed, 3 skipped (optional inputs absent: the CfD documents for `test_cfd_terms.py`, the WBSEDCL RfP `RFQ_RFP_Final_22_09.pdf` for two `test_extraction.py` tests; set `CFD_DOCS_DIR` / `EXTRACTION_WBSEDCL_RFP` to run them) |
| `make check-web` | every `tools/check_*.mjs` passed, LibreOffice recalculation included |
| `make e2e` (browser suite) | 23 passed in 6 min 42 s |
| `tests/e2e/test_click_tour.py` | 6 passed in about 50 s (run twice) |
| `tests/deploy` | 9 passed in 2 s |
| Core-zone instance check | voice agent 403, tender-reading routes 403, sizing allowed |

## How to read a failure

* **pytest (engine, pack, deploy).** The `FAILED path::test - message` line names the test; the
  assertion above it prints both sides. A `skipped` is a missing optional input (highspy, pymupdf,
  the CfD documents, node), never a failure; `-rs` prints the reason.
* **Model checks.** Each `check_*.mjs` stops at its first failed `assert` with the message in the
  script (for example "solar CUF calibrated") and a stack trace to the line; the script's header
  comment says what it covers. `check_live_model.mjs` prints "not run" for steps 2 and 3 when
  `soffice` is missing: install LibreOffice rather than treat it as a pass.
* **Browser tests.** A `TimeoutError: … waiting for locator("[data-testid=…]")` means the screen
  did not reach that state in time: open the app by hand at that step (the test's docstring names
  the flow) and look for an error toast or a blank section. An `AssertionError` prints the text the
  page showed, which usually says what differs from the expected (a count, a label, a value). The
  session's exit asserts `not errors`: a list of uncaught browser errors, with the message of
  each, is an app bug, not a test problem. `_tour()` in the click tour also lists any API answer
  of 500 or more as `status METHOD url`. Set `SCREENSHOTS` or `E2E_SHOTS` to keep a picture of
  each step. Timeouts: sizing waits up to 30 min, the stack's first page 60 s, the RTC finance stats
  120 s; a slower VM needs no change.
* **Flakiness known and handled.** The format review button can move under the pointer while the
  RfS page loads (`_review` in `test_seci_tab.py` clicks again); the send and paperclip icons take
  clicks only while their box is hovered (`_icon_for`, `_box_dot`, `_clip` hover first). The team,
  evidence and ping tests write to the shared demo database and tidy up after themselves; a run
  interrupted half way can leave a thread, an evidence item or a saved "Team test bid …" behind,
  which does not fail the next run.

## Not covered by automation

Read from the tests; each is a manual case in `CLICK-TESTS.md` where it is clickable.

* **Long jobs in the browser, other than the SECI and NHPC sizings:** the Round the Clock
  optimizer (the theatre, the worker, the Settings panel), the BESS "Optimize the bid", the CfD
  "Optimise own RE" and Stop. Their models are checked by `tools/check_rtc_engine.mjs`,
  `check_bess_engine.mjs` and `check_cfd_model.mjs`, and `tests/engine/test_rtc_lp.py`.
* **Uploads in the browser other than tenders and the CERC order:** CSV demand, solar and wind
  profiles in Round the Clock and on the source cards; a BESS RfS uploaded on the BESS tab itself
  (only the hand-off from Tender to Bid is driven); evidence of kind *file* (the tests attach a
  note and a link); the Tender step's model reading of an open tender (`bid-fill-model`).
* **Downloads not asserted:** the CfD workbook, the Round the Clock CSV export, the profile CUF
  file and justification from the browser (their content is checked in `check_cuf_file.mjs`), the
  pre-bid queries Word file, the letter offered to print in the Team panel.
* **Finance inputs the model checks cover but no browser test clicks:** refinancing, instalments a
  year, the moratorium, the DSM steps table, the drawdown profiles' effect on IDC (the click tour
  changes the selects and months but does not read the model's answer).
* **What-if:** Apply on a lever row; the solar and wind studios opened from the What-if tab; the
  week slider.
* **Library:** the scenario versions page and Compare; saving on Round the Clock and BESS;
  "Save as new scenario" on a linked bid.
* **Team:** "Add to team", deactivating a member, the send-icon mode (Always / On hover), "Mark
  all read"; a user signed in with an account (not View as); email through real SMTP (the demo
  outbox only).
* **Accounts and access:** the login page, first-run setup, Users and Activity admin pages, tab
  access and the Restricted screen (`allowedTabs`), the app chooser of the shared VM (only passed
  through when present).
* **Cloud services live:** the Anthropic model reading of a tender (a fake SDK and a mock
  transport), Docling and LlamaParse (recorded fixtures and mock transports), the GPT-Live voice
  agent with a real key (the refusal path is driven; a conversation is not), email delivery.
* **Zones and deployment:** the core zone's 403s are an instance check by hand, not a test;
  `tenderos-patch apply`, `rollback` and `status`, `install.sh`, `build-bundle.sh`, the enterprise
  compose overlay, `backup.sh` and a restore (all need a Docker daemon or a second machine).
* **Browser matrix:** Chromium only, one viewport (1500 × 1000), night mode except the theme
  test; no Firefox, Safari, phone widths, keyboard-only navigation or accessibility checks; day
  mode is checked by colour sampling on one chart, not visually.
* **Non-functional:** concurrency (two people on one bid), performance under load, memory of
  long sessions, the 6-hour MCP session expiry, the 15-second team refresh timing.
* **Content:** the wording of every condition, change and clarification is checked for its quote
  on its page, not for its meaning; the benchmarks' figures (CERC norms, 2025–26 prices) and the
  DSM norms are asserted as the app's own numbers, not against the notified texts.
