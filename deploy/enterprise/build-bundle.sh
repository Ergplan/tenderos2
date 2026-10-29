#!/usr/bin/env bash
# Build a signed TenderOS Enterprise bundle on a jouleWise build machine (deploy/enterprise/README.md).
#   bash deploy/enterprise/build-bundle.sh [VERSION | path/to/VERSION-file]
# Version: the argument (a file is read, anything else is the version itself), else `git describe --tags --always`.
# Env:
#   RELEASE_KEY      path to the release private key (default ~/.tenderos-release/release.key); never in the repo
#   INCLUDE_DOCLING  1 also saves the Docling image (needed by the intake zone; several GB)
#   OUT_DIR          where the bundle goes (default dist/)
# Result: dist/tenderos-<version>.bundle.tar holding tenderos-<version>.bundle/ with
#   images.tar, docker-compose.yml, docker-compose.enterprise.yml, Caddyfile, .env.example, migrations/,
#   CHANGELOG.md (this version's section), VERSION, tenderos-patch, install.sh, release.pub,
#   manifest.json (version, built_at, commit, images, sha256 of every file) and manifest.sig.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
HERE="deploy/enterprise"
RELEASE_KEY="${RELEASE_KEY:-$HOME/.tenderos-release/release.key}"
OUT_DIR="${OUT_DIR:-dist}"

if [ -n "${1:-}" ]; then
  if [ -f "$1" ]; then VERSION="$(head -1 "$1" | tr -d ' \r')"; else VERSION="$1"; fi
else
  VERSION="$(git describe --tags --always 2>/dev/null || echo dev)"
fi
VERSION="${VERSION#v}"
[ -n "$VERSION" ] || { echo "empty version" >&2; exit 1; }
[ -f "$RELEASE_KEY" ] || { echo "release private key not found at $RELEASE_KEY (RELEASE_KEY=...; see $HERE/README.md, Keypair)" >&2; exit 1; }
[ -f "$HERE/release.pub" ] || { echo "$HERE/release.pub missing" >&2; exit 1; }
for t in docker openssl python3 tar; do command -v "$t" >/dev/null || { echo "$t is required" >&2; exit 1; }; done

COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then COMMIT="$COMMIT-dirty"; echo "note: working tree has uncommitted changes" >&2; fi
NAME="tenderos-$VERSION.bundle"
BUNDLE="$OUT_DIR/$NAME"
mkdir -p "$OUT_DIR"
rm -rf -- "${OUT_DIR:?}/${NAME:?}" "${OUT_DIR:?}/${NAME:?}.tar"
mkdir -p "$BUNDLE"

echo "Building tenderos-engine:$VERSION and tenderos-web:$VERSION"
# the base compose file insists on these; they are not baked into the images
POSTGRES_PASSWORD=build SESSION_SECRET=build SITE_ADDRESS=build TENDEROS_VERSION="$VERSION" \
  docker compose -f docker-compose.yml -f "$HERE/docker-compose.enterprise.yml" build engine web

IMAGES=("tenderos-engine:$VERSION" "tenderos-web:$VERSION")
IMAGE_ARGS=(--image "engine=tenderos-engine:$VERSION=$(docker image inspect --format '{{.Id}}' "tenderos-engine:$VERSION")"
            --image "web=tenderos-web:$VERSION=$(docker image inspect --format '{{.Id}}' "tenderos-web:$VERSION")")
if [ "${INCLUDE_DOCLING:-0}" = "1" ]; then
  DOCLING="$(grep -oE 'quay.io/docling-project/docling-serve-cpu:[^ ]+' docker-compose.yml | head -1)"
  docker image inspect "$DOCLING" >/dev/null 2>&1 || docker pull "$DOCLING"
  IMAGES+=("$DOCLING")
  IMAGE_ARGS+=(--image "docling=$DOCLING=$(docker image inspect --format '{{.Id}}' "$DOCLING")")
fi
echo "Saving ${IMAGES[*]} to images.tar"
docker save "${IMAGES[@]}" -o "$BUNDLE/images.tar"

cp docker-compose.yml "$BUNDLE/docker-compose.yml"
cp "$HERE/docker-compose.enterprise.yml" "$HERE/Caddyfile" "$HERE/tenderos-patch" "$HERE/install.sh" "$HERE/release.pub" "$BUNDLE/"
cp .env.example "$BUNDLE/.env.example"
chmod +x "$BUNDLE/tenderos-patch" "$BUNDLE/install.sh"
# for reference: the web image runs these itself on start (web/lib/db.js)
mkdir -p "$BUNDLE/migrations" && cp web/db/migrations/*.sql "$BUNDLE/migrations/"
if [ -f CHANGELOG.md ]; then
  python3 "$HERE/manifest.py" changelog CHANGELOG.md "$VERSION" > "$BUNDLE/CHANGELOG.md"
else
  printf 'No CHANGELOG.md in the repository at version %s (commit %s).\n' "$VERSION" "$COMMIT" > "$BUNDLE/CHANGELOG.md"
fi
printf '%s\n' "$VERSION" > "$BUNDLE/VERSION"

python3 "$HERE/manifest.py" write "$BUNDLE" --version "$VERSION" --commit "$COMMIT" "${IMAGE_ARGS[@]}" >/dev/null
openssl dgst -sha256 -sign "$RELEASE_KEY" -out "$BUNDLE/manifest.sig" "$BUNDLE/manifest.json"
openssl dgst -sha256 -verify "$HERE/release.pub" -signature "$BUNDLE/manifest.sig" "$BUNDLE/manifest.json" >/dev/null \
  || { echo "the signature does not verify with $HERE/release.pub: RELEASE_KEY is not its private key" >&2; exit 1; }
python3 "$HERE/manifest.py" check "$BUNDLE"

tar -C "$OUT_DIR" -cf "$OUT_DIR/$NAME.tar" "$NAME"
rm -rf -- "${OUT_DIR:?}/${NAME:?}"
# a last check with the same tool the client runs
TENDEROS_RELEASE_PUB="$HERE/release.pub" bash "$HERE/tenderos-patch" verify "$OUT_DIR/$NAME.tar"
echo "bundle: $OUT_DIR/$NAME.tar ($(du -h "$OUT_DIR/$NAME.tar" | cut -f1))"
sha256sum "$OUT_DIR/$NAME.tar"
