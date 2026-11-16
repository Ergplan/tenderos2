#!/usr/bin/env bash
# The demo site's daily refresh: scan SECI and NHPC for open tenders, amendments, moved deadlines
# and result notices (site/scan.py), then rebuild site/public from it (site/build.mjs). It commits
# nothing: whoever runs it commits site/data-src/market-scan.json and site/public and pushes, which
# redeploys tenderos.joulewise.tech. Exits non-zero, leaving the last good files, if the scan or
# the build fails. Needs curl, node 22 and Python 3.12+ (it finds one, and installs pydantic in a
# throwaway virtualenv if it is missing).
set -euo pipefail
cd "$(dirname "$0")/.."
# the application's SECI parser needs Python 3.12 or later, and pydantic
PY=""
for c in python3.13 python3.12 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "daily: needs Python 3.12 or later" >&2; exit 1; }
if ! "$PY" -c "import pydantic" 2>/dev/null; then
  "$PY" -m venv /tmp/tenderos-scan-venv && /tmp/tenderos-scan-venv/bin/pip install -q pydantic && PY=/tmp/tenderos-scan-venv/bin/python
fi
cp site/data-src/market-scan.json /tmp/market-scan.before.json 2>/dev/null || true
"$PY" -W ignore site/scan.py | tee /tmp/market-scan.line
if ! node site/build.mjs > /tmp/site-build.log 2>&1; then
  cat /tmp/site-build.log; cp /tmp/market-scan.before.json site/data-src/market-scan.json 2>/dev/null || true
  echo "daily: the build failed; the scan was put back" >&2; exit 1
fi
grep -q 'On the market now' site/public/index.html || { echo "daily: the page lost its market drawing" >&2; exit 1; }
node --check site/public/assets/app.js
echo "daily: ok · $(cat /tmp/market-scan.line)"
