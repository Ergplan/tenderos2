import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { exportChangeRequests } from "@/lib/changeRequests";
import { requireMember } from "@/lib/team";
import { ZONE } from "@/lib/zone";
import { promptFileName } from "../../../../src/feedback/prompt.js";

export const dynamic = "force-dynamic";

/** The approved requests as a Markdown prompt file (download); ?mark=0 leaves them approved. Super admin. */
export const GET = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const me = await requireMember(user);
  const q = new URL(req.url).searchParams;
  const site = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const { markdown, batch, count } = await exportChangeRequests(me, {
    mark: q.get("mark") !== "0",
    meta: { site, version: process.env.TENDEROS_VERSION || "dev", zone: ZONE, branch: process.env.TENDEROS_BRANCH || "" },
  });
  return new Response(markdown, {
    status: 200,
    headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${promptFileName(batch)}"`, "x-change-requests": String(count) },
  });
});
