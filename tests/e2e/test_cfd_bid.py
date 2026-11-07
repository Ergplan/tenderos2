"""A full SECI CfD-I bid in the browser (web/src/cfd): the eleven steps with their teams, the
explainer, the documents and every amendment's changes, the conditions, the bid inputs, the design
with benchmarks, the finance inputs (repayment, construction, working capital), the sizing of the
own RE (the long job of this tab), the financial model with its tiles, the traceable model and the
nine-sheet workbook, the What-if levers, the bid forms with a letter download, the reference bids,
and Save.

Run with a stack in demo mode:
  TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 pytest -m slow tests/e2e/test_cfd_bid.py
"""
from __future__ import annotations

import re

import pytest

from tests.e2e.test_tender_to_bid import DEMO, URL, _session

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and DEMO), reason="set TENDEROS_URL and TENDEROS_DEMO=1"),
]

STEPS = ["explain", "documents", "conditions", "bid", "design", "financeInputs", "size", "finance", "whatif", "forms", "reference"]
TEAMS = {"explain": "Tender / Legal", "bid": "Projects", "design": "Design", "financeInputs": "Finance", "size": "Projects", "finance": "Finance", "whatif": "Finance", "forms": "Tender / Legal", "reference": "Projects"}
SHEETS = ["Live model", "Construction", "Profit and loss", "Cash flow", "Balance sheet", "Debt schedule", "Depreciation and tax", "Working capital", "Sensitivity"]


def _open(page):
    page.click("aside.sidebar button:has-text('CfD Bid')")
    page.wait_for_selector("[data-testid=cfd-tab]", timeout=30_000)


def _step(page, step):
    page.click(f"[data-testid=cfd-step-{step}]")
    assert page.locator(f"[data-testid=cfd-step-{step}]").get_attribute("aria-current") == "step", step
    page.wait_for_timeout(250)


def _field(page, label):
    return page.locator(".rtc-field", has=page.locator(".rtc-field-top span", has_text=re.compile(rf"^{re.escape(label)}$"))).first


def test_cfd_bid_end_to_end(tmp_path):
    with _session() as page:
        _open(page)
        # the steps and their teams
        for step in STEPS:
            assert page.locator(f"[data-testid=cfd-step-{step}]").count() == 1, step
        for step, team in TEAMS.items():
            assert page.locator(f"[data-testid=cfd-step-team-{step}]").text_content().strip() == team, step

        # 01 what is a CfD: the explainer, the diagram and the worked example
        _step(page, "explain")
        assert page.locator("[data-testid=cfd-explainer]").count() == 1
        text = page.locator("[data-testid=cfd-explainer]").inner_text().lower()
        assert "strike price" in text and "15" in text
        assert page.locator("[data-testid=cfd-flow]").count() == 1

        # 02 documents: five documents, every amendment's changes, the filter
        _step(page, "documents")
        assert page.locator("[data-testid^=cfd-doc-]").count() == 5
        assert page.locator("[data-testid^=cfd-change-]").count() >= 35
        page.click(".bid-filter button:has-text('Amendment-01')")
        assert 2 <= page.locator("[data-testid^=cfd-change-]").count() <= 6
        page.click(".bid-filter button:has-text('All')")
        assert page.locator("[data-testid=cfd-queries] li").count() >= 3

        # 03 conditions: every term with its quote
        _step(page, "conditions")
        assert page.locator("[data-testid^=cfd-term-]").count() >= 120
        assert "251 conditions" in page.locator("[data-testid=cfd-cond-summary]").inner_text() or "conditions" in page.locator("[data-testid=cfd-cond-summary]").inner_text()

        # 04 bid inputs
        _step(page, "bid")
        mw = _field(page, "Contracted capacity you bid").locator("input")
        mw.fill("100")
        mw.dispatch_event("change")

        # 05 design: benchmarks
        _step(page, "design")
        page.click("[data-testid=cfd-fill]")
        page.wait_for_timeout(300)

        # 06 finance inputs: the repayment methods and the construction months, then size
        _step(page, "financeInputs")
        if page.locator("[data-testid=cfd-fill]").count():
            page.click("[data-testid=cfd-fill]")
            page.wait_for_timeout(300)
        assert page.locator("[data-testid=cfd-missing]").count() == 0, page.locator("[data-testid=cfd-missing]").inner_text()
        repay = _field(page, "Repayment").locator("select")
        repay.select_option("sculpted")
        page.wait_for_timeout(200)
        assert "target dscr" in page.locator("main").inner_text().lower()
        repay.select_option("equal")
        page.click("[data-testid=cfd-size]")

        # 07 size: the optimiser runs (the own RE that gives the least strike price with every
        # day met); then the plant, the checks and the operations
        page.wait_for_selector("[data-testid=cfd-step-size][aria-current=step]")
        page.wait_for_selector("[data-testid=cfd-message]", timeout=600_000)
        assert "optimised" in page.locator("[data-testid=cfd-message]").inner_text().lower()
        sized = page.locator("[data-testid=cfd-plant]").inner_text()
        assert "MW" in sized and "₹" in sized
        assert page.locator("[data-testid^=cfd-check-]").count() >= 6
        assert page.locator("[data-testid=cfd-ops-table]").count() == 1 and page.locator("[data-testid=cfd-day]").count() == 1
        assert "₹" in page.locator("[data-testid=cfd-own-cost-1]").inner_text(), "own RE charging valued at the plant's cost"

        # 08 financial model: the tiles, the trace, the workbook with nine sheets
        _step(page, "finance")
        page.wait_for_selector("[data-testid=cfd-finance]", timeout=120_000)
        tiles = page.locator("[data-testid=cfd-finance]").inner_text()
        assert "₹" in tiles and "%" in tiles
        page.locator("[data-testid=cfd-finance] [data-trace=equityIrr]").first.click()
        page.wait_for_selector("[data-testid=trace-explorer]", timeout=30_000)
        page.keyboard.press("Escape")
        with page.expect_download(timeout=180_000) as dl:
            page.click("[data-testid=cfd-download]")
        xlsx = tmp_path / "cfd-model.xlsx"
        dl.value.save_as(str(xlsx))
        openpyxl = pytest.importorskip("openpyxl")
        wb = openpyxl.load_workbook(str(xlsx), read_only=True)
        for name in SHEETS:
            assert name in wb.sheetnames, (name, wb.sheetnames)

        # 08a market prices (F.9): a scenario, a dragged dot, Smooth, the comparison table
        panel = page.locator("[data-testid=cfd-price-path]")
        panel.scroll_into_view_if_needed()
        assert panel.count() == 1
        page.click("[data-testid=cfd-price-scenario-storageFlood]")
        page.wait_for_timeout(1500)
        assert "₹" in page.locator("[data-testid=cfd-price-now]").inner_text()
        dot = page.locator("[data-testid=cfd-price-dot-midday-2]")
        box = dot.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] - 40, steps=5)
        page.mouse.up()
        page.wait_for_timeout(1500)
        assert page.locator("[data-testid=cfd-price-scenario-custom]").get_attribute("class") == "primary", "dragging a dot makes it the bidder's own path"
        page.click("[data-testid=cfd-price-smooth]")
        page.wait_for_timeout(1500)
        page.click("[data-testid=cfd-price-run]")
        page.wait_for_selector("[data-testid=cfd-price-row-custom]", timeout=120_000)
        assert page.locator("[data-testid=cfd-price-table] tbody tr").count() == 4
        assert "₹" in page.locator("[data-testid=cfd-price-row-storageFlood]").inner_text()

        # 09 what-if: the track to a quote (an impossible one first, then a reachable one), then the levers
        _step(page, "whatif")
        page.wait_for_selector("[data-testid=cfd-whatif]", timeout=60_000)
        quote = _field(page, "Strike price you want to quote").locator("input")
        quote.fill("1")
        quote.dispatch_event("change")
        page.click("[data-testid=cfd-track-run]")
        page.wait_for_selector("[data-testid=cfd-track-verdict]", timeout=900_000)
        verdict = page.locator("[data-testid=cfd-track-verdict]").inner_text().lower()
        assert "out of reach" in verdict and "0%" in verdict, verdict
        assert page.locator("[data-testid=cfd-track-floor-toggle]").count() == 1
        needs = float(re.search(r"needs ₹([\d.]+)", page.locator("[data-testid=cfd-whatif]").inner_text()).group(1))
        quote.fill(f"{needs - 0.3:.2f}")
        quote.dispatch_event("change")
        page.click("[data-testid=cfd-track-run]")
        page.wait_for_selector("[data-testid=cfd-track-steps]", timeout=900_000)
        assert page.locator("[data-testid^=cfd-track-step-]").count() >= 1
        assert page.locator("[data-testid=cfd-track-chance]").count() >= 1
        assert page.locator("[data-testid=cfd-track-waterfall]").count() == 1
        assert "chance" in page.locator("[data-testid=cfd-track-verdict]").inner_text().lower()
        # a waterfall bar scrolls to its move and lights it
        first = page.locator("[data-testid^=cfd-track-step-]").first.get_attribute("data-testid").replace("cfd-track-step-", "")
        page.click(f"[data-testid=\"cfd-track-bar-{first}\"]")
        page.wait_for_timeout(300)
        assert "lit" in (page.locator(f"[data-testid=\"cfd-track-step-{first}\"]").get_attribute("class") or "")
        # freeze the first move with a note as evidence; the next track leaves it alone; the What-if workbook
        page.click(f"[data-testid=\"cfd-track-freeze-{first}\"]")
        page.wait_for_selector("[data-testid=cfd-freeze-dialog]", timeout=10_000)
        page.fill("[data-testid=cfd-freeze-note]", "Signed quote of 6 November")
        page.click("[data-testid=cfd-freeze-confirm]")
        page.wait_for_selector(f"[data-testid=\"cfd-frozen-{first}\"]", timeout=10_000)
        assert page.locator("[data-testid=cfd-frozen-table] thead th").count() >= 5, "the frozen levers as a table"
        assert "secured" in page.locator("[data-testid=cfd-frozen-progress]").inner_text().lower()
        page.click("[data-testid=cfd-track-run]")
        page.wait_for_selector("[data-testid=cfd-track-verdict]", timeout=900_000)
        page.wait_for_function("() => !document.querySelector('[data-testid=cfd-track-run]').disabled", timeout=900_000)
        assert page.locator(f"[data-testid=\"cfd-track-step-{first}\"]").count() == 0, "a frozen lever is not moved"
        with page.expect_download(timeout=180_000) as dl:
            page.click("[data-testid=cfd-whatif-download]")
        wi = tmp_path / "whatif.xlsx"
        dl.value.save_as(str(wi))
        wb2 = openpyxl.load_workbook(str(wi), read_only=True)
        assert "What-if track" in wb2.sheetnames, wb2.sheetnames
        page.click(f"[data-testid=\"cfd-unfreeze-{first}\"]")
        page.locator("[data-testid=cfd-levers-details] summary").click()
        page.wait_for_selector("[data-testid^=cfd-lever-]", timeout=600_000)
        assert page.locator("[data-testid^=cfd-lever-]").count() >= 11, "the table and at least ten levers"
        # the reading guide and a lever's explanation
        assert "how to read" in page.locator("[data-testid=cfd-lever-guide]").inner_text().lower()
        page.click("[data-testid=cfd-lever-why-solarMw]")
        note = page.locator("[data-testid=cfd-lever-note-solarMw]").inner_text().lower()
        assert "what it is" in note and "why it moves the price" in note and "in this bid" in note and "₹" in note
        page.click("[data-testid=cfd-lever-explain-all]")
        assert page.locator("[data-testid^=cfd-lever-note-]").count() >= 10

        # 10 bid forms: the particulars, a format, the letters
        _step(page, "forms")
        page.wait_for_selector("[data-testid=cfd-forms]", timeout=30_000)
        assert page.locator("[data-testid^=cfd-formsnav-7]").count() >= 10
        if page.locator("[data-testid=cfd-form-field-bidder]").count():
            page.fill("[data-testid=cfd-form-field-bidder]", "Arkaja Renewables Private Limited")
        page.click("[data-testid=\"cfd-formsnav-7.1\"]")
        page.wait_for_timeout(300)
        assert "covering" in page.locator("main").inner_text().lower()
        with page.expect_download(timeout=120_000) as dl:
            page.click("[data-testid=cfd-letters-docx]")
        docx = tmp_path / "letters.docx"
        dl.value.save_as(str(docx))
        assert docx.stat().st_size > 5_000

        # 11 reference bids
        _step(page, "reference")
        assert page.locator("[data-testid^=cfd-reference-seci-]").count() >= 5
        assert "FDRE" in page.locator("[data-testid=cfd-reference-table]").inner_text()

        # save to the library and reopen it
        page.click("[data-testid=cfd-save]")
        page.fill(".modal input[required]", "Acme CfD bid test")
        page.click(".modal button[type=submit]")
        page.wait_for_selector("[data-testid=cfd-saved]", timeout=30_000)
        page.goto(f"{URL}/scenarios?module=cfd")
        page.locator("tr", has_text="Acme CfD bid test").first.locator("a:has-text('Open')").click()
        page.wait_for_selector("[data-testid=cfd-tab]", timeout=30_000)
        assert "acme cfd bid test" in page.locator("[data-testid=cfd-linked]").inner_text().lower()


def test_tender_to_bid_hands_a_cfd_set_to_the_cfd_tab():
    """Tender to Bid reads the CfD-I set (the RfS and its three amendments), types it as a
    Contract for Difference tender, shows the set's changes, and on the sizing steps points to the
    CfD Bid tab instead of sizing a PPA plant."""
    from pathlib import Path

    base = Path(__file__).resolve().parents[2] / "web" / "public" / "tenders" / "seci-cfd-i"
    files = [str(base / n) for n in ("RfS.pdf", "Amendment-01.pdf", "Amendment-02.pdf", "Amendment-03.pdf")]
    with _session() as page:
        page.set_input_files("[data-testid=bid-file]", files)
        page.click("[data-testid=bid-read]")
        page.wait_for_selector("[data-testid=tender-set]", timeout=900_000)
        page.click("[data-testid=set-tab-changes]")
        assert page.locator("[data-testid=set-change-row]").count() >= 30, "every amendment's changes"
        page.click("[data-testid=bid-step-capacity]")
        page.wait_for_selector("[data-testid=bid-scope]", timeout=30_000)
        assert "contract for difference" in page.locator("[data-testid=bid-scope]").inner_text().lower()
        page.click("[data-testid=bid-open-cfd]")
        page.wait_for_selector("[data-testid=cfd-tab]", timeout=30_000)
