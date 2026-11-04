"""The only module that calls a model: versioned prompts in, typed answers out.

Ported from Ergplan/tender_engine `core/llm/client.py` and `core/llm/registry.py` (commit
5c29b4e), without the call log, batches and cache, which belong to tender_engine's database.
As in tender_engine, every extraction call goes to one Anthropic model, `claude-fable-5-1`
(tender_engine's locked decision: one model keeps extraction results comparable across
tenders). EXTRACTION_MODEL overrides it for an experiment; the model used is reported on
every reading.

Prompts are files <root>/<name>/<version>.md with a header between two '---' lines; a
prompt whose header says `extends: <name>/<version>` is the parent's text followed by its own.

A refusal (stop_reason "refusal") or a truncated answer is an error for that call: the
section is reported as not read, with the reason, and the run goes on. No server-side model
fallback is configured, so a reading is never silently produced by another model.
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from engine.extraction import keys

PACKAGE_ROOT = Path(__file__).resolve().parent
PROMPT_ROOTS: tuple[Path, ...] = (
    PACKAGE_ROOT / "prompts",
    PACKAGE_ROOT / "packs" / "core" / "prompts",
    PACKAGE_ROOT / "packs" / "power" / "prompts",
)
DEFAULT_MAX_TOKENS = 16000
DEFAULT_TIMEOUT_SECONDS = 300.0
MAX_RETRIES = 3
_NAME = re.compile(r"^[a-z0-9_]+(/[a-z0-9_]+)*$")
_VERSION = re.compile(r"^v[0-9]+$")
_model_lock = threading.Lock()
_default_client: "LLMClient | None" = None


class UnregisteredPromptError(LookupError):
    pass


class LLMError(RuntimeError):
    """The call did not produce a validated answer."""


@dataclass(frozen=True)
class Prompt:
    name: str
    version: str
    header: dict[str, str]
    text: str
    sha256: str


def _split(raw: str, path: Path) -> tuple[dict[str, str], str]:
    """Split the header block (between two '---' lines) from the prompt body."""
    parts = raw.split("---\n", 2)
    if len(parts) != 3 or parts[0].strip():
        raise UnregisteredPromptError(f"{path} has no header block")
    header: dict[str, str] = {}
    for line in parts[1].splitlines():
        key, sep, value = line.partition(":")
        if sep:
            header[key.strip()] = value.strip()
    required = {"purpose", "inputs", "output_schema", "known_failure_modes"}
    missing = required - header.keys()
    if missing:
        raise UnregisteredPromptError(f"{path} header is missing {sorted(missing)}")
    body = parts[2].strip()
    if not body:
        raise UnregisteredPromptError(f"{path} has an empty body")
    return header, body


def load_prompt(
    name: str,
    version: str,
    roots: tuple[Path, ...] = PROMPT_ROOTS,
    _seen: tuple[tuple[str, str], ...] = (),
) -> Prompt:
    """Load prompt <name>/<version>.md from the first root that has it, or refuse. The
    system text of a prompt that extends another is the parent's text, then its own."""
    if not _NAME.match(name) or not _VERSION.match(version):
        raise UnregisteredPromptError(f"invalid prompt reference {name!r} {version!r}")
    if (name, version) in _seen:
        raise UnregisteredPromptError(f"prompt {name}/{version} extends itself")
    for root in roots:
        path = root / name / f"{version}.md"
        if path.is_file():
            raw = path.read_text(encoding="utf-8")
            header, text = _split(raw, path)
            digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
            if "extends" in header:
                parent_name, _, parent_version = header["extends"].rpartition("/")
                parent = load_prompt(parent_name, parent_version, roots, (*_seen, (name, version)))
                text = f"{parent.text}\n\n{text}"
                digest = hashlib.sha256(f"{parent.sha256}{digest}".encode()).hexdigest()
            return Prompt(name=name, version=version, header=header, text=text, sha256=digest)
    raise UnregisteredPromptError(f"prompt {name}/{version} is not registered")


DEFAULT_MODEL = "claude-fable-5-1"
KEY_ENV = "ANTHROPIC_API_KEY"
_default_client: "LLMClient | None" = None
_client_lock = threading.Lock()


def provider() -> str:
    """Always "anthropic" when a key is set, else ""."""
    return "anthropic" if api_key() else ""


def api_key() -> str:
    """The key the web app handed over (Administration › API keys), else ANTHROPIC_API_KEY."""
    return keys.api_key(KEY_ENV)


def model_id() -> str:
    """EXTRACTION_MODEL, else the model tender_engine extracts with."""
    return (os.environ.get("EXTRACTION_MODEL") or DEFAULT_MODEL).strip()


def llm_available() -> bool:
    """A key is configured and the Anthropic SDK can be imported."""
    if not api_key():
        return False
    try:
        import anthropic  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


def timeout_seconds() -> float:
    try:
        return float(os.environ.get("EXTRACTION_TIMEOUT_SECONDS") or DEFAULT_TIMEOUT_SECONDS)
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS


def _usage(message: Any) -> dict[str, int]:
    usage = getattr(message, "usage", None)
    if usage is None:
        return {"input_tokens": 0, "output_tokens": 0}
    tokens_in = int(getattr(usage, "input_tokens", 0) or 0)
    tokens_in += int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
    tokens_in += int(getattr(usage, "cache_read_input_tokens", 0) or 0)
    return {"input_tokens": tokens_in, "output_tokens": int(getattr(usage, "output_tokens", 0) or 0)}


def _check_stop(message: Any) -> None:
    stop = getattr(message, "stop_reason", None)
    if stop == "refusal":
        details = getattr(message, "stop_details", None)
        reason = f"{getattr(details, 'category', '')}: {getattr(details, 'explanation', '')}" if details else "no details"
        raise LLMError(f"the model declined the request ({reason})")
    if stop == "max_tokens":
        raise LLMError("the answer hit the output token limit")


class LLMClient:
    """One Anthropic client and one model (or an injected SDK object, for tests)."""

    provider = "anthropic"

    def __init__(self, sdk: Any | None = None) -> None:
        self.key = ""
        if sdk is None:
            key = api_key()
            if not key:
                raise LLMError(f"{KEY_ENV} is not set")
            import anthropic

            sdk = anthropic.Anthropic(api_key=key, max_retries=MAX_RETRIES, timeout=timeout_seconds())
            self.key = key
        self._sdk = sdk

    @property
    def model(self) -> str:
        return model_id()

    def call(
        self,
        prompt_name: str,
        version: str,
        content_blocks: list[dict[str, Any]],
        response_model: type[BaseModel],
        max_tokens: int = DEFAULT_MAX_TOKENS,
    ) -> tuple[BaseModel, dict[str, int]]:
        """One model call: the registered prompt as system text, the content blocks (PDF
        pages, then the field list) as the user turn, the answer parsed into
        response_model. Returns (parsed, usage)."""
        prompt = load_prompt(prompt_name, version)
        try:
            message = self._sdk.messages.parse(
                model=self.model,
                max_tokens=max_tokens,
                system=prompt.text,
                messages=[{"role": "user", "content": content_blocks}],
                output_format=response_model,
            )
        except ValidationError as exc:
            raise LLMError(f"the answer did not match the schema: {exc.errors()[:3]}") from exc
        _check_stop(message)
        parsed = getattr(message, "parsed_output", None)
        if parsed is None:
            raise LLMError("the answer did not match the schema")
        if not isinstance(parsed, response_model):
            parsed = response_model.model_validate(parsed)
        return parsed, _usage(message)


def default_client() -> LLMClient:
    """The process-wide client, rebuilt when the key in use changes (a key entered or replaced in
    the application)."""
    global _default_client
    with _client_lock:
        if _default_client is None or _default_client.key != api_key():
            _default_client = LLMClient()
        return _default_client


def call(
    prompt_name: str,
    version: str,
    content_blocks: list[dict[str, Any]],
    response_model: type[BaseModel],
    max_tokens: int = DEFAULT_MAX_TOKENS,
    sdk: Any | None = None,
) -> tuple[BaseModel, dict[str, int]]:
    """Module-level form of LLMClient.call; `sdk` injects an SDK object (tests)."""
    client = LLMClient(sdk) if sdk is not None else default_client()
    return client.call(prompt_name, version, content_blocks, response_model, max_tokens)
