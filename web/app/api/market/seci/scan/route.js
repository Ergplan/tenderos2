import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { logEvent } from "@/lib/activity";
import { runSeciScan } from "@/lib/seciScan";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Scan SECI's tender list and details pages now (no document is opened) and summarise what is new. */
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !user.allowedTabs?.includes("newTenders")) throw new HttpError(403, "No access to New tenders.");
  const out = await runSeciScan(user);
  await logEvent({ user, kind: "engine", detail: { path: "market/seci-scan", found: out.scan?.found, new: out.scan?.new, mode: out.scan?.mode }, req });
  return Response.json(out);
});
