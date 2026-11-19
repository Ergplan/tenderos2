# TenderOS user manual · SECI-FDRE-X bid

*The FDRE-X Bid tab, step by step: what is on each screen and what to click. The tender is
SECI-FDRE-X, RfS No. SECI/C&P/IPP/13/0012/26-27 dated 07.10.2026: 4,800 MWh of assured peak
supply (1,200 MW × 4 hours), Amendment-01 in force.*

The tab works like the SECI RTC tender tab: the same sidebar, heading tools (Save, Team, Open,
Reset inputs), eight step chips with the owning team, and the Tender to Bid steps for the design,
the finance terms, the sizing and the financial model. The SECI RTC manual
(`SECI-RTC-USER-MANUAL.md`) describes those shared screens; this manual covers what is this
tender's own.

Over every screen a bar reads **Beta version for demo**: check every result independently before
using it in a bid application; Joulewise is not accountable for mistakes in the results. A demo
licence also shows its trial period there (start and end dates, days left).

---

## What the tender asks

SECI wants 4,800 MWh of firm supply a day in the non-solar hours (1,200 MW for 4 hours) from
ISTS-connected RE projects with energy storage. You sign a 25-year PPA with SECI at one fixed
tariff. For every MW you contract you supply 4 MWh a day, 1 MWh in an hour, in the four hours the
Buying Entity names each morning. You commission the whole Project within 18 months of the PPA's
Effective Date.

## The tender in simple terms

**What SECI is buying.** Not round-the-clock power: four hours a day, when the sun is down. The
Buying Entity (the distribution company SECI sells on to) tells you by 06:00 which four hours of
the coming evening, night or early morning it wants; at least one hour must be continuous. If it
says nothing, yesterday's hours apply. SECI wants 1,200 MW of this. A group bids 50 to 600 MW.

**How you get paid.** A PPA, not an exchange sale: SECI pays your tariff for every kWh you supply
in those hours, for 25 years, with no escalation. The auction is on the tariff, lowest wins;
there is no ceiling in the RfS. You may opt for cover under SECI's Payment Security Mechanism by
giving ₹0.02/kWh off every bill for the whole term; you choose once, in the Covering Letter.

**What you must build.** RE generation and storage, at one site or more, connected to the ISTS
at 220 kV or above. The RfS sets no storage size. Because the buyer names the hours only that
morning, the model sizes the battery to carry the whole 4 MWh per MW.

**Where the energy comes from.** All of it must be renewable. Your own solar or wind charges the
battery in the day. Up to 5% of the year's energy may be bought from the green market or under a
bilateral agreement, supplied directly or through the battery. Beyond that the battery may not be
charged from the grid.

**What happens if you miss.** The supply is reconciled by the billing month. Up to 10% short is
free. Beyond that, every missed kWh costs 1.5 times your tariff, and you lose its revenue. If you
sell to anyone else while the PPA is short, a second penalty of 1.5 times the day's highest
exchange price applies to what you sold.

**The grid connection.** You apply for ISTS connectivity with access in the non-solar hours
before you bid, for at least the contracted capacity. With that alone the plant cannot inject in
the day: solar beyond what the battery needs earns nothing. If you also hold connectivity for the
solar hours, say so on Bid inputs.

**What else the plant may earn.** Outside the four hours the battery may sell to others or on the
exchange, the PPA always first. Energy above the assured supply goes to SECI at the tariff if the
buyer agrees; only if SECI refuses may it be sold elsewhere. The model sells surplus at exchange
prices and does not count on SECI taking it.

**Money up front.** An earnest money deposit with the bid; a performance bank guarantee and the
second half of the Success Charges before the PPA is signed (the first half within 30 days of the
Letter of Award); a net-worth and liquidity test. Bank guarantees, Payment on Order Instruments
and surety bonds are all accepted.

**How it differs from the other SECI tenders in TenderOS.** FDRE-RTC-V asks for supply in every
time block around the clock; this tender asks only for four buyer-chosen hours. CfD-I is two
hours sold on the exchange and settled against a strike price for 15 years; this is a 25-year PPA
at a fixed tariff, with a monthly test and only 5% of bought power. The tab is built like the SECI
RTC tender tab: the same Design, Finance inputs, Size and Financial model steps, with HiGHS sizing
the plant against this tender's rules.

---

---

## Step 01 · Tender & amendments *(Tender / Legal)*

The four documents (RfS, standard PPA, standard PSA, Amendment-01) with what matters in each, and
a link to every PDF. The schedule (dates from SECI's website are marked as such). The twelve rows
of Amendment-01, each with the clause as it stood and "Deleted". How the bid goes, step by step,
and the points worth raising with SECI.

**Amended PPA & PSA: track changes** (the second view at the top of the step) shows the two
agreements whole, page by page, with Amendment-01 applied: each deleted clause struck through in red
and "Deleted." after it, tagged with the amendment, its date and the clause. *Amended text* hides
what is struck; *Original* shows the agreement as printed; "go to one" jumps to each change; every
page links to its PDF page.

## Step 02 · Bid conditions *(Tender / Legal)*

The 450 conditions of the RfS, the PPA and the PSA, by group. Each has a plain line, the clause,
the page and the quoted words. Search by word. Conditions the amendment deleted are struck through
beside what replaced them; fourteen are marked **conflict** where the documents disagree.

## Step 03 · Bid inputs *(Projects)*

| Box | What to enter |
|---|---|
| Contracted capacity | 50 to 600 MW, whole MW, one bid for your group. The supply to assure is 4 MWh per MW a day, 1 MWh per MW in each of the buyer's hours. |
| The buyer's four hours | *The 4 costliest non-solar hours each day* (the default): each night the 4 hours from 18:00 to 06:00 with the highest IEX Day-Ahead prices, the hours a buyer would most likely name (most often 18:00–22:00). *Evening 18:00–22:00*: cheaper to plan for, but short if the buyer names other hours. The plant is sized for these hours only. |
| Shortfall | *Pay the penalty beyond 10%* (the default): each month 10% of the peak energy may fall short for free (its revenue is lost) and the energy short beyond it costs 1.5 × the tariff; the optimizer weighs that against more plant. *Meet every month in full*: no shortfall. |
| Buy green-market or bilateral power | Yes or no. Up to 5% of each year's energy, supplied directly or through the storage, at the hourly IEX GDAM price plus the **charges on bought power** (exchange fee, transmission, losses; ₹0.30/kWh to start). |
| Connectivity in the solar hours too | *No* (the tender's connectivity): nothing is sold from 06:00 to 18:00. *Yes*: you hold connectivity for the solar hours as well, and the day's surplus may be sold. |
| Sell the surplus on the exchange | *Yes* sells what the buyer's hours and the storage do not take, outside the buyer's hours and within the connectivity, on **IEX GDAM** (green day-ahead, the usual choice), **DAM** or **RTM**, at that market's prices (the built-in IEX year; the 15-minute dispatch uses its 15-minute prices). *No* curtails it. The step quotes both sides: the RfS allows the sale (8.1.f), the PPA offers excess energy to SECI first (9.3); the model assumes SECI does not take it, so raise it in the pre-bid queries. |
| Payment Security Mechanism | Yes takes ₹0.02/kWh off every bill for the 25 years. |
| Effective Date of the PPA | Financial Closure, the SCSD (18 months later) and the latest start follow from it. |

**Money at stake** shows the EMD, the PBG, the net worth to show and the Success Charges (with
GST) on the sized plant: the RE in MW and the storage in MWh. The Success Charges, the RfS cost and
the bid fee are in the project cost. Every box carries its clause; click it to open the page.

## Step 04 · Design *(Design)*

Solar, wind and the storage, each switched on for this tender. On each source card:

* **Optimizer sizes it / Size fixed**: by default the optimizer chooses the size, up to the most
  you allow (the box). Switch to *Size fixed* to set the size yourself; the optimizer then sizes
  the other sources around it.
* The costs, the CUF and degradation, and the hourly profile: an upload or a profile from the
  shared library (the measured Beed wind cluster, the Beed PVsyst solar), scaled to your CUF.

Also here: the losses to the billing meter, one site or separate sites, and **Sale in the market**
(sell the surplus or not, at which IEX market, its escalation). *Fill up for me please* puts
benchmark values in every empty box.

## Step 05 · Finance inputs *(Finance)*

The financing, the debt repayment and refinancing, construction, working capital and the reserves,
and the finance team's detailed inputs, as on the SECI RTC tab.

## Step 06 · Size *(Projects)*

**Size the plant** runs HiGHS: hour by hour over the modelled years, the least 25-year tariff at
your target equity IRR with the buyer's four hours supplied, the monthly rule held, bought power
within 5% and nothing sold where there is no connectivity. A 100 MW bid takes about a minute.
While it runs, the optimizer animation fills the screen: a tariff surface over solar × wind (from
the instant What-if model, the best storage at each mix) builds up, the solver's log streams beside
it, and HiGHS's optimum is marked when it is found. *Skip animation* goes straight to the result;
*Cancel* stops the sizing. Then:

* **Plant**: the solar, wind and storage sizes and the tariff HiGHS proves no design can beat.
* **The monthly rule** year by year: the worst month's share of its peak energy, marked within the
  free 10% or with the penalty paid beyond it.
* **Tender conditions**: each condition checked on the plant, with its page.
* A dispatch week and where the energy went.

## Step 07 · Financial model *(Finance)*

The tariff for your target equity IRR (the exact model on HiGHS's design), the returns at the
tariff you mean to quote, the project cost, the revenue and costs by year (the power bought, the
PSM discount, the monthly penalty), and **Download the financial model**: the workbook with its
Live model sheet, every cell a formula.

## Step 08 · What-if *(Finance)*

Starts from the plant HiGHS sized and every input of the bid, and answers at once: change a size,
the storage hours, a cost, the financing, the buyer's hours, the shortfall plan, the bought power,
the connectivity or the PSM, and see the tariff your target equity IRR needs, the IRRs and DSCR at
your bid tariff, and whether the plant still meets the tender (the buyer's hours supplied, the
months within the free 10%, the energy short beyond it, the power bought against the 5%, the
surplus sold). The levers table ranks which input moves the tariff most, and how far each would
have to move to reach a tariff you name.

The What-if runs an instant rule-based dispatch (the battery serves the buyer's hours; the power
bought goes first to the months beyond the free 10%, cheapest hours first; the surplus is sold at
the hourly IEX price outside the solar hours), not the optimizer, so the sized bid itself reads a
little dearer here than in the Financial model (₹8.83 against ₹8.55 on the benchmark bid). Use it
to compare cases; size again for the bid. *Back to the sized bid* restores the starting case.

## Step 09 · Bid forms *(Tender / Legal)*

The RfS's 23 formats, filled from the bid and the sized plant: the Covering Letter (with your PSM
choice), the Power of Attorney and the Consortium Agreement where they apply, the EMD and PBG in
each of the three instruments, the board resolutions, the financial requirement, the undertakings
and disclosures, the financial bid, the cost estimate, and the annexures. Particulars are asked
once and used everywhere. Each format opens as a letter and exports as a Word file.

## The voice bid agent

**Talk to the bid agent** (bottom right) opens a GPT-Live voice conversation that works this tab
with you. It briefs the tender's key conditions with their documents and pages, asks your inputs
in order (the MW, the buyer's hours, the shortfall plan, bought power and its charges, the
connectivity, the PSM, the Effective Date, then the benchmarks or each design input), changes
anything you name on screen, sizes the plant with HiGHS, explains the plant, the monthly rule, the
power bought, EMD, PBG, net worth and SECI's charges, gives the tariff for your target IRR, checks
the tariff you mean to quote, tries what-ifs ("what if storage costs ₹0.9 crore per MWh?"), works
out the energy with the formula, and fills and reviews the bid forms with you. Every number comes
from the screen and every tender fact from the documents; it never changes a term.

Say, for example, "bid 150 megawatts, plan for the evening hours, use the benchmarks and run the
optimizer": it sets each input on screen and starts HiGHS, and the optimizer animation opens beside
its panel.

It needs the OpenAI key set up once by an administrator (API keys in the Library), an HTTPS
address for the microphone, and a network that lets the browser's voice connection (WebRTC) reach
the voice service. If it cannot connect within 20 seconds, the panel says so.

## Quick reference: an FDRE-X bid in nine clicks

1. **FDRE-X Bid** in the sidebar.
2. **Bid inputs**: the contracted MW, the Effective Date, the buyer's hours, the shortfall plan,
   bought power, connectivity and the PSM.
3. **Design**: *Fill up for me please*, then your solar, wind and storage costs; fix any size you
   already know, leave the rest to the optimizer; say whether the surplus is sold.
4. **Finance inputs**: your financing.
5. **Size**: *Size the plant*; read the plant and the monthly rule.
6. **Financial model**: the tariff to quote; type your quote to see its returns; download the workbook.
7. **What-if**: try another size, cost or plan; the levers table shows what moves the tariff.
8. **Bid forms**: fill the particulars, review each format, export the pack.
9. **Save**.

Or talk to the bid agent and let it take you through the same steps.
