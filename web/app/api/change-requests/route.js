import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { addChangeRequest, listChangeRequests } from "@/lib/changeRequests";
import { requireMember } from "@/lib/team";

export const dynamic = "force-dynamic";

async function member() {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  return requireMember(user);
}

/** ?status=: the change requests (items, counts by status). */
export const GET = handler(async (req) => {
  const me = await member();
  const q = new URL(req.url).searchParams;
  return Response.json(await listChangeRequests(me, { status: q.get("status") || "" }));
});

/** Raise one: { tab, tabLabel, step, stepLabel, sectionKey, sectionIndex, sectionTitle, boxes, pageUrl, comment }. */
export const POST = handler(async (req) => {
  const me = await member();
  const body = (await req.json()) || {};
  return Response.json({ item: await addChangeRequest(me, body) }, { status: 201 });
});
