import React, { useState } from "react";
import { Ban, ChevronDown, ChevronRight, Crosshair, Download, Loader2, Lock } from "lucide-react";
import { Stat, nf, pf } from "../rtc/ui";

// The track to a quote, as a story: the verdict, a waterfall from the price the model needs down to
// the quote, then the moves in order with the chance of each, who decides it, why it works and how
// far it could plausibly go. Data from track.js (planTrack).

const fmtV = (st, v) => (st.pct ? pf(v, 2) : nf(v, st.step < 0.01 ? 4 : st.step < 1 ? 2 : 0));
const unitOf = (st) => (st.pct ? "" : ` ${st.unit}`);

/**
 * The band edges of a move as a sentence; edges that coincide are said once ("sure to 50 MW, the
 * end of its range" rather than four times 50 MW).
 */
export function edgesText(st) {
  const e = st.edges;
  const same = (a, b) => Math.abs(a - b) < 1e-9;
  const v = (x) => `${fmtV(st, x)}${unitOf(st)}`;
  if (same(e.sure, e.likely) && same(e.likely, e.stretch) && same(e.stretch, e.zero)) return `sure all the way to ${v(e.sure)}, the end of its range: this one is yours to choose.`;
  const parts = [`sure to ${v(e.sure)}`];
  if (!same(e.likely, e.sure)) parts.push(`likely to ${v(e.likely)} (50%)`);
  if (!same(e.stretch, e.likely)) parts.push(`a stretch to ${v(e.stretch)} (10%)`);
  parts.push(same(e.zero, e.stretch) ? `nothing past ${v(e.zero)}, the end of its range` : `no chance past ${v(e.zero)}`);
  return `${parts.join(", ")}.`;
}

/** The chance as a chip: sure, likely, a stretch, a long shot, none. */
export function Chance({ p }) {
  const cls = p >= 0.999 ? "sure" : p >= 0.5 ? "likely" : p >= 0.1 ? "stretch" : p > 0 ? "long" : "none";
  const word = { sure: "sure", likely: "likely", stretch: "a stretch", long: "a long shot", none: "no chance" }[cls];
  return <span className={`track-chip ${cls}`} data-testid="cfd-track-chance">{pf(p, p > 0 && p < 0.01 ? 1 : 0)} · {word}</span>;
}

function Waterfall({ track, onPick }) {
  const shown = track.steps.slice(0, 8);
  const rest = track.steps.slice(8);
  const steps = rest.length ? [...shown, { label: `${rest.length} more moves`, price: track.steps[track.steps.length - 1].price, drop: shown[shown.length - 1].price - track.steps[track.steps.length - 1].price }] : shown;
  const top = track.base;
  const bottom = Math.min(track.target, ...steps.map((s) => s.price), track.floor ?? track.target);
  const span = Math.max(1e-6, top - bottom);
  const W = 720;
  const H = 180;
  const padL = 56;
  const padB = 24;
  const n = steps.length + 2;
  const colW = (W - padL - 12) / n;
  const y = (v) => 10 + ((top - v) / span) * (H - padB - 10);
  const bars = [];
  let prev = top;
  bars.push({ label: "Model needs", from: top, to: top, kind: "base" });
  for (const s of steps) { bars.push({ label: s.label, from: prev, to: s.price, kind: s.drop >= 0 ? "drop" : "rise", key: s.key || null, title: `${s.label}: ₹${nf(prev, 3)} → ₹${nf(s.price, 3)}` }); prev = s.price; }
  bars.push({ label: track.reached ? "Your quote" : "Still short", from: prev, to: bottom, kind: track.reached ? "quote" : "short", full: true });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="track-waterfall" data-testid="cfd-track-waterfall">
      <line x1={padL} x2={W - 12} y1={y(track.target)} y2={y(track.target)} className="target" />
      <text x={padL - 4} y={y(track.target) + 4} textAnchor="end" className="axis">₹{nf(track.target, 2)}</text>
      <text x={padL - 4} y={y(top) + 4} textAnchor="end" className="axis">₹{nf(top, 2)}</text>
      {bars.map((b, k) => {
        const x = padL + k * colW + 4;
        const yTop = y(Math.max(b.from, b.to));
        const h = Math.max(2, Math.abs(y(b.from) - y(b.to)));
        return (
          <g key={k}>
            <rect x={x} y={b.kind === "base" || b.full ? y(b.from) : yTop} width={colW - 8} height={b.kind === "base" || b.full ? Math.max(2, H - padB - y(b.from)) : h} className={`wf-bar ${b.kind} ${b.key ? "pick" : ""}`} onClick={b.key && onPick ? () => onPick(b.key) : undefined} data-testid={b.key ? `cfd-track-bar-${b.key}` : undefined}>
              {b.title && <title>{b.title}</title>}
            </rect>
            <text x={x + (colW - 8) / 2} y={H - 6} textAnchor="middle" className="axis">{b.label.length > 14 ? `${b.label.slice(0, 13)}…` : b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function TrackView({ track, targetIrr, onApply, frozen = {}, onFreeze = null, onReject = null, onDownload = null, downloading = false }) {
  const [showFloor, setShowFloor] = useState(false);
  const [lit, setLit] = useState(null);
  const pick = (key) => {
    const el = document.querySelector(`[data-testid="cfd-track-step-${key}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setLit(key);
    setTimeout(() => setLit((k) => (k === key ? null : k)), 1800);
  };
  if (track.above) {
    return (
      <div className="track" data-testid="cfd-track">
        <p className="track-verdict good" data-testid="cfd-track-verdict">Your quote of ₹{nf(track.target, 3)} is above the ₹{nf(track.base, 3)} the model needs: nothing to find. At that quote the equity earns more than its {pf(targetIrr, 1)} target; the levers below say how much room each adverse move would take.</p>
      </div>
    );
  }
  const verdict = track.reached
    ? track.chance >= 0.5
      ? `Reachable with likely moves: ${track.steps.length} ${track.steps.length === 1 ? "lever" : "levers"} take the price from ₹${nf(track.base, 3)} to ₹${nf(track.final, 3)}, with a ${pf(track.chance, 0)} chance that every move comes off.`
      : track.chance >= 0.05
        ? `Reachable, but a stretch: ${track.steps.length} levers get the price to ₹${nf(track.final, 3)}, and the chance that all of them come off is ${pf(track.chance, 0)}.`
        : `Only on paper: the levers can get the price to ₹${nf(track.final, 3)}, but the chance that every move comes off is ${pf(track.chance, 1)}. Not a bid-day plan.`
    : `Out of reach: with every lever at the end of its chance the price is still ₹${nf(track.floor, 3)}, above your ₹${nf(track.target, 3)}. Chance: 0%.`;
  const tone = track.reached ? (track.chance >= 0.5 ? "good" : track.chance >= 0.05 ? "warn" : "bad") : "bad";
  return (
    <div className="track" data-testid="cfd-track">
      <div className="rtc-grid rtc-grid-4">
        <Stat label="The model needs" value={`₹${nf(track.base, 3)}`} detail={`for a ${pf(targetIrr, 1)} equity IRR`} />
        <Stat label="You want to quote" value={`₹${nf(track.target, 3)}`} detail={`₹${nf(track.gap, 3)}/kWh to find`} />
        <Stat label="The track ends at" value={`₹${nf(track.reached ? track.final : track.floor, 3)}`} detail={track.reached ? `${track.steps.length} moves` : "every lever at the end of its chance"} tone={track.reached ? undefined : "bad"} />
        <Stat label="Chance it all comes off" value={pf(track.chance, track.chance > 0 && track.chance < 0.01 ? 1 : 0)} detail="the moves' chances multiplied" tone={tone === "good" ? "good" : "bad"} />
      </div>
      <p className={`track-verdict ${tone}`} data-testid="cfd-track-verdict">{verdict}</p>
      {track.steps.length > 0 && <Waterfall track={track} onPick={pick} />}
      {track.steps.length > 0 && (
        <ol className="track-steps" data-testid="cfd-track-steps">
          {track.steps.map((st, k) => (
            <li key={st.key} className={lit === st.key ? "lit" : ""} data-testid={`cfd-track-step-${st.key}`}>
              <div className="track-step-head">
                <b>{k + 1}. {st.label}</b>: {fmtV(st, st.from)}{unitOf(st)} → <b>{fmtV(st, st.to)}{unitOf(st)}</b> <Chance p={st.p} />
                <span className="track-price">price {st.drop >= 0 ? "falls" : "rises"} ₹{nf(Math.abs(st.drop), 3)} to <b>₹{nf(st.price, 3)}</b></span>
                <span className="track-cum">chance so far {pf(st.cum, st.cum > 0 && st.cum < 0.01 ? 1 : 0)}</span>
                {frozen[st.key] ? <span className="frozen-mark"><Lock size={11} /> frozen</span> : onFreeze && <button type="button" className="secondary freeze-btn" onClick={() => onFreeze(st)} title="Sure of this value? Freeze it with the evidence (a better one if you have it); the next track leaves it alone" data-testid={`cfd-track-freeze-${st.key}`}><Lock size={11} /> Freeze at this value</button>}
                {!frozen[st.key] && onReject && <button type="button" className="secondary freeze-btn" onClick={() => onReject(st)} title="Not a move you will make? Turn it down; the track is plotted again without it" data-testid={`cfd-track-reject-${st.key}`}><Ban size={11} /> Not for us</button>}
              </div>
              <div className="track-step-body">
                {st.who && <span><b>Who decides:</b> {st.who}.</span>}
                {st.why && <span> <b>Why it works:</b> {st.why}</span>}
                {st.edges && <span> <b>How far it can go:</b> {edgesText(st)}</span>}
                {st.operation && <span> Re-simulated: this move changes the day-by-day operation.</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {(track.frozenKeys?.length > 0 || track.rejectedKeys?.length > 0) && <p className="track-note">{[track.frozenKeys?.length ? `${track.frozenKeys.length} frozen ${track.frozenKeys.length === 1 ? "lever was" : "levers were"} left as they are` : null, track.rejectedKeys?.length ? `${track.rejectedKeys.length} ${track.rejectedKeys.length === 1 ? "lever you turned down was" : "levers you turned down were"} not used` : null].filter(Boolean).join("; ")}; the track found the gap elsewhere.</p>}
      {track.steps.length > 0 && (onApply || onDownload) && (
        <div className="track-actions">
          {onApply && <button type="button" className="secondary" onClick={() => onApply(track.steps)} data-testid="cfd-track-apply"><Crosshair size={12} /> Apply every move to the bid</button>}
          {onDownload && <button type="button" className="primary" onClick={onDownload} disabled={downloading} data-testid="cfd-whatif-download">{downloading ? <Loader2 size={12} className="spin" /> : <Download size={12} />} {downloading ? "Building the workbook…" : "Download What-if model (Excel)"}</button>}
          <small>The workbook is the bid with every move applied, priced through the full model, with a What-if track sheet (the moves, their chances, the frozen levers). Apply writes the moves into the bid; then size the plant again if any move was re-simulated.</small>
        </div>
      )}
      {!track.reached && track.floorLevers.length > 0 && (
        <div className="track-floor">
          <button type="button" className="lever-why" onClick={() => setShowFloor((v) => !v)} data-testid="cfd-track-floor-toggle">{showFloor ? <ChevronDown size={12} /> : <ChevronRight size={12} />} What the floor assumes: {track.floorLevers.length} levers at the end of their chance</button>
          {showFloor && (
            <ul>
              {track.floorLevers.map((f) => <li key={f.key}>{f.label}: {fmtV(f, f.from)}{unitOf(f)} → {fmtV(f, f.to)}{unitOf(f)}</li>)}
            </ul>
          )}
        </div>
      )}
      <p className="track-note">
        How the track is found: every lever that lowers the price is a candidate; at each turn the one whose next step buys the most price for the least chance given up is moved, until the gap is closed; the moves are then ordered from the surest to the least likely and priced for real, one after another, through the full financial model. The chance of a move comes from three bands per lever (sure, likely, a stretch; benchmark judgement for a 2028 project, named under each move), and the chance of the whole track is the product of the moves' chances, as if they were independent. Levers that are not yours to choose (the tax rate, the market's prices) are left out.
      </p>
    </div>
  );
}
