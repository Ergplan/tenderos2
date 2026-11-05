import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { logEvent } from "@/lib/activity";
import { buildModelWorkbook, workbookResponse } from "@/lib/modelWorkbook";

export const dynamic = "force-dynamic";

// CfD bid: the SECI CfD-I bid's financial model as an Excel workbook (web/lib/modelWorkbook.js),
// the same workbook as the SECI RTC tab's: Cover, Live model (every number a formula on the
// inputs and the day-by-day operation's yearly totals), Construction, Profit and loss, Cash flow,
// Balance sheet, Debt schedule, Depreciation and tax, Working capital, Sensitivity, then the
// inputs, plant and capex, and the model's years. The browser builds the request
// (web/src/cfd/finance.js cfdModelExport).
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !user.allowedTabs?.includes("cfd")) throw new HttpError(403, "No access to the CfD bid tab.");
  const body = await req.json();
  let out;
  try {
    out = await buildModelWorkbook(body, { preparedBy: user.name || user.email, product: "CfD bid" });
  } catch (err) {
    if (err.status) throw new HttpError(err.status, err.message);
    throw err;
  }
  await logEvent({ user, kind: "export", detail: { what: "cfd-bid-model.xlsx" }, req });
  return workbookResponse(out);
});
