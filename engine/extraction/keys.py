"""Provider keys handed to the engine by the web app.

The web app is the engine's only client. Keys an administrator enters in the application
(Administration › API keys) are stored encrypted on the web side and sent on every proxied call
as headers; the engine keeps the latest it was given, process-wide, so the background threads that
read a tender (engine/extraction/jobs.py) use them too. Every such call carries a marker header
(x-tenderos-keys); a marked call without a key clears the override and the engine's own
environment variable applies again, so removing a key in the application takes effect at once.
Unmarked calls (the health probe, tests) change nothing.

    api_key("ANTHROPIC_API_KEY")  ->  the handed-over key, else os.environ, else ""
"""

from __future__ import annotations

import os
import threading
from collections.abc import Mapping

# header name (lower case) -> environment variable it stands in for
HEADERS = {
    "x-tenderos-key-anthropic": "ANTHROPIC_API_KEY",
    "x-tenderos-key-llama": "LLAMA_CLOUD_API_KEY",
}
_runtime: dict[str, str] = {}
_lock = threading.Lock()


def api_key(name: str) -> str:
    """The key to use for the environment variable `name`."""
    with _lock:
        override = _runtime.get(name, "")
    return override or (os.environ.get(name) or "").strip()


def source(name: str) -> str | None:
    """Where the key in use comes from: "app" (handed over by the web app), "env", or None."""
    with _lock:
        if _runtime.get(name):
            return "app"
    return "env" if (os.environ.get(name) or "").strip() else None


MARKER = "x-tenderos-keys"


def take_from_headers(headers: Mapping[str, str]) -> None:
    """On a call from the web app (it carries the marker header): keep the keys the call carries
    and forget those it does not. A call without the marker (a health probe, a test client)
    leaves the keys as they are."""
    if not (headers.get(MARKER) or "").strip():
        return
    with _lock:
        for header, name in HEADERS.items():
            value = (headers.get(header) or "").strip()
            if value:
                _runtime[name] = value
            else:
                _runtime.pop(name, None)


def clear() -> None:
    with _lock:
        _runtime.clear()
