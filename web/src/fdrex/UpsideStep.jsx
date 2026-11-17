import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, CheckCircle2, Loader2, Send, Sparkles, Square, TriangleAlert, TrendingUp } from "lucide-react";
import { Field, Section, SelectBox, Stat, nf, pf } from "../rtc/ui";
import Cite from "./Cite.jsx";
import { applyPlan, caseSummary, planLabel, upsideContext, upsideSettings, upsideSweep, evaluatePlan } from "./upside.js";
import { TENDER } from "./tender.js";

const KIND = {
  do: { cls: "good", word: "Worth doing" },
  consider: { cls: "note", word: "To consider" },
  avoid: { cls: "warn", word: "Does not pay" },
  risk: { cls: "block", word: "Risk" },
  rule: { cls: "note", word: "Tender" },
};
const irr = (v, d = 1) => (typeof v === "number" && Number.isFinite(v) ? pf(v, d) : "–");
const pts = (v) => (typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : "−"}${nf(Math.abs(v) * 100, 2)} pt` : "");
const crs = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) > 1e-9 ? `₹${nf(v, d)} cr` : "–");
/** The starter questions: the one on connectivity asks for the other case than the bid's. */
const questionsOf = (dayOn) => [
  "What is the best way to raise the equity IRR of this bid?",
  dayOn ? "What if injection in the solar hours is not allowed?" : "What would connectivity in the solar hours add?",
  "From which year does a battery added for evening sale pay?",
  "How much lower could we bid with more own solar?",
];

/**
 * The Upside step of the SECI-FDRE-X bid (forked from the CfD-I tab's step): what more own solar
 * and battery behind the bid's connection would do to the bid's return at its tariff (./upside.js),
 * found by a sweep the browser runs on the bid on screen; and the bid analyst (POST
 * /api/fdrex/agent), which runs the same cases as tools to answer questions. A plan can be made the
 * bid's own: its solar and a battery tranche at the SCSD become the bid's plant; later tranches
 * stay with this step. SECI's first right to the excess energy at the tariff (PPA 9.3) is named as
 * an upside the cases do not count. Injection in the solar hours follows the bid's choice
 * (state.inputs.dayInjection; the tender asks for non-solar-hour access, RfS 7.2): without it the
 * cases curtail the day's surplus and the same plans with solar-hour connectivity too are shown as
 * a what-if; with it, no injection in solar hours is a stress.
 * Props: state, setState, model (runModel), prices, goto.
 */
export default function UpsideStep({ state, setState, model, prices, goto }) {
  const settings = useMemo(() => upsideSettings(state.upside?.settings), [state.upside?.settings]);
  const setSetting = (patch) => setState((s) => ({ ...s, upside: { ...(s.upside || {}), settings: { ...(s.upside?.settings || {}), ...patch } } }));
  const X = state.inputs?.contractedMw || 0;
  // injection in the solar hours: the bid's choice, unless this step's setting says otherwise
  const bidDay = Boolean(state.inputs?.dayInjection);
  const dayOn = settings.dayInjection ?? bidDay;
  // what the cases depend on: the bid and the settings
  const key = useMemo(() => JSON.stringify([state.inputs, state.fin, state.costs, state.bess, state.losses, state.tariffLocked, state.solarMonthScale, state.solarUpload?.name, state.windUpload?.name, settings]), [state.inputs, state.fin, state.costs, state.bess, state.losses, state.tariffLocked, state.solarMonthScale, state.solarUpload, state.windUpload, settings]);
  const [found, setFound] = useState(null); // { key, result }
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(null);
  const stopRef = useRef(false);
  const result = found && found.key === key ? found.result : null;
  const stale = Boolean(found && found.key !== key);

  const run = async () => {
    stopRef.current = false;
    setError(""); setApplied(null);
    setProgress({ done: 0, total: 1, label: "the bid as it stands" });
    try {
      const out = await upsideSweep(state, prices, settings, { onProgress: (done, total, label) => setProgress({ done, total, label }), shouldStop: () => stopRef.current });
      if (!out) setError("The bid could not be modelled: finish the inputs and size the plant first.");
      else setFound({ key, result: out });
    } catch (err) {
      setError(err.message || "The sweep failed.");
    } finally {
      setProgress(null);
    }
  };
  const apply = (plan) => {
    const out = applyPlan(state, plan);
    setState(() => out.state);
    setApplied({ label: planLabel(plan), kept: out.kept });
  };

  if (!model?.sim) {
    return (
      <Section index="12" title="Upside" note="After sizing">
        <p className="rtc-note">The Upside needs the bid's plant and tariff. Finish the inputs and size the plant first.</p>
        <button type="button" className="primary" onClick={() => goto?.("size")} data-testid="cfd-upside-go-size">Go to sizing <ArrowRight size={14} /></button>
      </Section>
    );
  }
  const r = result;
  // where this step's setting differs from the bid's connectivity, the cases' tariff is the bid's solved again for it: say so
  const bidTariff = !state.tariffLocked && Number.isFinite(model?.sp) ? model.sp : null;
  const solvedAgain = Boolean(r && bidTariff !== null && Math.abs(r.tariff - bidTariff) > 0.005);
  const rows = r ? [r.base, ...r.solar, ...r.timing, ...r.ladder] : [];
  const marks = r ? new Map([[r.best, "best IRR"], [r.bestValue, r.bestValue === r.best ? "best IRR, most value" : "most value"]]) : new Map();

  return (
    <>
      <Section index="12" title="Upside behind the same connection" note="More own solar and battery, sold on the exchange outside the buyer's four hours, at the bid's tariff"
        actions={(
          <>
            {progress && <button type="button" className="secondary" onClick={() => { stopRef.current = true; }} data-testid="cfd-upside-stop"><Square size={12} /> Stop</button>}
            <button type="button" className="primary" onClick={run} disabled={Boolean(progress)} data-testid="cfd-upside-run">
              {progress ? <Loader2 size={14} className="spin" /> : <TrendingUp size={14} />} {progress ? `Case ${progress.done} of ${progress.total}` : r ? "Run again" : "Find the upside"}
            </button>
          </>
        )}>
        <p className="rtc-note upside-intro">
          The bid pays for the line, the bay and the connectivity. Capacity added behind them carries none of that cost: more own solar keeps the battery charged on poor days{dayOn ? " and sells its surplus in the day" : ""}; battery added later, at a lower price, sells in the evening hours outside the four hours the buyer chose, with the PPA supply first and within the contracted MW. Bought power for the added battery sits inside the same {Math.round(TENDER.marketShare * 100)}% limit as the supply, so in practice it charges from own RE. Each case below is the bid's own model run again, the day-by-day operation and the full financial model, at the bid's tariff and the IEX price year held flat. SECI has the first right to the excess energy, at the tariff, if the Buying Entity consents: an upside the cases do not count, since they {dayOn ? "sell the surplus at exchange prices" : "count nothing from SECI"}.
          {" "}<Cite id="essOtherUse" /> <Cite id="connectivity" /> <Cite id="substation" /> <Cite id="marketShare" /> <Cite id="excess" />
        </p>
        {!dayOn && (
          <p className="rtc-note" data-testid="cfd-upside-nonsolar">
            <TriangleAlert size={12} /> {bidDay ? "Sale in solar hours is switched off below" : "This bid has connectivity with non-solar-hour access only (Bid inputs)"}: the cases inject nothing from 06:00 to 18:00. More solar then helps only by charging the battery, and its surplus in the day is curtailed; added battery tranches still sell in the evening hours outside the buyer's four hours. The same plans with solar-hour connectivity too are shown as a what-if.
            {" "}<Cite id="connectivityApplied" />
          </p>
        )}
        <div className="rtc-grid rtc-grid-4" data-testid="cfd-upside-settings">
          <Field label="Battery price fall" pct value={settings.batteryDecline} onChange={(v) => setSetting({ batteryDecline: v })} step={1} min={0} max={50} hint="a year: a tranche bought in year y costs today's price × (1 − fall)^(y − 1)" />
          <Field label="Debt on the addition" pct value={settings.debtShare ?? state.inputs.debtFraction} onChange={(v) => setSetting({ debtShare: v })} step={5} min={0} max={90} hint={settings.debtShare === null ? "the bid's debt share until you set it; 0: paid from equity" : "of its cost at the SCSD; 0: paid from equity"} />
          <Field label="One battery tranche" unit="MWh" value={Math.round(settings.trancheMwhPerMw * X)} onChange={(v) => setSetting({ trancheMwhPerMw: X > 0 ? v / X : 0.5 })} step={5} min={1} max={4 * X} hint={`${nf(settings.trancheMwhPerMw, 2)} MWh per contracted MW`} />
          <Field label="Largest solar addition" unit="MWac" value={Math.round(settings.maxSolarPerMw * X)} onChange={(v) => setSetting({ maxSolarPerMw: X > 0 ? v / X : 1 })} step={5} min={5} max={3 * X} hint="tried in steps; the sweep stops once the IRR has fallen twice" />
          <SelectBox label="Sale in solar hours" value={settings.dayInjection === null ? "bid" : settings.dayInjection ? "yes" : "no"} onChange={(v) => setSetting({ dayInjection: v === "bid" ? null : v === "yes" })} options={[["bid", `As in the bid (${bidDay ? "connectivity in the solar hours too" : "non-solar-hour access only"})`], ["yes", "Allowed (connectivity for all hours)"], ["no", "Not allowed (non-solar hours only)"]]} hint="RfS 7.2 asks for connectivity with injection rights in non-solar hours" />
          <Field label="Midday price stress" pct value={settings.middayStress} onChange={(v) => setSetting({ middayStress: v })} step={1} min={-30} max={30} digits={1} hint={dayOn ? "a year, on the best plan only" : "not run: the cases sell nothing in the day"} />
        </div>
        {error && <div className="alert"><TriangleAlert size={14} /> {error}</div>}
        {stale && !progress && <p className="rtc-note" data-testid="cfd-upside-stale"><TriangleAlert size={12} /> The bid or the settings changed since the last sweep: run it again.</p>}
        {applied && (
          <div className="upside-applied" data-testid="cfd-upside-applied">
            <CheckCircle2 size={14} /> {applied.label}: the solar{applied.kept.length || !/battery/.test(applied.label) ? "" : " and the battery"} is now in the bid (Design step). {applied.kept.length ? `The battery tranches of later years (${applied.kept.map((t) => `${nf(t.mwh)} MWh in year ${t.year}`).join(", ")}) stay with this step: the bid's plant is what is built for the SCSD. ` : ""}
            <button type="button" className="secondary" onClick={() => goto?.("size")}>See the bid on the Size step <ArrowRight size={12} /></button>
          </div>
        )}
        {progress && <p className="rtc-note" data-testid="cfd-upside-progress">Running {progress.label}…</p>}
        {!r && !progress && !stale && <p className="rtc-note">About thirty cases, a few seconds each on a slow machine. Nothing in the bid changes until you apply a plan.</p>}
      </Section>

      {r && (
        <>
          <Section index="12.1" title="What the model suggests" note={`At ₹${nf(r.tariff, 2)}/kWh${solvedAgain ? ` (the bid's ₹${nf(bidTariff, 2)} solved again ${r.settings.dayInjection ? "with" : "without"} sale in solar hours)` : ""}, target equity IRR ${pf(r.targetIrr, 1)}`}>
            <div className="rtc-grid rtc-grid-4" data-testid="cfd-upside-stats">
              <Stat label="The bid as it stands" value={irr(r.base.equityIrr)} detail={`equity IRR · project cost ${crs(r.base.costCr)} · green-market power bought ${crs(r.base.boughtCrYr, 1)} a year`} />
              <Stat label="Best plan" value={irr(r.best.equityIrr)} detail={r.best === r.base ? "no addition raises the equity IRR" : `${r.best.label} · ${pts(r.best.dEquityIrr)}`} tone={r.best !== r.base ? "good" : undefined} />
              <Stat label="What it costs" value={r.best === r.base ? "–" : crs(r.best.addCostCr)} detail={r.best === r.base ? "" : `at the SCSD${r.best.laterCapexCr > 0 ? `, and ${crs(r.best.laterCapexCr)} in later years from the project's cash` : ""} · on its own cost ${irr(r.best.addEquityIrr)} on equity`} />
              <Stat label="Or bid lower" value={r.lowerBid ? `₹${nf(r.lowerBid.tariff, 2)}/kWh` : "–"} detail={r.lowerBid ? `the same ${pf(r.targetIrr, 1)} with +${nf(r.lowerBid.solarMw)} MWac: ₹${nf(Math.abs(r.lowerBid.change), 2)} ${r.lowerBid.change < 0 ? "below" : "above"} the bid` : "no solar addition lowers the tariff"} />
            </div>
            <div className="bid-review upside-list" data-testid="cfd-upside-suggestions">
              {r.suggestions.map((s, k) => (
                <div key={`${s.kind}-${k}`} className={`review-item ${KIND[s.kind]?.cls || "note"}`} data-testid={`cfd-upside-${s.kind}`}>
                  <div className="review-head"><span className="upside-kind">{KIND[s.kind]?.word}</span><b>{s.title}</b>{s.cite && <Cite id={s.cite.id} compact />}</div>
                  <p>{s.detail}</p>
                  {s.plan && (s.kind === "do" || s.kind === "consider") && (s.plan.solarMw > 0 || s.plan.battery.some((t) => t.year === 1)) && (
                    <button type="button" className="secondary" onClick={() => apply(s.plan)} data-testid={`cfd-upside-apply-${k}`}>Make it the bid's plant <ArrowRight size={12} /></button>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section index="12.2" title="Every case" note="Equity IRR of the whole bid, and what the addition returns on its own cost">
            <div className="table-wrap rtc-model fin-table upside-table">
              <table data-testid="cfd-upside-table">
                <thead><tr><th>Plan</th><th>Equity IRR</th><th>Change</th><th>Cost at the SCSD</th><th>Later tranches</th><th>The addition alone, on equity</th><th>The last tranche alone</th><th>Sold in the day</th><th>Sold from the battery</th><th>Power bought</th><th>Value at the target</th><th>Min DSCR</th></tr></thead>
                <tbody>
                  {rows.map((c, k) => (
                    <tr key={`${c.label}-${k}`} className={c === r.best ? "is-best" : undefined} data-testid={c === r.best ? "cfd-upside-best-row" : undefined}>
                      <td>{c.label}{marks.get(c) && c !== r.base ? <small className="upside-mark">{marks.get(c)}</small> : null}</td>
                      <td>{irr(c.equityIrr, 2)}</td>
                      <td>{pts(c.dEquityIrr)}</td>
                      <td>{crs(c.addCostCr)}</td>
                      <td>{crs(c.laterCapexCr)}</td>
                      <td>{irr(c.addEquityIrr)}</td>
                      <td>{c.stepEquityAbove ? "above 150%" : irr(c.stepEquityIrr)}</td>
                      <td>{c.daySoldMuYr > 0.05 ? `${nf(c.daySoldMuYr, 0)} MU at ₹${nf(c.dayPrice, 2)}` : "–"}</td>
                      <td>{c.batterySoldMuYr > 0.05 ? `${nf(c.batterySoldMuYr, 0)} MU at ₹${nf(c.batteryPrice, 2)}` : "–"}</td>
                      <td>{crs(c.boughtCrYr, 1)}</td>
                      <td>{c === r.base ? "–" : crs(c.dEquityNpvCr, 1)}</td>
                      <td>{c.minDscr !== null ? `${nf(c.minDscr, 2)} (y${c.minDscrYear})` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rtc-note">Sold MU and power bought (green market, within the {Math.round(TENDER.marketShare * 100)}% limit) are yearly averages over the term. "Value at the target" is the equity's net present value at the target IRR, above the bid's. A battery tranche after the SCSD is paid from the project's cash in its year (no debt on it) and fades from that year; "the last tranche alone" is what that tranche returns on the cash it takes ("above 150%" where it takes almost none in its year).</p>
            {(Object.keys(r.stress).length > 0 || r.bidStress) && (
              <div className="table-wrap rtc-model fin-table upside-table">
                <table data-testid="cfd-upside-stress">
                  <thead><tr><th>Stress or what-if</th><th>Plan</th><th>Equity IRR</th><th>Against the plan</th><th>What changes</th></tr></thead>
                  <tbody>
                    {[...(r.bidStress ? [["bid", r.bidStress]] : []), ...Object.entries(r.stress)].flatMap(([which, tests]) => {
                      // the bid as it stands first (its own day sale rests on the same connectivity), then the plans
                      const plan = which === "bid" ? r.base : which === "bestSolar" ? r.bestSolar : (r.ladderPlan || r.best);
                      const text = {
                        noDayInjection: ["No injection in solar hours", (c) => `${nf(c.curtailedMuYr, 0)} MU a year curtailed`],
                        withDayInjection: ["What if: with solar-hour connectivity too", (c) => `${nf(c.daySoldMuYr, 0)} MU a year sold in the day${c.dayPrice ? ` at ₹${nf(c.dayPrice, 2)}/kWh` : ""}`],
                        middayPrices: [`Midday prices ${settings.middayStress < 0 ? "falling" : "rising"} ${pf(Math.abs(settings.middayStress), 0)} a year`, (c) => (c.dayPrice ? `day sale at ₹${nf(c.dayPrice, 2)}/kWh on average` : "")],
                        fromEquity: ["The addition paid from equity", (c) => `equity ${crs(c.equityCr)} of ${crs(c.costCr)}`],
                      };
                      return Object.entries(tests).map(([name, c]) => (
                        <tr key={`${which}-${name}`}><td>{text[name][0]}</td><td>{plan.label}</td><td>{irr(c.equityIrr, 2)}</td><td>{pts(c.equityIrr - plan.equityIrr)}</td><td>{text[name][1](c)}</td></tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      <Analyst state={state} prices={prices} settings={settings} apply={apply} dayOn={dayOn} />
    </>
  );
}

/** Read a stream of JSON lines, calling onEvent for each. */
async function readLines(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line) { try { onEvent(JSON.parse(line)); } catch { /* a broken line */ } }
    }
  }
}

/**
 * The bid analyst: a conversation with Claude, which runs the Upside cases as tools on the bid on
 * screen (web/lib/fdrexAgent.js). The plans it prices are offered below its answer.
 */
function Analyst({ state, prices, settings, apply, dayOn }) {
  const [info, setInfo] = useState(null); // { available, cloud, model }
  const [turns, setTurns] = useState([]); // { role, content, tools: [{ id, label, ok, ms }], plans }
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [priced, setPriced] = useState({}); // plan label → case numbers, priced here
  const abortRef = useRef(null);
  const endRef = useRef(null);
  useEffect(() => {
    let live = true;
    fetch("/api/fdrex/agent", { credentials: "same-origin" }).then((res) => (res.ok ? res.json() : null)).then((d) => { if (live) setInfo(d || { available: false }); }).catch(() => { if (live) setInfo({ available: false }); });
    return () => { live = false; abortRef.current?.abort(); };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [turns]);

  const ask = async (question) => {
    const q = question.trim();
    if (!q || busy) return;
    setError(""); setDraft(""); setBusy(true);
    const history = [...turns.filter((t) => t.content).map((t) => ({ role: t.role, content: t.content })), { role: "user", content: q }];
    setTurns((t) => [...t, { role: "user", content: q }, { role: "assistant", content: "", tools: [], plans: [] }]);
    const patchLast = (fn) => setTurns((t) => t.map((x, k) => (k === t.length - 1 ? fn(x) : x)));
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const res = await fetch("/api/fdrex/agent", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", signal: ctl.signal, body: JSON.stringify({ state, messages: history }) });
      if (!res.ok) {
        let msg = `The analyst did not answer (${res.status}).`;
        try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      await readLines(res, (e) => {
        if (e.type === "text") patchLast((x) => ({ ...x, content: x.content + e.delta }));
        else if (e.type === "retract") patchLast((x) => ({ ...x, content: x.content.slice(0, Math.max(0, x.content.length - e.length)) }));
        else if (e.type === "tool") patchLast((x) => ({ ...x, tools: [...x.tools, { id: e.id, label: e.label }] }));
        else if (e.type === "tool_done") patchLast((x) => ({ ...x, tools: x.tools.map((t) => (t.id === e.id ? { ...t, ok: e.ok, ms: e.ms } : t)) }));
        else if (e.type === "done") patchLast((x) => ({ ...x, content: e.text || x.content, plans: e.plans || [], model: e.model, stop: e.stop }));
        else if (e.type === "error") setError(e.message);
      });
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message || "The analyst did not answer.");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };
  // a plan the analyst priced, run here on the bid on screen (the same case, without the model's service)
  const priceHere = (p) => {
    const ctx = upsideContext(state, prices, settings);
    if (ctx) setPriced((m) => ({ ...m, [p.label]: caseSummary(evaluatePlan(ctx, p.plan)) }));
  };

  return (
    <Section index="12.3" title="Ask the analyst" note={info?.available ? `Claude runs the cases for you (${info.model})` : "Claude, with the bid's model as its tools"}>
      {info && !info.available && (
        <p className="rtc-note" data-testid="cfd-analyst-off">
          <TriangleAlert size={12} /> {info.cloud === false
            ? "The analyst does not run in the core zone: no cloud model reaches the bid workspace. The sweep above runs here without it."
            : "The analyst is not set up on this server: an administrator adds the Anthropic key under API keys in the sidebar. The sweep above runs without it."}
        </p>
      )}
      <div className="analyst" data-testid="cfd-analyst">
        {turns.length === 0 && (
          <div className="analyst-empty">
            <Bot size={18} />
            <p>Ask what would raise the return of this bid, or propose a plan to test. The analyst runs the day-by-day operation and the financial model for every case it quotes, and cites the tender for what it allows. The bid's inputs and results are sent to the model's service to answer; nothing in the bid changes unless you apply a plan.</p>
            <div className="analyst-starters">
              {questionsOf(dayOn).map((q) => <button key={q} type="button" className="secondary" disabled={!info?.available || busy} onClick={() => ask(q)}>{q}</button>)}
            </div>
          </div>
        )}
        {turns.map((t, k) => (
          <div key={k} className={`analyst-turn ${t.role}`} data-testid={`cfd-analyst-${t.role}`}>
            {t.role === "assistant" && t.tools?.length > 0 && (
              <ul className="analyst-tools">
                {t.tools.map((x) => <li key={x.id} className={x.ok === false ? "failed" : x.ok ? "done" : "running"}>{x.ok === undefined ? <Loader2 size={11} className="spin" /> : x.ok ? <CheckCircle2 size={11} /> : <TriangleAlert size={11} />} {x.label}{x.ms ? ` · ${nf(x.ms / 1000, 1)} s` : ""}</li>)}
              </ul>
            )}
            {t.content ? <div className="analyst-text">{t.content}</div> : t.role === "assistant" && busy && k === turns.length - 1 ? <div className="analyst-text muted"><Loader2 size={12} className="spin" /> Thinking…</div> : null}
            {t.role === "assistant" && t.stop === "refusal" && <p className="rtc-note"><TriangleAlert size={12} /> The model declined to answer this.</p>}
            {t.role === "assistant" && t.plans?.length > 0 && (
              <div className="analyst-plans">
                <span>Plans it priced:</span>
                {t.plans.map((p) => (
                  <span key={p.label} className="analyst-plan">
                    <b>{p.label}</b>
                    {priced[p.label] ? <em>{irr(priced[p.label].equityIrr, 2)} here ({pts(priced[p.label].dEquityIrr)})</em> : <button type="button" className="secondary" onClick={() => priceHere(p)}>Check it here</button>}
                    {(p.plan.solarMw > 0 || p.plan.battery.some((x) => x.year === 1)) && <button type="button" className="secondary" onClick={() => apply(p.plan)}>Make it the bid's plant</button>}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
        {error && <div className="alert" data-testid="cfd-analyst-error"><TriangleAlert size={14} /> {error}</div>}
        <form className="analyst-ask" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={4000} placeholder={info?.available ? "Ask about the upside of this bid, or propose a plan: 60 MWac more solar and 50 MWh of battery every year from year 5…" : "The analyst is not available on this server"}
            disabled={!info?.available || busy} data-testid="cfd-analyst-input" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(draft); } }} />
          {busy
            ? <button type="button" className="secondary" onClick={() => abortRef.current?.abort()} data-testid="cfd-analyst-stop"><Square size={12} /> Stop</button>
            : <button type="submit" className="primary" disabled={!info?.available || !draft.trim()} data-testid="cfd-analyst-send"><Send size={13} /> Ask</button>}
        </form>
      </div>
      <p className="rtc-note"><Sparkles size={11} /> Every number the analyst gives comes from a case it ran on this bid; "Check it here" runs the same case in your browser.</p>
    </Section>
  );
}
