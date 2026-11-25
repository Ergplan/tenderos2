# Public demo site: tenderos.joulewise.tech

A static marketing page that shows the depth of TenderOS to a public audience: a guided
thirteen-screen tour of SECI CfD-I becoming a bid (a cursor drives it until the visitor takes the
mouse), an interactive design studio, the tender types with isometric plant drawings, the
optimiser, security and deployment, collaboration, SECI's auction results as open data, the open
SECI tenders, an FAQ, a downloadable deck, and files for search engines and language models.

    python3 site/scan.py                      # the market scan: SECI and NHPC, into data-src/market-scan.json
    node site/voice.mjs [--all]               # record the tour's narration (OpenAI text-to-speech)
    node site/build.mjs [--model] [--pages]   # site/public/ from the app's own code and data
    node site/render.mjs [--shots DIR]        # TenderOS-deck.pdf, og.jpg, and the page's tests
    bash site/daily.sh                        # scan + build, for the daily scheduled run

Needs Node 22, Python 3 with `pymupdf` and `pillow` (for `--pages`), and Playwright's Chromium
(for `render.mjs`).

## Where every number comes from

| On the page | Source |
| --- | --- |
| The CfD model: the optimiser's scan, the design surface (105 plants × 16 cost cases), a day in 15-minute blocks, a year hour by hour, the finance rows, the levers and tracks, the Pool, the bid review | `lib/model.mjs` runs `web/src/cfd/*`; cached in `data-src/model-cache.json` (`--model` recomputes, about 100 s) |
| The tender set, amendment quotes and word diffs, conditions | `web/src/cfd/pack.js`, `terms.js`; `lib/diff.mjs` |
| The tender's pages with each quote highlighted | `pages.py` renders the PDFs in `web/public/tenders/seci-cfd-i/` and locates every quote; cached in `public/pages/` and `data-src/pages.json` (`--pages` re-renders; the run fails if a quote is not found on its page) |
| FDRE-RTC bridge, BESS example | `web/src/seci/winningBid.js`, `web/src/bess/engine.js` |
| SECI auction results | `web/src/market/seed.js` |
| Tenders on the market, the change feed, the hero drawing | `scan.py` reads SECI's tender list, details pages and result notices through the application's parser (`engine/market/seci_tenders.py`) and NHPC's tender list and details pages; it opens no document and compares with the previous run kept in `data-src/market-scan.json` (new tender, amendment or corrigendum, deadline moved, closed, result notice). `iso.js forTender` draws each open developer tender |
| The voice-over | `src/narration.json` (text, voice, delivery), recorded by `voice.mjs` into `public/audio/` (48 kbit/s MP3, named by a hash of the text so only changed clips are recorded); needs an OpenAI key at recording time only. The page marks it as an AI voice and shows the same words as captions |
| Security, optimiser, collaboration and timing statements | the product's documentation (`docs/enterprise/`, `docs/dev/`, `docs/TEAM.md`, `deploy/enterprise/README.md`); items not yet built are marked roadmap on the page |

The "by hand" column of the time table is indicative, not measured; the page says so.

## Files

- `build.mjs` assembles `public/index.html`, `public/deck/`, `public/data/*`, `llms.txt`,
  `llms-full.txt`, `robots.txt`, `sitemap.xml`, `vercel.json`.
- `src/app.js` the tour (cursor engine, one `rest`/`script` pair per screen), the studio, the
  what-if planner, the charts; `src/iso.js` the isometric drawings (shared with the build);
  `src/styles.css`, `src/iso.css`, `src/deck.css`.
- Colours are jouleWise's (www.joulewise.tech); night or day by the system or the header toggle.
- `public/` is committed and is what Vercel serves (project `tenderos-site`, root directory
  `site/public`, no build step).

`render.mjs` fails on any console error and checks each screen: the page images load with their
highlights, the studio's sliders move the price, the array and the conditions, Optimise returns to
the model's optimum, turning a lever down replans, the cursor tour runs and stops when the visitor
clicks, day mode, and no sideways scroll on a phone.

## The daily run

A scheduled Claude Code task runs `bash site/daily.sh` each morning, commits
`site/data-src/market-scan.json` and `site/public`, and pushes; Vercel redeploys. The landing
page's first drawing rotates through the developer tenders open that day (new and amended ones
first), and the "Open at SECI and NHPC" section lists them with what changed. Nothing else is
regenerated daily: the model cache, the page images, the narration and the deck PDF stay as
committed.

The landing page shows no bid price outside the tour: the tour is a worked example on
illustrative inputs and says so. The phone number is `PHONE` / `TEL` in `build.mjs`.

## Requests for a demo

The page has no server: the "Book a TenderOS demo" form (`#demo`) opens the visitor's own mail
with the answers addressed to the sales address (`CONTACT_EMAIL` in `build.mjs`). Replace it with a
form service or CRM endpoint when one is chosen. The tour has two routes (90-second overview of
five screens, full tour of thirteen); it is held, voice included, while more than half of its window
is out of view, and scrolling alone never stops it.

## Visit analytics and personal links

`src/track.js` (served as `/assets/track.js`, loaded before `app.js`) does two things.

**Counting.** It loads Vercel Web Analytics (`/_vercel/insights/script.js`, no cookies; Web
Analytics must be enabled on the Vercel project) and sends named events through
`window.TOSTrack(name, data, once)`:

| Event | Detail |
|---|---|
| Tour started, Tour finished, Voice-over heard | `route`: full tour or 90-second overview |
| Tour screen, Took the controls | `screen`: upload, read, amend … pack |
| Section read | `section`: the section's id, once it has held the middle of the screen for a second |
| Time on page | `reached`: 30 seconds, 2, 5, 10, 20 minutes, counted while the tab is in front |
| Deck downloaded, Call tapped, Email tapped, Book a demo clicked, Watch the tour clicked | `where`: header, footer, floating button or the section |
| Demo form | `step`: started, sent to mail (never what was typed) |
| Tender type opened, Design studio, Scenario saved, Data file opened, Outbound link | one detail each |

Only the visitor's own clicks count (`isTrusted`): the tour's cursor presses buttons too. Each
event carries one detail at most, plus `ref` on a personal visit, so no event has more than two
properties. Nothing is sent from `localhost`, where the tests read `window.TOSTrack.log`.

**Personal links.** `https://tenderos.joulewise.tech/for/<label>` is the home page
(`vercel.json` rewrites it; `/?ref=<label>` is turned into the same path). The label is kept in
the browser's `localStorage` (`tos-ref`) for 90 days and attached to every event as `ref`; the
first event of such a visit is `Personal link` with `visit`: opened the link, opened the link
again, or came back without the link. `/links` (not linked from the site, not indexed) makes
the links for the sales team. In Vercel Analytics a personal visit shows under Pages as
`/for/<label>`, and any event can be broken down by `ref`.

`/privacy` says what is counted and lets a visitor forget their label or turn counting off in
their browser (`tos-notrack`), after which neither the script nor any event is loaded or sent.

## The chat box

The floating button opens a chat box (`src/chat.js`, markup and answers in `build.mjs`). A
visitor asks a question or leaves a note; short questions get an automatic answer taken from the
page's FAQ by the words in them (no language model), marked "Automatic reply". After the first
message the box asks for a name and a phone number or email.

Everything the visitor writes is saved by the site's one server function, `POST /api/chat`
(`src/api/chat.js`, copied to `public/api/chat.js`; `public/package.json` gives it
`@vercel/blob`). Each conversation is one text file in the private Vercel Blob store
`tenderos-site-chat`, `chat/<date in India>/<personal label or visitor>-<id>.txt`, rewritten on
every message: the time, the label, the contact details, the page, the country and the messages.
Read them in Vercel under Storage, in that store's browser. Each save also sends the sales
team an email through Resend when the Vercel project has `RESEND_API_KEY` (to `CHAT_ALERT_TO`,
default the site's sales address; from `CHAT_ALERT_FROM`): the latest message, then the whole
conversation, one thread per conversation, with the visitor's email as the reply-to. A mail
that fails does not fail the save. The function takes requests from the
site's own pages only, limits a conversation to 30 messages of 1,500 characters and drops
anything that fills the hidden spam field. Analytics records that the chat was opened and used,
never what was written.

## The LinkedIn animation

`social/linkedin.html` is a 44-second, 1080 × 1350 animation (opened in a browser, it plays), cut
in whole bars at 120 beats a minute. Its five steps (read, track, size, price, prove) show the
real dashboard: `node site/social/capture.mjs` plays the tour on each screen with the page's
clock under its control and photographs it 50 times a second of the tour's own time into
`social/footage/` (not committed, a few hundred megabytes; `--survey DIR` saves a still every
half second to choose cuts from). `SHOTS` in the page says, for each clip, which part of the
screen is shown wide and which zoomed in on, and the cut as segments played fast or slow.

`node site/social/music-eleven.mjs` has ElevenLabs compose the soundtrack to the picture's
structure (the lead-in, the drop over the five steps, the close) and make three sound effects:
a whoosh where the footage turns fast, a hit where it turns slow, and the hit the name arrives
on. The model gives a drop an eight-bar lead-in whatever it is asked, so it is asked for one
eight seconds longer than the picture's and the front is cut off. `measure.py` finds each
take's drop; the takes are `social/music/eleven-<n>.mp3`, the chosen one `eleven.mp3`. It needs
`ELEVENLABS_API_KEY` (or the session's network proxy holding the key).

`node site/social/render.mjs` steps through the page frame by frame, slides the track so its
drop is the picture's, lays the effects on the speed changes and writes
`public/social/tenderos-linkedin.mp4`, the cover `tenderos-linkedin.jpg` and the sound alone as
`tenderos-linkedin-music.mp3`. `--take N` uses another ElevenLabs take, `--music FILE` another
track, `--synth` the track `music.py` synthesises from the cue points. The figures in the video
are read from `public/data/demo.json`.

## The tour on a phone, and the time chart's labels

Under 860 px of width `app.js` puts the demo window in phone mode (`.sim.phone`): the window is
one screen tall under the header, the intro paragraph of each screen gives way to the caption,
and each screen is split into panes (the columns it has on a desktop: `PANES` in `app.js`) shown
one at a time under a row of tabs. A pane taller than its box is drawn smaller, down to 62% of
its size, and scrolls inside itself only below that. The tour's cursor opens the pane of whatever
it is about to touch (`reveal`), a press whose answer appears elsewhere opens that pane
(`FOLLOW`), and the panes the cursor did not open are shown in turn before the tour moves on.
The page settles with the window filling the screen (scroll snap, proximity) and the chat button
steps aside while the demo is in view. The desktop layout is untouched: there the pane wrappers
are `display: contents`.

Every row of the time chart carries two labels, "Before" with the time by hand and "With
TenderOS" with the time in the product; once the chart is in view they light in turn while the
bar between them closes up (off under reduced motion).

## The narration in Hindi

`src/narration.json` holds the tour's narration in English and, under `hi`, in Hindi (`say`
respells a name for the voice only: SECI is said "seki"). `node site/voice.mjs` records both with
the same OpenAI voice; the Hindi clips are `public/audio/<screen>-hi-<hash>.mp3`. The demo's
language button (`#sim-lang`) switches the voice and the captions, and the choice is kept in the
browser (`tos-lang`).

## Search engines

What a search result shows is set in `build.mjs`, apart from the page's own headline: `SEO_TITLE`
(the product's category first, then the name) and `SEO_DESC` (about 160 characters). The page also
carries a canonical link, `robots` meta, and structured data (WebSite, SoftwareApplication,
Organization, Dataset, FAQPage); `robots.txt` and `sitemap.xml` are written by the build.

To prove ownership to Google Search Console with its "HTML tag" method, put the code in
`data-src/seo.json` as `{ "googleSiteVerification": "<code>" }` and rebuild: the build adds the
`google-site-verification` meta tag. (A Domain property verified by a DNS TXT record on
joulewise.tech needs nothing here and covers this subdomain.) The DNS method for this subdomain
alone is a TXT record on the host `tenderos`; that host then needs its own address record too (an
ALIAS to the wildcard's target), because a record on the name stops the `*` wildcard covering it.
Both are in the domain's DNS on Vercel since 25.11.2026. Then submit
`https://tenderos.joulewise.tech/sitemap.xml` there and ask for the home page to be indexed.
