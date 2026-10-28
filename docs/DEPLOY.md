# Deploying a demo VM

One VM runs everything with Docker Compose:

* Postgres;
* the engine;
* the web app;
* Caddy, which serves HTTPS on ports 80 and 443 with a Let's Encrypt certificate.

Only Caddy is reachable from outside.

## 1. Create the VM (Google Cloud)

Run this in Cloud Shell, in a clone of this repository:

```
PROJECT=<gcp-project-id> ADMIN_EMAIL=<your-login> bash deploy/gcp-create-vm.sh
```

The script does the following:

* It reserves a static IP and creates three firewall rules:
  * port 80, open to all, so Let's Encrypt can issue the certificate;
  * port 443, open to `WEB_SOURCES` (default: everyone; the app needs a login);
  * port 22, open only to Google's IAP range.
* It creates an `e2-standard-4` VM: 4 vCPU, 16 GB, Ubuntu 24.04, a 50 GB disk, in Mumbai
  (`asia-south1-a`). Sizing a tender on this VM takes about a minute.
* It runs `deploy/bootstrap.sh` on the VM.

At the end, the script prints the URL, the login and a generated password. The password is
also kept on the VM in `/root/tenderos-admin.txt`.

Options (environment variables):

| Variable | Default | |
| --- | --- | --- |
| `ZONE` | `asia-south1-a` | |
| `MACHINE` | `e2-standard-4` | |
| `WEB_SOURCES` | `0.0.0.0/0` | Comma-separated CIDRs allowed on 443, such as the client's office IPs |
| `SITE_ADDRESS` | `<ip>.sslip.io` | Your domain; point its A record at the static IP first |
| `ANTHROPIC_API_KEY` | (unset) | Model reading of tenders (see 4) |
| `BRANCH` | `main` | |

The script creates the VM only. On any other cloud, or on an existing Ubuntu/Debian VM, open
ports 80 and 443 and run the following on the VM:

```
curl -fsSL https://raw.githubusercontent.com/Ergplan/tenderos/main/deploy/bootstrap.sh -o bootstrap.sh
sudo ADMIN_EMAIL=<your-login> bash bootstrap.sh
```

## 2. What the bootstrap does

1. Installs Docker and clones the repository to `/opt/tenderos`.
2. Writes `/opt/tenderos/.env` (mode 600): random database password and session secret, the
   site address, and the API key if one was given. It keeps an existing `.env`.
3. Builds and starts the database, the engine and the web app, with nothing exposed yet.
4. Creates the administrator with a generated password. Nobody else can claim the first-run
   setup page.
5. Starts Caddy, which fetches the certificate and opens the site.

Running the bootstrap again is safe. It keeps the `.env`, the database and the administrator.

## 3. Operating it

| Task | Command (on the VM) |
| --- | --- |
| Update to the latest code, after a database backup | `sudo bash /opt/tenderos/deploy/update.sh` |
| Back up the database (the newest 14 are kept in `backups/`) | `sudo bash /opt/tenderos/deploy/backup.sh` |
| Restore | the steps at the top of `deploy/backup.sh` |
| Logs | `cd /opt/tenderos && sudo docker compose logs -f web engine caddy` |
| Status | `cd /opt/tenderos && sudo docker compose ps` |

To add client users, sign in as the administrator and open **Users**. Give each user only the
tabs they should see, for example Tender to Bid.

## 4. Model reading

Without `ANTHROPIC_API_KEY`, tenders are read by the rules reader. It finds the headline fields,
about 31 on the NHPC RfS, each with its page and quote. That is enough for the Tender to Bid
flow.

To enable model reading:

1. Put the key in `/opt/tenderos/.env`.
2. Run `deploy/update.sh`.

The model path has not yet been run against a real tender. Before a client sees it, read the
NHPC RfS once and compare the result with `samples/tenders/nhpc-fdre-ii/reviewed-reading.yaml`.

## 5. Demo run

1. Sign in.
2. On **Tender to Bid**, open "Read a new tender" and upload
   `samples/tenders/nhpc-fdre-ii/RfS.pdf` (264 pages; read in about 5 s).
3. Go through the steps, choosing solar, wind and battery and filling in the benchmarks.
4. Click **Size the plant**. It takes about a minute.
5. Review the tender conditions, open Financials and download the Excel model.

`docs/E2E-NHPC.md` lists the expected numbers.

To check a deployed site from any machine with the repository:

```
TENDEROS_URL=https://<site> TENDEROS_EMAIL=… TENDEROS_PASSWORD=… make e2e
```

## 6. Beside the old app on the shared VM (port 8081)

On the tariff-order VM (34.131.67.235), the old jouleWise app (compose project `fdre-dashboard`)
was published on port 8081. Ports 80 and 443 belong to the tariff-order app's Caddy and are
not touched. `deploy/shared-vm/install.sh` puts TenderOS beside the old app:

* `http://34.131.67.235:8081/` shows a chooser: **TenderOS** (new design and workflow, no
  sign-in) or the **old app** (unchanged, existing accounts).
  * The choice is a cookie, so the address stays the same and both apps keep their root paths.
  * "Switch app" in the TenderOS sidebar, or `/__switch`, shows the chooser again.
* TenderOS runs in demo mode (`DEMO_MODE=1`). Every visitor is signed in as one shared demo user
  who can open every tab.
  * Sign-in, first-run setup, account changes and administration are switched off.
  * Saved scenarios are shared by everyone who opens the demo.
* The old app's web container moves from `0.0.0.0:8081` to `127.0.0.1:8082`, and the router
  reaches it over its compose network. Its database, engine and data are not touched. The
  move costs about 10 seconds of downtime.
  * If the old app's own `deploy/update.sh` runs later, it re-publishes on port 8082. The
    router still finds it by container name.
* Measured memory use is about 0.5 GB for TenderOS while sizing NHPC; the build needs about 2 GB.
* The SECI RTC tab's voice bid agent (GPT-Live) needs `OPENAI_API_KEY` in TenderOS's `.env`.
  * Add the key there, then re-run the install to restart the web service.
  * The key stays on the server.
  * Without the key, the agent's panel says it is not set up.
* Browsers allow the microphone only on HTTPS or localhost, and the 8081 address is plain HTTP.
  To talk to the agent there, either open an SSH tunnel and browse to `http://localhost:8081`
  (`gcloud compute ssh <vm> -- -L 8081:localhost:8081`), or serve the router over HTTPS (below).

### HTTPS on the shared VM

`deploy/shared-vm/docker-compose.https.yml` makes the router serve the same chooser and apps on
`https://$SITE_ADDRESS`:

* Caddy gets the certificate from Let's Encrypt (ZeroSSL as fallback) and renews it.
* Port 80 redirects to HTTPS.
* Port 8081 stays as it was.

Ports 80 and 443 must be free, and port 80 or 443 must be open to the internet for the certificate
check. On the tariff-order VM those ports were ekbill's Caddy, which is stopped for this.

```
cd <tenderos folder>
docker stop ekbill-caddy-1 ekbill-app-1 ekbill-docling-1 ekbill-db-1
sed -i '/^COMPOSE_FILE=/d;/^SITE_ADDRESS=/d' .env
echo 'COMPOSE_FILE=docker-compose.yml:deploy/shared-vm/docker-compose.shared.yml:deploy/shared-vm/docker-compose.https.yml' >> .env
echo 'SITE_ADDRESS=34-131-67-235.sslip.io' >> .env
docker compose -p tenderos up -d router
docker logs tenderos-router-1 2>&1 | grep -iE "certificate obtained|error" | tail -5
```

For your own domain, point its DNS A record at the VM and use it as `SITE_ADDRESS`.

**Undo:**

```
sed -i 's#:deploy/shared-vm/docker-compose.https.yml##' .env && docker compose -p tenderos up -d router
docker start ekbill-db-1 ekbill-docling-1 ekbill-app-1 ekbill-caddy-1
```

The first command puts the router back on 8081 only. The second brings ekbill back on ports 80
and 443.

Tested here with Caddy 2.8.4 and `SITE_ADDRESS=localhost` (a locally signed certificate):

* the chooser and both apps over HTTPS;
* the redirect from port 80;
* port 8081 unchanged;
* in Chromium, the page is a secure context and the agent's microphone start goes through.

A Let's Encrypt certificate for the VM's address has not been issued here.

```
curl -fsSL https://raw.githubusercontent.com/Ergplan/tenderos/main/deploy/shared-vm/install.sh -o install.sh
sudo bash install.sh                                 # BRANCH=... for another branch
sudo bash /opt/tenderos/deploy/shared-vm/rollback.sh  # undo: old app back on 8081
```

Tested here against a stand-in for the old app: a compose project `fdre-dashboard` with a
`${WEB_PORT}:3000` web service and a Postgres db. The tests covered:

* the install and the move of the old app to `127.0.0.1:8082`;
* the chooser, both switches and `/__switch`;
* the NHPC browser run through the chooser with no sign-in;
* setup, account and admin closed;
* the rollback to 8081 and a re-install.

The real old app has not been run behind the router here.

### Docling for tender sets

`docker-compose.yml` runs a `docling` service with the image
`quay.io/docling-project/docling-serve-cpu:v1.35.0`. ekbill's `ekbill-docling-1` already pulled
it on the tariff-order VM. The engine reads a tender set's amendment and clarification tables
through it at `http://docling:5001`. The service needs about 2 GB of memory. The first conversion
after a start loads its models (a minute or two).

* To run without it, put `DOCLING_URL=` (empty) in `.env` and stop the service:
  `docker compose -p tenderos stop docling`.
* The engine then uses PyMuPDF's table finder and says so in the set's warnings.
* To read scanned pages with LlamaParse, add `LLAMA_CLOUD_API_KEY=` to `.env`.

On the shared VM, update the code and start the new service with the rest:

```
cd <tenderos folder>
git pull
docker compose -p tenderos up -d --build
docker compose -p tenderos ps docling engine
```

### Team sharing: email and files

* **Email.** To email people about their assignments, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASSWORD`, `MAIL_FROM` and `APP_URL` in `.env`, then rerun the update or install. Without
  them the Team panel says email is off.
* **Files.** Uploaded files (signed copies) live in the `team_files` Docker volume. The backup
  script archives them beside the database. See `docs/TEAM.md`.

## 7. Demo 2 beside Demo 1 on the shared VM

Demo 2 (this repository, `Ergplan/tenderos2`, public) runs as its own compose project `tenderos2`
in `~/tenderos2`, beside Demo 1 (`~/tenderos`, project `tenderos`) and the old app.

* **Its own:** database, engine and web app, with its own volumes.
* **Borrowed from Demo 1:** the Docling service, reached over Demo 1's network (it holds several GB
  of models).
* **Router:** its router takes over port 8081, and 80/443 when Demo 1 had HTTPS, reusing Demo 1's
  certificate volume. It serves a chooser of all three apps: Demo 2, Demo 1 and the old app.

Nothing of Demo 1 changes except that its router container is stopped.

As the `venture` user, on the VM:

```
cd ~ && git clone -b claude/laughing-pascal-7akw12 https://github.com/Ergplan/tenderos2.git
cd ~/tenderos2 && bash deploy/demo2/install.sh
```

`install.sh` does the following:

1. Writes `.env` the first time:
   * a new database password and session secret;
   * the API keys and `SITE_ADDRESS` copied from `~/tenderos/.env`, not printed;
   * `COMPOSE_PROJECT_NAME=tenderos2`;
   * the compose files, with the HTTPS overlay when Demo 1 has a certificate.
2. Builds the engine and web images.
3. Starts the database, the engine and the web app, and waits for the web app to be healthy.
4. Stops Demo 1's router and starts Demo 2's.

Then open the usual address and choose "TenderOS Demo 2".

* **Update:** `cd ~/tenderos2 && git pull && docker compose build engine web && docker compose up -d engine web`.
* **Undo the router switch:** `bash deploy/demo2/rollback.sh`. Port 8081 and HTTPS go back to Demo 1's router, with the two-app chooser.
* **Stop Demo 2 entirely:** `docker compose stop` in `~/tenderos2`. Its volumes stay.
* **Memory:** Demo 2 adds a Postgres, an engine and a web app, about 1.5 GB in use. Check
  `free -h` before installing on a small VM.

## 8. Removing it

Delete the VM, the static IP and the firewall rules:

```
gcloud compute instances delete tenderos-demo --zone asia-south1-a
gcloud compute addresses delete tenderos-demo-ip --region asia-south1
gcloud compute firewall-rules delete tenderos-demo-http tenderos-demo-https tenderos-demo-ssh
```

## Tested

The bootstrap was run end to end on a Docker host with `SITE_ADDRESS=localhost`, where Caddy
issues its own certificate. Docker and the images were already present (`SKIP_INSTALL=1
NO_BUILD=1`). What was checked:

* HTTPS and the HTTP→HTTPS redirect;
* a secure, HttpOnly session cookie and HSTS;
* the web port closed to the outside, and `/setup` locked once the admin exists;
* the browser end-to-end test through Caddy, from upload to the Excel model;
* a second run that keeps `.env` and the admin;
* a backup, and a restore of it.

Not yet run:

* `gcp-create-vm.sh` on a real project;
* a real Let's Encrypt issuance;
* the Docker install step on a fresh Ubuntu VM.
