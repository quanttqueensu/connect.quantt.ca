"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createHmac } from "node:crypto";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { cancelPendingInvite, removeCompanyContact } from "@/lib/cf-auth/accounts";
import { sendInviteEmail, type InviteAudience } from "@/lib/cf-auth/email";
import { hubEnv } from "@/lib/hub/env";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { denyRedirect } from "./deny";

/**
 * The address already has a Connect account.
 *
 * This is a refusal, never a fallback. An invite must never touch an account
 * that already exists (its role, firm or admin flag). Callers report it and
 * undo whatever they staged; nothing about the existing user is modified.
 */
class AlreadyRegisteredError extends Error {
  constructor() {
    super("Email already registered");
  }
}

/**
 * True for Next's redirect()/notFound() control-flow throws, which must be
 * rethrown rather than reported as an invite failure.
 */
function isControlFlowError(e: unknown) {
  const digest = (e as { digest?: unknown })?.digest;
  return typeof digest === "string" && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

/** "unsent": the invite is saved and works, but the notice email didn't go out. */
type InviteResult = { via: "email" } | { via: "unsent" };

function isUniqueViolation(message: string, code?: string) {
  return code === "23505" || /duplicate|unique/i.test(message);
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

/**
 * Tell an invited person how to sign in. There's no account to create: their
 * profile is made from the pending invites row the first time they sign in:
 * members through auth.quantt.ca, sponsors with an emailed code
 * (lib/cf-auth/accounts.ts).
 */
async function sendAuthInvite(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
  name: string,
  audience: InviteAudience,
): Promise<InviteResult> {
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) throw new AlreadyRegisteredError();
  try {
    await sendInviteEmail(await hubEnv(), email, name, `${siteUrl()}/login`, audience);
    return { via: "email" };
  } catch (e) {
    console.error("invite email not sent", e);
    return { via: "unsent" };
  }
}

/**
 * Not exported: this file is `"use server"`, so every export is a callable
 * endpoint. A public wrapper must never put driver text (unique-index names,
 * whether an email already requested access) on the wire.
 */
async function insertJoinRequest(formData: FormData) {
  const companyName = String(formData.get("company_name") ?? "").trim();
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim().toLowerCase();
  const website = httpUrlOrNull(formData.get("website"));
  const note = emptyToNull(formData.get("note"));

  if (
    !companyName ||
    companyName.length > MAX_COMPANY_NAME ||
    !contactName ||
    contactName.length > MAX_CONTACT_NAME ||
    !isEmail(contactEmail) ||
    website === INVALID_URL ||
    overLimit(note, MAX_NOTE)
  ) {
    throw new Error("invalid join request");
  }

  // Cloudflare supplies this header at the edge. No IP header is trusted as
  // the sole control: the RPC also enforces a global budget and queue ceiling.
  // Other hosting environments share the conservative "unknown" bucket.
  const ip = (await headers()).get("cf-connecting-ip")?.slice(0, 64) || "unknown";
  const key = (await hubEnv()).FILES_SIGNING_KEY;
  if (!key) throw new Error("Missing server configuration");
  const source = createHmac("sha256", key).update(`join:${ip}`).digest("hex");
  const { error } = await createAdminClient().rpc("submit_join_request", {
    p_company_name: companyName,
    p_website: website,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
    p_note: note,
    p_source: source,
  });
  if (error) throw new Error(error.message);
}

export async function submitCompanyRequest(formData: FormData) {
  try {
    await insertJoinRequest(formData);
  } catch (e) {
    if (isControlFlowError(e)) throw e;
    // Only invalid input or infrastructure failure reaches this branch. The
    // RPC gives new, duplicate and throttled valid submissions the same result.
    redirect("/join?error=join_request_failed");
  }
  redirect("/join?sent=1");
}

async function finishInvite(result: InviteResult): Promise<never> {
  revalidatePath("/admin/invite");
  revalidatePath("/admin/people");
  revalidatePath("/admin/companies");
  redirect(result.via === "unsent" ? "/admin/invite?unsent=1" : "/admin/invite?sent=1");
}

export async function invitePerson(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  let result: InviteResult = { via: "email" };
  // The invites row is what lets them sign in, so it is inserted first and
  // removed again if the address turns out to have an account already. Only a
  // row this call actually inserted is removed; a pre-existing pending invite
  // (unique violation, id stays null) is left alone.
  let insertedInviteId: string | null = null;
  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    const profile = await requireProfile();
    if (!profile.is_admin) denyRedirect("/admin/invite", "invite_failed");
    const kind = String(formData.get("kind") ?? "member");
    const fullName = String(formData.get("full_name") ?? "").trim();
    if (!isEmail(email) || !fullName) denyRedirect("/admin/invite", "invite_name_email_required");
    if (kind !== "company" && kind !== "member" && kind !== "admin") {
      denyRedirect("/admin/invite", "invite_kind_invalid");
    }

    admin = createAdminClient();

    if (kind === "company") {
      let companyId = emptyToNull(formData.get("company_id"));
      const newName = String(formData.get("new_company_name") ?? "").trim();
      if (!companyId && newName) {
        const tierId = emptyToNull(formData.get("sponsor_tier_id"));
        if (!tierId) denyRedirect("/admin/invite", "invite_tier_required");
        const { data, error } = await admin
          .from("companies")
          .insert({
            name: newName,
            slug: slugify(newName) + "-" + Math.random().toString(36).slice(2, 6),
            sponsor_tier_id: tierId,
            status: "active",
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        companyId = data.id;
      }
      if (!companyId) {
        denyRedirect("/admin/invite", "invite_company_required");
      }
      const { data: row, error: invErr } = await admin
        .from("invites")
        .insert({
          email,
          full_name: fullName,
          role: "company_user",
          company_id: companyId,
          invited_by: profile.id,
        })
        .select("id")
        .maybeSingle();
      if (invErr && !isUniqueViolation(invErr.message, invErr.code)) {
        throw new Error(invErr.message);
      }
      insertedInviteId = row?.id ?? null;
    } else {
      const { data: row, error: invErr } = await admin
        .from("invites")
        .insert({
          email,
          full_name: fullName,
          role: "member",
          is_admin: kind === "admin",
          invited_by: profile.id,
        })
        .select("id")
        .maybeSingle();
      if (invErr && !isUniqueViolation(invErr.message, invErr.code)) {
        throw new Error(invErr.message);
      }
      insertedInviteId = row?.id ?? null;
    }

    result = await sendAuthInvite(admin, email, fullName, kind === "company" ? "sponsor" : "member");
  } catch (e) {
    if (isControlFlowError(e)) throw e;
    // Nothing was invited, so do not leave a row sitting in "Waiting to join"
    // forever. Best-effort: a failed cleanup must not replace the real reason.
    if (admin && insertedInviteId) {
      await admin
        .from("invites")
        .delete()
        .eq("id", insertedInviteId)
        .then(undefined, () => undefined);
      revalidatePath("/admin/invite");
    }
    // Opaque code, never driver text: InviteForm/Notice look it up, so a
    // crafted ?denied= (or leftover ?error=) cannot put attacker copy in chrome.
    denyRedirect(
      "/admin/invite",
      e instanceof AlreadyRegisteredError
        ? "invite_email_already_registered"
        : "invite_failed",
    );
  }
  return finishInvite(result);
}

export async function reviewJoinRequest(formData: FormData) {
  const profile = await requireProfile();
  if (!profile.is_admin) denyRedirect("/feed", "admins_only");
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const supabase = await createClient();
  try {
    if (decision === "rejected") {
      const { data, error } = await supabase
        .from("company_join_requests")
        .update({
          status: "rejected",
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
          admin_note: emptyToNull(formData.get("admin_note")),
        })
        .eq("id", id)
        .select("id");
      if (error) denyRedirect("/admin/requests", "join_request_reject_failed");
      if (!data?.length) {
        // This update has no status filter, so an already-reviewed row still
        // matches and returns a row. Zero rows can only mean the request was
        // deleted, or RLS refused the write.
        denyRedirect("/admin/requests", "join_request_reject_failed");
      }
      revalidatePath("/admin/requests");
      return;
    }

    if (decision !== "approved") {
      denyRedirect("/admin/requests", "join_request_review_failed");
    }

    const { data: req } = await supabase
      .from("company_join_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!req) denyRedirect("/admin/requests", "join_request_review_failed");
    if (req.status !== "pending") {
      denyRedirect("/admin/requests", "join_request_review_race");
    }

    const admin = createAdminClient();
    const tierId = emptyToNull(formData.get("sponsor_tier_id"));
    if (!tierId) denyRedirect("/admin/requests", "invite_tier_required");
    const { data: company, error: cErr } = await admin
      .from("companies")
      .insert({
        name: req.company_name,
        slug: slugify(req.company_name) + "-" + crypto.randomUUID().slice(0, 4),
        sponsor_tier_id: tierId,
        website: req.website,
        status: "active",
      })
      .select("id")
      .single();
    if (cErr || !company) denyRedirect("/admin/requests", "join_request_review_failed");

    const { data: inviteRow, error: inviteRowErr } = await admin
      .from("invites")
      .insert({
        email: req.contact_email,
        full_name: req.contact_name,
        role: "company_user",
        company_id: company.id,
        invited_by: profile.id,
      })
      .select("id")
      .maybeSingle();
    if (inviteRowErr && !isUniqueViolation(inviteRowErr.message, inviteRowErr.code)) {
      denyRedirect("/admin/requests", "join_request_review_failed");
    }

    let invite: InviteResult | null = null;
    try {
      invite = await sendAuthInvite(admin, req.contact_email, req.contact_name, "sponsor");
    } catch (e) {
      if (!(e instanceof AlreadyRegisteredError)) throw e;
      // The contact already has an account, so there is nothing to invite and
      // certainly nothing to reset. Drop the invite row this call just added so
      // it does not sit in "Waiting to join" forever waiting for a signup that
      // can never happen, and say so below.
      if (inviteRow?.id) {
        await admin
          .from("invites")
          .delete()
          .eq("id", inviteRow.id)
          .then(undefined, () => undefined);
      }
    }

    const { data: approved, error: updErr } = await admin
      .from("company_join_requests")
      .update({
        status: "approved",
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        company_id: company.id,
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id");
    if (updErr) denyRedirect("/admin/requests", "join_request_review_failed");
    revalidatePath("/admin/requests");
    revalidatePath("/admin/companies");
    revalidatePath("/admin/invite");
    // The .eq("status", "pending") filter means zero rows here is a race: another
    // admin reviewed this request between the check above and now. The firm and
    // the invite were still created, so say so rather than reporting success.
    if (!approved?.length) {
      denyRedirect("/admin/requests", "join_request_review_race");
    }
    if (!invite) {
      denyRedirect("/admin/requests", "join_request_contact_already_registered");
    }
    if (invite.via === "unsent") {
      redirect("/admin/invite?unsent=1");
    }
  } catch (e) {
    if (isControlFlowError(e)) throw e;
    denyRedirect("/admin/requests", "join_request_review_failed");
  }
}

function revalidateCompanyAccess() {
  revalidatePath("/admin/companies");
  revalidatePath("/admin/tiers");
  revalidatePath("/feed");
  revalidatePath("/company", "layout");
  revalidatePath("/company/sponsorship");
  revalidatePath("/company/resume-book");
  revalidatePath("/company/search");
  revalidatePath("/company/applicants");
}

/** Withdraw an invite nobody has used yet. */
export async function cancelInvite(formData: FormData) {
  const profile = await requireProfile();
  if (!profile.is_admin) denyRedirect("/feed", "admins_only");
  const id = String(formData.get("invite_id") ?? "");
  if (!id || !(await cancelPendingInvite((await hubEnv()).DB, id))) {
    denyRedirect("/admin/invite", "invite_cancel_failed");
  }
  revalidatePath("/admin/invite");
  redirect("/admin/invite?cancelled=1");
}

/** Take a sponsor contact off their firm and sign them out. Posts and messages stay. */
export async function removeContact(formData: FormData) {
  const profile = await requireProfile();
  if (!profile.is_admin) denyRedirect("/feed", "admins_only");
  const id = String(formData.get("profile_id") ?? "");
  if (!id || !(await removeCompanyContact((await hubEnv()).DB, id))) {
    denyRedirect("/admin/companies", "contact_remove_failed");
  }
  revalidatePath("/admin/companies");
  revalidatePath("/admin/people");
  redirect("/admin/companies?removed=1");
}

/** Create a sponsor firm on its own, with no contact invited yet. */
export async function addCompany(formData: FormData) {
  const profile = await requireProfile();
  if (!profile.is_admin) denyRedirect("/feed", "admins_only");
  const name = String(formData.get("name") ?? "").trim();
  const tierId = emptyToNull(formData.get("sponsor_tier_id"));
  const website = httpUrlOrNull(formData.get("website"));
  const logoUrl = httpUrlOrNull(formData.get("logo_url"));
  if (!name || name.length > 120) denyRedirect("/admin/companies", "company_name_required");
  if (!tierId) denyRedirect("/admin/companies", "invite_tier_required");
  if (website === INVALID_URL || logoUrl === INVALID_URL) {
    denyRedirect("/admin/companies", "company_url_invalid");
  }
  const supabase = await createClient();
  const { data: existing } = await supabase.from("companies").select("id, name");
  if ((existing ?? []).some((c) => String(c.name).trim().toLowerCase() === name.toLowerCase())) {
    denyRedirect("/admin/companies", "company_exists");
  }
  const { data, error } = await supabase
    .from("companies")
    .insert({
      name,
      slug: (slugify(name) || "company") + "-" + Math.random().toString(36).slice(2, 6),
      sponsor_tier_id: tierId,
      status: "active",
      website,
      logo_url: logoUrl,
    })
    .select("id")
    .single();
  if (error || !data) denyRedirect("/admin/companies", "company_add_failed");
  await supabase.from("sponsor_tier_events").insert({
    kind: "company_assigned",
    tier_id: tierId,
    company_id: data.id,
    actor_id: profile.id,
    detail: { from: null, to: tierId },
  });
  revalidateCompanyAccess();
  revalidatePath("/admin/invite");
  redirect(`/admin/companies?added=1#company-${data.id}`);
}

export async function setCompanyTier(formData: FormData) {
  const profile = await requireProfile();
  if (!profile.is_admin) denyRedirect("/feed", "admins_only");
  const supabase = await createClient();
  const companyId = String(formData.get("company_id"));
  const tierId = String(formData.get("sponsor_tier_id"));
  const status = String(formData.get("status") ?? "");
  if (status !== "active" && status !== "inactive") {
    denyRedirect("/admin/companies", "company_status_invalid");
  }
  const { data: before } = await supabase
    .from("companies")
    .select("sponsor_tier_id, status")
    .eq("id", companyId)
    .maybeSingle();
  const { data, error } = await supabase
    .from("companies")
    .update({ sponsor_tier_id: tierId, status })
    .eq("id", companyId)
    .select("id");
  if (error || !data?.length) denyRedirect("/admin/companies", "company_tier_assign_failed");
  if (before?.sponsor_tier_id !== tierId) {
    await supabase.from("sponsor_tier_events").insert({
      kind: "company_assigned",
      tier_id: tierId,
      company_id: companyId,
      actor_id: profile.id,
      detail: { from: before?.sponsor_tier_id ?? null, to: tierId },
    });
  }
  if (before?.status !== status) {
    await supabase.from("sponsor_tier_events").insert({
      kind: "company_status",
      company_id: companyId,
      actor_id: profile.id,
      detail: { from: before?.status ?? null, to: status },
    });
  }
  revalidateCompanyAccess();
}

export async function setCompanyAccess(formData: FormData) {
  const profile = await requireProfile();
  if (!profile.is_admin) denyRedirect("/feed", "admins_only");
  const supabase = await createClient();
  const companyId = String(formData.get("company_id"));

  const [companyResult, capsResult, currentResult] = await Promise.all([
    supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .maybeSingle(),
    supabase.from("sponsor_capabilities").select("key, kind"),
    supabase
      .from("company_capability_overrides")
      .select("capability, granted, value")
      .eq("company_id", companyId),
  ]);
  if (
    companyResult.error ||
    capsResult.error ||
    currentResult.error ||
    !companyResult.data ||
    !capsResult.data?.length
  ) {
    denyRedirect("/admin/companies", "company_access_save_failed");
  }
  const caps = capsResult.data;
  const current = currentResult.data;

  const next: { capability: string; granted: boolean; value: number | null }[] = [];
  for (const cap of caps) {
    const mode = formData.get(`access_${cap.key}`);
    if (mode !== "inherit" && mode !== "grant" && mode !== "revoke") {
      denyRedirect("/admin/companies", "company_capability_mode_invalid");
    }
    // Only inheritance removes an override. Explicit grants/revocations stay
    // pinned even when they currently agree with the tier's defaults.
    if (mode === "inherit") continue;
    const granted = mode === "grant";
    let value: number | null = null;
    if (granted && cap.kind === "quota") {
      const raw = String(formData.get(`value_${cap.key}`) ?? "").trim();
      if (raw) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 2147483647) {
          denyRedirect("/admin/companies", "company_capability_value_invalid");
        }
        value = n;
      }
    }
    next.push({ capability: cap.key, granted, value });
  }

  const currentMap = new Map(
    (current ?? []).map((r) => [
      r.capability as string,
      { granted: r.granted as boolean, value: r.value as number | null },
    ]),
  );
  const nextMap = new Map(next.map((r) => [r.capability, r]));

  for (const row of next) {
    const prev = currentMap.get(row.capability);
    if (prev && prev.granted === row.granted && prev.value === row.value) continue;
    const { error } = await supabase.from("company_capability_overrides").upsert(
      {
        company_id: companyId,
        capability: row.capability,
        granted: row.granted,
        value: row.value,
      },
      { onConflict: "company_id,capability" },
    );
    if (error) denyRedirect("/admin/companies", "company_access_save_failed");
  }

  for (const key of currentMap.keys()) {
    if (nextMap.has(key)) continue;
    const { error } = await supabase
      .from("company_capability_overrides")
      .delete()
      .eq("company_id", companyId)
      .eq("capability", key);
    if (error) denyRedirect("/admin/companies", "company_access_save_failed");
  }

  await supabase.from("sponsor_tier_events").insert({
    kind: "company_access",
    company_id: companyId,
    actor_id: profile.id,
    detail: { overrides: next },
  });
  revalidateCompanyAccess();
}

export async function resetCompanyAccess(formData: FormData) {
  const profile = await requireProfile();
  if (!profile.is_admin) denyRedirect("/feed", "admins_only");
  const supabase = await createClient();
  const companyId = String(formData.get("company_id"));
  const { error } = await supabase
    .from("company_capability_overrides")
    .delete()
    .eq("company_id", companyId);
  if (error) denyRedirect("/admin/companies", "company_access_save_failed");
  await supabase.from("sponsor_tier_events").insert({
    kind: "company_access",
    company_id: companyId,
    actor_id: profile.id,
    detail: { overrides: [] },
  });
  revalidateCompanyAccess();
}

const MAX_COMPANY_NAME = 200;
const MAX_CONTACT_NAME = 120;
const MAX_EMAIL = 254;
const MAX_NOTE = 2000;
const MAX_URL = 500;

function emptyToNull(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function overLimit(v: string | null, max: number) {
  return v !== null && v.length > max;
}

function isEmail(value: string) {
  return value.length > 0 && value.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const INVALID_URL = Symbol("invalid-url");

function httpUrlOrNull(
  v: FormDataEntryValue | null,
): string | null | typeof INVALID_URL {
  const s = emptyToNull(v);
  if (!s) return null;
  if (s.length > MAX_URL) return INVALID_URL;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return INVALID_URL;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return INVALID_URL;
  return u.toString();
}
