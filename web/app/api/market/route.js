import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { addOrder, listOrders } from "@/lib/market";

export const dynamic = "force-dynamic";

/** The CERC orders uploaded so far. */
export const GET = handler(async () => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  return Response.json({ orders: await listOrders() });
});

/** Upload a CERC tariff-adoption order (PDF, form field "file"): read, stored, returned. */
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const form = await req.formData();
  return Response.json({ order: await addOrder(form.get("file"), user) }, { status: 201 });
});
