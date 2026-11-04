"""Administration › API keys (web/app/admin/api-keys, /api/settings/api-keys): a key is typed once,
stored encrypted and shown masked; it can be replaced and removed; a malformed key is refused.

Run with a stack in demo mode (the demo's super admin seat manages the keys):
  TENDEROS_URL=http://127.0.0.1:3000 TENDEROS_DEMO=1 pytest -m slow tests/e2e/test_api_keys.py
"""
from __future__ import annotations

import pytest

from tests.e2e.test_tender_to_bid import DEMO, URL, _session

pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(not (URL and DEMO), reason="set TENDEROS_URL and TENDEROS_DEMO=1"),
]

NAME = "LLAMA_CLOUD_API_KEY"  # the one key with no provider check, so the test needs no network


def _row(page, name=NAME):
    return page.locator(f"[data-testid=api-key-{name}]")


def _status(page, name=NAME):
    return page.locator(f"[data-testid=api-key-status-{name}]").text_content().strip()


def test_add_hide_replace_remove():
    with _session() as page:
        # reachable from the sidebar (the demo's super admin seat)
        page.wait_for_selector("[data-testid=nav-api-keys]", timeout=30_000)
        page.click("[data-testid=nav-api-keys]")
        page.wait_for_selector("[data-testid=api-keys]", timeout=30_000)
        assert page.locator("[data-testid^=api-key-status-]").count() == 3, "Anthropic, OpenAI, LlamaParse"
        # a clean start: remove a key left by an earlier run
        if _row(page).get_attribute("data-source") == "app":
            page.once("dialog", lambda d: d.accept())
            page.click(f"[data-testid=api-key-remove-{NAME}]")
            page.wait_for_function(f"() => document.querySelector('[data-testid=api-key-{NAME}]').dataset.source !== 'app'")
        before = _row(page).get_attribute("data-source")

        # a malformed key is refused and nothing is stored
        page.click(f"[data-testid=api-key-edit-{NAME}]")
        page.fill("[data-testid=api-key-value]", "llx-short")
        page.click("[data-testid=api-key-save]")
        page.wait_for_selector("[data-testid=api-keys-error]")
        assert "16 to 400" in page.locator("[data-testid=api-keys-error]").text_content()
        assert _row(page).get_attribute("data-source") == before

        # the key is typed hidden, saved, and only its last four characters come back
        secret = "llx-e2eTestKeyAbcdefghijklmnop9876"
        assert page.locator("[data-testid=api-key-value]").get_attribute("type") == "password", "typed hidden"
        page.fill("[data-testid=api-key-value]", secret)
        page.click("[data-testid=api-key-save]")
        page.wait_for_selector("[data-testid=api-keys-msg]")
        assert "saved and hidden" in page.locator("[data-testid=api-keys-msg]").text_content()
        assert _status(page) == "Set" and _row(page).get_attribute("data-source") == "app"
        row_text = _row(page).text_content()
        assert "…9876" in row_text and "Set in the application" in row_text and secret not in row_text
        assert page.locator("[data-testid=api-key-value]").count() == 0, "the input closes"
        assert page.locator("[data-testid=api-key-value]").count() == 0 and secret not in page.content(), "never in the page"
        # nor in the API
        listed = page.evaluate("async () => (await fetch('/api/settings/api-keys', {credentials: 'same-origin'})).json()")
        row = next(k for k in listed["keys"] if k["name"] == NAME)
        assert row["set"] and row["source"] == "app" and row["hint"] == "…9876" and secret not in str(listed)

        # the stored key survives a reload and can be replaced (the wrong prefix is refused)
        page.reload()
        page.wait_for_selector("[data-testid=api-keys]")
        assert _status(page) == "Set"
        page.click(f"[data-testid=api-key-edit-{NAME}]")
        page.fill("[data-testid=api-key-value]", "sk-not-a-llama-key-abcdefghij")
        page.click("[data-testid=api-key-save]")
        page.wait_for_selector("[data-testid=api-keys-error]")
        assert "starts with llx-" in page.locator("[data-testid=api-keys-error]").text_content()
        page.fill("[data-testid=api-key-value]", "llx-e2eReplacementKeyAbcdefghijk5555")
        page.click("[data-testid=api-key-save]")
        page.wait_for_selector("[data-testid=api-keys-msg]")
        assert "…5555" in _row(page).text_content()

        # removed: the environment (if any) applies again
        page.once("dialog", lambda d: d.accept())
        page.click(f"[data-testid=api-key-remove-{NAME}]")
        page.wait_for_function(f"() => document.querySelector('[data-testid=api-key-{NAME}]').dataset.source !== 'app'")
        assert _row(page).get_attribute("data-source") == before
        assert "…5555" not in _row(page).text_content()


def test_provider_checked_key_is_refused_or_saved_with_a_warning():
    """An OpenAI-shaped key that OpenAI does not know: refused (HTTP 401) when OpenAI is reachable,
    else saved with a warning that it could not be checked. Either way the page says which."""
    with _session() as page:
        page.goto(URL + "/admin/api-keys")
        page.wait_for_selector("[data-testid=api-keys]", timeout=30_000)
        name = "OPENAI_API_KEY"
        if _row(page, name).get_attribute("data-source") == "app":
            page.once("dialog", lambda d: d.accept())
            page.click(f"[data-testid=api-key-remove-{name}]")
            page.wait_for_function(f"() => document.querySelector('[data-testid=api-key-{name}]').dataset.source !== 'app'")
        page.click(f"[data-testid=api-key-edit-{name}]")
        page.fill("[data-testid=api-key-value]", "sk-proj-e2eNotARealKey0123456789abcdef")
        page.click("[data-testid=api-key-save]")
        page.wait_for_selector("[data-testid=api-keys-error], [data-testid=api-keys-msg]", timeout=30_000)
        if page.locator("[data-testid=api-keys-error]").count():
            assert "refused the key" in page.locator("[data-testid=api-keys-error]").text_content()
            assert _row(page, name).get_attribute("data-source") != "app"
        else:
            msg = page.locator("[data-testid=api-keys-msg]").text_content()
            assert "could not be reached" in msg or "answered HTTP" in msg, msg
            page.once("dialog", lambda d: d.accept())
            page.click(f"[data-testid=api-key-remove-{name}]")
            page.wait_for_function(f"() => document.querySelector('[data-testid=api-key-{name}]').dataset.source !== 'app'")
