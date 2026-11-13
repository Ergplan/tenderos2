// New tenders: SECI's open tenders scanned from its website by the engine (engine/market/
// seci_tenders.py: the tender list and the details pages, never a document), summarised by Claude
// (or by rules without a key), kept one row per tender and updated by every scan. Server-only.
import { query } from "./db";
import { HttpError } from "./auth";
import { engineKeyHeaders } from "./secrets.js";
import { ZONE } from "./zone";

const ENGINE_URL = process.env.ENGINE_URL || "http://127.0.0.1:8000";
export const STALE_HOURS = 12; // the page scans by itself when the last scan is older than this
const uuid = (v) => (typeof v === "string" && /^[0-9a-f-]{36}$/.test(v) ? v : null);
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const day = (d) => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return String(d).slice(0, 10);
};

function shape(row, lastScanAt) {
  return {
    tenderId: row.tender_id, ref: row.ref, title: row.title, published: day(row.published), bidDeadline: day(row.bid_deadline),
    record: row.record, summary: row.summary, listed: row.listed, firstSeen: iso(row.first_seen), changedAt: iso(row.changed_at), lastSeen: iso(row.last_seen),
    // new and changed are relative to the latest scan
    isNew: Boolean(lastScanAt && row.first_seen && new Date(row.first_seen) >= new Date(lastScanAt) - 1000),
    isChanged: Boolean(lastScanAt && row.changed_at && new Date(row.changed_at) >= new Date(lastScanAt) - 1000),
  };
}

export async function lastScan() {
  const { rows } = await query("SELECT s.*, u.name AS by_name FROM seci_scans s LEFT JOIN users u ON u.id = s.by_user ORDER BY s.at DESC LIMIT 1");
  const s = rows[0];
  return s ? { at: iso(s.at), by: s.by_name || null, mode: s.mode, found: s.found, new: s.new_count, changed: s.changed, delisted: s.delisted, seconds: s.seconds === null ? null : Number(s.seconds), errors: s.errors || [], usage: s.usage || {} } : null;
}

/** The tenders kept, open ones first by deadline, and the last scan. */
export async function listSeciTenders({ includeDelisted = true } = {}) {
  const scan = await lastScan();
  const { rows } = await query(`SELECT * FROM seci_tenders ${includeDelisted ? "" : "WHERE listed"} ORDER BY listed DESC, (bid_deadline < current_date) ASC NULLS FIRST, bid_deadline ASC NULLS LAST, tender_id LIMIT 300`);
  return { scan, stale: !scan || Date.now() - new Date(scan.at).getTime() > STALE_HOURS * 3600e3, tenders: rows.map((r) => shape(r, scan?.at)), zone: ZONE };
}

/** Scan SECI's site now: new and changed tenders summarised, every row updated, the scan logged. */
export async function runSeciScan(user) {
  if (ZONE === "core") throw new HttpError(403, "The core zone has no internet or cloud model: scan SECI's site from the intake zone.");
  const { rows: known } = await query("SELECT tender_id, fingerprint FROM seci_tenders WHERE listed");
  const res = await fetch(`${ENGINE_URL}/api/market/seci-scan`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await engineKeyHeaders()) },
    body: JSON.stringify({ known: Object.fromEntries(known.map((k) => [k.tender_id, k.fingerprint])), summarise: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, data.detail || `The scan failed (${res.status}).`);
  const tenders = Array.isArray(data.tenders) ? data.tenders.slice(0, 200) : [];
  const now = new Date();
  for (const t of tenders) {
    const id = String(t.tenderId || "").slice(0, 40);
    if (!id) continue;
    const { summary, status, ...record } = t;
    const params = [id, String(t.ref || "").slice(0, 200), String(t.title || "").slice(0, 600), day(t.published), day(t.bidOnline || t.bidDeadline), JSON.stringify(record), String(t.fingerprint || ""), now];
    if (status === "new") {
      await query(
        `INSERT INTO seci_tenders (tender_id, ref, title, published, bid_deadline, record, fingerprint, summary, first_seen, last_seen, listed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $9, $8, $8, true)
         ON CONFLICT (tender_id) DO UPDATE SET ref = $2, title = $3, published = $4, bid_deadline = $5, record = $6, fingerprint = $7, summary = $9, changed_at = $8, last_seen = $8, listed = true`,
        [...params, JSON.stringify(summary || {})],
      );
    } else if (status === "changed") {
      await query(
        "UPDATE seci_tenders SET ref = $2, title = $3, published = $4, bid_deadline = $5, record = $6, fingerprint = $7, summary = $9, changed_at = $8, last_seen = $8, listed = true WHERE tender_id = $1",
        [...params, JSON.stringify(summary || {})],
      );
    } else {
      // unchanged: the record's facts are refreshed (the days to the deadline move), the summary kept
      await query("UPDATE seci_tenders SET record = $2, bid_deadline = $3, last_seen = $4, listed = true WHERE tender_id = $1", [id, params[5], params[4], now]);
    }
  }
  const ids = tenders.map((t) => String(t.tenderId || "")).filter(Boolean);
  const { rowCount: delisted } = await query("UPDATE seci_tenders SET listed = false WHERE listed AND NOT (tender_id = ANY($1::text[]))", [ids]);
  await query(
    "INSERT INTO seci_scans (at, by_user, mode, found, new_count, changed, delisted, seconds, errors, usage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [now, uuid(user?.id), String(data.mode || ""), Number(data.found) || 0, Number(data.new) || 0, Number(data.changed) || 0, delisted || 0, Number(data.seconds) || null, JSON.stringify((data.errors || []).slice(0, 20)), JSON.stringify(data.usage || {})],
  );
  return listSeciTenders();
}
