import React, { useMemo, useState } from "react";
import { ArrowRight, Copy, RefreshCw, TriangleAlert } from "lucide-react";
import { Field, Section, SelectBox, nf, pf } from "../rtc/ui";
import Cite from "./Cite.jsx";
import { fmtDate, keyDates, addMonths, missingInputs, runModel } from "./model.js";
import { runCfdFinance } from "./finance.js";
import { OWN_SOLAR_DEFAULTS, bidSummary, compareBids, copyBid, hasBilateral } from "./ownSolar.js";

export { OWN_SOLAR_DEFAULTS };

/** The other tab's bid as this browser holds it, or null. */
function readOther(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * The inputs the CfD Own Solar tab adds, on the Bid inputs step: the existing plant that charges
 * the battery for the first months, and when the new RE at site is paid for.
 * Props: state, setState, otherKey (where the CfD Bid tab keeps its bid), fromSaved.
 */
export function OwnSolarInputs({ state, setState, otherKey, fromSaved }) {
  const i = state.inputs;
  const [copied, setCopied] = useState("");
  const set = (patch) => setState((s) => ({ ...s, inputs: { ...s.inputs, ...patch } }));
  const dates = i.effectiveDate ? keyDates(i.effectiveDate) : null;
  const until = dates && i.bilateralMonths > 0 ? addMonths(dates.scd, i.bilateralMonths) : null;
  const beyond = until && until > dates.extraUntil;
  const on = hasBilateral(i);
  const copy = () => {
    const other = readOther(otherKey);
    if (!other) { setCopied("The CfD Bid tab has no bid in this browser yet: enter one there first."); return; }
    setState((s) => copyBid(fromSaved(other), s));
    setCopied(`Copied the CfD Bid tab's bid (${nf(other.inputs?.contractedMw || 0)} MW). This tab's own inputs below are kept.`);
  };
  return (
    <Section index="3.4" title="Own solar: an existing plant, and when the new RE is paid for" note="What this tab adds to the CfD bid"
      actions={<button type="button" className="secondary" onClick={copy} data-testid="cfd-own-copy"><Copy size={13} /> Start from the CfD Bid tab's bid</button>}>
      <p className="rtc-note">
        This tab is the CfD bid with two things modelled as a bidder with solar of their own builds it. Every other step works as on the CfD Bid tab, and each tab keeps its own bid, so you can run both and compare them on the Financial model step.
        {" "}<Cite id="market25" /> <Cite id="market75" />
      </p>
      {copied && <p className="rtc-note" data-testid="cfd-own-copied">{copied}</p>}
      <div className="bid-src-group">
        <h4>An existing plant charges the battery for the first months</h4>
        <div className="rtc-grid rtc-grid-4 cfd-fields" data-testid="cfd-own-bilateral">
          <div data-testid="cfd-in-bilateralMonths"><Field label="Available for" unit="months" value={i.bilateralMonths} onChange={(v) => set({ bilateralMonths: v })} step={1} min={0} max={180} allowEmpty hint="from the battery's commissioning (SCD); blank or 0: no existing plant" /></div>
          <div data-testid="cfd-in-bilateralPrice"><Field label="Its price" unit="₹/kWh" value={i.bilateralPrice} onChange={(v) => set({ bilateralPrice: v })} step={0.05} min={0} max={20} allowEmpty disabled={!(i.bilateralMonths > 0)} hint="at the plant, fixed for those months" /></div>
          <div data-testid="cfd-in-bilateralCharges"><Field label="Charges and losses on it" unit="₹/kWh" value={i.bilateralCharges} onChange={(v) => set({ bilateralCharges: v ?? 0 })} step={0.05} min={0} max={5} disabled={!(i.bilateralMonths > 0)} hint="ISTS charges and losses to your meter; 0 if the price is delivered" /></div>
          <div data-testid="cfd-in-bilateralMw"><Field label="The plant's size" unit="MW" value={i.bilateralMw} onChange={(v) => set({ bilateralMw: v })} step={5} min={0} max={5000} allowEmpty disabled={!(i.bilateralMonths > 0)} hint="blank: as much as the battery takes; a size limits each hour to its output along the solar shape" /></div>
          <SelectBox label="Use it" value={i.bilateralUse === "cheapest" ? "cheapest" : "first"} onChange={(v) => set({ bilateralUse: v })} options={[["first", "Before the green market (a firm supply)"], ["cheapest", "Only where it is cheaper than the green market"]]} hint="own RE always charges first" />
        </div>
        <p className="rtc-note" data-testid="cfd-own-bilateral-note">
          {on
            ? `The plant supplies in solar hours until ${until ? fmtDate(until) : "the months end"} at ₹${nf((i.bilateralPrice || 0) + (i.bilateralCharges || 0), 2)}/kWh at your meter. It counts in the green-market and bilateral allowance: up to the whole supply until ${dates ? fmtDate(dates.extraUntil) : "month 36 from the Effective Date"}, 25% of the year's energy after.`
            : "Leave the months blank if no existing plant supplies the bid. The battery then charges from own RE, the green market and (after month 36) group RE, as on the CfD Bid tab."}
          {beyond ? " Part of these months falls after month 36, where only 25% of the year's energy may come from the green market or bilateral agreements: the model keeps within it." : ""}
        </p>
      </div>
      <div className="bid-src-group">
        <h4>When the new RE at site is paid for</h4>
        <div className="rtc-grid rtc-grid-4 cfd-fields">
          <div data-testid="cfd-in-reCostAtCod">
            <SelectBox label="Own RE's cost" value={i.reCostAtCod ? "cod" : "scd"} onChange={(v) => set({ reCostAtCod: v === "cod" })}
              options={[["cod", "Spent when it is commissioned"], ["scd", "Carried from the SCD (as the CfD Bid tab)"]]} hint={`RE commissioned ${nf(i.reCodMonths || 0)} months after the SCD (Design step)`} />
          </div>
        </div>
        <p className="rtc-note">
          {i.reCostAtCod
            ? ((i.reCodMonths || 0) > 0
              ? `The battery, the line and SECI's charges are the project cost at the SCD. The RE's cost is put in by lenders and equity in operating year ${Math.max(1, Math.ceil(i.reCodMonths / 12))}, when it is commissioned, at the bid's debt share, and repaid over the years left. Until then the battery runs on bought power.`
              : "The RE is commissioned at the SCD (0 months after it on the Design step), so its cost is spent with the rest of the project: set the months there if it comes later.")
            : "The RE's cost is carried from the SCD even when it is commissioned later, as the CfD Bid tab does: a conservative simplification."}
        </p>
      </div>
    </Section>
  );
}

const show = (v, row) => {
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "–";
  if (row.unit === "%") return pf(v, 2);
  if (row.unit === "₹/kWh") return `₹${nf(v, row.digits)}`;
  if (row.unit === "₹ cr") return `₹${nf(v, row.digits)} cr`;
  return `${nf(v, row.digits)}${row.unit === "×" ? "×" : ` ${row.unit}`}`;
};
const showDiff = (row) => {
  if (row.diff === null || Math.abs(row.diff) < 10 ** -(row.digits + 1)) return "";
  const sign = row.diff > 0 ? "+" : "−";
  const mag = Math.abs(row.diff);
  if (row.unit === "%") return `${sign}${nf(mag * 100, 2)} pt`;
  return `${sign}${row.unit === "₹/kWh" || row.unit === "₹ cr" ? "₹" : ""}${nf(mag, row.digits)}`;
};

/**
 * The two tabs' bids side by side, on this tab's Financial model step: the CfD Bid tab's bid as
 * this browser holds it, priced by its own model, against this tab's.
 * Props: state, model (this tab's), prices, otherKey, fromSaved (the CfD Bid tab's stored bid as
 * that tab reads it), goto.
 */
export function OwnSolarCompare({ state, model, prices, otherKey, fromSaved, goto }) {
  const [stamp, setStamp] = useState(0);
  const raw = useMemo(() => readOther(otherKey), [otherKey, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = useMemo(() => {
    try { return bidSummary(state, model, runCfdFinance({ ...state, tariffLocked: false }, model)); } catch { return null; }
  }, [state.inputs, state.fin, state.costs, state.bess, state.tariffLocked, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const other = useMemo(() => {
    if (!raw || !prices) return { error: raw ? "" : "The CfD Bid tab has no bid in this browser yet." };
    try {
      const st = fromSaved(raw);
      const missing = missingInputs(st);
      if (missing.length) return { error: `The CfD Bid tab's bid is not complete (${missing.length} input${missing.length > 1 ? "s" : ""} needed).` };
      const m = runModel(st, prices);
      return { summary: bidSummary(st, m, runCfdFinance({ ...st, tariffLocked: false }, m)), mw: st.inputs.contractedMw };
    } catch (err) {
      return { error: `The CfD Bid tab's bid could not be priced: ${err.message}` };
    }
  }, [raw, prices]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = mine && other.summary ? compareBids(other.summary, mine) : null;
  const head = rows ? rows[0] : null;
  const sameSize = other.summary && other.mw === state.inputs.contractedMw;
  return (
    <Section index="5.0c" title="Compare with the CfD Bid tab" note="The same tender, the two ways of modelling the bid"
      actions={<button type="button" className="secondary" onClick={() => setStamp((n) => n + 1)} data-testid="cfd-own-refresh"><RefreshCw size={12} /> Read the CfD Bid tab again</button>}>
      {other.error && <p className="rtc-note" data-testid="cfd-own-compare-missing"><TriangleAlert size={12} /> {other.error} Enter and size a bid on the CfD Bid tab, or use "Start from the CfD Bid tab's bid" on Bid inputs here and change what differs. <button type="button" className="secondary" onClick={() => goto?.("bid")}>Bid inputs <ArrowRight size={12} /></button></p>}
      {rows && (
        <>
          <p className="rtc-note" data-testid="cfd-own-compare-verdict">
            {Math.abs(head.diff) < 0.0005
              ? `Both bids need ₹${nf(head.a, 3)}/kWh.`
              : `This tab's bid needs ₹${nf(head.b, 3)}/kWh, ₹${nf(Math.abs(head.diff), 3)} ${head.diff < 0 ? "below" : "above"} the CfD Bid tab's ₹${nf(head.a, 3)}.`}
            {!sameSize ? ` The two bids are for different capacities (${nf(other.mw)} MW there, ${nf(state.inputs.contractedMw)} MW here): compare the prices, not the amounts.` : ""}
          </p>
          <div className="table-wrap rtc-model fin-table own-compare">
            <table data-testid="cfd-own-compare">
              <thead><tr><th /><th>CfD Bid tab</th><th>CfD Own Solar (this tab)</th><th>Difference</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const good = r.better && r.diff !== null && Math.abs(r.diff) > 1e-9 ? ((r.better === "low") === (r.diff < 0) ? "good" : "bad") : "";
                  return <tr key={r.key} data-testid={`cfd-own-row-${r.key}`}><td>{r.label}</td><td>{show(r.a, r)}</td><td>{show(r.b, r)}</td><td className={good ? `own-${good}` : undefined}>{showDiff(r)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <p className="rtc-note">The CfD Bid tab's column is that tab's bid as this browser holds it, priced by its model: own RE's cost carried from the SCD, no existing plant. "Capital in all" adds own RE's cost to the project cost at the SCD when it is put in later.</p>
        </>
      )}
    </Section>
  );
}
