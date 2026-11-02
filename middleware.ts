import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE, type SessionProfile } from "@/lib/cf-auth/sessions";
import type { D1Database } from "@/lib/db/d1";
import { parseSponsorModeCookie, SPONSOR_MODE_COOKIE } from "@/lib/sponsor-mode-cookie";

/**
 * Routes reachable without a session.
 *
 * These are listed one by one on purpose. The bare prefix `/auth` used to be
 * here, which made every future `/auth/*` route public by accident rather than
 * by decision. **A new auth route is private until someone adds it here
 * deliberately** — and if you add one, say why in a comment.
 *
 *  - `/`, `/for-companies` — public brochure pages.
 *  - `/login`              — the sign-in form itself.
 *  - `/join`               — public sponsor access-request form.
 *  - `/files`              — signed file links (resumes, photos). The link's
 *                            own signature is the permission, checked by the
 *                            route (app/files/[...path]/route.ts).
 *  - `/auth/quantt/start`, `/auth/quantt/callback` — "Sign in with QUANTT" for
 *                            club members: there is no session until the
 *                            callback redeems auth.quantt.ca's code
 *                            (lib/quantt-signin.ts).
 *  - `/alumni`             — the alumni area. Alumni have their own accounts,
 *                            cookie (`connect_alumni`) and tables, kept apart
 *                            from members and sponsors. Every alumni page
 *                            checks that session in app/alumni/(hub)/layout.tsx
 *                            and every alumni action checks it again
 *                            (lib/alumni/current.ts).
 */
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/for-companies",
  "/join",
  "/files",
  "/auth/quantt/start",
  "/auth/quantt/callback",
  "/alumni",
];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

async function sessionProfile(request: NextRequest): Promise<SessionProfile | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { env } = getCloudflareContext();
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) return null;
  return readSession(db, token);
}

function go(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // One D1 read when there is a session cookie, none otherwise.
  const profile = await sessionProfile(request);

  if (!profile) {
    // `/` only ever sends a signed-out visitor on to /login.
    if (pathname === "/" || !isPublic(pathname)) {
      const res = go(request, "/login");
      // A cookie that no longer matches a session (expired, signed out
      // elsewhere, account removed) is dropped so the fast path applies next time.
      if (request.cookies.get(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    return NextResponse.next();
  }

  const user = { id: profile.id };
  const sponsorDemo = Boolean(
    profile.is_admin &&
    parseSponsorModeCookie(request.cookies.get(SPONSOR_MODE_COOKIE)?.value, user.id),
  );

  // Sponsor mode: stay where a sponsor would be (/company) until the admin
  // exits, so every page reads with that sponsor's rules. The picker page is
  // the one exception, to switch companies.
  if (
    sponsorDemo && !isPublic(pathname) &&
    pathname !== "/company" && !pathname.startsWith("/company/") &&
    pathname !== "/admin/sponsor-mode"
  ) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/company";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  if (pathname === "/login") {
    const redirect = request.nextUrl.clone();
    redirect.pathname = sponsorDemo || profile.role === "company_user" ? "/company" : "/feed";
    return NextResponse.redirect(redirect);
  }

  if (profile.role === "company_user") {
    const blocked =
      pathname.startsWith("/feed") ||
      pathname.startsWith("/members") ||
      pathname.startsWith("/packages") ||
      pathname.startsWith("/applications") ||
      pathname.startsWith("/profile") ||
      pathname.startsWith("/messages") ||
      pathname.startsWith("/alumni-network") ||
      (pathname.startsWith("/admin") && !profile.is_admin) ||
      pathname === "/";
    if (blocked) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/company";
      return NextResponse.redirect(redirect);
    }
  }

  if (profile.role === "member") {
    if (pathname.startsWith("/company") && !profile.is_admin) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/feed";
      return NextResponse.redirect(redirect);
    }
    if (pathname.startsWith("/admin") && !profile.is_admin) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/feed";
      return NextResponse.redirect(redirect);
    }
    if (pathname === "/") {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/feed";
      return NextResponse.redirect(redirect);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Run on everything except real static-asset locations.
     *
     * The exclusions are anchored to the start of the path. The previous
     * pattern excluded *any* path ending in an image extension, so application
     * routes such as `/members/<id>.png` or `/admin/<id>.png` skipped the
     * middleware entirely. Asset paths are a property of where a file lives,
     * not of how its URL happens to end.
     */
    "/((?!_next/|favicon\\.ico|favicon\\.png|images/|robots\\.txt|sitemap\\.xml).*)",
  ],
};
