# Demo licences

TenderOS 2 gives clients demo licences: an account that opens only the tabs chosen for it, until
an end date, in a workspace of its own. The licensing administrator gives them on **Administration ›
Users and licences** and hands over the sign-in details the screen shows.

## Before the first licence: switch demo mode off

A licence needs sign-in, so the server must not run in demo mode (`DEMO_MODE=1` signs every visitor
in as one shared user and switches administration off).

1. On the server, in `~/tenderos2/.env`: `DEMO_MODE=0` (the Demo 2 compose file,
   `deploy/demo2/docker-compose.demo2.yml`, reads it; without it the app stays in demo mode) and,
   served over HTTPS, `COOKIE_SECURE=true`. A plain `docker-compose.yml` installation has no
   demo mode unless a file of your own sets it: `docker compose config | grep DEMO_MODE` shows it.
2. `git pull && docker compose build web && docker compose up -d web`.

On the shared VM the address shows the chooser: TenderOS (Demo 2) and the old app. A client's
sign-in details point past it, to `https://<site>/__switch/demo2` (`SIGN_IN_PATH`, set by the Demo
2 compose file), and a client's sidebar has no "Switch app".

**Demo 1 is for TenderOS administrators only.** It is off the chooser; the router
(`deploy/demo2/apps.caddy`) asks TenderOS's `/api/auth/gate` before every Demo 1 request, with the
visitor's cookies: an administrator signed in to TenderOS passes (204), anyone else is sent to the
TenderOS sign-in. Administrators open it with **Demo 1 · administrators only** in the sidebar
(`DEMO1_URL`, `/__switch/new`). Demo 1's own code and data are unchanged; it keeps its cookie
`tenderos_session`, and TenderOS on this address uses `tenderos2_session` (`SESSION_COOKIE_NAME`),
so opening one does not sign you out of the other. Signing out of TenderOS closes Demo 1 too.
After this change everyone signs in to TenderOS once more (the cookie's name changed).

On its first start the web app applies `web/db/migrations/021_licences.sql`, which adds the licence
columns and creates the licensing administrator **ergcon@joulewise.com** with the password handed
over separately (only its scrypt hash is in the migration). Sign in at `https://<site>/login` and
change it at once: your name at the bottom of the sidebar › Account. An account that already has
that email is left as it is.

Saved bids made in demo mode belong to the shared demo user, in the operator's own workspace: the
administrators and the operator's team see them, clients never do.

## Giving a licence

**Give a demo licence** takes:

| Field | Meaning |
| --- | --- |
| Email | The client's sign-in |
| Name | Shown in the sidebar and the list |
| Company (its workspace) | Required for a client. Everyone of one company shares a workspace: they see each other's saved bids, and nobody else's. Tick *One of our team* for a colleague instead: our workspace, no end needed |
| Role | User; or Administrator (every tab, every workspace, this screen) |
| Valid for | 7, 14, 30, 60 or 90 days, until a date (the end of that day, India time), or no end date |
| Note | For us: the deal, the contact |
| Tabs they can open | The tabs of the workspace; the others show locked, with whom to contact |

**Give the licence** generates the password (four groups of five letters and digits, no look-alike
characters) and shows a card with the address, the email, the password, the tabs and the end date:
**Copy** puts it on the clipboard, **Write an email** opens it in the mail program. The password is
shown only then; TenderOS keeps only its hash.

## Managing licences

The list shows each account's workspace, tabs, licence (days left; amber in the last week; red when
ended or switched off) and last sign-in, with:

* **New password**: a new generated password, shown once in the card; the old one stops and every
  session of that account ends.
* **+30 days**: thirty days more, from the end date (or from today if it has passed).
* **Switch off / Switch on**: off signs the account out at once and refuses sign-in.
* **Remove**: deletes the account; its saved bids pass to our workspace.

The tabs of an account are changed in the table under the list (*Change the tabs of an account*).

When a licence is switched off or has ended, sign-in says so ("This demo licence ended on 19
November 2026. To continue, write to ergcon@joulewise.com.") and an open session stops at its next
request. Every licence given or changed is in **Activity**.

## What a client sees

* Its tabs; the others locked.
* Its company and the licence's end under its name in the sidebar.
* The library (Saved scenarios), tender readings and uploaded wind and solar profiles of its own
  workspace, and the built-in ones. A bid of another workspace is "not found", by list or by link.
* No Team setup, Messages, Feedback or Change requests: the tender team spans the installation.
* Its account page, to change its password.

The server enforces all of it: a tab's routes refuse an account without the tab, the library and
the readings are filtered by workspace in the database query, and a client is never a member of
the tender team.

## Where it is in the code

| | |
| --- | --- |
| `web/db/migrations/021_licences.sql` | `users.org`, `expires_at`, `disabled`, `note`, `created_by`; the administrator |
| `web/lib/workspace.js` | `isClient`, `visibleTo` (the SQL condition per viewer), `licenceProblem`, `licenceEnd`, `generatePassword` |
| `web/lib/auth.js` | `currentUser` refuses an account switched off or ended; `currentUserWithAccess` marks `client` |
| `web/app/api/auth/login/route.js` | Sign-in says why a licence does not sign in |
| `web/app/api/users/route.js`, `[id]/route.js` | Give a licence (password generated and returned once); change its end, workspace, note, on/off; a new password |
| `web/lib/scenarios.js`, `tenders.js`, `profiles.js` | Lists and items filtered by workspace |
| `web/lib/team.js` | `actingMember`: a client is never on the team |
| `web/components/UserAdmin.jsx` | The screen and the credentials card |
| `web/src/main.jsx` | The sidebar for a client |

Checks: `tools/check_licences.mjs` (the rules, the generated passwords, the migration). The
browser test of the whole flow (administrator, two clients, switch off, an ended licence, +30 days)
is described in `docs/dev/FUNCTIONAL-TESTS.md`.
