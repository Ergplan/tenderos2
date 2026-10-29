# TenderOS Demo 2

Demo 2 is Demo 1 (`Ergplan/tenderos`, commit `3a3aa62`, day and night mode) with the additions below.
Demo 1 is not changed by any of them; on the shared VM both run side by side (`docs/DEPLOY.md` §7).

## Traceable financial model

Every financial model in the app is the same 25-year model that the Excel export writes as
formulas (the Live model sheet, `web/lib/liveModel.js`). Demo 2 builds that sheet into an
in-memory grid instead of a file (`web/src/model/trace.js`) and shows it in an explorer
(`web/src/model/ModelExplorer.jsx`):

* **Where it opens.** Click a headline number (tariff, equity and project IRR, DSCR, LCOE, project
  cost, payback, year-1 supply) or any number of the 25-year table. "Trace the model" opens the
  whole grid.
* **What a number shows.**
  * Its formula, each reference shown as its line, year and value.
  * The numbers it reads and the numbers that read it, each a click away, with a back button.
  * "Every input it rests on": the inputs and dispatch figures it depends on, through every
    formula in between.
* **The grid.** Inputs are blue, dispatch figures green and formulas plain. The selected number's
  precedents and dependents are highlighted, and a search box finds a line.
* **Where it is wired in.** SECI RTC and Tender to Bid Financials, the Round the clock finance
  chapter, and the What-if tab.

The values are the Live model's own, which `tools/check_live_model.mjs` recalculates with
LibreOffice against the app. `tools/check_trace.mjs` checks the trace itself:

* every reference resolves;
* precedents and dependents mirror each other;
* the equity IRR carries the app's value and traces to the financing inputs and the dispatch.

### Generation a CFO can check by hand

The energy lines of the model (delivered, sold, short of the floor) come from the hourly dispatch.
The plant's generation does not need the dispatch, so it is a formula. The "Generation (capacity ×
CUF × 365 days × 24 hours)" section of the Live model sheet, in Excel and on screen, builds it
for solar and for wind:

| Line | Formula |
| --- | --- |
| January … December CUF | inputs: the mean of the month's hours of the profile the dispatch ran |
| Annual CUF | (Jan CUF × 31 + Feb CUF × 28 + … + Dec CUF × 31) ÷ 365 |
| Degradation factor, year *n* | (1 − degradation)^(*n* − 1) |
| Generation, year *n* | MW × CUF × 365 × 24 ÷ 1,000 × degradation factor (MU) |
| At the 33 kV bus | generation × (1 − losses from the CUF's measuring point to the bus) |
| Year 1 by month | MW × month's CUF × days × 24 ÷ 1,000; the twelve add up to year 1 |
| Solar and wind at the 33 kV bus | the sum of the two |
| Generated but not delivered or sold | bus generation (+ biomass, hydro, thermal) − delivered − sold |

The only thing left to the dispatch is where each hour's energy goes: to the procurer, into the
battery, sold or curtailed. A dispatch number in the explorer says that in plain words and links
to the generation it comes from.

Selecting a solar or wind generation number opens a drill-down from the year to the 15-minute
blocks:
* the year's arithmetic;
* the twelve months, each with MW × CUF × days × 24;
* any day's 96 blocks, each MW × capacity factor × ¼ h, split from the hour the way the
  15-minute dispatch splits it (`engine/sizing/dispatch15.py` `split_hourly`, ported in
  `web/src/model/generation.js`);
* all 35,040 blocks added back up to the year.

**Ask the bid agent.** In the SECI tab, the bid agent (voice, GPT-Live) has a tool,
`explain_generation` (`web/src/model/explainGeneration.js`). It works the energy out from the same
traceable model and opens it on screen, beside the conversation, at that line, year, month and
day. The CFO can ask:
* "How is the solar energy worked out?" The agent gives the steps with the bid's numbers:
  megawatts × CUF × 365 × 24 ÷ 1,000, then the year's degradation, then the losses to the bus.
* "What about June?" or "Show me 21 June in 15-minute blocks." The agent gives the month's
  figure, the hours the plant generates that day, and the largest block's arithmetic.
* "I get 1,719 million units for year 5, is that right?" The agent says whether the figure
  matches. If not, it says what the figure leaves out (the year's degradation, the losses to the
  bus) or by how much it differs.
* "Where did the rest of the energy go?" The agent gives the generation, what was delivered and
  sold, and what was curtailed or lost.

The agent names the Excel cell for each figure. Without a microphone, or without a voice key on
the server, "Check the energy" in the agent's panel asks the same question typed: technology,
year, and the user's own figure. `tools/check_seci_agent.mjs` and `tests/e2e/test_seci_tab.py`
check both.

`tools/check_generation.mjs` checks that the formula gives the dispatch's own generation for every
year in the What-if tab, Round the clock (one site and split sites) and Tender to Bid (the profile
and losses the HiGHS sizing receives). It also checks that the months add up to the year and that
the 15-minute blocks keep each hour's energy. `tools/check_live_model.mjs` recalculates the section
in LibreOffice.

## Peak Hours: the 6 costliest hours each day

SECI RTC-TM-V lets the Buying Entity choose any 6 hours a day, day-ahead, between 18:00 and 10:00
the next morning (Amendment-01 p. 2; PSA p. 18). The new default plan in the SECI tab and the
What-if tab, "The 6 costliest hours each day" (`web/src/seci/peakPrices.js`), works as follows:
* Each day, the 6 hours of that window with the highest IEX Day-Ahead Market prices are held to the
  90% peak floor (`web/public/market/iex_hourly_prices.json`, Sep 2025 to Sep 2026). A buyer
  would most likely pick these hours.
* Every other hour, including the window's other 10, is held to its own floor: under Amendment-03,
  50% in the Solar Hours and 70% in the Remaining Hours (before it, 70% off-peak).
* The hours change from day to day. The sizing (HiGHS), the 15-minute dispatch, the What-if
  dispatch and the charts all get them hour by hour.
* The bid checklist's "Peak hours" row says which hours are picked most often (18:00–24:00 on
  these prices) and their average price against the whole window: ₹7.41 against ₹5.45/kWh.
* The agent's Peak Hours chart shows how often each hour is picked.

Until the prices load, this plan holds all 16 window hours, as "Any 6 of the 16 hours" does.
That plan (the safest) and "Evening 18:00–24:00" remain as choices.

On a 200 MW bid with the benchmark inputs, sized with HiGHS and the shortfall penalty allowed:

| Peak Hours plan | Tariff | Solar / wind | Battery | Peak hours met (year 1) | Short (worst year, peak / off-peak) |
| --- | --- | --- | --- | --- | --- |
| Any 6 of the 16 hours | ₹7.04 | 523 / 293 MW | 423 MW / 1,692 MWh | 85.8% | 109.3 / 0.5 MU |
| The 6 costliest hours each day | ₹6.50 | 432 / 311 MW | 297 MW / 1,188 MWh | 85.1% | 32.1 / 81.2 MU |

With only 6 hours a night held to 90%, the plant needs a smaller battery and the tariff falls by
₹0.54/kWh. The optimiser then accepts some off-peak shortfall at 1.5 × tariff where that costs
less than more plant. Choose "Meet every block" to rule that out.

`tools/check_peak_prices.mjs` checks the following on the price file:
* each window gets exactly 6 hours;
* they are its costliest hours, and none falls outside the window;
* the sizing request carries them;
* the charts' floors and the What-if dispatch use them.

## Team mode

Every input box of every tab has a send icon. It opens the box's thread, where you ping a teammate
with `@name`. They see it under **Messages** (sidebar), open the field from there and reply, with a
value if they have it. The asker puts the value in the box with **Fill in**. **Team setup**
(sidebar) assigns each person:

* a role (a team, and whether they are a super admin);
* a title;
* the tabs they cover (they come first in the @ suggestions).

`docs/TEAM.md` has the details.

## TenderOS in Claude (MCP connector)

TenderOS serves a remote MCP server at `/api/mcp/<MCP_TOKEN>`. Add it to claude.ai or Claude
Desktop as a custom connector, and Claude can:

* search the tender with page links;
* size a bid with HiGHS and read its financials;
* check a quoted tariff;
* run What-if;
* explain the winning bid.

`docs/MCP.md` has the setup and a demo script.

## SECI Amendment-03 and the winning bid

**Amendment-03** (25.06.2026, `web/public/tenders/seci-rtc-tm-v/Amendment-03.pdf`) renamed the
tender SECI-FDRE-RTC-V and rewrote its supply profile. It is in the tender pack with its 8 changes,
and the conditions it amends cite its pages. The model sizes it by default (`docs/SECI_RTC.md`,
"How the tender's supply rules reach the engine"):

| Hours | Floor | Most the buyer takes |
| --- | --- | --- |
| Peak Hours (6 a day, the buyer's pick in 18:00–10:00) | 90% | the contract |
| Solar Hours (GRID-INDIA's for the State; 08:00–18:00 assumed) | 50% | 60% |
| Remaining Hours | 70% | the contract |

Every block's shortfall costs 1.5 × the tariff. Above 60% in a Solar Hour, the buyer has the first
right to the power at half the tariff. With market sales on, the model sells each such MWh to
whichever pays more, so it earns min(market price, 0.5 × tariff).

The sizing, the 15-minute dispatch, the finance, the Excel workbook (Live model and dispatch
sheets), the What-if tab, the charts, the hourly tooltip, the checklist and the bid agent all
follow it. "Before Amendment-03" on the What you bid step gives the earlier terms (90% peak, 70%
off-peak) to compare.

On the default 200 MW bid (benchmark inputs, costliest-hours plan, nothing sold), the profile
moves the tariff from ₹6.50 to ₹7.46/kWh. The plant shifts to 2.22 MWac of solar, 1.19 MW of wind
and 8.6 MWh of battery per contracted MW. Solar Hours deliver at most 60%, so the battery must
carry more of the night.

**Winning bid** (step 8 of the SECI tab, after Bid forms; `web/src/seci/WinningBid.jsx`,
`winningBid.js`) bridges from ₹6.50 to the winners' ₹5.25 one change at a time:

* Amendment-03;
* green-market purchases;
* battery cost;
* selling the Solar Hours surplus;
* finance;
* wind.

Beside the bridge it shows:

* what one winner disclosed against the bridge's design;
* the biggest levers, and each change on its own;
* which results compare;
* what could not be verified.

## Faster sizing: each run starts from the last

The HiGHS sizing finds the least tariff in rounds. Each round is one full solve of the 25-year
hourly model: guess a tariff and the years the project pays tax, solve, update both, and stop
when they agree. The first solve, from cold, takes most of the time: on the SECI 200 MW case about
60–95 s, whichever HiGHS method or thread count is used (measured). The number of rounds and their
cost depend on how far the starting guess is from the answer. With "₹5.50, tax paid from year 1",
the design moves a long way before the tax years settle (year 10 here).

Each sizing now starts from a design (`seed` in the request, `rtc_lp.solve`):
* the last sizing of this bid, scaled to the bid size (`state.sizingSeed`, kept when an input
  change clears the result);
* else, on the SECI tab, a typical SECI RTC-TM design per contracted MW (`seciTerms().typicalSeed`).

The design's tariff and tax years start the first solve. The optimum is the same. Measured on the
SECI 200 MW bid:

| Start | Time | Rounds |
| --- | --- | --- |
| ₹5.50, tax from year 1 (before) | 116 s | 5 |
| The typical SECI design (first sizing) | 55 s | 1 |
| The last sizing, after wind capex +5% | 53 s (93 s before) | 2 |
| A rough design (sizes −15%, tariff +6%) | 73 s | 3 |
| The costliest-hours design, sizing "Any 6 of 16" | 76 s (103 s before) | 4 |

The sizing also puts a negligible cost (₹0.001/kWh) on every MWh the battery charges or
discharges, as the 15-minute dispatch does. Of two dispatches worth the same, it picks the one that
uses the wind or the sun before the battery. Before this, an hour could curtail wind while the
battery discharged (Jan 05:00 in the SECI chart). Now no hour does: 0 of 3,461 discharge hours.

The supply floor table now reads "Met in every block (lowest 90.0%)" when a floor holds. The
lowest block is that block's supply as a share of contracted capacity. When a floor does not hold,
the table gives the share of blocks met and the energy short. "Above the floor" in the hour's
Sankey is energy delivered between the floor and the contracted capacity. The procurer pays the
tariff for it; it is not a requirement.

`tests/engine/test_rtc_lp.py::test_a_seed_reaches_the_same_optimum_in_fewer_solves` (slow) checks
the following:
* a seeded sizing reaches the same tariff in fewer rounds;
* a seed that does not fit is ignored.

`tools/check_bid_model.mjs` checks the seed's scaling.

## Excel: every year's energy from hour-by-hour formulas

The HiGHS sizing models a few years hour by hour: year 1, year 25, and any battery augmentation
years. It interpolates the years between them. The bid workbook now carries those modelled years as
sheets "Dispatch Y1" and "Dispatch Y25" (`web/lib/dispatchSheets.js`), 8,760 rows each. Every
number on them is a formula except the following:
* the inputs, in blue: each hour's solar and wind capacity factor at the 33 kV bus, and whether it
  is a Peak Hour;
* the optimiser's three choices each hour, in green: how much the battery charges and discharges,
  and how much is sold.

| Column | Formula |
| --- | --- |
| Solar, wind output (MW) | MW × the hour's capacity factor × the year's degradation factor |
| Direct to the PPA | MIN(contract ÷ share to the meter − discharge, generation − charge − sold); in a Solar Hour (Amendment-03) the contract is × 60% |
| Curtailed | generation − direct − charge − sold |
| Battery energy | last hour's + charge × η − discharge ÷ η (η = √ round trip), from the year's start level |
| Delivered, at the meter | (direct + discharge) × share reaching the meter |
| Floor, short | contract × the hour's floor (90% peak; 50% Solar Hours and 70% Remaining Hours under Amendment-03, 70% off-peak before it); MAX(0, floor − delivered) |

Each sheet's year totals are SUMs of its hours. In the Live model, "Contracted energy",
"Delivered to the procurer", "Short of the time-block floors" and "Sold in the market" are formulas
on those totals, weighted between the modelled years as the sizing interpolates. Only the hourly
choices remain green.

The LP always delivers what it can (each MWh earns the tariff), so the MIN formula gives its own
direct supply. On the SECI 200 MW sizing the formulas give the LP's delivered energy and
shortfall to the MWh, and the battery never goes below its minimum
(`tests/engine/test_rtc_lp.py::test_the_dispatch_sheets_formulas_give_the_lps_energy`, slow).

* **When the sheets are written.** The sizing returns the hours (`returnDispatch`, about 0.4 MB).
  The browser keeps them beside the result for the session, not in the saved bid. A bid opened from
  a save shows the yearly values until it is sized again.
* **Which plants.** The sheets are written for solar, wind and a battery on one site with a flat
  contract. Other plants keep the yearly values.
* **In the traceable model.** "Delivered" reads "Year 1 hour by hour · Delivered … · 8,760 hours
  summed". Opening it shows any day's 24 hours with each column worked out, the optimiser's choices
  in green.

`tools/check_dispatch_sheets.mjs` builds a workbook with the sheets and has LibreOffice
recalculate every formula from no stored value: 159,751 formulas in about 6 s, a 2.8 MB file. All
match the app. `tests/e2e/test_seci_tab.py` checks the SECI download and the trace's drill-down to
the hours.

## Solar plant studio

`web/src/plant/solar.js` and `SolarStudio.jsx`. Open it from the solar source in Supply sources,
or from What-if.

* **Layout.** It starts from the AC capacity, the DC:AC ratio and the module (TOPCon 580/620/700 Wp,
  PERC 545 Wp, typical datasheet values). From there it works out:
  * modules per string, from the cold-morning Voc and 1500 V;
  * strings, modules, and fixed-tilt tables (2P) or single-axis trackers (1P);
  * inverters and blocks, with one IDT per block for string inverters or MV-skid stations for
    central ones;
  * land, from the ground cover ratio plus 25% for roads and setbacks, with the row pitch.

  A plan view draws the blocks and the pooling station.
* **Cost build-up in ₹/Wp.** One line per component: modules, structure, DC cables and combiners,
  inverters, LV AC and IDTs (string only), 33 kV cables, switchgear, SCADA, earthing, optional
  robotic cleaning, civil, buildings, installation, transport and engineering. On top come the EPC
  margin, contingency, GST (equipment and services shares at their rates) and land.
  * Every price is editable.
  * Totals are shown in ₹/Wp, ₹ cr/MWp and ₹ cr/MWac.
* **String or central.** The same plant with each inverter type: units, blocks, transformers,
  inverter equipment in ₹/Wp, European efficiency, availability and plant cost.
* **Use in the bid.** Writes ₹ cr/MWac and the DC:AC ratio into the solar source.

The defaults are indicative 2025–26 market figures, not from any tender; the studio says so.

## Wind farm studio

`web/src/plant/wind.js` and `WindStudio.jsx`.

* **Turbines.**
  * Vestas V155-3.3 and V150-4.2
  * GE Vernova 2.7-132 and 3.6-154
  * Suzlon S144 and S133
  * Siemens Gamesa SG 3.4-145
  * Envision EN-156/3.3
  * Inox 3.3 MW
  * Adani AW 5.2-160

  Each has its rated power, rotor and usual hub height.
* **Power curves.** Generic, rotor-limited curves, not the makers' certified ones; the studio says so.
* **CUF.** Each turbine's capacity factor comes from the site's mean wind, moved to hub height by
  the shear exponent, on a Weibull distribution, after availability, wake, electrical and other
  losses. The table compares every turbine at the same site, alongside its specific power.
* **Farm.** Turbines, energy, the area at the chosen spacing (in rotor diameters), land bought, and a
  plan.
* **Cost build-up.** ₹ cr/MW lines (turbines with towers, 33 kV lines, pooling substation,
  foundations, erection, roads, engineering), then contingency, GST and land.
* **Use in the bid.** Writes ₹ cr/MW and the net CUF into the wind source.

`tools/check_plant.mjs` checks both studios:

* string voltages, block and IDT counts;
* that the cost lines add up and convert between units;
* that a price change carries margin, contingency and GST;
* that the curves are monotone and capacity factors rise with the wind;
* that a lower specific power gives a higher CUF.

## Profiles on screen

Each solar and wind source shows its hourly profile (`web/src/plant/ProfileView.jsx`):

* the CUF used in the bid, and the uploaded file's own CUF when the profile was scaled to it;
* the highest hour and the hours at zero;
* the best and worst month;
* a month × hour heat map, the monthly CUF, and one week hour by hour.

It opens by itself when a profile has been uploaded.

Two downloads, built in the browser (`web/src/plant/cufFile.js`, no server call):

* **Download CUF file**: a CSV of the 8,760 hours with the hour of the year, month, day and hour,
  the capacity factor as used in the bid (the profile scaled to the CUF entered) and, when a file
  was uploaded, the file's own capacity factor. A header block of `#` lines names the source (the
  uploaded file or the typical profile), the CUF entered, the CUF of the file, where the CUF is
  measured, the degradation per year and the date.
* **Download 25-year CUF table**: one row per PPA year (the tender's term, 25 by default) with
  the degradation factor the model applies (`yearFactors` in `web/src/rtc/engine.js`:
  `(1 − d)^(year − 1)`), the CUF that year, the energy per MW (CUF × 8,760) and the cumulative
  energy.

A **25-year justification** panel (`web/src/plant/justification.js`) explains, in plain words, why
one year's hourly profile stands for the PPA: the typical meteorological year method (the profile
is the shape, the CUF the level), the P50 level and what P75/P90 mean, with inputs for the P50
CUF (prefilled with the bid's) and an optional P90 CUF from the assessor, the typical year-to-year
variability of the technology (solar ±3–5%, wind ±8–12%, stated as typical ranges and not site
data), the degradation the model applies and the CUF in the last year, the evidence to attach
(data source, period, measuring point, independent assessor's report, degradation basis), and what
the model does not capture (grid curtailment, availability). Every number comes from the bid's
inputs. **Download justification (Word)** posts the paragraphs and the by-year table to
`POST /api/plant/justification`, which writes the .docx with `web/lib/docx.js`.
`tools/check_cuf_file.mjs` checks the CSVs and the text.

## What-if analysis

A tab of its own (`web/src/whatif/model.js` and `WhatIfTab.jsx`).

* **Inputs.**
  * The contracted capacity, the Peak Hours plan and the shortfall rule.
  * Solar MWac and DC:AC, wind MW, and battery MW and hours.
  * CUFs, losses, costs and O&M (the studios can fill the costs).
  * Financing and tax, and the bid tariff.
* **Dispatch.** Every PPA year is dispatched hour by hour, with degradation and battery fade:
  * renewable output serves the contract and surplus charges the battery;
  * in the Peak Hours the battery discharges to the full contract, outside them only up to the
    off-peak floor, keeping energy for the peak;
  * energy is counted at the billing meter.

  This is a rule-based, instant check of a size, not the HiGHS optimum; the tab says so. A run
  takes about 150 ms.
* **Returns at the bid tariff** (the app's 25-year model):
  * equity, project and lender's IRR, and the DSCR against the lender's minimum;
  * equity NPV, LCOE, payback and year-1 supply;
  * the tariff the target IRR needs, with a button to bid at it;
  * the IRR curve against the tariff, and a week of supply against the block floors.
* **Tender checks.**
  * Hard checks: the bid range (50–300 MW), the battery (mandatory), and renewable sources.
  * Each floor's share of hours met in year 1 and in the worst year, with the energy short and its
    1.5 × tariff penalty.
  * Verdict: *compliant*, *compliant with block penalties*, or *not compliant* (a hard check fails,
    or a block falls short under "meet every block").
* **Year by year.** A table, with the full traceable model.

`tools/check_whatif.mjs` checks the What-if model:

* the energy balances, and the floors counted over all 8,760 hours;
* that the battery's discharge leans to the peak;
* that returns move the right way with the tariff, costs and size;
* that the tariff needed gives the target IRR, and the lender earns the interest rate;
* that the checks refuse no storage and too small a bid;
* that the traceable model reproduces the returns.

## Enterprise financing: construction, repayment, working capital, refinancing

The 25-year model (`web/src/rtc/engine.js` `cashflows`) and its Excel twin (`web/lib/liveModel.js`)
carry the finance team's full set of terms. Every one of them is a formula in the workbook, and
`tools/check_live_model.mjs` recalculates each case with LibreOffice to the app's numbers.

* **Construction, month by month** (`constructionSchedule`). Construction months, a drawdown
  profile (even, S-curve, front-loaded, back-loaded) and the funding order (debt and equity pro
  rata, or equity first). The cost before IDC is spent month by month; the interest during
  construction accrues on the debt drawn (on the balance at the start of the month plus the
  month's draw) and is capitalised as debt. The debt share applies to the cost before IDC, so
  there is no circularity: debt = share × cost + IDC. With 0 months the IDC stays inside the
  pre-operative share, as before. The workbook gets a **Construction** sheet with the table, linked
  to the Live model's inputs; the app shows it on the Financial model step (`ConstructionView.jsx`).
* **Repayment methods** (`REPAYMENT_METHODS`, `principalOf`): equal principal, annuity (level debt
  service), sculpted to a target DSCR (principal = CFADS ÷ target − interest; the last year clears
  the balance), balloon (a share in the last year, the rest in equal parts), bullet, step-up (the
  principal growing at a rate a year). A principal moratorium (years within the tenor, interest
  paid). Instalments a year (1, 2, 4, 12): the balance is paid down through the year, so the
  interest is on the average balance ((n − 1) ÷ 2n of the year's principal less); sculpting is
  worked out yearly. The tenor is door to door.
* **Refinancing**: at the end of a chosen year, a new rate and tenor; the fee on the balance is
  expensed that year; the schedule continues under the same method with the years left.
* **Working capital** per CERC norms: receivable days, O&M in hand (months), maintenance spares
  (% of the year's O&M), interest on the working capital (expensed; 0 means equity funded); the
  balance is released at the end of the term.
* **Debt service reserve**: months of the next year's debt service, put aside from the equity
  cash and released as the debt service falls and at the end; it does not touch the DSCR.
* **The Excel sculpting trick.** The sculpted principal needs the tax, which needs the interest, so
  the sheet carries a small tax chain of its own for sculpting (on the interest on the opening
  balance), which keeps every method switchable in Excel without a circular reference.

`tools/check_live_model.mjs` adds three cases: an 18-month S-curve build with IDC, a 1-year
moratorium, sculpted repayment at 1.35×, CERC working capital with interest, a 6-month DSRA and
DSM charges; a balloon repayment with quarterly instalments refinanced in year 6; and a step-up
repayment with monthly instalments and an equity-first back-loaded build.

## Deviation settlement (CERC DSM)

`web/src/dsm/dsm.js` and `DsmPanel.jsx`. The sizing dispatches with perfect foresight, so the
deviation comes from a forecast-error assumption: the error in a 15-minute block, as a share of
the schedule, is normal with a standard deviation by category (solar 8%, wind 12%, hybrid 9%,
editable), cut by a battery's firming share. Every MWh scheduled then carries the same expected
charge, a line in the contract rate (a × tariff + b), so the financial model applies it to the
tariff it solves for and the Excel model carries it as a formula. The norms follow the CERC
(Deviation Settlement and Related Matters) Regulations, 2024 structure: a tolerance band (±10%
solar and hybrid, ±15% wind; ±5% and ±10% from FY2026-27), the X factor (the in-band share settled
at the contract rate: 100% in FY2026-27 winding down to 0 from FY2031-32), the rest of the in-band
deviation at the normal rate (dear when the plant is short, cheap when long), and steps beyond the
band charged at 110 / 150 / 200% of the contract rate for under-injection and paid at 90 / 50 / 0%
for over-injection. The numbers are inputs: check them against the notified text and the orders of
the day. The year's charge is an operating-cost line ("Deviation settlement charges").
`tools/check_dsm.mjs` checks the block charge, the bands by year, the firming and the model line.

## Steps by team, the site schematic and the What-if after sizing

* The SECI flow runs **Tender & amendments → Bid conditions → Bid inputs (Projects) → Design →
  Finance inputs → Size → Financial model → What-if → Bid forms → Winning bid**; each step chip names
  its team. Design holds the sources, the losses and the sites; Finance inputs holds the financing
  terms, repayment and refinancing, construction and IDC, working capital and reserves, and the DSM
  norms, and ends with "Size the plant". The paperclip on every box (Evidence, docs/TEAM.md) carries
  the evidence and the sign-off.
* **Site schematic** (`web/src/bid/SiteSchematic.jsx`): one line diagram of the plant. One site:
  solar, wind and the battery on one 33 kV bus, one pooling station (33/220 kV transformer) and one
  220 kV line to the billing meter. Separate sites: a bus, a battery, a pooling station and a line
  per site, each with its own losses (`siteFactors`). The sizing dispatches at one evacuation factor
  (the wind site's) and the solar profile is scaled by the ratio of the two, so each site's energy
  carries its own losses (`tools/check_bid_model.mjs`).
* **What-if after sizing**: the What-if step starts from the plant HiGHS sized and every input of the
  bid (`whatIfFromBid`); "Back to the sized bid" restores it. **Tariff levers** (`whatif/levers.js`,
  `LeverPanel.jsx`, also on the What-if tab): set the tariff you want to quote, compute the levers,
  and each row gives the tariff with that input one step up and one step down, the ₹/kWh per step,
  and how far that lever alone would have to move to reach the tariff (Apply moves it). About a
  second for twenty levers.

## Zones

`TENDEROS_ZONE` (docs/enterprise/ARCHITECTURE.md): `intake` reads tenders with cloud models, `core`
is the bid workspace on the client's network, anything else is one installation with everything.
In the core the engine pass-through refuses the tender-reading routes (`web/lib/zone.js`
`zoneAllowsEngine`) and the voice agent is off; the sidebar shows the zone and the version
(`/api/health`). `deploy/enterprise/` holds the signed bundle, the installer and `tenderos-patch`.

## Recent tenders

A tab of its own (`web/src/market/`).

* **SECI results** (`seed.js`). Eight recent auctions, read from SECI's own result notices
  (Tenders › Results › View Bidder Detail on www.seci.co.in):
  * Wind Tranche XIX and XX;
  * FDRE-RTC-V and RTC-IV;
  * FDRE-VII and FDRE-IX (peak power);
  * ISTS-XX and ISTS-XXI (solar with storage).

  Each record gives the RfS number and date, the dates of the e-reverse auction and the LoAs,
  every awarded bidder with the capacity it bid, the capacity awarded and its tariff, and the
  bidders not awarded at their final tariff. Each links its notice. `tools/check_market.mjs`
  checks that the awards add up, that no bidder got more than it bid, and that no unawarded
  bidder was below the highest awarded tariff.
* **CERC orders.** Upload a tariff-adoption order (PDF). The engine (`engine/market/cerc_order.py`,
  `POST /api/bid/cerc-order`) reads its petition, date of order, petitioner, capacity, tariffs and
  successful bidders, each with its page and quote, using rules over the text, no model. The order
  is then stored (`market_orders`, migration 010, the PDF in the files volume).
  * Correct any field, add bidders, and save it as checked.
  * A scan with no text layer is refused with that reason.
* **Chart.** Every discovered tariff side by side.

`tests/engine/test_cerc_order.py` checks the reader and its route.

## Tests

| Command | Covers |
| --- | --- |
| `make check-web` | adds `check_trace`, `check_generation`, `check_peak_prices`, `check_dispatch_sheets`, `check_plant`, `check_whatif`, `check_market`, `check_dsm`, `check_cuf_file` and `check_evidence`; `check_live_model` and `check_bid_model` cover the enterprise financing and the pooling stations |
| `make test` | adds `tests/engine/test_cerc_order.py` |
| `make e2e` | adds `tests/e2e/test_demo2.py`: the traceable model from Round the clock, both studios writing into the SECI bid and the profile view, the What-if returns and checks, a dispatch number traced to its generation formula, months and 15-minute blocks, and a CERC order uploaded, read, checked and deleted |
