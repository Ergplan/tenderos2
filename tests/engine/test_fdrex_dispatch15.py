"""SECI-FDRE-X in the 15-minute dispatch (engine/sizing/dispatch15.py): the sized plant dispatched in
96 blocks a day with the sizing's FDRE-X rules: supply only in the buyer's four hours, power bought
within 5% of the year's energy at the hourly price plus charges and never resold, no sale in the
solar hours without connectivity for them, and the month's energy short beyond the free 10% at
1.5 x the tariff."""
from __future__ import annotations

import numpy as np
import pytest

from engine.sizing import dispatch15 as D
from engine.sizing import rtc_lp as M
from tests.engine.test_fdrex_lp import FOUR, NON_SOLAR, PRICE, X, _payload

pytestmark = pytest.mark.skipif(M.highspy is None, reason="highspy not installed")

FOUR_B = np.repeat(FOUR > 0.5, D.BLOCKS_PER_HOUR)
NON_SOLAR_B = np.repeat(NON_SOLAR > 0.5, D.BLOCKS_PER_HOUR)
# a plant a little short of the four hours every day: the battery cannot carry them all
SIZES = {"solarMw": 120.0, "windMw": 60.0, "bessMw": 70.0, "bessMwh": 230.0}
TARIFF = 6.0


def _year(**kw):
    payload = _payload(**kw)
    inp = D._inputs(payload)
    return D.dispatch_year(inp, SIZES, TARIFF, 1), inp


@pytest.fixture(scope="module")
def penalty():
    return _year(penalty=1.5, tolerance=0.1, buy_share=0.05)


def test_supply_only_in_the_four_hours(penalty):
    res, _ = penalty
    s = res["series"]
    assert np.asarray(s["delivered"])[~FOUR_B].max() == pytest.approx(0, abs=0.01), "nothing delivered outside the buyer's hours"
    assert res["summary"]["demandMu"] == pytest.approx(X * 4 * 365 / 1000, rel=1e-6), "4 MWh per MW a day"


def test_purchases_within_five_percent_priced_and_not_resold(penalty):
    res, inp = penalty
    s, summ = res["series"], res["summary"]
    bought = np.asarray(s["bought"])
    assert bought.sum() > 0, "the plant buys power"
    assert summ["boughtShare"] <= 0.05 + 1e-6, f"within 5%: {summ['boughtShare']:.4f}"
    price = np.repeat(PRICE + 0.3, D.BLOCKS_PER_HOUR)
    cost = float((bought / inp["poi"] * price).sum() * D.DT * 1e-4)
    assert summ["boughtCostCr"] == pytest.approx(cost, rel=1e-6), "priced at the hour's price plus the charges"
    sold = np.asarray(s["sold"])
    gen = np.asarray(s["solar"]) + np.asarray(s["wind"])
    assert (sold <= gen + 0.01).all(), "sales come from own RE only"


def test_no_sale_in_the_solar_hours(penalty):
    res, _ = penalty
    sold = np.asarray(res["series"]["sold"])
    assert sold.sum() > 0
    assert sold[~NON_SOLAR_B].max() == pytest.approx(0, abs=0.01), "no sale without connectivity"


def test_the_monthly_tolerance_and_the_penalty_beyond_it(penalty):
    res, _ = penalty
    s, summ = res["series"], res["summary"]
    rule = summ["rules"][0]
    assert rule["tolerance"] == 0.1 and rule["penaltyMultiple"] == 1.5
    delivered, demand = np.asarray(s["delivered"]), np.asarray(s["demand"])
    beyond = sum(max(0.0, 0.9 * demand[D.MONTH_OF_BLOCK == m].sum() - delivered[D.MONTH_OF_BLOCK == m].sum()) for m in range(12)) * D.DT / 1000
    assert rule["penalisedMu"] == pytest.approx(beyond, abs=1e-3), "the penalised energy is what is short beyond 90% of each month"
    assert summ["penalisedMu"] == pytest.approx(rule["penalisedMu"])
    worst = min(delivered[D.MONTH_OF_BLOCK == m].sum() / demand[D.MONTH_OF_BLOCK == m].sum() for m in range(12))
    assert rule["achieved"] == pytest.approx(worst, abs=1e-6)
    assert rule["withinTolerance"] == (worst >= 0.9 - 1e-6)


def test_meeting_every_month_in_full_buys_more_or_falls_short():
    hard, _ = _year(buy_share=0.05)
    soft, _ = _year(penalty=1.5, tolerance=0.1, buy_share=0.05)
    h, s = hard["summary"], soft["summary"]
    assert "tolerance" not in h["rules"][0], "a hard monthly rule has no free share"
    assert h["deliveredMu"] >= s["deliveredMu"] - 1e-6, "the whole month is worth more than the free tenth"


def test_without_purchases_or_the_sale_mask_nothing_changes_for_other_tenders():
    res, inp = _year(penalty=1.5, tolerance=0.1, sale_mask=False)
    assert inp["buy"] is None and inp["sale_mask"] is None
    assert "bought" not in res["series"] and "boughtMu" not in res["summary"]
    sold = np.asarray(res["series"]["sold"])
    assert sold[~NON_SOLAR_B].sum() > 0, "with connectivity in the solar hours, they sell"


def test_the_files_carry_the_bought_power(penalty, tmp_path):
    res, inp = penalty
    csv = D.year_csv(res["series"], 1).splitlines()
    assert "Bought power (green market, bilateral) MW" in csv[0]
    summ = D.summary_csv([res["summary"]]).splitlines()
    assert "Bought MU" in summ[0] and len(summ) == 2


def test_a_bad_tolerance_is_refused():
    p = _payload(penalty=1.5, tolerance=1.2)
    with pytest.raises(D.DispatchError):
        D._inputs(p)


def test_fifteen_minute_prices_set_what_is_bought_and_when():
    # the same hourly mean, but within each hour a dear second block and a cheap third one
    shape = np.tile([1.0, 1.2, 0.8, 1.0], D.RLP.HOURS)
    p15 = np.repeat(PRICE, D.BLOCKS_PER_HOUR) * shape
    payload = _payload(penalty=1.5, tolerance=0.1, buy_share=0.05)
    payload["purchase"]["prices15"] = p15.tolist()
    payload["ctx"]["surplusPrice15"] = p15.tolist()
    inp = D._inputs(payload)
    res = D.dispatch_year(inp, SIZES, TARIFF, 1)
    bought = np.asarray(res["series"]["bought"]) / inp["poi"]
    cost = float((bought * (p15 + 0.3)).sum() * D.DT * 1e-4)
    assert res["summary"]["boughtCostCr"] == pytest.approx(cost, rel=1e-6), "each block at its own price"
    k = np.arange(D.BLOCKS) % 4
    assert bought[k == 2].sum() >= bought[k == 1].sum() - 1e-6, "more is bought in the cheap block than in the dear one"
    assert np.allclose(res["series"]["price"], p15), "sales priced block by block"


def test_fifteen_minute_prices_must_cover_the_year():
    payload = _payload(penalty=1.5, tolerance=0.1, buy_share=0.05)
    payload["ctx"]["surplusPrice15"] = [3.0] * 8760
    with pytest.raises(D.DispatchError, match="35040"):
        D._inputs(payload)


def test_nothing_is_sold_on_a_day_left_short_and_the_met_days_sell():
    # a plant that carries the four hours on some days, not all
    sizes = {"solarMw": 130.0, "windMw": 60.0, "bessMw": 80.0, "bessMwh": 300.0}
    inp = D._inputs(_payload(penalty=1.5, tolerance=0.1, buy_share=0.05, saleOnMetDays=True))
    res = D.dispatch_year(inp, sizes, TARIFF, 1)
    s, summ = res["series"], res["summary"]
    day = np.arange(D.BLOCKS) // (24 * D.BLOCKS_PER_HOUR)
    need = np.bincount(day, weights=np.asarray(s["demand"]), minlength=365)
    got = np.bincount(day, weights=np.minimum(np.asarray(s["delivered"]), np.asarray(s["demand"])), minlength=365)
    sold = np.bincount(day, weights=np.asarray(s["sold"]), minlength=365)
    short = got < need * (1 - 1e-4)  # the series are rounded to two decimals
    assert short.any() and (~short).any(), "this plant meets some days and not others"
    assert sold[short].max() == pytest.approx(0, abs=0.01), "no sale on a day the supply is short"
    assert sold[~short].sum() > 0, "the days met in full sell their surplus"
    assert summ["saleDays"] + summ["shortDays"] == 365 and summ["saleDays"] == int((~short).sum())
    plain = D.dispatch_year(D._inputs(_payload(penalty=1.5, tolerance=0.1, buy_share=0.05)), sizes, TARIFF, 1)
    assert "saleDays" not in plain["summary"], "the rule is off unless asked"
    assert plain["summary"]["soldMu"] >= summ["soldMu"] - 1e-6, "without the rule the short days sell too"


def test_the_sizings_days_are_where_the_dispatch_starts():
    sizes = {"solarMw": 130.0, "windMw": 60.0, "bessMw": 80.0, "bessMwh": 300.0}
    base = _payload(penalty=1.5, tolerance=0.1, buy_share=0.05, saleOnMetDays=True)
    free = D.dispatch_year(D._inputs(base), sizes, TARIFF, 1)["summary"]
    # told that every day is met in full (more than this plant can): the days still short are released
    told = D.dispatch_year(D._inputs({**base, "saleDayMask": {"years": [1], "masks": ["1" * 365]}}), sizes, TARIFF, 1)
    s, summ = told["series"], told["summary"]
    day = np.arange(D.BLOCKS) // (24 * D.BLOCKS_PER_HOUR)
    need = np.bincount(day, weights=np.asarray(s["demand"]), minlength=365)
    got = np.bincount(day, weights=np.minimum(np.asarray(s["delivered"]), np.asarray(s["demand"])), minlength=365)
    sold = np.bincount(day, weights=np.asarray(s["sold"]), minlength=365)
    short = got < need * (1 - 1e-4)
    assert 0 < summ["saleDays"] < 365 and short.any()
    assert sold[short].max() == pytest.approx(0, abs=0.01), "no sale on a day the supply is short"
    assert abs(summ["saleDays"] - free["saleDays"]) <= 0.15 * 365, "about the days the dispatch finds on its own"
    assert D._day_masks({"years": [1], "masks": ["101"]}) == {}, "a mask that is not 365 days is ignored"
    assert list(D._day_masks({"years": [1, 25], "masks": ["1" * 365, "0" * 365]})) == [1, 25]
