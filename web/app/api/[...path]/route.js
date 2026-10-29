// Authenticated pass-through to the Python engine (FastAPI): /api/<anything not handled by
// Next.js> → ENGINE_URL/api/<same path>. Uses node:http so long optimizer runs are not cut
// off by fetch timeouts.
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { mayCallEngine } from "@/lib/tabs";
import { ZONE, zoneAllowsEngine } from "@/lib/zone";
import { logEvent } from "@/lib/activity";

export const dynamic = "force-dynamic";
const ENGINE_URL = process.env.ENGINE_URL || "http://127.0.0.1:8000";
const TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS || 30 * 60 * 1000);

async function forward(req, { params }) {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  const { path } = await params;
  // each tab may call only its own engine routes: Tender to Bid /api/bid/* and /api/rtc/*, Round
  // the Clock /api/rtc/*, BESS Tender /api/bess/*; /api/health for any signed-in user
  if (!mayCallEngine(user.allowedTabs, path[0])) throw new HttpError(403, "Contact Administrator: no access to this part of the engine.");
  // the core zone has no cloud client: tender reading happens in the intake zone and arrives as a signed package
  if (!zoneAllowsEngine(path.join("/"))) throw new HttpError(403, `Not in the ${ZONE} zone: tender documents are read in the intake zone and imported here as a signed package (docs/enterprise/ARCHITECTURE.md).`);
  const incoming = new URL(req.url);
  const target = new URL(`/api/${path.map(encodeURIComponent).join("/")}${incoming.search}`, ENGINE_URL);
  const body = req.method === "GET" || req.method === "HEAD" ? null : Buffer.from(await req.arrayBuffer());
  const headers = { accept: req.headers.get("accept") || "*/*" };
  if (req.headers.get("content-type")) headers["content-type"] = req.headers.get("content-type");
  if (body) headers["content-length"] = String(body.length);
  const started = Date.now();
  const logged = req.method !== "GET" && req.method !== "HEAD"; // compute calls, not reads
  return new Promise((resolve) => {
    const lib = target.protocol === "https:" ? https : http;
    const upstream = lib.request(target, { method: req.method, headers, timeout: TIMEOUT_MS }, (res) => {
      // usage: engine path, status and wall time until the (possibly streamed) response ends
      if (logged) res.on("close", () => logEvent({ user, kind: "engine", detail: { path: path.join("/"), status: res.statusCode }, ms: Date.now() - started, req }));
      const out = new Headers();
      for (const h of ["content-type", "content-disposition", "content-length", "cache-control"]) if (res.headers[h]) out.set(h, res.headers[h]);
      resolve(new Response(Readable.toWeb(res), { status: res.statusCode || 502, headers: out }));
    });
    upstream.on("timeout", () => upstream.destroy(new Error("Engine timed out")));
    upstream.on("error", (err) => resolve(Response.json({ error: `Engine unavailable: ${err.message}` }, { status: 502 })));
    if (body) upstream.write(body);
    upstream.end();
  });
}

export const GET = handler(forward);
export const POST = handler(forward);
export const PUT = handler(forward);
export const PATCH = handler(forward);
export const DELETE = handler(forward);
