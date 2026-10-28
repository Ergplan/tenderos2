#!/usr/bin/env bash
# Give the address back to Demo 1's router (two-app chooser); Demo 2's containers stay, stopped
# router only. Run as venture:   cd ~/tenderos2 && bash deploy/demo2/rollback.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DEMO1="${DEMO1_DIR:-$HOME/tenderos}"
docker compose stop router
(cd "$DEMO1" && docker compose up -d router)
echo "Demo 1's router is back. Stop Demo 2 entirely with: docker compose stop"
