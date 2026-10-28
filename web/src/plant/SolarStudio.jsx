"use client";
// The solar plant studio: lay out a grid-scale plant (modules, strings, tables or trackers,
// inverters, blocks, land), compare string and central inverters, and build its cost up line by
// line in ₹/Wp; "Use in the bid" writes the ₹ cr/MWac and the DC:AC into the solar source.
import { createPortal } from "react-dom";
import React, { useMemo } from "react";
import { Check, LayoutGrid, Sun, X } from "lucide-react";
import { Field, SelectBox, SwitchBox, nf, pf } from "../rtc/ui";
import { INVERTERS, MODULES, PLANT_NOTE, STRUCTURES, defaultSolarStudio, inverterComparison, solarCost, solarDesign } from "./solar";

/** The plant seen from above: blocks of rows, an inverter station or IDT per block, the substation. */
export function SolarLayout({ design, width = 640, height = 340 }) {
  const n = design.blocks;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
  const rowsN = Math.ceil(n / cols);
  const pad = 14;
  const subW = 70;
  const bw = (width - pad * 2 - subW - 16) / cols;
  const bh = Math.min((height - pad * 2) / rowsN, bw * 0.75);
  const stripes = design.structure.id === "sat" ? 7 : 9;
  const blocks = [];
  for (let i = 0; i < n; i += 1) {
    const cx = pad + (i % cols) * bw;
    const cy = pad + Math.floor(i / cols) * bh;
    const inner = [];
    for (let k = 0; k < stripes; k += 1) {
      const y = cy + 4 + ((bh - 10) * k) / stripes;
      inner.push(<rect key={k} x={cx + 4} y={y} width={bw - 18} height={Math.max(1.2, ((bh - 10) / stripes) * (design.structure.id === "sat" ? 0.35 : 0.5))} className="sl-row" />);
    }
    blocks.push(
      <g key={i}>
        <rect x={cx + 1} y={cy + 1} width={bw - 2} height={bh - 2} className="sl-block" />
        {inner}
        <rect x={cx + bw - 12} y={cy + bh / 2 - 4} width={8} height={8} className={design.inverter.id === "central" ? "sl-station" : "sl-idt"} />
      </g>,
    );
  }
  const sx = width - pad - subW;
  const sh = Math.min(90, rowsN * bh);
  return (
    <svg className="solar-layout" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Plant layout: ${n} blocks`} data-testid="solar-layout">
      <rect x="1" y="1" width={width - 2} height={height - 2} className="sl-fence" />
      {blocks}
      <rect x={sx} y={pad + (rowsN * bh - sh) / 2} width={subW - 4} height={sh} className="sl-sub" />
      <text x={sx + (subW - 4) / 2} y={pad + rowsN * bh / 2 - 4} textAnchor="middle" className="sl-label">33/220 kV</text>
      <text x={sx + (subW - 4) / 2} y={pad + rowsN * bh / 2 + 10} textAnchor="middle" className="sl-label">pooling</text>
    </svg>
  );
}

const PRICE_KEY = { module: "modulePerWp", structure: "structurePerWp", dcCable: "dcCablePerWp", inverter: "inverterPerWac", lvAc: "lvAcPerWac", idt: "idtPerWac", mvCable: "mvCablePerWac", switchgear: "switchgearPerWac", scada: "scadaPerWp", earthing: "earthingPerWp", cleaning: "cleaningPerWp", civil: "civilPerWp", buildings: "buildingsPerWp", install: "installPerWp", transport: "transportPerWp", engineering: "engineeringPerWp" };

/** The studio's whole screen; studio is its saved input, onChange saves it, onApply uses its cost. */
export default function SolarStudio({ studio, onChange, onApply, onClose, acMw, fixedCuf }) {
  const s = useMemo(() => ({ ...defaultSolarStudio(), ...(studio || {}), ...(acMw && !studio?.acMw ? { acMw } : {}), price: { ...defaultSolarStudio().price, ...(studio?.price || {}) } }), [studio, acMw]);
  const set = (v) => onChange({ ...s, ...v });
  const setPrice = (k, v) => onChange({ ...s, price: { ...s.price, [k]: v } });
  const design = useMemo(() => solarDesign(s), [s]);
  const cost = useMemo(() => solarCost(s, design), [s, design]);
  const compare = useMemo(() => inverterComparison(s), [s]);
  const groups = [...new Set(cost.lines.map((l) => l.group))];
  return (
    createPortal(
    <div className="trace-overlay" role="dialog" aria-modal="true" aria-label="Solar plant studio" data-testid="solar-studio">
      <div className="trace-shell studio-shell">
        <header className="trace-head">
          <div>
            <span className="rtc-index"><Sun size={12} /> Solar plant studio</span>
            <h2>{nf(s.acMw, 0)} MWac · {nf(design.dcMw, 1)} MWp · ₹{nf(cost.perWp, 2)}/Wp</h2>
            <p className="rtc-note">{PLANT_NOTE} Every price is editable; the layout, quantities and cost follow each change.</p>
          </div>
          <div className="studio-apply">
            <button type="button" className="primary" onClick={() => onApply({ capex: Number(cost.crPerMwac.toFixed(3)), dcAc: Number(design.dcAc.toFixed(3)), studio: s, summary: `₹${nf(cost.perWp, 2)}/Wp · ${design.inverter.id === "central" ? "central" : "string"} inverters · ${design.structure.id === "sat" ? "single-axis tracker" : "fixed tilt"}` })} data-testid="solar-apply">
              <Check size={14} /> Use ₹{nf(cost.crPerMwac, 3)} cr/MWac in the bid
            </button>
          </div>
          <button type="button" className="rtc-icon-btn" onClick={onClose} aria-label="Close the studio"><X size={16} /></button>
        </header>
        <div className="studio-body">
          <section className="studio-col">
            <div className="rtc-subhead">Plant</div>
            <div className="rtc-grid rtc-grid-2">
              <Field label="AC capacity" unit="MWac" value={s.acMw} onChange={(v) => set({ acMw: Math.max(1, v) })} step={10} min={1} />
              <Field label="DC:AC ratio" unit="MWp/MWac" value={s.dcAc} onChange={(v) => set({ dcAc: Math.max(1, v) })} step={0.05} min={1} max={2.5} />
              <SelectBox label="Module" value={s.module} onChange={(v) => set({ module: v })} options={MODULES.map((m) => [m.id, m.name])} />
              <SelectBox label="Mounting" value={s.structure} onChange={(v) => set({ structure: v })} options={STRUCTURES.map((m) => [m.id, m.name])} />
              <SelectBox label="Inverters" value={s.inverter} onChange={(v) => set({ inverter: v })} options={INVERTERS.map((m) => [m.id, m.name])} />
              <Field label="Coldest site temperature" unit="°C" value={s.minTempC} onChange={(v) => set({ minTempC: v })} step={1} min={-20} max={30} hint="Sets the modules per string (Voc at the system voltage)" />
              <Field label="Land price" unit="₹ lakh/acre" value={s.landLakhPerAcre} onChange={(v) => set({ landLakhPerAcre: v })} step={0.5} min={0} />
              <SwitchBox label="Robotic module cleaning" checked={s.cleaningRobots} onChange={(v) => set({ cleaningRobots: v })} />
            </div>
            <div className="rtc-subhead">Layout</div>
            <SolarLayout design={design} />
            <div className="studio-facts" data-testid="solar-design">
              <div><span>Modules per string</span><b>{design.modulesPerString}</b><small>{nf(design.stringVoc, 0)} V Voc at {s.minTempC} °C ≤ {s.systemV} V</small></div>
              <div><span>Strings</span><b>{nf(design.strings, 0)}</b><small>{nf(design.modules, 0)} modules</small></div>
              <div><span>{design.structure.id === "sat" ? "Trackers" : "Tables"}</span><b>{nf(design.tables, 0)}</b><small>{design.modulesPerTable} modules, {nf(design.rowLengthM, 0)} m long</small></div>
              <div><span>Inverters</span><b>{nf(design.inverters, 0)}</b><small>{nf(design.stringsPerInverter, 1)} strings each</small></div>
              <div><span>Blocks</span><b>{design.blocks}</b><small>{design.idts ? `${design.idts} IDTs of ${design.inverter.blockMw} MVA` : `${design.inverter.blockMw} MW stations`}</small></div>
              <div><span>DC capacity</span><b>{nf(design.dcMw, 1)} MWp</b><small>DC:AC {nf(design.dcAc, 3)}</small></div>
              <div><span>Land</span><b>{nf(design.acres, 0)} acres</b><small>{nf(design.acresPerMwp, 2)} acres/MWp · row pitch {nf(design.pitchM, 1)} m</small></div>
              <div><span>Energy</span><b>{design.structure.yieldGain ? `+${pf(design.structure.yieldGain, 0)}` : "Base"}</b><small>{design.structure.yieldGain ? "tracker gain on the fixed-tilt CUF" : "fixed tilt"}{fixedCuf ? ` · CUF ${pf(fixedCuf * (1 + design.structure.yieldGain), 1)}` : ""}</small></div>
            </div>
          </section>
          <section className="studio-col">
            <div className="rtc-subhead">Cost build-up</div>
            <table className="studio-cost" data-testid="solar-cost">
              <thead><tr><th>Item</th><th className="num">Price</th><th className="num">₹ cr</th><th className="num">₹/Wp</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <React.Fragment key={g}>
                    <tr className="studio-group"><td colSpan={4}>{g}</td></tr>
                    {cost.lines.filter((l) => l.group === g).map((l) => (
                      <tr key={l.key}>
                        <td>{l.label}{l.note && <small>{l.note}</small>}</td>
                        <td className="num">
                          {PRICE_KEY[l.key] ? (
                            <label className="studio-price">
                              <input type="number" step={0.05} min={0} value={Number(l.price.toFixed(3))} onChange={(e) => setPrice(PRICE_KEY[l.key], e.target.value === "" ? null : Number(e.target.value))} aria-label={`${l.label} price`} data-testid={`solar-price-${l.key}`} />
                              <span>₹/{l.basis}</span>
                            </label>
                          ) : ""}
                        </td>
                        <td className="num">{nf(l.cr, 1)}</td>
                        <td className="num">{nf(l.perWp, 2)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Total</td><td /><td className="num">{nf(cost.total, 0)}</td><td className="num" data-testid="solar-per-wp">{nf(cost.perWp, 2)}</td></tr>
                <tr><td colSpan={2}>Per MWp / per MWac</td><td className="num" colSpan={2}>₹{nf(cost.crPerMwp, 3)} cr/MWp · <b data-testid="solar-cr-mwac">₹{nf(cost.crPerMwac, 3)} cr/MWac</b></td></tr>
              </tfoot>
            </table>
            <div className="rtc-grid rtc-grid-2 studio-margins">
              <Field label="EPC margin" pct value={s.epcMarginPct} onChange={(v) => set({ epcMarginPct: v })} step={0.5} min={0} max={30} />
              <Field label="Contingency" pct value={s.contingencyPct} onChange={(v) => set({ contingencyPct: v })} step={0.5} min={0} max={20} />
              <Field label="GST on equipment" pct value={s.gstEquipmentPct} onChange={(v) => set({ gstEquipmentPct: v })} step={1} min={0} max={28} hint="Check the current GST notification" />
              <Field label="GST on services" pct value={s.gstServicesPct} onChange={(v) => set({ gstServicesPct: v })} step={1} min={0} max={28} />
              <Field label="Equipment share of EPC" pct value={s.equipmentShare} onChange={(v) => set({ equipmentShare: v })} step={5} min={0} max={100} hint="For the GST split" />
            </div>
            <div className="rtc-subhead"><LayoutGrid size={12} /> String or central inverters, same plant</div>
            <table className="studio-cost" data-testid="solar-inverters">
              <thead><tr><th /> {compare.map((x) => <th key={x.inverter.id} className={`num ${x.inverter.id === s.inverter ? "is-chosen" : ""}`}>{x.inverter.id === "string" ? "String" : "Central"}</th>)}</tr></thead>
              <tbody>
                <tr><td>Units × size</td>{compare.map((x) => <td key={x.inverter.id} className="num">{x.design.inverters} × {x.inverter.unitMw} MW</td>)}</tr>
                <tr><td>Blocks / transformers</td>{compare.map((x) => <td key={x.inverter.id} className="num">{x.design.blocks} / {x.design.idts || `${x.design.blocks} on skids`}</td>)}</tr>
                <tr><td>Inverter equipment</td>{compare.map((x) => <td key={x.inverter.id} className="num">₹{nf(x.cost.lines.filter((l) => ["inverter", "lvAc", "idt", "dcCable"].includes(l.key)).reduce((a, l) => a + l.perWp, 0), 2)}/Wp</td>)}</tr>
                <tr><td>European efficiency</td>{compare.map((x) => <td key={x.inverter.id} className="num">{pf(x.inverter.euroEff, 1)}</td>)}</tr>
                <tr><td>Availability</td>{compare.map((x) => <td key={x.inverter.id} className="num">{pf(x.inverter.availability, 1)}</td>)}</tr>
                <tr><td>Energy factor (eff. × avail.)</td>{compare.map((x) => <td key={x.inverter.id} className="num">{pf(x.energyFactor, 2)}</td>)}</tr>
                <tr><td>Plant cost</td>{compare.map((x) => <td key={x.inverter.id} className="num"><b>₹{nf(x.cost.crPerMwac, 3)} cr/MWac</b></td>)}</tr>
                <tr><td>Inverter O&M</td>{compare.map((x) => <td key={x.inverter.id} className="num">₹{nf(x.inverter.omLakhPerMw, 1)} lakh/MW/yr</td>)}</tr>
              </tbody>
            </table>
            {compare.map((x) => <p key={x.inverter.id} className="rtc-note"><b>{x.inverter.id === "string" ? "String" : "Central"}:</b> {x.inverter.notes}</p>)}
          </section>
        </div>
      </div>
    </div>,
    document.body,
    )
  );
}
