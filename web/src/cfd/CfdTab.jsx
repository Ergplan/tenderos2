import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BookOpen, ChevronLeft, CircleDollarSign, ClipboardCheck, Factory, FileStack, FlaskConical, FolderOpen, Landmark, ListChecks, RotateCcw, Save, Scale, TrendingUp, Trophy, Users, Zap } from "lucide-react";
import SaveDialog from "../scenarios/SaveDialog";
import { scenarioApi } from "../scenarios/client";
import useTeam, { TeamContext } from "../team/useTeam";
import TeamPanel from "../team/TeamPanel";
import { applyAnswer } from "../team/apply";
import LiveAgent from "../seci/LiveAgent";
import { trackEvent } from "../activity";
import { nf } from "../rtc/ui";
import * as E from "../rtc/engine";
import { loadMarketPrices } from "../bid/model.js";
import * as M from "./model.js";
import { defaultCfdState, fmtDate, mergeCfdState, missingInputs, optimiseOwnRe, runModel, shortDaysByPeriod, sizesItself, sizingKey, STORAGE_KEY } from "./model.js";
import { runCfdFinance } from "./finance.js";
import { RFS, TENDER } from "./terms.js";
import { exampleMw } from "./example.js";
import { createToolRunner } from "./agent.js";
import ExplainStep from "./ExplainStep.jsx";
import DocumentsStep from "./DocumentsStep.jsx";
import ConditionsStep from "./ConditionsStep.jsx";
import BidInputsStep from "./BidInputsStep.jsx";
import DesignStep from "./DesignStep.jsx";
import FinanceInputsStep from "./FinanceInputsStep.jsx";
import SizeStep from "./SizeStep.jsx";
import FinanceModelStep from "./FinanceModelStep.jsx";
import WhatIfStep from "./WhatIfStep.jsx";
import UpsideStep from "./UpsideStep.jsx";
import { OWN_SOLAR_DEFAULTS, OwnSolarCompare, OwnSolarInputs } from "./OwnSolar.jsx";
import BidForms from "./BidForms.jsx";
import ReferenceBids from "./ReferenceBids.jsx";

export const CFD_MODULE = "cfd";
/**
 * The two tabs on this model. "CfD Own Solar" is the same bid and the same steps with two things
 * modelled as an own-solar bidder builds: own RE's cost is spent in the year it is commissioned
 * (not carried from the SCD), and an existing plant can charge the battery at a fixed price for
 * the first months (web/src/cfd/OwnSolar.jsx). Each tab keeps its own bid, in this browser and in
 * the library, so the two can be run side by side and compared.
 */
export const CFD_VARIANTS = {
  cfd: { id: "cfd", module: CFD_MODULE, storageKey: STORAGE_KEY, title: "CfD bid · SECI" },
  ownSolar: { id: "ownSolar", module: "cfdOwnSolar", storageKey: `${STORAGE_KEY}:own-solar`, title: "CfD bid · own solar · SECI" },
};

// the steps, each with the team that owns it (docs/enterprise/ARCHITECTURE.md, section 3)
export const CFD_STEPS = [
  { id: "explain", title: "What is a CfD", icon: BookOpen, color: "#d4ff3f", team: "Tender / Legal" },
  { id: "documents", title: "Tender & amendments", icon: FileStack, color: "#b79cff", team: "Tender / Legal" },
  { id: "conditions", title: "Bid conditions", icon: ListChecks, color: "#ff8a5f", team: "Tender / Legal" },
  { id: "bid", title: "Bid inputs", icon: Scale, color: "#4fd1c5", team: "Projects" },
  { id: "design", title: "Design", icon: Factory, color: "#3fa7d6", team: "Design" },
  { id: "financeInputs", title: "Finance inputs", icon: Landmark, color: "#9ad7a0", team: "Finance" },
  { id: "size", title: "Size", icon: Zap, color: "#f5b83d", team: "Projects" },
  { id: "finance", title: "Financial model", icon: CircleDollarSign, color: "#7ddc9a", team: "Finance" },
  { id: "whatif", title: "What-if", icon: FlaskConical, color: "#ff9fd0", team: "Finance" },
  { id: "forms", title: "Bid forms", icon: ClipboardCheck, color: "#a98bff", team: "Tender / Legal" },
  { id: "reference", title: "Reference bids", icon: Trophy, color: "#ffd166", team: "Projects" },
  { id: "upside", title: "Upside", icon: TrendingUp, color: "#5fe0b7", team: "Finance" },
];
const STEP_IDS = CFD_STEPS.map((s) => s.id);
// the steps of the tab as it was (seven steps): where each one's state goes now
const OLD_STEPS = { model: "explain", example: "explain", terms: "conditions", plant: "design", costs: "financeInputs", operations: "size" };

// the enterprise finance terms and construction settings the full financial model uses (web/src/cfd/finance.js,
// stream B, exports the defaults from model.js; until then the shared engine's)
const FIN_KEYS = ["repayment", "graceYears", "paymentsPerYear", "targetDscr", "balloonPct", "stepUpPct", "refiYear", "refiRate", "refiTenorYears", "refiFeePct", "omStockMonths", "sparesPctOm", "wcInterestRate", "dsraMonths", "receivableDays", "taxDepreciation", "wdvRate", "bookLifeYears", "salvagePct"];
export const FIN_DEFAULTS = M.CFD_FIN_DEFAULTS || Object.fromEntries(FIN_KEYS.map((k) => [k, E.DEFAULT_FINANCE[k]]));
export const COST_DEFAULTS = M.CFD_COST_DEFAULTS || { constructionMonths: 0, drawdown: "linear", drawOrder: "proRata" };

/** The tab's state when nothing is entered: the model's inputs plus everything the steps keep. */
export function defaultTabState(variant = "cfd") {
  const base = defaultCfdState();
  if (variant === "ownSolar") base.inputs = { ...base.inputs, ...OWN_SOLAR_DEFAULTS };
  return {
    ...base,
    step: "explain",
    fin: { ...FIN_DEFAULTS },
    costs: { ...COST_DEFAULTS },
    locks: {},
    tariffLocked: false,
    quoteTariff: null,
    forms: {}, // the particulars and every format's blanks
    formsReview: {}, // format id -> { at, print }
    letters: {}, // format id -> { block index: the bidder's wording }
    signed: {}, // format id -> the signed copy accepted from the team
    clarifications: {}, // condition id -> the team's accepted reading
  };
}

/** A saved bid (this browser's, or one opened from the library) as the tab's state. */
export function fromSaved(saved, variant = "cfd") {
  const base = defaultTabState(variant);
  const merged = mergeCfdState(saved);
  if (variant === "ownSolar") merged.inputs = { ...OWN_SOLAR_DEFAULTS, ...merged.inputs };
  const step = STEP_IDS.includes(saved?.step) ? saved.step : OLD_STEPS[saved?.step] || "explain";
  return {
    ...base,
    ...merged,
    step,
    fin: { ...FIN_DEFAULTS, ...(saved?.fin || {}) },
    costs: { ...COST_DEFAULTS, ...(saved?.costs || {}) },
    locks: saved?.locks || {},
    tariffLocked: Boolean(saved?.tariffLocked),
    quoteTariff: saved?.quoteTariff ?? null,
    forms: saved?.forms || {},
    formsReview: saved?.formsReview || {},
    letters: saved?.letters || {},
    signed: saved?.signed || {},
    clarifications: saved?.clarifications || {},
  };
}

function loadState(variant = "cfd") {
  try {
    const raw = window.localStorage.getItem(CFD_VARIANTS[variant].storageKey);
    return raw ? fromSaved(JSON.parse(raw), variant) : defaultTabState(variant);
  } catch {
    return defaultTabState(variant);
  }
}

/**
 * Accept a team member's answer into the CfD bid: inputs.<key> (a number box of the inputs),
 * fin.<key> and costs.<key> (the finance terms), forms.<key>, format.<id> (a signed copy) and
 * condition.<id> (a clarification) as in the SECI tab (web/src/team/apply.js).
 */
export function acceptIntoState(state, a) {
  const key = a.target_key || "";
  if (key.startsWith("inputs.")) {
    const k = key.slice(7);
    const raw = a.answer?.value;
    const ctx = a.context || {};
    if (raw === null || raw === undefined || raw === "") return state;
    const n = Number(String(raw).replace(/[,₹\s]/g, ""));
    if (!Number.isFinite(n)) throw new Error(`“${raw}” is not a number`);
    const filled = { ...state.filled };
    delete filled[k];
    return { ...state, inputs: { ...state.inputs, [k]: ctx.pct ? n / 100 : n }, filled };
  }
  const next = applyAnswer(state, a);
  if ("lp" in next) delete next.lp; // the SECI apply clears a sizing the CfD tab does not have
  return next;
}

// survive switching dashboard tabs (each tab its own bid)
const session = { cfd: { state: null, linked: null }, ownSolar: { state: null, linked: null } };

/**
 * SECI CfD-I: what a Contract for Difference is, the tender and its amendments, the conditions in
 * force, what the bidder offers, the plant and the finance terms, the own RE sized for the least
 * strike price, the full financial model, the what-ifs, the RfS's bid formats and the auctions that
 * say what a strike price should be. A bid agent works through it by voice.
 */
export default function CfdTab({ initialScenario = null, variant = "cfd" }) {
  const V = CFD_VARIANTS[variant] || CFD_VARIANTS.cfd;
  const own = V.id === "ownSolar";
  const opened = initialScenario?.current?.inputs?.state;
  const [state, setState] = useState(() => (opened ? fromSaved(opened, V.id) : session[V.id].state || loadState(V.id)));
  const [linked, setLinked] = useState(() => (opened ? { id: initialScenario.scenario.id, name: initialScenario.scenario.name, version: initialScenario.current.version } : session[V.id].linked));
  const [showSave, setShowSave] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  useEffect(() => { session[V.id].linked = linked; }, [linked]); // eslint-disable-line react-hooks/exhaustive-deps
  const [prices, setPrices] = useState(null);
  const [priceError, setPriceError] = useState("");
  const [optimising, setOptimising] = useState(null);
  const [message, setMessage] = useState(null);
  const abortRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => { loadMarketPrices().then(setPrices).catch((err) => setPriceError(err.message)); }, []);
  useEffect(() => {
    session[V.id].state = state;
    const id = setTimeout(() => { try { window.localStorage.setItem(V.storageKey, JSON.stringify(state)); } catch { /* storage blocked */ } }, 400);
    return () => clearTimeout(id);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const flush = () => { try { if (session[V.id].state) window.localStorage.setItem(V.storageKey, JSON.stringify(session[V.id].state)); } catch { /* storage blocked */ } };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // the team on the saved bid: assignments, answers, acceptance (src/team)
  const team = useTeam(linked?.id || null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamFocus, setTeamFocus] = useState(null);
  useEffect(() => {
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
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    fetch("/api/seci/live", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then(setAgent).catch(() => setAgent(null));
  }, []);

  const setInput = useCallback((key, value) => setState((s) => {
    const filled = { ...s.filled };
    delete filled[key];
    return { ...s, inputs: { ...s.inputs, [key]: value }, filled };
  }), []);
  const patch = useCallback((section, values) => setState((s) => ({ ...s, [section]: { ...(s[section] || {}), ...values } })), []);
  const set = useCallback((key, value) => setState((s) => ({ ...s, [key]: value })), []);
  const isLocked = useCallback((key) => Boolean(stateRef.current.locks?.[key]), []);
  const lockProps = useCallback((key) => ({ locked: Boolean(stateRef.current.locks?.[key]), onLock: () => setState((s) => ({ ...s, locks: { ...(s.locks || {}), [key]: !s.locks?.[key] } })) }), []);
  const goto = useCallback((step) => {
    setState((s) => ({ ...s, step: STEP_IDS.includes(step) ? step : OLD_STEPS[step] || s.step }));
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }, []);
  const setExample = useCallback((p) => setState((s) => ({ ...s, example: { ...(s.example || {}), ...p } })), []);

  const missing = missingInputs(state);
  // the strike price everywhere on this tab is the full financial model's (the shared engine, the
  // same model the Financial model step and the workbook show); the optimiser sizes on it too
  const pricer = useCallback((inputs, sim) => {
    try {
      return runCfdFinance({ ...stateRef.current, tariffLocked: false }, { inputs, sim, opYears: sim.opYears, sp: null });
    } catch {
      return null;
    }
  }, [state.fin, state.costs]); // eslint-disable-line react-hooks/exhaustive-deps
  // the model: the day-by-day operation and the strike price for the target IRR (about a second)
  const model = useMemo(() => (missing.length || !prices ? null : runModel(state, prices, { price: pricer })), [state.inputs, state.fin, state.costs, prices]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Why no own-RE size meets every day: where the closest plant's short days fall, and what would cure them. */
  const noSizeMeets = (s, best, px) => {
    const i = s.inputs;
    const m = runModel({ ...s, inputs: { ...i, solarMw: best.solarMw, windMw: best.windMw } }, px);
    const p = shortDaysByPeriod(m);
    const d = m?.sim?.dates;
    const parts = [];
    const fixes = [];
    if (p.beforeRe) {
      parts.push(`${nf(p.beforeRe)} before your own RE is online (${fmtDate(d.reCod)}), when only bought power${i.bilateralMonths > 0 ? " or your existing plant" : ""} may charge the battery${i.useMarket ? "" : " and the green market is switched off"}`);
      fixes.push(i.useMarket ? "bring the RE forward (Design)" : "switch on green-market power (Bid inputs) or bring the RE forward (Design)");
    }
    if (p.beforeExtraEnd) parts.push(`${nf(p.beforeExtraEnd)} before month 36 from the Effective Date (${fmtDate(d.extraUntil)}), when group-company RE may not yet charge it`);
    if (p.after) {
      parts.push(`${nf(p.after)} after it, with the green market${i.useMarket ? " at 25%" : " switched off"} and group-company RE${i.useGroup ? " at 50%" : " not used"} of the year's energy`);
      if (!i.useMarket) fixes.push("switch on green-market power");
      if (!i.useGroup) fixes.push("allow group-company RE");
      fixes.push("more battery or wind for cloudy runs");
    }
    fixes.push("set the policy to pay the penalty");
    return `No own-RE size meets every day's supply within the sourcing limits: the closest is solar ${nf(best.solarMw)} MWac${best.windMw ? ` with ${nf(best.windMw)} MW of wind` : ""}, short on ${nf(best.shortDays)} days (${parts.join("; ")}). ${p.beforeRe && !p.after && !p.beforeExtraEnd ? "More solar cannot cure them: " : "To meet every day: "}${[...new Set(fixes)].join(", or ")}.`;
  };
  // the own-RE sizing: run by the button, by "Fill up for me please", and by the tab itself whenever an
  // input the size depends on changes (sizingKey), unless the size is the bidder's own (sizesItself)
  const runningKey = useRef(null);
  const optimise = useCallback(async (opts) => {
    const auto = opts?.auto === true; // the button passes its click event: not an automatic run
    const s = stateRef.current;
    if (!prices || abortRef.current || missingInputs(s).length) return null;
    const abort = new AbortController();
    abortRef.current = abort;
    const key = sizingKey(s);
    runningKey.current = key;
    setOptimising({ done: 0, total: 1, auto });
    if (!auto) setMessage(null);
    try {
      const best = await optimiseOwnRe(s, prices, { signal: abort.signal, price: pricer, onProgress: (done, total) => setOptimising({ done, total, auto }) });
      trackEvent("optimize", { module: V.module, contractedMw: s.inputs.contractedMw, auto });
      setState((st) => {
        const filled = { ...st.filled };
        delete filled.solarMw;
        delete filled.windMw;
        return { ...st, inputs: { ...st.inputs, solarMw: best.solarMw, windMw: best.windMw }, filled, sizeAuto: true, sized: { solarMw: best.solarMw, windMw: best.windMw, sp: best.sp, policy: best.policy, at: new Date().toISOString(), key } };
      });
      const said = best.policy === "pay"
        ? { ok: true, text: `Own RE optimised on the strike price alone (policy: pay the penalty): solar ${nf(best.solarMw)} MWac${best.windMw ? `, wind ${nf(best.windMw)} MW` : ""} gives ₹${best.sp.toFixed(4)}/kWh${best.ok ? ", with every day's supply met" : `, with ${nf(best.short, 0)} MWh of shortfall over the term paid for as penalty`}.` }
        : best.ok
          ? { ok: true, text: `Own RE optimised (policy: meet every day): solar ${nf(best.solarMw)} MWac${best.windMw ? `, wind ${nf(best.windMw)} MW` : ""} gives the lowest strike price, ₹${best.sp.toFixed(4)}/kWh, with every day's supply met.` }
          : { ok: false, text: noSizeMeets(s, best, prices) };
      setMessage({ ...said, text: auto ? `Sized again for the changed inputs. ${said.text}` : said.text });
      return best;
    } catch (err) {
      // a run overtaken by a newer input is restarted for it without a word; one the bidder stopped hands the size to them
      if (abort.signal.reason !== "restart") setMessage({ ok: false, text: abort.signal.reason === "user" ? "Sizing stopped: the own RE stays as it is and is now your size. Optimise own RE sizes it again and hands it back to the model." : err.message });
      return null;
    } finally {
      setOptimising(null);
      abortRef.current = null;
      runningKey.current = null;
    }
  }, [prices]);
  const stopOptimise = useCallback(() => {
    if (!abortRef.current) return;
    abortRef.current.abort("user");
    setState((s) => ({ ...s, sizeAuto: false }));
  }, []);
  // a size the bidder sets (typed, by the agent, a What-if move, an Upside plan) is theirs: the tab no
  // longer sizes it; the fill's first guess and the optimiser's own result are not
  const sizeKey = sizingKey(state);
  useEffect(() => {
    const z = state.sized;
    if (!z || state.sizeAuto === false || state.filled?.solarMw) return;
    if (z.solarMw !== state.inputs.solarMw || (z.windMw || 0) !== (state.inputs.windMw || 0)) setState((s) => ({ ...s, sizeAuto: false }));
  }, [state.inputs.solarMw, state.inputs.windMw]); // eslint-disable-line react-hooks/exhaustive-deps
  // size the own RE again for changed inputs, a moment after the last change; a run for inputs since
  // changed is stopped and started again for the new ones
  useEffect(() => {
    const z = state.sized;
    const current = z && z.key === sizeKey && z.solarMw === state.inputs.solarMw && (z.windMw || 0) === (state.inputs.windMw || 0);
    if (!sizesItself(state) || !prices || missing.length || current) return undefined;
    if (abortRef.current) {
      if (runningKey.current !== sizeKey) abortRef.current.abort("restart");
      return undefined;
    }
    const id = setTimeout(() => { optimise({ auto: true }); }, 1500);
    return () => clearTimeout(id);
  }, [sizeKey, state.sizeAuto, state.locks?.solarMw, state.inputs.solarMw, state.inputs.windMw, prices, missing.length, optimising === null]); // eslint-disable-line react-hooks/exhaustive-deps
  // the sizing as the agent and the Finance inputs step see it
  const sizing = useMemo(() => ({
    startSizing: optimise,
    stopSizing: stopOptimise,
    run: optimising ? { active: true, ...optimising } : null,
    hourly: null,
    clear: () => {},
  }), [optimise, stopOptimise, optimising]);

  function buildSave(st = state) {
    const i = st.inputs;
    const m = st === state ? model : null;
    return {
      inputs: { state: st },
      results: { sp: m?.sp ?? null, bid: m?.bid ?? null, solarMw: i.solarMw ?? null, windMw: i.windMw ?? null },
      summary: {
        contractedMw: i.contractedMw ?? null,
        solarMw: i.solarMw ?? null,
        windMw: i.windMw ?? null,
        bessMw: Number.isFinite(i.contractedMw) && Number.isFinite(i.essMwPerMw) ? i.contractedMw * i.essMwPerMw : null,
        bessMwh: Number.isFinite(i.contractedMw) && Number.isFinite(i.essMwhPerMw) ? i.contractedMw * i.essMwhPerMw : null,
        tariff: st.quoteTariff ?? m?.bid ?? null,
        bidder: st.forms?.bidder || null,
      },
    };
  }

  /** Accept a team member's answer: write it into the bid and save that as a new version. */
  async function acceptAnswer(a) {
    if (!linked || linked.id !== a.scenario_id) throw new Error("Open this bid from the library to accept answers into it.");
    const next = acceptIntoState(state, a);
    const res = await scenarioApi.saveVersion(linked.id, { ...buildSave(next), note: `Accepted from ${a.answer?.by || "the team"}: ${a.target_label}` });
    setState(next);
    setLinked({ ...linked, version: res.version });
    await team.act(a.id, "accept", { version: res.version });
    setSaveMessage(`Accepted “${a.target_label}” from ${a.answer?.by || "the team"}: saved as version ${res.version}.`);
  }

  function resetAll() {
    if (!window.confirm("Clear your CfD bid: inputs, finance terms, forms and letters in this tab?")) return;
    stopOptimise();
    setState(defaultTabState(V.id));
    setMessage(null);
  }

  const i = state.inputs;
  const designMissing = missing.filter((m) => !/capex|O&M|IRR|Debt|Interest|tenor|tax|Insurance|escalation|Pre-operative|fee|Discount|depreciation|Letter|guarantee|GST|Transmission|REC|price|Charges/i.test(m));
  const financeMissing = missing.filter((m) => !designMissing.includes(m));
  const sized = Boolean(model?.sp);
  const done = {
    explain: true,
    documents: true,
    conditions: true,
    bid: Number.isInteger(i.contractedMw) && i.contractedMw >= TENDER.bidMinMw && i.contractedMw <= TENDER.bidMaxMw && Boolean(i.effectiveDate),
    design: designMissing.length === 0,
    financeInputs: missing.length === 0,
    size: sized,
    finance: sized,
    whatif: sized,
    upside: sized,
    forms: sized && Boolean(state.forms?.bidder),
    reference: true,
  };
  const summary = {
    explain: `${nf(exampleMw(state))} MW, step by step`,
    documents: "RfS, CfDA, Amendments 01–04",
    conditions: "From the RfS, CfDA and amendments",
    bid: i.contractedMw ? `${nf(i.contractedMw)} MW` : "Not entered",
    design: designMissing.length ? `${designMissing.length} input${designMissing.length > 1 ? "s" : ""} needed` : `${nf(i.solarMw || 0)} MW solar${i.windMw ? `, ${nf(i.windMw)} MW wind` : ""}`,
    financeInputs: financeMissing.length ? `${financeMissing.length} input${financeMissing.length > 1 ? "s" : ""} needed` : missing.length ? "Design inputs pending" : "Ready to size",
    size: optimising ? `Optimising ${optimising.done}/${optimising.total}` : sized ? `₹${nf(model.sp, 3)}/kWh` : "Not sized",
    finance: sized ? "Strike price and returns" : "After sizing",
    whatif: sized ? "Strike price levers" : "After sizing",
    upside: sized ? "More solar and battery, sold on the exchange" : "After sizing",
    forms: state.forms?.bidder ? "Particulars in" : "RfS formats to fill",
    reference: "SECI's auction results",
  };
  const index = CFD_STEPS.findIndex((s) => s.id === state.step);
  const step = CFD_STEPS[Math.max(0, index)];
  const next = CFD_STEPS[index + 1];
  const prev = CFD_STEPS[index - 1];
  const props = { state, setState, setInput, patch, set, lockProps, isLocked, goto, prices, model, missing, optimise };
  // the agent opens the traceable model at a line: the Financial model step shows it
  const [traceAsk, setTraceAsk] = useState(null);
  const onTrace = useCallback((t) => setTraceAsk({ ...t, at: Date.now() }), []);
  useEffect(() => { if (step.id !== "finance") setTraceAsk(null); }, [step.id]);
  const agentRunner = useCallback((ctx) => createToolRunner({ ...ctx, getPrices: () => prices, getModel: () => (missingInputs(ctx.getState()).length || !prices ? null : runModel(ctx.getState(), prices, { price: pricer })) }), [prices, pricer]);

  return (
    <TeamContext.Provider value={teamCtx}>
    <div className={`rtc story bid cfd ${docked ? "agent-docked" : ""} ${teamOpen ? "team-docked" : ""}`} data-testid="cfd-tab">
      <section className="story-hero">
        <div>
          <div className="eyebrow"><Scale size={13} /> SECI CfD-I · RfS No. {RFS.number}</div>
          <h1 data-testid="cfd-title">{V.title}</h1>
          <p>Assured peak supply of 1,000 MWh a day (500 MW × 2 hours) through the power exchanges under a Contract for Difference. What a CfD is, the tender and its amendments, the conditions in force, what you bid, your plant and finance terms, the own RE sized for the lowest strike price, the full financial model, the what-ifs, the RfS's formats and the auctions that say what a strike price should be. Talk to the bid agent to go through it by voice.</p>
        </div>
        <div className="story-hero-tools">
          {linked && <span className="rtc-live" data-testid="cfd-linked">{linked.name} · v{linked.version}</span>}
          <button type="button" className="rtc-reset" onClick={() => setShowSave(true)} data-testid="cfd-save"><Save size={13} /> Save</button>
          {team.me && (
            <button type="button" className={`rtc-reset team-open ${teamCount ? "has" : ""}`} onClick={() => teamCtx.openPanel(null)} data-testid="cfd-team" title={`You: ${team.me.name}`}>
              <Users size={13} /> Team{teamCount ? <b data-testid="cfd-team-count">{teamCount}</b> : null}
            </button>
          )}
          <a className="rtc-reset" href={`/scenarios?module=${V.module}`}><FolderOpen size={13} /> Open</a>
          <button type="button" className="rtc-reset" onClick={resetAll} data-testid="cfd-reset"><RotateCcw size={13} /> Reset inputs</button>
        </div>
      </section>

      {saveMessage && <div className="alert ok" data-testid="cfd-saved" role="status">{saveMessage}</div>}
      {priceError && <div className="alert">IEX prices could not be loaded ({priceError}); the operations and the strike price need them.</div>}
      {message && <div className={message.ok ? "bid-mode" : "alert"} data-testid="cfd-message">{message.text}</div>}

      <nav className="bid-steps cfd-steps" aria-label="Steps">
        {CFD_STEPS.map((s, k) => {
          const Icon = s.icon;
          return (
            <button key={s.id} type="button" className={`bid-step ${state.step === s.id ? "active" : ""} ${done[s.id] ? "done" : ""}`} style={{ "--chapter": s.color }}
              onClick={() => goto(s.id)} aria-current={state.step === s.id ? "step" : undefined} data-testid={`cfd-step-${s.id}`}>
              <span className="story-tab-icon"><Icon size={16} /></span>
              <span className="story-tab-text">
                <small>{String(k + 1).padStart(2, "0")}</small>
                <strong>{s.title}</strong>
                <em>{summary[s.id]}</em>
                <i className="bid-step-team" data-testid={`cfd-step-team-${s.id}`}>{s.team}</i>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="bid-page" style={{ "--chapter": step.color }} key={step.id}>
        {step.id === "explain" && <ExplainStep state={state} prices={prices} model={model} setExample={setExample} goto={goto} />}
        {step.id === "documents" && <DocumentsStep />}
        {step.id === "conditions" && <ConditionsStep state={state} />}
        {step.id === "bid" && <BidInputsStep {...props} />}
        {step.id === "bid" && own && <OwnSolarInputs state={state} setState={setState} otherKey={CFD_VARIANTS.cfd.storageKey} fromSaved={(saved) => fromSaved(saved, "ownSolar")} />}
        {step.id === "finance" && own && model?.sim && <OwnSolarCompare state={state} model={model} prices={prices} otherKey={CFD_VARIANTS.cfd.storageKey} fromSaved={(saved) => fromSaved(saved, "cfd")} goto={goto} />}
        {step.id === "design" && <DesignStep {...props} optimise={optimise} optimising={optimising} stopOptimise={stopOptimise} model={model} />}
        {step.id === "financeInputs" && <FinanceInputsStep {...props} startSizing={optimise} />}
        {step.id === "size" && <SizeStep {...props} optimise={optimise} optimising={optimising} stopOptimise={stopOptimise} />}
        {step.id === "finance" && <FinanceModelStep {...props} traceRequest={traceAsk} quoteTariff={state.quoteTariff ?? null} onQuoteTariff={(v) => setState((s) => ({ ...s, quoteTariff: v, forms: { ...(s.forms || {}), tariff: v } }))} />}
        {step.id === "whatif" && <WhatIfStep {...props} />}
        {step.id === "upside" && <UpsideStep {...props} />}
        {step.id === "forms" && <BidForms {...props} />}
        {step.id === "reference" && <ReferenceBids state={state} model={model} />}
      </div>

      <footer className="story-page-foot bid-foot">
        {prev ? <button type="button" className="secondary" onClick={() => goto(prev.id)}><ChevronLeft size={14} /> {prev.title}</button> : <span />}
        {next && <button type="button" className="primary chapter-next" onClick={() => goto(next.id)} style={{ "--next": next.color }} data-testid="cfd-next">Next: {next.title} <ArrowRight size={14} /></button>}
      </footer>

      {showSave && (
        <SaveDialog
          module={V.module}
          linked={linked}
          defaultName={`SECI CfD-I · ${state.forms?.bidder || "Bid"} · ${nf(i.contractedMw || 0)} MW`}
          build={buildSave}
          onSaved={(saved) => { setLinked(saved); setShowSave(false); setSaveMessage(`Saved “${saved.name}” version ${saved.version}: the inputs, the finance terms, the particulars and the letters.`); }}
          onClose={() => setShowSave(false)}
        />
      )}

      <LiveAgent tab={CFD_MODULE} runner={agentRunner} charts={null} toolWords={CFD_TOOL_WORDS} energyCheck={false}
        intro="Talk naturally: it explains what a CfD is and the bid conditions with their pages, takes your inputs in order, changes anything on screen, sizes the own RE again and explains the strike price and the returns. Every number comes from this screen; every tender fact from the documents."
        state={state} setState={setState} terms={null} goto={goto} sizing={sizing} info={agent} onDock={setDocked} onTrace={onTrace} />
      {teamOpen && <TeamPanel team={teamCtx} state={state} bidName={linked?.name} onAccept={acceptAnswer} letterFor={null} onClose={() => setTeamOpen(false)} focusId={teamFocus} />}
    </div>
    </TeamContext.Provider>
  );
}

/** What the agent's log says for each CfD tool. */
const CFD_TOOL_WORDS = {
  get_status: () => "Read the bid on screen",
  tender_brief: () => "Read the key conditions",
  tender_lookup: (a) => `Looked up “${a.query}” in the tender`,
  list_conditions: () => "Listed the conditions in force",
  amendment_changes: (a) => `Read what ${a.amendment || "the amendments"} changed`,
  explain_cfd: () => "Explained the CfD",
  next_question: () => "Next input",
  list_inputs: (a) => `Listed the ${a.part} inputs`,
  set_input: (a, r) => (r?.ok ? `Set ${a.key} → ${r.value}` : `Could not set ${a.key}: ${r?.error || ""}`),
  use_benchmarks: () => "Filled the benchmarks",
  go_to_step: (a) => `Showed ${a.step}`,
  run_optimizer: (a, r) => (r?.ok ? "Sized the own RE for the lowest strike price" : `Sizing: ${r?.error || "did not run"}`),
  stop_optimizer: () => "Stopped the sizing",
  get_results: () => "Read the results",
  get_financials: () => "Read the financial model",
  check_tariff: (a, r) => (r?.ok ? `Checked ₹${a.tariff}/kWh: equity IRR ${r.equityIrrPct}%, project IRR ${r.projectIrrPct}%` : `Strike price check: ${r?.error || ""}`),
};
