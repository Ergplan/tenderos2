# TenderOS Demo 2

Demo 2 is Demo 1 (`Ergplan/tenderos`, commit `3a3aa62`, day and night mode) with five additions.
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

`tools/check_generation.mjs` checks that the formula gives the dispatch's own generation for every
year in the What-if tab, Round the clock (one site and split sites) and Tender to Bid (the profile
and losses the HiGHS sizing receives). It also checks that the months add up to the year and that
the 15-minute blocks keep each hour's energy. `tools/check_live_model.mjs` recalculates the section
in LibreOffice.

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
| `make check-web` | adds `check_trace`, `check_generation`, `check_plant`, `check_whatif` and `check_market` |
| `make test` | adds `tests/engine/test_cerc_order.py` |
| `make e2e` | adds `tests/e2e/test_demo2.py`: the traceable model from Round the clock, both studios writing into the SECI bid and the profile view, the What-if returns and checks, a dispatch number traced to its generation formula, months and 15-minute blocks, and a CERC order uploaded, read, checked and deleted |
