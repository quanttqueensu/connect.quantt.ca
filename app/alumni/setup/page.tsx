import { redirect } from "next/navigation";

import AlumniNotificationSettings from "@/components/AlumniNotificationSettings";
import AlumniProfileForm from "@/components/AlumniProfileForm";
import Notice from "@/components/Notice";
import PublicShell from "@/components/PublicShell";
import { requireAlumnus } from "@/lib/alumni/current";
import { alumniProfileComplete, getAlumniPrefs, getAlumnus, hasChosenAlumniPrefs } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

/**
 * The one-time setup for alumni, before the alumni area: first their profile
 * (LinkedIn, phone and About are required), then their email notifications.
 * Existing alumni missing a required field are sent here once too.
 */
export default async function AlumniSetupPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const sp = await searchParams;
  const me = await requireAlumnus();
  const { DB } = await hubEnv();
  const profile = await getAlumnus(DB, me.id);
  if (!profile) redirect("/login");
  const profileDone = alumniProfileComplete(profile);
  const prefsDone = await hasChosenAlumniPrefs(DB, me.id);
  if (profileDone && prefsDone) redirect("/alumni");
  const prefs = prefsDone ? null : await getAlumniPrefs(DB, me.id);
  const steps = (profileDone ? 0 : 1) + (prefsDone ? 0 : 1);
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-lg rounded border border-line bg-white p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          Setup{steps > 1 ? " · step 1 of 2" : ""}
        </p>
        {!profileDone ? (
          <>
            <h1 className="mt-2 text-xl font-semibold text-ink">Your profile</h1>
            <p className="mt-2 text-sm leading-6 text-copy">
              Members see this in the alumni directory. Your email and phone number are never shown to members.
            </p>
            <div className="mt-5">
              <Notice message={sp.denied} />
              <AlumniProfileForm a={profile} setup />
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-xl font-semibold text-ink">Email notifications</h1>
            <p className="mt-2 text-sm leading-6 text-copy">
              Members send you a message request before their first message. Choose which emails you want. They link
              back to Connect and never include message text. You can change this later on your Profile.
            </p>
            <div className="mt-5">{prefs && <AlumniNotificationSettings prefs={prefs} setup />}</div>
          </>
        )}
      </div>
    </PublicShell>
  );
}
