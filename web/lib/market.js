// Recent tenders: CERC tariff-adoption orders uploaded by the bidder, read by the engine into their
// facts, then checked by hand. Server-only.
import { query } from "./db";
import { HttpError } from "./auth";
import { saveUpload } from "./files";

const ENGINE_URL = process.env.ENGINE_URL || "http://127.0.0.1:8000";
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v, n = 300) => String(v ?? "").slice(0, n);
const date = (v) => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || ""));
  return m ? m[1] : null;
};
// a DATE column comes back as a Date at local midnight: send it as the calendar date it is
const pad = (n) => String(n).padStart(2, "0");
function shape(row) {
  if (!row) return row;
  const d = row.order_date;
  return { ...row, order_date: d instanceof Date ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : d };
}

function cleanWinners(list) {
  return (Array.isArray(list) ? list : []).slice(0, 40).map((w) => ({
    name: str(w?.name, 160), mw: num(w?.mw), tariff: num(w?.tariff), page: num(w?.page), quote: str(w?.quote, 300),
  })).filter((w) => w.name);
}

export async function listOrders() {
  const { rows } = await query("SELECT * FROM market_orders ORDER BY order_date DESC NULLS LAST, created_at DESC LIMIT 200");
  return rows.map(shape);
}

/** Read an uploaded order with the engine and keep it with its file. */
export async function addOrder(file, user) {
  if (!file || file.type !== "application/pdf") throw new HttpError(400, "Upload the order as a PDF.");
  const buf = Buffer.from(await file.arrayBuffer());
  const res = await fetch(`${ENGINE_URL}/api/bid/cerc-order`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: { name: file.name, content_base64: buf.toString("base64") } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 400 ? 400 : 502, data.detail || "The order could not be read.");
  const stored = await saveUpload(new File([buf], file.name, { type: file.type }), null);
  const f = data.fields || {};
  const s = data.summary || {};
  const { rows } = await query(
    `INSERT INTO market_orders (file_id, file_name, petition, order_date, petitioner, title, capacity_mw, tariff_min, tariff_max, winners, evidence, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [stored.id, stored.name, str(f.petition?.value, 80), date(f.orderDate?.value), str(f.petitioner?.value, 40), str(s.title, 300), num(f.capacityMw?.value),
      num(s.tariffMin), num(s.tariffMax), JSON.stringify(cleanWinners(f.winners)),
      JSON.stringify({ petition: f.petition || null, orderDate: f.orderDate || null, petitioner: f.petitioner || null, capacityMw: f.capacityMw || null, subject: f.subject || null, tariffs: (f.tariffs || []).slice(0, 12) }),
      user?.id && /^[0-9a-f-]{36}$/.test(user.id) ? user.id : null],
  );
  return shape(rows[0]);
}

/** A reader's corrections. */
export async function updateOrder(id, body) {
  const winners = cleanWinners(body.winners);
  const tariffs = winners.map((w) => w.tariff).filter((v) => v !== null);
  const { rows } = await query(
    `UPDATE market_orders SET petition = $2, order_date = $3, petitioner = $4, title = $5, capacity_mw = $6, winners = $7,
       tariff_min = $8, tariff_max = $9, note = $10, checked = $11, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, str(body.petition, 80), date(body.order_date), str(body.petitioner, 40), str(body.title, 300), num(body.capacity_mw), JSON.stringify(winners),
      tariffs.length ? Math.min(...tariffs) : num(body.tariff_min), tariffs.length ? Math.max(...tariffs) : num(body.tariff_max), str(body.note, 1000), Boolean(body.checked)],
  );
  if (!rows[0]) throw new HttpError(404, "Order not found.");
  return shape(rows[0]);
}

export async function deleteOrder(id) {
  const { rowCount } = await query("DELETE FROM market_orders WHERE id = $1", [id]);
  if (!rowCount) throw new HttpError(404, "Order not found.");
}

export async function orderFile(id) {
  const { rows } = await query("SELECT f.* FROM market_orders o JOIN team_files f ON f.id = o.file_id WHERE o.id = $1", [id]);
  if (!rows[0]) throw new HttpError(404, "File not found.");
  return rows[0];
}
