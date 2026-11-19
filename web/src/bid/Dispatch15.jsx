import React, { useEffect, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Play, TriangleAlert, XCircle } from "lucide-react";
import { Section, nf, pf } from "../rtc/ui";
import { getJson } from "./readTender";

const PLANT_TITLE = { biomass: "Biomass", thermal: "Thermal", hydro: "Hydro" };

/**
 * Year 1 short of the time-block floors here against the hourly sizing. The tender charges the
 * energy short, not the blocks: at the same energy (and penalty) the 15-minute dispatch may spread
 * the shortfall over more blocks than the sizing, so its share of blocks at the floor is lower.
 */
function sizingShort(lp, y1) {
  const hourly = lp?.perYear?.find((r) => r.year === y1?.year)?.blockShortfallMu;
  if (!(hourly >= 0) || !y1) return "";
  const peak = lp.perYear.find((r) => r.year === y1.year)?.rules?.find((r) => r.basis === "block" && r.hoursMet != null);
  return ` Year ${y1.year}: ${nf(y1.shortfallMu, 1)} MU short here, ${nf(hourly, 1)} MU in the hourly sizing. The penalty is on the energy short, so it is the same whether that energy falls in a few blocks or is spread over many; the 15-minute dispatch spreads it${peak ? ` (the sizing had ${pf(peak.hoursMet, 0)} of ${peak.id} hours at the floor)` : ""}, which is why fewer blocks are at the floor here.`;
}

/**
 * Size step 4.5: the sized plant dispatched in 15-minute blocks (96 a day) for every PPA year,
 * with biomass and thermal held at their technical minimum and ramp limit in every block.
 * Runs on the engine as a job (a few minutes); the per-year results show as each year finishes,
 * then the ZIP of 15-minute CSV files and the 25-year workbook (a summary, the months, and every
 * year hour by hour) can be downloaded. Time-block floors (SECI RTC-TM) are checked block by block.
 */
export default function Dispatch15({ lp, start }) {
  const jobId = lp?.d15?.jobId || null;
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!jobId) { setJob(null); return undefined; }
    let stop = false;
    let timer = null;
    const poll = async () => {
      try {
        const next = await getJson(`/api/bid/dispatch15/${jobId}`);
        if (stop) return;
        setJob(next);
        if (next.status === "queued" || next.status === "running") timer = setTimeout(poll, 2500);
      } catch (err) {
        if (!stop) setError(/No such/.test(err.message) ? "This run is no longer on the server (runs are kept for 24 hours): run it again." : err.message);
      }
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [jobId]);

  async function run() {
    setError("");
    setStarting(true);
    try {
      await start();
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || job?.status === "queued" || job?.status === "running";
  const years = job?.years || [];
  const done = job?.status === "done";
  const total = job?.progress?.total || 25;
  const rules = years[0]?.rules || [];
  const plants = Object.keys(years[0]?.plants || {});
  const failedYears = years.filter((y) => !y.allMet);
  // a time-block floor with a penalty may fall short by design: the shortfall is paid, not a failure
  const priced = rules.length > 0 && rules.every((r) => r.basis === "block" && r.penaltyMultiple != null);
  // SECI-FDRE-X: a monthly rule with a free share and a penalty beyond it; the power bought
  const monthly = rules.length > 0 && rules.every((r) => r.tolerance != null && r.penaltyMultiple != null);
  const buying = years.some((y) => y.boughtMu != null);
  const penalisedYears = monthly ? years.filter((y) => (y.penalisedMu || 0) > 0.0005) : [];
  const worst = (pid, key, fn) => (years.length ? fn(...years.map((y) => y.plants[pid]?.[key] ?? 0)) : null);

  return (
    <Section index="4.5" title="15-minute dispatch, every PPA year" note="96 blocks a day · ramp and technical minimum in every block"
      actions={(
        <>
          <button type="button" className={done ? "secondary" : "primary"} onClick={run} disabled={busy || !lp} data-testid="bid-d15-run">
            {busy ? <Loader2 className="spin" size={14} /> : <Play size={14} />} {jobId ? "Run again" : "Run the 15-minute dispatch"}
          </button>
          {done && (
            <a className="button primary" href={`/api/bid/dispatch15/${jobId}/xlsx`} download data-testid="bid-d15-xlsx">
              <FileSpreadsheet size={14} /> 25-year dispatch (Excel)
            </a>
          )}
          {done && (
            <a className="button secondary" href={`/api/bid/dispatch15/${jobId}/zip`} download data-testid="bid-d15-download">
              <Download size={14} /> 15-minute blocks (ZIP)
            </a>
          )}
        </>
      )}>
      <p className="rtc-note">
        The sizing above works hour by hour. This takes the plant it chose and dispatches it in 15-minute time blocks for every
        year of the PPA, one HiGHS run per year with that year's degradation: biomass and thermal stay at or above their
        technical minimum in every block and move by no more than their ramp rate per block (%/min × 15); the battery charges
        from renewable output only and never charges and discharges in the same block; the tender's supply floors are checked
        on the 15-minute delivery. Solar and wind profiles are hourly, so each hour is split into four blocks along the
        hour's trend, keeping its energy. A time-block floor is checked in every 15-minute block on its own, a block short of it
        paid at its penalty multiple of the tariff. The Excel workbook has a summary by year, the months, and every year hour by
        hour (8,760 rows a year); the ZIP has one CSV per year at 15 minutes (35,040 rows) and the summary.
        {monthly && " SECI-FDRE-X as in the sizing: the contract is the buyer's four hours; power bought from the market (within the tender's share of the year's energy, never resold) is priced at the hour's price plus the charges; nothing is sold in the hours without connectivity; each month needs its share less the free tolerance, and the energy short beyond it is paid at the penalty multiple of the tariff."}
      </p>
      {busy && (
        <div className="bid-progress" role="status" data-testid="bid-d15-progress">
          <div className="bid-progress-bar"><i style={{ width: `${Math.round(((job?.progress?.done || 0) / total) * 100)}%` }} /></div>
          <span><Loader2 className="spin" size={13} /> {years.length ? `Year ${years.length} of ${total} done` : "Solving year 1 (the longest; later years start from it)"}</span>
        </div>
      )}
      {job?.status === "failed" && <div className="alert"><TriangleAlert size={14} /> {job.error}</div>}
      {error && <div className="alert"><TriangleAlert size={14} /> {error}</div>}
      {done && (
        <div className={`bid-mode ${failedYears.length ? "rules" : ""}`} data-testid="bid-d15-verdict">
          {failedYears.length ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}
          <span>
            {monthly
              ? (penalisedYears.length
                ? `In 15-minute blocks the month's peak energy falls short beyond the free ${pf(rules[0].tolerance, 0)} in ${penalisedYears.length} of ${years.length} years: ${nf(penalisedYears.reduce((a, y) => a + y.penalisedMu, 0), 2)} MU in all, paid at ${rules[0].penaltyMultiple} × the tariff, as the sizing chose.`
                : `Every month of all ${years.length} years is within the free ${pf(rules[0].tolerance, 0)} in 15-minute blocks: no penalty.`)
                + (buying ? ` Power bought: ${nf(years[0].boughtMu, 2)} MU in year 1 (${pf(years[0].boughtShare, 2)} of the contracted energy, ₹${nf(years[0].boughtCostCr, 2)} crore); at most ${pf(Math.max(...years.map((y) => y.boughtShare || 0)), 2)} in a year.` : "")
              : failedYears.length && priced
              ? `In 15-minute blocks the plant is short of the time-block floors in ${failedYears.length} of ${years.length} years: ${nf(failedYears.reduce((a, y) => a + y.shortfallMu, 0), 1)} MU in all, paid at ${rules[0].penaltyMultiple} × the tariff, as the sizing chose.${sizingShort(lp, years[0])}`
              : failedYears.length
              ? `In 15-minute blocks the plant misses a supply floor in ${failedYears.length} of ${years.length} years (years ${failedYears.map((y) => y.year).join(", ")}); shortfall ${nf(failedYears.reduce((a, y) => a + y.shortfallMu, 0), 1)} MU in all. Size again with more battery or a fixed larger biomass.`
              : `Every supply floor is met in all ${years.length} years in 15-minute blocks.`}
            {plants.map((pid) => ` ${PLANT_TITLE[pid] || pid}: lowest output ${pf(worst(pid, "minPct", Math.min), 1)} of MW (technical minimum ${pf(years[0].plants[pid].minLoad, 0)}), largest 15-minute change ${pf(worst(pid, "maxStepPct", Math.max), 1)} (limit ${years[0].plants[pid].rampPerBlock != null ? pf(years[0].plants[pid].rampPerBlock, 0) : "none"}).`).join("")}
          </span>
        </div>
      )}
      {years.length > 0 && (
        <div className="bid-d15" data-testid="bid-d15-table">
          <div className="bid-d15-row head">
            <span>Year</span>
            {rules.map((r) => <span key={r.id}>{r.label || r.id} ≥ {pf(r.target, 0)}</span>)}
            <span>{monthly ? `Short beyond ${pf(rules[0].tolerance, 0)}` : "Shortfall"}</span>
            {buying && <span>Bought</span>}
            {plants.map((pid) => <span key={pid}>{PLANT_TITLE[pid] || pid}: lowest · largest 15-min change</span>)}
            <span>Curtailed</span>
            <span>Sold</span>
          </div>
          {years.map((y) => (
            <div key={y.year} className={`bid-d15-row ${y.allMet ? "" : "failed"}`}>
              <span>{y.year}</span>
              {y.rules.map((r) => (r.basis === "block"
                ? <span key={r.id} className={r.met ? "ok" : r.penaltyMultiple != null ? "warn" : "bad"} title={`${nf(r.shortfallMu, 2)} MU short; lowest block ${pf(r.achieved, 1)}`}>{r.met ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {pf(r.hoursMet, 1)} of blocks</span>
                : r.tolerance != null
                ? <span key={r.id} className={r.met ? "ok" : r.withinTolerance ? "ok" : "warn"} title={`worst month ${pf(r.achieved, 1)} of its peak energy`}>{r.withinTolerance ? <CheckCircle2 size={12} /> : <XCircle size={12} />} worst month {pf(r.achieved, 1)}</span>
                : <span key={r.id} className={r.met ? "ok" : "bad"}>{r.met ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {pf(r.achieved, 1)}</span>))}
              <span>{y.shortfallMu > 0.0005 ? `${nf(y.shortfallMu, monthly ? 2 : 1)} MU` : "none"}</span>
              {buying && <span>{nf(y.boughtMu || 0, 2)} MU · {pf(y.boughtShare || 0, 1)}</span>}
              {plants.map((pid) => <span key={pid}>{pf(y.plants[pid].minPct, 1)} · {pf(y.plants[pid].maxStepPct, 1)}</span>)}
              <span>{nf(y.curtailedMu, 0)} MU</span>
              <span>{nf(y.soldMu, 0)} MU</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
