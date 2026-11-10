import React, { useMemo, useState } from "react";
import { ArrowRight, BatteryCharging, LayoutGrid, Loader2, Square, Sun, Wand2, Wind, X, TriangleAlert } from "lucide-react";
import { Section, nf, pf } from "../rtc/ui";
import { DATA_COLORS } from "../chartTheme";
import * as E from "../rtc/engine";
import LossChain, { POINTS } from "../rtc/LossChain";
import ProfileLibrary from "../rtc/ProfileLibrary";
import SolarStudio from "../plant/SolarStudio";
import WindStudio from "../plant/WindStudio";
import ProfileView from "../plant/ProfileView";
import SiteSchematic from "../bid/SiteSchematic";
import { defaultLosses } from "../bid/model";
import { useTeamContext } from "../team/useTeam";
import Cite from "./Cite.jsx";
import { designProfiles, essRequiredPerMw, lossFactorsOfCfd, missingInputs, socWindow, socWindowWarning } from "./model.js";
import { Choice, Fields, FillBar } from "./inputs.jsx";

const COLORS = { solar: DATA_COLORS.solar, wind: DATA_COLORS.wind, bess: DATA_COLORS.bess };
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** The optimiser's button and its words: offered on Design and on Size. */
export function OptimiseBar({ missing, optimise, optimising, stopOptimise, note = true, policy = "meet" }) {
  const aim = policy === "pay" ? "the lowest strike price, a day's shortfall allowed where paying for it is cheaper (your policy)" : "the lowest strike price with every day's supply met";
  return (
    <div className="cfd-optimise">
      {optimising
        ? <button type="button" className="secondary" onClick={stopOptimise} data-testid="cfd-optimise-stop"><Square size={14} /> Stop ({optimising.done}/{optimising.total})</button>
        : <button type="button" className="primary" onClick={optimise} disabled={missing.length > 0} data-testid="cfd-optimise"><Wand2 size={14} /> Optimise own RE</button>}
      {note && <span className="rtc-note">{optimising ? <><Loader2 className="spin" size={12} /> Trying own-RE sizes: {aim}</> : `Finds the solar (and wind, if you have it) that gives ${aim} within the sourcing limits. One to three minutes.`}</span>}
    </div>
  );
}

/** One source card of the SECI pattern: the boxes, the studio, the profile on screen and the profile library. */
function SourceCard({ id, state, setState, setInput, set, lockProps, isLocked, user, profiles }) {
  const i = state.inputs;
  const [studioOpen, setStudioOpen] = useState(false);
  const studio = state.studio?.[id] || null;
  const upload = state[`${id}Upload`] || null;
  const on = id === "solar" ? true : (i.windMw || 0) > 0;
  const cuf = id === "solar" ? i.solarCuf : i.windCuf;
  const Icon = id === "solar" ? Sun : Wind;
  const saveStudio = (v) => setState((st) => ({ ...st, studio: { ...(st.studio || {}), [id]: { ...v, applied: st.studio?.[id]?.applied || null } } }));
  const applyStudio = ({ capex, dcAc, cuf: c, studio: v, summary }) => {
    const values = id === "solar" ? { solarCrPerMw: capex, ...(dcAc ? { solarDcAc: dcAc } : {}), ...(c ? { solarCuf: c } : {}) } : { windCrPerMw: capex, ...(c ? { windCuf: c } : {}) };
    setState((st) => {
      const filled = { ...st.filled };
      for (const k of Object.keys(values)) delete filled[k];
      return { ...st, inputs: { ...st.inputs, ...values }, filled, studio: { ...(st.studio || {}), [id]: { ...v, applied: { capex, dcAc: dcAc || null, cuf: c || null, summary, at: new Date().toISOString() } } } };
    });
    setStudioOpen(false);
  };
  const cf = id === "solar" ? profiles?.solar : profiles?.wind;
  const hasProfile = on && isNum(cuf) && cf && cf.length >= E.HOURS;
  const cufAt = state.losses ? POINTS[id][state.losses[`${id}FileAt`] ?? POINTS[id].length - 1] : null;
  const title = id === "solar" ? "Own solar" : "Own wind";
  return (
    <div className={`bid-source ${on ? "" : "off"}`} style={{ "--chapter": COLORS[id] }} data-testid={`source-${id}`}>
      <header>
        <span className="bid-source-icon"><Icon size={16} /></span>
        <strong>{title}</strong>
        <span className="rtc-note">{id === "solar" ? "Co-located with the battery; domestic cells and modules" : "0 MW for none; the optimiser sizes it when you give it a CUF"}</span>
      </header>
      <div className="bid-source-body">
        <div className="bid-src-group">
          <h4>Capacity and parameters</h4>
          <Fields state={state} setInput={setInput} section="project" only={id === "solar" ? ["solarMw"] : ["windMw"]} lockProps={lockProps} />
          <Fields state={state} setInput={setInput} section="resource" only={id === "solar" ? ["solarCuf", "solarDcAc", "solarDegradation"] : ["windCuf", "windDegradation"]} lockProps={lockProps} />
          {cufAt && <p className="rtc-note">CUF measured at: {cufAt} (change it under Losses to the billing meter).{id === "solar" && isNum(i.solarCrPerMw) && isNum(i.solarDcAc) && i.solarDcAc > 0 ? ` Capex ₹${nf(i.solarCrPerMw, 2)} cr/MWac is ₹${nf(i.solarCrPerMw / i.solarDcAc, 2)} cr/MWp.` : ""}</p>}
          {!cufAt && id === "solar" && isNum(i.solarCrPerMw) && isNum(i.solarDcAc) && i.solarDcAc > 0 && <p className="rtc-note">Capex ₹{nf(i.solarCrPerMw, 2)} cr/MWac is ₹{nf(i.solarCrPerMw / i.solarDcAc, 2)} cr/MWp at DC:AC {nf(i.solarDcAc, 2)}.</p>}
        </div>
        <div className="bid-src-group">
          <h4>Costs</h4>
          <Fields state={state} setInput={setInput} section="costs" only={id === "solar" ? ["solarCrPerMw", "solarOmLakhPerMw"] : ["windCrPerMw", "windOmLakhPerMw"]} lockProps={lockProps} />
        </div>
        <div className="bid-studio-row">
          <button type="button" className="secondary" onClick={() => setStudioOpen(true)} data-testid={`studio-${id}`}>
            <LayoutGrid size={14} /> {id === "solar" ? "Solar plant studio: layout, inverters, ₹/Wp build-up" : "Wind farm studio: turbines by make, CUF, cost build-up"}
          </button>
          {studio?.applied && <span className="rtc-note" data-testid={`studio-applied-${id}`}>From the studio: ₹{nf(studio.applied.capex, 3)} cr/{id === "solar" ? "MWac" : "MW"}{studio.applied.cuf ? `, CUF ${nf(studio.applied.cuf * 100, 1)}%` : ""} · {studio.applied.summary}</span>}
        </div>
        {studioOpen && id === "solar" && (
          <SolarStudio studio={studio} acMw={i.solarMw || null} fixedCuf={isNum(i.solarCuf) ? i.solarCuf : null} onChange={saveStudio} onApply={applyStudio} onClose={() => setStudioOpen(false)} />
        )}
        {studioOpen && id === "wind" && (
          <WindStudio studio={studio} farmMw={i.windMw || null} onChange={saveStudio} onApply={applyStudio} onClose={() => setStudioOpen(false)} />
        )}
        {hasProfile && (
          <details className="bid-profile" open={Boolean(upload)} data-testid={`cfd-profile-${id}`}>
            <summary>Profile on screen: CUF {nf(cuf * 100, 2)}%{upload ? ` · ${upload.name}` : " · typical shape"}</summary>
            <ProfileView cf={cf} raw={upload?.values || null} color={COLORS[id]} label={id === "solar" ? "Solar" : "Wind"} kind={id} name={upload?.name || null}
              cufAt={cufAt} degradation={id === "solar" ? (isNum(i.solarDegradation) ? i.solarDegradation : 0) : (isNum(i.windDegradation) ? i.windDegradation : 0)} years={15} />
          </details>
        )}
        {on && (
          <details className="bid-profile" data-testid={`cfd-profile-library-${id}`}>
            <summary>Hourly profile: {upload?.name || "a typical Indian profile shape"}, scaled to your CUF</summary>
            <p className="rtc-note">The CUF you enter sets the energy; the profile sets its hour-by-hour shape. Pick or upload your site's 8,760-hour profile for the real shape.</p>
            <ProfileLibrary kind={id} state={state} set={set} lockProps={lockProps} isLocked={isLocked} color={COLORS[id]} user={user} />
          </details>
        )}
      </div>
    </div>
  );
}

/** The losses to the billing meter (the Round the clock loss chain on the bid's losses) and the site layout. */
function LossesAndSite({ state, setState, profiles, model }) {
  const i = state.inputs;
  const kinds = [{ id: "solar", title: "Solar", heading: "From the panels to the billing meter" }, ...((i.windMw || 0) > 0 ? [{ id: "wind", title: "Wind", heading: "From the turbines to the billing meter" }] : []), { id: "bess", title: "Battery", heading: "From the battery to the billing meter" }];
  const [pick, setPick] = useState("solar");
  const kind = kinds.some((k) => k.id === pick) ? pick : "solar";
  const meta = kinds.find((k) => k.id === kind);
  const mw = i.contractedMw || 100; // not X: that is the close icon
  const sizes = { solarMw: i.solarMw || 0, windMw: i.windMw || 0, bessMw: mw * (i.essMwPerMw || 1), bessMwh: mw * (i.essMwhPerMw || 2) };
  const discharged = model?.sim?.years?.[0]?.essOutMwh || 0;
  const lf = lossFactorsOfCfd(state);
  const shim = { inputs: { ...(state.losses || {}), solarDcAc: i.solarDcAc || 1, lossPct: 0 }, bess: { rte: i.rte ?? E.DEFAULT_BESS.rte } };
  const patch = (_section, values) => setState((s) => ({ ...s, losses: { ...(s.losses || defaultLosses()), ...values } }));
  // the site schematic reads the SECI bid's shape: a shim of this bid, its losses written back
  const siteShim = (s) => ({ sources: { solar: (s.inputs.solarMw || 0) > 0, wind: (s.inputs.windMw || 0) > 0, bess: true }, sites: { split: false, solarSite: {}, windSite: {} }, losses: s.losses, src: { bess: { rte: s.inputs.rte ?? E.DEFAULT_BESS.rte } } });
  const setSite = (fn) => setState((s) => { const next = typeof fn === "function" ? fn(siteShim(s)) : fn; return { ...s, losses: next.losses ?? s.losses }; });
  return (
    <>
      <Section index="4.3" title="Losses to the billing meter" note={state.losses ? `Every part with its loss, each technology's transformer included · reaches the meter: ${pf(lf.meter, 2)} of the 33 kV bus` : "Not modelled yet: the CUFs and the round trip are read at the billing meter"}>
        {!state.losses ? (
          <div className="cfd-optimise">
            <button type="button" className="secondary" onClick={() => setState((s) => ({ ...s, losses: defaultLosses() }))} data-testid="cfd-losses-on">Model the losses to the billing meter</button>
            <span className="rtc-note">Puts the Round the clock tab's loss chain on this bid: the inverter-duty, WTG and MV transformers, the 33 kV cables, the 33/220 kV power transformer and the 220 kV line, each with a typical loss you can change. The supply, the surplus sold and the extra battery's sales are then counted at the meter; bought charging power is bought at the meter.</span>
          </div>
        ) : (
          <>
            <p className="rtc-note">
              Pick where each CUF is measured: the stages above that point are already in it, the ones below are applied. The battery's round trip is applied from where it is quoted, both ways.
              The 33/220 kV power transformer and the 220 kV line are shared by every source. Energies are year 1 of the plant as entered.
              {" "}<button type="button" className="rtc-icon-btn" onClick={() => setState((s) => ({ ...s, losses: null }))} data-testid="cfd-losses-off" title="Remove the losses"><X size={12} /> Remove the losses</button>
            </p>
            <div className="bid-choice bid-loss-kinds" role="tablist" data-testid="bid-loss-kinds">
              {kinds.map((k) => (
                <button key={k.id} type="button" role="tab" aria-selected={k.id === kind} className={k.id === kind ? "active" : ""} onClick={() => setPick(k.id)} data-testid={`bid-loss-kind-${k.id}`}>{k.title}</button>
              ))}
            </div>
            <div className="chapter-group" data-testid="bid-losses">
              <div className="chapter-group-head"><span>{meta.heading}</span><small>Every part with its loss · year 1</small></div>
              <LossChain kind={kind} state={shim} patch={patch} sizes={sizes} sim={{ dischargeMWh: discharged }} measured="CUF"
                foot={`Year-1 ${meta.title.toLowerCase()} output at each point, before the battery; the day-by-day operation then supplies the two peak hours at the meter.`}
                cf={kind === "solar" ? profiles?.solar : kind === "wind" ? profiles?.wind : undefined} />
            </div>
          </>
        )}
      </Section>
      <Section index="4.4" title="Site layout" note="The plant on one site with one pooling station: the 33 kV bus, the 33/220 kV transformer and the 220 kV line to the billing meter">
        <SiteSchematic state={siteShim(state)} setState={setSite} energy={model?.sim?.years?.[0] ? { meterMu: model.sim.years[0].deliveredMwh / 1000 } : null} />
        {!state.losses && <p className="rtc-note">The transformer and line losses apply once the losses are modelled above.</p>}
      </Section>
    </>
  );
}

/**
 * Step 05, the Design team: the battery the tender mandates with its window, efficiency and ageing;
 * the own solar and wind with their studios, profiles and costs; the losses to the billing meter and
 * the site layout. "Fill up for me please" puts benchmarks in every empty box; "Optimise own RE"
 * sizes the generation.
 */
export default function DesignStep({ state, setState, setInput, set, lockProps, isLocked, optimise, optimising, stopOptimise, goto, model = null }) {
  const i = state.inputs;
  const missing = missingInputs(state);
  const X = i.contractedMw || 0;
  const teamCtx = useTeamContext();
  const user = teamCtx?.team?.me || null;
  const profiles = useMemo(() => designProfiles(state),
    // the profiles follow the CUFs, the DC:AC, the uploads and the monthly redraw
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i.solarCuf, i.solarDcAc, i.windCuf, i.windMw, state.solarUpload, state.windUpload, state.solarMonthScale, state.windMonthScale]);
  const win = socWindow(i);
  const socWarn = socWindowWarning(i);
  const nameplate = isNum(i.essMwhPerMw) ? i.essMwhPerMw : null;
  const usable = nameplate !== null ? nameplate * win : null;
  const need = essRequiredPerMw(state);
  const duration = isNum(i.essMwhPerMw) && isNum(i.essMwPerMw) && i.essMwPerMw > 0 ? i.essMwhPerMw / i.essMwPerMw : null;
  const rteAt = state.losses ? POINTS.bess[state.losses.bessRteAt ?? POINTS.bess.length - 1] : "the billing meter (model the losses to say where it is quoted)";
  return (
    <>
      <Section index="4" title="Battery" note="Mandatory: X MW / 2X MWh for X MW contracted, owned by you, co-located with the RE" actions={null}>
        <FillBar state={state} setState={setState} missing={missing} optimise={optimise} />
        <div className="bid-source" style={{ "--chapter": COLORS.bess }} data-testid="source-bess">
          <header><span className="bid-source-icon"><BatteryCharging size={16} /></span><strong>Battery</strong><span className="rtc-note">Round-trip efficiency quoted at: {rteAt}</span></header>
          <div className="bid-source-body">
            <div className="bid-src-group">
              <h4>Size</h4>
              <Fields state={state} setInput={setInput} section="project" only={["essMwhPerMw", "essMwPerMw", "extraEssMwhPerMw"]} lockProps={lockProps} />
              {X > 0 && nameplate !== null && (
                <p className="rtc-note" data-testid="cfd-battery-size">
                  Battery {nf(X * (i.essMwPerMw || 1))} MW / {nf(X * nameplate)} MWh nameplate for {nf(X)} MW contracted{duration !== null ? `; discharge duration ${nf(duration, 2)} h` : ""}{win < 1 ? `; usable ${nf(X * usable)} MWh within the ${pf(i.essSocMin || 0, 0)}–${pf(i.essSocMax ?? 1, 0)} state-of-charge window` : ""} <Cite id="ess" /> <Cite id="essOwned" /> <Cite id="colocated" />
                  {i.extraEssMwhPerMw > 0 && <>, plus {nf(X * i.extraEssMwhPerMw)} MWh for evening sale outside the peak hours, once the day's supply is met <Cite id="essOtherUse" /></>}.
                  {nameplate !== null && (nameplate < need.energy - 1e-9 || (i.essMwPerMw || 0) < need.power - 1e-9) && <strong> The tender's 2 MWh per MW must reach the meter: {nf(need.energy, 2)} MWh and {nf(need.power, 2)} MW per MW nameplate{win < 1 ? " within this window" : ""}{need.meter < 1 ? ` after the ${((1 - need.meter) * 100).toFixed(1)}% lost to the meter` : ""}; "Fill up for me please" sets it.</strong>}
                  {need.shortYear && <strong> Without augmentation the usable energy falls below the need from year {need.shortYear}; pick annual augmentation or more nameplate.</strong>}
                </p>
              )}
            </div>
            <div className="bid-src-group">
              <h4>Operation</h4>
              <Fields state={state} setInput={setInput} section="resource" only={["rte", "essSocMin", "essSocMax", "essDegradation"]} lockProps={lockProps} />
              {socWarn && <div className="alert soc-warning" data-testid="cfd-soc-warning"><TriangleAlert size={14} /> <span><b>Check the state-of-charge window:</b> {socWarn.text}</span></div>}
              <div className="rtc-grid rtc-grid-4 cfd-fields"><Choice state={state} setInput={setInput} k="augmentation" lockProps={lockProps} /></div>
            </div>
            <div className="bid-src-group">
              <h4>Costs</h4>
              <Fields state={state} setInput={setInput} section="costs" only={["essCrPerMwh", "essOmLakhPerMwh", "augDecline"]} lockProps={lockProps} />
            </div>
          </div>
        </div>
      </Section>

      <Section index="4.1" title="Own RE generation" note="Solar and wind in any mix, together they may exceed the contracted capacity; online by 36 months from the Effective Date">
        <OptimiseBar missing={missing} optimise={optimise} optimising={optimising} stopOptimise={stopOptimise} policy={i.shortfallPolicy || "meet"} />
        <Fields state={state} setInput={setInput} section="project" only={["reCodMonths", "availability"]} lockProps={lockProps} />
        <SourceCard id="solar" state={state} setState={setState} setInput={setInput} set={set} lockProps={lockProps} isLocked={isLocked} user={user} profiles={profiles} />
        <SourceCard id="wind" state={state} setState={setState} setInput={setInput} set={set} lockProps={lockProps} isLocked={isLocked} user={user} profiles={profiles} />
        <p className="rtc-note">RE by 36 months from the Effective Date <Cite id="reCod" />; any mix of solar and wind <Cite id="reSize" />; no connectivity above the contracted capacity <Cite id="connectivity" />; domestic cells and modules <Cite id="dcr" />.</p>
      </Section>

      <LossesAndSite state={state} setState={setState} profiles={profiles} model={model} />

      <section className="optimize-bar">
        <div>
          <span className="rtc-index">4.5</span>
          <h2>{missing.length ? `${missing.length} input${missing.length > 1 ? "s" : ""} still needed` : "Design inputs in"}</h2>
          {missing.length
            ? <ul className="bid-warnings">{missing.slice(0, 12).map((m) => <li key={m}>{m}</li>)}{missing.length > 12 && <li>… and {missing.length - 12} more</li>}</ul>
            : <p>The Finance team's terms come next; then the plant is sized.</p>}
        </div>
        <div className="optimize-bar-actions">
          <button type="button" className="primary optimize-go" onClick={() => goto("financeInputs")} data-testid="cfd-to-finance">Continue to Finance inputs <ArrowRight size={14} /></button>
        </div>
      </section>
    </>
  );
}
