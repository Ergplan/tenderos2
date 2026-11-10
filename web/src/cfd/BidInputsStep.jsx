import React from "react";
import { Field, Section, nf } from "../rtc/ui";
import AssignButton from "../team/AssignButton";
import Cite, { Cites } from "./Cite.jsx";
import { TENDER } from "./terms.js";
import { BG_YEARS, CHOICES, fmtDate, keyDates, missingInputs, rfsAmounts } from "./model.js";
import { Choice, DateBox, Fields, FillBar } from "./inputs.jsx";

const cr = (v) => `₹${nf(v, 2)} cr`;

/** What the RfS asks of a bid for this plant: securities, SECI's charges and the eligibility tests. */
export function RfsAmounts({ inputs }) {
  const a = rfsAmounts(inputs);
  const plant = `${nf(a.solarMw)} MW solar${a.windMw ? `, ${nf(a.windMw)} MW wind` : ""}, ${nf(a.essMwh)} MWh battery`;
  const rows = [
    ["EMD with the bid", cr(a.emdCr), `bank guarantee, held ~${nf(BG_YEARS.emd * 12, 0)} months`, ["emd"]],
    ["PBG after the LoA", cr(a.pbgCr), `bank guarantee, held ~${nf(BG_YEARS.pbg * 12, 0)} months`, ["pbg"]],
    ["Contract Administration Charges", cr(a.cacCr), "+ GST, within 20 days of the LoA", ["cac"]],
    ["Bid processing fee and RfS cost", cr(a.bidFeeCr + a.rfsCostCr), "+ GST, with the bid", ["bidFee", "rfsCost"]],
    ["Net worth you must show", cr(a.netWorthCr), "for the installed capacities", ["netWorth"]],
    ["Liquidity: one of", `${cr(a.turnoverCr)} turnover`, `or ${cr(a.pbditCr)} PBDIT, or a ${cr(a.lineOfCreditCr)} line of credit`, ["turnover", "pbdit", "lineOfCredit"]],
  ];
  return (
    <div className="cfd-rfs" data-testid="cfd-rfs-amounts">
      <p className="rtc-note">For {nf(inputs.contractedMw || 0)} MW contracted: {plant}. The model charges the bank guarantees at the cost on Finance inputs and adds SECI's charges, with GST, to the project cost.</p>
      <div className="cfd-rfs-grid">
        {rows.map(([label, value, note, cites]) => (
          <div key={label} className="rtc-stat"><span>{label}</span><strong>{value}</strong><small>{note}</small><span className="cfd-rfs-cites"><Cites ids={cites} /></span></div>
        ))}
      </div>
    </div>
  );
}

/**
 * Step 04, the Projects team: what you bid (contracted MW), the Effective Date and every date that
 * follows it, where the peak supply is sold, where the charging power may come from, the sale of
 * surplus RE and what happens after the term; then what the RfS asks of this bid.
 */
export default function BidInputsStep({ state, setState, setInput, lockProps, optimise = null }) {
  const i = state.inputs;
  const missing = missingInputs(state);
  const dates = i.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(i.effectiveDate) ? keyDates(i.effectiveDate) : null;
  return (
    <>
      <Section index="3" title="What you bid" note="The Projects team's decisions; the tender's own numbers stand beside them">
        <FillBar state={state} setState={setState} missing={missing} optimise={optimise} />
        <div className="rtc-grid rtc-grid-4 cfd-fields">
          <div className="has-assign" data-testid="cfd-in-contractedMw" data-voice="inputs.contractedMw">
            <Field label="Contracted capacity you bid" unit="MW" value={i.contractedMw} step={1} min={TENDER.bidMinMw} max={TENDER.bidMaxMw} onChange={(v) => setInput("contractedMw", v)}
              hint={`${TENDER.bidMinMw} to ${TENDER.bidMaxMw} MW in whole MW, one bid for your group; ${nf(TENDER.totalMw)} MW tendered`} {...lockProps("inputs.contractedMw")} />
            <AssignButton compact target={{ kind: "field", key: "inputs.contractedMw", label: "Contracted capacity you bid", context: { unit: "MW", type: "number" } }} />
            <Cite id="capacityBid" />
          </div>
          <div className={state.filled.effectiveDate ? "bid-benchmark" : ""}>
            <DateBox label={CHOICES.effectiveDate.label} value={i.effectiveDate} onChange={(v) => setInput("effectiveDate", v)} testId="cfd-in-effectiveDate" voice="inputs.effectiveDate"
              hint={[state.filled.effectiveDate ? "benchmark" : null, CHOICES.effectiveDate.hint].filter(Boolean).join(" · ")} />
          </div>
          <div className="rtc-stat"><span>Supply to guarantee</span><strong>{nf((i.contractedMw || 0) * TENDER.mwhPerMwDay)} MWh a day</strong><small>{TENDER.mwhPerMwDay} MWh per contracted MW in any 2 of the Peak Hours (18:00–24:00), every day <Cite id="mandate" compact /></small></div>
          <div className="rtc-stat"><span>How you are paid</span><strong>The strike price, every kWh</strong><small>The CfD Pool settles the difference to the market price each 15-minute block <Cite id="settlement" compact /></small></div>
        </div>
        {dates && (
          <div className="cfd-dates" data-testid="cfd-dates">
            <span>Letter of Award <strong>{fmtDate(dates.loa)}</strong><Cite id="effectiveDate" compact /></span>
            <span>PBG, charges, documents <strong>{fmtDate(dates.docsDue)}</strong><Cite id="docsDue" compact /></span>
            <span>Financial closure <strong>{fmtDate(dates.finClose)}</strong><Cite id="finClose" compact /></span>
            <span>SCD: battery and supply <strong>{fmtDate(dates.scd)}</strong><Cite id="essScd" compact /></span>
            <span>Last day with penalty <strong>{fmtDate(dates.lastWithPenalty)}</strong><Cite id="delay" compact /></span>
            <span>PBG valid to <strong>{fmtDate(dates.pbgUntil)}</strong><Cite id="pbgValidity" compact /></span>
            <span>Own RE by <strong>{fmtDate(dates.reDeadline)}</strong><Cite id="reCod" compact /></span>
            <span>Term ends <strong>{fmtDate(dates.end)}</strong><Cite id="term" compact /></span>
          </div>
        )}
      </Section>

      <Section index="3.1" title="Where the supply is sold and charged" note="Your choices within the tender's sourcing limits">
        <p className="rtc-note">All supply must be RE <Cite id="allRe" />. Up to 25% may come from the green market or bilateral deals all term <Cite id="market25" />, a further 75% for charging until month 36 <Cite id="market75" />, then a further 50% from group companies' RE <Cite id="group50" />; shares are measured on the energy discharged <Cite id="discharged" />. Green power is bought at the hourly IEX GDAM price.</p>
        <div className="rtc-grid rtc-grid-4 cfd-fields">
          <Choice state={state} setInput={setInput} k="sellMarket" lockProps={lockProps} />
          <Choice state={state} setInput={setInput} k="useMarket" yesNo lockProps={lockProps} />
          <Choice state={state} setInput={setInput} k="useGroup" yesNo lockProps={lockProps} />
          <Choice state={state} setInput={setInput} k="merchant" yesNo lockProps={lockProps} />
        </div>
        <div className="rtc-grid rtc-grid-4 cfd-fields">
          <Choice state={state} setInput={setInput} k="shortfallPolicy" lockProps={lockProps} />
          <div className="rtc-field cfd-policy-note" data-testid="cfd-policy-note">
            <div className="rtc-field-top"><span>What the policy means</span></div>
            <small>{i.shortfallPolicy === "pay"
              ? <>Pay the penalty: a day may fall short when that is cheaper than more plant; beyond 10% in a Contract Week the shortfall costs 1.5 × (the week's highest evening price − the strike price) and that evening's revenue is lost <Cite id="tolerance" compact /> <Cite id="shortfall" compact />. The optimiser then sizes the own RE on the strike price alone.</>
              : <>Meet every day: no shortfall on any day of any Contract Year; the optimiser only keeps plants that meet the supply within the sourcing limits <Cite id="tolerance" compact /> <Cite id="shortfall" compact />.</>}</small>
          </div>
          <Choice state={state} setInput={setInput} k="afterTerm" lockProps={lockProps} />
          {i.afterTerm === "merchant" && (
            <div className="has-assign" data-testid="cfd-in-merchantYears" data-voice="inputs.merchantYears">
              <Field label="Years of market sales after the term" unit="years" value={i.merchantYears} step={1} min={0} max={15} onChange={(v) => setInput("merchantYears", v)}
                hint="The CfD ends with the term; you may operate on" {...lockProps("inputs.merchantYears")} />
              <AssignButton compact target={{ kind: "field", key: "inputs.merchantYears", label: "Years of market sales after the term", context: { unit: "years", type: "number" } }} />
              <Cite id="afterExpiry" />
            </div>
          )}
        </div>
        <Fields state={state} setInput={setInput} section="sourcing" lockProps={lockProps} />
      </Section>

      <Section index="3.2" title="Money at stake" note="From the RfS formulas, on your contracted MW and the installed capacities of the Design step">
        <RfsAmounts inputs={i} />
      </Section>
    </>
  );
}
