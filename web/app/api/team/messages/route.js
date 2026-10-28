import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { requireMember } from "@/lib/team";
import { inbox, listThread, postMessage, threadCounts } from "@/lib/teamMessages";

export const dynamic = "force-dynamic";

async function member() {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  return requireMember(user);
}

/** ?thread=<key>: a field's messages; ?tab=<id>: message counts by field; ?inbox=1: my inbox. */
export const GET = handler(async (req) => {
  const me = await member();
  const q = new URL(req.url).searchParams;
  if (q.get("thread")) return Response.json({ messages: await listThread(me, q.get("thread")) });
  if (q.get("tab")) return Response.json({ counts: await threadCounts(me, q.get("tab")) });
  return Response.json(await inbox(me));
});

/** Post in a field's thread: { threadKey, tab, fieldLabel, place, step, fieldValue, body, value }. */
export const POST = handler(async (req) => {
  const me = await member();
  return Response.json({ message: await postMessage(me, await req.json()) }, { status: 201 });
});
