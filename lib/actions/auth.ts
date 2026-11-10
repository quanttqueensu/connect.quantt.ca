"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { pushConnectAlumni } from "@/lib/alumni/directory-push";
import {
  ALUMNI_COOKIE,
  alumniCookieOptions,
  canAlumniSignIn,
  createAlumniSession,
  requestAlumniCode,
  verifyAlumniCode,
} from "@/lib/alumni/auth";
import { canSignIn } from "@/lib/cf-auth/accounts";
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
 *
 * Sponsors and alumni share this one form. A sponsor account (or invite) wins;
 * otherwise an alumni account (or invite) gets an alumni code. Which one was
 * sent is kept in LOGIN_KIND_COOKIE so step 2 checks the right table. Alumni
 * still get their own session cookie and tables (lib/alumni/auth.ts).
 */
const LOGIN_EMAIL_COOKIE = "connect_login_email";
const LOGIN_KIND_COOKIE = "connect_login_kind";
const LOGIN_EMAIL_MINUTES = 15;

function secure() {
  return siteUrl().startsWith("https://");
}

export async function requestCode(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!looksLikeEmail(email)) redirect("/login?error=login_email_required");

  const env = await hubEnv();
  let kind: "account" | "alumni" = "account";
  try {
    const send = (to: string, code: string) => sendLoginCodeEmail(env, to, code);
    if (!(await canSignIn(env.DB, email)) && (await canAlumniSignIn(env.DB, email))) {
      kind = "alumni";
      await requestAlumniCode(env.DB, email, send);
    } else {
      await requestLoginCode(env.DB, email, send);
    }
  } catch (e) {
    // Same answer either way; the log says what went wrong (usually Resend).
    console.error("login code not sent", e);
  }
  const jar = await cookies();
  const opts = { httpOnly: true, secure: secure(), sameSite: "lax" as const, path: "/login", maxAge: LOGIN_EMAIL_MINUTES * 60 };
  jar.set(LOGIN_EMAIL_COOKIE, email, opts);
  jar.set(LOGIN_KIND_COOKIE, kind, opts);
  redirect("/login?step=code");
}

export async function verifyCode(formData: FormData) {
  const jar = await cookies();
  const email = jar.get(LOGIN_EMAIL_COOKIE)?.value;
  if (!email) redirect("/login?error=login_code_expired");

  const env = await hubEnv();
  if (jar.get(LOGIN_KIND_COOKIE)?.value === "alumni") {
    const alum = await verifyAlumniCode(env.DB, email, String(formData.get("code") ?? ""));
    if (!alum.ok) {
      if (alum.code === "alumni_account_missing") {
        clearLoginCookies(jar);
        redirect("/login?error=login_account_missing");
      }
      redirect("/login?step=code&error=login_code_invalid");
    }
    jar.set(ALUMNI_COOKIE, await createAlumniSession(env.DB, alum.alumniId), alumniCookieOptions(secure()));
    // An invite may just have turned into an account: auth's Alumni tab shows them as joined now.
    await pushConnectAlumni(env.DB, env.AUTH).catch((e) => console.error("connect alumni push failed", e));
    clearLoginCookies(jar);
    redirect("/alumni");
  }
  const result = await verifyLoginCode(env.DB, email, String(formData.get("code") ?? ""));
  if (!result.ok) {
    if (result.code === "login_account_missing") {
      clearLoginCookies(jar);
      redirect("/login?error=login_account_missing");
    }
    redirect("/login?step=code&error=login_code_invalid");
  }

  const { token } = await createSession(env.DB, result.profileId);
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(secure()));
  clearLoginCookies(jar);
  revalidatePath("/", "layout");
  redirect(result.role === "company_user" ? "/company" : "/feed");
}

/** "Use a different email" on the code step. */
function clearLoginCookies(jar: Awaited<ReturnType<typeof cookies>>) {
  jar.delete({ name: LOGIN_EMAIL_COOKIE, path: "/login" });
  jar.delete({ name: LOGIN_KIND_COOKIE, path: "/login" });
}

export async function restartLogin() {
  clearLoginCookies(await cookies());
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
