"""SECI-FDRE-X in the sizing LP (engine/sizing/rtc_lp.py): supply only in four hours a day, a monthly
reconciliation with 10% free and the rest at 1.5 x the tariff, purchases from the green market or a
bilateral agreement within 5% of a year's energy, and no sale in the hours without connectivity."""
from __future__ import annotations

import numpy as np
import pytest

from engine.sizing import rtc_lp as M
from tests.engine.test_bid_lp import BESS0, FIN0, HOUR
from tests.engine.test_rtc_lp import COSTS, _case

pytestmark = pytest.mark.skipif(M.highspy is None, reason="highspy not installed")

X = 100.0
FOUR = ((HOUR >= 18) & (HOUR < 22)).astype(float)  # the buyer's four hours
NON_SOLAR = ((HOUR < 6) | (HOUR >= 18)).astype(float)  # connectivity for the non-solar hours only
PRICE = np.where((HOUR >= 9) & (HOUR < 16), 2.0, 6.0)  # Rs/kWh: cheap midday, dear otherwise
MONTH = M.MONTH_OF_HOUR


def _payload(*, penalty=None, tolerance=None, buy_share=None, buy_price=PRICE, sell=True, sale_mask=True, **extra):
    solar, wind, _ = _case()
    rule = {"id": "supply", "label": "Four hours a day, reconciled monthly", "target": 1.0, "hours": "all", "basis": "monthly"}
    if penalty is not None:
        rule["penaltyMultiple"] = penalty
    if tolerance is not None:
        rule["tolerance"] = tolerance
    payload = {
        "ctx": {"demand": (FOUR * X).tolist(), "solarCf": solar.tolist(), "windCf": wind.tolist(), "plantMw": X,
                "sellSurplus": sell, "surplusPrice": PRICE.tolist() if sell else None},
        "bess": BESS0, "costs": COSTS, "fin": {**FIN0, "sellSurplus": sell}, "dfrTarget": 0.0, "dfrBasis": "annual",
        "compliance": [rule], "tariffGuess": 6.0, "returnHourly": True, "returnLifetime": True, "ppaFirst": sell,
    }
    if buy_share is not None:
        payload["purchase"] = {"maxShare": buy_share, "prices": np.asarray(buy_price, float).tolist(), "chargesRsPerKwh": 0.3}
    if sell and sale_mask:
        payload["saleMask"] = NON_SOLAR.tolist()
    payload.update(extra)
    return payload


def _delivered(h):
    return np.asarray(h["direct"]) + np.asarray(h["discharge"])


@pytest.fixture(scope="module")
def hard():
    return M.solve(_payload(buy_share=0.05))


def test_supply_only_in_the_four_hours_and_every_month_met(hard):
    h = hard["hourly"]
    d = _delivered(h)
    assert d[FOUR < 0.5].max() == pytest.approx(0, abs=0.02), "nothing is delivered to the PPA outside the buyer's hours"
    req = np.asarray(h["demand"])
    for m in range(12):
        assert d[MONTH == m].sum() >= req[MONTH == m].sum() * (1 - 1e-4), f"month {m + 1} met"


def test_purchases_stay_within_five_percent_and_are_priced(hard):
    rows = hard["lifetime"]
    for row in rows:
        assert row["purchaseMwh"] <= 0.05 * row["demandMwh"] * (1 + 1e-6), f"year {row['year']}: within 5%"
    bought = np.asarray(hard["hourly"]["purchase"])
    assert bought.sum() > 0, "cheap midday power is bought"
    cost = M.RS_CR_PER_MWH_AT_1RS * float(bought @ (PRICE + 0.3)) * hard["evacuationEfficiency"]
    assert rows[0]["purchaseCostCr"] == pytest.approx(cost, rel=0.02)
    # supplied directly in the buyer's hours or charged into the battery at midday: either is allowed
    assert bought[(FOUR > 0.5) | ((HOUR >= 9) & (HOUR < 16))].sum() >= 0.99 * bought.sum()


def test_nothing_sold_in_the_solar_hours_and_bought_power_is_not_resold(hard):
    h = hard["hourly"]
    ex = np.asarray(h["export"])
    assert ex[NON_SOLAR < 0.5].max() == pytest.approx(0, abs=0.02), "no sale without connectivity"
    gen = np.asarray(h["solar"]) + np.asarray(h["wind"])
    assert (ex <= gen + 0.02).all(), "sales come from own RE only"


@pytest.mark.slow  # two more solves
def test_the_monthly_tolerance_and_penalty():
    soft = M.solve(_payload(penalty=1.5, tolerance=0.1, buy_share=0.05))
    h = soft["hourly"]
    d = _delivered(h)
    req = np.asarray(h["demand"])
    y1 = soft["perYear"][0]
    beyond = sum(max(0.0, 0.9 * req[MONTH == m].sum() - d[MONTH == m].sum()) for m in range(12))
    assert y1["monthlyPenaltyMu"] * 1000 == pytest.approx(beyond * soft["evacuationEfficiency"], rel=1e-3, abs=2.0)  # hourly values are rounded to 0.01 MW
    assert soft["lifetime"][0]["blockShortfallMwh"] >= soft["lifetime"][0]["monthlyPenaltyMwh"] - 1e-6
    # the free tenth can only make the plant cheaper
    hard_case = M.solve(_payload(buy_share=0.05))
    assert soft["tariff"] <= hard_case["tariff"] + 0.01


@pytest.mark.slow
def test_dear_power_is_not_bought():
    # with the penalty, a MWh short costs 1.5 x the tariff: power at Rs 50 is never worth buying (under
    # a hard monthly floor it can be, to cover the worst months instead of building plant for them)
    dear = M.solve(_payload(penalty=1.5, tolerance=0.1, buy_share=0.05, buy_price=np.full(M.HOURS, 50.0)))
    assert sum(row["purchaseMwh"] for row in dear["lifetime"]) == pytest.approx(0, abs=1.0)
