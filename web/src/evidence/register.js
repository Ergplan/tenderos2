// The evidence register: the evidence of every box, grouped by tab and box, for a report or a CSV.
// Plain JavaScript shared by the server (GET /api/evidence/register) and tools/check_evidence.mjs.
// An item is an evidence row as lib/evidence.js lists it: field_key, tab, field_label, place,
// kind, file_id, file_name, url, note, value_at, by_name, created_at, and the box's sign-off when it
// has one (signed_value_at, signed_by_name, signed_at).

const TAB_LABELS = {
  tenderBid: "Tender to Bid", rtc: "Round the Clock", seciRtc: "SECI RTC tender", bessTender: "BESS Tender",
  cfd: "CfD Bid", whatIf: "What-if analysis", recentTenders: "Recent tenders",
};
export const tabLabel = (tab) => TAB_LABELS[tab] || String(tab || "");

/** What an item points at: the file's name, the link, or the note. */
export function itemName(item) {
  if (item.kind === "file") return item.file_name || (item.file_id ? "file" : "file (removed)");
  if (item.kind === "link") return item.url || "";
  return item.note || "";
}

/**
 * The sign-off of a box relative to one of its items: "current" when the box was signed off at
 * the value the item was attached at, "older value" when signed off at another value, "" when not.
 */
export function signedState(item) {
  if (!item.signed_at) return "";
  return String(item.signed_value_at ?? "") === String(item.value_at ?? "") ? "current" : "older value";
}

/**
 * Group items by tab, then by box, in the order given (list them by tab, place, label, time).
 * Returns [{ tab, tabLabel, fields: [{ key, label, place, signoff, items: [...] }] }].
 */
export function evidenceRegister(items) {
  const tabs = new Map();
  for (const it of items || []) {
    if (!tabs.has(it.tab)) tabs.set(it.tab, { tab: it.tab, tabLabel: tabLabel(it.tab), fields: new Map() });
    const t = tabs.get(it.tab);
    if (!t.fields.has(it.field_key)) {
      t.fields.set(it.field_key, {
        key: it.field_key, label: it.field_label, place: it.place || "",
        signoff: it.signed_at ? { valueAt: String(it.signed_value_at ?? ""), by: it.signed_by_name || "", at: it.signed_at } : null,
        items: [],
      });
    }
    t.fields.get(it.field_key).items.push({
      id: it.id, kind: it.kind, name: itemName(it), valueAt: String(it.value_at ?? ""), by: it.by_name || "", at: it.created_at, signed: signedState(it),
    });
  }
  return [...tabs.values()].map((t) => ({ ...t, fields: [...t.fields.values()] }));
}

const cell = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const when = (v) => (v ? new Date(v).toISOString() : "");

export const REGISTER_COLUMNS = ["Tab", "Box", "Place", "Value at attach", "Kind", "Name / URL / note", "By", "When", "Signed off", "Signed value", "Signed by", "Signed at"];

/** The register as CSV: one line per item, the header first. */
export function registerCsv(items) {
  const lines = [REGISTER_COLUMNS.map(cell).join(",")];
  for (const t of evidenceRegister(items)) {
    for (const f of t.fields) {
      for (const it of f.items) {
        lines.push([t.tabLabel, f.label, f.place, it.valueAt, it.kind, it.name, it.by, when(it.at),
          it.signed || "no", f.signoff?.valueAt ?? "", f.signoff?.by ?? "", when(f.signoff?.at)].map(cell).join(","));
      }
    }
  }
  return `${lines.join("\r\n")}\r\n`;
}
