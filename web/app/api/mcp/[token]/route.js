// TenderOS's MCP server for Claude (web/lib/mcp.js) at /api/mcp/<MCP_TOKEN>: add that URL as a
// custom connector in claude.ai or Claude Desktop, or with `claude mcp add --transport http` in
// Claude Code (docs/MCP.md). Off (404) unless MCP_TOKEN is set; the token is the only key, so
// keep the URL private. Streamable HTTP with JSON replies: POST carries JSON-RPC, GET has no
// event stream (405), DELETE ends the session.
import { timingSafeEqual } from "node:crypto";
import { dropSession, handlePost } from "@/lib/mcp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(token) {
  const want = process.env.MCP_TOKEN || "";
  if (want.length < 16) return false; // off unless a long token is set
  const a = Buffer.from(String(token || ""));
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The site's own address, for links to the tender's PDF pages. */
function baseOf(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = (req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "")).split(",")[0];
  return host ? `${proto}://${host}` : null;
}

const notFound = () => new Response("Not found", { status: 404 });

export async function POST(req, { params }) {
  const { token } = await params;
  if (!authorised(token)) return notFound();
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const out = await handlePost(body, req.headers.get("mcp-session-id"), { base: baseOf(req) });
  const headers = { "cache-control": "no-store" };
  if (out.sessionId) headers["mcp-session-id"] = out.sessionId;
  if (out.status === 202) return new Response(null, { status: 202, headers });
  return Response.json(out.body, { status: out.status, headers });
}

export async function GET(req, { params }) {
  const { token } = await params;
  if (!authorised(token)) return notFound();
  return new Response("No event stream: POST JSON-RPC messages to this URL.", { status: 405, headers: { allow: "POST, DELETE" } });
}

export async function DELETE(req, { params }) {
  const { token } = await params;
  if (!authorised(token)) return notFound();
  const id = req.headers.get("mcp-session-id");
  if (id) dropSession(id);
  return new Response(null, { status: 204 });
}
