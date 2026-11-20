# FDRE-X bid (SECI-FDRE-X)

The **FDRE-X Bid** tab works a bid for SECI's tender SECI-FDRE-X: RfS No.
SECI/C&P/IPP/13/0012/26-27 dated 07.10.2026, assured peak supply of 4,800 MWh (1,200 MW × 4 hours)
from ISTS-connected RE projects with energy storage, under a 25-year PPA with SECI.

Since 18 November 2026 the tab is built like the **SECI RTC tender** tab (`docs/SECI_RTC.md`): on the
Tender to Bid steps, with the plant sized by **HiGHS** (`engine/sizing/rtc_lp.py`) against the
tender's constraints, and the financial model, its formula workbook and the bid forms on that
sizing. Solar, wind and the storage are each sized by the optimizer or fixed by the bidder (the
switch on every source card of the Design step). The earlier tab, a fork of the CfD Bid tab with a
day-by-day simulation and a whole-MW search, is gone; its tender content (the conditions, the
documents, the bid formats and letters) is kept and reused.

## The steps

| Step | What it shows | Code |
| --- | --- | --- |
| 01 Tender & amendments | The four documents, the schedule, the twelve deleted rows of Amendment-01, the bid process, queries for SECI; and the amended PPA and PSA whole, in track changes (docs/SECI_RTC.md, "The amended document in track changes") | `DocumentsStep.jsx`, `pack.js`, `web/src/tender/` |
| 02 Bid conditions | 450 terms in eleven groups, each quoted on its page; the deleted ones beside what replaced them; fourteen conflicts | `ConditionsStep.jsx`, `terms.js` |
| 03 Bid inputs | The contracted MW (50 to 600); the buyer's four hours (the 4 costliest non-solar hours each day, or 18:00–22:00); the shortfall plan; bought power and its charges; connectivity in the solar hours; the PSM; the Effective Date and the dates from it; EMD, PBG, net worth and Success Charges on the sized plant | `BidInputs.jsx`, `bidTerms.js` |
| 04 Design | Solar, wind (on) and the storage, each "Optimizer sizes it" or "Size fixed", with costs and profiles (the RTC tab's profile library: upload or a built-in measured profile); the losses to the meter; the market sale of the surplus | `../bid/SourcesStep.jsx` |
| 05 Finance inputs | The financing, repayment, refinancing, working capital and the finance team's inputs | `../bid/FinanceInputsStep.jsx` |
| 06 Size | HiGHS: the least-tariff plant, the solver's log, the monthly rule year by year, the tender's conditions checked on the plant, a dispatch week | `../bid/SizeStep.jsx`, `../bid/useSizing.js`, `../bid/Checklist.jsx` |
| 07 Financial model | The tariff for the target equity IRR, the returns at your quote, the statements, the workbook with its Live model (every cell a formula) | `../bid/FinanceStep.jsx`, `../bid/exportModel.js`, `web/lib/liveModel.js` |
| 08 What-if | The sized bid in the instant What-if: change any size, cost, financing or FDRE-X setting and see the tariff the target IRR needs, the returns at the bid tariff, the tender checks and the tariff levers | `../whatif/WhatIfTab.jsx`, `../whatif/model.js` (`tender: "fdrex"`) |
| 09 Bid forms | The RfS's 23 formats filled from the bid and its sized plant | `BidForms.jsx`, `forms.js`, `formats.js`, `letters/` |

The bid forms read the bid through `formsView`, and their changes come back through the tab's
`setForms`, which applies them to that view (so a format's review is fingerprinted on what the
forms show) and drops the view's `inputs`.

The tariff the forms quote ("Use") and check against is the one the Financial model needs for the
target equity IRR (`formsModel` in `FdrexBidTab.jsx`, the same `runFinancialModel` as the Financial
model step), rounded up to the paisa: not HiGHS's screening tariff, which takes tax as linear and
on a bid that sells its surplus can sit well above it (₹7.163 against ₹6.501 on a 150 MW bid
selling on IEX GDAM). In the letters, the RfS's note on a blank ("[Insert name of the Bidder]",
"(enter name of the Promoter/Promoters)", "150 MW [Insert cumulative Contracted Capacity
proposed]") goes once the blank is filled and stays while it is empty (`segments` in
`web/src/seci/letters/index.js`, shared with the CfD letters); the net worth in words follows the
figure in the particulars.

The tab is `FdrexBidTab.jsx`; its state (the Tender to Bid state with `fdrex` settings), a saved
bid read back and the view the bid forms read (`formsView`: the contracted MW, the Effective Date,
the storage per MW and the sizes as the forms name them) are in `bidState.js`. This browser keeps
the bid under `tenderos.fdrex.bid.v2`; a bid saved by the earlier tab opens as a new bid.

## The tender as the sizing sees it (`bidTerms.js`)

`fdrexTerms(settings, prices)` gives the terms in the shape of `web/src/bid/tenderMap.js` (as
`seciTerms` does), from the figures of `terms.js` (`TENDER`), each tied there to its clause:

| | The sizing | Where |
| --- | --- | --- |
| Supply | The demand is the contracted MW in the buyer's four hours each day (`supplyMask`) and nothing in the others: 4 MWh per MW a day, 1 MWh per MW in each hour | RfS 8.1.a–c |
| The four hours | "The 4 costliest non-solar hours each day": each night, the 4 hours of 18:00–06:00 with the highest IEX DAM prices (`costliestHours` with the window as a parameter; most often 18:00–22:00, ₹7.98/kWh against ₹6.40 for the window); or "Evening 18:00–22:00". Until the prices load, the evening hours | RfS 8.1.a, PPA 4.4.1 |
| Shortfall | One monthly rule on the month's peak energy. "Pay the penalty beyond 10%": up to 10% short free (its revenue lost), the energy short beyond it at 1.5 × the tariff (`basis: "monthly"`, `tolerance: 0.1`, `penaltyMultiple: 1.5`); "Meet every month in full": a hard floor | RfS 8.2 |
| Bought power | Green market or bilateral, within 5% of each year's required energy, supplied directly or through the storage, at the hourly IEX GDAM price plus the charges to the meter (`purchase`); never resold | RfS 8.1.e |
| Sale | The surplus sold outside the buyer's hours, when *Sell the surplus on the exchange* is Yes on Bid inputs (3.3.1), on IEX GDAM, DAM or RTM, **only on the days the supply is met in full** (`saleOnMetDays`): a sale "while the supply commitments under the PPA remains unfulfilled" is a breach, penalised at 1.5 × that day's highest exchange rate on the volume sold; without solar-hour connectivity nothing is sold from 06:00 to 18:00 (`saleMask`). The RfS allows the sale (8.1.f); the PPA offers excess energy to SECI first and SECI buys it at the tariff only if the Buying Entity consents (9.3): the step cites both and the sale assumes SECI does not take it | RfS 8.1.f, 7.2; PPA 9.3 |
| PSM | ₹0.02/kWh off every bill when taken (`psmRsPerKwh`) | RfS 18.4 |
| SECI's charges | Success Charges ₹1 lakh per MW of Installed Capacity (the RE in MW and the storage in MWh), the RfS cost and the bid fee, with GST, in the project cost (`otherCapexCr`, worked out on the sized plant) | RfS 18.1, Bid Information Sheet |
| Sources | Solar, wind and the storage (mandatory); 50 to 600 MW; 25 years from the SCSD | RfS 3.1, 5.1, 20.2 |

## The sizing (`engine/sizing/rtc_lp.py`)

The LP gained four things for this tender, each optional so the other tabs are unchanged
(`tests/engine/test_fdrex_lp.py`):

* **Demand by hour**: the payload's `ctx.demand` carries the four hours (it always took an hourly series).
* **Purchases** (`purchase: { maxShare, prices, chargesRsPerKwh, escalation, capMw? }`): an hourly
  column per modelled year that adds to the energy at the bus, priced at the hourly price plus
  charges (carried to the years each modelled year stands for, escalating), within `maxShare` of
  the year's required energy; with a sale, a row keeps the sale to own RE. Results: `purchaseMu`
  per modelled year, `purchaseMwh` and `purchaseCostCr` per year, `purchase` hour by hour.
* **A sale mask** (`saleMask`): the export column is closed in the hours marked 0.
* **Sales only on the days the supply is met** (`saleOnMetDays`, with `ppaFirst`): a day is either
  met in full, and its surplus is sold at the market price, or it may fall short (within the month's
  free 10%) and sells nothing. Which days are which is a choice of the design, so it is searched:
  a row per day and modelled year (the day's delivery plus a slack covers the day's need); (1) every
  day met if it can be, a MWh of slack priced at 10 × the tariff; (2) the days still short are
  released (no row, no sale), and so are, a fifth of a year's days at a time, the days whose
  requirement costs more at the margin (the row's dual on 15% of the day's need) than their sales
  earn; (3) repeated from the new design while the tariff falls and more than 3% of the days would
  change. Each round is one interior-point solve and a Dinkelbach step. Sales are then worth the
  market price, not capped at the tariff (on a day met in full nothing sold could have gone to the
  PPA): until 20.11.2026 the LP valued a sale at most at the tariff and sold on short days as well,
  so it built too little for the dear evening hours and counted sales the RfS penalises. From
  starting prices of 6, 10 and 30 × the tariff the search ends within 0.1% of the same tariff
  (₹6.387 to ₹6.394 on a 150 MW bid); from a low price (1.2 ×) it starts with too few days met and
  stays 11% dearer, hence the 10. A sizing takes about two minutes. Results: `saleOnMetDays`,
  `saleDays` (per modelled year), and `saleDays` / `shortDays` in each year's row.
* **Monthly rules with a penalty and a free tolerance** (`basis: "monthly"`, `penaltyMultiple`,
  `tolerance`): one column per month and modelled year for the energy short beyond the tolerance,
  in the row `delivered + short ≥ (1 − tolerance) × target × demand`, worth −penaltyMultiple × the
  tariff in the objective (the Dinkelbach λ, as the block penalty). Results: `monthlyPenaltyMu`,
  and the yearly `monthlyPenaltyMwh`, also added to `blockShortfallMwh` so the finance charges it;
  a rule's outcome carries `tolerance`, `withinTolerance` and `penaltyMultiple`.

On the benchmark inputs this tab fills in (solar ₹4.0 cr/MWac at 25%, wind ₹6.5 cr/MW at 33%,
storage ₹0.80 cr/MWh, debt 75% at 9% for 18 years, 14% equity; the IEX year of 2 Nov 2025 to
18 Nov 2026), a 100 MW bid sizes in about two minutes to 10 MWac solar, 109 MW wind and
79 MW / 316 MWh of storage: wind blows at night when the four hours fall; the storage is under
4 MWh per MW because the free 10%, the bought 5% and the wind direct cover the rest. 260 days of
year 1 are met in full and sell (96 MU on IEX GDAM); 105 fall short within the free 10% and sell
nothing. HiGHS's tariff ₹6.954/kWh; the financial model's ₹7.111/kWh (the LP takes tax as linear;
the app prices the design exactly, and the bid forms quote its figure).

**Against the market** (`marketCase.js`, `MarketCheck.jsx`, on the Financial model step). The
auctions of the same product discovered ₹8.50 (SECI-FDRE-VI, Jan 2025), ₹6.74 (SJVN FDRE-4, Oct
2025), ₹6.27–6.28 (SECI-FDRE-VII, Feb 2026) and ₹5.99–6.00 (SECI-FDRE-IX, Aug 2026). The step shows
the bid's tariff beside them, and a bridge on a 100 MW bid, each step a run of this sizing priced by
the financial model:

| Step (cumulative) | Tariff | Change |
| --- | --- | --- |
| The Tender to Bid benchmarks: battery ₹1.20 cr/MWh, debt 70% at 9% for 15 years, equity IRR 14%, wind 33% at ₹6.5 cr/MW | ₹9.02 | |
| + battery ₹0.80 cr/MWh (CTUIL's benchmark, October 2026) | ₹7.51 | −1.51 |
| + debt 75% for 18 years (IREDA's norms): what the tab now fills in | ₹7.11 | −0.40 |
| + debt at 8.5% | ₹6.89 | −0.22 |
| + equity IRR 12% (an estimate) | ₹6.35 | −0.55 |
| + wind 37% CUF at ₹7.0 cr/MW (an estimate) | ₹5.80 | −0.55 |

So the model is at the auctions' level on the inputs the winners appear to use, and above it on
cautious ones; the battery price alone is ₹1.5. "Use the market case in this bid" puts the last
row's inputs in the bid (`applyMarketCase`) and opens Size. `fdrexTerms().benchmarks`
(`FDREX_BENCHMARKS`: battery ₹0.80 cr/MWh, debt 75% for 18 years) is what "Fill up for me please"
fills in place of Tender to Bid's (`fillBenchmarks(state, terms)` reads `terms.benchmarks`). No
winner has published its inputs: the last two steps are estimates and the step says so.

## The financial model

The shared engine on the LP's yearly energy (`web/src/bid/model.js` `opsFromLp`):

* revenue: the tariff on the energy supplied in the four hours, and the sale of the surplus at the
  hourly market price;
* `chargingCostCr` ← the purchases' cost (the row `charging`); `pxFeesCr` ← the PSM discount on the
  energy supplied (the row `pxFees`); `blockShortfallMWh` ← the energy short beyond the monthly
  10%, at `fin.blockPenaltyMultiple` (monthly rules now count) × the tariff;
* `costs.otherCapexCr` ← SECI's charges on the sized plant (`terms.otherCapexCr(sizes, MW)`).

The workbook (`/api/bid/model`, `buildModelWorkbook`) is the Tender to Bid workbook. The request
carries `chargingCostCr`, `pxFeesCr` and `otherCapexCr`, and the tender's names for those rows
(`terms.workbookLabels`: "Power bought (green market, bilateral)", "PSM discount", "Monthly
shortfall penalty", "SECI's charges …"); the operating-cost statement shows them when they are not
nil. Recalculated in LibreOffice, the Live model agreed with the app (₹8.8021, equity IRR 14.00%,
minimum DSCR 1.129 on the benchmark bid of the earlier price year and sale rule).

While HiGHS sizes the plant (from the Size, Design or Finance inputs step, or when the voice agent
runs the optimizer), the tab shows the Round-the-Clock tab's optimizer theatre (`../rtc/Theatre.jsx`):
a tariff surface over solar × wind builds on screen, HiGHS's live log scrolls beside it, and its
optimum is marked when it returns; then the Size step shows the result. The surface is
`surface.js`, built off the page's thread by `surface.worker.js`: solar 0–1.2 × and wind 0–1.75 ×
the contracted MW (a fixed size, or a source switched off, is one point), and at each mix the
tariff the target IRR needs with the best of three storage sizes (0.7, 0.85 and 1.0 × the MW at
the bid's hours), from the instant What-if dispatch (about 0.1 s a design, some 15 s for the 56
mixes). It is a picture of the design space; the bid's numbers come from HiGHS and the Financial
model. Cancel stops the sizing.

**The 15-minute dispatch** (Size step, *Run the 15-minute dispatch*; `engine/sizing/dispatch15.py`)
takes the sized plant and dispatches every PPA year in 96 blocks a day, one HiGHS LP a year, with
the sizing's FDRE-X rules: the contract only in the buyer's four hours; power bought (a column per
block at the bus, the hour's GDAM price plus the charges, escalating) within 5% of the year's
required energy and never resold; no sale where `saleMask` is 0; each month needs 90% of its
energy, and the energy short beyond it costs 1.5 × the tariff (a hard plan: the whole month).
With `saleOnMetDays` each year is solved twice: first with a sale worth at most the tariff, which
supplies the PPA as far as the plant can and so shows the days it meets in full; then with those
days held in full and their surplus sold at the block's market price, the other days selling
nothing (`saleDays`, `shortDays` in each year's summary). The
panel gives each year's worst month against the free 10%, the energy penalised beyond it, the power
bought and its share, curtailment and sales; the Excel workbook (Summary: *Bought MU*, *Bought share*,
*Bought cost*; every year hour by hour with *Bought power*) and the ZIP of 15-minute CSV files carry
them. Prices are the exchange's own 15-minute prices (below), for the sale and the purchases, so the
dispatch moves the buying and the selling to the cheaper and the dearer quarter-hours. On a 150 MW
bid (earlier price year) the 25 years take under a minute, and match the hourly sizing:
year 1 exactly at the free 10%, year 25 at 87.1% (0.79 MU penalised), 5% bought every year.
`tests/engine/test_fdrex_dispatch15.py`.

## The What-if (`web/src/whatif/model.js`)

The step embeds the What-if tab seeded from the sized bid (`whatIfFromBid`, which carries
`tender: "fdrex"`, the `fdrex` settings, the market's escalation and the sale market).
`runWhatIf` then takes the terms from `fdrexTerms` (with the IEX prices) and runs
`dispatchFdrexYear` for every PPA year, rule-based and instant:

* the demand is the contracted MW in the buyer's four hours (`supplyMask`), nothing else;
* solar and wind serve those hours, the battery charges from any surplus and discharges only in
  them (as in the LP, the storage serves the PPA and the sale is of the plant's own output);
* the surplus is sold up to the connection where `saleMask` allows, at the hourly price of the
  bid's market; once a night's buyer's hours are over it is sold before it charges the battery
  (the day refills it from output that cannot be sold);
* the power bought (GDAM + charges, escalating), within 5% of the year's energy: first the days a
  little short that have surplus to sell (buying the rest of the day's supply lets the day sell:
  while the energy's tariff and the day's sales come to more than the power costs, the days that
  gain most per MWh first); then each
  month's energy short beyond the free 10%, cheapest hours first, while it costs less than the
  tariff plus the penalty it saves; then any hour still short while it costs less than the tariff;
* the month's energy short beyond 10% is the penalised energy, at 1.5 × the tariff (none in "meet
  every month in full", where the check fails instead);
* on a day still short after the power bought, nothing is sold (`saleOnMetDays`): what the dispatch
  counted as sold that day is curtailed instead (`saleDays`, `shortDays`).

The finance is the shared engine with the same rows as the Financial model: the power bought
(`chargingCostCr`), the PSM discount (`pxFeesCr`), SECI's charges (`costs.otherCapexCr`) and the
sale at hourly prices (`surplusRevenueCr`). On the benchmark plant (10 MWac solar, 109 MW wind,
79 MW / 316 MWh) it needs ₹7.65/kWh against the Financial model's ₹7.11 on the same plant: about
8% dearer, as a rule-based dispatch is against the optimum once a day one MWh short sells nothing
(it meets 292 days against the optimiser's 260 by buying, and pays a penalty on 4.7 MU the
optimiser avoids). The screen shows the FDRE-X
plan (the buyer's hours, the shortfall plan, buying and its charges, solar-hour connectivity, the
PSM), the FDRE-X checks and stats, and the power bought and the PSM discount by year; an RTC case
is unchanged.

## The voice agent (`bidAgent.js`)

The SECI RTC tab's GPT-Live agent (`../seci/LiveAgent.jsx`, its `LiveEvents` loop), with this
tab's tools on the Tender to Bid state; `/api/seci/live` gives it this tab's instructions and tools
for `tab: "fdrex"`. Twenty tools: the tender (`tender_brief` with each paragraph's terms and pages,
`tender_lookup`, `list_conditions`, `amendment_changes`), the guided inputs (`next_question` in the
order MW, the buyer's hours, the shortfall plan, buying, its charges, solar-hour connectivity, the
PSM, the Effective Date, the benchmarks; `list_inputs`, `set_input` over 177 inputs,
`use_benchmarks`), `run_optimizer` (HiGHS through the tab's sizing), `get_results` (the plant, the
energy supplied, penalised, bought and sold, EMD, PBG, net worth, SECI's charges, the dates),
`get_financials`, `check_tariff` (records the quote), `what_if` (the instant What-if on changed
sizes, costs, IRR or tariff), `explain_generation`, and the bid forms (`review_bid_forms`,
`open_format`, `mark_format_reviewed`). Asked to change inputs and size the plant, it sets each
input on screen and runs the optimizer through the same path as the Size button, so the theatre
opens beside its panel (the panel stays on top). If the voice service's audio cannot connect in 20
seconds (a network that blocks WebRTC: UDP 3478 or TCP 443 to the voice servers), the panel says
so instead of waiting. The earlier tab's agent (`agent.js`) still serves
`/api/fdrex/agent` and lends its tender lookup.

## Where it is registered

Tab id and library module `fdrex` (`web/src/main.jsx`, `web/lib/tabs.js`, `web/lib/scenarios.js`).
The tab may call the engine's `rtc` and `bid` routes (the sizing, `lib/tabs.js`) and the bid
workbook route (`requireBidAccess`, `lib/tenders.js`). The routes under `/api/fdrex/` (forms,
letters) serve the bid forms; `/api/fdrex/model`, `dispatch15`, `agent` and `upside` and the
modules behind them (`model.js`, `finance.js`, `agent.js`, `upside.js`, `review.js`,
`dispatch15.js`) belong to the earlier tab's model; the forms still use `model.js` `rfsAmounts`.

## Checks

* `tools/check_fdrex_bid.mjs`: the terms (four hours a night from the non-solar window, the plans,
  the monthly rule, 5% bought, the sale mask, the PSM), the sizing request (demand only in those
  hours, the tolerance, the purchase at GDAM + charges, the optimizer's switches, a fixed size kept),
  the finance on a sizing result (power bought, the PSM, the penalty at 1.5 × tariff, SECI's
  charges, the workbook's rows and names), the dates, the money at stake, the forms' view and a
  saved bid.
* `tests/engine/test_fdrex_lp.py`: supply only in the four hours and every month met; purchases
  within 5% and priced; no sale in the solar hours and nothing bought resold; the monthly tolerance
  and penalty (the penalised MWh equal the energy short beyond 90%, and the free tenth can only
  lower the tariff); dear power not bought.
* `tools/check_fdrex_whatif.mjs`: the What-if on a case from an FDRE-X bid: demand only in the
  buyer's hours, the battery and the purchases only in them, no sale in the solar hours, bought
  power within 5% and below the tariff, the penalised energy beyond 90% of each month at
  1.5 × tariff, the PSM, buying off, solar-hour connectivity, the hard plan, no prices, the live
  model's rows, an RTC case unchanged.
* `tools/check_fdrex_bid_agent.mjs`: the voice agent's tools on a stand-in for the tab (strict
  schemas, the brief and lookup with pages, the guided order, inputs and their limits, the sizing,
  results and financials, the quote, the what-if, the energy, the forms) and the live loop.
* `tools/check_fdrex_content.mjs`, `tests/engine/test_fdrex_terms.py`: every quote of the pack, the
  formats and the 450 terms on its PDF page. `tools/check_fdrex_forms.mjs`: the forms and letters.
* `tools/check_fdrex_model.mjs`, `check_fdrex_agent.mjs`, `check_fdrex_review.mjs`,
  `check_fdrex_blocks.mjs`: the earlier tab's model, agents, review and 15-minute workbook, kept
  while their modules are.

Not yet in this tab: the Excel input template (it was built on the earlier tab's model).

## IEX prices (built in)

`tools/build_iex_prices.py` turns IEX's 15-minute market results (GDAM, DAM and RTM exports, sheet
"15min": date, time block, MCP) into a calendar year, each day from the latest year with data:

* `web/public/market/iex_15min_prices.json`: 35,040 blocks per market (Rs/MWh), and GDAM's cleared
  volume; loaded only for the 15-minute dispatch (`loadMarketPrices15`, `withPrices15` in
  `web/src/bid/model.js`), which sends the sale market's and GDAM's blocks as `ctx.surplusPrice15`
  and `purchase.prices15` (Rs/kWh); `engine/sizing/dispatch15.py` prices each block at its own price;
* `web/public/market/iex_hourly_prices.json`: the same year as 8,760 hours (the mean of each hour's
  four blocks), what the sizing, the finance and the buyer's costliest hours read.

The year built in is 2 Nov 2025 to 18 Nov 2026 (1 Jan to 18 Nov from 2026, the rest from 2025):
GDAM averages ₹5.30/kWh, DAM ₹4.87, RTM ₹4.45; 18:00–22:00 ₹8.08, ₹7.43 and ₹6.50; midday about
₹2. To refresh it, export the three markets from IEX and run
`python3 tools/build_iex_prices.py --gdam GDAM.xlsx --dam DAM.xlsx --rtm RTM.xlsx`.
