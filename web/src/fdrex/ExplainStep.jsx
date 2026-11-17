// SECI-FDRE-X, step 01 "What FDRE-X asks" (forked from web/src/cfd/ExplainStep.jsx, which explains
// a Contract for Difference; this tender is a plain PPA with SECI). In plain words, each claim with
// the clause it rests on: what the tender buys, what the developer builds, where the energy comes
// from, how it is paid, what a short month costs and what else the plant may earn; then the tender
// as a picture (VisualModel) and the worked example on real evenings (ExampleStep).
import React from "react";
import { Section, nf, pf } from "../rtc/ui";
import Cite, { Cites } from "./Cite.jsx";
import { TENDER } from "./tender.js";
import { EXAMPLE_DEFAULTS } from "./example.js";
import VisualModel from "./VisualModel.jsx";
import ExampleStep from "./ExampleStep.jsx";
import "../cfd/pack.css";

const SP = EXAMPLE_DEFAULTS.sp; // the example tariff of the plain-words table, ₹/kWh (see ./example.js for where it comes from)
const ROWS = [
  { market: 4.0, label: "A cheap evening" },
  { market: SP, label: "The exchange clears at your tariff" },
  { market: 10.0, label: "A dear evening" },
];

/** A plain-words card: a heading, one or two sentences and the clauses behind them. */
function Card({ when, title, children, cites }) {
  return (
    <div className="cfd-explain-card">
      <span>{when}</span>
      <strong>{title}</strong>
      <div>{children}</div>
      <div className="cfd-cites"><Cites ids={cites} compact /></div>
    </div>
  );
}

/**
 * Step 01: what SECI-FDRE-X asks, in plain words, each claim with the clause it rests on; then the
 * tender as a picture (VisualModel) and the worked example on real evenings (ExampleStep).
 */
export default function ExplainStep({ state, prices, model, setExample, goto }) {
  const X = state.inputs?.contractedMw || 100;
  const H = TENDER.peakHours;
  const E = TENDER.mwhPerMwDay;
  return (
    <>
      <Section index="1" title="What SECI-FDRE-X asks, in simple terms" note="Read this first: the whole tender in plain words, with the clause behind each sentence">
        <div className="cfd-explain" data-testid="cfd-explainer">
          <p>
            SECI-FDRE-X is a power purchase. SECI buys <strong>assured peak supply</strong> from you under a {TENDER.termYears}-year PPA and sells it on to a Buying Entity.
            For every MW you contract you deliver <strong>{E} MWh every day</strong>, in {H} hours the buyer chooses each morning from the non-solar hours, {TENDER.maxMwhPerMwHour} MWh per MW in each hour.
            You are paid <strong>one fixed tariff</strong>, the one you bid, on every kWh you supply in those hours. Nothing is sold on an exchange for you and nothing is settled against exchange prices{" "}
            <Cite id="scheme" compact /> <Cite id="mandate" compact /> <Cite id="fourHours" compact /> <Cite id="hourCap" compact /> <Cite id="tariffFixed" compact />.
          </p>
          <h3>One kilowatt-hour, three evenings, at a tariff of ₹{nf(SP, 2)}</h3>
          <table className="cfd-settle-table" data-testid="cfd-explainer-table">
            <thead><tr><th>Evening</th><th>The exchange price that hour</th><th>SECI pays you</th><th>Your tariff against the exchange</th></tr></thead>
            <tbody>
              {ROWS.map((r) => {
                const gap = SP - r.market;
                return (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>₹{nf(r.market, 2)}/kWh</td>
                    <td><b>₹{nf(SP, 2)}/kWh</b></td>
                    <td className={gap > 0 ? "you" : gap < 0 ? "pool" : ""}>{gap > 0 ? `₹${nf(gap, 2)} dearer than the exchange` : gap < 0 ? `₹${nf(-gap, 2)} cheaper than the exchange` : "the same"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p>
            So your revenue does not move with the market: it is the tariff times the energy you supply in the Peak Hours, for {TENDER.termYears} years from the Scheduled Commencement of Supply Date
            (SCSD) <Cite id="tariff" compact /> <Cite id="term" compact />. The exchange price matters to the buyer, not to your bill: it is what the same hours would cost it elsewhere, and it pays SECI your
            tariff plus a trading margin of ₹{nf(TENDER.tradingMarginRsPerKwh, 2)}/kWh <Cite id="tradingMarginPsa" compact />. Your risks are the ones you control: building the plant on time, having the energy
            stored for whichever hours the buyer names, and the tariff you bid.
          </p>
          <h3>What this means for you</h3>
          <div className="cfd-explain-grid">
            <Card when="What you build" title={`RE generation with storage that can carry ${nf(E * X)} MWh a day, ISTS-connected`} cites={["newProject", "ess", "essThirdParty", "colocated", "reSize", "voltage", "substation", "scsd"]}>
              Solar, wind or both, of any size against your contracted MW, co-located with the storage and connected to an ISTS substation at 220 kV or above with injection rights in the
              non-solar hours. Storage is mandatory; the RfS states no minimum size. The model takes {nf(X)} MW / {nf(TENDER.essHoursMin * X)} MWh for {nf(X)} MW, because the buyer may ask for the whole {E} MWh per MW
              from storage. It may be your own or tied up with a third party. The whole Project must supply by the SCSD, {TENDER.essScdMonths} months from the Effective Date.
              The connection asked for carries power only in the non-solar hours.
            </Card>
            <Card when="Every day" title={`The buyer names ${H} hours by 06:00; you deliver ${nf(E * X)} MWh, ${nf(X)} MWh in each`} cites={["fourHours", "peakWindow", "continuous", "scheduleBy6", "noSchedule", "buyerMustOfftake"]}>
              The Peak Hours run from the evening non-solar hours to the next morning's, as GRID-INDIA defines them for the State of your project. The Buying Entity picks any {H} of them
              each day, with at least 1 hour continuous, and tells you by 06:00. With no schedule, the previous day's hours apply. The buyer must take the energy every day.
            </Card>
            <Card when="Where the energy comes from" title={`All of it renewable; up to ${pf(TENDER.marketShare, 0)} of the year may be bought`} cites={["allRe", "marketShare", "marketUse", "discharged", "overCap", "gridCharging"]}>
              Your own RE charges the storage in the day. Up to {pf(TENDER.marketShare, 0)} of the year's energy may come from the green market or a bilateral agreement, supplied directly in the Peak Hours or
              through the storage, counted on the energy discharged. Energy above that limit is not paid for, and charging the storage from the grid is otherwise not allowed.
            </Card>
            <Card when="How you are paid" title="Tariff × the energy supplied in the Peak Hours, every month" cites={["tariff", "monthlyBill", "dueDate", "lc", "psm", "psmOptIn"]}>
              You bill SECI each month on the energy accounts; SECI pays by the 45th day after it receives the bill and opens a Letter of Credit in your favour. If you opt, in the Covering Letter, for cover under SECI's
              Payment Security Mechanism, you give a discount of ₹{nf(TENDER.psmChargeRsPerKwh, 2)}/kWh on every bill for the whole term. The choice is made once.
            </Card>
            <Card when="If you fall short" title={`${pf(TENDER.shortfallTolerance, 0)} free each billing month, then ${nf(TENDER.penaltyMultiple, 1)} × the tariff`} cites={["shortfall", "tolerance", "shortfallExample", "noPenaltyFm", "thirdPartyPenalty"]}>
              Each billing month you owe {E} MWh per MW for every day. A shortfall beyond {pf(TENDER.shortfallTolerance, 0)} of that costs {nf(TENDER.penaltyMultiple, 1)} × your tariff on every kWh short, and the energy not supplied earns
              nothing. The PPA's example: 3 MU due, 2 MU supplied, at ₹2.70/kWh, costs ₹28.35 lakh. No penalty for supply lost to Force Majeure.
            </Card>
            <Card when="What else the plant may earn" title="Sale outside the Peak Hours, after the PPA supply; SECI first for excess energy" cites={["essOtherUse", "priority", "thirdParty", "excess", "excessFirstRefusal", "connectivityApplied"]}>
              Outside the day's {H} hours the storage may sell to third parties or on an exchange, within the connectivity, without a NOC. The PPA supply comes first: a sale on a day the PPA is
              short costs {nf(TENDER.thirdPartyPenaltyMultiple, 1)} × that day's highest exchange rate on the quantum sold, on top of the shortfall penalty. Excess energy is bought by SECI at the tariff if the Buying Entity
              agrees; it may go to others only if SECI refuses it. Mind the connection: it is for the non-solar hours, so solar beyond what charges the storage
              earns nothing in the day unless you hold solar-hour connectivity as well.
            </Card>
            <Card when="Security you give" title="EMD with the bid, PBG before the PPA, Success Charges to SECI" cites={["emd", "pbg", "pbgValidity", "successCharges", "successInstalments"]}>
              The EMD and the PBG follow the solar, wind and storage you propose. The PBG runs until {TENDER.pbgAfterScdMonths} months after the SCSD and is encashed, pro rata, if supply starts late. Success
              Charges are ₹{nf(TENDER.cacLakhPerMw)} lakh per MW of Installed Capacity (the battery counted in MWh) plus taxes, half within 30 days of the Letter of Award. You give no Letter of Credit.
            </Card>
            <Card when="What you bid" title="One tariff, ₹/kWh, two decimals, for all your projects" cites={["bid", "capacityBid", "decrement", "range", "se"]}>
              You bid {TENDER.bidMinMw} to {TENDER.bidMaxMw} MW in whole MW and one first-round tariff. The qualified bidders then go into an e-Reverse Auction and lower it in steps of 1 paisa or more.
              Bidders within {pf(TENDER.eraRange, 0)} of the lowest tariff win, lowest first, until {pf(TENDER.eraAwardShare, 0)} of the capacity bid (at most {nf(TENDER.totalMw)} MW) is awarded.
            </Card>
          </div>
          <p>
            Because your revenue is fixed by the tariff, the tariff you bid has to cover the storage, your own RE, the power you buy, O&amp;M, the guarantees and any penalties, and earn your
            return over {TENDER.termYears} years. That is what the rest of this tab works out: the steps that follow take your plant and your costs, run every day of the term, and solve the tariff
            that earns your target equity IRR.
          </p>
        </div>
      </Section>
      <Section index="1a" title="The tender in simple terms" note="What SECI buys, how you are paid, what you build, what a miss costs, the money up front, and what to weigh">
        <div className="cfd-explain" data-testid="cfd-explainer-plain">
          <p>
            <strong>What SECI is buying.</strong> Not round-the-clock power: {H} hours a day of the buyer's choosing, in the non-solar hours between the evening and the next morning. For every MW you contract you
            supply {E} MWh a day. SECI wants {nf(TENDER.totalMw)} MW of this, so {nf(TENDER.totalMw * E)} MWh a day in all. A bidder and its group bid {TENDER.bidMinMw} to {TENDER.bidMaxMw} MW{" "}
            <Cite id="scheme" compact /> <Cite id="peakWindow" compact /> <Cite id="capacityBid" compact />.
          </p>
          <p>
            <strong>How you get paid.</strong> You sell to SECI under a PPA; SECI sells to the Buying Entity under a PSA and adds its margin. Your tariff is the one discovered in the
            auction, fixed for {TENDER.termYears} years with no escalation, paid on the energy you supply in the Peak Hours. The auction is on the tariff, lowest wins. The RfS states no
            ceiling tariff <Cite id="nodal" compact /> <Cite id="tariffFixed" compact /> <Cite id="termRfs" compact /> <Cite id="bid" compact />.
          </p>
          <p>
            <strong>What you must build.</strong> RE generation and storage on one site, with the line to an ISTS substation, all supplying by month {TENDER.essScdMonths} from the Effective
            Date. There is one date for the whole Project. The storage has to hold the day's {E} MWh per MW until the hours the buyer names; the documents fix no storage size, so
            sizing it is your call and this tab's Size step tests it day by day <Cite id="newProject" compact /> <Cite id="colocated" compact /> <Cite id="scsd" compact /> <Cite id="ess" compact />.
          </p>
          <p>
            <strong>Where the energy comes from.</strong> Your own solar or wind, stored in the day. You may buy up to {pf(TENDER.marketShare, 0)} of a year's energy from the green market or
            under a bilateral agreement, and no more: a long cloudy or still spell has to be covered by a larger plant, not by purchases <Cite id="allRe" compact /> <Cite id="marketShare" compact /> <Cite id="gridCharging" compact />.
          </p>
          <p>
            <strong>What happens if you miss.</strong> The supply is due every day and is tested by the billing month. Up to {pf(TENDER.shortfallTolerance, 0)} short is free. Beyond that, each missed
            kWh costs {nf(TENDER.penaltyMultiple, 1)} times your tariff, and you lose its revenue. If supply starts late, the PBG is encashed pro rata for up to {TENDER.delayMonthsMax} months; after
            that the capacity not supplying is cut from the PPA <Cite id="monthlyReconciliation" compact /> <Cite id="tolerance" compact /> <Cite id="shortfall" compact /> <Cite id="delay" compact /> <Cite id="delayBeyond" compact />.
          </p>
          <p>
            <strong>What else the plant may earn.</strong> Outside the buyer's {H} hours the storage may be used for sale to others, once the day's PPA supply is met. Energy above the
            assured supply is offered to SECI and the buyer at the tariff first. The connection the tender asks for carries power only in the non-solar hours, so the solar your plant
            makes beyond what charges the storage earns nothing unless you hold solar-hour connectivity as well, or SECI buys it at the tariff. The model does not count on SECI:
            it sells the surplus at exchange prices only if your bid says you hold that connectivity, and curtails it otherwise{" "}
            <Cite id="essOtherUse" compact /> <Cite id="priority" compact /> <Cite id="excess" compact /> <Cite id="excessPsa" compact /> <Cite id="connectivityApplied" compact />.
          </p>
          <p>
            <strong>Money up front.</strong> An earnest money deposit with the bid, then a performance bank guarantee and SECI's Success Charges before the PPA is signed, and a
            net-worth and liquidity test. No plant is needed to bid; you qualify as a company. You do need to have applied for connectivity with non-solar-hour access at the
            substation you name <Cite id="emd" compact /> <Cite id="pbg" compact /> <Cite id="successCharges" compact /> <Cite id="company" compact /> <Cite id="connectivityApplied" compact />.
          </p>
          <p>
            <strong>What to weigh.</strong> A fixed tariff from SECI for {TENDER.termYears} years, with SECI's payment to you not dependent on the buyer paying SECI. Against it: the buyer,
            not you, picks the hours, and is not yet named; the PPA is signed only after a buyer signs the PSA; the tariff has to carry solar you cannot sell in the day; and the tariff you quote has to be inside {pf(TENDER.eraRange, 0)} of the lowest
            bid. That is what the steps that follow size, price and let you test with What-if <Cite id="seciPays" compact /> <Cite id="buyingEntities" compact /> <Cite id="psaFirst" compact /> <Cite id="range" compact />.
          </p>
        </div>
      </Section>

      <VisualModel state={state} prices={prices} />
      <ExampleStep state={state} prices={prices} model={model} setExample={setExample} goto={goto} />
    </>
  );
}
