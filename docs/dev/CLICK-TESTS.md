# TenderOS Demo 2: manual click tests

The tester's script. One numbered case per thing to click, grouped by screen, each with its
preconditions, the clicks, the expected result and the automated test that covers it (or
"manual only"). Run it on a demo deployment (`DEMO_MODE=1`, no sign-in) in a fresh browser
profile, night mode, 1500 px wide or more. The automated counterpart of the quick cases is
`tests/e2e/test_click_tour.py` (about a minute); the long ones are in the journey tests
(`make e2e`, 6 to 7 minutes) and are marked with their timing.

Conventions:

* **Step chips** are the numbered buttons under a tab's heading; **chapters** are the buttons on
  the left rail of Round the Clock and BESS Tender.
* **Fill up for me please** puts the benchmarks (CERC norms, 2025–26 prices) into every empty
  box and marks them as benchmarks; anything typed replaces them.
* **Long jobs** (do not start them in a quick pass): HiGHS sizing 1.5–3 minutes on the demo VM
  (one site) and several minutes on separate sites; the 15-minute dispatch of every PPA year
  several minutes; reading an uploaded tender 1–4 minutes (a tender set up to 10 minutes);
  the CfD "Optimise own RE" 1–3 minutes.
* Every case also expects: no error toast, nothing frozen, and nothing in the browser console
  marked as an uncaught error (press F12 before the run).

---

## 0. Shell: sidebar, zone, day and night mode

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| SH-01 | Sidebar | Fresh browser at `/` | Open the app | The Tender to Bid start screen; no login page; the sidebar lists Workspace (7 tabs), Team (Team setup, Messages), Library (Saved scenarios), the day/night switch | `test_click_tour.py::test_sidebar_tabs_theme_and_zone`; `test_tender_to_bid.py` (`_session`) |
| SH-02 | Sidebar | — | Click each Workspace tab in turn: Tender to Bid, Round the Clock, SECI RTC tender, BESS Tender, CfD Bid, What-if analysis, Recent tenders | Each opens its screen and its button is highlighted; the previous tab's edits are still there when you come back (tabs keep their state while the page is open) | `test_click_tour.py::test_sidebar_tabs_theme_and_zone` |
| SH-03 | Zone badge | — | Read the badge under the logo | "Single installation · vdev" (or the version); hover: "Tender reading and the bid workspace together". On a core-zone install it reads "Core zone … patched under AMC" | `test_click_tour.py` (data-zone = all); the core-zone 403s: instance check only (see FUNCTIONAL-TESTS.md) |
| SH-04 | Day mode | — | Click "Day mode" at the foot of the sidebar | The page turns light at once, the logo changes to the dark-type one, the button reads "Night mode"; open charts redraw in the day palette | `test_theme.py::test_day_and_night`, `::test_switch_redraws_open_charts`; `test_click_tour.py` |
| SH-05 | Day mode kept | SH-04 | Reload; open Saved scenarios; come back | Still day mode everywhere; the library page carries the same switch; switch back to night there and the workspace is night again | `test_theme.py::test_day_and_night` |
| SH-06 | Team: Messages | — | Click Messages | A drawer opens on the right: "0 unread" (or the count), View as, Unread/All, "Nothing unread"; click Messages again or × to close | `test_click_tour.py`; `test_team_mode.py` |
| SH-07 | Team setup | — | Click Team setup | The team table (five demo seats: Tender manager, Finance, Procurement, Legal, Technical desks), "Who to ping for what" by tab, the roles, the send-icon setting (Always / On hover) | `test_click_tour.py::test_bess_cfd_recent_team`; `test_team_mode.py` |
| SH-08 | Saved scenarios | — | Click Saved scenarios | The library page lists saved bids by module with Open, versions and Compare | `test_seci_tab.py::test_bid_on_screen` (open from the library); compare: manual only |

## 1. Tender to Bid

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| TB-01 | Start screen | — | Look at the start screen | "Upload a tender" with a file box and "Read the tender"; the prefilled simulation card (WBSEDCL/PT&P/RE-RTC/2026/01, 1,500 MW) with "Run"; recent tenders | `test_click_tour.py::test_tender_to_bid_steps` |
| TB-02 | Prefilled | — | Click Run on the prefilled card | The workflow opens at once on WBSEDCL (no scan screen); the tender head names it | `test_tender_to_bid.py::test_prefilled_simulation` |
| TB-03 | Tender step | TB-02 | Step chip 01 Tender | The reading summary (pages, fields read), the recent tenders table, "Key dates" button, the model-reading upload button | `test_click_tour.py` |
| TB-04 | Key dates | TB-02 | Step chip 02 | The calendar with the tender's dates and the agenda list; past dates greyed | `test_click_tour.py` |
| TB-05 | Bid capacity | TB-02 | Step chip 03; set the capacity; choose Yes/No on the greenshoe | "1,500 MW" and the tender's range shown; outside the range a warning lists why; the greenshoe choice is a bid decision and stays asked until chosen | `test_click_tour.py`; `test_tender_to_bid.py::test_nhpc_tender_to_bid` |
| TB-06 | Supply sources | TB-05 | Step chip 04; click "Fill up for me please" | Every empty box gets a benchmark (marked); "0 inputs needed"; the Size the plant button becomes enabled | `test_click_tour.py`; `test_tender_to_bid.py` |
| TB-07 | Sources on/off | TB-06 | Click "I have it" / "Not in my bid" on wind, biomass | The card switches; the required storage cannot be switched off; inputs reappear for a source switched on | `test_tender_to_bid.py::test_nhpc_tender_to_bid` |
| TB-08 | Sites | TB-06 | "One site" / "Separate sites" | Separate sites needs solar, wind and a battery in the bid (disabled otherwise, with the reason under it); on separate sites the rule text appears (each battery charges from its own site) | `test_click_tour.py` |
| TB-09 | Size (long) | TB-06 | Step chip 05, "Size the plant" | The console streams the solver; after 1.5–3 min the sizes (solar, wind, battery, tariff), the compliance table and the checklist with every tender condition Met | `test_tender_to_bid.py::test_nhpc_tender_to_bid` (NHPC, after an upload) |
| TB-10 | Financials (long) | TB-09 | Step chip 06 | Bid tariff, equity IRR = the 14% target, DSCR, the 25-year table, revenue chart; "Download financial model (Excel)" | `test_tender_to_bid.py::test_nhpc_tender_to_bid` |
| TB-11 | Excel download (long) | TB-10 | Click Download financial model | An `..._financial_model.xlsx` with Cover, Live model (formulas, linked from the Cover), inputs and the dispatch sheets; opened in Excel/LibreOffice the Live model's tariff and IRR are the app's | `test_tender_to_bid.py` (`_check_live_model`, LibreOffice recalculation when installed) |
| TB-12 | Before sizing | TB-02 | Step chips 05 and 06 without sizing | 05 offers "Size the plant"; 06 says "Size the plant first" with a Go to sizing button | `test_click_tour.py` |
| TB-13 | New tender | TB-02 | "New tender" (top right) | Back to the start screen, which now offers "Continue" on the open tender | `test_tender_to_bid.py::test_prefilled_simulation`; `test_click_tour.py` |
| TB-14 | Upload (long) | — | Choose `samples/tenders/nhpc-fdre-ii/RfS.pdf`, Read the tender | The scan screen: five agents (dates, eligibility, constraints, finance, risks), scrolling lines each with its page, the key dates locking in, "264 pages · every value on its page"; then the workflow on 2024_NHPC_800202_1 | `test_tender_to_bid.py::test_nhpc_tender_to_bid` |
| TB-15 | Scan: Skip | TB-14 in progress | Click Skip | The animation stops; the workflow opens when the reading is done | `test_tender_to_bid.py::test_skip_and_reduced_motion` |
| TB-16 | Tender set (long) | — | Choose the five SECI files in `web/public/tenders/seci-rtc-tm-v/` at once; Read | "Read the tender set (5)"; after the read, the Tender set panel: amended terms (least bid 100 → 50 MW by Amendment-01), Documents, Changes (with the target filter), Clarifications, Formats, Process, Search ("e-reverse auction" finds pages) | `test_tender_to_bid.py::test_tender_set` |
| TB-17 | BESS hand-off | A standalone BESS RfS uploaded | Step chip 03 | "standalone battery storage tender" notice with "Open in the BESS tab"; clicking it opens BESS Tender with the file read | `test_tender_to_bid.py::test_bess_tender_goes_to_the_bess_tab` |
| TB-18 | Reset inputs | TB-06 | "Reset inputs", confirm | Capacity, sources, costs and sizing cleared; the tender and pre-bid queries stay | manual only |
| TB-19 | Pre-bid queries | TB-02 | On the Tender step, the pre-bid queries block: tick/untick, set the bidder and deadline, Copy, Download | The queries quote the clause and page; the Word file downloads | manual only (`tests/engine/test_extraction.py::test_prebid_queries_quote_the_wbsedcl_rfp_word_for_word` checks the quotes) |

## 2. SECI RTC tender (the ten steps, by team)

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| SE-01 | Tab | — | Open SECI RTC tender | Hero "RTC tender · SECI", RfS No.; ten step chips, each with its team under it: Tender/Legal, Tender/Legal, Projects, Design, Finance, Projects, Finance, Finance, Tender/Legal, Projects; Save, Open, Reset inputs; "Talk to the bid agent" | `test_click_tour.py::test_seci_steps` (teams asserted); `test_seci_tab.py` |
| SE-02 | 01 Tender & amendments | — | Read the step; click Amendment-02 then All in the changes filter | Six documents (RfS, three amendments, clarifications, PSA) with "Open the PDF"; the bid process (10+ steps); the changes list filters by document; clarifications with verdicts; the points to raise with SECI | `test_click_tour.py`; `test_seci_tab.py::test_documents_and_conditions` |
| SE-03 | PDF links | SE-02 | Click a quote's page link | The PDF opens at that page (e.g. Amendment-02.pdf#page=3) | `test_seci_tab.py::test_documents_and_conditions` |
| SE-04 | 02 Bid conditions | — | Step chip 02; open "RfS as issued" on the off-peak condition | 50+ conditions, the summary counts the removed ones; the amended condition shows 70% in force and the RfS's 80% under "RfS as issued" | `test_click_tour.py`; `test_seci_tab.py::test_documents_and_conditions` |
| SE-05 | 03 Bid inputs | — | Step chip 03; type 200 MW; pick "6 costliest IEX hours", "pay the penalty"; set a PPA date | Solar Hours 100–120 MW and Remaining Hours 140 MW follow the MW; Amendment-03's profile is on; SCSD = PPA + 24 months and Financial Closure 6 months before it; before a sizing "Money at stake" says to size first | `test_click_tour.py`; `test_seci_tab.py::test_bid_on_screen` |
| SE-06 | 04 Design | — | Step chip 04; Fill up for me please | Benchmarks in every box, "0 inputs needed"; the losses to the billing meter block; "Continue to Finance inputs" | `test_click_tour.py`; `test_seci_tab.py` |
| SE-07 | Loss-kind tabs | SE-06 | Click Solar / Wind / Battery in the losses block | Solar: inverter-duty transformers; Wind: WTG step-up transformers; Battery: MV transformers; each with where its CUF is measured | `test_click_tour.py`; `test_seci_tab.py` |
| SE-08 | Site schematic | SE-06 | One site / Separate sites | One site: one pooling station shared by solar, wind and the battery, losses summed at it. Separate sites: two pooling stations, Battery A at the solar site, Battery B at the wind site, two lines to the GSS; four loss boxes under it | `test_click_tour.py` (data-split 0/1, texts) |
| SE-09 | Solar studio | SE-06 | "Solar studio" on the solar card; change the module price; Apply | The layout drawing, inverters, the cost build-up in ₹/Wp and ₹ cr/MWac; the capex box takes the studio's figure, marked "From the studio" | `test_demo2.py::test_plant_studios_fill_the_bid`; open/close in `test_click_tour.py` |
| SE-10 | Wind studio | SE-06 | "Wind studio"; pick Vestas V155-3.3; Apply | The turbine table, the farm's CUF in the heading; the CUF box takes it | `test_demo2.py::test_plant_studios_fill_the_bid` |
| SE-11 | Profile on screen | SE-06 | Open "Profile on screen" on the solar card | Month × hour heat map, monthly CUF, the CUF figure; CUF file and justification downloads | `test_demo2.py` (view); downloads: `tools/check_cuf_file.mjs` |
| SE-12 | 05 Finance inputs | SE-06 | "Continue to Finance inputs" or chip 05; Fill up for me please | Financing and project costs grid, Debt repayment and refinancing, Construction and IDC, Working capital and reserves, Deviation settlement (CERC DSM), "Ready to size" | `test_click_tour.py`; `test_seci_tab.py::test_bid_on_screen` |
| SE-13 | Repayment methods | SE-12 | Repayment select: Equal, Annuity, Sculpted, Balloon, Bullet, Step-up; Instalments a year; moratorium | Sculpted shows Target DSCR, Balloon shows Balloon share, Step-up shows Principal step-up; the others no extra box; instalments Yearly / Half-yearly / Quarterly / Monthly | `test_click_tour.py` (sculpted, balloon, stepUp); the model: `tools/check_live_model.mjs` (annuity), `tests/engine/test_rtc_lp.py` |
| SE-14 | Refinancing | SE-12 | Set "Refinance at the end of year" to 8 | New interest rate, new tenor and fee boxes become enabled | manual only in the browser; the model: `tools/check_live_model.mjs` (balloon, quarterly instalments, refinanced in year 6, recalculated by LibreOffice) |
| SE-15 | Construction | SE-12 | Construction months 0 → 12; drawdown profile; funding order | Hint changes from "IDC inside the pre-operative share" to "IDC worked out month by month"; the profiles are Even, S-curve, Front, Back; funding Pro rata / Equity first | `test_click_tour.py` (hint, profile select) |
| SE-16 | Working capital | SE-12 | Read and edit receivable days, O&M in hand, spares, WC interest, DSRA | CERC norms in the hints (45 days, 1 month, 15%) | `test_click_tour.py` (hint) |
| SE-17 | DSM switch | SE-12 | "Apply DSM charges" On → Off → On | Off: the charge per MWh reads "off"; On: ₹/MWh for year 1 and year 6, blocks outside the band, X factor; the steps table is editable | `test_click_tour.py`; model: `tools/check_dsm.mjs` |
| SE-18 | 06 Size (long) | SE-12 | "Size the plant" (2–3 min) | Sizes for solar, wind and battery, the tariff; the compliance table: Peak Hours floor, Solar Hours band, Remaining Hours floor met in every block; the year-1 dispatch chart; hover an hour for the Sankey with the block's floor | `test_seci_tab.py::test_bid_on_screen` |
| SE-19 | 15-minute dispatch (long) | SE-18 | "Run the 15-minute dispatch"; then download the Excel | Several minutes; the table reports blocks per year; the workbook has About, Summary, Monthly and 25 year sheets of 8,760 rows | `test_seci_tab.py::test_bid_on_screen` |
| SE-20 | Money at stake | SE-18 | Chip 03 | EMD, PBG and minimum net worth in ₹ cr on the installed MW/MWh | `test_seci_tab.py::test_bid_on_screen` |
| SE-21 | 07 Financial model (long) | SE-18 | Chip 07 | Bid tariff for the 14% equity IRR, project IRR, DSCR; the quote check: a tariff below the target is warned with the IRR it earns; Trace the model opens the grid; Download the Excel | `test_seci_tab.py::test_bid_on_screen` |
| SE-22 | 08 What-if | SE-18 | Chip 08 | "Starts from the plant HiGHS sized"; "Back to the sized bid"; Compute the levers lists 8+ levers with the move each needs | `test_seci_tab.py::test_bid_on_screen`; before sizing: `test_click_tour.py` ("Size the plant first", levers on the default case) |
| SE-23 | 09 Bid forms | — | Chip 09; fill the particulars; "Use ₹x/kWh" | The particulars form, the checks (capacity, storage, substation, net worth, experience, EMD, PBG, dates, formats), the formats nav: Envelope I, Envelope II, Not needed for this bid | `test_seci_tab.py::test_bid_on_screen` |
| SE-24 | A format | SE-23 | Click 7.1; fill a blank; click a blank's context; "Mark reviewed"; edit again | The blanks beside the RfS page (page 68); a blank's words open their page; Reviewed shows on the nav; an edit after the review says "changed since review" | `test_seci_tab.py::test_bid_on_screen`; open: `test_click_tour.py` |
| SE-25 | The letter | SE-24 | "The letter"; click a paragraph, type, click away; Revert | The RfS wording with the blanks filled, alternatives not chosen struck out; the paragraph is marked "changed from the RfS"; Revert restores it | `test_seci_tab.py::test_bid_on_screen`; open: `test_click_tour.py` |
| SE-26 | Letters and bid pack | SE-24 | Word / PDF of this letter; all letters Word / PDF; "Bid pack (Word)" | Files download; Word holds the strike-through; the bid pack holds every format this bid needs and not the consortium ones | `test_seci_tab.py::test_bid_on_screen` |
| SE-27 | 10 Winning bid | — | Chip 10 | ₹5.25 in the head; the bridge table of 8 rows from ₹6.50 to ₹5.25; the disclosed winners (Juniper …); a link to SECI's result | `test_click_tour.py`; `test_demo2.py::test_winning_bid_step` |
| SE-28 | Save | — | Save; close with ×; Save again; name it; Save | The dialog opens and closes without saving; a save shows "Saved … version 1" and the name · v1 in the hero; the next Save offers "New version" | open/close: `test_click_tour.py`; save: `test_seci_tab.py`, `test_team.py` |
| SE-29 | Open from the library | SE-28 | Open › the saved bid › Open | The tab reopens with the saved particulars, blanks, letter edits and sizing | `test_seci_tab.py::test_bid_on_screen` |
| SE-30 | Bid agent | — | "Talk to the bid agent" | The GPT-Live panel; without a key on the server it says to set OPENAI_API_KEY and Start is disabled; the chart buttons draw the sized plant's charts; "Check the energy" types the CFO's question | `test_seci_tab.py::test_agent_panel`, `::test_bid_on_screen`; open/close: `test_click_tour.py` |
| SE-31 | Reset inputs | — | Reset inputs, confirm | Bid, sources, costs, sizing and forms back to the defaults (300 MW) | `test_click_tour.py` |
| SE-32 | Next / Previous | — | The footer buttons | Walk the ten steps forward and back | manual only |

## 3. Evidence and team mode (on any input box)

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| EV-01 | Paperclip | Messages › View as: Tender manager | Hover a box (e.g. What-if › Contracted capacity); the paperclip at its top-right corner; click it | The box's evidence popover: label, place (tab › step › section), Register (CSV), "No evidence yet", Note / Link / File, Attach, Sign off (super admin) | `test_click_tour.py` (open/close); `test_evidence.py` |
| EV-02 | Attach | EV-01 | Note, type, Attach; Link, URL, Attach | Two items with who and when and "value then"; the paperclip shows 2 | `test_evidence.py::test_attach_evidence_sign_off_and_download_the_register` |
| EV-03 | Sign-off | EV-02 | "Sign off this value"; then change the box | The paperclip turns green; after the change amber ("signed off at an older value", "Now in the box: …") | `test_evidence.py` |
| EV-04 | Register | EV-02 | Register (CSV) | A CSV with Tab, Box, Place, Value at attach, Kind, Name/URL/note, By, When, Signed off | `test_evidence.py`; `tools/check_evidence.mjs` |
| EV-05 | Remove | EV-02 | The bin icon on an item | The item goes; the count drops | `test_evidence.py` |
| TM-01 | Send icon | View as: Tender manager | Hover a box; click the send icon (right of the paperclip) | The thread popover: "# label", place, "Now in the box", "No messages yet", the composer; Send disabled until typed | `test_click_tour.py` (open/close); `test_team_mode.py` |
| TM-02 | Ping | TM-01 | Type "@fin", Enter, a question, Send | "@finance.desk" suggested with "covers this tab"; the message in the thread with the handle highlighted | `test_team_mode.py::test_ping_a_teammate_for_a_box_and_fill_in_the_answer` |
| TM-03 | Answer | TM-02 | View as: Finance desk; Messages | The ping is unread (badge on Messages); "Open field" opens the tab, step and thread; reply with a value 320 | `test_team_mode.py` |
| TM-04 | Fill in | TM-03 | View as: Tender manager; open the reply; "Fill in" | The box takes 320 and flashes | `test_team_mode.py` |
| TM-05 | Team setup edit | View as: Tender manager | Team setup; change a title; Save | "Saved" on the row; a non-super-admin sees the table read-only | `test_team_mode.py` |
| TM-06 | Icon mode | — | Team setup › send icons: On hover | Icons show only on the box under the mouse and on boxes with messages | manual only |
| TA-01 | Assign (needs a saved bid) | SECI, a saved bid open, View as: Tender manager | On Design, the assign button beside the solar capex; team Procurement is preselected; request; Send | The box gets a team chip; the Team panel counts it | `test_team.py::test_assign_answer_accept_and_return` |
| TA-02 | Assign a format and a condition | TA-01 | Bid forms › 7.1 › assign to Finance; Conditions › assign one to Legal | Chips on the format and the condition | `test_team.py` |
| TA-03 | Answer as each desk | TA-02 | View as Procurement: value 3.6 + note; Finance: upload a signed PDF (the filled letter is offered to print); Legal: a note | Each card loses its Send after the answer | `test_team.py` |
| TA-04 | Accept / return | TA-03 | View as Tender manager: Accept the capex and the signed copy; Return the legal reading with a note; Legal answers again; Accept | Each acceptance is a new saved version (v+1, v+2); the capex box reads 3.6; the signed copy is linked on 7.1; the clarification shows on the condition | `test_team.py` |
| TA-05 | Demo outbox | TA-04 | Team panel › Outbox | "Email in demo mode"; every mail written to the seats' .example addresses | `test_team.py` |

## 4. What-if analysis (standalone tab)

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| WI-01 | Tab | — | Open What-if analysis | The verdict banner, returns at the bid tariff (equity, project and lender's IRR, DSCR, project cost, LCOE, year-1 supply, payback), the tariff for the target IRR, the IRR-vs-tariff chart and a week of dispatch | `test_click_tour.py::test_what_if_tab`; `test_demo2.py::test_what_if` |
| WI-02 | Bid at this tariff | WI-01 | Click "Bid at this tariff" | The equity IRR becomes the 14% target; "Meets the target" | `test_click_tour.py`; `test_demo2.py::test_what_if` |
| WI-03 | Tender compliance | WI-01 | Set Battery power to 0, Enter | The verdict turns red; the storage check fails; Reset inputs restores it | `test_demo2.py::test_what_if` |
| WI-04 | Compute the levers | WI-01 | Set the tariff you want to quote; "Compute the levers" (about 10 s) | A table of 8+ levers: now, one step, tariff up/down, ₹/kWh per step, the move alone to reach the target, Apply where reachable; the button reads "Levers up to date"; a change makes it "Recompute" | `test_click_tour.py`; model: `tools/check_whatif.mjs` |
| WI-05 | Apply a lever | WI-04 | Apply on a reachable row | The case's input moves to the reach value; the returns follow; the levers are stale | manual only (`whatif/levers.js withLever` is covered by `tools/check_whatif.mjs`) |
| WI-06 | Trace | WI-01 | Click Project IRR; follow a reference; Back; "Every input it rests on"; Escape | The traceable model opens at Project IRR with its formula; references open their line; the inputs list | `test_click_tour.py`; `test_demo2.py::test_traceable_model_round_the_clock` |
| WI-07 | Generation drill-down | WI-01 | Trace › find "Delivered to the procurer" › year 1 › Solar generation › June › 21 June | MW × CUF × 365 × 24; twelve months adding to the year; 96 blocks of the day; 35,040 blocks | `test_demo2.py::test_generation_traces_to_15_minutes` |
| WI-08 | Studios | WI-01 | Solar studio / Wind studio under "Your case" | The studios open and Apply writes the cost | manual only on this tab (same components as SE-09/10) |
| WI-09 | Reset inputs | WI-01 | Reset inputs | The default case returns; the levers table says the case changed | `test_click_tour.py` |

## 5. Round the Clock

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| RT-01 | Chapters | — | Click Energy needed, Supply type, DFR, Solar, Wind, Battery storage | Each chapter page opens with its heading and summary on the rail | `test_click_tour.py::test_round_the_clock_chapters` |
| RT-02 | Separate sites | RT-01 Battery | "Separate sites" / "One site" | Separate sites: nothing to enter; Battery at the solar site / at the wind site; "x% at the wind site decided by the optimizer"; the finance stats recompute | `test_click_tour.py`; `test_round_the_clock.py::test_rtc_separate_sites` |
| RT-03 | Finance chapter | — | Scroll to the finance stats under the chapters | Tariff for the target IRR, equity IRR, DSCR, LCOE; clicking a stat opens the trace | `test_click_tour.py`; `test_demo2.py::test_traceable_model_round_the_clock` |
| RT-04 | Repayment | RT-03 | Repayment: Sculpted / Balloon / Step-up / Equal | Target DSCR, Balloon share, Principal step-up appear in turn; the DSCR line in the stats names the method | `test_click_tour.py` (sculpted) |
| RT-05 | Construction view | RT-03 | Construction months 0 → 18 | A new section "Construction: 18 months, month by month": cost before IDC, interest during construction, debt at COD, equity put in, the monthly chart; back to 0 removes it | `test_click_tour.py` |
| RT-06 | Excel download | RT-03 | "Download financial model (Excel)" | `Round_the_clock_..._financial_model.xlsx`; Cover, Live model with formulas; the tariff and IRR match | `test_round_the_clock.py::test_rtc_workbook`, `::test_rtc_separate_sites` |
| RT-07 | Optimize (long) | — | "Optimize the bid" | The theatre: the tariff map over solar/wind mixes, HiGHS on the engine, then the answer; 1–3 min | manual only in the browser (`tests/engine/test_rtc_lp.py` covers the LP; `tools/check_rtc_engine.mjs` the search) |
| RT-08 | Save | RT-03 | Save (enabled when the model is settled) | The save dialog; a saved scenario in the library under Round the Clock | manual only |

## 6. BESS Tender

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| BE-01 | Chapters | — | Tender, Requirements, Battery, Costs, Finance | Each opens; "Optimize the bid" offered | `test_click_tour.py::test_bess_cfd_recent_team` |
| BE-02 | Read an RfS (long) | — | Tender chapter: upload a BESS RfS (PDF/Word); parser Auto | "Read … with …: n of m requirements found"; the Requirements chapter with each value's page and clause | `test_tender_to_bid.py::test_bess_tender_goes_to_the_bess_tab` (hand-off); the reader: `tests/engine/test_extraction.py::test_rules_mode_reads_bess_sample` |
| BE-03 | Optimize | BE-01 | Optimize the bid (seconds) | The strategy map (oversize × augmentation interval), the answer in ₹ lakh/MW/month, the capacity trajectory, compliance, the finance table | manual only in the browser (`tools/check_bess_engine.mjs` checks the engine) |
| BE-04 | Save / Reset | — | Save; Reset | The dialog; the defaults | manual only |

## 7. CfD Bid

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| CF-01 | Steps | — | How it works, Worked example, Tender terms, Plant and sourcing, Costs and finance, Operations, Bid and financials | Each opens; Next walks them | `test_click_tour.py::test_bess_cfd_recent_team` |
| CF-02 | Worked example | — | 50 / 100 / 150 MW; change the strike price | The example's answer, commitments, phases, money, week and year follow the choice | `test_click_tour.py` (100 MW) |
| CF-03 | Tender terms | — | Read the terms | Every term with its document and page quote; the RfS amounts | `test_click_tour.py` (count); `tests/engine/test_cfd_terms.py` (quotes word for word, needs the CfD documents) |
| CF-04 | Fill up | — | Plant and sourcing › Fill up for me please | "0 inputs needed"; Optimise own RE enabled | `test_click_tour.py` |
| CF-05 | Optimise own RE (long) | CF-04 | Optimise own RE (1–3 min, Stop available) | Solar/wind sizes that give the lowest strike price with every day's supply met | manual only (`tools/check_cfd_model.mjs` checks the model) |
| CF-06 | Bid and financials | CF-04 | Step 7 | The strike price in ₹/kWh, the statements, the pool; Download the Excel | `test_click_tour.py` (₹ shown); Excel: `tools/demo_run.py` |

## 8. Recent tenders

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| RC-01 | SECI results | — | Open Recent tenders; expand "bidders not awarded" on a card | 8+ result cards (e.g. SECI Wind XIX: K.P. Energy Limited, ₹3.67), each with winners, others, sources; the tariff chart | `test_click_tour.py`; `test_demo2.py::test_recent_tenders_and_cerc_upload`; `tools/check_market.mjs` |
| RC-02 | CERC order upload (long) | — | Upload a CERC tariff-adoption order PDF | A card with petition, date, petitioner, capacity and the winners, each with its page quote; edit; "Save as checked"; delete | `test_demo2.py::test_recent_tenders_and_cerc_upload` (a synthetic order); `tests/engine/test_cerc_order.py` |

## 9. Saved scenarios (library)

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| SC-01 | List | A saved bid | Saved scenarios | The list by module, name, version, Open | `test_seci_tab.py::test_bid_on_screen` (`/scenarios?module=seci`) |
| SC-02 | Versions | SE-28 twice | Open a scenario's page | The versions with their notes; the summary of each | manual only |
| SC-03 | Compare | Two saved bids | Compare | Side by side: sizes, tariff, contracted MW | manual only |

## 10. MCP connector (Claude)

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| MC-01 | Handshake | `MCP_TOKEN` set on the server; HTTPS reachable | `curl -X POST https://<site>/api/mcp/<token>` with the initialize body (docs/MCP.md §4) | `serverInfo.name = tenderos`; a wrong token 404; a GET 405 | `test_mcp.py::test_mcp_server` (needs `MCP_TOKEN`); `tools/check_mcp.mjs` |
| MC-02 | In Claude | MC-01; the connector added with "No sign-in" | Ask: "What are the Peak Hours after the amendments?" | An answer citing the document and page with a link to the PDF page (`tender_lookup`) | manual only |
| MC-03 | A bid in chat (long) | MC-02 | "Use the benchmarks, size a 300 MW bid and give me the financials" | `use_benchmarks`, `run_optimizer` (1–3 min; `sizing_status` while running), `get_results`, `get_financials`; the numbers are the SECI tab's | manual only (`tools/check_mcp.mjs` runs the same session on a stand-in engine) |
| MC-04 | What-if in chat | MC-02 | "What if we bid 300 MW at ₹7?" | `check_bid` answers instantly with IRRs, DSCR, floors met | `test_mcp.py` |

## 11. Zones (enterprise)

| ID | Screen | Preconditions | Steps | Expected | Automated |
| --- | --- | --- | --- | --- | --- |
| ZN-01 | Core zone | An instance started with `TENDEROS_ZONE=core` | Read the badge; upload a tender; open the bid agent; size a plant | "Core zone"; the tender read routes answer 403 ("Not in the core zone…"); the voice agent is refused (403); sizing works | instance check only, run once (voice agent 403, tender-reading routes 403, sizing allowed); not in the suites |
| ZN-02 | Patch tool | A bundle built with `deploy/enterprise/build-bundle.sh` | `tenderos-patch verify <bundle>` | A good bundle passes; a tampered file, a stray file or another key's signature fails | `tests/deploy/test_patch_tool.py` (verify path only; apply/rollback need a Docker daemon: manual only) |
