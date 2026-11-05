import React from "react";
import { Section, nf } from "../rtc/ui";
import Cite, { Cites } from "./Cite.jsx";
import { TENDER } from "./terms.js";
import VisualModel from "./VisualModel.jsx";
import ExampleStep from "./ExampleStep.jsx";
import "./pack.css";

const SP = 5.7; // the worked strike price of the plain-words example, ₹/kWh
const ROWS = [
  { market: 4.0, label: "A cheap evening" },
  { market: 5.7, label: "The market clears at your strike price" },
  { market: 7.0, label: "A dear evening" },
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
 * Step 01: what a Contract for Difference is, in plain words, each claim with the clause it rests on;
 * then the tender as a picture (VisualModel) and the worked example on real evenings (ExampleStep).
 */
export default function ExplainStep({ state, prices, model, setExample, goto }) {
  const X = state.inputs?.contractedMw || 100;
  return (
    <>
      <Section index="1" title="What a Contract for Difference is, in simple terms" note="Read this first: the whole tender in plain words, with the clause behind each sentence">
        <div className="cfd-explain" data-testid="cfd-explainer">
          <p>
            A Contract for Difference (CfD) is a promise about <strong>price</strong>, not a promise to buy your power. You sell your electricity on a
            power exchange every evening, at whatever price the market clears. SECI then settles the <strong>difference</strong> between that market price
            and the price you bid, the <strong>strike price</strong>: when the market paid you less than your strike price, SECI's CfD Pool pays you the gap;
            when the market paid you more, you hand the excess to the Pool. Either way you end the evening with your strike price on every kWh you supplied <Cite id="settlement" compact /> <Cite id="noRisk" compact />.
          </p>
          <h3>One kilowatt-hour, three evenings, at a strike price of ₹{nf(SP, 2)}</h3>
          <table className="cfd-settle-table" data-testid="cfd-explainer-table">
            <thead><tr><th>Evening</th><th>The exchange pays you</th><th>The CfD Pool</th><th>You keep</th></tr></thead>
            <tbody>
              {ROWS.map((r) => {
                const gap = SP - r.market;
                return (
                  <tr key={r.market}>
                    <td>{r.label}</td>
                    <td>₹{nf(r.market, 2)}/kWh</td>
                    <td className={gap > 0 ? "pool" : gap < 0 ? "you" : ""}>{gap > 0 ? `pays you ₹${nf(gap, 2)}` : gap < 0 ? `you pay ₹${nf(-gap, 2)}` : "nothing changes hands"}</td>
                    <td><b>₹{nf(SP, 2)}/kWh</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p>
            So your revenue does not move with the market: it is the strike price times the energy you supply, for 15 years <Cite id="spFixed" compact /> <Cite id="term" compact />.
            The market price only decides whether money flows from the Pool to you or from you to the Pool. SECI does this because it wants firm power in the
            evening peak without a utility signing a 25-year PPA: the exchanges take the power, and the ₹{TENDER.poolCr} crore Pool, topped up by SECI if it ever
            runs dry, carries the price risk <Cite id="pool" compact /> <Cite id="poolReplenish" compact />. Your risks are the ones you control: building the plant on time,
            supplying every evening, and the price you bid.
          </p>
          <h3>What this means for you</h3>
          <div className="cfd-explain-grid">
            <Card when="What you build" title={`A battery of at least ${nf(X)} MW / ${nf(2 * X)} MWh, and your own solar or wind`} cites={["ess", "essOwned", "colocated", "essScd", "reCod"]}>
              For every contracted MW you own at least 1 MW / 2 MWh of battery, co-located with your generation, connected to an ISTS substation at 220 kV or more.
              The battery must run 15 months from the Effective Date (that date is the SCD); your own solar or wind gets until 36 months.
            </Card>
            <Card when="Every day" title={`Pick 2 hours between 18:00 and 24:00 and sell ${nf(2 * X)} MWh on the exchange`} cites={["twoHours", "mandate", "blocks", "cleared", "markets"]}>
              You choose the two hours a day ahead (eight 15-minute blocks, not necessarily consecutive), in the market of your choice: DAM, GDAM, HP-DAM, RTM, TAM or G-TAM.
              Only energy whose bid clears on the exchange is settled; energy above 2 MWh per MW is not.
            </Card>
            <Card when="Where the energy comes from" title="All of it renewable; up to 25% bought, more while you build" cites={["allRe", "market25", "market75", "group50", "discharged"]}>
              Every year's supply must be RE. Up to 25% may be bought in the green market for the whole term; until month 36 a further 75% may be bought to charge the battery,
              so you can supply before your own plant runs; after month 36 a further 50% may come from your group companies' RE projects, again only to charge the battery.
              The shares are measured on the energy the battery discharges.
            </Card>
            <Card when="If you fall short" title="10% free each week, then 1.5 × the gap" cites={["tolerance", "shortfall", "noPenaltyBelow", "uncleared"]}>
              Each Contract Week (Monday to Sunday) you owe 14 MWh per MW. Shortfall beyond 10% of that costs 1.5 × (the week's highest evening market price on any exchange − your strike price)
              per MWh short; nothing when that price is below your strike price. Energy that did not clear counts as short.
            </Card>
            <Card when="Security you give" title="EMD with the bid, PBG after the award, a Letter of Credit through the term" cites={["emd", "pbg", "lc", "cac"]}>
              The EMD and the PBG follow the solar, wind and battery you propose. The Letter of Credit to SECI is 2000 × your MW × (₹10 − your strike price) × 30 days: the lower your
              strike price, the larger the LC. Plus ₹1 lakh per MW of Contract Administration Charges.
            </Card>
            <Card when="What you bid" title="One strike price, ₹/kWh, two decimals, no ceiling" cites={["bid", "ceiling", "capacityBid", "decrement", "range", "se"]}>
              You bid 50 to 150 MW and one first-round tariff for all your projects. The qualified bidders then go into an e-Reverse Auction and lower it in steps of 1 paisa.
              Everyone within 2% of the lowest tariff wins, in tariff order, until 80% of the capacity bid (at most 500 MW) is awarded.
            </Card>
          </div>
          <p>
            Because your revenue is fixed by the strike price, the price you bid has to cover the battery, your own RE, the charging power you buy, O&amp;M, the guarantees and
            any penalties, and earn your return over 15 years. That is what the rest of this tab works out: the steps that follow take your plant and your costs, run every day of
            the term, and solve the strike price that earns your target equity IRR.
          </p>
        </div>
      </Section>

      <VisualModel state={state} prices={prices} />
      <ExampleStep state={state} prices={prices} model={model} setExample={setExample} goto={goto} />
    </>
  );
}
