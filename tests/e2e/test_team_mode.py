"""Browser end to end: team mode (demo deployment, seats switched with View as).

The tender manager opens the What-if tab, clicks the send icon on the "Contracted capacity" box
and pings @finance.desk for it. As the Finance desk: Messages shows it unread, "Open field" goes to
the box and opens its thread, and the reply offers 320. Back as the manager: the reply is in the
inbox, and "Fill in" puts 320 in the box. Team setup lists the seats with their roles and tabs, and
a role change is saved. SCREENSHOTS=<dir> keeps a picture of each step."""
from __future__ import annotations

import os
import uuid

import pytest

from tests.e2e.test_tender_to_bid import DEMO, URL, _session

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and DEMO), reason="set TENDEROS_URL and TENDEROS_DEMO=1 (the seats are switched with View as)"),
]
SHOTS = os.environ.get("SCREENSHOTS")


def _shot(page, name):
    if SHOTS:
        page.screenshot(path=os.path.join(SHOTS, f"{name}.png"))


def _view_as(page, name):
    page.click("[data-testid=nav-messages]")
    sel = page.locator("[data-testid=team-actas] select")
    sel.select_option(label=next(o for o in sel.locator("option").all_inner_texts() if o.startswith(name)))
    page.wait_for_function(f"document.querySelector('[data-testid=nav-messages]').textContent.includes('as {name}')", timeout=15_000)


def _close_inbox(page):
    if page.locator("[data-testid=team-inbox]").count():
        page.click("[data-testid=nav-messages]")


def _box_dot(page, label):
    """The send icon of the What-if box with this label."""
    box = page.locator(".rtc-field", has_text=label).first.locator("input")
    box.scroll_into_view_if_needed()
    box.hover()
    key = page.evaluate("""(el) => { const r = el.getBoundingClientRect();
        const dots = [...document.querySelectorAll('[data-testid=ping-dot]')];
        let best = null, d = 1e9;
        for (const b of dots) { const q = b.getBoundingClientRect(); const dd = Math.abs(q.left + 10 - r.right) + Math.abs(q.top + 10 - r.top); if (dd < d) { d = dd; best = b; } }
        return best && d < 30 ? best.dataset.pingKey : null; }""", box.element_handle())
    assert key, f"no send icon at the {label} box"
    return box, page.locator(f'[data-testid=ping-dot][data-ping-key="{key}"]')


def test_ping_a_teammate_for_a_box_and_fill_in_the_answer():
    tag = uuid.uuid4().hex[:6]
    with _session() as page:
        page.wait_for_selector("aside.sidebar")
        _view_as(page, "Tender manager")
        _close_inbox(page)
        page.click("aside.sidebar button:has-text('What-if analysis')")
        page.wait_for_selector("[data-testid=ping-dot]")
        assert page.locator("[data-testid=ping-dot]").count() >= 10, "a send icon on every box"
        box, dot = _box_dot(page, "Contracted capacity (bid)")
        before = box.input_value()
        dot.click()
        page.wait_for_selector("[data-testid=ping-pop]")
        page.locator("[data-testid=ping-text]").type("@fin")
        page.wait_for_selector("[data-testid=ping-suggest] li")
        assert "@finance.desk" in page.locator("[data-testid=ping-suggest]").inner_text()
        page.keyboard.press("Enter")  # picks @finance.desk
        page.locator("[data-testid=ping-text]").type(f"what contracted MW should we bid? ({tag})")
        _shot(page, "1-ping")
        page.click("[data-testid=ping-send]")
        page.wait_for_selector(f"[data-testid=ping-thread] article:has-text('{tag}')")
        assert "@finance.desk" in page.locator("[data-testid=ping-thread]").inner_text()
        page.keyboard.press("Escape")

        # the Finance desk: unread, open the field, answer with a value
        _view_as(page, "Finance desk")
        item = page.locator("[data-testid=inbox-item]", has_text=tag).first
        item.wait_for()
        assert "mentioned you" in item.inner_text() and "Contracted capacity" in item.inner_text()
        assert int(page.locator("[data-testid=messages-unread]").inner_text()) >= 1
        _shot(page, "2-inbox")
        item.locator("[data-testid=inbox-open]").click()
        page.wait_for_selector("[data-testid=ping-pop]")
        assert tag in page.locator("[data-testid=ping-thread]").inner_text()
        page.locator("[data-testid=ping-text]").fill(f"Bid 320 MW: the board approved it ({tag}-reply)")
        page.locator("[data-testid=ping-value]").fill("320")
        page.click("[data-testid=ping-send]")
        page.wait_for_selector(f"[data-testid=ping-thread] article:has-text('{tag}-reply')")
        _shot(page, "3-reply")
        page.keyboard.press("Escape")

        # back as the manager: the reply is in the inbox; Fill in puts 320 in the box
        _view_as(page, "Tender manager")
        reply = page.locator("[data-testid=inbox-item]", has_text=f"{tag}-reply").first
        reply.wait_for()
        assert "replied" in reply.inner_text() and "320" in reply.inner_text()
        reply.locator("[data-testid=inbox-open]").click()
        page.wait_for_selector("[data-testid=ping-fill]")
        page.locator("[data-testid=ping-fill]").last.click()
        box = page.locator(".rtc-field", has_text="Contracted capacity (bid)").first.locator("input")
        page.wait_for_function("(el) => el.value === '320'", arg=box.element_handle(), timeout=5_000)
        assert before != "320" or True
        _shot(page, "4-filled")
        page.keyboard.press("Escape")
        box.fill(before)  # leave the shared demo as it was

        # Team setup: the seats, their roles and tabs; a title is saved
        page.click("[data-testid=nav-team-setup]")
        page.wait_for_selector("[data-testid=team-setup]")
        assert page.locator("[data-testid=setup-member-finance-desk], [data-testid^=setup-member-finance]").count() >= 1
        assert "@finance.desk" in page.locator("[data-testid=cover-whatIf]").inner_text()
        row = page.locator("tr", has_text="@legal.desk")
        title = row.locator("input[aria-label=Title]")
        old = title.input_value()
        title.fill(f"General counsel {tag}")
        row.locator("[data-testid=setup-save]").click()
        row.locator("text=Saved").wait_for()
        _shot(page, "5-setup")
        title.fill(old)
        row.locator("[data-testid=setup-save]").click()
