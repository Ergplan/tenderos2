import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { plain } from "@/lib/json";
import { getSetting } from "@/lib/settings";
import { ALL_TAB_IDS, cleanTabList } from "@/lib/tabs";
import { USER_COLS } from "@/lib/workspace";
import PageShell from "@/components/PageShell";
import UserAdmin from "@/components/UserAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users and licences" };

export default async function UsersPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin/users");
  if (user.role !== "admin") redirect("/");
  const { rows } = await query(`SELECT ${USER_COLS} FROM users ORDER BY created_at`);
  return (
    <PageShell user={user} active="users" eyebrow="Administration" title="Users and licences">
      <UserAdmin me={user} initial={plain(rows)} defaultTabs={cleanTabList(await getSetting("default_tabs", null)) ?? ALL_TAB_IDS}
        signInPath={process.env.SIGN_IN_PATH || "/login"} />
    </PageShell>
  );
}
