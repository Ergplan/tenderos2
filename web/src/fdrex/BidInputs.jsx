import React from "react";
import { Field, Section, Stat, nf } from "../rtc/ui";
import { Choice } from "../seci/BidStep";
import { hourRanges } from "../seci/peakPrices";
import Cite from "./Cite.jsx";
import { DEFAULT_SETTINGS, NON_SOLAR, PEAK_PLANS, SHORTFALL_MODES, TENDER, keyDates, moneyAtStake } from "./bidTerms.js";

const fmtDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "–");
const cr = (rs) => `₹${nf(rs / 1e7, 2)} cr`;
const yesNo = { yes: { label: "Yes", detail: "" }, no: { label: "No", detail: "" } };

/** A yes / no choice with a line of explanation under each answer. */
function YesNo({ value, onChange, yes, no, testid }) {
  return <Choice options={{ yes: { ...yesNo.yes, detail: yes }, no: { ...yesNo.no, detail: no } }} value={value ? "yes" : "no"} onChange={(v) => onChange(v === "yes")} testid={testid} />;
}

/**
 * Step 3 of the FDRE-X Bid tab: what the bidder offers and the tender's choices that shape the
 * sizing: the contracted capacity, the buyer's 4 hours, the shortfall plan, bought power, the
 * connectivity, the Payment Security Mechanism, the dates from the PPA, and the money at stake on
 * the sized plant. Every choice changes the terms the HiGHS sizing works to (bidTerms.js).
 */
export default function BidInputs({ state, setState, terms }) {
  const fx = { ...DEFAULT_SETTINGS, ...(state.fdrex || {}) };
  const setFx = (patch) => setState((s) => ({ ...s, fdrex: { ...DEFAULT_SETTINGS, ...(s.fdrex || {}), ...patch }, lp: null }));
  const mw = state.bid.baseMw;
  const bad = !(Number.isInteger(mw) && mw >= TENDER.bidMinMw && mw <= TENDER.bidMaxMw);
  const dates = keyDates(fx.ppaDate);
  const sized = state.lp?.sizes;
  const money = sized ? moneyAtStake(sized) : null;
  const picked = terms.peak?.picked;
  const hh = (h) => `${String(h).padStart(2, "0")}:00`;
  return (
    <>
      <Section index="3" title="What you bid" note="One tariff for the contracted capacity, fixed for 25 years; bidders within L1 + 2% win">
        <div className="rtc-grid rtc-grid-3">
          <div data-voice="bidMw">
            <label className="rtc-field">
              <div className="rtc-field-top"><span>Contracted capacity</span><em>MW</em></div>
              <input type="number" min={TENDER.bidMinMw} max={TENDER.bidMaxMw} step={10} value={mw ?? ""} data-testid="fdrex-bid-mw"
                onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); setState((s) => ({ ...s, bid: { ...s.bid, baseMw: v, greenshoe: false }, lp: null })); }} />
              <small className={bad ? "seci-flag" : ""}>{bad ? `${TENDER.bidMinMw} to ${TENDER.bidMaxMw} MW, in whole MW` : `Of ${nf(TENDER.totalMw, 0)} MW tendered`} <Cite id="capacityBid" compact /></small>
            </label>
          </div>
          <Stat label="Supply to assure" value={mw ? `${nf(mw * TENDER.mwhPerMwDay, 0)} MWh a day` : "–"}
            detail={mw ? `${nf(mw, 0)} MW in each of the ${TENDER.peakHours} hours the buyer names, 1 MWh per MW an hour` : ""} />
          <Stat label="Shortfall" value={`${nf(TENDER.penaltyMultiple, 1)} × tariff`} detail={`on the month's energy short beyond ${Math.round(TENDER.shortfallTolerance * 100)}%; the energy short earns nothing`} />
        </div>
        <p className="rtc-note">The demand the optimizer sizes for is the contracted MW in the buyer's four hours each day and nothing in the others. <Cite id="mandate" compact /> <Cite id="hourCap" compact /> <Cite id="fourHours" compact /></p>
      </Section>

      <Section index="3.1" title="The buyer's four hours" note="The Buying Entity names 4 hours of the non-solar hours each morning, by 06:00">
        <Choice options={PEAK_PLANS} value={fx.peakPlan} onChange={(v) => setFx({ peakPlan: v })} testid="fdrex-peak" />
        <p className="rtc-note" data-testid="fdrex-peak-note">
          {picked
            ? `From the IEX Day-Ahead prices: most often ${hourRanges(picked.mostOften)}; the hours picked average ₹${nf(picked.pickedRsPerKwh, 2)}/kWh against ₹${nf(picked.windowRsPerKwh, 2)}/kWh for the whole window. `
            : terms.peak?.pricesPending ? "The IEX prices are loading; until then the evening hours 18:00–22:00 are used. " : ""}
          The non-solar hours are taken as {hh(NON_SOLAR.start)} to {hh(NON_SOLAR.end)} until GRID-INDIA's for the project's State are known. <Cite id="peakWindow" compact /> <Cite id="noSchedule" compact /> <Cite id="continuous" compact />
        </p>
      </Section>

      <Section index="3.2" title="Shortfall" note="Reconciled month by month">
        <Choice options={SHORTFALL_MODES} value={fx.shortfall} onChange={(v) => setFx({ shortfall: v })} testid="fdrex-shortfall" />
        <p className="rtc-note"><Cite id="shortfall" compact /> <Cite id="shortfallBeyond" compact /> <Cite id="monthlyReconciliation" compact /></p>
      </Section>

      <Section index="3.3" title="Charging power and connectivity" note="All of the energy must be renewable">
        <div className="rtc-grid rtc-grid-2">
          <div className="rtc-field" data-testid="fdrex-buy">
            <div className="rtc-field-top"><span>Buy green-market or bilateral power</span></div>
            <YesNo value={fx.buy} onChange={(v) => setFx({ buy: v })} testid="fdrex-buy-choice"
              yes={`Up to ${Math.round(TENDER.marketShare * 100)}% of each year's energy, supplied directly or through the storage, at the hourly IEX GDAM price plus the charges below`}
              no="Own solar and wind only" />
            <small><Cite id="marketShare" compact /></small>
          </div>
          {fx.buy && (
            <Field label="Charges on bought power" unit="₹/kWh" value={fx.buyCharges} onChange={(v) => setFx({ buyCharges: v })} step={0.01} min={0} max={3}
              hint="Exchange fee, transmission charges and losses to the meter, on top of the GDAM price" />
          )}
          <div className="rtc-field" data-testid="fdrex-day">
            <div className="rtc-field-top"><span>Connectivity in the solar hours too</span></div>
            <YesNo value={fx.dayInjection} onChange={(v) => setFx({ dayInjection: v })} testid="fdrex-day-choice"
              yes="You hold connectivity for the solar hours as well: the day's surplus may be sold"
              no="The tender's connectivity, for the non-solar hours: nothing is sold from 06:00 to 18:00, so solar beyond what the storage takes is curtailed" />
            <small><Cite id="connectivityApplied" compact /> <Cite id="connectivityQuantum" compact /></small>
          </div>
        </div>
        <p className="rtc-note">Whether to sell the surplus in the market, and at which price, is on the Design step. Outside the buyer's hours the storage may sell to others, the PPA first. <Cite id="essOtherUse" compact /> <Cite id="priority" compact /></p>
      </Section>

      <Section index="3.4" title="Payment Security Mechanism" note="Chosen once, in the Covering Letter, for the whole term">
        <YesNo value={fx.psm} onChange={(v) => setFx({ psm: v })} testid="fdrex-psm"
          yes={`₹${TENDER.psmChargeRsPerKwh.toFixed(2)}/kWh off every bill for the 25 years, for SECI's payment security`} no="No discount; the project is not covered" />
        <p className="rtc-note"><Cite id="psmOptIn" compact /></p>
      </Section>

      <Section index="3.5" title="Dates" note="Everything follows the Effective Date of the PPA">
        <div className="rtc-grid rtc-grid-4">
          <label className="rtc-field">
            <div className="rtc-field-top"><span>Effective Date of the PPA</span></div>
            <input type="date" value={fx.ppaDate || ""} onChange={(e) => setFx({ ppaDate: e.target.value || null })} data-testid="fdrex-ppa-date" />
            <small>15 days after SECI's invitation to sign</small>
          </label>
          <Stat label="Financial Closure" value={fmtDate(dates?.financialClosure)} detail={`${TENDER.finCloseMonthsBeforeScd} months before the SCSD`} />
          <Stat label="Supply starts (SCSD)" value={fmtDate(dates?.scsd)} detail={`${TENDER.scdMonths} months from the Effective Date, for the full capacity`} />
          <Stat label="Latest start" value={fmtDate(dates?.latestStart)} detail="with the PBG encashed pro rata" />
        </div>
        <p className="rtc-note"><Cite id="scsd" compact /> <Cite id="term" compact /></p>
      </Section>

      <Section index="3.6" title="Money at stake" note={money ? "On the sized plant: the RE in MW, the storage in MWh" : "Size the plant to see these: they follow the installed capacity"}>
        <div className="rtc-grid rtc-grid-4" data-testid="fdrex-money">
          <Stat label="EMD" value={money ? cr(money.emdRs) : "–"} detail={<Cite id="emd" compact />} />
          <Stat label="PBG" value={money ? cr(money.pbgRs) : "–"} detail={<Cite id="pbg" compact />} />
          <Stat label="Net worth to show" value={money ? cr(money.netWorthRs) : "–"} detail={<Cite id="netWorth" compact />} />
          <Stat label="Success Charges with GST" value={money ? cr(money.successRs) : "–"} detail={<>in the project cost <Cite id="successCharges" compact /></>} />
        </div>
      </Section>
    </>
  );
}
