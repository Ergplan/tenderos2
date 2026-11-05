"""The RfS fields with the amendments applied, and their history.

The RfS is read as before (read_tender). Each field it found sits in a clause of the RfS:
the clause index below gives the clause number at any point of the text ("8.1" then "a."
-> 8.1.a). An amendment change touches a field when

  - its existing text contains the field's quote (the amendment quotes the RfS), or
  - it amends the field's clause, or a clause the field's clause sits in.

The field is then read again from the amended text, by the same rules (or by the model, in
model mode, with prompt amended_fields/v1), and its quote located in the amendment. The new
value replaces the old one, the old one goes into the field's history, and the field says
which amendment last changed it. A clause the amendment deletes withdraws the field. When
the amended text gives no value, the field is marked needs_review with the change attached:
the old value is shown as it was, never silently kept.

Changes apply in the order of the set (Amendment-01, then Amendment-02): a later amendment
of the same clause wins, and the history keeps both.
"""

from __future__ import annotations

import copy
import re
from bisect import bisect_right
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, cast

from pydantic import BaseModel, Field, create_model
from rapidfuzz import fuzz

from engine.extraction import rules_reader
from engine.extraction.extract import _PY_TYPES, Draft, Quote, _field_json, finalise
from engine.extraction.pages import CharBoxes
from engine.extraction.resolver import PageText, locate, normalise
from engine.extraction.schema import FieldSpec, TenderSchema
from engine.extraction.tenderset.changes import same_clause
from engine.extraction.values import JSON_KINDS

QUOTE_IN_EXISTING = 88.0
MIN_QUOTE_WORDS = 8  # a shorter quote (a name, a heading) is in too many clauses to say which one changed  # partial ratio of a field quote inside an amendment's existing text
# what the document is, not a term: an amendment quoting the RfS's name does not change it
NOT_AMENDED = ("core.summary.", "core.identity.")
AMENDED_PROMPT = "amended_fields"
AMENDED_VERSION = "v2"

_NUMBERED = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,2}){1,3})\.?(?:\s*$|\s+(?=\S))")
_SECTION = re.compile(r"^\s*(\d{1,2})\.?\s*$")  # a top-level clause number alone on its line
_LETTERED = re.compile(r"^\s*\(?([a-z])[.)]\s+\S")
_TOC = re.compile(r"table\s+of\s+contents|^\s*contents\s*$", re.I | re.M)


@dataclass(frozen=True)
class ClauseMark:
    page: int
    offset: int
    key: tuple[str, ...]
    label: str


class ClauseIndex:
    """The clause number in force at any (page, character offset) of a document."""

    def __init__(self, marks: list[ClauseMark]) -> None:
        self.marks = marks
        self._positions = [(mark.page, mark.offset) for mark in marks]

    def at(self, page: int, offset: int) -> ClauseMark | None:
        index = bisect_right(self._positions, (page, offset)) - 1
        return self.marks[index] if index >= 0 else None

    def of_label(self, key: tuple[str, ...]) -> list[ClauseMark]:
        return [mark for mark in self.marks if mark.key == key]


def _version(label: str) -> tuple[int, ...]:
    return tuple(int(part) for part in label.split("."))


def clause_index(pages: list[PageText]) -> ClauseIndex:
    """Numbered clauses ("9.2", alone on a line or before a capitalised heading) and their
    lettered items ("a."), in reading order. A number that would run backwards, or jump far
    ahead, is a table cell or a cross reference, not a heading; tables of contents are skipped."""
    marks: list[ClauseMark] = []
    current: tuple[int, ...] | None = None
    number_label = ""
    letter = ""
    for page in pages:
        if _TOC.search(page.text[:400]):
            continue
        offset = 0
        for line in page.text.splitlines(keepends=True):
            numbered = _NUMBERED.match(line) or (_SECTION.match(line) if current is not None else None)
            label = numbered.group(1) if numbered else ""
            version = _version(label) if label else ()
            if numbered and (current is None or (version > current and version[0] <= current[0] + 2)):
                current, number_label, letter = version, label, ""
                marks.append(ClauseMark(page.page_no, offset, tuple(label.split(".")), label))
            elif current is not None and not numbered:
                lettered = _LETTERED.match(line)
                # items run a., b., c. ...; (i), (v) and (x) out of turn are roman numerals
                if lettered and (lettered.group(1) == "a" or (letter and ord(lettered.group(1)) == ord(letter) + 1)):
                    letter = lettered.group(1)
                    key = (*number_label.split("."), letter)
                    marks.append(ClauseMark(page.page_no, offset, key, f"{number_label}.{letter}"))
            offset += len(line)
    return ClauseIndex(marks)


def _contains(quote: str, text: str) -> bool:
    if not quote or not text:
        return False
    q, _ = normalise(quote)
    t, _ = normalise(text)
    if len(q.split()) < MIN_QUOTE_WORDS:
        return False
    return q in t or fuzz.partial_ratio(q, t) >= QUOTE_IN_EXISTING


def _field_clause(field: dict[str, Any], pages: dict[int, PageText], index: ClauseIndex) -> ClauseMark | None:
    for evidence in field.get("evidence") or []:
        if not evidence.get("located"):
            continue
        page = pages.get(evidence["page"])
        found = locate(evidence["quote"], page) if page else None
        if found is not None:
            # the middle of the quote: a quote often starts at the end of the line before the item
            return index.at(found.page_no, (found.char_start + found.char_end) // 2)
    return None


def touches(field: dict[str, Any], change: dict[str, Any], mark: ClauseMark | None) -> str | None:
    """How a change touches a field: "quote" (its existing text holds the field's quote),
    "clause" (it amends the field's clause), or None."""
    if change["document"] != "RfS" or change["kind"] == "added":
        return None
    before = change["before"]["text"]
    if before and any(_contains(e.get("quote", ""), before) for e in field.get("evidence") or [] if e.get("located")):
        return "quote"
    if mark is not None:
        key = tuple(change["clause_key"])
        # the amended clause is the field's clause or holds it (8.1 holds 8.1.a); a field in
        # a parent clause (8.1) is touched only by an amendment of that very clause
        if len(key) <= len(mark.key) and same_clause(key, mark.key) and len(key) >= min(2, len(mark.key)):
            return "clause"
    return None


def _synthetic(text: str) -> list[PageText]:
    return [PageText(1, text, CharBoxes.empty(len(text)))]


def reread_rules(schema: TenderSchema, path: str, change: dict[str, Any], amendment_pages: list[PageText]) -> dict[str, Any] | None:
    """The field read again from the change's amended text by the rules reader, its quote
    located in the amendment; None when the amended text gives no value."""
    text = change["after"]["text"]
    if not text or path not in rules_reader.RULE_PATHS:
        return None
    draft = rules_reader.read(_synthetic(text), [path]).get(path)
    if draft is None:
        return None
    window = change["pages"] or [1]
    quotes = [Quote(window[0], quote, True) for _, quote in draft.quotes]
    return _finalised(schema, path, Draft(draft.value, draft.confidence, draft.rationale, quotes, window), amendment_pages)


def _finalised(schema: TenderSchema, path: str, draft: Draft, pages: list[PageText]) -> dict[str, Any]:
    fields, _ = finalise(schema, {path: draft}, pages)
    item = next(item for item in fields if item.spec.path == path)
    return _field_json(item)


# ----------------------------------------------------------------------------- model re-read


class AmendedEvidence(BaseModel):
    quote: str = Field(description="Verbatim words of the amended text that state the value (5 to 40 words)")


@lru_cache(maxsize=64)
def _amended_kind_model(kind: str) -> type[BaseModel]:
    """One field's answer, typed by the field's JSON kind like extract's `_kind_model`. A typed
    `value` matters: the SDK builds the structured-output schema from this model and rejects an
    untyped (`Any`) property, which made every re-read fail before it was sent."""
    make = cast(Any, create_model)
    return cast(
        type[BaseModel],
        make(
            f"Amended_{kind}",
            value=(_PY_TYPES.get(kind, str) | None, None),
            withdrawn=(bool, False),
            confidence=(float, 0.0),
            rationale=(str, ""),
            evidence=(list[AmendedEvidence], Field(default_factory=list)),
        ),
    )


def amended_output_model(specs: list[FieldSpec]) -> type[BaseModel]:
    """The structured-output model for one re-read: one required entry per field, keyed by the
    field's key (the last part of its path), each typed by the field's kind."""
    make = cast(Any, create_model)
    properties = {spec.key: (_amended_kind_model(JSON_KINDS.get(spec.type, "string")), ...) for spec in specs}
    return cast(type[BaseModel], make("AmendedFields", **properties))


def reread_model(
    client: Any,
    schema: TenderSchema,
    change: dict[str, Any],
    fields: list[dict[str, Any]],
    amendment_pages: list[PageText],
    usage: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """The fields touched by one change, read again from its amended text by the model."""
    specs = [schema.field(field["path"]) for field in fields]
    lines = []
    for spec, field in zip(specs, fields, strict=True):
        lines.append(
            f"- key: {spec.key}\n  path: {spec.path}\n  label: {spec.label}\n  type: {spec.type}{f' ({spec.unit})' if spec.unit else ''}\n"
            f"  help: {spec.help or ''}\n  value before the amendment: {field.get('display') or field.get('value')}"
        )
    text = (
        f"Document amended: {change['document']}, clause {change['clause']}\n\n"
        f"Existing text (as the amendment quotes it):\n{change['before']['text'] or '(not quoted)'}\n\n"
        f"Amended text:\n{change['after']['text']}\n\nFields (answer under each field's key):\n" + "\n".join(lines)
    )
    usage["calls"] += 1
    parsed, used = client.call(AMENDED_PROMPT, AMENDED_VERSION, [{"type": "text", "text": text}], amended_output_model(specs), 4096)
    usage["input_tokens"] += int(used.get("input_tokens", 0))
    usage["output_tokens"] += int(used.get("output_tokens", 0))
    window = change["pages"] or [1]
    out: dict[str, dict[str, Any]] = {}
    for spec in specs:
        answer = getattr(parsed, spec.key, None)
        if answer is None or (answer.value is None and not answer.withdrawn):
            continue
        quotes = [Quote(window[0], e.quote, True) for e in answer.evidence if e.quote.strip()]
        confidence = min(max(float(answer.confidence or 0.0), 0.0), 1.0)
        draft = Draft(None if answer.withdrawn else answer.value, confidence, answer.rationale, quotes, window, answer.withdrawn)
        out[spec.path] = _finalised(schema, spec.path, draft, amendment_pages)
    return out


# ----------------------------------------------------------------------------- consolidation


def _with_doc(evidence: list[dict[str, Any]], doc: str) -> list[dict[str, Any]]:
    return [{**item, "doc": doc} for item in evidence]


def _issue(rule: str, message: str, warning: bool = False) -> dict[str, Any]:
    return {"rule": rule, "message": message, "warning": warning}


def consolidate(
    schema: TenderSchema,
    rfs: dict[str, Any],
    rfs_pages: list[PageText],
    changes: list[dict[str, Any]],
    amendment_pages: dict[str, list[PageText]],
    client: Any | None = None,
    warnings: list[str] | None = None,
    usage: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """(the RfS result with the amendments applied, one entry per amended field).

    rfs: read_tender's result for the RfS. changes: every change of the set, in set order.
    amendment_pages: the pages of each amendment, by document id. client: an LLM client for
    the model re-read (None: rules only)."""
    notes = warnings if warnings is not None else []
    spent = usage if usage is not None else {"calls": 0, "input_tokens": 0, "output_tokens": 0}
    result = copy.deepcopy(rfs)
    by_no = {page.page_no: page for page in rfs_pages}
    index = clause_index(rfs_pages)
    fields = [field for section in result["sections"] for field in section["fields"]]
    found = [
        field
        for field in fields
        if field.get("value") is not None and field["status"] != "rejected" and not field["path"].startswith(NOT_AMENDED)
    ]
    marks = {field["path"]: _field_clause(field, by_no, index) for field in found}
    for field in fields:
        field["evidence"] = _with_doc(field.get("evidence") or [], "rfs")
        field["history"] = []
        field["changed_by"] = None
        mark = marks.get(field["path"])
        field["clause"] = mark.label if mark else None

    touched: list[tuple[dict[str, Any], list[tuple[dict[str, Any], str]]]] = []
    for change in changes:
        hits = [(field, how) for field in found if (how := touches(field, change, marks.get(field["path"])))]
        if hits:
            touched.append((change, hits))

    amended: list[dict[str, Any]] = []
    for change, hits in touched:
        pages = amendment_pages.get(change["doc"], [])
        model_reads: dict[str, dict[str, Any]] = {}
        if client is not None and change["kind"] != "deleted":
            try:
                model_reads = reread_model(client, schema, change, [field for field, _ in hits], pages, spent)
            except Exception as exc:  # noqa: BLE001 - the rules re-read still runs
                notes.append(f"{change['id']}: the model could not re-read the amended text ({type(exc).__name__}); rules were used.")
        for field, how in hits:
            before = {"value": field.get("value"), "display": field.get("display"), "evidence": field.get("evidence")}
            entry: dict[str, Any] = {
                "change": change["id"],
                "doc": change["doc"],
                "clause": change["clause"],
                "kind": change["kind"],
                "matched_by": how,
                "was": before,
            }
            if change["kind"] == "deleted":
                field.update(
                    value=None,
                    display="",
                    status="withdrawn",
                    withdrawn=True,
                    evidence=_with_doc(change["after"]["evidence"], change["doc"]),
                    changed_by=change["id"],
                )
                field["issues"] = [_issue("withdrawn", f"{change['doc']} deletes {change['document']} {change['clause']}", True)]
                entry["now"] = {"value": None, "display": "withdrawn", "evidence": field["evidence"]}
            else:
                reread = model_reads.get(field["path"]) or reread_rules(schema, field["path"], change, pages)
                if reread is not None and reread.get("value") is not None and reread["status"] != "rejected":
                    if isinstance(reread["value"], dict) and isinstance(field.get("value"), dict):
                        # a clause amends part of a structured value: the parts it does not state stay
                        reread["value"] = {**field["value"], **{k: v for k, v in reread["value"].items() if v is not None}}
                    same = reread["value"] == field.get("value")
                    field.update(
                        value=reread["value"],
                        display=reread["display"],
                        confidence=reread["confidence"],
                        status=reread["status"],
                        evidence=_with_doc(reread["evidence"], change["doc"]),
                        rationale=reread["rationale"],
                        issues=reread["issues"],
                        changed_by=change["id"],
                    )
                    entry["now"] = {"value": reread["value"], "display": reread["display"], "evidence": field["evidence"]}
                    entry["same_value"] = same
                else:
                    field["status"] = "needs_review"
                    field["changed_by"] = change["id"]
                    field.setdefault("issues", []).append(
                        _issue(
                            "amended",
                            f"{change['doc']} amends {change['document']} {change['clause']}; the new value could not be read "
                            "from the amended text: check it against the amendment.",
                        )
                    )
                    entry["now"] = None
            field["history"].append(entry)
            amended.append({"path": field["path"], "label": field.get("label"), **entry})

    # the values block follows the fields
    result["values"] = {
        field["path"]: field["value"]
        for field in fields
        if field.get("value") is not None and field["status"] in ("validated", "needs_review")
    }
    statuses = [field["status"] for field in fields]
    result["counts"].update(
        validated=statuses.count("validated"),
        needs_review=statuses.count("needs_review"),
        withdrawn=statuses.count("withdrawn"),
        amended=len({item["path"] for item in amended}),
    )
    return result, amended
