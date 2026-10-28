"""Read a CERC tariff-adoption order (a PDF) into the facts a bidder compares: the petition, the
order date, the petitioner, the capacity, the tariffs adopted and the successful bidders, each with
the page and the words it was read from. Rules over the PDF text (PyMuPDF), no model: a reader can
check every value against its quote and correct it in the app.
"""

from __future__ import annotations

import re
from typing import Any

import pymupdf

AGENCIES = [
    ("SECI", r"Solar Energy Corporation of India"),
    ("NTPC", r"NTPC\b"),
    ("NHPC", r"NHPC\b"),
    ("SJVN", r"SJVN\b"),
]
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}
COMPANY = re.compile(r"([A-Z][A-Za-z0-9&().,'\- ]{3,90}?(?:Private Limited|Pvt\.? Ltd\.?|Limited|Ltd\.?|LLP))")
MW = re.compile(r"(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*MW\b")
TARIFF = re.compile(r"(?:Rs\.?|INR|₹)\s*(\d\.\d{1,2})\s*(?:/|per)\s*(?:kWh|unit)", re.I)
BARE_TARIFF = re.compile(r"(?<![\d.])(\d\.\d{2})(?![\d.%])")


def _pages(payload: bytes) -> list[str]:
    with pymupdf.open(stream=payload, filetype="pdf") as doc:
        return [p.get_text("text", flags=0) for p in doc]


def _quote(text: str, start: int, end: int, pad: int = 70) -> str:
    a = max(0, start - pad)
    b = min(len(text), end + pad)
    return re.sub(r"\s+", " ", text[a:b]).strip()


def _date(s: str) -> str | None:
    m = re.search(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]+),?\s+(\d{4})", s)
    if m and m.group(2).lower() in MONTHS:
        return f"{int(m.group(3)):04d}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    m = re.search(r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})", s)
    if m and m.group(1).lower() in MONTHS:
        return f"{int(m.group(3)):04d}-{MONTHS[m.group(1).lower()]:02d}-{int(m.group(2)):02d}"
    return None


def _first(pages: list[str], pattern: str, flags: int = re.I, group: int = 1, limit: int = 4) -> dict[str, Any] | None:
    for i, text in enumerate(pages[:limit]):
        m = re.search(pattern, text, flags)
        if m:
            return {"value": re.sub(r"\s+", " ", m.group(group)).strip(), "page": i + 1, "quote": _quote(text, m.start(), m.end())}
    return None


def read_order(name: str, payload: bytes) -> dict[str, Any]:
    pages = _pages(payload)
    if not any(p.strip() for p in pages):
        raise ValueError("The PDF has no text layer (a scan): enter the order's facts by hand.")
    head = "\n".join(pages[:3])
    fields: dict[str, Any] = {}
    fields["petition"] = _first(pages, r"Petition\s+No\.?\s*[:\-]?\s*([0-9A-Za-z/\-]+(?:\s*/\s*\d{4})?)")
    date = _first(pages, r"Date\s+of\s+Order\s*[:\-]?\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{4}|[0-9]{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[A-Za-z]+,?\s+[0-9]{4}|[A-Za-z]+\s+[0-9]{1,2},?\s+[0-9]{4})")
    if date:
        date["value"] = _date(date["value"]) or date["value"]
    fields["orderDate"] = date
    for code, pat in AGENCIES:
        m = re.search(pat, head)
        if m:
            text = pages[0] if re.search(pat, pages[0]) else head
            mm = re.search(pat, text)
            fields["petitioner"] = {"value": code, "page": 1 if text is pages[0] else None, "quote": _quote(text, mm.start(), mm.end())}
            break
    subject = _first(pages, r"(?:Subject|In the matter of)\s*[:\-]?\s*(.{20,400}?)(?:\n\s*\n|And\s*\n|Petitioner|Respondent)", flags=re.I | re.S)
    if subject:
        subject["value"] = subject["value"][:300]
    fields["subject"] = subject
    # capacity: the largest MW figure in the subject, else on the first pages
    caps = []
    for i, text in enumerate(pages[:4]):
        for m in MW.finditer(text):
            v = float(m.group(1).replace(",", ""))
            if 5 <= v <= 20000:
                caps.append((v, i + 1, _quote(text, m.start(), m.end())))
    if subject:
        in_subject = [float(x.replace(",", "")) for x in MW.findall(subject["value"])]
        if in_subject:
            v = max(in_subject)
            fields["capacityMw"] = {"value": v, "page": subject["page"], "quote": subject["quote"]}
    if "capacityMw" not in fields and caps:
        v, pg, q = max(caps, key=lambda c: c[0])
        fields["capacityMw"] = {"value": v, "page": pg, "quote": q}
    # tariffs stated with a unit anywhere in the order
    tariffs = []
    for i, text in enumerate(pages):
        for m in TARIFF.finditer(text):
            v = float(m.group(1))
            if 1.0 <= v <= 15.0:
                tariffs.append({"value": v, "page": i + 1, "quote": _quote(text, m.start(), m.end())})
    fields["tariffs"] = tariffs[:40]
    # successful bidders: a company, a MW figure and a tariff on the same line or the next two
    winners: list[dict[str, Any]] = []
    seen = set()
    for i, text in enumerate(pages):
        lines = [ln.strip() for ln in text.split("\n")]
        for k, ln in enumerate(lines):
            cm = COMPANY.search(ln)
            if not cm:
                continue
            window = " ".join(lines[k:k + 4])
            rest = window[window.find(cm.group(1)) + len(cm.group(1)):]
            mw = MW.search(rest) or next((m for m in re.finditer(r"(?<![\d.])(\d{2,4})(?:\.\d+)?(?![\d.])", rest) if not 1900 <= int(m.group(1)) <= 2100), None)
            after = rest[mw.end():] if mw else rest
            tf = BARE_TARIFF.search(after[:40]) or TARIFF.search(after[:60])
            if not (mw and tf):
                continue
            company = re.sub(r"^(?:M/s\.?|\d+\.?|[ivx]+\))\s*", "", cm.group(1)).strip(" ,.")
            if re.search(r"Solar Energy Corporation|Commission|NTPC Limited|NHPC Limited|SJVN Limited|Power Trading|Grid", company):
                continue
            mwv = float(mw.group(1).replace(",", ""))
            tv = float(tf.group(1))
            if not (1 <= mwv <= 5000 and 1.0 <= tv <= 15.0):
                continue
            key = (company.lower(), mwv, tv)
            if key in seen:
                continue
            seen.add(key)
            winners.append({"name": company, "mw": mwv, "tariff": tv, "page": i + 1, "quote": re.sub(r"\s+", " ", window)[:240]})
    fields["winners"] = winners[:30]
    vals = [w["tariff"] for w in winners] or [t["value"] for t in tariffs]
    summary = {
        "title": (fields.get("subject") or {}).get("value") or name,
        "tariffMin": min(vals) if vals else None,
        "tariffMax": max(vals) if vals else None,
        "awardedMw": sum(w["mw"] for w in winners) if winners else None,
        "pages": len(pages),
    }
    return {"name": name, "fields": fields, "summary": summary}
