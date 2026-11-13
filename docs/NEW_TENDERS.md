# New tenders (SECI scan)

A workspace tab (`newTenders`, "New tenders") that keeps SECI's open tenders in view: the engine
reads SECI's tender list and each tender's details page, and a summary of every tender is written
from those pages alone. **No tender document is downloaded or read**: the RfS, the PPA and the
amendments stay on SECI's site, and the summaries say nothing a document alone holds.

## What is read

| Page | Fields |
| --- | --- |
| `www.seci.co.in/tenders` (the `#tender-list` table) | Tender ID, ETS code, reference, title, publication date, bid deadline, the details link |
| `/tender-details/<id>` | Tender type and description; tender fee, cost of RfS, EMD and PBG wording; publication, pre-bid, document sale, online and offline bid deadlines and bid opening, to the minute; the documents' **names and upload dates**; the announcements' titles and dates (pre-bid notices, corrigenda, extensions) |

Rules read off the title (`facts`): the category (CfD, FDRE peak, RTC, standalone BESS, green
hydrogen and ammonia, rooftop RESCO, hybrid, wind, solar, consultancy, administration), who bids
(developer at a tariff, EPC contractor, services), the capacity (MW, MWh, kW, hours a day), the
scheme code (SECI-FDRE-X, SECI-ESS-IV, Tranche-XXI, RTSPV T-XV, C&I-1, Mode-2A-Tranche-II) and the
days to the bid deadline.

## The summary

* **Claude** (`engine/extraction/prompts/seci_scan/v1.md`, output `SeciScanOutput`) when the
  Anthropic key is set (Administration › API keys, or `ANTHROPIC_API_KEY` on the engine): two or
  three sentences (what, how much, who bids, by when), up to four points to act on (an
  announcement, a pre-bid ahead, a deadline within 14 days, an amendment among the document
  names, an EMD figure the page states) and a relevance (high, medium, low). At most 12 tenders a
  call. The prompt forbids stating a term only the documents hold.
* **Rules** otherwise, or for a tender Claude left out: the facts and the dates in sentences.

Only tenders that are **new** or whose **fingerprint** changed (dates, EMD/PBG wording, the
document list, the announcements) are summarised again; the rest keep their summary. A tender that
leaves SECI's list is kept and marked "no longer listed".

## Where it lives

| Part | File |
| --- | --- |
| Scan, parse, facts, fingerprint, summaries | `engine/market/seci_tenders.py`; route `POST /api/market/seci-scan` (`{known: {tenderId: fingerprint}}`) |
| Prompt | `engine/extraction/prompts/seci_scan/v1.md` |
| Storage | `web/db/migrations/018_seci_scan.sql`: `seci_tenders` (one row per tender), `seci_scans` (the log) |
| Server | `web/lib/seciScan.js`; `GET /api/market/seci`, `POST /api/market/seci/scan` |
| Page | `web/src/market/NewTendersTab.jsx`, `newTenders.css` |
| MCP tool | `seci_new_tenders` in `web/lib/mcp.js`: a connected Claude session lists the tenders, scans first when asked or when the last scan is over 12 hours old |
| Tests | `tests/engine/test_seci_scan.py` (saved pages in `tests/engine/fixtures/seci/`), `tests/e2e/test_new_tenders.py` (the live site) |

## Behaviour

* The page scans by itself when nobody has scanned for 12 hours; **Scan SECI now** scans at once
  (about a minute: the list, then each details page 0.4 s apart).
* Filters: all open, new or changed, closing in 14 days, for developers, no longer listed.
* Zones: the scan needs the internet and a cloud model, so it runs in the intake zone (and in a
  single installation); the core zone refuses it (`web/lib/zone.js`).
* Access: the `newTenders` tab, granted like any other tab; administrators see it.
