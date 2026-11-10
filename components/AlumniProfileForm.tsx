import { Field, PrimaryButton, TextArea, TextInput } from "@/components/Form";
import { saveAlumniProfile } from "@/lib/actions/alumni";

type Values = {
  full_name: string;
  firm: string | null;
  title: string | null;
  location: string | null;
  grad_year: number | null;
  program: string | null;
  linkedin_url: string | null;
  other_social_url: string | null;
  phone: string | null;
  bio: string | null;
};

/** The alum's profile, on /alumni/profile and the first-time /alumni/setup. LinkedIn, phone and About are required. */
export default function AlumniProfileForm({ a, setup = false }: { a: Values; setup?: boolean }) {
  return (
    <form action={saveAlumniProfile} className="grid max-w-xl gap-4">
      {setup && <input type="hidden" name="from" value="setup" />}
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
      <Field label="LinkedIn (required)">
        <TextInput name="linkedin_url" type="url" required maxLength={500} placeholder="https://" defaultValue={a.linkedin_url ?? ""} />
      </Field>
      <Field label="Other social or website (X, GitHub, personal site)">
        <TextInput name="other_social_url" type="url" maxLength={500} placeholder="https://" defaultValue={a.other_social_url ?? ""} />
      </Field>
      <Field label="Phone (required, only QUANTT execs see it)">
        <TextInput name="phone" type="tel" required maxLength={40} autoComplete="tel" defaultValue={a.phone ?? ""} />
      </Field>
      <Field label="About (required)">
        <TextArea name="bio" rows={4} required maxLength={1000} defaultValue={a.bio ?? ""} />
      </Field>
      <PrimaryButton type="submit">{setup ? "Save and continue" : "Save profile"}</PrimaryButton>
    </form>
  );
}
