#!/usr/bin/env bash
# First installation of TenderOS Enterprise from a signed bundle, by the client's IT, with no internet.
#   sudo bash install.sh tenderos-<version>.bundle.tar [/opt/tenderos]
# Give it the .tar as it came; it unpacks what it needs. It verifies the bundle, loads the images,
# writes .env (asking for the zone and the site address, generating the secrets), copies the compose
# files, Caddyfile and the patch tool into the install folder, starts the stack and waits for the
# health check. Put the certificate files in <install folder>/certs/ (tenderos.crt, tenderos.key)
# first, or when asked.
# Before the first run, compare the fingerprint of release.pub it prints with the one jouleWise
# gave you over another channel: every later patch is checked against this key.
set -euo pipefail
BUNDLE="${1:-}"
TARGET="${2:-/opt/tenderos}"
[ -n "$BUNDLE" ] && [ -f "$BUNDLE" ] || { echo "usage: install.sh <tenderos-X.bundle.tar> [install folder]" >&2; exit 2; }
for t in docker openssl tar sha256sum; do command -v "$t" >/dev/null || { echo "$t is required" >&2; exit 1; }; done
docker compose version >/dev/null 2>&1 || { echo "docker compose (v2) is required" >&2; exit 1; }
BUNDLE="$(cd "$(dirname "$BUNDLE")" && pwd)/$(basename "$BUNDLE")"

WORK="$(mktemp -d)"; trap 'rm -rf -- "${WORK:?}"' EXIT
tar -xf "$BUNDLE" -C "$WORK"
DIR="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name '*.bundle' | head -1)"
[ -n "$DIR" ] || { echo "not a TenderOS bundle" >&2; exit 1; }

mkdir -p "$TARGET"
if [ -f "$TARGET/release.pub" ]; then
  PUB="$TARGET/release.pub"
  cmp -s "$PUB" "$DIR/release.pub" || echo "note: the bundle carries a different release.pub than $PUB; the installed one is used" >&2
else
  PUB="$DIR/release.pub"
  echo "First install: trusting the release key shipped in this bundle. Its fingerprint:"
  openssl pkey -pubin -in "$PUB" -outform DER | sha256sum | sed 's/^/  sha256 /'
  echo "Compare it with the fingerprint jouleWise gave you before continuing."
  read -r -p "Continue? [y/N] " ok; [ "${ok:-}" = "y" ] || [ "${ok:-}" = "Y" ] || exit 1
fi
TENDEROS_RELEASE_PUB="$PUB" bash "$DIR/tenderos-patch" verify "$BUNDLE"
VERSION="$(head -1 "$DIR/VERSION" | tr -d ' \r')"

cd "$TARGET"
for f in docker-compose.yml docker-compose.enterprise.yml Caddyfile .env.example release.pub CHANGELOG.md VERSION install.sh tenderos-patch; do
  cp -p "$DIR/$f" "$TARGET/$f"
done
rm -rf -- "${TARGET:?}/migrations" && cp -pr "$DIR/migrations" "$TARGET/migrations"
chmod +x "$TARGET/tenderos-patch" "$TARGET/install.sh"
mkdir -p certs backups .tenderos && chmod 700 backups .tenderos

ZONE="$(grep -E '^TENDEROS_ZONE=' .env 2>/dev/null | cut -d= -f2- || true)"
if [ ! -f .env ]; then
  echo
  echo "Writing $TARGET/.env"
  ZONE=""
  while [ "$ZONE" != "intake" ] && [ "$ZONE" != "core" ]; do
    read -r -p "Zone this machine is in (intake = tender reading with cloud models, core = bid workspace, no internet): " ZONE
  done
  read -r -p "Site address users will type (host name on the certificate, e.g. tenderos.client.local): " SITE
  [ -n "$SITE" ] || { echo "a site address is needed" >&2; exit 1; }
  read -r -p "SMTP host for team mail (empty to skip): " SMTP_HOST
  SMTP_PORT=587; SMTP_USER=""; SMTP_PASSWORD=""; MAIL_FROM=""
  if [ -n "$SMTP_HOST" ]; then
    read -r -p "SMTP port [587]: " p; SMTP_PORT="${p:-587}"
    read -r -p "SMTP user (empty for none): " SMTP_USER
    if [ -n "$SMTP_USER" ]; then read -r -s -p "SMTP password: " SMTP_PASSWORD; echo; fi
    read -r -p "Mail from address: " MAIL_FROM
  fi
  ANTHROPIC=""; LLAMA=""; OPENAI=""
  if [ "$ZONE" = "intake" ]; then
    read -r -s -p "Anthropic API key (the tender reader; empty for the rule-based reader): " ANTHROPIC; echo
    read -r -s -p "LlamaParse key for scanned pages (optional): " LLAMA; echo
    read -r -s -p "OpenAI key for tender questions by voice (optional): " OPENAI; echo
  fi
  umask 077
  {
    echo "# TenderOS Enterprise, written by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Keys are secrets: keep this file to root."
    echo "COMPOSE_PROJECT_NAME=tenderos"
    echo "COMPOSE_FILE=docker-compose.yml:docker-compose.enterprise.yml"
    echo "TENDEROS_ZONE=$ZONE"
    echo "TENDEROS_VERSION=$VERSION"
    echo "SITE_ADDRESS=$SITE"
    echo "APP_URL=https://$SITE"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "SESSION_SECRET=$(openssl rand -hex 32)"
    echo "COOKIE_SECURE=true"
    if [ "$ZONE" = "intake" ]; then
      echo "# intake zone: the engine may reach the model providers; Docling reads the tables"
      echo "TENDEROS_ENGINE_INTERNAL=false"
      echo "COMPOSE_PROFILES=intake"
      echo "ANTHROPIC_API_KEY=$ANTHROPIC"
      echo "LLAMA_CLOUD_API_KEY=$LLAMA"
      echo "OPENAI_API_KEY=$OPENAI"
    else
      echo "# core zone: no cloud client is configured and the engine has no route out"
      echo "TENDEROS_ENGINE_INTERNAL=true"
      echo "DOCLING_URL="
      echo "ANTHROPIC_API_KEY="
      echo "LLAMA_CLOUD_API_KEY="
      echo "OPENAI_API_KEY="
    fi
    echo "SMTP_HOST=$SMTP_HOST"
    echo "SMTP_PORT=$SMTP_PORT"
    echo "SMTP_USER=$SMTP_USER"
    echo "SMTP_PASSWORD=$SMTP_PASSWORD"
    echo "MAIL_FROM=$MAIL_FROM"
  } > .env
  echo "Wrote .env (secrets not shown)."
else
  echo "Keeping the existing $TARGET/.env"
  if grep -qE '^TENDEROS_VERSION=' .env; then sed -i -E "s/^TENDEROS_VERSION=.*/TENDEROS_VERSION=$VERSION/" .env; else echo "TENDEROS_VERSION=$VERSION" >> .env; fi
fi

if [ ! -f certs/tenderos.crt ] || [ ! -f certs/tenderos.key ]; then
  echo
  echo "Put the certificate in $TARGET/certs/tenderos.crt (server certificate followed by its chain, PEM)"
  echo "and the key in $TARGET/certs/tenderos.key, then press Enter. (Without them Caddy will not start;"
  echo "the web app still comes up; add the files later and run: docker compose up -d caddy)"
  read -r -p "Press Enter to continue..." _
fi
chmod 600 certs/tenderos.key 2>/dev/null || true

echo "Loading the images (no pull)"
docker load -i "$DIR/images.tar"
echo "Starting TenderOS $VERSION"
docker compose up -d
echo "Waiting for the web app (migrations run on first start)..."
ok=0; body=""
for _ in $(seq 1 100); do
  if body="$(docker compose exec -T web wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null)"; then ok=1; break; fi
  sleep 3
done
printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$VERSION" "${USER:-$(id -un)}" "$([ $ok = 1 ] && echo installed || echo install-unhealthy)" "zone $ZONE" >> .tenderos/patch-log
docker compose ps
if [ $ok = 1 ]; then
  echo "health: $body"
  echo "TenderOS $VERSION is up: https://$(grep -E '^SITE_ADDRESS=' .env | cut -d= -f2-)/  (first user: /setup)"
  echo "Patches: cd $TARGET && sudo ./tenderos-patch apply tenderos-<version>.bundle.tar"
else
  echo "The web app did not answer /api/health in time: docker compose logs web db" >&2
  exit 1
fi
