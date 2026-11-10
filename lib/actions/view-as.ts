"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listAlumniAccounts } from "@/lib/alumni/data";
import { ALUMNI_MODE_COOKIE, alumniModeCookieValue } from "@/lib/alumni-mode-cookie";
import { requireProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";
import { SPONSOR_MODE_COOKIE } from "@/lib/sponsor-mode-cookie";

/**
 * The admin "View as" switch (components/ViewAsSwitch.tsx): Admin, Member,
 * Sponsor or Alum. Leaving any preview clears both preview cookies, so an
 * admin is only ever in one view. Sponsor and Alum open their pickers.
 */
const TARGETS = {
  admin: "/admin",
  member: "/feed",
  sponsor: "/admin/sponsor-mode",
  alum: "/admin/alumni-mode",
} as const;

export async function viewAs(formData: FormData) {
  const profile = await requireProfile();
  if (!profile.is_admin) redirect("/feed");
  const target = String(formData.get("target") ?? "") as keyof typeof TARGETS;
  const jar = await cookies();
  jar.delete(SPONSOR_MODE_COOKIE);
  jar.delete(ALUMNI_MODE_COOKIE);
  redirect(TARGETS[target] ?? "/admin");
}

/** View the alumni area exactly as the chosen alum sees it. Read-only. */
export async function enterAlumniMode(formData: FormData) {
  const profile = await requireProfile();
  if (!profile.is_admin) redirect("/feed");
  const id = String(formData.get("alumni_id") ?? "");
  const alumni = await listAlumniAccounts((await hubEnv()).DB);
  if (!alumni.some((a) => a.id === id)) redirect("/admin/alumni-mode");
  const jar = await cookies();
  jar.delete(SPONSOR_MODE_COOKIE);
  jar.set(ALUMNI_MODE_COOKIE, alumniModeCookieValue(profile.id, id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  redirect("/alumni");
}
