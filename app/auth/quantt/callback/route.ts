import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { profileForQuanttMember } from "@/lib/cf-auth/accounts";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/cf-auth/sessions";
import type { D1Database } from "@/lib/db/d1";
import type { R2BucketLike } from "@/lib/db/storage";
import { syncDirectoryFiles } from "@/lib/directory-files";
import { siteUrl } from "@/lib/site-url";
import { QUANTT_STATE_COOKIE, redeemSignin } from "@/lib/quantt-signin";

/**
 * Lands "Sign in with QUANTT" (see lib/quantt-signin.ts). A redeemed code
 * signs the member in, creating their profile the first time (using a pending
 * invite if there is one). The directory decides hub admin: its Connect role
 * is copied onto is_admin on every sign-in. A company account with the same
 * email is refused. The headshot and resume on file in the directory are
 * copied in when newer, unless the member turned sync off (lib/directory-files.ts).
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
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) return back("quantt_signin_unconfigured");
  const { sub, email, emails, name, role } = result.claims;
  const outcome = await profileForQuanttMember(db, { sub, email, emails, name, role });
  if (!outcome.ok) return back(outcome.code);

  const files = (env as unknown as { FILES?: R2BucketLike }).FILES;
  if (files) {
    // Never blocks sign-in: a failed copy just leaves the profile as it was.
    await syncDirectoryFiles(db, files, env.AUTH, outcome.profileId, email).catch((e) =>
      console.warn("directory files: sync failed", e instanceof Error ? e.message : e),
    );
  }

  const { token } = await createSession(db, outcome.profileId);
  const res = NextResponse.redirect(`${siteUrl()}/feed`);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(siteUrl().startsWith("https://")));
  res.cookies.delete({ name: QUANTT_STATE_COOKIE, path: "/auth/quantt" });
  return res;
}
