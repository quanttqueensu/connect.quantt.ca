import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { ALUMNI_COOKIE, readAlumniSession, type Alumnus } from "@/lib/alumni/auth";
import { hubEnv } from "@/lib/hub/env";

/** The signed-in alumnus for this request (their own session cookie), or null. */
export const currentAlumnus = cache(async (): Promise<Alumnus | null> => {
  const token = (await cookies()).get(ALUMNI_COOKIE)?.value;
  if (!token) return null;
  return readAlumniSession((await hubEnv()).DB, token);
});

/** For alumni pages and actions: the alumnus, or off to /alumni/login. */
export async function requireAlumnus(): Promise<Alumnus> {
  const a = await currentAlumnus();
  if (!a) redirect("/alumni/login");
  return a;
}
