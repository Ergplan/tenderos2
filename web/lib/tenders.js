// Tender readings (Tender to Bid): save each tender the engine reads, list them for the team,
// and load built-in readings from db/seed/tenders. Server-only.
import fs from "node:fs";
import { orgOf, visibleTo } from "./workspace";
import path from "node:path";
import { query } from "./db";
import { HttpError } from "./auth";

const LIST_COLS = `t.id, t.seed_key, t.file_name, t.title, t.issuer, t.tender_number, t.tender_type, t.capacity_mw, t.mode,
  t.pages, t.found, t.fields, t.created_at, u.name AS created_by_name, u.email AS created_by_email`;

function summary(result) {
  const v = result?.values || {};
  const text = (x) => (x === null || x === undefined ? "" : String(x)).slice(0, 300);
  return {
    title: text(v["core.identity.title"]),
    issuer: text(v["core.identity.issuing_agency"]),
    tenderNumber: text(v["core.identity.tender_number"]),
    tenderType: text(result?.tender_type),
    capacityMw: Number.isFinite(Number(v["sector.power.common.total_capacity_mw"])) ? Number(v["sector.power.common.total_capacity_mw"]) : null,
    mode: result?.mode === "llm" ? "llm" : "rules",
    sha256: result?.document?.sha256 || null,
    pages: Number.isFinite(result?.document?.pages) ? result.document.pages : null,
    found: Number.isFinite(result?.counts?.found) ? result.counts.found : null,
    fields: Number.isFinite(result?.counts?.fields) ? result.counts.fields : null,
  };
}

/** The readings the viewer's workspace may see (lib/workspace.js), and the built-in ones. */
export async function listTenderReads(limit = 30, viewer) {
  const vals = [Math.max(1, Math.min(100, limit))];
  const cond = visibleTo(viewer, "u", vals, "t.seed_key");
  const { rows } = await query(
    `SELECT ${LIST_COLS} FROM tender_reads t LEFT JOIN users u ON u.id = t.created_by WHERE ${cond} ORDER BY t.created_at DESC LIMIT $1`,
    vals,
  );
  return rows;
}

export async function getTenderRead(id, viewer) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new HttpError(404, "Tender reading not found.");
  const vals = [id];
  const cond = visibleTo(viewer, "u", vals, "t.seed_key");
  const { rows } = await query(`SELECT t.* FROM tender_reads t LEFT JOIN users u ON u.id = t.created_by WHERE t.id = $1 AND ${cond}`, vals);
  if (!rows[0]) throw new HttpError(404, "Tender reading not found.");
  return rows[0];
}

/** Save a reading; the same file read the same way again replaces the earlier row. */
export async function saveTenderRead(user, { fileName, result }) {
  if (!result || !Array.isArray(result.sections) || !result.values) throw new HttpError(400, "A tender reading is required.");
  const name = String(fileName || result?.document?.name || "tender.pdf").slice(0, 300);
  const s = summary(result);
  const body = JSON.stringify(result);
  if (body.length > 8 * 1024 * 1024) throw new HttpError(413, "The reading is too large to save.");
  // the same file read the same way replaces the earlier reading of the saver's own workspace only
  if (s.sha256) {
    await query(
      "DELETE FROM tender_reads WHERE sha256 = $1 AND mode = $2 AND seed_key IS NULL AND coalesce((SELECT org FROM users WHERE id = tender_reads.created_by), '') = $3",
      [s.sha256, s.mode, orgOf(user)],
    );
  }
  const { rows } = await query(
    `INSERT INTO tender_reads (file_name, title, issuer, tender_number, tender_type, capacity_mw, mode, sha256, pages, found, fields, result, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, created_at`,
    [name, s.title, s.issuer, s.tenderNumber, s.tenderType, s.capacityMw, s.mode, s.sha256, s.pages, s.found, s.fields, body, user?.id || null],
  );
  return rows[0];
}

/** Built-in readings from db/seed/tenders/*.json ({ seedKey, fileName, result }). */
export async function seedTenderReads() {
  const dir = [path.join(process.cwd(), "db", "seed", "tenders"), path.join(process.cwd(), "web", "db", "seed", "tenders")].find((d) => fs.existsSync(d));
  if (!dir) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const { seedKey, fileName, result } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!seedKey || !result) continue;
    const s = summary(result);
    await query(
      `INSERT INTO tender_reads (seed_key, file_name, title, issuer, tender_number, tender_type, capacity_mw, mode, sha256, pages, found, fields, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (seed_key) DO UPDATE SET file_name = EXCLUDED.file_name, title = EXCLUDED.title, issuer = EXCLUDED.issuer,
         tender_number = EXCLUDED.tender_number, tender_type = EXCLUDED.tender_type, capacity_mw = EXCLUDED.capacity_mw, mode = EXCLUDED.mode,
         sha256 = EXCLUDED.sha256, pages = EXCLUDED.pages, found = EXCLUDED.found, fields = EXCLUDED.fields, result = EXCLUDED.result`,
      [seedKey, fileName, s.title, s.issuer, s.tenderNumber, s.tenderType, s.capacityMw, s.mode, s.sha256, s.pages, s.found, s.fields, JSON.stringify(result)],
    );
    n += 1;
  }
  return n;
}

/** Users of a bid tab (Tender to Bid or the SECI RTC tender) and administrators: the bid workbook. */
export function requireBidAccess(user) {
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !["tenderBid", "seciRtc", "fdrex"].some((t) => user.allowedTabs?.includes(t))) throw new HttpError(403, "No access to a bid tab.");
}

/** Tender to Bid users (and administrators) only. */
export function requireTenderAccess(user) {
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !user.allowedTabs?.includes("tenderBid")) throw new HttpError(403, "No access to Tender to Bid.");
}
