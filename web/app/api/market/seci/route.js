import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { listSeciTenders } from "@/lib/seciScan";

export const dynamic = "force-dynamic";

/** New tenders: SECI's open tenders as last scanned, with their summaries and the last scan. */
export const GET = handler(async () => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !user.allowedTabs?.includes("newTenders")) throw new HttpError(403, "No access to New tenders.");
  return Response.json(await listSeciTenders());
});
