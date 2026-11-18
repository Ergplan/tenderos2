# TenderOS user manual · SECI-FDRE-X bid

*The FDRE-X Bid tab, step by step: what is on each screen and what to click. The tender is
SECI-FDRE-X, RfS No. SECI/C&P/IPP/13/0012/26-27 dated 07.10.2026: 4,800 MWh of assured peak
supply (1,200 MW × 4 hours), Amendment-01 in force.*

The tab has the flow of the CfD Bid tab: the same sidebar, heading tools (Save, Team, Open, Reset
inputs), twelve step chips with the owning team, boxes with pings, evidence and feedback, the Talk
to the bid agent button, Save and Open to the library. The CfD manual
(`SECI-CFD-USER-MANUAL.md`) describes those tools; this manual covers what is different: the
tender and what each step does with it.

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
solar hours, say so on Bid inputs; it lowers the tariff you need by a wide margin.

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
at a fixed tariff, with a monthly test and only 5% of bought power.

---

## Step 01 · What FDRE-X asks *(Tender / Legal)*

The explanation above with a worked example for a capacity you pick (50 to 600 MW): the energy a
day, the battery, a day's four evening hours with their exchange prices from the IEX year, what
the tariff pays for them, and what a short month costs. Every claim carries its clause; click a
citation to open the page of the document.

## Step 02 · Tender & amendments *(Tender / Legal)*

The four documents (RfS, standard PPA, standard PSA, Amendment-01) with what matters in each, and
a link to every PDF. The schedule: dates from the RfS and dates from SECI's website, the second
kind marked as such (online bids 1 December 2026, 18:00; offline documents 3 December; opening
4 December; the e-reverse auction date is not announced). The twelve rows of Amendment-01, each
with the clause as it stood and "Deleted": the Buying Entity's right to resell surplus power and
to schedule the plant are gone, so scheduling stays with you. How the bid goes, step by step, and
the points worth raising with SECI.

## Step 03 · Bid conditions *(Tender / Legal)*

The 450 conditions of the RfS, the PPA and the PSA, by group (Scheme and bid, Auction, Daily
supply, Tariff and payment, Plant, Energy sourcing, Dates, Bid security and charges, Penalties and
security, Eligibility, Bid documents). Each has a plain line, the clause, the page and the
quoted words. Search by word. Conditions the amendment deleted are shown struck through beside
what replaced them. Fourteen are marked **conflict**: places where the documents disagree, with
what differs (for example the PPA says "Project Capacity" where the RfS says Contracted Capacity).

## Step 04 · Bid inputs *(Projects)*

| Box | What to enter |
|---|---|
| Contracted capacity you bid | 50 to 600 MW, whole MW, one bid for your group. |
| Effective Date of the PPA | 15 days after SECI's invitation to sign. Every date below follows from it: documents and PBG, financial closure, the SCSD 18 months later, the last day with penalty, the PBG's validity, the end of the 25 years. |
| Exchange for market prices | The buyer's four dearest evening hours are read from it; the extra battery's sale is priced in it. |
| Buy green-market power to charge the battery | Yes or no. Within 5% of each year's energy. |
| Sell surplus own RE in the market | Yes or no. At exchange prices, on days the supply is met. |
| Connectivity in the solar hours too | The tender asks for connectivity with access in the non-solar hours only. *No* (the default): nothing is injected from 06:00 to 18:00, so solar beyond what charges the battery is curtailed. *Yes*: you hold connectivity for the solar hours as well, and the day's surplus is sold. |
| Cover under SECI's Payment Security Mechanism | Yes takes ₹0.02/kWh off every bill for the term. |
| Shortfall policy | *Meet every day*, or *Pay the penalty* where that is cheaper than more plant. |
| After the 25-year term | Nothing, or years of market sales. |

**Money at stake** shows the EMD, the PBG, the Success Charges, the bid fee, and the net worth and
liquidity you must show, worked on your plant. **Fill up for me please** puts a competitive
bidder's value in every empty box and sizes the own RE.

## Step 05 · Design *(Design)*

The battery (energy and power per contracted MW, the state-of-charge window, degradation, the
augmentation of every year as a table), the own solar and wind with their profiles, and the
losses to the meter. The battery must hold 4 MWh per MW usable at the meter; the step says what
nameplate that needs. **Optimise own RE** finds the solar (and wind) that gives the lowest tariff.

## Step 06 · Finance inputs *(Finance)*

Costs, financing, construction, working capital and the finance team's detailed inputs, as on the
CfD tab. The loan tenor may run to 25 years. There is no Letter of Credit and no REC price here.

## Step 07 · Size *(Projects)*

The tariff to bid, the days short, the tender's checks (capacity, the battery for the four hours,
bought power within 5%, 4 MWh per MW every day, the monthly shortfall within 10%), the Bid
review's findings, the day-by-day operation and the 15-minute dispatch.

**Own RE size: sized for you, or your size.** Below the Optimise own RE button (Design and Size
steps). *Sized for you*, the default: whenever you change an input the size depends on (the
battery, where the charging power comes from, prices, costs, finance), the tab sizes the solar
(and wind) again a moment later, in whole MW, and says so. *Your size*: the tab keeps the size you
set; typing a solar or wind size, a What-if move or an Upside plan switches to it, and Optimise
own RE hands the size back. When no size meets every day, the message says how many days fall
short, when, and what would cure them (for example green-market power before your own RE is
online).

## Step 08 · Financial model *(Finance)*

The tariff for your target equity IRR and the tariff to quote (two decimals), the returns at a
tariff you type, the project cost, the revenue and costs by year, the monthly penalty over the
term, the tariff received after the PSM discount, and what the same hours cost on the exchange.
**Download the financial model** gives the workbook with every number a formula; the second
button adds the 15-minute dispatch behind the energy.

## Step 09 · What-if *(Finance)*

The levers that move the tariff, each priced through the full model, the track from the model's
tariff to the one you want to quote, and Freeze, which pins a lever's value with its evidence.

## Step 10 · Bid forms *(Tender / Legal)*

The RfS's 23 formats, filled from the bid: the Covering Letter, the Power of Attorney and the
Consortium Agreement where they apply, the EMD and PBG in each of the three instruments, the
board resolutions, the financial requirement, the undertakings and disclosures, the financial
bid, the cost estimate, and the annexures. Particulars are asked once and used everywhere. A
format that does not apply to your bid says so. Each can be opened as a letter and exported as a
Word file; the bid pack exports them together.

## Step 11 · Reference bids *(Projects)*

What wins: your tariff against SECI's earlier firm and peak-power awards, against what the same
four hours cost on the exchange, and the auction's rules (80% of the qualified capacity awarded,
winners within 2% of the lowest tariff). The risks that are yours: the buyer chooses the hours,
the monthly penalty, the 5% limit on bought power, battery fade, delay in commissioning, a part
award.

## Step 12 · Upside *(Finance)*

What more solar and battery behind the same connection would earn on the exchange, case by case,
with the bid's own model. Selling is allowed outside the buyer's four hours, the PPA first. SECI's
first right to excess energy at the tariff is an upside the step names and does not count.

## The bid agent

**Talk to the bid agent** works the tab by voice: it explains the tender with pages, takes the
inputs in order, sizes the plant and explains the tariff. **Ask the analyst** on the Upside step
is the written analyst, which runs the bid's model to answer questions; it needs the Anthropic
key on the server and is switched off in the core zone.

## Quick reference: an FDRE-X bid in ten clicks

1. **FDRE-X Bid** in the sidebar.
2. **Bid inputs**: the contracted MW and the Effective Date.
3. **Fill up for me please**; wait for the optimiser.
4. Replace the marked boxes with your own figures (battery and solar prices, financing).
5. **Design**: check the battery and the profiles; **Optimise own RE** again.
6. **Size**: read the checks and the Bid review.
7. **Financial model**: the tariff to quote; type the tariff you mean to bid to see its returns.
8. **What-if**: the levers that close the gap to the price you want.
9. **Bid forms**: fill the particulars, review each format, export the pack.
10. **Save**; download the financial model.
