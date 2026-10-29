import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { registerCsvFor } from "@/lib/evidence";
import { requireMember } from "@/lib/team";

export const dynamic = "force-dynamic";

/** The evidence register as CSV: ?tab=<id> for one tab, else every tab. */
export const GET = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  await requireMember(user);
  const tab = new URL(req.url).searchParams.get("tab") || null;
  const csv = await registerCsvFor(tab);
  const name = `evidence-register-${tab || "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
});
