import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { Field, FileInput, PrimaryButton, QuietButton, TextArea, TextInput } from "@/components/Form";
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
import { isWatchingFeedback } from "@/lib/sponsor-feedback";

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
  const sponsorFeedback = profile.is_admin ? await isWatchingFeedback(DB, profile.id).catch(() => false) : undefined;
  const photoUrl = photoPath ? `/members/${profile.id}/photo?v=${encodeURIComponent(photoPath)}` : null;
  const sectionRows = (sections as ProfileSection[] | null) ?? [];
  const nextSort =
    sectionRows.reduce((max, s) => Math.max(max, s.sort_order), -1) + 1;

  return (
    <>
      <PageHeader title="Profile" />
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
                <span className="mt-1 block text-xs text-muted">Your alumni account after May 1 of your grad year.</span>
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
          <h2 className="mt-8 border-t border-line pt-5 text-sm font-semibold text-ink">Custom sections</h2>
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
                    <QuietButton type="submit">Remove</QuietButton>
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
              <QuietButton type="submit">Add section</QuietButton>
            </form>
          </details>
        </div>
        <aside className="min-w-0 space-y-5 text-sm">
          <section id="sync" className="scroll-mt-40">
            <h2 className="font-semibold text-ink">Photo</h2>
            <div className="mt-2 flex items-center gap-3">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="" className="h-12 w-12 shrink-0 object-cover" />
              ) : (
                <div aria-hidden="true" className="h-12 w-12 shrink-0 bg-surface" />
              )}
              <div className="min-w-0 flex-1">
                <HeadshotUpload action={uploadPhoto} compact />
              </div>
            </div>
            <form action={setDirectorySyncSetting} className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-copy">
              <input type="hidden" name="enabled" value={synced ? "false" : "true"} />
              <span>
                {synced ? (
                  <>
                    Photo and resume synced with{" "}
                    <a href="https://auth.quantt.ca" className="text-primary hover:text-ink">auth.quantt.ca</a>.
                  </>
                ) : (
                  "Photo and resume used on Connect only."
                )}
              </span>
              {synced ? (
                <button type="submit" className="text-copy underline hover:text-ink">Turn off</button>
              ) : (
                <ConfirmSubmitButton
                  variant="nav"
                  confirmMessage="Use your photo and resume from auth.quantt.ca? They will replace the ones on Connect now and whenever you change them there."
                >
                  Keep in sync
                </ConfirmSubmitButton>
              )}
            </form>
          </section>

          <section id="documents" className="scroll-mt-40 border-t border-line pt-4">
            <h2 className="font-semibold text-ink">Documents</h2>
            <p className="mt-1 text-xs text-copy">PDF under 5 MB. Used when you apply; private unless in the resume book.</p>
            {documentsError ? (
              <p role="alert" className="mt-3 text-copy">Your documents could not be loaded. Try again.</p>
            ) : (
              <div className="mt-3 space-y-4">
                {(["resume", "cover"] as const).map((kind) => {
                  const label = kind === "resume" ? "Resume" : "Cover letter";
                  const path = kind === "resume" ? documents?.resume_path : documents?.cover_letter_path;
                  const hasText = kind === "cover" && documents?.cover_letter;
                  return (
                    <div key={kind}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-ink">{label}</span>
                        {path ? (
                          <a href={`/profile/documents/${kind}`} className="text-primary hover:text-ink">View</a>
                        ) : (
                          <span className="text-copy">{hasText ? "Saved as text" : "None"}</span>
                        )}
                        {(path || hasText) && (
                          <form action={removeProfileDocument.bind(null, kind)}>
                            <button type="submit" className="text-copy underline hover:text-ink">Remove</button>
                          </form>
                        )}
                      </div>
                      {hasText && !path ? <p className="mt-1 whitespace-pre-wrap text-copy">{documents?.cover_letter}</p> : null}
                      <form action={saveProfileDocument.bind(null, kind)} className="mt-2 flex flex-wrap items-center gap-2">
                        <FileInput
                          name="document"
                          accept="application/pdf"
                          required
                          aria-label={`${path || hasText ? "Replace" : "Upload"} ${label.toLowerCase()}`}
                          className="min-w-0 flex-1"
                        />
                        <QuietButton type="submit">Upload</QuietButton>
                      </form>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="border-t border-line pt-4">
            <h2 className="font-semibold text-ink">Resume book</h2>
            <p className="mt-1 text-xs text-copy">
              On by default; opt out any time. Sponsors and alumni see your name, program, grad year, headshot and resume, never your applications or messages.
            </p>
            <form action={setResumeBookOptIn} className="mt-2 flex flex-wrap items-center gap-3">
              <input type="hidden" name="opt_in" value={profile.resume_book_opt_in ? "false" : "true"} />
              <span className="text-ink">
                {profile.resume_book_opt_in ? "You're in" : "You're not in"}
                {!documents?.resume_path && !documentsError ? " (upload a resume to appear)" : ""}
              </span>
              {profile.resume_book_opt_in ? (
                <ConfirmSubmitButton
                  variant="quiet"
                  confirmMessage="Withdraw from the resume book? Sponsors will no longer be able to see your profile there."
                >
                  Withdraw
                </ConfirmSubmitButton>
              ) : (
                <QuietButton type="submit">Opt in</QuietButton>
              )}
            </form>
          </section>

          <NotificationSettings
            prefs={prefs}
            role="member"
            saved={sp.notifications === "saved"}
            sponsorFeedback={sponsorFeedback}
            lean
          />
        </aside>
      </div>



    </>
  );
}
