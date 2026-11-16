# Public demo site: tenderos.joulewise.tech

A static page that explains TenderOS to a public audience: an eleven-step simulation of a tender
becoming a bid (SECI CfD-I), every module, SECI's recent auction results as open data, the open
SECI tenders, an FAQ, a downloadable deck, and files for search engines and language models.

    node site/build.mjs                 # site/public/ from the app's own code and data
    node site/render.mjs [--shots DIR]  # TenderOS-deck.pdf, og.jpg; checks the page for errors

Every number comes from the application, run at build time: `web/src/market/seed.js` (SECI
results), `web/src/cfd/pack.js` and `terms.js` (the tender set, amendment quotes, conditions),
`web/src/cfd/model.js`, `finance.js`, `winning.js`, `review.js` (the sizing scan, a day's dispatch,
the Pool, the bid review). The open tenders are a snapshot in `data-src/seci-open.json` from
`engine/market/seci_tenders.py` (rules summaries, no document opened); refresh it and rebuild.

Colours are jouleWise's (www.joulewise.tech): night by default where the system is dark, day mode by the system or the toggle in the header (kept in localStorage `tos-theme`).

`site/public/` is committed and is what Vercel serves (project root directory `site/public`,
no build step). SEO: canonical, Open Graph, JSON-LD (SoftwareApplication, Organization, Dataset,
FAQPage), sitemap. LLM: `llms.txt`, `llms-full.txt`, data as JSON and CSV, AI crawlers allowed in
`robots.txt`. Contact links go to jouleWise's published contact page and sales address.
