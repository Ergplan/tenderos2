# TenderOS (Demo 2)

This repository is TenderOS Demo 2. Demo 1 is kept unchanged in `Ergplan/tenderos`; Demo 2 starts
from it and adds:

* **A traceable financial model.** Click any number of a financial model (SECI RTC, Tender to Bid,
  Round the clock, What-if) and see its formula with every reference named and valued, what it reads,
  what reads it and every input it rests on: the Live model sheet of the Excel export, in the app
  (`web/src/model/`).
* **Solar plant and wind farm studios.** A grid-scale solar plant laid out from module, mounting and
  string or central inverters, its cost built up in ₹/Wp; wind turbines by make (Vestas, GE Vernova,
  Suzlon, Siemens Gamesa, Envision, Inox, Adani) with their CUF at your site's wind and the farm's
  cost. Either writes its cost into the bid (`web/src/plant/`). Uploaded solar and wind profiles
  are shown with their CUF.
* **What-if analysis.** Your size, costs, financing and bid tariff in; equity, project and lender's
  IRR, DSCR and the tariff the target IRR needs out, and whether the plant meets the SECI RTC-TM-V
  floors and limits (`web/src/whatif/`).
* **Recent tenders.** Recent SECI auction results as reported, with sources, and CERC
  tariff-adoption orders uploaded and read into their facts with page and quote (`web/src/market/`,
  `engine/market/`).

`docs/DEMO2.md` describes each, and `docs/DEPLOY.md` §7 runs Demo 2 beside Demo 1 on the shared VM.

TenderOS is a workspace for bidding Indian renewable power tenders. You upload a tender, and it
reads what the tender requires, each item with its page and quote. You then enter the sources you
have and their costs. HiGHS sizes the least-tariff plant that meets every tender condition, and the
app produces the bid's financial model as an Excel workbook, whose Live model tab is the whole
model as Excel formulas (change an input and the returns follow).

* The interface is the jouleWise design (renamed TenderOS) from `Ergplan/FDRE` branch `claude/intelligent-carson-mwonct`.
* The tender reading is the extraction engine of `Ergplan/tender_engine` (main, `5c29b4e`), with the
  extraction model `claude-fable-5-1`.

| Tab | |
| --- | --- |
| **Tender to Bid** | Start by uploading any tender (read on a scan screen where five agents work through its text) or with the prefilled simulation. Then the tender, its key dates, the bid capacity, the supply sources, the HiGHS sizing with the tender conditions and a 15-minute dispatch, then the financials and the Excel model (`docs/TENDER_TO_BID.md`) |
| **SECI RTC tender** | SECI RTC-TM-V: the RfS, the amendments and what they changed, the bid conditions with quotes and the points to raise with SECI, what to bid, the sources, sizing against every peak and off-peak block, the financial model with formulas, equity and project IRR at the tariff you quote, every RfS bid format filled and reviewed beside its page, the Word bid pack, and a voice bid agent (GPT-Live, with `OPENAI_API_KEY`) that changes inputs, re-runs the optimizer and explains the results (`docs/SECI_RTC.md`) |
| Round the clock | RTC / FDRE sizing and finance from your own inputs, with the same Excel workbook and Live model tab |
| BESS tender | Standalone battery tenders |
| CfD bid | SECI CfD-I strike price (`docs/CFD.md`) |
| **What-if analysis** | Demo 2: your plant, costs, financing and bid tariff; returns, the lender's view and tender compliance (`docs/DEMO2.md`) |
| **Recent tenders** | Demo 2: SECI auction results and CERC tariff-adoption orders (`docs/DEMO2.md`) |

Further reading: `docs/ARCHITECTURE.md` (the parts and the data flow) and `docs/EXTRACTION.md` (the
tender reader). `docs/E2E-NHPC.md` reports one tender run end to end: the NHPC FDRE-II RfS, 1,200 MW
and 264 pages, from upload to the Excel model.

## Run with Docker Compose

```
cp .env.example .env        # set POSTGRES_PASSWORD and SESSION_SECRET; ANTHROPIC_API_KEY optional
docker compose up -d --build
```

Open `http://<host>:3000`. On a fresh database, the first visit asks you to create the
administrator. Without `ANTHROPIC_API_KEY`, tenders are read by the rule-based reader, which reads
the headline fields only; the Tender step says which reader was used. Behind HTTPS, set
`COOKIE_SECURE=true`.

## Deploy a demo VM

`docs/DEPLOY.md`: one script creates a Google Cloud VM with HTTPS (Caddy and Let's Encrypt), a
generated administrator password, firewall rules, backups and updates.

## Run locally

You need Python 3.12, Node 22 and a Postgres database.

```
make install                # .venv with the engine and test requirements; web/node_modules
make build                  # next build
export DATABASE_URL=postgres://user:pass@127.0.0.1:5432/tenderos SESSION_SECRET=$(openssl rand -hex 32)
make dev                    # engine on :8000, web on :3000; `make stop` stops both
```

## Tests

```
make test                   # engine tests and the NHPC reading end to end (sizing tests take ~9 min)
make check-web              # browser-side models in node
JOULEWISE_URL=http://127.0.0.1:3000 JOULEWISE_EMAIL=… JOULEWISE_PASSWORD=… make e2e
                            # NHPC RfS in the browser: upload, size, conditions, Excel
```

## Status

The NHPC end-to-end runs pass in rules mode, both against local processes and against the compose
stack (see `docs/E2E-NHPC.md`).

The model reader has not been run against a real tender in this repository, because no API key was
available. Its tests use a fake SDK. Run one tender with a key, and compare the reading with
`samples/tenders/nhpc-fdre-ii/reviewed-reading.yaml`, before relying on it.

The app has sign-in, users and per-user tab access. It does not store approved tender values,
corrigendum versions or an audit trail of them; that review workflow is tender_engine's.
