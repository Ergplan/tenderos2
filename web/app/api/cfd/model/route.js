import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { mayUseCfd } from "@/lib/tabs";
import { logEvent } from "@/lib/activity";
import { buildModelWorkbook, workbookResponse } from "@/lib/modelWorkbook";
import { cfdBlockData } from "@/lib/cfdBlockSheets";

export const dynamic = "force-dynamic";

// CfD bid: the SECI CfD-I bid's financial model as an Excel workbook (web/lib/modelWorkbook.js),
// the same workbook as the SECI RTC tab's: Cover, Live model (every number a formula on the
// inputs and the day-by-day operation's yearly totals), Construction, Profit and loss, Cash flow,
// Balance sheet, Debt schedule, Depreciation and tax, Working capital, Sensitivity, then the
// inputs, plant and capex, and the model's years. The browser builds the request
// (web/src/cfd/finance.js cfdModelExport).
// With `blocks15` and the saved bid `state` in the body it is the second version: the Live model's
// contracted, supplied and sold energy are formulas on the 15-minute dispatch of every day of the
// term, on sheets at the end of the workbook (web/lib/cfdBlockSheets.js).
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !mayUseCfd(user)) throw new HttpError(403, "No access to the CfD bid tab.");
  const body = await req.json();
  let out;
  try {
    const blockData = body?.blocks15 ? cfdBlockData(body.state) : null;
    out = await buildModelWorkbook(body, { preparedBy: user.name || user.email, product: "CfD bid", blockData });
  } catch (err) {
    if (err.status) throw new HttpError(err.status, err.message);
    throw err;
  }
  await logEvent({ user, kind: "export", detail: { what: body?.blocks15 ? "cfd-bid-model-15min.xlsx" : "cfd-bid-model.xlsx" }, req });
  return workbookResponse(out);
});
