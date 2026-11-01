import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { Field, FileInput, PrimaryButton, QuietDangerButton, TextArea, TextInput } from "@/components/Form";
import {
  addSection,
  deleteSection,
  setResumeBookOptIn,
  updateProfile,
  uploadPhoto,
} from "@/lib/actions/profile";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { HiringPackage, ProfileSection } from "@/lib/types";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const sp = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const [{ data: sections }, { data: defaultPackage }] = await Promise.all([
    supabase
      .from("profile_sections")
      .select("*")
      .eq("member_id", profile.id)
      .order("sort_order"),
    supabase
      .from("hiring_packages")
      .select("id, name")
      .eq("member_id", profile.id)
      .eq("is_default", true)
      .maybeSingle<Pick<HiringPackage, "id" | "name">>(),
  ]);

  const photoUrl = profile.photo_path ? `/members/${profile.id}/photo` : null;
  const sectionRows = (sections as ProfileSection[] | null) ?? [];
  const nextSort =
    sectionRows.reduce((max, s) => Math.max(max, s.sort_order), -1) + 1;

  return (
    <>
      <PageHeader kicker="You" title="Profile">
        Visible to other members. Resumes live on hiring packages, not here.
      </PageHeader>
      <Notice message={sp.denied} />
      {photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt=""
          className="mb-6 h-24 w-24 object-cover"
        />
      )}
      <form action={uploadPhoto} encType="multipart/form-data" className="mb-8 flex flex-wrap items-end gap-3">
        <div className="min-w-0 max-w-full">
          <Field label="Photo">
            <FileInput name="photo" accept="image/jpeg,image/png,image/webp" />
          </Field>
        </div>
        <PrimaryButton type="submit">Upload photo</PrimaryButton>
      </form>
      <form action={updateProfile} className="grid max-w-xl gap-4">
        <Field label="Name">
          <TextInput name="full_name" defaultValue={profile.full_name} required maxLength={120} />
        </Field>
        <Field label="Program">
          <TextInput name="program" defaultValue={profile.program ?? ""} maxLength={120} />
        </Field>
        <Field label="Grad year">
          <TextInput
            name="grad_year"
            type="number"
            min={1900}
            max={2100}
            defaultValue={profile.grad_year ?? ""}
          />
        </Field>
        <Field label="Bio">
          <TextArea name="bio" rows={4} defaultValue={profile.bio ?? ""} maxLength={2000} />
        </Field>
        <Field label="Interests">
          <TextInput name="interests" defaultValue={profile.interests ?? ""} maxLength={2000} />
        </Field>
        <Field label="LinkedIn">
          <TextInput name="linkedin_url" defaultValue={profile.linkedin_url ?? ""} maxLength={500} />
        </Field>
        <Field label="GitHub">
          <TextInput name="github_url" defaultValue={profile.github_url ?? ""} maxLength={500} />
        </Field>
        <Field label="Website">
          <TextInput name="website_url" defaultValue={profile.website_url ?? ""} maxLength={500} />
        </Field>
        <PrimaryButton type="submit" className="justify-self-start">Save profile</PrimaryButton>
      </form>

      <h2 className="mt-14 font-heading text-lg font-bold text-white">Custom sections</h2>
      <ul className="mt-4 space-y-4">
        {sectionRows.map((s) => (
          <li key={s.id} className="border-t border-white/10 pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <p className="text-sm font-medium text-white">{s.label}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-white/60">{s.body}</p>
              </div>
              <form action={deleteSection} className="shrink-0">
                <input type="hidden" name="id" value={s.id} />
                <QuietDangerButton type="submit">Remove section</QuietDangerButton>
              </form>
            </div>
          </li>
        ))}
      </ul>
      <form action={addSection} className="mt-6 max-w-xl space-y-3">
        <input type="hidden" name="sort_order" value={nextSort} />
        <Field label="Section title">
          <TextInput name="label" required placeholder="Coursework" maxLength={80} />
        </Field>
        <Field label="Content">
          <TextArea name="body" rows={3} required maxLength={4000} />
        </Field>
        <PrimaryButton type="submit">Add section</PrimaryButton>
      </form>

      <section className="mt-10 border-t border-white/10 pt-8">
        <h2 className="font-heading text-lg font-bold text-white">Resume book</h2>
        <p className="mt-2 text-sm text-white/60">
          QUANTT sponsors can browse an opt-in resume book. If you opt
          in, sponsor firms can see your name, program, graduation
          year, and the resume on your default hiring package. The resume book
          does not include your applications or messages. You can withdraw at
          any time.
        </p>
        {defaultPackage ? (
          <p className="mt-2 text-sm text-white/60">
            Your default package is <strong className="text-white">{defaultPackage.name}</strong>.
            That is the resume sponsors would see.{" "}
            <Link href="/packages" className="text-blue-light hover:text-white">
              Change it
            </Link>
          </p>
        ) : (
          <p className="mt-2 text-sm text-white/60">
            You have no default hiring package, so there is no resume to show. Opting in exposes
            your name, program, and graduation year only, until you{" "}
            <Link href="/packages" className="text-blue-light hover:text-white">
              create a package
            </Link>{" "}
            and set it as your default.
          </p>
        )}
        <p className="mt-2 text-sm text-white/80">
          You are currently{" "}
          <strong>{profile.resume_book_opt_in ? "opted in" : "opted out"}</strong>.
        </p>
        <form action={setResumeBookOptIn} className="mt-4">
          <input
            type="hidden"
            name="opt_in"
            value={profile.resume_book_opt_in ? "false" : "true"}
          />
          {profile.resume_book_opt_in ? (
            <ConfirmSubmitButton
              variant="danger"
              confirmMessage="Withdraw from the resume book? Sponsors will no longer be able to see your profile there."
            >
              Withdraw from the resume book
            </ConfirmSubmitButton>
          ) : (
            <PrimaryButton type="submit">Opt in to resume book</PrimaryButton>
          )}
        </form>
      </section>
    </>
  );
}
