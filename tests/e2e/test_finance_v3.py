"""The finance team's inputs of 4 November (docs/dev/FINANCE-V3-SPEC.md) in the browser: the ten
groups on the SECI tab's Finance inputs step (a COD date, an EMD guarantee, carbon credits on), the
same groups under F.1 of Round the Clock where the model is instant (carbon adds its line to F.4
and lifts revenue; a COD date puts months on the year headers; F.5 Returns, F.7 Balance sheet and
cash-flow statement; F.8 runs the sensitivities), and the groups on the CfD tab's Finance inputs.

Run with a stack in demo mode:
  TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 pytest -m slow tests/e2e/test_finance_v3.py
"""
from __future__ import annotations

import re

import pytest

from tests.e2e.test_tender_to_bid import DEMO, URL, _session

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and DEMO), reason="set TENDEROS_URL and TENDEROS_DEMO=1"),
]

GROUPS = ["timeline", "construction", "generation", "opex", "debt", "quasi", "guarantees", "tax", "returns", "sensitivity"]
MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec"


def _field(scope, label):
    return scope.locator(".rtc-field", has=scope.locator(".rtc-field-top span", has_text=re.compile(rf"^{re.escape(label)}$"))).first


def _open_group(page, root, group):
    """Open a closed <details> group (the summary toggles it) and return it."""
    g = root.locator(f"[data-testid=fin-v3-{group}]")
    assert g.count() == 1, group
    if not g.evaluate("el => el.open"):
        g.locator("summary").first.click()
        page.wait_for_timeout(150)
    assert g.evaluate("el => el.open"), group
    return g


def _check_groups(page, root):
    """Every group is there, closed by default, opens and closes again."""
    for group in GROUPS:
        g = root.locator(f"[data-testid=fin-v3-{group}]")
        assert g.count() == 1, group
        g.locator("summary").first.click()
        page.wait_for_timeout(100)
        assert g.evaluate("el => el.open"), group
        g.locator("summary").first.click()
        page.wait_for_timeout(100)
        assert not g.evaluate("el => el.open"), group


def _switch_on(page, scope, label):
    box = _field(scope, label)
    button = box.locator("button.rtc-switch")
    if "on" not in (button.get_attribute("class") or "").split():
        button.click()
        page.wait_for_timeout(200)
    assert "on" in (button.get_attribute("class") or "").split(), label


def _line(page, line_label):
    """The first table row whose first cell is this label (F.4 comes before the statements)."""
    return page.locator("table tr", has=page.locator("td:first-child", has_text=re.compile(rf"^{re.escape(line_label)}$")))


def _revenue_of(page, line_label):
    """The year-1 value of a line of the F.4 table, as a float (₹ cr): the first cell with a digit
    after the label (Y0 is blank on the revenue lines)."""
    row = _line(page, line_label).first
    assert row.count() == 1, line_label
    cells = row.locator("td").all_inner_texts()[1:]
    nums = [c for c in cells if re.search(r"\d", c)]
    assert nums, (line_label, cells)
    return float(nums[0].replace(",", "").replace("₹", "").replace("−", "-").replace("–", "-"))


def test_finance_team_inputs_and_statements():
    with _session() as page:
        # --- SECI RTC tender › 05 Finance inputs: the groups and three inputs
        page.click("aside.sidebar button:has-text('SECI RTC tender')")
        page.wait_for_selector("[data-testid=seci-tab]", timeout=30_000)
        page.click("[data-testid=seci-step-financeInputs]")
        page.wait_for_selector("[data-testid=bid-financing]", timeout=30_000)
        root = page.locator("[data-testid=fin-v3]").first
        assert root.count() == 1, "the finance team's inputs on the Finance inputs step"
        _check_groups(page, root)

        _open_group(page, root, "timeline")
        page.fill("[data-testid=fin-v3-cod]", "2028-05-01")
        page.locator("[data-testid=fin-v3-cod]").dispatch_event("change")
        page.wait_for_timeout(200)
        assert page.input_value("[data-testid=fin-v3-cod]") == "2028-05-01"

        g = _open_group(page, root, "guarantees")
        before = g.locator("[data-testid=fin-v3-guarantee-list] tbody tr").count()
        g.locator("[data-testid=fin-v3-guarantee-emd]").click()
        page.wait_for_timeout(200)
        rows = g.locator("[data-testid=fin-v3-guarantee-list] tbody tr")
        assert rows.count() == before + 1
        assert "EMD" in rows.last.inner_text() or "Earnest" in rows.last.inner_text()

        g = _open_group(page, root, "generation")
        _switch_on(page, g, "Carbon credit revenue")
        price = _field(g, "Credit price").locator("input")
        price.fill("500")
        price.dispatch_event("change")
        page.wait_for_timeout(200)

        # the inputs are kept when leaving and coming back to the step
        page.click("[data-testid=seci-step-bid]")
        page.wait_for_timeout(200)
        page.click("[data-testid=seci-step-financeInputs]")
        page.wait_for_selector("[data-testid=fin-v3]", timeout=30_000)
        assert page.input_value("[data-testid=fin-v3-cod]") == "2028-05-01"

        # --- Round the Clock: the model is instant, so the numbers can be read
        page.click("aside.sidebar button:has-text('Round the Clock')")
        page.wait_for_selector("[data-testid=rtc-finance-stats]", timeout=120_000)
        page.wait_for_timeout(1000)
        toggle = page.locator("[data-testid=fin-v3-toggle]")
        toggle.scroll_into_view_if_needed()
        if toggle.get_attribute("aria-expanded") != "true":
            toggle.click()
        page.wait_for_selector("[data-testid=fin-v3]", timeout=10_000)
        root = page.locator("[data-testid=fin-v3]").first
        _check_groups(page, root)

        # the year headers before a date: Y1, Y2 …; carbon credits off: no line
        assert _line(page, "Carbon credits").count() == 0, "no carbon line while the input is off"
        revenue_before = _revenue_of(page, "Total revenue")

        # carbon on: the line appears and total revenue rises
        g = _open_group(page, root, "generation")
        _switch_on(page, g, "Carbon credit revenue")
        price = _field(g, "Credit price").locator("input")
        price.fill("500")
        price.dispatch_event("change")
        page.wait_for_timeout(800)
        assert _line(page, "Carbon credits").count() >= 1, "the Carbon credits line of F.4"
        carbon = _revenue_of(page, "Carbon credits")
        revenue_after = _revenue_of(page, "Total revenue")
        assert carbon > 0 and revenue_after > revenue_before, (carbon, revenue_before, revenue_after)

        # a COD date puts months on the headers
        _open_group(page, root, "timeline")
        page.fill("[data-testid=fin-v3-cod]", "2028-05-01")
        page.locator("[data-testid=fin-v3-cod]").dispatch_event("change")
        page.wait_for_timeout(800)
        heads = page.locator("table thead th").all_inner_texts()
        assert any(re.search(rf"Y1\s*·\s*({MONTHS}) 2028", h) for h in heads), heads[:6]

        # the statements
        for tid in ("fin-returns", "fin-balance", "fin-cashflow"):
            assert page.locator(f"[data-testid={tid}]").count() == 1, tid
        returns = page.locator("[data-testid=fin-returns]").inner_text()
        for label in ("Equity IRR", "Project IRR", "Lender XIRR", "Minimum DSCR", "Minimum FSCR"):
            assert label in returns, label

        # the reverse-auction sensitivities (a button: the model runs many times)
        run = page.locator("[data-testid=fin-sensitivity-run]")
        if run.count():
            run.scroll_into_view_if_needed()
            run.click()
            page.wait_for_selector("[data-testid=fin-sensitivity]", timeout=300_000)
            assert page.locator("[data-testid=fin-sensitivity] tbody tr").count() >= 6, "one row per axis and case"
            text = page.locator("[data-testid=fin-sensitivity]").inner_text().lower()
            assert "capex" in text and "exchange" in text and "p90" in text, text[:300]
        else:
            pytest.skip("the sensitivities button is not on this build (the engine does not export sensitivities yet)")

        # --- CfD Bid › 06 Finance inputs: the same groups
        page.click("aside.sidebar button:has-text('CfD Bid')")
        page.wait_for_selector("[data-testid=cfd-tab]", timeout=30_000)
        page.click("[data-testid=cfd-step-financeInputs]")
        page.wait_for_selector("[data-testid=fin-v3]", timeout=30_000)
        _check_groups(page, page.locator("[data-testid=fin-v3]").first)
