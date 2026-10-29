#!/usr/bin/env python3
"""Generate docs/dev/SCREEN-TO-DATA.md: every calculated figure on screen, where it is computed and where it is stored.

    python3 tools/gen_screen_map.py            # writes docs/dev/SCREEN-TO-DATA.md
    python3 tools/gen_screen_map.py --check    # exits 1 when the committed file is stale

Two kinds of content are merged:

* read from the code on every run: every `<Stat …/>` headline number in web/src (its label, the
  file and line, the value expression and the trace target), and the row lists of the financial
  model tables (FIN_LINES in web/src/rtc/FinanceView.jsx, METER_LINES in web/src/rtc/RtcTab.jsx,
  costLines in web/src/bid/FinanceStep.jsx);
* curated in this script (FILES and STATS below, checked against the code they cite): for each
  figure the function that computes it, the inputs it rests on, and where it is stored. A figure
  without a curated entry is printed with "to confirm" so the gap is visible rather than guessed.

No third-party dependency.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "web" / "src"
OUT = ROOT / "docs" / "dev" / "SCREEN-TO-DATA.md"

# ----------------------------------------------------------------------------- JSX scanning


def _skip_string(s: str, i: int) -> int:
    """i at a quote; returns the index just after the closing quote (template literals nest ${})."""
    q = s[i]
    i += 1
    if q == "`":
        while i < len(s):
            if s[i] == "\\":
                i += 2
            elif s[i] == "`":
                return i + 1
            elif s.startswith("${", i):
                i = _skip_braces(s, i + 1)
            else:
                i += 1
        return i
    while i < len(s):
        if s[i] == "\\":
            i += 2
        elif s[i] == q:
            return i + 1
        else:
            i += 1
    return i


def _skip_braces(s: str, i: int) -> int:
    """i at '{'; returns the index just after the matching '}'."""
    depth = 0
    while i < len(s):
        c = s[i]
        if c in "\"'`":
            i = _skip_string(s, i)
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return i


def find_tags(text: str, tag: str) -> list[dict]:
    """Every <tag …/> in a JSX file: line, attributes ({name: (kind, value)}, kind 'str' | 'expr' | 'flag') and the raw tag."""
    out = []
    for m in re.finditer(rf"<{tag}(?=[\s/>])", text):
        i = m.end()
        attrs: dict[str, tuple[str, str]] = {}
        while i < len(text):
            while i < len(text) and text[i].isspace():
                i += 1
            if text.startswith("/>", i):
                i += 2
                break
            if text[i] == ">":
                i += 1
                break
            nm = re.match(r"[A-Za-z_][\w-]*", text[i:])
            if not nm:
                i += 1
                continue
            name = nm.group(0)
            i += len(name)
            while i < len(text) and text[i].isspace():
                i += 1
            if i < len(text) and text[i] == "=":
                i += 1
                while i < len(text) and text[i].isspace():
                    i += 1
                if text[i] == '"':
                    j = _skip_string(text, i)
                    attrs[name] = ("str", text[i + 1:j - 1])
                elif text[i] == "{":
                    j = _skip_braces(text, i)
                    attrs[name] = ("expr", text[i + 1:j - 1].strip())
                else:
                    j = i + 1
                    attrs[name] = ("expr", text[i:j])
                i = j
            else:
                attrs[name] = ("flag", "")
        out.append({"line": text.count("\n", 0, m.start()) + 1, "attrs": attrs, "raw": text[m.start():i]})
    return out


def literals(expr: str) -> list[str]:
    """The string and template literals in an expression, ${…} shown as <…>."""
    out = []
    i = 0
    while i < len(expr):
        c = expr[i]
        if c in "\"'`":
            j = _skip_string(expr, i)
            body = expr[i + 1:j - 1]
            if c == "`":
                body = re.sub(r"\$\{([^}]*)\}", lambda m: f"<{m.group(1).strip()}>", body)
            out.append(body)
            i = j
        else:
            i += 1
    return out


def label_text(attr: tuple[str, str]) -> str:
    kind, value = attr
    if kind == "str":
        return value
    lits = [x for x in literals(value) if x.strip()]
    return " / ".join(lits) if lits else f"<{compact(value)}>"


def compact(s: str, limit: int = 150) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= limit else s[: limit - 1] + "…"


def code(s: str) -> str:
    """A code span that survives backticks and pipes inside."""
    s = s.replace("|", "\\|")
    return f"`` {s} ``" if "`" in s else f"`{s}`"


def parse_lines_array(text: str, name: str) -> list[tuple]:
    """Entries of a `const NAME = [ ["Label", "key" | null, fmt?, sign?, strong?], … ]` array."""
    m = re.search(rf"const {name} = \[(.*?)\n\];", text, re.S)
    if not m:
        m = re.search(rf"const {name} = \[(.*?)\];", text, re.S)
    if not m:
        return []
    rows = []
    for e in re.finditer(r"\[\s*\"([^\"]+)\"\s*,\s*(null|\"(\w+)\")(?:\s*,\s*(\"pct\"|\d))?(?:\s*,\s*(-?\d))?(?:\s*,\s*(true))?\s*\]", m.group(1)):
        rows.append((e.group(1), e.group(3), (e.group(4) or "").strip('"'), e.group(5), bool(e.group(6))))
    return rows


def parse_trace_line(text: str) -> dict[str, str]:
    m = re.search(r"const TRACE_LINE = \{(.*?)\};", text, re.S)
    return dict(re.findall(r"(\w+): \"(\w+)\"", m.group(1))) if m else {}


# ----------------------------------------------------------------------------- the curated map
#
# FILES: for each file with calculated figures, where it is on screen and what is true of every
# figure in it unless STATS says otherwise. STATS: per figure (file, label as shown), the function
# that computes it, the inputs it rests on and where it is stored. Storage vocabulary:
#   "computed" = worked out from state on every render, never stored
#   "localStorage <key>" = kept in the browser tab's saved state under that key
#   "scenarios.inputs.state.<path>" / "results.<path>" / "summary.<field>" = the jsonb of the saved
#     scenario version (scenario_versions) when the tab is saved to the library
#   a DB table/column = written by an API route

FIN_RTC = ("Round the clock: `web/src/rtc/RtcTab.jsx` finance = `E.runFinancialModel(ctx, sizes, { costs, fin, bess, dfrTarget, tariffLocked })` "
           "(`web/src/rtc/engine.js` runFinancialModel → cashflows). Tender to Bid / SECI: `web/src/bid/FinanceStep.jsx` finance = "
           "`E.runFinancialModel(null, lp.sizes, { costs, fin, bess, dfrTarget, tariffLocked, ops: opsFromLp(lp, fin, bess, dsmFor(state)), solveBy: \"npv\" })`")
FIN_INPUTS_RTC = "state.inputs, state.costs, state.fin, state.bess, the size variables (state.vars) and the year-1 simulation; in the bid tabs state.lp (HiGHS sizing), state.costs, state.fin, state.src, state.dsm"
FIN_STORE = ("Round the clock: saved as `results.finance.<key>` and the summary fields `tariff`, `lcoe`, `equityIrr`, `projectIrr`, `minDscr`, `payback` (`RtcTab.jsx` buildSave); "
             "SECI RTC: computed, not stored (recomputed from `inputs.state.lp` on load; `summary.tariff` is the quoted `forms.tariff`, else the HiGHS `lp.tariff`); "
             "Tender to Bid: computed, the state in localStorage `fdre.bid.v4` only")

FILES = {
    "rtc/FinanceView.jsx": {
        "screen": "Round the clock › Finance chapter (06); Tender to Bid › Financials (5); SECI RTC tender › Financial model (FinanceView is shared)",
        "fn": FIN_RTC, "inputs": FIN_INPUTS_RTC, "store": FIN_STORE,
    },
    "rtc/ConstructionView.jsx": {
        "screen": "Finance chapter / Financials › F.3b Construction (inside FinanceView, so the same three tabs)",
        "fn": "`finance.construction` = `web/src/rtc/engine.js` constructionSchedule(baseCostCr, costs, fin), called from capexCr inside cashflows",
        "inputs": "costs.constructionMonths, costs.drawdown, costs.drawOrder, fin.debtFraction, fin.interestRate, the hard + pre-operative cost",
        "store": "Round the clock: `results.finance.construction` (rows per month); bid tabs: computed",
    },
    "rtc/results.jsx": {
        "screen": "Round the clock › the answer (DispatchStory, EnergyFlow, SolverLog, AgeingImpact in `RtcTab.jsx`)",
        "fn": "`sim` = `E.simulate(ctx, sizes, { hourly: true })` (`web/src/rtc/engine.js`), memoised in `RtcTab.jsx`",
        "inputs": "state.inputs (demand, plant, losses), the demand shape and profiles, state.bess, the sizes",
        "store": "the simulation summary without its hourly arrays is saved as `results.sim.<key>`; the headline ones also as summary fields (`dfr`, `deliveredMu`, `curtailMu`, `meterMu`, `evacLossMu`, …); state in localStorage `fdre.rtc.v1`",
    },
    "rtc/MeterView.jsx": {
        "screen": "Round the clock › Plant to meter chapter (`PlantToMeter` in `RtcTab.jsx`)",
        "fn": "`sim.evac` from `E.simulate` (evacuationEfficiency, trafoLossMWh, lineLossMWh, meterMWh); finance as above",
        "inputs": "state.inputs.trafoLossPct, lineLossPct, lossPct, the sizes and the year-1 dispatch",
        "store": "`results.sim.evac` and summary `meterMu`, `evacLossMu`, `trafoLossPct`, `lineLossPct`, `solarCufBus`, `solarCufMeter` on Save; otherwise computed",
    },
    "rtc/chapters.jsx": {
        "screen": "Round the clock › Energy, DFR, Solar/Wind, Battery and Sites chapters",
        "fn": "from state.inputs directly, or `sim` (`E.simulate`) and `E.evacuationEfficiency(inputs)`",
        "inputs": "state.inputs, the uploaded or synthetic profiles, state.bess, the sizes",
        "store": "inputs: localStorage `fdre.rtc.v1` → `scenarios.inputs.state.inputs`; the derived figures: `results.sim` / summary on Save, else computed",
    },
    "seci/BidStep.jsx": {
        "screen": "SECI RTC tender › Bid inputs (step 3)",
        "fn": "the tender pack `PACK.model` (`web/src/seci/terms.js`, from `seci-rtc-tm-v.json`) applied to the bid; `keyDates(ppaDate)` and `moneyAtStake(lp.sizes)` in `terms.js`",
        "inputs": "state.bid.baseMw, state.seci.ppaDate, state.seci.profile, state.lp.sizes",
        "store": "the inputs in localStorage `tenderos.seci.v1` → `scenarios.inputs.state.bid` / `.seci`; the derived MW, dates and amounts are computed, not stored",
    },
    "whatif/WhatIfTab.jsx": {
        "screen": "What-if analysis tab (standalone) and SECI RTC tender › What-if (step 8, `embedded`)",
        "fn": "`res` = `runWhatIf(state, { prices })` (`web/src/whatif/model.js`): rule-based `dispatchYear` per year, then `E.runFinancialModel(null, sizes, { …, ops, tariffLocked: true, solveBy: \"npv\" })` at the bid tariff (`atBid`) and unlocked (`needed`)",
        "inputs": "the What-if case: contractedMw, solar/wind MW and CUF, battery, costs, om, fin (tariff, financing, target IRR), dsm, the plan (Peak Hours) and the IEX prices",
        "store": "standalone: the case (inputs only) in localStorage `tenderos-whatif`; embedded: seeded from the SECI bid by `whatIfFromBid(state, terms)` and kept in memory only; results are never stored",
    },
    "cfd/ExampleStep.jsx": {
        "screen": "CfD bid › Worked example (step 2)",
        "fn": "`x` = `workedExample({ mw, sp, prices, market, rte, solarCuf })` (`web/src/cfd/example.js`: `commit`, `money` = rfsAmounts + lcCr, `year` from the IEX evenings)",
        "inputs": "state.example (mw, sp, rte, solarCuf), state.inputs.sellMarket, the IEX hourly prices",
        "store": "state.example in localStorage `fdre.cfd.v1`; the figures computed; the CfD tab is never saved to the library",
    },
    "cfd/OperationsStep.jsx": {
        "screen": "CfD bid › Operations over the term (step 5)",
        "fn": "`model` = `runModel(state, prices)` (`web/src/cfd/model.js`: modelInputs → priceBook → profiles → simulate → solveStrikePrice), memoised in `CfdTab.jsx`; the figures reduce `model.sim.years`",
        "inputs": "state.inputs (contracted MW, own RE, charging power, markets, availability, costs, financing)",
        "store": "computed; inputs in localStorage `fdre.cfd.v1`",
    },
    "cfd/FinanceStep.jsx": {
        "screen": "CfD bid › Strike price to bid (step 6)",
        "fn": "`model.fin` = `financials(inputs, sim, sp)` and `model.bid` (`solveStrikePrice`), `poolFlows(sim, bid)` in `web/src/cfd/model.js`",
        "inputs": "state.inputs and the simulation",
        "store": "computed; the Excel twin is written on request by `POST /api/cfd/model` (logged in `activity_log` as `export`)",
    },
    "bess/results.jsx": {
        "screen": "BESS tender › the answer (Compliance, CapacityTrajectory, TypicalDay, FinanceTable in `BessTab.jsx`)",
        "fn": "`res` = `B.evaluate(state.req, state.tech, state.costs, state.fin, state.strategy)` (`web/src/bess/engine.js`), memoised in `BessTab.jsx`",
        "inputs": "state.req (contract), state.tech (battery), state.costs, state.fin, state.strategy (oversize, interval)",
        "store": "on Save `results.res.<key>` (plan years without cohorts, `rows`) and the summary fields (`day1DcMwh`, `augMwh`, `capexCr`, `vgfCr`, `chargeLakhPerMwMonth`, `lcos`, `equityIrr`, `projectIrr`, `minDscr`); state in localStorage `fdre.bess.v1`",
    },
    "bess/chapters.jsx": {
        "screen": "BESS tender › Tender and Battery chapters",
        "fn": "Tender chapter: the engine's parse (`POST /api/bess/parse`, `engine/bess`) kept as state.tender; Battery chapter: `B.rteAt(year, tech)`, `B.requiredDcMwh(req, tech)` (`web/src/bess/engine.js`)",
        "inputs": "state.tender, state.req, state.tech",
        "store": "state.tender / req / tech in localStorage `fdre.bess.v1` → `scenarios.inputs.state`; the derived figures computed",
    },
    "dsm/DsmPanel.jsx": {
        "screen": "Finance inputs › Deviation settlement (Tender to Bid / SECI `FinanceInputsStep.jsx`) and Finance chapter › F.3a (FinanceView, all three tabs)",
        "fn": "`dsmUnitCharge({ dsm, category, hasStorage, year, contract: tariff })` for years 1–6 and 10, `sigmaOf`, `dsmCategory` (`web/src/dsm/dsm.js`)",
        "inputs": "state.dsm (on, category, sigmaPct, storageFirming, codFy, steps), state.sources, the tariff shown (lp.tariff or finance.tariff)",
        "store": "state.dsm in the tab's localStorage key → `scenarios.inputs.state.dsm` (SECI); the charges computed (they enter the financial model through `opsFromLp` → `dsmLines` as the `dsm` row)",
    },
    "bid/QuoteCheck.jsx": {
        "screen": "Tender to Bid › Financials › 5.0 Your quote; SECI RTC tender › Bid forms (the quoted tariff, `BidForms.jsx`)",
        "fn": "`q` = `quotedReturns(state, terms, tariff)` (`web/src/bid/quote.js`): `E.runFinancialModel` locked at the quote and unlocked for the target",
        "inputs": "the quoted tariff, state.lp, state.costs, state.fin, state.dsm",
        "store": "the quote itself: Tender to Bid `state.quoteTariff` (localStorage `fdre.bid.v4`); SECI `state.forms.tariff` → `scenarios.inputs.state.forms.tariff` and `summary.tariff`; the IRRs computed",
    },
    "bid/DatesStep.jsx": {
        "screen": "Tender to Bid › Key dates (step 2)",
        "fn": "`events` = `tenderDates(state.tender.result)` (`web/src/bid/tenderMap.js`) from the reading's date fields; days counted from today",
        "inputs": "state.tender.result (the engine's reading), today's date",
        "store": "the reading: `tender_reads.result` (saved by `readTender.js` → `POST /api/tenders`) and `state.tender` in localStorage `fdre.bid.v4`; the countdown computed",
    },
    "bid/SizeStep.jsx": {
        "screen": "Tender to Bid › Size (step 4) and SECI RTC tender › Size (step 6)",
        "fn": "`lp` = `state.lp`, the HiGHS sizing from `POST /api/rtc/lp` (`engine/sizing/rtc_lp.py` solve; started by `web/src/bid/useSizing.js` startSizing with `lpPayload`); `mix` = `energyMix(hourly)` (`web/src/bid/model.js`) over the year-1 hourly dispatch",
        "inputs": "state.bid, state.sources, state.src, state.fin, state.costs, state.market, the profiles, the tender terms",
        "store": "`state.lp` in localStorage (`fdre.bid.v4` / `tenderos.seci.v1`); SECI Save: `scenarios.inputs.state.lp` (whole), `results.lp` (`sizes`, `tariff`, `years`) and summary `solarMw`, `windMw`, `bessMw`, `bessMwh`; the hourly dispatch is in memory only (`sizingSession.hourly`), so the Year-1 energy figures show only after a sizing in this page load",
    },
    "bid/CapacityStep.jsx": {
        "screen": "Tender to Bid › Bid capacity (step 3)",
        "fn": "`plantMw(state, terms)`, `solarMinMw(state, terms)` (`web/src/bid/model.js`) with `terms` = `tenderTerms(result, accepted)` (`tenderMap.js`)",
        "inputs": "state.bid.baseMw, state.bid.greenshoe, the tender's capacity, greenshoe, solar multiple and supply floors",
        "store": "state.bid in localStorage `fdre.bid.v4`; computed",
    },
    "bid/FinanceStep.jsx": {
        "screen": "Tender to Bid › Financials (step 5) and SECI RTC tender › Financial model (step 7)",
        "fn": "`finance` = `E.runFinancialModel(null, lp.sizes, { costs, fin, bess, dfrTarget, tariffLocked, ops: opsFromLp(lp, fin, bess, dsmFor(state)), solveBy: \"npv\" })` with `modelInputs(state, terms)`; `capex` = `capexBySource(sizes, costs)` (`web/src/bid/model.js`)",
        "inputs": "state.lp (sizes, lifetime, perYear), state.costs, state.fin, state.src, state.dsm, state.tariffLocked, the tender's ceiling, EMD and PBG per MW",
        "store": "computed from state on every render; nothing of the financial model is stored (SECI `summary.tariff` is the quoted tariff or the HiGHS tariff); state in localStorage; the Excel twin by `POST /api/bid/model` (`web/lib/modelWorkbook.js` + `liveModel.js`)",
    },
    "market/RecentTendersTab.jsx": {
        "screen": "Recent tenders › SECI results",
        "fn": "`tile(product)`: the latest result per product in `SECI_RESULTS` (`web/src/market/seed.js`) and its tariff range",
        "inputs": "the researched result list in code",
        "store": "code, not stored (the uploaded CERC orders beside them are `market_orders` rows)",
    },
}

TRACE_NOTE = "opens the traceable model (`web/src/model/trace.js` traceModel over `web/lib/liveModel.js`) at "

STATS = {
    # ---- FinanceView (shared)
    ("rtc/FinanceView.jsx", "Tariff (fixed) / Tariff for target IRR"): {"fn": "`finance.tariff` (+ `levelisedTariff` when escalated): the tariff solved for the target equity IRR, or the fixed one", "inputs": "fin.targetEquityIrr, fin.tariffEscalation, the whole model"},
    ("rtc/FinanceView.jsx", "LCOE"): {"fn": "`finance.lcoe`: present value of costs ÷ present value of energy at fin.discountRate", "inputs": "fin.discountRate, the cost and energy rows"},
    ("rtc/FinanceView.jsx", "Equity IRR"): {"fn": "`finance.equityIrr` = `irr(cf.equityFlows)`; detail `equityNpv` = `npvAt(fin.targetEquityIrr, equityFlows)`", "inputs": "the free cash to equity of every year"},
    ("rtc/FinanceView.jsx", "Project IRR"): {"fn": "`finance.projectIrr` = `irr(cf.projectFlows)`", "inputs": "the unlevered project cash flows"},
    ("rtc/FinanceView.jsx", "DSCR min / avg"): {"fn": "`finance.minDscr` / `avgDscr` over the years with debt service; detail from `fin.tenorYears`, `fin.repayment`, `fin.graceYears`, `finance.debtTerms`", "inputs": "CFADS and debt service per year"},
    ("rtc/FinanceView.jsx", "Equity payback"): {"fn": "`finance.payback`: the first year cumulative equity cash turns positive; detail `finance.equity`, `finance.debt`", "inputs": "cumulative FCFE, capex, fin.debtFraction"},
    # ---- ConstructionView
    ("rtc/ConstructionView.jsx", "Cost before IDC"): {"fn": "`finance.capex.hard + finance.capex.preop`", "inputs": "the sizes × unit costs, costs.preopPct, costs.evacuationCr"},
    ("rtc/ConstructionView.jsx", "Interest during construction"): {"fn": "`finance.construction.idc` (sum of the monthly IDC in constructionSchedule)", "inputs": "the drawdown profile, fin.interestRate, costs.constructionMonths"},
    ("rtc/ConstructionView.jsx", "Debt at COD"): {"fn": "`finance.debt` (debt drawn + IDC capitalised)", "inputs": "fin.debtFraction, the IDC"},
    ("rtc/ConstructionView.jsx", "Equity put in"): {"fn": "`finance.equity`; detail from `construction.order`", "inputs": "project cost − debt"},
    # ---- rtc/results.jsx
    ("rtc/results.jsx", "Generated"): {"fn": "`sim.solarGenMWh + sim.windGenMWh`", "inputs": "the profiles × sizes"},
    ("rtc/results.jsx", "Used by the customer"): {"fn": "`sim.deliveredMWh` (at the 220 kV meter)", "inputs": "the hourly dispatch"},
    ("rtc/results.jsx", "Sold to grid"): {"fn": "`sim.excessMWh`", "inputs": "fin.sellSurplus, the hourly surplus"},
    ("rtc/results.jsx", "Curtailed"): {"fn": "`sim.curtailMWh`", "inputs": "the hourly dispatch"},
    ("rtc/results.jsx", "DFR year 1"): {"fn": "`sim.dfr` = delivered ÷ demand", "inputs": "inputs.dfrTarget for the tone", "store": "summary `dfr`; results.sim.dfr"},
    ("rtc/results.jsx", "Lowest month"): {"fn": "`sim.minMonthlyDfr` and its month from `sim.monthlyDfr`", "inputs": "the monthly dispatch", "store": "summary `minMonthlyDfr`"},
    ("rtc/results.jsx", "Delivered"): {"fn": "`sim.deliveredMWh` of `sim.demandMWh`", "inputs": "the hourly dispatch", "store": "summary `deliveredMu`"},
    ("rtc/results.jsx", "Battery cycles"): {"fn": "`sim.cycles`", "inputs": "discharged energy ÷ usable energy"},
    ("rtc/results.jsx", "Designs evaluated"): {"fn": "`opt.stats.evals`, `cacheHits` of the optimizer run (`web/src/rtc/optimizer.worker.js` running `E.optimize`)", "inputs": "the optimizer run", "store": "`results.opt.stats` on Save (opt is a module-level session variable, not in localStorage)"},
    ("rtc/results.jsx", "Full-year dispatches"): {"fn": "`opt.stats.dispatches`", "inputs": "the optimizer run", "store": "`results.opt.stats`"},
    ("rtc/results.jsx", "Hours simulated"): {"fn": "`opt.stats.simulatedHours`, `simMs`", "inputs": "the optimizer run", "store": "`results.opt.stats`"},
    ("rtc/results.jsx", "Run time"): {"fn": "`opt.stats.ms`, `gridPoints`, `starts`", "inputs": "the optimizer run", "store": "`results.opt.stats`"},
    ("rtc/results.jsx", "25-year models"): {"fn": "`opt.stats.tariffEvals`, `tariffMs`", "inputs": "the optimizer run", "store": "`results.opt.stats`"},
    ("rtc/results.jsx", "HiGHS LP"): {"fn": "`opt.highs.seconds`, `model.columns`, `lowerBound` from `POST /api/rtc/lp` (`engine/sizing/rtc_lp.py`)", "inputs": "the HiGHS seed run", "store": "`results.opt.highs`"},
    ("rtc/results.jsx", "Tariff without ageing"): {"fn": "`E.tariffAgeingBreakdown(ctx, sizes, …).ideal.tariff` (the model with no degradation, fade or augmentation)", "inputs": "fin.solarDegradation, windDegradation, bess.annualDegradation, bess.augmentation", "store": "computed"},
    ("rtc/results.jsx", "Generation degradation"): {"fn": "`tariffAgeingBreakdown().genImpact` = tariff with generation ageing − ideal", "inputs": "fin.solarDegradation, fin.windDegradation", "store": "computed"},
    ("rtc/results.jsx", "Battery fade + augmentation"): {"fn": "`tariffAgeingBreakdown().bessImpact` and `all.augCapexCr`", "inputs": "bess.annualDegradation, bess.augmentation, augmentationYear", "store": "computed"},
    ("rtc/results.jsx", "Energy lost to ageing"): {"fn": "`b.ideal.deliveredMu − b.all.deliveredMu` over fin.years", "inputs": "as above", "store": "computed"},
    # ---- MeterView
    ("rtc/MeterView.jsx", "Billing metering point"): {"fn": "fixed text (220 kV GSS)", "inputs": "none", "store": "none"},
    ("rtc/MeterView.jsx", "Reaches the meter"): {"fn": "`sim.evac.efficiency` = (1 − trafoLossPct) × (1 − lineLossPct) (`E.evacuationEfficiency`)", "inputs": "inputs.trafoLossPct, inputs.lineLossPct", "store": "summary `trafoLossPct`, `lineLossPct`"},
    ("rtc/MeterView.jsx", "Lost on the way · year 1"): {"fn": "`sim.evac.trafoLossMWh + lineLossMWh`, valued at `finance.tariff`", "inputs": "injected energy, the losses, the tariff", "store": "summary `evacLossMu`"},
    ("rtc/MeterView.jsx", "Solar CUF"): {"fn": "`sim.solarGenMWh ÷ (sizes.solarMw × 8760)` at the bus, × `sim.evac.efficiency` at the meter", "inputs": "the solar profile, losses to the bus, evacuation losses", "store": "summary `solarCufBus`, `solarCufMeter` (RtcTab `derived`)"},
    ("rtc/MeterView.jsx", "DFR at the meter"): {"fn": "`sim.dfr`", "inputs": "delivered ÷ demand", "store": "summary `dfr`"},
    # ---- chapters
    ("rtc/chapters.jsx", "Peak demand"): {"fn": "`Math.max(...demand)` of `E.buildDemand` (RtcTab `peakDemand`)", "inputs": "inputs.annualEnergyMu, the hour and month shapes or the uploaded demand", "store": "computed"},
    ("rtc/chapters.jsx", "Year-1 demand"): {"fn": "`sim.demandMWh`; `avgMw` = annualEnergyMu × 1000 ÷ 8760", "inputs": "inputs.annualEnergyMu", "store": "summary `annualEnergyMu`"},
    ("rtc/chapters.jsx", "Power transformer"): {"fn": "`inputs.trafoLossPct` shown as a figure", "inputs": "an input", "store": "`inputs.state.inputs.trafoLossPct`"},
    ("rtc/chapters.jsx", "220 kV line"): {"fn": "`inputs.lineLossPct`", "inputs": "an input", "store": "`inputs.state.inputs.lineLossPct`"},
    ("rtc/chapters.jsx", "Reaches the meter"): {"fn": "`E.evacuationEfficiency(inputs)`", "inputs": "trafoLossPct, lineLossPct", "store": "computed"},
    ("rtc/chapters.jsx", "Sold · year 1"): {"fn": "`sim.excessMWh`, valued at `fin.surplusPrice`", "inputs": "fin.sellSurplus, fin.surplusPrice", "store": "results.sim.excessMWh"},
    ("rtc/chapters.jsx", "Curtailed · year 1"): {"fn": "`sim.curtailMWh` ÷ generation", "inputs": "the dispatch", "store": "summary `curtailMu`"},
    ("rtc/chapters.jsx", "CUF of the profile"): {"fn": "`E.mean(cf)` of the profile in use; × `toBusFactor` and `evacuationEfficiency` for the bus and meter figures", "inputs": "the upload or synthetic profile, the monthly redraw, the losses to the bus", "store": "the profile and scales in `inputs.state` (`solarUpload`, `solarMonthScale`, …); the CUF computed"},
    ("rtc/chapters.jsx", "Battery at the solar site"): {"fn": "`sizes.bessMw − at(\"bessMw\")` with `share = sizes.bessWindShare`", "inputs": "the optimizer's bessWindShare variable", "store": "`inputs.state.vars.bessWindShare`"},
    ("rtc/chapters.jsx", "Battery at the wind site"): {"fn": "`sizes.bessMw × share`", "inputs": "as above", "store": "as above"},
    ("rtc/chapters.jsx", "Split between the sites"): {"fn": "`share × 100`", "inputs": "as above", "store": "as above"},
    ("rtc/chapters.jsx", "Duration"): {"fn": "`sizes.bessMwh ÷ sizes.bessMw`", "inputs": "the size variables", "store": "summary `bessMw`, `bessMwh`"},
    ("rtc/chapters.jsx", "Year-1 cycles"): {"fn": "`sim.cycles`, `sim.dischargeMWh`", "inputs": "the dispatch", "store": "results.sim"},
    # ---- SECI BidStep
    ("seci/BidStep.jsx", "Supply to guarantee"): {"fn": "`baseMw × PACK.model.peakFloor` (and solarFloor / solarMax / remainingFloor or offpeakFloor)", "inputs": "state.bid.baseMw, the pack's floors, state.seci.profile"},
    ("seci/BidStep.jsx", "Shortfall penalty"): {"fn": "`PACK.model.penaltyMultiple`", "inputs": "the pack", "store": "code"},
    ("seci/BidStep.jsx", "Financial Closure"): {"fn": "`keyDates(ppaDate).financialClosure` = SCSD − fcMonthsBefore", "inputs": "state.seci.ppaDate, PACK.model months"},
    ("seci/BidStep.jsx", "Supply starts (SCSD)"): {"fn": "`keyDates(ppaDate).scsd` = PPA + scsdMonths", "inputs": "state.seci.ppaDate"},
    ("seci/BidStep.jsx", "Latest start, with penalty"): {"fn": "`keyDates(ppaDate).latestStart` = SCSD + lateMonths", "inputs": "state.seci.ppaDate"},
    ("seci/BidStep.jsx", "EMD"): {"fn": "`moneyAtStake(lp.sizes).emdRs` = per-MW/MWh rates × installed solar, wind (+ other RE) and storage", "inputs": "state.lp.sizes, PACK.model.emdRs"},
    ("seci/BidStep.jsx", "Performance Bank Guarantee"): {"fn": "`moneyAtStake(lp.sizes).pbgRs`", "inputs": "state.lp.sizes, PACK.model.pbgRs"},
    ("seci/BidStep.jsx", "Minimum net worth"): {"fn": "`moneyAtStake(lp.sizes).netWorthRs`", "inputs": "state.lp.sizes, PACK.model.netWorthRs"},
    # ---- What-if
    ("whatif/WhatIfTab.jsx", "Equity IRR"): {"fn": "`res.finance.equityIrr` (= `atBid.equityIrr`), `equityNpv`, `meetsTarget`", "inputs": "fin.tariff (the bid tariff), fin.targetEquityIrr, the case"},
    ("whatif/WhatIfTab.jsx", "Project IRR"): {"fn": "`res.finance.projectIrr`", "inputs": "the case"},
    ("whatif/WhatIfTab.jsx", "Lender's IRR (debt)"): {"fn": "`res.finance.lenderIrr` = `debtIrr(atBid)` in `whatif/model.js`", "inputs": "the debt drawn and its service"},
    ("whatif/WhatIfTab.jsx", "DSCR min / average"): {"fn": "`res.finance.minDscr`, `avgDscr`, `bankable` (≥ fin.minDscr)", "inputs": "fin.minDscr, the cash flows"},
    ("whatif/WhatIfTab.jsx", "Project cost"): {"fn": "`res.atBid.capex.total`, `debt`, `equity`", "inputs": "costs, sizes, fin.debtFraction"},
    ("whatif/WhatIfTab.jsx", "LCOE"): {"fn": "`res.finance.lcoe`", "inputs": "fin.discountRate"},
    ("whatif/WhatIfTab.jsx", "Year-1 supply"): {"fn": "`res.year1.deliveredMWh` of `demandMWh` (`dispatchYear`)", "inputs": "the rule-based dispatch of year 1"},
    ("whatif/WhatIfTab.jsx", "Equity payback"): {"fn": "`res.finance.payback`", "inputs": "cumulative FCFE"},
    ("whatif/WhatIfTab.jsx", "Peak blocks at the floor, year 1"): {"fn": "`res.year1.rules.peak.share`, `met`, `hours` (`dispatchYear` against the Peak Hours floor)", "inputs": "the plan (Peak Hours), the dispatch"},
    ("whatif/WhatIfTab.jsx", "Off-peak blocks at the floor / Solar and Remaining blocks at the floor"): {"fn": "the other rules of `res.year1.rules` summed (`other`)", "inputs": "the profile in force (amd1 off-peak or amd3 Solar/Remaining Hours)"},
    ("whatif/WhatIfTab.jsx", "Short of the floors, year 1"): {"fn": "`res.year1.blockShortfallMWh`; penalty `res.penaltyY1` = `atBid.rows[0].blockPenalty`", "inputs": "the dispatch, the 1.5 × tariff penalty"},
    ("whatif/WhatIfTab.jsx", "Surplus sold / curtailed"): {"fn": "`res.year1.excessMWh`, `curtailMWh`, `res.ops[0].buyerExcessMWh`", "inputs": "fin.sellSurplus, fin.surplusPrice, the Solar Hours excess rule"},
    # ---- CfD example
    ("cfd/ExampleStep.jsx", "Every evening"): {"fn": "`x.commit.dailyMwh` = MW × 2 h", "inputs": "the example MW"},
    ("cfd/ExampleStep.jsx", "Every Contract Week"): {"fn": "`x.commit.weeklyMwh`, `weeklyMinMwh` (90%)", "inputs": "the example MW, TENDER tolerance"},
    ("cfd/ExampleStep.jsx", "Every year"): {"fn": "`x.commit.yearlyMwh`", "inputs": "the example MW"},
    ("cfd/ExampleStep.jsx", "Battery, at least"): {"fn": "`x.commit.batteryMw`, `batteryMwh`", "inputs": "the example MW, TENDER.essHoursMin"},
    ("cfd/ExampleStep.jsx", "EMD with the bid"): {"fn": "`x.money.emdCr` (`rfsAmounts`)", "inputs": "the example MW, RFS rates"},
    ("cfd/ExampleStep.jsx", "PBG after the award"): {"fn": "`x.money.pbgCr`", "inputs": "as above"},
    ("cfd/ExampleStep.jsx", "SECI's charges"): {"fn": "`x.money.cacCr + bidFeeCr + rfsCostCr`", "inputs": "as above"},
    ("cfd/ExampleStep.jsx", "Letter of Credit to SECI"): {"fn": "`lcCr(mw, sp)` = 2000 × MW × (₹10 − SP) × 30 days", "inputs": "the example MW and strike price"},
    ("cfd/ExampleStep.jsx", "Energy supplied"): {"fn": "`x.year.energyMwh`, `avgPrice` over the 12 months of evenings", "inputs": "the IEX prices of the chosen market"},
    ("cfd/ExampleStep.jsx", "The exchanges pay you"): {"fn": "`x.year.exchangeCr` = Σ market price × energy", "inputs": "the IEX prices"},
    ("cfd/ExampleStep.jsx", "The Pool pays you, net / You pay the Pool, net"): {"fn": "`x.year.poolCr` = youCr − exchangeCr; `daysPoolPays`, `daysYouPay`", "inputs": "the strike price, the IEX prices"},
    ("cfd/ExampleStep.jsx", "You receive"): {"fn": "`x.year.youCr` = SP × energy", "inputs": "the strike price"},
    # ---- CfD operations
    ("cfd/OperationsStep.jsx", "Supplied"): {"fn": "Σ `deliveredMwh` ÷ Σ `requiredMwh` over `sim.years`", "inputs": "the simulation"},
    ("cfd/OperationsStep.jsx", "Own RE share (after month 36)"): {"fn": "min `shareOwn` of the Contract Years after month 36", "inputs": "the simulation"},
    ("cfd/OperationsStep.jsx", "Green market share (after month 36)"): {"fn": "max `shareMarket` after month 36 against `TENDER.marketShare`", "inputs": "the simulation"},
    ("cfd/OperationsStep.jsx", "Group RE share"): {"fn": "max `shareGroup`", "inputs": "the simulation"},
    ("cfd/OperationsStep.jsx", "Days short of charging power"): {"fn": "Σ `shortDays`", "inputs": "the simulation"},
    ("cfd/OperationsStep.jsx", "Weeks with a penalty"): {"fn": "weeks with `beyondMwh` > 0; `penalty` = Σ `penaltyCr(year, sp)`", "inputs": "the simulation, the strike price"},
    ("cfd/OperationsStep.jsx", "Surplus RE sold"): {"fn": "Σ `merchantMwh`, `merchantRevCr`", "inputs": "the simulation"},
    ("cfd/OperationsStep.jsx", "Curtailed"): {"fn": "Σ `curtailedMwh`", "inputs": "the simulation"},
    # ---- CfD finance
    ("cfd/FinanceStep.jsx", "Strike price to bid"): {"fn": "`model.bid` (`solveStrikePrice`: the exact `sp` for the target equity IRR, rounded up to 2 decimals)", "inputs": "inputs.targetEquityIrr and the whole model"},
    ("cfd/FinanceStep.jsx", "Equity IRR"): {"fn": "`fin.equityIrr` (`xirr`), `fin.projectIrr`", "inputs": "the dated cash flows"},
    ("cfd/FinanceStep.jsx", "DSCR"): {"fn": "`fin.minDscr`, `fin.avgDscr`", "inputs": "the rows"},
    ("cfd/FinanceStep.jsx", "Levelised cost of supply"): {"fn": "`fin.levelisedCost` at inputs.discountRate, net of surplus sales and RECs", "inputs": "the cost flows"},
    ("cfd/FinanceStep.jsx", "Capex"): {"fn": "`fin.capex.total`, `atScd`, `atRe` (`capex(inputs)`)", "inputs": "inputs costs, own RE MW"},
    ("cfd/FinanceStep.jsx", "Letter of Credit to SECI"): {"fn": "`fin.lcCr` (`lcCr(mw, sp)`)", "inputs": "contracted MW, the strike price"},
    ("cfd/FinanceStep.jsx", "EMD and PBG"): {"fn": "`fin.rfs.emdCr`, `pbgCr`, `rows[0].bgCost`", "inputs": "RFS rates, contracted MW"},
    ("cfd/FinanceStep.jsx", "Energy supplied"): {"fn": "Σ `sim.years[].deliveredMwh`", "inputs": "the simulation"},
    ("cfd/FinanceStep.jsx", "Average evening market price"): {"fn": "`poolFlows(sim, bid)` year 2 `mcpAvg`", "inputs": "the IEX prices of inputs.sellMarket"},
    # ---- BESS results
    ("bess/results.jsx", "Lowest year-end energy"): {"fn": "`req.energyMwh + res.minMarginMwh` (`evaluate`: min over the plan's years of endPoiMwh − energyMwh)", "inputs": "req, tech, strategy"},
    ("bess/results.jsx", "Installed by the end"): {"fn": "`res.plan.years.at(-1).installedDcMwh`, `plan.cohorts[0].mwh`", "inputs": "buildPlan(req, tech, strategy)", "store": "summary `day1DcMwh`"},
    ("bess/results.jsx", "Augmentation"): {"fn": "`res.augEvents`, `augMwh`, `augCapexCr`", "inputs": "the plan", "store": "summary `augMwh`, `augIntervalYears`"},
    ("bess/results.jsx", "RTE in the last year"): {"fn": "`res.endRte` vs `state.req.minRte`", "inputs": "tech fade, req.minRte"},
    ("bess/results.jsx", "Energy the battery holds"): {"fn": "`B.typicalDay(req, tech, res, year).usableMwh`", "inputs": "the chosen year, the plan", "store": "computed"},
    ("bess/results.jsx", "Headroom over the contract"): {"fn": "`typicalDay().headroom`", "inputs": "as above", "store": "computed"},
    ("bess/results.jsx", "Round-trip efficiency"): {"fn": "`typicalDay().rte`", "inputs": "as above", "store": "computed"},
    ("bess/results.jsx", "Equity IRR"): {"fn": "`res.equityIrr` = `irr(cf.equityFlows)`", "inputs": "fin, the rows", "store": "summary `equityIrr`"},
    ("bess/results.jsx", "Project IRR"): {"fn": "`res.projectIrr`", "inputs": "the rows", "store": "summary `projectIrr`"},
    ("bess/results.jsx", "Debt · equity"): {"fn": "`res.debt`, `res.equity` (cf.debt0, equity0)", "inputs": "fin.debtFraction, fin.interestRate, capex"},
    ("bess/results.jsx", "DSCR"): {"fn": "`res.minDscr`, `avgDscr`", "inputs": "the rows", "store": "summary `minDscr`"},
    ("bess/results.jsx", "Capital cost"): {"fn": "`res.capex.total`, `dc`, `pcs`, `bop`", "inputs": "costs, the day-one DC MWh", "store": "summary `capexCr`, `vgfCr`"},
    # ---- BESS chapters
    ("bess/chapters.jsx", "Requirements found"): {"fn": "`state.tender.found` / `total` from the engine's parse", "inputs": "the uploaded tender", "store": "`inputs.state.tender`"},
    ("bess/chapters.jsx", "Capacity"): {"fn": "`state.req.powerMw`, `energyMwh` and their ratio (hours)", "inputs": "req inputs", "store": "summary `powerMw`, `energyMwh`"},
    ("bess/chapters.jsx", "Contract"): {"fn": "`state.req.contractYears`, `cyclesPerDay`", "inputs": "req inputs", "store": "summary `contractYears`, `cyclesPerDay`"},
    ("bess/chapters.jsx", "Risk flags"): {"fn": "`state.tender.risk_flags.length`", "inputs": "the parse", "store": "`inputs.state.tender`"},
    ("bess/chapters.jsx", "AC round-trip efficiency"): {"fn": "`B.rteAt(1, tech)` and `B.rteAt(contractYears, tech)` vs `req.minRte`", "inputs": "tech.rte and its fade"},
    ("bess/chapters.jsx", "DC needed for the contract"): {"fn": "`B.requiredDcMwh(req, tech)`", "inputs": "req.energyMwh, tech (DoD, RTE, aux)"},
    ("bess/chapters.jsx", "Capacity fade"): {"fn": "`tech.calendarFade + tech.cycleFadePer1000 × req.annualCycles ÷ 1000`", "inputs": "tech, req.annualCycles"},
    # ---- DSM
    ("dsm/DsmPanel.jsx", "Charge per MWh scheduled"): {"fn": "`dsmUnitCharge(...).perMwh` = a × contract tariff + b for year 1 and year 6", "inputs": "dsm.steps, tolerance, X factor, the tariff"},
    ("dsm/DsmPanel.jsx", "Blocks outside the band"): {"fn": "`dsmUnitCharge(...).outOfBand` from `sigma` (`sigmaOf`, firmed by the battery) and the tolerance band", "inputs": "dsm.sigmaPct, dsm.storageFirming, the category"},
    ("dsm/DsmPanel.jsx", "X factor"): {"fn": "`xFactor(year, codFy)` (X_TRAJECTORY)", "inputs": "dsm.codFy"},
    ("dsm/DsmPanel.jsx", "Year-1 charge"): {"fn": "`scheduledMu × y1.perMwh ÷ 1e4` (scheduledMu = year-1 delivered + sold)", "inputs": "the financial model's year 1", "store": "computed; the model keeps it as the `dsm` row"},
    # ---- QuoteCheck
    ("bid/QuoteCheck.jsx", "Equity IRR at this tariff"): {"fn": "`quotedReturns().equityIrr` (locked model at the quote) vs `targetEquityIrr`", "inputs": "the quote, state.lp, costs, fin"},
    ("bid/QuoteCheck.jsx", "Project IRR at this tariff"): {"fn": "`quotedReturns().projectIrr`, `targetProjectIrr` (at the target tariff)", "inputs": "as above"},
    ("bid/QuoteCheck.jsx", "Difference"): {"fn": "`gap` = quote − target tariff, `gapPct`, `minDscr`", "inputs": "as above"},
    # ---- DatesStep
    ("bid/DatesStep.jsx", "Next"): {"fn": "the first event on or after today in `tenderDates(result)`", "inputs": "the reading's dates"},
    ("bid/DatesStep.jsx", "Bid submission closes"): {"fn": "the event of kind `deadline`", "inputs": "the reading"},
    ("bid/DatesStep.jsx", "Supply starts"): {"fn": "the `supply_start_date` event", "inputs": "the reading"},
    # ---- SizeStep
    ("bid/SizeStep.jsx", "Battery at the solar site"): {"fn": "`lp.sizes.bessSolarSiteMw`, `bessSolarSiteMwh` (HiGHS, split sites)", "inputs": "state.sites.split, the LP"},
    ("bid/SizeStep.jsx", "Battery at the wind site"): {"fn": "`lp.sizes.bessWindSiteMw`, `bessWindSiteMwh`", "inputs": "as above"},
    ("bid/SizeStep.jsx", "Split between the sites"): {"fn": "`bessWindSiteMw ÷ bessMw`", "inputs": "as above"},
    ("bid/SizeStep.jsx", "<s.title>"): {"fn": "`lp.sizes.<source>Mw` per source on; detail: DC MWp from `state.src.solar.dcAc`, × contracted, `lp.perYear[0].<source>Mu`, `rampStats(hourly[source])` for biomass/thermal", "inputs": "the LP sizes, perYear, the hourly dispatch", "store": "summary `solarMw`, `windMw` (SECI); `results.lp.sizes`"},
    ("bid/SizeStep.jsx", "<s.title>", "mix["): {"fn": "`energyMix(hourly)[source]` MU delivered from each source on, and its share of `mix.demand`", "inputs": "the hourly dispatch", "store": "computed from the in-memory dispatch only"},
    ("bid/SizeStep.jsx", "Battery", "lp.sizes"): {"fn": "`lp.sizes.bessMw` / `bessMwh` and the hours", "inputs": "the LP", "store": "summary `bessMw`, `bessMwh` (SECI); `results.lp.sizes`"},
    ("bid/SizeStep.jsx", "Battery", "mix.battery"): {"fn": "`energyMix(hourly).battery` MU discharged and its share of demand", "inputs": "the hourly dispatch", "store": "computed from the in-memory dispatch only"},
    ("bid/SizeStep.jsx", "25-year tariff (HiGHS)"): {"fn": "`lp.tariff`, `lp.lowerBound` (`rtc_lp.py` solve)", "inputs": "the LP", "store": "`results.lp.tariff`, `inputs.state.lp.tariff`; summary `tariff` when no quote"},
    ("bid/SizeStep.jsx", "Contracted (100%)"): {"fn": "`energyMix(hourly).demand`", "inputs": "the hourly dispatch", "store": "computed from the in-memory dispatch only"},
    ("bid/SizeStep.jsx", "Not supplied"): {"fn": "`energyMix(hourly).unmet`", "inputs": "the hourly dispatch", "store": "computed from the in-memory dispatch only"},
    ("bid/SizeStep.jsx", "Sold on IEX <lp.market> / Sold in the market"): {"fn": "`energyMix(hourly).export`, `exportRevenueCr` (at the hourly price, capped at the buyer's share), or × `lp.flatPrice`", "inputs": "the hourly dispatch, the IEX prices or flat price", "store": "computed from the in-memory dispatch only"},
    ("bid/SizeStep.jsx", "Curtailed"): {"fn": "`energyMix(hourly).curtail`", "inputs": "the hourly dispatch", "store": "computed from the in-memory dispatch only"},
    # ---- CapacityStep
    ("bid/CapacityStep.jsx", "Contracted capacity sized"): {"fn": "`plantMw(state, terms)` = baseMw (+ greenshoe)", "inputs": "state.bid"},
    ("bid/CapacityStep.jsx", "Solar the tender requires"): {"fn": "`solarMinMw(state, terms)` = terms.solarMultiple × contracted", "inputs": "the tender's solar multiple"},
    ("bid/CapacityStep.jsx", "Supply floors"): {"fn": "`terms.rules[].target` and labels (`tenderTerms`)", "inputs": "the reading's supply rules (ticked proposals)"},
    # ---- bid/FinanceStep
    ("bid/FinanceStep.jsx", "Tariff (fixed) / Bid tariff"): {"fn": "`finance.tariff` (solved for the target equity IRR by NPV, or fixed); detail `lp.tariff`", "inputs": "the model; state.tariffLocked"},
    ("bid/FinanceStep.jsx", "Ceiling tariff"): {"fn": "`terms.ceiling` and `headroom` = ceiling − finance.tariff", "inputs": "the tender's ceiling (provenance `prov.ceiling`)"},
    ("bid/FinanceStep.jsx", "Equity IRR"): {"fn": "`finance.equityIrr`", "inputs": "the model"},
    ("bid/FinanceStep.jsx", "Project IRR"): {"fn": "`finance.projectIrr`", "inputs": "the model"},
    ("bid/FinanceStep.jsx", "Minimum DSCR"): {"fn": "`finance.minDscr`, `avgDscr`", "inputs": "the model"},
    ("bid/FinanceStep.jsx", "Project cost"): {"fn": "`finance.capex.total`; per contracted MW; `finance.lcoe`", "inputs": "sizes × costs, preopPct, evacuationCr, IDC"},
    ("bid/FinanceStep.jsx", "Year-1 supply"): {"fn": "`finance.rows[0].deliveredMu`, `dfr`", "inputs": "lp.lifetime[0] through `opsFromLp`"},
    ("bid/FinanceStep.jsx", "Year-1 operating cost"): {"fn": "`finance.rows[0].opex` (+ `fuel`, `hydroCost`, `thermalCost`)", "inputs": "O&M rates, insurance, fuel"},
    ("bid/FinanceStep.jsx", "<s.title> capex"): {"fn": "`capexBySource(sizes, costs)[source]`", "inputs": "lp.sizes, costs per MW/MWh, preopPct"},
    ("bid/FinanceStep.jsx", "Bid security (EMD)"): {"fn": "`terms.emdPerMw × state.bid.baseMw`", "inputs": "the tender's EMD per MW (provenance `prov.emd`)"},
    ("bid/FinanceStep.jsx", "Performance guarantee (PBG)"): {"fn": "`terms.pbgPerMw × plantMw`", "inputs": "the tender's PBG per MW"},
    ("bid/FinanceStep.jsx", "Equity"): {"fn": "`finance.equity`, `finance.debt`", "inputs": "project cost, fin.debtFraction"},
    ("bid/FinanceStep.jsx", "Equity payback"): {"fn": "`finance.payback`", "inputs": "cumulative FCFE"},
    ("bid/FinanceStep.jsx", "PPA supply, year 1"): {"fn": "`finance.rows[0].energyRevenue` = deliveredMu × tariff ÷ 10", "inputs": "year-1 delivered, the tariff"},
    ("bid/FinanceStep.jsx", "<saleLabel>, year 1"): {"fn": "`finance.rows[0].surplusRevenue` (from `lp.lifetime[0].exportRevenueCr` when sized against IEX prices, else excess × surplusPrice)", "inputs": "the LP's export, the market"},
    ("bid/FinanceStep.jsx", "<saleLabel>, <fin.years> years"): {"fn": "Σ `finance.rows[].surplusRevenue` and its share of `finance.totals.revenue`", "inputs": "every year's export"},
    ("bid/FinanceStep.jsx", "Total revenue, <fin.years> years"): {"fn": "`finance.totals.revenue`, `totals.penalty`", "inputs": "every year's rows"},
    # ---- market
    ("market/RecentTendersTab.jsx", "<t.label>"): {"fn": "four tiles (FDRE-RTC, FDRE peak power, Wind, Solar + storage): `tile(product)` → `tariffRange(latest(product))` over `SECI_RESULTS`", "inputs": "the result list in `web/src/market/seed.js`", "store": "code; not stored"},
}


# ----------------------------------------------------------------------------- extra tables (curated)

EXTRA_TABLES = [
    ("Construction month by month (`web/src/rtc/ConstructionView.jsx`, F.3b of FinanceView)",
     "Columns Month, Share, Cost drawn, Equity, Debt drawn, Opening debt, IDC, Closing debt = `finance.construction.rows[].{month, share, cost, equity, debt, openingDebt, idc, closingDebt}` "
     "and the Total row (`construction.equity`, `debtDrawn`, `idc`, `finance.debt`). Computed by `web/src/rtc/engine.js` constructionSchedule. Stored only in Round the clock saves "
     "(`results.finance.construction`); the Excel twin writes the same table as formulas (`web/lib/liveModel.js` CONSTRUCTION_SHEET)."),
    ("Plant to meter ladder (`web/src/rtc/MeterView.jsx`, `data-testid=\"rtc-meter-ladder\"`)",
     "Year-1 MU from the 33 kV bus to the 220 kV meter: generated, injected, transformer loss, line loss, at the meter, delivered, sold — `sim.evac.{injectedMWh, trafoLossMWh, lineLossMWh, meterMWh}`, `sim.deliveredMWh`, `sim.excessMWh` (`E.simulate`). "
     "Stored as `results.sim.evac` and the summary fields `meterMu`, `evacLossMu` on Save."),
    ("Tender conditions table (`web/src/bid/SizeStep.jsx` ComplianceTable, Tender to Bid and SECI Size step)",
     "One row per supply floor and one column per modelled year: `lp.perYear[y].rules[i]` from `engine/sizing/rtc_lp.py` (`basis: \"block\"` floors show met / shortfallMu / achieved / penaltyMultiple; "
     "annual floors show achieved against target). Computed by HiGHS on the engine; stored in `state.lp.perYear` (localStorage; SECI `scenarios.inputs.state.lp.perYear`), not in `results.lp`."),
    ("Tender compliance (`web/src/bess/results.jsx` Compliance)",
     "Rows `B.compliance(state.req, state.tech, res)` (`web/src/bess/engine.js`): label, required, design, note, ok, with the source page and clause of each requirement from `state.reqSource` (set when the tender is parsed). Computed; not stored."),
    ("What-if tender compliance (`web/src/whatif/WhatIfTab.jsx` section 2)",
     "`res.checks[]` and `res.verdict` (pass / penalty / fail) from `runWhatIf`: bid range (`SECI_LIMITS`), storage in place, every peak and off-peak block at its floor in year 1. Computed; not stored."),
    ("Tariff levers (`web/src/whatif/LeverPanel.jsx`)",
     "Columns Lever, Now, One step, Tariff if up, Tariff if down, ₹/kWh per step, To reach ₹X alone = `leverEffects(state, { prices, target, base })[]` "
     "(`web/src/whatif/levers.js`: `runWhatIf` with each lever of LEVERS moved one step either side; slope and secant to the target). Computed on the button, kept in component state; the target tariff is component state too. Not stored."),
    ("What-if year by year (`WhatIfTab.jsx` section 4) and the 25-year table (`FinanceView.jsx`)",
     "`res.atBid.rows[]` / `finance.rows[]`: see the financial model lines below."),
    ("BESS financial model (`web/src/bess/results.jsx` FinanceTable)",
     "Columns Year, Revenue, O&M, RTE penalty, EBITDA, Augmentation, Interest, Principal, Tax, DSCR, Equity CF = `res.rows[].{year, revenue, om, rtePenalty, ebitda, aug, interest, principal, tax, dscr, fcfe}` "
     "(`web/src/bess/engine.js` evaluate). Stored as `results.res.rows` on Save; CSV export in the browser."),
    ("CfD revenue and costs by year (`web/src/cfd/FinanceStep.jsx` 6.2 / 6.3)",
     "`model.fin.rows[]` per period (`financials` in `web/src/cfd/model.js`). Computed; not stored."),
    ("SECI step strip (`web/src/seci/SeciTab.jsx` `summary`)",
     "The one-line summary under each step: documents and changes counted from `PACK`, `state.bid.baseMw`, the design and finance inputs still missing (`missingInputs`), `state.lp.tariff` after sizing, and "
     "`formatsSummary(state).reviewed / needed` for the bid forms. Computed from state."),
    ("The answer panels (`web/src/rtc/results.jsx` Answer, `web/src/bess/results.jsx` BidAnswer)",
     "Round the clock: the sizes (`sizes.solarMw`, `windMw`, `bessMw` / `bessMwh`) with `finance.tariff`; BESS: the day-one DC MWh, `res.augMwh`, `res.capex.net` and the capacity charge `res.charge / 1e5` ₹ lakh/MW/month. "
     "Both from the memoised results above; stored through `summary` and `results` on Save."),
]

NARRATIVE = """
## How the state moves

### One React state per tab, mirrored to localStorage, saved on request

Each tab owns one state object. The six tabs that hold a case keep it in a `useState` at the top of
the tab component and write it to the browser's `localStorage` 400 ms after each change (Tender to Bid and CfD
also flush on unload so the last change is not lost): Tender to Bid `fdre.bid.v4` (`web/src/bid/BidTab.jsx`, state shape
`web/src/bid/model.js` defaultBidState), SECI RTC tender `tenderos.seci.v1` (`web/src/seci/SeciTab.jsx`,
`web/src/seci/state.js` defaultSeciState), Round the clock `fdre.rtc.v1` (`web/src/rtc/RtcTab.jsx`),
BESS tender `fdre.bess.v1` (`web/src/bess/BessTab.jsx`), CfD bid `fdre.cfd.v1` (`web/src/cfd/CfdTab.jsx`)
and What-if `tenderos-whatif` (`web/src/whatif/WhatIfTab.jsx`, standalone only). A module-level
`sessionState` keeps the state while the user switches dashboard tabs, so a tab remounts where it was.

Results are **not** part of that saved state except the HiGHS sizing: `useSizing.js` writes the LP
summary (without the hourly dispatch) into `state.lp`, so it survives a reload; the hourly dispatch
and the run log live in a module-level `sizingSession` and are gone after a reload (the Year-1 energy
section of the Size step then waits for the next sizing). The Round the clock optimizer result (`opt`)
and the BESS strategy search are module-level session variables too.

Everything else on screen is recomputed from the state on every render with `useMemo`: the
financial model (`E.runFinancialModel`), the year-1 simulation (`E.simulate`), the What-if run, the
CfD model, the BESS evaluation, the DSM charges, the quoted-tariff check.

"Save" (`web/src/scenarios/SaveDialog.jsx`) exists in Round the clock, BESS tender and SECI RTC
tender. It calls the tab's `buildSave()` and posts `{ inputs: { state }, results, summary }` to
`POST /api/scenarios` (a new scenario and its version 1) or `PUT /api/scenarios/{id}` (the next
version of the linked scenario): `web/lib/scenarios.js` createScenario / addVersion write
`scenarios` and `scenario_versions` in one transaction and `activity_log` gets a `scenario_save` row.
What each module puts in `results` and `summary` is listed in `docs/dev/DATABASE.md`. Tender to Bid,
CfD and What-if are never saved to the database.

### What is recomputed on load

Opening a scenario (`/?open=<id>&v=<version>`, `web/app/page.js` → `getScenario` → the tab's
`initialScenario` prop) replaces the tab's state with `inputs.state`, merged over the current
defaults so fields added since the save get their default (`mergeState` in RtcTab, `mergeBidState` +
`fromSaved` in SeciTab, a spread in BessTab). Then:

* **Round the clock** recomputes the simulation, finance and capex from the state at once; the
  optimizer result is restored from `results.opt` (its cloud thinned at save time) so the solver
  log and tariff map show without a re-run.
* **SECI RTC tender** recomputes the financial model from `inputs.state.lp`; the sizing's hourly
  dispatch is not saved, so the Size step's year-1 energy mix and dispatch week appear after the
  next sizing; the What-if step is re-seeded from the bid (`whatIfFromBid`) on each new sizing.
* **BESS tender** recomputes `B.evaluate` from the state and restores the strategy map from
  `results.opt`.
* `results.sim`, `results.finance`, `results.res` and `summary` are read only by the library list,
  the comparison page and the Excel export (`GET /api/scenarios/export`), never by the tabs.

A plain reload (no `?open=`) reads `localStorage` instead and recomputes the same way.

### Team and evidence rows beside the state

The tender team's work hangs off a saved SECI bid: `assignments` carry a `target_key` into the bid
state (`web/src/team/apply.js`: `forms.<key>`, `src.<source>.<field>`, `fin.<key>`, `costs.<key>`,
`format.<id>`, `condition.<id>`); accepting an answer writes it into the state in the browser and
saves a new version (`SeciTab.jsx` acceptAnswer). Team-mode messages (`team_messages`) and evidence
(`evidence`, `field_signoff`) are keyed by the box, not the scenario: `<tab>:<data-testid>` or
`<tab>:<section>:<label>` (`web/src/team/mentions.js` threadKey), with the box's value at the time
in `field_value` / `value_at`. Usage events (`activity_log`) are posted by `web/src/activity.js`.

### The MCP server's bid

`web/lib/mcp.js` serves Claude the same bid model without a browser. Each MCP session
(`Mcp-Session-Id`) gets its own bid: `newSession` builds `state = defaultSeciState()` and a
`createToolRunner` (`web/src/seci/agent.js`, the SECI voice agent's tools) over it, so `set_input`,
`use_benchmarks`, `run_optimizer` (`sizeOnEngine` → `POST /api/rtc/lp`, writing `state.lp` and
`sizingSeed` like `useSizing`), `get_results`, `get_financials`, `check_tariff` and
`review_bid_forms` work on that state; `check_bid` runs `runWhatIf` and `winning_bid` reads
`web/src/seci/winningBid.js`. The sessions live in a `Map` in the web server process (6-hour TTL,
50 at most, evicted oldest first); nothing is written to the database or to localStorage, and a
restart or an unknown session id starts a fresh bid. The route is `web/app/api/mcp/[token]/route.js`
(on only when `MCP_TOKEN` is set).
"""


# ----------------------------------------------------------------------------- rendering


def stat_rows() -> tuple[list[dict], list[str]]:
    rows = []
    unresolved = []
    for f in sorted(SRC.rglob("*.jsx")):
        text = f.read_text(encoding="utf-8")
        tags = find_tags(text, "Stat")
        if not tags:
            continue
        rel = f.relative_to(SRC).as_posix()
        defaults = FILES.get(rel)
        for t in tags:
            attrs = t["attrs"]
            if "label" not in attrs:
                continue
            label = label_text(attrs["label"])
            value = attrs.get("value", ("expr", ""))[1]
            trace = attrs.get("trace", (None, ""))[1]
            cur = STATS.get((rel, label))
            # a label used twice in one file (e.g. per-source tiles in two sections): a third key names a token of the value expression
            for key, entry in STATS.items():
                if len(key) == 3 and key[0] == rel and key[1] == label and key[2] in value:
                    cur = entry
            if cur is None:
                unresolved.append(f"{rel}:{t['line']} {label}")
            fn = (cur or {}).get("fn") or ("to confirm" if not defaults else f"see the file's note: {defaults['fn']}")
            inputs = (cur or {}).get("inputs") or ("to confirm" if not defaults else defaults["inputs"])
            store = (cur or {}).get("store") or ("see the file's note above" if defaults else "to confirm")
            rows.append({
                "file": rel, "line": t["line"], "label": label, "value": value, "trace": trace,
                "screen": defaults["screen"] if defaults else "to confirm", "fn": fn, "inputs": inputs, "store": store,
                "expr_label": attrs["label"][0] == "expr",
            })
    return rows, unresolved


def trace_text(trace: str) -> str:
    if not trace:
        return ""
    m = re.search(r"key:\s*\"(\w+)\"", trace)
    if m:
        return TRACE_NOTE + f"the named cell `{m.group(1)}`"
    m = re.search(r"line:\s*\"(\w+)\",\s*year:\s*(\d+)", trace)
    if m:
        return TRACE_NOTE + f"line `{m.group(1)}`, year {m.group(2)}"
    return TRACE_NOTE + code(compact(trace, 60))


def render() -> str:
    rows, unresolved = stat_rows()
    fv = (SRC / "rtc" / "FinanceView.jsx").read_text(encoding="utf-8")
    fin_lines = parse_lines_array(fv, "FIN_LINES")
    trace_line = parse_trace_line(fv)
    meter_lines = parse_lines_array((SRC / "rtc" / "RtcTab.jsx").read_text(encoding="utf-8"), "METER_LINES")
    bid_fs = (SRC / "bid" / "FinanceStep.jsx").read_text(encoding="utf-8")
    cost_lines = re.findall(r"\[\"([^\"]+)\", \"(\w+)\", \d(?:, -?\d)?\]", bid_fs[bid_fs.find("function costLines"):bid_fs.find("function RevenueStack")])
    optional = re.search(r"const OPTIONAL_LINES = \[(.*?)\]", fv)
    optional_keys = set(re.findall(r"\"(\w+)\"", optional.group(1))) if optional else set()

    out: list[str] = []
    w = out.append
    w("# TenderOS Demo 2: from the screen to the data")
    w("")
    w("Generated by `tools/gen_screen_map.py`; do not edit by hand. The headline numbers (`<Stat>`) and the")
    w("financial-model line lists are read from `web/src` on every run; the computing function, inputs and")
    w("storage come from the curated map in the script, checked against the code it cites. Anything the")
    w("script could not match is marked **to confirm**.")
    w("")
    files = sorted({r["file"] for r in rows})
    w(f"{len(rows)} headline numbers in {len(files)} files, {len(fin_lines)} entries in the 25-year table, {len(EXTRA_TABLES)} other calculated tables.")
    w("")
    w("Storage vocabulary: **computed** = worked out from the tab's state on every render and never stored; "
      "**localStorage `key`** = part of the tab's state the browser keeps under that key; "
      "**`scenarios.inputs.state.<path>`**, **`results.<path>`**, **`summary.<field>`** = the jsonb of the saved version "
      "(`scenario_versions`) when the tab is saved to the library (Round the clock, BESS, SECI only); a table name = a database row written by an API route.")
    w("")
    w("## Headline numbers (`<Stat label=… value=…>` in `web/src`)")
    w("")
    w("One row per `<Stat>` tag (`web/src/rtc/ui.jsx` Stat): a label, a value, a detail line and, with `trace`, a click that opens the traceable model at that cell.")
    w("")
    for rel in files:
        d = FILES.get(rel)
        w(f"### `web/src/{rel}`")
        w("")
        if d:
            w(f"**Screen:** {d['screen']}  ")
            w(f"**Computed by:** {d['fn']}  ")
            w(f"**Rests on:** {d['inputs']}  ")
            w(f"**Stored:** {d['store']}")
        else:
            w("**Screen / computed by / stored:** to confirm (no entry in FILES).")
        w("")
        w("| Label as shown | Where | Value expression | Computed by | Inputs | Stored |")
        w("| --- | --- | --- | --- | --- | --- |")
        for r in [x for x in rows if x["file"] == rel]:
            label = r["label"] + (" *(label is an expression)*" if r["expr_label"] else "")
            fn = r["fn"]
            if r["trace"]:
                fn += "; " + trace_text(r["trace"])
            w(f"| {label} | `{rel}:{r['line']}` | {code(compact(r['value']))} | {fn} | {r['inputs']} | {r['store']} |")
        w("")
    # ---- 25-year table
    w("## The 25-year financial model table (`web/src/rtc/FinanceView.jsx` FIN_LINES)")
    w("")
    w("Shown in Round the clock › Finance, Tender to Bid › Financials and SECI › Financial model (FinanceView is shared), one column per year.")
    w("Every cell is `finance.rows[year][key]`, computed by `web/src/rtc/engine.js` cashflows (called by runFinancialModel) from the year's")
    w("operations (`ops`: the simulation in Round the clock, `opsFromLp(lp, …)` in the bid tabs) and the cost, financing and tax inputs.")
    w("A click on a cell opens the traceable model at the Live model line named in the Trace column (`TRACE_LINE` in FinanceView.jsx → `web/lib/liveModel.js`).")
    w("Stored: Round the clock saves the whole `finance.rows` as `results.finance.rows` (the Excel export `GET /api/scenarios/export` prints it);")
    w("the bid tabs store nothing of it (recomputed from `inputs.state.lp` on load). Rows marked *optional* show only when some year has a value.")
    w("")
    w("| Line as shown | `finance.rows[].key` | Trace line | Note |")
    w("| --- | --- | --- | --- |")
    for label, key, fmt, sign, strong in fin_lines:
        if key is None:
            w(f"| **{label}** | | | group |")
            continue
        notes = []
        if strong:
            notes.append("total")
        if key in optional_keys:
            notes.append("optional")
        if sign == "-1":
            notes.append("shown as a deduction")
        if fmt == "pct":
            notes.append("percent")
        w(f"| {label} | `{key}` | {('`' + trace_line[key] + '`') if key in trace_line else '–'} | {', '.join(notes)} |")
    w("")
    w("Round the clock adds the bus-to-meter energy lines before *Delivered* (`web/src/rtc/RtcTab.jsx` METER_LINES, from `ops[].{genBusMu, injectedMu, trafoLossMu, lineLossMu, meterMu}`):")
    w("")
    w("| Line as shown | key |")
    w("| --- | --- |")
    for label, key, *_ in meter_lines:
        w(f"| {label} | `{key}` |")
    w("")
    w("Tender to Bid / SECI add cost lines after *Other fixed* when the source is on (`web/src/bid/FinanceStep.jsx` costLines, from `opsFromLp` → `lp.lifetime[]` energies and the fuel/plant costs):")
    w("")
    w("| Line as shown | key |")
    w("| --- | --- |")
    for label, key in cost_lines:
        w(f"| {label} | `{key}` |")
    w("")
    w("The Y0 column is `-finance.equity` (Free cash to equity), `-finance.capex.total` (Project cash flow) and `finance.debt` (Closing balance).")
    w("")
    # ---- other tables
    w("## Other calculated tables")
    w("")
    for title, text in EXTRA_TABLES:
        w(f"* **{title}.** {text}")
    w("")
    w(NARRATIVE.rstrip())
    w("")
    if unresolved:
        w("## To confirm")
        w("")
        w("Headline numbers found in the code with no curated entry (they use their file's note above):")
        w("")
        for u in unresolved:
            w(f"* {u}")
        w("")
    return "\n".join(out)


def main() -> None:
    text = render()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            sys.exit(f"{OUT.relative_to(ROOT)} is stale: run python3 tools/gen_screen_map.py")
        print(f"{OUT.relative_to(ROOT)} is up to date")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    rows, unresolved = stat_rows()
    print(f"wrote {OUT.relative_to(ROOT)}: {len(rows)} headline numbers in {len({r['file'] for r in rows})} files, {len(unresolved)} to confirm")
    for u in unresolved:
        print("  to confirm:", u)


if __name__ == "__main__":
    main()
