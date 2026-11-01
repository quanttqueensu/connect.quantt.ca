"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sendLoginCodeEmail } from "@/lib/cf-auth/email";
import { requestLoginCode, verifyLoginCode } from "@/lib/cf-auth/login-codes";
import { createSession, endSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/cf-auth/sessions";
import { looksLikeEmail, normalizeEmail } from "@/lib/cf-auth/tokens";
import { hubEnv } from "@/lib/hub/env";
import { SPONSOR_MODE_COOKIE } from "@/lib/sponsor-mode";
import { siteUrl } from "@/lib/site-url";

/**
 * Sign-in by emailed code (lib/cf-auth/login-codes.ts).
 *
 * Step 1 takes an email and sends a code; step 2 takes the code. Between the
 * two the email sits in a short-lived HttpOnly cookie rather than the URL.
 * The page answers the same way whether or not the email has an account, so
 * /login cannot be used to find out who is a member or a sponsor.
 */
const LOGIN_EMAIL_COOKIE = "connect_login_email";
const LOGIN_EMAIL_MINUTES = 15;

function secure() {
  return siteUrl().startsWith("https://");
}

export async function requestCode(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!looksLikeEmail(email)) redirect("/login?error=login_email_required");

  const env = await hubEnv();
  try {
    await requestLoginCode(env.DB, email, (to, code) => sendLoginCodeEmail(env, to, code));
  } catch (e) {
    // Same answer either way; the log says what went wrong (usually Resend).
    console.error("login code not sent", e);
  }
  (await cookies()).set(LOGIN_EMAIL_COOKIE, email, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/login",
    maxAge: LOGIN_EMAIL_MINUTES * 60,
  });
  redirect("/login?step=code");
}

export async function verifyCode(formData: FormData) {
  const jar = await cookies();
  const email = jar.get(LOGIN_EMAIL_COOKIE)?.value;
  if (!email) redirect("/login?error=login_code_expired");

  const env = await hubEnv();
  const result = await verifyLoginCode(env.DB, email, String(formData.get("code") ?? ""));
  if (!result.ok) {
    if (result.code === "login_account_missing") {
      jar.delete({ name: LOGIN_EMAIL_COOKIE, path: "/login" });
      redirect("/login?error=login_account_missing");
    }
    redirect("/login?step=code&error=login_code_invalid");
  }

  const { token } = await createSession(env.DB, result.profileId);
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(secure()));
  jar.delete({ name: LOGIN_EMAIL_COOKIE, path: "/login" });
  revalidatePath("/", "layout");
  redirect(result.role === "company_user" ? "/company" : "/feed");
}

/** "Use a different email" on the code step. */
export async function restartLogin() {
  (await cookies()).delete({ name: LOGIN_EMAIL_COOKIE, path: "/login" });
  redirect("/login");
}

export async function logout() {
  const jar = await cookies();
  const env = await hubEnv();
  await endSession(env.DB, jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  jar.delete(SPONSOR_MODE_COOKIE);
  revalidatePath("/", "layout");
  redirect("/login");
}
