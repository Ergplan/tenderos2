import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// The router's door to the other apps of a shared VM that only TenderOS administrators may open
// (deploy/demo2/apps.caddy: Demo 1 behind forward_auth). Caddy sends each request for such an app
// here first, with the visitor's cookies: 204 lets it through; otherwise the visitor is sent to
// this app's sign-in (past the chooser), and Caddy returns that answer instead of the app.
export async function GET() {
  const user = await currentUser().catch(() => null);
  if (user?.role === "admin") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const to = process.env.SIGN_IN_PATH || "/login";
  return new Response(`Administrators only: sign in to TenderOS at ${to}`, {
    status: 302,
    headers: { Location: to, "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}
