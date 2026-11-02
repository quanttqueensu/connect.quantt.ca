import { createClient, currentSession } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { redirect } from "next/navigation";
import { cache } from "react";

/**
 * Both are wrapped in React `cache()`, so they run once per request and the
 * layout and the page share the result.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const session = await currentSession();
  const user = session ? { id: session.id, email: session.email, app_metadata: {} } : null;
  return { supabase, user };
});

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const { supabase, user } = await getSessionUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return data as Profile | null;
});

/**
 * Hub pages that need a signed-in profile. A session without a profiles row
 * used to bounce /feed → /login with no banner; send a real code instead.
 */
export async function requireCurrentProfile(): Promise<Profile> {
  const { user } = await getSessionUser();
  if (!user) redirect("/login");
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?error=login_account_missing");
  return profile;
}

export async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile) {
    throw new Error("Not signed in");
  }
  return profile;
}
