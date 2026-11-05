import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { logEvent } from "@/lib/activity";
import { docxBuffer, docxResponse, para, str, table } from "@/lib/docx";

export const dynamic = "force-dynamic";

// SECI CfD-I: the bid pack as a Word file. The browser sends the bidder's answers, the plant, the
// money at stake, the dates and every check with the term it rests on (web/src/cfd/forms.js
// bidPackRequest) and the formats with their blanks (formatsForPack); this route lays them out on A4.

const num = (v, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
const fmtDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || "")) ? iso.split("-").reverse().join(".") : "–");
const STATUS = { ok: "OK", bad: "Not met", warn: "Check", todo: "To do" };

function bodyXml(b, preparedBy) {
  const t = b.tender || {};
  const bid = b.bid || {};
  const fields = (Array.isArray(b.fields) ? b.fields : []).slice(0, 60);
  const checks = (Array.isArray(b.checks) ? b.checks : []).slice(0, 40);
  const docs = (Array.isArray(b.documents) ? b.documents : []).slice(0, 12);
  const groups = [...new Set(fields.map((f) => str(f.group, 40)))];
  const out = [
    para(`Bid pack: ${str(t.short, 80)}`, { bold: true, size: 30, center: true, after: 80 }),
    para(str(t.title, 300), { center: true, after: 40 }),
    para(`RfS No. ${str(t.rfsNo, 80)} · ${str(t.issuer, 120)}`, { center: true, after: 40, size: 18, color: "555555" }),
    para(`Prepared ${fmtDate(new Date().toISOString().slice(0, 10))} by ${str(preparedBy, 120)} with TenderOS`, { center: true, italic: true, size: 18, color: "777777", after: 240 }),
    para("The offer", { bold: true, size: 24, before: 120 }),
    table([["Item", 3600], ["Value", 6300]], [
      ["Contracted capacity", `${num(bid.contractedMw, 0)} MW`],
      ["Strike price quoted", typeof bid.tariff === "number" ? `₹${num(bid.tariff, 2)}/kWh, fixed for the 15-year term` : "Not entered"],
      ["Strike price for the target equity IRR (model)", typeof bid.modelTariff === "number" ? `₹${num(bid.modelTariff, 2)}/kWh` : "Run the model"],
      ["Solar", `${num(bid.solarMw, 0)} MW`], ["Wind", `${num(bid.windMw, 0)} MW`], ["Storage", `${num(bid.bessMw, 0)} MW / ${num(bid.bessMwh, 0)} MWh`],
      ["Market the peak supply is sold in", str(bid.sellMarket, 20) || "–"],
      ["EMD", typeof bid.emdCr === "number" ? `₹${num(bid.emdCr)} crore` : "–"],
      ["Performance Bank Guarantee", typeof bid.pbgCr === "number" ? `₹${num(bid.pbgCr)} crore` : "–"],
      ["Contract Administration Charges", typeof bid.cacCr === "number" ? `₹${num(bid.cacCr)} crore + GST` : "–"],
      ["Minimum net worth", typeof bid.netWorthCr === "number" ? `₹${num(bid.netWorthCr)} crore` : "–"],
    ], { colOpts: [{ bold: true }, {}] }),
  ];
  if (b.dates) {
    out.push(para("Dates", { bold: true, size: 24, before: 200 }), table([["Milestone", 3600], ["Date", 6300]], [
      ["Effective Date of the CfDA", fmtDate(b.dates.effective)], ["Financial Closure", fmtDate(b.dates.finClose)],
      ["Battery commissioned (SCD)", fmtDate(b.dates.scd)], ["Latest, with penalty", fmtDate(b.dates.lastWithPenalty)],
      ["RE generation commissioned by", fmtDate(b.dates.reDeadline)], ["End of the term", fmtDate(b.dates.end)],
    ], { colOpts: [{ bold: true }, {}] }));
  }
  for (const g of groups) {
    out.push(para(g, { bold: true, size: 24, before: 200 }), table([["Particular", 3600], ["Entry", 6300]],
      fields.filter((f) => str(f.group, 40) === g).map((f) => [str(f.label, 120), str(f.value, 2000) || "________________"]), { colOpts: [{ bold: true }, {}] }));
  }
  out.push(para("Checks against the tender", { bold: true, size: 24, before: 200 }), table([["Check", 2400], ["Result", 4200], ["Status", 1100], ["Source", 2200]],
    checks.map((c) => [str(c.label, 120), str(c.detail, 600), STATUS[c.status] || str(c.status, 20), str(c.source, 120)]), { colOpts: [{ bold: true }, {}, {}, {}] }));
  out.push(para("Documents read", { bold: true, size: 24, before: 200 }), table([["Document", 4500], ["Reference", 2200], ["Read", 1200]],
    docs.map((d) => [str(d.title, 160), str(d.ref, 60), d.provided ? "Yes" : "Not provided"])));
  const formats = (Array.isArray(b.formats) ? b.formats : []).slice(0, 30);
  if (formats.length) {
    out.push(para("The RfS formats", { bold: true, size: 28, before: 320 }),
      para("Each format this bid needs, with every blank as filled in TenderOS. Print each on the paper it names, in the RfS's own wording (pages given), and sign it.", { italic: true, size: 18, color: "555555", after: 120 }));
    for (const f of formats) {
      const pages = Array.isArray(f.pages) ? `RfS PDF pp. ${num(f.pages[0], 0)}–${num(f.pages[1], 0)}` : "";
      out.push(para(`Format ${str(f.id, 20)}: ${str(f.title, 160)}`, { bold: true, size: 24, before: 240 }));
      out.push(table([["", 2400], ["", 7500]], [
        ["In the RfS", pages],
        ["Signed by", str(f.submittedBy, 300)],
        ["On", str(f.paper, 300)],
        ["Goes in", str(f.envelope, 200)],
        ["When", str(f.when, 200)],
        ["Status", `${f.applies === "later" ? "After the award" : "Needed"}; ${f.reviewed === "current" ? `reviewed ${fmtDate(String(f.reviewedAt || "").slice(0, 10))}` : f.reviewed === "changed" ? "changed since its review" : "not reviewed yet"}`],
      ], { colOpts: [{ bold: true }, {}], header: false }));
      const fields = (Array.isArray(f.fields) ? f.fields : []).slice(0, 60);
      if (fields.length) {
        out.push(table([["Blank", 3400], ["Entry", 5600], ["Page", 900]], fields.map((x) => [str(x.label, 160), str(x.value, 2000) || "________________", num(x.page, 0)]), { colOpts: [{ bold: true }, {}, {}] }));
      }
      const att = (Array.isArray(f.attachments) ? f.attachments : []).slice(0, 12);
      if (att.length) out.push(table([["Enclose", 7800], ["Ready", 2100]], att.map((a) => [str(a.label, 300), a.done ? "Yes" : "Not yet"]), { colOpts: [{}, { bold: true }] }));
    }
  }
  return out.join("");
}

export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !user.allowedTabs?.includes("cfd")) throw new HttpError(403, "No access to the CfD Bid tab.");
  const body = await req.json();
  if (!body?.tender || !body?.bid) throw new HttpError(400, "The bid pack is empty.");
  const bidder = (Array.isArray(body.fields) ? body.fields : []).find((f) => f.label === "Bidder's name")?.value;
  const buffer = await docxBuffer({ title: `Bid pack ${str(body.tender.short, 80)}`, author: str(bidder, 200) || user.name || user.email, body: bodyXml(body, user.name || user.email) });
  await logEvent({ user, kind: "export", detail: { what: "cfd-bid-pack.docx", mw: body.bid.contractedMw }, req });
  return docxResponse(buffer, `${str(body.fileName, 80).replace(/[^\w.-]+/g, "_") || "bid_pack"}.docx`);
});
