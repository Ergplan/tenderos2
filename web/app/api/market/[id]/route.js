import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { deleteOrder, updateOrder } from "@/lib/market";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

/** Correct an order's facts (and mark it checked). */
export const PATCH = handler(async (req, { params }) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const { id } = await params;
  if (!UUID.test(id)) throw new HttpError(404, "Order not found.");
  return Response.json({ order: await updateOrder(id, (await req.json()) || {}) });
});

export const DELETE = handler(async (_req, { params }) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const { id } = await params;
  if (!UUID.test(id)) throw new HttpError(404, "Order not found.");
  await deleteOrder(id);
  return Response.json({ ok: true });
});
