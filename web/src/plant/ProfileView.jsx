"use client";
// An hourly solar or wind profile on screen: its CUF, the uploaded file's own CUF when the profile
// is scaled to the bid's, a month × hour heat map, the monthly CUF and one week hour by hour;
// the CUF file and the 25-year CUF table as CSV (built in the browser, web/src/plant/cufFile.js)
// and the 25-year justification (web/src/plant/justification.js) with its Word file
// (app/api/plant/justification).
import React, { useMemo, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { LiveChart } from "../rtc/charts";
import { downloadText, heatmapOption, nf, pf } from "../rtc/ui";
import * as E from "../rtc/engine";
import { cufByYearCsv, cufCsv } from "./cufFile";
import { cufJustification } from "./justification";

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const toCuf = (text) => {
  const v = Number(text);
  return text !== "" && Number.isFinite(v) && v > 0 ? v / 100 : null;
};

/**
 * cf: the profile the bid uses (scaled to the CUF entered); raw: the uploaded file's values, or null;
 * kind: "solar" | "wind"; name: the uploaded file's name; cufAt: where the CUF is measured;
 * degradation: the per-year degradation the model applies to this technology; years: the PPA term.
 */
export default function ProfileView({ cf, raw = null, color, label, colors, kind = null, name = null, cufAt = null, degradation = 0, years = 25 }) {
  const tech = kind || (label || "solar").toLowerCase();
  const n = Math.max(1, Math.round(Number(years) || 25));
  const [week, setWeek] = useState(26);
  const [p50Text, setP50Text] = useState(null); // % typed by the user; null = the bid's CUF
  const [p90Text, setP90Text] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stats = useMemo(() => {
    if (!cf?.length) return null;
    const monthly = E.monthlyMeans(cf);
    let peak = 0;
    let zero = 0;
    for (const v of cf) { if (v > peak) peak = v; if (v <= 1e-6) zero += 1; }
    return { cuf: mean(cf), rawCuf: raw?.length ? mean(raw) : null, monthly, peak, zeroShare: zero / cf.length, matrix: E.monthHourMatrix(Array.from(cf, (v) => v * 100)) };
  }, [cf, raw]);
  const heat = useMemo(() => (stats ? heatmapOption(stats.matrix, { name: label, unit: "%", min: 0, colors: colors || ["#151515", color] }) : null), [stats, label, color, colors]);
  const months = useMemo(() => (stats ? {
    animation: false,
    grid: { left: 44, right: 10, top: 18, bottom: 26 },
    tooltip: { trigger: "axis", valueFormatter: (v) => `${nf(v, 1)}%` },
    xAxis: { type: "category", data: E.MONTHS },
    yAxis: { type: "value", name: "CUF %" },
    series: [{ name: "Monthly CUF", type: "bar", data: stats.monthly.map((v) => Number((v * 100).toFixed(2))), itemStyle: { color } }],
  } : null), [stats, color]);
  const weekOpt = useMemo(() => {
    if (!cf?.length) return null;
    const start = Math.min(E.HOURS - 168, week * 168);
    const data = Array.from({ length: 168 }, (_, i) => Number((cf[start + i] * 100).toFixed(2)));
    return {
      animation: false,
      grid: { left: 44, right: 10, top: 18, bottom: 26 },
      tooltip: { trigger: "axis", valueFormatter: (v) => `${nf(v, 1)}%` },
      xAxis: { type: "category", data: data.map((_, i) => `D${Math.floor(i / 24) + 1} ${String(i % 24).padStart(2, "0")}h`), axisLabel: { interval: 23 } },
      yAxis: { type: "value", name: "% of MW", max: 100 },
      series: [{ name: label, type: "line", data, showSymbol: false, areaStyle: { color, opacity: 0.25 }, lineStyle: { color, width: 1.4 }, itemStyle: { color } }],
    };
  }, [cf, week, color, label]);
  const p50Default = stats ? (stats.cuf * 100).toFixed(2) : "";
  const p50 = p50Text === null ? (stats ? stats.cuf : null) : toCuf(p50Text);
  const p90 = toCuf(p90Text);
  const justification = useMemo(() => (stats ? cufJustification({
    kind: tech, stats, name, cuf: stats.cuf, rawCuf: stats.rawCuf, degradation: degradation || 0, years: n, p50p90: { p50: p50 ?? stats.cuf, p90 }, cufAt,
  }) : null), [stats, tech, name, degradation, n, p50, p90, cufAt]);
  if (!stats) return null;

  const common = { kind: tech, cuf: stats.cuf, rawCuf: stats.rawCuf, name, degradation: degradation || 0, cufAt, years: n };
  const downloadCuf = () => downloadText(`${tech}_cuf_8760.csv`, cufCsv({ ...common, values: cf, raw: raw?.length ? raw : null }));
  const downloadByYear = () => downloadText(`${tech}_cuf_by_year.csv`, cufByYearCsv(common));
  async function downloadWord() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/plant/justification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ kind: tech, title: justification.title, paragraphs: justification.paragraphs, rows: justification.yearTable, source: name ? `Profile: ${name}` : `Typical ${tech} profile` }),
      });
      if (!res.ok) {
        let msg = `Download failed (${res.status})`;
        try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tech}_cuf_justification.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-view" data-testid={`profile-view-${label.toLowerCase()}`}>
      <div className="studio-facts">
        <div><span>CUF used in the bid</span><b data-testid="profile-cuf">{pf(stats.cuf, 2)}</b><small>{nf(stats.cuf * 8760, 0)} kWh per kW a year</small></div>
        {stats.rawCuf !== null && <div><span>CUF of the uploaded file</span><b>{pf(stats.rawCuf, 2)}</b><small>{Math.abs(stats.rawCuf - stats.cuf) > 1e-4 ? "scaled to the CUF you entered" : "used as it is"}</small></div>}
        <div><span>Highest hour</span><b>{pf(stats.peak, 1)}</b><small>of capacity</small></div>
        <div><span>Hours at zero</span><b>{pf(stats.zeroShare, 0)}</b><small>{nf(stats.zeroShare * 8760, 0)} h a year</small></div>
        <div><span>Best / worst month</span><b>{pf(Math.max(...stats.monthly), 1)} / {pf(Math.min(...stats.monthly), 1)}</b><small>{E.MONTHS[stats.monthly.indexOf(Math.max(...stats.monthly))]} / {E.MONTHS[stats.monthly.indexOf(Math.min(...stats.monthly))]}</small></div>
        <div><span>CUF in year {n}</span><b data-testid="profile-cuf-last">{pf(justification.year25.cuf, 2)}</b><small>{degradation > 0 ? `${pf(degradation, 2)} a year degradation, factor ${justification.year25.factor.toFixed(3)}` : "no degradation applied"}</small></div>
      </div>
      <div className="bid-studio-row">
        <button type="button" className="secondary" onClick={downloadCuf} data-testid={`profile-download-${tech}`}><FileDown size={14} /> Download CUF file</button>
        <button type="button" className="secondary" onClick={downloadByYear} data-testid={`profile-download-years-${tech}`}><FileDown size={14} /> Download {n}-year CUF table</button>
        <span className="rtc-note">CSV, built here: 8,760 hours as used in the bid{raw?.length ? " and as uploaded" : ""}; one row per PPA year with the degradation applied.</span>
      </div>
      <div className="rtc-grid rtc-grid-2">
        <div><div className="rtc-subhead">Month × hour, % of capacity</div><LiveChart option={heat} height={260} /></div>
        <div><div className="rtc-subhead">Monthly CUF</div><LiveChart option={months} height={260} /></div>
      </div>
      <div className="rtc-subhead">One week, hour by hour <input type="range" min={0} max={51} value={week} onChange={(e) => setWeek(Number(e.target.value))} aria-label="Week of the year" /> week {week + 1}</div>
      <LiveChart option={weekOpt} height={200} />
      <details className="bid-profile profile-justification" data-testid={`profile-justification-${tech}`}>
        <summary>{n}-year justification: why one year's profile stands for the PPA</summary>
        <div className="bid-studio-row">
          <label className="rtc-note">P50 CUF % <input type="number" min={0} max={100} step={0.01} value={p50Text === null ? p50Default : p50Text} onChange={(e) => setP50Text(e.target.value)} aria-label="P50 CUF" style={{ width: 80 }} /></label>
          <label className="rtc-note">P90 CUF % (optional) <input type="number" min={0} max={100} step={0.01} value={p90Text} placeholder="from the assessor" onChange={(e) => setP90Text(e.target.value)} aria-label="P90 CUF" style={{ width: 80 }} /></label>
          <button type="button" className="secondary" onClick={downloadWord} disabled={busy} data-testid={`profile-justification-word-${tech}`}>
            {busy ? <Loader2 className="spin" size={14} /> : <FileDown size={14} />} Download justification (Word)
          </button>
          {error && <span className="rtc-note" role="alert">{error}</span>}
        </div>
        <h4 className="rtc-subhead">{justification.title}</h4>
        {justification.paragraphs.map((p) => (
          <div key={p.heading} className="profile-justification-para">
            <b>{p.heading}</b>
            <p className="rtc-note">{p.text}</p>
          </div>
        ))}
      </details>
    </div>
  );
}
