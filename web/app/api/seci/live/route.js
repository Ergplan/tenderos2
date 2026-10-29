import { NextResponse } from "next/server";
import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { CLOUD_AGENTS, ZONE } from "@/lib/zone";
import { logEvent } from "@/lib/activity";
import { LIVE_MODEL, liveSessionConfig } from "@/src/seci/agent";

export const dynamic = "force-dynamic";

// The SECI RTC bid agent's voice session (GPT-Live, gpt-live-1). The browser sends its WebRTC
// offer; this route creates the session with OpenAI (POST /v1/live/sessions) using the server's
// OPENAI_API_KEY, which never reaches the browser, and returns the SDP answer. The session's
// backend model works the bid through function tools the browser runs (web/src/seci/agent.js).
//
// Settings (environment): OPENAI_API_KEY (required for the agent), OPENAI_LIVE_BACKEND_MODEL
// (default gpt-6-luna), OPENAI_LIVE_VOICE (default marin), OPENAI_BASE_URL.

const BACKEND = () => process.env.OPENAI_LIVE_BACKEND_MODEL || "gpt-6-luna";
const VOICE = () => process.env.OPENAI_LIVE_VOICE || "marin";
const BASE = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const GREETING = "Open the conversation: greet the bid manager in one short sentence, say you can walk them through the SECI RTC-TM-V bid step by step, filling the model, running the optimiser and explaining the results, or answer any question about the tender, and ask whether to start.";
const lastStart = new Map(); // user id -> time of the last session started (one every 10 seconds)

async function allowed() {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !user.allowedTabs?.includes("seciRtc")) throw new HttpError(403, "No access to the SECI RTC tender tab.");
  return user;
}

/** Whether the agent can run here (a key on the server), so the tab says how to set it up if not. */
export const GET = handler(async () => {
  await allowed();
  return NextResponse.json({ available: CLOUD_AGENTS && Boolean(process.env.OPENAI_API_KEY), zone: ZONE, model: LIVE_MODEL, backendModel: BACKEND(), voice: VOICE() });
});

export const POST = handler(async (req) => {
  const user = await allowed();
  if (!CLOUD_AGENTS) throw new HttpError(403, "The voice agent does not run in the core zone: no cloud model reaches the bid workspace.");
  if (!process.env.OPENAI_API_KEY) throw new HttpError(503, "The voice agent is not set up on this server (OPENAI_API_KEY).");
  const body = await req.json().catch(() => null);
  const sdp = body?.sdp;
  if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > 65536) throw new HttpError(400, "A WebRTC offer (SDP) is required.");
  const key = user.id || user.email;
  if (Date.now() - (lastStart.get(key) || 0) < 10_000) throw new HttpError(429, "A voice session was started a moment ago; wait a few seconds.");
  lastStart.set(key, Date.now());

  const res = await fetch(`${BASE()}/live/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ session: liveSessionConfig({ backendModel: BACKEND(), voice: VOICE(), greeting: GREETING }), transport: { type: "webrtc", sdp } }),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || !data?.transport?.sdp) {
    console.error("GPT-Live session creation failed", res.status, text.slice(0, 500));
    throw new HttpError(res.status === 401 || res.status === 403 ? 502 : res.status >= 400 && res.status < 600 ? res.status : 502,
      `The voice service did not start the session (${res.status}${data?.error?.message ? `: ${String(data.error.message).slice(0, 200)}` : ""}).`);
  }
  await logEvent({ user, kind: "voice", detail: { what: "seci-live-session", session: data.session?.id || null, backend: BACKEND() }, req });
  return NextResponse.json({ session: { id: data.session?.id || null }, transport: { type: "webrtc", sdp: data.transport.sdp }, greeting: GREETING }, { status: 201 });
});
