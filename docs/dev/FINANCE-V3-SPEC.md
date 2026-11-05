# Financial model v3: the finance team's inputs of 4 November

The client's finance team listed 45 changes to the financial model (`docs/enterprise/…`, workbook
`TenderOS_0411_CFteaminputs.xlsx`). This specification turns them into inputs, formulas, rows and
screens for the shared financial model (`web/src/rtc/engine.js` `cashflows` / `runFinancialModel`),
its workbook twin (`web/lib/liveModel.js`), the finance screens (`web/src/rtc/FinanceView.jsx`,
the Finance inputs steps) and the tabs that use them: Tender to Bid, Round the Clock, SECI RTC
tender, CfD Bid and What-if. The BESS Tender tab has its own capacity-charge model and is out of
scope here.

Binding rules for every stream:

1. **Every new input is off by default** and, when off, changes no number: the eight cases of
   `tools/check_live_model.mjs` and `tools/check_rtc_engine.mjs` keep their values.
2. **Names below are the contract.** Input keys live under `state.fin`, `state.costs` and
   `state.bess` as named here; row keys on `finance.rows[y]` as named here. A stream that must
   deviate updates this file in the same change and says so in its report.
3. **The workbook mirrors the engine line for line**, every number a formula on the inputs, and
   `tools/check_live_model.mjs` proves it against LibreOffice for every feature below.
4. Plain wording on screen, Indian units (₹ cr, lakh, MU), no model identifiers anywhere.

## 1. Timeline with dates

| Input | Key | Default | Meaning |
| --- | --- | --- | --- |
| Commercial operation date | `fin.codDate` | `null` | ISO date of the SCOD / COD. Year y runs from `cod + (y−1) years` to `cod + y years`. Each tab seeds it from its tender: SECI RTC `terms.supplyStart` (the SCSD), CfD the SCD (`keyDates().scd`), Tender to Bid `terms.supplyStart`, Round the Clock an input on the Finance chapter. |

Engine: `rows[y].start` and `rows[y].end` (ISO) when `codDate` is set, else `null`; `finance.timeline = { codDate, constructionStart }` where `constructionStart = codDate − constructionMonths`. Screens label the columns `Y1 · May 2028 – Apr 2029` (short month names) when dates exist. The workbook adds a row of year-start dates (`EDATE` on an input date cell) under the year numbers.

## 2. Construction and commissioning

### 2.1 Hard-cost breakup with phasing

`costs.phasing`: `{ solar: { start, months }, wind: {…}, bess: {…}, evac: {…}, other: {…} }`, months offsets within the construction window (`start` ≥ 0, `start + months` ≤ `constructionMonths`); a missing component spends over the whole window. `constructionSchedule()` takes the components (`[{ key, costCr, start, months }]`, the pre-operative cost spread over the whole window) and returns per-month rows with a cost column per component (`rows[m].byComponent = { solar, wind, bess, evac, other, preop }`) beside the existing totals; `finance.capex.byComponent = { solar, wind, bess, pcs, evac, other, preop, idc }` always.

### 2.2 Early and part commissioning

`fin.parts`: `[{ share, offsetMonths }]`, shares summing to 1 (`[]` means one part on the COD). A part runs from `cod + offsetMonths`. For year y the **operating factor** `opFactor(y)` is the capacity-weighted share of the year the parts run: for a part with offset `o` (months), the months it runs inside year y are `max(0, min(12·y, ∞) − max(12·(y−1), o))` capped at 12, divided by 12; a negative offset (early commissioning) credits its early months to year 1, so `opFactor(1)` can exceed 1. Applied to `deliveredMWh`, `excessMWh`, `buyerExcessMWh`, `demandMWh`, the given `surplusRevenueCr`, biomass/hydro/thermal MWh and the O&M lines; not to insurance, fixed lines or capex. Row: `rows[y].opFactor`.

### 2.3 Prefinancing (bridge loan)

`fin.bridge`: `{ months: 0, rate: null, feePct: 0 }`. During the first `months` of construction the debt draws are a bridge loan at `rate` (null → `interestRate`); in month `months` the term loan takes it out, paying `feePct` of the balance (capitalised with the IDC). `construction.rows[m].bridge = true|false`, `finance.capex.bridgeFee`.

## 3. Generation and revenue

### 3.1 P50 / P75 / P90

`fin.generationCase`: `"p50" | "p75" | "p90"` (default p50); `fin.caseFactors`: `{ p75: 0.97, p90: 0.94 }`. The factor scales `deliveredMWh`, `excessMWh`, `buyerExcessMWh`, the given `surplusRevenueCr`, `solarGenMWh` and `windGenMWh` (so the DFR and the penalties move). Row: `rows[y].generationFactor`.

### 3.2 Carbon credits

`fin.carbon`: `{ enabled: false, tPerMwh: 0.71, pricePerT: 500, years: 10, escalation: 0.03 }` (₹ per tonne). Row `carbonRevenue` = `(deliveredMWh + excessMWh) × tPerMwh × pricePerT × (1 + escalation)^(y−1) / 1e7` for `y ≤ years`, part of `revenue` and taxable.

### 3.3 Life extension

`fin.extension`: `{ years: 0, capexCr: 0, tariffRsPerKwh: null, omFactor: 1, degradation: null }`. The model runs `fin.years + extension.years` years. Beyond the PPA: energy = the last PPA year's × `(1 − degradation)^(y − N)` (`degradation` null → `fin.solarDegradation`), revenue at `tariffRsPerKwh` (null → `fin.surplusPrice`), no penalties, O&M and fixed lines continue escalating × `omFactor`, insurance continues; `capexCr` is spent in year N (the last PPA year), depreciated straight line over the extension years and added to the WDV block. Row `rows[y].phase = "ppa" | "extension"`; `finance.ppaYears = N`.

### 3.4 Solar repowering

`fin.repower`: `{ year: 0, capexCr: 0, upliftPct: 0 }`. Capex in `year` (book: straight line over the remaining book life; tax: into the WDV block / straight line); from `year + 1` the solar share of the energy (`solarGenMWh / (solarGenMWh + windGenMWh)`, 1 when unknown) grows by `upliftPct`. Rows `repowerCapex`, `repowerUplift` (MWh added).

### 3.5 Battery augmentation on a schedule

`bess.augmentation = "schedule"` with `bess.augmentationYears: [6, 12, 18]`: in each listed year the capacity lost since the previous augmentation (`min(0.6, deg × years since)` × `bessMwh`) is replaced at that year's battery price. Same row `augCapex`.

## 4. Operating cost

| Input | Key | Default |
| --- | --- | --- |
| O&M escalation by source | `fin.solarOmEscalation`, `fin.windOmEscalation`, `fin.bessOmEscalation` | `null` → `fin.omEscalation` |
| Wind O&M by component | `fin.windOmComponents`: `[{ label, lakhPerMw, escalation }]` | `[]` → `windOmLakhPerMw` |
| Other fixed costs split | `fin.otherFixedLines`: `[{ label, crPerYear, escalation }]` | `[]` → `otherFixedCr` |

Rows: `solarOm`, `windOm`, `bessOm`, `biomassOm` (their sum stays `om`); `otherLines: [cr, …]` in the order given (their sum stays `other`); `windOmComponents: [cr, …]`.

## 5. Debt and financing

| Feature | Input | Rule |
| --- | --- | --- |
| Sculpting to a target DSCR | exists (`repayment: "sculpted"`, `targetDscr`) | unchanged |
| Refinancing with re-sculpting | exists; `fin.refiRepayment` (`null` → the same method) | after the refinancing year the method (and sculpting at `targetDscr`) applies to the refinanced balance under the new rate |
| Interest step-down after COD | `fin.rateStepDown`: `{ afterYears: 0, rate: null }` | from year `afterYears + 1` the senior rate is `rate` until a refinancing applies |
| Top-up | `fin.topUp`: `{ year: 0, debtFraction: null }` | at the end of `year` new senior debt = `max(0, debtFraction × capex.total − closingDebt)`; it is paid out to equity (row `topUpCr`, added to `fcfe`) and repaid under the method over the years left to the tenor |
| Prepayment penalty | `fin.prepaymentPct` (0) | on every principal prepaid outside the schedule: refinancing takeout and cash sweep; row `prepaymentFee`, expensed |
| Cash sweep | `fin.sweep`: `{ pct: 0, fromYear: 1, toYear: null }` | each year in range: sweep due = `pct × max(0, fcfe before sweep) + sweepAccrued`; paid up to the cash available, the rest accrues (row `sweepAccrued`); prepays principal after the scheduled principal (row `sweepCr`), the balance then re-amortises under the method |
| FSCR | — | `fscr = (cfads + fixedCharges) / (debtService + fixedCharges)`, `fixedCharges = other + guaranteeFees`; also `llcr` = PV of CFADS over the years left to the tenor at the senior rate ÷ opening debt, `plcr` = PV over the years left of the project ÷ opening debt (rows `fscr`, `llcr`, `plcr`; `finance.minFscr`, `minLlcr`, `minPlcr`) |
| DSRA peak and swing | `fin.dsraBasis`: `"next"` (exists) or `"peak"` | peak: `months/12 × max(debtService of the years after y)`; swing is the existing `dDsra` |
| DSRA interest | `fin.dsraInterestRate` (0) | row `dsraInterest` = opening DSRA × rate, other income (taxable, cash) |

Mezzanine and quasi-equity both rank below the senior debt and are part of the funding: `equity0 = capex.total − debt0 − mezz − quasi`.

| Instrument | Input | Rule |
| --- | --- | --- |
| Quasi-equity | `fin.quasi`: `{ amountCr: 0, rate: 0.12, lenderMinDscr: 1.2, repayFromYear: 1 }` | interest due = opening × rate + accrued; paid when the senior DSCR ≥ `lenderMinDscr` and cash (fcfe after senior service) allows, else it accrues (row `quasiAccrued`); principal repaid from the cash left when the DSCR ≥ `lenderMinDscr` and `y ≥ repayFromYear` (row `quasiRepaid`); rows `quasiInterestPaid`, `quasiOpening`, `quasiClosing` |
| Mezzanine | `fin.mezz`: `{ amountCr: 0, rate: 0.14, tenorYears: 10, graceYears: 0, repayment: "equal" or "bullet", feePct: 0 }` | interest paid every year (row `mezzInterest`), principal per the schedule (`mezzPrincipal`), `mezzOpening`/`mezzClosing`; `totalDscr = cfads / (debtService + mezzService)` |

Guarantees: `fin.guarantees`: `[{ label, amountCr, feePct, marginPct, marginRate, fromYear, years }]` (EMD, PBG, connectivity BG, statutory BG, surety bonds). Fees (row `guaranteeFees`, expensed below EBITDA with the working-capital interest), margin money blocked while a guarantee runs (row `marginBalance`, funded from equity cash like the DSRA, released after) earning `marginInterest` (other income). `fromYear` 0 means it starts in construction (its construction-period fee is capitalised).

## 6. Tax and depreciation

| Input | Key | Default |
| --- | --- | --- |
| Book depreciation basis | `fin.bookDepreciation` | `"slm"` (`"wdv"` allowed) |
| Component lives | `fin.lives`: `{ solar, wind, bess, evac, other }` years | `null` → `bookLifeYears` |
| Thin capitalisation | `fin.thinCapPct` | `0` (off); `0.3` caps the deductible interest on quasi-equity and mezzanine at 30% of EBITDA, the excess carried forward 8 years |
| Loss carry-forward | `fin.lossCarryYears` | `8`; unabsorbed depreciation carries without limit |

Rows: `bookDepSlm`, `bookDepWdv` (both always), `bookDep` (the chosen), `taxDepSlm`, `taxDepWdv`, `taxDep` (the chosen), `grossBlock` (by component: `grossBlockByComponent`), `accDep`, `netBlock`, `netBlockByComponent`, `taxableIncome`, `lossSetOff`, `depSetOff`, `lossCarried`, `depCarried`, `interestDisallowed`, `interestCarried`. Quasi interest is deductible when paid, not when accrued.

## 7. Returns

| Output | Definition |
| --- | --- |
| `equityIrr` (levered), `projectIrr` (unlevered) | as today, post-tax; `preTaxEquityIrr`, `preTaxProjectIrr` added |
| SPV / HoldCo / promoter | `fin.holdco`: `{ expensesCrPerYear: 0, promoterShare: 1 }`. SPV flows = `equityFlows`. HoldCo flows = SPV dividends + quasi interest paid + quasi repayments − holdco expenses, with the holdco funding the equity and the quasi-equity at year 0. Promoter flows = HoldCo flows × `promoterShare`. `holdcoIrr`, `promoterIrr`, `holdcoFlows`, `promoterFlows` |
| Lender | `lenderFlows`: dated (draws by construction month, service by year end; dates from `codDate`, else a nominal COD 1 Jan 2028), `lenderXirr`, `lenderMirr` with `fin.lenderReinvestRate` (null → senior rate) |

## 8. Statements

The balance sheet gains the asset split: `grossBlockByComponent`, `cwip` (year 0), `accDep`, `netBlock`, `dsraBalance`, `marginBalance`, `receivables`, `cash`; liabilities: share capital, retained earnings, senior debt, mezzanine, quasi-equity, accrued quasi interest, sweep accrued. The cash-flow statement carries every new line (carbon, extension capex, repowering, top-up, sweep, prepayment fee, quasi and mezzanine flows, guarantee fees and margin money, DSRA interest). Rows on `finance.rows[y]`: `cash`, `retained`, `shareCapital`.

## 9. Sensitivity for the reverse auction

`fin.capexUsdShare` (0), `fin.fxBase` (83) and `costs.moduleSharePct` (0.45 of the solar capex) feed a sensitivity table of the tariff for the target IRR: capex ±, module cost ±, exchange rate ±, interest ±, generation case, part commissioning delay (+3, +6 months), life extension (+5, +10 years), refinancing rate ±. Engine helper `sensitivities(ctx, sizes, args)` returns the table; the screen shows it (F.8) and the workbook's Sensitivity sheet gains the new axes.

## 10. Where it shows

* Inputs: the Finance inputs step (Tender to Bid / SECI / CfD) and the Round the Clock Finance chapter and FinanceView F.1, in groups: Timeline, Construction (phasing table, parts table, bridge), Generation (case, carbon, extension, repowering, augmentation schedule), Operating cost (escalations, wind components, other lines), Debt (step-down, top-up, prepayment, sweep, DSRA basis and rate), Quasi-equity and mezzanine, Guarantees, Tax, Returns (holdco, lender reinvestment), Sensitivity (USD share, FX, module share).
* Outputs: FinanceView F.4 table with the new lines; F.5 Returns (SPV, HoldCo, promoter, lender XIRR/MIRR, DSCR/FSCR/LLCR/PLCR); F.6 Tax schedule; F.7 Balance sheet and cash-flow statement; F.8 Reverse-auction sensitivity.
* Workbook: an Inputs sheet separate from the Live model (every input there, the model linking to it), the dates row, the new rows and sheets (Tax schedule, Returns, Guarantees and reserves, Quasi-equity and mezzanine), the sensitivity axes.

## 11. Open points (not built until answered)

* "Keep metrics proprietary (risk)": whether the workbook should carry a confidentiality mark and omit the benchmark notes, or whether some outputs should not leave the application at all.
* Returns at the promoter level assume the promoter holds `promoterShare` of the holdco and the holdco holds all of the SPV; dividend distribution rules are not modelled.

## 12. Status (5 November 2026)

| Stream | State | Where |
| --- | --- | --- |
| UI inputs and outputs | Built | `web/src/rtc/financeV3.js`, `FinanceInputsV3.jsx` (ten groups, mounted on the Finance inputs step of Tender to Bid / SECI 4.3a and CfD 5.4a and under F.1 "More inputs (finance team)"), `FinanceStatements.jsx` (F.5 Returns, F.6 Tax schedule, F.7 Balance sheet and cash-flow statement, F.8 Reverse-auction sensitivity), `FinanceView.jsx` (dated year headers, the v3 lines of F.4 as optional lines, CSV); COD seeded from the SCSD (SECI, Tender to Bid), the SCD (CfD), typed in Round the Clock |
| Engine | See the engine stream's report | `web/src/rtc/engine.js`, `tools/check_finance_v3.mjs`, `tools/check_rtc_engine.mjs` |
| Workbook | See the workbook stream's report | `web/lib/liveModel.js`, `tools/check_live_model.mjs` |
| Docs and tests | Built | `docs/enterprise/FEATURES.md` / `.xlsx` (FMV-01 to FMV-34, through `tools/build_enterprise_features.py`), `docs/dev/DEV-MANUAL.md` §6.2, 6.2a, 8.5, 10, `SCREEN-TO-DATA.md`, `FUNCTIONAL-TESTS.md`, `CLICK-TESTS.md` §2a (FV3-01 to FV3-24), the two user manuals ("More inputs (finance team)"), `docs/PRODUCT.md`, `CFD.md`, `SECI_RTC.md`, `TENDER_TO_BID.md`; `tests/e2e/test_finance_v3.py` |

Open points of §11 stand: "Keep metrics proprietary" (FMV-01, not built) and the promoter-level
assumption (FMV-30 note).
