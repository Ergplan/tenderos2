// The HiGHS sizing of a bid, shared by the Tender to Bid and SECI RTC tabs: start, stop, the
// streamed log and progress, the year-1 hourly dispatch, and the 15-minute dispatch job. The run
// and the hourly dispatch survive switching dashboard tabs through the caller's `session` object.
import { useCallback, useEffect, useRef, useState } from "react";
import { trackEvent } from "../activity";
import { dispatch15Request, hourlyAtMeter, loadMarketPrices, lpPayload, missingInputs, plantMw, resourceProfiles, runSizing, sizingSeedOf, keepDispatch } from "./model";
import { getJson } from "./readTender";

/**
 * session: a module-level object of the calling tab ({ hourly, run }), kept across mounts.
 * module: the activity log's module name ("bid", "seci").
 */
export default function useSizing({ state, setState, terms, prices, session, module = "bid" }) {
  const [hourly, setHourly] = useState(() => session.hourly || null);
  const [run, setRun] = useState(() => session.run || null);
  const abortRef = useRef(null);
  useEffect(() => { session.hourly = hourly; }, [hourly, session]);
  useEffect(() => { session.run = run; }, [run, session]);

  /** The IEX price year when the bid sells at an IEX market (null for a flat price or no sale). */
  const marketPrices = useCallback(async () => {
    if (!(state.market.sell && state.market.source !== "flat")) return null;
    return prices || loadMarketPrices();
  }, [state.market.sell, state.market.source, prices]);

  /** Size the plant; resolves with the sizing summary (or null when it did not run or failed). */
  const startSizing = useCallback(async () => {
    if (run?.active) return null;
    if (missingInputs(state, terms).length) return null;
    let market = null;
    try {
      market = await marketPrices();
    } catch (err) {
      setRun({ active: false, started: Date.now(), finished: Date.now(), log: [], error: `IEX prices could not be loaded (${err.message}); choose a flat price or try again.` });
      return null;
    }
    const payload = lpPayload(state, terms, resourceProfiles(state), market);
    const abort = new AbortController();
    abortRef.current = abort;
    const started = Date.now();
    setRun({ active: true, started, log: [], iteration: 0 });
    trackEvent("optimize", { module, plantMw: plantMw(state, terms) });
    try {
      const result = await runSizing(payload, {
        signal: abort.signal,
        onLog: (line) => setRun((r) => (r ? { ...r, log: [...r.log.slice(-400), line] } : r)),
        onProgress: (p) => setRun((r) => (r ? { ...r, iteration: p.iteration, tariff: p.tariff ?? r.tariff } : r)),
      });
      const { hourly: h, log, dispatch, ...summary } = result;
      setHourly(h ? hourlyAtMeter(h, summary.evacuationEfficiency) : null);
      const used = payload.ctx.surplusPrice ? state.market.source : null;
      const lp = { ...summary, market: used, flatPrice: used ? null : (payload.ctx.sellSurplus ? payload.fin.surplusPrice : null) };
      keepDispatch(lp, dispatch);
      // remembered for the next sizing's start, even after an input change clears the result
      setState((s) => ({ ...s, lp, sizingSeed: sizingSeedOf(lp, payload.ctx.plantMw) || s.sizingSeed || null }));
      setRun((r) => ({ ...r, active: false, finished: Date.now() }));
      return lp;
    } catch (err) {
      const msg = abort.signal.aborted ? "Stopped." : err.message;
      setRun((r) => ({ ...(r || { log: [], started }), active: false, finished: Date.now(), error: msg }));
      return null;
    } finally {
      abortRef.current = null;
    }
  }, [run?.active, state, terms, marketPrices, setState, module]);

  /** The sized plant, dispatched in 15-minute blocks for every PPA year (an engine job). */
  const startDispatch15 = useCallback(async () => {
    if (!state.lp) throw new Error("Size the plant first.");
    const payload = lpPayload(state, terms, resourceProfiles(state), await marketPrices());
    const { job_id: jobId } = await getJson("/api/bid/dispatch15", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dispatch15Request(payload, state.lp)),
    });
    trackEvent("run", { module, action: "dispatch15" });
    setState((s) => (s.lp ? { ...s, lp: { ...s.lp, d15: { jobId, started: Date.now() } } } : s));
  }, [state, terms, marketPrices, setState, module]);

  const stopSizing = useCallback(() => { abortRef.current?.abort(); }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setHourly(null);
    setRun(null);
  }, []);

  return { hourly, setHourly, run, startSizing, stopSizing, startDispatch15, clear };
}
