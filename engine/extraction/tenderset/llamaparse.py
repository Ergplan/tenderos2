"""Text for scanned pages with LlamaParse (LlamaIndex cloud), when LLAMA_CLOUD_API_KEY is set.

A PDF page without a text layer has nothing for the resolver to find a quote in. When a
document of the set has such pages and a key is set, the file is sent to LlamaParse and
the text it returns for those pages takes their place (without character boxes, so the
evidence is located on the page but cannot be highlighted). Without a key the pages stay
as they are and the set says so in its warnings.

API (v1): POST {base}/api/v1/parsing/upload (multipart `file`) -> {id}; GET
{base}/api/v1/parsing/job/{id} -> {status: PENDING|SUCCESS|ERROR}; GET
{base}/api/v1/parsing/job/{id}/result/json -> {pages: [{page, text, md}]}.
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx

from engine.extraction import keys
from engine.extraction.pages import CharBoxes
from engine.extraction.resolver import PageText

DEFAULT_BASE = "https://api.cloud.llamaindex.ai"


class LlamaParseError(RuntimeError):
    """LlamaParse could not read the file."""


def api_key() -> str:
    """The key the web app handed over (Administration › API keys), else LLAMA_CLOUD_API_KEY."""
    return keys.api_key("LLAMA_CLOUD_API_KEY")


def llamaparse_available() -> bool:
    return bool(api_key())


def _base() -> str:
    return (os.environ.get("LLAMA_CLOUD_BASE_URL") or DEFAULT_BASE).rstrip("/")


def _timeout() -> float:
    try:
        return max(30.0, float(os.environ.get("LLAMAPARSE_TIMEOUT_SECONDS") or 600))
    except ValueError:
        return 600.0


def parse_pages(name: str, payload: bytes, client: httpx.Client | None = None, poll_seconds: float = 2.0) -> dict[int, str]:
    """{page number: text} for every page LlamaParse read. Raises LlamaParseError."""
    key = api_key()
    if not key:
        raise LlamaParseError("LLAMA_CLOUD_API_KEY is not set")
    own = client is None
    http = client or httpx.Client(timeout=_timeout())
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    base = _base()
    try:
        res = http.post(f"{base}/api/v1/parsing/upload", headers=headers, files={"file": (name, payload, "application/pdf")})
        if res.status_code >= 400:
            raise LlamaParseError(f"LlamaParse answered {res.status_code}: {res.text[:200]}")
        job = res.json().get("id")
        if not job:
            raise LlamaParseError("LlamaParse gave no job id")
        deadline = time.monotonic() + _timeout()
        while True:
            status = str(http.get(f"{base}/api/v1/parsing/job/{job}", headers=headers).json().get("status") or "").upper()
            if status == "SUCCESS":
                break
            if status in ("ERROR", "CANCELED", "CANCELLED"):
                raise LlamaParseError(f"LlamaParse job {status.lower()}")
            if time.monotonic() > deadline:
                raise LlamaParseError("LlamaParse took too long")
            time.sleep(poll_seconds)
        answer: dict[str, Any] = http.get(f"{base}/api/v1/parsing/job/{job}/result/json", headers=headers).json()
    except httpx.HTTPError as exc:
        raise LlamaParseError(f"LlamaParse unreachable: {exc}") from exc
    finally:
        if own:
            http.close()
    out: dict[int, str] = {}
    for item in answer.get("pages") or []:
        number = int(item.get("page") or 0)
        text = item.get("text") or item.get("md") or ""
        if number > 0 and text.strip():
            out[number] = text
    return out


def fill_scanned(name: str, payload: bytes, pages: list[PageText], client: httpx.Client | None = None) -> tuple[list[PageText], list[int]]:
    """The pages with LlamaParse's text in place of each page that has no text layer, and
    the page numbers filled. Pages with a text layer are never replaced."""
    scanned = [page.page_no for page in pages if not page.has_text_layer]
    if not scanned:
        return pages, []
    texts = parse_pages(name, payload, client)
    filled: list[int] = []
    out: list[PageText] = []
    for page in pages:
        text = texts.get(page.page_no)
        if not page.has_text_layer and text:
            out.append(PageText(page.page_no, text, CharBoxes.empty(len(text)), True))
            filled.append(page.page_no)
        else:
            out.append(page)
    return out, filled
