import { notFound } from "next/navigation";

import { Field, PrimaryButton, TextArea, TextInput } from "@/components/Form";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { saveAlumniProfile } from "@/lib/actions/alumni";
import { requireAlumnus } from "@/lib/alumni/current";
import { getAlumnus } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const me = await requireAlumnus();
  const a = await getAlumnus((await hubEnv()).DB, me.id);
  if (!a) notFound();
  return (
    <>
      <PageHeader kicker="You" title="Profile">
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
        <label className="flex items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            name="email_messages"
            defaultChecked={a.email_messages === 1}
            className="h-4 w-4 accent-primary"
          />
          Email me when a member messages me
        </label>
        <PrimaryButton type="submit">Save profile</PrimaryButton>
      </form>
    </>
  );
}
