"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import {
  assertPdf,
  PDF_CONTENT_TYPE,
  imageContentType,
  imageExtension,
  imageKind,
  MAX_IMAGE_BYTES,
} from "@/lib/files";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { denyRedirect } from "./deny";

export async function updateProfile(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "member") throw new Error("Members only");
  const supabase = await createClient();

  // profiles.full_name is `not null`; program/bio/... are unbounded text. The
  // form's maxlength/required attributes are client-only, so a forged POST
  // would otherwise store an empty name or an arbitrarily large blob that
  // every member then renders in the directory.
  const fullName = String(formData.get("full_name") ?? "").trim();
  const program = emptyToNull(formData.get("program"));
  const bio = emptyToNull(formData.get("bio"));
  const interests = emptyToNull(formData.get("interests"));
  const linkedinUrl = emptyToNull(formData.get("linkedin_url"));
  const githubUrl = emptyToNull(formData.get("github_url"));
  const websiteUrl = emptyToNull(formData.get("website_url"));
  // Parsed here rather than coerced to null on failure: a typo'd year must be
  // refused, not silently dropped from the member's profile.
  const rawGradYear = String(formData.get("grad_year") ?? "").trim();
  const gradYear = rawGradYear === "" ? null : Number(rawGradYear);

  if (
    !fullName ||
    fullName.length > MAX_NAME ||
    overLimit(program, MAX_SHORT) ||
    overLimit(bio, MAX_LONG) ||
    overLimit(interests, MAX_LONG) ||
    overLimit(linkedinUrl, MAX_URL) ||
    overLimit(githubUrl, MAX_URL) ||
    overLimit(websiteUrl, MAX_URL) ||
    (gradYear !== null &&
      (!Number.isInteger(gradYear) || gradYear < 1900 || gradYear > 2100))
  ) {
    denyRedirect("/profile", "profile_invalid");
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      program,
      grad_year: gradYear,
      bio,
      interests,
      linkedin_url: linkedinUrl,
      github_url: githubUrl,
      website_url: websiteUrl,
    })
    .eq("id", profile.id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    denyRedirect("/profile", "profile_save_failed");
  }
  revalidatePath("/profile");
  revalidatePath("/members");
  revalidatePath(`/members/${profile.id}`);
}

export async function addSection(formData: FormData) {
  const profile = await requireProfile();
  // sections_own_write is `for all` on member_id = auth.uid(), so without this
  // check a company_user could insert profile_sections rows that every member
  // then reads through sections_member_read.
  if (profile.role !== "member") throw new Error("Members only");
  const supabase = await createClient();

  const label = String(formData.get("label") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  // `Number("")` is 0 but `Number("abc")` is NaN, which serialises to null and
  // violates the `not null` on profile_sections.sort_order (0001_init.sql) —
  // a raw Postgres error where the member should see a validation message.
  const rawSortOrder = String(formData.get("sort_order") ?? "").trim();
  const sortOrder = rawSortOrder === "" ? 0 : Number(rawSortOrder);

  if (
    !label ||
    label.length > MAX_SECTION_LABEL ||
    !body ||
    body.length > MAX_SECTION_BODY ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > MAX_SORT_ORDER
  ) {
    denyRedirect("/profile", "profile_section_invalid");
  }

  // Sections are rendered unpaginated on /members/[id] for every member, so
  // an unbounded count is both a storage and a read-path problem.
  const { count, error: countErr } = await supabase
    .from("profile_sections")
    .select("id", { count: "exact", head: true })
    .eq("member_id", profile.id);
  if (countErr) throw new Error(countErr.message);
  if ((count ?? 0) >= MAX_SECTIONS_PER_MEMBER) {
    denyRedirect("/profile", "profile_section_limit");
  }

  const { error } = await supabase.from("profile_sections").insert({
    member_id: profile.id,
    label,
    body,
    sort_order: sortOrder,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/profile");
  revalidatePath("/members");
  revalidatePath(`/members/${profile.id}`);
}

export async function deleteSection(formData: FormData) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profile_sections")
    .delete()
    .eq("id", String(formData.get("id")))
    .eq("member_id", profile.id)
    .select("id");
  if (error) throw new Error(error.message);
  // Owner-scoped, matching the RLS policy exactly, so zero rows means the
  // section is already gone rather than that it belongs to someone else.
  if (!data?.length) {
    denyRedirect("/profile", "profile_section_missing");
  }
  revalidatePath("/profile");
  revalidatePath("/members");
  revalidatePath(`/members/${profile.id}`);
}

export async function uploadPhoto(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "member") throw new Error("Members only");
  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) denyRedirect("/profile", "profile_photo_invalid");
  if (file.size > MAX_IMAGE_BYTES) denyRedirect("/profile", "profile_photo_invalid");
  const kind = await imageKind(file);
  if (!kind) denyRedirect("/profile", "profile_photo_invalid");
  const supabase = await createClient();
  const ext = imageExtension(kind);
  const contentType = imageContentType(kind);
  const path = `${profile.id}/photo.${ext}`;
  const { error } = await supabase.storage.from("photos").upload(path, file, {
    upsert: true,
    contentType,
  });
  if (error) throw new Error(error.message);

  const { data: updated, error: updErr } = await supabase
    .from("profiles")
    .update({ photo_path: path })
    .eq("id", profile.id)
    .select("id");
  if (updErr) throw new Error(updErr.message);
  if (!updated?.length) {
    denyRedirect("/profile", "profile_photo_attach_failed");
  }
  revalidatePath("/profile");
  revalidatePath("/members");
  revalidatePath(`/members/${profile.id}`);
}

export async function setResumeBookOptIn(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "member") throw new Error("Members only");
  const supabase = await createClient();
  const optIn = formData.get("opt_in") === "true";

  const { data, error } = await supabase
    .from("profiles")
    .update({ resume_book_opt_in: optIn })
    .eq("id", profile.id)
    .select("id");

  if (error) throw new Error(error.message);
  // A silently dropped write here would tell a member their consent was
  // withdrawn while sponsors could still see them. Never report success.
  if (!data?.length) {
    denyRedirect(
      "/profile",
      optIn ? "resume_book_opt_in_failed" : "resume_book_opt_out_failed",
    );
  }
  revalidatePath("/profile");
  revalidatePath("/members");
  revalidatePath(`/members/${profile.id}`);
  revalidatePath("/company/resume-book");
  revalidatePath("/company/search");
}

/** Input caps. Nothing in the schema bounds these text columns. */
const MAX_NAME = 120;
const MAX_SHORT = 120;
const MAX_LONG = 2000;
const MAX_URL = 500;
const MAX_SECTION_LABEL = 80;
const MAX_SECTION_BODY = 4000;
const MAX_SECTIONS_PER_MEMBER = 20;
const MAX_SORT_ORDER = 9999;

function overLimit(v: string | null, max: number) {
  return v !== null && v.length > max;
}

function emptyToNull(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

/** Each form updates one document so simultaneous uploads cannot overwrite its sibling. */
export async function saveProfileDocument(kind: "resume" | "cover", formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "member") throw new Error("Members only");
  if (kind !== "resume" && kind !== "cover") throw new Error("Invalid document");
  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) {
    denyRedirect("/profile", "profile_document_invalid");
  }
  try {
    await assertPdf(file, kind === "resume" ? "Resume" : "Cover letter");
  } catch {
    denyRedirect("/profile", "profile_document_invalid");
  }
  const supabase = await createClient();
  // Keep the established owner-scoped storage format. Unique keys prevent an
  // upload from changing a file while an application is taking its snapshot.
  const path = `${profile.id}/packages/${crypto.randomUUID()}/${kind}.pdf`;
  const { error: uploadError } = await supabase.storage.from("resumes").upload(path, file, {
    contentType: PDF_CONTENT_TYPE,
  });
  if (uploadError) denyRedirect("/profile", "profile_document_save_failed");
  const column = kind === "resume" ? "resume_path" : "cover_letter_path";
  const { data, error } = await supabase.from("member_documents").upsert({
    member_id: profile.id,
    [column]: path,
    ...(kind === "cover" ? { cover_letter: null } : {}),
    updated_at: new Date().toISOString(),
  }, { onConflict: "member_id" }).select("member_id");
  if (error || !data?.length) {
    // Only the new, unreferenced object is safe to remove. Legacy packages and
    // in-flight applications may still reference earlier document versions.
    const { error: cleanupError } = await createAdminClient().storage.from("resumes").remove([path]);
    if (cleanupError) console.warn("profile: document upload cleanup failed", cleanupError.message);
    denyRedirect("/profile", "profile_document_save_failed");
  }
  revalidatePath("/profile");
  revalidatePath("/feed/[id]", "page");
  revalidatePath("/company/resume-book");
  revalidatePath("/company/search");
}

export async function removeProfileDocument(kind: "resume" | "cover") {
  const profile = await requireProfile();
  if (profile.role !== "member") throw new Error("Members only");
  if (kind !== "resume" && kind !== "cover") throw new Error("Invalid document");
  const supabase = await createClient();
  const column = kind === "resume" ? "resume_path" : "cover_letter_path";
  const { data, error } = await supabase.from("member_documents").update({
    [column]: null,
    ...(kind === "cover" ? { cover_letter: null } : {}),
    updated_at: new Date().toISOString(),
  }).eq("member_id", profile.id).select("member_id");
  if (error || !data?.length) denyRedirect("/profile", "profile_document_save_failed");
  revalidatePath("/profile");
  revalidatePath("/feed/[id]", "page");
  revalidatePath("/company/resume-book");
  revalidatePath("/company/search");
}
