# SECI RTC tender tab

The **SECI RTC tender** tab takes one tender from its documents to a priced, sized bid and a
filled bid pack. The tender is SECI's FDRE-RTC-V: 1,000 MW of firm and dispatchable
round-the-clock power from ISTS-connected RE projects with storage, RfS No.
SECI/C&P/IPP/13/0020/25-26 dated 10.03.2026. It was issued as RTC-TM-V (thermal mimic);
Amendment-03 (25.06.2026) renamed it and rewrote its supply profile.

A **bid agent**, a GPT-Live voice conversation, can walk the bidder through the tab from start to
finish and works the bid on screen.

## The documents

The six documents are in `web/public/tenders/seci-rtc-tm-v/`:

* the RfS (139 pages);
* Amendment-01;
* Amendment-02;
* Clarifications-01;
* Amendment-03 (15 pages; it amends the RfS and the PPA);
* the Standard PSA.

Where an amendment or a clarification changes the RfS, the amended rule applies. The RfS's
original wording is kept beside each condition, under "RfS as issued".

The tender pack `web/src/seci/seci-rtc-tm-v.json` holds the following, each item with its
document, page and quote:

* 63 bid conditions, in force after the amendments. 30 of them are stated only in the RfS, for
  example the fees, the EMD and PBG instruments, liquidity, who may bid, the e-Reverse Auction and
  its 80% cap, success charges, PPA signing and Financial Closure.
* The RfS's original wording for 26 conditions.
* 31 amendment changes, each clause as it was and as it is now (8 from Amendment-03: the name,
  connectivity at bid submission, the DFR, offtake, excess power, the Solar and Remaining Hours
  definitions and the penalty illustration).
* 9 clarifications.
* 14 steps of the bid process, from registration on the portal to the PPA.
* 20 bid formats (Section 7 and the annexures signed with the bid), with 221 blanks. Each blank
  carries the RfS's words around it and the page.
* 19 points to raise with SECI, where the documents conflict or are unclear. Each names the page
  to cite. For example:
  * clause 34.1 sends the technology declaration to Format 7.9, which is the Integrity Pact;
  * the PBG counts storage in MW in one place and in MWh in another.

`tests/test_seci_pack.py` (part of `make test`) checks that every one of these quotes is printed
on the page it cites, plus checks on the conditions and formats themselves.

Three items the four smaller documents left open are now answered by the RfS:

* **PPA term:** 25 years from the SCSD (cl. 20.2).
* **Ceiling tariff:** none is stated. SECI may annul the process if the tariff discovered is high
  (cl. 41.2).
* **Bid deadline:** as per the NIT on the ISN-ETS portal.

Clause 34.3 (technical eligibility) stays **unclear**. Amendment-02 marks it "Not used", but other
clauses still refer to it.

## The steps

| Step | What it shows | Code |
| --- | --- | --- |
| Documents | The documents, how the bid goes, the amendment trail (filter by amendment), SECI's clarifications and the points to raise with SECI; each quote links to its page in the PDF | `DocumentsStep.jsx` |
| Conditions | The 63 conditions grouped, each marked as issued, amended, removed or unclear, with the RfS's original wording | `ConditionsStep.jsx` |
| What you bid | The contracted MW (50 to 500), the supply profile (Amendment-03, or the terms before it to compare) and the Solar Hours, the Peak Hours plan, the shortfall plan, the PPA date and the dates that follow from it (Amendment-02: SCSD 24 months after the PPA, Financial Closure 6 months before the SCSD, latest start SCSD + 6 months), and the EMD, PBG and net worth on the sized plant | `BidStep.jsx`, `terms.js` |
| Supply sources | Solar, wind, biomass and the mandatory battery, with costs (Tender to Bid's step) | `../bid/SourcesStep.jsx` |
| Size | HiGHS sizes the least-tariff plant against every block's floor: Peak, Solar and Remaining Hours | `../bid/SizeStep.jsx`, `../bid/useSizing.js` |
| Financials | The tariff for the target equity IRR, the equity and project IRR, **your quote** checked against the target, and the Excel workbook with its Live model tab (every cell a formula) | `../bid/FinanceStep.jsx`, `../bid/QuoteCheck.jsx`, `web/lib/liveModel.js` |
| Bid forms | The particulars, asked once; every RfS format this bid needs, filled and reviewed one by one beside the RfS page; each format as its full letter in the RfS wording, editable in place; the checks against the tender; the bid pack as Word; the letters as Word and PDF | `BidForms.jsx`, `LetterView.jsx`, `forms.js`, `formats.js`, `letters/`, `POST /api/seci/forms`, `POST /api/seci/letters`, `POST /api/bid/document/pdf` |

## How the tender's supply rules reach the engine

`seciTerms(settings)` (`web/src/seci/terms.js`) turns the tender and the bidder's planning
choices into terms shaped like Tender to Bid's terms. The sizing, the finance and the Excel export
are the same code as in Tender to Bid.

Under Amendment-03 (cl. 8.1.a, the default `profile: "amd3"`) the supply rules are three
time-block floors on the contracted capacity, all with `basis: "block"`:

| Rule | Hours | Floor | Most the buyer takes |
| --- | --- | --- | --- |
| Peak | `hours: "peak"` | 90% | the contract |
| Solar Hours | `hours: "solar"`: the Solar Hours that are not Peak Hours | 50% | 60% (`max: 0.6`) |
| Remaining Hours | `hours: "remaining"`: neither Solar nor Peak Hours | 70% | the contract |

`profile: "amd1"` gives the terms before Amendment-03, to compare: 90% in the Peak Hours and 70%
in every other block (`hours: "offpeak"`).

**Solar Hours.** GRID-INDIA defines them by State under the GNA Regulations (RfS cl. 42.66 as
amended); the tender does not fix them. The model assumes 08:00 to 18:00 (`model.solarHours` in the
pack) until the bidder enters the project State's hours. The sizing request carries them as
`solarMask`. An hour the buyer picks as a Peak Hour is held to 90%, even inside the Solar Hours.

**The Solar Hours excess.** Above 60% in a Solar Hour, the power goes first to the Buying Entity,
day-ahead, at 50% of the tariff (cl. 8.3 as amended); only if it declines may it be sold to a
third party or the exchange. The rule carries `excessTariffShare: 0.5`. With market sales on, the
model takes the buyer as accepting whenever the market price is above half the tariff, so each
MWh sold in those hours earns `min(market price, 0.5 × tariff)`:

* in the sizing LP (`rtc_lp.solve`) the sale's value in those hours is capped at that;
* the lifetime rows split the sales into `exportMwh` (the market) and `buyerExcessMwh` (the buyer),
  with `buyerExcessShare: 0.5`;
* the finance adds `buyerRevenue = buyerExcessMWh × 0.5 × the year's tariff`;
* the Live model has the same rows as formulas ("Of which the buyer takes", "Solar Hours excess sold
  to the buyer").

With market sales off, nothing is sold: the excess is curtailed.

**Peak Hours.** The Buying Entity picks any 6 hours between 18:00 and 10:00, and names them only a
day ahead. The bidder chooses one of two plans:

* **Any 6 of the 16 hours (the default):** all 16 hours are held to 90%, so the plant is safe
  whichever hours are picked.
* **Evening only:** 18:00 to 24:00 only, which is cheaper but short whenever a morning hour is
  picked.

**Shortfall.** The bidder chooses one of two plans:

* **Pay the penalty (the default):** each block's floor gets a shortfall variable, priced at
  1.5 × the tariff. HiGHS then weighs each missing MWh against the extra plant that would cover it.
* **Meet every block:** the floors are hard.

The engine side is in `engine/sizing/rtc_lp.py`:

* `block_rules` and `penalty_mult` set up the floors; `rule_hours` gives each rule's hours from
  `peakMask` and `solarMask`, and a rule's `max` caps the delivery target in its hours;
* the per-hour rows are `delivered + shortfall ≥ floor`;
* `rule_outcome` reports the hours met and the MWh short.

The finance charges the block penalty each year as `blockPenalty`, and the Live model has the same
rows as Excel formulas.

Excess power above the contracted capacity may be sold (PSA 2.11.5).

## Losses to the billing meter

The SECI tab sizes against the 220 kV GSS billing meter, where the tender counts the supply. Supply
sources → *Losses to the billing meter* is the Round the clock tab's loss chain
(`rtc/LossChain.jsx`, through `bid/BidLosses.jsx`), one technology at a time:

| Technology | Stages to the 33 kV main bus bar | Where the CUF is measured (default) | Applied by default |
| --- | --- | --- | --- |
| Solar | DC losses, inverters, inverter-duty transformers (LV/33 kV), 33 kV collection cables | inverter output (LV AC) | IDT 1%, cables 0.5% |
| Wind | WTG step-up transformers (0.69/33 kV), 33 kV collection cables | WTG terminals | WTG transformer 1%, cables 0.5% |
| Battery | PCS, MV transformers (LV/33 kV), 33 kV feeders, each way | round trip quoted at the PCS output | MV transformer 0.8%, feeders 0.3%, both ways |
| All | 33/220 kV power transformer, 220 kV line to the GSS | | 0.4%, 0.5% |

* The stages above the measuring point are already in the CUF; the ones below are applied. Pick
  another point in the chain to change that.
* `lpPayload` (`bid/model.js`) sends HiGHS the profiles at the 33 kV bus (the CUF times the
  stages after its point), the battery's round trip at the bus (`rteAtBus`), and the transformer
  and line losses. `rtc_lp.py` dispatches at the bus and bills, checks the floors and sells at
  the meter, as the Round the clock tab does.
* The 15-minute dispatch (`engine/sizing/dispatch15.py`) does the same. In its files, the contract,
  delivery, sales and battery discharge are at the meter; generation, charging and curtailment are
  at the bus; and the transformer and line losses get their own column.
* The hourly dispatch on the Size step shows delivery at the meter (`hourlyAtMeter`), with the
  hour's transformer and line losses in its tooltip.
* Tender to Bid has no losses (`state.losses` is null) until the chain is added there.
* A bid saved before the losses existed opens with the defaults; size it again.

**Solar in MWac and MWp.** The RfS contracts AC capacity (cl. 42.11) and allows larger DC arrays.

* Solar capex and O&M are entered per MWac. The card shows them per MWp (÷ DC:AC).
* The DC:AC ratio is always asked, even with an uploaded profile, because it turns MWac into MWp.
* The sized plant, the checklist, the agent and Format 7.1 give solar as MWac with its MWp, for
  example "511 MWac (715 MWp DC)".

## The dispatch, hour by hour and for 25 years

**Hover an hour** of the year-1 dispatch chart (Size step) and the tooltip is a see-through Sankey
of that hour (`web/src/bid/hourSankey.js`). It reads left to right:

1. **Sources:** solar, wind and battery discharge.
2. **Where the energy went:** to the PPA, battery charging, sold, curtailed, and the transformer
   and line losses.
3. **The hour's tender condition:**
   * the delivery that meets the hour's floor (Peak 90%, Solar Hours 50%, Remaining Hours 70%;
     off-peak 70% before Amendment-03);
   * any delivery above the floor;
   * any shortfall, as a dashed box, with the 1.5× tariff penalty it costs.

The header gives the floor, the delivery and the verdict. `tools/check_seci.mjs` checks the
arithmetic: every MW from a source lands somewhere; the losses node equals the hour's losses; and
met + above = delivered.

**The 25-year dispatch** (Size step 4.5) dispatches every PPA year in 15-minute blocks, with the
time-block floors in every block and the shortfall priced at 1.5× the tariff. **25-year dispatch
(Excel)** downloads it as one workbook: a summary by year, the months, and every year hour by hour.
The ZIP has the 15-minute rows. See `docs/TENDER_TO_BID.md`, "15-minute dispatch, every PPA year".

## Team sharing

The tender team shares the saved bid. Anyone on the team can **Assign** a data point to a team or
a person:

* a particular or a format's blank;
* a source's cost (to procurement);
* a financing input (to finance);
* a format, for its signed copy (to finance);
* a tender condition, for a clarification (to legal).

The **Team** button (top of the tab) opens the panel: what is waiting for you, answers to accept,
every assignment with its history, and the team. The super admin accepts an answer into the bid as
a new saved version, or returns it with a note. Demo deployments switch between the team's seats
with "View as". See `docs/TEAM.md`.

## Your quote against the target IRR

`quotedReturns(state, terms, tariff)` (`web/src/bid/quote.js`) runs the financial model of the
sized plant twice:

* once solved for the target equity IRR, which gives the tariff the target needs;
* once at the tariff the bidder will quote, which gives the equity and project IRR that tariff
  earns.

A quote more than half a paisa below the target tariff is **warned**. The warning gives:

* how far below the target the quote is;
* the equity IRR and the project IRR at the quote;
* "the equity loses money at this tariff" when the equity IRR is zero or less, or no IRR exists.

The quote is shown and checked in three places:

* on Financials, under "Your quote";
* under the tariff in the bid forms, where it is the same value;
* in the "Tariff quoted" check.

The bid agent's `check_tariff` gives the same figures. Tender to Bid's Financials has the same
"Your quote" panel.

## The bid forms

**Particulars.** The bid forms start with the particulars, asked once. They are:

* the bidder, consortium or single company, and the address;
* the signatory, the date on the letters and the place;
* the tariff;
* the EMD instrument;
* the substation and its SCD, and connectivity;
* where the battery sits;
* net worth and experience;
* whether a common shareholder holds 10–26% in another bidder.

**Formats.** Each RfS format is then a page of its own. `formats.js` decides whether this bid needs
the format:

* Format 7.2 and Format 7.5 only for a consortium;
* only the EMD format of the chosen instrument (7.3A, 7.3B or 7.3C);
* 7.3D to 7.3F after the award;
* 7.8A only with a common shareholder;
* Annexure-I only when another entity's connectivity is used.

The formats are grouped as submitted: Envelope I, Envelope II, after the award, and not needed.

**Where each blank's value comes from:**

* **Your bid:** the contracted MW, the installed solar, wind and storage, the EMD and PBG amounts,
  and the RfS's number, date and title. These are not editable on the format.
* **Your particulars:** editable on any format; an edit changes every format that uses it.
* **This format:** a blank only this format has, such as a reference number, the board meeting
  date or the turnover.
* **Consortium only:** for a single company, a consortium member's blanks show "Not applicable
  (single company)" and are not counted as empty. These are Format 7.4's equity share, other
  members, Consortium Agreement signatory and date, and Format 7.6's per-member net worth
  (`when: "consortium"` in the pack).

**Beside the blanks:** each blank shows the RfS's words around it. Clicking them shows that page of
the RfS beside the blanks. The format also lists what to enclose, with a tick for each.

**Review.** "Mark reviewed" records the values reviewed. A later edit shows the format as "changed
since review".

**The bid pack.** `POST /api/seci/forms` writes the Word bid pack with `web/lib/docx.js`. It
contains:

* the offer;
* the dates;
* the particulars;
* the checks with their sources;
* the documents read;
* every format this bid needs, with its signer, paper, envelope and RfS pages, every blank as
  filled, the enclosures and whether it was reviewed.

**The letters.** Each format has two views: *Blanks beside the RfS* and *The letter*. The letter is
the format as SECI prints it in the RfS, with the blanks filled.

* The wording is one template per format (`web/src/seci/letters/<id>.js`), taken from the RfS PDF
  (`tools/build_seci_letters.py` drafts one from the RfS pages; Annexure-B was generated and
  word-checked against pp. 116–124). A template marks each blank as `{{key}}` (a field of the
  format), with `:num`, `:words` and `:crore` for amounts, and the RfS's alternatives as
  `[if key=Option]` paragraphs, `[[key=Option|text]]` phrases and `[only consortium|company]`
  paragraphs. The syntax is described in `web/src/seci/letters/index.js`.
* The values are the blanks' values (`blankValue`): from the sizing, the particulars or typed.
  They show as chips. Change a value in the blanks and every letter follows.
* The alternatives the bidder did not choose are struck out, as the RfS asks ("strike out
  whichever is not applicable"). Paragraphs for a consortium are left out of a single company's
  letter, and the other way round.
* **Editing in place.** Click a paragraph to change its wording. The edit is kept with the bid
  (`state.letters[format][paragraph]`), with the value chips still linked. The paragraph is marked
  "Your wording, changed from the RfS" and can be reverted. An edit counts as a change to the
  format, so a reviewed format shows "changed since review". Headings, the RfS's notes and tables
  are not editable. This is paragraph editing, not a word processor: there are no styles, tracked
  changes or comments, and the Word file is the place for layout changes.
* **Word and PDF.** Each letter downloads as Word (`POST /api/seci/letters`, `web/lib/docx.js`:
  Times New Roman, struck runs, a page per letter) and PDF (`POST /api/bid/document/pdf`, the
  engine lays the letter's HTML out on A4 with PyMuPDF's Story, `engine/documents/pdf.py`). *All
  letters* gives every format this bid needs in one file. Letters on letterhead carry the bidder's
  name and address at the top; the others name the stamp paper they go on.
* **Saved.** *Save* (top of the tab) keeps the bid in the scenario library (module `seci`): the
  inputs, the particulars, the blanks, the reviews and the letter edits. *Open* in the library
  brings it back to this tab.

Check each letter against its RfS pages before signing: the templates are the RfS text as
extracted, and `tools/check_seci_letters.mjs` checks that every blank is placed, not that every
word matches. Blanks that only a consortium or another bid would need (Format 7.2, 7.5 and parts of
7.3B–F, such as witness lines and SECI's own entries) may stay empty in the letter as dashes.

**Checks.** `bidChecks` checks the bid against the tender:

* the capacity band;
* the tariff against the target IRR;
* the mandatory storage and its co-location;
* the substation SCD (by 30.06.2028);
* the net worth against the sized plant;
* the experience, where cl. 34.3 still applies;
* the EMD and PBG amounts;
* the PPA dates;
* how many formats are reviewed.

## The bid agent (GPT-Live)

The agent is a voice conversation with OpenAI's `gpt-live-1`. A backend model works the bid on
screen while it talks; this is GPT-Live's Responses delegation, with `OPENAI_LIVE_BACKEND_MODEL`,
default `gpt-6-luna`.

**How a session starts:**

1. The browser makes a WebRTC offer with the microphone.
2. `POST /api/seci/live` creates the session with OpenAI (`POST /v1/live/sessions`). It uses the
   server's `OPENAI_API_KEY`, which never reaches the browser.
3. The route returns the answer.
4. Audio flows over WebRTC. Events flow on the data channel.

**Tools.** The backend's function tools (`web/src/seci/agent.js`, `AGENT_TOOLS`) run in the
browser, against the same state the screen shows:

| Tool | Does |
| --- | --- |
| `get_status` | The bid as it stands: inputs missing, sizing, financials, the quote, forms |
| `tender_brief`, `tender_lookup` | The key conditions; a search of conditions, amendments and clarifications, each with document, page and quote |
| `next_question` | The next input of the guided exercise, in the guide's order, with its current value and benchmark; `keep` / `keep_rest` accept values as they stand |
| `list_inputs`, `set_input` | Any input on screen (bid, planning choices, sources on or off, sizes, every source and finance input, market sale, separate sites, particulars and format blanks); spoken values are read and range-checked; a change that affects the sizing clears it |
| `use_benchmarks` | Fill empty inputs with industry benchmarks |
| `go_to_step` | Show a step |
| `run_optimizer`, `stop_optimizer` | Size with HiGHS (again) and return the result |
| `get_results`, `get_financials` | The plant, floors met, shortfall, EMD, PBG, net worth, dates; tariff, equity and project IRR, DSCR, penalties |
| `check_tariff` | Equity and project IRR at a quoted tariff, with the warning; records it as the quote |
| `review_bid_forms`, `open_format`, `mark_format_reviewed` | The formats this bid needs, a format's blanks with their input keys, and the bidder's review (only on their word) |
| `show_chart` | Opens a chart in the agent's column, with a summary the agent describes; it uses it when asked to show or compare something, and on its own when a picture explains better |

**Charts.** `web/src/seci/charts.js` draws every chart from the bid itself, never from numbers
the model says:

* **Peak Hours:** the 24-hour day, the 18:00–10:00 window, the floor in each hour under your plan,
  and, once sized, the average and worst-hour delivery.
* **A day:** the sized plant hour by hour, by source and battery, for the year or one month.
* **Months:** delivered energy, the shortfall against the floors, and surplus sold.
* **IRR vs tariff:** equity and project IRR against the tariff, with the target and your quote.
* **Cash flows:** revenue, operating cost, penalties, debt service and cash to equity.
* **Money:** capex by source, EMD, PBG, net worth, equity and debt.

The chart opens inside the agent's column and can be enlarged. The same six charts are buttons on
the panel, so they also work without talking. On a wide screen the panel docks as a column and the
page makes room for it.

**Rules for the backend model.** Its instructions (`BACKEND_INSTRUCTIONS`) are:

* tender facts come only from the lookup tools, with document and page;
* numbers come only from the model;
* inputs change only through `set_input` with the value the user gave.

`LiveEvents` handles the session's events:

* transcripts;
* the backend's function calls, each answered with `response.item.create`;
* `response.create` to continue.

**What it needs.** `GET /api/seci/live` says whether the server has a key; without one, the agent's
panel says how to set it up. The microphone needs HTTPS or localhost.

**Tested here** with a stand-in for OpenAI:

* the tools and the event loop (`tools/check_seci_agent.mjs`);
* the route and the browser's WebRTC offer (`tests/e2e/test_seci_tab.py`).

**Not yet tested:** a conversation with the real service, because no OpenAI key was available here.

## Tests

| Test | Command |
| --- | --- |
| The pack's quotes are on their pages, the gaps answered, the formats cover Section 7 | `make test` (`tests/test_seci_pack.py`) |
| Block floors in the LP: hard (fast), penalty (slow) | `make test`, `make test-slow` (`tests/engine/test_block_rules.py`) |
| Terms, LP payload, dates, money at stake, the quote against the target IRR, forms and formats, spoken numbers and dates, and the agent's script | `make check-web` (`tools/check_seci.mjs`) |
| The letter templates: every token is a field, every field placed or left out on purpose, every alternative a valid option; the demo bid's letters filled with no blank left, the right alternatives struck, an edit kept | `make check-web` (`tools/check_seci_letters.mjs`) |
| The PDF writer: a page per letter, long letters flow, ₹ written as Rs., no images or scripts | `make test` (`tests/engine/test_document_pdf.py`) |
| The bid agent's tools against a stand-in tab, the guided order, the tender lookup, every chart, the GPT-Live event loop | `make check-web` (`tools/check_seci_agent.mjs`) |
| The block penalty in the Live model, recalculated by LibreOffice | `make check-web` (`tools/check_live_model.mjs`) |
| In the browser: documents, the RfS, conditions with the RfS's wording, a bid through the tab's controls (bid, benchmarks, HiGHS sizing, money at stake, finance), a low quote warned with both IRRs, the particulars, a format filled and reviewed beside the RfS page, its letter with a paragraph changed and reverted, the letter and all letters as Word and PDF, the Word pack, the Excel workbook, the bid saved to the library and reopened with its letter edit; the six charts from the sized plant; the agent panel without a key and against a stand-in for OpenAI | `make e2e` (`tests/e2e/test_seci_tab.py`) |

## Access and settings

**Access.** An administrator grants the tab (`seciRtc`) per user. It uses the engine's `rtc` and
`bid` route families. The tender PDFs are served behind the login.

**The agent's settings.** They are environment variables of the web service, set in `.env`:

* `OPENAI_API_KEY`;
* `OPENAI_LIVE_BACKEND_MODEL`, optional;
* `OPENAI_LIVE_VOICE`, optional, default `marin`.
