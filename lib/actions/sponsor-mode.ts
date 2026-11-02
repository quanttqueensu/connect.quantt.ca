"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SPONSOR_MODE_COOKIE, sponsorModeCookieValue } from "@/lib/sponsor-mode-cookie";

/** View Connect exactly as a contact at the chosen company would. Read-only. */
export async function enterSponsorMode(formData: FormData) {
  const profile = await requireProfile();
  if (!profile.is_admin) throw new Error("Admins only");
  const companyId = String(formData.get("company_id") ?? "");
  const { data: company } = await createAdminClient()
    .from("companies").select("id").eq("id", companyId).maybeSingle();
  if (!company) redirect("/admin/sponsor-mode?error=company");
  (await cookies()).set(SPONSOR_MODE_COOKIE, sponsorModeCookieValue(profile.id, company.id as string), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  redirect("/company");
}

export async function exitSponsorMode() {
  const profile = await requireProfile();
  if (!profile.is_admin) throw new Error("Admins only");
  (await cookies()).delete(SPONSOR_MODE_COOKIE);
  redirect("/admin/sponsor-mode");
}
