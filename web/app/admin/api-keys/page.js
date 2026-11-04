import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { actingMember } from "@/lib/team";
import { secretStatus } from "@/lib/secrets";
import { ZONE } from "@/lib/zone";
import { plain } from "@/lib/json";
import PageShell from "@/components/PageShell";
import ApiKeysAdmin from "@/components/ApiKeysAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "API keys" };

/** Administration › API keys: enter each provider key once; it is stored encrypted and shown masked. */
export default async function ApiKeysPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin/api-keys");
  const me = user.role === "admin" ? null : await actingMember(user);
  if (user.role !== "admin" && !me?.super_admin) redirect("/");
  return (
    <PageShell user={user} active="apiKeys" eyebrow="Administration" title="API keys" keyAdmin>
      <ApiKeysAdmin initial={plain(await secretStatus())} zone={ZONE} />
    </PageShell>
  );
}
