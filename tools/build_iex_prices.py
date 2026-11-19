"""Build the app's IEX price year from IEX 15-minute market files (GDAM, DAM, RTM).

    python3 tools/build_iex_prices.py --gdam GDAM_15min.xlsx --dam DAM_15min.xlsx --rtm RTM_15min.xlsx

Each file is IEX's 15-minute market result as exported (sheet "15min"): Date (YYYY-MM-DD), Time Block
("00:00 - 00:15"), Hour, the bids and volumes, and "MCP (₹/MWh)". Writes:

* web/public/market/iex_15min_prices.json: a calendar year of 35,040 blocks (1 Jan 00:00 to 31 Dec
  23:45) per market, the market-clearing price in Rs/MWh; and GDAM's cleared volume (MW);
* web/public/market/iex_hourly_prices.json: the same year as 8,760 hours (the mean of each hour's four
  blocks), with the means by month and hour of day, in the shape the app has always read.

The year: each day of a 365-day calendar year is taken from the latest year with data for that day
(29 February is left out). A block with no price takes the same block of the nearest day that has one
(counted in blocksFilled).
"""
from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "market"
LABELS = {"GDAM": "Green Day-Ahead Market", "DAM": "Day-Ahead Market", "RTM": "Real-Time Market"}
MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def read(path: Path) -> tuple[dict, dict]:
    """{date: [96 prices or None]}, {date: [96 cleared MW or None]} from one IEX 15-minute export."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["15min"] if "15min" in wb.sheetnames else wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    head = [str(h or "").strip() for h in next(rows)]
    i_date, i_block = head.index("Date"), head.index("Time Block")
    i_mcp = next(i for i, h in enumerate(head) if h.startswith("MCP"))
    i_mcv = next((i for i, h in enumerate(head) if h.startswith("Total MCV") or h.startswith("MCV")), None)
    prices: dict = {}
    mcv: dict = {}
    for r in rows:
        if not r or r[i_date] is None:
            continue
        d = r[i_date] if isinstance(r[i_date], date) else date.fromisoformat(str(r[i_date])[:10])
        start = str(r[i_block]).split("-")[0].strip()
        hh, mm = (int(x) for x in start.split(":"))
        k = hh * 4 + mm // 15
        prices.setdefault(d, [None] * 96)[k] = float(r[i_mcp]) if r[i_mcp] not in (None, "") else None
        if i_mcv is not None:
            mcv.setdefault(d, [None] * 96)[k] = float(r[i_mcv]) if r[i_mcv] not in (None, "") else None
    return prices, mcv


def calendar_year(days: dict) -> tuple[list[float], dict, int]:
    """35,040 blocks of a 365-day year, each day from the latest year with data for it."""
    have = sorted(days)
    by_md: dict = {}
    for d in have:
        by_md[(d.month, d.day)] = d  # sorted, so the latest year wins
    out: list = []
    from_year: dict = {}
    filled = 0
    for m, n in enumerate(MONTH_DAYS, start=1):
        for day in range(1, n + 1):
            d = by_md.get((m, day))
            if d is None:
                raise SystemExit(f"no data for {m:02d}-{day:02d}: the files must cover a whole year")
            from_year[str(d.year)] = from_year.get(str(d.year), 0) + 1
            vals = list(days[d])
            for k in range(96):
                if vals[k] is None:  # the same block of the nearest day that has it
                    for step in range(1, 30):
                        for dd in (d - timedelta(days=step), d + timedelta(days=step)):
                            v = days.get(dd, [None] * 96)[k]
                            if v is not None:
                                vals[k] = v
                                break
                        if vals[k] is not None:
                            break
                    filled += 1
            out.extend(vals)
    return out, from_year, filled


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--gdam", required=True, type=Path)
    ap.add_argument("--dam", required=True, type=Path)
    ap.add_argument("--rtm", required=True, type=Path)
    a = ap.parse_args()
    blocks_out = {"unit": "Rs/MWh", "blocks": 35040,
                  "year": "calendar year of 35,040 15-minute blocks (1 Jan 00:00 to 31 Dec 23:45); each day from the latest year with data",
                  "markets": {}}
    hourly_out = {"unit": "Rs/MWh",
                  "year": "calendar year of 8,760 hours (1 Jan 00:00 to 31 Dec 23:00), the mean of each hour's four 15-minute blocks; each day from the latest year with data",
                  "markets": {}}
    for key, path in (("GDAM", a.gdam), ("DAM", a.dam), ("RTM", a.rtm)):
        prices, mcv = read(path)
        first, last = min(prices), max(prices)
        blocks, from_year, filled = calendar_year(prices)
        hours = [sum(blocks[h * 4:h * 4 + 4]) / 4 for h in range(8760)]
        month_of_hour = [m for m, n in enumerate(MONTH_DAYS) for _ in range(n * 24)]
        monthly = [round(sum(v for v, m in zip(hours, month_of_hour) if m == k) / (MONTH_DAYS[k] * 24)) for k in range(12)]
        by_hour = [round(sum(hours[h::24]) / 365) for h in range(24)]
        meta = {"label": LABELS[key], "source": f"IEX {key} 15-minute market-clearing price (MCP), {first} to {last}",
                "from": str(first), "to": str(last), "days": len(prices), "daysFromYear": dict(sorted(from_year.items())), "blocksFilled": filled}
        blocks_out["markets"][key] = {**meta, "meanRsPerMwh": round(sum(blocks) / len(blocks)), "minRsPerMwh": round(min(blocks)),
                                      "maxRsPerMwh": round(max(blocks)), "blocksRsPerMwh": [round(v, 1) for v in blocks]}
        hourly_out["markets"][key] = {**meta, "daysFilled": [], "meanRsPerMwh": round(sum(hours) / 8760), "minRsPerMwh": round(min(hours)),
                                      "maxRsPerMwh": round(max(hours)), "monthlyMeanRsPerMwh": monthly, "hourOfDayMeanRsPerMwh": by_hour,
                                      "hourlyRsPerMwh": [round(v) for v in hours]}
        if key == "GDAM" and mcv:
            mblocks, _, _ = calendar_year(mcv)
            mh = [sum(mblocks[h * 4:h * 4 + 4]) / 4 for h in range(8760)]
            hourly_out["markets"][key]["meanMcvMw"] = round(sum(mh) / 8760)
            hourly_out["markets"][key]["hourlyMcvMw"] = [round(v) for v in mh]
            blocks_out["markets"][key]["blocksMcvMw"] = [round(v, 1) for v in mblocks]
        print(f"{key}: {first} to {last}, {len(prices)} days; year from {from_year}; {filled} blocks filled; "
              f"mean Rs {sum(blocks) / len(blocks):,.0f}/MWh, min {min(blocks):,.0f}, max {max(blocks):,.0f}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "iex_15min_prices.json").write_text(json.dumps(blocks_out, separators=(",", ":")))
    (OUT / "iex_hourly_prices.json").write_text(json.dumps(hourly_out, separators=(",", ":")))
    for f in ("iex_15min_prices.json", "iex_hourly_prices.json"):
        print(f, f"{(OUT / f).stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
