# Public demo site: tenderos.joulewise.tech

A static marketing page that shows the depth of TenderOS to a public audience: a guided
thirteen-screen tour of SECI CfD-I becoming a bid (a cursor drives it until the visitor takes the
mouse), an interactive design studio, the tender types with isometric plant drawings, the
optimiser, security and deployment, collaboration, SECI's auction results as open data, the open
SECI tenders, an FAQ, a downloadable deck, and files for search engines and language models.

    node site/build.mjs [--model] [--pages]   # site/public/ from the app's own code and data
    node site/render.mjs [--shots DIR]        # TenderOS-deck.pdf, og.jpg, and the page's tests

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
| Open SECI tenders | `data-src/seci-open.json`, a snapshot from `engine/market/seci_tenders.py` (rules summaries, no document opened); refresh it and rebuild |
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
