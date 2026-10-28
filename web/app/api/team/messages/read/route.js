import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { requireMember } from "@/lib/team";
import { markRead } from "@/lib/teamMessages";

export const dynamic = "force-dynamic";

/** Mark messages read: { ids: [...] } or { threadKey }. */
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const me = await requireMember(user);
  return Response.json(await markRead(me, (await req.json()) || {}));
});
