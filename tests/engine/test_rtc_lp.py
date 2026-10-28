"""Round-the-clock sizing LP (engine/sizing/rtc_lp.py): years, finance weights and a small solve."""
from __future__ import annotations

import math

import numpy as np
import pytest

from engine.sizing import rtc_lp as M

FIN = {
    "years": 25, "targetEquityIrr": 0.14, "debtFraction": 0.7, "interestRate": 0.09, "tenorYears": 15,
    "repayment": "equal", "taxRate": 0.2517, "taxDepreciation": "wdv", "wdvRate": 0.4, "bookLifeYears": 25,
    "salvagePct": 0.1, "solarOmLakhPerMw": 4.0, "windOmLakhPerMw": 9.0, "bessOmLakhPerMwh": 1.2,
    "omEscalation": 0.05, "insurancePct": 0.003, "otherFixedCr": 0, "receivableDays": 45, "sellSurplus": False,
    "surplusPrice": 2.5, "tariffEscalation": 0, "solarDegradation": 0.005, "windDegradation": 0, "demandGrowth": 0,
}
BESS = {"rte": 0.87, "minSoc": 0.05, "maxSoc": 0.95, "initSoc": 0.5, "annualDegradation": 0.02,
        "augmentation": "annual", "augmentationYear": 12, "costDeclinePct": 0.03, "durationH": 4}
COSTS = {"solarCrPerMw": 3.5, "windCrPerMw": 6.5, "bessCrPerMwh": 1.2, "bessPcsCrPerMw": 0, "evacuationCr": 0, "preopPct": 0.05}


def test_representative_years():
    assert M.representative_years(FIN, BESS) == [1, 25]  # annual top-ups: year 25 binds
    assert M.representative_years(FIN, {**BESS, "augmentation": "oneTime"}) == [1, 11, 12, 25]
    flat = {**FIN, "solarDegradation": 0}
    assert M.representative_years(flat, {**BESS, "annualDegradation": 0}) == [1]
    assert M.representative_years(FIN, BESS, "all") == list(range(1, 26))
    w = M.interpolation_weights([1, 25], 25)
    assert np.allclose(w.sum(axis=1), 1) and w[12, 0] == pytest.approx(0.5)


def test_tax_timing_carries_losses_forward():
    taxable = np.array([0, -10, -5, 4, 6, 8, 3] + [5] * 19, float)
    z = M.tax_timing(FIN, taxable)
    # the 15 of losses are used up in year 5 (4 + 6 + 8 >= 15), so tax on years 1-5 lands in year 5
    assert list(z[1:6]) == [5, 5, 5, 5, 5] and z[6] == 6
    assert list(M.tax_timing(FIN, None)[1:4]) == [1, 2, 3]


def test_tariff_weights_reduce_to_discounting():
    fin = {**FIN, "taxRate": 0, "debtFraction": 0, "receivableDays": 0, "salvagePct": 0}
    tw = M.tariff_weights(fin)
    v = np.array([1.14 ** -y for y in range(1, 26)])
    assert tw["capex"] == pytest.approx(1.0)
    assert np.allclose(tw["rev"][1:], v) and np.allclose(tw["opex"][1:], v) and np.allclose(tw["aug"][1:], v)


def _case(seed=5):
    rng = np.random.default_rng(seed)
    h = np.arange(M.HOURS) % 24
    day = np.arange(M.HOURS) // 24
    solar = np.clip(np.sin((h - 6) / 12 * math.pi), 0, None) * (0.9 + 0.1 * np.cos(day / 365 * 2 * math.pi))
    solar *= 0.24 / solar.mean()
    wind = np.clip(0.33 + 0.25 * np.sin(day / 365 * 2 * math.pi) + 0.2 * np.sin(h / 24 * 2 * math.pi + 2) + rng.normal(0, 0.12, M.HOURS), 0, 1)
    demand = np.full(M.HOURS, 2455e3 / M.HOURS)
    return solar, wind, demand


def _greedy_dfr(solar, wind, demand, plant, sizes, bess):
    """The browser engine's dispatch rule (simulate() in engine.js), year 1."""
    eta = math.sqrt(bess["rte"])
    E = sizes["bessMwh"]
    lo, hi = E * bess["minSoc"], E * bess["maxSoc"]
    soc = min(hi, max(lo, E * bess["initSoc"]))
    delivered = 0.0
    for t in range(M.HOURS):
        target = min(demand[t], plant)
        g = sizes["solarMw"] * solar[t] + sizes["windMw"] * wind[t]
        direct = min(g, target)
        ch = max(0.0, min(g - direct, sizes["bessMw"], (hi - soc) / eta))
        soc += ch * eta
        dis = max(0.0, min(target - direct, sizes["bessMw"], (soc - lo) * eta))
        soc -= dis / eta
        delivered += direct + dis
    return delivered / demand.sum()


@pytest.mark.skipif(M.highspy is None, reason="highspy not installed")
def test_lp_meets_dfr_and_matches_engine_dispatch():
    solar, wind, demand = _case()
    fin = {**FIN, "solarDegradation": 0}
    bess = {**BESS, "annualDegradation": 0}
    payload = {
        "ctx": {"demand": demand.tolist(), "solarCf": solar.tolist(), "windCf": wind.tolist(), "plantMw": 285},
        "bess": bess, "costs": COSTS, "fin": fin, "dfrTarget": 0.85, "dfrBasis": "annual",
        "vars": {"solarMw": {"min": 0, "max": 1200}, "windMw": {"min": 0, "max": 900}, "bessMw": {"min": 0, "max": 500}},
        "tariffGuess": 5.5,
    }
    lines = []
    res = M.solve(payload, on_log=lines.append)
    assert res["ok"], res.get("status")
    assert res["years"] == [1]
    assert res["perYear"][0]["dfr"] >= 0.85 - 1e-6
    assert res["lowerBound"] <= res["tariff"] + 1e-9 and res["tariff"] - res["lowerBound"] < 0.01
    assert any(line["stage"] == "highs-log" for line in lines), "HiGHS output is streamed"
    # the engine's greedy dispatch reaches the same DFR with the LP's sizes
    assert _greedy_dfr(solar, wind, demand, 285, res["sizes"], bess) == pytest.approx(res["perYear"][0]["dfr"], abs=0.003)
    # and 5% less of everything cannot meet the target: the answer is not oversized
    smaller = {k: v * 0.95 for k, v in res["sizes"].items()}
    assert _greedy_dfr(solar, wind, demand, 285, smaller, bess) < 0.85


@pytest.mark.skipif(M.highspy is None, reason="highspy not installed")
def test_lp_bills_at_the_220kv_meter_after_transformer_and_line_losses():
    """Profiles at the 33 kV bus, billing at the 220 kV GSS: the LP with a 0.4% power transformer and
    a 0.5% line loss is the lossless LP for demand and capacity referred to the bus (÷ η), with every
    MWh billed η smaller, so the same plant and a tariff 1/η higher."""
    solar, wind, demand = _case()
    fin = {**FIN, "solarDegradation": 0}
    bess = {**BESS, "annualDegradation": 0}
    eta = (1 - 0.004) * (1 - 0.005)

    def run(ctx_extra, dem, plant):
        payload = {
            "ctx": {"demand": dem.tolist(), "solarCf": solar.tolist(), "windCf": wind.tolist(), "plantMw": plant, **ctx_extra},
            "bess": bess, "costs": COSTS, "fin": fin, "dfrTarget": 0.85, "dfrBasis": "annual",
            "vars": {"solarMw": {"min": 0, "max": 1200}, "windMw": {"min": 0, "max": 900}, "bessMw": {"min": 0, "max": 500}},
            "tariffGuess": 5.5, "gapTol": 1e-6,
        }
        return M.solve(payload)

    lossy = run({"trafoLossPct": 0.004, "lineLossPct": 0.005}, demand, 285)
    bus = run({}, demand / eta, 285 / eta)
    assert lossy["ok"] and bus["ok"]
    assert lossy["evacuationEfficiency"] == pytest.approx(eta)
    for k in ("solarMw", "windMw", "bessMw"):
        assert lossy["sizes"][k] == pytest.approx(bus["sizes"][k], rel=1e-3, abs=0.5)
    assert lossy["tariff"] * eta == pytest.approx(bus["tariff"], rel=1e-4)
    assert lossy["perYear"][0]["dfr"] == pytest.approx(bus["perYear"][0]["dfr"], abs=1e-6)
    assert lossy["perYear"][0]["deliveredMu"] == pytest.approx(bus["perYear"][0]["deliveredMu"] * eta, rel=1e-6)


@pytest.mark.slow  # four full solves: several minutes
@pytest.mark.skipif(M.highspy is None, reason="highspy not installed")
def test_a_seed_reaches_the_same_optimum_in_fewer_solves():
    """The browser starts each sizing from the last one (bid/model.js seedFor): its tariff and tax
    timing start the first solve near the answer; the optimum is the same. A seed that does not fit
    (wrong number of years, a size missing) is ignored."""
    solar, wind, demand = _case()
    payload = {
        "ctx": {"demand": demand.tolist(), "solarCf": solar.tolist(), "windCf": wind.tolist(), "plantMw": 285},
        "bess": BESS, "costs": COSTS, "fin": FIN, "dfrTarget": 0.85, "dfrBasis": "annual",
        "vars": {"solarMw": {"min": 0, "max": 1200}, "windMw": {"min": 0, "max": 900}, "bessMw": {"min": 0, "max": 500}},
        "tariffGuess": 5.5, "returnLifetime": True,
    }
    cold = M.solve(dict(payload))
    assert cold["ok"]
    seed = {"from": "your last sizing", "tariff": round(cold["tariff"], 2), "sizes": cold["sizes"],
            "deliveredMwh": [y["deliveredMwh"] for y in cold["lifetime"]], "exportMwh": [y["exportMwh"] for y in cold["lifetime"]]}
    lines = []
    warm = M.solve({**payload, "seed": seed, "tariffGuess": seed["tariff"]}, on_log=lines.append)
    assert warm["ok"]
    assert warm["tariff"] == pytest.approx(cold["tariff"], abs=0.003)
    assert len(warm["iterations"]) < len(cold["iterations"])
    assert any("from your last sizing" in line["msg"] for line in lines)
    # a seed for another term, or without the battery's size, is not used
    for bad in ({**seed, "deliveredMwh": seed["deliveredMwh"][:10]}, {**seed, "sizes": {"solarMw": 1, "windMw": 1}}):
        lines = []
        res = M.solve({**payload, "seed": bad}, on_log=lines.append)
        assert res["ok"] and any("tax paid in the year it arises" in line["msg"] for line in lines)


def _formula_delivered(d: dict, y: dict, sizes: dict, fin: dict, bess: dict) -> tuple[float, float, float]:
    """Delivered MWh, shortfall MWh and the lowest battery level of a modelled year, worked out as the
    workbook's dispatch sheet works them out (web/lib/dispatchSheets.js) from the optimiser's choices."""
    f = M.year_factors(y["year"], fin, bess)
    solar = np.asarray(d["solarCf"]) * f["solarFactor"] * sizes["solarMw"]
    wind = np.asarray(d["windCf"]) * f["windFactor"] * sizes["windMw"]
    ch, dis = np.asarray(y["charge"]), np.asarray(y["discharge"])
    sold = np.asarray(y["sold"]) if d["sell"] else 0.0
    direct = np.minimum(d["contract"] / d["poi"] - dis, solar + wind - ch - sold)
    delivered = (direct + dis) * d["poi"]
    level = min(max(d["initSoc"] - d["minSoc"], 0), d["maxSoc"] - d["minSoc"]) * sizes["bessMwh"] * y["bf"] + np.cumsum(ch * d["eta"] - dis / d["eta"])
    short = 0.0
    if d["blocks"]:
        floor = d["contract"] * np.where(np.asarray(d["peak"]) == 1, d["peakFloor"], d["offFloor"])
        short = float(np.maximum(0.0, floor - delivered).sum())
    return float(delivered.sum()), short, float(level.min())


@pytest.mark.slow  # a full solve: a minute or more
@pytest.mark.skipif(M.highspy is None, reason="highspy not installed")
def test_the_dispatch_sheets_formulas_give_the_lps_energy():
    """The workbook's hour-by-hour sheets keep only the optimiser's choices (charge, discharge, sold)
    and work the rest out: direct = MIN(contract - discharge, generation - charge - sold). The LP's
    optimum always delivers what it can, so the sheets' energy is the LP's, year by year."""
    solar, wind, demand = _case()
    plant = 285
    peak = (np.arange(M.HOURS) % 24 >= 18).astype(int)
    payload = {
        "ctx": {"demand": [plant] * M.HOURS, "solarCf": solar.tolist(), "windCf": wind.tolist(), "plantMw": plant, "trafoLossPct": 0.005, "lineLossPct": 0.01},
        "bess": BESS, "costs": COSTS, "fin": FIN, "dfrTarget": 0, "dfrBasis": "annual",
        "vars": {"solarMw": {"min": 0, "max": 1500}, "windMw": {"min": 0, "max": 900}, "bessMw": {"min": 0, "max": 600}},
        "compliance": [{"id": "peak", "basis": "block", "hours": "peak", "target": 0.9, "penaltyMultiple": 1.5},
                       {"id": "offpeak", "basis": "block", "hours": "offpeak", "target": 0.7, "penaltyMultiple": 1.5}],
        "peakMask": peak.tolist(), "tariffGuess": 6.0, "returnLifetime": True, "returnDispatch": True,
    }
    res = M.solve(payload)
    assert res["ok"]
    d = res["dispatch"]
    assert d["blocks"] and len(d["byYear"]) == len(res["years"]) and len(d["weights"]) == FIN["years"]
    life = {y["year"]: y for y in res["lifetime"]}
    for y in d["byYear"]:
        delivered, short, low = _formula_delivered(d, y, res["sizes"], FIN, BESS)
        assert delivered == pytest.approx(life[y["year"]]["deliveredMwh"], rel=1e-5)
        assert short == pytest.approx(life[y["year"]]["blockShortfallMwh"], rel=1e-4, abs=1.0)
        assert low >= -1e-3, "the battery never goes below its minimum"
