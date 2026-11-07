import React, { useState } from "react";
import { ChevronDown, ChevronRight, Crosshair } from "lucide-react";
import { Stat, nf, pf } from "../rtc/ui";

// The track to a quote, as a story: the verdict, a waterfall from the price the model needs down to
// the quote, then the moves in order with the chance of each, who decides it, why it works and how
// far it could plausibly go. Data from track.js (planTrack).

const fmtV = (st, v) => (st.pct ? pf(v, 2) : nf(v, st.step < 0.01 ? 4 : st.step < 1 ? 2 : 0));
const unitOf = (st) => (st.pct ? "" : ` ${st.unit}`);

/** The chance as a chip: sure, likely, a stretch, a long shot, none. */
export function Chance({ p }) {
  const cls = p >= 0.999 ? "sure" : p >= 0.5 ? "likely" : p >= 0.1 ? "stretch" : p > 0 ? "long" : "none";
  const word = { sure: "sure", likely: "likely", stretch: "a stretch", long: "a long shot", none: "no chance" }[cls];
  return <span className={`track-chip ${cls}`} data-testid="cfd-track-chance">{pf(p, p > 0 && p < 0.01 ? 1 : 0)} · {word}</span>;
}

function Waterfall({ track }) {
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
  for (const s of steps) { bars.push({ label: s.label, from: prev, to: s.price, kind: s.drop >= 0 ? "drop" : "rise" }); prev = s.price; }
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
            <rect x={x} y={b.kind === "base" || b.full ? y(b.from) : yTop} width={colW - 8} height={b.kind === "base" || b.full ? Math.max(2, H - padB - y(b.from)) : h} className={`wf-bar ${b.kind}`} />
            <text x={x + (colW - 8) / 2} y={H - 6} textAnchor="middle" className="axis">{b.label.length > 14 ? `${b.label.slice(0, 13)}…` : b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function TrackView({ track, targetIrr, onApply }) {
  const [showFloor, setShowFloor] = useState(false);
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
      {track.steps.length > 0 && <Waterfall track={track} />}
      {track.steps.length > 0 && (
        <ol className="track-steps" data-testid="cfd-track-steps">
          {track.steps.map((st, k) => (
            <li key={st.key} data-testid={`cfd-track-step-${st.key}`}>
              <div className="track-step-head">
                <b>{k + 1}. {st.label}</b>: {fmtV(st, st.from)}{unitOf(st)} → <b>{fmtV(st, st.to)}{unitOf(st)}</b> <Chance p={st.p} />
                <span className="track-price">price {st.drop >= 0 ? "falls" : "rises"} ₹{nf(Math.abs(st.drop), 3)} to <b>₹{nf(st.price, 3)}</b></span>
                <span className="track-cum">chance so far {pf(st.cum, st.cum > 0 && st.cum < 0.01 ? 1 : 0)}</span>
              </div>
              <div className="track-step-body">
                {st.who && <span><b>Who decides:</b> {st.who}.</span>}
                {st.why && <span> <b>Why it works:</b> {st.why}</span>}
                {st.edges && (
                  <span> <b>How far it can go:</b> sure to {fmtV(st, st.edges.sure)}{unitOf(st)}, likely to {fmtV(st, st.edges.likely)}{unitOf(st)} (50%), a stretch to {fmtV(st, st.edges.stretch)}{unitOf(st)} (10%), no chance past {fmtV(st, st.edges.zero)}{unitOf(st)}.</span>
                )}
                {st.operation && <span> Re-simulated: this move changes the day-by-day operation.</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {track.steps.length > 0 && onApply && (
        <div className="track-actions">
          <button type="button" className="secondary" onClick={() => onApply(track.steps)} data-testid="cfd-track-apply"><Crosshair size={12} /> Apply every move to the bid</button>
          <small>Then size the plant again if any move was re-simulated, and plot the track again.</small>
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
