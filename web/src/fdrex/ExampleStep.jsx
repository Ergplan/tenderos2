// SECI-FDRE-X: the worked example of step 01 (forked from web/src/cfd/ExampleStep.jsx). One bid
// size walked through the tender: what is signed, what is built, the money put up, three real IEX
// evenings (the four hours a buyer would choose, their exchange price, and what the PPA pays), a
// billing month with days missed, and a year of evenings against the tariff. The arithmetic is
// ./example.js; the test ids are the CfD tab's.
import React, { useMemo } from "react";
import { ArrowRight, CircleCheck } from "lucide-react";
import { Field, Section, Stat, nf, pf } from "../rtc/ui";
import { LiveChart } from "../rtc/charts";
import { Cites } from "./Cite.jsx";
import { TENDER } from "./tender.js";
import { fmtDate } from "./model.js";
import { EXAMPLE_DEFAULTS, exampleMw, workedExample } from "./example.js";

// the tariff against the exchange price of the buyer's four hours (validated against the dark chart surface)
const TARIFF_ABOVE = "#9473f0"; // the exchange was cheaper than the tariff that evening
const TARIFF_BELOW = "#c08420"; // the exchange was dearer than the tariff

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const lakh = (v) => `₹${nf(Math.abs(v), 2)} lakh`;
const cr = (v) => `₹${nf(Math.abs(v), 2)} cr`;
const hour = (h) => `${String(h).padStart(2, "0")}:00–${String(h + 1).padStart(2, "0")}:00`;
const weekday = (t) => new Date(t).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
const BID_CHIPS = [50, 100, 150, 300, 600];

/** One evening as bars: what the four hours cost on the exchange, what the PPA pays you for them, and the difference. */
function Evening({ title, e, sp, scale }) {
  const w = (v) => `${(Math.abs(v) / scale) * 100}%`;
  const above = e.gapLakh >= 0;
  return (
    <div className="cfd-evening" data-testid="cfd-evening">
      <div className="cfd-evening-head"><span>{title}</span><strong>{fmtDate(e.date)}</strong></div>
      <p className="cfd-evening-hours">The buyer takes {nf(e.mwhPerHour)} MWh in each of its {e.hours.length} dearest evening hours: {e.hours.map((h, i) => `${hour(h)} at ₹${nf(e.prices[i], 2)}/kWh`).join(", ")}.</p>
      <div className="cfd-settle">
        <span>On the exchange</span>
        <div className="cfd-settle-bar"><i className="ex" style={{ width: w(e.exchangeLakh) }} /></div>
        <b>{lakh(e.exchangeLakh)}</b>
        <span>{above ? "Tariff above it by" : "Tariff below it by"}</span>
        <div className="cfd-settle-bar"><i style={{ marginLeft: above ? w(e.exchangeLakh) : w(e.youLakh), width: w(e.gapLakh), background: above ? TARIFF_ABOVE : TARIFF_BELOW }} /></div>
        <b>{lakh(e.gapLakh)}</b>
        <span>SECI pays you</span>
        <div className="cfd-settle-bar"><i className="you" style={{ width: w(e.youLakh) }} /></div>
        <b>{lakh(e.youLakh)}</b>
      </div>
      <small>= ₹{nf(sp, 2)}/kWh × {nf(e.energyMwh)} MWh, whatever the exchange price. {above && e.gapLakh > 0 ? "That evening the same hours were cheaper on the exchange than at your tariff." : e.gapLakh < 0 ? "That evening the same hours cost more on the exchange than at your tariff." : "That evening the exchange price was exactly your tariff."}</small>
    </div>
  );
}

/** The year's evenings against the tariff: the exchange price of the buyer's four hours each day (one bar per evening). */
function YearChart({ year, sp, hours }) {
  const option = useMemo(() => ({
    animation: false,
    grid: { left: 52, right: 56, top: 24, bottom: 36 },
    tooltip: {
      trigger: "axis",
      formatter: (items) => {
        const s = year.series[items[0].dataIndex];
        const gap = s.gapLakh >= 0 ? `the tariff is ₹${nf(s.gapLakh, 2)} lakh above the exchange on the day's energy` : `the tariff is ₹${nf(-s.gapLakh, 2)} lakh below the exchange on the day's energy`;
        return `${fmtDate(s.date)}<br/>The ${hours} dearest evening hours: ₹${nf(s.avg, 2)}/kWh<br/>Your tariff: ₹${nf(sp, 2)}/kWh<br/>${gap}`;
      },
    },
    xAxis: { type: "category", data: year.series.map((s) => new Date(s.date).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" })), axisLabel: { interval: (i) => new Date(year.series[i].date).getUTCDate() === 1 }, axisTick: { show: false } },
    yAxis: { type: "value", name: "₹/kWh", min: 0, max: Math.ceil(Math.max(sp, year.maxPrice) + 1), splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } } },
    series: [
      { name: `The ${hours} dearest evening hours`, type: "bar", barCategoryGap: "20%", large: false,
        data: year.series.map((s) => ({ value: Number(s.avg.toFixed(3)), itemStyle: { color: s.avg < sp ? TARIFF_ABOVE : TARIFF_BELOW } })) },
      { name: "Your tariff", type: "line", data: year.series.map(() => sp), symbol: "none", silent: true, lineStyle: { color: "#d4ff3f", type: "dashed", width: 1.5 }, itemStyle: { color: "#d4ff3f" },
        endLabel: { show: true, formatter: `₹${nf(sp, 2)}`, color: "#d4ff3f" } },
    ],
  }), [year, sp, hours]);
  return (
    <div className="rtc-card" data-testid="cfd-example-year">
      <div className="cfd-legend">
        <span><i className="box" style={{ background: TARIFF_ABOVE }} /> Exchange price below your tariff: the same hours were cheaper on the exchange</span>
        <span><i className="box" style={{ background: TARIFF_BELOW }} /> Above it: your tariff was the cheaper power</span>
        <span><i className="dashed" /> Your tariff</span>
      </div>
      <LiveChart option={option} height={300} />
    </div>
  );
}

/** The tender worked through for one bid size, with real IEX evenings (part of the What FDRE-X asks step). */
export default function ExampleStep({ state, prices, model, setExample, goto }) {
  const ex = state.example || {};
  const i = state.inputs;
  const mw = exampleMw(state);
  const sp = isNum(ex.sp) ? ex.sp : model?.bid ?? EXAMPLE_DEFAULTS.sp;
  const spSource = isNum(ex.sp) ? "your example" : model?.bid ? "your bid from the Financial model step" : "an example; yours is solved on the Financial model step";
  const market = i.sellMarket || "DAM";
  const rte = isNum(i.rte) ? i.rte : EXAMPLE_DEFAULTS.rte;
  const solarCuf = isNum(i.solarCuf) ? i.solarCuf : EXAMPLE_DEFAULTS.solarCuf;
  const assumed = !isNum(i.rte) || !isNum(i.solarCuf);
  const dayInjection = i.dayInjection === true; // the bid says it holds connectivity in the solar hours too
  const x = useMemo(() => (prices ? workedExample({ mw, sp, prices, market, rte, solarCuf }) : null), [mw, sp, prices, market, rte, solarCuf]);
  const H = TENDER.peakHours;

  const controls = (
    <div className="cfd-example-controls" data-testid="cfd-example-controls">
      <div className="cfd-chips" role="group" aria-label="Bid size">
        {BID_CHIPS.map((v) => <button key={v} type="button" className={mw === v ? "active" : ""} onClick={() => setExample({ mw: v })} data-testid={`cfd-example-mw-${v}`}>{v} MW</button>)}
      </div>
      <div data-testid="cfd-example-mw"><Field label="Bid size" unit="MW" value={mw} step={1} min={TENDER.bidMinMw} max={TENDER.bidMaxMw} onChange={(v) => setExample({ mw: Math.round(v) })} hint={`${TENDER.bidMinMw} to ${TENDER.bidMaxMw} MW (RfS 5.1)`} /></div>
      <div data-testid="cfd-example-sp"><Field label="Tariff" unit="₹/kWh" value={sp} step={0.01} min={0} max={20} onChange={(v) => setExample({ sp: v })} hint={spSource} /></div>
      {(isNum(ex.mw) || isNum(ex.sp)) && <button type="button" className="secondary" onClick={() => setExample({ mw: null, sp: null })}>Use my bid</button>}
    </div>
  );

  if (!x) return <><Section index="3" title="Worked example" note="Loading IEX prices">{controls}</Section></>;
  const c = x.commit;
  const g = x.charging;
  const m = x.money;
  const b = x.month;
  const y = x.year;
  const scale = Math.max(...["low", "middle", "high"].map((k) => Math.max(x.evenings[k].exchangeLakh, x.evenings[k].youLakh)));

  return (
    <>
      <Section index="3" title={`Worked example: a ${nf(mw)} MW bid`} note={`Step by step, on real IEX ${market} evenings · this does not change your inputs`}>
        {controls}
        <div className="cfd-answer" data-testid="cfd-answer">
          <div className="cfd-answer-head"><CircleCheck size={18} /><div><span>Do you need a solar or wind plant already?</span><strong>No. You build the Project after you win. You do need a connectivity application.</strong></div></div>
          <ul>
            <li>You bid as a company, on financial strength: a net worth and one liquidity test sized to the plant you propose. No operating plants or experience are asked for. <Cites ids={["company", "netWorth", "turnover"]} /></li>
            <li>You must already have applied for ISTS connectivity with non-solar-hour access at the Delivery Point you name, for at least the {nf(mw)} MW you offer, and enclose the proof with the Covering Letter. That connection carries power only in the non-solar hours: solar beyond what charges the battery earns nothing unless you hold solar-hour connectivity as well, or SECI buys the excess at the tariff. <Cites ids={["connectivityApplied", "connectivityQuantum", "excess"]} /></li>
            <li>After the award you build RE generation with storage, co-located, and supply from the whole Project by the SCSD, {TENDER.essScdMonths} months from the Effective Date. The model takes a battery of {nf(c.batteryMw)} MW / {nf(c.batteryMwh)} MWh: the RfS states no minimum size, but the battery must carry the {H} hours the buyer names. <Cites ids={["newProject", "scsd", "colocated", "ess"]} /></li>
            <li>All the energy must be RE. Your own RE charges the storage in the day; up to {pf(g.boughtShare, 0)} of the year's energy ({nf(g.boughtMwhYear)} MWh for {nf(mw)} MW) may be bought from the green market or under a bilateral agreement. On energy alone that is about <strong>{nf(g.solarAlone, 0)} MWac</strong> of solar, or <strong>{nf(g.solarWithMarket, 0)} MWac</strong> with the {pf(g.boughtShare, 0)} bought. <Cites ids={["allRe", "marketShare", "discharged"]} /></li>
            <li>Its type and size are yours: solar, wind or both, smaller or larger than {nf(mw)} MW, and you may change it until the SCSD. The storage may be your own or tied up with a third party. <Cites ids={["reSize", "configChange", "essThirdParty"]} /></li>
            <li>Already own a plant with untied capacity? It may bid too, and may start supply early; the {TENDER.termYears} years still run from the SCSD. <Cites ids={["existingAllowed", "existingProjects"]} /></li>
          </ul>
        </div>
      </Section>

      <Section index="3.1" title="What you sign up for" note={`${nf(mw)} MW is ${pf(c.share, 0)} of the tender's ${nf(TENDER.totalMw)} MW`}>
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-example-commit">
          <Stat label="Every day" value={`${nf(c.dailyMwh)} MWh`} detail={`${nf(c.hourlyMwh)} MWh in each of the ${H} hours the Buying Entity names by 06:00`} />
          <Stat label="Every billing month" value={`${nf(c.monthlyMwh)} MWh`} detail={`in a 30-day month; at least ${nf(c.monthlyMinMwh)} MWh (${pf(1 - TENDER.shortfallTolerance, 0)}) or a penalty`} />
          <Stat label="Every year" value={`${nf(c.yearlyMwh / 1000, 1)} GWh`} detail={`for ${TENDER.termYears} years from the SCSD, at one fixed tariff`} />
          <Stat label="Battery, in the model" value={`${nf(c.batteryMw)} MW / ${nf(c.batteryMwh)} MWh`} detail={`to carry the ${H} hours; the RfS states no minimum`} />
        </div>
        <p className="rtc-note"><Cites ids={["mandate", "hourCap", "scheduleBy6", "tolerance", "term", "tariffFixed", "ess"]} /></p>
      </Section>

      <Section index="3.2" title="What you build, and how the battery is charged" note="Months from the Effective Date of the PPA (the 15th day after SECI's invitation to sign)">
        <div className="cfd-phases" data-testid="cfd-phases">
          <div><span>Months 0–{TENDER.essScdMonths} · build</span><strong>RE generation, a battery of {nf(c.batteryMw)} MW / {nf(c.batteryMwh)} MWh and the line to an ISTS substation</strong><small>No supply yet. Financial closure {TENDER.finCloseMonthsBeforeScd} months before month {TENDER.essScdMonths}. A delay of up to {TENDER.delayMonthsMax} months costs the PBG, pro rata.</small></div>
          <div><span>From month {TENDER.essScdMonths} · every day</span><strong>Charge from your own RE in the day, supply {nf(c.dailyMwh)} MWh in the buyer's {H} hours</strong><small>About {nf(g.perDayMwh, 0)} MWh a day goes into the battery (at {pf(rte, 0)} round-trip efficiency). About {nf(g.solarAlone, 0)} MWac of solar gives that over a year (at {pf(solarCuf, 0)} CUF). Charging from the grid is not allowed.</small></div>
          <div><span>All term · bought power</span><strong>Up to {pf(g.boughtShare, 0)} of the year's energy from the green market or a bilateral agreement</strong><small>{nf(g.boughtMwhYear)} MWh a year for {nf(mw)} MW, supplied directly in the Peak Hours or through the battery, counted on the energy discharged. Energy above the limit is not paid for.</small></div>
        </div>
        <p className="rtc-note">{assumed ? `Solar is sized on energy alone with an example ${pf(rte, 0)} battery efficiency and ${pf(solarCuf, 0)} solar CUF (your own figures on Design replace them). ` : "Solar is sized on energy alone with your efficiency and CUF. "}Optimise own RE on the Size step finds the size that meets every day, not just the year; it is larger, and on most days it then makes more than the battery takes. {dayInjection ? "Your bid says you hold connectivity in the solar hours too, so the model sells that surplus at exchange prices." : "With connectivity for the non-solar hours only, which is what the tender asks for and what your bid assumes, that surplus is not injected in the day and earns nothing; the tariff has to carry the whole plant."} <Cites ids={["scsd", "finClose", "delay", "marketShare", "marketUse", "overCap", "gridCharging", "connectivityApplied"]} /></p>
      </Section>

      <Section index="3.3" title="Money you put up before you earn" note={`For ${nf(mw)} MW with ${nf(c.batteryMwh)} MWh of battery and ${nf(g.plantSolar)} MWac of solar`}>
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-example-money">
          <Stat label="EMD with the bid" value={cr(m.emdCr)} detail="bank guarantee, returned once the PBG is in" />
          <Stat label="PBG before the PPA" value={cr(m.pbgCr)} detail={`bank guarantee, until ${TENDER.pbgAfterScdMonths} months after the SCSD`} />
          <Stat label="SECI's charges" value={cr(m.cacCr + m.bidFeeCr + m.rfsCostCr)} detail="Success Charges, bid processing fee, cost of the RfS; + GST" />
          <Stat label="Net worth to show" value={cr(m.netWorthCr)} detail="for this plant, with one of three liquidity tests" />
        </div>
        <p className="rtc-note">No Letter of Credit is asked of you: SECI opens one in your favour. If you opt for cover under SECI's Payment Security Mechanism, you give a discount of ₹{nf(TENDER.psmChargeRsPerKwh, 2)}/kWh on every bill for the whole term: {cr(y.psmCr)} a year on {nf(mw)} MW. <Cites ids={["emd", "pbg", "pbgValidity", "successCharges", "bidFee", "rfsCost", "netWorth", "lc", "psm", "psmOptIn"]} /></p>
      </Section>

      <Section index="3.4" title="Three real evenings, billed" note={`At a tariff of ₹${nf(sp, 2)}/kWh, against IEX ${market} prices in the ${H} dearest evening hours`}>
        <div className="cfd-evenings">
          <Evening title="The cheapest evening of the year" e={x.evenings.low} sp={sp} scale={scale} />
          <Evening title="A middle evening" e={x.evenings.middle} sp={sp} scale={scale} />
          <Evening title="The dearest evening of the year" e={x.evenings.high} sp={sp} scale={scale} />
        </div>
        <p className="rtc-note">You are paid your tariff on every kWh you supply in the Peak Hours; the exchange price does not change your bill. It is the buyer's alternative: the Buying Entity pays SECI your tariff plus a trading margin of ₹{nf(TENDER.tradingMarginRsPerKwh, 2)}/kWh. The buyer may choose any {H} of the non-solar hours, evening to the next morning; the model takes the {H} dearest evening hours. Prices are hourly averages of the 15-minute prices. <Cites ids={["tariff", "tariffFixed", "monthlyBill", "tradingMargin", "fourHours"]} /></p>
      </Section>

      <Section index="3.5" title="A month with missed days" note={`Billing month ${fmtDate(b.start)} – ${fmtDate(b.end)}, read as the calendar month`}>
        <div className="cfd-week" data-testid="cfd-example-week">
          <p>Say the battery is out for {nf(b.outageDays)} days from <strong>{weekday(b.outageFrom)} {fmtDate(b.outageFrom)}</strong> and you supply nothing on those evenings.</p>
          <div className="cfd-week-rows">
            <span>Required this month ({nf(b.days)} days × {nf(c.dailyMwh)} MWh)</span><b>{nf(b.requiredMwh)} MWh</b>
            <span>Supplied</span><b>{nf(b.suppliedMwh)} MWh</b>
            <span>Short</span><b>{nf(b.shortMwh)} MWh ({pf(b.shortPct, 1)})</b>
            <span>Free tolerance ({pf(TENDER.shortfallTolerance, 0)} of the month: {nf(b.freeDays, 1)} days of supply)</span><b>{nf(b.freeMwh)} MWh</b>
            <span>Penalised</span><b>{nf(b.penalisedMwh)} MWh</b>
            <span>Penalty = {nf(TENDER.penaltyMultiple, 1)} × ₹{nf(sp, 2)} × {nf(b.penalisedMwh)} MWh</span><b>{b.penaltyLakh > 0 ? lakh(b.penaltyLakh) : "nil (within the tolerance)"}</b>
            <span>Plus the tariff not earned on the {nf(b.shortMwh)} MWh not supplied</span><b>{lakh(b.lostLakh)} lost</b>
          </div>
          <p className="rtc-note">One missed evening ({nf(c.dailyMwh)} MWh, {pf(b.oneDayPct, 1)} of the month) stays within the {pf(TENDER.shortfallTolerance, 0)} tolerance: no penalty, only that day's revenue is lost. The PPA's own example: 3 MU required, 2 MU supplied, at ₹2.70/kWh, costs (0.90 × 3 − 2) × 2.7 × 1.5 = ₹28.35 lakh. The penalty does not depend on the exchange price. <Cites ids={["shortfall", "tolerance", "shortfallBeyond", "shortfallExample", "billingMonth"]} /></p>
        </div>
      </Section>

      <Section index="3.6" title="A year of evenings against your tariff" note={`IEX ${market}, ${fmtDate(Date.parse(`${y.from}T00:00:00Z`))} – ${fmtDate(Date.parse(`${y.to}T00:00:00Z`))}; every evening supplied in full`}>
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-example-yearstats">
          <Stat label="Energy supplied" value={`${nf(y.energyMwh / 1000, 1)} GWh`} detail={`the ${H} dearest evening hours average ₹${nf(y.avgPrice, 2)}/kWh on the exchange`} />
          <Stat label="You receive" value={cr(y.youCr)} detail={`₹${nf(sp, 2)}/kWh × ${nf(y.energyMwh / 1000, 1)} GWh`} />
          <Stat label="The same energy on the exchange" value={cr(y.exchangeCr)} detail="exchange price × energy, in the hours supplied" />
          <Stat label={y.gapCr >= 0 ? "Your tariff above the exchange by" : "Your tariff below the exchange by"} value={cr(y.gapCr)} detail={`the exchange was cheaper on ${y.daysExchangeCheaper} evenings, your tariff on ${y.daysPpaCheaper}`} />
        </div>
        <YearChart year={y} sp={sp} hours={H} />
        <p className="rtc-note">The highest evening price in these 12 months was ₹{nf(y.maxPrice, 2)}/kWh. None of this changes what SECI pays you. It matters for the award: the Buying Entities are not yet named, SECI signs the PPA only after a buyer has signed the PSA, and it may annul the process if it finds no buyers at the discovered tariffs. <Cites ids={["buyingEntities", "psaFirst", "noBuyers"]} /></p>
      </Section>

      <Section index="3.7" title="Your bid" note="The tariff that covers your costs and return">
        <div className="cfd-bidline" data-testid="cfd-example-bid">
          <p>Your revenue is the tariff times the energy you supply in the Peak Hours, fixed for {TENDER.termYears} years; the exchange price does not change it. So the tariff must pay for the battery, your own RE, the bought power, O&amp;M, the guarantees and the penalties, and earn your return. {dayInjection ? "Your bid also counts on selling the day's surplus RE, which needs connectivity in the solar hours." : "It carries the surplus solar too, which a connection for the non-solar hours cannot sell in the day: a bidder with solar-hour connectivity can quote lower."} In the e-Reverse Auction you then need to be within {pf(TENDER.eraRange, 0)} of the lowest tariff to win. <Cites ids={["tariffFixed", "range", "decrement"]} /></p>
          <div className="cfd-bidline-actions">
            <button type="button" className="secondary" onClick={() => goto("design")}>Your design <ArrowRight size={14} /></button>
            <button type="button" className="primary" onClick={() => goto("finance")}>Solve your tariff <ArrowRight size={14} /></button>
          </div>
        </div>
      </Section>
    </>
  );
}
