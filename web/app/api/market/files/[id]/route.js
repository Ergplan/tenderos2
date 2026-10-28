import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { readStored } from "@/lib/files";
import { orderFile } from "@/lib/market";

export const dynamic = "force-dynamic";

/** The uploaded order's PDF (by the order's id). */
export const GET = handler(async (_req, { params }) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "File not found.");
  const row = await orderFile(id);
  const buf = await readStored(row);
  return new Response(buf, {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(buf.length),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
