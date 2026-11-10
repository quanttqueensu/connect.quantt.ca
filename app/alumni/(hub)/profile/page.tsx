import { notFound } from "next/navigation";

import AlumniNotificationSettings from "@/components/AlumniNotificationSettings";
import AlumniProfileForm from "@/components/AlumniProfileForm";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { requireAlumnus } from "@/lib/alumni/current";
import { getAlumniPrefs, getAlumnus } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; saved?: string; notifications?: string }>;
}) {
  const sp = await searchParams;
  const me = await requireAlumnus();
  const { DB } = await hubEnv();
  const [a, prefs] = await Promise.all([getAlumnus(DB, me.id), getAlumniPrefs(DB, me.id)]);
  if (!a) notFound();
  return (
    <>
      <PageHeader title="Profile">
        Members see this in the alumni directory. Your email is never shown.
      </PageHeader>
      <Notice message={sp.denied} />
      {sp.saved && <p className="mb-6 text-sm text-copy">Saved.</p>}
      <AlumniProfileForm a={a} />
      <section id="notifications" className="mt-6 max-w-xl scroll-mt-40 border-t border-line pt-5">
        <h2 className="font-heading text-lg font-bold text-ink">Email notifications</h2>
        <p className="mt-1 text-sm text-copy">Emails link back to Connect and never include message text.</p>
        <div className="mt-4">
          <AlumniNotificationSettings prefs={prefs} saved={sp.notifications === "saved"} />
        </div>
      </section>
    </>
  );
}
