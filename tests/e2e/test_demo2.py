"""TenderOS Demo 2 in the browser: the traceable financial model, the solar and wind studios with
the profiles on screen, the What-if tab and the Recent tenders tab with a CERC order uploaded.

Run with a running stack (demo mode):
  TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 pytest -m slow tests/e2e/test_demo2.py
"""
from __future__ import annotations

import re

import pymupdf
import pytest

from tests.e2e.test_tender_to_bid import DEMO, EMAIL, PASSWORD, URL, _session

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and (DEMO or (EMAIL and PASSWORD))), reason="set TENDEROS_URL and TENDEROS_EMAIL, TENDEROS_PASSWORD (or TENDEROS_DEMO=1)"),
]


def _pct(text: str) -> float:
    return float(re.search(r"(-?[\d.]+)%", text).group(1))


def test_traceable_model_round_the_clock():
    with _session() as page:
        page.click("aside.sidebar button:has-text('Round the Clock')")
        page.wait_for_selector("[data-testid=rtc-finance-stats]", timeout=120_000)
        shown = _pct(page.locator("[data-testid=rtc-finance-stats] [data-trace=equityIrr] strong").inner_text())
        page.click("[data-testid=rtc-finance-stats] [data-trace=equityIrr]")
        page.wait_for_selector("[data-testid=trace-explorer]")
        assert page.locator("[data-testid=trace-name]").inner_text() == "Equity IRR"
        assert abs(_pct(page.locator("[data-testid=trace-value]").inner_text()) - shown) < 0.006
        assert "IRR(" in page.locator("[data-testid=trace-formula]").inner_text()
        # follow a reference, then back
        page.locator("[data-testid=trace-panel] .trace-list .trace-ref").first.click()
        assert "Equity cash flow" in page.locator("[data-testid=trace-name]").inner_text()
        page.click("[aria-label=Back]")
        assert page.locator("[data-testid=trace-name]").inner_text() == "Equity IRR"
        # every input under the equity IRR
        page.click("[data-testid=trace-inputs-toggle]")
        inputs = page.locator("[data-testid=trace-inputs]").inner_text()
        for want in ("Debt share", "Interest rate", "Corporate tax", "Solar"):
            assert want in inputs
        page.keyboard.press("Escape")
        assert page.locator("[data-testid=trace-explorer]").count() == 0
        # a cell of the 25-year table opens at its own line and year
        cell = page.locator(".fin-table td.is-traceable").nth(30)
        cell.scroll_into_view_if_needed()
        cell.click()
        page.wait_for_selector("[data-testid=trace-explorer]")
        assert re.search(r"· Year \d+", page.locator("[data-testid=trace-name]").inner_text())


def test_plant_studios_fill_the_bid():
    with _session() as page:
        page.click("aside.sidebar button:has-text('SECI RTC tender')")
        page.wait_for_selector("[data-testid=seci-tab]")
        page.click("[data-testid=seci-step-sources]")
        page.click("[data-testid=bid-fill]")
        page.click("[data-testid=studio-solar]")
        studio = page.locator("[data-testid=solar-studio]")
        studio.wait_for()
        string_cost = page.locator("[data-testid=solar-cr-mwac]").inner_text()
        assert int(re.search(r"Modules per string\s*(\d+)", page.locator("[data-testid=solar-design]").inner_text(), re.I).group(1)) > 20
        # a module price change moves the total
        price = page.locator("[data-testid=solar-price-module]")
        price.fill("16")
        page.wait_for_timeout(200)
        assert page.locator("[data-testid=solar-cr-mwac]").inner_text() != string_cost
        cr = float(re.search(r"₹([\d.]+)", page.locator("[data-testid=solar-cr-mwac]").inner_text()).group(1))
        page.click("[data-testid=solar-apply]")
        assert page.locator("[data-testid=solar-studio]").count() == 0
        capex = page.locator("[data-testid=source-solar] .rtc-field", has_text="Capex per MWac").locator("input").first
        assert abs(float(capex.input_value()) - cr) < 0.0015
        assert "From the studio" in page.locator("[data-testid=studio-applied-solar]").inner_text()

        page.click("[data-testid=studio-wind]")
        page.wait_for_selector("[data-testid=wind-studio]")
        assert page.locator("[data-testid=wind-turbines] tbody tr").count() >= 8
        page.click("[data-testid=turbine-vestas-v155-3\\.3]")
        head = page.locator("[data-testid=wind-studio] h2").inner_text()
        assert "Vestas V155-3.3 MW" in head
        cuf = float(re.search(r"CUF ([\d.]+)%", head).group(1))
        page.click("[data-testid=wind-apply]")
        wcuf = page.locator("[data-testid=source-wind] .rtc-field", has_text="CUF").locator("input").first
        assert abs(float(wcuf.input_value()) - cuf) < 0.06
        # the profiles on screen, with their CUF
        page.locator("[data-testid=source-solar] summary", has_text="Profile on screen").click()
        view = page.locator("[data-testid=profile-view-solar]")
        view.wait_for()
        assert "%" in view.locator("[data-testid=profile-cuf]").inner_text()


def test_what_if():
    with _session() as page:
        page.click("aside.sidebar button:has-text('What-if analysis')")
        page.wait_for_selector("[data-testid=whatif-verdict]")
        returns = page.locator("[data-testid=whatif-returns]")
        assert "LENDER'S IRR" in returns.inner_text().upper()
        # bid at the tariff the target needs: the equity IRR is the target
        page.click("[data-testid=whatif-use-needed]")
        page.wait_for_timeout(500)
        assert abs(_pct(returns.locator("[data-trace=equityIrr] strong").inner_text()) - 14.0) < 0.02
        assert "Meets the target" in page.locator("[data-testid=whatif-verdict]").inner_text()
        # no battery: the tender refuses it
        bess = page.locator(".whatif-group", has_text="Size").locator(".rtc-field", has_text="Battery power").locator("input")
        bess.fill("0")
        bess.press("Enter")
        page.wait_for_function("document.querySelector('[data-testid=whatif-verdict]').dataset.verdict === 'fail'")
        assert page.locator("[data-testid=whatif-check-storage] .bad").count() == 1
        page.click("[data-testid=whatif-reset]")
        page.wait_for_function("document.querySelector('[data-testid=whatif-verdict]').dataset.verdict !== 'fail'")
        # the returns open the traceable model
        returns.locator("[data-trace=projectIrr]").click()
        page.wait_for_selector("[data-testid=trace-explorer]")
        assert page.locator("[data-testid=trace-name]").inner_text() == "Project IRR"


def test_generation_traces_to_15_minutes():
    """A CFO's path: a dispatch number in plain words, its generation as MW × CUF × 365 × 24, then
    the year's months and one day's 15-minute blocks."""
    with _session() as page:
        page.click("aside.sidebar button:has-text('What-if analysis')")
        page.wait_for_selector("[data-testid=whatif-verdict]")
        page.locator("[data-testid=whatif-returns] [data-trace=projectIrr]").click()
        page.wait_for_selector("[data-testid=trace-explorer]")
        page.fill("[data-testid=trace-search]", "Delivered to the procurer")
        page.locator(".trace-grid td.kind-opt button").first.click()  # year 1 (the total column is a SUM)
        note = page.locator("[data-testid=trace-dispatch]")
        assert "365 days × 24 hours" in note.inner_text()
        assert "solver" not in note.inner_text().lower()
        note.locator(".trace-ref").first.click()
        assert "Solar and wind at the 33 kV bus · Year 1" == page.locator("[data-testid=trace-name]").inner_text()
        # the bus total reads solar and wind; solar's year is MW × CUF × 365 × 24
        page.locator("[data-testid=trace-formula] .trace-ref", has_text="Solar generation").first.click()
        formula = page.locator("[data-testid=trace-formula]").inner_text()
        assert "365" in formula and "24" in formula and "CUF" in formula
        drill = page.locator("[data-testid=gen-drill]")
        year = drill.locator("[data-testid=gen-year]").inner_text()
        assert "× 365 days × 24 h" in year
        mu = float(re.search(r"= ([\d,]+\.\d) MU", year).group(1).replace(",", ""))
        assert abs(mu - float(page.locator("[data-testid=trace-value]").inner_text().split()[0].replace(",", ""))) < 0.11
        months = drill.locator("[data-testid=gen-months]")
        assert months.locator("tbody tr").count() == 12
        assert abs(float(months.locator("tfoot td").last.inner_text().replace(",", "")) - mu) < 0.11
        # June, its 21st: 96 blocks, dark at night and generating at noon
        months.locator("tbody tr").nth(5).click()
        page.select_option("[data-testid=gen-day]", label="21 June")
        blocks = drill.locator("[data-testid=gen-blocks] tbody tr")
        assert blocks.count() == 96
        assert blocks.nth(0).locator("td").last.inner_text() == "0.0"
        assert float(blocks.nth(48).locator("td").last.inner_text().replace(",", "")) > 0
        assert "35,040 blocks" in drill.locator("[data-testid=gen-all-blocks]").inner_text()


def test_recent_tenders_and_cerc_upload(tmp_path):
    pdf = tmp_path / "CERC order 412-AT-2025.pdf"
    doc = pymupdf.open()
    p1 = doc.new_page()
    y = 60
    for ln in ["CENTRAL ELECTRICITY REGULATORY COMMISSION", "Petition No. 412/AT/2025", "Date of Order: 22.11.2025",
               "In the matter of: Petition under Section 63 for adoption of tariff for 420 MW RTC power",
               "Solar Energy Corporation of India Limited ... Petitioner"]:
        p1.insert_text((40, y), ln, fontsize=9)
        y += 14
    p2 = doc.new_page()
    y = 60
    for ln in ["Name of the Successful Bidder Capacity (MW) Tariff (Rs/kWh)", "1", "Hero Solar Energy Private Limited", "120", "5.06",
               "2", "Jindal India Power Limited", "150", "5.07"]:
        p2.insert_text((40, y), ln, fontsize=9)
        y += 14
    doc.save(pdf)
    with _session() as page:
        page.click("aside.sidebar button:has-text('Recent tenders')")
        page.wait_for_selector("[data-testid=seci-results]")
        assert page.locator("[data-testid^=seci-result-]").count() >= 8
        xix = page.locator("[data-testid=seci-result-seci-wind-xix]").inner_text()
        assert "K.P. Energy Limited" in xix and "3.67" in xix and "SECI/C&P/IPP/12/0013/25-26" in xix
        before = page.locator("[data-testid=cerc-order]").count()
        page.set_input_files("[data-testid=cerc-file]", str(pdf))
        page.wait_for_function(f"document.querySelectorAll('[data-testid=cerc-order]').length > {before}", timeout=90_000)
        card = page.locator("[data-testid=cerc-order]").first
        assert card.locator("[data-testid=cerc-petition]").input_value() == "412/AT/2025"
        assert card.locator("[data-testid=cerc-date]").input_value() == "2025-11-22"
        assert card.locator("[data-testid=cerc-petitioner]").input_value() == "SECI"
        names = [i.input_value() for i in card.locator("[data-testid=cerc-winners] tbody input:not([type=number])").all()]
        assert names[:2] == ["Hero Solar Energy Private Limited", "Jindal India Power Limited"]
        card.locator("[data-testid=cerc-checked]").click()
        page.wait_for_timeout(600)
        assert "checked" in card.inner_text()
        href = card.locator("a.market-file").get_attribute("href")
        assert page.request.get(URL + href).body().startswith(b"%PDF")
        # tidy: the test's order goes
        page.once("dialog", lambda d: d.accept())
        card.locator("[title='Delete this order']").click()
        page.wait_for_function(f"document.querySelectorAll('[data-testid=cerc-order]').length === {before}")


def test_winning_bid_step():
    """SECI tab, after Bid forms: how this tender's winners bid ₹5.25, as a bridge of sizing runs."""
    with _session() as page:
        page.click("aside.sidebar button:has-text('SECI RTC tender')")
        page.wait_for_selector("[data-testid=seci-tab]")
        page.click("[data-testid=seci-step-winning]")
        bridge = page.locator("[data-testid=win-bridge]")
        bridge.wait_for()
        assert bridge.locator("tbody tr").count() == 8
        text = bridge.inner_text()
        for want in ("₹6.50", "₹7.46", "₹5.14", "₹5.39", "estimate"):
            assert want in text, want
        assert "₹5.25" in page.locator("[data-testid=win-head]").inner_text()
        assert page.locator("[data-testid=win-head] a, .rtc-section a:has-text(\"SECI's result\")").count() >= 1
        assert "Juniper" in page.locator("[data-testid=win-disclosed]").inner_text()
