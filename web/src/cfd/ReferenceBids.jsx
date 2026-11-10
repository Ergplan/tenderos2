import React, { useMemo } from "react";
import { ExternalLink, Trophy } from "lucide-react";
import { Section, Stat, nf, pf } from "../rtc/ui";
import { SECI_RESULTS, SECI_SITE, TRADING_MARGIN_NOTE, tariffRange, weightedTariff } from "../market/seed.js";
import { TENDER } from "./terms.js";
import Cite from "./Cite.jsx";
import { cfdRisks, poolTable, whatWins } from "./winning.js";

// Results that say something about a CfD strike price for 2 hours of assured evening supply:
// the peak-power tenders (the closest product), the RTC results (firm supply round the clock,
// an upper bound), and the solar-plus-storage and wind results (what the building blocks cost).
const COMPARE = {
  "FDRE peak power": "Closest product: assured supply in the evening peak from RE with storage. 4 hours a day, a 25-year PPA at a fixed tariff; the CfD asks 2 hours a day for 15 years and pays the strike price through the market.",
  "FDRE-RTC": "Firm supply in every hour of the day: more storage and more RE per MW than a 2-hour peak product, so a ceiling rather than a comparable.",
  "RTC (round-the-clock RE)": "Round-the-clock RE without the Amendment-03 block floors; an older ceiling.",
  "Solar + ESS": "Solar with 2 to 4 hours of storage sold flat: the cost of the storage and the solar the CfD plant is made of.",
  Wind: "Plain wind: the cost of the wind energy a CfD bidder can use in the peak hours or for charging.",
};
const ORDER = ["FDRE peak power", "FDRE-RTC", "RTC (round-the-clock RE)", "Solar + ESS", "Wind"];
const fmtDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "–");

/** Step 11: no SECI-CfD-I result yet; what the auctions SECI has run say about a strike price. */
export default function ReferenceBids({ state, model }) {
  const results = useMemo(() => [...SECI_RESULTS].sort((a, b) => ORDER.indexOf(a.product) - ORDER.indexOf(b.product) || String(b.auctionDate).localeCompare(String(a.auctionDate))), []);
  const peak = results.filter((r) => r.product === "FDRE peak power");
  const latestPeak = peak[0] || null;
  const peakRange = latestPeak ? tariffRange(latestPeak) : [null, null];
  const sp = model?.bid ?? null;
  const X = state?.inputs?.contractedMw || 0;
  const gap = sp !== null && peakRange[0] !== null ? sp - peakRange[0] : null;
  return (
    <>
      <Section index="11" title="Reference bids" note="SECI-CfD-I has not been auctioned yet: what SECI's other results say about a strike price"
        actions={<a className="rtc-link" href={SECI_SITE} target="_blank" rel="noreferrer"><ExternalLink size={12} /> SECI results</a>}>
        <p className="rtc-note" data-testid="cfd-reference-note">
          The RfS of 15.07.2026 (revised) is open; no Letter of Award has been issued, so there is no winning strike price to compare with. The nearest
          product SECI has auctioned is assured peak supply for 4 hours a day under a 25-year PPA (FDRE peak power). A CfD strike price is not a PPA tariff:
          you receive it for 2 MWh per MW a day for {TENDER.termYears} years, SECI's CfD Pool settles the difference to the market price every 15-minute
          block, the energy may come from your own RE, the green market and your group's plants within the sourcing limits, and the plant is a
          {" "}{nf(X)} MW / {nf(2 * X)} MWh battery with RE online by month {TENDER.reCodMonths}. {TRADING_MARGIN_NOTE}
        </p>
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-reference">
          <Stat label="Your strike price" value={sp !== null ? `₹${nf(sp, 2)}/kWh` : "Not sized"} detail={sp !== null ? "for the target equity IRR, rounded up to the paisa" : "size the plant first (step 07)"} />
          <Stat label={latestPeak ? `${latestPeak.tender.replace(/\(.*\)/, "").trim()}` : "FDRE peak power"} value={peakRange[0] !== null ? `₹${nf(peakRange[0], 2)}–${nf(peakRange[1], 2)}` : "–"} detail={latestPeak ? `awarded ${fmtDate(latestPeak.auctionDate)}: 4 h a day, 25 years` : ""} />
          <Stat label="Against the peak tariff" value={gap === null ? "–" : `${gap >= 0 ? "+" : "−"}₹${nf(Math.abs(gap), 2)}/kWh`} detail={gap === null ? "" : gap >= 0 ? "above the lowest peak-power award" : "below the lowest peak-power award"} tone={gap !== null && gap > 1 ? "bad" : undefined} />
          <Stat label="Round-the-clock ceiling" value={(() => { const r = results.find((x) => x.product === "FDRE-RTC"); const t = r ? tariffRange(r) : [null]; return t[0] !== null ? `₹${nf(t[0], 2)}/kWh` : "–"; })()} detail="FDRE-RTC-V, every hour of the day" />
        </div>
      </Section>

      <Section index="11.1" title="SECI's results that compare" note="Each result as SECI's notice gives it; capacity-weighted tariff of the capacity awarded">
        <div className="table-wrap">
          <table className="rtc-table" data-testid="cfd-reference-table">
            <thead><tr><th>Product</th><th>Tender</th><th>Tendered</th><th>Storage</th><th>Awarded</th><th>Tariff awarded</th><th>Weighted</th><th>Auction</th><th>Why it compares</th></tr></thead>
            <tbody>
              {results.map((r) => {
                const [lo, hi] = tariffRange(r);
                const w = weightedTariff(r);
                return (
                  <tr key={r.id} data-testid={`cfd-reference-${r.id}`}>
                    <td>{r.product}</td>
                    <td>{r.tender}</td>
                    <td>{nf(r.tenderedMw)} MW</td>
                    <td>{r.storageMwh ? `${nf(r.storageMwh)} MWh` : "–"}</td>
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

      <Section index="11.2" title="Why a CfD strike price sits where it does" note="What is in the number, against a peak-power PPA tariff">
        <ul className="seci-queries" data-testid="cfd-reference-why">
          <li><Trophy size={13} /> <span><b>Fewer hours, the same battery.</b> The CfD asks 2 MWh per MW a day; a 4-hour peak PPA asks 4. The battery is sized to the hours, so the capex per kWh supplied is similar, but the fixed costs (land, evacuation, O&amp;M, fees) are spread over half the energy.</span></li>
          <li><Trophy size={13} /> <span><b>Charging power is bought, not only generated.</b> Up to 25% of the year's energy (75% more until month 36) may come from the green market; what you pay for it, plus exchange and transmission charges, goes straight into the strike price.</span></li>
          <li><Trophy size={13} /> <span><b>Market price risk is the Pool's, not yours.</b> You net the strike price on every cleared kWh. A PPA bidder prices the same certainty; the CfD adds the risk that the Pool runs dry, which SECI undertakes to replenish (Amendment-01).</span></li>
          <li><Trophy size={13} /> <span><b>A shorter term.</b> 15 years from the SCD against 25 under a PPA: the capex is recovered faster, which raises the strike price; whatever you sell after the term at market prices is yours.</span></li>
          <li><Trophy size={13} /> <span><b>Penalties bite weekly.</b> Shortfall beyond 10% of the week's 14 MWh/MW costs 1.5 × (the highest evening price − strike price); a bidder with little own RE and a thin battery pays for it.</span></li>
          <li><Trophy size={13} /> <span><b>No ceiling.</b> Amendment-03 removed the ₹5.80/kWh ceiling; the e-Reverse Auction and the L1 + 2% range decide. The What-if step shows which input moves your strike price most.</span></li>
        </ul>
      </Section>
      <WhatWins state={state} model={model} />
    </>
  );
}

/**
 * 11.1 What wins and 11.2 the risks that are yours: the CfD Pool's net flow at strike prices
 * around the evening market and at the bid's own, the award test Amendment-04 added, the bidding
 * logic it implies, and the operational risks (DSM, availability, designated hours, fees, the
 * weekly penalty, fade, a part award), each sized from the model where it can be (winning.js).
 */
function WhatWins({ state, model }) {
  const win = useMemo(() => (model?.sim ? whatWins({ model, finance: model.finance || null }) : null), [model]);
  const rows = useMemo(() => (model?.sim ? poolTable(model, win?.quote ?? null) : []), [model, win]);
  const risks = useMemo(() => (model?.sim ? cfdRisks({ state, model, finance: model.finance || null }) : []), [state, model]);
  if (!model?.sim) {
    return (
      <Section index="11.1" title="What wins" note="The CfD Pool's flow at your price against the evening market and the corpus, once the plant is sized">
        <p className="rtc-note" data-testid="cfd-winning-waiting">Size the plant first: the award test and the risks are priced from your bid.</p>
      </Section>
    );
  }
  return (
    <>
      <Section index="11.1" title="What wins: the Pool's flow at your price" note="Who pays whom at each strike price, and the award test Amendment-04 added (RfS 42.2.b): the capacity awarded is what the corpus carries at the discovered tariff">
        {win && (
          <>
            <div className="rtc-grid rtc-grid-4" data-testid="cfd-winning">
              <Stat label="The evening market" value={`₹${nf(win.mcp, 2)}/kWh`} detail={`average MCP in the two evening hours your plant chooses (IEX ${model.inputs.sellMarket}, the price year); every evening hour averages ₹${nf(win.eveningAverage, 2)}`} />
              <Stat label="Your quote" value={`₹${nf(win.quote, 2)}/kWh`} detail={win.quote <= win.mcp ? `₹${nf(win.mcp - win.quote, 2)} below the evening market` : `₹${nf(win.quote - win.mcp, 2)} above the evening market`} tone={win.tone === "bad" ? "bad" : undefined} />
              <Stat label={win.pool.paysCr >= 0 ? "The Pool pays, net" : "The Pool collects, net"} value={`₹${nf(Math.abs(win.pool.paysCr), 1)} cr a year`} detail={`on your ${nf(model.inputs.contractedMw)} MW; ₹${nf(Math.abs(win.pool.allCr), 0)} cr a year on the full ${nf(TENDER.totalMw)} MW`} />
              <Stat label="Against the corpus" value={win.pool.allCr <= 0 ? "feeds it" : `${nf(win.pool.ratio, 1)}× a year`} detail={`the CfD Pool is ₹${nf(TENDER.poolCr)} cr, a revolving buffer SECI undertakes to replenish`} tone={win.tone === "good" ? "good" : win.tone === "bad" ? "bad" : undefined} />
            </div>
            <p className={`track-verdict ${win.tone}`} data-testid="cfd-winning-verdict">{win.verdict}</p>
          </>
        )}
        <div className="cfd-statements" data-testid="cfd-pool-table">
          <table>
            <thead><tr><th>Strike price</th><th>Pool's net flow, your {nf(model.inputs.contractedMw)} MW</th><th>The full {nf(TENDER.totalMw)} MW</th><th>Against the ₹{nf(TENDER.poolCr)} cr corpus</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sp} className={r.yours ? "strong" : ""}>
                  <td>₹{nf(r.sp, 2)}{r.yours ? " · your quote" : ""}</td>
                  <td>{r.paysCr >= 0 ? `pays ₹${nf(r.paysCr, 1)} cr` : `collects ₹${nf(-r.paysCr, 1)} cr`} a year</td>
                  <td>{r.allCr >= 0 ? `pays ₹${nf(r.allCr, 0)} cr` : `collects ₹${nf(-r.allCr, 0)} cr`} a year</td>
                  <td>{r.allCr <= 0 ? "feeds it" : `${nf(r.ratio, 1)}× a year`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="seci-queries" data-testid="cfd-winning-logic">
          <li><Trophy size={13} /> <span><b>How the settlement works.</b> Every 15-minute block you sell on the exchange at the market clearing price. Below your strike price the Pool pays you the difference; above it you pass the excess to the Pool. Since Amendment-03 that is a full pass-through: you net the strike price on every kWh and the Pool carries the whole gap both ways <Cite id="noRisk" compact />.</span></li>
          <li><Trophy size={13} /> <span><b>What Amendment-04 adds.</b> SECI awards only the capacity whose cost to the Pool stays within the corpus at the discovered tariff <Cite id="corpusCap" compact />. It will test that on its own evening-price view over 15 years, not on last year's two dearest hours: as batteries arrive the evening softens, so a quote that costs the Pool nothing today may cost it on SECI's view. The lower the quote sits against the evening market, the more of the {nf(TENDER.totalMw)} MW SECI can award.</span></li>
          <li><Trophy size={13} /> <span><b>Nearest the market, not lowest in the band.</b> The auction awards everyone within L1 + 2% in tariff order <Cite id="range" compact />. Going below your cost of capital buys nothing: any gain above the strike price goes to the Pool, so a low quote is never recovered from a strong market. Going above the market costs the award, not just the rank. The target is the lowest price your capital accepts, which on the benchmarks sits close to where the Pool is neutral.</span></li>
          <li><Trophy size={13} /> <span><b>Bid what your balance sheet carries.</b> The strike price barely moves with the MW (every cost scales with it), so the size is set by the net worth and guarantees you can show, not by the price. If SECI restricts the award in tariff order the marginal bidder gets a part, and RfS 42.4 lets a bidder refuse a part below half its bid <Cite id="partial" compact />: a quote you are sure is inside the band gets its full MW.</span></li>
          <li><Trophy size={13} /> <span><b>Freeze the battery contract.</b> The battery's capex is the largest line of the price (the Bid review names it). A signed supply contract turns the biggest assumption into evidence: the lender accepts the leverage, the What-if track stops treating it as a stretch, and the review stops flagging it. Freeze it on the What-if step with the contract attached.</span></li>
        </ul>
      </Section>
      <Section index="11.2" title="Risks that are yours" note="Once the market price risk is the Pool's, what remains is operational; Amendment-04 spells it out, and the model sizes it where it can">
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
