"use client";
// New tenders: SECI's open tenders as scanned from its website (the tender list and each tender's
// details page; no document is opened), each with a summary Claude wrote from the page alone, or
// rules without a key. The page scans by itself when the last scan is older than 12 hours; "Scan
// SECI now" scans at once. Data: /api/market/seci (web/lib/seciScan.js, engine/market/seci_tenders.py).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, ExternalLink, FileText, Loader2, Megaphone, Radar, RefreshCw, Sparkles } from "lucide-react";
import { Section, Stat, nf } from "../rtc/ui";
import { DATA_COLORS } from "../chartTheme";
import "./newTenders.css";

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `Request failed (${res.status})`);
  return data;
}

const CAT_COLORS = { cfd: DATA_COLORS.bess, peak: DATA_COLORS.bess, rtc: DATA_COLORS.signal, bess: DATA_COLORS.bess, hybrid: "#4fd1c5", wind: DATA_COLORS.wind, solar: DATA_COLORS.solar, rooftop: DATA_COLORS.solar, hydrogen: "#7ddc9a", consultancy: DATA_COLORS.muted, admin: DATA_COLORS.muted, other: DATA_COLORS.muted };
const BIDDER = { developer: "Developer bid", epc: "EPC", services: "Services", other: "Other" };
const REL = { high: "For developers", medium: "Worth a look", low: "Not a power bid" };
const FILTERS = [["all", "All open"], ["new", "New or changed"], ["soon", "Closing in 14 days"], ["high", "For developers"], ["closed", "Closed or delisted"]];

const fmtDay = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "–");
const fmtAt = (iso) => {
  if (!iso) return "–";
  const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00`);
  return iso.length > 10 ? `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}` : fmtDay(iso);
};
const ago = (iso) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
// calendar days from today to the deadline's date, as the engine counts them (16 Nov from 13 Nov: 3)
const daysLeft = (t) => {
  const d = (t.record?.bidOnline || t.bidDeadline || "").slice(0, 10);
  if (!d) return null;
  const now = new Date();
  return Math.round((new Date(`${d}T00:00:00`) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
};
const capacity = (c = {}) => [c.mw ? `${nf(c.mw, c.mw % 1 ? 1 : 0)} MW` : null, c.mwh ? `${nf(c.mwh)} MWh` : null, c.kw ? `${nf(c.kw, c.kw % 1 ? 2 : 0)} kW` : null, c.hours && !c.mwh ? `${c.hours} h a day` : null].filter(Boolean).join(" / ");

/** One tender: what it is, the dates, the summary, what to watch, the documents (names only). */
function TenderCard({ t }) {
  const r = t.record || {};
  const f = r.facts || {};
  const s = t.summary || {};
  const left = daysLeft(t);
  const [open, setOpen] = useState(false);
  const dates = [["Published", r.publishedAt || t.published], ["Pre-bid", r.preBid], ["Bids due", r.bidOnline || t.bidDeadline], ["Offline copy", r.bidOffline], ["Bids open", r.bidOpen]].filter(([, v]) => v);
  return (
    <article className={`market-card seci-tender rel-${s.relevance || "low"} ${t.listed ? "" : "delisted"}`} data-testid={`seci-tender-${t.tenderId}`}>
      <header>
        <span className="market-tag" style={{ "--tag": CAT_COLORS[f.category] || DATA_COLORS.muted }}>{f.categoryLabel || "Tender"}</span>
        <span className="seci-chip">{BIDDER[f.bidder] || "–"}</span>
        {capacity(f.capacity) && <span className="seci-chip strong">{capacity(f.capacity)}</span>}
        {f.scheme && <span className="seci-chip">{f.scheme}</span>}
        {t.isNew && <span className="seci-flag new">New</span>}
        {!t.isNew && t.isChanged && <span className="seci-flag changed">Changed</span>}
        {!t.listed && <span className="seci-flag gone">No longer listed</span>}
        {t.listed && left !== null && left < 0 && <span className="seci-flag gone">Deadline passed</span>}
        <span className={`seci-days ${left !== null && left <= 7 ? "urgent" : left !== null && left <= 14 ? "soon" : ""}`} data-testid="seci-days">
          <CalendarClock size={12} /> {left === null ? "no deadline" : left < 0 ? "closed" : left === 0 ? "due today" : `${left} day${left === 1 ? "" : "s"} left`}
        </span>
      </header>
      <h3>{t.title}</h3>
      <small className="rtc-note">{t.tenderId}{r.ets ? ` · ${r.ets}` : ""} · {t.ref}</small>
      <div className="seci-summary" data-testid="seci-summary">
        <p>{s.summary || "Not summarised yet: scan again."}</p>
        <small className="seci-by">{s.by === "claude" ? <><Sparkles size={11} /> Summary by Claude from the tender page</> : "Summary by rules from the tender page"} · no document opened</small>
      </div>
      {s.watch?.length > 0 && (
        <ul className="seci-watch" data-testid="seci-watch">
          {s.watch.map((w, k) => <li key={k}><AlertTriangle size={12} /> {w}</li>)}
        </ul>
      )}
      <div className="seci-dates">
        {dates.map(([label, v]) => <div key={label}><span>{label}</span><b>{fmtAt(v)}</b></div>)}
      </div>
      <div className="seci-foot">
        <button type="button" className="lever-why" onClick={() => setOpen((o) => !o)} data-testid="seci-more">
          <FileText size={12} /> {(r.documents || []).length} documents · <Megaphone size={12} /> {(r.announcements || []).length} announcements {open ? "▴" : "▾"}
        </button>
        <a className="rtc-link" href={r.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> The tender on SECI's site</a>
      </div>
      {open && (
        <div className="seci-more">
          {(r.announcements || []).length > 0 && (
            <>
              <h4>Announcements</h4>
              <ul>{r.announcements.map((a, k) => <li key={k}>{a.title} <small>{fmtAt(a.uploadedAt)}</small></li>)}</ul>
            </>
          )}
          <h4>Documents on the page (names only; none was opened)</h4>
          <ul>{(r.documents || []).map((d, k) => <li key={k}>{d.name} <small>{fmtAt(d.uploadedAt)}</small></li>)}</ul>
          {(r.emd || r.pbg || r.rfsCost || r.fee) && (
            <p className="rtc-note">{[r.fee && `Tender fee: ${r.fee}`, r.rfsCost && `Cost of RfS: ${r.rfsCost}`, r.emd && `EMD: ${r.emd}`, r.pbg && `PBG: ${r.pbg}`].filter(Boolean).join(" · ")}</p>
          )}
        </div>
      )}
    </article>
  );
}

export default function NewTendersTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState("all");
  const autoRan = useRef(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setError("");
    try {
      setData(await api("/api/market/seci/scan", { method: "POST" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    let stop = false;
    api("/api/market/seci")
      .then((d) => {
        if (stop) return;
        setData(d);
        // the page scans by itself when nobody has scanned for 12 hours (not in the core zone)
        if (d.stale && d.zone !== "core" && !autoRan.current) { autoRan.current = true; scan(); }
      })
      .catch((err) => { if (!stop) setError(err.message); });
    return () => { stop = true; };
  }, [scan]);

  const tenders = data?.tenders || [];
  // open: still on SECI's list and the deadline not passed; closed: delisted, or the deadline passed
  const isOpen = (t) => { const d = daysLeft(t); return t.listed && (d === null || d >= 0); };
  const shown = useMemo(() => tenders.filter((t) => {
    if (filter === "closed") return !isOpen(t);
    if (!isOpen(t)) return false;
    if (filter === "new") return t.isNew || t.isChanged;
    if (filter === "soon") { const d = daysLeft(t); return d !== null && d >= 0 && d <= 14; }
    if (filter === "high") return t.summary?.relevance === "high";
    return true;
  }), [tenders, filter]);
  const open = tenders.filter(isOpen);
  const scanInfo = data?.scan;
  const soon = open.filter((t) => { const d = daysLeft(t); return d !== null && d >= 0 && d <= 14; }).length;

  return (
    <div className="new-tenders" data-testid="new-tenders">
      <Section index="1" title="New tenders · SECI" note="SECI's open tenders, read from its tender list and each tender's details page; a summary of each, with what to watch. No tender document is downloaded or read."
        actions={<button type="button" className="primary" onClick={scan} disabled={scanning || data?.zone === "core"} data-testid="seci-scan">{scanning ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {scanning ? "Scanning SECI…" : "Scan SECI now"}</button>}>
        <div className="rtc-grid rtc-grid-4" data-testid="seci-scan-stats">
          <Stat label="Open tenders" value={nf(open.length)} detail={scanInfo ? `listed ${ago(scanInfo.at)}, deadline not passed` : "not scanned yet"} />
          <Stat label="New or changed" value={nf(scanInfo ? (scanInfo.new || 0) + (scanInfo.changed || 0) : 0)} detail={scanInfo ? `${scanInfo.new} new, ${scanInfo.changed} with new dates, documents or announcements` : ""} tone={scanInfo && scanInfo.new + scanInfo.changed > 0 ? "good" : undefined} />
          <Stat label="Closing in 14 days" value={nf(soon)} detail="by the online bid deadline" tone={soon ? "bad" : undefined} />
          <Stat label="Summaries by" value={scanInfo?.mode === "claude" ? "Claude" : scanInfo ? "Rules" : "–"} detail={scanInfo?.mode === "claude" ? "from the page alone; the terms stay in the documents" : "set the Anthropic key under Administration › API keys for Claude's summaries"} />
        </div>
        {scanning && <p className="rtc-note" data-testid="seci-scanning"><Radar size={12} /> Reading SECI's tender list and each tender's details page (about a minute); Claude summarises what is new or changed. No document is opened.</p>}
        {error && <div className="alert" data-testid="seci-error">{error}</div>}
        {scanInfo?.errors?.length > 0 && <div className="alert soft">{scanInfo.errors.join(" · ")}</div>}
        {data?.zone === "core" && <p className="rtc-note">This is the core zone: it has no internet or cloud model. The scan runs in the intake zone.</p>}
        <div className="bid-filter" role="tablist">
          {FILTERS.map(([k, label]) => <button key={k} type="button" className={filter === k ? "active" : ""} onClick={() => setFilter(k)} data-testid={`seci-filter-${k}`}>{label}</button>)}
        </div>
        {!data && !error && <p className="rtc-note"><Loader2 size={12} className="spin" /> Loading…</p>}
        {data && shown.length === 0 && !scanning && <p className="rtc-note" data-testid="seci-empty">{tenders.length ? "No tender matches this filter." : "No scan yet: Scan SECI now."}</p>}
        <div className="seci-tender-list" data-testid="seci-tender-list">
          {shown.map((t) => <TenderCard key={t.tenderId} t={t} />)}
        </div>
        <p className="rtc-note">
          Source: <a className="rtc-link" href="https://www.seci.co.in/tenders" target="_blank" rel="noreferrer">www.seci.co.in/tenders</a> and each tender's details page. The scan reads the tender ID, reference, title and dates from the list, and the pre-bid, sale, submission and opening dates, the fee, EMD and PBG wording, the names of the documents and the titles of the announcements from the details page. The documents themselves are never downloaded, so the summaries say nothing a document alone holds (tariff ceilings, eligibility, the EMD amount when the page says "as per RfS"). Only new or changed tenders are summarised again; a tender that leaves SECI's open list is kept, marked "no longer listed". {scanInfo ? `Last scan ${ago(scanInfo.at)}${scanInfo.by ? ` by ${scanInfo.by}` : ""}, ${nf(scanInfo.seconds || 0, 0)} s.` : ""}
        </p>
      </Section>
    </div>
  );
}
