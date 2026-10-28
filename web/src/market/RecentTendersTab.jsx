"use client";
// Recent tenders: SECI's latest auction results (as reported, with their sources) and the CERC
// tariff-adoption orders the bidder uploads, read into their facts with the page and quote of
// each, corrected by hand and marked checked. A chart puts every discovered tariff side by side.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, Gavel, Loader2, Save, Trash2, Upload } from "lucide-react";
import { Section, Stat, nf } from "../rtc/ui";
import { LiveChart } from "../rtc/charts";
import { DATA_COLORS } from "../chartTheme";
import { SECI_RESULTS, SECI_SITE, TRADING_MARGIN_NOTE, latest, tariffRange, weightedTariff } from "./seed";

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const PRODUCT_COLORS = { "RTC (round-the-clock RE)": DATA_COLORS.signal, "FDRE-RTC": "#4fd1c5", "FDRE peak power": DATA_COLORS.bess, "Solar + ESS": DATA_COLORS.solar, Wind: DATA_COLORS.wind, CERC: "#ff8a5f" };
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "–");

function ResultCard({ r }) {
  const [lo, hi] = tariffRange(r);
  const w = weightedTariff(r);
  return (
    <article className="market-card" data-testid={`seci-result-${r.id}`}>
      <header>
        <span className="market-tag" style={{ "--tag": PRODUCT_COLORS[r.product] || DATA_COLORS.muted }}>{r.product}</span>
        {r.official && <span className="market-official">SECI result notice</span>}
        <small>e-reverse auction {fmtDate(r.auctionDate)} · LoAs {fmtDate(r.loaDate)}</small>
      </header>
      <h3>{r.tender}</h3>
      <small className="rtc-note">RfS {r.rfsNo}{r.rfsDate ? `, ${fmtDate(r.rfsDate)}` : ""}</small>
      <div className="market-figs">
        <div><span>Tariff awarded</span><b>{lo === null ? "–" : lo === hi ? `₹${nf(lo, 2)}` : `₹${nf(lo, 2)}–${nf(hi, 2)}`}</b><small>{r.tariffUnit}{w ? ` · weighted ₹${nf(w, 3)}` : ""}</small></div>
        <div><span>Awarded</span><b>{nf(r.awardedMw, r.awardedMw % 1 ? 1 : 0)} MW</b><small>of {nf(r.tenderedMw, 0)} MW tendered{r.storageMwh ? ` · ${nf(r.storageMwh, 0)} MWh` : ""}</small></div>
        <div><span>Winners</span><b>{r.winners.length}</b><small>{r.others.length} more in the auction</small></div>
      </div>
      <table className="studio-cost">
        <thead><tr><th>Successful bidder</th><th className="num">Bid MW</th><th className="num">Awarded MW</th><th className="num">₹/kWh</th></tr></thead>
        <tbody>{r.winners.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num">{nf(x.bidMw, x.bidMw % 1 ? 1 : 0)}</td><td className="num"><b>{nf(x.mw, x.mw % 1 ? 1 : 0)}</b></td><td className="num">{nf(x.tariff, 2)}</td></tr>)}</tbody>
      </table>
      {r.others.length > 0 && (
        <details className="market-others">
          <summary>{r.others.length} bidders not awarded, at their final e-RA tariff</summary>
          <table className="studio-cost">
            <tbody>{r.others.map((x) => <tr key={`${x.name}-${x.tariff}`}><td>{x.name}</td><td className="num">{nf(x.bidMw, x.bidMw % 1 ? 1 : 0)} MW</td><td className="num">₹{nf(x.tariff, 2)}</td></tr>)}</tbody>
          </table>
        </details>
      )}
      {r.note && <p className="rtc-note">{r.note}</p>}
      <div className="market-sources">
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
      ...[...SECI_RESULTS].sort((a, b) => a.product.localeCompare(b.product) || String(b.auctionDate).localeCompare(String(a.auctionDate))).map((r) => ({ name: `${r.tender.match(/\(([^)]+)\)$/)?.[1] || r.tender} · ${r.product}`, product: r.product, range: tariffRange(r), w: weightedTariff(r) })),
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
  const tile = (product) => {
    const r = latest(product);
    if (!r) return { value: "–", detail: "" };
    const [lo, hi] = tariffRange(r);
    return { value: lo === hi ? `₹${nf(lo, 2)}` : `₹${nf(lo, 2)}–${nf(hi, 2)}`, detail: `${r.tender.match(/\(([^)]+)\)$/)?.[1] || r.tender}, ${fmtDate(r.auctionDate)}` };
  };
  const tiles = [["FDRE-RTC", "FDRE-RTC, latest"], ["FDRE peak power", "FDRE peak power, latest"], ["Wind", "Wind, latest"], ["Solar + ESS", "Solar + storage, latest"]].map(([p, label]) => ({ label, ...tile(p) }));
  return (
    <div className="rtc story bid market">
      <section className="story-hero">
        <div>
          <div className="eyebrow"><Gavel size={13} /> Recent tenders · SECI results and CERC tariff adoption</div>
          <h1>Recent tenders</h1>
          <p>What recent auctions discovered, and what CERC adopted: SECI&apos;s latest results from its own result notices, and the tariff-adoption orders you upload, read into their facts with the page each came from.</p>
        </div>
        <div className="story-hero-tools">
          <a className="rtc-reset" href={SECI_SITE} target="_blank" rel="noreferrer"><ExternalLink size={13} /> SECI&apos;s site</a>
        </div>
      </section>

      <Section index="1" title="Discovered tariffs side by side" note={TRADING_MARGIN_NOTE}>
        <div className="rtc-grid rtc-grid-4">
          {tiles.map((t) => <Stat key={t.label} label={t.label} value={t.value} detail={t.detail} />)}
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

      <Section index="3" title="SECI auction results" note={`${SECI_RESULTS.length} recent auctions from SECI's result notices: every awarded bidder, its capacity and tariff, and who else bid`}>
        <div className="market-grid" data-testid="seci-results">
          {SECI_RESULTS.map((r) => <ResultCard key={r.id} r={r} />)}
        </div>
      </Section>
    </div>
  );
}
