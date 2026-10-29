# Installing TenderOS on any cloud or on-prem

How to put the whole package (Postgres, the engine with HiGHS, the web app, Caddy for HTTPS,
optional Docling) on a VM in AWS, Azure, GCP or your own data centre. The shared part is the
same everywhere: Docker Compose on an Ubuntu VM with ports 80 and 443 open. Only the VM creation,
the static IP and the firewall rule differ per cloud (section 12).

Everything below was checked against the scripts and compose files in `deploy/` and the code
in `web/` and `engine/`; the cloud CLI commands in section 12 are the providers' standard ones
and were not run here. `docs/DEPLOY.md` is the original GCP walkthrough; `docs/dev/DEV-MANUAL.md`
explains the parts.

## 1. What runs

| Service | Image | Published | Memory in use (measured, `docs/DEPLOY.md`) |
| --- | --- | --- | --- |
| `db` | `postgres:16-alpine` | no | small |
| `engine` | built from `deploy/engine.Dockerfile` (python 3.12, HiGHS, PyMuPDF) | no | about 0.5 GB while sizing |
| `web` | built from `web/Dockerfile` (node 22, Next.js) | no on a VM (Caddy in front); port 3000 with the base compose only | |
| `caddy` | `caddy:2.8-alpine` | 80, 443 (and 443/udp) | small |
| `docling` (optional) | `quay.io/docling-project/docling-serve-cpu:v1.35.0` | no | about 2 GB; several GB of models on disk |

Building the images needs about 2 GB; a sizing takes about a minute on 4 vCPU ("one to two minutes
on 4 CPU cores", `docs/enterprise/ARCHITECTURE.md`); the engine allows two sizings at once.

## 2. Prerequisites

* **VM:** 4 vCPU, 16 GB RAM, 50 GB disk, x86-64. This is what `deploy/gcp-create-vm.sh` creates
  (`e2-standard-4`, `pd-balanced` 50 GB) and the measured figures fit it with Docling. Without
  Docling, 2 vCPU and 8 GB run the demo but sizings take longer and the image build is tight.
* **OS:** Ubuntu 24.04 LTS (what the GCP script uses) or Debian 12. `deploy/bootstrap.sh` installs
  Docker with `get.docker.com` on apt systems; on another distribution install Docker Engine with
  the Compose v2 plugin yourself and run the bootstrap with `SKIP_INSTALL=1`.
* **Network:** a public IP that stays (static), DNS if you want your own name, ports 80 and 443
  reachable from the users (80 also from the internet while Let's Encrypt issues the certificate),
  22 from your admin network only. Outbound HTTPS to Docker Hub, GitHub, Let's Encrypt and, if used,
  `api.anthropic.com`, `api.openai.com`, `api.cloud.llamaindex.ai`.
* **Tools on your machine:** `git`, `ssh`; optionally the cloud CLI.

## 3. OS and Docker

On a fresh Ubuntu VM (what `deploy/bootstrap.sh` does in `install_packages`):

```
sudo apt-get update -qq
sudo apt-get install -y ca-certificates curl git openssl
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
docker compose version          # needs the v2 plugin
```

Add your user to the `docker` group if you do not want to `sudo` every command
(`sudo usermod -aG docker $USER`, then log in again).

## 4. Get the code

**From git (demo and development installs):**

```
sudo git clone --branch <branch> https://github.com/Ergplan/tenderos2.git /opt/tenderos
cd /opt/tenderos
```

The branch today is `claude/laughing-pascal-7akw12` (`docs/DEPLOY.md` §7 clones it; there are no
release tags yet). Note that `deploy/bootstrap.sh` defaults to `REPO_URL=https://github.com/Ergplan/tenderos.git`
(Demo 1) and `BRANCH=main`; for Demo 2 pass `REPO_URL=https://github.com/Ergplan/tenderos2.git`
and `BRANCH=<branch>`.

**From the enterprise bundle (air-gapped installs):** jouleWise builds
`tenderos-<version>.bundle.tar` with `deploy/enterprise/build-bundle.sh` (images, compose files,
Caddyfile for your own certificate, migrations, changelog, signed manifest). The client's IT
installs it with the `install.sh` inside the bundle; no internet is needed on the host. Section 11.

## 5. Create `.env`

```
cd /opt/tenderos
cp .env.example .env
chmod 600 .env
```

Never commit `.env` (`.gitignore` excludes it). Generate the secrets with openssl, never type
them by hand:

```
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
```

Every variable, from `.env.example` and the compose files:

| Variable | Set it to | Required |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | yes |
| `SESSION_SECRET` | `openssl rand -hex 32` (32+ characters; the web app refuses less) | yes |
| `COMPOSE_FILE` | `docker-compose.yml:deploy/docker-compose.vm.yml` for a VM with Caddy; omit to publish port 3000 without TLS | VM |
| `SITE_ADDRESS` | your domain, or `<ip-with-dashes>.sslip.io` (section 6) | VM |
| `COOKIE_SECURE` | `true` behind HTTPS (the VM overlay sets it anyway) | |
| `WEB_PORT` | the published port when not using the overlay (default 3000) | |
| `ANTHROPIC_API_KEY` | model reading of tenders; empty = rules reader | no |
| `EXTRACTION_MODEL`, `EXTRACTION_REQUIRE_LLM` | leave empty | no |
| `DOCLING_URL` | leave unset to use the compose `docling` service; set to empty (`DOCLING_URL=`) to run without it | no |
| `LLAMA_CLOUD_API_KEY` | LlamaParse for scanned pages | no |
| `OPENAI_API_KEY`, `OPENAI_LIVE_BACKEND_MODEL`, `OPENAI_LIVE_VOICE` | the SECI voice agent (needs HTTPS for the microphone) | no |
| `MCP_TOKEN` | `openssl rand -hex 24` to switch the Claude connector on; empty = off | no |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `MAIL_FROM`, `APP_URL` | team email; `APP_URL=https://<site>` | no |
| `TENDEROS_ZONE` | `intake`, `core`, or leave unset for one installation with everything | no |
| `TENDEROS_VERSION` | a label shown in `/api/health` and the sidebar (the enterprise installer writes it) | no |
| `DATABASE_URL`, `ENGINE_URL` | only for local runs without compose; compose sets its own | no |

`deploy/bootstrap.sh` writes the same file for you (random password and secret, `COMPOSE_FILE`,
`SITE_ADDRESS`, `COOKIE_SECURE=true`, the Anthropic key if given) and keeps an existing one.

## 6. DNS and TLS

Three options. The site address goes in `SITE_ADDRESS`.

1. **Your own domain with Caddy's automatic HTTPS** (`deploy/Caddyfile`, used by
   `deploy/docker-compose.vm.yml`): create an A record `tenderos.example.com → <static IP>` before
   starting, set `SITE_ADDRESS=tenderos.example.com`. Caddy obtains and renews the Let's Encrypt
   certificate itself; ports 80 and 443 must reach the VM from the internet during issuance.
2. **No domain yet: sslip.io.** `SITE_ADDRESS=203-0-113-10.sslip.io` (the IP with dashes) resolves
   to the IP without any DNS of your own; Caddy issues a real certificate for it. This is the
   bootstrap's default (`write_env` builds it from the external IP).
3. **A certificate you provide** (`deploy/enterprise/Caddyfile` and the enterprise overlay): put
   the server certificate followed by its chain in `certs/tenderos.crt` and the key in
   `certs/tenderos.key` (PEM) in the install folder; Caddy never contacts an ACME server
   (`auto_https disable_certs`). Renewal: replace the files and `docker compose restart caddy`.
   You can use this overlay with a git install too:
   `COMPOSE_FILE=docker-compose.yml:deploy/enterprise/docker-compose.enterprise.yml` with
   `TENDEROS_CADDYFILE=./deploy/enterprise/Caddyfile`, `TENDEROS_CERTS_DIR=./certs` and
   `TENDEROS_VERSION=dev` (the overlay names the images `tenderos-web:<version>`; build them with
   `docker compose build`).

Caddy also redirects HTTP to HTTPS, sets HSTS and other headers, accepts bodies up to 100 MB
(tender uploads are up to 60 MB per file, 120 MB per set) and streams the sizing's progress lines.

## 7. Firewall

| Port | Open to | Why |
| --- | --- | --- |
| 443/tcp (and 443/udp for HTTP/3) | the users' networks, or everyone for a demo (the app needs a login) | the site |
| 80/tcp | everyone, while using Let's Encrypt (option 1 or 2); otherwise the users' networks | certificate issuance; redirect to HTTPS |
| 22/tcp | your admin network or the cloud's identity-aware proxy only | SSH |
| anything else | nobody | Postgres, the engine and Docling have no published port |

For the Claude connector, 443 must also be reachable from Anthropic's outbound range
`160.79.104.0/21` (`docs/MCP.md`). For the enterprise zones, the outbound rules per zone are in
`deploy/enterprise/README.md` §6 (the core allows SMTP and the directory server only).

## 8. Start the stack

The scripted way, on the VM (installs Docker, clones, writes `.env`, builds, creates the
administrator, starts Caddy):

```
sudo REPO_URL=https://github.com/Ergplan/tenderos2.git BRANCH=<branch> \
     ADMIN_EMAIL=you@company.com SITE_ADDRESS=tenderos.example.com \
     ANTHROPIC_API_KEY=... bash deploy/bootstrap.sh
```

(`SITE_ADDRESS` and `ANTHROPIC_API_KEY` optional; `SKIP_INSTALL=1` when Docker exists;
`NO_BUILD=1` to reuse images; `TENDEROS_DIR` for another folder. Re-running is safe: it keeps
`.env`, the database and the administrator. The generated password is printed and kept in
`/root/tenderos-admin.txt`, mode 600.)

By hand, after sections 4 to 7:

```
cd /opt/tenderos
docker compose build                 # a few minutes the first time
docker compose up -d db engine web   # nothing reachable from outside yet
docker compose exec -T web wget -qO- http://127.0.0.1:3000/api/health   # wait for "database":"ok"
# create the first administrator now (section 10), then:
docker compose up -d caddy
curl -fsS https://<site>/api/health
```

`docker compose ps` shows the health of every container (both images carry a `HEALTHCHECK` on
`/api/health`). Without the VM overlay in `COMPOSE_FILE`, `docker compose up -d --build` publishes
the web app on `http://<host>:3000` with no TLS (set `COOKIE_SECURE=false`).

## 9. Migrations

Nothing to run. The web app applies `web/db/migrations/*.sql` on every start
(`web/instrumentation.js` → `migrate()` in `web/lib/db.js`): under an advisory lock it creates
`schema_migrations`, applies each file not yet recorded in name order, one transaction per file,
and retries 30 times at 2-second intervals while the database comes up. It then seeds the built-in
resource profiles and tender readings. The container copies `db/` into the image
(`web/Dockerfile`), so a new migration ships with a rebuild of `web`. Check what was applied:

```
docker compose exec db psql -U tenderos -d tenderos -c "select name, applied_at from schema_migrations order by name"
```

## 10. First user and administrator

* On a fresh database `GET /api/auth/setup` answers `{needsSetup: true}` and `/setup` shows the
  form (`web/app/setup/page.js`); `POST /api/auth/setup` creates the first user as `admin` only
  while the `users` table is empty (locked in a transaction), then signs them in
  (`web/app/api/auth/setup/route.js`). Once a user exists `/setup` redirects to `/login` and the
  route answers 409. Passwords are at least 8 characters, hashed with scrypt.
* `deploy/bootstrap.sh` does this for you before Caddy opens the site, so nobody on the internet
  can claim the setup page (`create_admin`).
* Then sign in, open **Users** (`/admin/users`) to add people and grant them tabs; the same page
  sets the default tabs for users without their own list (`web/components/TabAccess.jsx`,
  `PUT /api/settings/tabs`).
* **Demo mode vs real sign-in.** `DEMO_MODE=1` on the web service (used by `deploy/demo2` and
  `deploy/shared-vm`) signs every visitor in as one shared user with every tab, and switches off
  setup, account changes and administration (`web/lib/demo.js`, `web/app/api/auth/demo/route.js`).
  Use it only for a demo behind a firewall; a client installation runs with real sign-in and
  `COOKIE_SECURE=true`.

## 11. Operate it

**Backups** (`deploy/backup.sh`, run on the VM):

```
sudo bash /opt/tenderos/deploy/backup.sh
```

It dumps the database to `backups/tenderos-<time>.sql.gz` and the uploaded files (evidence,
signed copies, CERC orders) to `backups/tenderos-files-<time>.tar.gz`, keeping the newest 14 of
each. Put it in cron (for example `0 2 * * * root bash /opt/tenderos/deploy/backup.sh`) and copy
`backups/` off the VM. The restore steps are in the script's header:

```
docker compose stop web
docker compose exec -T db dropdb -U tenderos tenderos
docker compose exec -T db createdb -U tenderos tenderos
gunzip -c backups/<file>.sql.gz | docker compose exec -T db psql -q -U tenderos -d tenderos
docker compose start web
docker compose exec -T web tar -xzf - -C /data < backups/tenderos-files-<time>.tar.gz
```

**Updates from git** (`deploy/update.sh`): backup, `git pull --ff-only`, `docker compose build`,
`docker compose up -d`, prune old images, then poll `https://$SITE_ADDRESS/api/health`:

```
sudo bash /opt/tenderos/deploy/update.sh
```

Run it also after editing `.env` (compose recreates the containers whose environment changed).

**The enterprise patch path** (`deploy/enterprise/README.md`): the first install is
`sudo bash install.sh tenderos-<version>.bundle.tar /opt/tenderos`, which prints the release
key's fingerprint for you to compare with the one received out of band, verifies the bundle,
asks the zone, site address, SMTP and (intake only) cloud keys, writes `.env` with generated
secrets, waits for `certs/tenderos.crt` and `certs/tenderos.key`, `docker load`s the images,
starts the stack and waits for health. Later releases:

```
cd /opt/tenderos
sudo ./tenderos-patch verify tenderos-<version>.bundle.tar   # signature and checksums
sudo ./tenderos-patch apply  tenderos-<version>.bundle.tar   # backup, load, restart, health check; rolls back on failure
sudo ./tenderos-patch status
sudo ./tenderos-patch rollback                               # back to before the last apply (restores the database dump)
```

**Health checks:** `curl -fsS https://<site>/api/health` returns
`{"web":"ok","database":"ok","engine":"ok","zone":"all","version":"dev"}` (503 when the database is
down; `engine` is checked through its `/docs` page). Inside the stack:
`docker compose exec web wget -qO- http://engine:8000/api/health` reports the reader's status
(model, Docling, LlamaParse).

**Logs:** `docker compose logs -f web engine caddy` (add `docling` when used).

**The Claude connector:** set `MCP_TOKEN` (section 5), `docker compose up -d web`, and add
`https://<site>/api/mcp/<MCP_TOKEN>` as a custom connector with "No sign-in" (`docs/MCP.md`). The
token is the only key: keep the URL private, rotate it by changing `.env` and recreating `web`.

**The zone flag:** `TENDEROS_ZONE=intake` runs the tender reading with cloud models;
`core` refuses the reading routes and the voice agent and expects signed packages; unset means
one installation with everything. The sidebar badge and `/api/health` show it.

## 12. Per-cloud differences

Everything in sections 3 to 11 is the same. What differs: creating the VM, reserving a static
IP, and the firewall rule. Replace the names and the admin CIDR.

### AWS EC2 (Ubuntu)

```
# security group: 80 from anywhere (Let's Encrypt), 443 from the users, 22 from the admin network
aws ec2 create-security-group --group-name tenderos --description "TenderOS" --vpc-id <vpc>
aws ec2 authorize-security-group-ingress --group-name tenderos --protocol tcp --port 80  --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-name tenderos --protocol tcp --port 443 --cidr <users-cidr>
aws ec2 authorize-security-group-ingress --group-name tenderos --protocol udp --port 443 --cidr <users-cidr>
aws ec2 authorize-security-group-ingress --group-name tenderos --protocol tcp --port 22  --cidr <admin-cidr>
# a 4 vCPU / 16 GB instance with a 50 GB disk, Ubuntu 24.04
aws ec2 run-instances --image-id <ubuntu-24.04-ami> --instance-type m6i.xlarge --key-name <key> \
  --security-groups tenderos --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=50}'
# a static address
aws ec2 allocate-address --domain vpc
aws ec2 associate-address --instance-id <id> --allocation-id <eipalloc>
ssh -i <key.pem> ubuntu@<elastic-ip>
```

Then section 8 with `SITE_ADDRESS` pointing at the Elastic IP (or `<ip-with-dashes>.sslip.io`).
`bootstrap.sh` finds the external IP through `api.ipify.org` when it is not on GCP.

### Azure VM

```
az group create -n tenderos -l centralindia
az vm create -g tenderos -n tenderos --image Ubuntu2404 --size Standard_D4s_v5 \
  --os-disk-size-gb 50 --public-ip-sku Standard --public-ip-address-allocation static \
  --admin-username azureuser --generate-ssh-keys
# NSG rules (the VM's NSG is created by az vm create as tenderosNSG)
az network nsg rule create -g tenderos --nsg-name tenderosNSG -n http  --priority 100 --destination-port-ranges 80  --access Allow --protocol Tcp --source-address-prefixes '*'
az network nsg rule create -g tenderos --nsg-name tenderosNSG -n https --priority 110 --destination-port-ranges 443 --access Allow --protocol '*'  --source-address-prefixes <users-cidr>
az network nsg rule create -g tenderos --nsg-name tenderosNSG -n ssh   --priority 120 --destination-port-ranges 22  --access Allow --protocol Tcp --source-address-prefixes <admin-cidr>
ssh azureuser@$(az vm show -d -g tenderos -n tenderos --query publicIps -o tsv)
```

A Standard SKU public IP with static allocation keeps the address across restarts.

### GCP Compute Engine

This one is scripted: from a clone of the repository, in Cloud Shell,

```
PROJECT=<gcp-project-id> ADMIN_EMAIL=<your-login> WEB_SOURCES=<users-cidr> \
  SITE_ADDRESS=<domain or empty> BRANCH=<branch> bash deploy/gcp-create-vm.sh
```

`deploy/gcp-create-vm.sh` reserves a regional static IP, creates three firewall rules
(`tcp:80` from everyone, `tcp:443,udp:443` from `WEB_SOURCES`, `tcp:22` from the IAP range
`35.235.240.0/20`), creates an `e2-standard-4` Ubuntu 24.04 VM with a 50 GB disk in
`asia-south1-a` (`ZONE`, `MACHINE`, `NAME` are variables), and runs the bootstrap over
`gcloud compute ssh --tunnel-through-iap`. Note that the script fetches the bootstrap from
`Ergplan/tenderos` raw on GitHub and does not pass `REPO_URL`; for Demo 2 run the bootstrap on the
VM yourself with `REPO_URL` and `BRANCH` set (section 8), or edit the last line of the script.
Removal: `docs/DEPLOY.md` §8.

### Generic on-prem VM

* A VM or bare host with Ubuntu 24.04 / Debian 12, 4 vCPU, 16 GB, 50 GB, and a fixed IP on your
  network.
* Open 443 (and 80) on the host and the perimeter firewall to the users; 22 to the admin network.
* Without a public IP, Let's Encrypt cannot reach the host: use option 3 of section 6 (your own
  certificate with `deploy/enterprise/Caddyfile`), or an internal CA.
* Without internet on the host, use the enterprise bundle (section 11) instead of git and Docker
  Hub; `install.sh` and `tenderos-patch` need only Docker, bash, openssl, tar and sha256sum.
* Give the Docker volumes (`db`, `team_files`, `extraction_jobs`, `caddy_data`) an encrypted disk
  and include `backups/` in your backup rotation.

## 13. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `docker compose up` refuses: `set POSTGRES_PASSWORD in .env` or `set SESSION_SECRET in .env` | The two required variables (`docker-compose.yml` uses `${VAR:?}`); `SITE_ADDRESS` likewise with the VM overlay |
| Web container restarts; log says `SESSION_SECRET must be set (32+ characters)` | Generate it with `openssl rand -hex 32` (`web/lib/session.js`) |
| Log says `[db] migration attempt N failed` then `Database migrations failed` | Postgres not reachable from `web`: check `docker compose ps db`, `DATABASE_URL`, the password; the app retries for a minute before giving up |
| `the web app did not become healthy` (bootstrap) | `docker compose logs --tail 40 web engine`; usually the database password or a build that ran out of memory (needs about 2 GB) |
| `https://<site>` does not answer after start | Ports 80/443 not open, or the name does not resolve to this VM; `docker compose logs caddy` shows the ACME errors (`certificate obtained` when fine). With sslip.io the IP must be the VM's public IP |
| Sign-in works on HTTP but not behind HTTPS, or vice versa | `COOKIE_SECURE` must be `true` behind TLS and `false` on plain HTTP (`web/lib/session.js`) |
| `Contact Administrator: no access to this part of the engine` (403) | The user's tabs do not include one that needs that route family (`web/lib/tabs.js`); grant the tab |
| `Not in the core zone: tender documents are read in the intake zone…` (403) | `TENDEROS_ZONE=core` refuses the reading routes by design; read in the intake zone or unset the flag |
| `Engine unavailable: …` (502) or `Engine timed out` | The engine container is down or a solve exceeded `ENGINE_TIMEOUT_MS` (30 min); `docker compose logs engine` |
| Sizing says "Another HiGHS run is in progress on this server; waiting for a free slot" | Two solves already running (`_LP_SLOTS` in `engine/app.py`); it queues |
| "The file is larger than 60 MB" / "The set is larger than 120 MB" | The engine's upload limits (`engine/app.py`); Caddy's body limit is 100 MB per request |
| The Tender step says the rules reader was used | No `ANTHROPIC_API_KEY` on the engine, or a DOCX/text upload; set the key in `.env` and run `deploy/update.sh` |
| A tender set's warnings say PyMuPDF tables were used | Docling is down or `DOCLING_URL=`; its first conversion after a start loads models for a minute or two |
| The voice agent panel says it is not set up / microphone does not start | `OPENAI_API_KEY` missing on the web service, or the page is plain HTTP (browsers allow the microphone on HTTPS or localhost only) |
| `/api/mcp/<token>` answers 404 | `MCP_TOKEN` empty or shorter than 16 characters, or a wrong token; GET answers 405 by design |
| `Too many attempts. Try again in 15 minutes.` (429) | The login brake: 10 failures per email and IP in 15 minutes (`web/app/api/auth/login/route.js`) |
| `/setup` sends you to `/login` | A user already exists; sign in, or reset the database |
| Team email not sent | `SMTP_HOST` unset (the Team panel says email is off); on a demo the mails stay in the Outbox tab |
| `tenderos-patch apply` rolled back | The new version did not answer `/api/health` with its version within `TENDEROS_HEALTH_WAIT` (300 s); `docker compose logs web db`, then `tenderos-patch status` |
| Space runs out | `docker image prune -f` (update.sh does it); Docling's models and `backups/` are the big items |
