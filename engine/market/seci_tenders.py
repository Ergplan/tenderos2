"""SECI's open tenders, scanned from its website and summarised without opening a document.

The scan reads two kinds of page and nothing else:

* the tender list (https://www.seci.co.in/tenders): the tender ID, the ETS code, the reference,
  the title, the publication date and the bid deadline of every open tender;
* each tender's details page (/tender-details/<id>): the pre-bid, sale, submission and opening
  dates, the EMD and PBG wording, the names and upload dates of the documents, and the titles and
  dates of the tender's announcements (corrigenda, pre-bid minutes, extensions).

The documents themselves (the RfS, the PPA, the amendments) are never downloaded: the summary
says what the page says about them, which is their names and dates. A fingerprint of each record
lets the caller summarise only the tenders that are new or have changed since the last scan.

The summary is written by Claude (the registered prompt seci_scan/v1, one call for the tenders to
summarise) when a key is set, and by rules otherwise: the category, the capacity and the scheme
code read off the title, the dates, the documents and the announcements put into sentences.
"""

from __future__ import annotations

import hashlib
import html as htmllib
import json
import os
import re
import time
from datetime import date, datetime
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field

BASE_URL = os.environ.get("SECI_BASE_URL", "https://www.seci.co.in").rstrip("/")
LIST_PATH = "/tenders"
USER_AGENT = "TenderOS tender scanner (reads the public tender list and details pages only)"
MAX_TENDERS = 60  # a ceiling on details pages fetched per scan
PAGE_DELAY_S = 0.4  # politeness between details pages

# ---------------------------------------------------------------- parsing


def _text(fragment: str) -> str:
    """The visible text of an HTML fragment, whitespace folded."""
    fragment = re.sub(r"<!--.*?-->", "", fragment, flags=re.S)
    fragment = re.sub(r"<(script|style)\b.*?</\1>", "", fragment, flags=re.S | re.I)
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def _date(value: str) -> str | None:
    """dd/mm/yyyy (with or without a time) as an ISO date, or None."""
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", value or "")
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat()
    except ValueError:
        return None


def _datetime(value: str) -> str | None:
    """dd/mm/yyyy hh:mm[:ss] as an ISO date-time (to the minute), or the date alone."""
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})", value or "")
    if not m:
        return _date(value)
    try:
        return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), int(m.group(4)), int(m.group(5))).isoformat(timespec="minutes")
    except ValueError:
        return _date(value)


def parse_list(page: str) -> list[dict[str, Any]]:
    """The rows of the tender list: id, ets, ref, title, published, bidDeadline, detailsPath."""
    table = re.search(r'<table[^>]*id="tender-list".*?</table>', page, flags=re.S)
    if not table:
        raise ValueError("the SECI tender list was not found on the page (the site layout may have changed)")
    out = []
    for row in re.findall(r'<tr class="tender-row">(.*?)</tr>', table.group(0), flags=re.S):
        row = re.sub(r"<!--.*?-->", "", row, flags=re.S)
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S)
        if len(cells) < 8:
            continue
        link = re.search(r'href="(/tender-details/[^"]+)"', row)
        tender_id = _text(cells[1])
        if not tender_id:
            continue
        out.append({
            "tenderId": tender_id,
            "ets": _text(cells[2]) or None,
            "ref": _text(cells[3]),
            "title": _text(cells[4]),
            "published": _date(_text(cells[5])),
            "bidDeadline": _date(_text(cells[6])),
            "detailsPath": link.group(1) if link else None,
        })
    return out


# the labels of the details page and the keys they map to
_DETAIL_LABELS = {
    "Tender Type": "type",
    "Tender Description": "description",
    "Tender Fee/Bid Processing Fee": "fee",
    "Cost of RFS": "rfsCost",
    "EMD": "emd",
    "PBG": "pbg",
    "Tender Publication Date": "publishedAt",
    "Pre Bid Meeting Date": "preBid",
    "Document Sale Start Date": "saleStart",
    "Document Sale End Date": "saleEnd",
    "Bid Submission End Date (Online)": "bidOnline",
    "Bid Submission End Date (Offline)": "bidOffline",
    "Bid Open Date": "bidOpen",
    "Tender ID On CPPP": "cppp",
}
_DATE_KEYS = {"publishedAt", "preBid", "saleStart", "saleEnd", "bidOnline", "bidOffline", "bidOpen"}


def _table_titled(body: str, title: str) -> str | None:
    """The whole <table> whose header carries `title` (the section titles sit inside the tables)."""
    at = body.find(title)
    if at < 0:
        return None
    start = body.rfind("<table", 0, at)
    end = body.find("</table>", at)
    return body[start:end + 8] if start >= 0 and end > 0 else None


def parse_details(page: str) -> dict[str, Any]:
    """The details page: its labelled fields, the documents' names and dates, the announcements."""
    body = re.sub(r"<!--.*?-->", "", page, flags=re.S)
    body = re.sub(r"<(script|style)\b.*?</\1>", "", body, flags=re.S | re.I)
    lines = [ln.strip() for ln in htmllib.unescape(re.sub(r"<[^>]+>", "\n", body)).split("\n")]
    lines = [ln for ln in lines if ln and ln != "-->"]
    out: dict[str, Any] = {}
    labels = set(_DETAIL_LABELS)
    for k, line in enumerate(lines):
        if line in _DETAIL_LABELS and k + 1 < len(lines):
            value = lines[k + 1]
            if value in labels or value in ("Financial Instruments", "Bid Details", "Remarks", "Tender Documents"):
                value = ""
            key = _DETAIL_LABELS[line]
            if key in out:
                continue
            out[key] = _datetime(value) if key in _DATE_KEYS else (None if value in ("", "-") else value[:400])
    # the documents: the table whose header reads "Tender Documents" (file name, uploaded on)
    docs = []
    m = _table_titled(body, "Tender Documents")
    if m:
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", m, flags=re.S):
            cells = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S)]
            if len(cells) >= 2 and cells[0] and cells[0].lower() != "file":
                docs.append({"name": cells[0][:200], "uploadedAt": _datetime(cells[1])})
    out["documents"] = docs
    # the announcements: the table whose header reads "Tender Related Announcements" (s.no, title, file, uploaded on)
    notes = []
    m = _table_titled(body, "Tender Related Announcements")
    if m:
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", m, flags=re.S):
            cells = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S)]
            if len(cells) >= 4 and cells[1]:
                notes.append({"title": cells[1][:300], "uploadedAt": _datetime(cells[3])})
            elif len(cells) == 3 and cells[0]:
                notes.append({"title": cells[0][:300], "uploadedAt": _datetime(cells[2])})
    out["announcements"] = notes
    return out


# ---------------------------------------------------------------- facts read off the title


_CATEGORIES: list[tuple[str, str, str]] = [
    # (category, label, pattern on the lower-cased title), first match wins
    ("cfd", "Contract for Difference (peak supply)", r"\bcfd\b|contract for difference"),
    ("peak", "Assured peak supply (FDRE)", r"peak supply|fdre"),
    ("rtc", "Round-the-clock RE", r"round.the.clock|\brtc\b"),
    ("bess", "Battery storage (standalone BESS)", r"battery energy storage|\bbess\b|\bess\b|storage system"),
    ("hydrogen", "Green hydrogen and ammonia", r"hydrogen|ammonia"),
    ("rooftop", "Rooftop solar (RESCO)", r"rooftop|resco"),
    ("hybrid", "Wind-solar hybrid", r"hybrid"),
    ("wind", "Wind power", r"\bwind\b"),
    ("solar", "Solar power", r"\bsolar\b"),
    ("consultancy", "Consultancy, studies and services", r"consultan|detailed project report|\bdpr\b|executing agenc|pmc\b|project management"),
    ("admin", "Office, administration and other", r"office|renting|tenant|manpower|housekeeping|vehicle|insurance|audit"),
]
_CAT_LABEL = {c: label for c, label, _ in _CATEGORIES} | {"other": "Other"}


def _category(title: str) -> str:
    t = title.lower()
    for cat, _, pat in _CATEGORIES:
        if re.search(pat, t):
            return cat
    return "other"


def _mode(title: str, ref: str) -> str:
    """Who bids: a developer selling power (IPP / tariff bidding), an EPC contractor, or a service bidder."""
    t = f"{title} {ref}".lower()
    if re.search(r"design, engineering|\bepc\b|erection|commissioning and o&m|/op/", t):
        return "epc"
    if re.search(r"\brfs\b|request for selection|tariff.based|\btbcb\b|supply of energy|power developer|/ipp/|resco", t):
        return "developer"
    if re.search(r"call for proposal|\beoi\b|\brfp\b|consultan|executing agenc|/eoi/", t):
        return "services"
    return "other"


_NUM = r"(\d[\d,]*(?:\.\d+)?)"


def _capacity(title: str) -> dict[str, Any]:
    """The capacity the title states: MW, MWh, kW; and the hours when written as 'x Hrs'."""
    out: dict[str, Any] = {}
    mw = re.search(_NUM + r"\s*MW(?!h)\b", title, flags=re.I)
    mwh = re.search(_NUM + r"\s*MWh\b", title, flags=re.I)
    kw = re.search(_NUM + r"\s*kW(?!h)\b", title, flags=re.I)
    hrs = re.search(r"(\d+(?:\.\d+)?)\s*(?:hrs?|hours)\b", title, flags=re.I)
    num = lambda m: float(m.group(1).replace(",", ""))  # noqa: E731
    if mw:
        out["mw"] = num(mw)
    if mwh:
        out["mwh"] = num(mwh)
    if kw and not mw:
        out["kw"] = num(kw)
    if hrs:
        out["hours"] = num(hrs)
    return out


def _scheme(title: str) -> str | None:
    """The scheme code the title carries: SECI-FDRE-X, SECI-ESS-IV, Tranche-XXI, RTSPV T-XV, C&I-1."""
    for pat in (r"\(?(SECI-[A-Za-z&]+(?:-[A-Za-z0-9&]+)*)\)?", r"\b(RTSPV[ -]+(?:T|Tranche)[- ]*[IVXL]+)\b", r"\b(Mode-\w+-Tranche-[IVXL]+)\b", r"\b((?:SECI-)?Tranche-[IVXL]+)\b", r"\((C&I-\d+)\)"):
        m = re.search(pat, title)
        if m:
            return m.group(1).strip("()")
    return None


def facts(record: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    """What the title and the dates say on their own: category, who bids, capacity, scheme, days left."""
    today = today or date.today()
    deadline = (record.get("bidOnline") or record.get("bidDeadline") or "")[:10]
    days = (date.fromisoformat(deadline) - today).days if deadline else None
    cat = _category(record.get("title", ""))
    return {
        "category": cat,
        "categoryLabel": _CAT_LABEL[cat],
        "bidder": _mode(record.get("title", ""), record.get("ref", "")),
        "capacity": _capacity(record.get("title", "")),
        "scheme": _scheme(record.get("title", "")),
        "daysToBid": days,
    }


def fingerprint(record: dict[str, Any]) -> str:
    """A digest of what a reader would call a change: the dates, the documents, the announcements."""
    keys = ("title", "ref", "bidDeadline", "preBid", "bidOnline", "bidOffline", "bidOpen", "saleEnd", "emd", "pbg")
    basis = {k: record.get(k) for k in keys}
    basis["documents"] = sorted((d.get("name"), d.get("uploadedAt")) for d in record.get("documents", []))
    basis["announcements"] = sorted((a.get("title"), a.get("uploadedAt")) for a in record.get("announcements", []))
    return hashlib.sha256(json.dumps(basis, sort_keys=True, default=str).encode()).hexdigest()[:16]


# ---------------------------------------------------------------- the summaries


_BIDDER_WORDS = {
    "developer": "for developers: a power-supply or tariff bid",
    "epc": "for EPC contractors: build the plant for SECI",
    "services": "for consultants and service providers",
    "other": "not a power-supply bid",
}


def _human_date(iso: str | None) -> str:
    if not iso:
        return "not stated"
    d = date.fromisoformat(iso[:10])
    s = f"{d.day} {d.strftime('%b %Y')}"
    return f"{s}, {iso[11:16]}" if len(iso) > 10 and iso[11:16] != "00:00" else s


def _capacity_words(cap: dict[str, Any]) -> str:
    parts = []
    if "mw" in cap:
        parts.append(f"{cap['mw']:,.0f} MW" if cap["mw"] == int(cap["mw"]) else f"{cap['mw']:,.1f} MW")
    if "mwh" in cap:
        parts.append(f"{cap['mwh']:,.0f} MWh")
    if "kw" in cap:
        parts.append(f"{cap['kw']:,.2f} kW".replace(".00 kW", " kW"))
    if "hours" in cap and "mwh" not in cap:
        parts.append(f"{cap['hours']:g} hours a day")
    return " / ".join(parts)


def rules_summary(record: dict[str, Any], f: dict[str, Any]) -> dict[str, Any]:
    """The summary without a model: the facts and the dates in sentences."""
    cap = _capacity_words(f["capacity"])
    what = f"{f['categoryLabel']}{f', {cap}' if cap else ''}{f' ({f['scheme']})' if f['scheme'] else ''}"
    deadline = record.get("bidOnline") or record.get("bidDeadline")
    days = f["daysToBid"]
    # the date only: a count of days would go stale, as unchanged tenders keep their summary (the
    # page shows the days left, counted live)
    when = f"Bids are due {_human_date(deadline)}" + (", already closed" if days is not None and days < 0 else "")
    lines = [f"{what}; {_BIDDER_WORDS[f['bidder']]}.", f"{when}."]
    if record.get("preBid"):
        lines.append(f"Pre-bid meeting {_human_date(record['preBid'])}.")
    if record.get("bidOpen"):
        lines.append(f"Bids open {_human_date(record['bidOpen'])}.")
    watch = []
    notes = record.get("announcements") or []
    if notes:
        latest = max(notes, key=lambda a: a.get("uploadedAt") or "")
        watch.append(f"{len(notes)} announcement{'s' if len(notes) > 1 else ''} on the page; the latest: “{latest['title']}” ({_human_date(latest.get('uploadedAt'))}).")
    docs = record.get("documents") or []
    names = [d["name"] for d in docs]
    if any(re.search(r"amend|corrig|addend|clarification-?\d|pre.?bid.?clarif|revised", n, re.I) and not re.search(r"format|query", n, re.I) for n in names):
        watch.append("The document list includes an amendment, corrigendum or clarification.")
    if docs:
        watch.append(f"{len(docs)} document{'s' if len(docs) > 1 else ''} listed (not opened): {', '.join(names[:5])}{'…' if len(names) > 5 else ''}.")
    for key, label in (("emd", "EMD"), ("pbg", "PBG")):
        v = record.get(key)
        if v and not re.search(r"as per", v, re.I):
            watch.append(f"{label}: {v}.")
    relevance = "high" if f["bidder"] == "developer" and f["category"] in ("cfd", "peak", "rtc", "bess", "hybrid", "wind", "solar") else "medium" if f["bidder"] in ("developer", "epc") else "low"
    return {"summary": " ".join(lines), "watch": watch, "relevance": relevance, "by": "rules"}


class SeciTenderSummary(BaseModel):
    tender_id: str = Field(description="The tender ID exactly as given (SECI000295)")
    summary: str = Field(description="Two or three plain sentences: what is tendered, how much, who bids, by when")
    watch: list[str] = Field(default_factory=list, description="Up to four points a bid manager should act on, each one sentence, from the dates, the announcements and the document names only")
    relevance: Literal["high", "medium", "low"] = Field(description="high: a power-supply or storage bid a renewable developer would make; medium: EPC or a niche developer bid; low: services, consultancy, administration")


class SeciScanOutput(BaseModel):
    tenders: list[SeciTenderSummary]


def _model_input(record: dict[str, Any], f: dict[str, Any]) -> dict[str, Any]:
    """What Claude sees of one tender: the page's words and dates, and the facts read off the title."""
    keep = ("tenderId", "ets", "ref", "title", "description", "type", "published", "bidDeadline", "preBid", "saleStart", "saleEnd", "bidOnline", "bidOffline", "bidOpen", "fee", "rfsCost", "emd", "pbg")
    return {
        **{k: record.get(k) for k in keep if record.get(k) not in (None, "")},
        "documents": [d["name"] for d in record.get("documents", [])][:20],
        "announcements": [{"title": a["title"], "on": a.get("uploadedAt")} for a in record.get("announcements", [])][:10],
        "readOffTheTitle": {"category": f["categoryLabel"], "bidder": f["bidder"], "capacity": f["capacity"], "scheme": f["scheme"], "daysToBid": f["daysToBid"]},
    }


def claude_summaries(items: list[tuple[dict[str, Any], dict[str, Any]]], today: date, sdk: Any | None = None) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    """One model call for the tenders to summarise: {tenderId: summary}, and the call's usage."""
    from engine.extraction import llm

    payload = {"today": today.isoformat(), "tenders": [_model_input(r, f) for r, f in items]}
    blocks = [{"type": "text", "text": "The SECI tender list as scanned today, as JSON. Summarise every tender in it.\n\n" + json.dumps(payload, ensure_ascii=False, default=str)}]
    parsed, usage = llm.call("seci_scan", "v1", blocks, SeciScanOutput, max_tokens=min(16000, 900 + 450 * len(items)), sdk=sdk)
    by_id = {}
    for s in parsed.tenders:
        by_id[s.tender_id.strip()] = {"summary": s.summary.strip(), "watch": [w.strip() for w in s.watch if w.strip()][:4], "relevance": s.relevance, "by": "claude"}
    return by_id, usage


# ---------------------------------------------------------------- the scan


Fetch = Callable[[str], str]


def http_fetch(url: str) -> str:
    """GET a SECI page as text (the agent proxy and its CA bundle are honoured through the environment)."""
    import httpx

    with httpx.Client(timeout=30, follow_redirects=True, headers={"user-agent": USER_AGENT}) as client:
        res = client.get(url)
        res.raise_for_status()
        return res.text


def scan(known: dict[str, str] | None = None, summarise: bool = True, fetch: Fetch | None = None, today: date | None = None,
         use_llm: bool | None = None, sdk: Any | None = None, delay: float = PAGE_DELAY_S) -> dict[str, Any]:
    """Scan the list and every tender's details page; summarise the tenders that are new or whose
    fingerprint differs from `known` ({tenderId: fingerprint}); return them all with what changed."""
    from engine.extraction.llm import llm_available

    fetch = fetch or http_fetch
    today = today or date.today()
    known = known or {}
    started = time.monotonic()
    listing = parse_list(fetch(BASE_URL + LIST_PATH))[:MAX_TENDERS]
    records = []
    errors = []
    for k, row in enumerate(listing):
        rec = dict(row)
        rec["url"] = BASE_URL + row["detailsPath"] if row.get("detailsPath") else BASE_URL + LIST_PATH
        if row.get("detailsPath"):
            try:
                if k and delay:
                    time.sleep(delay)
                rec.update({key: v for key, v in parse_details(fetch(rec["url"])).items() if v not in (None, "") or key in ("documents", "announcements")})
            except Exception as exc:  # one page failing does not stop the scan
                errors.append(f"{row['tenderId']}: {exc}")
                rec.setdefault("documents", [])
                rec.setdefault("announcements", [])
        rec["facts"] = facts(rec, today)
        rec["fingerprint"] = fingerprint(rec)
        rec["status"] = "new" if rec["tenderId"] not in known else "changed" if known[rec["tenderId"]] != rec["fingerprint"] else "unchanged"
        records.append(rec)
    todo = [r for r in records if r["status"] != "unchanged"]
    mode = "rules"
    usage: dict[str, int] = {}
    if summarise and todo:
        use_llm = llm_available() if use_llm is None else use_llm
        summaries: dict[str, dict[str, Any]] = {}
        if use_llm or sdk is not None:
            try:
                for i in range(0, len(todo), 12):  # at most 12 tenders a call
                    part, u = claude_summaries([(r, r["facts"]) for r in todo[i:i + 12]], today, sdk=sdk)
                    summaries.update(part)
                    for key, v in u.items():
                        usage[key] = usage.get(key, 0) + v
                mode = "claude"
            except Exception as exc:
                errors.append(f"Claude could not summarise ({exc}); the rules wrote the summaries")
                summaries = {}
        for r in todo:
            r["summary"] = summaries.get(r["tenderId"]) or rules_summary(r, r["facts"])
        if mode == "claude" and any(r["summary"]["by"] == "rules" for r in todo):
            errors.append("Claude left some tenders out; the rules wrote theirs")
    return {
        "scannedAt": datetime.now().isoformat(timespec="seconds"),
        "source": BASE_URL + LIST_PATH,
        "mode": mode,
        "found": len(records),
        "new": sum(r["status"] == "new" for r in records),
        "changed": sum(r["status"] == "changed" for r in records),
        "tenders": records,
        "errors": errors,
        "usage": usage,
        "seconds": round(time.monotonic() - started, 1),
        "documentsOpened": 0,
    }
