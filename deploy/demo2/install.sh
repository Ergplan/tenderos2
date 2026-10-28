#!/usr/bin/env bash
# Put TenderOS Demo 2 up beside Demo 1 on the shared VM. Run as the user that runs Docker (venture),
# from the Demo 2 checkout:   cd ~/tenderos2 && bash deploy/demo2/install.sh
#
# What it does, and nothing else:
#   1. writes .env if there is none: new database password and session secret, the API keys copied
#      from Demo 1's .env (never printed), project name and compose files (HTTPS when Demo 1 has it)
#   2. builds Demo 2's engine and web images
#   3. starts Demo 2's database, engine and web app (its own volumes; Demo 1's are not touched)
#   4. stops Demo 1's router and starts Demo 2's, which serves the three-app chooser on the same
#      address (port 8081, and HTTPS when it was on)
# Undo step 4 with deploy/demo2/rollback.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
DEMO1="${DEMO1_DIR:-$HOME/tenderos}"

if ! docker network inspect tenderos_default >/dev/null 2>&1; then
  echo "Demo 1's network (tenderos_default) is not there: start Demo 1 first." >&2
  exit 1
fi

if [ ! -f .env ]; then
  umask 077
  {
    echo "COMPOSE_PROJECT_NAME=tenderos2"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "SESSION_SECRET=$(openssl rand -hex 32)"
    if [ -f "$DEMO1/.env" ]; then
      grep -E '^(ANTHROPIC_API_KEY|OPENAI_API_KEY|LLAMA_CLOUD_API_KEY|OPENAI_LIVE_BACKEND_MODEL|OPENAI_LIVE_VOICE|SITE_ADDRESS)=' "$DEMO1/.env" || true
    fi
  } > .env
  if grep -q '^SITE_ADDRESS=' .env && docker volume inspect tenderos_router_data >/dev/null 2>&1; then
    echo "COMPOSE_FILE=docker-compose.yml:deploy/demo2/docker-compose.demo2.yml:deploy/demo2/docker-compose.demo2-https.yml" >> .env
  else
    sed -i '/^SITE_ADDRESS=/d' .env
    echo "COMPOSE_FILE=docker-compose.yml:deploy/demo2/docker-compose.demo2.yml" >> .env
  fi
  echo "Wrote .env (secrets not shown)."
fi

docker compose build engine web
docker compose up -d db engine web
echo "Waiting for Demo 2's web app..."
for _ in $(seq 1 60); do
  if docker compose exec -T web wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then break; fi
  sleep 3
done

if [ -d "$DEMO1" ]; then
  (cd "$DEMO1" && docker compose stop router) || true
fi
docker compose up -d router
docker compose ps
echo "Demo 2 is up. Open the usual address and choose 'TenderOS Demo 2'."
