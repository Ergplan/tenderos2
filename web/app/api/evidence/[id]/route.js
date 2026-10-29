import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { deleteEvidence } from "@/lib/evidence";
import { requireMember } from "@/lib/team";

export const dynamic = "force-dynamic";

/** Remove an evidence item: who attached it, or a super admin. */
export const DELETE = handler(async (_req, { params }) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const me = await requireMember(user);
  const { id } = await params;
  return Response.json(await deleteEvidence(me, id));
});
