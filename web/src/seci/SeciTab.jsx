import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, CircleDollarSign, ClipboardCheck, FileStack, FlaskConical, FolderOpen, Gavel, Landmark, Layers, ListChecks, RotateCcw, Save, Scale, Trophy, Users, Zap } from "lucide-react";
import SaveDialog from "../scenarios/SaveDialog";
import { scenarioApi } from "../scenarios/client";
import useTeam, { TeamContext } from "../team/useTeam";
import TeamPanel from "../team/TeamPanel";
import { applyAnswer } from "../team/apply";
import { letterOf } from "./letters/index.js";
import { downloadLetters } from "./letters/export.js";
import { nf } from "../rtc/ui";
import { defaultLosses, loadMarketPrices, mergeBidState, missingInputs } from "../bid/model";
import useSizing from "../bid/useSizing";
import SourcesStep from "../bid/SourcesStep";
import SizeStep from "../bid/SizeStep";
import FinanceStep from "../bid/FinanceStep";
import FinanceInputsStep from "../bid/FinanceInputsStep";
import WhatIfTab from "../whatif/WhatIfTab";
import { whatIfFromBid } from "../whatif/model";
import { DEFAULT_SETTINGS, PACK, seciTerms } from "./terms";
import DocumentsStep from "./DocumentsStep";
import ConditionsStep from "./ConditionsStep";
import BidStep from "./BidStep";
import BidForms from "./BidForms";
import { formIssues } from "./forms";
import { formatsSummary } from "./formats";
import LiveAgent from "./LiveAgent";
import WinningBid from "./WinningBid";
import { TENDER, defaultSeciState } from "./state";

export { defaultSeciState };

const STORAGE_KEY = "tenderos.seci.v1";
// the steps, each with the team that owns it (docs/enterprise/ARCHITECTURE.md, section 3)
export const SECI_STEPS = [
  { id: "documents", title: "Tender & amendments", icon: FileStack, color: "#d4ff3f", team: "Tender / Legal" },
  { id: "conditions", title: "Bid conditions", icon: ListChecks, color: "#ff8a5f", team: "Tender / Legal" },
  { id: "bid", title: "Bid inputs", icon: Scale, color: "#4fd1c5", team: "Projects" },
  { id: "sources", title: "Design", icon: Layers, color: "#3fa7d6", team: "Design" },
  { id: "financeInputs", title: "Finance inputs", icon: Landmark, color: "#9ad7a0", team: "Finance" },
  { id: "size", title: "Size", icon: Zap, color: "#f5b83d", team: "Projects" },
  { id: "finance", title: "Financial model", icon: CircleDollarSign, color: "#7ddc9a", team: "Finance" },
  { id: "whatif", title: "What-if", icon: FlaskConical, color: "#ff9fd0", team: "Finance" },
  { id: "forms", title: "Bid forms", icon: ClipboardCheck, color: "#a98bff", team: "Tender / Legal" },
  { id: "winning", title: "Winning bid", icon: Trophy, color: "#ffd166", team: "Projects" },
];

/** A saved bid (this browser's, or one opened from the library) as the tab's state. */
function fromSaved(saved) {
  const merged = mergeBidState(saved);
  return {
    ...merged,
    tender: TENDER,
    step: SECI_STEPS.some((s) => s.id === saved.step) ? saved.step : "documents",
    seci: { ...DEFAULT_SETTINGS, ...(saved.seci || {}) },
    // a bid saved before the losses were asked starts with the defaults
    losses: saved.losses ? { ...defaultLosses(), ...saved.losses } : defaultLosses(),
    forms: saved.forms || {},
    formsReview: saved.formsReview || {},
    letters: saved.letters || {},
    signed: saved.signed || {}, // format id -> the signed copy accepted from the team
    clarifications: saved.clarifications || {}, // condition id -> the team's accepted reading
  };
}

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? fromSaved(JSON.parse(raw)) : defaultSeciState();
  } catch {
    return defaultSeciState();
  }
}

// survive switching dashboard tabs
let sessionState = null;
let sessionLinked = null;
const sizingSession = { hourly: null, run: null };

/**
 * SECI FDRE-RTC-V (issued as RTC-TM-V): the tender and its amendments, the bid conditions in force, what the bidder
 * offers, the supply sources and the HiGHS sizing against the time-block floors (the Tender to Bid
 * steps), the financial model with its formula workbook, the bid forms, and a voice bid agent
 * (GPT-Live) that works through it all on screen.
 */
export default function SeciTab({ initialScenario = null }) {
  const opened = initialScenario?.current?.inputs?.state;
  const [state, setState] = useState(() => (opened ? fromSaved(opened) : sessionState || loadState()));
  // the saved bid this one is a version of (library: Saved scenarios, module "seci")
  const [linked, setLinked] = useState(() => (opened ? { id: initialScenario.scenario.id, name: initialScenario.scenario.name, version: initialScenario.current.version } : sessionLinked));
  const [showSave, setShowSave] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  useEffect(() => { sessionLinked = linked; }, [linked]);
  const [prices, setPrices] = useState(null);
  // the IEX prices pick the Peak Hours of the "costliest hours" plan
  const terms = useMemo(() => seciTerms(state.seci, prices), [state.seci, prices]);
  const missing = useMemo(() => missingInputs(state, terms), [state, terms]);
  const sizing = useSizing({ state, setState, terms, prices, session: sizingSession, module: "seci" });

  // the tender team on the saved bid: assignments, answers, acceptance (src/team)
  const team = useTeam(linked?.id || null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamFocus, setTeamFocus] = useState(null);
  useEffect(() => {
    // a link from a team email: ?open=<bid>&team=<assignment>
    const id = new URLSearchParams(window.location.search).get("team");
    if (id) { setTeamFocus(id === "1" ? null : id); setTeamOpen(true); }
  }, []);
  const teamCtx = useMemo(() => ({
    ...team,
    openPanel: (id) => { setTeamFocus(id || null); setTeamOpen(true); },
    needSave: () => { setSaveMessage("Name the bid to share it: the whole team then works on this saved bid."); setShowSave(true); },
  }), [team]);
  const teamCount = team.forMe.length + team.toAccept.length;

  const [agent, setAgent] = useState(null); // { available, model, backendModel } from /api/seci/live
  const [docked, setDocked] = useState(false); // the agent's panel is open: the page makes room for it
  useEffect(() => { loadMarketPrices().then(setPrices).catch(() => setPrices(null)); }, []);
  useEffect(() => {
    fetch("/api/seci/live", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then(setAgent).catch(() => setAgent(null));
  }, []);
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
        solarMw: lp?.sizes?.solarMw ?? null,
        windMw: lp?.sizes?.windMw ?? null,
        bessMw: lp?.sizes?.bessMw ?? null,
        bessMwh: lp?.sizes?.bessMwh ?? null,
        tariff: st.forms?.tariff ?? lp?.tariff ?? null,
        contractedMw: st.bid.baseMw,
        bidder: st.forms?.bidder || null,
      },
    };
  }

  /** Accept a team member's answer: write it into the bid and save that as a new version. */
  async function acceptAnswer(a) {
    if (!linked || linked.id !== a.scenario_id) throw new Error("Open this bid from the library to accept answers into it.");
    const next = applyAnswer(state, a);
    const res = await scenarioApi.saveVersion(linked.id, { ...buildSave(next), note: `Accepted from ${a.answer?.by || "the team"}: ${a.target_label}` });
    setState(next);
    setLinked({ ...linked, version: res.version });
    await team.act(a.id, "accept", { version: res.version });
    setSaveMessage(`Accepted “${a.target_label}” from ${a.answer?.by || "the team"}: saved as version ${res.version}.`);
  }

  /** The filled letter of a format, for the person asked to sign it. */
  function letterFor(formatId, kind) {
    const format = PACK.formats.find((f) => f.id === formatId);
    const letter = format ? letterOf(state, format) : null;
    if (letter) downloadLetters([letter], kind).catch((err) => window.alert(err.message));
  }

  function resetAll() {
    if (!window.confirm("Clear your bid, sources, costs, sizing and bid forms in this tab?")) return;
    sizing.clear();
    setState(defaultSeciState());
  }

  const designMissing = missing.filter((m) => !m.startsWith("Financing"));
  const financeMissing = missing.filter((m) => m.startsWith("Financing"));
  const done = {
    documents: true,
    conditions: true,
    bid: state.bid.baseMw >= PACK.model.minBidMw && state.bid.baseMw <= PACK.model.maxBidMw,
    sources: designMissing.length === 0,
    financeInputs: missing.length === 0,
    size: Boolean(state.lp),
    finance: Boolean(state.lp),
    whatif: Boolean(state.lp),
    forms: Boolean(state.lp) && formIssues(state).length === 0 && formatsSummary(state).reviewed === formatsSummary(state).needed,
  };
  const summary = {
    documents: `${PACK.documents.filter((d) => d.file).length} documents, ${PACK.changes.length} changes`,
    conditions: `${PACK.conditions.length} conditions`,
    bid: state.bid.baseMw ? `${nf(state.bid.baseMw, 0)} MW` : "Not entered",
    sources: designMissing.length ? `${designMissing.length} input${designMissing.length > 1 ? "s" : ""} needed` : "Design inputs in",
    financeInputs: financeMissing.length ? `${financeMissing.length} input${financeMissing.length > 1 ? "s" : ""} needed` : missing.length ? "Design inputs pending" : "Ready to size",
    size: state.lp ? `₹${nf(state.lp.tariff, 3)}/kWh` : "Not sized",
    finance: state.lp ? "Tariff and returns" : "After sizing",
    whatif: state.lp ? "Tariff levers" : "After sizing",
    forms: `${formatsSummary(state).reviewed} of ${formatsSummary(state).needed} formats reviewed`,
  };
  const index = SECI_STEPS.findIndex((s) => s.id === state.step);
  const step = SECI_STEPS[Math.max(0, index)];
  const next = SECI_STEPS[index + 1];
  const prev = SECI_STEPS[index - 1];
  const props = { state, setState, patch, set, lockProps, isLocked, goto, prices, terms, missing };
  // the agent opens the traceable model at a line (explain_generation): the Financials step shows it
  const [traceAsk, setTraceAsk] = useState(null);
  const onTrace = useCallback((t) => setTraceAsk({ ...t, at: Date.now() }), []);
  // once the user leaves the Financials, coming back does not open it again
  useEffect(() => { if (step.id !== "finance") setTraceAsk(null); }, [step.id]);

  return (
    <TeamContext.Provider value={teamCtx}>
    <div className={`rtc story bid seci ${docked ? "agent-docked" : ""} ${teamOpen ? "team-docked" : ""}`} data-testid="seci-tab">
      <section className="story-hero">
        <div>
          <div className="eyebrow"><Gavel size={13} /> {PACK.short} · RfS No. {PACK.rfsNo}</div>
          <h1>RTC tender · SECI</h1>
          <p>{PACK.title}. The tender and its amendments, the conditions in force, what you bid, your supply sources sized against every block's floor (Peak, Solar and Remaining Hours, Amendment-03), the financial model, and the RfS's bid formats to fill and review. Talk to the bid agent to go through it by voice.</p>
        </div>
        <div className="story-hero-tools">
          {linked && <span className="rtc-live" data-testid="seci-linked">{linked.name} · v{linked.version}</span>}
          <button type="button" className="rtc-reset" onClick={() => setShowSave(true)} data-testid="seci-save"><Save size={13} /> Save</button>
          {team.me && (
            <button type="button" className={`rtc-reset team-open ${teamCount ? "has" : ""}`} onClick={() => teamCtx.openPanel(null)} data-testid="seci-team"
              title={team.me ? `You: ${team.me.name}` : ""}>
              <Users size={13} /> Team{teamCount ? <b data-testid="seci-team-count">{teamCount}</b> : null}
            </button>
          )}
          <a className="rtc-reset" href="/scenarios?module=seci"><FolderOpen size={13} /> Open</a>
          <button type="button" className="rtc-reset" onClick={resetAll}><RotateCcw size={13} /> Reset inputs</button>
        </div>
      </section>

      {saveMessage && <div className="alert ok" data-testid="seci-saved" role="status">{saveMessage}</div>}

      <nav className="bid-steps" aria-label="Steps">
        {SECI_STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <button key={s.id} type="button" className={`bid-step ${state.step === s.id ? "active" : ""} ${done[s.id] ? "done" : ""}`} style={{ "--chapter": s.color }}
              onClick={() => goto(s.id)} aria-current={state.step === s.id ? "step" : undefined} data-testid={`seci-step-${s.id}`}>
              <span className="story-tab-icon"><Icon size={16} /></span>
              <span className="story-tab-text">
                <small>{String(i + 1).padStart(2, "0")}</small>
                <strong>{s.title}</strong>
                <em>{summary[s.id]}</em>
                <i className="bid-step-team" data-testid={`seci-step-team-${s.id}`}>{s.team}</i>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="bid-page" style={{ "--chapter": step.color }} key={step.id}>
        {step.id === "documents" && <DocumentsStep />}
        {step.id === "conditions" && <ConditionsStep state={state} />}
        {step.id === "bid" && <BidStep {...props} />}
        {step.id === "sources" && <SourcesStep {...props} startSizing={sizing.startSizing} hourly={sizing.hourly} withFinance={false} />}
        {step.id === "financeInputs" && <FinanceInputsStep {...props} startSizing={sizing.startSizing} />}
        {step.id === "whatif" && <WhatIfTab embedded seed={state.lp ? whatIfFromBid(state, terms) : null} seedKey={state.lp ? `${JSON.stringify(state.lp.sizes)}|${state.lp.tariff}` : ""} onBack={() => goto("finance")} />}
        {step.id === "size" && <SizeStep {...props} run={sizing.run} startSizing={sizing.startSizing} stopSizing={sizing.stopSizing} hourly={sizing.hourly} startDispatch15={sizing.startDispatch15} />}
        {step.id === "finance" && <FinanceStep {...props} traceRequest={traceAsk} quoteTariff={state.forms?.tariff ?? null} onQuoteTariff={(v) => setState((s) => ({ ...s, forms: { ...s.forms, tariff: v } }))} />}
        {step.id === "forms" && <BidForms {...props} />}
        {step.id === "winning" && <WinningBid {...props} />}
      </div>

      <footer className="story-page-foot bid-foot">
        {prev ? <button type="button" className="secondary" onClick={() => goto(prev.id)}><ChevronLeft size={14} /> {prev.title}</button> : <span />}
        {next && <button type="button" className="primary chapter-next" onClick={() => goto(next.id)} style={{ "--next": next.color }}>Next: {next.title} <ArrowRight size={14} /></button>}
      </footer>

      {showSave && (
        <SaveDialog
          module="seci"
          linked={linked}
          defaultName={`${PACK.short} · ${state.forms?.bidder || "Bid"} · ${nf(state.bid.baseMw || 0, 0)} MW`}
          build={buildSave}
          onSaved={(saved) => { setLinked(saved); setShowSave(false); setSaveMessage(`Saved “${saved.name}” version ${saved.version}: the particulars, every format's blanks, the letters with their edits and the sizing.`); }}
          onClose={() => setShowSave(false)}
        />
      )}

      <LiveAgent state={state} setState={setState} terms={terms} goto={goto} sizing={sizing} info={agent} onDock={setDocked} onTrace={onTrace} />
      {teamOpen && <TeamPanel team={teamCtx} state={state} bidName={linked?.name} onAccept={acceptAnswer} letterFor={letterFor} onClose={() => setTeamOpen(false)} focusId={teamFocus} />}
    </div>
    </TeamContext.Provider>
  );
}
