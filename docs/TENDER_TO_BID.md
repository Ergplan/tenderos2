# Tender to Bid

The main tab of TenderOS: it takes a power-sale tender to a priced bid. It is separate from Round the Clock,
BESS tender and CfD bid, and does not change them.

## The journey

1. **Start screen** (`StartScreen.jsx`). The start screen offers four ways in:
   * **Upload a tender:** any power tender (PDF, Word or text, up to 60 MB). The type is detected,
     or you choose it. Choose several files at once (the RfS with its amendments, clarifications
     and draft PPA/PSA; up to 20 files, 120 MB) and they are read as a tender set:
     * the amendments are applied to the RfS, so every later step uses the amended terms;
     * a page chip shows the amendment's name ("Amd-1 p. 1") when the value comes from one;
     * the Tender step opens with a **Tender set** panel: documents, amended terms (was → now,
       with the amendment's quote), every change with a word diff, clarifications with their
       verdicts, the bid formats with their blanks, the Bid Information Sheet and the bid steps,
       and a search over every page.
   * **Run the prefilled simulation:** WBSEDCL/PT&P/RE-RTC/2026/01, whose reading ships built
     in. It opens straight in the workflow.
   * **Continue** the tender in progress.
   * **Open** a tender read before.

   "New tender" in the workflow returns here.
2. **Scan screen** (`ScanStage.jsx`, `scanAgents.js`). This runs while an upload is read.
   * Five agents work side by side: Key dates, Eligibility & qualification, Capacity & supply
     constraints, Commercial & finance inputs, and Tender risks.
   * Each agent scrolls the tender's own lines on its subject, with the matched phrases marked.
     The lines come from the engine's early preview (`engine/extraction/preview.py`), a verbatim
     run of each page's text.
   * When the reading is done, each agent locks in what it found as fields of the reading with
     their page.
   * A closing line gives the pages, the fields read and how many values were located on their
     page.
   * The screen runs for at least about 6 s and stays until the reading ends.
   * **Skip animation** and `prefers-reduced-motion` show a plain progress view instead.
   * Nothing on the screen is invented. An agent with no finding says "Not stated in this
     document". If the rule-based reader did not look for the subject at all (eligibility, for
     example), it says "Not read" instead.
3. **The workflow** (the six steps below) opens on the new tender.

**Any tender.** The sizing steps (bid capacity, supply sources, size, financials) apply to supply
tenders: solar, wind, hybrid, FDRE, RE-RTC, generation and IPP (`sizingScope` in
`tenderMap.js`). For other tender types, those steps show a notice (`ScopeNotice.jsx`) instead
of a broken form:
* **Standalone battery tender:** the notice offers "Open in the BESS tender tab", which hands the
  uploaded file to that tab and reads it there.
* **Transmission or EPC tender:** the notice says there is no plant to size. The Tender and Key
  dates steps hold everything read.

Wherever a tender does not state a term, the step says so, and no value is carried over from
another tender.

| Step | What happens | Where |
| --- | --- | --- |
| 1 Tender | Every requirement of the tender on one page: what it says, how the sizing applies it, and the page and quote it comes from. Then the pre-bid queries (WBSEDCL), every field read, and other tenders (read before, or a new upload) | `tenderMap.js` (`buildProposals`, `tenderTerms`), `TenderStep.jsx`, `RequirementsStep.jsx`, `PreBidQueries.jsx` |
| 2 Key dates | Every date the tender prints (schedule of bidding, award, PPA, greenshoe offer, supply start) on a calendar, with what is next, days to go and the page and quote of each | `tenderDates` in `tenderMap.js`, `DatesStep.jsx` |
| 3 Bid capacity | The capacity you bid and whether the plant is sized for the greenshoe too, checked against the tender (WBSEDCL: 1,500 MW, no part capacity, 500 MW greenshoe at the same tariff) | `CapacityStep.jsx` |
| 4 Supply sources | The sources you have: solar, wind, hydro, biomass, thermal (non-RE) and battery. For each, fixed capacity or the most the optimizer may build, its parameters (CUF, availability, minimum load, battery duration and efficiency) and its costs; then financing and, where the tender allows it, market sale. Every field starts empty | `SourcesStep.jsx`, `model.js` (`SOURCE_FIELDS`, `missingInputs`) |
| 5 Size | HiGHS finds the least-tariff plant from your sources that meets every tender requirement, with the tender conditions table (met / not met); then the plant is dispatched in 15-minute blocks for every PPA year, with a ZIP download | `POST /api/rtc/lp` (`engine/sizing/rtc_lp.py`), `POST /api/bid/dispatch15` (`engine/sizing/dispatch15.py`), `SizeStep.jsx`, `Dispatch15.jsx`, `Checklist.jsx` |
| 6 Financials | The financial model of that plant: bid tariff at your equity IRR, capex by source, fuel, hydro and thermal costs (with RECs), guarantees, statements; **Download financial model (Excel)** | `engine.js runFinancialModel`, `FinanceStep.jsx`, `exportModel.js`, `POST /api/bid/model` |

## Constraints from the tender, inputs from the bidder

The sizing applies only constraints the tender states, each from a field the tender engine read
with a quote located on its page (`tenderTerms`). For WBSEDCL:

* Supply floors: 80% CUF each accounting year, 70% every month, 90% in peak hours (p. 10). The
  peak hours are decided by WBSEDCL (4 h a day), so the 90% floor is checked in every hour of the
  day, every month (the tender does not state the measuring period; the stricter monthly check is
  used and said so on the requirements page).
* Sources: solar, wind, hydro, biomass and storage are named (p. 9); non-RE supply is allowed for
  the balance with RECs (p. 10) with at least 51% traceable green power each accounting year
  (p. 10), a hard constraint of the sizing once a non-RE source is in the bid; solar of twice the
  contracted capacity is mandatory (p. 11).
* Market sale: only the mandated solar may be scheduled in the market (p. 11); the PPA is supplied
  first in every hour and only solar surplus is sold. Non-RE energy is never sold.
* Capacity: 1,500 MW, no part capacity (p. 12); greenshoe 500 MW at the procurer's option, supply
  from 01.04.2029, same tariff (p. 10). PPA term 25 years.

### A first round in a few clicks

The tab opens ready for a first round: the bid capacity is the tender's 1,500 MW (greenshoe off), and solar,
biomass and battery are switched on with the optimizer choosing their sizes (up to 12, 1 and 4 ×
the contracted capacity when no limit is entered; solar at least the tender's 2 ×). Each source
card has a **Fix the size** toggle: switched on, that source is built at exactly the MW entered
(for example a biomass plant of a given size) and the optimizer sizes the other sources around it. **Fill up for
me please** on Supply sources puts industry benchmarks (CERC norms, 2025–26 prices; `BENCHMARKS`
in `model.js`) in every empty field and marks each as a benchmark; a value the bidder types
replaces it. WBSEDCL allows no part capacity (p. 12): another capacity is still sized and priced,
but shown as a warning on Bid capacity and as not met in the conditions table.

The Tender page opens with a plain-English summary of the tender. The rule-based reader assembles
it only from the fields it read (capacity, green share, supply floors, mandatory solar of 3 GW for
the base and 1 GW more with the greenshoe anywhere in India, no part capacity, supply start dates,
the bidding schedule, EMD and PBG), and keeps the quote of every figure.

### Filling every section of the reading

The built-in WBSEDCL reading is from the tender engine's rule-based reader, which reads the
figures the sizing needs. Summary, eligibility, commercial, penalty and connectivity clauses are
read by its model: **Fill every section with the model** on the Tender step (shown when the
engine has a model key) reads the RFP PDF chosen there and merges the result. Every field the
rule-based reader found is kept; a field it did not find is taken from the model reading, with
its own located quote and checks, and marked "model". The model reading is saved, and the merged
reading loads by default from then on (`mergeReadings` in `tenderMap.js`).

### The bidder's inputs

Everything else is the bidder's input: capacities, CUF and the other
plant parameters, every cost (capex, O&M, fuel, hydro and thermal fixed and energy charges, REC
cost), financing (equity IRR, debt, interest, tenor, tax, escalations, insurance, pre-operative
costs, transmission) and the market choice. **Size** stays disabled until every source switched on
has all of its inputs (typed, or benchmarks filled on request); the missing ones are listed. Solar and wind take an hourly profile shape (a
typical profile, or the site's 8,760-hour profile from the library or an upload) scaled to the CUF
entered. The inputs used are listed on the Size step under "Your inputs".

Hydro and thermal are dispatchable sources in the sizing LP (`plants` in the request): output up
to availability × MW each hour, at least the minimum load, energy within the CUF (per year, or per
month for hydro when a monthly CUF is entered); costs are capex per MW, a fixed or capacity charge
per MW per year and an energy charge per kWh (plus the REC cost for thermal), escalating yearly.
Enter capex 0 for power bought under contract.

### Guardrails on the reading

* The model must quote; every quote is searched on the PDF page (capped confidence and review when
  not found; rejected without a quote); every number and date must be printed in its own quote
  (`value_in_quotes`, an FDRE addition); types, ranges and cross-field rules are plain Python.
* The Tender step says which reader produced the values (and, for the model,
  which model). Without `ANTHROPIC_API_KEY` the engine falls back to the rule-based reader and the
  screen says so (see `docs/EXTRACTION.md`).
* A value is used in the model only when the page proves it: its quote is found on the page and
  prints the value. A value whose quote is not found or does not print it is shown unticked as
  "Not proved by the page" and is applied only if the reviewer ticks it after checking. A review
  raised by a plausibility check alone (a range, the EMD/PBG ratio) does not block a value the
  page prints.
  `EXTRACTION_REQUIRE_LLM=1` switches the fallback off: a read that cannot use the model fails.

## Pre-bid queries

Section 1.2 of the Tender step drafts ten pre-bid queries for the WBSEDCL RE-RTC RfQ/RfP
(`preBidQueries.js`), ordered by how much the answer can move the tariff:

| # | Query | Clause and page |
| --- | --- | --- |
| 1 | Peak hours: the window WBSEDCL picks the 4 hours from, the notice, stretch length, and whether 90% is measured daily, monthly or yearly | RFQ 1.1.1, p. 10 |
| 2 | Sale of the mandated solar in the market: any cap on quantum, time blocks or share; priority; revenue sharing; solar above 3 GW (RFQ 1.1.2 says "or in the market", RFP 5.3.1 omits it) | RFQ 1.1.2, p. 11; RFP 5.3.1, p. 62 |
| 3 | Payment for supply above 80% annual CUF; any maximum; sale of excess | RFQ 1.2.15, p. 15; RFP 1.1.7, p. 48 |
| 4 | Shortfall compensation for each of the three floors; double counting; cap; exclusions | RFQ 1.1.1, p. 10; RFP 1.1.6, p. 47 |
| 5 | The draft PPA and the 51% Traceable Green Power formula; storage and REC-backed energy in it | RFQ 1.1.4, p. 11; RFP 1.1.6, p. 47 |
| 6 | Year-wise or escalating tariff; discount rate and weights of the levelized tariff; e-RA; greenshoe tariff | RFP 7.9.1, p. 64 |
| 7 | Non-RE under Merit Order Despatch: deemed supply for the floors, schedule confirmation, RECs, sale of unscheduled energy | RFP 1.1.4, p. 47 |
| 8 | Battery co-location, charging from the grid or GDAM, market discharge, ISTS charges | RFQ 1.1.4, p. 11 |
| 9 | Mandated solar: MWac or MWp, existing capacity, commissioning date, and the 15-day vs 3/6-month land and CTU documents | RFQ 1.1.2, p. 11; RFP 1.1.9, p. 48; RFP 5.3, p. 62 |
| 10 | Greenshoe: option or obligation, timing of the extra 1 GW solar, tariff indexation, PPA term | RFQ 1.1.1, p. 10 |

Each query quotes the RFP word for word with its page (`test_prebid_queries_quote_the_wbsedcl_rfp_word_for_word`
checks every quote against the RFP when it is available) and carries a rationale for WBSEDCL, plus a
note for the bidder on why it matters for the tariff and which input changes once it is answered.
The query text and rationale can be edited and any query left out; **Copy all** puts the letter
on the clipboard, and **Download Word file** saves it as .docx (`POST /api/bid/queries`), in the
form RFP clause 1.1.10 asks for: titled "Queries/Request for Additional Information: RFP for
1500MW with 500MW green shoe option Supply Capacity", one table row per query (S. No., clause and
page, RFP provision, clarification sought, rationale). The section shows the tender's query
dates (last date for queries, pre-bid meeting, response) and says when the last date has passed.

## 15-minute dispatch, every PPA year

The sizing works in hours over representative years (year 1 and the years that bind). Section 4.5
of the Size step, **Run the 15-minute dispatch**, takes the plant it chose and dispatches it in
15-minute time blocks (96 a day, 35,040 a year) for every year of the PPA (`engine/sizing/dispatch15.py`,
one HiGHS LP per year, run on the engine as a job):

* Biomass and thermal (and hydro) stay at or above their technical minimum in every block and
  change by at most their ramp rate per block: ramp %/min × 15 (1%/min: 15% of MW per block).
* The battery charges from renewable output only (RFQ 1.1.4: "Charges through RE only"), within
  its power and energy, and never charges and discharges in the same block.
* The tender's floors (80% a year, 70% each month, 90% in the peak hours WBSEDCL picks) are
  checked on the 15-minute delivery. A floor the plant cannot meet in a year is reported with its
  shortfall (the run does not fail), so a design that only works hour by hour shows up here.
* Each year uses its own solar and wind degradation and battery capacity, and the tariff and fuel
  escalation of that year. Among dispatches of equal value the one with the smoothest schedule to
  the procurer is chosen (a negligible cost per MW of change from block to block).
* Solar and wind profiles are hourly: each hour is split into four blocks along the hour's trend
  (half the change from the previous to the next hour), keeping the hour's energy exactly and
  every block between zero and the peak. Demand and market prices take the hour's value.

Year 1 is solved from scratch (interior point, then crossover); each later year changes only
costs, bounds and right-hand sides, so dual simplex restarts from the previous year's basis. For
the WBSEDCL benchmark plant year 1 takes about 1.5 minutes and each later year a few seconds.

The table shows, for every year, each floor achieved, any shortfall, the lowest biomass/thermal
output against its technical minimum, the largest 15-minute change against its ramp limit,
curtailment and sales. **25-year dispatch (Excel)** (`GET /api/bid/dispatch15/{id}/xlsx`,
`engine/sizing/dispatch_workbook.py`) is one workbook:

* **About:** the plant, tariff, losses and floors.
* **Summary:** one row per PPA year.
* **Monthly:** one row per year and month.
* **Year 01 to Year 25:** 8,760 rows each, the four 15-minute blocks summed to MWh per hour.

Each year sheet adds up to that year's summary. **15-minute blocks (ZIP)** gives one CSV per year
(`dispatch_15min_year_NN.csv`: day, month, block 1–96, time, contracted supply, output of each
source, battery charging, discharging and state of charge, direct and total delivery to the PPA,
sales, curtailment, price; with losses set, the transformer and line losses; with time-block
floors, each block's floor and the delivery short of it), `summary_by_year.csv`, a README and the
request used. Runs are kept on the engine for 24 hours.

**Time-block floors** (SECI RTC-TM) are checked in every 15-minute block on its own.

* A block short of its floor costs the penalty multiple × the tariff on the energy short (SECI:
  1.5×). A hard floor gets a large penalty, so a miss is reported instead of failing the year.
* The table gives, per floor, the share of blocks at the floor.
* Inside an hour, solar's ramp can leave one block short where the hourly average was met. So the
  15-minute check is a little stricter than the hourly sizing.
* **With a penalty, compare energy, not blocks.** The penalty is on the energy short, so the LP
  pays the same whether that energy falls in a few blocks or is spread over many. The 15-minute
  dispatch spreads it, because its tie-breaker keeps delivery smooth. Its share of blocks at the floor
  can therefore be much lower than the sizing's share of hours, with nearly the same energy short.
  * Example, the demo bid in year 1: 97.3 MU short in 15-minute blocks against 96.3 MU in the hourly
    sizing; 54% of peak blocks at the floor against 86% of peak hours.
  * The verdict gives both energies.

### Reading the hourly dispatch chart

The stacked areas of the year-1 chart are the supply to the PPA by source: direct delivery is
shared among the sources in proportion to their output that hour, plus battery discharge and
sales. They are not each plant's output: a biomass plant at its 55% minimum whose output mostly
charges the battery shows as a thin "Biomass to PPA" band. The dashed lines are the actual output
of biomass, thermal and hydro, and the tooltip gives the hour's full balance (output by source with
% of MW, direct supply, battery charging, sales, curtailment, discharge and state of charge).

An hour that both charges and discharges the battery (an LP tie when the energy would be curtailed
anyway) is shown as its net, with the same state of charge and delivery. When a non-RE plant is in
the bid the sizing also limits charging to renewable output.

### Solver time

The sizing gives HiGHS 1,200 s for all its Dinkelbach iterations together. If the limit stops a
later iteration, the design shown is the last one solved to optimality, and the status says so
with its distance from the proven lower bound (for example "Time limit reached in iteration 3;
design of iteration 2 (within ₹0.001/kWh of the best possible)").

## Financial model workbook

After sizing, **Download financial model (Excel)** on Financials saves a workbook built from what
the tab computed:

* **Cover**: the bid tariff, equity and project IRR, equity NPV, minimum and average DSCR,
  payback, project cost, debt and equity, levelised cost, year-1 supply and market sale, and how
  many tender conditions are met; the plant (sizes, fixed or optimised, year-1 energy); the key
  inputs; the tender's terms; and notes on where the numbers come from. The key results are
  formulas on the Live model tab, so they follow any input changed there.
* **Live model**: the whole financial model as Excel formulas (`web/lib/liveModel.js`), one
  column per year, every cell linked:
  * *Key results*: the tariff, IRRs, NPVs, DSCRs, levelised cost and tariff, payback, project
    cost, debt, equity and revenue, each beside the app's number with the difference and "Same as
    app?"; and how to price the bid again with Goal Seek (set "Equity IRR less the target" to 0
    by changing the bid tariff).
  * *Inputs* in blue on yellow: tariff and escalation; capex by source, evacuation and
    pre-operative cost; O&M, insurance, other fixed cost, biomass fuel, hydro and thermal charges
    and RECs; market sale (Yes / No) and its
    price, the supply floor and shortfall penalty; battery augmentation (annual / oneTime /
    none), fade, year and price decline; debt share, interest, tenor, repayment (annuity /
    equal), target IRR, discount rate; tax, tax depreciation (wdv / slm), WDV rate, book life,
    salvage and receivable days. Choices are drop-down lists. Each input says where it came from
    (your input, industry benchmark, model default, tender).
  * *From the optimiser* in green: the sizes, and by year the contracted, delivered and sold
    energy, the realised hourly market price, and biomass, hydro and thermal energy. These come from the HiGHS dispatch; changing a size moves its cost, not
    its energy (size again in TenderOS for that).
  * *Formulas* in black: project cost and funding, escalation and discount factors, revenue,
    operating costs by line, EBITDA, battery augmentation, book depreciation (with augmentation
    over the years left), debt (opening, interest, principal, closing, debt service), tax
    depreciation (WDV block), profit and loss with tax losses carried forward, cash flow (working
    capital, CFADS, DSCR, salvage and receivables released in the final year), equity and
    project cash flows from year 0, levelised cost, the returns, and model checks.
  * `tools/check_live_model.mjs` builds the tab for three bids that between them reach every
    branch, has LibreOffice work out every formula from no stored value and compares each cell
    with the app's model; it then changes the tariff and a capex in the sheet and checks the
    recalculated returns against the app run on the same inputs.
* **Tender conditions**: each condition, what the tender says, its page and quote, what the plant
  and bid deliver, and met / not met.
* **Inputs**: every input the Live model reads, in groups (blue cells; the Live model and every schedule sheet link to them), with the tables of the finance team's inputs (part commissioning, wind O&M components, other fixed cost lines, guarantees, augmentation years).
* **Inputs (list)**: every input of the bid with its unit and source (your input, industry benchmark, model default), as the app recorded them.
* **Plant and capex**: sizes, capex by source, transmission, pre-operative costs, debt and equity.
* **Round the clock** downloads the same workbook from its financial model (F.4, **Download
  financial model (Excel)**, `POST /api/rtc/model`): no tender conditions sheet, the energy from
  the tab's hourly simulation of every year (green), with the 33 kV bus to 220 kV meter lines, and
  each site's battery when solar and wind are on separate sites.
* **Revenue and costs (values)**: the app's numbers when the workbook was made; year by year, PPA supply revenue, market sale revenue, penalties, O&M,
  insurance, other fixed cost, biomass fuel, hydro and thermal costs (with RECs), augmentation.
* **Financial model (values)**: the app's numbers; energy and tariff, revenue, operating costs, profit and loss, cash flow
  and debt for every year with totals, then the equity and project cash flows from year 0.

## The finance team's inputs (November 2026)

The Finance inputs step (section 4.3a, "Finance team's inputs") and F.1 of Financials carry the
ten groups of the finance team's list of 4 November (`docs/dev/FINANCE-V3-SPEC.md`), shared with
the SECI, Round the Clock and CfD tabs through `web/src/rtc/FinanceInputsV3.jsx`: the commercial
operation date (seeded from the tender's supply start, so the model's columns read real months),
capex phasing and part commissioning, a bridge loan, generation cases, carbon credits, life
extension, repowering, augmentation on a schedule, O&M splits and other fixed lines, the debt
features, quasi-equity and mezzanine, guarantees, tax bases, HoldCo and lender returns and the
reverse-auction sensitivities. `modelInputs` (`web/src/bid/model.js`) passes `costs.phasing`,
`costs.moduleSharePct` and the battery schedule to the engine; Financials shows F.5 Returns, F.6
Tax schedule, F.7 Balance sheet and cash-flow statement and F.8 Reverse-auction sensitivity, and
the workbook an Inputs sheet with the dated year row and the new rows. Everything is off by default.

## Recently extracted tenders

Each tender read is saved (`tender_reads`, migration 006) and listed on the Tender step for every
Tender to Bid user, so a tender read once can be opened again. The WBSEDCL RfQ/RfP reading ships
built in (`web/db/seed/tenders/`).

## Supply floors

The tender's obligations become floors on delivered energy ÷ (contracted capacity × hours):

* **Annual** over all hours of each year (e.g. 80% CUF per accounting year),
* **Monthly** over all hours of every month (e.g. 70% CUF monthly),
* **Peak** over the peak hours, every month or over the year (e.g. 90% in 4 peak hours a day).

Demand is the contracted capacity in every hour (round-the-clock supply), so each floor is the
tender's CUF measure. The LP enforces every floor in every modelled PPA year (year 1, the years
that bind and augmentation years; other years are interpolated), with solar degradation and
battery fade. When the procurer picks the peak hours, the peak floor holds in each hour of the day on its own.

## Biomass

A dispatchable renewable generator with its own size and hourly output:

* output ≤ availability × MW in every hour, ≥ minimum stable load × MW (it runs all year),
* ramp rate: the output moves at most ramp × 60 min × MW from one hour to the next (the
  benchmark is 1% of capacity per minute and a 55% technical minimum, the IEGC 2023 norms for
  thermal steam units; thermal takes the same ramp input),
* yearly output ≤ fuel-limited PLF × 8,760 × MW,
* capex (₹ cr/MW), O&M (₹ lakh/MW/yr) and fuel (₹/kWh generated, escalating) are costs; fuel
  enters the LP objective and the financial model's operating cost ("Biomass fuel" line).

Biomass may charge the battery; its surplus is curtailed (only what the tender allows is sold).

## Solar and wind on separate sites

On the Supply sources step, **Solar and wind sites → Separate sites** applies when the bid has
solar, wind and a battery. It sizes a plant whose solar and wind are on different sites, each with
its own battery. Nothing more is asked for.

**The rule:** each battery charges only from its own site. Solar cannot charge the wind-site
battery, and wind cannot charge the solar-site battery. No energy is sent between the sites to
charge a battery, so there is no transmission charge or loss between them.

In the sizing LP (`engine/sizing/rtc_lp.py`, `payload.sites = { split: true }`), each modelled
hour works like this:

* **Charging.** The solar-site battery charges from solar only (charge ≤ solar output), and the
  wind-site battery from wind only (charge ≤ wind output).
* **Delivery.** Both sites serve the customer, and both batteries discharge into the delivery.
* **Other plants.** Biomass, hydro and thermal feed the delivery point and do not charge the
  batteries in this mode.

HiGHS sizes both batteries, which decides how much storage goes to each site. The battery range
and duration you enter apply to the two batteries together; each battery keeps the duration. The
Size step shows each site's battery and the split. On one site the battery can charge from both,
so separate sites never cost less.

The 15-minute dispatch models one battery site and is not offered for separate sites yet.

**Round the clock tab.** The Battery chapter has the same switch and nothing to enter. The tab's
answer comes from its own search, which is seeded by HiGHS, and from the browser's hour-by-hour
dispatch (`simulate` in `web/src/rtc/engine.js`). With separate sites:

* **The battery split.** The battery is divided between the sites by a wind-site share, which the
  optimizer decides: HiGHS's two-battery optimum seeds it, and the search then sweeps it from 0 to
  100%. It is not an input; the Battery chapter shows each site's battery and the split.
* **Dispatch rule.** Each hour, solar's surplus charges the solar-site battery and wind's surplus
  the wind-site battery, as far as each can take it; the rest is sold or curtailed. A deficit is
  served by both batteries.

`tools/check_rtc_engine.mjs` checks the following:
* with all the battery at one site, it charges hour by hour from that site's output only, and
  never in an hour only the other site produces;
* separate sites never deliver more than one site, and generation still balances;
* the optimizer sweeps the split, and the HiGHS request carries `{ split: true }` only.

## Surplus sold on IEX

Where the tender allows a sale, the bidder chooses on the Supply sources step whether to sell; for
WBSEDCL only the mandated solar's surplus, over its own connection, after the PPA is supplied in
every hour. The price is hourly:

* **IEX GDAM** (green day-ahead, the default for renewable surplus), **DAM** or **RTM**, from
  15-minute market-clearing prices (`web/public/market/iex_hourly_prices.json`, built by
  `tools/build_iex_prices.py` from the IEX extracts for 1 Sep 2025 to 24 Sep 2026). Each hour of
  the year is the mean of its four blocks on the latest date with data for that day; missing
  days take the same weekday a week either side. Averages: GDAM ₹4.90, DAM ₹4.45, RTM ₹4.14
  per kWh, with midday near ₹2 and the evening peak near ₹7.5–8.3.
* or a flat price.

The LP values every MWh exported at that hour's price (escalated yearly if set), so it shifts
dispatchable output (biomass) to dear hours and counts cheap midday solar surplus for little.
The sale shows in the year-1 energy stack (MU, ₹ cr, realised ₹/kWh), in the dispatch chart
(with the price line) and in the Financials revenue stack (PPA supply, IEX sale, penalties).

To refresh the prices with a newer extract:

```
python tools/build_iex_prices.py --gdam GDAM.xlsx --dam DAM.xlsx --rtm RTM.xlsx \
    --out web/public/market/iex_hourly_prices.json
```

## What is not modelled yet

* Scenario saving: the model inputs and sizing live in the browser (per user and device); tender
  readings are shared (Recently extracted tenders), the Scenarios library is not used yet.
* The greenshoe is modelled from the base supply start; its own start (01-04-2029 for WBSEDCL) is
  nine months later, so the sizing is slightly conservative.
* The sizing itself is hourly; the 15-minute ramp and minimum are checked afterwards by the
  15-minute dispatch (a design that fails there is reported, not resized automatically).
* 15-minute solar and wind come from the hourly profiles (split along each hour's trend); measured
  15-minute profiles cannot be uploaded yet. Market prices are hourly.

## Checks

* `tests/engine/test_bid_lp.py` — biomass, hydro (annual and monthly CUF) and thermal sizing, the green
  share cap on non-RE, non-RE never sold, costs reaching the tariff, peak/monthly/annual floors,
  hourly market prices (a constant series equals the flat price; sales are valued at their hour), and that
  Round-the-clock requests are unchanged (results of three RTC cases were compared before and
  after the change and are identical).
* `tools/check_bid_model.mjs` — the WBSEDCL terms from the built-in reading, that every bidder
  input starts empty and sizing waits for it, the HiGHS request, and the financial model with
  hydro and thermal costs (RECs) and the NPV-based tariff solve.
* `tests/engine/test_dispatch15.py` — the 15-minute dispatch: the hour split keeps each hour's energy,
  battery netting keeps charge and delivery, biomass holds its technical minimum and ramp per
  block, every floor is met, the ZIP's files and rows, an unmet floor is reported, and charging
  from renewables only when thermal supplies.
* `tests/engine/test_extraction.py` — the tender reader (see `docs/EXTRACTION.md`), and that every
  RFP provision the pre-bid queries quote is on its page.
* `tools/check_bid_model.mjs` also checks the pre-bid queries: ten, each with clause, page,
  quote and parts; edits and left-out queries reach the copied text and the Word file rows.

* `tests/engine/test_split_sites.py` (`make test-slow`, several minutes) checks separate sites:
  * switched off, it gives exactly the one-site model;
  * each battery charges from its own site only, hour by hour (none at the solar site at night,
    none at the wind site in calm hours), within its MW;
  * separate sites cost no less than one site, and the tender floors still hold;
  * a transmission charge in an older request is ignored.

  `tools/check_bid_model.mjs` checks that nothing more is asked for and the request.
* `tests/engine/test_preview.py`: the scan screen's preview. Every line is on its page, a job
  shows it before the result, and text uploads work.
* `tools/check_scan_agents.mjs`: which agent reports which field, with its page; the "Not read"
  coverage; and the sizing scope by tender type.
* `tests/e2e/test_tender_to_bid.py` runs the journey in a browser:
  * start screen → upload → scan → workflow, where every scrolled line is checked against the
    PDF's page;
  * the prefilled simulation and Continue;
  * Skip and reduced motion;
  * the BESS hand-off.
* `tests/e2e/test_nhpc_tender.py` and `tools/check_nhpc_terms.mjs` — one real tender (NHPC FDRE-II)
  read, compared with its reviewed reading and turned into terms; `tests/e2e/test_tender_to_bid.py`
  runs the same tender through the browser to the Excel model (see `docs/E2E-NHPC.md`).

## Deploying

See the README: `docker compose up -d --build` with a filled `.env`.
