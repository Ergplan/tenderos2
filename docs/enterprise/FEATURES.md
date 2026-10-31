# TenderOS Enterprise: features list

One row per feature. Live: in Demo 2 today. Extend: exists, changes for the enterprise version. Build: new. Zone: DMZ (tender intake, cloud LLMs, no bid data), Core (the client's militarised zone, no cloud LLM), Both. The same list is `FEATURES.xlsx` (with counts); both come from `tools/build_enterprise_features.py`.

## Tender intake

| ID | Feature | What it does | Team | Zone | Status | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TI-01 | Upload a tender | Any power tender (PDF, Word, text, to 60 MB); the type is detected or chosen | Legal | DMZ | Live | P1 | Tender to Bid start screen |
| TI-02 | Upload a tender set | RfS with amendments, clarifications and PPA/PSA (to 20 files): amendments applied to the RfS | Legal | DMZ | Live | P1 | engine/extraction/tenderset |
| TI-03 | LLM reading of the tender | Every value with page and quote; sections mapped; scan screen with five agents | Legal | DMZ | Live | P1 | Claude (claude-fable-5-1) through engine/extraction; rule-based reader without a key |
| TI-04 | Table reading (Docling) | Amendment and clarification tables through docling-serve; PyMuPDF fallback | Legal | DMZ | Live | P1 |  |
| TI-05 | Scanned pages (LlamaParse) | Pages without a text layer read through LlamaParse | Legal | DMZ | Live | P2 | Optional key |
| TI-06 | Amendments: changes was → now | Each clause before and after, with quotes, word diff and effect | Legal | DMZ | Live | P1 |  |
| TI-07 | Clarifications with verdicts | SECI's answers linked to the clauses, accepted / refused | Legal | DMZ | Live | P1 |  |
| TI-08 | Consolidated reading | RfS fields with amendments applied and their history | Legal | DMZ | Live | P1 |  |
| TI-09 | Bid formats and bid process | Formats with blanks and context; the bid steps from registration to PPA | Legal | DMZ | Live | P1 |  |
| TI-10 | Search over the tender | BM25 search over every page of the set | All | DMZ | Live | P2 | Haystack |
| TI-11 | Curated tender packs | A reviewed pack per tender (SECI FDRE-RTC-V): conditions, changes, clarifications, formats, every quote checked on its page | Legal | DMZ | Live | P1 | web/src/seci/seci-rtc-tm-v.json; tests/test_seci_pack.py |
| TI-12 | Pre-bid queries | Points to raise with the issuer, each quoting the clause and page; Word file | Legal | DMZ | Live | P2 |  |
| TI-13 | Tender questions by voice / chat | Ask the extracted tender questions; answers cite document and page | All | DMZ | Extend | P2 | GPT-Live bid agent today also drives the bid; in the DMZ it answers tender questions only |
| TI-14 | CERC orders | Tariff-adoption orders uploaded and read into facts with page and quote; SECI results as reported | Finance | DMZ | Live | P3 | Recent tenders tab |
| TI-15 | Claude connector (MCP) | TenderOS tools in Claude: tender lookup with citations, sizing, financials, What-if | All | DMZ | Extend | P3 | Demo only; in the enterprise version limited to the tender (no bid data) or off |
| TI-16 | Review before transfer | A reviewer confirms the reading (every value located on its page) before it is packaged for the core | Legal | DMZ | Build | P1 | Today: the reviewer ticks unlocated values in the workflow |
| TI-17 | Transfer package to the core | The reading, the pack and the documents exported as one signed, checksummed bundle; imported inside the core | IT | Both | Build | P1 | One-way: documents in, nothing out |

## Bid workspace

| ID | Feature | What it does | Team | Zone | Status | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BW-01 | Step-wise bid navigation | One tender, one bid, steps in order with sign-off per step: Tender → Bid inputs → Design → Finance inputs → Sizing → Results → Financial model → What-if → Bid forms → Submission | All | Core | Live | P1 | SECI RTC tab: Tender → Conditions → Bid inputs (Projects) → Design → Finance inputs → Size → Financial model → What-if → Bid forms → Winning bid, each step labelled with its team; sign-off is per box (Evidence) |
| BW-02 | Team-wise input tabs | Projects (bid inputs and assumptions), Design and Finance each get their own input tab; each box shows who owns it and whether it is filled, evidenced and signed off | All | Core | Live | P1 | Bid inputs (Projects), Design, Finance inputs as steps of their own; the paperclip on every box shows evidence and sign-off |
| BW-03 | Bid inputs and assumptions (Projects) | Contracted MW, dates, supply profile and planning choices (Peak Hours, shortfall), market sale, assumptions register | Projects | Core | Live | P1 | The Bid inputs step; the assumptions register is the evidence register |
| BW-04 | Benchmarks | Industry benchmarks (CERC norms, market prices) fill empty inputs, marked as benchmarks until changed | All | Core | Live | P1 |  |
| BW-05 | Tender conditions checklist | Every condition against the bid: met, failed, pending; with page and quote | Legal | Core | Live | P1 |  |
| BW-06 | Saved bids with versions | A bid saved to the library with versions; opened later; compared | Management | Core | Live | P1 | Scenario library |
| BW-07 | Sign-off per step and submission lock | Each team signs off its step; the manager freezes the bid for submission; later edits make a new version | Management | Core | Build | P2 |  |
| BW-08 | Bid forms and letters | Every RfS format filled from the bid, reviewed beside its page; letters in the RfS wording, editable; Word and PDF; the bid pack | Legal | Core | Live | P1 | SECI formats today; other tenders through their packs |
| BW-09 | Winning bid analysis | The auction result and a bridge from the benchmark tariff to it, lever by lever | Management | Core | Live | P3 |  |

## Design

| ID | Feature | What it does | Team | Zone | Status | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-01 | Supply sources | Solar, wind, battery, biomass, hydro, thermal with costs, limits and fixed sizes | Design | Core | Live | P1 |  |
| D-02 | Solar plant studio | Layout from modules, mounting, string or central inverters; cost in ₹/Wp; writes the cost into the bid | Design | Core | Live | P2 |  |
| D-03 | Wind farm studio | Turbines by make, CUF at the site's wind, farm cost; writes the cost into the bid | Design | Core | Live | P2 |  |
| D-04 | Profiles: upload and view | Hourly solar and wind profiles uploaded; CUF, month × hour heat map, monthly CUF, a week | Design | Core | Live | P1 |  |
| D-05 | CUF file download | Download the profile used in the bid (as uploaded, and as scaled to the CUF entered) with its statistics | Design | Core | Live | P1 | CSV built in the browser; tools/check_cuf_file.mjs |
| D-06 | 25-year CUF justification | Why one year's profile stands for 25: the source and period of the data, P50/P90, degradation per year, inter-annual variability, the typical year method; a note in the bid pack | Design | Core | Live | P1 | Panel on the profile with P50/P90 inputs; Word file from POST /api/plant/justification |
| D-07 | Losses to the billing meter | Each technology's stages to the 33 kV bus with where its CUF is measured; the 33/220 kV transformer and the line | Design | Core | Live | P1 |  |
| D-08 | Separate sites | Solar and wind on different sites, each with its own battery; no energy between them | Design | Core | Live | P1 |  |
| D-09 | Co-located solar + BESS and wind + BESS | Which site each battery sits on and charges from; one or two pooling stations | Design | Core | Live | P1 | One site (shared pooling station) or separate sites, each with its own battery and pooling station; the losses of each reach the sizing |
| D-10 | Site schematic (single-line) | A drawing of the chosen layout: solar, wind and battery blocks, their transformers, the pooling station(s), the line to the billing meter; losses shown at each stage and summed at the pooling station | Design | Core | Live | P1 | bid/SiteSchematic.jsx: one or two pooling stations with their transformer and line losses; inputs beside the drawing |
| D-11 | Deviation settlement (DSM) per CERC | Forecast error on solar and wind by block, the DSM charges under the CERC DSM Regulations (bands by % deviation, the RE schedule revision allowance), a forecasting accuracy input, the cost in the model | Design | Core | Live | P1 | src/dsm: forecast-error distribution, tolerance band by year, X factor trajectory, steps beyond the band; norms editable; verify against the notified text |
| D-12 | Degradation and augmentation | Solar, wind and battery degradation; battery augmentation annual or one-time with price decline | Design | Core | Live | P1 |  |

## Sizing

| ID | Feature | What it does | Team | Zone | Status | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-01 | Sizing engine | The least-tariff plant that meets every tender condition over the PPA term; a seed from the last sizing | Design | Core | Live | P1 | Proprietary; described by its interface only |
| S-02 | Tender supply rules | Annual, monthly and time-block floors (every 15-minute block), peak hours as planned (costliest IEX hours, any of the window, evening), shortfall at a penalty or hard | Projects | Core | Live | P1 |  |
| S-03 | Market sale of surplus | Sales on IEX (hourly DAM/G-DAM prices) or at a flat price; PPA first; buyer's first right at a share of the tariff | Projects | Core | Live | P1 |  |
| S-04 | 15-minute dispatch, every PPA year | Block-wise dispatch with ramp and minimum, every floor checked, CSV/ZIP and Excel | Design | Core | Live | P1 |  |
| S-05 | Dispatch sheets in Excel | Every modelled year hour by hour as formulas; the yearly energy of the model comes from them | Finance | Core | Live | P1 |  |
| S-06 | Compliance table and hourly charts | Floors met per year, the week's dispatch, the per-hour Sankey of where energy went | All | Core | Live | P1 |  |

## Finance

| ID | Feature | What it does | Team | Zone | Status | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | Financing inputs (Finance tab) | Target equity IRR, debt share, rate, tenor, repayment, tax, depreciation, O&M escalation, insurance, receivables, discount rate | Finance | Core | Live | P1 | The Finance inputs step of the SECI flow (and the Financials step of every tab) |
| F-02 | 25-year financial model | Revenue, penalties, O&M, insurance, augmentation, depreciation (WDV/SLM), tax with loss carry-forward, debt, DSCR, IRRs, LCOE, payback | Finance | Core | Live | P1 |  |
| F-03 | Tariff for the target IRR | The tariff that gives the target equity IRR; a quoted tariff's equity and project IRR with a warning below target | Finance | Core | Live | P1 |  |
| F-04 | Traceable model | Every number's formula, precedents, dependents and the inputs it rests on, in the app | Finance | Core | Live | P1 |  |
| F-05 | Excel model with live formulas | The whole model as Excel formulas (Live model sheet), recalculated by LibreOffice in tests to the app's numbers | Finance | Core | Live | P1 |  |
| F-06 | Construction phase, monthly | Monthly model from financial closure to commissioning: drawdown schedule, equity first or pro rata, capex phasing by package, commissioning in parts | Finance | Core | Live | P1 | Months, drawdown profile (even, S-curve, front, back), equity first or pro rata; Construction sheet in Excel. Phasing by package and commissioning in parts: not built |
| F-07 | Interest during construction (IDC) | IDC computed month by month from the drawdowns and the rate, capitalised into the project cost (today a % of hard cost) | Finance | Core | Live | P1 | Month by month on the debt drawn, capitalised as debt; 0 months keeps the pre-operative % as before |
| F-08 | Operations phase, yearly | The yearly model starts at commissioning (COD) with the construction balances carried in | Finance | Core | Live | P1 | Year 1 starts at COD with the debt (incl. IDC) and equity from the construction schedule |
| F-09 | Working capital | Receivables (days), O&M stock, maintenance spares, DSM and penalty reserve; working capital loan with its own rate and margin; letter of credit cost | Finance | Core | Live | P1 | Receivable days, O&M in hand (months), spares (% of O&M), interest on the working capital, DSRA. DSM/penalty reserve and letter-of-credit cost: not built |
| F-10 | Repayment methods | Equal principal, annuity, sculpted to a target DSCR, balloon / bullet, step-up; grace period / moratorium; quarterly or yearly instalments | Finance | Core | Live | P1 | Equal, annuity, sculpted, balloon, bullet, step-up; moratorium; yearly, half-yearly, quarterly or monthly instalments; all as Excel formulas |
| F-11 | Debt sculpting | Principal shaped to hold a target DSCR each year given CFADS; minimum and average DSCR reported | Finance | Core | Live | P1 | Principal = CFADS ÷ target DSCR − interest each year; the last year clears the balance |
| F-12 | Refinancing | Refinance in a chosen year at a new rate and tenor, with fees and prepayment cost; before/after returns | Finance | Core | Live | P1 | Year, new rate, new tenor, fee on the balance; the schedule continues under the same method. Prepayment cost: use the fee |
| F-13 | DSCR and lender's view | Minimum and average DSCR, lender's IRR, DSRA, covenants flagged | Finance | Core | Live | P1 | Min/avg DSCR, DSRA, lender's IRR (What-if); DSCR below 1.1 flagged red. Covenant list: not built |
| F-14 | Deviation settlement cost in the model | The DSM charges from the Design tab as an operating cost line | Finance | Core | Live | P1 | DSM charges as an operating-cost line, a line in the year's tariff; in the Excel model as formulas |
| F-15 | Money at stake | EMD, PBG and net worth on the installed capacity | Finance | Core | Live | P1 | Per tender pack |

## What-if

| ID | Feature | What it does | Team | Zone | Status | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| W-01 | What-if after sizing | Opens on the sized plant: the optimum as the base case, every input as a lever | All | Core | Live | P1 | The What-if step of the SECI flow starts from the sized plant and every input of the bid |
| W-02 | Tariff levers on bid day | Set a tariff and see which levers reach it: cost, CUF, financing, IRR, storage, sale; each lever's effect on the tariff and the IRR; instant | Management | Core | Live | P1 | whatif/levers.js: each lever's tariff a step up and down, ₹/kWh per step, the move of that lever alone to reach the tariff wanted; Apply |
| W-03 | Sensitivity table | One-way and two-way sensitivities (tariff vs capex, CUF, rate) with the base case marked | Finance | Core | Live | P2 | The Sensitivity sheet of the Excel model: one-way tables and two-way grids (capex, CUF, interest rate) from full runs of the model |
| W-04 | Scenario compare | Saved what-if cases side by side with the base | All | Core | Extend | P2 | Scenario compare exists for saved bids |

## Evidence

| ID | Feature | What it does | Team | Zone | Status | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E-01 | Evidence upload per input | Any input (CUF, costs, financing, conditions) carries files or links as evidence: quotes, reports, data sheets; who uploaded it and when | All | Core | Live | P1 | Paperclip on every box: files, links, notes with who and when; migration 012 |
| E-02 | Feedback and change requests | Give feedback: click any section of any page and write what should change; the Change requests tab lists every request (when, where, comment, by which team) with approve / reject; the approved ones export as one Markdown prompt for jouleWise to apply with Claude Code under the AMC | All | Core | Live | P1 | web/src/feedback; tests/e2e/test_feedback.py |
| E-03 | Evidence status on every box | Each box shows filled / evidenced / signed off; the bid pack lists the evidence register | All | Core | Live | P1 | Faint / with count / signed off at this value / signed at an older value; the register as CSV |
| E-04 | Assignments | A data point assigned to a team or person; answer with a value, note or file; accept or return into the bid as a new version | All | Core | Live | P1 |  |
| E-05 | Pings from any box (@mentions) | A thread on every input box; mention a teammate; reply with a value; Fill in | All | Core | Live | P1 |  |
| E-06 | Team setup | People, teams, super admin, titles, the tabs they cover | Management | Core | Live | P1 |  |
| E-07 | Activity and audit log | Every sizing, export and change logged with user and time; exportable | IT | Core | Extend | P2 | Activity log today; export to build |
| E-08 | Email notifications | Assignments and pings by email through the client's SMTP | All | Core | Live | P2 |  |

## Platform

| ID | Feature | What it does | Team | Zone | Status | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P-01 | Users, sign-in and tab access | Accounts, administrator, tabs granted per user | IT | Both | Live | P1 |  |
| P-02 | Enterprise sign-in (SSO) | The client's directory (SAML/OIDC or LDAP) for sign-in | IT | Core | Build | P2 |  |
| P-03 | Air-gapped installation | Everything as an offline bundle: images, database, no outbound traffic from the core; verified checksums | IT | Core | Live | P1 | deploy/enterprise: images.tar, compose overlay with internal networks, install.sh; not run against a Docker daemon in this session |
| P-04 | Patches under AMC | Signed offline patch bundles from jouleWise, applied by the client's IT with one command, with health check and rollback; a changelog per patch | IT | Core | Live | P1 | tenderos-patch verify/apply/rollback/status on signed bundles (manifest + ECDSA signature); apply/rollback not exercised against a Docker daemon here |
| P-05 | Backups and restore | Database and files backed up on a schedule; restore tested | IT | Core | Live | P1 | deploy/backup.sh today |
| P-06 | HTTPS and firewall | TLS at the edge; allowlists | IT | Both | Live | P1 |  |
| P-07 | Day and night mode | Both modes, remembered per browser | All | Both | Live | P3 |  |
| P-08 | Demo mode | No sign-in; View as to switch seats | IT | DMZ | Live | P3 | Not in the core |

## Counts

| Status | Features |
| --- | --- |
| Live | 71 |
| Extend | 4 |
| Build | 4 |
| Total | 79 |
