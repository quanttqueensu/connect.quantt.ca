"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { assertPdf, PDF_CONTENT_TYPE } from "@/lib/files";
import { isPackagePdfPath } from "@/lib/storage-paths";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { denyRedirect } from "./deny";

const MAX_NAME = 120;
const MAX_URL = 500;
const MAX_COVER = 4000;

/**
 * Deletes package objects a failed createPackage/deletePackage already wrote.
 *
 * Scoped to the one package's own prefix on purpose: the member's other
 * packages and every `snapshots/...` copy live in the same bucket and must
 * never be touched. Uses the service role because storage has owner INSERT,
 * SELECT and UPDATE policies but no DELETE policy at all. Storage failures are
 * logged rather than thrown -- the caller is either already reporting a real
 * error or has already removed the row.
 */
async function removePackageObjects(memberId: string, packageId: string, paths: (string | null)[]) {
  const prefix = `${memberId}/packages/${packageId}/`;
  const own = paths.filter((p): p is string => isPackagePdfPath(p, memberId) && p.startsWith(prefix));
  if (!own.length) return;
  const { error } = await createAdminClient().storage.from("resumes").remove(own);
  if (error) {
    console.warn(`packages: orphaned objects under ${prefix}: ${error.message}`);
  }
}

export async function createPackage(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "member") throw new Error("Members only");
  const file = formData.get("resume") as File | null;
  if (!file || file.size === 0) denyRedirect("/packages", "package_file_invalid");
  try {
    await assertPdf(file, "Resume");
  } catch {
    denyRedirect("/packages", "package_file_invalid");
  }

  const name = String(formData.get("name") ?? "").trim();
  const linkedinUrl = httpUrlOrNull(String(formData.get("linkedin_url") ?? "").trim());
  const coverLetter = emptyToNull(formData.get("cover_letter"));
  if (!linkedinUrl) denyRedirect("/packages", "package_url_invalid");
  if (
    !name ||
    name.length > MAX_NAME ||
    linkedinUrl.length > MAX_URL ||
    (coverLetter !== null && coverLetter.length > MAX_COVER)
  ) {
    denyRedirect("/packages", "package_invalid");
  }

  const supabase = await createClient();
  const id = crypto.randomUUID();
  // Every object this invocation has written, so any later failure can undo
  // them instead of leaking PDFs that nothing will ever reference again.
  const written: string[] = [];
  const resumePath = `${profile.id}/packages/${id}/resume.pdf`;
  const { error: upErr } = await supabase.storage.from("resumes").upload(resumePath, file, {
    contentType: PDF_CONTENT_TYPE,
    upsert: true,
  });
  if (upErr) throw new Error(upErr.message);
  written.push(resumePath);

  let coverPath: string | null = null;
  const coverFile = formData.get("cover_pdf") as File | null;
  if (coverFile && coverFile.size > 0) {
    try {
      await assertPdf(coverFile, "Cover letter file");
    } catch {
      await removePackageObjects(profile.id, id, written);
      denyRedirect("/packages", "package_file_invalid");
    }
    coverPath = `${profile.id}/packages/${id}/cover.pdf`;
    const { error } = await supabase.storage.from("resumes").upload(coverPath, coverFile, {
      contentType: PDF_CONTENT_TYPE,
      upsert: true,
    });
    if (error) {
      await removePackageObjects(profile.id, id, written);
      throw new Error(error.message);
    }
    written.push(coverPath);
  }

  const { error } = await supabase.from("hiring_packages").insert({
    id,
    member_id: profile.id,
    name,
    linkedin_url: linkedinUrl,
    resume_path: resumePath,
    cover_letter: coverLetter,
    cover_letter_path: coverPath,
    is_default: formData.get("is_default") === "on",
  });
  if (error) {
    // Nothing references these uploads once the insert is gone. This must run
    // BEFORE denyRedirect, which unwinds by throwing NEXT_REDIRECT.
    await removePackageObjects(profile.id, id, written);
    // hiring_packages_one_default (0001_init.sql:49). A double-submit is the
    // user's own second click, not an exceptional state.
    if (error.code === "23505") {
      denyRedirect("/packages", "package_create_duplicate");
    }
    throw new Error(error.message);
  }
  revalidatePath("/packages");
}

export async function setDefaultPackage(formData: FormData) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hiring_packages")
    .update({ is_default: true })
    .eq("id", String(formData.get("id")))
    .eq("member_id", profile.id)
    .select("id");
  if (error) throw new Error(error.message);
  // Owner-scoped, matching the RLS policy exactly, so zero rows means the
  // package is gone rather than that it belongs to someone else.
  if (!data?.length) {
    denyRedirect("/packages", "package_default_missing");
  }
  revalidatePath("/packages");
}

export async function deletePackage(formData: FormData) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const id = String(formData.get("id"));
  // The deleted row's own paths come back with the delete, so the objects are
  // removed from the exact paths the row referenced -- and only ever from
  // inside this package's prefix, never a sibling package and never a
  // snapshot, which is an application's frozen copy and outlives the package.
  const { data, error } = await supabase
    .from("hiring_packages")
    .delete()
    .eq("id", id)
    .eq("member_id", profile.id)
    .select("id, resume_path, cover_letter_path");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    denyRedirect("/packages", "package_missing");
  }
  const row = data[0];
  await removePackageObjects(profile.id, id, [row.resume_path, row.cover_letter_path]);
  revalidatePath("/packages");
}

function emptyToNull(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function httpUrlOrNull(raw: string) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
