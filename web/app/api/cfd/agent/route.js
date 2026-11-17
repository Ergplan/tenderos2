import Anthropic from "@anthropic-ai/sdk";
import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { CLOUD_AGENTS, ZONE } from "@/lib/zone";
import { logEvent } from "@/lib/activity";
import { getSecret } from "@/lib/secrets";
import { AGENT_MODEL, agentErrorOf, cleanMessages, runBidAgent } from "@/lib/cfdAgent";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The CfD bid analyst (web/lib/cfdAgent.js): Claude with the bid's own model as its tools.
// POST { state: the saved bid state, messages: [{ role: "user" | "assistant", content }] }
// answers with a stream of JSON lines: { type: "text", delta }, { type: "tool", id, name, label },
// { type: "tool_done", id, ok, ms }, then { type: "done", text, plans, model, usage } or
// { type: "error", message }. The Anthropic key is the one entered under Administration › API keys
// (or ANTHROPIC_API_KEY in .env); it never reaches the browser. Not in the core zone.
//
// Settings (environment): CFD_AGENT_MODEL (default claude-opus-5-5), CFD_AGENT_EFFORT (default
// medium), ANTHROPIC_BASE_URL.

const busy = new Map(); // user id -> time the running answer started (one at a time)

async function allowed() {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !user.allowedTabs?.includes("cfd")) throw new HttpError(403, "No access to the CfD bid tab.");
  return user;
}

/** Whether the analyst can run here, so the step says how to set it up if not. */
export const GET = handler(async () => {
  await allowed();
  return Response.json({ available: CLOUD_AGENTS && Boolean(await getSecret("ANTHROPIC_API_KEY")), cloud: CLOUD_AGENTS, zone: ZONE, model: AGENT_MODEL() });
});

export const POST = handler(async (req) => {
  const user = await allowed();
  if (!CLOUD_AGENTS) throw new HttpError(403, "The analyst does not run in the core zone: no cloud model reaches the bid workspace. The Upside step itself runs here without it.");
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) throw new HttpError(503, "The analyst is not set up on this server: add the Anthropic key under Administration › API keys (or ANTHROPIC_API_KEY in .env).");
  const body = await req.json().catch(() => null);
  if (!body?.state || typeof body.state !== "object") throw new HttpError(400, "The bid state is required.");
  if (!cleanMessages(body.messages).length) throw new HttpError(400, "A question is required.");
  const key = user.id || user.email;
  if (Date.now() - (busy.get(key) || 0) < 240_000) throw new HttpError(429, "The analyst is still answering your last question.");
  busy.set(key, Date.now());

  const client = new Anthropic({ apiKey, ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}) });
  const encoder = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* the browser left */ } };
      try {
        const out = await runBidAgent({ client, state: body.state, messages: body.messages, send, signal: req.signal });
        send({ type: "done", text: out.text, plans: out.plans, model: out.model, usage: out.usage, stop: out.stop });
        await logEvent({ user, kind: "run", detail: { what: "cfd-analyst", model: out.model, tools: out.toolCalls, in: out.usage.input_tokens, out: out.usage.output_tokens, stop: out.stop }, ms: Date.now() - started, req });
      } catch (err) {
        if (!req.signal.aborted) {
          const [status, message] = agentErrorOf(err);
          if (status === 500) console.error(err);
          send({ type: "error", message });
        }
      } finally {
        busy.delete(key);
        try { controller.close(); } catch { /* closed */ }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});
