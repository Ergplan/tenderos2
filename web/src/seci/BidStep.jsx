import React from "react";
import { Section, Stat, nf } from "../rtc/ui";
import { PACK, PEAK_PLANS, PROFILES, SHORTFALL_MODES, keyDates, moneyAtStake, prov, solarHoursOf } from "./terms";
import { SourceChip } from "../bid/RequirementsStep";

const fmtDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "–");
const cr = (rs) => `₹${nf(rs / 1e7, 2)} cr`;

/** A choice between a few options, each with a line of explanation. */
export function Choice({ options, value, onChange, testid }) {
  return (
    <div className="seci-choice" role="radiogroup" data-testid={testid}>
      {Object.entries(options).map(([id, o]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? "active" : ""} onClick={() => onChange(id)} data-testid={`${testid}-${id}`}>
          <strong>{o.label}</strong>
          <small>{o.detail}</small>
        </button>
      ))}
    </div>
  );
}

/** Step 3: what the bidder offers: the contracted capacity, how the Peak Hours and a shortfall
 * are planned for, the dates from the PPA, and the guarantees on the sized plant. */
export default function BidStep({ state, setState, terms }) {
  const m = PACK.model;
  const seci = state.seci;
  const setSeci = (patch) => setState((s) => ({ ...s, seci: { ...s.seci, ...patch }, lp: null }));
  const mw = state.bid.baseMw;
  const bad = !(mw >= m.minBidMw && mw <= m.maxBidMw);
  const dates = keyDates(seci.ppaDate);
  const sized = state.lp?.sizes;
  const money = sized ? moneyAtStake(sized) : null;
  const amd3 = seci.profile !== "amd1";
  const sh = solarHoursOf(seci);
  const hh = (h) => `${String(h).padStart(2, "0")}:00`;
  const setHours = (k, v) => {
    const h = { ...sh, [k]: Math.max(0, Math.min(24, Math.round(Number(v)))) };
    if (Number.isFinite(h[k]) && h.start < h.end) setSeci({ solarHours: h });
  };
  return (
    <>
      <Section index="3" title="What you bid" note="One tariff for the contracted capacity, fixed for the term; bidders within L1 + 2% win">
        <div className="rtc-grid rtc-grid-3">
          <div className="bid-input-with-src" data-voice="bidMw">
            <label className="rtc-field">
              <div className="rtc-field-top"><span>Contracted capacity</span><em>MW</em></div>
              <input type="number" min={m.minBidMw} max={m.maxBidMw} step={10} value={mw ?? ""} data-testid="seci-bid-mw"
                onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); setState((s) => ({ ...s, bid: { ...s.bid, baseMw: v, greenshoe: false }, lp: null })); }} />
              <small className={bad ? "seci-flag" : ""}>{bad ? `Between ${m.minBidMw} and ${m.maxBidMw} MW` : `Of ${nf(PACK.tenderedMw, 0)} MW tendered`}</small>
            </label>
            <SourceChip source={prov("bidSize")} />
          </div>
          <Stat label="Supply to guarantee" value={mw ? `${nf(mw * m.peakFloor, 0)} MW peak` : "–"}
            detail={!mw ? "" : amd3 ? `${nf(mw * m.solarFloor, 0)}–${nf(mw * m.solarMax, 0)} MW in the Solar Hours, ${nf(mw * m.remainingFloor, 0)} MW in the Remaining Hours, in every 15-minute block` : `${nf(mw * m.offpeakFloor, 0)} MW off-peak, in every 15-minute block`} />
          <Stat label="Shortfall penalty" value={`${nf(m.penaltyMultiple, 1)} × tariff`} detail="on the energy short of each block's floor, monthly" />
        </div>
      </Section>

      <Section index="3.1" title="Supply profile" note="Amendment-03 (25.06.2026) splits the day into Peak, Solar and Remaining Hours">
        <div className="rtc-grid rtc-grid-2">
          <div data-voice="profile"><Choice options={PROFILES} value={amd3 ? "amd3" : "amd1"} onChange={(v) => setSeci({ profile: v })} testid="seci-profile" /></div>
          <div>
            {amd3 && (
              <div className="rtc-grid rtc-grid-2" data-voice="solarHours">
                <label className="rtc-field">
                  <div className="rtc-field-top"><span>Solar Hours from</span><em>hour</em></div>
                  <input type="number" min={0} max={23} step={1} value={sh.start} data-testid="seci-solar-start" onChange={(e) => setHours("start", e.target.value)} />
                </label>
                <label className="rtc-field">
                  <div className="rtc-field-top"><span>to</span><em>hour</em></div>
                  <input type="number" min={1} max={24} step={1} value={sh.end} data-testid="seci-solar-end" onChange={(e) => setHours("end", e.target.value)} />
                </label>
              </div>
            )}
            <p className="rtc-note">
              {amd3
                ? <>In the Solar Hours ({hh(sh.start)}–{hh(sh.end)}) the buyer takes at least {nf(m.solarFloor * 100, 0)}% and at most {nf(m.solarMax * 100, 0)}% of the contract. Power above that goes first to the buyer, day-ahead, at {nf(m.solarExcessTariffShare * 100, 0)}% of the tariff; the model sells it to whichever pays more (the buyer when the market price is above half the tariff), and only when market sales are on. GRID-INDIA notifies the Solar Hours by State: set the project State's. An hour the buyer picks as a Peak Hour is held to 90%. </>
                : <>The terms before Amendment-03: 90% in the Peak Hours, 70% in every other block. Use it to see what the amendment changed. </>}
              <SourceChip source={prov("dfrSolar")} /> <SourceChip source={prov("solarHours")} /> <SourceChip source={prov("excess", "Solar Hours excess")} />
            </p>
          </div>
        </div>
      </Section>

      <Section index="3.2" title="Peak Hours" note="The Buying Entity picks 6 hours a day, day-ahead, between 18:00 and 10:00">
        <div className="rtc-grid rtc-grid-2">
          <div data-voice="peakPlan"><Choice options={PEAK_PLANS} value={seci.peakPlan} onChange={(v) => setSeci({ peakPlan: v })} testid="seci-peak" /></div>
          <p className="rtc-note">You learn the six hours only the day before, so a plant that must never miss a peak block holds 90% in all sixteen hours of the window. Planning on the evening only is cheaper but is short whenever the morning is picked. <SourceChip source={prov("peakHours")} /></p>
        </div>
      </Section>

      <Section index="3.3" title="Shortfall" note="Whether the plant may fall below a block's floor and pay for it">
        <div className="rtc-grid rtc-grid-2">
          <div data-voice="shortfall"><Choice options={SHORTFALL_MODES} value={seci.shortfall} onChange={(v) => setSeci({ shortfall: v })} testid="seci-shortfall" /></div>
          <p className="rtc-note">With the penalty, HiGHS weighs each missing MWh at {nf(m.penaltyMultiple, 1)} × the tariff against the plant that would cover it. Note: failing the floors for two consecutive Contract Years is an Event of Default. <SourceChip source={prov("default")} /></p>
        </div>
      </Section>

      <Section index="3.4" title="Dates" note="From the PPA's Effective Date (Amendment-02: SCSD 24 months after it)">
        <div className="rtc-grid rtc-grid-4">
          <label className="rtc-field" data-voice="ppaDate">
            <div className="rtc-field-top"><span>PPA Effective Date</span></div>
            <input type="date" value={seci.ppaDate || ""} data-testid="seci-ppa-date" onChange={(e) => setState((s) => ({ ...s, seci: { ...s.seci, ppaDate: e.target.value || null } }))} />
            <small>Expected signing; change it as you learn more</small>
          </label>
          <Stat label="Financial Closure" value={dates ? fmtDate(dates.financialClosure) : "–"} detail="6 months before the SCSD" />
          <Stat label="Supply starts (SCSD)" value={dates ? fmtDate(dates.scsd) : "–"} detail="24 months after the PPA" />
          <Stat label="Latest start, with penalty" value={dates ? fmtDate(dates.latestStart) : "–"} detail="PBG encashed pro rata" />
        </div>
      </Section>

      <Section index="3.5" title="Money at stake" note="On the installed solar MW, wind MW and storage MWh, not the contracted MW">
        {money ? (
          <div className="rtc-grid rtc-grid-3" data-testid="seci-money">
            <Stat label="EMD" value={cr(money.emdRs)} detail={`₹9.68 lakh × ${nf(money.S, 0)} MW solar + ₹13.68 lakh × ${nf(money.W, 0)} MW wind + ₹2.40 lakh × ${nf(money.E, 0)} MWh`} />
            <Stat label="Performance Bank Guarantee" value={cr(money.pbgRs)} detail="₹24.20 lakh/MW solar, ₹34.20 lakh/MW wind, ₹6.00 lakh/MWh storage" />
            <Stat label="Minimum net worth" value={cr(money.netWorthRs)} detail="₹96.8 lakh/MW solar, ₹1.368 cr/MW wind, ₹24 lakh/MWh storage" />
          </div>
        ) : (
          <p className="rtc-note">Size the plant (step 5): EMD, PBG and the net worth needed follow from the installed solar, wind and storage.</p>
        )}
        <p className="rtc-note">PPA term: {terms.provenance.years.display}. <SourceChip source={prov("emd")} /> <SourceChip source={prov("pbg")} /> <SourceChip source={prov("networth")} /></p>
      </Section>
    </>
  );
}
