"use server";

import { assertSponsorWriteAllowed } from "@/lib/sponsor-mode";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { sendInviteEmail } from "@/lib/cf-auth/email";
import { looksLikeEmail, normalizeEmail } from "@/lib/cf-auth/tokens";
import { MAX_COMPANY_CONTACTS } from "@/lib/company-team";
import { hubEnv } from "@/lib/hub/env";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { denyRedirect } from "./deny";


/**
 * A sponsor contact invites a colleague at the same firm (Company → Team).
 * Only addresses at the inviter's own email domain, only into the inviter's own
 * company, and never onto an address that already has an account. Admins still
 * see and manage everyone under Admin → People → Sponsors.
 */
export async function inviteColleague(formData: FormData) {
  const profile = await requireProfile();
  await assertSponsorWriteAllowed(profile);
  if (profile.role !== "company_user") throw new Error("Companies only");
  const supabase = await createClient();
  const { data: cu } = await supabase
    .from("company_users")
    .select("company_id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!cu) throw new Error("No company on this account");

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  if (!looksLikeEmail(email) || !fullName) denyRedirect("/company/team", "invite_name_email_required");
  const domain = (e: string) => e.slice(e.lastIndexOf("@") + 1).toLowerCase();
  if (domain(email) !== domain(profile.email)) denyRedirect("/company/team", "team_invite_domain");

  const admin = createAdminClient();
  const [{ count: contacts }, { count: pending }, { data: existing }] = await Promise.all([
    admin.from("company_users").select("*", { count: "exact", head: true }).eq("company_id", cu.company_id),
    admin
      .from("invites")
      .select("*", { count: "exact", head: true })
      .eq("company_id", cu.company_id)
      .is("accepted_at", null),
    admin.from("profiles").select("id").eq("email", email).maybeSingle(),
  ]);
  if (existing) denyRedirect("/company/team", "team_invite_taken");
  if ((contacts ?? 0) + (pending ?? 0) >= MAX_COMPANY_CONTACTS) denyRedirect("/company/team", "team_invite_limit");

  const { error } = await admin.from("invites").insert({
    email,
    full_name: fullName,
    role: "company_user",
    company_id: cu.company_id,
    invited_by: profile.id,
  });
  if (error) {
    if (!/duplicate|unique/i.test(error.message)) {
      console.error("team invite failed", error.message);
      denyRedirect("/company/team", "team_invite_failed");
    }
    // Already invited. Only resend when it's an invite to this firm; never touch anyone else's.
    const { data: other } = await admin
      .from("invites")
      .select("company_id")
      .eq("email", email)
      .is("accepted_at", null)
      .maybeSingle();
    if (other?.company_id !== cu.company_id) denyRedirect("/company/team", "team_invite_taken");
  }
  let sent = true;
  try {
    await sendInviteEmail(await hubEnv(), email, fullName, `${siteUrl()}/login`, "sponsor");
  } catch (e) {
    console.error("team invite email not sent", e);
    sent = false;
  }
  revalidatePath("/company/team");
  revalidatePath("/admin/people");
  redirect(sent ? "/company/team?sent=1" : "/company/team?unsent=1");
}

const MAX_URL = 500;
const MAX_SHORT = 500;

function emptyToNull(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function httpUrlOrNull(raw: string | null) {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  return u.toString();
}

export async function updateCompanyProfile(formData: FormData) {
  const profile = await requireProfile();
  await assertSponsorWriteAllowed(profile);
  if (profile.role !== "company_user") throw new Error("Companies only");
  const supabase = await createClient();
  const { data: cu } = await supabase
    .from("company_users")
    .select("company_id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!cu) throw new Error("No company on this account");

  const website = httpUrlOrNull(emptyToNull(formData.get("website")));
  const logoUrl = httpUrlOrNull(emptyToNull(formData.get("logo_url")));
  const description = emptyToNull(formData.get("description"));
  if (website === undefined) denyRedirect("/company/sponsorship", "company_url_invalid");
  if (logoUrl === undefined) denyRedirect("/company/sponsorship", "company_url_invalid");
  if (description && description.length > MAX_SHORT) {
    denyRedirect("/company/sponsorship", "company_profile_invalid");
  }
  if (website && website.length > MAX_URL) {
    denyRedirect("/company/sponsorship", "company_url_invalid");
  }
  if (logoUrl && logoUrl.length > MAX_URL) {
    denyRedirect("/company/sponsorship", "company_url_invalid");
  }

  const { data, error } = await supabase
    .from("companies")
    .update({ website, logo_url: logoUrl, description })
    .eq("id", cu.company_id)
    .select("id");
  if (error || !data?.length) denyRedirect("/company/sponsorship", "company_profile_invalid");
  revalidatePath("/company/sponsorship");
  revalidatePath("/feed");
  revalidatePath("/company");
}
