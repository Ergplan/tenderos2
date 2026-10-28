"""The tender-set pipeline on the SECI RTC-TM-V set (RfS, two amendments, clarifications, PSA),
scored against the hand-checked pack (web/src/seci/seci-rtc-tm-v.json): the changes of both
amendments, the clarifications, the 20 bid formats and the bid-process sources.

The Docling outputs are recorded from docling-serve (tests/engine/fixtures/docling, trimmed
to the tables), so the tests need no Docling service; the PyMuPDF table finder is tested on
the same files as the fallback. The HTTP clients (docling-serve, LlamaParse) run against
httpx mock transports; the model paths against a fake SDK.
"""

from __future__ import annotations

import base64
import gzip
import json
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from engine.extraction.extract import read_tender
from engine.extraction.pages import read_pages
from engine.extraction.schema import compile_type
from engine.extraction.tenderset import search as set_search
from engine.extraction.tenderset.changes import clause_key, clause_label, read_changes, same_clause, word_diff
from engine.extraction.tenderset.clarifications import link, read_clarifications, verdict
from engine.extraction.tenderset.consolidate import clause_index, consolidate
from engine.extraction.tenderset.docling import DoclingError, convert
from engine.extraction.tenderset.documents import describe, order, short_ids
from engine.extraction.tenderset.formats import read_formats
from engine.extraction.tenderset.layout import read_layout, tables_from_docling, tables_from_pymupdf
from engine.extraction.tenderset.llamaparse import fill_scanned
from engine.extraction.tenderset.process import read_process
from engine.extraction.tenderset.read_set import read_set

ROOT = Path(__file__).resolve().parents[2]
SET = ROOT / "web/public/tenders/seci-rtc-tm-v"
FIXTURES = Path(__file__).resolve().parent / "fixtures/docling"
PACK = json.loads((ROOT / "web/src/seci/seci-rtc-tm-v.json").read_text())
FILES = {"rfs": "RfS.pdf", "amd1": "Amendment-01.pdf", "amd2": "Amendment-02.pdf", "clar1": "Clarifications-01.pdf", "psa": "Standard-PSA.pdf"}


def _bytes(doc: str) -> bytes:
    return (SET / FILES[doc]).read_bytes()


def _pages(doc: str):
    return read_pages(FILES[doc], _bytes(doc))


def _docling(doc: str) -> dict:
    with gzip.open(FIXTURES / f"{doc}.json.gz", "rt", encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture(scope="module")
def changes() -> list[dict]:
    out = []
    for doc in ("amd1", "amd2"):
        out += read_changes(doc, tables_from_docling(_docling(doc)), _pages(doc))
    return out


# the amendments whose schedules these tests parse (the pack's Amendment-03 changes are checked
# against their pages by tests/test_seci_pack.py)
PARSED = ("amd1", "amd2")


@pytest.fixture(scope="module")
def rfs_pages():
    return _pages("rfs")


# ----------------------------------------------------------------------------- documents


def test_documents_roles_numbers_and_order():
    docs = [describe("x", FILES[doc], _pages(doc)) for doc in ("psa", "clar1", "amd2", "rfs", "amd1")]
    docs = order(docs)
    short_ids(docs)
    got = [(d.id, d.role, d.kind, d.number, d.date) for d in docs]
    assert got == [
        ("rfs", "rfs", "rfs", None, "2026-03-10"),
        ("amd1", "amendment", "amendment", 1, "2026-04-02"),
        ("amd2", "amendment", "amendment", 2, "2026-04-27"),
        ("clar1", "clarification", "clarification", 1, "2026-04-27"),
        ("psa", "agreement", "psa", None, docs[4].date),
    ]
    assert docs[0].rfs_no == "SECI/C&P/IPP/13/0020/25-26" and docs[1].ref == "SECI/C&P/IPP/13/0020/25-26/Amendment-01"
    assert [d.title for d in docs[:4]] == ["RfS", "Amendment-01", "Amendment-02", "Clarifications-01"]


# ----------------------------------------------------------------------------- changes


def test_clause_labels_and_keys():
    assert clause_label("Annexu re-A Sl. 1, 2, and 3") == "Annexure-A Sl. 1, 2, and 3"
    assert clause_label("13.1.1.( i)") == "13.1.1.(i)"
    assert clause_label('1.1 “SCSD ”') == '1.1 "SCSD"'
    assert clause_key("Clause 8.1(c)") == clause_key("8.1.c") == clause_key("8.1 c") == ("8", "1", "c")
    assert same_clause(("8", "1"), ("8", "1", "c")) and not same_clause(("8", "1", "a"), ("8", "1", "c"))
    assert not same_clause(("10",), ("10", "2"))  # a single number is not the parent of a clause
    assert word_diff("of 100 MW and", "of 50 MW and") == [["=", "of"], ["-", "100"], ["+", "50"], ["=", "MW and"]]


def test_docling_changes_cover_the_pack_and_every_quote_is_located(changes):
    assert len([c for c in changes if c["doc"] == "amd1"]) == 30  # 17 RfS + 11 PPA + 2 PSA
    assert len([c for c in changes if c["doc"] == "amd2"]) == 21  # 14 RfS + 6 PPA + 1 PSA
    for gold in [g for g in PACK["changes"] if g["doc"] in PARSED]:
        key = clause_key(gold["clause"])
        hits = [c for c in changes if c["doc"] == gold["doc"] and c["document"] == gold["document"] and same_clause(key, tuple(c["clause_key"]))]
        assert hits, f"{gold['id']} ({gold['doc']} {gold['document']} {gold['clause']}) not found"
    for change in changes:
        for evidence in change["before"]["evidence"] + change["after"]["evidence"]:
            assert evidence["located"], (change["id"], evidence["quote"][:60])
            assert evidence["page"] in change["pages"]


def test_change_kinds_and_effects(changes):
    by_id = {c["id"]: c for c in changes}
    assert by_id["amd1-rfs-1"]["effect"] == "'100 MW' -> '50 MW'."
    assert by_id["amd1-rfs-1"]["before"]["evidence"][0]["bbox"]  # highlightable
    assert by_id["amd2-rfs-8"]["effect"].startswith("'9,54,000' -> '9,68,000'")  # EMD formula
    assert by_id["amd2-rfs-12"]["kind"] == "deleted" and by_id["amd2-rfs-12"]["after"]["text"] == "Not used."
    assert by_id["amd1-rfs-17"]["kind"] == "replaced"  # "Revised Annexure is enclosed herewith."
    merged = by_id["amd1-rfs-4"]  # one cell across both columns: the new 8.1.a, the old not quoted
    assert merged["merged"] and not merged["before"]["text"] and merged["after"]["text"].startswith("Clause modified as follows")
    assert by_id["amd2-rfs-2"]["kind"] == "added"  # "Addendum to the Clause: ..."
    assert {c["document"] for c in changes} == {"RfS", "PPA", "PSA"}


def test_pymupdf_fallback_reads_the_same_schedules():
    found = []
    for doc in ("amd1", "amd2"):
        found += read_changes(doc, tables_from_pymupdf(_bytes(doc)), _pages(doc))
    gold = [g for g in PACK["changes"] if g["doc"] in PARSED]
    hits = [g for g in gold if any(c["doc"] == g["doc"] and c["document"] == g["document"] and same_clause(clause_key(g["clause"]), tuple(c["clause_key"])) for c in found)]
    assert len(hits) == len(gold)
    assert sum(1 for c in found if c["doc"] == "amd2") == 21


# ----------------------------------------------------------------------------- clarifications


def test_clarifications_verdicts_and_links(changes):
    clar = read_clarifications("clar1", tables_from_docling(_docling("clar1")), _pages("clar1"))
    assert [c["no"] for c in clar][:18] == list(range(1, 19))
    by_no = {c["no"]: c for c in clar}
    assert by_no[1]["verdict"] == "amended" and by_no[2]["verdict"] == "unchanged" and by_no[14]["verdict"] == "refer"
    assert by_no[9]["document"] == "PPA"
    for gold in PACK["clarifications"]:
        item = by_no[gold["no"]]
        assert (item["verdict"] == "unchanged") == ("remain unchanged" in gold["response"].lower()), gold["no"]
        assert item["evidence"]["response"][0]["located"]
    link(clar, changes)
    assert by_no[1]["changes"] == ["amd1-rfs-6"]  # 8.1(c) -> Amendment-01 8.1.c
    assert by_no[16]["changes"] == ["amd1-rfs-8", "amd2-rfs-4"]  # 9.2 a, amended twice
    assert verdict("Clause has been suitably modified. Kindly refer amendments-01") == "amended"
    assert verdict("It is clarified that the bidder may quote in INR.") == "answered"


# ----------------------------------------------------------------------------- consolidation


def test_clause_index_numbers_and_items(rfs_pages):
    index = clause_index(rfs_pages)
    labels = [m.label for m in index.marks if m.page in (16, 17)]
    assert labels[:4] == ["8", "8.1", "8.1.a", "8.1.b"] and "8.1.c" in labels
    page16 = [m.label for m in index.marks if m.page == 16]
    assert page16 == ["8", "8.1", "8.1.a", "8.1.b"]  # "(i)" ... "(iii)" under a. are roman numerals, not items
    assert [m.label for m in index.marks if m.page == 17][-2:] == ["8.1.i", "8.1.j"]  # a real item i, after h
    assert "16.3" in [m.label for m in index.marks if m.page == 28]  # past top-level "12", "13" alone on a line


@pytest.fixture(scope="module")
def consolidated(changes, rfs_pages):
    rfs = read_tender("RfS.pdf", _bytes("rfs"), mode="rules")
    pages = {doc: _pages(doc) for doc in ("amd1", "amd2")}
    return rfs, consolidate(compile_type(rfs["tender_type"]), rfs, rfs_pages, changes, pages)


def _field(result: dict, path: str) -> dict:
    return next(f for s in result["sections"] for f in s["fields"] if f["path"] == path)


def test_amendments_applied_with_history(consolidated):
    rfs, (result, amended) = consolidated
    min_bid = _field(result, "sector.power.common.min_bid_mw")
    assert _field(rfs, "sector.power.common.min_bid_mw")["value"] == 100  # the RfS as printed
    assert min_bid["value"] == 50 and min_bid["status"] == "validated" and min_bid["changed_by"] == "amd1-rfs-1"
    assert min_bid["evidence"][0]["doc"] == "amd1" and min_bid["evidence"][0]["located"]
    assert min_bid["history"][0]["was"]["value"] == 100 and min_bid["history"][0]["matched_by"] == "quote"
    scod = _field(result, "sector.power.common.scod_months")
    assert scod["value"] == 24 and [h["change"] for h in scod["history"]] == ["amd1-rfs-8", "amd2-rfs-4"]
    assert scod["history"][0]["was"]["value"] == 18
    peak = _field(result, "sector.power.fdre.peak_window_definition")
    assert peak["value"] == "6 hours within 18:00–10:00" and peak["evidence"][0]["doc"] == "amd1"
    assert _field(result, "sector.power.common.max_bid_mw")["value"] == 500  # amended clause, same value
    assert result["values"]["sector.power.common.min_bid_mw"] == 50
    assert result["counts"]["amended"] == len({a["path"] for a in amended})
    # identity is not a term: an amendment quoting the issuer's name does not touch it
    assert not _field(result, "core.identity.issuing_agency")["history"]


def test_an_amended_field_that_cannot_be_reread_is_flagged(consolidated):
    _, (result, _) = consolidated
    location = _field(result, "sector.power.common.location_constraint")  # 6.1 rewritten by Amendment-02
    assert location["status"] == "needs_review" and location["changed_by"] == "amd2-rfs-1"
    assert any(issue["rule"] == "amended" for issue in location["issues"])
    assert location["value"] == "ists_anywhere"  # shown as it was, flagged


def test_a_deleted_clause_withdraws_its_field(changes, rfs_pages):
    rfs = read_tender("RfS.pdf", _bytes("rfs"), mode="rules")
    target = _field(rfs, "sector.power.common.min_bid_mw")
    deletion = {
        "id": "amd9-rfs-1", "doc": "amd9", "document": "RfS", "clause": "5.1", "clause_key": ["5", "1"], "kind": "deleted",
        "before": {"text": "", "evidence": []},
        "after": {"text": "Not used.", "evidence": [{"page": 1, "quote": "Not used.", "located": True, "doc": "amd9"}]},
        "pages": [1], "merged": True,
    }
    result, amended = consolidate(compile_type(rfs["tender_type"]), rfs, rfs_pages, [deletion], {"amd9": []})
    field = _field(result, target["path"])
    assert field["status"] == "withdrawn" and field["value"] is None and field["changed_by"] == "amd9-rfs-1"
    assert "sector.power.common.min_bid_mw" not in result["values"] and result["counts"]["withdrawn"] >= 1


class _AmendSDK:
    """Answers amended_fields/v1 with a canned re-read of the field asked about."""

    def __init__(self) -> None:
        self.messages = self
        self.prompts: list[str] = []

    def parse(self, *, model, max_tokens, system, messages, output_format):
        text = messages[0]["content"][0]["text"]
        self.prompts.append(text)
        usage = SimpleNamespace(input_tokens=500, output_tokens=50)
        fields = []
        if "sector.power.common.location_constraint" in text:
            fields.append({
                "path": "sector.power.common.location_constraint", "value": "ists_anywhere", "confidence": 0.8, "rationale": "still anywhere in India",
                "evidence": [{"quote": "the Projects can be located anywhere on the moon at the bidder's choice"}],
            })
        return SimpleNamespace(parsed_output=output_format.model_validate({"fields": fields}), usage=usage, stop_reason="end_turn")


def test_model_reread_of_amended_fields(changes, rfs_pages):
    from engine.extraction.llm import LLMClient

    rfs = read_tender("RfS.pdf", _bytes("rfs"), mode="rules")
    sdk = _AmendSDK()
    usage = {"calls": 0, "input_tokens": 0, "output_tokens": 0}
    six_one = [c for c in changes if c["id"] == "amd2-rfs-1"]
    result, _ = consolidate(compile_type(rfs["tender_type"]), rfs, rfs_pages, six_one, {"amd2": _pages("amd2")}, client=LLMClient(sdk), usage=usage)
    field = _field(result, "sector.power.common.location_constraint")
    assert usage["calls"] == 1 and "Amended text:" in sdk.prompts[0] and "value before the amendment: " in sdk.prompts[0]
    assert field["changed_by"] == "amd2-rfs-1" and field["evidence"][0]["doc"] == "amd2"
    # the quote is not in Amendment-02 verbatim, so the value stays for review, unlocated
    assert field["status"] == "needs_review" and not field["evidence"][0]["located"]


# ----------------------------------------------------------------------------- formats and process


def test_formats_match_the_pack(rfs_pages):
    formats = {f["id"]: f for f in read_formats(rfs_pages)}
    for gold in PACK["formats"]:
        assert gold["id"] in formats, gold["id"]
        assert formats[gold["id"]]["pages"] == gold["pages"], gold["id"]
    cover = formats["7.1"]
    assert cover["heading"]["located"] and cover["paper"].startswith("Letter Head of the Bidding Company")
    assert {"date", "rfsNo", "address"} <= set(cover["maps"]) and cover["blank_count"] >= 20
    assert formats["7.2"]["applies"] == "only Consortium" and formats["7.2"]["paper"].startswith("Non-Judicial Stamp Paper")
    assert any(b["instruction"] and b["instruction"].lower().startswith("insert name") for b in formats["7.3A"]["blanks"])


def test_bid_process_information_sheet_and_steps(rfs_pages):
    process = read_process(rfs_pages, tables_from_pymupdf(_bytes("rfs"), max_pages=12), {p for p in range(68, 140)})
    items = {row["item"]: row for row in process["information"]}
    assert set("ABCDEFGHIJKLMNOP") <= set(items)
    assert items["G"]["value"].endswith("applicable GST corresponding to the quoted Capacity.") or "20,000/MW" in items["G"]["value"]
    assert items["M"]["label"].lower().startswith("e-reverse auction")
    keys = [step["key"] for step in process["steps"]]
    assert keys[:3] == ["register", "fees", "emd"] and {"era", "selection", "loa", "ppa"} <= set(keys)
    for step in process["steps"]:
        assert all(source["located"] for source in step["sources"]), step["key"]
    gold_pages = {s["page"] for g in PACK["bidProcess"] for s in g["sources"]}
    ours = {s["page"] for step in process["steps"] for s in step["sources"]}
    assert len([p for p in gold_pages if any(abs(p - q) <= 1 for q in ours)]) >= 13  # of 17


# ----------------------------------------------------------------------------- the whole set


@pytest.fixture(scope="module")
def tender_set() -> dict:
    files = [(FILES[doc], _bytes(doc)) for doc in ("psa", "clar1", "amd2", "rfs", "amd1")]
    docling = {FILES[doc]: _docling(doc) for doc in ("amd1", "amd2", "clar1")}
    return read_set(files, mode="rules", docling=docling)


def test_read_set_end_to_end(tender_set):
    r = tender_set
    assert [d["id"] for d in r["documents"]] == ["rfs", "amd1", "amd2", "clar1", "psa"]
    assert [d["layout"] for d in r["documents"]] == [None, "docling", "docling", "docling", None]
    counts = r["counts"]
    assert counts["changes"] == 51 and counts["changes_located"] == 51 and counts["clarifications"] >= 18
    assert counts["formats"] >= 20 and counts["amended_fields"] >= 8 and counts["steps"] >= 10
    assert {c["target_doc"] for c in r["changes"] if c["document"] == "PSA"} == {"psa"}
    assert {c["target_doc"] for c in r["changes"] if c["document"] == "PPA"} == {None}  # no PPA in the set
    assert _field(r["tender"], "sector.power.common.min_bid_mw")["value"] == 50
    assert r["warnings"] == []
    json.dumps(r)  # the job store writes it as JSON


def test_search_over_the_set(tender_set):
    passages = tender_set["search"]["passages"]
    assert {p["doc"] for p in passages} == {"rfs", "amd1", "amd2", "clar1", "psa"}
    hits = set_search.search("test-set", passages, "e-reverse auction", top_k=5)
    assert hits and hits[0]["doc"] == "rfs" and hits[0]["score"] > 0
    only = set_search.search("test-set", passages, "peak hours", top_k=5, role="amendment")
    assert only and {h["doc"] for h in only} <= {"amd1", "amd2"}
    assert set_search.search("test-set", passages, "peak hours", top_k=3, doc="clar1")[0]["doc"] == "clar1"
    assert set_search.search("test-set", passages, "   ") == []


# ----------------------------------------------------------------------------- clients


def _docling_transport(fail: str | None = None, doc: dict | None = None):
    polls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/convert/file/async":
            assert b'name="to_formats"' in request.content and b"json" in request.content
            if fail == "submit":
                return httpx.Response(500, text="boom")
            return httpx.Response(200, json={"task_id": "t1", "task_status": "pending"})
        if path == "/v1/status/poll/t1":
            polls["n"] += 1
            if fail == "task":
                return httpx.Response(200, json={"task_status": "failure"})
            return httpx.Response(200, json={"task_status": "success" if polls["n"] > 1 else "started"})
        if path == "/v1/result/t1":
            return httpx.Response(200, json={"document": {"json_content": doc or {"tables": []}}, "status": "success"})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def test_docling_client_polls_the_task(monkeypatch):
    monkeypatch.setenv("DOCLING_URL", "http://docling:5001/")
    doc = _docling("amd2")
    with httpx.Client(transport=_docling_transport(doc=doc)) as http:
        got = convert("Amendment-02.pdf", b"%PDF-1.4", client=http, poll_seconds=0)
    assert len(tables_from_docling(got)) == len(doc["tables"])
    for fail in ("submit", "task"):
        with httpx.Client(transport=_docling_transport(fail=fail)) as http, pytest.raises(DoclingError):
            convert("x.pdf", b"%PDF-1.4", client=http, poll_seconds=0)
    monkeypatch.delenv("DOCLING_URL")
    with pytest.raises(DoclingError):
        convert("x.pdf", b"%PDF-1.4")


def test_layout_falls_back_to_pymupdf_when_docling_is_down(monkeypatch):
    monkeypatch.setenv("DOCLING_URL", "http://127.0.0.1:9")  # nothing listens
    monkeypatch.setenv("DOCLING_TIMEOUT_SECONDS", "30")
    layout = read_layout("Amendment-02.pdf", _bytes("amd2"))
    assert layout.source == "pymupdf" and layout.tables and "Docling could not read the tables" in layout.warnings[0]
    monkeypatch.delenv("DOCLING_URL")
    assert read_layout("Amendment-02.pdf", _bytes("amd2")).warnings == []


def _scanned_pdf() -> bytes:
    import pymupdf

    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((72, 72), "Page one has a text layer and says so. " * 4)
        pdf.new_page()  # no text: a scanned page
        return pdf.tobytes()


def test_llamaparse_fills_only_scanned_pages(monkeypatch):
    monkeypatch.setenv("LLAMA_CLOUD_API_KEY", "llx-test")
    payload = _scanned_pdf()
    pages = read_pages("scan.pdf", payload)
    assert [p.has_text_layer for p in pages] == [True, False]
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        assert request.headers["Authorization"] == "Bearer llx-test"
        if request.url.path == "/api/v1/parsing/upload":
            return httpx.Response(200, json={"id": "job1"})
        if request.url.path == "/api/v1/parsing/job/job1":
            return httpx.Response(200, json={"status": "SUCCESS"})
        return httpx.Response(200, json={"pages": [{"page": 1, "text": "REPLACED"}, {"page": 2, "text": "The EMD shall be Rs. 10 lakh per MW."}]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        filled_pages, filled = fill_scanned("scan.pdf", payload, pages, client=http)
    assert filled == [2] and filled_pages[0].text == pages[0].text  # a text layer is never replaced
    assert "Rs. 10 lakh" in filled_pages[1].text and filled_pages[1].has_text_layer
    assert seen == ["/api/v1/parsing/upload", "/api/v1/parsing/job/job1", "/api/v1/parsing/job/job1/result/json"]


class _ProseSDK:
    """Answers amendment_changes/v1 for an amendment with no schedule table."""

    def __init__(self) -> None:
        self.messages = self

    def parse(self, *, model, max_tokens, system, messages, output_format):
        assert any(b["type"] == "document" for b in messages[0]["content"])
        usage = SimpleNamespace(input_tokens=900, output_tokens=80)
        answer = {"changes": [{"document": "RfS", "clause": "Bid submission deadline", "kind": "modified", "existing_quote": "",
                               "amended_quote": "The last date of bid submission is extended to 15.05.2026", "page_no": 1}]}
        return SimpleNamespace(parsed_output=output_format.model_validate(answer), usage=usage, stop_reason="end_turn")


def test_prose_amendment_read_by_the_model():
    import pymupdf

    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((72, 72), "Corrigendum-03 to RfS No. ABC/123/2026")
        page.insert_text((72, 100), "The last date of bid submission is extended to 15.05.2026 (15:00 Hrs).")
        payload = pdf.tobytes()
    result = read_set([("Corrigendum-03.pdf", payload)], mode="auto", sdk=_ProseSDK())
    assert result["documents"][0]["role"] == "amendment" and result["documents"][0]["kind"] == "corrigendum"
    change = result["changes"][0]
    assert change["source"] == "model" and change["after"]["evidence"][0]["located"] and change["id"] == "amd3-rfs-1"
    assert result["usage"]["calls"] == 1 and "No file reads as the RfS itself" in result["warnings"][0]


# ----------------------------------------------------------------------------- API


@pytest.fixture()
def api(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from engine.app import app

    monkeypatch.setenv("EXTRACTION_JOBS_DIR", str(tmp_path / "jobs"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("DOCLING_URL", raising=False)
    return TestClient(app)


def _file(doc: str) -> dict:
    return {"name": FILES[doc], "content_base64": base64.b64encode(_bytes(doc)).decode()}


def test_api_read_set_then_search(api):
    res = api.post("/api/rtc/tender/read-set", json={"files": [_file("amd2"), _file("rfs")], "mode": "rules"})
    assert res.status_code == 202 and res.json()["files"] == 2
    job_id = res.json()["job_id"]
    assert api.get("/api/rtc/tender/search", params={"job_id": job_id, "q": "EMD"}).status_code in (409, 200)
    for _ in range(300):
        job = api.get(f"/api/rtc/tender/read/{job_id}").json()
        if job["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert job["status"] == "done", job.get("error")
    assert job["kind"] == "set" and job["preview"]["pages"] == 139  # the scan screen scrolls the RfS
    result = job["result"]
    assert result["kind"] == "set" and [d["id"] for d in result["documents"]] == ["rfs", "amd2"]
    assert result["documents"][1]["layout"] == "pymupdf" and result["counts"]["changes"] == 21
    hits = api.get("/api/bid/tender/search", params={"job_id": job_id, "q": "Net-Worth requirement", "k": 3}).json()["hits"]
    assert hits and hits[0]["doc"] in ("rfs", "amd2")
    assert api.get("/api/bid/tender/search", params={"job_id": "0" * 32, "q": "x"}).status_code == 404


def test_api_read_set_rejects_bad_requests(api):
    assert api.post("/api/bid/tender/read-set", json={"files": []}).status_code == 422
    assert api.post("/api/bid/tender/read-set", json={"files": [_file("amd2")], "mode": "llm"}).status_code == 400
    assert api.post("/api/bid/tender/read-set", json={"files": [_file("amd2")], "tender_type": "nuclear"}).status_code == 422
    bad = {"name": "x.pdf", "content_base64": base64.b64encode(b"not a pdf").decode()}
    assert api.post("/api/bid/tender/read-set", json={"files": [bad]}).status_code == 400
    assert api.post("/api/bid/tender/read-set", json={"files": [_file("amd2")] * 21}).status_code == 422
