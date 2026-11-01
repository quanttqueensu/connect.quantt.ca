import { cache } from "react";
import { cookies } from "next/headers";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DEMO_COMPANY, DEMO_COMPANY_ID, DEMO_MEMBERS } from "@/lib/sponsor-demo";
import type { Company, Profile } from "@/lib/types";

export const SPONSOR_MODE_COOKIE = "connect-sponsor-mode";

/** This preference never grants access: re-check the real profile on every request. */
export async function sponsorModeCompanyId(profile: Profile): Promise<string | null> {
  if (!profile.is_admin) return null;
  const value = (await cookies()).get(SPONSOR_MODE_COOKIE)?.value;
  if (!value) return null;
  return value === `${profile.id}:demo` ? DEMO_COMPANY_ID : null;
}

/** Shared by company pages AND handlers; layouts alone do not protect handlers. */
export const getCompanyContext = cache(async () => {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const previewId = await sponsorModeCompanyId(profile);
  if (previewId) return { company_id: DEMO_COMPANY_ID, company: DEMO_COMPANY, preview: true };
  if (profile.role !== "company_user") return null;
  const supabase = await createClient();
  const { data } = await supabase.from("company_users").select("company_id")
    .eq("profile_id", profile.id).maybeSingle();
  const companyId: string | null = data?.company_id ?? null;
  if (!companyId) return null;
  const { data: company } = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (!company) return null;
  return { company_id: companyId, company: company as Company, preview: false };
});

/** Guard server actions as well as disabling their buttons in the preview UI. */
export async function assertSponsorWriteAllowed(profile: Profile) {
  if (await sponsorModeCompanyId(profile)) {
    throw new Error("Sponsor mode is read-only. Exit sponsor mode to make changes.");
  }
}

/** Only fictional talent is available in sponsor mode. */
export async function loadPreviewTalent(options: {
  capability: "resume_book" | "candidate_search";
  program?: string;
  year?: number | null;
  q?: string;
  memberId?: string;
}) {
  const context = await getCompanyContext();
  if (!context?.preview) return [];
  const q = options.q?.toLocaleLowerCase();
  return DEMO_MEMBERS.filter((row) =>
    (!options.memberId || row.id === options.memberId) &&
    (!options.program || row.program?.toLocaleLowerCase().includes(options.program.toLocaleLowerCase())) &&
    (options.year == null || row.grad_year === options.year) &&
    (!q || [row.full_name, row.program, row.interests, row.bio].some((value) => value?.toLocaleLowerCase().includes(q)))
  ).map((row) => ({ ...row, package_name: "Sample hiring package" }));
}
