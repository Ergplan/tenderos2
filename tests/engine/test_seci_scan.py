"""The SECI tender scan (engine/market/seci_tenders.py): the list and details pages parsed from saved
copies of SECI's site, the facts read off the titles, the fingerprints, the rule-based summaries,
the Claude summaries through the registered prompt (a stand-in SDK), and that no tender document
is ever fetched."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from engine.market import seci_tenders as S

FIX = Path(__file__).parent / "fixtures" / "seci"
TODAY = date(2026, 11, 13)


def _pages():
    listing = (FIX / "tenders.html").read_text(encoding="utf-8")
    details = {"/tender-details/Ymty": (FIX / "details-Ymty.html").read_text(encoding="utf-8"),
               "/tender-details/YmR0": (FIX / "details-YmR0.html").read_text(encoding="utf-8")}
    fetched = []

    def fetch(url):
        fetched.append(url)
        assert not url.lower().endswith((".pdf", ".xlsx", ".zip", ".docx")), f"a document was fetched: {url}"
        if url.endswith(S.LIST_PATH):
            return listing
        path = url[len(S.BASE_URL):]
        # the other details pages: the NHAI page stands in, with its id swapped out
        return details.get(path, details["/tender-details/Ymty"])

    return fetch, fetched


def test_the_list_is_parsed():
    rows = S.parse_list((FIX / "tenders.html").read_text(encoding="utf-8"))
    assert len(rows) == 15
    cfd = next(r for r in rows if r["tenderId"] == "SECI000249")
    assert cfd["ref"] == "SECI/C&P/IPP/13/0002/26-27" and cfd["ets"] == "SECI-2026-TN000007"
    assert cfd["published"] == "2026-04-19" and cfd["bidDeadline"] == "2026-11-20" and cfd["detailsPath"] == "/tender-details/YmZ-"
    assert "CfD Mechanism" in cfd["title"]
    assert next(r for r in rows if r["tenderId"] == "SECI000283")["ets"] is None


def test_a_page_without_the_list_is_refused():
    with pytest.raises(ValueError, match="layout"):
        S.parse_list("<html><body>maintenance</body></html>")


def test_the_details_page_is_parsed():
    d = S.parse_details((FIX / "details-Ymty.html").read_text(encoding="utf-8"))
    assert d["preBid"] == "2026-11-12T14:30" and d["bidOnline"] == "2026-12-14T18:00" and d["bidOpen"] == "2026-12-17T10:00"
    assert d["emd"] == "As per RfS document" and d["type"] == "On Line"
    assert [x["name"] for x in d["documents"]] == ["Technical_Specification_Annexure-B_1.pdf", "Format_for_seeking_clarifications_on_tender40.xlsx", "NHAI_Tender-final_upload.pdf", "Standard_Draft_PPA.pdf"]
    assert d["announcements"] == [{"title": "Pre bid meeting for RfS for setting up Solar PV Power Project for NHAI (Phase-I) under Tariff-Based Competitive Bidding", "uploadedAt": "2026-11-05T16:46"}]
    w = S.parse_details((FIX / "details-YmR0.html").read_text(encoding="utf-8"))
    assert w["emd"] == "INR 8,43,68,000/-" and len(w["documents"]) == 9 and w["announcements"] == []


@pytest.mark.parametrize("title,ref,cat,bidder,cap,scheme", [
    ("RfS for assured Peak Supply of 1000 MWh (500 MW x 2 Hrs.) under CfD Mechanism from ISTS-Connected RE Projects (SECI-CfD-I)", "SECI/C&P/IPP/13/0002/26-27", "cfd", "developer", {"mw": 500, "mwh": 1000, "hours": 2}, "SECI-CfD-I"),
    ("RfS for Supply of Energy from 800 MW/ 3200 MWh Standalone Battery Energy Storage Systems in India (SECI-ESS-IV)", "SECI/C&P/IPP/15/0010/26-27", "bess", "developer", {"mw": 800, "mwh": 3200}, "SECI-ESS-IV"),
    ("Tender for Design, Engineering, Supply, Construction, Erection, Testing, Commissioning and O&M of ISTS-Connected 60 MW (AC) Solar PV Power Plant at Gaya, Bihar, India", "SECI/C&P/OP/11/0007/26-27", "solar", "epc", {"mw": 60}, None),
    ("Request for Selection (RfS) of Solar Power Developer for setting up of 3680 kW Grid-Connected Rooftop Solar PV Projects on NDMC Buildings under RESCO Mode through Tariff-based Competitive Bidding (RTSPV T-XV)", "SECI/C&P/IPP/11/0010/26-27", "rooftop", "developer", {"kw": 3680}, "RTSPV T-XV"),
    ("RfS for Green Ammonia (Mode-2A-Tranche-II)", "SECI/C&P/MI/00/06/2026-27", "hydrogen", "developer", {}, "Mode-2A-Tranche-II"),
    ("Selection of Tenant(s) for Renting out the Office space(s) of SECI", "RfP No. SECI/C&P/MI/00/0002/26-27", "admin", "services", {}, None),
])
def test_facts_read_off_the_title(title, ref, cat, bidder, cap, scheme):
    f = S.facts({"title": title, "ref": ref, "bidDeadline": "2026-11-20"}, TODAY)
    assert f["category"] == cat and f["bidder"] == bidder and f["scheme"] == scheme
    assert {k: v for k, v in f["capacity"].items()} == cap
    assert f["daysToBid"] == 7


def test_scan_with_rules_never_fetches_a_document():
    fetch, fetched = _pages()
    out = S.scan(fetch=fetch, today=TODAY, use_llm=False, delay=0)
    assert out["found"] == 15 and out["new"] == 15 and out["changed"] == 0 and out["mode"] == "rules"
    assert out["documentsOpened"] == 0 and len(fetched) == 16  # the list and 15 details pages
    nhai = next(t for t in out["tenders"] if t["tenderId"] == "SECI000295")
    s = nhai["summary"]
    assert s["by"] == "rules" and "Bids are due 14 Dec 2026, 18:00." in s["summary"] and "Pre-bid meeting 12 Nov 2026" in s["summary"]
    assert " days" not in s["summary"], "no count of days in a summary that is kept while the tender is unchanged"
    assert any("Pre bid meeting for RfS" in w for w in s["watch"]) and any("not opened" in w for w in s["watch"])
    assert not any("amendment, corrigendum" in w for w in s["watch"]), "a clarification-query form is not an amendment"
    # the second scan with the fingerprints: nothing new, nothing summarised again
    known = {t["tenderId"]: t["fingerprint"] for t in out["tenders"]}
    again = S.scan(known=known, fetch=_pages()[0], today=TODAY, use_llm=False, delay=0)
    assert again["new"] == 0 and again["changed"] == 0 and all("summary" not in t for t in again["tenders"])
    # an announcement added: that tender is changed and summarised again
    known["SECI000295"] = "0" * 16
    third = S.scan(known=known, fetch=_pages()[0], today=TODAY, use_llm=False, delay=0)
    assert third["changed"] == 1 and next(t for t in third["tenders"] if t["tenderId"] == "SECI000295")["summary"]["by"] == "rules"


class _FakeMessages:
    def __init__(self):
        self.calls = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        import json
        text = kwargs["messages"][0]["content"][0]["text"]
        tenders = json.loads(text[text.index("{"):])["tenders"]
        out = S.SeciScanOutput(tenders=[S.SeciTenderSummary(tender_id=t["tenderId"], summary=f"Summary of {t['tenderId']}.", watch=["Bids due soon."], relevance="high") for t in tenders[:-1]])
        return SimpleNamespace(parsed_output=out, stop_reason="end_turn", usage=SimpleNamespace(input_tokens=1000, output_tokens=200, cache_read_input_tokens=0, cache_creation_input_tokens=0))


def test_scan_with_claude_uses_the_registered_prompt_and_fills_gaps_with_rules():
    fetch, _ = _pages()
    sdk = SimpleNamespace(messages=_FakeMessages())
    out = S.scan(fetch=fetch, today=TODAY, sdk=sdk, delay=0)
    assert out["mode"] == "claude" and len(sdk.messages.calls) == 2  # 15 tenders, at most 12 a call
    system = sdk.messages.calls[0]["system"]
    assert "you do not have the tender documents" in system and "Never state a tariff" in system and "never write a number of days" in system
    sent = sdk.messages.calls[0]["messages"][0]["content"][0]["text"]
    assert "readOffTheTitle" in sent and "Standard_Draft_PPA.pdf" in sent
    by = [t["summary"]["by"] for t in out["tenders"]]
    assert by.count("claude") == 13 and by.count("rules") == 2  # the stand-in leaves one tender out of each call
    assert any("left some tenders out" in e for e in out["errors"]) and out["usage"]["input_tokens"] == 2000


def test_the_output_model_is_accepted_by_the_sdk():
    transform = pytest.importorskip("anthropic.lib._parse._transform").transform_schema
    transform(S.SeciScanOutput)
