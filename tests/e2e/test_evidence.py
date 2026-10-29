"""Browser end to end: evidence on every input (demo deployment, seats switched with View as).

The tender manager opens the What-if tab, clicks the paperclip on the "Contracted capacity (bid)"
box and attaches a note and a link; the paperclip shows 2. The manager (a super admin) signs off the
value: the paperclip turns green. Changing the box's value turns it amber ("signed off at an older
value"). The note is removed, the tab's evidence register is downloaded as CSV and holds the link,
and the demo is left as it was. SCREENSHOTS=<dir> keeps a picture of each step."""
from __future__ import annotations

import os
import uuid

import pytest

from tests.e2e.test_team_mode import _close_inbox, _view_as
from tests.e2e.test_tender_to_bid import DEMO, URL, _session

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and DEMO), reason="set TENDEROS_URL and TENDEROS_DEMO=1 (the seats are switched with View as)"),
]
SHOTS = os.environ.get("SCREENSHOTS")
LABEL = "Contracted capacity (bid)"


def _shot(page, name):
    if SHOTS:
        page.screenshot(path=os.path.join(SHOTS, f"{name}.png"))


def _box(page):
    return page.locator(".rtc-field", has_text=LABEL).first.locator("input")


def _clip(page):
    """The paperclip of the What-if box with LABEL: it sits 34 px left of the box's right edge, at its top."""
    box = _box(page)
    box.scroll_into_view_if_needed()
    box.hover()
    key = page.evaluate("""(el) => { const r = el.getBoundingClientRect();
        const dots = [...document.querySelectorAll('[data-testid=ev-dot]')];
        let best = null, d = 1e9;
        for (const b of dots) { const q = b.getBoundingClientRect(); const dd = Math.abs(q.left + 34 - r.right) + Math.abs(q.top + 10 - r.top); if (dd < d) { d = dd; best = b; } }
        return best && d < 30 ? best.dataset.evKey : null; }""", box.element_handle())
    assert key, f"no paperclip at the {LABEL} box"
    return box, page.locator(f'[data-testid=ev-dot][data-ev-key="{key}"]')


def _open(page):
    box, clip = _clip(page)
    clip.click()
    page.wait_for_selector("[data-testid=ev-pop]")
    return box, clip


def _clear(page):
    """Leave the shared demo as it was: no sign-off and none of this test's items on the box."""
    pop = page.locator("[data-testid=ev-pop]")
    if pop.locator("[data-testid=ev-signoff]:has-text('Clear sign-off')").count():
        pop.locator("[data-testid=ev-signoff]").click()
    elif pop.locator("[data-testid=ev-signoff-clear]").count():
        pop.locator("[data-testid=ev-signoff-clear]").click()
    page.wait_for_function("() => !document.querySelector('[data-testid=ev-state]')", timeout=10_000)


def test_attach_evidence_sign_off_and_download_the_register(tmp_path):
    tag = uuid.uuid4().hex[:6]
    link = f"https://example.com/board-minute/{tag}"
    with _session() as page:
        page.wait_for_selector("aside.sidebar")
        _view_as(page, "Tender manager")
        _close_inbox(page)
        page.click("aside.sidebar button:has-text('What-if analysis')")
        page.wait_for_selector("[data-testid=ev-dot]")
        assert page.locator("[data-testid=ev-dot]").count() >= 10, "a paperclip on every box"
        assert page.locator("[data-testid=ping-dot]").count() >= 10, "beside the send icons"

        # a note and a link on the box
        box, clip = _open(page)
        before = box.input_value()
        pop = page.locator("[data-testid=ev-pop]")
        assert LABEL in pop.inner_text() and "What-if analysis" in pop.inner_text()
        pop.locator("[data-testid=ev-kind-note]").click()
        pop.locator("[data-testid=ev-note]").fill(f"Board minute of 12 October ({tag})")
        pop.locator("[data-testid=ev-add]").click()
        page.wait_for_selector(f"[data-testid=ev-item][data-kind=note]:has-text('{tag}')")
        pop.locator("[data-testid=ev-kind-link]").click()
        pop.locator("[data-testid=ev-url]").fill(link)
        pop.locator("[data-testid=ev-add]").click()
        page.wait_for_selector(f"[data-testid=ev-item][data-kind=link]:has-text('{link}')")
        item = pop.locator("[data-testid=ev-item]", has_text=tag).first
        assert "Tender manager" in item.inner_text()
        assert f"value then: {before}" in item.inner_text() or before == ""
        _shot(page, "1-attached")
        key = clip.get_attribute("data-ev-key")
        page.keyboard.press("Escape")
        page.wait_for_function(f"() => Number(document.querySelector('[data-testid=ev-dot][data-ev-key=\"{key}\"]')?.dataset.evCount) >= 2", timeout=10_000)
        clip = page.locator(f'[data-testid=ev-dot][data-ev-key="{key}"]')
        assert int(clip.get_attribute("data-ev-count")) >= 2 and clip.inner_text().strip(), "the paperclip shows the count"

        # the super admin signs off the value: green
        box, clip = _open(page)
        pop = page.locator("[data-testid=ev-pop]")
        pop.locator("[data-testid=ev-signoff]:has-text('Sign off this value')").click()
        page.wait_for_selector("[data-testid=ev-state]:has-text('Signed off at this value')")
        assert "Tender manager" in pop.locator("[data-testid=ev-state]").inner_text()
        _shot(page, "2-signed")
        page.keyboard.press("Escape")
        page.wait_for_function(f"() => document.querySelector('[data-testid=ev-dot][data-ev-key=\"{key}\"]')?.dataset.evState === 'signed'", timeout=10_000)

        # the value changes: amber, signed off at an older value
        changed = "310" if before != "310" else "320"
        box.fill(changed)
        page.wait_for_function(f"() => document.querySelector('[data-testid=ev-dot][data-ev-key=\"{key}\"]')?.dataset.evState === 'stale'", timeout=10_000)
        box, clip = _open(page)
        pop = page.locator("[data-testid=ev-pop]")
        state = pop.locator("[data-testid=ev-state]")
        assert "older value" in state.inner_text() and before in state.inner_text()
        assert f"Now in the box: {changed}" in pop.locator(".ev-now").inner_text()
        _shot(page, "3-stale")

        # remove the note; the link stays
        note = pop.locator("[data-testid=ev-item]", has_text=tag).first
        note.locator("[data-testid=ev-delete]").click()
        page.wait_for_function(f"() => !document.querySelector('[data-testid=ev-item][data-kind=note]') || !document.querySelector('[data-testid=ev-pop]').textContent.includes('{tag}')", timeout=10_000)
        assert pop.locator("[data-testid=ev-item]", has_text=link).count() == 1

        # the tab's evidence register as CSV
        with page.expect_download(timeout=60_000) as dl:
            pop.locator("[data-testid=ev-register]").click()
        path = tmp_path / "register.csv"
        dl.value.save_as(str(path))
        csv = path.read_text(encoding="utf-8")
        assert csv.startswith("Tab,Box,Place,Value at attach,Kind,Name / URL / note,By,When,Signed off")
        row = next(line for line in csv.splitlines() if link in line)
        # the link was attached at the value that was signed off, so the register says "current" (it does not see the box now)
        assert row.startswith("What-if analysis,") and LABEL in row and "link" in row and "Tender manager" in row and ",current," in row
        assert tag not in csv.replace(link, ""), "the removed note is not in the register"
        _shot(page, "4-register")

        # leave the demo as it was: the link removed, no sign-off, the old value back
        pop.locator("[data-testid=ev-item]", has_text=link).first.locator("[data-testid=ev-delete]").click()
        page.wait_for_function(f"() => !document.querySelector('[data-testid=ev-pop]').textContent.includes('{link}')", timeout=10_000)
        _clear(page)
        page.keyboard.press("Escape")
        box.fill(before)
        page.wait_for_function(f"() => document.querySelector('[data-testid=ev-dot][data-ev-key=\"{key}\"]')?.dataset.evState === 'none'", timeout=10_000)
