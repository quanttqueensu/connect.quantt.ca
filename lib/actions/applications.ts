"use server";

import { assertSponsorWriteAllowed } from "@/lib/sponsor-mode";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { assertPdf, PDF_CONTENT_TYPE } from "@/lib/files";
import { notify } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isInAppJob, type Post } from "@/lib/types";
import { denyRedirect } from "./deny";

/**
 * Deletes snapshot objects a failed apply already created.
 *
 * Scoped to `snapshots/{appId}/` on purpose: the copies share a bucket with the
 * member's own `{member_id}/packages/...` source files, which must never be
 * touched. Storage failures here are logged, not thrown -- the caller is
 * already on its way to reporting the real error.
 */
async function removeSnapshots(
  admin: ReturnType<typeof createAdminClient>,
  appId: string,
  paths: string[],
) {
  const prefix = `snapshots/${appId}/`;
  const own = paths.filter((p) => p.startsWith(prefix));
  if (!own.length) return;
  const { error } = await admin.storage.from("resumes").remove(own);
  if (error) {
    console.warn(`applyToJob: orphaned snapshots under ${prefix}: ${error.message}`);
  }
}

/**
 * Service-role copy bypasses storage RLS. Path prefix is checked again, and
 * the source bytes are re-validated, so a member who overwrote their package
 * object via the Storage API after createPackage cannot snapshot HTML/EXE
 * into an application the recruiter will download.
 */
async function snapshotOwnedPdf(
  admin: ReturnType<typeof createAdminClient>,
  sourcePath: string,
  destPath: string,
  memberId: string,
  label: string,
) {
  if (!sourcePath.startsWith(`${memberId}/`)) {
    denyRedirect("/applications", "application_package_path_invalid");
  }
  const { data, error } = await admin.storage.from("resumes").download(sourcePath);
  if (error || !data) throw new Error(error?.message ?? `${label} could not be read`);
  const buf = await data.arrayBuffer();
  await assertPdf(new File([buf], "document.pdf"), label);
  // Upload the validated bytes with a pinned MIME. `copy` would preserve a
  // spoofed Content-Type the member wrote through the Storage API.
  const { error: upErr } = await admin.storage.from("resumes").upload(destPath, buf, {
    contentType: PDF_CONTENT_TYPE,
  });
  if (upErr) throw new Error(upErr.message);
}

const STAGES = ["submitted", "reviewing", "interviewing", "offer", "closed"] as const;
const MAX_COVER_LETTER = 4000;
const MAX_COMPANY_NAME = 200;
const MAX_NOTES = 2000;

export async function applyToJob(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "member") throw new Error("Members only");
  const supabase = await createClient();
  const postId = String(formData.get("post_id"));
  const packageId = String(formData.get("package_id"));

  const feedPath = `/feed/${encodeURIComponent(postId)}`;
  const { data: post, error: postErr } = await supabase
    .from("posts")
    .select("*")
    .eq("id", postId)
    .single();
  if (postErr || !post) denyRedirect("/feed", "application_not_open");
  if (!isInAppJob(post as Post)) denyRedirect(feedPath, "application_not_open");

  const { data: pack, error: packErr } = await supabase
    .from("hiring_packages")
    .select("*")
    .eq("id", packageId)
    .eq("member_id", profile.id)
    .single();
  if (packErr || !pack) denyRedirect(feedPath, "application_package_missing");
  if (
    typeof pack.resume_path !== "string" ||
    !pack.resume_path.startsWith(`${profile.id}/`) ||
    (pack.cover_letter_path &&
      (typeof pack.cover_letter_path !== "string" ||
        !pack.cover_letter_path.startsWith(`${profile.id}/`)))
  ) {
    // Service-role copy below bypasses storage RLS. The DB trigger in 0005 is
    // the real control; this check still has to exist so a deploy that ships
    // app code before the migration cannot copy another member's file.
    denyRedirect("/applications", "application_package_path_invalid");
  }

  const coverMode = String(formData.get("cover_mode") ?? "default");
  let coverLetter = pack.cover_letter as string | null;
  let coverPath: string | null = null;
  const appId = crypto.randomUUID();
  const admin = createAdminClient();
  // Every snapshot object this invocation has created, so a failure after the
  // copies can undo them instead of leaking orphans into the resumes bucket.
  const snapshots: string[] = [];

  if (coverMode === "none") {
    coverLetter = null;
  } else if (coverMode === "write") {
    coverLetter = String(formData.get("cover_letter") ?? "").trim() || null;
    if (coverLetter && coverLetter.length > MAX_COVER_LETTER) {
      denyRedirect("/applications", "application_cover_invalid");
    }
  } else if (coverMode === "upload") {
    const file = formData.get("cover_pdf") as File | null;
    if (!file || file.size === 0) denyRedirect(feedPath, "application_cover_invalid");
    try {
      await assertPdf(file, "Cover letter");
    } catch {
      denyRedirect(feedPath, "application_cover_invalid");
    }
    coverPath = `snapshots/${appId}/cover.pdf`;
    const { error } = await admin.storage.from("resumes").upload(coverPath, file, {
      contentType: PDF_CONTENT_TYPE,
    });
    if (error) {
      await removeSnapshots(admin, appId, snapshots);
      denyRedirect(feedPath, "application_cover_invalid");
    }
    snapshots.push(coverPath);
    coverLetter = null;
  }

  const snapResume = `snapshots/${appId}/resume.pdf`;
  try {
    await snapshotOwnedPdf(admin, pack.resume_path, snapResume, profile.id, "Resume");
  } catch (e) {
    await removeSnapshots(admin, appId, snapshots);
    if (isNextRedirect(e)) throw e;
    denyRedirect(feedPath, "application_package_path_invalid");
  }
  snapshots.push(snapResume);

  let snapCover = coverPath;
  if (coverMode === "default" && pack.cover_letter_path) {
    snapCover = `snapshots/${appId}/cover.pdf`;
    try {
      await snapshotOwnedPdf(
        admin,
        pack.cover_letter_path,
        snapCover,
        profile.id,
        "Cover letter file",
      );
    } catch (e) {
      await removeSnapshots(admin, appId, snapshots);
      if (isNextRedirect(e)) throw e;
      denyRedirect(feedPath, "application_package_path_invalid");
    }
    snapshots.push(snapCover);
  }

  const { error } = await supabase.from("applications").insert({
    id: appId,
    member_id: profile.id,
    kind: "in_app",
    post_id: postId,
    company_id: post.company_id,
    package_id: pack.id,
    package_name: pack.name,
    linkedin_url: pack.linkedin_url,
    resume_path: snapResume,
    cover_letter: coverLetter,
    cover_letter_path: snapCover,
    stage: "submitted",
  });
  if (error) {
    // Nothing references these copies once the row is gone, and no other code
    // ever collects them, so drop them here. This must run BEFORE denyRedirect,
    // which unwinds by throwing NEXT_REDIRECT.
    await removeSnapshots(admin, appId, snapshots);
    // applications_one_per_job (0001_init.sql:166). A double-submit is the
    // user's own second click, not an exceptional state.
    if (error.code === "23505") {
      denyRedirect("/applications", "application_duplicate");
    }
    if (/this firm is not accepting hub applications/i.test(error.message)) {
      denyRedirect(
        `/feed/${encodeURIComponent(postId)}`,
        "application_firm_not_accepting",
      );
    }
    denyRedirect(feedPath, "application_submit_failed");
  }
  await notify({
    type: "application",
    to: [],
    subject: "New application",
    body: `${profile.full_name} applied to ${post.title}`,
  });
  revalidatePath("/feed");
  revalidatePath(`/feed/${postId}`);
  revalidatePath("/applications");
}

export async function logOffPlatform(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "member") throw new Error("Members only");
  const supabase = await createClient();
  const postId = emptyToNull(formData.get("post_id"));

  // post_id arrives from the form, and applications_one_per_job is a unique
  // index on (member_id, post_id): logging against an arbitrary id would burn
  // the member's only slot for a real job they may still want to apply to in
  // the hub. Only accept an id that resolves to a post they can actually see.
  if (postId) {
    const { data: post, error: postErr } = await supabase
      .from("posts")
      .select("id, kind, external_url")
      .eq("id", postId)
      .maybeSingle();
    // Only external listings. Logging against an in-app job id would insert
    // kind=off_platform and, via applications_one_per_job, permanently block
    // a later hub apply to that same posting.
    if (
      postErr ||
      !post ||
      (post.kind !== "job" && post.kind !== "job_link") ||
      typeof post.external_url !== "string" ||
      !/^https?:\/\//i.test(post.external_url)
    ) {
      denyRedirect("/applications", "application_log_post_missing");
    }
  }

  const { error } = await supabase.from("applications").insert({
    member_id: profile.id,
    kind: "off_platform",
    post_id: postId,
    company_id: emptyToNull(formData.get("company_id")),
    company_name: String(formData.get("company_name") ?? "").trim().slice(0, MAX_COMPANY_NAME),
    stage: "submitted",
    notes: emptyToNull(formData.get("notes"))?.slice(0, MAX_NOTES) ?? null,
  });
  if (error) {
    if (error.code === "23505") {
      denyRedirect("/applications", "application_log_duplicate");
    }
    denyRedirect("/applications", "application_log_invalid");
  }
  // The post page is where the off-platform form lives, so it is the page that
  // must re-render to show the logged state and hide the form.
  if (postId) revalidatePath(`/feed/${postId}`);
  revalidatePath("/applications");
}

export async function updateApplicationStage(formData: FormData) {
  const profile = await requireProfile();
  await assertSponsorWriteAllowed(profile);
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const stage = String(formData.get("stage"));

  // One target for every refusal in this action, so an admin or recruiter is
  // never dumped on the member page they cannot use.
  const deniedPath = stageDeniedPath(profile.role, profile.is_admin, formData);

  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    denyRedirect(deniedPath, "stage_invalid");
  }

  const { data, error } = await supabase
    .from("applications")
    .update({ stage })
    .eq("id", id)
    .select("id");

  if (error) denyRedirect(deniedPath, "application_update_failed");
  if (!data?.length) {
    denyRedirect(deniedPath, "application_update_failed");
  }

  revalidatePath("/applications");
  revalidatePath("/company");
  revalidatePath("/admin/applications");
}

function emptyToNull(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function isNextRedirect(e: unknown) {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

/** Stage forms live on several pages; never honor an off-site or member URL. */
function stageDeniedPath(
  role: string,
  isAdmin: boolean,
  formData: FormData,
): string {
  const fallback =
    role === "company_user"
      ? "/company/applicants"
      : isAdmin
        ? "/admin/applications"
        : "/applications";
  const raw = String(formData.get("return_to") ?? "").trim().split("?")[0];
  if (
    role === "company_user" &&
    /^\/company\/posts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      raw,
    )
  ) {
    return raw;
  }
  return fallback;
}
