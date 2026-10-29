# Team sharing

The SECI RTC tender tab lets the tender's team share one saved bid. Anyone on the team can assign
any data point to a team or a person. The assignee answers with a value, a note or a file, and the
tender's super admin accepts the answer into the bid or returns it.

## Team mode: ping a teammate from any box

Every input box of every tab carries a small send icon at its top-right corner. The icon is clickable
while its box is under the mouse or has focus, so it never covers a button above the box. Click it
and the box's thread opens, Slack style:

* the box's label, where it is (tab › step › section) and its value now;
* the messages about it, each with who wrote it and when;
* a composer. Type `@` to see teammates, with those who cover the tab first. Pick one with Enter or
  a click. Add a **value** if you are answering.

People are mentioned by **handle**: the name in lower case, words joined by dots (`@finance.desk`,
`@priya.sharma`).

* **Who is told.** The people mentioned, and on a reply everyone already in the thread, get it
  under **Messages** in the sidebar. A badge counts what is unread.
* **Email.** The people mentioned are emailed when mail is set up. On a demo, the mail goes to the
  demo outbox, as for assignments.
* **Open field.** Messages lists each ping with the box, the place and the text. "Open field"
  switches to the tab, opens the step, scrolls to the box and opens its thread.
* **Fill in.** A reply that carries a value shows **Fill in**, which puts the value in the box as if
  typed. For a choice, it picks the option with that value or name.
* **Badges.** A box with messages shows their count on its icon. The icon turns yellow when one is
  unread for you.

**Team setup** (sidebar, under Team) lists the team. Each person has:

* their **role**: a team, and whether they are a super admin;
* a **title**, such as CFO;
* the **tabs they cover**;
* an **email**.

A super admin edits a row and saves it, or adds a person. Everyone else sees the table read-only.
"Who to ping for what" shows, tab by tab, who covers it. The send icons can show on every box (the
default) or only on hover; this is a setting of the browser.

On a demo, **View as** (in Messages and on Team setup) switches between the seats. Each demo seat
has a title and the tabs it covers.

| Part | Where |
| --- | --- |
| Tables: `team_messages`, `team_notices`; `team_members.title`, `tabs`; `team_outbox.message_id` | `web/db/migrations/011_team_messages.sql` |
| Server | `web/lib/teamMessages.js`; `GET/POST /api/team/messages` (`?thread=`, `?tab=`, inbox), `POST /api/team/messages/read` |
| Browser | `web/src/team/`: `FieldPings.jsx` (the icons and threads), `fields.js` (boxes read from the page, Fill in), `mentions.js` (handles, mentions, thread keys), `Inbox.jsx`, `TeamSetup.jsx`, `useTeamMode.js` |

**How a box is named.** Boxes are read from the page, so no tab is wired by hand.

* A box with a `data-testid` keeps it as its key, which is stable.
* Any other box gets its section heading and label, numbered when two boxes share them.
* Renaming a label or a section gives the box a new thread; the old messages stay in Messages.

**Tests:**

* `node tools/check_team_messages.mjs`: handles, mentions, suggestions and thread keys.
* `tests/e2e/test_team_mode.py` (demo mode). The manager pings `@finance.desk` from a What-if box.
  The Finance desk sees it unread, opens the field and replies with 320. The manager fills it in,
  and a title change is saved on Team setup.

## Evidence on every input

Every input box also carries a small **paperclip**, left of the send icon (E-01 and E-02 in
`docs/enterprise/FEATURES.md`). It is faint while the box has no evidence and solid, with a count,
when it has. Click it and the box's evidence opens:

* the box's label, where it is (tab › step › section) and its value now;
* the evidence attached to it: a **file** (download it from the name), a **link** or a **note**,
  each with who attached it, when, and the value the box held at the time;
* a form to attach more: a note, a link (`http://` or `https://`) or a file (PDF, PNG, JPEG, Word
  or Excel, up to 25 MB, the same checks as the assignments' uploads);
* for a super admin, **Sign off this value** and **Clear sign-off**;
* **Register (CSV)**: the tab's evidence register.

Anyone on the team attaches evidence and removes their own; a super admin removes any.

**Sign-off.** A super admin signs off a box's value: the sign-off keeps the value, who and when.
The paperclip gets a green tick while the box holds that value. When the value changes, the tick
turns amber and the popover says "signed off at an older value" and shows it; the super admin
signs off the new value or clears the sign-off. A sign-off needs no evidence, and evidence needs no
sign-off. A box has one sign-off at a time.

**The register.** `Register (CSV)` downloads one line per piece of evidence of the tab: tab, box,
place, the value at attach, kind, name / URL / note, by, when, and the sign-off (whether the box
was signed off at the value the item was attached at — `current`, `older value` or `no` — with
the signed value, who and when). The register does not see the boxes, only what was saved.
`GET /api/evidence/register` without `?tab=` gives every tab.

| Part | Where |
| --- | --- |
| Tables: `evidence` (one row per item, with `file_id` into `team_files`), `field_signoff` (one per box: `tab`, `field_key`, `value_at`, `signed_by`, `signed_at`) | `web/db/migrations/012_evidence.sql` |
| Server | `web/lib/evidence.js`; `GET /api/evidence?tab=` (items, sign-offs, counts by box), `POST /api/evidence` (JSON, or multipart with `file`), `DELETE /api/evidence/[id]`, `POST /api/evidence/signoff` (`{ tab, fieldKey, fieldLabel, valueAt, signed }`), `GET /api/evidence/register?tab=` (CSV) |
| Browser | `web/src/evidence/`: `EvidenceLayer.jsx` (the paperclips and the popover, mounted beside `FieldPings` in `main.jsx`), `useEvidence.js` (the tab's evidence, refreshed every 20 s), `register.js` (the register and its CSV, plain JavaScript), `evidence.css` |

Boxes are named as in team mode (`web/src/team/fields.js`): the `data-testid`, else the section
and label. The evidence of a box whose label or section is renamed stays in the register under the
old name. Access is as for messages: anyone on the tender team (`requireMember`); in demo mode,
the seat chosen with **View as**.

**Tests:**

* `node tools/check_evidence.mjs` (in `make check-web`): the register's grouping, names, sign-off
  states and CSV.
* `tests/e2e/test_evidence.py` (in `make e2e`, demo mode). The manager attaches a note and a link
  to the What-if "Contracted capacity (bid)" box, sees the count, signs off the value (green),
  changes the value (amber), removes the note, downloads the register and leaves the demo as it
  was.

## The team

| Team | Usually answers |
| --- | --- |
| Tender management (the super admin) | Manages the tender, assigns, accepts or returns answers, manages the team |
| Finance | Financing inputs; signed copies of the formats |
| Procurement | Costs of each item (solar, wind and battery capex and O&M) |
| Legal | Readings of tender conditions and clauses |
| Technical | Anything else technical |

**Demo deployments** (`DEMO_MODE=1`, no sign-in):

* The team starts with one seat per team, without email: the tender manager (super admin) and the
  finance, procurement, legal and technical desks.
* "View as" in the Team panel switches between the seats (a cookie), so each role can be shown on
  one screen.
* Add email addresses on the Team tab to have people notified.

**With sign-in**, each person acts as the team member linked to their account (or with their
email). An administrator who is not on the team yet is added as a super admin. Others are added by
a super admin on the Team tab.

## What can be assigned

Each data point has an **Assign** button beside it.

| Data point | Where | Default team | The answer |
| --- | --- | --- | --- |
| A particular (bidder, signatory, net worth, …) | Bid forms → Particulars | Tender management | A value |
| A blank of a format | Bid forms → a format, blanks view | Tender management | A value |
| A format to sign | Bid forms → a format, top | Finance | The signed copy (PDF or image) |
| A source's cost | Supply sources → Costs | Procurement | A figure in the field's unit |
| A financing input | Supply sources → Financing | Finance | A figure (percentages in %) |
| A tender condition | Bid conditions | Legal | A clarification, with an optional file |

## The flow

1. **Save the bid** to the library. Assignments belong to a saved bid, so the whole team works on
   the same one.
2. **Assign.** Click Assign beside a data point. Pick the team (the usual one is preselected), a
   person or anyone in the team, what is needed, and a due date. The data point then shows its
   status: assigned, answer to accept, returned or accepted.
3. **Answer.** The assignee opens the **Team** panel (a count shows what is waiting). Under *For
   you*:
   * for a value or a cost, the bid's current value is prefilled; change it and add a note;
   * for a format, download the filled letter (PDF or Word), print, sign and upload the signed copy;
   * for a condition, write the reading and attach the basis if needed.
4. **Accept or return.** The super admin sees *Answered: to accept*.
   * **Accept** writes the answer into the bid and saves it as a new version of the saved bid, with
     the note "Accepted from <person>: <data point>".
   * A cost or financing input clears the sizing, as typing it would; size again.
   * A signed copy shows on its format. A clarification shows under its condition ("Our reading").
   * **Return** sends it back with a note, and the assignee answers again.
5. Every step (created, answered, accepted, returned, reassigned, cancelled, comments, emails sent)
   is kept in the assignment's **History**.

## Email

People are emailed when work is assigned to them (or to their team), when an answer is waiting for
the super admin, and when their answer is accepted or returned. Email is off unless SMTP is set in
`.env`:

| Variable | |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD` | The mail server (Google Workspace, Amazon SES, Office 365 SMTP relay, …) |
| `SMTP_SECURE=1` | For port 465 |
| `MAIL_FROM` | The sender, for example `TenderOS <tenders@yourcompany.com>` |
| `APP_URL` | The address people open TenderOS at; each mail links to the bid and opens the Team panel |

Then rebuild or restart the web service.

* **The Outbox.** Every email is kept in the Team panel's **Outbox** tab (`team_outbox`,
  migration 009): to, subject, the full text, and whether it was sent. Each mail sent, and each
  failure with its reason, is also in the assignment's history.
* **Demo mode.** On a demo deployment without SMTP, the emails are written exactly as they would be
  sent and kept in the Outbox as "Demo outbox", not sent. The demo seats have fictional
  `@arkaja-renewables.example` addresses (`.example` is never delivered).
* **Neither.** On a signed-in deployment without SMTP, email is off and people see their work in the
  panel.

## Files

* Uploads are PDF, PNG, JPEG, Word or Excel files of up to 25 MB.
* The file's first bytes must match its type.
* They are stored on the server under `FILES_DIR`. On the VM this is the `team_files` Docker
  volume at `/data/files`.
* Each file is named by its id. The database (`team_files`) keeps its name, type, size and
  SHA-256.
* `deploy/backup.sh` archives them beside the database dump (`backups/tenderos-files-*.tar.gz`).
* Anyone on the team can download them.

## How it is built

| Part | Where |
| --- | --- |
| Tables: `team_members`, `assignments`, `assignment_events`, `team_files` | `web/db/migrations/008_team.sql` |
| Who is acting, members, assignments and their rules, emails | `web/lib/team.js`, `web/lib/mail.js` (nodemailer), `web/lib/files.js` |
| API | `GET /api/team`, `POST /api/team/members`, `PATCH /api/team/members/[id]`, `POST /api/team/act-as` (demo only), `GET/POST /api/team/assignments`, `POST /api/team/assignments/[id]` (submit, accept, return, cancel, comment, reassign; multipart with a file), `GET /api/team/files/[id]` |
| Browser | `web/src/team/` (`useTeam.js`, `AssignButton.jsx`, `TeamPanel.jsx`, `apply.js`: where each kind of data point lives in the bid and how an accepted answer is written) |

**Rules (server):**

* Only a super admin manages the team, accepts, returns, reassigns or cancels.
* Only the assignee, or anyone in the assigned team when no person is named, answers. A super
  admin can also answer.
* A data point has one live assignment at a time.
* A signed copy needs its file.
* A return needs a note.

**Tests:**

* `node tools/check_team.mjs` (in `make check-web`): applying answers of every kind.
* `tests/e2e/test_team.py` (in `make e2e`, demo mode): assign three data points to three teams,
  answer each from its seat, accept two, return one and accept it re-answered. The test checks the
  value, the signed copy and the reading in the bid, and the file downloaded byte for byte.

## Not yet

* Assignments (accept or return into a saved bid) are for the SECI RTC tender tab only. Pings work
  on every tab.
* There is one team for the whole server, not one per tender.
* Assignments are per saved bid; a bid that is not saved cannot be shared.
* There are no reminders before a due date.
* No e-signature: the signed copy is a scan of the paper the signatory signed.
