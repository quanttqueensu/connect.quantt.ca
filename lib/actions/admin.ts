"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { authCallbackUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { denyRedirect } from "./deny";

const MANUAL_INVITE_COOKIE = "hub_manual_invite";
/**
 * The cookie carries a working credential, so it is scoped to the only routes
 * that render it (/admin/invite and /admin/requests) rather than the whole
 * site, and it lives just long enough to survive the redirect that shows it.
 */
const MANUAL_INVITE_PATH = "/admin";
const MANUAL_INVITE_MAX_AGE = 120;

/**
 * The address already has an auth account.
 *
 * This is a refusal, never a fallback. An invite must never touch an account
 * that already exists: doing so would let any exec type a colleague's address
 * and be handed a working password for their account. Callers report it and
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

type InviteResult = { via: "email" } | { via: "manual"; password: string };

function randomPassword() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function isUniqueViolation(message: string, code?: string) {
  return code === "23505" || /duplicate|unique/i.test(message);
}

function isEmailRateLimited(message: string) {
  return /rate limit|over_email_send_rate_limit/i.test(message);
}

async function stashManualInvite(email: string, password: string, adminId: string) {
  const store = await cookies();
  store.set(MANUAL_INVITE_COOKIE, JSON.stringify({ email, password, adminId }), {
    httpOnly: true,
    sameSite: "lax",
    // Plaintext credential: never let it travel over plain http in production.
    secure: process.env.NODE_ENV === "production",
    maxAge: MANUAL_INVITE_MAX_AGE,
    path: MANUAL_INVITE_PATH,
  });
}

function forgetManualInvite(store: Awaited<ReturnType<typeof cookies>>) {
  // readManualInvite runs during a Server Component render, where Next refuses
  // cookie writes. Best-effort here; ManualInviteBanner calls
  // clearManualInvite() from the client so the delete actually lands.
  try {
    store.set(MANUAL_INVITE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
      path: MANUAL_INVITE_PATH,
    });
  } catch {
    // Server Component render: the client-side clear is the real one.
  }
}

/**
 * Hand back the one-time password stashed by the invite that just ran.
 *
 * This is an exported server action, i.e. a callable endpoint, so it checks
 * admin rights itself rather than trusting the page that calls it, and it
 * only answers the admin who created the stash -- a cookie on a shared exec
 * laptop is not proof that the person at the keyboard is the inviter.
 */
export async function readManualInvite() {
  const profile = await requireProfile().catch(() => null);
  if (!profile?.is_admin) return null;

  const store = await cookies();
  const raw = store.get(MANUAL_INVITE_COOKIE)?.value;
  if (!raw) return null;
  forgetManualInvite(store);
  try {
    const parsed = JSON.parse(raw) as {
      email?: string;
      password?: string;
      adminId?: string;
    };
    if (!parsed.email || !parsed.password) return null;
    if (parsed.adminId !== profile.id) return null;
    return { email: parsed.email, password: parsed.password };
  } catch {
    return null;
  }
}

/** Drop the stashed password once the banner has rendered it. */
export async function clearManualInvite() {
  const profile = await requireProfile().catch(() => null);
  if (!profile?.is_admin) return;
  forgetManualInvite(await cookies());
}

async function markInviteNeedsPassword(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  appMetadata: Record<string, unknown> | undefined,
) {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...(appMetadata ?? {}),
      must_set_password: true,
    },
  });
  if (error) throw new Error(error.message);
}

/**
 * Create a brand-new account with a generated password, for when GoTrue will
 * not send the invite email (rate limit). Only ever creates: if the address
 * turns out to already exist, this refuses rather than reaching for the
 * existing row, so no code path here can hand an admin a password to someone
 * else's account.
 */
async function createUserWithoutEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<InviteResult> {
  const password = randomPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { must_set_password: true },
  });
  if (!error && data.user) return { via: "manual", password };

  if (error && /already/i.test(error.message)) throw new AlreadyRegisteredError();

  throw new Error(error?.message ?? "Could not create user");
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

async function sendAuthInvite(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<InviteResult> {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: authCallbackUrl(),
  });
  if (!error && data.user) {
    await markInviteNeedsPassword(admin, data.user.id, data.user.app_metadata);
    return { via: "email" };
  }

  const message = error?.message ?? "Invite failed";

  // "Already registered / already invited" means an account exists. Refuse.
  // The generated-password fallback below is only ever safe for an address
  // that has no account yet; running it here would reset a colleague's
  // password and hand it to whoever typed their email into this form.
  if (/already been (registered|invited)/i.test(message)) {
    throw new AlreadyRegisteredError();
  }

  // A genuine send-rate limit: the account does not exist, GoTrue just will
  // not mail it. Creating it with a temporary password to read out is fine.
  if (isEmailRateLimited(message)) return createUserWithoutEmail(admin, email);

  throw new Error(message);
}

/**
 * Not exported: this file is `"use server"`, so every export is a callable
 * endpoint. A public wrapper must never put driver text (unique-index names,
 * whether an email already requested access) on the wire.
 */
async function insertJoinRequest(formData: FormData) {
  const companyName = String(formData.get("company_name") ?? "").trim();
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
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

  const supabase = await createClient();
  const { error } = await supabase.from("company_join_requests").insert({
    company_name: companyName,
    website,
    contact_name: contactName,
    contact_email: contactEmail,
    note,
    status: "pending",
  });
  if (error) throw new Error(error.message);
  await notify({
    type: "join_request",
    to: [],
    subject: "Company access request",
    body: companyName,
  });
}

export async function submitCompanyRequest(formData: FormData) {
  try {
    await insertJoinRequest(formData);
  } catch (e) {
    if (isControlFlowError(e)) throw e;
    // /join is public and unauthenticated. The pending-email unique index means
    // a duplicate submission comes back as a 23505 naming the constraint, so
    // echoing the driver text would confirm whether an address has already
    // requested access (email enumeration) and disclose schema besides. One
    // opaque code for every failure, distinguishing nothing — and the page
    // looks the code up rather than rendering ?error= text.
    redirect("/join?error=join_request_failed");
  }
  redirect("/join?sent=1");
}

async function finishInvite(
  email: string,
  adminId: string,
  result: InviteResult,
): Promise<never> {
  revalidatePath("/admin/invite");
  revalidatePath("/admin/people");
  revalidatePath("/admin/companies");
  if (result.via === "manual") {
    await stashManualInvite(email, result.password, adminId);
    redirect("/admin/invite?manual=1");
  }
  redirect("/admin/invite?sent=1");
}

export async function invitePerson(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  let result: InviteResult = { via: "email" };
  let profileId = "";
  // The invites row has to exist before the auth user is created --
  // handle_new_user() raises 'Invite required' otherwise -- so it is inserted
  // first and removed again if the invite does not go out. Only a row this
  // call actually inserted is removed; a pre-existing pending invite (unique
  // violation, id stays null) is left alone.
  let insertedInviteId: string | null = null;
  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    const profile = await requireProfile();
    if (!profile.is_admin) denyRedirect("/admin/invite", "invite_failed");
    profileId = profile.id;
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

    result = await sendAuthInvite(admin, email);
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
  return finishInvite(email, profileId, result);
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
      invite = await sendAuthInvite(admin, req.contact_email);
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
    if (invite?.via === "manual") {
      await stashManualInvite(req.contact_email, invite.password, profile.id);
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
    if (invite.via === "manual") {
      redirect("/admin/invite?manual=1");
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
