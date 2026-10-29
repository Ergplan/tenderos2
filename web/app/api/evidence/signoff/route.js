import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { signOff } from "@/lib/evidence";
import { requireMember } from "@/lib/team";

export const dynamic = "force-dynamic";

/** Sign off a box's value, or clear the sign-off: { tab, fieldKey, fieldLabel, valueAt, signed: true | false }. Super admin only. */
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const me = await requireMember(user);
  const body = (await req.json()) || {};
  return Response.json(await signOff(me, { ...body, signed: body.signed !== false }));
});
