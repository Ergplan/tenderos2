"use client";
// The wind farm studio: pick a turbine by make and size, see its power curve and capacity factor
// at the site's wind against every other turbine, the farm's turbines, layout and land, and its
// cost line by line; "Use in the bid" writes the ₹ cr/MW and the net CUF into the wind source.
import { createPortal } from "react-dom";
import React, { useMemo } from "react";
import { Check, Wind, X } from "lucide-react";
import { LiveChart } from "../rtc/charts";
import { DATA_COLORS } from "../chartTheme";
import { Field, nf, pf } from "../rtc/ui";
import { TURBINES, WIND_NOTE, defaultWindStudio, turbineComparison, windCost, windFarm } from "./wind";

/** Turbines in rows across the wind, spaced in rotor diameters. */
export function WindLayout({ farm, spacing, width = 640, height = 300 }) {
  const n = farm.count;
  const across = Math.max(1, Math.ceil(Math.sqrt(n * (spacing.along / spacing.across))));
  const rows = Math.ceil(n / across);
  const pad = 22;
  const top = 34;
  const dx = (width - pad * 2) / Math.max(1, across - 1 || 1);
  const dy = (height - pad - top) / Math.max(1, rows - 1 || 1);
  const r = Math.max(2.5, Math.min(7, dx / 4));
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const row = Math.floor(i / across);
    const col = i % across;
    const x = pad + (across > 1 ? col * dx : (width - pad * 2) / 2) + (row % 2 ? dx / 2 : 0) * (across > 1 ? 1 : 0);
    const y = top + (rows > 1 ? row * dy : (height - pad - top) / 2);
    pts.push(<g key={i} transform={`translate(${Math.min(width - pad, x)},${y})`}><circle r={r} className="wl-turbine" /><path d={`M0,0 L0,${-r * 1.8} M0,0 L${r * 1.55},${r * 0.9} M0,0 L${-r * 1.55},${r * 0.9}`} className="wl-blade" /></g>);
  }
  return (
    <svg className="wind-layout" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Wind farm layout: ${n} turbines`} data-testid="wind-layout">
      <rect x="1" y="1" width={width - 2} height={height - 2} className="sl-fence" />
      <text x={width - 10} y={16} textAnchor="end" className="sl-label">Prevailing wind ↓ · {spacing.across}D across × {spacing.along}D along</text>
      {pts}
    </svg>
  );
}

export default function WindStudio({ studio, onChange, onApply, onClose, farmMw }) {
  const s = useMemo(() => {
    const d = defaultWindStudio();
    return { ...d, ...(studio || {}), ...(farmMw && !studio?.farmMw ? { farmMw } : {}), losses: { ...d.losses, ...(studio?.losses || {}) }, price: { ...d.price, ...(studio?.price || {}) }, spacingRotors: { ...d.spacingRotors, ...(studio?.spacingRotors || {}) } };
  }, [studio, farmMw]);
  const set = (v) => onChange({ ...s, ...v });
  const farm = useMemo(() => windFarm(s), [s]);
  const cost = useMemo(() => windCost(s, farm), [s, farm]);
  const all = useMemo(() => turbineComparison(s), [s]);
  const curveOption = useMemo(() => ({
    animation: false,
    grid: { left: 52, right: 16, top: 30, bottom: 36 },
    legend: { top: 0, right: 0, type: "scroll" },
    tooltip: { trigger: "axis", valueFormatter: (v) => `${nf(v, 0)} kW` },
    xAxis: { type: "value", name: "m/s", min: 0, max: 25 },
    yAxis: { type: "value", name: "kW" },
    series: all.filter((x) => x.turbine.id === s.turbine || x.turbine.make !== farm.turbine.make).slice(0, 6).map((x) => ({
      name: `${x.turbine.make} ${x.turbine.model}`, type: "line", showSymbol: false, data: x.curve,
      lineStyle: { width: x.turbine.id === s.turbine ? 2.5 : 1, opacity: x.turbine.id === s.turbine ? 1 : 0.5 },
      ...(x.turbine.id === s.turbine ? { itemStyle: { color: DATA_COLORS.wind }, lineStyle: { width: 2.5, color: DATA_COLORS.wind } } : {}),
    })),
  }), [all, s.turbine, farm.turbine.make]);
  const groups = [...new Set(cost.lines.map((l) => l.group))];
  return (
    createPortal(
    <div className="trace-overlay" role="dialog" aria-modal="true" aria-label="Wind farm studio" data-testid="wind-studio">
      <div className="trace-shell studio-shell">
        <header className="trace-head">
          <div>
            <span className="rtc-index"><Wind size={12} /> Wind farm studio</span>
            <h2>{farm.count} × {farm.turbine.make} {farm.turbine.model} · {nf(farm.mw, 1)} MW · CUF {pf(farm.netCf, 1)}</h2>
            <p className="rtc-note">{WIND_NOTE}</p>
          </div>
          <div className="studio-apply">
            <button type="button" className="primary" onClick={() => onApply({ capex: Number(cost.crPerMw.toFixed(3)), cuf: Number(farm.netCf.toFixed(4)), studio: s, summary: `${farm.count} × ${farm.turbine.make} ${farm.turbine.model} at ${nf(farm.vHub, 2)} m/s hub wind` })} data-testid="wind-apply">
              <Check size={14} /> Use ₹{nf(cost.crPerMw, 3)} cr/MW and CUF {pf(farm.netCf, 1)} in the bid
            </button>
          </div>
          <button type="button" className="rtc-icon-btn" onClick={onClose} aria-label="Close the studio"><X size={16} /></button>
        </header>
        <div className="studio-body">
          <section className="studio-col">
            <div className="rtc-subhead">Turbines at your site</div>
            <table className="studio-cost studio-turbines" data-testid="wind-turbines">
              <thead><tr><th>Make and model</th><th className="num">MW</th><th className="num">Rotor</th><th className="num">Hub</th><th className="num">W/m²</th><th className="num">Hub wind</th><th className="num">Net CUF</th><th className="num">Turbines</th></tr></thead>
              <tbody>
                {all.map((x) => (
                  <tr key={x.turbine.id} className={x.turbine.id === s.turbine ? "is-chosen" : ""} onClick={() => set({ turbine: x.turbine.id, hubM: null })} data-testid={`turbine-${x.turbine.id}`}>
                    <td><b>{x.turbine.make}</b> {x.turbine.model}</td>
                    <td className="num">{nf(x.turbine.mw, 2)}</td>
                    <td className="num">{x.turbine.rotorM} m</td>
                    <td className="num">{x.hub} m</td>
                    <td className="num">{nf(x.specificPower, 0)}</td>
                    <td className="num">{nf(x.vHub, 2)} m/s</td>
                    <td className="num"><b>{pf(x.netCf, 1)}</b></td>
                    <td className="num">{x.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="rtc-note">Lower W/m² (a bigger rotor for the rating) gives a higher CUF at low-wind Indian sites. Click a turbine to choose it.</p>
            <div className="rtc-subhead">Power curves</div>
            <LiveChart option={curveOption} height={260} />
            <div className="rtc-subhead">Site wind</div>
            <div className="rtc-grid rtc-grid-3">
              <Field label="Farm capacity" unit="MW" value={s.farmMw} onChange={(v) => set({ farmMw: Math.max(1, v) })} step={10} min={1} />
              <Field label="Mean wind speed" unit="m/s" value={s.meanWindMs} onChange={(v) => set({ meanWindMs: v })} step={0.1} min={2} max={15} />
              <Field label="Measured at" unit="m" value={s.measuredAtM} onChange={(v) => set({ measuredAtM: v })} step={10} min={10} max={200} />
              <Field label="Hub height" unit="m" value={s.hubM ?? farm.turbine.hubM} onChange={(v) => set({ hubM: v })} step={5} min={60} max={200} />
              <Field label="Weibull k" value={s.weibullK} onChange={(v) => set({ weibullK: v })} step={0.1} min={1} max={4} />
              <Field label="Wind shear exponent" value={s.shear} onChange={(v) => set({ shear: v })} step={0.01} min={0} max={0.5} />
              <Field label="Air density" unit="kg/m³" value={s.airDensity} onChange={(v) => set({ airDensity: v })} step={0.01} min={0.9} max={1.3} />
              <Field label="Availability" pct value={s.losses.availability} onChange={(v) => set({ losses: { ...s.losses, availability: v } })} step={0.5} min={80} max={100} />
              <Field label="Wake loss" pct value={s.losses.wake} onChange={(v) => set({ losses: { ...s.losses, wake: v } })} step={0.5} min={0} max={25} />
              <Field label="Electrical loss" pct value={s.losses.electrical} onChange={(v) => set({ losses: { ...s.losses, electrical: v } })} step={0.5} min={0} max={10} />
              <Field label="Other losses" pct value={s.losses.other} onChange={(v) => set({ losses: { ...s.losses, other: v } })} step={0.5} min={0} max={10} hint="Icing, curtailment, hysteresis" />
            </div>
          </section>
          <section className="studio-col">
            <div className="rtc-subhead">Farm</div>
            <WindLayout farm={farm} spacing={s.spacingRotors} />
            <div className="studio-facts" data-testid="wind-farm">
              <div><span>Turbines</span><b>{farm.count}</b><small>{nf(farm.mw, 1)} MW installed</small></div>
              <div><span>Wind at hub</span><b>{nf(farm.vHub, 2)} m/s</b><small>Weibull k {s.weibullK}, c {nf(farm.weibullC, 2)}</small></div>
              <div><span>Gross / net CF</span><b>{pf(farm.netCf, 1)}</b><small>gross {pf(farm.grossCf, 1)} × {pf(farm.netFactor, 1)} after losses</small></div>
              <div><span>Energy</span><b>{nf(farm.energyMu, 0)} MU/yr</b><small>{nf(farm.aepMwh, 0)} MWh per turbine</small></div>
              <div><span>Farm area</span><b>{nf(farm.footprintKm2, 1)} km²</b><small>spacing {s.spacingRotors.across}D × {s.spacingRotors.along}D, shared with farming</small></div>
              <div><span>Land bought</span><b>{nf(farm.landAcres, 0)} acres</b><small>{s.landAcresPerTurbine} acres per turbine</small></div>
            </div>
            <div className="rtc-subhead">Cost build-up</div>
            <table className="studio-cost" data-testid="wind-cost">
              <thead><tr><th>Item</th><th className="num">₹ cr/MW</th><th className="num">₹ cr</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <React.Fragment key={g}>
                    <tr className="studio-group"><td colSpan={3}>{g}</td></tr>
                    {cost.lines.filter((l) => l.group === g).map((l) => (
                      <tr key={l.key}>
                        <td>{l.label}{l.note && <small>{l.note}</small>}</td>
                        <td className="num">
                          {l.price !== undefined ? (
                            <label className="studio-price">
                              <input type="number" step={0.01} min={0} value={Number(l.price.toFixed(3))} onChange={(e) => set({ price: { ...s.price, [`${l.key}CrPerMw`]: e.target.value === "" ? null : Number(e.target.value) } })} aria-label={`${l.label} price`} data-testid={`wind-price-${l.key}`} />
                            </label>
                          ) : nf(l.perMw, 3)}
                        </td>
                        <td className="num">{nf(l.cr, 1)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Total</td><td className="num" data-testid="wind-cr-mw"><b>₹{nf(cost.crPerMw, 3)} cr/MW</b></td><td className="num">{nf(cost.total, 0)}</td></tr>
              </tfoot>
            </table>
            <div className="rtc-grid rtc-grid-2 studio-margins">
              <Field label="Land price" unit="₹ lakh/acre" value={s.price.landLakhPerAcre} onChange={(v) => set({ price: { ...s.price, landLakhPerAcre: v } })} step={0.5} min={0} />
              <Field label="Contingency" pct value={s.contingencyPct} onChange={(v) => set({ contingencyPct: v })} step={0.5} min={0} max={20} />
              <Field label="GST on equipment" pct value={s.gstEquipmentPct} onChange={(v) => set({ gstEquipmentPct: v })} step={1} min={0} max={28} hint="Check the current GST notification" />
              <Field label="GST on services" pct value={s.gstServicesPct} onChange={(v) => set({ gstServicesPct: v })} step={1} min={0} max={28} />
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
    )
  );
}

export { TURBINES };
