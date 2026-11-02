import { cache } from "react";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, sponsorModeViewer } from "@/lib/supabase/server";
import type { Company, Profile } from "@/lib/types";

export { SPONSOR_MODE_COOKIE } from "@/lib/sponsor-mode-cookie";

/**
 * The company an admin is viewing as, or null. Re-checked against the real
 * session on every request; the cookie alone never grants anything.
 */
export async function sponsorModeCompanyId(profile: Profile): Promise<string | null> {
  if (!profile.is_admin) return null;
  return (await sponsorModeViewer())?.companyId ?? null;
}

/**
 * Shared by company pages AND handlers; layouts alone do not protect handlers.
 * In sponsor mode the company is real and every read goes through the same
 * sponsor rules a contact at that company gets; `preview` only marks the
 * session read-only.
 */
export const getCompanyContext = cache(async () => {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const previewId = await sponsorModeCompanyId(profile);
  const supabase = await createClient();
  let companyId: string | null = previewId;
  if (!companyId) {
    if (profile.role !== "company_user") return null;
    const { data } = await supabase.from("company_users").select("company_id")
      .eq("profile_id", profile.id).maybeSingle();
    companyId = data?.company_id ?? null;
  }
  if (!companyId) return null;
  const { data: company } = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (!company) return null;
  return { company_id: companyId, company: company as Company, preview: Boolean(previewId) };
});

/** Guard server actions as well as disabling their buttons in the preview UI. */
export async function assertSponsorWriteAllowed(profile: Profile) {
  if (await sponsorModeCompanyId(profile)) {
    throw new Error("Sponsor mode is read-only. Exit sponsor mode to make changes.");
  }
}
