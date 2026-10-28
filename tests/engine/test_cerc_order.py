"""The CERC order reader (engine/market/cerc_order.py) and its route: the petition, the date, the
petitioner, the capacity and the successful bidders, each with its page and quote; a scan with no
text is refused with a reason."""

from __future__ import annotations

import base64

import pymupdf
import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.market.cerc_order import read_order

ORDER = """CENTRAL ELECTRICITY REGULATORY COMMISSION
NEW DELHI
Petition No. 412/AT/2025
Date of Order: 22.11.2025
In the matter of: Petition under Section 63 of the Electricity Act, 2003 for adoption of tariff for
420 MW Round-the-Clock power from ISTS-connected Renewable Energy Projects under RTC-IV.
And
Solar Energy Corporation of India Limited ... Petitioner
"""
ROWS = ["S.No. Name of the Successful Bidder Capacity (MW) Tariff (Rs/kWh)",
        "1", "Hero Solar Energy Private Limited", "120", "5.06",
        "2", "Jindal India Power Limited", "150", "5.07",
        "3", "Sembcorp Green Infra Private Limited", "50", "5.07",
        "The tariff of Rs 5.06/kWh discovered in the e-reverse auction is adopted."]


def _pdf(pages: list[list[str]]) -> bytes:
    doc = pymupdf.open()
    for lines in pages:
        page = doc.new_page()
        y = 60
        for ln in lines:
            for part in ln.split("\n"):
                page.insert_text((40, y), part, fontsize=9)
                y += 13
    return doc.tobytes()


def test_reads_the_order():
    out = read_order("order.pdf", _pdf([[ORDER], ROWS]))
    f = out["fields"]
    assert f["petition"]["value"] == "412/AT/2025" and f["petition"]["page"] == 1
    assert f["orderDate"]["value"] == "2025-11-22"
    assert f["petitioner"]["value"] == "SECI"
    assert f["capacityMw"]["value"] == 420
    got = [(w["name"], w["mw"], w["tariff"]) for w in f["winners"]]
    assert got == [("Hero Solar Energy Private Limited", 120, 5.06), ("Jindal India Power Limited", 150, 5.07), ("Sembcorp Green Infra Private Limited", 50, 5.07)]
    assert all(w["page"] == 2 and w["quote"] for w in f["winners"])
    assert out["summary"]["tariffMin"] == 5.06 and out["summary"]["tariffMax"] == 5.07 and out["summary"]["awardedMw"] == 320
    assert any(t["value"] == 5.06 for t in f["tariffs"])


def test_long_date_and_no_bidders():
    out = read_order("o.pdf", _pdf([["Petition No. 7/AT/2026", "Date of Order: 3rd March, 2026", "NHPC Limited ... Petitioner", "adoption of tariff for 1200 MW"]]))
    assert out["fields"]["orderDate"]["value"] == "2026-03-03"
    assert out["fields"]["petitioner"]["value"] == "NHPC"
    assert out["fields"]["winners"] == []


def test_route_and_scan():
    client = TestClient(app)
    body = {"file": {"name": "order.pdf", "content_base64": base64.b64encode(_pdf([[ORDER], ROWS])).decode()}}
    r = client.post("/api/bid/cerc-order", json=body)
    assert r.status_code == 200, r.text
    assert len(r.json()["fields"]["winners"]) == 3
    blank = pymupdf.open()
    blank.new_page()
    r = client.post("/api/bid/cerc-order", json={"file": {"name": "scan.pdf", "content_base64": base64.b64encode(blank.tobytes()).decode()}})
    assert r.status_code == 400


@pytest.mark.parametrize("text,want", [("Date of Order: 05/01/2026", "2026-01-05"), ("Date of Order: January 5, 2026", "2026-01-05")])
def test_dates(text, want):
    out = read_order("d.pdf", _pdf([[text]]))
    assert out["fields"]["orderDate"]["value"] == want
