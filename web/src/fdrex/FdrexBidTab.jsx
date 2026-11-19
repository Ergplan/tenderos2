import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, CircleDollarSign, ClipboardCheck, FileStack, FlaskConical, FolderOpen, Landmark, Layers, ListChecks, MoonStar, RotateCcw, Save, Scale, Users, Zap } from "lucide-react";
import SaveDialog from "../scenarios/SaveDialog";
import BidFileTools from "../cfd/BidFileTools.jsx";
import { scenarioApi } from "../scenarios/client";
import useTeam, { TeamContext } from "../team/useTeam";
import TeamPanel from "../team/TeamPanel";
import { applyAnswer } from "../team/apply";
import { nf } from "../rtc/ui";
import { loadMarketPrices, missingInputs } from "../bid/model";
import useSizing from "../bid/useSizing";
import SourcesStep from "../bid/SourcesStep";
import SizeStep from "../bid/SizeStep";
import FinanceStep from "../bid/FinanceStep";
import FinanceInputsStep from "../bid/FinanceInputsStep";
import WhatIfTab from "../whatif/WhatIfTab";
import { whatIfFromBid } from "../whatif/model";
import LiveAgent, { TOOL_WORDS } from "../seci/LiveAgent";
import { createToolRunner } from "./bidAgent.js";
import { DOCUMENTS, RFS, TENDER, fdrexTerms } from "./bidTerms.js";
import { defaultFdrexBidState, formsView, fromSaved } from "./bidState.js";
import { TERMS } from "./terms.js";
import DocumentsStep from "./DocumentsStep.jsx";
import DocumentsView from "../tender/DocumentsView.jsx";
import { PACK as TENDER_PACK } from "./pack.js";
import ConditionsStep from "./ConditionsStep.jsx";
import BidInputs from "./BidInputs.jsx";
import BidForms from "./BidForms.jsx";
import { formIssues } from "./forms.js";
import { formatsSummary } from "./formats.js";
import OptimizerTheatre from "../rtc/Theatre";

export const STORAGE_KEY = "tenderos.fdrex.bid.v2";
export const MODULE = "fdrex";

// the steps, each with the team that owns it (docs/enterprise/ARCHITECTURE.md, section 3), as the SECI RTC tab
export const FDREX_STEPS = [
  { id: "documents", title: "Tender & amendments", icon: FileStack, color: "#d4ff3f", team: "Tender / Legal" },
  { id: "conditions", title: "Bid conditions", icon: ListChecks, color: "#ff8a5f", team: "Tender / Legal" },
  { id: "bid", title: "Bid inputs", icon: Scale, color: "#4fd1c5", team: "Projects" },
  { id: "sources", title: "Design", icon: Layers, color: "#3fa7d6", team: "Design" },
  { id: "financeInputs", title: "Finance inputs", icon: Landmark, color: "#9ad7a0", team: "Finance" },
  { id: "size", title: "Size", icon: Zap, color: "#f5b83d", team: "Projects" },
  { id: "finance", title: "Financial model", icon: CircleDollarSign, color: "#7ddc9a", team: "Finance" },
  { id: "whatif", title: "What-if", icon: FlaskConical, color: "#ff9fd0", team: "Finance" },
  { id: "forms", title: "Bid forms", icon: ClipboardCheck, color: "#a98bff", team: "Tender / Legal" },
];

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? fromSaved(JSON.parse(raw)) : defaultFdrexBidState();
  } catch {
    return defaultFdrexBidState();
  }
}

// survive switching dashboard tabs
let sessionState = null;
let sessionLinked = null;
const sizingSession = { hourly: null, run: null };

/**
 * SECI-FDRE-X (RfS No. SECI/C&P/IPP/13/0012/26-27): 4,800 MWh a day of assured peak supply. The
 * tender and its amendment, the bid conditions in force, what the bidder offers, the supply
 * sources (solar, wind and the storage, each sized by the optimizer or fixed), the HiGHS sizing
 * against the tender's constraints (the buyer's four hours, the monthly reconciliation, bought
 * power within 5%, no sale without connectivity), the financial model with its formula workbook,
 * an instant What-if on the sized plant, and the bid forms, with a voice bid agent (GPT-Live) that
 * works all of it. Built on the Tender to Bid steps, as the SECI RTC tab.
 */
export default function FdrexBidTab({ initialScenario = null }) {
  const opened = initialScenario?.current?.inputs?.state;
  const [state, setState] = useState(() => (opened ? fromSaved(opened) : sessionState || loadState()));
  const [linked, setLinked] = useState(() => (opened ? { id: initialScenario.scenario.id, name: initialScenario.scenario.name, version: initialScenario.current.version } : sessionLinked));
  const [showSave, setShowSave] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  useEffect(() => { sessionLinked = linked; }, [linked]);
  const [prices, setPrices] = useState(null);
  useEffect(() => { loadMarketPrices().then(setPrices).catch(() => setPrices(null)); }, []);
  const terms = useMemo(() => fdrexTerms(state.fdrex, prices), [state.fdrex, prices]);
  const missing = useMemo(() => missingInputs(state, terms), [state, terms]);
  const sizing = useSizing({ state, setState, terms, prices, session: sizingSession, module: MODULE });

  // the voice agent (web/src/fdrex/bidAgent.js): its tools run on this tab's state; the What-if and
  // the bought power read the IEX prices
  const [agent, setAgent] = useState(null); // { available, model, backendModel } from /api/seci/live
  const [docked, setDocked] = useState(false); // the agent's panel is open: the page makes room for it
  useEffect(() => {
    fetch("/api/seci/live", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then(setAgent).catch(() => setAgent(null));
  }, []);
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  const agentRunner = useCallback((ctx) => createToolRunner({ ...ctx, getPrices: () => pricesRef.current }), []);

  // the optimizer theatre of the Round-the-Clock tab while HiGHS sizes the plant (from a button or
  // the agent): the tariff surface over solar × wind from the instant What-if (surface.worker.js),
  // HiGHS's live log beside it, its optimum marked when it returns
  const [theatre, setTheatre] = useState(false);
  const feedRef = useRef(null);
  const surfaceRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const startWithTheatre = useCallback(async () => {
    if (sizing.run?.active) return null;
    const st = stateRef.current;
    if (missingInputs(st, terms).length) return sizing.startSizing();
    surfaceRef.current?.terminate();
    const id = Date.now();
    const feed = {
      startedAt: performance.now(), axes: null, cells: [], tcells: [], tariffMode: true, done: false, result: null, error: null, progress: null,
      highs: { active: true, lines: [], progress: null, done: false, result: null, error: null, startedAt: performance.now() },
    };
    feedRef.current = feed;
    setTheatre(true);
    try {
      const worker = new Worker(new URL("./surface.worker.js", import.meta.url), { type: "module" });
      surfaceRef.current = worker;
      worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.id !== id || feedRef.current !== feed) return;
        if (m.type === "axes") feed.axes = m.axes;
        else if (m.type === "cells") { feed.cells.push(...m.cells); feed.tcells.push(...m.cells); }
        else if (m.type === "done" || m.type === "error") worker.terminate();
      };
      worker.postMessage({ id, state: { ...st, lp: null, sizingSeed: null }, prices: pricesRef.current });
    } catch { /* no workers: the theatre shows HiGHS alone */ }
    const lp = await sizing.startSizing();
    if (feedRef.current === feed) {
      const best = lp ? { sizes: lp.sizes, tariff: lp.tariff } : null;
      Object.assign(feed.highs, { done: true, result: best, error: lp ? null : "did not finish", endedAt: performance.now() });
      if (best) { feed.result = { best }; feed.done = true; } else feed.error = "The sizing did not finish: see the Size step.";
      // the surface is a picture: if it is not complete when HiGHS is back, draw what there is
      if (best && !(feed.axes && feed.tcells.length >= feed.axes.solarGrid.length * feed.axes.windGrid.length)) {
        setTimeout(() => {
          if (feedRef.current !== feed || !feed.axes) return;
          const have = new Set(feed.tcells.map((c) => `${c.si}|${c.wi}`));
          for (let si = 0; si < feed.axes.solarGrid.length; si += 1) for (let wi = 0; wi < feed.axes.windGrid.length; wi += 1) {
            if (!have.has(`${si}|${wi}`)) feed.tcells.push({ si, wi, sizes: { solarMw: feed.axes.solarGrid[si], windMw: feed.axes.windGrid[wi] }, z: null, feasible: false });
          }
        }, 6000);
      }
    }
    return lp;
  }, [sizing, terms]);
  // HiGHS's log and Dinkelbach progress into the theatre
  useEffect(() => {
    const f = feedRef.current;
    if (!f || !sizing.run) return;
    f.highs.lines = (sizing.run.log || []).map((l) => ({ stage: l.stage || "highs", msg: l.msg || String(l) }));
    if (sizing.run.iteration) f.highs.progress = { iteration: sizing.run.iteration, lambda: sizing.run.tariff ?? null };
  }, [sizing.run]);
  const closeTheatre = useCallback(() => { surfaceRef.current?.terminate(); feedRef.current = null; setTheatre(false); }, []);
  const cancelTheatre = useCallback(() => { sizing.stopSizing(); closeTheatre(); }, [sizing, closeTheatre]);
  const sizingForAgent = useMemo(() => ({ ...sizing, startSizing: startWithTheatre }), [sizing, startWithTheatre]);

  const team = useTeam(linked?.id || null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamFocus, setTeamFocus] = useState(null);
  const teamCtx = useMemo(() => ({
    ...team,
    openPanel: (id) => { setTeamFocus(id || null); setTeamOpen(true); },
    needSave: () => { setSaveMessage("Name the bid to share it: the whole team then works on this saved bid."); setShowSave(true); },
  }), [team]);
  const teamCount = team.forMe.length + team.toAccept.length;

  useEffect(() => {
    sessionState = state;
    const id = setTimeout(() => {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
    }, 400);
    return () => clearTimeout(id);
  }, [state]);

  const patch = useCallback((section, values) => setState((s) => ({ ...s, [section]: { ...s[section], ...values } })), []);
  const set = useCallback((key, value) => setState((s) => ({ ...s, [key]: value })), []);
  const isLocked = (key) => Boolean(state.locks?.[key]);
  const lockProps = (key) => ({ locked: isLocked(key), onLock: () => setState((s) => ({ ...s, locks: { ...s.locks, [key]: !s.locks?.[key] } })) });
  const goto = useCallback((step) => {
    setState((s) => ({ ...s, step }));
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }, []);

  function buildSave(st = state) {
    const lp = st.lp;
    return {
      inputs: { state: st },
      results: { lp: lp ? { sizes: lp.sizes, tariff: lp.tariff, years: lp.years } : null },
      summary: {
        solarMw: lp?.sizes?.solarMw ?? null, windMw: lp?.sizes?.windMw ?? null, bessMw: lp?.sizes?.bessMw ?? null, bessMwh: lp?.sizes?.bessMwh ?? null,
        tariff: st.forms?.tariff ?? lp?.tariff ?? null, contractedMw: st.bid.baseMw, bidder: st.forms?.bidder || null,
      },
    };
  }

  async function acceptAnswer(a) {
    if (!linked || linked.id !== a.scenario_id) throw new Error("Open this bid from the library to accept answers into it.");
    const next = applyAnswer(state, a);
    const res = await scenarioApi.saveVersion(linked.id, { ...buildSave(next), note: `Accepted from ${a.answer?.by || "the team"}: ${a.target_label}` });
    setState(next);
    setLinked({ ...linked, version: res.version });
    await team.act(a.id, "accept", { version: res.version });
    setSaveMessage(`Accepted “${a.target_label}” from ${a.answer?.by || "the team"}: saved as version ${res.version}.`);
  }

  // a bid file (Export in the heading): the same bid as where it was written; no longer linked to a saved bid
  function importBid(saved, name) {
    sizing.clear();
    setState(fromSaved(saved));
    setLinked(null);
    setSaveMessage(saved?.version === 4 ? `Loaded the bid file “${name}”: every input, the sizing, the forms and letters.` : `“${name}” is a bid of the earlier FDRE-X tab: it opens as a new bid.`);
  }

  function resetAll() {
    if (!window.confirm("Clear your bid, sources, costs, sizing and bid forms in this tab?")) return;
    sizing.clear();
    setState(defaultFdrexBidState());
  }

  // the bid forms see the bid through formsView; their changes (forms, review, letters) come back as they are
  const forms = useMemo(() => formsView(state), [state]);
  const formsModel = state.lp ? { bid: Math.ceil((state.lp.tariff || 0) * 100 - 1e-9) / 100 } : null;
  const designMissing = missing.filter((m) => !m.startsWith("Financing"));
  const financeMissing = missing.filter((m) => m.startsWith("Financing"));
  const mw = state.bid.baseMw;
  const done = {
    documents: true,
    conditions: true,
    bid: Number.isInteger(mw) && mw >= TENDER.bidMinMw && mw <= TENDER.bidMaxMw && Boolean(state.fdrex?.ppaDate),
    sources: designMissing.length === 0,
    financeInputs: missing.length === 0,
    size: Boolean(state.lp),
    finance: Boolean(state.lp),
    whatif: Boolean(state.lp),
    forms: Boolean(state.lp) && formIssues(forms).length === 0 && formatsSummary(forms).reviewed === formatsSummary(forms).needed,
  };
  const summary = {
    documents: `${DOCUMENTS.length} documents`,
    conditions: `${TERMS.length} conditions`,
    bid: mw ? `${nf(mw, 0)} MW` : "Not entered",
    sources: designMissing.length ? `${designMissing.length} input${designMissing.length > 1 ? "s" : ""} needed` : "Design inputs in",
    financeInputs: financeMissing.length ? `${financeMissing.length} input${financeMissing.length > 1 ? "s" : ""} needed` : missing.length ? "Design inputs pending" : "Ready to size",
    size: state.lp ? `₹${nf(state.lp.tariff, 3)}/kWh` : "Not sized",
    finance: state.lp ? "Tariff and returns" : "After sizing",
    whatif: state.lp ? "Tariff levers" : "After sizing",
    forms: `${formatsSummary(forms).reviewed} of ${formatsSummary(forms).needed} formats reviewed`,
  };
  const index = FDREX_STEPS.findIndex((s) => s.id === state.step);
  const step = FDREX_STEPS[Math.max(0, index)];
  const next = FDREX_STEPS[index + 1];
  const prev = FDREX_STEPS[index - 1];
  const props = { state, setState, patch, set, lockProps, isLocked, goto, prices, terms, missing };
  // the bid forms work on formsView(state): their updates (forms, formsReview, letters, the view) are
  // made on that view, so a review's fingerprint is taken on what the forms show, and come back
  // without the view's `inputs`
  const setForms = useCallback((fn) => setState((s) => {
    const { inputs, ...next } = typeof fn === "function" ? fn(formsView(s)) : fn;
    return next;
  }), []);
  // the agent opens the traceable model at a line (explain_generation): the Financial model step shows it
  const [traceAsk, setTraceAsk] = useState(null);
  const onTrace = useCallback((t) => setTraceAsk({ ...t, at: Date.now() }), []);
  useEffect(() => { if (step.id !== "finance") setTraceAsk(null); }, [step.id]);
  const whatIfSeed = useMemo(() => (state.lp ? whatIfFromBid(state, terms) : null), [state, terms]);

  return (
    <TeamContext.Provider value={teamCtx}>
    <div className={`rtc story bid seci fdrex-bid ${docked ? "agent-docked" : ""} ${teamOpen ? "team-docked" : ""}`} data-testid="fdrex-tab">
      <section className="story-hero">
        <div>
          <div className="eyebrow"><MoonStar size={13} /> SECI-FDRE-X · RfS No. {RFS.number}</div>
          <h1 data-testid="fdrex-title">FDRE-X bid · SECI</h1>
          <p>Assured peak supply of 4,800 MWh a day (1,200 MW × 4 hours) from ISTS-connected RE projects with storage. The tender and its amendment, the conditions in force, what you bid, your solar, wind and storage sized by HiGHS against the tender's constraints (the buyer's four hours each day, the monthly 10% tolerance and 1.5 × penalty, bought power within 5%, no sale without connectivity), the financial model with its formula workbook, an instant What-if, and the RfS's bid formats. Talk to the bid agent to go through it by voice.</p>
        </div>
        <div className="story-hero-tools">
          {linked && <span className="rtc-live" data-testid="fdrex-linked">{linked.name} · v{linked.version}</span>}
          <button type="button" className="rtc-reset" onClick={() => setShowSave(true)} data-testid="fdrex-save"><Save size={13} /> Save</button>
          {team.me && (
            <button type="button" className={`rtc-reset team-open ${teamCount ? "has" : ""}`} onClick={() => teamCtx.openPanel(null)} data-testid="fdrex-team" title={`You: ${team.me.name}`}>
              <Users size={13} /> Team{teamCount ? <b>{teamCount}</b> : null}
            </button>
          )}
          <a className="rtc-reset" href={`/scenarios?module=${MODULE}`}><FolderOpen size={13} /> Open</a>
          <BidFileTools state={state} module={MODULE} title="FDRE-X bid · SECI" testid="fdrex" onLoad={importBid} onError={(text) => setSaveMessage(text)} />
          <button type="button" className="rtc-reset" onClick={resetAll} data-testid="fdrex-reset"><RotateCcw size={13} /> Reset inputs</button>
        </div>
      </section>

      {saveMessage && <div className="alert ok" data-testid="fdrex-saved" role="status">{saveMessage}</div>}

      <nav className="bid-steps" aria-label="Steps">
        {FDREX_STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <button key={s.id} type="button" className={`bid-step ${state.step === s.id ? "active" : ""} ${done[s.id] ? "done" : ""}`} style={{ "--chapter": s.color }}
              onClick={() => goto(s.id)} aria-current={state.step === s.id ? "step" : undefined} data-testid={`fdrex-step-${s.id}`}>
              <span className="story-tab-icon"><Icon size={16} /></span>
              <span className="story-tab-text">
                <small>{String(i + 1).padStart(2, "0")}</small>
                <strong>{s.title}</strong>
                <em>{summary[s.id]}</em>
                <i className="bid-step-team">{s.team}</i>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="bid-page" style={{ "--chapter": step.color }} key={step.id}>
        {step.id === "documents" && <DocumentsView pack={TENDER_PACK}><DocumentsStep /></DocumentsView>}
        {step.id === "conditions" && <ConditionsStep state={forms} />}
        {step.id === "bid" && <BidInputs {...props} />}
        {step.id === "sources" && <SourcesStep {...props} startSizing={startWithTheatre} hourly={sizing.hourly} withFinance={false} />}
        {step.id === "financeInputs" && <FinanceInputsStep {...props} startSizing={startWithTheatre} />}
        {step.id === "size" && <SizeStep {...props} run={sizing.run} startSizing={startWithTheatre} stopSizing={sizing.stopSizing} hourly={sizing.hourly} startDispatch15={sizing.startDispatch15} />}
        {step.id === "finance" && <FinanceStep {...props} traceRequest={traceAsk} quoteTariff={state.forms?.tariff ?? null} onQuoteTariff={(v) => setState((s) => ({ ...s, forms: { ...s.forms, tariff: v } }))} />}
        {step.id === "whatif" && <WhatIfTab embedded seed={whatIfSeed} seedKey={state.lp ? `${JSON.stringify(state.lp.sizes)}|${state.lp.tariff}|${JSON.stringify(state.fdrex)}` : ""} onBack={() => goto("finance")} />}
        {step.id === "forms" && <BidForms state={forms} setState={setForms} goto={goto} model={formsModel} index="9" />}
      </div>

      <footer className="story-page-foot bid-foot">
        {prev ? <button type="button" className="secondary" onClick={() => goto(prev.id)}><ChevronLeft size={14} /> {prev.title}</button> : <span />}
        {next && <button type="button" className="primary chapter-next" onClick={() => goto(next.id)} style={{ "--next": next.color }} data-testid="fdrex-next">Next: {next.title} <ArrowRight size={14} /></button>}
      </footer>

      {showSave && (
        <SaveDialog
          module={MODULE}
          linked={linked}
          defaultName={`SECI-FDRE-X · ${state.forms?.bidder || "Bid"} · ${nf(mw || 0, 0)} MW`}
          build={buildSave}
          onSaved={(saved) => { setLinked(saved); setShowSave(false); setSaveMessage(`Saved “${saved.name}” version ${saved.version}: the inputs, the sizing, the particulars and the letters.`); }}
          onClose={() => setShowSave(false)}
        />
      )}
      <LiveAgent tab={MODULE} runner={agentRunner} charts={null} toolWords={FDREX_TOOL_WORDS}
        intro="Talk naturally: it explains the tender and its conditions with their pages, takes your inputs in order, changes anything on screen, sizes the plant with HiGHS, explains the tariff and the returns, tries what-ifs and fills the bid forms. Every number comes from this screen; every tender fact from the documents."
        state={state} setState={setState} terms={terms} goto={goto} sizing={sizingForAgent} info={agent} onDock={setDocked} onTrace={onTrace} />
      {theatre && feedRef.current && (
        <OptimizerTheatre feed={feedRef} onFinish={() => { closeTheatre(); goto("size"); }} onCancel={cancelTheatre} title="HiGHS: the least 25-year tariff for FDRE-X"
          buildSteps={(st) => {
            const total = st.total || 0;
            return [
              [`Instant dispatch of ${st.mapped}/${total || "…"} solar × wind mixes, the best storage at each (the What-if model)`, total > 0 && st.mapped >= total],
              ["HiGHS LP: the buyer's 4 hours, the monthly 10% rule, bought power within 5%, the sale outside the solar hours", Boolean(st.highs?.done)],
              ["Least tariff found: the Financial model prices it exactly", st.phase === "found"],
            ];
          }} />
      )}
      {teamOpen && <TeamPanel team={teamCtx} state={state} bidName={linked?.name} onAccept={acceptAnswer} onClose={() => setTeamOpen(false)} focusId={teamFocus} />}
    </div>
    </TeamContext.Provider>
  );
}

/** The agent's log for this tab's own tools (the rest as the SECI RTC tab says them). */
const FDREX_TOOL_WORDS = {
  ...TOOL_WORDS,
  list_conditions: (a) => (a.group ? `Listed the ${a.group} conditions` : "Listed the condition groups"),
  amendment_changes: () => "Read what Amendment-01 changed",
  what_if: (a, r) => (r?.ok ? `What-if: ₹${r.tariffNeeded}/kWh needed (${r.change >= 0 ? "+" : ""}${r.change} against the sized bid)` : `What-if: ${r?.error || ""}`),
};
