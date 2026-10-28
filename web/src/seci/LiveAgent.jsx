import React, { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Bot, Calculator, Loader2, Maximize2, Mic, MicOff, Minimize2, PhoneOff, Sparkles, X } from "lucide-react";
import { LiveChart } from "../rtc/charts";
import { LiveEvents, createToolRunner } from "./agent";
import { agentChart } from "./charts";

const TOOL_WORDS = {
  get_status: () => "Read the bid on screen",
  tender_brief: () => "Read the key conditions",
  tender_lookup: (a) => `Looked up “${a.query}” in the tender`,
  next_question: () => "Next input",
  list_inputs: (a) => `Listed the ${a.part} inputs`,
  set_input: (a, r) => (r?.ok ? `Set ${a.key} → ${r.value}` : `Could not set ${a.key}: ${r?.error || ""}`),
  use_benchmarks: () => "Filled the benchmarks",
  go_to_step: (a) => `Showed ${a.step}`,
  run_optimizer: (a, r) => (r?.ok ? "Sized the plant with HiGHS" : `Sizing: ${r?.error || "did not run"}`),
  stop_optimizer: () => "Stopped the sizing",
  get_results: () => "Read the results",
  get_financials: () => "Read the financial model",
  check_tariff: (a, r) => (r?.ok ? `Checked ₹${a.tariff}/kWh: equity IRR ${r.equityIrrPct}%, project IRR ${r.projectIrrPct}%` : `Tariff check: ${r?.error || ""}`),
  review_bid_forms: () => "Reviewed the bid forms",
  show_chart: (a, r) => (r?.ok ? `Showed a chart: ${r.shown}` : `Chart: ${r?.error || ""}`),
  open_format: (a) => `Opened ${a.id === "particulars" ? "the particulars" : `Format ${a.id}`}`,
  mark_format_reviewed: (a) => `${a.reviewed ? "Marked" : "Unmarked"} Format ${a.id} reviewed`,
  explain_generation: (a, r) => (r?.ok ? `Worked out the ${a.source === "all" ? "solar and wind" : a.source} energy, year ${r.year}: MW × CUF × 365 × 24${r.check ? ` (${r.check.matches ? "your figure matches" : "your figure differs"})` : ""}` : `Energy: ${r?.error || ""}`),
};

function highlightTarget(target) {
  document.querySelectorAll(".voice-target").forEach((el) => el.classList.remove("voice-target"));
  if (!target) return;
  setTimeout(() => {
    const el = document.querySelector(`[data-voice="${target}"]`) || document.querySelector(`[data-testid="seci-form-${String(target).replace(/^form\./, "")}"]`);
    if (el) { el.classList.add("voice-target"); el.scrollIntoView?.({ block: "center", behavior: "smooth" }); }
  }, 350);
}

/** Wait for the browser to gather its ICE candidates before sending the offer (as the GPT-Live guide does). */
function iceGathered(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pc.removeEventListener("icegatheringstatechange", check); reject(new Error("Timed out while preparing the connection.")); }, 10_000);
    function check() {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

const CHART_BUTTONS = [["peak_window", "Peak Hours"], ["typical_day", "A day"], ["monthly_energy", "Months"], ["irr_vs_tariff", "IRR vs tariff"], ["cash_flows", "Cash flows"], ["money", "Money"]];

/** A chart the agent opened, in its column (charts.js draws it from the bid itself); it can be enlarged. */
export function ChartWindow({ chart, onClose }) {
  const [big, setBig] = useState(false);
  if (!chart) return null;
  return (
    <section className={`agent-chart ${big ? "big" : ""}`} aria-label={chart.title} data-testid="agent-chart" data-kind={chart.kind}>
      <header>
        <strong><BarChart3 size={14} /> {chart.title}</strong>
        <span>
          <button type="button" className="rtc-icon-btn" onClick={() => setBig((v) => !v)} aria-label={big ? "Make the chart smaller" : "Enlarge the chart"} data-testid="agent-chart-size">{big ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
          <button type="button" className="rtc-icon-btn" onClick={onClose} aria-label="Close the chart"><X size={14} /></button>
        </span>
      </header>
      <LiveChart key={big ? "big" : "small"} option={chart.option} height={big ? 460 : 250} />
      <p className="rtc-note">{chart.caption}</p>
    </section>
  );
}

/**
 * "Check the energy" without talking: the same explain_generation tool the voice agent calls,
 * typed. The answer goes into the conversation and the traceable model opens at the line.
 */
function EnergyCheck({ run, addTurn }) {
  const [source, setSource] = useState("solar");
  const [year, setYear] = useState(1);
  const [mine, setMine] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    const theirMu = mine.trim() === "" ? null : Number(mine.replace(/,/g, ""));
    addTurn("you", `How is the ${source === "all" ? "solar and wind" : source} energy in year ${year} worked out?${Number.isFinite(theirMu) && theirMu !== null ? ` I get ${theirMu.toLocaleString("en-IN")} MU.` : ""}`, false);
    const r = await run({ source, year: Number(year) || 1, month: null, day: null, their_mu: Number.isFinite(theirMu) ? theirMu : null, show: true });
    addTurn("agent", r.ok ? r.spoken : r.error, false);
    setBusy(false);
  };
  return (
    <form className="agent-energy" data-testid="agent-energy" onSubmit={(e) => { e.preventDefault(); check(); }}>
      <span className="rtc-note">Check the energy: MW × CUF × 365 × 24</span>
      <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Technology" data-testid="agent-energy-source">
        <option value="solar">Solar</option><option value="wind">Wind</option><option value="all">Both</option>
      </select>
      <label>Year <input type="number" min={1} max={40} value={year} onChange={(e) => setYear(e.target.value)} data-testid="agent-energy-year" /></label>
      <label>My figure <input inputMode="decimal" placeholder="MU" value={mine} onChange={(e) => setMine(e.target.value)} data-testid="agent-energy-mine" /></label>
      <button type="submit" className="secondary" disabled={busy} data-testid="agent-energy-check"><Calculator size={13} /> Check</button>
    </form>
  );
}

/**
 * The bid agent: a GPT-Live voice conversation whose backend works this tab through the tools in
 * agent.js (setting inputs, running HiGHS, reading results, checking a tariff, the bid forms).
 * The server creates the session (/api/seci/live); audio flows over WebRTC; nothing is recorded.
 */
export default function LiveAgent({ state, setState, terms, goto, sizing, info, onDock = () => {}, onTrace = () => {} }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { onDock(open); }, [open, onDock]);
  const [phase, setPhase] = useState("idle"); // idle | connecting | connected | working | closing
  const [turns, setTurns] = useState([]);
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [chart, setChart] = useState(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const termsRef = useRef(terms);
  termsRef.current = terms;
  const sizingRef = useRef(sizing);
  sizingRef.current = sizing;
  const conn = useRef(null); // { pc, dc, mic, audio, events, closeTimer }
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const secure = typeof window === "undefined" || window.isSecureContext;

  const addTurn = useCallback((who, text, join = true) => {
    if (!text) return;
    setTurns((t) => {
      const last = t[t.length - 1];
      if (join && last && last.who === who && Date.now() - last.at < 2500) return [...t.slice(0, -1), { ...last, text: last.text + text, at: Date.now() }];
      return [...t.slice(-80), { who, text, at: Date.now() }];
    });
  }, []);

  const cleanup = useCallback(() => {
    const c = conn.current;
    conn.current = null;
    if (!c) return;
    clearTimeout(c.closeTimer);
    c.mic?.getTracks().forEach((tr) => tr.stop());
    try { c.dc?.close(); } catch { /* closed */ }
    try { c.pc?.close(); } catch { /* closed */ }
    if (c.audio) c.audio.srcObject = null;
    highlightTarget(null);
    setPhase("idle");
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    setError("");
    setTurns([]);
    setPhase("connecting");
    const runTool = createToolRunner({
      getState: () => stateRef.current,
      apply: (fn) => { stateRef.current = fn(stateRef.current); setState(stateRef.current); },
      getTerms: () => termsRef.current,
      goto,
      highlight: highlightTarget,
      // the sizing reads the state of the last render: let the tab render the agent's changes first
      runSizing: async () => { await new Promise((r) => setTimeout(r, 80)); return sizingRef.current.startSizing(); },
      stopSizing: () => sizingRef.current.stopSizing(),
      getRun: () => sizingRef.current.run,
      getHourly: () => sizingRef.current.hourly,
      showChart: setChart,
      showTrace: onTrace,
    });
    const c = { audio: new Audio() };
    c.audio.autoplay = true;
    conn.current = c;
    try {
      const pc = new RTCPeerConnection();
      c.pc = pc;
      pc.addEventListener("track", (e) => { c.audio.srcObject = new MediaStream([e.track]); c.audio.play().catch(() => setError("Press play in the browser to hear the agent.")); });
      c.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of c.mic.getAudioTracks()) pc.addTrack(track, c.mic);
      const dc = pc.createDataChannel("oai-events");
      c.dc = dc;
      let greeting = "";
      c.events = new LiveEvents({
        send: (o) => { if (dc.readyState === "open") dc.send(JSON.stringify(o)); },
        runTool,
        on: {
          status: (s) => {
            if (s === "connected" && greeting && !c.greeted) {
              c.greeted = true;
              dc.send(JSON.stringify({ type: "session.commentary.append", event_id: `greet_${Date.now()}`, delegation_id: null, content: greeting }));
            }
            setPhase((p) => (p === "closing" ? p : s));
          },
          heard: (t) => addTurn("you", t),
          said: (t) => addTurn("agent", t),
          tool: (name, args, result) => addTurn("tool", (TOOL_WORDS[name] || (() => name))(args, result), false),
          error: (m) => setError(m),
          closed: () => cleanup(),
        },
      });
      dc.addEventListener("message", ({ data }) => { c.events.handle(data).catch((err) => setError(err.message)); });
      dc.addEventListener("close", () => { if (conn.current === c) { if (phaseRef.current !== "closing") setError("The voice connection closed."); cleanup(); } });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await iceGathered(pc);
      const res = await fetch("/api/seci/live", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ sdp: pc.localDescription.sdp }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The voice agent could not start (${res.status}).`);
      greeting = body.greeting || "";
      await pc.setRemoteDescription({ type: "answer", sdp: body.transport.sdp });
    } catch (err) {
      setError(err.name === "NotAllowedError" ? "The microphone is blocked: allow it for this site and try again." : err.message);
      cleanup();
    }
  }, [addTurn, cleanup, goto, setState]);

  const stop = useCallback(() => {
    const c = conn.current;
    if (!c?.dc || c.dc.readyState !== "open") { cleanup(); return; }
    setPhase("closing");
    c.dc.send(JSON.stringify({ type: "session.close" }));
    c.closeTimer = setTimeout(cleanup, 15_000);
  }, [cleanup]);

  const toggleMic = () => {
    const on = !micOn;
    conn.current?.mic?.getAudioTracks().forEach((t) => { t.enabled = on; });
    setMicOn(on);
  };

  if (!open) {
    return (
      <button type="button" className="voice-fab agent-fab" onClick={() => setOpen(true)} data-testid="agent-open">
        <Sparkles size={16} /> Talk to the bid agent
      </button>
    );
  }
  const live = phase !== "idle";
  return (
    <aside className="voice-panel agent-panel" aria-label="Bid agent" data-testid="agent-panel">
      <header>
        <strong><Bot size={14} /> Bid agent · GPT-Live</strong>
        <button type="button" className="rtc-icon-btn" onClick={() => { stop(); setOpen(false); }} aria-label="Close the agent"><X size={14} /></button>
      </header>
      <p className="rtc-note">Talk naturally: it explains the bid conditions, takes your inputs in order, changes anything on screen, runs the optimizer again and explains the results and the IRR at the tariff you quote. Every number comes from this screen; every tender fact from the documents, with the page.</p>
      {info && !info.available && <p className="voice-note" data-testid="agent-unavailable">The voice agent is not set up on this server yet: add OPENAI_API_KEY to the server's .env and restart the web service (docs/DEPLOY.md).</p>}
      {!secure && <p className="voice-note" data-testid="agent-insecure">The microphone needs an HTTPS address or localhost. Open the app over HTTPS, or through an SSH tunnel at http://localhost (docs/DEPLOY.md).</p>}
      <div className="voice-controls">
        {!live
          ? <button type="button" className="primary" onClick={start} disabled={!secure || !info?.available} data-testid="agent-start"><Mic size={14} /> Start talking</button>
          : <button type="button" className="secondary" onClick={stop} data-testid="agent-stop"><PhoneOff size={14} /> End</button>}
        {live && <button type="button" className={`secondary voice-mic ${micOn ? "listening" : ""}`} onClick={toggleMic} data-testid="agent-mic">{micOn ? <Mic size={14} /> : <MicOff size={14} />} {micOn ? "Mic on" : "Mic off"}</button>}
        <span className="rtc-note agent-phase" data-testid="agent-phase">
          {phase === "connecting" && <><Loader2 className="spin" size={12} /> Connecting…</>}
          {phase === "connected" && "Listening"}
          {phase === "working" && <><Loader2 className="spin" size={12} /> Working on the bid…</>}
          {phase === "closing" && "Ending…"}
        </span>
      </div>
      {error && <p className="voice-note" role="alert" data-testid="agent-error">{error}</p>}
      <div className="agent-charts" role="group" aria-label="Charts">
        {CHART_BUTTONS.map(([kind, label]) => (
          <button key={kind} type="button" className={chart?.kind === kind ? "active" : ""} data-testid={`agent-chart-${kind}`}
            onClick={() => {
              try { setChart(agentChart(kind, { state: stateRef.current, terms: termsRef.current, hourly: sizingRef.current.hourly })); setError(""); } catch (err) { setError(err.message); }
            }}>{label}</button>
        ))}
      </div>
      <ChartWindow chart={chart} onClose={() => setChart(null)} />
      <EnergyCheck run={(args) => createToolRunner({
        getState: () => stateRef.current, apply: () => {}, getTerms: () => termsRef.current, goto, showTrace: onTrace,
      })("explain_generation", args)} addTurn={addTurn} />
      <div className="voice-log agent-log" data-testid="agent-log" aria-live="polite">
        {turns.length === 0 && <p>{info?.backendModel ? `Voice ${info.model}; the bid work by ${info.backendModel}.` : ""}</p>}
        {turns.map((t, i) => <p key={i} className={t.who}>{t.text}</p>)}
      </div>
    </aside>
  );
}
