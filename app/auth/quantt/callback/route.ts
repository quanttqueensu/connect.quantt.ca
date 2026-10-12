import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { QUANTT_STATE_COOKIE, redeemSignin } from "@/lib/quantt-signin";

/**
 * Lands "Sign in with QUANTT" (see lib/quantt-signin.ts). A redeemed code
 * signs the member into their Supabase account, creating it the first time
 * through the usual invite row so handle_new_user() builds the profile. The
 * directory decides hub admin: its Connect role is copied onto is_admin on
 * every sign-in. A company account with the same email is refused.
 */
function back(code: string) {
  const res = NextResponse.redirect(`${siteUrl()}/login?error=${code}`);
  res.cookies.delete({ name: QUANTT_STATE_COOKIE, path: "/auth/quantt" });
  return res;
}

export async function GET(request: NextRequest) {
  const { env } = await getCloudflareContext({ async: true });
  const result = await redeemSignin(
    env.AUTH,
    request.nextUrl.searchParams.get("code"),
    request.cookies.get(QUANTT_STATE_COOKIE)?.value,
  );
  if (!result.ok) {
    console.warn(`QUANTT sign-in refused: ${result.reason}`);
    return back(result.reason === "the AUTH service binding is missing" ? "quantt_signin_unconfigured" : "quantt_signin_failed");
  }
  const { email, name, role } = result.claims;
  const isAdmin = role === "admin";
  const admin = createAdminClient();

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id, role, is_admin")
    .eq("email", email)
    .maybeSingle();
  if (profileErr) return back("quantt_signin_failed");
  if (profile?.role === "company_user") return back("quantt_signin_company");

  if (!profile) {
    // At most one pending invite per email (invites_pending_email): reuse it if there is one.
    const { data: pending } = await admin
      .from("invites")
      .select("id, role")
      .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
      .is("accepted_at", null)
      .maybeSingle();
    if (pending?.role === "company_user") return back("quantt_signin_company");
    const { error: inviteErr } = pending
      ? await admin.from("invites").update({ is_admin: isAdmin }).eq("id", pending.id)
      : await admin.from("invites").insert({ email, full_name: name ?? "", role: "member", is_admin: isAdmin });
    if (inviteErr) return back("quantt_signin_failed");
    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { must_set_password: false, quantt_member: true },
    });
    if (createErr) return back("quantt_signin_failed");
  } else {
    if (profile.is_admin !== isAdmin) {
      const { error } = await admin.from("profiles").update({ is_admin: isAdmin }).eq("id", profile.id);
      if (error) return back("quantt_signin_failed");
    }
    // Members who were invited but never set a password don't need one now.
    const { data: existing } = await admin.auth.admin.getUserById(profile.id);
    if (existing?.user?.app_metadata?.must_set_password === true) {
      await admin.auth.admin.updateUserById(profile.id, {
        app_metadata: { ...existing.user.app_metadata, must_set_password: false },
      });
    }
  }

  // A one-time login link, exchanged here so it never leaves the server.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return back("quantt_signin_failed");
  const supabase = await createClient();
  const { error: otpErr } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (otpErr) return back("quantt_signin_failed");

  const res = NextResponse.redirect(`${siteUrl()}/feed`);
  res.cookies.delete({ name: QUANTT_STATE_COOKIE, path: "/auth/quantt" });
  return res;
}
