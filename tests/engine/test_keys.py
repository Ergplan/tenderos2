"""Provider keys handed to the engine by the web app (engine/extraction/keys.py): a header on the
call overrides the environment, process-wide; a call without it clears the override."""

from __future__ import annotations

from fastapi.testclient import TestClient

from engine.app import app
from engine.extraction import keys, llm
from engine.extraction.tenderset import llamaparse


def test_header_overrides_environment_and_absence_restores_it(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-env")
    monkeypatch.delenv("LLAMA_CLOUD_API_KEY", raising=False)
    keys.clear()
    assert keys.api_key("ANTHROPIC_API_KEY") == "sk-ant-env" and keys.source("ANTHROPIC_API_KEY") == "env"
    assert llm.api_key() == "sk-ant-env" and llamaparse.api_key() == "" and not llamaparse.llamaparse_available()

    keys.take_from_headers({"x-tenderos-keys": "web", "x-tenderos-key-anthropic": " sk-ant-app ", "x-tenderos-key-llama": "llx-app"})
    assert llm.api_key() == "sk-ant-app" and keys.source("ANTHROPIC_API_KEY") == "app"
    assert llamaparse.api_key() == "llx-app" and llamaparse.llamaparse_available()

    keys.take_from_headers({})  # unmarked: nothing changes
    assert llm.api_key() == "sk-ant-app" and llamaparse.api_key() == "llx-app"
    keys.take_from_headers({"x-tenderos-keys": "web"})
    assert llm.api_key() == "sk-ant-env" and llamaparse.api_key() == "" and keys.source("LLAMA_CLOUD_API_KEY") is None
    keys.clear()


def test_every_engine_call_carries_the_keys(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    keys.clear()
    client = TestClient(app)
    status = client.get("/api/health").json()["tender_reading"]
    assert status["key_source"] is None

    with_key = client.get("/api/health", headers={"x-tenderos-keys": "web", "x-tenderos-key-anthropic": "sk-ant-app"}).json()[
        "tender_reading"
    ]
    assert with_key["key_source"] == "app"
    # the key stays for the background work until the next call says otherwise
    assert llm.api_key() == "sk-ant-app"

    # an unmarked probe (the web app's /api/health, a monitor) leaves the key in place
    assert client.get("/api/health").json()["tender_reading"]["key_source"] == "app"
    assert client.get("/api/health", headers={"x-tenderos-keys": "web"}).json()["tender_reading"]["key_source"] is None
    assert llm.api_key() == ""


def test_default_client_follows_the_key_in_use(monkeypatch):
    built: list[str] = []

    class FakeAnthropic:
        def __init__(self, api_key, **_):
            built.append(api_key)

    import sys
    import types

    monkeypatch.setitem(sys.modules, "anthropic", types.SimpleNamespace(Anthropic=FakeAnthropic))
    monkeypatch.setattr(llm, "_default_client", None)
    keys.clear()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-one")
    first = llm.default_client()
    assert llm.default_client() is first and built == ["sk-ant-one"]
    keys.take_from_headers({"x-tenderos-keys": "web", "x-tenderos-key-anthropic": "sk-ant-two"})
    second = llm.default_client()
    assert second is not first and built == ["sk-ant-one", "sk-ant-two"] and second.key == "sk-ant-two"
    keys.clear()
    monkeypatch.setattr(llm, "_default_client", None)
