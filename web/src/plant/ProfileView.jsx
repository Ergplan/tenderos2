"use client";
// An hourly solar or wind profile on screen: its CUF, the uploaded file's own CUF when the profile
// is scaled to the bid's, a month × hour heat map, the monthly CUF and one week hour by hour.
import React, { useMemo, useState } from "react";
import { LiveChart } from "../rtc/charts";
import { heatmapOption, nf, pf } from "../rtc/ui";
import * as E from "../rtc/engine";

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

export default function ProfileView({ cf, raw = null, color, label, colors }) {
  const [week, setWeek] = useState(26);
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
  if (!stats) return null;
  return (
    <div className="profile-view" data-testid={`profile-view-${label.toLowerCase()}`}>
      <div className="studio-facts">
        <div><span>CUF used in the bid</span><b data-testid="profile-cuf">{pf(stats.cuf, 2)}</b><small>{nf(stats.cuf * 8760, 0)} kWh per kW a year</small></div>
        {stats.rawCuf !== null && <div><span>CUF of the uploaded file</span><b>{pf(stats.rawCuf, 2)}</b><small>{Math.abs(stats.rawCuf - stats.cuf) > 1e-4 ? "scaled to the CUF you entered" : "used as it is"}</small></div>}
        <div><span>Highest hour</span><b>{pf(stats.peak, 1)}</b><small>of capacity</small></div>
        <div><span>Hours at zero</span><b>{pf(stats.zeroShare, 0)}</b><small>{nf(stats.zeroShare * 8760, 0)} h a year</small></div>
        <div><span>Best / worst month</span><b>{pf(Math.max(...stats.monthly), 1)} / {pf(Math.min(...stats.monthly), 1)}</b><small>{E.MONTHS[stats.monthly.indexOf(Math.max(...stats.monthly))]} / {E.MONTHS[stats.monthly.indexOf(Math.min(...stats.monthly))]}</small></div>
      </div>
      <div className="rtc-grid rtc-grid-2">
        <div><div className="rtc-subhead">Month × hour, % of capacity</div><LiveChart option={heat} height={260} /></div>
        <div><div className="rtc-subhead">Monthly CUF</div><LiveChart option={months} height={260} /></div>
      </div>
      <div className="rtc-subhead">One week, hour by hour <input type="range" min={0} max={51} value={week} onChange={(e) => setWeek(Number(e.target.value))} aria-label="Week of the year" /> week {week + 1}</div>
      <LiveChart option={weekOpt} height={200} />
    </div>
  );
}
