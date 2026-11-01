"use server";

import { assertSponsorWriteAllowed } from "@/lib/sponsor-mode";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, capValue, loadMyCompanyTier } from "@/lib/tiers";
import type { PostKind, RoleType, TermSeason } from "@/lib/types";
import { denyRedirect } from "./deny";

const COMPANY_POST_KINDS: PostKind[] = ["job", "job_link", "event", "announcement"];
const ADMIN_POST_KINDS: PostKind[] = ["job", "job_link", "event", "announcement", "connection"];
const ROLE_TYPES: RoleType[] = ["full_time", "internship", "coop"];
const TERM_SEASONS: TermSeason[] = ["fall", "winter", "summer"];

export async function createPost(formData: FormData) {
  const profile = await requireProfile();
  await assertSponsorWriteAllowed(profile);
  const supabase = await createClient();
  const kind = String(formData.get("kind")) as PostKind;
  const postFormPath =
    profile.role === "company_user" ? "/company/posts/new" : "/admin/posts/new";

  let companyId: string | null = emptyToNull(formData.get("company_id"));
  if (profile.role === "company_user") {
    const { data } = await supabase
      .from("company_users")
      .select("company_id")
      .eq("profile_id", profile.id)
      .single();
    companyId = data?.company_id ?? null;
    if (!companyId) throw new Error("No company on this account");
    if (!COMPANY_POST_KINDS.includes(kind)) {
      denyRedirect(postFormPath, "post_kind_forbidden");
    }
  } else if (!profile.is_admin) {
    throw new Error("Only companies and admins can post");
  } else if (!ADMIN_POST_KINDS.includes(kind)) {
    denyRedirect(postFormPath, "post_invalid");
  }

  // Validated only after authorization: a plain member forging this call must
  // be told they cannot post at all, not redirected to a form they cannot open.
  const parsedUrl = httpUrlOrNull(formData.get("external_url"));
  if (parsedUrl === INVALID_URL) {
    denyRedirect(postFormPath, "post_url_invalid");
  }
  const externalUrl = parsedUrl;
  if (externalUrl && externalUrl.length > MAX_POST_URL) {
    denyRedirect(postFormPath, "post_url_invalid");
  }

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const location = emptyToNull(formData.get("location"));
  if (
    !title ||
    title.length > MAX_POST_TITLE ||
    !body ||
    body.length > MAX_POST_BODY ||
    overLimit(location, MAX_POST_LOCATION)
  ) {
    denyRedirect(postFormPath, "post_invalid");
  }

  const roleType = parseEnum(formData.get("role_type"), ROLE_TYPES);
  const termSeason = parseEnum(formData.get("term_season"), TERM_SEASONS);
  const termYear = parseTermYear(formData.get("term_year"));

  const isInApp = kind === "job" && !externalUrl;
  if (isInApp && (!roleType || !termSeason || !termYear)) {
    denyRedirect(postFormPath, "post_term_fields_required");
  }

  // job_link_has_url (0001_init.sql:133) requires external_url on a job_link.
  // Without this guard a blank URL reaches the database and crashes.
  if (kind === "job_link" && !externalUrl) {
    denyRedirect(postFormPath, "post_job_link_url_required");
  }

  const startsAt = kind === "event" ? emptyToNull(formData.get("starts_at")) : null;
  if (startsAt && Number.isNaN(Date.parse(startsAt))) {
    denyRedirect(postFormPath, "post_invalid");
  }

  if (profile.role === "company_user" && companyId) {
    const { access } = await loadMyCompanyTier(companyId);
    if (kind === "event" && !can(access, "post_event")) {
      denyRedirect(postFormPath, "post_kind_forbidden");
    }
    if (isInApp) {
      if (!can(access, "post_in_app_job")) {
        denyRedirect(postFormPath, "post_kind_forbidden");
      }
      const quota = capValue(access, "post_in_app_job");
      if (quota != null) {
        const { count } = await supabase
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("kind", "job")
          .is("external_url", null)
          .eq("status", "open");
        if ((count ?? 0) >= quota) {
          denyRedirect(postFormPath, "post_quota_reached");
        }
      }
    }
  }

  const { error } = await supabase.from("posts").insert({
    author_id: profile.id,
    company_id: companyId,
    kind,
    title,
    body,
    location,
    starts_at: startsAt,
    published: true,
    status: "open",
    role_type: isInApp ? roleType : null,
    term_season: isInApp ? termSeason : null,
    term_year: isInApp ? termYear : null,
    external_url: kind === "job_link" || kind === "job" ? externalUrl : null,
  });
  if (error) {
    // Pre-checks already mapped capability/quota. A remaining in-app insert
    // failure is almost always a quota race; anything else is a save failure.
    // Never surface Postgres/RLS text in the hub chrome.
    if (profile.role === "company_user" && isInApp) {
      denyRedirect(postFormPath, "post_quota_reached");
    }
    denyRedirect(postFormPath, "post_save_failed");
  }
  revalidatePath("/feed");
  revalidatePath("/company");
  revalidatePath("/admin");
  redirect(profile.role === "company_user" ? "/company" : "/admin/posts");
}

export async function addComment(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "member") throw new Error("Members only");
  const supabase = await createClient();
  const postId = String(formData.get("post_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  // post_comments.body is `not null` with no length check, and the form's
  // `required` attribute is client-only: a forged POST would otherwise insert
  // a blank comment, or an arbitrarily large one that every member renders.
  if (!body || body.length > MAX_COMMENT_BODY) {
    // Encoded: post_id is raw form input, and it lands in a redirect path.
    denyRedirect(`/feed/${encodeURIComponent(postId)}`, "comment_invalid");
  }

  const { error } = await supabase.from("post_comments").insert({
    post_id: postId,
    author_id: profile.id,
    body,
  });
  if (error) denyRedirect(`/feed/${encodeURIComponent(postId)}`, "comment_invalid");
  revalidatePath(`/feed/${postId}`);
}

export async function closePost(formData: FormData) {
  const profile = await requireProfile();
  await assertSponsorWriteAllowed(profile);
  const supabase = await createClient();
  const id = String(formData.get("id"));

  // Company UPDATE on posts is capability-gated and would refuse a close after
  // a downgrade. close_own_post is the supported path for firms and admins.
  const { data, error } = await supabase.rpc("close_own_post", { p_post: id });
  if (error) throw new Error(error.message);
  if (!data) {
    if (profile.role === "company_user") {
      denyRedirect("/company", "post_close_not_yours");
    }
    if (profile.is_admin) {
      denyRedirect("/admin/posts", "post_close_missing");
    }
    denyRedirect("/feed", "post_close_forbidden");
  }

  revalidatePath("/company");
  revalidatePath("/admin/posts");
  revalidatePath("/feed");
}

const MAX_COMMENT_BODY = 4000;
const MAX_POST_TITLE = 200;
const MAX_POST_BODY = 8000;
const MAX_POST_LOCATION = 120;
const MAX_POST_URL = 500;

function overLimit(v: string | null, max: number) {
  return v !== null && v.length > max;
}

function parseEnum<T extends string>(v: FormDataEntryValue | null, allowed: readonly T[]): T | null {
  const s = emptyToNull(v);
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

function parseTermYear(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  if (!/^\d{4}$/.test(s)) return null;
  const n = Number(s);
  if (n < 2000 || n > 2100) return null;
  return n;
}

function emptyToNull(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

/**
 * Sentinel for a URL the user typed that we will not accept. The browser's
 * type="url" check is looser than the protocol check below (it lets ftp://
 * through), so a bad value is a correctable user mistake, not an exceptional
 * state — the caller surfaces it with denyRedirect rather than crashing.
 */
const INVALID_URL = Symbol("invalid-url");

function httpUrlOrNull(
  v: FormDataEntryValue | null,
): string | null | typeof INVALID_URL {
  const s = emptyToNull(v);
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return INVALID_URL;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return INVALID_URL;
  return u.toString();
}
