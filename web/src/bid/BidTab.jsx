import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronLeft, CircleDollarSign, FilePlus2, FileSearch, Gavel, Layers, RotateCcw, Scale, X, Zap } from "lucide-react";
import { trackEvent } from "../activity";
import { nf } from "../rtc/ui";
import { defaultBidMw, defaultBidState, loadMarketPrices, mergeBidState, missingInputs, capacityIssues, plantMw } from "./model";
import useSizing from "./useSizing";
import { mergeReadings, sizingScope, tenderDates, tenderTerms } from "./tenderMap";
import ScopeNotice from "./ScopeNotice";
import { handOff } from "../handoff";
import TenderStep from "./TenderStep";
import StartScreen, { PREFILLED_TENDER } from "./StartScreen";
import ScanStage from "./ScanStage";
import { getJson, openSavedTender, readTenderFile, readTenderSet } from "./readTender";
import CapacityStep from "./CapacityStep";
import DatesStep from "./DatesStep";
import SourcesStep from "./SourcesStep";
import SizeStep from "./SizeStep";
import FinanceStep from "./FinanceStep";

const STORAGE_KEY = "fdre.bid.v4";
const STEPS = [
  { id: "tender", title: "Tender", icon: FileSearch, color: "#d4ff3f" },
  { id: "dates", title: "Key dates", icon: CalendarDays, color: "#ff8a5f" },
  { id: "capacity", title: "Bid capacity", icon: Scale, color: "#4fd1c5" },
  { id: "sources", title: "Supply sources", icon: Layers, color: "#3fa7d6" },
  { id: "size", title: "Size", icon: Zap, color: "#f5b83d" },
  { id: "finance", title: "Financials", icon: CircleDollarSign, color: "#7ddc9a" },
];

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? mergeBidState(JSON.parse(raw)) : defaultBidState();
  } catch {
    return defaultBidState();
  }
}

// survive switching dashboard tabs; the hour-by-hour dispatch is kept only for the session
let sessionState = null;
const sizingSession = { hourly: null, run: null };
// where the journey is (start screen, scan, workflow): the start screen first on each visit
let sessionView = null;
// the last uploaded file, in memory only (handed to the BESS tender tab on request)
let lastUpload = null;

/** The prefilled simulation's tender, with the latest model reading of it merged in when there is one. */
async function loadPrefilled() {
  const { tenders } = await getJson("/api/tenders");
  const item = (tenders || []).find((t) => t.seed_key === PREFILLED_TENDER);
  if (!item) throw new Error("The prefilled tender is not available on this server.");
  // the latest model reading of the same tender fills the fields the rule-based reading has not
  const modelItem = (tenders || []).filter((t) => t.mode === "llm" && t.tender_number && t.tender_number === item.tender_number)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const tender = await openSavedTender(item.id);
  const model = modelItem ? await openSavedTender(modelItem.id) : null;
  const result = model ? mergeReadings(tender.result, model.result) : tender.result;
  return { ...tender, result, baseResult: tender.result, modelId: model?.savedId || null, seedKey: PREFILLED_TENDER };
}

/**
 * Tender to Bid: a start screen (upload any tender, or the prefilled simulation), the scan
 * screen while a new tender is read, then the tender's requirements, the capacity bid, the
 * bidder's supply sources with their parameters and costs, the least-tariff sizing that meets
 * every requirement, and the bid's financial model.
 */
export default function BidTab({ user = null, openTab = null }) {
  const [state, setState] = useState(() => sessionState || loadState());
  const [message, setMessage] = useState("");
  const [prices, setPrices] = useState(null);
  const [view, setViewState] = useState(() => sessionView || "start");
  const [scan, setScan] = useState(null); // { id, file, opts, job, outcome, error }
  const [startError, setStartError] = useState("");
  const scanId = useRef(0);
  const setView = useCallback((v) => { sessionView = v; setViewState(v); window.scrollTo?.({ top: 0 }); }, []);

  const terms = useMemo(() => tenderTerms(state.tender?.result, state.accepted || {}), [state.tender, state.accepted]);
  const missing = useMemo(() => missingInputs(state, terms), [state, terms]);
  const { hourly, setHourly, run, startSizing, stopSizing, startDispatch15, clear: clearSizing } = useSizing({ state, setState, terms, prices, session: sizingSession, module: "bid" });

  // IEX price year for market sales (public market data, loaded once)
  useEffect(() => {
    loadMarketPrices().then(setPrices).catch(() => setPrices(null));
  }, []);

  useEffect(() => {
    sessionState = state;
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* storage full or blocked: the tab still works for this session */
      }
    }, 400);
    return () => clearTimeout(id);
  }, [state]);
  // a reload or tab close within the save delay still keeps the last change
  useEffect(() => {
    const flush = () => {
      try {
        if (sessionState) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionState));
      } catch {
        /* storage full or blocked */
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // edits on Financials re-price the same plant; Supply sources clears the sizing itself
  const patch = useCallback((section, values) => setState((s) => ({ ...s, [section]: { ...s[section], ...values } })), []);
  const set = useCallback((key, value) => setState((s) => ({ ...s, [key]: value })), []);
  const isLocked = (key) => Boolean(state.locks?.[key]);
  const lockProps = (key) => ({ locked: isLocked(key), onLock: () => setState((s) => ({ ...s, locks: { ...s.locks, [key]: !s.locks?.[key] } })) });
  const goto = (step) => {
    set("step", step);
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };

  // a model reading of the open tender: merged into it (rule-based fields kept, the rest filled)
  function onModelRead(modelResult, modelId) {
    setState((s) => {
      const base = s.tender?.baseResult || s.tender?.result;
      return { ...s, tender: { ...s.tender, baseResult: base, result: mergeReadings(base, modelResult), modelId }, lp: null };
    });
  }

  function onRead(tender) {
    trackEvent("run", { module: "bid", action: "tender-read", mode: tender.result?.mode, type: tender.result?.tender_type });
    // a new tender opens with its own bid capacity (not the previous tender's)
    const fresh = tenderTerms(tender.result);
    setState((s) => ({ ...s, tender, accepted: {}, lp: null, step: "tender", bid: { ...s.bid, baseMw: defaultBidMw(fresh), greenshoe: fresh.greenshoeMw ? null : false } }));
    setHourly(null);
    setMessage("");
  }

  /** Read an uploaded tender on the scan screen; the scan opens the workflow when it closes. */
  function startUpload(upload, opts) {
    const id = ++scanId.current;
    const files = Array.isArray(upload) ? upload : [upload];
    const isSet = files.length > 1;
    lastUpload = isSet ? null : files[0];
    setStartError("");
    // a set shows on the scan screen as one item; the RfS's name replaces it once read
    const file = isSet ? { name: `tender set (${files.length} documents)`, size: files.reduce((n, f) => n + f.size, 0) } : files[0];
    setScan({ id, file, opts, job: null, outcome: null, error: null });
    setView("scan");
    const mine = (fn) => setScan((sc) => (sc && sc.id === id ? fn(sc) : sc));
    const read = isSet ? readTenderSet : (f, o) => readTenderFile(f[0], o);
    read(files, { mode: opts.mode, type: opts.type, onUpdate: (job) => mine((sc) => ({ ...sc, job })), isCancelled: () => scanId.current !== id })
      .then((outcome) => { if (outcome) mine((sc) => ({ ...sc, outcome })); })
      .catch((err) => mine((sc) => ({ ...sc, error: err.message })));
  }

  const scanRef = useRef(null);
  scanRef.current = scan;
  function finishScan() {
    const sc = scanRef.current;
    if (sc?.outcome) onRead({ name: sc.outcome.name || sc.file.name, readAt: new Date().toISOString(), result: sc.outcome.result, savedId: sc.outcome.savedId });
    setScan(null);
    setView(sc?.outcome ? "work" : "start");
  }

  function cancelScan() {
    scanId.current += 1;
    setScan(null);
    setView("start");
  }

  /** The start screen opens a tender read before: the prefilled simulation or a saved reading. */
  async function openFromStart(item, how) {
    const tender = how === "prefilled" ? await loadPrefilled() : await openSavedTender(item.id);
    onRead(tender);
    setView("work");
  }

  function resetAll() {
    if (!window.confirm("Clear your bid capacity, sources, costs and the sizing in Tender to Bid? The tender and your pre-bid queries stay.")) return;
    clearSizing();
    setState((s) => ({ ...defaultBidState(), tender: s.tender, prebid: s.prebid }));
    setMessage("");
  }

  const dates = tenderDates(state.tender?.result);
  const today = new Date().toISOString().slice(0, 10);
  const nextDate = dates.find((d) => d.date >= today);
  const done = {
    tender: Boolean(state.tender),
    dates: dates.length > 0,
    capacity: capacityIssues(state, terms).length === 0,
    sources: missing.length === 0,
    size: Boolean(state.lp),
    finance: false,
  };
  const total = plantMw(state, terms);
  const scope = sizingScope(state.tender?.result);
  const sizingStep = (id) => ["capacity", "sources", "size", "finance"].includes(id);
  const summary = {
    tender: state.tender ? (state.tender.result?.values?.["core.identity.tender_number"] || state.tender.name) : "No tender",
    dates: nextDate ? `Next: ${nextDate.label.toLowerCase()} ${nextDate.date.split("-").reverse().join(".")}` : dates.length ? `${dates.length} date${dates.length > 1 ? "s" : ""}` : "No dates",
    capacity: total ? `${nf(total, 0)} MW${state.bid.greenshoe ? " incl. greenshoe" : ""}` : "Not entered",
    sources: missing.length ? `${missing.length} input${missing.length > 1 ? "s" : ""} needed` : `${Object.values(state.sources).filter(Boolean).length} sources ready`,
    size: state.lp ? `₹${nf(state.lp.tariff, 3)}/kWh` : "Not sized",
    finance: state.lp ? "Bid tariff and returns" : "After sizing",
  };
  if (!scope.applies) for (const id of ["capacity", "sources", "size", "finance"]) { summary[id] = scope.kind === "bess" ? "In the BESS tab" : "Not for this tender"; done[id] = false; }
  const fileInMemory = Boolean(lastUpload && state.tender && lastUpload.name === state.tender.name);
  const bessAllowed = !user?.allowedTabs || user.allowedTabs.includes("bessTender");
  const openBessTab = openTab && bessAllowed ? () => { if (fileInMemory) handOff(lastUpload); openTab("bessTender"); } : null;

  const index = STEPS.findIndex((s) => s.id === state.step);
  const step = STEPS[Math.max(0, index)];
  const next = STEPS[index + 1];
  const prev = STEPS[index - 1];
  const props = { state, setState, patch, set, lockProps, isLocked, goto, user, prices, terms, missing };

  if (view === "scan" && scan) {
    return (
      <ScanStage key={scan.id} file={scan.file} job={scan.job} outcome={scan.outcome} error={scan.error}
        onFinish={finishScan} onRetry={() => startUpload(scan.file, scan.opts)} onCancel={cancelScan} />
    );
  }
  if (view !== "work" || !state.tender) {
    return (
      <div className="rtc story bid">
        <StartScreen current={state.tender ? state : null} onUpload={startUpload} onOpenSaved={openFromStart}
          onContinue={() => setView("work")} error={startError} />
      </div>
    );
  }

  return (
    <div className="rtc story bid">
      <section className="story-hero">
        <div>
          <div className="eyebrow"><Gavel size={13} /> Tender to bid · {summary.tender}</div>
          <h1>Tender to bid</h1>
          <p>What the tender requires, the capacity you bid, the sources you have with their costs, the least-tariff plant that meets every requirement, and the bid's financial model.</p>
        </div>
        <div className="story-hero-tools">
          <button type="button" className="rtc-reset" onClick={() => setView("start")} data-testid="bid-new-tender-top"><FilePlus2 size={13} /> New tender</button>
          <button type="button" className="rtc-reset" onClick={resetAll}><RotateCcw size={13} /> Reset inputs</button>
        </div>
      </section>

      {message && (
        <div className="alert">
          {message}
          <button type="button" className="rtc-icon-btn" onClick={() => setMessage("")} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      <nav className="bid-steps" aria-label="Steps">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <button key={s.id} type="button" className={`bid-step ${state.step === s.id ? "active" : ""} ${done[s.id] ? "done" : ""}`} style={{ "--chapter": s.color }}
              onClick={() => goto(s.id)} aria-current={state.step === s.id ? "step" : undefined} data-testid={`bid-step-${s.id}`}>
              <span className="story-tab-icon"><Icon size={16} /></span>
              <span className="story-tab-text">
                <small>{String(i + 1).padStart(2, "0")}</small>
                <strong>{s.title}</strong>
                <em>{summary[s.id]}</em>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="bid-page" style={{ "--chapter": step.color }} key={step.id}>
        {step.id === "tender" && <TenderStep {...props} onRead={onRead} onModelRead={onModelRead} onNewTender={() => setView("start")} />}
        {step.id === "dates" && <DatesStep {...props} />}
        {!scope.applies && sizingStep(step.id) && <ScopeNotice scope={scope} goto={goto} openBess={openBessTab} openCfd={openTab ? () => openTab("cfd") : null} fileInMemory={fileInMemory} />}
        {scope.applies && step.id === "capacity" && <CapacityStep {...props} />}
        {scope.applies && step.id === "sources" && <SourcesStep {...props} startSizing={startSizing} />}
        {scope.applies && step.id === "size" && <SizeStep {...props} run={run} startSizing={startSizing} stopSizing={stopSizing} hourly={hourly} startDispatch15={startDispatch15} />}
        {scope.applies && step.id === "finance" && <FinanceStep {...props} />}
      </div>

      <footer className="story-page-foot bid-foot">
        {prev ? <button type="button" className="secondary" onClick={() => goto(prev.id)}><ChevronLeft size={14} /> {prev.title}</button> : <span />}
        {next && <button type="button" className="primary chapter-next" onClick={() => goto(next.id)} style={{ "--next": next.color }}>Next: {next.title} <ArrowRight size={14} /></button>}
      </footer>
    </div>
  );
}
