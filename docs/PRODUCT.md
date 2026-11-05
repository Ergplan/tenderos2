# TenderOS

**From tender document to winning bid, with every number traceable.**

TenderOS is the bid workspace for renewable power tenders in India: round-the-clock and firm RE
tenders (SECI, NHPC, NTPC, state discoms), standalone battery tenders and contracts for
difference. It reads the tender and its amendments, lets the Projects, Design and Finance teams
enter their inputs step by step with evidence, sizes the plant against every condition the tender
sets, prices the bid for the equity return the board wants, and produces the bid pack: the
financial model as a live Excel workbook, the tender's own formats and letters, and the
sensitivities the bid committee asks for on bid day.

It is built by jouleWise and runs on the client's own infrastructure.

---

## Who it is for

| Team | What TenderOS gives them |
| --- | --- |
| **Tender / Legal** | The tender and its amendments read and reconciled, every condition with its page and quote, the formats and letters filled in the RfS's own wording, a pre-bid query list |
| **Projects** | The bid inputs in one place: capacity, dates, supply profile, planning choices, market sale; the sized plant and its compliance block by block |
| **Design** | Sources, plant studios (solar modules and inverters, wind turbines by make), hourly profiles with CUF files, the loss chain to the billing meter, one or two pooling stations, deviation settlement per CERC norms |
| **Finance** | Financing terms, construction and IDC, repayment methods, refinancing, working capital, DSRA; the 25-year model; the Excel twin with debt, depreciation, P&L, cash flow, balance sheet and sensitivity sheets |
| **Management** | The tariff for the target IRR, the levers that move it on bid day, the winning-bid analysis, sign-off per input, the audit trail, the feedback loop to jouleWise |
| **IT** | A Docker installation on any cloud or on-premises, two-zone enterprise deployment, signed patches, backups, users and roles |

---

## The journey of a bid

**1. Tender in.** Upload the RfS with its amendments, clarifications and PPA/PSA (up to 20 files).
TenderOS reads them (layout-aware parsing; cloud models in the intake zone), applies the
amendments to the RfS, lists every change (was / now, with quotes), the clarifications and the
verdicts, the formats to submit and the bid process. Every value carries its document and page; a
reviewer confirms the reading before it reaches the bid.

**2. Conditions.** Every condition the tender sets — supply floors by time block, storage,
penalties, EMD, PBG, timelines — as a checklist against the bid, met / failed / pending.

**3. Inputs by team.** Separate steps for **Bid inputs** (Projects), **Design** and **Finance
inputs**, each labelled with its team. Industry benchmarks (CERC norms, current market prices)
fill the empty boxes and are marked until replaced. Every input box carries a paperclip for
**evidence** — quotes, reports, data sheets, links, notes — and a sign-off by the super admin that
turns amber if the value later changes. Team mode lets anyone ping a colleague from any box
(@mentions, threads, "fill in" the answer).

**4. Sizing.** The optimiser sizes solar, wind and storage (and biomass, hydro or thermal where
the tender allows) against every block floor, storage mandate and sale rule of the tender,
minimising the tariff for the target equity IRR. It dispatches every PPA year hour by hour
(15-minute blocks for the compliance workbook), with degradation, battery fade and augmentation,
separate sites with their own batteries and pooling stations, and sale of the surplus in the
market or to the buyer where the tender provides for it.

**5. Financial model.** A 25-year model from the construction months onward: the cost spent month
by month with interest during construction capitalised as debt; equal, annuity, sculpted,
balloon, bullet or step-up repayment with a moratorium and instalments; refinancing; working
capital per CERC norms with interest; a debt service reserve; WDV or straight-line tax
depreciation with losses carried; deviation settlement charges per the CERC DSM regulations.
Results: the tariff for the target IRR, equity and project IRR, DSCR, LLCR, lender's IRR, payback,
LCOE. **Every number on screen opens its formula and the inputs it rests on.**

**6. Excel twin.** One click downloads the whole model as a live Excel workbook — the Live model
(every number a formula on the blue inputs), Construction, Profit and loss, Cash flow, Balance
sheet (balances to zero every year), Debt schedule, Depreciation and tax, Working capital,
Sensitivity (tariff vs capex, CUF and interest rate), and the hour-by-hour dispatch sheets for the
modelled years. Change a blue cell and the whole book moves; Goal Seek the tariff. The workbook is
recalculated by LibreOffice in the product's own tests against the application's numbers.

**7. What-if on bid day.** The What-if step starts from the sized plant and every input of the
bid. Set the tariff you want to quote and the **levers table** tells you, input by input, the
tariff one step up and down, ₹/kWh per step, and how far each lever alone would have to move to
reach your number.

**8. Bid pack.** Every format of the RfS filled from the bid and reviewed beside its page; letters
in the RfS's own wording, editable; Word and PDF; the signed copies accepted from the team; the
evidence register. A **winning-bid analysis** bridges the benchmark tariff to the auction result,
lever by lever.

---

## What makes it different

* **Traceable, not a black box.** Every figure traces to its formula and inputs in the
  application and in the Excel workbook, which is verified against the application in tests.
* **The tender's rules, not a generic model.** Time-block floors, Solar Hours bands, buyer's first
  right on the excess, penalties at multiples of the tariff, storage mandates — the optimiser and
  the model carry the tender's conditions as they are written, amendments applied.
* **Built for the team, not one analyst.** Steps by team, evidence and sign-off on every input,
  pings and hand-offs, saved bids with versions, an activity log.
* **Secrets stay inside.** The enterprise edition splits the product into an intake zone (the
  tender documents and the cloud models) and a core zone on the client's network where the bid,
  the costs and the model live with no cloud client at all.
* **The client steers the roadmap.** Feedback on any button, box, cell or section becomes a change
  request; approved requests export as one prompt file that jouleWise applies with Claude Code and
  ships back as a signed patch under the AMC.

---

## Features at a glance

**Tender intake** · upload a tender or a tender set · amendments applied, changes with quotes ·
clarifications and verdicts · formats and bid process extracted · search across the set · CERC
order reading · voice and chat questions on the tender (intake zone) · Claude connector (MCP).

**Bid workspace** · steps by team with sign-off · benchmarks · conditions checklist · saved bids
with versions · bid forms and letters (Word, PDF) · winning-bid analysis · pre-bid queries.

**Design** · solar, wind, battery, biomass, hydro, thermal · solar plant studio (modules,
mounting, inverters, ₹/Wp) · wind farm studio (turbines by make, site CUF) · hourly profiles
uploaded, viewed and downloaded · 25-year CUF justification (P50/P90, degradation) · losses to the
billing meter · one site or separate sites, single-line schematic with the pooling stations ·
deviation settlement per CERC norms · degradation and augmentation.

**Sizing** · HiGHS optimisation against every block floor · hour-by-hour dispatch of every year ·
15-minute compliance workbook · separate-site batteries · market or buyer sale of the excess ·
faster re-runs from the last solution.

**Finance** · financing terms · construction month by month with IDC · six repayment methods,
moratorium, instalments · refinancing · working capital and DSRA · tax with losses carried ·
traceable model · Excel twin with nine sheets · sensitivity tables · money at stake (EMD, PBG).

**Finance team's model (November 2026)** · a dated timeline from the commercial operation date ·
capex phasing by component, part and early commissioning, a bridge loan · P50 / P75 / P90 cases,
carbon credits, life extension, solar repowering, battery augmentation on a schedule · O&M
escalation by source and wind component, other fixed costs as separate lines · refinancing with
re-sculpting, rate step-down, top-up, prepayment penalty, cash sweep with accruals, FSCR / LLCR /
PLCR, DSRA on the peak with interest · quasi-equity and mezzanine · EMD, PBG, connectivity and
statutory guarantees and surety bonds with fees and margin money · book depreciation on SLM and
WDV, thin capitalisation, losses carried · returns at the SPV, HoldCo and promoter, the lender's
XIRR and MIRR · a full balance sheet and cash-flow statement · reverse-auction sensitivities
(capex, modules, exchange rate, interest, generation case, commissioning delay, life, refinancing)
· inputs on their own sheet of the workbook. Every input off by default.

**What-if** · instant rule-based what-if on any plant · tariff levers for bid day · seeded from the
sized bid.

**CfD bid (SECI CfD-I)** · what a Contract for Difference is, in plain words · the RfS and its
three amendments with every change quoted · 251 conditions with their pages · bid inputs, design
and finance inputs by team · own RE sized for the least strike price with every day's supply met
· the full financial model through the shared engine (nine-sheet Excel, traceable model) · strike
price levers · the RfS's 17 formats as letters (Word, PDF) · reference bids from SECI's results ·
the same voice agent, team, evidence and save as the RTC tender.

**Team and evidence** · team setup and roles · pings and threads on every box · assignments and
hand-offs with email · evidence and sign-off on every input · evidence register · activity log ·
feedback and change requests exported as a prompt.

**Platform** · users, sign-in and tab access · day and night mode · Docker on any cloud or
on-premises · enterprise two-zone deployment · signed offline bundles and patches under AMC ·
backups and restore · HTTPS and firewall allowlists.

---

## Setting up the providers

The three cloud keys TenderOS can use (Anthropic for reading tender documents, OpenAI for the
SECI voice agent, LlamaParse for scanned pages) are entered once in the application, under
**API keys** in the sidebar, by an administrator. Each key is checked with its provider when it
is typed, stored encrypted on the server and shown masked from then on (only its last four
characters, who set it and when). A key can be replaced or removed at any time without a
restart. Installations may still set the keys in the server's `.env`; a key entered in the
application wins. In the core zone the page holds no keys: they belong to the intake zone.

## Editions

| | Demo / single installation | Enterprise |
| --- | --- | --- |
| Where it runs | One VM, Docker Compose, HTTPS | The client's own infrastructure, two zones |
| Tender reading | Cloud models from the same installation | Intake zone only; the reading crosses into the core as a signed package |
| Bid, costs, model | On the installation | In the core zone, with no cloud client and no outbound traffic |
| Voice agent, Claude connector | On | Intake zone only; off in the core |
| Updates | `git pull` and rebuild | Signed bundles applied with `tenderos-patch` (verify, backup, apply, health check, rollback) under the AMC |
| Sign-in | Accounts, or demo mode for demonstrations | Accounts; SSO on the roadmap |

Sizing for a typical bid team: one 4-vCPU / 16 GB virtual machine (AWS, Azure, GCP or on-prem),
Docker, a domain or a provided certificate. Installation: `docs/dev/INSTALL-ANY-CLOUD.md`.

---

## What you receive

* The application, installed and running on your infrastructure, with your tender packs.
* The Excel workbook of every bid, the bid pack (formats, letters, evidence register) and the
  sensitivity tables.
* The documentation set: the developer manual, the database design, the screen-to-data map, the
  functional test matrix, the manual click-test script and the installation guide
  (`docs/dev/`), and the feature list with the split of responsibilities between jouleWise and
  the client (`docs/enterprise/`).
* Under the AMC: patches and new tender packs as signed bundles, support on installation and
  upgrades, and the change requests your team raises in the application, implemented and shipped.

---

## Roadmap (not in the current release)

Enterprise single sign-on · sign-off per step and a submission lock · letter-of-credit cost ·
scenario compare of saved what-if cases · review-before-transfer screen and the signed transfer
package tooling in the intake zone · which model outputs stay inside the application ("keep
metrics proprietary", a decision pending from the finance team).

---

*TenderOS is a product of jouleWise. The optimiser and the model are jouleWise's intellectual
property, delivered sealed; the client owns its data, its bids and its workbooks.*
