# TenderOS. Local runs need Postgres, Python 3.12 and Node 22; see README.
PY ?= .venv/bin/python

.PHONY: install build test test-slow check-web e2e demo lint docs-check dev stop up down

install:
	python3.12 -m venv .venv && $(PY) -m pip install -r engine/requirements-dev.txt
	cd web && npm ci

build:
	cd web && npx next build

test:
	$(PY) -m pytest -q -m "not slow" tests/engine tests/test_seci_pack.py tests/e2e/test_nhpc_tender.py

# the split-site sizing LP tests (several minutes)
test-slow:
	$(PY) -m pytest -q -m slow tests/engine

check-web:
	for f in tools/check_*.mjs; do case $$f in *nhpc*) continue;; esac; node $$f || exit 1; done

# Needs a running stack: TENDEROS_URL and TENDEROS_EMAIL, TENDEROS_PASSWORD (or TENDEROS_DEMO=1)
e2e:
	$(PY) -m pytest -q -m slow tests/e2e/test_tender_to_bid.py tests/e2e/test_mcp.py tests/e2e/test_round_the_clock.py tests/e2e/test_seci_tab.py tests/e2e/test_team.py tests/e2e/test_team_mode.py tests/e2e/test_evidence.py tests/e2e/test_theme.py tests/e2e/test_demo2.py tests/e2e/test_click_tour.py

# the whole demo, clicked through once, with the PDF report (needs a running stack; see demo/README.md)
demo:
	$(PY) tools/demo_run.py && $(PY) tools/demo_report.py

lint:
	$(PY) -m ruff check engine tests tools/demo_run.py tools/demo_report.py tools/gen_db_doc.py tools/gen_screen_map.py
	python3 tools/gen_screen_map.py --check

# the generated developer documents are the code's: fails when docs/dev/DATABASE.md or
# SCREEN-TO-DATA.md is stale (the database one needs DATABASE_URL)
docs-check:
	python3 tools/gen_db_doc.py --check
	python3 tools/gen_screen_map.py --check

dev:
	bash tools/dev.sh

stop:
	bash tools/dev.sh stop

up:
	docker compose up -d --build

down:
	docker compose down
