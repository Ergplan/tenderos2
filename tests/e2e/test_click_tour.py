"""Browser click tour (demo deployment): every tab, every step, every main button that does not
start a long job, with no page error, no 5xx from the API, the expected data-testids on screen and
the key texts rendered. No HiGHS sizing, no 15-minute dispatch, no tender upload: the tour runs in
about three minutes and complements the journey tests, which do the long work.

* test_sidebar_tabs_theme_and_zone: every sidebar entry opens its screen; the zone badge; day and
  night mode switched and switched back.
* test_tender_to_bid_steps: the prefilled WBSEDCL tender and its six steps; Fill up for me please;
  One site / Separate sites; the sizing and financials steps before any sizing; back to the start.
* test_seci_steps: the ten step chips in order with their main controls: the amendment filter, a
  condition's RfS wording, the Peak Hours and shortfall choices, Fill up for me please, the loss-kind
  tabs, the site schematic on one and on separate sites, the solar studio, the finance inputs (the
  repayment method, construction months, working capital, the DSM switch), the What-if levers, the
  bid formats and the letter view, the winning bid, the Save dialog, the evidence paperclip and the
  ping icon on a box, and Reset inputs.
* test_what_if_tab: the standalone What-if tab: Bid at this tariff, Compute the levers, the
  traceable model, Reset inputs, the paperclip and the ping icon.
* test_round_the_clock_chapters: the six chapters, One site / Separate sites, the repayment method
  and the construction view in the finance chapter.
* test_bess_cfd_recent_team: the BESS chapters, the CfD steps with Fill up, Recent tenders, Team
  setup and Messages.

Run with a stack in demo mode (the seats are switched with View as):
  TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 pytest -q -m slow tests/e2e/test_click_tour.py
Optional: PLAYWRIGHT_CHROMIUM (a Chromium binary), SCREENSHOTS (a folder for a picture per screen).
"""
from __future__ import annotations

import contextlib
import json
import os
import re
from pathlib import Path

import pytest

from tests.e2e.test_team_mode import _close_inbox, _view_as
from tests.e2e.test_tender_to_bid import DEMO, URL, _session

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and DEMO), reason="set TENDEROS_URL and TENDEROS_DEMO=1 (the seats are switched with View as)"),
]
SHOTS = os.environ.get("SCREENSHOTS")
PACK = json.loads((Path(__file__).resolve().parents[2] / "web" / "src" / "seci" / "seci-rtc-tm-v.json").read_text())

TABS = ["Tender to Bid", "Round the Clock", "SECI RTC tender", "BESS Tender", "CfD Bid", "What-if analysis", "Recent tenders"]
SECI_STEPS = ["documents", "conditions", "bid", "sources", "financeInputs", "size", "finance", "whatif", "forms", "winning"]
BID_STEPS = ["tender", "dates", "capacity", "sources", "size", "finance"]
RTC_CHAPTERS = ["Energy needed", "Supply type", "DFR", "Solar", "Wind", "Battery storage"]
BESS_CHAPTERS = ["Tender", "Requirements", "Battery", "Costs", "Finance"]
CFD_STEPS = ["model", "example", "terms", "plant", "costs", "operations", "finance"]


def _shot(page, name):
    if SHOTS:
        page.screenshot(path=os.path.join(SHOTS, f"tour-{name}.png"))


@contextlib.contextmanager
def _tour():
    """A session that also counts the API's failures: any response of 500 or more fails the tour;
    the 4xx answers are reported, not asserted (a demo seat is refused some admin calls by design)."""
    failed: list[str] = []
    refused: list[str] = []
    with _session() as page:
        def on_response(r):
            if r.status >= 500:
                failed.append(f"{r.status} {r.request.method} {r.url}")
            elif r.status >= 400:
                refused.append(f"{r.status} {r.request.method} {r.url}")
        page.on("response", on_response)
        page.wait_for_selector("aside.sidebar")
        yield page
        page.wait_for_timeout(300)
        assert not failed, failed
        if refused:
            print("4xx answers during the tour:", refused)


def _tab(page, label):
    page.click(f"aside.sidebar button:has-text('{label}')")


def _seci(page):
    _tab(page, "SECI RTC tender")
    page.wait_for_selector("[data-testid=seci-tab]", timeout=30_000)


def _step(page, kind, step):
    page.click(f"[data-testid={kind}-step-{step}]")
    assert page.locator(f"[data-testid={kind}-step-{step}]").get_attribute("aria-current") == "step", step
    page.wait_for_timeout(250)


def _field(page, label):
    """The box of the Field / SelectBox with this label (rtc/ui.jsx)."""
    return page.locator(".rtc-field", has=page.locator(".rtc-field-top span", has_text=re.compile(rf"^{re.escape(label)}$"))).first


def _icon_for(page, box, testid, key_attr, dx):
    """The paperclip (ev-dot, dx 34) or the send icon (ping-dot, dx 10) of a box: they sit at the
    box's top-right corner and take clicks only while the box is under the mouse."""
    box.scroll_into_view_if_needed()
    box.hover()
    page.wait_for_timeout(300)
    key = page.evaluate("""([el, testid, attr, dx]) => { const r = el.getBoundingClientRect();
        const dots = [...document.querySelectorAll(`[data-testid=${testid}]`)];
        let best = null, d = 1e9;
        for (const b of dots) { const q = b.getBoundingClientRect(); const dd = Math.abs(q.left + dx - r.right) + Math.abs(q.top + 10 - r.top); if (dd < d) { d = dd; best = b; } }
        return best && d < 30 ? best.dataset[attr] : null; }""", [box.element_handle(), testid, key_attr, dx])
    assert key, f"no {testid} at the box"
    attr = "data-ev-key" if key_attr == "evKey" else "data-ping-key"
    return page.locator(f'[data-testid={testid}][{attr}="{key}"]')


def _evidence_and_ping(page, box):
    """Open and close the box's evidence and its thread."""
    _icon_for(page, box, "ev-dot", "evKey", 34).click()
    pop = page.wait_for_selector("[data-testid=ev-pop]")
    assert "Attach" in pop.inner_text() and page.locator("[data-testid=ev-register]").count() == 1
    assert page.locator("[data-testid=ev-kind-note]").count() == 1 and page.locator("[data-testid=ev-add]").count() == 1
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('[data-testid=ev-pop]')")
    _icon_for(page, box, "ping-dot", "pingKey", 10).click()
    pop = page.wait_for_selector("[data-testid=ping-pop]")
    assert "Now in the box" in pop.inner_text() and page.locator("[data-testid=ping-text]").count() == 1
    assert page.locator("[data-testid=ping-send]").is_disabled(), "nothing typed: nothing to send"
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('[data-testid=ping-pop]')")


def test_sidebar_tabs_theme_and_zone():
    with _tour() as page:
        badge = page.locator("[data-testid=zone-badge]")
        badge.wait_for()
        assert badge.get_attribute("data-zone") == "all" and "Single installation" in badge.inner_text()
        expect = {
            "Tender to Bid": ("[data-testid=bid-start]", "Tender to bid"),
            "Round the Clock": ("[data-testid=rtc-finance-stats]", "Equity IRR"),
            "SECI RTC tender": ("[data-testid=seci-tab]", "RTC tender · SECI"),
            "BESS Tender": ("nav.story-rail", "BESS"),
            "CfD Bid": ("[data-testid=cfd-step-model]", "How it works"),
            "What-if analysis": ("[data-testid=whatif-verdict]", "What-if"),
            "Recent tenders": ("[data-testid=seci-results]", "SECI"),
        }
        for label in TABS:
            _tab(page, label)
            selector, text = expect[label]
            page.wait_for_selector(selector, timeout=120_000)
            assert page.locator(f"aside.sidebar button:has-text('{label}')").get_attribute("class").startswith("active"), label
            assert text.lower() in page.locator("main").inner_text().lower(), (label, text)
            _shot(page, f"tab-{label.replace(' ', '-').lower()}")
        page.click("[data-testid=nav-team-setup]")
        page.wait_for_selector("[data-testid=team-setup]")
        assert "team setup" in page.locator("main").inner_text().lower()
        page.click("[data-testid=nav-messages]")
        page.wait_for_selector("[data-testid=team-inbox]")
        assert "Messages" in page.locator("[data-testid=team-inbox]").inner_text()
        page.click("[data-testid=nav-messages]")
        page.wait_for_function("() => !document.querySelector('[data-testid=team-inbox]')")
        # day mode and back
        toggle = page.locator("aside.sidebar [data-testid=theme-toggle]")
        assert page.evaluate("document.documentElement.dataset.theme") == "dark"
        toggle.click()
        page.wait_for_function("document.documentElement.dataset.theme === 'light'")
        assert "night mode" in toggle.inner_text().lower()
        _shot(page, "day-mode")
        toggle.click()
        page.wait_for_function("document.documentElement.dataset.theme === 'dark'")
        assert "day mode" in toggle.inner_text().lower()


def test_tender_to_bid_steps():
    with _tour() as page:
        _tab(page, "Tender to Bid")
        page.wait_for_selector("[data-testid=bid-start]")
        for tid in ("bid-file", "bid-read", "start-prefilled", "start-run-prefilled"):
            assert page.locator(f"[data-testid={tid}]").count() == 1, tid
        page.click("[data-testid=start-run-prefilled]")
        head = page.wait_for_selector("[data-testid=bid-tender-head]", timeout=60_000)
        assert "WBSEDCL/PT&P/RE-RTC/2026/01" in head.inner_text()
        for step in BID_STEPS:
            assert page.locator(f"[data-testid=bid-step-{step}]").count() == 1, step
        _step(page, "bid", "tender")
        assert page.locator("[data-testid=bid-summary]").count() == 1 and page.locator("[data-testid=bid-recent]").count() == 1
        _step(page, "bid", "dates")
        assert page.locator("[data-testid=bid-calendar]").count() == 1 and page.locator("[data-testid=bid-agenda]").count() == 1
        assert page.locator("[data-testid=bid-dates-head]").inner_text().strip()
        _step(page, "bid", "capacity")
        assert page.locator("[data-testid=bid-base-mw]").count() == 1
        assert "1,500 MW" in page.locator(".bid-page").inner_text()
        # the greenshoe is a bid decision, not a benchmark: say no, so the sources step has nothing left to ask
        page.locator("[data-testid=bid-greenshoe] button", has_text="No").click()
        assert "active" in page.locator("[data-testid=bid-greenshoe] button", has_text="No").get_attribute("class")
        _step(page, "bid", "sources")
        page.click("[data-testid=bid-fill]")
        assert page.locator("[data-testid=bid-missing]").count() == 0, "the benchmarks fill every input"
        assert page.locator("[data-testid=bid-financing]").count() == 1
        for sid in ("solar", "wind", "bess"):
            assert page.locator(f"[data-testid=source-{sid}]").count() == 1, sid
        page.click("[data-testid=bid-sites-one]")
        assert "active" in page.locator("[data-testid=bid-sites-one]").get_attribute("class")
        split = page.locator("[data-testid=bid-sites-split]")
        if split.is_enabled():
            split.click()
            page.wait_for_selector("[data-testid=bid-sites-rule]")
            page.click("[data-testid=bid-sites-one]")
            page.wait_for_function("() => !document.querySelector('[data-testid=bid-sites-rule]')")
        assert page.locator("[data-testid=bid-size]").count() == 1, "Size the plant is offered, not clicked"
        _shot(page, "bid-sources")
        _step(page, "bid", "size")
        assert page.locator("[data-testid=bid-size-again]").count() == 1 and page.locator("[data-testid=bid-sizes]").count() == 0
        _step(page, "bid", "finance")
        assert "size the plant first" in page.locator(".bid-page").inner_text().lower()
        page.click("[data-testid=bid-new-tender-top]")
        page.wait_for_selector("[data-testid=start-continue]")
        assert "WBSEDCL" in page.locator("[data-testid=start-continue]").inner_text()


def test_seci_steps():
    with _tour() as page:
        _view_as(page, "Tender manager")
        _close_inbox(page)
        _seci(page)
        for step in SECI_STEPS:
            assert page.locator(f"[data-testid=seci-step-{step}]").count() == 1, step
        teams = {s: page.locator(f"[data-testid=seci-step-team-{s}]").text_content() for s in SECI_STEPS}
        assert teams["bid"] == "Projects" and teams["sources"] == "Design" and teams["financeInputs"] == "Finance" and teams["forms"] == "Tender / Legal", teams

        # 01 Tender & amendments
        _step(page, "seci", "documents")
        assert page.locator("[data-testid=seci-docs] article").count() == 6
        assert page.locator("[data-testid=seci-process] li").count() >= 10
        total = page.locator("[data-testid=seci-changes] .seci-change").count()
        page.click("button:has-text('Amendment-02')")
        assert 0 < page.locator("[data-testid=seci-changes] .seci-change").count() < total
        page.click("button:has-text('All')")
        assert page.locator("[data-testid=seci-changes] .seci-change").count() == total
        assert page.locator("[data-testid=seci-clarifications] .seci-change").count() == len(PACK["clarifications"])
        assert page.locator("[data-testid=seci-queries] li").count() >= 10

        # 02 Bid conditions
        _step(page, "seci", "conditions")
        assert page.locator(".seci-cond").count() >= 50
        assert "conditions" in page.locator("[data-testid=seci-cond-summary]").inner_text()
        rfs = page.locator("summary:has-text('RfS as issued')").first
        rfs.scroll_into_view_if_needed()
        rfs.click()
        assert "open" in page.evaluate("(el) => [...el.closest('details').attributes].map((a) => a.name)", rfs.element_handle())

        # 03 Bid inputs
        _step(page, "seci", "bid")
        mw = page.locator("[data-testid=seci-bid-mw]")
        assert mw.input_value()
        for choice in ("seci-peak-price", "seci-shortfall-penalty", "seci-profile-amd3"):
            page.click(f"[data-testid={choice}]")
            assert page.locator(f"[data-testid={choice}]").get_attribute("aria-checked") == "true", choice
        # the money at stake follows the installed capacity, so before a sizing the section says so
        money = page.locator(".rtc-section", has_text="Money at stake")
        assert page.locator("[data-testid=seci-money]").count() == 0 and "size the plant" in money.inner_text().lower()
        _evidence_and_ping(page, mw)
        _shot(page, "seci-bid")

        # 04 Design
        _step(page, "seci", "sources")
        page.click("[data-testid=bid-fill]")
        assert page.locator("[data-testid=bid-missing]").count() == 0
        losses = page.locator("[data-testid=bid-losses]")
        for kind, want in (("solar", "Inverter-duty transformers"), ("wind", "WTG step-up transformers"), ("bess", "MV transformers")):
            page.click(f"[data-testid=bid-loss-kind-{kind}]")
            assert page.locator(f"[data-testid=bid-loss-kind-{kind}]").get_attribute("aria-selected") == "true"
            assert want in losses.inner_text(), (kind, want)
        schematic = page.locator("[data-testid=site-schematic]")
        page.click("[data-testid=bid-sites-one]")
        assert schematic.get_attribute("data-split") == "0" and "One pooling station" in schematic.inner_text()
        page.click("[data-testid=bid-sites-split]")
        page.wait_for_selector("[data-testid=bid-sites-rule]")
        assert schematic.get_attribute("data-split") == "1"
        _shot(page, "seci-schematic-split")
        page.click("[data-testid=bid-sites-one]")
        page.wait_for_function("() => document.querySelector('[data-testid=site-schematic]')?.dataset.split === '0'")
        page.click("[data-testid=studio-solar]")
        page.wait_for_selector("[data-testid=solar-studio]")
        assert page.locator("[data-testid=solar-layout]").count() == 1 and "₹" in page.locator("[data-testid=solar-cr-mwac]").inner_text()
        page.click("[aria-label='Close the studio']")
        page.wait_for_function("() => !document.querySelector('[data-testid=solar-studio]')")
        assert page.locator("[data-testid=bid-to-finance-inputs]").count() == 1

        # 05 Finance inputs
        page.click("[data-testid=bid-to-finance-inputs]")
        page.wait_for_selector("[data-testid=bid-financing]")
        assert page.locator("[data-testid=seci-step-financeInputs]").get_attribute("aria-current") == "step"
        for tid in ("bid-debt-terms", "bid-construction", "bid-working-capital", "dsm-stats", "bid-fill-finance"):
            assert page.locator(f"[data-testid={tid}]").count() == 1, tid
        page.click("[data-testid=bid-fill-finance]")
        assert page.locator("[data-testid=bid-missing]").count() == 0
        repay = _field(page, "Repayment").locator("select")
        assert repay.input_value() == "equal"
        for method, extra in (("sculpted", "Target DSCR"), ("balloon", "Balloon share"), ("stepUp", "Principal step-up")):
            repay.select_option(method)
            assert extra.lower() in page.locator("[data-testid=bid-debt-terms]").inner_text().lower(), method
        repay.select_option("equal")
        assert "target dscr" not in page.locator("[data-testid=bid-debt-terms]").inner_text().lower()
        months = _field(page, "Construction").locator("input")
        months.fill("12")
        assert "month by month" in _field(page, "Construction").inner_text()
        months.fill("0")
        assert "pre-operative" in _field(page, "Construction").inner_text()
        _field(page, "Drawdown profile").locator("select").select_option(index=1)
        _field(page, "Drawdown profile").locator("select").select_option(index=0)
        assert "CERC norm: 45 days" in page.locator("[data-testid=bid-working-capital]").inner_text()
        switch = page.locator(".dsm-panel .rtc-switch").first
        assert switch.inner_text().strip().lower() == "on" and "₹" in page.locator("[data-testid=dsm-stats]").inner_text()
        switch.click()
        assert switch.inner_text().strip().lower() == "off" and "off" in page.locator("[data-testid=dsm-stats]").inner_text().lower()
        switch.click()
        assert switch.inner_text().strip().lower() == "on"
        assert "ready to size" in page.locator(".optimize-bar").inner_text().lower() and page.locator("[data-testid=bid-size]").is_enabled()
        _shot(page, "seci-finance-inputs")

        # 06 Size, 07 Financial model: before any sizing
        _step(page, "seci", "size")
        assert page.locator("[data-testid=bid-size-again]").count() == 1 and page.locator("[data-testid=bid-sizes]").count() == 0
        _step(page, "seci", "finance")
        assert "size the plant first" in page.locator(".bid-page").inner_text().lower()

        # 08 What-if: the default case until the plant is sized; the levers run in the browser
        _step(page, "seci", "whatif")
        seeded = page.wait_for_selector("[data-testid=whatif-seeded]")
        assert "Size the plant first" in seeded.inner_text()
        page.wait_for_selector("[data-testid=whatif-verdict]")
        assert page.locator("[data-testid=whatif-returns]").count() == 1
        page.click("[data-testid=lever-compute]")
        page.wait_for_selector("[data-testid=lever-table]", timeout=120_000)
        assert page.locator("[data-testid=lever-table] tbody tr").count() >= 8
        assert "levers up to date" in page.locator("[data-testid=lever-compute]").inner_text().lower()
        _shot(page, "seci-whatif-levers")

        # 09 Bid forms
        _step(page, "seci", "forms")
        assert page.locator("[data-testid=seci-forms-nav]").count() == 1 and page.locator("[data-testid=seci-particulars]").count() == 1
        assert page.locator("[data-testid=seci-checks]").count() == 1
        page.click("[data-testid=seci-formsnav-7\\.1]")
        page.wait_for_selector("[data-testid=seci-format-7\\.1]")
        assert "COVERING LETTER" in page.locator("[data-testid=seci-format-7\\.1]").inner_text().upper()
        assert page.locator("[data-testid=seci-rfs-frame]").get_attribute("src").endswith("RfS.pdf#page=68&view=FitH")
        page.click("[data-testid=seci-format-mode-letter]")
        page.wait_for_selector("[data-testid=seci-letter]")
        assert "COVERING LETTER" in page.locator("[data-testid=seci-letter]").inner_text().upper()
        page.click("[data-testid=seci-format-mode-blanks]")
        page.wait_for_selector("[data-testid=seci-rfs-frame]")
        page.click("[data-testid=seci-formsnav-particulars]")
        page.wait_for_selector("[data-testid=seci-particulars]")
        for tid in ("seci-forms-download", "seci-letters-word", "seci-letters-pdf"):
            assert page.locator(f"[data-testid={tid}]").count() == 1, tid
        _shot(page, "seci-forms")

        # 10 Winning bid
        _step(page, "seci", "winning")
        page.wait_for_selector("[data-testid=win-bridge]")
        assert page.locator("[data-testid=win-bridge] tbody tr").count() == 8
        assert "₹5.25" in page.locator("[data-testid=win-head]").inner_text()
        assert page.locator("[data-testid=win-disclosed]").count() == 1

        # Save: the dialog opens and closes without saving; the agent panel opens and closes
        page.click("[data-testid=seci-save]")
        modal = page.wait_for_selector(".modal")
        assert "save scenario" in modal.inner_text().lower() and page.locator(".modal input[required]").count() == 1
        page.click(".modal [aria-label=Close]")
        page.wait_for_function("() => !document.querySelector('.modal')")
        assert page.locator("[data-testid=seci-saved]").count() == 0, "nothing was saved"
        page.click("[data-testid=agent-open]")
        page.wait_for_selector("[data-testid=agent-panel]")
        assert "GPT-LIVE" in page.locator("[data-testid=agent-panel]").inner_text().upper()
        page.click("[aria-label='Close the agent']")
        page.wait_for_function("() => !document.querySelector('[data-testid=agent-panel]')")

        # Reset inputs: the confirm is accepted; the bid is the default again
        page.once("dialog", lambda d: d.accept())
        page.click("button:has-text('Reset inputs')")
        _step(page, "seci", "bid")
        assert page.locator("[data-testid=seci-bid-mw]").input_value() == "300"


def test_what_if_tab():
    with _tour() as page:
        _view_as(page, "Tender manager")
        _close_inbox(page)
        _tab(page, "What-if analysis")
        page.wait_for_selector("[data-testid=whatif-verdict]")
        returns = page.locator("[data-testid=whatif-returns]")
        assert "EQUITY IRR" in returns.inner_text().upper() and "LENDER'S IRR" in returns.inner_text().upper()
        assert page.locator("[data-testid=whatif-checks] tr").count() >= 4
        page.click("[data-testid=whatif-use-needed]")
        page.wait_for_timeout(500)
        assert "meets the target" in page.locator("[data-testid=whatif-verdict]").inner_text().lower()
        page.click("[data-testid=lever-compute]")
        page.wait_for_selector("[data-testid=lever-table]", timeout=120_000)
        rows = page.locator("[data-testid=lever-table] tbody tr").count()
        assert rows >= 8 and page.locator("[data-testid=lever-debt]").count() == 1
        _shot(page, "whatif-levers")
        returns.locator("[data-trace=projectIrr]").click()
        page.wait_for_selector("[data-testid=trace-explorer]")
        assert page.locator("[data-testid=trace-name]").inner_text() == "Project IRR"
        page.keyboard.press("Escape")
        page.wait_for_function("() => !document.querySelector('[data-testid=trace-explorer]')")
        page.click("[data-testid=trace-open]")
        page.wait_for_selector("[data-testid=trace-explorer]")
        page.keyboard.press("Escape")
        assert page.locator("[data-testid=whatif-years] tbody tr").count() >= 10
        box = _field(page, "Contracted capacity (bid)").locator("input")
        _evidence_and_ping(page, box)
        page.click("[data-testid=whatif-reset]")
        page.wait_for_timeout(300)
        assert page.locator("[data-testid=whatif-verdict]").count() == 1
        assert "recompute" in page.locator("[data-testid=lever-compute]").inner_text().lower() or page.locator(".lever-stale").count() == 1


def test_round_the_clock_chapters():
    with _tour() as page:
        _tab(page, "Round the Clock")
        page.wait_for_selector("[data-testid=rtc-finance-stats]", timeout=120_000)
        for title in RTC_CHAPTERS:
            page.click(f"nav.story-rail button:has-text('{title}')")
            page.wait_for_timeout(250)
            assert title in page.locator(".story-page h2").first.inner_text(), title
        assert page.locator("[data-testid=loss-chain-bess], [data-testid^=loss-chain-]").count() >= 1
        page.click("[data-testid=rtc-sites-split]")
        result = page.wait_for_selector("[data-testid=rtc-sites-result]", timeout=30_000)
        assert "charges from solar only" in result.inner_text() and "charges from wind only" in result.inner_text()
        page.click("[data-testid=rtc-sites-one]")
        page.wait_for_function("() => !document.querySelector('[data-testid=rtc-sites-result]')")
        _shot(page, "rtc-battery")
        stats = page.locator("[data-testid=rtc-finance-stats]")
        stats.scroll_into_view_if_needed()
        assert re.search(r"equity irr\s*[\d.]+%", stats.inner_text(), re.I), stats.inner_text()
        repay = _field(page, "Repayment").locator("select")
        repay.select_option("sculpted")
        page.wait_for_timeout(300)
        assert "target dscr" in page.locator("main").inner_text().lower()
        repay.select_option("equal")
        months = _field(page, "Construction").locator("input")
        assert months.input_value() == "0" and page.locator(".rtc-construction").count() == 0
        months.fill("18")
        page.wait_for_selector(".rtc-construction", timeout=30_000)
        view = page.locator(".rtc-construction")
        assert "18 months" in view.inner_text().lower() and "interest during construction" in view.inner_text().lower()
        _shot(page, "rtc-construction")
        months.fill("0")
        page.wait_for_function("() => !document.querySelector('.rtc-construction')", timeout=30_000)
        stats.locator("[data-trace=equityIrr]").click()
        page.wait_for_selector("[data-testid=trace-explorer]")
        assert page.locator("[data-testid=trace-name]").inner_text() == "Equity IRR"
        page.keyboard.press("Escape")
        assert page.locator("[data-testid=rtc-download]").count() == 1


def test_bess_cfd_recent_team():
    with _tour() as page:
        _tab(page, "BESS Tender")
        page.wait_for_selector("nav.story-rail")
        for title in BESS_CHAPTERS:
            page.click(f"nav.story-rail button:has-text('{title}')")
            page.wait_for_timeout(200)
            assert title in page.locator(".story-page h2").first.inner_text(), title
        assert page.locator("button:has-text('Optimize the bid')").count() == 1, "offered, not clicked"
        _shot(page, "bess")

        _tab(page, "CfD Bid")
        page.wait_for_selector("[data-testid=cfd-step-model]")
        for step in CFD_STEPS:
            _step(page, "cfd", step)
        _step(page, "cfd", "example")
        page.click("[data-testid=cfd-example-mw-100]")
        assert "active" in page.locator("[data-testid=cfd-example-mw-100]").get_attribute("class")
        assert page.locator("[data-testid=cfd-answer]").count() == 1
        _step(page, "cfd", "terms")
        assert page.locator("[data-testid^=cfd-term-]").count() >= 10
        _step(page, "cfd", "plant")
        page.click("[data-testid=cfd-fill]")
        assert page.locator("[data-testid=cfd-missing]").count() == 0
        assert page.locator("[data-testid=cfd-optimise]").is_enabled(), "offered, not clicked"
        _step(page, "cfd", "finance")
        page.wait_for_selector("[data-testid=cfd-finance]", timeout=60_000)
        assert "₹" in page.locator("[data-testid=cfd-finance]").inner_text()
        _shot(page, "cfd-finance")

        _tab(page, "Recent tenders")
        page.wait_for_selector("[data-testid=seci-results]")
        assert page.locator("[data-testid^=seci-result-]").count() >= 8
        assert "K.P. Energy Limited" in page.locator("[data-testid=seci-result-seci-wind-xix]").inner_text()
        assert page.locator("[data-testid=cerc-file]").count() == 1
        page.locator("[data-testid^=seci-result-] details summary").first.click()

        page.click("[data-testid=nav-team-setup]")
        page.wait_for_selector("[data-testid=team-setup]")
        assert page.locator("[data-testid^=setup-member-]").count() >= 5
        assert page.locator("[data-testid=team-actas] select option").count() >= 5
        for tid in ("cover-tenderBid", "cover-seciRtc", "cover-whatIf"):
            assert "@" in page.locator(f"[data-testid={tid}]").inner_text(), tid
        _shot(page, "team-setup")
        page.click("[data-testid=nav-messages]")
        inbox = page.wait_for_selector("[data-testid=team-inbox]")
        assert "unread" in inbox.inner_text()
        page.click("[data-testid=team-inbox] button:has-text('All')")
        page.click("[data-testid=team-inbox] [title=Close]")
        page.wait_for_function("() => !document.querySelector('[data-testid=team-inbox]')")
