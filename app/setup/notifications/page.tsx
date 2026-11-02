import { redirect } from "next/navigation";

import NotificationSettings from "@/components/NotificationSettings";
import PublicShell from "@/components/PublicShell";
import { requireCurrentProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";
import { getPrefs, hasChosenPrefs } from "@/lib/notifications";

/**
 * The one-time setup step: members and sponsors choose their email
 * notifications before using Connect. The member and sponsor layouts send
 * anyone who hasn't saved them here. Changeable later on Profile / Sponsorship.
 */
export default async function NotificationSetupPage() {
  const profile = await requireCurrentProfile();
  const { DB } = await hubEnv();
  const home = profile.role === "company_user" ? "/company" : "/feed";
  if (await hasChosenPrefs(DB, profile.id)) redirect(home);
  const prefs = await getPrefs(DB, profile.id);
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-lg rounded border border-line bg-white p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Setup</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">Email notifications</h1>
        <p className="mt-2 text-sm leading-6 text-copy">
          Choose which emails you want from Connect. Emails link back to Connect and never include message text. You
          can change this later {profile.role === "company_user" ? "under Sponsorship" : "on your Profile"}.
        </p>
        <div className="mt-5">
          <NotificationSettings prefs={prefs} role={profile.role} setup />
        </div>
      </div>
    </PublicShell>
  );
}
