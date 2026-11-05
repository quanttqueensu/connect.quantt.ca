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
  saveProfileDocument,
  removeProfileDocument,
  setDirectorySyncSetting,
} from "@/lib/actions/profile";
import { getDirectorySync, syncDirectoryFiles } from "@/lib/directory-files";
import { HeadshotUpload } from "@/components/HeadshotUpload";
import { syncGradYear } from "@/lib/graduation-sync";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { MemberDocuments, ProfileSection } from "@/lib/types";
import { redirect } from "next/navigation";
import NotificationSettings from "@/components/NotificationSettings";
import { hubEnv } from "@/lib/hub/env";
import { DEFAULT_PREFS, getPrefs } from "@/lib/notifications";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; notifications?: string }>;
}) {
  const sp = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { DB, FILES } = await hubEnv();
  const synced = profile.role === "member" ? await getDirectorySync(DB, profile.id).catch(() => true) : false;
  if (synced) {
    // Pick up a headshot or resume changed on auth.quantt.ca since the last check, before showing them.
    const { env } = await getCloudflareContext({ async: true });
    await syncDirectoryFiles(DB, FILES, env.AUTH, profile.id, profile.email).catch((e) =>
      console.warn("directory files: sync failed", e instanceof Error ? e.message : e),
    );
  }
  // Grad year and personal email are shared with auth.quantt.ca (lib/graduation-sync.ts).
  let personal: string | null = null;
  if (profile.role === "member") {
    const { env } = await getCloudflareContext({ async: true });
    const g = await syncGradYear(DB, env.AUTH, profile.id, profile.email, profile.grad_year).catch((e) => {
      console.warn("graduation sync failed", e instanceof Error ? e.message : e);
      return null;
    });
    if (g?.gradYear) profile.grad_year = g.gradYear;
    personal = g?.personal ?? null;
  }
  const supabase = await createClient();
  const [{ data: sections }, { data: documents, error: documentsError }] = await Promise.all([
    supabase
      .from("profile_sections")
      .select("*")
      .eq("member_id", profile.id)
      .order("sort_order"),
    supabase
      .from("member_documents")
      .select("*")
      .eq("member_id", profile.id)
      .maybeSingle<MemberDocuments>(),
  ]);

  // Re-read the photo pointer: the sync above may have just changed it.
  const photoPath = synced
    ? ((await DB.prepare(`SELECT photo_path FROM profiles WHERE id = ?`).bind(profile.id).first<{ photo_path: string | null }>())?.photo_path ?? null)
    : profile.photo_path;
  const prefs = await getPrefs(DB, profile.id).catch(() => ({ ...DEFAULT_PREFS }));
  const photoUrl = photoPath ? `/members/${profile.id}/photo?v=${encodeURIComponent(photoPath)}` : null;
  const sectionRows = (sections as ProfileSection[] | null) ?? [];
  const nextSort =
    sectionRows.reduce((max, s) => Math.max(max, s.sort_order), -1) + 1;

  return (
    <>
      <PageHeader title="Profile">
        Manage your member profile and the documents you use to apply.
      </PageHeader>
      <Notice message={sp.denied} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-12">
        <div className="min-w-0">
          <form action={updateProfile} className="grid gap-3 md:grid-cols-2">
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
            {profile.role === "member" && (
              <Field label="Personal email (for after you graduate)">
                <TextInput name="personal_email" type="email" defaultValue={personal ?? ""} maxLength={200} placeholder="you@gmail.com" />
                <span className="mt-1 block text-xs text-muted">
                  On May 1 of your grad year you become a QUANTT alum, and your profile, headshot and resume move to an alumni
                  account at this address. Synced with auth.quantt.ca.
                </span>
              </Field>
            )}
            <div className="md:col-span-2">
            <Field label="Bio">
              <TextArea name="bio" rows={3} defaultValue={profile.bio ?? ""} maxLength={2000} />
            </Field>
            </div>
            <div className="md:col-span-2">
            <Field label="Interests">
              <TextInput name="interests" defaultValue={profile.interests ?? ""} maxLength={2000} />
            </Field>
            </div>
            <Field label="LinkedIn">
              <TextInput name="linkedin_url" defaultValue={profile.linkedin_url ?? ""} maxLength={500} />
            </Field>
            <Field label="GitHub">
              <TextInput name="github_url" defaultValue={profile.github_url ?? ""} maxLength={500} />
            </Field>
            <Field label="Website">
              <TextInput name="website_url" defaultValue={profile.website_url ?? ""} maxLength={500} />
            </Field>
            <PrimaryButton type="submit" className="justify-self-start md:col-span-2">Save profile</PrimaryButton>
          </form>
          <h2 className="mt-8 border-t border-line pt-6 font-heading text-lg font-bold text-ink">Custom sections</h2>
          <ul className="mt-3 space-y-3">
            {sectionRows.map((s) => (
              <li key={s.id} className="border-t border-line pt-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <p className="text-sm font-medium text-ink">{s.label}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-copy">{s.body}</p>
                  </div>
                  <form action={deleteSection} className="shrink-0">
                    <input type="hidden" name="id" value={s.id} />
                    <QuietDangerButton type="submit">Remove section</QuietDangerButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
          <details className="group mt-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-primary">
              <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
              Add a section
            </summary>
            <form action={addSection} className="mt-3 space-y-3">
              <input type="hidden" name="sort_order" value={nextSort} />
              <Field label="Section title">
                <TextInput name="label" required placeholder="Coursework" maxLength={80} />
              </Field>
              <Field label="Content">
                <TextArea name="body" rows={3} required maxLength={4000} />
              </Field>
              <PrimaryButton type="submit">Add section</PrimaryButton>
            </form>
          </details>
        </div>
        <aside className="min-w-0">
          <div className="flex items-start gap-4">
              {photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl}
                  alt=""
                  className="h-16 w-16 shrink-0 object-cover"
                />
              )}
              <section id="sync" className="min-w-0 scroll-mt-40">
                <h2 className="text-sm font-medium text-ink">Photo and resume</h2>
                {synced ? (
                  <p className="mt-1 text-sm text-copy">
                    Kept in sync with your QUANTT profile on{" "}
                    <a href="https://auth.quantt.ca" className="text-primary hover:text-ink">auth.quantt.ca</a>. Upload here or there; either one updates both.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-copy">
                    Not synced. The photo and resume you upload here are used on Connect only.
                  </p>
                )}
                <form action={setDirectorySyncSetting} className="mt-3">
                  <input type="hidden" name="enabled" value={synced ? "false" : "true"} />
                  {synced ? (
                    <QuietDangerButton type="submit">Turn off Keep in sync</QuietDangerButton>
                  ) : (
                    <ConfirmSubmitButton
                      variant="primary"
                      confirmMessage="Use your photo and resume from auth.quantt.ca? They will replace the ones on Connect now and whenever you change them there."
                    >
                      Keep in sync with auth.quantt.ca
                    </ConfirmSubmitButton>
                  )}
                </form>
              </section>
          </div>
          <HeadshotUpload action={uploadPhoto} />
          <section id="documents" className="mt-6 scroll-mt-40 border-t border-line pt-5">
            <h2 className="font-heading text-lg font-bold text-ink">Application documents</h2>
            <p className="mt-2 text-sm text-copy">
              Used automatically when you apply through Connect; you can swap in a different file per application.
              PDF under 5 MB. Private, except your resume if you opt in to the resume book.
            </p>
            {documentsError ? (
              <p role="alert" className="mt-4 text-sm text-copy">Your documents could not be loaded. Try again.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {(["resume", "cover"] as const).map((kind) => {
                  const label = kind === "resume" ? "Resume" : "Cover letter";
                  const path = kind === "resume" ? documents?.resume_path : documents?.cover_letter_path;
                  const hasText = kind === "cover" && documents?.cover_letter;
                  return (
                    <div key={kind}>
                      <h3 className="text-sm font-medium text-ink">{label}</h3>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-copy">
                        {path ? (
                          <a href={`/profile/documents/${kind}`} className="text-primary hover:text-ink">View saved {label.toLowerCase()}</a>
                        ) : <p>{hasText ? "Saved cover letter" : `No ${label.toLowerCase()} uploaded.`}</p>}
                        {(path || hasText) && (
                          <form action={removeProfileDocument.bind(null, kind)}>
                            <QuietDangerButton type="submit">Remove {label.toLowerCase()}</QuietDangerButton>
                          </form>
                        )}
                      </div>
                      {hasText && !path ? <p className="mt-2 whitespace-pre-wrap text-sm text-copy">{documents?.cover_letter}</p> : null}
                      {synced && kind === "resume" && <p className="mt-2 text-sm text-copy">Synced with auth.quantt.ca.</p>}
                      <form action={saveProfileDocument.bind(null, kind)} className="mt-3 flex flex-wrap items-end gap-3">
                        <Field label={`${path || hasText ? "Replace" : "Upload"} ${label.toLowerCase()}`}>
                          <FileInput name="document" accept="application/pdf" required />
                        </Field>
                        <PrimaryButton type="submit">Save {label.toLowerCase()}</PrimaryButton>
                      </form>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <section className="mt-6 border-t border-line pt-5">
            <h2 className="font-heading text-lg font-bold text-ink">Resume book</h2>
            <p className="mt-2 text-sm text-copy">
              Sponsors see your name, program, grad year and saved resume, never your applications or
              messages. Withdraw any time.
            </p>
            {!documents?.resume_path && !documentsError && (
              <p className="mt-2 text-sm text-copy">Upload a resume above to appear in the resume book.</p>
            )}
            <p className="mt-2 text-sm text-ink">
              You are currently{" "}
              <strong>{profile.resume_book_opt_in ? "opted in" : "opted out"}</strong>.
            </p>
            <form action={setResumeBookOptIn} className="mt-3">
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
          <NotificationSettings prefs={prefs} role="member" saved={sp.notifications === "saved"} />
        </aside>
      </div>



    </>
  );
}
