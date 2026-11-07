import React from "react";
import { ArrowRight, Loader2, Square, Wand2 } from "lucide-react";
import { Section, nf } from "../rtc/ui";
import Cite from "./Cite.jsx";
import { missingInputs } from "./model.js";
import { Choice, Fields, FillBar } from "./inputs.jsx";

/** The optimiser's button and its words: offered on Design and on Size. */
export function OptimiseBar({ missing, optimise, optimising, stopOptimise, note = true }) {
  return (
    <div className="cfd-optimise">
      {optimising
        ? <button type="button" className="secondary" onClick={stopOptimise} data-testid="cfd-optimise-stop"><Square size={14} /> Stop ({optimising.done}/{optimising.total})</button>
        : <button type="button" className="primary" onClick={optimise} disabled={missing.length > 0} data-testid="cfd-optimise"><Wand2 size={14} /> Optimise own RE</button>}
      {note && <span className="rtc-note">{optimising ? <><Loader2 className="spin" size={12} /> Trying own-RE sizes: the lowest strike price with every day's supply met</> : "Finds the solar (and wind, if you have it) that gives the lowest strike price while every day's supply is met within the sourcing limits. One to three minutes."}</span>}
    </div>
  );
}

/**
 * Step 05, the Design team: the battery the tender mandates, its efficiency and ageing, the own RE
 * generation (solar and wind) with its resource, and when the RE comes online. "Fill up for me
 * please" puts benchmarks in every empty box; "Optimise own RE" sizes the generation.
 */
export default function DesignStep({ state, setState, setInput, lockProps, optimise, optimising, stopOptimise, goto }) {
  const i = state.inputs;
  const missing = missingInputs(state);
  const X = i.contractedMw || 0;
  return (
    <>
      <Section index="4" title="Battery" note="Mandatory: X MW / 2X MWh for X MW contracted, owned by you, co-located with the RE" actions={null}>
        <FillBar state={state} setState={setState} missing={missing} />
        <Fields state={state} setInput={setInput} section="project" only={["essMwhPerMw", "essMwPerMw", "extraEssMwhPerMw"]} lockProps={lockProps} />
        {X > 0 && i.essMwhPerMw && <p className="rtc-note" data-testid="cfd-battery-size">Battery {nf(X * (i.essMwPerMw || 1))} MW / {nf(X * i.essMwhPerMw)} MWh for {nf(X)} MW contracted <Cite id="ess" /> <Cite id="essOwned" /> <Cite id="colocated" />{i.extraEssMwhPerMw > 0 && <>, plus {nf(X * i.extraEssMwhPerMw)} MWh for evening sale outside the peak hours, once the day's supply is met <Cite id="essOtherUse" /></>}.</p>}
        <Fields state={state} setInput={setInput} section="resource" only={["rte", "essDegradation"]} lockProps={lockProps} />
        <div className="rtc-grid rtc-grid-4 cfd-fields"><Choice state={state} setInput={setInput} k="augmentation" lockProps={lockProps} /></div>
      </Section>

      <Section index="4.1" title="Own RE generation" note="Solar and wind in any mix, together they may exceed the contracted capacity; online by 36 months from the Effective Date">
        <OptimiseBar missing={missing} optimise={optimise} optimising={optimising} stopOptimise={stopOptimise} />
        <Fields state={state} setInput={setInput} section="project" only={["solarMw", "windMw", "reCodMonths", "availability"]} lockProps={lockProps} />
        <Fields state={state} setInput={setInput} section="resource" only={["solarCuf", "solarDegradation", "windCuf"]} lockProps={lockProps} />
        <p className="rtc-note">RE by 36 months from the Effective Date <Cite id="reCod" />; any mix of solar and wind <Cite id="reSize" />; no connectivity above the contracted capacity <Cite id="connectivity" />; domestic cells and modules <Cite id="dcr" />.</p>
      </Section>

      <section className="optimize-bar">
        <div>
          <span className="rtc-index">4.2</span>
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
