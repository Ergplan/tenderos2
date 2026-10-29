import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { addEvidence, listEvidence } from "@/lib/evidence";
import { requireMember } from "@/lib/team";

export const dynamic = "force-dynamic";

async function member() {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  return requireMember(user);
}

/** ?tab=<id>: the tab's evidence (items, sign-offs, counts by box). */
export const GET = handler(async (req) => {
  const me = await member();
  const q = new URL(req.url).searchParams;
  return Response.json(await listEvidence(me, q.get("tab") || ""));
});

/**
 * Attach evidence to a box: { fieldKey, tab, fieldLabel, place, valueAt, kind, url | note } as JSON,
 * or multipart with the same fields and "file" (kind file).
 */
export const POST = handler(async (req) => {
  const me = await member();
  let body;
  if ((req.headers.get("content-type") || "").startsWith("multipart/form-data")) {
    const form = await req.formData();
    const field = (k) => (form.get(k) === null ? null : String(form.get(k)));
    const file = form.get("file");
    body = {
      fieldKey: field("fieldKey"), tab: field("tab"), fieldLabel: field("fieldLabel"), place: field("place") || "", valueAt: field("valueAt") || "",
      kind: field("kind") || "file", url: field("url"), note: field("note"), file: file && typeof file === "object" ? file : null,
    };
  } else {
    body = { ...((await req.json()) || {}), file: null };
  }
  return Response.json({ item: await addEvidence(me, body) }, { status: 201 });
});
