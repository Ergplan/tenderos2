# FDRE-X bid (SECI-FDRE-X)

The **FDRE-X Bid** tab works a bid for SECI's tender SECI-FDRE-X: RfS No.
SECI/C&P/IPP/13/0012/26-27 dated 07.10.2026, assured peak supply of 4,800 MWh (1,200 MW × 4 hours)
from ISTS-connected RE projects with energy storage, under a 25-year PPA with SECI. It has the
flow and depth of the CfD Bid tab: twelve steps from what the tender asks to the upside, a bid
agent by voice, a written analyst, the financial model as a workbook of formulas, the RfS's bid
formats filled from the bid.

The code is `web/src/fdrex/`, a fork of `web/src/cfd/` (as the CfD tab was forked from the SECI RTC
tab): the same file names, the same stylesheet (`web/src/cfd.css`, `web/src/cfd/*.css`) and the
same `cfd-…` test ids, so a fix in one tab can be carried to the other file by file. Function
names inherited from the CfD model are kept (`defaultCfdState`, `runCfdFinance` …). The CfD tabs
are not touched by this tab.

## The tender, from its documents

| Document | File (`web/public/tenders/seci-fdre-x/`) | Pages |
| --- | --- | --- |
| RfS, 07.10.2026 | `RfS.pdf` | 138 printed (the PDF has a cover first: PDF page = printed + 1) |
| Standard PPA (SECI and the developer) | `Standard-PPA.pdf` | 84 |
| Standard PSA (SECI and the Buying Entity) | `Standard-PSA.pdf` | 33 |
| Amendment-01, 29.10.2026 | `Amendment-01.pdf` | 7 |

* `terms.js`: 450 conditions, each with its document, clause, printed page and a word-for-word
  quote; `tests/engine/test_fdrex_terms.py` checks every quote against its page. `TENDER` there is
  every number the documents state. Fourteen terms are marked `conflict` where the documents
  disagree (for example PPA 4.4.1(a)(i) says "Project Capacity" where the RfS says Contracted
  Capacity; the Success Charges clause against its own illustration).
* `pack.js`: the documents with summaries, the twelve rows of Amendment-01 (all deletions: PPA
  6.1.6 to 6.1.11 and the mirror PSA provisions, the Buying Entity's resale and scheduling
  rights), the schedule (dates from SECI's website are marked as such), how the bid goes, points
  to raise with SECI. `formatsData.js`: the RfS's 23 bid formats with every blank quoted on its
  page. `tools/check_fdrex_content.mjs` checks the quotes of both.
* `tender.js`: the numbers the model applies: `terms.js`'s `TENDER` plus the model's own readings
  (below) and the names the model inherited from the CfD model (`essScdMonths`, `loaToEdDays`,
  `cacLakhPerMw` for the Success Charges).

What the tender asks, in the model's terms:

| | SECI-FDRE-X | Where |
| --- | --- | --- |
| Supply | 4 MWh per MW of Contracted Capacity a day, 1 MWh per MW in an hour, in 4 hours the Buying Entity chooses each day (by 06:00) from the non-solar hours | RfS 8.1.a–c, PPA 4.4.1.a |
| Contract | PPA with SECI, 25 years from the SCSD, one tariff fixed for the term | RfS 20.2, PPA 9.1 |
| Sources | 100% RE; up to 5% of the year's energy from the green market or bilateral agreements, direct or through the storage, counted on the energy discharged; no other grid charging | RfS 8.1.e, PPA 4.4.1.a.vii |
| Shortfall | 1.5 × the tariff on a billing month's energy short beyond 10% | RfS 8.2, PPA 4.4.1.b |
| Other sale | The storage may sell to others outside the Peak Hours, the PPA first; SECI has the first right to excess generation at the tariff | RfS 8.1.f, PPA 9.3 |
| Connectivity | ISTS at 220 kV or above, with injection rights in the non-solar hours, applied for before the bid, for at least the Contracted Capacity | RfS 7.1, 7.2 |
| Dates | Effective Date 15 days after SECI's invitation to sign; SCSD 18 months later, for the whole Project; Financial Closure 6 months before it; up to 6 months' delay with the PBG encashed | RfS 20.4, 9.2, 21.1 |
| Bid | 50 to 600 MW; e-reverse auction; 80% of the qualified capacity awarded; L1 + 2%; no ceiling tariff | RfS 5.1, 40, 41 |
| Money | EMD and PBG per MW and per MWh as CfD-I; PBG to 9 months after the SCSD; Success Charges ₹1 lakh per MW of Installed Capacity; PSM discount ₹0.02/kWh (the bidder's option) | RfS 16, 17, 18 |

## The model (`model.js`)

`simulate` runs every day of the 25 years, as the CfD model does, with this tender's rules:

* **The four hours.** The Buying Entity is taken to choose its four dearest hours of 18:00 to
  24:00 in the exchange chosen for market prices (`inputs.sellMarket`). This is the model's
  reading: the tender lets the buyer choose any four of the non-solar hours, evening to the next
  morning. A morning choice needs the same stored energy; it would change what the extra battery
  can sell.
* **The battery** must carry the whole 4 MWh per MW (`TENDER.essHoursMin = 4`, the model's
  requirement: the RfS makes storage mandatory and states no size). The nameplate grows with the
  state-of-charge window and the losses to the meter, as in the CfD model (`essRequiredPerMw`).
* **Charging** before 18:00 from own solar and wind first, then from the green market (hourly GDAM
  price plus charges) within 5% of the Contract Year's energy (`marketShare`), set on what the
  plant can supply. No group RE, no first-months allowance, no separate RE commissioning date:
  the inputs `reCodMonths`, `groupPrice`, `groupCharges`, `useGroup`, `recPrice` and `lcCostPct`
  do not exist here (`modelInputs` switches them off for the shared arithmetic).
* **Billing months.** Each year row carries `months` (`{ start, required, supplied, beyondMwh }`),
  where the CfD model has `weeks`: `beyondMwh = max(0, 0.9 × required − supplied)`, the PPA's own
  example. `penaltyCr(cy, tariff) = 1.5 × tariff × Σ beyondMwh`; `penaltyMwh(cy)` is the energy. A
  month is counted in the year its last day falls in.
* **Connectivity and surplus.** The tender asks for connectivity with non-solar-hour access (RfS
  7.2), so by default nothing is injected from 06:00 to 18:00 and the day's surplus solar is
  curtailed (`inputs.dayInjection = false`, a choice of the Bid inputs step, "Connectivity in the
  solar hours too"). With it on, surplus RE is sold at exchange prices on days the supply is met,
  within the connection. The difference is large: a 100 MW bid sized by the optimiser needs
  ₹8.87/kWh on a competitive bidder's inputs with non-solar-hour access only (112 MWac of solar,
  86 MU a year curtailed) and ₹7.01 with solar-hour connectivity too (132 MWac, the surplus sold);
  ₹10.03 and ₹8.16 on the plain benchmarks. SECI's first right to excess energy at the tariff
  (PPA 9.3) is not counted on in either case.
* `exchangeValue(sim, tariff)` gives, per Contract Year, what the energy supplied would cost the
  buyer on the exchange against the tariff (it stands where the CfD model has the Pool's flows).
* `psmDiscount(inputs)`: ₹0.02/kWh when the bid opts for the Payment Security Mechanism
  (`inputs.psm`, a choice of the Bid inputs step, on by default in the benchmarks).
* `rfsAmounts`: EMD, PBG and net worth on the installed capacities; the Success Charges on the
  Installed Capacity as RfS 18.1 defines it, the RE's MW plus the battery's rated MWh (the RfS's
  own illustration uses the awarded capacity instead, a conflict the conditions flag: the
  clause's reading, the larger, is budgeted);
  `BG_YEARS.pbg` from 15 days after the Effective Date to 9 months after the SCSD plus the claim
  period.
* Benchmarks and the competitive bidder's values (`BENCHMARKS`, `WINNING`): a 4 MWh per MW
  battery, an 18-year loan (20 for a competitive bidder) on the 25-year PPA, a 25-year book life,
  Effective Date 1 June 2027.

## The financial model (`finance.js`)

The shared engine (`web/src/rtc/engine.js`), as for the CfD bid:

* Revenue is the tariff on the energy supplied in the Peak Hours.
* The **monthly penalty** is the engine's tariff-multiple penalty: `ops[].blockShortfallMWh` is the
  year's `penaltyMwh`, `fin.blockPenaltyMultiple = 1.5`; the row is `blockPenalty`.
* **Charging power** bought is the cost line `charging`; the **PSM discount** on the energy billed
  and the **exchange fees** on what is sold in the market are the line `pxFees`.
* No Letter of Credit and no weekly penalty (`lcCostPct = 0`, `cfdPenaltyMultiple = 0`).
* The workbook (`cfdModelExport`, POST `/api/fdrex/model`) is the same workbook as the other tabs'.
  `web/lib/liveModel.js` takes the names of the bought-power, fee and penalty rows from the
  request (`labels`), and leaves out the Letter of Credit and weekly-penalty rows when a bid has
  none, so the Live model reads "Monthly shortfall penalty" and "PSM discount and exchange fees".
  The second version puts the 15-minute dispatch behind the energy
  (`web/lib/fdrexBlockSheets.js`: sixteen peak blocks a day, no group-RE sheet).

Notes shown beside the results (`MODEL_NOTES`): the whole project cost is spent before the SCSD;
years are operating years from the SCSD; the tariff is fixed; the evening-hours reading; the
non-solar-hour connectivity and what is sold.

## The steps

| Step | Files | What is this tender's own |
| --- | --- | --- |
| 01 What FDRE-X asks | `ExplainStep.jsx`, `ExampleStep.jsx`, `example.js`, `VisualModel.jsx` | A PPA purchase explained, not a CfD: what is bought, built, sourced, paid, penalised and earned besides; a worked day on the four dearest evening hours of the IEX year against the tariff; a short billing month's penalty (`shortfallPenaltyLakh`); the flow diagram with the surplus curtailed or sold by the bid's connectivity choice |
| 02 Tender & amendments | `DocumentsStep.jsx`, `pack.js` | Four documents, the schedule (website-only dates badged), the twelve deleted rows of Amendment-01, the bid process, queries for SECI |
| 03 Bid conditions | `ConditionsStep.jsx`, `terms.js` | 450 terms in eleven groups, the deleted ones beside what replaced them, fourteen conflicts |
| 04 Bid inputs | `BidInputsStep.jsx` | The Effective Date of the PPA and its dates; the choices `useMarket`, `merchant`, `dayInjection`, `psm`; the money at stake with the Success Charges |
| 05 Design, 06 Finance inputs | `DesignStep.jsx`, `FinanceInputsStep.jsx`, `AugmentationTable.jsx` | The battery for the four hours; tenor and refinancing up to 25 years |
| 07 Size | `SizeStep.jsx`, `checks.js`, `review.js`, `dispatch15.js` | The checks `capacity`, `ess`, `market` (5% of the energy required), `daily`, `monthly`; the Bid review's findings (`market-limit`, `monthly-penalty`, `no-day-connectivity`, `day-connectivity`, `surplus-re`, `buyer-hours`, `psm`, and the price against SECI's peak-power awards); the 15-minute dispatch with sixteen peak blocks and the curtailed energy |
| 08 Financial model | `FinanceModelStep.jsx`, `MarketPrices.jsx`, `finance.js` | The tariff after the PSM discount, the monthly penalty, the exchange price of the hours supplied, the curtailed energy; the midday price band matters only for bought power and, with solar-hour connectivity, the surplus |
| 09 What-if | `WhatIfStep.jsx`, `levers.js`, `leverNotes.js`, `track.js`, `TrackView.jsx`, `Freeze.jsx` | 36 levers with this tender's ranges and notes; evidence filed under the tab `fdrex` |
| 10 Bid forms | `BidForms.jsx`, `formats.js`, `formatsData.js`, `forms.js`, `letters/` | 23 formats: EMD and PBG as bank guarantee, Payment on Order Instrument or surety bond; Annexure-K when another entity's connectivity is used; Annexure-H after the award; the PSM choice in the Covering Letter from `inputs.psm`; the Success Charges from `rfsAmounts` |
| 11 Reference bids | `ReferenceBids.jsx`, `winning.js` | The tariff against SECI's earlier firm and peak-power awards (not like for like: they say so), against the exchange price of the four hours (`tariffAt`, `tariffTable`), the auction's arithmetic (`awardCapacity`, `h1Dropped`, `awardList`), thirteen risks |
| 12 Upside | `UpsideStep.jsx`, `upside.js`, `web/lib/fdrexUpside.js` | Day injection follows the bid's connectivity; without it the cases carry a "with solar-hour connectivity too" what-if |
| The agents | `agent.js`, `voice.js`, `web/lib/fdrexAgent.js` | The voice agent's tools and script on this tender (`check_tariff` on the full model); the written analyst with the fdrex model as its tools |

Known limits: the engine's average DSCR is a plain mean over the debt years, so a small last
instalment of a sculpted loan can make it read very high (the minimum DSCR is the figure to
read); `shortfallCauses` does not attribute short days to battery fade when the bid has wind;
the third-party-sale penalty (RfS 8.1.f) is not priced, because the model never sells while the
PPA is short; the Python end-to-end test of the CfD tab has no FDRE-X counterpart yet.

## The own-RE optimiser

The same search as the CfD tab's (`docs/CFD.md`, "The own-RE optimiser"): whole MW, no short day
for "meet", the tab sizing the own RE again whenever an input changes unless the size is the
bidder's own. Checked on 48 FDRE-X combinations (50, 100 and 150 MW; the green market on and off;
surplus sale on and off; solar-hour connectivity on and off; both policies) against every whole MW
of solar from 0 to 4 × the capacity: the exhaustive best on all 48.

## Where it is registered

Tab id and library module `fdrex` (`web/src/main.jsx`, `web/lib/tabs.js`, `web/lib/scenarios.js`,
migration `020_fdrex_module.sql`); this browser keeps the bid under `fdre.fdrex.v1`. Routes under
`/api/fdrex/` (model, dispatch15, forms, letters, agent, upside) allow the tab `fdrex`; the voice
agent's session route `/api/seci/live` takes `tab: "fdrex"`.

## Checks

* `tools/check_fdrex_model.mjs`: the tender's numbers, the inputs, the dates, the day-by-day
  operation (four evening hours, 1 MWh per MW in an hour, bought power within 5%, the billing
  months), the PPA's own penalty example, the financial model (the tariff for the target IRR, the
  PSM discount, the monthly penalty in the engine), the optimiser, and that the workbook request
  carries nothing of CfD-I.
* `tools/check_fdrex_content.mjs`: every quote of the pack and the formats on its PDF page.
* `tests/engine/test_fdrex_terms.py`: every quote of the 450 terms on its page.
* `tools/check_fdrex_forms.mjs`, `check_fdrex_agent.mjs`, `check_fdrex_winning.mjs`,
  `check_fdrex_review.mjs`, `check_fdrex_whatif.mjs`: the forms and letters, the agents, steps 01
  and 11, the Bid review with the 15-minute dispatch, the levers, track and upside.
* `tools/check_fdrex_blocks.mjs`: the workbook with the 15-minute dispatch behind its energy,
  recalculated in LibreOffice (about 2.3 lakh formulas; it runs itself with a larger heap).
* `tools/check_live_model.mjs`: the case "SECI-FDRE-X …" and the workbook "SECI-FDRE-X bid" are
  recalculated in LibreOffice with the others.
