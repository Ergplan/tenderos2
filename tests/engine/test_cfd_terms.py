"""Every SECI CfD-I condition the CfD tab uses (web/src/cfd/terms.js) and every amendment change in its
tender pack (web/src/cfd/pack.js) is quoted word for word on the page it cites.

The RfS and Amendments 01 to 03 are in the repository (web/public/tenders/seci-cfd-i/). The standard
CfD Agreement is not: its terms are checked only when CFD_DOCS_DIR holds a copy (file name
Standard_SECI_CfDA_CfD-I-_final_upload.pdf), otherwise they are skipped one by one and the test still
runs for the other documents. Pages in terms.js are the numbers printed on the page; a document's
pdfOffset turns them into PDF pages (the RfS has a cover). Pages in pack.js are PDF pages.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "web" / "public" / "tenders" / "seci-cfd-i"
CFDA_FILE = "Standard_SECI_CfDA_CfD-I-_final_upload.pdf"


def _node(script: str) -> dict:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    out = subprocess.run([node, "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def _norm(text: str) -> str:
    return " ".join(re.sub(r"-[ \t]*\n\s*", "-", text).split())


def _pages(documents: list[dict]) -> dict[str, list[str]]:
    """{doc id: page texts} for every document whose PDF is present."""
    fitz = pytest.importorskip("fitz")
    base = os.environ.get("CFD_DOCS_DIR")
    found: dict[str, list[str]] = {}
    for doc in documents:
        candidates = []
        if doc.get("file"):
            candidates.append(PUBLIC / doc["file"])
            if base:
                candidates.append(Path(base) / doc["file"])
        elif doc["id"] == "cfda" and base:
            candidates.append(Path(base) / CFDA_FILE)
        hit = next((c for c in candidates if c.is_file()), None)
        if hit is not None:
            found[doc["id"]] = [page.get_text("text") for page in fitz.open(hit)]
    return found


def test_cfd_terms_quote_the_documents_word_for_word():
    data = _node("import { DOCUMENTS, TERMS } from './web/src/cfd/terms.js'; console.log(JSON.stringify({ DOCUMENTS, TERMS }));")
    pages = _pages(data["DOCUMENTS"])
    offset = {doc["id"]: doc.get("pdfOffset", 0) for doc in data["DOCUMENTS"]}
    assert {"rfs", "amd1", "amd2", "amd3"} <= set(pages), "the RfS and the three amendments are in web/public/tenders/seci-cfd-i"
    terms = data["TERMS"]
    assert len(terms) >= 240
    assert len({t["id"] for t in terms}) == len(terms), "unique term ids"
    checked = skipped = 0
    for term in terms:
        if term["doc"] not in pages:
            skipped += 1
            continue
        text = pages[term["doc"]][term["page"] - 1 + offset[term["doc"]]]
        assert _norm(term["quote"]) in _norm(text), (term["id"], term["doc"], term["page"])
        if term["doc"] == "rfs":  # the page number is the one printed on the page
            assert f"Page {term['page']} of 128" in text, (term["id"], term["page"])
        checked += 1
    assert checked >= 200
    if skipped:
        assert all(t["doc"] == "cfda" for t in terms if t["doc"] not in pages), "only the CfDA may be absent"


def test_cfd_pack_quotes_the_amendments_and_the_rfs():
    data = _node("import { PACK } from './web/src/cfd/pack.js'; console.log(JSON.stringify(PACK));")
    pages = _pages(data["documents"])
    assert {"rfs", "amd1", "amd2", "amd3"} <= set(pages)
    by_doc = {d: sum(1 for c in data["changes"] if c["doc"] == d) for d in ("amd1", "amd2", "amd3")}
    assert by_doc == {"amd1": 4, "amd2": 11, "amd3": 22}, by_doc
    assert len({c["id"] for c in data["changes"]}) == len(data["changes"])
    quotes = [(c["id"], q) for c in data["changes"] for q in (c["before"], c["after"]) if q]
    quotes += [(f"process {i + 1}", q) for i, p in enumerate(data["bidProcess"]) for q in p["sources"]]
    for where, q in quotes:
        assert q["doc"] in pages, (where, q["doc"])
        assert _norm(q["quote"]) in _norm(pages[q["doc"]][q["page"] - 1]), (where, q["doc"], q["page"])
    assert len(data["bidProcess"]) >= 12 and len(data["queries"]) >= 8
