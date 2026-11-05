import React, { useMemo } from "react";
import { ExternalLink, Trophy } from "lucide-react";
import { Section, Stat, nf, pf } from "../rtc/ui";
import { SECI_RESULTS, SECI_SITE, TRADING_MARGIN_NOTE, tariffRange, weightedTariff } from "../market/seed.js";
import { TENDER } from "./terms.js";

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
    </>
  );
}
