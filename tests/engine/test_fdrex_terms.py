"""Every SECI-FDRE-X condition the FDRE-X tab uses (web/src/fdrex/terms.js) is quoted word for word on the
page it cites.

The RfS, the standard PPA, the standard PSA and Amendment-01 are all in the repository
(web/public/tenders/seci-fdre-x/). Pages in terms.js are the numbers printed on the page; a document's
pdfOffset turns them into PDF pages (the RfS has a cover, the other three print the PDF page itself).
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "web" / "public" / "tenders" / "seci-fdre-x"
DOC_IDS = {"rfs", "ppa", "psa", "amd1"}


def _node(script: str) -> dict:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    out = subprocess.run([node, "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def _norm(text: str) -> str:
    return " ".join(re.sub(r"-[ \t]*\n\s*", "-", text).split())


def _pymupdf():
    try:
        import pymupdf
    except ImportError:  # older PyMuPDF releases only have the name fitz
        return pytest.importorskip("fitz")
    return pymupdf


def _pages(documents: list[dict]) -> dict[str, list[str]]:
    """{doc id: page texts} for every document whose PDF is present."""
    pymupdf = _pymupdf()
    found: dict[str, list[str]] = {}
    for doc in documents:
        path = PUBLIC / doc["file"] if doc.get("file") else None
        if path is not None and path.is_file():
            found[doc["id"]] = [page.get_text("text") for page in pymupdf.open(path)]
    return found


def test_fdrex_terms_quote_the_documents_word_for_word():
    data = _node("import { DOCUMENTS, TERMS } from './web/src/fdrex/terms.js'; console.log(JSON.stringify({ DOCUMENTS, TERMS }));")
    documents = {doc["id"]: doc for doc in data["DOCUMENTS"]}
    pages = _pages(data["DOCUMENTS"])
    assert set(documents) == DOC_IDS
    assert set(pages) == DOC_IDS, "the RfS, the PPA, the PSA and Amendment-01 are in web/public/tenders/seci-fdre-x"
    for doc_id, doc in documents.items():  # `pages` is the printed count; the offset is the unnumbered pages before page 1
        assert len(pages[doc_id]) == doc["pages"] + doc.get("pdfOffset", 0), doc_id
    terms = data["TERMS"]
    assert len(terms) >= 200
    assert len({t["id"] for t in terms}) == len(terms), "unique term ids"
    checked = 0
    for term in terms:
        doc = documents[term["doc"]]
        where = (term["id"], term["doc"], term["page"])
        assert 1 <= term["page"] <= doc["pages"], where
        text = _norm(pages[term["doc"]][term["page"] - 1 + doc.get("pdfOffset", 0)])
        assert _norm(term["quote"]) in text, where
        # the page number is the one printed on the page: "Page 16 of 138" (one PPA page prints "81 of 84")
        assert re.search(rf"(?<!\d){term['page']} of {doc['pages']}(?!\d)", text), where
        if term.get("status") == "replaced":
            assert term.get("by") in DOC_IDS, where
        if term.get("status") == "conflict":
            assert term.get("flag"), where
        checked += 1
    assert checked == len(terms) and checked >= 180
    replaced_by = {t["by"] for t in terms if t.get("status") == "replaced"}
    assert replaced_by <= {t["doc"] for t in terms}, "every amendment that replaces a term is itself quoted"
