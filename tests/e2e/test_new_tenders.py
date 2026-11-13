"""New tenders: the page scans SECI's live site (the tender list and each details page; no document
opened), shows every open tender with its summary, dates and what to watch, filters them, and a
second scan finds nothing new. Needs network access to www.seci.co.in; slow (a scan is about a
minute)."""

from __future__ import annotations

import pytest

from tests.e2e.test_tender_to_bid import _session

pytestmark = pytest.mark.slow


def _open(page):
    page.click("aside.sidebar button:has-text('New tenders')")
    page.wait_for_selector("[data-testid=new-tenders]", timeout=30_000)


def test_new_tenders_scans_seci_and_summarises_without_documents():
    with _session() as page:
        _open(page)
        ready = "() => { const b = document.querySelector('[data-testid=seci-scan]'); return b && !b.disabled; }"
        # a stale store scans by itself on opening; else scan now
        page.wait_for_timeout(1500)
        page.wait_for_function(ready, timeout=600_000)
        if page.locator("[data-testid^=seci-tender-SECI]").count() == 0:
            page.click("[data-testid=seci-scan]")
            page.wait_for_selector("[data-testid=seci-scanning]", timeout=10_000)
            page.wait_for_function(ready, timeout=600_000)
        assert page.locator("[data-testid=seci-error]").count() == 0, page.locator("[data-testid=seci-error]").inner_text()
        cards = page.locator("[data-testid^=seci-tender-SECI]")
        assert cards.count() >= 3, "SECI lists several open tenders"
        stats = page.locator("[data-testid=seci-scan-stats]").inner_text().lower()
        assert "open tenders" in stats and "summaries by" in stats
        first = cards.first
        assert len(first.locator("[data-testid=seci-summary]").inner_text()) > 60
        assert "no document opened" in first.locator("[data-testid=seci-summary]").inner_text()
        assert first.locator("[data-testid=seci-days]").count() == 1
        first.locator("[data-testid=seci-more]").click()
        first.locator(".seci-more").wait_for(timeout=10_000)
        assert "none was opened" in first.locator(".seci-more").inner_text().lower()
        assert "closed" not in first.locator("[data-testid=seci-days]").inner_text(), "open tenders first; a passed deadline sits under Closed"
        # the filters
        page.click("[data-testid=seci-filter-soon]")
        for card in page.locator("[data-testid^=seci-tender-SECI]").all():
            assert "left" in card.locator("[data-testid=seci-days]").inner_text() or "due today" in card.locator("[data-testid=seci-days]").inner_text()
        page.click("[data-testid=seci-filter-all]")
        # a second scan: nothing new, the summaries kept
        page.click("[data-testid=seci-scan]")
        page.wait_for_selector("[data-testid=seci-scanning]", timeout=10_000)
        page.wait_for_function(ready, timeout=600_000)
        assert page.locator("[data-testid=seci-error]").count() == 0, page.locator("[data-testid=seci-error]").inner_text()
        assert "0 new" in page.locator("[data-testid=seci-scan-stats]").inner_text(), "a second scan finds nothing new"
        page.click("[data-testid=seci-filter-new]")
        assert page.locator("[data-testid^=seci-tender-SECI]").count() == 0 or "changed" in page.inner_text("[data-testid=seci-tender-list]").lower()
