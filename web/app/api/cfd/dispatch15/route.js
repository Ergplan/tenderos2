import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { logEvent } from "@/lib/activity";
import { workbookResponse } from "@/lib/modelWorkbook";
import { buildCfdDispatchXlsx, buildCfdDispatchZip, zipResponse } from "@/lib/cfdDispatch";

export const dynamic = "force-dynamic";

// CfD bid: the plant's operation in 15-minute blocks for every day of the 15-year term, from the
// same model as the Size step (web/lib/cfdDispatch.js). Body: { state: the saved bid state,
// format: "zip" (one CSV per Contract Year plus the summaries) | "xlsx" (one workbook) }.
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !user.allowedTabs?.includes("cfd")) throw new HttpError(403, "No access to the CfD bid tab.");
  const body = await req.json();
  const format = body?.format === "xlsx" ? "xlsx" : "zip";
  let out;
  try {
    out = format === "xlsx" ? await buildCfdDispatchXlsx(body?.state) : await buildCfdDispatchZip(body?.state);
  } catch (err) {
    if (err.status) throw new HttpError(err.status, err.message);
    throw err;
  }
  await logEvent({ user, kind: "export", detail: { what: out.file, blocks: out.blocks, years: out.years }, req });
  return format === "xlsx" ? workbookResponse(out) : zipResponse(out);
});
