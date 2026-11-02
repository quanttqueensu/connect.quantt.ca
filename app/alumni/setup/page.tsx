import { redirect } from "next/navigation";

import AlumniNotificationSettings from "@/components/AlumniNotificationSettings";
import PublicShell from "@/components/PublicShell";
import { requireAlumnus } from "@/lib/alumni/current";
import { getAlumniPrefs, hasChosenAlumniPrefs } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

/** The one-time setup step for alumni: choose email notifications before using the alumni area. */
export default async function AlumniSetupPage() {
  const me = await requireAlumnus();
  const { DB } = await hubEnv();
  if (await hasChosenAlumniPrefs(DB, me.id)) redirect("/alumni");
  const prefs = await getAlumniPrefs(DB, me.id);
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-lg rounded border border-line bg-white p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Setup</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">Email notifications</h1>
        <p className="mt-2 text-sm leading-6 text-copy">
          Members send you a message request before their first message. Choose which emails you want. They link back
          to Connect and never include message text. You can change this later on your Profile.
        </p>
        <div className="mt-5">
          <AlumniNotificationSettings prefs={prefs} setup />
        </div>
      </div>
    </PublicShell>
  );
}
