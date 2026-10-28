"use client";
// Recent tenders: SECI's latest auction results (as reported, with their sources) and the CERC
// tariff-adoption orders the bidder uploads, read into their facts with the page and quote of
// each, corrected by hand and marked checked. A chart puts every discovered tariff side by side.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, Gavel, Loader2, Save, Trash2, Upload } from "lucide-react";
import { Section, Stat, nf } from "../rtc/ui";
import { LiveChart } from "../rtc/charts";
import { DATA_COLORS } from "../chartTheme";
import { SECI_RESULTS, SECI_SITE, TRADING_MARGIN_NOTE, tariffRange, weightedTariff } from "./seed";

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const PRODUCT_COLORS = { "RTC (round-the-clock RE)": DATA_COLORS.signal, "FDRE-RTC": DATA_COLORS.wind, "FDRE peak power": DATA_COLORS.bess, "Solar + BESS": DATA_COLORS.solar, CERC: "#ff8a5f" };

function ResultCard({ r }) {
  const [lo, hi] = tariffRange(r);
  const w = weightedTariff(r);
  return (
    <article className="market-card" data-testid={`seci-result-${r.id}`}>
      <header>
        <span className="market-tag" style={{ "--tag": PRODUCT_COLORS[r.product] || DATA_COLORS.muted }}>{r.product}</span>
        <small>{r.agency} · e-reverse auction {r.auctionDate}</small>
      </header>
      <h3>{r.tender}</h3>
      <div className="market-figs">
        <div><span>Discovered tariff</span><b>{lo === null ? "–" : lo === hi ? `₹${nf(lo, 2)}` : `₹${nf(lo, 2)}–${nf(hi, 2)}`}</b><small>{r.tariffUnit}{w ? ` · weighted ₹${nf(w, 3)}` : ""}</small></div>
        <div><span>Awarded</span><b>{r.awardedMw ? `${nf(r.awardedMw, 0)} MW` : "–"}</b><small>{r.tenderedMw ? `of ${nf(r.tenderedMw, 0)} MW tendered` : ""}</small></div>
        <div><span>Winners</span><b>{r.winners.length}</b></div>
      </div>
      <table className="studio-cost">
        <thead><tr><th>Successful bidder</th><th className="num">MW</th><th className="num">₹/kWh</th></tr></thead>
        <tbody>{r.winners.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num">{x.mw === null ? "n/a" : nf(x.mw, 0)}</td><td className="num">{x.tariff === null ? "n/a" : nf(x.tariff, 2)}</td></tr>)}</tbody>
      </table>
      {r.note && <p className="rtc-note">{r.note}</p>}
      <div className="market-sources">
        <span>As reported by</span>
        {r.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label} <ExternalLink size={11} /></a>)}
      </div>
    </article>
  );
}

function OrderCard({ order, onSaved, onDeleted }) {
  const [draft, setDraft] = useState(order);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setDraft(order), [order]);
  const ev = order.evidence || {};
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setW = (i, k, v) => setDraft((d) => ({ ...d, winners: d.winners.map((w, j) => (j === i ? { ...w, [k]: v } : w)) }));
  const save = async (checked = draft.checked) => {
    setBusy(true); setError("");
    try {
      const { order: o } = await api(`/api/market/${order.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, checked }) });
      onSaved(o);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const Quote = ({ e }) => (e ? <small className="market-quote" title={e.quote}>p. {e.page ?? "?"}: “{e.quote}”</small> : <small className="market-quote">not found in the text: enter it</small>);
  return (
    <article className="market-card market-order" data-testid="cerc-order">
      <header>
        <span className="market-tag" style={{ "--tag": PRODUCT_COLORS.CERC }}>CERC order</span>
        <small>{order.checked ? <><CheckCircle2 size={12} /> checked</> : "read by TenderOS: check each fact against its quote"}</small>
        <a href={`/api/market/files/${order.id}`} target="_blank" rel="noreferrer" className="market-file"><FileText size={12} /> {order.file_name}</a>
      </header>
      <div className="market-form">
        <label>Petition<input value={draft.petition || ""} onChange={(e) => set("petition", e.target.value)} data-testid="cerc-petition" /><Quote e={ev.petition} /></label>
        <label>Date of order<input type="date" value={draft.order_date ? String(draft.order_date).slice(0, 10) : ""} onChange={(e) => set("order_date", e.target.value)} data-testid="cerc-date" /><Quote e={ev.orderDate} /></label>
        <label>Petitioner<input value={draft.petitioner || ""} onChange={(e) => set("petitioner", e.target.value)} data-testid="cerc-petitioner" /><Quote e={ev.petitioner} /></label>
        <label>Capacity (MW)<input type="number" value={draft.capacity_mw ?? ""} onChange={(e) => set("capacity_mw", e.target.value)} data-testid="cerc-capacity" /><Quote e={ev.capacityMw} /></label>
        <label className="wide">In the matter of<textarea rows={2} value={draft.title || ""} onChange={(e) => set("title", e.target.value)} /></label>
      </div>
      <table className="studio-cost" data-testid="cerc-winners">
        <thead><tr><th>Successful bidder</th><th className="num">MW</th><th className="num">₹/kWh</th><th>Read from</th></tr></thead>
        <tbody>
          {(draft.winners || []).map((w, i) => (
            <tr key={i}>
              <td><input value={w.name} onChange={(e) => setW(i, "name", e.target.value)} /></td>
              <td className="num"><input type="number" value={w.mw ?? ""} onChange={(e) => setW(i, "mw", e.target.value)} /></td>
              <td className="num"><input type="number" step="0.01" value={w.tariff ?? ""} onChange={(e) => setW(i, "tariff", e.target.value)} /></td>
              <td><small className="market-quote" title={w.quote}>{w.page ? `p. ${w.page}` : "added by hand"}</small></td>
            </tr>
          ))}
          {!draft.winners?.length && <tr><td colSpan={4}><small className="rtc-note">No bidder table found in the text: add the bidders.</small></td></tr>}
        </tbody>
      </table>
      <div className="market-actions">
        <button type="button" className="secondary" onClick={() => setDraft((d) => ({ ...d, winners: [...(d.winners || []), { name: "", mw: null, tariff: null }] }))}>Add a bidder</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => save()}><Save size={13} /> Save</button>
        <button type="button" className="primary" disabled={busy} onClick={() => save(true)} data-testid="cerc-checked">{busy ? <Loader2 className="spin" size={13} /> : <CheckCircle2 size={13} />} Save as checked</button>
        <button type="button" className="rtc-icon-btn" title="Delete this order" onClick={async () => { if (!window.confirm("Delete this order and its PDF record?")) return; await api(`/api/market/${order.id}`, { method: "DELETE" }); onDeleted(order.id); }}><Trash2 size={14} /></button>
      </div>
      {error && <div className="alert">{error}</div>}
    </article>
  );
}

export default function RecentTendersTab() {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { api("/api/market").then((d) => setOrders(d.orders)).catch((e) => setError(e.message)); }, []);
  async function upload(files) {
    setBusy(true); setError("");
    try {
      for (const f of files) {
        const form = new FormData();
        form.set("file", f);
        const { order } = await api("/api/market", { method: "POST", body: form });
        setOrders((o) => [order, ...o]);
      }
    } catch (err) { setError(err.message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  const chart = useMemo(() => {
    const items = [
      ...SECI_RESULTS.map((r) => ({ name: r.tender, product: r.product, range: tariffRange(r), w: weightedTariff(r) })),
      ...orders.filter((o) => o.tariff_min !== null).map((o) => ({ name: `CERC ${o.petition || o.file_name}`, product: "CERC", range: [Number(o.tariff_min), Number(o.tariff_max)], w: null })),
    ].filter((x) => x.range[0] !== null);
    return {
      animation: false,
      grid: { left: 260, right: 30, top: 10, bottom: 30 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => `₹${nf(v, 2)}/kWh` },
      xAxis: { type: "value", name: "₹/kWh", min: 0 },
      yAxis: { type: "category", data: items.map((x) => (x.name.length > 40 ? `${x.name.slice(0, 39)}…` : x.name)), inverse: true },
      series: [
        { name: "Lowest", type: "bar", stack: "t", data: items.map((x) => x.range[0]), itemStyle: { color: "transparent" }, tooltip: { show: false } },
        { name: "Tariff range", type: "bar", stack: "t", barWidth: 14, data: items.map((x) => ({ value: Math.max(0.03, x.range[1] - x.range[0]), itemStyle: { color: PRODUCT_COLORS[x.product] || DATA_COLORS.muted } })),
          label: { show: true, position: "right", color: "#c2c2bc", formatter: (p) => `₹${nf(items[p.dataIndex].range[0], 2)}${items[p.dataIndex].range[1] !== items[p.dataIndex].range[0] ? `–${nf(items[p.dataIndex].range[1], 2)}` : ""}` } },
      ],
    };
  }, [orders]);
  const rtc = SECI_RESULTS.filter((r) => /RTC/.test(r.product));
  const latestRtc = rtc.map(weightedTariff).filter(Boolean);
  return (
    <div className="rtc story bid market">
      <section className="story-hero">
        <div>
          <div className="eyebrow"><Gavel size={13} /> Recent tenders · SECI results and CERC tariff adoption</div>
          <h1>Recent tenders</h1>
          <p>What recent auctions discovered, and what CERC adopted: SECI&apos;s latest results as reported, and the tariff-adoption orders you upload, read into their facts with the page each came from.</p>
        </div>
        <div className="story-hero-tools">
          <a className="rtc-reset" href={SECI_SITE} target="_blank" rel="noreferrer"><ExternalLink size={13} /> SECI&apos;s site</a>
        </div>
      </section>

      <Section index="1" title="Discovered tariffs side by side" note={TRADING_MARGIN_NOTE}>
        <div className="rtc-grid rtc-grid-4">
          <Stat label="RTC / FDRE-RTC, latest" value={latestRtc.length ? `₹${nf(Math.max(...latestRtc), 3)}` : "–"} detail="capacity-weighted, as reported" />
          <Stat label="Results listed" value={String(SECI_RESULTS.length)} detail="SECI auctions, 2025–26" />
          <Stat label="CERC orders uploaded" value={String(orders.length)} detail={`${orders.filter((o) => o.checked).length} checked`} />
          <Stat label="Solar + BESS, latest" value="₹3.12–3.13" detail="ISTS Tranche XXI, as reported" />
        </div>
        <LiveChart option={chart} height={Math.max(220, 40 * (SECI_RESULTS.length + orders.length) + 40)} />
      </Section>

      <Section index="2" title="CERC tariff-adoption orders" note="Upload the order PDFs: TenderOS reads the petition, date, petitioner, capacity and successful bidders, each with its page and quote, for you to check"
        actions={(
          <>
            <input ref={fileRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => upload([...e.target.files])} data-testid="cerc-file" />
            <button type="button" className="primary" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="cerc-upload">{busy ? <Loader2 className="spin" size={14} /> : <Upload size={14} />} Upload CERC orders</button>
          </>
        )}>
        {error && <div className="alert" data-testid="cerc-error">{error}</div>}
        {!orders.length && <p className="rtc-note">No orders yet. CERC publishes its orders at cercind.gov.in; upload one or two tariff-adoption orders (Section 63 petitions) as PDFs.</p>}
        <div className="market-orders">
          {orders.map((o) => <OrderCard key={o.id} order={o} onSaved={(n) => setOrders((all) => all.map((x) => (x.id === n.id ? n : x)))} onDeleted={(id) => setOrders((all) => all.filter((x) => x.id !== id))} />)}
        </div>
      </Section>

      <Section index="3" title="SECI auction results" note="As the trade press reported them: open the sources, and SECI's own result notices, before relying on a figure">
        <div className="market-grid" data-testid="seci-results">
          {SECI_RESULTS.map((r) => <ResultCard key={r.id} r={r} />)}
        </div>
      </Section>
    </div>
  );
}
