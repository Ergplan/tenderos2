#!/usr/bin/env python3
"""Generate docs/dev/DATABASE.md from the live Postgres database and the code.

    DATABASE_URL=postgres://... python3 tools/gen_db_doc.py          # writes docs/dev/DATABASE.md
    DATABASE_URL=postgres://... python3 tools/gen_db_doc.py --check  # exits 1 when the committed file is stale

The schema (tables, columns, keys, indexes, cascades) is read from the database's own catalog
(pg_catalog / information_schema), so it cannot drift from what is deployed. The rest is read
from the repository: which migration created or changed each table (web/db/migrations), and which
server code writes and reads it (SQL in web/lib/*.js, web/app/api/**/route.js, web/app/**/page.js,
web/instrumentation.js), with the API routes that reach that code through its imports. The prose
(purpose of each table, the JSON documents in jsonb columns, what lives outside the database) is
kept in this script and was checked against the code it cites.

Needs the psycopg (3) or psycopg2 module when one is installed; otherwise the psql CLI.
No third-party dependency is required.
"""
from __future__ import annotations

import csv
import io
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "dev" / "DATABASE.md"
MIGRATIONS = ROOT / "web" / "db" / "migrations"

# ----------------------------------------------------------------------------- database access


def run_sql(sql: str) -> list[dict]:
    """Rows of a query as dicts of strings (arrays as Postgres text, e.g. '{a,b}')."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set")
    try:
        import psycopg  # type: ignore

        with psycopg.connect(url) as conn, conn.cursor() as cur:
            cur.execute(sql)
            cols = [d[0] for d in cur.description]
            return [{c: _text(v) for c, v in zip(cols, row)} for row in cur.fetchall()]
    except ImportError:
        pass
    try:
        import psycopg2  # type: ignore

        conn = psycopg2.connect(url)
        try:
            cur = conn.cursor()
            cur.execute(sql)
            cols = [d[0] for d in cur.description]
            return [{c: _text(v) for c, v in zip(cols, row)} for row in cur.fetchall()]
        finally:
            conn.close()
    except ImportError:
        pass
    res = subprocess.run(
        ["psql", url, "-X", "-v", "ON_ERROR_STOP=1", "--csv", "-c", sql],
        capture_output=True, text=True, check=False,
    )
    if res.returncode != 0:
        sys.exit(f"psql failed: {res.stderr.strip()}")
    return list(csv.DictReader(io.StringIO(res.stdout)))


def _text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "t" if v else "f"
    if isinstance(v, (list, tuple)):
        return "{" + ",".join(str(x) for x in v) + "}"
    return str(v)


def pg_array(text: str) -> list[str]:
    text = (text or "").strip()
    if not text or text == "{}":
        return []
    return [x.strip('"') for x in text.strip("{}").split(",")]


def read_schema() -> dict:
    tables = [r["table_name"] for r in run_sql(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")]
    cols = run_sql(
        """SELECT c.relname AS table_name, a.attname AS name, a.attnum AS pos, format_type(a.atttypid, a.atttypmod) AS type,
                  t.typname AS udt, a.attnotnull AS notnull, pg_get_expr(d.adbin, d.adrelid) AS dflt
             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_type t ON t.oid = a.atttypid
             LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY c.relname, a.attnum""")
    cons = run_sql(
        """SELECT c.relname AS table_name, con.conname AS name, con.contype AS kind, pg_get_constraintdef(con.oid) AS def,
                  (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                     JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols,
                  fc.relname AS ref_table,
                  (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                     JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS ref_cols,
                  con.confdeltype AS on_delete
             FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
             LEFT JOIN pg_class fc ON fc.oid = con.confrelid
            WHERE n.nspname = 'public' ORDER BY c.relname, con.contype, con.conname""")
    idx = run_sql("SELECT tablename AS table_name, indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2")
    applied = [r["name"] for r in run_sql("SELECT name FROM schema_migrations ORDER BY name")] if "schema_migrations" in tables else []
    by_table: dict[str, dict] = {t: {"columns": [], "constraints": [], "indexes": []} for t in tables}
    for r in cols:
        by_table[r["table_name"]]["columns"].append(r)
    for r in cons:
        r["cols"] = pg_array(r["cols"])
        r["ref_cols"] = pg_array(r["ref_cols"])
        by_table[r["table_name"]]["constraints"].append(r)
    for r in idx:
        by_table[r["table_name"]]["indexes"].append(r)
    return {"tables": tables, "by_table": by_table, "applied": applied}


# ----------------------------------------------------------------------------- migrations


def read_migrations() -> dict:
    """For each table: the migration that created it and the ones that altered it; per migration its head comment."""
    created: dict[str, str] = {}
    changed: dict[str, list[str]] = defaultdict(list)
    heads: dict[str, str] = {}
    for f in sorted(MIGRATIONS.glob("*.sql")):
        text = f.read_text(encoding="utf-8")
        head = []
        for line in text.splitlines():
            if line.startswith("--"):
                head.append(line[2:].strip())
            elif line.strip():
                break
        heads[f.name] = " ".join(head)
        for m in re.finditer(r"CREATE TABLE IF NOT EXISTS (\w+)", text):
            created.setdefault(m.group(1), f.name)
        for m in re.finditer(r"ALTER TABLE (\w+)", text):
            if f.name not in changed[m.group(1)]:
                changed[m.group(1)].append(f.name)
        for m in re.finditer(r"CREATE INDEX IF NOT EXISTS \w+ ON (\w+)", text):
            if created.get(m.group(1)) != f.name and f.name not in changed[m.group(1)]:
                changed[m.group(1)].append(f.name)
    return {"created": created, "changed": changed, "heads": heads}


# ----------------------------------------------------------------------------- code scan

SQL_WRITE = re.compile(r"\b(INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE IF NOT EXISTS)\s+([a-z_]+)")
SQL_READ = re.compile(r"\b(FROM|JOIN)\s+([a-z_]+)")
FUNC_HEAD = re.compile(r"^(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(|^(?:export\s+)?const\s+(\w+)\s*=\s*(?:handler\()?(?:async\b|\()")
LIB_IMPORT = re.compile(r"import\s*\{([^}]*)\}\s*from\s*[\"'](?:@/lib/|\./|\.\./lib/|\.\./\.\./lib/|\.\./\.\./\.\./lib/|\.\./\.\./\.\./\.\./lib/)(\w+)(?:\.js)?[\"']")
CONST_SQL = re.compile(r"^(?:export )?const (\w+) = `((?:[^`\\]|\\.)*)`;", re.M)
# auth helpers that read `users` on every request: listed once in the users section, not per route
AUTH_READERS = {"currentUser", "currentUserWithAccess", "requireUser", "userCount"}
ROUTE_METHOD = re.compile(r"^export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b", re.M)


def scan_code(tables: set[str]) -> dict:
    """Which functions in which files write / read each table, directly or through the lib functions they call."""
    files = sorted(
        [*ROOT.glob("web/lib/*.js"), *ROOT.glob("web/app/api/**/route.js"), *ROOT.glob("web/app/**/page.js"), ROOT / "web" / "instrumentation.js"]
    )
    funcs: dict[tuple[str, str], dict] = {}  # (relfile, name) -> {writes:{table:set(verbs)}, reads:set, calls:set((file,name))}
    imports: dict[str, dict[str, tuple[str, str]]] = {}  # relfile -> local name -> (lib relfile, name)
    bodies: dict[str, list[tuple[str, int, int]]] = {}  # relfile -> [(func, start, end)]
    texts: dict[str, str] = {}
    for f in files:
        rel = f.relative_to(ROOT).as_posix()
        text = f.read_text(encoding="utf-8")
        texts[rel] = text
        lines = text.splitlines()
        # module-level SQL fragments (const COLS = `...`; const FROM = `...`) belong to the functions
        # that use them, not to the function written just above them
        consts: dict[str, tuple[dict, set]] = {}
        for m in CONST_SQL.finditer(text):
            start, end = text.count("\n", 0, m.start()), text.count("\n", 0, m.end())
            cw: dict[str, set] = defaultdict(set)
            cr: set[str] = set()
            for sm in SQL_WRITE.finditer(m.group(2)):
                if sm.group(2) in tables:
                    cw[sm.group(2)].add(sm.group(1).split()[0])
            for sm in SQL_READ.finditer(m.group(2)):
                if sm.group(2) in tables:
                    cr.add(sm.group(2))
            consts[m.group(1)] = (cw, cr)
            for i in range(start, end + 1):
                lines[i] = ""
        heads = []
        for i, line in enumerate(lines):
            m = FUNC_HEAD.match(line)
            if m:
                heads.append((m.group(1) or m.group(2), i))
        spans = []
        for k, (name, start) in enumerate(heads):
            end = heads[k + 1][1] if k + 1 < len(heads) else len(lines)
            spans.append((name, start, end))
        bodies[rel] = spans
        imp = {}
        for m in LIB_IMPORT.finditer(text):
            lib = f"web/lib/{m.group(2)}.js"
            for part in m.group(1).split(","):
                part = part.strip()
                if not part:
                    continue
                orig, _, alias = part.partition(" as ")
                imp[(alias or orig).strip()] = (lib, orig.strip())
        imports[rel] = imp
        for name, start, end in spans:
            body = "\n".join(lines[start:end])
            writes: dict[str, set] = defaultdict(set)
            reads: set[str] = set()
            for m in SQL_WRITE.finditer(body):
                if m.group(2) in tables:
                    writes[m.group(2)].add(m.group(1).split()[0])
            for m in SQL_READ.finditer(body):
                if m.group(2) in tables:
                    reads.add(m.group(2))
            for cname, (cw, cr) in consts.items():
                if re.search(rf"\b{cname}\b", body):
                    for t, verbs in cw.items():
                        writes[t] |= verbs
                    reads |= cr
            funcs[(rel, name)] = {"writes": writes, "reads": reads, "body": body}
    # calls: identifiers followed by "(" that are functions of the same file or imported from a lib file
    for (rel, name), info in funcs.items():
        calls = set()
        local = {n for (r, n) in funcs if r == rel}
        for m in re.finditer(r"\b(\w+)\s*\(", info["body"]):
            ident = m.group(1)
            if ident == name:
                continue
            if ident in local:
                calls.add((rel, ident))
            elif ident in imports.get(rel, {}):
                target = imports[rel][ident]
                if target in funcs:
                    calls.add(target)
        info["calls"] = calls
    # transitive closure of the tables each function touches
    memo: dict[tuple[str, str], tuple[dict, set]] = {}

    def closure(key, stack=()):
        if key in memo:
            return memo[key]
        if key in stack:
            return defaultdict(set), set()
        info = funcs[key]
        w: dict[str, set] = defaultdict(set)
        r: set[str] = set(info["reads"])
        for t, verbs in info["writes"].items():
            w[t] |= verbs
        for c in info["calls"]:
            cw, cr = closure(c, stack + (key,))
            for t, verbs in cw.items():
                w[t] |= verbs
            r |= cr
        memo[key] = (w, r)
        return memo[key]

    for key in funcs:
        funcs[key]["all_writes"], funcs[key]["all_reads"] = closure(key)
    # routes: path, methods, the lib functions they import (and so the tables they reach)
    routes = []
    for rel, text in texts.items():
        if not rel.startswith("web/app/api/") or not rel.endswith("/route.js"):
            continue
        path = "/" + rel[len("web/app/"):-len("/route.js")]
        methods = ROUTE_METHOD.findall(text)
        routes.append({"file": rel, "path": path, "methods": methods})
    return {"funcs": funcs, "imports": imports, "routes": routes, "files": list(texts)}


# ----------------------------------------------------------------------------- the prose kept here

# What each table is for: from the migration comments and the code that uses it (file cited).
PURPOSE = {
    "users": "Sign-in accounts: email, scrypt password hash (`web/lib/auth.js` hashPassword), role (admin or user), the "
             "`session_epoch` that invalidates earlier session cookies when it changes, and `tab_access` (which workspace tabs "
             "the user may open; NULL means the deployment default in `app_settings.default_tabs`, see `web/lib/tabs.js` resolveTabs). "
             "In demo mode (`DEMO_MODE=1`) one shared user `demo@tenderos.local` is upserted by `GET /api/auth/demo`.",
    "scenarios": "A saved case in the scenario library: its name, description, module (`rtc` Round the clock, `bess` BESS tender, "
                 "`seci` SECI RTC tender; `fdre` is still allowed by the CHECK but `web/lib/scenarios.js` MODULES no longer accepts it), "
                 "who created it, and whether it is archived. The content lives in `scenario_versions`.",
    "scenario_versions": "One row per save of a scenario: the version number, a note, the full tab state (`inputs`), the results "
                         "kept with it (`results`) and the headline numbers for lists and comparison (`summary`, the keys of "
                         "`web/lib/summaryFields.js`). Versions are never updated: a restore adds a new version "
                         "(`web/lib/scenarios.js` restoreVersion). See the JSON documents section for the shape per module.",
    "app_settings": "Deployment-wide settings as key → jsonb. The only key the code writes is `default_tabs` "
                    "(`web/app/api/settings/tabs/route.js`, read by `web/lib/auth.js` currentUserWithAccess).",
    "resource_profiles": "The library of hourly wind and solar capacity-factor profiles (8,760 values in `vals`), built-in ones "
                         "(`seed_key`, loaded from `web/db/seed/profiles/*.json` on start by `web/lib/profiles.js` seedProfiles) and "
                         "uploads (`POST /api/profiles`), each with its CUF, monthly CUFs, quality and the issues found.",
    "user_sessions": "One row per sign-in: when it started, was last seen and ended, the active seconds added by the browser's "
                     "heartbeat (`POST /api/activity` ping, at most 120 s per ping), the IP and user agent. Purged after 400 days "
                     "(`web/lib/activity.js` purgeOldActivity, run on start).",
    "activity_log": "The usage log: one row per event with its kind, a jsonb `detail` (trimmed to 2,000 characters) and the "
                    "compute time where it applies. Server-side kinds: `login`, `login_failed`, `logout`, `engine` (every non-GET "
                    "call proxied to the engine, `web/app/api/[...path]/route.js`), `scenario_save`, `tender_read`, `export`, "
                    "`profile_upload`, `voice`; browser-reported kinds (`web/src/activity.js` trackEvent, allowed by CLIENT_KINDS): "
                    "`tab`, `optimize`, `run`, `export`, `download`. Purged after 400 days.",
    "tender_reads": "Tenders read by the engine (Tender to Bid): the whole reading with its page evidence in `result`, plus the "
                    "columns the list shows (title, issuer, number, type, capacity, mode `rules` or `llm`, page and field counts). "
                    "Saved best-effort after every read (`web/src/bid/readTender.js` → `POST /api/tenders`); the same file read "
                    "the same way again replaces the earlier row (same `sha256` and `mode`). Built-in readings come from "
                    "`web/db/seed/tenders/*.json` (`seed_key`).",
    "team_members": "The tender's team: name, email, team (management, finance, procurement, legal, technical), super admin "
                    "flag, the linked sign-in account (`user_id`) when there is one, job title and the tabs the person covers. "
                    "In demo mode five seats are created on first use (`web/lib/team.js` seedDemo) and the visitor picks one "
                    "(\"View as\", cookie `tenderos_member`).",
    "team_files": "Files people upload: on assignments (signed copies), as evidence on a box, and the CERC order PDFs of Recent "
                  "tenders. The bytes are on disk under `FILES_DIR` named `<id>.<ext>` (`web/lib/files.js` saveUpload); the row "
                  "holds the name, type, size, SHA-256 and that relative path.",
    "assignments": "Work assigned on a data point of a saved bid: which scenario, what kind of data point (`field`, `cost`, "
                   "`finance`, `document`, `condition`), its key in the bid state (`web/src/team/apply.js` documents the key "
                   "forms), the request, the team or person asked, due date, status, the answer (jsonb), the file submitted "
                   "and the scenario version the acceptance was saved as.",
    "assignment_events": "The history of each assignment: created, submitted, accepted, returned, cancelled, reassigned, comment, "
                         "emailed, email_failed, with who and a note (`web/lib/team.js` event / notify).",
    "team_outbox": "Every email team sharing composes (`web/lib/team.js` notify and `web/lib/teamMessages.js` emailMentioned): "
                   "sent through SMTP, failed, or kept as the demo outbox when there is no SMTP on a demo deployment.",
    "market_orders": "Recent tenders: CERC tariff-adoption orders uploaded as PDF, read by the engine (`POST /api/bid/cerc-order`) "
                     "into petition, date, petitioner, capacity, the tariff range and the winners, with the page and quote of each "
                     "fact, then corrected by hand (`checked`). The SECI auction results beside them are code "
                     "(`web/src/market/seed.js`), not rows.",
    "team_messages": "Team mode: a message in the thread of one input box of one tab (`thread_key` = the box's key, "
                     "`web/src/team/mentions.js` threadKey), with where the box is, its value at the time, the text and an "
                     "optional value offered for \"Fill in\".",
    "team_notices": "Each member's inbox: the messages they were mentioned in (`mention`) or that answered a thread they are in "
                    "(`reply`), and when they read them.",
    "evidence": "Evidence attached to an input box: a file, a link or a note, with the box's key, label and place, who attached "
                "it and the box's value at the time (`web/lib/evidence.js`).",
    "field_signoff": "A super admin's sign-off of a box's value, one row per box; `value_at` keeps the value signed, so a later "
                     "change shows as \"signed off at an older value\".",
    "schema_migrations": "Which `web/db/migrations/*.sql` files have been applied (`web/lib/db.js` migrate, run on start by "
                         "`web/instrumentation.js`). Not created by a migration file.",
}

OVERVIEW = """
## What the database holds, and what lives elsewhere

TenderOS keeps in Postgres only what has to be shared between people or kept after the browser
closes. Everything is written by the Next.js web app (`web/lib/*.js`, server-only modules, through
`web/lib/db.js`); the Python engine (`engine/`) never touches the database.

| In Postgres | Tables |
| --- | --- |
| Sign-in and access | `users`, `user_sessions`, `app_settings` (default tabs), `schema_migrations` |
| The scenario library (saved cases with their versions) | `scenarios`, `scenario_versions` |
| Usage | `activity_log` |
| Reference data shared by the team | `resource_profiles` (wind and solar profiles), `tender_reads` (tender readings), `market_orders` (CERC orders) |
| Team work on a saved bid | `team_members`, `team_files`, `assignments`, `assignment_events`, `team_outbox` |
| Team mode and evidence on any input box | `team_messages`, `team_notices`, `evidence`, `field_signoff` |

What is **not** in the database:

* **The working state of every tab is in the browser.** Each tab keeps its React state and writes
  it to `localStorage` a few hundred milliseconds after each change; only "Save" puts a copy in
  `scenarios` / `scenario_versions` (and only the Round the clock, BESS and SECI tabs have Save).
  Keys: Tender to Bid `fdre.bid.v4` (`web/src/bid/BidTab.jsx`), SECI RTC tender `tenderos.seci.v1`
  (`web/src/seci/SeciTab.jsx`), Round the clock `fdre.rtc.v1` (`web/src/rtc/RtcTab.jsx`), BESS
  tender `fdre.bess.v1` (`web/src/bess/BessTab.jsx`), CfD bid `fdre.cfd.v1` (`web/src/cfd/model.js`),
  What-if `tenderos-whatif` (`web/src/whatif/WhatIfTab.jsx`, not when embedded in the SECI tab),
  the theme `tenderos-theme` and the ping-icon mode `tenderos.pingIcons`. The last sizing's hourly
  dispatch and the optimizer's cloud are module-level variables that survive switching tabs but
  not a reload.
* **Uploaded files are on disk**, under `FILES_DIR` (`/data/files` in `docker-compose.yml`, the
  `team_files` volume; `web/data/files` when unset), written and read only by `web/lib/files.js`
  (`saveUpload`, `readStored`). The database row (`team_files`) carries the metadata and the
  relative path `<uuid>.<ext>`.
* **Engine jobs are JSON files, not rows.** A tender read is a job file in `EXTRACTION_JOBS_DIR`
  (default `/tmp/tenderos_extraction_jobs`, `engine/extraction/jobs.py`) and a 15-minute dispatch
  a job file plus its ZIP and XLSX in `DISPATCH15_JOBS_DIR` (default `<tmp>/tenderos_dispatch15`,
  `engine/sizing/dispatch15.py`); files older than 24 hours are deleted when a job starts. The
  browser polls the job and then saves the finished reading to `tender_reads` itself.
* **The MCP server's bids are in memory**: `web/lib/mcp.js` keeps one bid state per MCP session
  in a `Map` of the web process (6-hour TTL, at most 50); a restart starts a fresh bid.
* **Reference data in code and static files**: the SECI tender pack (`web/src/seci/seci-rtc-tm-v.json`
  and `web/src/seci/terms.js`), the SECI auction results (`web/src/market/seed.js`), the IEX hourly
  prices (`web/public/market/iex_hourly_prices.json`), and the seed files that are loaded into
  `resource_profiles` and `tender_reads` on start (`web/db/seed/`).
* **Sessions are a signed cookie** (`tenderos_session`, HS256 JWT, `web/lib/session.js`); the
  database only records them in `user_sessions` for the usage report.
"""

JSON_DOCS = """
## The JSON documents in jsonb columns

### `scenario_versions.inputs`, `results`, `summary`

A save is built in the browser by each tab's `buildSave()` and posted to `POST /api/scenarios`
(new scenario, version 1) or `PUT /api/scenarios/{id}` (next version) by `web/src/scenarios/SaveDialog.jsx`
(`web/src/scenarios/client.js` scenarioApi). `web/lib/scenarios.js` validates only that `inputs` is an
object and `summary` an object; the shape below is what each tab writes. `inputs.state` is the
tab's whole React state, so opening a scenario (`web/app/page.js` `?open=<id>&v=<version>` →
`getScenario` → the tab's `initialScenario` prop) restores the tab exactly; `results` keeps what
was computed at the time; `summary` feeds the library list, the comparison page and the Excel
export (`GET /api/scenarios/export`, the fields of `web/lib/summaryFields.js` SUMMARY_FIELDS).

| Module | `inputs` | `results` | `summary` keys |
| --- | --- | --- | --- |
| `seci` (SECI RTC tender, `web/src/seci/SeciTab.jsx` buildSave) | `{ state }`: the Tender to Bid state (`web/src/bid/model.js` defaultBidState: `version: 4`, `step`, `tender`, `accepted`, `bid { baseMw, greenshoe }`, `sources`, `filled`, `losses`, `src.<source>.<field>`, `solarUpload`, `windUpload`, `solarMonthScale`, `windMonthScale`, `fin`, `costs`, `dsm`, `market`, `sites`, `tariffLocked`, `quoteTariff`, `locks`, `lp` (the last HiGHS sizing without the hourly dispatch: `sizes`, `tariff`, `lowerBound`, `years`, `perYear` with the floor rules per year, `lifetime` per PPA year, `evacuationEfficiency`, `sites`, `market`, `flatPrice`, …; `engine/sizing/rtc_lp.py` solve), `sizingSeed`, `prebid`) plus the SECI additions (`web/src/seci/state.js` defaultSeciState: `seci { peakPlan, shortfall, ppaDate, profile, solarHours }`, `forms` (the particulars and every format's blanks, incl. `forms.tariff`, the quoted tariff, and `forms.bidder`), `formsReview`, `letters` (edited paragraphs per format), `signed` (format id → the accepted signed copy `{ fileId, name, by, at }`), `clarifications` (condition id → `{ text, fileId, by, at }`)) | `{ lp: { sizes, tariff, years } }` or `{ lp: null }` | `solarMw`, `windMw`, `bessMw`, `bessMwh` (from `lp.sizes`), `tariff` (`forms.tariff` when quoted, else `lp.tariff`), `contractedMw` (`bid.baseMw`), `bidder` (`forms.bidder`) |
| `rtc` (Round the clock, `web/src/rtc/RtcTab.jsx` buildSave) | `{ state }` with `chapter` reset to `"energy"`: `inputs` (demand, plant capacity, DFR target, CUFs, losses, …; `web/src/rtc/engine.js` DEFAULT_RTC_INPUTS), `hourShape`, `monthShape`, `demandUpload`, `solarUpload`, `windUpload`, `solarMonthScale`, `windMonthScale`, `bess`, `costs`, `fin`, `vars` (the size variables with their ranges and locks), `sites`, `objective`, `solver`, `gridPoints`, `stateVersion`, `tariffLocked`, `locks` | `opt` (the optimizer result with its cloud thinned to ≤1,500 points, `compactOpt`), `sim` (the year-1 simulation without the hourly arrays; `engine.js` simulate), `finance` (the whole `runFinancialModel` result: tariff, IRRs, DSCRs, `rows` for every year, `construction`, `totals`, …), `capex` (`capexCr`) | `annualEnergyMu`, `plantCapacityMw`, `dfrTarget`, `solarMw`, `windMw`, `bessMw`, `bessMwh`, `dfr`, `minMonthlyDfr`, `minLifetimeDfr`, `deliveredMu`, `meterMu`, `evacLossMu`, `trafoLossPct`, `lineLossPct`, `solarCufBus`, `solarCufMeter`, `curtailMu`, `capexCr`, `tariff`, `tariffLocked`, `lcoe`, `equityIrr`, `projectIrr`, `minDscr`, `payback` |
| `bess` (BESS tender, `web/src/bess/BessTab.jsx` buildSave) | `{ state }` with `chapter` reset to `"tender"`: `tender` (the parsed tender from `POST /api/bess/parse`), `req`, `tech`, `costs`, `fin`, `strategy`, locks | `opt` (the strategy search), `res` (`web/src/bess/engine.js` evaluate without the per-cohort detail: capex, charge, IRRs, DSCRs, LCOS, augmentation, the yearly plan, `rows`) | `powerMw`, `energyMwh`, `contractYears`, `cyclesPerDay`, `tender`, `day1DcMwh`, `oversizePct`, `augIntervalYears`, `augMwh`, `capexCr`, `vgfCr`, `chargeLakhPerMwMonth`, `ceilingLakhPerMwMonth`, `lcos`, `equityIrr`, `projectIrr`, `minDscr` |
| Tender to Bid (`bid`), CfD, What-if | not saved to the library: these tabs have no Save and `web/lib/scenarios.js` MODULES accepts only `rtc`, `bess`, `seci`. They live in `localStorage` only. | | |

### `tender_reads.result`

The engine's reading of one tender (`engine/extraction/extract.py` read_tender; the browser posts
it unchanged). Top-level keys: `engine`, `mode` (`rules` or `llm`), `model`, `provider`,
`document { name, pages, sha256, text_pages, scanned_pages }`, `tender_type`, `type_source`,
`type_scores`, `sections[] { name, label, fields[] }`, `values { "<field path>": value }`,
`rules[]` (the cross-field validation outcomes), `counts { fields, found, located, validated,
needs_review, not_found, rejected, withdrawn, required_missing[] }`, `usage`, `warnings`. Each
field in `sections[].fields[]` is `{ path, key, label, type, unit, required, help, enum, value,
display, confidence, status, rationale, evidence[], issues, withdrawn }`, and each evidence item is
`{ page, quote, located, method, score, resolution, bbox }` (`_evidence` in extract.py): a value is
used by the bid steps only when its quote is located on the page, else the reviewer must tick it
(`web/src/bid/tenderMap.js` isUsed). A tender set (RfS with amendments, `POST /api/bid/tender/read-set`,
`engine/extraction/tenderset/read_set.py`) is not saved here: its `kind: "set"` result (documents,
amended fields, changes, clarifications, formats, process, search passages) stays in the engine's
job file and the browser.

### `assignments.context` and `answer`

`context` is what the browser sends with the data point so the answer can be typed and placed
(`web/src/team/useTeam.js` → `createAssignment`): for a cost or financing input
`{ unit, pct, type: "number" }` (`web/src/bid/SourcesStep.jsx`, `FinanceInputsStep.jsx`); for a
format's blank `{ type, quote, page }` and for a particular `{ type, unit }` (`web/src/seci/BidForms.jsx`);
for a format to sign `{ paper, signer, page }`; for a tender condition `{ quote, page, value }`
(`web/src/seci/ConditionsStep.jsx`). `answer` is written on submit by `web/lib/team.js`
actOnAssignment: `{ value, note, by, at }` (the file goes in `file_id`). Accepting an answer is
done by the browser (`web/src/team/apply.js` applyAnswer writes it into the SECI state and
`SeciTab.jsx` acceptAnswer saves a new scenario version), then `accepted_version` records that
version.

### `team_messages` payload

Not jsonb: plain columns. `thread_key` is `<tab>:<data-testid>` or `<tab>:<section>:<label>`
(`web/src/team/mentions.js` threadKey), `place` and `step` say where the box is, `field_value`
is the box's value when the message was written, `body` the text with `@handle` mentions, and
`value` an optional value offered for "Fill in" (`web/src/team/FieldPings.jsx` → `POST /api/team/messages`).

### `market_orders.winners` and `evidence`

`winners` is a list of `{ name, mw, tariff, page, quote }` (at most 40, `web/lib/market.js`
cleanWinners); `evidence` keeps the engine's read of each fact with its page and quote:
`{ petition, orderDate, petitioner, capacityMw, subject, tariffs[] }` (at most 12 tariffs).

### `resource_profiles.monthly_cuf`, `issues`, `vals`

`vals` is the array of 8,760 hourly capacity factors rounded to 4 decimals (null when the profile
is rejected), `monthly_cuf` the twelve monthly means, `issues` the list of problems found when
the file was parsed (at most 10) — all written by `web/lib/profiles.js` createProfile / seedProfiles.

### `activity_log.detail`

Free-form per kind, trimmed to 2,000 characters (`web/lib/activity.js` trimDetail). Examples from the
code: `{ tab }` for `tab`; `{ module, plantMw }` or `{ module, objective, ok, sizes, tariff, designs, … }`
for `optimize`; `{ module, action }` for `run`; `{ path, status }` for `engine`;
`{ scenario, module, version }` / `{ scenarioId, version, restoredFrom }` for `scenario_save`;
`{ file, mode }` for `tender_read`; `{ what, … }` for `export`; `{ profile, kind, cuf }` for
`profile_upload`; `{ what, session, backend }` for `voice`.

### `users.tab_access` and `app_settings.value`

`tab_access` is a JSON array of tab ids from `web/lib/tabs.js` TAB_CATALOG (`tenderBid`, `rtc`,
`seciRtc`, `bessTender`, `cfd`, `whatIf`, `recentTenders`) or NULL; `app_settings.default_tabs`
holds the same kind of array for users without their own list.
"""

RETENTION = """
## Retention and cascades

* **Deleting a user** (`DELETE /api/users/{id}`) removes their `user_sessions` (CASCADE) and sets
  `created_by` / `user_id` to NULL everywhere else (`scenarios`, `scenario_versions`,
  `resource_profiles`, `tender_reads`, `market_orders`, `team_members`); `activity_log.email` keeps
  the address so the log stays readable.
* **Deleting a scenario** (`DELETE /api/scenarios/{id}`) removes its versions, its assignments
  (and through them their events) and its outbox emails (CASCADE on `scenario_id`).
* **Deleting an assignment** is not exposed by the API; the FK would cascade to
  `assignment_events` and `team_outbox`. A member removed from the team is deactivated
  (`active = false`), not deleted; the FKs from assignments, events, files, messages, evidence and
  sign-offs would set the member to NULL.
* **Deleting a team message** is not exposed; it would cascade to `team_notices` and the outbox
  rows of its emails.
* **Deleting evidence** (`DELETE /api/evidence/{id}`, by whoever attached it or a super admin)
  removes the row only: the `team_files` row and the file on disk stay (another item may share the
  file). Nothing deletes `team_files` rows or files on disk.
* **Tender readings**: saving a reading deletes the earlier row with the same `sha256` and `mode`
  (built-in `seed_key` rows excepted). Built-in rows are upserted on start.
* **Resource profiles**: built-in rows whose `seed_key` is no longer shipped are deleted on start
  (`seedProfiles`); uploads can be deleted by their owner or an administrator.
* **Usage**: `activity_log` and `user_sessions` older than 400 days are deleted on every start
  (`purgeOldActivity`).
* **Engine job files** older than 24 hours are deleted when the next job starts; they are never in
  the database.
"""


def on_delete_text(code: str) -> str:
    return {"c": "CASCADE", "n": "SET NULL", "a": "NO ACTION", "r": "RESTRICT", "d": "SET DEFAULT"}.get(code, code)


MERMAID_TYPE = {"_text": "text_array", "int4": "integer", "int8": "bigint", "float8": "double", "bool": "boolean", "timestamptz": "timestamptz"}


# ----------------------------------------------------------------------------- rendering


def md_escape(s: str) -> str:
    return (s or "").replace("|", "\\|")


def render(schema: dict, mig: dict, code: dict) -> str:
    tables = schema["tables"]
    by = schema["by_table"]
    funcs = code["funcs"]
    out: list[str] = []
    w = out.append
    w("# TenderOS Demo 2: the database")
    w("")
    w("Generated by `tools/gen_db_doc.py` from the live database's catalog and the code; do not edit by hand.")
    w("Re-run `DATABASE_URL=… python3 tools/gen_db_doc.py` after a migration or a change to the code that uses a table.")
    w("")
    w(f"Postgres database with **{len(tables)} tables** in schema `public` ({len(tables) - 1} application tables from the migrations plus `schema_migrations`): {', '.join(f'`{t}`' for t in tables)}.")
    mig_files = sorted(mig["heads"])
    w(f"Schema from `web/db/migrations/` ({len(mig_files)} files, `{mig_files[0]}` … `{mig_files[-1]}`), applied in name order on web start "
      "by `web/lib/db.js` migrate (each file in its own transaction, recorded in `schema_migrations`, under advisory lock 727401).")
    missing = [m for m in mig_files if m not in schema["applied"]]
    if missing:
        w(f"**Not yet applied in this database:** {', '.join(missing)}.")
    w(OVERVIEW.rstrip())
    w("")
    # ---- ER diagram
    w("## Entity relationship diagram")
    w("")
    w("```mermaid")
    w("erDiagram")
    for t in tables:
        w(f"  {t} {{")
        cons = by[t]["constraints"]
        pk = {c for con in cons if con["kind"] == "p" for c in con["cols"]}
        fk = {c for con in cons if con["kind"] == "f" for c in con["cols"]}
        uk = {c for con in cons if con["kind"] == "u" and len(con["cols"]) == 1 for c in con["cols"]}
        for col in by[t]["columns"]:
            typ = MERMAID_TYPE.get(col["udt"], col["udt"])
            key = "PK" if col["name"] in pk else "FK" if col["name"] in fk else "UK" if col["name"] in uk else ""
            w(f"    {typ} {col['name']}{(' ' + key) if key else ''}")
        w("  }")
    for t in tables:
        for con in by[t]["constraints"]:
            if con["kind"] != "f":
                continue
            # a child row needs (||) or may lack (o|) its parent; many children per parent
            col = by[t]["columns"]
            notnull = all(next(c for c in col if c["name"] == name)["notnull"] == "t" for name in con["cols"])
            rel = "||--o{" if notnull else "|o--o{"
            w(f"  {con['ref_table']} {rel} {t} : \"{', '.join(con['cols'])} ({on_delete_text(con['on_delete'])})\"")
    w("```")
    w("")
    # ---- tables
    w("## Tables")
    w("")
    for t in tables:
        info = by[t]
        w(f"### `{t}`")
        w("")
        w(PURPOSE.get(t, "Purpose: to confirm (no entry in tools/gen_db_doc.py PURPOSE)."))
        w("")
        created = mig["created"].get(t)
        changed = [m for m in mig["changed"].get(t, []) if m != created]
        if created:
            line = f"Created by `{created}`"
            if changed:
                line += f"; changed by {', '.join(f'`{m}`' for m in changed)}"
            w(line + ".")
        elif t == "schema_migrations":
            w("Created by `web/lib/db.js` migrate (`CREATE TABLE IF NOT EXISTS`), not by a migration file.")
        else:
            w("Created by: to confirm (not found in web/db/migrations).")
        w("")
        w("| Column | Type | Null | Default |")
        w("| --- | --- | --- | --- |")
        for col in info["columns"]:
            w(f"| `{col['name']}` | {col['type']} | {'no' if col['notnull'] == 't' else 'yes'} | {md_escape(col['dflt']) or ''} |")
        w("")
        keys = []
        for con in info["constraints"]:
            if con["kind"] == "p":
                keys.append(f"Primary key: `{'`, `'.join(con['cols'])}`.")
        for con in info["constraints"]:
            if con["kind"] == "f":
                keys.append(f"Foreign key `{'`, `'.join(con['cols'])}` → `{con['ref_table']}` (`{'`, `'.join(con['ref_cols'])}`), on delete {on_delete_text(con['on_delete'])}.")
        for con in info["constraints"]:
            if con["kind"] == "u":
                keys.append(f"Unique: `{'`, `'.join(con['cols'])}`.")
        for con in info["constraints"]:
            if con["kind"] == "c":
                keys.append(f"Check `{con['name']}`: `{con['def'][6:].strip() if con['def'].startswith('CHECK ') else con['def']}`.")
        for k in keys:
            w(f"* {k}")
        idx = [i for i in info["indexes"] if not any(i["name"] == c["name"] for c in info["constraints"])]
        for i in idx:
            m = re.search(r"USING \w+ (\(.*\))", i["def"])
            w(f"* Index `{i['name']}`: `{m.group(1) if m else i['def']}`.")
        w("")
        # who writes / reads
        writers: list[str] = []
        readers: list[str] = []
        for (rel, name), fi in sorted(funcs.items()):
            if t in fi["writes"]:
                verbs = "/".join(sorted(fi["writes"][t]))
                writers.append(f"`{rel}` {name} ({verbs})")
            elif t in fi["reads"]:
                readers.append(f"`{rel}` {name}")
        w("**Written by** (direct SQL): " + ("; ".join(writers) if writers else "nothing in the web app (data arrives through migrations or seeds only)") + ".")
        w("")
        w("**Read by** (direct SQL, besides the writers): " + ("; ".join(readers) if readers else "nothing else") + ".")
        w("")
        routes = []
        for r in code["routes"]:
            touched = []
            for local, target in code["imports"].get(r["file"], {}).items():
                if target[1] in AUTH_READERS or target not in funcs:
                    continue
                if t in funcs[target]["all_writes"] or t in funcs[target]["all_reads"]:
                    touched.append(local)
            direct = False
            for (rel, name), fi in funcs.items():
                if rel == r["file"] and (t in fi["writes"] or t in fi["reads"]):
                    direct = True
            if touched or direct:
                methods = ", ".join(r["methods"]) or "handler"
                how = sorted(set(touched)) + (["own SQL"] if direct else [])
                routes.append(f"`{methods} {r['path']}` ({', '.join(how)})")
        pages = []
        for (rel, name), fi in funcs.items():
            if rel.endswith("page.js") or rel.endswith("instrumentation.js"):
                reach = set(fi["all_writes"]) | fi["all_reads"]
                for local, target in code["imports"].get(rel, {}).items():
                    if target in funcs:
                        reach |= set(funcs[target]["all_writes"]) | funcs[target]["all_reads"]
                if t in reach:
                    pages.append(f"`{rel}`")
        note = " Also read by every signed-in request through `web/lib/auth.js` currentUser / currentUserWithAccess (left out above)." if t == "users" else ""
        w("**Reached through**: " + ("; ".join(routes) if routes else "no API route") + (("; " + ", ".join(sorted(set(pages)))) if pages else "") + "." + note)
        w("")
    w(JSON_DOCS.rstrip())
    w("")
    w(RETENTION.rstrip())
    w("")
    w("## Migrations")
    w("")
    w("| File | What it does (its head comment) |")
    w("| --- | --- |")
    for name in mig_files:
        w(f"| `{name}` | {md_escape(mig['heads'][name]) or '(no comment)'} |")
    w("")
    return "\n".join(out)


def main() -> None:
    schema = read_schema()
    mig = read_migrations()
    code = scan_code(set(schema["tables"]))
    text = render(schema, mig, code)
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            sys.exit(f"{OUT.relative_to(ROOT)} is stale: run python3 tools/gen_db_doc.py")
        print(f"{OUT.relative_to(ROOT)} is up to date")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(schema['tables'])} tables, {len(code['funcs'])} functions scanned, {len(code['routes'])} routes")


if __name__ == "__main__":
    main()
