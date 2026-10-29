import React from "react";
import { Field, nf, pf } from "../rtc/ui";
import { lossFactorsOf, siteFactors, splitSitesOn } from "./model";

// the schematic's colours (chartTheme's data colours, for the SVG)
const C = { solar: "#f5b83d", wind: "#5ec8d8", bess: "#b48cff", grid: "#f4f4f1", line: "#8a8a86", loss: "#ff6b5f" };

function Solar({ x, y }) {
  return (
    <g transform={`translate(${x},${y})`}>
      {[0, 1, 2].map((i) => <rect key={i} x={i * 16} y={0} width={14} height={20} rx={2} fill={C.solar} opacity={0.9} />)}
      <text x={23} y={34} textAnchor="middle" className="ss-label">Solar</text>
    </g>
  );
}
function Wind({ x, y }) {
  return (
    <g transform={`translate(${x},${y})`}>
      {[0, 1].map((i) => (
        <g key={i} transform={`translate(${i * 24},0)`}>
          <line x1={10} y1={8} x2={10} y2={26} stroke={C.wind} strokeWidth={2} />
          <circle cx={10} cy={8} r={2.5} fill={C.wind} />
          {[0, 120, 240].map((a) => <line key={a} x1={10} y1={8} x2={10 + 9 * Math.cos(((a - 90) * Math.PI) / 180)} y2={8 + 9 * Math.sin(((a - 90) * Math.PI) / 180)} stroke={C.wind} strokeWidth={2} />)}
        </g>
      ))}
      <text x={22} y={38} textAnchor="middle" className="ss-label">Wind</text>
    </g>
  );
}
function Battery({ x, y, label = "Battery" }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={0} y={4} width={34} height={18} rx={3} fill="none" stroke={C.bess} strokeWidth={2} />
      <rect x={34} y={9} width={4} height={8} fill={C.bess} />
      <rect x={3} y={7} width={20} height={12} fill={C.bess} opacity={0.8} />
      <text x={19} y={36} textAnchor="middle" className="ss-label">{label}</text>
    </g>
  );
}
function Transformer({ x, y, loss }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx={10} cy={12} r={9} fill="none" stroke={C.grid} strokeWidth={2} />
      <circle cx={22} cy={12} r={9} fill="none" stroke={C.grid} strokeWidth={2} />
      <text x={16} y={36} textAnchor="middle" className="ss-label">33/220 kV</text>
      <text x={16} y={48} textAnchor="middle" className="ss-loss">−{pf(loss, 2)}</text>
    </g>
  );
}
function Meter({ x, y }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={0} y={0} width={44} height={26} rx={4} fill="none" stroke={C.grid} strokeWidth={2} />
      <text x={22} y={17} textAnchor="middle" className="ss-label" style={{ fontWeight: 600 }}>GSS</text>
      <text x={22} y={40} textAnchor="middle" className="ss-label">220 kV billing meter</text>
    </g>
  );
}
function Bus({ x, y, w, label }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x + w} y2={y} stroke={C.grid} strokeWidth={4} strokeLinecap="round" />
      <text x={x + w + 6} y={y + 4} className="ss-label">{label}</text>
    </g>
  );
}
const Wire = ({ d, color = C.line, dashed = false }) => <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeDasharray={dashed ? "4 3" : undefined} />;

/**
 * One line diagram of the plant: solar, wind and the battery on one site, sharing a pooling
 * station (the 33/220 kV transformer and the 220 kV line to the billing meter), or on separate
 * sites, each with its own battery and its own pooling station and line. The losses at each
 * pooling station are the inputs beside it; year-1 energies at the meter when the plant is sized.
 */
export default function SiteSchematic({ state, setState, energy = null }) {
  const split = splitSitesOn(state);
  const sf = siteFactors(state);
  const lf = lossFactorsOf(state);
  const on = state.sources;
  const setSite = (k, values) => setState((s) => ({ ...s, sites: { ...s.sites, [k]: { ...s.sites[k], ...values } }, lp: null }));
  const setShared = (values) => setState((s) => ({ ...s, losses: { ...(s.losses || {}), ...values }, lp: null }));
  const lineLabel = (poi) => `−${pf(1 - poi, 2)} to the meter`;
  const W = 640;
  return (
    <div className="site-schematic" data-testid="site-schematic" data-split={split ? "1" : "0"}>
      <svg viewBox={`0 0 ${W} ${split ? 250 : 170}`} role="img" aria-label={split ? "Solar and wind on separate sites, each with a pooling station" : "Solar, wind and the battery on one site with one pooling station"}>
        {!split ? (
          <g>
            {on.solar && <Solar x={30} y={20} />}
            {on.wind && <Wind x={120} y={16} />}
            {on.bess && <Battery x={210} y={20} />}
            {on.solar && <Wire d="M53,42 L53,80" color={C.solar} />}
            {on.wind && <Wire d="M142,42 L142,80" color={C.wind} />}
            {on.bess && <Wire d="M229,42 L229,80" color={C.bess} />}
            <Bus x={20} y={80} w={260} label="33 kV bus · one site" />
            <Wire d="M280,80 L340,80" />
            <Transformer x={340} y={68} loss={lf.trafo} />
            <Wire d="M372,80 L560,80" dashed />
            <text x={466} y={72} textAnchor="middle" className="ss-label">220 kV line</text>
            <text x={466} y={96} textAnchor="middle" className="ss-loss">−{pf(lf.line, 2)}</text>
            <Meter x={560} y={67} />
            <text x={300} y={140} textAnchor="middle" className="ss-note">One pooling station: {pf(sf.common, 2)} of the 33 kV bus energy reaches the meter{energy ? ` · year 1 ${nf(energy.meterMu, 0)} MU at the meter` : ""}</text>
          </g>
        ) : (
          <g>
            <Solar x={30} y={14} />
            <Battery x={120} y={14} label="Battery A" />
            <Wire d="M53,36 L53,70" color={C.solar} />
            <Wire d="M139,36 L139,70" color={C.bess} />
            <Bus x={20} y={70} w={160} label="33 kV · solar site" />
            <Wire d="M180,70 L300,70" />
            <Transformer x={300} y={58} loss={sf.solarSite.trafo} />
            <Wire d="M332,70 L540,70 L560,100" dashed />
            <text x={430} y={62} textAnchor="middle" className="ss-label">220 kV line A</text>
            <text x={430} y={86} textAnchor="middle" className="ss-loss">−{pf(sf.solarSite.line, 2)}</text>

            <Wind x={30} y={136} />
            <Battery x={120} y={138} label="Battery B" />
            <Wire d="M52,162 L52,194" color={C.wind} />
            <Wire d="M139,160 L139,194" color={C.bess} />
            <Bus x={20} y={194} w={160} label="33 kV · wind site" />
            <Wire d="M180,194 L300,194" />
            <Transformer x={300} y={182} loss={sf.windSite.trafo} />
            <Wire d="M332,194 L540,194 L560,130" dashed />
            <text x={430} y={186} textAnchor="middle" className="ss-label">220 kV line B</text>
            <text x={430} y={210} textAnchor="middle" className="ss-loss">−{pf(sf.windSite.line, 2)}</text>
            <Meter x={560} y={102} />
            <text x={300} y={240} textAnchor="middle" className="ss-note">Two pooling stations: {pf(sf.solar, 2)} of the solar site's energy and {pf(sf.wind, 2)} of the wind site's reach the meter · each battery charges from its own site</text>
          </g>
        )}
      </svg>
      <div className="rtc-grid rtc-grid-4 site-losses">
        {!split ? (
          <>
            <Field label="Power transformer loss" pct value={lf.trafo} onChange={(v) => setShared({ trafoLossPct: v })} step={0.05} min={0} max={5} hint="33/220 kV, shared pooling station" />
            <Field label="220 kV line loss" pct value={lf.line} onChange={(v) => setShared({ lineLossPct: v })} step={0.05} min={0} max={5} hint="to the GSS billing meter" />
          </>
        ) : (
          <>
            <Field label="Solar site transformer" pct value={sf.solarSite.trafo} onChange={(v) => setSite("solarSite", { trafoLossPct: v })} step={0.05} min={0} max={5} hint="pooling station A" />
            <Field label="Solar site line" pct value={sf.solarSite.line} onChange={(v) => setSite("solarSite", { lineLossPct: v })} step={0.05} min={0} max={5} hint={lineLabel(sf.solar)} />
            <Field label="Wind site transformer" pct value={sf.windSite.trafo} onChange={(v) => setSite("windSite", { trafoLossPct: v })} step={0.05} min={0} max={5} hint="pooling station B" />
            <Field label="Wind site line" pct value={sf.windSite.line} onChange={(v) => setSite("windSite", { lineLossPct: v })} step={0.05} min={0} max={5} hint={lineLabel(sf.wind)} />
          </>
        )}
      </div>
    </div>
  );
}
