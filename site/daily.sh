#!/usr/bin/env bash
# The demo site's daily refresh: scan SECI and NHPC for open tenders, amendments, moved deadlines
# and result notices (site/scan.py), then rebuild site/public from it (site/build.mjs). It commits
# nothing: whoever runs it commits site/data-src/market-scan.json and site/public and pushes, which
# redeploys tenderos.joulewise.tech. Exits non-zero, leaving the last good files, if the scan or
# the build fails.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -c "import pydantic" 2>/dev/null || pip install -q pydantic
cp site/data-src/market-scan.json /tmp/market-scan.before.json 2>/dev/null || true
python3 -W ignore site/scan.py | tee /tmp/market-scan.line
if ! node site/build.mjs > /tmp/site-build.log 2>&1; then
  cat /tmp/site-build.log; cp /tmp/market-scan.before.json site/data-src/market-scan.json 2>/dev/null || true
  echo "daily: the build failed; the scan was put back" >&2; exit 1
fi
grep -q 'On the market now' site/public/index.html || { echo "daily: the page lost its market drawing" >&2; exit 1; }
node --check site/public/assets/app.js
echo "daily: ok · $(cat /tmp/market-scan.line)"
