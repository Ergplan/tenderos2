import { currentUserWithAccess, handler, HttpError } from "@/lib/auth";
import { mayUseCfd } from "@/lib/tabs";
import { logEvent } from "@/lib/activity";
import { runUpsideCase, runUpsideSweep } from "@/lib/cfdUpside";

export const dynamic = "force-dynamic";

// CfD bid: the Upside of the bid (web/src/cfd/upside.js), what more own solar and battery behind
// the same connection would do to the equity IRR at the bid's strike price.
// Body: { state: the saved bid state, settings?: { batteryDecline, debtShare, dayInjection,
// trancheMwhPerMw, maxSolarPerMw, middayStress } } runs the sweep; with
// plan: { solarMw, battery: [{ year, mwh }] } (and stress?: { dayInjection, middayPerYear,
// debtShare }, lowerBid?: true) it prices that one plan.
export const POST = handler(async (req) => {
  const user = await currentUserWithAccess();
  if (!user) throw new HttpError(401, "Sign in required.");
  if (user.role !== "admin" && !mayUseCfd(user)) throw new HttpError(403, "No access to the CfD bid tab.");
  const body = await req.json();
  let out;
  try {
    out = body?.plan
      ? runUpsideCase(body.state, body.settings, body.plan, body.stress, { lowerBid: Boolean(body.lowerBid) })
      : await runUpsideSweep(body?.state, body?.settings);
  } catch (err) {
    if (err.status) throw new HttpError(err.status, err.message);
    throw err;
  }
  await logEvent({ user, kind: "run", detail: { what: body?.plan ? "cfd-upside-case" : "cfd-upside-sweep" }, req });
  return Response.json(out);
});
