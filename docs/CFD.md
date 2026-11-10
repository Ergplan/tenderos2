# CfD bid (SECI CfD-I)

A dashboard tab for bidding SECI's CfD-I tender: assured peak supply of 1000 MWh a day (500 MW ×
2 hours) from ISTS-connected RE projects, sold on the power exchanges and settled by SECI's CfD Pool
against the bidder's strike price. It is a separate tab (`cfd`, "CfD Bid") and runs in the browser;
an administrator grants it like the other tabs.

| Step | Team | What it shows | Where |
| --- | --- | --- | --- |
| 01 What is a CfD | Tender / Legal | A plain-words explainer with a three-evening ₹5.70 table (every claim cites a term), the tender as a picture (energy and money flows, the timeline, a day of supply, the obligations in order), and the worked example for 50–150 MW | `ExplainStep.jsx`, `VisualModel.jsx`, `example.js`, `ExampleStep.jsx` |
| 02 Tender & amendments | Tender / Legal | The six documents (RfS of 15.07.2026, the standard CfDA, Amendments 01–04), how the bid goes, the 40 changes clause by clause (was / now, with the page link), the points to raise with SECI | `pack.js`, `DocumentsStep.jsx`; the PDFs under `web/public/tenders/seci-cfd-i/` |
| 03 Bid conditions | Tender / Legal | 249 conditions in force (262 with the superseded ones) in 11 groups, each quoted word for word with its document, clause and page; the amended ones with "As issued"; the three where the RfS and the CfDA differ; Assign to Legal | `terms.js`, `ConditionsStep.jsx` |
| 04 Bid inputs | Projects | Contracted MW (50–150, whole MW), the Effective Date with every date that follows it, the market to sell in, the sourcing choices, merchant sale, after the term; money at stake (EMD, PBG, CAC, fees, net worth, liquidity) | `BidInputsStep.jsx`, `inputs.jsx` |
| 05 Design | Design | Battery MWh and MW per contracted MW, own solar and wind, RE commissioning, availability, CUFs, RTE, degradation, augmentation; **Fill up for me please** (`fillWinning`: the competitive bidder's values of `WINNING` where empty, benchmarks elsewhere, the finance sculpted, then the optimiser); **Optimise own RE** | `DesignStep.jsx` |
| 06 Finance inputs | Finance | Costs and financing; debt repayment (six methods), moratorium, instalments, refinancing; construction months, drawdown, funding order; working capital and the debt service reserve; **Size the plant** | `FinanceInputsStep.jsx` |
| 07 Size | Projects | The optimiser's own-RE sizes for the least strike price with every day met, each candidate priced by the full financial model (`runModel` and `optimiseOwnRe` take a `price` function; the screening price is kept beside it); the plant; seven tender checks; year-1 energy mix; every Contract Year; any day's operation by the hour or in 15-minute blocks; the 15-minute dispatch of the whole term (526,000 blocks: tiles, a table by Contract Year, a ZIP of one CSV per Contract Year, a workbook with a sheet per Contract Year); the Bid review (6.6): why the bid is not optimal, as findings in three groups (blocks the bid, carries cost, to note) with where to fix each | `model.js optimiseOwnRe`, `finance.js runCfdFinance`, `dispatch15.js`, `checks.js` (the tender checks as plain data), `review.js`, `BidReview.jsx`, `SizeStep.jsx`, `POST /api/cfd/dispatch15` (`web/lib/cfdDispatch.js`) |
| 08 Financial model | Finance | The bid strike price from the shared financial engine (the same price as on Size; the fast screening figure beside it), IRRs, DSCR, project cost, LC, Pool pay-in, penalty, charging power; Your quote; money at stake; revenue stack; the Pool; F.1 Assumptions to F.4 the 15-year model with the traceable explorer; **Download financial model (Excel)**: Cover, Live model, Construction, Profit and loss, Cash flow, Balance sheet, Debt schedule, Depreciation and tax, Working capital, Sensitivity | `finance.js`, `FinanceModelStep.jsx`, `web/src/rtc/engine.js`, `web/lib/liveModel.js`, `POST /api/cfd/model` |
| 09 What-if | Finance | Returns at a tried strike price; the track to the quote (which levers, how far, in what order, the chance of each move and of the whole track; out of reach when no lever can get there) with a waterfall and a story; every input one step up and down with the price it gives and how far it must move, a reading guide and a plain-words note per lever; Apply; **Not for us** on a move turns the lever down (`state.rejected`, the track plotted again without it); a frozen value better than the suggestion is priced through the full model and the dialog gives the bands' chance of it; the bid size is not a lever | `levers.js`, `leverNotes.js` (notes, plausibility bands, `leverChance`), `track.js` (`planTrack`, frozen levers left alone), `TrackView.jsx`, `Freeze.jsx` (freeze with evidence into `state.frozen` and the evidence register, unfreeze), the What-if workbook (`cfdModelExport` + a `whatIf` block → the "What-if track" sheet of `lib/modelWorkbook.js`), `WhatIfStep.jsx` |
| 10 Bid forms | Tender / Legal | The RfS's 17 formats with their 224 blanks beside the RfS page, the particulars asked once, the letters in the RfS wording, eleven checks, Word and PDF | `forms.js`, `formats.js`, `letters/`, `BidForms.jsx`, `POST /api/cfd/forms`, `/api/cfd/letters` |
| 11 Reference bids | Projects | No CfD-I result yet: SECI's eight results that compare, the gap to the lowest peak-power award, why a strike price sits where it does; 11.1 What wins: the evening price of the chosen hours, the Pool's net flow at strike prices around it and at the quote (your MW and the full 500 MW against the ₹76 cr corpus), the verdict under Amendment-04's award test, the bidding logic; 11.2 the risks that are yours (DSM sized by the CERC-style model, availability per point, SECI-designated hours, fees, the weekly penalty, fade, a part award; the evening price as the Pool's) | `ReferenceBids.jsx`, `winning.js`, `web/src/market/seed.js` |

Across the steps: Save / Open (library module `cfd`), the Team panel with assignments on boxes, formats and conditions, pings and evidence on every box, feedback, and the voice bid agent (GPT-Live) with sixteen tools (`agent.js`, `voice.js`; the session from `POST /api/seci/live` with `tab: "cfd"`).

## Worked example (`workedExample`)

For a bid of X MW (default: the contracted MW, else 100) and a strike price (default: the solved bid,
else ₹9.00 as a labelled example):

* **No plant is needed to bid.** Bidders qualify as companies on net worth and liquidity (RfS 35, 37);
  the battery is built by month 15 from the Effective Date and own RE by month 36 (Amd-02); until
  month 36 the battery may be charged entirely from the green market (25% + 75%); after it own RE
  must give at least 25% of the energy with 50% group-company RE, or 75% without. Plants already
  built with untied capacity may bid too (RfS 2.6).
* Commitments: 2X MWh every evening, 14X MWh a Contract Week (at least 90%), 730X MWh a year, a
  battery of at least X MW / 2X MWh.
* Own solar sized on energy alone: share × 730X MWh / round-trip efficiency / (8,760 h × CUF), with
  the bidder's efficiency and CUF or labelled examples (87%, 25%).
* Money up front: EMD, PBG (with that solar), SECI's charges, the LC at the strike price.
* Three real evenings (the cheapest, a middle one and the dearest in the selling market's best two
  hours of 18:00–24:00): the exchange pays MCP × energy, the Pool settles (SP − MCP) × energy, the
  bidder ends with SP × energy.
* A Contract Week (Monday to Sunday) with one evening missed: 2X short, 1.4X free, 0.6X penalised at
  1.5 × (the week's highest evening price on any market − SP), plus the evening's revenue lost.
* A year of evenings in date order against the strike price.

## The tender, from its documents

The terms come from the RfS No. SECI/C&P/IPP/13/0002/26-27 dated 15.07.2026 (`rfp.pdf` in the
repository; it replaces the RfS of 17.04.2026), the standard CfD Agreement (CfDA) and Amendments 02
(03.08.2026) and 03 (08.10.2026). Pages are the numbers printed on each page; the RfS PDF has a cover
first, so its PDF page is the printed page + 1. If documents differ the CfDA prevails, then the RfS
(CfDA 1.2.18). Where an amendment changed a term, the amended term applies:

* Settlement (Amd-03, CfDA 9.2.iv): the RPD receives the strike price for every kWh supplied; the
  CfD Pool pays SP − MCP when the market clears below it and receives MCP − SP when it clears
  above. The draft CfDA's 70:30 / 50:50 / 30:70 slab sharing is replaced.
* Term (Amd-03): 15 years from the SCD (was 12). Ceiling tariff: removed (was ₹5.80/kWh).
* Battery (Amd-02): X MW / 2X MWh for X MW contracted, owned by the RPD. SCD of the battery: 15
  months from the Effective Date; RE generation: 36 months from it.
* Sourcing (Amd-02): all supply RE; up to 25% from the green market or bilateral deals for the
  whole term; a further 75% for charging until month 36; then a further 50% from group-company RE
  for charging; shares measured on the energy discharged.
* Bid (RfS 6.1, 6.2): one bid per group, 50 to 150 MW cumulative in whole MW, at most 150 MW
  awarded. e-RA (41, 42): SE = 0.8 × the qualified bid capacity, at most 500 MW (the H1 bidder is
  dropped when 0.8 × ST exceeds 500 MW); quotes fall by at least ₹0.01/kWh; every bidder within
  L1 + 2% wins in tariff order up to SE; the last may be offered part (never under 50 MW) and must
  accept if it is at least half its bid.
* Securities and charges (RfS): EMD (17) ₹9.68 lakh/MW solar + ₹13.68 lakh/MW wind + ₹2.40 lakh/MWh
  battery, valid 12 months; PBG (18.1) ₹24.20 lakh/MW solar + ₹34.20 lakh/MW wind + ₹6.00 lakh/MWh,
  within 20 days of the LoA, valid to 6 months after the SCD; Contract Administration Charges (19.1)
  ₹1 lakh/MW + GST; bid processing fee ₹20,000/MW (at most ₹20 lakh) and RfS cost ₹50,000, + GST.
  Capacities are installed AC (CfDA 1.1 Installed Capacity).
* Dates (RfS 21): CfDA signed within 30 days of the LoA; Effective Date = the 30th day from the LoA.
* Eligibility (RfS 37): net worth ₹96.8 lakh/MW solar + ₹1.368 crore/MW wind + ₹24 lakh/MWh; and
  one of turnover ₹42.37 lakh, PBDIT ₹8.47 lakh or a line of credit ₹10.59 lakh per contracted MW.
  Shareholding in the project company ≥ 51% until a year after the SCD (23.5). Solar uses domestic
  cells and modules (Annexure-B 1.d).
* Daily supply (CfDA): 2 MWh per contracted MW in 2 hours chosen day-ahead between 18:00 and 24:00,
  cleared on an exchange; weekly shortfall beyond 10% of 14 MWh/MW is penalised at 1.5 × (the week's
  highest evening MCP across exchanges − SP); the RPD gives SECI an LC of 2000 × MW × (₹10 − SP) × 30;
  RECs from brown-market sales are sold within 3 months, half the proceeds to the Pool.

Where the documents still differ (marked "documents differ"; the model follows the CfDA):

* RfS 7.1 lets the battery sit away from the RE; the CfDA's RE Power Project says co-located.
* RfS 2.6 offers existing projects a longer CfDA "pursuant to Clause 11", and Clause 11 reads "Not
  used". The longer term is not defined and not modelled.

Replaced and marked: the ₹5.80 ceiling and the slab sharing (Amd-03); RfS 4.4's third-party battery
(Amd-02, which numbers the clause 4.3); the RfS's 12-year term (Amd-03, RfS 2.3, 21.2, 21.7).

`tests/engine/test_cfd_terms.py` checks every quote against its page (and each RfS page number against the
"Page N of 128" printed on it): the RfS from the repository, the CfDA and amendments when available
(`CFD_DOCS_DIR`).

## Operations (`simulate`)

Every day from the SCD to the end of the term, with the IEX DAM/GDAM/RTM prices of Sep 2025 –
Sep 2026, each year scaled by the **price path** (`pricePathOf`): two multipliers per model year,
the midday band (hours before 18:00: charging, midday merchant sales) and the evening band (the
peak hours: the settlement price, evening merchant sales, the penalty reference). The path comes
from the scenario (`PRICE_SCENARIOS`: flat, storage flood, tight grid, each a slope per band on
top of the market price escalation) or from the bidder's own dots (`inputs.pricePath`, dragged
on F.9 of the Financial model step and smoothed by `smoothPath`). Market charging in an hour is
also capped at `gdamShareCap` × the hour's cleared GDAM volume (`hourlyMcvMw` of the price file):

1. The 2 Peak Hours are the two highest-priced hours of 18:00–24:00 in the market the bidder sells
   in (the CfDA asks the RPD to bid to maximise revenue).
2. The day's supply is Contracted MW × 2 h × availability: own wind in those hours, then the battery.
3. The battery charges before 18:00 from own RE first (in the hours its market value is lowest),
   then from GDAM power (hourly price + charges) and group-company RE (price + charges), cheapest
   first, within each Contract Year's limits (April–March; the SCD to 31 March for the first).
4. Own RE not needed is sold in the GDAM within the connection (the Contracted MW) on days the
   supply is met (CfDA 4.4.1.v), or curtailed.
4a. The **extra battery for evening sale** (`extraEssMwhPerMw`, Design; 0 by default): beyond the
   tender's 2 MWh per MW, charged after the day's commitment (own RE first, then the green market
   within what is left of its limit and the depth cap) and, only when the day's supply is met,
   discharged in the dearest evening hours outside the two peak hours, within the connection, at
   the sell market's price (CfDA 4.4.1.v; HP-DAM prices are not in the file, so the sell market's
   price stands in). Its capex, O&M, augmentation, EMD and PBG follow the installed MWh. Per year:
   `extraSoldMwh`, `extraRevCr`, `extraChargeOwnMwh`, `extraChargeMarketMwh`, `extraMarketCostCr`,
   folded into the merchant and charging totals the financial model reads.
5. Each Contract Week's shortfall beyond 10% is penalised at the strike price being solved.

**The plant detail of the Design step** (state keys beside `state.inputs`, all merged by
`mergeCfdState` and saved with the bid):

* **Losses to the billing meter** (`state.losses`, null until the bidder switches them on; the
  SECI tab's `defaultLosses()` shape: `solarLoss`/`solarFileAt`, `windLoss`/`windFileAt`,
  `bessLoss`/`bessRteAt`, `trafoLossPct`, `lineLossPct`). `lossFactorsOfCfd(state, rte)` turns them
  into `{ solar, wind, rteBus, meter }` through the RTC engine's `lossFactors`; `modelInputs`
  puts them on `inputs.loss` and `simulate` applies them: generation reaches the 33 kV bus as
  MW × profile × `solar`/`wind`; the battery's round trip at the bus is `rteBus` (the quoted RTE
  moved to the bus from where it is quoted); everything injected (own wind in the peak hours, the
  battery's discharge, the surplus and the extra battery's sale) is multiplied by `meter` on its
  way to the meter, and the connection limit is applied at the meter; power bought in the market
  or from the group is measured at the meter, so a bus MWh costs `1/meter` MWh bought and the
  sourcing caps count delivered-equivalent energy (`c × rte × meter`). With `losses` null every
  factor is 1 and `rte` is the input RTE, so the figures are exactly the earlier ones (checked).
  `sim.loss` carries the factors used.
* **The state-of-charge window** (`inputs.essSocMin`, `inputs.essSocMax`, empty by default):
  `socWindow(inputs)` = max − min, clamped to 5–100%; `simulate` runs the battery (and the extra
  battery) on nameplate × window, while capex, O&M, EMD and PBG stay on the nameplate. The tender's
  2 MWh per MW is read as usable energy: `missingInputs` and the Size check "Battery X MW / 2X MWh
  usable" demand nameplate ≥ 2 ÷ window (2.5 MWh per MW for 10–90%). `sim.socWindow` carries it.
* **Profiles** (`state.solarUpload`, `state.windUpload`: `{ name, values[8760], … }` from the
  profile library or an upload; `state.solarMonthScale`, `state.windMonthScale`: twelve monthly
  multipliers drawn on the heat map). `profileSourcesOf(state)` hands them to `profiles(inputs)`
  as `inputs.profileSources`: the upload's shape, else the typical shape (`E.synthSolarCf` at the
  DC:AC, `E.synthWindCf`), redrawn by the monthly multipliers (`E.applyMonthlyScale`) and scaled
  to the entered CUF (`scaleToCuf`). `designProfiles(state)` gives the same series to the Design
  step's heat maps without a sized plant. At a given AC CUF the hourly shape does not depend on
  the DC:AC ratio (the ratio and the site irradiance enter the clipping only as a product, which
  the CUF pins); `inputs.solarDcAc` (benchmark 1.4) sets the MWp and the capex per MWp and goes
  to the studio.
* **The studios** (`state.studio.solar`, `state.studio.wind`: the studio's design and, once
  applied, `applied: { capex, dcAc, cuf, summary, at }`): *Use this cost* writes
  `solarCrPerMw`/`solarDcAc` or `windCrPerMw`/`windCuf` into `state.inputs` and clears their
  benchmark marks.
* **Wind degradation** (`inputs.windDegradation`, 0 by default) lowers the wind output year by
  year as `solarDegradation` does the solar.

**The shortfall policy** (`inputs.shortfallPolicy`, a choice on Bid inputs 3.1, `meet` by
default; a choice, not a lever). `optimiseOwnRe` compares candidate plants under `meet` by
feasibility first (a plant that meets every day beats one that does not; when none does, the
least short), then by price; under `pay` by price alone, which already carries the weekly
penalty (`penaltyCr`, in the financial model's `penalty` row) and the lost revenue of the short
evenings (revenue runs on `deliveredMwh`). The result carries `policy`; the Size step's "2 MWh/MW
every day" check is a failure under `meet` and information under `pay` ("N days short, ₹X cr of
penalty over the term, allowed by your policy"), and the optimiser's message names the policy.

F.9 of the Financial model step (`MarketPrices.jsx`) draws the two bands (`priceBands` gives
today's levels: the cheapest three charging hours and the two dearest evening hours), lets the
bidder drag a year's dot, smooth or pick a scenario, re-runs the full financial model on every
change, and compares the scenarios through the full model (`runModel` with the `price` function).
`tools/check_cfd_model.mjs` checks the bands, the scenarios' effect on charging cost, merchant
revenue and the strike price (dearer midday power lowers the benchmark bid's strike price through
its surplus solar sales and raises it when those sales are off), the bidder's own path, smoothing
and the depth cap.

Shown as assumptions, not tender terms: hourly (not 15-minute) prices; the battery empties each
evening and recharges the next day; group-company power is available in any hour before 18:00; RECs
are counted only on energy from own RE sold in a brown market; surplus RE is sold only after the
day's supply is met (a cautious reading of 4.4.1.v, since the evening obligation comes after the
daytime sale).

## Financial model (`financials`, `solveStrikePrice`)

Construction (battery, line and pre-operative costs; SECI's charges with GST; the cost of the EMD
and PBG bank guarantees over their validity, EMD 12 months and PBG from 20 days after the LoA to 6
months after the SCD, each with the 30-day claim period), then each Contract Year: CfD
revenue (SP × energy supplied), surplus sales, the bidder's half of REC sales; charging power, O&M,
augmentation (degraded MWh replaced every year at a falling price), scheduling and fees, insurance,
exchange fees, the LC cost and penalties. Own RE capex is spent at its commissioning. Straight-line
depreciation, debt at the debt share drawn with each tranche and repaid in equal principal over the
tenor, tax at the corporate rate with losses carried forward. The strike price is the price at which
the equity NPV at the target IRR is nil (bisection); the bid is that price rounded up to two
decimals. Optionally the plant keeps selling at market prices for some years after the term.

**Optimise own RE** tries own solar (and wind, if in the bid) from 0 to 3 × the contracted MW and
keeps the size with the lowest strike price at which every day's supply is met within the sourcing
limits.

**The CfD Pool at your strike price**: the project's net pay-in to the Pool each year,
(MCP − SP) × energy supplied. At a strike price above the evening market price the Pool pays out;
scaled to 500 MW this shows how long the ₹76 crore Pool would last, which is the bidder's payment
security (CfDA 10.4(b)).

## The finance team's inputs (November 2026)

The CfD Finance inputs step (5.4a) and F.1 of the Financial model carry the shared
`FinanceInputsV3` groups (`web/src/rtc/FinanceInputsV3.jsx`, spec `docs/dev/FINANCE-V3-SPEC.md`):
a dated timeline from the battery's SCD (`keyDates(effectiveDate).scd` seeds `fin.codDate`),
capex phasing and part commissioning, a bridge loan, P50 / P75 / P90 cases, carbon credits, life
beyond the term, repowering, augmentation on a schedule (`state.bess.augmentation = "schedule"`,
merged on open by `mergeCfdState`), O&M splits, debt features (re-sculpting, step-down, top-up,
prepayment, sweep, DSRA on the peak with interest), quasi-equity and mezzanine, the guarantees
(EMD and PBG are also costed by the fast screening model from the RfS's amounts; the guarantee
rows here are the finance team's own schedule with fees and margin money), tax bases, HoldCo and
lender returns and the reverse-auction sensitivities. `cfdEngineInputs` (`finance.js`) passes
`costs.phasing`, `costs.moduleSharePct` and the battery schedule to the engine; the Financial model
step shows F.5 to F.8 like the RTC tender. Every input is off by default, so the strike price is
unchanged until one is filled.

## Checks

* `tools/check_cfd_model.mjs`: the terms, dates and Contract Years, the worked example (exchange + Pool =
  SP × energy every evening and over the year, the week's penalty, the solar sizing), the RfS's EMD, PBG, charges and
  eligibility amounts, the 50–150 MW bid, the LC and penalty formulas, the
  benchmarks, operation within the sourcing limits on synthetic prices, too little own RE falling
  short, the strike price earning exactly the target IRR, debt repaid, the Pool flows, and the real
  IEX year with the optimiser.
* `tests/engine/test_cfd_terms.py`: every quote on its page.

## The 15-minute dispatch

`web/src/cfd/dispatch15.js` turns the model's day plan into 96 blocks a day for every day of the
term. `simulate` hands each day's hourly flows to an `onDay` callback; `dayBlocks` splits every
hour into four blocks that keep its energy: solar and wind along the hour's trend (the engine's
`split_hourly` shape), own-RE charging following the generation within the hour and held within
the battery's power where the generation allows (a steep ramp that cannot be held is kept with
the generation and counted as `overPower`), bought charging and the discharge even over the hour
(the IEX prices are hourly), wind supplied directly following the wind. The battery's stored
energy is tracked block by block (charging × ¼ h × round trip − discharge × ¼ h, from empty each
day) and the state of charge is the window's minimum plus the stored energy over that year's
nameplate. `dispatch15(model, { onDay })` streams the days and returns the totals per Contract
Year and per month; `tools/check_cfd_dispatch15.mjs` proves every Contract Year's totals equal
the model's. `POST /api/cfd/dispatch15` (`web/lib/cfdDispatch.js`) runs the same on the saved
bid state and answers with the ZIP (`format: "zip"`: one CSV per Contract Year, the two
summaries, the inputs, a README) or the workbook (`format: "xlsx"`, written with ExcelJS's
streaming writer: About, Summary, Monthly, one sheet per Contract Year).

## Battery augmentation in the operation

The finance team's augmentation choice (annual, none, one-time year, or a schedule of years on the
Finance inputs step) reaches the day-by-day operation as well as the financial model:
`bessCapFactor(inputs, year)` in `model.js` gives the usable capacity of an operating year as a
share of nameplate by the shared engine's convention (restored in an augmentation year, faded by
the degradation since the last one, never below 40%), and `simulate` sizes each day's charging to
it. Before 10 Nov 2026 the operation faded the battery from year 1 whenever the choice was not
annual, while the financial model paid for the scheduled augmentation: the two now agree.
A day is short when less than the 2 MWh per MW (at the plant's availability) reaches the meter,
whatever the cause: charging power missing within the sourcing limits, or a battery faded below
the need. `tools/check_live_model.mjs` rebuilds the uploaded 150 MW bid of 10 Nov 2026 from its
listed inputs: with the battery kept at nameplate (as that file's build did) the strike price
reproduces within ₹0.15 of the file's ₹25.53; with the fade reaching the operation the last year
delivers under 90% of the mandate and the price is about ₹0.9 higher.

## The Bid review

`web/src/cfd/review.js` `reviewBid({ state, model, finance, prices })` reads a bid as a reviewer
would and returns findings `{ id, severity, title, detail, step, cite }` in three severities:
`block` (a tender check failed, from `checks.js sizingChecks`; a strike price above 1.5× the top
tariff of the latest FDRE peak-power award in `web/src/market/seed.js`; a minimum DSCR below the
lender's), `warn` (own solar not at its best, tested one step up and down on the screening price;
little own RE when more would help, else a note that buying the charging power is right; an extra evening-sale battery that earns less a year than its annualised capex and
O&M; battery energy above the need; a battery faded below the need in the last year; inputs more
than 25% from `BENCHMARKS` in the direction that raises the price) and `note` (a narrow SoC window,
green-market charging near the cap, what carries the price (capex annualised, costs averaged, over
the energy supplied), inputs far from the benchmark the other way, a year-1
refinancing, an equity target above 15%, short days under the pay policy). The Size step shows it
(6.6, `BidReview.jsx`), the workbook carries it (sheet "Bid review", `cfdModelExport` →
`modelWorkbook.js`), the agent answers from it (`review_bid`), and `tools/check_cfd_review.mjs`
asserts the uploaded 150 MW bid's findings and that the optimised benchmark bid has none of the
plant findings.

## Amendment-04 (05.11.2026)

Three changes in the pack (`pack.js`, `a4-*`), the PDF under `web/public/tenders/seci-cfd-i/`:
RfS 9.2.c and CfDA 4.4.2.iv rewritten as a procedure for SECI-designated hours (availability
declared in MWh by 06:00 on D-1, else 100% of the contracted capacity deemed; SECI's blocks, price
and quantum by 08:00 on D-1, or SECI bids on the RPD's behalf; up to 80% of the availability
through TAM/G-TAM and the balance day-ahead, never above the contracted capacity in a block;
deviations, DSM and every exchange charge the RPD's; sale elsewhere when MCPs stay low with
SECI/MNRE approval), and RfS 42.2.b letting SECI restrict the capacity awarded to the CfD corpus.
Eleven conditions carry it (`terms.js`, the Amd-03 wording of 9.2.c marked replaced), the
explainer's picture cites it, the voice brief says it, and the Bid review sizes the Pool's pay-out
at the bid's strike price against the ₹76 cr corpus (`corpus-cap`). Two points to raise with SECI
are added (the deemed 100% against the 2 MWh/MW obligation; how a restricted award is cut).

## What wins and the risks

`web/src/cfd/winning.js`: `eveningMcp` (the average MCP in the two chosen evening hours over the
full Contract Years), `eveningAverage` (every evening hour of the price year), `poolAt(model, sp)`
(the Pool's net flow a year from `poolFlows`, per MW and for the whole tender, against
`TENDER.poolCr`), `poolTable`, `whatWins` (the verdict in three tones: below the evening market,
within the corpus at today's prices, beyond it) and `cfdRisks` (DSM from `web/src/dsm/dsm.js`
with storage firming at the bid's strike price on the scheduled energy; availability per point;
designated hours; exchange fees; the weekly penalty against the year's highest evening price;
fade; the award; the market as the Pool's). `tools/check_cfd_winning.mjs` asserts the Pool
collects below the evening price and pays above it, the verdicts, and the sized DSM.

## Fill up for me please

`fillWinning(state)` in `model.js`: every empty input gets the competitive bidder's value from
`WINNING` (battery ₹0.85 cr/MWh, solar ₹3.6 cr/MWac, group RE at ₹2.5 with no charges and
`useGroup` on, 13% equity, 8.75% debt over 15 years, no extra battery, no SoC window, annual
augmentation; one line of reasoning each in `WINNING_WHY`), marked `"winning"` in `state.filled`,
and the industry benchmark otherwise (marked `true`); the finance team's repayment is sculpted to a
1.2 DSCR when still at the default (`WINNING_FIN`); typed values are never touched. The fill bars
(`inputs.jsx FillBar`, the Finance inputs button) then call the tab's `optimise`, so the own RE is
sized at once. The Inputs sheet and the Bid review read the mark (`WINNING_NOTE`). On 100 MW the
fill prices at about ₹8.4/kWh against ₹10.1 on `fillBenchmarks`, which the checks keep
(`tools/check_cfd_winning.mjs`). The agent's `use_benchmarks` does the same.

## Where the own-RE size came from

The optimiser records its result on the bid (`state.sized`: solarMw, windMw, the price, the
policy, when). `ownReSource(state)` in `model.js` reads it against the inputs as they stand:
"sized by the optimiser on <date>" while they match, "a first guess" when the fill put the size
in, "your size" when typed (with a note when the optimiser's result was changed since). The
workbook's cover and its Inputs sheet (`sizedLabel` on the live request) say the same, so a size
the optimiser chose is never labelled as the bidder's own.

## The sourcing limits' basis

The green-market and group-RE limits are shares of the energy supplied (Amendment-02), so
`simulate` budgets them on the planned supply, the daily mandate at the plant's availability, not
on the mandate itself: a plant at 97% availability that used 25% of the mandate would show 25.8%
of its supply. Measured ex post against the energy actually supplied, a year with short days can
sit a few tenths of a point over the budget; the Size step's checks allow half a point for that
before calling it a breach (`checks.js`, 10 Nov 2026).

## The state-of-charge window warning

`socWindowWarning(inputs)` in `model.js` flags a window that looks mistyped (a minimum under 1%,
a maximum under 80%, a minimum above 30%, or a window under 60%) with the nameplate it forces;
the Design step shows it beside the boxes (`cfd-soc-warning`), the Bid review carries it as a
cost finding, and the agent's `set_input` answers with it. Added after the uploaded bid of 10 Nov
2026, whose 0.05%–50% window doubled the battery to 4.1 MWh per MW.
