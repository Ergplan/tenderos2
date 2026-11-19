"""The 25-year dispatch as one Excel workbook (dispatch15.run, beside the ZIP of 15-minute CSVs).

Sheets:
  About        the plant, the tariff, the losses and how to read the sheets
  Summary      one row per PPA year: energy, each supply floor, shortfall, the plants' checks
  Monthly      one row per PPA year and month: energy at the meter and at the 33 kV bus
  Year 01..NN  one row per hour of that year (8,760): the 15-minute blocks summed to MWh

Hours are summed from the 15-minute dispatch, so each year's sheet adds up to that year's summary.
The contract, delivery, sales, battery discharge and the time-block floor are at the 220 kV meter;
generation, charging and curtailment at the 33 kV bus (as in the CSVs).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import xlsxwriter

from engine.sizing import rtc_lp as RLP

HOURS = RLP.HOURS
BLOCKS_PER_HOUR = 4
DT = 1 / BLOCKS_PER_HOUR
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_OF_HOUR = np.repeat(np.arange(12), np.array(RLP.MONTH_DAYS) * 24)
DAY_OF_MONTH = np.concatenate([np.repeat(np.arange(1, d + 1), 24) for d in RLP.MONTH_DAYS])

# the hourly columns, in order: key, header, unit (MWh, or the key's own)
FIXED = [("demand", "Contracted supply")]
GEN = [("solar", "Solar output"), ("wind", "Wind output"), ("biomass", "Biomass output")]
AFTER = [
    ("charge", "Battery charging"), ("discharge", "Battery discharging"), ("soc", "Battery state of charge, end of hour"),
    ("bought", "Bought power (green market, bilateral)"),
    ("direct", "Direct to PPA"), ("delivered", "Delivered to PPA"), ("sold", "Sold in market"), ("curtailed", "Curtailed"),
    ("evacLoss", "Power transformer and line losses"), ("floor", "Time-block floor"), ("floorShort", "Short of the floor"),
    ("price", "Market price"),
]
KNOWN = {k for k, _ in FIXED + GEN + AFTER}


def hourly_of(series: dict) -> dict:
    """A year's 15-minute series as hours: energy summed to MWh, the state of charge at the hour's
    end, the price averaged."""
    out = {}
    for key, values in series.items():
        a = np.asarray(values, dtype=float).reshape(HOURS, BLOCKS_PER_HOUR)
        if key == "soc":
            out[key] = a[:, -1].astype(np.float32)
        elif key == "price":
            out[key] = a.mean(axis=1).astype(np.float32)
        else:
            out[key] = (a.sum(axis=1) * DT).astype(np.float32)
    return out


def _columns(hourly: dict) -> list[tuple[str, str, str]]:
    keys = [k for k, _ in FIXED + GEN if k in hourly and (k != "biomass" or float(hourly[k].sum()) > 0)]
    cols = [(k, h, "MWh") for k, h in FIXED + GEN if k in keys]
    cols += [(k, f"{k.capitalize()} output", "MWh") for k in hourly if k not in KNOWN]  # hydro, thermal
    for k, h in AFTER:
        if k in hourly:
            cols.append((k, h, "%" if k == "soc" else "Rs/kWh" if k == "price" else "MWh"))
    return cols


def write(path: Path, summaries: list[dict], hourly: dict[int, dict], *, sizes: dict, tariff: float, poi: float, rules: list[dict]) -> None:
    """Write the workbook. summaries: dispatch15's year summaries; hourly: year -> hourly_of(series)."""
    wb = xlsxwriter.Workbook(str(path), {"constant_memory": True})
    try:
        bold = wb.add_format({"bold": True})
        head = wb.add_format({"bold": True, "bg_color": "#E8E8E8", "text_wrap": True, "valign": "top", "border": 1})
        num = wb.add_format({"num_format": "#,##0.00"})
        num3 = wb.add_format({"num_format": "#,##0.000"})
        pct = wb.add_format({"num_format": "0.00%"})
        wrap = wb.add_format({"text_wrap": True, "valign": "top"})

        # ---- About
        ws = wb.add_worksheet("About")
        ws.set_column(0, 0, 34)
        ws.set_column(1, 1, 90)
        rows = [
            ("25-year dispatch", "Every PPA year dispatched by HiGHS in 15-minute blocks, with the plant sizes of the sizing."),
            ("Tariff", f"Rs {tariff:.4f}/kWh (year 1)"),
            ("Plant", ", ".join(f"{k} {v:,.1f}" for k, v in sizes.items() if isinstance(v, (int, float)))),
            ("Reaches the meter", f"{poi:.4%} of what is injected at the 33 kV bus (33/220 kV transformer and 220 kV line)"),
            ("Supply floors", "; ".join(f"{r['label'] or r['id']}: {r['target']:.0%} ({r['basis']}, {r['hours']} hours"
                                        + (f", {r['tol']:.0%} short free" if r.get("tol") else "")
                                        + (f", short at {r['penalty']:g} x tariff" if r.get("penalty") is not None else "") + ")" for r in rules) or "none"),
            ("Summary", "One row per PPA year: energy, each supply floor (achieved, met, blocks at the floor), shortfall, the plants' checks."),
            ("Monthly", "One row per year and month."),
            ("Year NN", "One row per hour: the four 15-minute blocks summed to MWh; state of charge at the end of the hour; price averaged."),
            ("Where energy is counted", "The contract, delivery, sales, battery discharge and the time-block floor at the 220 kV billing meter; "
                                        "generation, charging and curtailment at the 33 kV bus. The 15-minute rows are in the ZIP."),
        ]
        for i, (a, b) in enumerate(rows):
            ws.write(i, 0, a, bold)
            ws.write(i, 1, b, wrap)

        # ---- Summary
        ws = wb.add_worksheet("Summary")
        rule_ids = [r["id"] for r in summaries[0]["rules"]] if summaries else []
        plant_ids = list(summaries[0]["plants"]) if summaries else []
        cols = ["PPA year", "Delivered MU", "Contracted MU", "Annual supply"]
        cols += [f"{rid} floor achieved" for rid in rule_ids] + [f"{rid} floor met" for rid in rule_ids] + [f"{rid} blocks at the floor" for rid in rule_ids]
        cols += ["Shortfall MU", "Solar MU", "Wind MU", "Sold MU", "Curtailed MU", "Battery charged MU", "Battery discharged MU",
                 "Transformer and line losses MU", "Green share"]
        cols += [f"{pid} MU" for pid in plant_ids]
        buying = bool(summaries) and "boughtMu" in summaries[0]
        if buying:
            cols += ["Bought MU", "Bought share of the contract", "Bought cost Rs crore"]
        ws.set_row(0, 45)
        ws.set_column(0, len(cols), 13)
        for j, c in enumerate(cols):
            ws.write(0, j, c, head)
        for i, s in enumerate(summaries, start=1):
            vals = [(s["year"], None), (s["deliveredMu"], num), (s["demandMu"], num), (s["annualShare"], pct)]
            vals += [(r["achieved"], pct) for r in s["rules"]] + [("yes" if r["met"] else "NO", None) for r in s["rules"]]
            vals += [(r.get("hoursMet"), pct) for r in s["rules"]]
            vals += [(s["shortfallMu"], num3), (s["solarMu"], num), (s["windMu"], num), (s["soldMu"], num), (s["curtailedMu"], num),
                     (s["chargedMu"], num), (s["dischargedMu"], num), (s.get("evacuationLossMu", 0.0), num3), (s["greenShare"], pct)]
            vals += [(s["plants"][pid]["mu"], num) for pid in plant_ids]
            if buying:
                vals += [(s["boughtMu"], num3), (s["boughtShare"], pct), (s["boughtCostCr"], num3)]
            for j, (v, f) in enumerate(vals):
                if v is None:
                    ws.write_blank(i, j, None)
                elif f is None:
                    ws.write(i, j, v)
                else:
                    ws.write_number(i, j, float(v), f)
        ws.freeze_panes(1, 1)

        # ---- Monthly
        ws = wb.add_worksheet("Monthly")
        years = sorted(hourly)
        mcols = _columns(hourly[years[0]]) if years else []
        mcols = [c for c in mcols if c[2] == "MWh"]
        ws.set_row(0, 45)
        ws.set_column(0, 1, 9)
        ws.set_column(2, 2 + len(mcols), 14)
        ws.write(0, 0, "PPA year", head)
        ws.write(0, 1, "Month", head)
        for j, (_, h, _u) in enumerate(mcols, start=2):
            ws.write(0, j, f"{h} MU", head)
        r = 1
        for y in years:
            h = hourly[y]
            for m in range(12):
                mask = MONTH_OF_HOUR == m
                ws.write_number(r, 0, y)
                ws.write(r, 1, MONTHS[m])
                for j, (k, _h, _u) in enumerate(mcols, start=2):
                    ws.write_number(r, j, float(h[k][mask].sum()) / 1000, num3)
                r += 1
        ws.freeze_panes(1, 2)

        # ---- one sheet per year, an hour per row
        for y in years:
            h = hourly[y]
            cols_y = _columns(h)
            ws = wb.add_worksheet(f"Year {y:02d}")
            ws.set_row(0, 45)
            ws.set_column(0, 1, 9)
            ws.set_column(2, 1 + len(cols_y), 13)
            ws.write(0, 0, "Date", head)
            ws.write(0, 1, "Hour", head)
            for j, (_k, name, unit) in enumerate(cols_y, start=2):
                ws.write(0, j, f"{name} ({unit})", head)
            data = [(h[k], unit) for k, _n, unit in cols_y]
            for t in range(HOURS):
                ws.write(t + 1, 0, f"{DAY_OF_MONTH[t]:02d}-{MONTHS[MONTH_OF_HOUR[t]]}")
                ws.write(t + 1, 1, f"{t % 24:02d}:00")
                for j, (arr, unit) in enumerate(data, start=2):
                    v = float(arr[t])
                    ws.write_number(t + 1, j, v, pct if unit == "%" else num3 if unit == "Rs/kWh" else num)
            ws.freeze_panes(1, 2)
    finally:
        wb.close()
