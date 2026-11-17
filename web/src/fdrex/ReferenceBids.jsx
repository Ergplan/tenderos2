// SECI-FDRE-X, step 11: reference bids, what wins and the risks that are the bidder's (forked from
// web/src/cfd/ReferenceBids.jsx). There is no CfD Pool here: the bid's tariff is read against
// SECI's earlier awards for assured peak supply of 4 hours a day, against the exchange price of
// the hours supplied (the buyer's alternative), and against the auction rules of the RfS. The
// arithmetic is ./winning.js; the test ids are the CfD tab's.
import React, { useMemo } from "react";
import { ExternalLink, Trophy } from "lucide-react";
import { Section, Stat, nf, pf } from "../rtc/ui";
import { SECI_RESULTS, SECI_SITE, TRADING_MARGIN_NOTE, tariffRange, weightedTariff } from "../market/seed.js";
import { TENDER } from "./tender.js";
import Cite from "./Cite.jsx";
import { cfdRisks, eveningMcp, peakAwards, tariffTable, whatWins } from "./winning.js";

// How each of SECI's results reads against a tariff for 4 MWh per MW a day in four hours the buyer
// chooses: the peak-power tenders are the same product by name; the others are what round-the-clock
// supply clears at and what the building blocks (solar with storage, wind) cost.
const PEAK = "FDRE peak power";
const COMPARE = {
  [PEAK]: `The same product by name: assured peak supply of ${TENDER.mwhPerMwDay} MWh per MW a day (MW × ${TENDER.peakHours} h), as this tender. The notice gives the capacity, the hours and the tariffs; read that RfS for its term, its choice of hours, its penalty, its limit on bought power and what it lets the plant sell besides before reading the tariff across. An award under which more energy is bought per MW, or the surplus may be sold, is not like for like.`,
  "FDRE-RTC": "Firm supply in every hour of the day, not four hours the buyer chooses: a different product, with far more energy per contracted MW. Not a comparable: it shows what round-the-clock RE with storage clears at.",
  "RTC (round-the-clock RE)": "An older round-the-clock result; the same remark.",
  "Solar + ESS": "Solar sold with a battery at one tariff on all its energy, most of it daytime solar. It shows what the solar and the battery this plant is made of cost, not the price of four evening hours.",
  Wind: "Plain wind energy: what wind costs if you use it in the buyer's hours or for charging.",
};
const ORDER = [PEAK, "FDRE-RTC", "RTC (round-the-clock RE)", "Solar + ESS", "Wind"];
const fmtDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "–");
const signed = (v, d = 2) => `${v >= 0 ? "+" : "−"}₹${nf(Math.abs(v), d)}`;

/** Step 11: no SECI-FDRE-X result yet; what the auctions SECI has run say about a tariff, what wins, and the risks. */
export default function ReferenceBids({ state, model }) {
  const results = useMemo(() => [...SECI_RESULTS].sort((a, b) => ORDER.indexOf(a.product) - ORDER.indexOf(b.product) || String(b.auctionDate).localeCompare(String(a.auctionDate))), []);
  const awards = useMemo(() => peakAwards(), []);
  const latest = awards[0] || null;
  const sp = model?.bid ?? null;
  const gap = sp !== null && latest ? sp - latest.hi : null;
  const mcp = useMemo(() => (model?.sim ? eveningMcp(model) : null), [model]);
  return (
    <>
      <Section index="11" title="Reference bids" note="SECI-FDRE-X has not been auctioned yet: what SECI's earlier results say about a tariff"
        actions={<a className="rtc-link" href={SECI_SITE} target="_blank" rel="noreferrer"><ExternalLink size={12} /> SECI results</a>}>
        <p className="rtc-note" data-testid="cfd-reference-note">
          No e-Reverse Auction has been held for SECI-FDRE-X, so there is no winning tariff to compare with. SECI has auctioned the same product by name,
          assured peak supply of {TENDER.mwhPerMwDay} MWh per MW a day, {awards.length === 1 ? "once" : `${nf(awards.length)} times`} in the results this tab holds
          {awards.length ? `: ${awards.map((a) => `${a.short} (${nf(a.tenderedMw)} MW × ${nf(a.mwhPerMwDay)} h, ₹${nf(a.lo, 2)} to ${nf(a.hi, 2)}/kWh, ${fmtDate(a.auctionDate)})`).join(" and ")}` : ""}.
          This tender asks {nf(TENDER.totalMw)} MW × {TENDER.peakHours} h: {TENDER.mwhPerMwDay} MWh per MW every day in {TENDER.peakHours} hours the Buying Entity chooses from the non-solar hours,
          for {TENDER.termYears} years at one fixed tariff, all of it RE with at most {pf(TENDER.marketShare, 0)} of a year's energy bought, and {nf(TENDER.penaltyMultiple, 1)} × the tariff on a month's
          shortfall beyond {pf(TENDER.shortfallTolerance, 0)} <Cite id="scheme" compact /> <Cite id="mandate" compact /> <Cite id="termRfs" compact /> <Cite id="marketShare" compact /> <Cite id="shortfall" compact />. {TRADING_MARGIN_NOTE}
        </p>
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-reference">
          <Stat label="Your tariff" value={sp !== null ? `₹${nf(sp, 2)}/kWh` : "Not sized"} detail={sp !== null ? "for the target equity IRR, rounded up to the paisa" : "size the plant first (step 07)"} />
          <Stat label={latest ? latest.short : "FDRE peak power"} value={latest ? `₹${nf(latest.lo, 2)}–${nf(latest.hi, 2)}` : "–"} detail={latest ? `awarded ${fmtDate(latest.auctionDate)}: ${nf(latest.tenderedMw)} MW × ${nf(latest.mwhPerMwDay)} h a day` : ""} />
          <Stat label="Against the latest peak award" value={gap === null ? "–" : `${signed(gap)}/kWh`} detail={gap === null ? "" : gap > 0 ? "above its highest tariff awarded" : "at or below its highest tariff awarded"} tone={gap !== null && gap > 0 ? "bad" : undefined} />
          <Stat label="The buyer's alternative" value={mcp !== null ? `₹${nf(mcp, 2)}/kWh` : "–"} detail={mcp !== null ? `IEX ${model.inputs.sellMarket} in the ${TENDER.peakHours} dearest evening hours, the price year` : "the exchange price of the hours supplied, once the plant is sized"} />
        </div>
      </Section>

      <Section index="11.1" title="SECI's results that compare" note="Each result as SECI's notice gives it; capacity-weighted tariff of the capacity awarded">
        <div className="table-wrap">
          <table className="rtc-table" data-testid="cfd-reference-table">
            <thead><tr><th>Product</th><th>Tender</th><th>Tendered</th><th>Assured supply or storage</th><th>Awarded</th><th>Tariff awarded</th><th>Weighted</th><th>Auction</th><th>How it compares with SECI-FDRE-X</th></tr></thead>
            <tbody>
              {results.map((r) => {
                const [lo, hi] = tariffRange(r);
                const w = weightedTariff(r);
                return (
                  <tr key={r.id} data-testid={`cfd-reference-${r.id}`}>
                    <td>{r.product}</td>
                    <td>{r.tender}</td>
                    <td>{nf(r.tenderedMw)} MW</td>
                    <td>{r.storageMwh ? `${nf(r.storageMwh)} MWh${r.product === PEAK ? ` a day (${nf(r.storageMwh / r.tenderedMw)} MWh per MW)` : " of storage"}` : "–"}</td>
                    <td>{nf(r.awardedMw)} MW</td>
                    <td>{lo !== null ? `₹${nf(lo, 2)}–${nf(hi, 2)}` : "–"}</td>
                    <td>{w !== null ? `₹${nf(w, 2)}` : "–"}</td>
                    <td>{fmtDate(r.auctionDate)}</td>
                    <td className="wrap">{COMPARE[r.product] || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section index="11.2" title="How the earlier peak auctions closed" note="From SECI's result notices: who quoted what, and where the capacity ran out">
        <ul className="seci-queries" data-testid="cfd-reference-why">
          {awards.map((a) => (
            <li key={a.id}><Trophy size={13} /> <span><b>{a.short}, {fmtDate(a.auctionDate)}: ₹{nf(a.lo, 2)} to {nf(a.hi, 2)}/kWh.</b> {nf(a.bidders)} bidders quoted for {nf(a.quotedMw)} MW against {nf(a.tenderedMw)} MW tendered ({nf(a.quotedMw / a.tenderedMw, 1)} times). The tariffs awarded are {nf(Math.round((a.hi - a.lo) * 100))} paisa apart; quotes in the auction ran up to ₹{nf(a.highestQuote, 2)}. This tender's L1 + {pf(TENDER.eraRange, 0)} would reach ₹{nf(a.rangeTop, 2)} from that lowest tariff{a.inRangeUnawarded ? `, and ${nf(a.inRangeUnawarded)} bidders inside it (${nf(a.inRangeUnawardedMw)} MW) were awarded nothing: the capacity ran out first` : ""}.{a.partAward ? ` The last winner bid ${nf(a.partAward.bidMw)} MW and was awarded ${nf(a.partAward.mw)} MW.` : ""}</span></li>
          ))}
          <li><Trophy size={13} /> <span><b>What the two results say.</b> When the capacity quoted is several times the capacity tendered, the award goes to the bidders at the very bottom, in tariff order. Being inside L1 + {pf(TENDER.eraRange, 0)} is necessary, not enough <Cite id="range" compact /> <Cite id="seCap" compact />.</span></li>
          <li><Trophy size={13} /> <span><b>What this tender asks that moves a tariff.</b> The buyer picks its {TENDER.peakHours} hours from the whole night each morning, so the storage must carry the full {TENDER.mwhPerMwDay} MWh per MW; at most {pf(TENDER.marketShare, 0)} of a year's energy may be bought; a month short by more than {pf(TENDER.shortfallTolerance, 0)} pays {nf(TENDER.penaltyMultiple, 1)} × the tariff; the whole Project is due {TENDER.essScdMonths} months from the Effective Date; the term is {TENDER.termYears} years <Cite id="fourHours" compact /> <Cite id="marketShare" compact /> <Cite id="shortfall" compact /> <Cite id="scsd" compact /> <Cite id="term" compact />. Whether the earlier tenders asked the same is in their own RfS, which this tab does not hold: check before you take their tariffs as your target. A tender that buys more energy per MW, or lets the surplus be sold, is not like for like.</span></li>
          <li><Trophy size={13} /> <span><b>The connection decides what the tariff must carry.</b> The tender asks for connectivity with non-solar-hour access. A plant sized to charge the storage on its worst days makes more solar than the storage takes on most days, and that surplus cannot be injected in the day. It earns something only if you hold solar-hour connectivity as well, or if SECI buys it as excess energy at the tariff, which needs the Buying Entity's consent. This is one of the things that separates a low bid from a high one <Cite id="connectivityApplied" compact /> <Cite id="substation" compact /> <Cite id="excess" compact />.</span></li>
          <li><Trophy size={13} /> <span><b>Where your number comes from.</b> The tariff has to pay for the storage, the own RE that charges it, the bought power, O&amp;M, the guarantees and the return, on {TENDER.mwhPerMwDay} MWh per MW a day. If it stands well above the earlier awards, the Bid review names the inputs that carry it and the What-if step shows which one moves it most.</span></li>
          <li><Trophy size={13} /> <span><b>No ceiling tariff is stated.</b> The RfS sets none. SECI may still cancel any or all bids after the auction if the tariff discovered is high, and may annul the process if it finds no buyers <Cite id="highTariffCancel" compact /> <Cite id="noBuyers" compact />.</span></li>
        </ul>
      </Section>
      <WhatWins state={state} model={model} />
    </>
  );
}

/**
 * 11.3 What wins and 11.4 the risks that are yours: the bid's tariff against SECI's earlier peak
 * awards and against the exchange price of the hours supplied (what the same energy would cost the
 * buyer), the auction rules of the RfS and the bidding logic they imply, and the risks the PPA
 * leaves with the developer, each sized from the model where it can be (winning.js).
 */
function WhatWins({ state, model }) {
  const win = useMemo(() => (model?.sim ? whatWins({ model, finance: model.finance || null }) : null), [model]);
  const rows = useMemo(() => (model?.sim ? tariffTable(model, win?.quote ?? null) : []), [model, win]);
  const risks = useMemo(() => (model?.sim ? cfdRisks({ state, model, finance: model.finance || null }) : []), [state, model]);
  if (!model?.sim) {
    return (
      <Section index="11.3" title="What wins" note="Your tariff against the earlier awards, the buyer's alternative and the auction rules, once the plant is sized">
        <p className="rtc-note" data-testid="cfd-winning-waiting">Size the plant first: the comparison and the risks are priced from your bid.</p>
      </Section>
    );
  }
  const X = model.inputs.contractedMw;
  return (
    <>
      <Section index="11.3" title="What wins: your tariff, the earlier awards and the buyer's alternative" note="The auction awards the lowest tariffs; SECI then needs a buyer at the tariff discovered before it signs the PPA">
        {win && (
          <>
            <div className="rtc-grid rtc-grid-4" data-testid="cfd-winning">
              <Stat label="Your quote" value={`₹${nf(win.quote, 2)}/kWh`} detail={win.latest ? (win.vsLatest > 0 ? `₹${nf(win.vsLatest, 2)} above the latest peak award (${win.latest.short}, ₹${nf(win.latest.lo, 2)}–${nf(win.latest.hi, 2)})` : `at or below the latest peak award (${win.latest.short}, ₹${nf(win.latest.lo, 2)}–${nf(win.latest.hi, 2)})`) : "no earlier peak award in the results"} tone={win.tone === "bad" ? "bad" : undefined} />
              <Stat label="The same hours on the exchange" value={`₹${nf(win.mcp, 2)}/kWh`} detail={`average price in the ${TENDER.peakHours} evening hours supplied (IEX ${model.inputs.sellMarket}, the price year); every evening hour averages ₹${nf(win.eveningAverage, 2)}`} />
              <Stat label={win.exchange.savesCr >= 0 ? "The buyer saves" : "The buyer pays more"} value={`₹${nf(Math.abs(win.exchange.savesCr), 1)} cr a year`} detail={`on your ${nf(X)} MW, at ₹${nf(win.buyerCost, 2)} with SECI's margin; ₹${nf(Math.abs(win.exchange.allCr), 0)} cr a year on the full ${nf(TENDER.totalMw)} MW`} tone={win.exchange.savesCr >= 0 ? "good" : "bad"} />
              <Stat label="The range if you are lowest" value={`up to ₹${nf(win.rangeTop, 2)}`} detail={`L1 + ${pf(TENDER.eraRange, 0)}; you stay inside it while the lowest quote is ₹${nf(win.l1Floor, 2)} or more`} />
            </div>
            <p className={`track-verdict ${win.tone}`} data-testid="cfd-winning-verdict">{win.verdict}</p>
          </>
        )}
        <div className="cfd-statements" data-testid="cfd-pool-table">
          <table>
            <thead><tr><th>Tariff</th><th>The buyer pays, with SECI's margin</th><th>Against the exchange price</th><th>The buyer's saving, your {nf(X)} MW</th><th>The full {nf(TENDER.totalMw)} MW</th><th>Against the latest peak award</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sp} className={r.yours ? "strong" : ""}>
                  <td>₹{nf(r.sp, 2)}{r.label ? ` · ${r.label}` : ""}</td>
                  <td>₹{nf(r.buyerCost, 2)}/kWh</td>
                  <td>{r.vsExchange <= 0 ? `₹${nf(-r.vsExchange, 2)} below` : `₹${nf(r.vsExchange, 2)} above`}</td>
                  <td>{r.savesCr >= 0 ? `saves ₹${nf(r.savesCr, 1)} cr` : `pays ₹${nf(-r.savesCr, 1)} cr more`} a year</td>
                  <td>{r.allCr >= 0 ? `saves ₹${nf(r.allCr, 0)} cr` : `pays ₹${nf(-r.allCr, 0)} cr more`} a year</td>
                  <td>{r.vsLatest === null ? "–" : r.vsLatest > 1e-9 ? `₹${nf(r.vsLatest, 2)} above` : r.vsLatest < -1e-9 ? `₹${nf(-r.vsLatest, 2)} below` : "at its highest"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="seci-queries" data-testid="cfd-winning-logic">
          <li><Trophy size={13} /> <span><b>How you are paid.</b> One tariff, fixed for {TENDER.termYears} years, on the energy you supply in the Peak Hours, billed monthly to SECI. Nothing is settled against exchange prices: the exchange price is what the same energy would cost the buyer, which pays SECI your tariff plus ₹{nf(TENDER.tradingMarginRsPerKwh, 2)}/kWh <Cite id="tariffFixed" compact /> <Cite id="monthlyBill" compact /> <Cite id="tradingMargin" compact />.</span></li>
          <li><Trophy size={13} /> <span><b>The first-round tariff decides who enters the auction.</b> The qualified bids are ranked on it. SECI awards {pf(TENDER.eraAwardShare, 0)} of the capacity they add up to, at most {nf(TENDER.totalMw)} MW. When that {pf(TENDER.eraAwardShare, 0)} exceeds {nf(TENDER.totalMw)} MW the bidder with the highest first-round tariff is dropped before the auction, unless two share that tariff, fewer than 3 bidders would remain, or {pf(TENDER.eraAwardShare, 0)} of the rest would no longer exceed {nf(TENDER.totalMw)} MW. Do not open at a tariff that can be the highest <Cite id="se" compact /> <Cite id="h1Out" compact /> <Cite id="h1Condition" compact />.</span></li>
          <li><Trophy size={13} /> <span><b>In the auction.</b> You start from your first-round tariff and can only go down, by ₹{nf(TENDER.eraDecrement, 2)}/kWh or more each time; your MW cannot change. You see every bidder's last tariff and capacity under a pseudo identity. The clock runs 30 minutes and extends by 8 minutes whenever a quote moves a bidder between the green (full award), orange (part) and red (none) zones <Cite id="decrement" compact /> <Cite id="noIncrease" compact /> <Cite id="capacityFixed" compact /> <Cite id="eraScreen" compact /> <Cite id="eraClock" compact />.</span></li>
          <li><Trophy size={13} /> <span><b>Who wins.</b> Every bidder within L1 + {pf(TENDER.eraRange, 0)} of the lowest tariff, lowest first, until the capacity eligible for award is used up; a tie goes to the earlier last quote. The RfS's own illustration prints ₹3.55 as the range for a lowest tariff of ₹3.50, where {pf(TENDER.eraRange, 0)} gives ₹3.57: this page applies the clause's words <Cite id="range" compact /> <Cite id="seCap" compact /> <Cite id="tie" compact />.</span></li>
          <li><Trophy size={13} /> <span><b>Know your floor before you log in.</b> In the earlier peak auctions the winners' tariffs were {awardSpread(win)} apart. A step of 1 paisa moves the equity return very little; the question is where you stop. Take the floor from the Financial model step (the tariff at the lowest return your capital accepts), go down only while you are in the orange or red zone, and stop there <Cite id="eraZones" compact />.</span></li>
          <li><Trophy size={13} /> <span><b>Bid the MW you can build at half.</b> The last winner gets what is left of the capacity. A part of half your bid or more must be accepted, or the EMD is encashed; a smaller part may be refused within 7 days. The tariff barely moves with the MW, so size the bid on the net worth and guarantees you can show <Cite id="partial" compact /> <Cite id="partRefuse" compact /> <Cite id="partRefuseDays" compact /> <Cite id="netWorth" compact />.</span></li>
          <li><Trophy size={13} /> <span><b>The buyer must want the power.</b> SECI signs the PPA only after a Buying Entity has signed the PSA, signs only the capacity it has sold, and may annul the process if it finds no buyers at the tariffs discovered. A tariff that, with SECI's margin, is below what the same evening hours cost on the exchange is easy to place; one above it has to be sold on firmness and on the buyer's renewable and storage obligations <Cite id="psaFirst" compact /> <Cite id="psaShortfall" compact /> <Cite id="noBuyers" compact /> <Cite id="rpo" compact />.</span></li>
          <li><Trophy size={13} /> <span><b>Solar-hour connectivity is worth paise.</b> {win?.surplus ? (win.surplus.dayInjection ? `Your bid sells ${nf(win.surplus.soldMwh / 1000, 1)} GWh of surplus RE a year for ₹${nf(win.surplus.soldCr, 1)} cr because it says you hold connectivity in the solar hours too. A rival without it has to put that into the tariff.` : `Your bid curtails ${nf(win.surplus.curtailedMwh / 1000, 1)} GWh of surplus solar a year because it holds non-solar-hour access only, as the tender asks. A rival that holds solar-hour connectivity as well sells that surplus and can quote lower.`) : "A bidder that can inject in the solar hours sells its surplus; one that cannot puts the whole plant into the tariff."} Set the choice on Bid inputs to what you can show, and see the difference on the Financial model step <Cite id="connectivityApplied" compact /> <Cite id="connectivityRisk" compact />.</span></li>
          <li><Trophy size={13} /> <span><b>Freeze what you can prove.</b> The storage and the own RE are the largest lines of the tariff. A signed supply contract turns the biggest assumption into evidence: the lender accepts the leverage, the What-if track stops treating it as a stretch, and the Bid review stops flagging it. Freeze it on the What-if step with the contract attached.</span></li>
        </ul>
      </Section>
      <Section index="11.4" title="Risks that are yours" note="The tariff is fixed and the exchange price is not your risk on the PPA supply; these are, and the model sizes them where it can">
        <div className="bid-review" data-testid="cfd-risks">
          {risks.map((r) => (
            <div key={r.id} className="review-item note" data-testid={`cfd-risk-${r.id}`}>
              <div className="review-head"><b>{r.title}</b>{r.cite && <Cite id={r.cite} compact />}</div>
              <p>{r.detail}</p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

/** How far apart the tariffs awarded in the earlier peak auctions were, in words (from the result notices). */
function awardSpread(win) {
  const spreads = (win?.awards || []).map((a) => Math.round((a.hi - a.lo) * 100));
  return spreads.length ? `${nf(Math.max(...spreads))} paisa or less` : "very little";
}
