// SECI-FDRE-X, the tender as a picture (part of step 01; forked from web/src/cfd/VisualModel.jsx):
// who supplies what to whom and who pays whom under the PPA, the dates from the Effective Date, a
// day of supply (charging from own RE, discharge in the buyer's four hours), the winning bidder's
// obligations in order, and the money in one line. There is no exchange sale of the peak supply
// and no Pool here: the storage delivers to the Buying Entity and SECI pays the tariff.
import React, { useMemo } from "react";
import { Section, nf, pf } from "../rtc/ui";
import { LiveChart } from "../rtc/charts";
import Cite, { Cites } from "./Cite.jsx";
import { TENDER } from "./tender.js";
import { fmtDate, keyDates } from "./model.js";

const H = TENDER.peakHours;
const E = TENDER.mwhPerMwDay;

/** A box of the flow diagram: a title and up to six lines. */
function Node({ x, y, w, h, tone, title, lines }) {
  return (
    <g className={`cfd-node ${tone}`}>
      <rect x={x} y={y} width={w} height={h} rx="6" />
      <rect className="cfd-node-accent" x={x} y={y} width="5" height={h} rx="2" />
      <text x={x + 18} y={y + 26} className="cfd-node-title">{title}</text>
      {lines.map((l, i) => <text key={i} x={x + 18} y={y + 48 + i * 19} className="cfd-node-line">{l}</text>)}
    </g>
  );
}

function Arrow({ d, label, lx, ly, dashed = false, tone = "" }) {
  return (
    <g className={`cfd-arrow ${tone} ${dashed ? "dashed" : ""}`}>
      <path d={d} markerEnd="url(#cfd-head)" />
      {label && <text x={lx} y={ly} className="cfd-arrow-label">{label}</text>}
    </g>
  );
}

/**
 * Energy and money in SECI-FDRE-X: who supplies what, to whom, and who pays whom. `dayInjection`
 * is the bid's choice: true when it holds connectivity in the solar hours too, so that the day's
 * surplus RE can be sold; false (the tender's non-solar-hour access only) and it is curtailed.
 */
export function FlowDiagram({ mw, dayInjection = false }) {
  const X = mw || 100;
  const sale = dayInjection
    ? ["storage and surplus RE, to third", "parties or on an exchange,", "only after the day's PPA supply;", "excess energy: SECI first"]
    : ["the storage, to third parties or on", "an exchange, after the PPA supply;", "surplus solar in the day: curtailed", "(connection: non-solar hours only)"];
  return (
    <svg className="cfd-svg" viewBox="0 0 1150 580" role="img" aria-label="How the SECI-FDRE-X tender works: energy and money flows" data-testid="cfd-flow">
      <defs>
        <marker id="cfd-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="cfd-head" />
        </marker>
      </defs>
      <Node x={420} y={16} w={280} h={88} tone="bid" title="You bid one tariff" lines={[`₹/kWh for ${TENDER.bidMinMw}–${TENDER.bidMaxMw} MW, two decimals`, `e-RA; fixed for the ${TENDER.termYears}-year PPA`]} />
      <Node x={20} y={116} w={300} h={124} tone="re" title="Your RE plant: solar / wind" lines={["co-located with the storage", "any size against the contracted MW", `supplying by ED + ${TENDER.essScdMonths} months (SCSD)`, dayInjection ? "connection: non-solar and solar hours" : "connection: non-solar hours only"]} />
      <Node x={20} y={256} w={300} h={104} tone="market" title="Green market / bilateral" lines={[`up to ${pf(TENDER.marketShare, 0)} of a year's energy`, "directly in the Peak Hours or", "through the storage"]} />
      <Node x={20} y={396} w={300} h={132} tone="group" title="Sale outside the Peak Hours" lines={sale} />
      <Node x={420} y={196} w={280} h={142} tone="ess" title="Storage (mandatory)" lines={[`${nf(X)} MW / ${nf(TENDER.essHoursMin * X)} MWh for ${nf(X)} MW bid`, "the model's size: the RfS sets none", "own or tied up with a third party", "no charging from the grid"]} />
      <Node x={800} y={124} w={300} h={190} tone="px" title="Buying Entity, through SECI" lines={[`names ${H} hours by 06:00 every day`, "from the non-solar hours,", "evening to the next morning", `${E} MWh per MW: ${nf(E * X)} MWh a day`, `${nf(X)} MWh in each hour named`, "must take it; not yet named"]} />
      <Node x={800} y={372} w={300} h={180} tone="pool" title="SECI: buys from you, sells on" lines={["pays you tariff × energy, monthly", "Letter of Credit in your favour", `buyer pays it tariff + ₹${nf(TENDER.tradingMarginRsPerKwh, 2)}/kWh`, `a month short by more than ${pf(TENDER.shortfallTolerance, 0)}:`, `you pay ${nf(TENDER.penaltyMultiple, 1)} × the tariff`]} />
      <Node x={420} y={420} w={280} h={140} tone="you" title="You receive the tariff" lines={["for the energy supplied in the", `Peak Hours, fixed for ${TENDER.termYears} years`, `less ₹${nf(TENDER.psmChargeRsPerKwh, 2)}/kWh with PSM cover`, "plus sales outside the Peak Hours", "less bought power, O&M, penalties"]} />
      <Arrow d="M 320 190 C 370 190 380 244 418 256" label="charge in the day" lx={336} ly={180} tone="re" />
      <Arrow d="M 320 308 C 360 308 380 300 418 296" label={`≤ ${pf(TENDER.marketShare, 0)} a year`} lx={330} ly={290} tone="market" />
      <Arrow d="M 320 160 C 520 110 650 120 798 170" label="wind in the buyer's hours; bought RE direct" lx={430} ly={124} dashed tone="re" />
      <Arrow d="M 700 268 C 740 268 760 250 798 242" label={`${H} h discharge`} lx={706} ly={292} tone="ess" />
      <Arrow d="M 950 314 V 370" label={`tariff + ₹${nf(TENDER.tradingMarginRsPerKwh, 2)}/kWh`} lx={960} ly={348} tone="px" />
      <Arrow d="M 798 474 C 760 474 740 486 702 490" label="tariff × kWh" lx={706} ly={464} tone="pool" />
      <Arrow d="M 420 320 C 380 330 372 420 322 440" label={dayInjection ? "storage and surplus RE" : "storage, outside the Peak Hours"} lx={392} ly={392} dashed tone="group" />
      <Arrow d="M 320 478 H 418" label="market price" lx={328} ly={468} tone="group" />
      <Arrow d="M 700 60 H 1132 V 440 H 1104" label="the tariff sets every bill" lx={860} ly={52} dashed tone="bid" />
    </svg>
  );
}

const MONTH_X = (m) => 40 + (Math.min(m, 40) / 40) * 760;

/** The tender's dates from the Effective Date: construction, financial closure, the SCSD, the delay allowed, the 25-year term. */
export function Timeline({ effectiveDate }) {
  const d = effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) ? keyDates(effectiveDate) : null;
  const at = (k) => (d ? fmtDate(d[k]) : "");
  const scsd = TENDER.essScdMonths;
  const marks = [
    { m: 0, up: true, title: "Effective Date", sub: `${TENDER.loaToEdDays} days after SECI's invitation to sign`, date: at("ed") },
    { m: scsd - TENDER.finCloseMonthsBeforeScd, up: false, end: true, title: "Financial closure", sub: `${TENDER.finCloseMonthsBeforeScd} months before the SCSD`, date: at("finClose") },
    { m: scsd, up: true, title: "SCSD: the whole Project supplies", sub: `the ${TENDER.termYears}-year term starts`, date: at("scd") },
    { m: scsd + TENDER.delayMonthsMax, up: false, title: "Latest with penalty", sub: "PBG encashed pro rata; later: capacity cut", date: at("lastWithPenalty") },
  ];
  return (
    <svg className="cfd-svg cfd-timeline" viewBox="0 0 1120 190" role="img" aria-label="Tender timeline" data-testid="cfd-timeline">
      <rect x={MONTH_X(0)} y="86" width={MONTH_X(scsd) - MONTH_X(0)} height="16" className="cfd-band build" />
      <rect x={MONTH_X(scsd)} y="86" width={1080 - MONTH_X(scsd)} height="16" className="cfd-band term" />
      <text x={MONTH_X(scsd / 2)} y="98" className="cfd-band-label" textAnchor="middle">construction</text>
      <text x={(MONTH_X(scsd + TENDER.delayMonthsMax) + 832) / 2} y="98" className="cfd-band-label" textAnchor="middle">{`${E} MWh per MW every day`}</text>
      <text x={950} y="98" className="cfd-band-label" textAnchor="middle">one fixed tariff</text>
      <line x1="40" y1="94" x2="1080" y2="94" className="cfd-axis" />
      <path d="M 832 80 l 8 28 M 846 80 l 8 28" className="cfd-break" />
      {marks.map((k) => (
        <g key={k.m} className="cfd-mark">
          <line x1={MONTH_X(k.m)} x2={MONTH_X(k.m)} y1={k.up ? 50 : 102} y2={k.up ? 86 : 138} />
          <circle cx={MONTH_X(k.m)} cy="94" r="5" />
          <text x={MONTH_X(k.m) + (k.end ? -6 : 6)} y={k.up ? 22 : 152} className="cfd-mark-title" textAnchor={k.end ? "end" : "start"}>{k.title} · month {k.m}</text>
          <text x={MONTH_X(k.m) + (k.end ? -6 : 6)} y={k.up ? 38 : 168} className="cfd-mark-sub" textAnchor={k.end ? "end" : "start"}>{k.sub}{k.date ? ` · ${k.date}` : ""}</text>
        </g>
      ))}
      <g className="cfd-mark end">
        <line x1="1060" x2="1060" y1="50" y2="86" />
        <circle cx="1060" cy="94" r="5" />
        <text x="1076" y="22" className="cfd-mark-title" textAnchor="end">Term ends</text>
        <text x="1076" y="38" className="cfd-mark-sub" textAnchor="end">SCSD + {TENDER.termYears} years{d ? ` · ${at("end")}` : ""}</text>
      </g>
    </svg>
  );
}

const clock = (h) => `${String(h).padStart(2, "0")}:00`;

/**
 * A day of the obligation (illustrative): the exchange's average prices by hour, the four dearest
 * evening hours (the hours the model takes the buyer to choose), charging from own RE in the day
 * and the discharge of 1 MWh per MW in each of the four hours.
 */
export function TypicalDay({ prices, mw, market = "DAM" }) {
  const mean = useMemo(() => prices?.markets?.[market]?.hourOfDayMeanRsPerMwh?.map((v) => v / 1000) || null, [prices, market]);
  const best = useMemo(() => {
    const peak = Array.from({ length: TENDER.peakEnd - TENDER.peakStart }, (_, i) => TENDER.peakStart + i);
    return mean ? [...peak].sort((a, b) => mean[b] - mean[a]).slice(0, H).sort((a, b) => a - b) : null;
  }, [mean]);
  const option = useMemo(() => {
    const X = mw || 100;
    const rte = 0.87; // an example round-trip efficiency, for the picture only
    const need = (E * X) / rte;
    const sun = Array.from({ length: 24 }, (_, h) => Math.max(0, Math.sin((Math.PI * (h - 6)) / 12)));
    const sunTotal = sun.reduce((a, v) => a + v, 0);
    const charge = sun.map((v) => -(need * v) / sunTotal);
    const hours = best || Array.from({ length: H }, (_, k) => TENDER.peakStart + k);
    const discharge = Array.from({ length: 24 }, (_, h) => (hours.includes(h) ? TENDER.maxMwhPerMwHour * X : 0));
    const labels = Array.from({ length: 24 }, (_, h) => clock(h));
    let soc = 0;
    const socLine = Array.from({ length: 24 }, (_, h) => { soc += -charge[h] * rte - discharge[h]; return Math.max(0, soc); });
    return {
      animation: false,
      grid: { left: 56, right: 56, top: 40, bottom: 40 },
      legend: { top: 0, right: 0 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: labels, axisLabel: { interval: 2 } },
      yAxis: [{ type: "value", name: "MW / MWh" }, { type: "value", name: "₹/kWh", min: 0, splitLine: { show: false } }],
      series: [
        { name: "Storage charging from own RE", type: "bar", data: charge.map((v) => Number(v.toFixed(1))), itemStyle: { color: "rgba(125,220,154,0.55)" }, barWidth: "70%",
          markArea: { silent: true, itemStyle: { color: "rgba(212,255,63,0.07)" }, label: { show: true, position: "insideTop", color: "#d4ff3f", fontSize: 11 }, data: [[{ name: `The model's evening window ${clock(TENDER.peakStart)}–24:00`, xAxis: labels[TENDER.peakStart] }, { xAxis: labels[TENDER.peakEnd - 1] }]] } },
        { name: `Supply to the buyer (${H} h)`, type: "bar", data: discharge, itemStyle: { color: "#a98bff" }, barWidth: "70%" },
        { name: "Energy in the storage", type: "line", data: socLine.map((v) => Number(v.toFixed(1))), symbol: "none", lineStyle: { color: "#a98bff", type: "dashed", width: 1.4 }, itemStyle: { color: "#a98bff" } },
        ...(mean ? [{ name: `${market} average price`, type: "line", yAxisIndex: 1, data: mean.map((v) => Number(v.toFixed(2))), symbol: "none", lineStyle: { color: "#f2b84b", width: 1.6 }, itemStyle: { color: "#f2b84b" } }] : []),
      ],
    };
  }, [mean, best, mw, market]);
  return (
    <div className="rtc-card" data-testid="cfd-typical-day">
      <div className="rtc-card-head">
        <span>A day of supply for {nf(mw || 100)} MW (illustrative): charge from own RE in the day, supply {E} MWh/MW in the {H} hours the buyer names, taken here as the {H} dearest evening hours{best ? ` (on average ${best.map(clock).join(", ")} in the ${market})` : ""}</span>
      </div>
      <LiveChart option={option} height={300} />
    </div>
  );
}

const lakhRs = (v) => `₹${nf(v, 2)} lakh`;
const STEPS_TO_DO = [
  { when: "Before you bid", text: "Apply for ISTS connectivity with non-solar-hour access at the Delivery Point you will name, for at least the MW you offer, in your name or that of an entity whose connectivity you may use. The proof goes in with the Covering Letter.", cites: ["connectivityApplied", "connectivityQuantum", "connectivityOther", "substationCriteria"] },
  { when: "Bid", text: `Bid once for yourself and your group: ${TENDER.bidMinMw} to ${TENDER.bidMaxMw} MW in whole MW. Pay the cost of the RfS (₹50,000) and the bid processing fee (₹20,000/MW, at most ₹${nf(TENDER.bidFeeMaxLakh)} lakh), plus GST, and give an EMD bank guarantee valid ${TENDER.emdValidityMonths} months. Show the net worth and one of the three liquidity tests for the plant you propose. Say in the Covering Letter whether you opt for cover under the Payment Security Mechanism.`, cites: ["capacityBid", "rfsCost", "bidFee", "emd", "emdValidity", "netWorth", "turnover", "psmOptIn"] },
  { when: "e-Reverse Auction", text: `Quote one first-round tariff (₹/kWh, two decimals) for all your projects; in the e-RA lower it in steps of at least 1 paisa. Every bidder within L1 + ${pf(TENDER.eraRange, 0)} wins, in tariff order, up to ${pf(TENDER.eraAwardShare, 0)} of the capacity bid (at most ${nf(TENDER.totalMw)} MW).`, cites: ["bid", "decrement", "range", "se"] },
  { when: "LoA + 30 days", text: `Pay the first half of the Success Charges (₹${nf(TENDER.cacLakhPerMw)} lakh per MW of Installed Capacity + taxes). Late: ₹1,000/MW a day.`, cites: ["successCharges", "successInstalments", "successLate"] },
  { when: "Invitation + 15 days", text: `The Effective Date of the PPA is the ${TENDER.loaToEdDays}th day after SECI's invitation, whenever the PPA is signed, and every date below runs from it. SECI signs only after a Buying Entity has signed the PSA. Keep at least 51% of the project company until a year after the SCSD.`, cites: ["effectiveDate", "ppaSign", "psaFirst", "lockIn"] },
  { when: "Invitation + 30 days", text: `Within ${TENDER.docsDueDays} days of SECI's invitation to sign the PPA: the PBG (${lakhRs(TENDER.pbgLakh.solarMw)}/MW solar, ${lakhRs(TENDER.pbgLakh.windMw)}/MW wind, ${lakhRs(TENDER.pbgLakh.essMwh)}/MWh storage), valid until ${TENDER.pbgAfterScdMonths} months after the SCSD, the second half of the Success Charges and the documents. Late: ₹1,000/MW a day.`, cites: ["docsDue", "pbg", "pbgValidity", "lateDocs", "checklistH"] },
  { when: "SCSD − 6 months", text: "Reach financial closure (late: ₹100/MW a day, paid in advance).", cites: ["finClose", "fcContent", "fcLate"] },
  { when: `By ED + ${TENDER.essScdMonths} months`, text: "Commission the whole Project: RE generation and storage, co-located, connected to an ISTS substation at 220 kV or above with non-solar-hour access. This is the SCSD: supply and the term start. Solar modules and cells from the ALMM lists; wind turbines from the RLMM.", cites: ["scsd", "colocated", "delivery", "substation", "almm", "rlmm"] },
  { when: "Every day", text: `Take the Buying Entity's ${H} hours by 06:00 (with none, yesterday's apply) and supply ${E} MWh per contracted MW, ${TENDER.maxMwhPerMwHour} MWh per MW in each hour. Schedule the power yourself at every RLDC on the corridor.`, cites: ["scheduleBy6", "noSchedule", "mandate", "hourCap", "punchIn", "buyerSchedulesDeleted"] },
  { when: "Every day", text: `Supply only RE. Charge the storage from your own RE; up to ${pf(TENDER.marketShare, 0)} of the year's energy may come from the green market or a bilateral agreement, directly or through the storage. No other charging from the grid.`, cites: ["allRe", "marketShare", "marketUse", "discharged", "gridCharging"] },
  { when: "Every month", text: `Supply at least ${pf(1 - TENDER.shortfallTolerance, 0)} of the month's ${E} MWh per MW a day, or pay ${nf(TENDER.penaltyMultiple, 1)} × the tariff on the shortfall beyond ${pf(TENDER.shortfallTolerance, 0)}. Send SECI the supply data within 7 days of the month's end.`, cites: ["shortfall", "tolerance", "shortfallBeyond", "supplyData"] },
  { when: "Every month", text: `Bill SECI: the energy in the energy accounts × the tariff, less ₹${nf(TENDER.psmChargeRsPerKwh, 2)}/kWh if you opted for the Payment Security Mechanism. SECI deducts any shortfall penalty from the payment.`, cites: ["monthlyBill", "psm", "dueDate", "deductions"] },
  { when: "All term", text: "Forecast and schedule under the CERC and SERC regulations; deviation charges are yours and are paid by you directly.", cites: ["forecasting", "dsmOnRpd"] },
  { when: "All term", text: `Sell anything else (the storage outside the Peak Hours, surplus RE) only after the day's PPA supply is met, within the connectivity. The connectivity asked for is for the non-solar hours: surplus solar can be injected in the day only if you hold solar-hour connectivity as well. Offer excess energy to SECI and the buyer first. A sale while the PPA is short costs ${nf(TENDER.thirdPartyPenaltyMultiple, 1)} × the day's highest exchange rate.`, cites: ["essOtherUse", "priority", "connectivityApplied", "thirdParty", "excess", "excessPsa"] },
];

/** The tender as a picture: flows, dates, a day, and the bidder's obligations in order (part of the What FDRE-X asks step). */
export default function VisualModel({ state, prices }) {
  const X = state.inputs.contractedMw || 100;
  const market = state.inputs.sellMarket || "DAM";
  const dayInjection = state.inputs.dayInjection === true; // the bid holds connectivity in the solar hours too
  const span = prices?.markets?.[market];
  const monthYear = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <Section index="2" title="How SECI-FDRE-X works" note={`Assured peak supply of ${nf(TENDER.totalMw * E)} MWh a day (${nf(TENDER.totalMw)} MW × ${H} h), under a ${TENDER.termYears}-year PPA with SECI at the tariff you bid`}>
        <div className="cfd-lead">
          <p>You build renewable generation with storage, deliver <strong>{E} MWh per contracted MW every day</strong> in the {H} hours the Buying Entity names, and SECI pays you the <strong>tariff you bid</strong> on every kWh supplied <Cite id="mandate" compact /> <Cite id="tariff" compact />. SECI is the intermediary: it buys from you under the PPA and sells to the Buying Entity under a back-to-back PSA <Cite id="nodal" compact /> <Cite id="backToBack" compact />. Amendment-01 changed one thing: it deleted the Buying Entity's rights to resell the power and to schedule it, so you schedule the power yourself, to the Buying Entity only <Cite id="buyerSurplusDeleted" compact /> <Cite id="buyerSchedulesDeleted" compact />.</p>
          <p>You need no plant to bid: you build the Project after you win. You do need to have applied for connectivity with non-solar-hour access at the substation you name <Cite id="newProject" compact /> <Cite id="connectivityApplied" compact />. The worked example below walks a bid of your size through real evenings.</p>
          <p>That connection carries power only in the non-solar hours. Solar beyond what charges the storage earns nothing in the day unless you hold solar-hour connectivity as well, or SECI buys the excess at the tariff, which needs the Buying Entity's consent <Cite id="substation" compact /> <Cite id="excess" compact />. {dayInjection ? "Your bid says you hold connectivity in the solar hours too: the picture shows the surplus sold." : "Your bid holds non-solar-hour access only: the picture shows the surplus curtailed. Change it on Bid inputs if you hold more."}</p>
        </div>
        <FlowDiagram mw={X} dayInjection={dayInjection} />
      </Section>
      <Section index="2.1" title="Timeline" note={state.inputs.effectiveDate ? `From the Effective Date you entered (${fmtDate(Date.parse(`${state.inputs.effectiveDate}T00:00:00Z`))})` : "Months from the Effective Date of the PPA; enter the date on Bid inputs to see the calendar dates"}>
        <Timeline effectiveDate={state.inputs.effectiveDate} />
        <p className="rtc-note">There is one date for the whole Project: no later date for the RE generation. The PBG stays valid until {TENDER.pbgAfterScdMonths} months after the SCSD. Dates: <Cites ids={["effectiveDate", "scsd", "term", "finClose", "delayMax", "delay", "delayBeyond", "pbgValidity", "fmExtension", "connectivityDelay"]} /></p>
      </Section>
      <Section index="2.2" title="A day of supply" note={span ? `IEX ${market} prices, ${monthYear(span.from)} – ${monthYear(span.to)}` : "IEX prices"}>
        <TypicalDay prices={prices} mw={X} market={market} />
        <p className="rtc-note">The buyer may name any {H} of the non-solar hours, evening to the next morning, with at least 1 hour continuous; the model takes the {H} dearest hours of {clock(TENDER.peakStart)} to 24:00. Hours in the early morning need the same stored energy, held overnight. The picture shows the charging and the supply only: {dayInjection ? "solar beyond the charging is sold in the day, as your bid holds solar-hour connectivity." : "solar beyond the charging is not injected in the day, as your bid holds non-solar-hour access only."} <Cites ids={["fourHours", "peakWindow", "continuous", "connectivityApplied"]} /></p>
      </Section>
      <Section index="2.3" title="What the winning bidder must do" note="In order, each with the clause it comes from">
        <ol className="cfd-todo" data-testid="cfd-todo">
          {STEPS_TO_DO.map((s, i) => (
            <li key={i}>
              <span className="cfd-todo-when">{s.when}</span>
              <span>{s.text}</span>
              <span className="cfd-todo-cites"><Cites ids={s.cites} /></span>
            </li>
          ))}
        </ol>
      </Section>
      <Section index="2.4" title="Your money, in one line" note="What the financial model computes">
        <div className="cfd-money" data-testid="cfd-money">
          <div><span>Revenue</span><strong>Tariff × energy supplied in the Peak Hours</strong><small>up to {E} MWh/MW a day; less ₹{nf(TENDER.psmChargeRsPerKwh, 2)}/kWh if you opt for PSM cover; + any extra battery sold outside the Peak Hours at exchange prices; {dayInjection ? "+ the day's surplus RE sold, as your bid holds solar-hour connectivity" : "the day's surplus solar earns nothing, as your bid holds non-solar-hour access only"}</small></div>
          <div><span>Costs</span><strong>Storage + own RE + bought power</strong><small>capex, O&amp;M, augmentation, green-market or bilateral power within {pf(TENDER.marketShare, 0)}, exchange fees on market sales, EMD and PBG guarantees, SECI's charges, monthly penalties</small></div>
          <div><span>Your bid</span><strong>The tariff that earns your equity IRR</strong><small>solved on the Financial model step, rounded up to two decimals</small></div>
        </div>
      </Section>
    </>
  );
}
