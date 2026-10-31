"""Build docs/enterprise/FEATURES.xlsx and FEATURES.md from one list: every feature of TenderOS
Enterprise, with its team, zone and status. Run from the repository root:
    python3 tools/build_enterprise_features.py
"""
from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "enterprise"

ZONES = {
    "DMZ": "Tender intake zone: internet-facing, holds the tender documents and the cloud LLMs; no bid data",
    "Core": "Militarised zone: the client's network, TenderOS with the bid, the engine and the model; no cloud LLM",
    "Both": "Present in both zones",
}
TEAMS = {
    "Projects": "Bid inputs and assumptions: capacity, dates, tender conditions, market, the bid itself",
    "Design": "Sources, sites, co-location, losses, profiles, plant studios",
    "Finance": "Financing, tax, working capital, debt, the financial model, the quote",
    "Legal": "Tender conditions, amendments, clarifications, formats and letters",
    "Management": "Tender manager / super admin: team, roles, sign-off, submission",
    "IT": "Installation, patches, backups, access",
    "All": "Every team",
}
STATUS = {
    "Live": "In TenderOS Demo 2 today",
    "Extend": "Exists today; changes for the enterprise version",
    "Build": "New for the enterprise version",
}
PRIORITY = {"P1": "Needed for the first enterprise release", "P2": "Second release", "P3": "Later"}

# (area, feature, what it does, team, zone, status, priority, notes / where)
F = [
    # ------------------------------------------------------------ tender intake (DMZ)
    ("Tender intake", "Upload a tender", "Any power tender (PDF, Word, text, to 60 MB); the type is detected or chosen", "Legal", "DMZ", "Live", "P1", "Tender to Bid start screen"),
    ("Tender intake", "Upload a tender set", "RfS with amendments, clarifications and PPA/PSA (to 20 files): amendments applied to the RfS", "Legal", "DMZ", "Live", "P1", "engine/extraction/tenderset"),
    ("Tender intake", "LLM reading of the tender", "Every value with page and quote; sections mapped; scan screen with five agents", "Legal", "DMZ", "Live", "P1", "Claude (claude-fable-5-1) through engine/extraction; rule-based reader without a key"),
    ("Tender intake", "Table reading (Docling)", "Amendment and clarification tables through docling-serve; PyMuPDF fallback", "Legal", "DMZ", "Live", "P1", ""),
    ("Tender intake", "Scanned pages (LlamaParse)", "Pages without a text layer read through LlamaParse", "Legal", "DMZ", "Live", "P2", "Optional key"),
    ("Tender intake", "Amendments: changes was → now", "Each clause before and after, with quotes, word diff and effect", "Legal", "DMZ", "Live", "P1", ""),
    ("Tender intake", "Clarifications with verdicts", "SECI's answers linked to the clauses, accepted / refused", "Legal", "DMZ", "Live", "P1", ""),
    ("Tender intake", "Consolidated reading", "RfS fields with amendments applied and their history", "Legal", "DMZ", "Live", "P1", ""),
    ("Tender intake", "Bid formats and bid process", "Formats with blanks and context; the bid steps from registration to PPA", "Legal", "DMZ", "Live", "P1", ""),
    ("Tender intake", "Search over the tender", "BM25 search over every page of the set", "All", "DMZ", "Live", "P2", "Haystack"),
    ("Tender intake", "Curated tender packs", "A reviewed pack per tender (SECI FDRE-RTC-V): conditions, changes, clarifications, formats, every quote checked on its page", "Legal", "DMZ", "Live", "P1", "web/src/seci/seci-rtc-tm-v.json; tests/test_seci_pack.py"),
    ("Tender intake", "Pre-bid queries", "Points to raise with the issuer, each quoting the clause and page; Word file", "Legal", "DMZ", "Live", "P2", ""),
    ("Tender intake", "Tender questions by voice / chat", "Ask the extracted tender questions; answers cite document and page", "All", "DMZ", "Extend", "P2", "GPT-Live bid agent today also drives the bid; in the DMZ it answers tender questions only"),
    ("Tender intake", "CERC orders", "Tariff-adoption orders uploaded and read into facts with page and quote; SECI results as reported", "Finance", "DMZ", "Live", "P3", "Recent tenders tab"),
    ("Tender intake", "Claude connector (MCP)", "TenderOS tools in Claude: tender lookup with citations, sizing, financials, What-if", "All", "DMZ", "Extend", "P3", "Demo only; in the enterprise version limited to the tender (no bid data) or off"),
    ("Tender intake", "Review before transfer", "A reviewer confirms the reading (every value located on its page) before it is packaged for the core", "Legal", "DMZ", "Build", "P1", "Today: the reviewer ticks unlocated values in the workflow"),
    ("Tender intake", "Transfer package to the core", "The reading, the pack and the documents exported as one signed, checksummed bundle; imported inside the core", "IT", "Both", "Build", "P1", "One-way: documents in, nothing out"),
    # ------------------------------------------------------------ bid workspace
    ("Bid workspace", "Step-wise bid navigation", "One tender, one bid, steps in order with sign-off per step: Tender → Bid inputs → Design → Finance inputs → Sizing → Results → Financial model → What-if → Bid forms → Submission", "All", "Core", "Live", "P1", "SECI RTC tab: Tender → Conditions → Bid inputs (Projects) → Design → Finance inputs → Size → Financial model → What-if → Bid forms → Winning bid, each step labelled with its team; sign-off is per box (Evidence)"),
    ("Bid workspace", "Team-wise input tabs", "Projects (bid inputs and assumptions), Design and Finance each get their own input tab; each box shows who owns it and whether it is filled, evidenced and signed off", "All", "Core", "Live", "P1", "Bid inputs (Projects), Design, Finance inputs as steps of their own; the paperclip on every box shows evidence and sign-off"),
    ("Bid workspace", "Bid inputs and assumptions (Projects)", "Contracted MW, dates, supply profile and planning choices (Peak Hours, shortfall), market sale, assumptions register", "Projects", "Core", "Live", "P1", "The Bid inputs step; the assumptions register is the evidence register"),
    ("Bid workspace", "Benchmarks", "Industry benchmarks (CERC norms, market prices) fill empty inputs, marked as benchmarks until changed", "All", "Core", "Live", "P1", ""),
    ("Bid workspace", "Tender conditions checklist", "Every condition against the bid: met, failed, pending; with page and quote", "Legal", "Core", "Live", "P1", ""),
    ("Bid workspace", "Saved bids with versions", "A bid saved to the library with versions; opened later; compared", "Management", "Core", "Live", "P1", "Scenario library"),
    ("Bid workspace", "Sign-off per step and submission lock", "Each team signs off its step; the manager freezes the bid for submission; later edits make a new version", "Management", "Core", "Build", "P2", ""),
    ("Bid workspace", "Bid forms and letters", "Every RfS format filled from the bid, reviewed beside its page; letters in the RfS wording, editable; Word and PDF; the bid pack", "Legal", "Core", "Live", "P1", "SECI formats today; other tenders through their packs"),
    ("Bid workspace", "Winning bid analysis", "The auction result and a bridge from the benchmark tariff to it, lever by lever", "Management", "Core", "Live", "P3", ""),
    # ------------------------------------------------------------ design
    ("Design", "Supply sources", "Solar, wind, battery, biomass, hydro, thermal with costs, limits and fixed sizes", "Design", "Core", "Live", "P1", ""),
    ("Design", "Solar plant studio", "Layout from modules, mounting, string or central inverters; cost in ₹/Wp; writes the cost into the bid", "Design", "Core", "Live", "P2", ""),
    ("Design", "Wind farm studio", "Turbines by make, CUF at the site's wind, farm cost; writes the cost into the bid", "Design", "Core", "Live", "P2", ""),
    ("Design", "Profiles: upload and view", "Hourly solar and wind profiles uploaded; CUF, month × hour heat map, monthly CUF, a week", "Design", "Core", "Live", "P1", ""),
    ("Design", "CUF file download", "Download the profile used in the bid (as uploaded, and as scaled to the CUF entered) with its statistics", "Design", "Core", "Live", "P1", "CSV built in the browser; tools/check_cuf_file.mjs"),
    ("Design", "25-year CUF justification", "Why one year's profile stands for 25: the source and period of the data, P50/P90, degradation per year, inter-annual variability, the typical year method; a note in the bid pack", "Design", "Core", "Live", "P1", "Panel on the profile with P50/P90 inputs; Word file from POST /api/plant/justification"),
    ("Design", "Losses to the billing meter", "Each technology's stages to the 33 kV bus with where its CUF is measured; the 33/220 kV transformer and the line", "Design", "Core", "Live", "P1", ""),
    ("Design", "Separate sites", "Solar and wind on different sites, each with its own battery; no energy between them", "Design", "Core", "Live", "P1", ""),
    ("Design", "Co-located solar + BESS and wind + BESS", "Which site each battery sits on and charges from; one or two pooling stations", "Design", "Core", "Live", "P1", "One site (shared pooling station) or separate sites, each with its own battery and pooling station; the losses of each reach the sizing"),
    ("Design", "Site schematic (single-line)", "A drawing of the chosen layout: solar, wind and battery blocks, their transformers, the pooling station(s), the line to the billing meter; losses shown at each stage and summed at the pooling station", "Design", "Core", "Live", "P1", "bid/SiteSchematic.jsx: one or two pooling stations with their transformer and line losses; inputs beside the drawing"),
    ("Design", "Deviation settlement (DSM) per CERC", "Forecast error on solar and wind by block, the DSM charges under the CERC DSM Regulations (bands by % deviation, the RE schedule revision allowance), a forecasting accuracy input, the cost in the model", "Design", "Core", "Live", "P1", "src/dsm: forecast-error distribution, tolerance band by year, X factor trajectory, steps beyond the band; norms editable; verify against the notified text"),
    ("Design", "Degradation and augmentation", "Solar, wind and battery degradation; battery augmentation annual or one-time with price decline", "Design", "Core", "Live", "P1", ""),
    # ------------------------------------------------------------ sizing and dispatch
    ("Sizing", "Sizing engine", "The least-tariff plant that meets every tender condition over the PPA term; a seed from the last sizing", "Design", "Core", "Live", "P1", "Proprietary; described by its interface only"),
    ("Sizing", "Tender supply rules", "Annual, monthly and time-block floors (every 15-minute block), peak hours as planned (costliest IEX hours, any of the window, evening), shortfall at a penalty or hard", "Projects", "Core", "Live", "P1", ""),
    ("Sizing", "Market sale of surplus", "Sales on IEX (hourly DAM/G-DAM prices) or at a flat price; PPA first; buyer's first right at a share of the tariff", "Projects", "Core", "Live", "P1", ""),
    ("Sizing", "15-minute dispatch, every PPA year", "Block-wise dispatch with ramp and minimum, every floor checked, CSV/ZIP and Excel", "Design", "Core", "Live", "P1", ""),
    ("Sizing", "Dispatch sheets in Excel", "Every modelled year hour by hour as formulas; the yearly energy of the model comes from them", "Finance", "Core", "Live", "P1", ""),
    ("Sizing", "Compliance table and hourly charts", "Floors met per year, the week's dispatch, the per-hour Sankey of where energy went", "All", "Core", "Live", "P1", ""),
    # ------------------------------------------------------------ finance
    ("Finance", "Financing inputs (Finance tab)", "Target equity IRR, debt share, rate, tenor, repayment, tax, depreciation, O&M escalation, insurance, receivables, discount rate", "Finance", "Core", "Live", "P1", "The Finance inputs step of the SECI flow (and the Financials step of every tab)"),
    ("Finance", "25-year financial model", "Revenue, penalties, O&M, insurance, augmentation, depreciation (WDV/SLM), tax with loss carry-forward, debt, DSCR, IRRs, LCOE, payback", "Finance", "Core", "Live", "P1", ""),
    ("Finance", "Tariff for the target IRR", "The tariff that gives the target equity IRR; a quoted tariff's equity and project IRR with a warning below target", "Finance", "Core", "Live", "P1", ""),
    ("Finance", "Traceable model", "Every number's formula, precedents, dependents and the inputs it rests on, in the app", "Finance", "Core", "Live", "P1", ""),
    ("Finance", "Excel model with live formulas", "The whole model as Excel formulas (Live model sheet), recalculated by LibreOffice in tests to the app's numbers", "Finance", "Core", "Live", "P1", ""),
    ("Finance", "Construction phase, monthly", "Monthly model from financial closure to commissioning: drawdown schedule, equity first or pro rata, capex phasing by package, commissioning in parts", "Finance", "Core", "Live", "P1", "Months, drawdown profile (even, S-curve, front, back), equity first or pro rata; Construction sheet in Excel. Phasing by package and commissioning in parts: not built"),
    ("Finance", "Interest during construction (IDC)", "IDC computed month by month from the drawdowns and the rate, capitalised into the project cost (today a % of hard cost)", "Finance", "Core", "Live", "P1", "Month by month on the debt drawn, capitalised as debt; 0 months keeps the pre-operative % as before"),
    ("Finance", "Operations phase, yearly", "The yearly model starts at commissioning (COD) with the construction balances carried in", "Finance", "Core", "Live", "P1", "Year 1 starts at COD with the debt (incl. IDC) and equity from the construction schedule"),
    ("Finance", "Working capital", "Receivables (days), O&M stock, maintenance spares, DSM and penalty reserve; working capital loan with its own rate and margin; letter of credit cost", "Finance", "Core", "Live", "P1", "Receivable days, O&M in hand (months), spares (% of O&M), interest on the working capital, DSRA. DSM/penalty reserve and letter-of-credit cost: not built"),
    ("Finance", "Repayment methods", "Equal principal, annuity, sculpted to a target DSCR, balloon / bullet, step-up; grace period / moratorium; quarterly or yearly instalments", "Finance", "Core", "Live", "P1", "Equal, annuity, sculpted, balloon, bullet, step-up; moratorium; yearly, half-yearly, quarterly or monthly instalments; all as Excel formulas"),
    ("Finance", "Debt sculpting", "Principal shaped to hold a target DSCR each year given CFADS; minimum and average DSCR reported", "Finance", "Core", "Live", "P1", "Principal = CFADS ÷ target DSCR − interest each year; the last year clears the balance"),
    ("Finance", "Refinancing", "Refinance in a chosen year at a new rate and tenor, with fees and prepayment cost; before/after returns", "Finance", "Core", "Live", "P1", "Year, new rate, new tenor, fee on the balance; the schedule continues under the same method. Prepayment cost: use the fee"),
    ("Finance", "DSCR and lender's view", "Minimum and average DSCR, lender's IRR, DSRA, covenants flagged", "Finance", "Core", "Live", "P1", "Min/avg DSCR, DSRA, lender's IRR (What-if); DSCR below 1.1 flagged red. Covenant list: not built"),
    ("Finance", "Deviation settlement cost in the model", "The DSM charges from the Design tab as an operating cost line", "Finance", "Core", "Live", "P1", "DSM charges as an operating-cost line, a line in the year's tariff; in the Excel model as formulas"),
    ("Finance", "Money at stake", "EMD, PBG and net worth on the installed capacity", "Finance", "Core", "Live", "P1", "Per tender pack"),
    # ------------------------------------------------------------ what-if
    ("What-if", "What-if after sizing", "Opens on the sized plant: the optimum as the base case, every input as a lever", "All", "Core", "Live", "P1", "The What-if step of the SECI flow starts from the sized plant and every input of the bid"),
    ("What-if", "Tariff levers on bid day", "Set a tariff and see which levers reach it: cost, CUF, financing, IRR, storage, sale; each lever's effect on the tariff and the IRR; instant", "Management", "Core", "Live", "P1", "whatif/levers.js: each lever's tariff a step up and down, ₹/kWh per step, the move of that lever alone to reach the tariff wanted; Apply"),
    ("What-if", "Sensitivity table", "One-way and two-way sensitivities (tariff vs capex, CUF, rate) with the base case marked", "Finance", "Core", "Live", "P2", "The Sensitivity sheet of the Excel model: one-way tables and two-way grids (capex, CUF, interest rate) from full runs of the model"),
    ("What-if", "Scenario compare", "Saved what-if cases side by side with the base", "All", "Core", "Extend", "P2", "Scenario compare exists for saved bids"),
    # ------------------------------------------------------------ evidence and audit
    ("Evidence", "Evidence upload per input", "Any input (CUF, costs, financing, conditions) carries files or links as evidence: quotes, reports, data sheets; who uploaded it and when", "All", "Core", "Live", "P1", "Paperclip on every box: files, links, notes with who and when; migration 012"),
    ("Evidence", "Evidence status on every box", "Each box shows filled / evidenced / signed off; the bid pack lists the evidence register", "All", "Core", "Live", "P1", "Faint / with count / signed off at this value / signed at an older value; the register as CSV"),
    ("Evidence", "Assignments", "A data point assigned to a team or person; answer with a value, note or file; accept or return into the bid as a new version", "All", "Core", "Live", "P1", ""),
    ("Evidence", "Pings from any box (@mentions)", "A thread on every input box; mention a teammate; reply with a value; Fill in", "All", "Core", "Live", "P1", ""),
    ("Evidence", "Team setup", "People, teams, super admin, titles, the tabs they cover", "Management", "Core", "Live", "P1", ""),
    ("Evidence", "Activity and audit log", "Every sizing, export and change logged with user and time; exportable", "IT", "Core", "Extend", "P2", "Activity log today; export to build"),
    ("Evidence", "Email notifications", "Assignments and pings by email through the client's SMTP", "All", "Core", "Live", "P2", ""),
    # ------------------------------------------------------------ platform
    ("Platform", "Users, sign-in and tab access", "Accounts, administrator, tabs granted per user", "IT", "Both", "Live", "P1", ""),
    ("Platform", "Enterprise sign-in (SSO)", "The client's directory (SAML/OIDC or LDAP) for sign-in", "IT", "Core", "Build", "P2", ""),
    ("Platform", "Air-gapped installation", "Everything as an offline bundle: images, database, no outbound traffic from the core; verified checksums", "IT", "Core", "Live", "P1", "deploy/enterprise: images.tar, compose overlay with internal networks, install.sh; not run against a Docker daemon in this session"),
    ("Platform", "Patches under AMC", "Signed offline patch bundles from jouleWise, applied by the client's IT with one command, with health check and rollback; a changelog per patch", "IT", "Core", "Live", "P1", "tenderos-patch verify/apply/rollback/status on signed bundles (manifest + ECDSA signature); apply/rollback not exercised against a Docker daemon here"),
    ("Platform", "Backups and restore", "Database and files backed up on a schedule; restore tested", "IT", "Core", "Live", "P1", "deploy/backup.sh today"),
    ("Platform", "HTTPS and firewall", "TLS at the edge; allowlists", "IT", "Both", "Live", "P1", ""),
    ("Platform", "Day and night mode", "Both modes, remembered per browser", "All", "Both", "Live", "P3", ""),
    ("Platform", "Demo mode", "No sign-in; View as to switch seats", "IT", "DMZ", "Live", "P3", "Not in the core"),
]

AREAS = []
for a in [f[0] for f in F]:
    if a not in AREAS:
        AREAS.append(a)

HEAD = ["ID", "Area", "Feature", "What it does", "Team", "Zone", "Status", "Priority", "Notes / where"]


def rows():
    out = []
    n = {}
    for a, feat, what, team, zone, status, prio, notes in F:
        n[a] = n.get(a, 0) + 1
        code = "".join(w[0] for w in a.split()).upper()
        out.append([f"{code}-{n[a]:02d}", a, feat, what, team, zone, status, prio, notes])
    return out


def build_xlsx(path: Path):
    wb = Workbook()
    font = Font(name="Arial", size=10)
    bold = Font(name="Arial", size=10, bold=True)
    head_fill = PatternFill("solid", fgColor="1F3864")
    head_font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    wrap = Alignment(wrap_text=True, vertical="top")

    def sheet(ws, header, data, widths, name):
        ws.append(header)
        for c in ws[1]:
            c.font = head_font
            c.fill = head_fill
            c.alignment = Alignment(vertical="center", wrap_text=True)
            c.border = border
        for r in data:
            ws.append(r)
        for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
            for c in row:
                c.font = font
                c.alignment = wrap
                c.border = border
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = "A2"
        ref = f"A1:{get_column_letter(len(header))}{ws.max_row}"
        t = Table(displayName=name, ref=ref)
        t.tableStyleInfo = TableStyleInfo(name="TableStyleLight1", showRowStripes=True)
        ws.add_table(t)

    # README
    ws = wb.active
    ws.title = "README"
    lines = [
        ("TenderOS Enterprise: features list", bold),
        ("", font),
        ("One row per feature on the Features sheet. Columns: Area, Feature, What it does, Team (who fills it in or owns it), Zone, Status, Priority, Notes.", font),
        ("", font),
        ("Zone", bold),
    ] + [(f"{k}: {v}", font) for k, v in ZONES.items()] + [("", font), ("Status", bold)] + [(f"{k}: {v}", font) for k, v in STATUS.items()] + [("", font), ("Priority", bold)] + [(f"{k}: {v}", font) for k, v in PRIORITY.items()] + [("", font), ("Team", bold)] + [(f"{k}: {v}", font) for k, v in TEAMS.items()] + [
        ("", font),
        ("The Summary sheet counts the Features sheet with formulas; it follows any edit to a Status or Priority.", font),
        ("Source: the TenderOS Demo 2 repository (docs/*.md) for Live features; the enterprise requirements of October 2026 for Extend and Build.", font),
        ("Built by tools/build_enterprise_features.py; edit the list there and run it again, or edit this file directly.", font),
    ]
    for i, (text, f) in enumerate(lines, 1):
        c = ws.cell(row=i, column=1, value=text)
        c.font = f
        c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.column_dimensions["A"].width = 120

    # Features
    data = rows()
    sheet(wb.create_sheet("Features"), HEAD, data, [8, 14, 30, 70, 12, 8, 9, 9, 48], "Features")

    # Summary with formulas
    ws = wb.create_sheet("Summary")
    n = len(data) + 1
    ws["A1"] = "Features by area and status"
    ws["A1"].font = bold
    ws.append(["Area", "Live", "Extend", "Build", "Total"])
    for c in ws[2]:
        c.font = head_font
        c.fill = head_fill
        c.border = border
    for i, a in enumerate(AREAS, 3):
        ws.cell(row=i, column=1, value=a)
        for j, st in enumerate(STATUS, 2):
            ws.cell(row=i, column=j, value=f'=COUNTIFS(Features!$B$2:$B${n},$A{i},Features!$G$2:$G${n},{get_column_letter(j)}$2)')
        ws.cell(row=i, column=5, value=f"=SUM(B{i}:D{i})")
    tot = 3 + len(AREAS)
    ws.cell(row=tot, column=1, value="Total").font = bold
    for j in range(2, 6):
        col = get_column_letter(j)
        c = ws.cell(row=tot, column=j, value=f"=SUM({col}3:{col}{tot - 1})")
        c.font = bold
    r0 = tot + 2
    ws.cell(row=r0, column=1, value="Features by priority and status").font = bold
    ws.append([])
    ws.cell(row=r0 + 1, column=1, value="Priority")
    for j, st in enumerate(STATUS, 2):
        ws.cell(row=r0 + 1, column=j, value=st)
    ws.cell(row=r0 + 1, column=5, value="Total")
    for c in ws[r0 + 1]:
        c.font = head_font
        c.fill = head_fill
        c.border = border
    for i, p in enumerate(PRIORITY, r0 + 2):
        ws.cell(row=i, column=1, value=p)
        for j in range(2, 5):
            ws.cell(row=i, column=j, value=f'=COUNTIFS(Features!$H$2:$H${n},$A{i},Features!$G$2:$G${n},{get_column_letter(j)}${r0 + 1})')
        ws.cell(row=i, column=5, value=f"=SUM(B{i}:D{i})")
    r1 = r0 + 2 + len(PRIORITY) + 1
    ws.cell(row=r1, column=1, value="Work to do, by team (Extend + Build)").font = bold
    ws.cell(row=r1 + 1, column=1, value="Team")
    ws.cell(row=r1 + 1, column=2, value="Extend")
    ws.cell(row=r1 + 1, column=3, value="Build")
    ws.cell(row=r1 + 1, column=4, value="Total")
    for c in ws[r1 + 1][:4]:
        c.font = head_font
        c.fill = head_fill
        c.border = border
    for i, t in enumerate(TEAMS, r1 + 2):
        ws.cell(row=i, column=1, value=t)
        ws.cell(row=i, column=2, value=f'=COUNTIFS(Features!$E$2:$E${n},$A{i},Features!$G$2:$G${n},"Extend")')
        ws.cell(row=i, column=3, value=f'=COUNTIFS(Features!$E$2:$E${n},$A{i},Features!$G$2:$G${n},"Build")')
        ws.cell(row=i, column=4, value=f"=B{i}+C{i}")
    for row in ws.iter_rows(min_row=3, max_row=ws.max_row):
        for c in row:
            if c.font != bold and c.font != head_font:
                c.font = font
    for col, w in zip("ABCDE", [34, 10, 10, 10, 10]):
        ws.column_dimensions[col].width = w

    # Teams and tabs
    ws = wb.create_sheet("Teams and steps")
    steps = [
        ("1 Tender", "The reading, the conditions, amendments, clarifications, formats (from the DMZ package)", "Legal", "Review and sign off the conditions"),
        ("2 Bid inputs", "Contracted MW, dates, supply profile, planning choices, market sale, assumptions register", "Projects", "Every input evidenced and signed off"),
        ("3 Design", "Sources, sites and co-location, schematic and losses, profiles with CUF files and the 25-year justification, DSM inputs, studios", "Design", "Sign off the design"),
        ("4 Finance inputs", "Financing, construction schedule and IDC, working capital, repayment and sculpting, refinancing, tax", "Finance", "Sign off the financing case"),
        ("5 Sizing", "The sizing engine on the signed-off inputs; a seed from the last run", "Design", "Run; re-run after a change"),
        ("6 Results", "The plant, the compliance table, dispatch charts, the 15-minute dispatch", "All", "Review"),
        ("7 Financial model", "Monthly construction then yearly operations; the traceable model; Excel with formulas", "Finance", "Review; sign off the model"),
        ("8 What-if", "The sized plant as the base case; levers to reach a tariff on bid day; sensitivities", "Management", "Decide the tariff"),
        ("9 Bid forms", "Formats filled and reviewed, letters, the bid pack, the evidence register", "Legal", "Review each format"),
        ("10 Submission", "The bid frozen as a version; what was submitted, by whom, when", "Management", "Freeze"),
    ]
    sheet(ws, ["Step", "What is on it", "Owner", "Gate"], [list(s) for s in steps], [18, 90, 14, 40], "Steps")

    wb.save(path)


def build_md(path: Path):
    data = rows()
    out = ["# TenderOS Enterprise: features list", "",
           "One row per feature. Live: in Demo 2 today. Extend: exists, changes for the enterprise version. Build: new. "
           "Zone: DMZ (tender intake, cloud LLMs, no bid data), Core (the client's militarised zone, no cloud LLM), Both. "
           "The same list is `FEATURES.xlsx` (with counts); both come from `tools/build_enterprise_features.py`.", ""]
    for a in AREAS:
        out += [f"## {a}", "", "| ID | Feature | What it does | Team | Zone | Status | Priority | Notes |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
        for r in data:
            if r[1] == a:
                out.append("| " + " | ".join(str(x).replace("|", "\\|") for x in [r[0], r[2], r[3], r[4], r[5], r[6], r[7], r[8]]) + " |")
        out.append("")
    counts = {s: sum(1 for r in data if r[6] == s) for s in STATUS}
    out += ["## Counts", "", "| Status | Features |", "| --- | --- |"] + [f"| {s} | {c} |" for s, c in counts.items()] + [f"| Total | {len(data)} |", ""]
    path.write_text("\n".join(out))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    build_xlsx(OUT / "FEATURES.xlsx")
    build_md(OUT / "FEATURES.md")
    print(f"{len(F)} features → {OUT / 'FEATURES.xlsx'}, {OUT / 'FEATURES.md'}")
