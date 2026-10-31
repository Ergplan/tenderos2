import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { decideChangeRequest, deleteChangeRequest } from "@/lib/changeRequests";
import { requireMember } from "@/lib/team";

export const dynamic = "force-dynamic";

async function member() {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  return requireMember(user);
}

/** { status: open | approved | rejected | done } (super admin). */
export const PATCH = handler(async (req, { params }) => {
  const me = await member();
  const { id } = await params;
  const body = (await req.json()) || {};
  return Response.json({ item: await decideChangeRequest(me, id, String(body.status || "")) });
});

export const DELETE = handler(async (req, { params }) => {
  const me = await member();
  const { id } = await params;
  return Response.json(await deleteChangeRequest(me, id));
});
