"use server";

import { cookies } from "next/headers";
import { SPONSOR_MODE_COOKIE } from "@/lib/sponsor-mode";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { userNeedsPassword } from "@/lib/auth-session";
import { authCallbackUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

async function homeForUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/login?error=login_failed";
  if (userNeedsPassword(user)) return "/auth/set-password";

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return "/login?error=login_account_missing";
  return profile.role === "company_user" ? "/company" : "/feed";
}

export async function login(formData: FormData) {
  if (!isSupabaseConfigured()) {
    redirect("/login?error=login_misconfigured");
  }
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Opaque code: /login used to render ?error= text, so a crafted link or a
    // raw GoTrue message (including user-enumeration variants) could appear in
    // the hub's own chrome. One code, one lookup, nothing from the driver.
    redirect("/login?error=login_failed");
  }
  const dest = await homeForUser(supabase);
  revalidatePath("/", "layout");
  redirect(dest);
}

/**
 * Self-serve password reset.
 *
 * The outcome never depends on whether the address has an account: a failure
 * from GoTrue (unknown address, send rate limit) leads to exactly the same
 * redirect as a success, so /login cannot be used to test whether someone is
 * a member. This is also the supported way back in for a locked-out user --
 * before it existed, the only recovery was an admin re-invite, which is what
 * made that path dangerous.
 */
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    redirect("/login?error=login_reset_email_required");
  }

  try {
    const supabase = await createClient();
    // The recovery link lands on /auth/callback, which verifies the recovery
    // token and forwards to /auth/set-password.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authCallbackUrl(),
    });
  } catch {
    // Same answer either way -- see above.
  }
  redirect("/login?reset=1");
}

export async function markMustSetPassword() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  if (user.app_metadata?.must_set_password === false) return;

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...(user.app_metadata ?? {}),
      must_set_password: true,
    },
  });
  if (error) throw new Error(error.message);
}

export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    redirect("/auth/set-password?error=password_too_short");
  }
  if (password !== confirm) {
    redirect("/auth/set-password?error=password_mismatch");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?error=login_link_expired");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/auth/set-password?error=password_save_failed");
  }

  const admin = createAdminClient();
  const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...(user.app_metadata ?? {}),
      must_set_password: false,
    },
  });
  if (metaErr) {
    redirect("/auth/set-password?error=password_save_failed");
  }
  await supabase.auth.refreshSession();
  revalidatePath("/", "layout");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) redirect("/login?error=login_account_missing");
  redirect(profile.role === "company_user" ? "/company" : "/feed");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(SPONSOR_MODE_COOKIE);
  revalidatePath("/", "layout");
  redirect("/login");
}
