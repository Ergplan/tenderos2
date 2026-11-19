import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listScenarios } from "@/lib/scenarios";
import { plain } from "@/lib/json";
import PageShell from "@/components/PageShell";
import ScenarioLibrary from "@/components/ScenarioLibrary";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saved scenarios" };

export default async function Scenarios({ searchParams }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/scenarios");
  const sp = await searchParams;
  const module = ["rtc", "bess", "seci", "cfd", "cfdOwnSolar", "fdrex"].includes(sp?.module) ? sp.module : "";
  const rows = plain(await listScenarios({ module, viewer: user }));
  return (
    <PageShell user={user} active="scenarios" eyebrow="Library" title="Saved scenarios">
      <ScenarioLibrary initial={rows} initialModule={module} />
    </PageShell>
  );
}
