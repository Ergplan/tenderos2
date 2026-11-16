"""The daily market scan behind the demo site: developer (IPP) tenders at SECI and NHPC.

    python3 site/scan.py            writes site/data-src/market-scan.json

What it reads, and nothing else (no tender document is ever opened):

* SECI: the tender list (www.seci.co.in/tenders), each tender's details page, and the list of
  result notices (www.seci.co.in/tenders/results), through the application's own parser
  (engine/market/seci_tenders.py), so the site and the application read SECI the same way;
* NHPC: the tender list (www.nhpcindia.com/welcome/tender) and, for the developer tenders in it,
  each tender's details page with its corrigenda.

What it reports, against the snapshot of the previous run kept in the same file:

* a tender seen for the first time, an amendment or corrigendum newly listed on a tender's page,
  a bid deadline that moved, a tender that left the list, a result notice newly published.

The first run has nothing to compare with: it dates the feed from the pages themselves (tenders
published and amendments uploaded in the last fourteen days). Needs `curl`, and `pydantic` for the
application's parser; no key, no model.
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from engine.market import seci_tenders as S  # noqa: E402  (the application's SECI parser)

OUT = Path(__file__).resolve().parent / "data-src" / "market-scan.json"
UA = "TenderOS tender scanner (reads public tender lists and details pages only)"
NHPC = "https://www.nhpcindia.com"
RECENT_DAYS = 14
AMENDMENT = re.compile(r"(?i)amend|corrig|addend|clarif|extension|revised")
# an NHPC tender for developers: a selection of developers or a tariff bid, not works or supplies
NOT_AMENDMENT = re.compile(r"(?i)format|query|integrity")
pretty = lambda n: re.sub(r"\s+", " ", re.sub(r"(?i)[-_ ]*final[-_ ]*upload\d*|\.(pdf|zip|docx?|xlsx?)$", "", n).replace("_", " ")).strip()
NHPC_IPP = re.compile(r"(?i)\bRfS\b|request for selection|selection of [^.]{0,60}developer|\bdevelopers? for\b|tariff[- ]based|\bFDRE\b|firm and dispatchable|\bISTS\b")
NHPC_LOOK = 400  # the newest entries of NHPC's list (it carries every tender since 2021)
NHPC_DETAILS = 12


def fetch(url: str) -> str:
    out = subprocess.run(["curl", "-sS", "-L", "-m", "60", "--retry", "4", "--retry-all-errors", "--retry-delay", "3", "-A", UA, url], capture_output=True, text=True, errors="ignore")
    if out.returncode != 0 or len(out.stdout) < 500:
        raise RuntimeError(f"{url}: {out.stderr.strip() or 'empty page'}")
    return out.stdout


clean = lambda s: html.unescape(html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)))).strip()
dmy = lambda s: datetime.strptime(s, "%d-%m-%Y").date().isoformat() if s else None
day = lambda s: (s or "")[:10] or None


def scan_seci(today: date) -> tuple[list[dict], list[dict]]:
    tenders = []
    for k, row in enumerate(S.parse_list(fetch(S.BASE_URL + S.LIST_PATH))[: S.MAX_TENDERS]):
        rec = dict(row)
        rec["url"] = S.BASE_URL + row["detailsPath"] if row.get("detailsPath") else S.BASE_URL + S.LIST_PATH
        if row.get("detailsPath"):
            if k:
                time.sleep(S.PAGE_DELAY_S)
            try:
                rec.update({key: v for key, v in S.parse_details(fetch(rec["url"])).items() if v not in (None, "") or key in ("documents", "announcements")})
            except RuntimeError as exc:  # one details page failing: keep the list's row
                print(f"scan: {exc}", file=sys.stderr)
        f = S.facts(rec, today)
        docs = rec.get("documents") or []
        tenders.append({
            "source": "SECI", "id": rec["tenderId"], "ref": rec.get("ref"), "title": rec["title"], "url": rec["url"],
            "published": day(rec.get("published") or rec.get("publishedAt")), "bidDeadline": day(rec.get("bidDeadline")), "bidOpen": day(rec.get("bidOpen")),
            "category": f.get("category"), "categoryLabel": f.get("categoryLabel"), "capacity": f.get("capacity") or {}, "scheme": f.get("scheme"),
            "ipp": f.get("bidder") == "developer", "summary": S.rules_summary(rec, f)["summary"], "documents": len(docs),
            "amendments": [{"name": pretty(d["name"]), "date": day(d.get("uploadedAt"))} for d in docs if AMENDMENT.search(d.get("name", "")) and not NOT_AMENDMENT.search(d.get("name", ""))],
            "fingerprint": S.fingerprint(rec),
        })
    results = []
    page = fetch(S.BASE_URL + "/tenders/results")
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [clean(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        link = re.search(r'href="(/tender-details/[^"]+)"', row)
        if len(cells) >= 8 and re.match(r"SECI\d+", cells[1]):
            results.append({"source": "SECI", "id": cells[1], "ref": cells[4], "title": cells[5], "url": S.BASE_URL + (link.group(1) if link else "/tenders/results")})
    return tenders, results


def scan_nhpc(today: date) -> list[dict]:
    page = fetch(f"{NHPC}/welcome/tender")
    items = []
    for box in page.split('class="media-release-box"')[1 : NHPC_LOOK + 1]:
        title = re.search(r"Tender Title\s*:\s*</strong>(.*?)</p>", box, re.S)
        nit = re.search(r"NIT No\.\s*:(.*?)</strong>", box, re.S)
        ident = re.search(r"tender_detail/(\d+)", box)
        if title and ident and NHPC_IPP.search(clean(title.group(1))):
            items.append({"id": ident.group(1), "title": clean(title.group(1)), "ref": clean(nit.group(1)) if nit else None})
    tenders = []
    for item in items[:NHPC_DETAILS]:
        time.sleep(0.4)
        url = f"{NHPC}/welcome/tender_detail/{item['id']}"
        body = fetch(url)
        body = body[body.find("main-content"):]
        text = clean(body)
        dates = re.search(r"Bid Submission Start Date Bid Submission End Date (\d\d-\d\d-\d{4}) (\d\d-\d\d-\d{4}) Bid Opening Date (\d\d-\d\d-\d{4})", text)
        start, end, opening = (dmy(x) for x in dates.groups()) if dates else (None, None, None)
        if end and end < today.isoformat():
            continue  # closed
        corr = []
        at = body.find("Corrigendum List")
        if at > 0:
            for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body[at:], re.S):
                cells = [clean(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
                if len(cells) >= 5 and re.match(r"\d\d-\d\d-\d{4}", cells[4]):
                    corr.append({"name": cells[2] or cells[3], "date": dmy(cells[4])})
        rec = {"tenderId": f"NHPC{item['id']}", "ref": item["ref"] or "", "title": item["title"], "published": start, "bidDeadline": end, "bidOpen": opening, "documents": [], "announcements": []}
        f = S.facts(rec, today)
        cap = f.get("capacity") or {}
        what = f.get("categoryLabel") or "Renewable energy"
        if re.search(r"(?i)solar", item["title"]) and re.search(r"(?i)BESS|storage", item["title"]):
            f["category"], what = "solar+ess", "Solar with battery storage"
        size = f"{cap['mw']:,.0f} MW" if cap.get("mw") else ""
        tenders.append({
            "source": "NHPC", "id": item["id"], "ref": item["ref"], "title": item["title"], "url": url, "published": start, "bidDeadline": end, "bidOpen": opening,
            "category": f.get("category"), "categoryLabel": what, "capacity": cap, "scheme": f.get("scheme"), "ipp": True,
            "summary": f"{what}{', ' + size if size else ''}; for developers: a power-supply or tariff bid." + (f" {len(corr)} corrigend{'um' if len(corr) == 1 else 'a'} on the page." if corr else ""),
            "documents": 1, "amendments": corr, "fingerprint": f"{end}|{len(corr)}|{item['title']}",
        })
    return tenders


def main() -> None:
    today = date.today()
    prev = json.loads(OUT.read_text()) if OUT.exists() else None
    errors, tenders, results = [], [], []
    try:
        t, results = scan_seci(today)
        tenders += t
    except Exception as exc:  # one source failing does not lose the other
        errors.append(f"SECI: {exc}")
    try:
        tenders += scan_nhpc(today)
    except Exception as exc:
        errors.append(f"NHPC: {exc}")
    if not tenders:
        raise SystemExit("scan: nothing read from SECI or NHPC; the previous snapshot is kept\n" + "\n".join(errors))

    key = lambda t: f"{t['source']}:{t['id']}"
    before = {key(t): t for t in (prev or {}).get("tenders", [])}
    failed = {e.split(":")[0] for e in errors}
    events, recent = [], (today - timedelta(days=RECENT_DAYS)).isoformat()
    name = lambda t: t.get("scheme") or (t["title"][:70] + ("…" if len(t["title"]) > 70 else ""))
    ev = lambda d, t, kind, detail: events.append({"date": d, "source": t["source"], "id": t["id"], "tender": name(t), "kind": kind, "detail": detail, "url": t["url"]})
    for t in tenders:
        old = before.get(key(t))
        t["firstSeen"] = (old or {}).get("firstSeen") or (t.get("published") if prev is None else today.isoformat()) or today.isoformat()
        if prev is None:  # the first run: dated from the pages
            if (t.get("published") or "") >= recent:
                ev(t["published"], t, "new tender", t["summary"].split(" Bids are due")[0])
            for a in t["amendments"]:
                if (a.get("date") or "") >= recent:
                    ev(a["date"], t, "amendment", a["name"])
        elif old is None:
            ev(today.isoformat(), t, "new tender", t["summary"].split(" Bids are due")[0])
        else:
            seen = {a["name"] for a in old.get("amendments", [])}
            for a in t["amendments"]:
                if a["name"] not in seen:
                    ev(a.get("date") or today.isoformat(), t, "amendment", a["name"])
            if old.get("bidDeadline") and t.get("bidDeadline") and old["bidDeadline"] != t["bidDeadline"]:
                ev(today.isoformat(), t, "deadline moved", f"{old['bidDeadline']} → {t['bidDeadline']}")
        last = max([a["date"] for a in t["amendments"] if a.get("date")] or [""])
        t["status"] = "new" if t["firstSeen"] >= recent and (t.get("published") or t["firstSeen"]) >= recent else "amended" if last >= recent else "open"
        t["lastAmendment"] = last or None
        t["daysToBid"] = (date.fromisoformat(t["bidDeadline"]) - today).days if t.get("bidDeadline") else None
    if prev is not None:
        now = {key(t) for t in tenders}
        for k, old in before.items():
            if k not in now and old["source"] not in failed:
                ev(today.isoformat(), old, "closed", "no longer on the list of open tenders")
        if "SECI" in failed:  # keep yesterday's SECI rows rather than show none
            tenders += [t for t in prev["tenders"] if t["source"] == "SECI"]
        if "NHPC" in failed:
            tenders += [t for t in prev["tenders"] if t["source"] == "NHPC"]
        known = {r["id"] for r in prev.get("results", [])}
        if results:
            for r in results:
                if r["id"] not in known:
                    events.append({"date": today.isoformat(), "source": "SECI", "id": r["id"], "tender": r["title"][:90], "kind": "result notice", "detail": "result notice published", "url": r["url"]})
        else:
            results = prev.get("results", [])
    history = [e for e in (prev or {}).get("events", []) if (e["date"], e["id"], e["kind"], e["detail"]) not in {(x["date"], x["id"], x["kind"], x["detail"]) for x in events}]
    events = sorted(events + history, key=lambda e: e["date"], reverse=True)[:80]
    tenders.sort(key=lambda t: (t.get("bidDeadline") or "9999", t["source"]))
    out = {
        "scannedAt": datetime.now().isoformat(timespec="seconds"), "sources": [S.BASE_URL + S.LIST_PATH, S.BASE_URL + "/tenders/results", f"{NHPC}/welcome/tender"],
        "documentsOpened": 0, "errors": errors, "tenders": tenders, "results": results, "events": events,
        "counts": {"tenders": len(tenders), "ipp": sum(1 for t in tenders if t["ipp"]), "seci": sum(1 for t in tenders if t["source"] == "SECI"), "nhpc": sum(1 for t in tenders if t["source"] == "NHPC"), "newToday": sum(1 for e in events if e["date"] == today.isoformat())},
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    c = out["counts"]
    print(f"scan: {c['tenders']} open tenders ({c['seci']} SECI, {c['nhpc']} NHPC; {c['ipp']} for developers), {len(results)} SECI result notices, {c['newToday']} events today, {len(events)} in the feed" + (f"; errors: {errors}" if errors else ""))


if __name__ == "__main__":
    main()
