"""The MCP server for Claude connectors (web/lib/mcp.js, docs/MCP.md) on a running stack:
TENDEROS_URL and MCP_TOKEN (the server's). The handshake, the tool list, a tender lookup with a
link to the PDF page, a What-if check, a wrong token (404) and GET (405)."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import pytest

URL = os.environ.get("TENDEROS_URL", "").rstrip("/")
TOKEN = os.environ.get("MCP_TOKEN", "")
pytestmark = [pytest.mark.slow, pytest.mark.skipif(not (URL and TOKEN), reason="set TENDEROS_URL and MCP_TOKEN")]


def _post(body: dict, session: str | None = None, token: str = TOKEN):
    headers = {"content-type": "application/json", "accept": "application/json, text/event-stream"}
    if session:
        headers["mcp-session-id"] = session
    req = urllib.request.Request(f"{URL}/api/mcp/{token}", data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.status, res.headers.get("mcp-session-id"), (json.loads(res.read()) if res.status == 200 else None)


def _tool(session: str, name: str, args: dict) -> dict:
    _, _, body = _post({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": name, "arguments": args}}, session)
    return json.loads(body["result"]["content"][0]["text"])


def test_mcp_server():
    status, session, body = _post({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                   "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "e2e", "version": "1"}}})
    assert status == 200 and session and body["result"]["serverInfo"]["name"] == "tenderos"
    assert _post({"jsonrpc": "2.0", "method": "notifications/initialized"}, session)[0] == 202
    _, _, tools = _post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, session)
    names = {t["name"] for t in tools["result"]["tools"]}
    assert {"tender_lookup", "run_optimizer", "get_financials", "check_bid", "winning_bid"} <= names
    hit = _tool(session, "tender_lookup", {"query": "solar hours excess"})
    assert "Amendment-03.pdf#page=" in json.dumps(hit)
    what = _tool(session, "check_bid", {"contracted_mw": 300, "tariff": 7})
    assert what["ok"] and what["tariffForTargetIrr"] > 5
    with pytest.raises(urllib.error.HTTPError) as wrong:
        _post({"jsonrpc": "2.0", "id": 1, "method": "ping"}, token="not-the-token-000000")
    assert wrong.value.code == 404
    with pytest.raises(urllib.error.HTTPError) as get:
        urllib.request.urlopen(f"{URL}/api/mcp/{TOKEN}", timeout=30)
    assert get.value.code == 405
