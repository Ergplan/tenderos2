"""Browser end to end: feedback on any section and the Change requests tab (demo deployment).

As the Tender manager: switch feedback on, click the "Tariff levers" section of the What-if tab,
write a comment; it is recorded as a change request. On Change requests it lists where, what and by
whom; the manager (a super admin) approves it and exports the approved requests as one Markdown
prompt file, whose text names the request, the section and the code to touch; the request is then
Exported, and is removed to leave the demo as it was."""
from __future__ import annotations

import uuid

import pytest

from tests.e2e.test_team_mode import _close_inbox, _view_as
from tests.e2e.test_tender_to_bid import DEMO, URL, _session

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and DEMO), reason="set TENDEROS_URL and TENDEROS_DEMO=1 (the seats are switched with View as)"),
]


def test_feedback_to_change_request_to_prompt(tmp_path):
    tag = uuid.uuid4().hex[:6]
    with _session() as page:
        page.wait_for_selector("aside.sidebar")
        _view_as(page, "Tender manager")
        _close_inbox(page)
        page.click("aside.sidebar button:has-text('What-if analysis')")
        page.wait_for_selector("[data-testid=whatif-verdict]")

        # feedback on: the section under the mouse is outlined; a click opens the note
        page.click("[data-testid=nav-feedback]")
        page.wait_for_selector("[data-testid=fb-banner]")
        section = page.locator("section.rtc-section", has_text="Tariff levers for bid day").first
        section.scroll_into_view_if_needed()
        section.hover()
        assert page.locator(".fb-outline").count() == 1, "the hovered section is outlined"
        section.locator("header h2").click()
        page.wait_for_selector("[data-testid=fb-pop]")
        pop = page.locator("[data-testid=fb-pop]")
        assert "Tariff levers for bid day" in pop.inner_text() and "What-if analysis" in pop.inner_text()
        page.fill("[data-testid=fb-text]", f"Show the levers as a tornado chart too ({tag})")
        page.click("[data-testid=fb-send]")
        page.wait_for_selector("text=Recorded as CR-")
        page.click("[data-testid=fb-off]")
        assert page.locator("[data-testid=fb-banner]").count() == 0

        # the Change requests tab lists it: where, what, who; approve and export
        page.click("[data-testid=nav-change-requests]")
        page.wait_for_selector("[data-testid=change-requests]")
        row = page.locator("[data-testid=cr-row]", has_text=tag).first
        row.wait_for()
        text = row.inner_text()
        assert "What-if analysis" in text and "Tariff levers for bid day" in text and "Tender manager" in text and "Open" in text, text
        assert row.get_attribute("data-status") == "open"
        row.locator("[data-testid=cr-approve]").click()
        page.wait_for_function("(tag) => [...document.querySelectorAll('[data-testid=cr-row]')].some((r) => r.textContent.includes(tag) && r.dataset.status === 'approved')", arg=tag)
        with page.expect_download(timeout=60_000) as dl:
            page.click("[data-testid=cr-export]")
        path = tmp_path / dl.value.suggested_filename
        dl.value.save_as(str(path))
        md = path.read_text(encoding="utf-8")
        assert dl.value.suggested_filename.startswith("tenderos-change-requests-") and dl.value.suggested_filename.endswith(".md")
        assert "# TenderOS change requests" in md and "## Instructions for Claude Code" in md and "docs/dev/DEV-MANUAL.md" in md
        assert tag in md and "What-if analysis › 3 Tariff levers for bid day" in md and "web/src/whatif" in md and "Tender manager" in md, md[:2000]
        page.wait_for_function("(tag) => [...document.querySelectorAll('[data-testid=cr-row]')].some((r) => r.textContent.includes(tag) && r.dataset.status === 'exported')", arg=tag)
        row = page.locator("[data-testid=cr-row]", has_text=tag).first
        assert "batch" in row.inner_text()
        # leave the demo as it was
        row.locator("[data-testid=cr-delete]").click()
        page.wait_for_function("(tag) => ![...document.querySelectorAll('[data-testid=cr-row]')].some((r) => r.textContent.includes(tag))", arg=tag)
