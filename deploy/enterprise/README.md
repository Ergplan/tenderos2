# TenderOS Enterprise: installation and patches

How jouleWise builds a release bundle, how the client's IT installs it and applies patches under
the AMC, how a patch is rolled back, the release keypair, and what the client's firewall must
allow in each zone. The design is `docs/enterprise/ARCHITECTURE.md`, sections 1, 4, 8 and 9.

Everything here works with no internet on the client's side: no image is pulled, no certificate
is requested, no package is downloaded. The bundle is the only thing that crosses.

## What is in this folder

| File | Runs where | What it is |
| --- | --- | --- |
| `build-bundle.sh` | jouleWise build machine | Builds the images, writes and signs the manifest, packs `dist/tenderos-<version>.bundle.tar` |
| `manifest.py` | build machine (python3, no modules) | Computes the sha256 of every file and writes `manifest.json`; extracts the changelog section |
| `release.pub` | in every bundle, and on the client | The release public key; signatures are verified against it |
| `release.key.placeholder` | — | A note: the private key is never in the repository |
| `tenderos-patch` | client (in the bundle) | `verify`, `apply`, `rollback`, `status` |
| `install.sh` | client (in the bundle) | First installation from a bundle |
| `docker-compose.enterprise.yml` | client (in the bundle) | The overlay on `docker-compose.yml`: image names, Caddy with the client's certificate, networks per zone |
| `Caddyfile` | client (in the bundle) | HTTPS with the client's own certificate files, no ACME |

## 1. Building a bundle (jouleWise)

On a machine with Docker, git, openssl and python3, from a clean checkout at the release tag:

```
git checkout v1.2.0
RELEASE_KEY=~/.tenderos-release/release.key bash deploy/enterprise/build-bundle.sh
# or with an explicit version, or a VERSION file:
bash deploy/enterprise/build-bundle.sh 1.2.0
bash deploy/enterprise/build-bundle.sh path/to/VERSION
```

The version is `git describe --tags --always` (a leading `v` is dropped) unless given. The script:

1. builds `tenderos-engine:<version>` and `tenderos-web:<version>` with the enterprise overlay (the
   images carry the `org.opencontainers.image.version` label);
2. `docker save`s them into `images.tar` (`INCLUDE_DOCLING=1` adds the Docling image, which the
   intake zone needs for tender-set tables; it is several GB);
3. copies `docker-compose.yml`, `docker-compose.enterprise.yml`, `Caddyfile`, `.env.example`,
   `web/db/migrations/` (for reference: the web image applies them itself on start), the
   `CHANGELOG.md` section for the version (or a note when there is no changelog), `VERSION`,
   `tenderos-patch`, `install.sh` and `release.pub`;
4. writes `manifest.json` (version, built at, git commit, image tags and ids, sha256 of every
   file) and signs it: `manifest.sig` = `openssl dgst -sha256 -sign release.key manifest.json`;
5. packs `dist/tenderos-<version>.bundle.tar` and runs `tenderos-patch verify` on it.

Before building, run the test suite. Record the bundle's sha256 (printed at the end) in the
release note sent to the client; it lets them check the download before they even run `verify`.

## 2. The release keypair

The manifest is signed with an EC P-256 key. Generate the pair once, on the build machine, and
keep the private key out of the repository (`.gitignore` already ignores `*.key` and `*.pem`):

```
mkdir -p ~/.tenderos-release && chmod 700 ~/.tenderos-release
openssl ecparam -name prime256v1 -genkey -noout -out ~/.tenderos-release/release.key
chmod 600 ~/.tenderos-release/release.key
openssl pkey -in ~/.tenderos-release/release.key -pubout -out deploy/enterprise/release.pub
openssl pkey -pubin -in deploy/enterprise/release.pub -outform DER | sha256sum   # the fingerprint
```

Commit `release.pub` only. Give the client the fingerprint over a channel other than the bundle
(the contract, a signed letter, a phone call): `install.sh` prints the fingerprint of the key in
the first bundle and asks them to compare it. After that first install, patches are verified
against the key already on the client's machine, never against a key found in a bundle.

The `release.pub` in the repository today was generated for the first build machine; the private
key is at `~/.tenderos-release/release.key` on it. **Rotation:** generate a new pair, commit the
new `release.pub`, build one bundle signed with the OLD key that carries the NEW `release.pub`,
and have the client replace `<install folder>/release.pub` with it after that patch (the patch
tool keeps using the installed key, so the swap is a deliberate step by their IT); every later
bundle is signed with the new key.

## 3. Installing (the client's IT)

Requirements on the host: Linux, Docker Engine with Compose v2, bash, openssl, tar, sha256sum,
and python3 or jq (to read the manifest; without both the tool falls back to a plain scan). The
host needs no internet. The certificate for the site address, as two PEM files.

```
sudo bash install.sh tenderos-1.2.0.bundle.tar /opt/tenderos
```

(`install.sh` is inside the bundle: `tar -xf tenderos-1.2.0.bundle.tar
tenderos-1.2.0.bundle/install.sh` takes it out, or unpack the whole folder.) It:

1. prints the fingerprint of `release.pub` and asks for confirmation (first install only), then
   verifies the bundle's signature and every checksum;
2. copies the compose files, `Caddyfile`, the patch tool, the notes and `release.pub` into
   `/opt/tenderos`;
3. writes `/opt/tenderos/.env`: asks the **zone** (`intake` or `core`), the **site address**
   (the host name on the certificate), SMTP (optional) and, in the intake zone only, the cloud
   keys; generates `POSTGRES_PASSWORD` and `SESSION_SECRET` with openssl; sets
   `TENDEROS_VERSION`;
4. waits for `certs/tenderos.crt` (server certificate followed by the chain) and
   `certs/tenderos.key` in `/opt/tenderos/certs/`;
5. `docker load`s the images, `docker compose up -d`, and waits for `/api/health` on the web
   container (the database migrations run on the web app's first start);
6. prints the address. The first user is created at `https://<site>/setup`.

`.env` holds secrets; it is written with mode 600. `backups/` and `.tenderos/` are created beside
it.

### The overlay, per zone

`docker-compose.enterprise.yml` is used with the base file through `COMPOSE_FILE` in `.env`.
Images are `tenderos-engine:<TENDEROS_VERSION>` and `tenderos-web:<TENDEROS_VERSION>`, so the
version in `.env` is what runs. The web port is not published; Caddy (443, and 80 for the
redirect) is the only published service and terminates TLS with the files in `certs/`.

Networks:

| Network | Members | Routable? |
| --- | --- | --- |
| `backend` | db, engine, web, docling | No (`internal: true`): nothing on it has a route out of the host |
| `frontend` | caddy, web | Yes: Caddy answers browsers; web reaches the client's SMTP server and directory |
| `egress` | engine | `TENDEROS_ENGINE_INTERNAL` (default `true`, no route out); `false` in the intake zone, where the engine must reach the model providers |

`install.sh` writes `TENDEROS_ENGINE_INTERNAL=true` and empty cloud keys for `core`, and
`TENDEROS_ENGINE_INTERNAL=false`, `COMPOSE_PROFILES=intake` (starts Docling) and the keys for
`intake`. In the core zone the engine and the database therefore have no path to anything outside
the stack, and the web app has no cloud client configured; the host firewall (below) is the
second lock.

## 4. Patching (AMC)

A patch is a bundle like the first one. jouleWise sends it by the agreed channel (download in the
DMZ, or media), and it reaches the core by the same transfer as the tender packages. Then:

```
cd /opt/tenderos
sudo ./tenderos-patch verify tenderos-1.3.0.bundle.tar     # optional: signature and checksums only
sudo ./tenderos-patch apply  tenderos-1.3.0.bundle.tar
sudo ./tenderos-patch status
```

`apply`:

1. verifies the manifest signature against the installed `release.pub` and the sha256 of every
   file, and refuses a bundle with any file missing, changed or not in the manifest;
2. backs up the database (`pg_dump`) and the files volume to `backups/<timestamp>/`, with the
   current compose files and patch tool;
3. records the current version and image ids in `.tenderos/previous.json`;
4. `docker load`s the images from the bundle (no pull), copies the new compose files, `Caddyfile`
   and patch tool into place, and sets `TENDEROS_VERSION` in `.env`;
5. `docker compose up -d`, then waits (up to 5 minutes, `TENDEROS_HEALTH_WAIT`) for `/api/health`
   on the web container to answer 200 **and report the new version**. The migrations run on the
   web app's start, before it answers;
6. on failure, rolls back (next section) and exits non-zero;
7. appends a line to `.tenderos/patch-log`: when, version, who (`$USER`), result, note. `status`
   shows the version, the health JSON (with zone and version), the compose status and the last
   log lines. The About page in the app reads the same version from `/api/health`.

The tool runs in the install folder (or `TENDEROS_HOME`). It replaces itself by rename during a
patch, so the running copy finishes with the old code and the next run uses the new one.

## 5. Rollback

`sudo ./tenderos-patch rollback` returns to the state of before the last `apply`: it re-tags the
previous images from the recorded ids if the tags were pruned, restores the compose files and
patch tool from the backup folder, drops and restores the database from `db.sql.gz`, sets
`TENDEROS_VERSION` back, `docker compose up -d`, waits for health, and restores the files volume
from `files.tar.gz`. `apply` runs the same rollback by itself when the health check fails. Both
are logged.

A rollback restores the **database as it was before the patch**: anything users entered between
the patch and the rollback is lost. Roll back soon after a bad patch, or take a fresh
`pg_dump` first and ask jouleWise.

By hand, if the tool cannot (no `previous.json`, or the previous image is gone): load the previous
bundle's images (`docker load -i`), set `TENDEROS_VERSION` in `.env` to the previous version, and
restore the dump as `deploy/backup.sh` in the repository describes (`dropdb`, `createdb`, `psql <
dump`), then `docker compose up -d`.

## 6. The firewall, per zone

The host runs Docker; Docker publishes 443 and 80 (Caddy) and nothing else. Beyond that:

**Core zone** (the bid workspace; ARCHITECTURE.md section 4 and 9):

| Direction | Allow | Block |
| --- | --- | --- |
| In | 443 (and 80, redirect only) from the users' networks; SSH from the IT jump host | Everything else |
| Out | The client's SMTP server (team mail) and, when sign-in is wired to it, the directory server (LDAP/LDAPS or the SAML/OIDC issuer), from the host | **All other outbound traffic, including DNS to the internet and any proxy.** Nothing in the core ever needs the internet; a cloud API key must never be present in `.env` |

The engine and the database cannot reach any of this anyway (internal networks); the rule
protects the web container, which needs the mail and directory servers and nothing more.

**Intake zone** (the tender reading in the DMZ; ARCHITECTURE.md section 2):

| Direction | Allow | Block |
| --- | --- | --- |
| In | 443 (and 80) from the legal/bid desk networks; SSH from the IT jump host | Everything else, including anything from the core |
| Out | HTTPS (443) to the model providers only: `api.anthropic.com`, `api.cloud.llamaindex.ai` (scanned pages, if a key is set), `api.openai.com` (voice questions, if a key is set); DNS to resolve those; the client's SMTP | All other outbound traffic |

Between the zones there is no network path. Tender packages and bundles go through the agreed
transfer (data diode or reviewed file drop), never a connection.

## 7. Day to day

* `sudo ./tenderos-patch status`: version, zone, health, containers, rollback target, last patches.
* Backups of the database and files on a schedule: `deploy/backup.sh` from the repository works
  unchanged in the install folder (`docker compose exec -T db pg_dump ...`); keep them on an
  encrypted volume. Every patch takes its own backup as well.
* Logs: `docker compose logs -f web engine caddy`.
* Certificate renewal: replace the files in `certs/` and `docker compose restart caddy`.
* Changing `.env` (SMTP, site address): edit it and `docker compose up -d`.

## Not run here

The scripts were written and syntax-checked, the patch tool's `verify` path is covered by
`tests/deploy/test_patch_tool.py` with a test keypair and tampered bundles, and the compose
overlay is validated with `docker compose config` for both zones. `build-bundle.sh`,
`install.sh` and `tenderos-patch apply`/`rollback` need a Docker daemon and have not been run
end to end yet: do a dry run on a jouleWise VM (build a bundle, install into `/tmp/tenderos`,
patch it with a second bundle, break a health check and watch the rollback) before the first
client delivery.
