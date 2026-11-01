"use server";

import { assertSponsorWriteAllowed } from "@/lib/sponsor-mode";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { denyRedirect } from "./deny";

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
