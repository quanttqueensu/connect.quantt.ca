import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { ALUMNI_COOKIE, readAlumniSession, type Alumnus } from "@/lib/alumni/auth";
import { ALUMNI_MODE_COOKIE, parseAlumniModeCookie } from "@/lib/alumni-mode-cookie";
import { getCurrentProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";

/** `preview`: an admin viewing the alumni area as this alum (alumni mode). Read-only. */
export type CurrentAlumnus = Alumnus & { preview: boolean };

/** An admin in alumni mode: the alum they picked, or null. */
async function previewAlumnus(): Promise<Alumnus | null> {
  const value = (await cookies()).get(ALUMNI_MODE_COOKIE)?.value;
  if (!value) return null;
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return null;
  const id = parseAlumniModeCookie(value, profile.id);
  if (!id) return null;
  return (await hubEnv()).DB.prepare(`SELECT id, email, full_name FROM alumni WHERE id = ?`).bind(id).first<Alumnus>();
}

/**
 * The alumnus for this request: an admin's alumni-mode pick first, else the
 * alum's own session cookie. Null when neither.
 */
export const currentAlumnus = cache(async (): Promise<CurrentAlumnus | null> => {
  const preview = await previewAlumnus();
  if (preview) return { ...preview, preview: true };
  const token = (await cookies()).get(ALUMNI_COOKIE)?.value;
  if (!token) return null;
  const a = await readAlumniSession((await hubEnv()).DB, token);
  return a ? { ...a, preview: false } : null;
});

/** For alumni pages: the alumnus (or an admin's preview of one), or off to /login. */
export async function requireAlumnus(): Promise<CurrentAlumnus> {
  const a = await currentAlumnus();
  if (!a) redirect("/login");
  return a;
}

/** For alumni actions: the alum's own session only. Alumni mode is read-only. */
export async function requireAlumnusForWrite(): Promise<Alumnus> {
  const a = await requireAlumnus();
  if (a.preview) throw new Error("Alumni mode is read-only. Switch back to make changes.");
  return a;
}
