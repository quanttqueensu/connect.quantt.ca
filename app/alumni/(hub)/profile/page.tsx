import { notFound } from "next/navigation";

import AlumniNotificationSettings from "@/components/AlumniNotificationSettings";
import { Field, PrimaryButton, TextArea, TextInput } from "@/components/Form";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { saveAlumniProfile } from "@/lib/actions/alumni";
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
      <form action={saveAlumniProfile} className="grid max-w-xl gap-4">
        <Field label="Full name">
          <TextInput name="full_name" required maxLength={120} defaultValue={a.full_name} />
        </Field>
        <Field label="Firm">
          <TextInput name="firm" maxLength={120} defaultValue={a.firm ?? ""} />
        </Field>
        <Field label="Title">
          <TextInput name="title" maxLength={120} defaultValue={a.title ?? ""} />
        </Field>
        <Field label="Location">
          <TextInput name="location" maxLength={120} defaultValue={a.location ?? ""} />
        </Field>
        <Field label="Graduation year">
          <TextInput name="grad_year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} defaultValue={a.grad_year ?? ""} />
        </Field>
        <Field label="Program">
          <TextInput name="program" maxLength={120} defaultValue={a.program ?? ""} />
        </Field>
        <Field label="LinkedIn">
          <TextInput name="linkedin_url" type="url" maxLength={500} placeholder="https://" defaultValue={a.linkedin_url ?? ""} />
        </Field>
        <Field label="About">
          <TextArea name="bio" rows={4} maxLength={1000} defaultValue={a.bio ?? ""} />
        </Field>
        <PrimaryButton type="submit">Save profile</PrimaryButton>
      </form>
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
