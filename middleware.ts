import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { shouldForwardToAuthCallback, userNeedsPassword } from "@/lib/auth-session";

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
 *  - `/auth/callback`      — lands the invite/recovery link. The tokens arrive
 *                            in the URL hash and are exchanged client-side, so
 *                            there is no session yet when this route loads.
 *  - `/auth/set-password`  — an invited user may land here before the client
 *                            has finished establishing the session; the page
 *                            renders <AwaitInviteSession /> in that window.
 *  - `/auth/quantt/start`, `/auth/quantt/callback` — "Sign in with QUANTT" for
 *                            club members: there is no session until the
 *                            callback redeems auth.quantt.ca's code
 *                            (lib/quantt-signin.ts).
 */
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/for-companies",
  "/join",
  "/auth/callback",
  "/auth/set-password",
  "/auth/quantt/start",
  "/auth/quantt/callback",
];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function redirectKeepingSession(url: URL, supabaseResponse: NextResponse) {
  const res = NextResponse.redirect(url);
  supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}

/**
 * Does the request carry a Supabase session cookie at all? @supabase/ssr names
 * them `sb-<project-ref>-auth-token`, split into `.0`, `.1`… when large.
 */
function hasSessionCookie(request: NextRequest) {
  return request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });


  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Fail closed in production: without these the rest of this function
    // cannot authenticate, and returning next() would make every route public.
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Service unavailable", { status: 503 });
    }
    return supabaseResponse;
  }

  // Signed-out fast path. With no session cookie there is nothing to verify, so
  // skip the Supabase round trips that used to run on every request, including
  // the public pages. Tokens in the query string still go to /auth/callback.
  if (
    !hasSessionCookie(request) &&
    !shouldForwardToAuthCallback(request.nextUrl.pathname, request.nextUrl.search, "")
  ) {
    const { pathname } = request.nextUrl;
    // `/` only ever sends a signed-out visitor on to /login, after loading its
    // own JS and asking Supabase. Do it here instead. The browser keeps any
    // #access_token hash across the redirect, and AuthHashCatcher on /login
    // forwards it to /auth/callback as before.
    if (pathname === "/" || !isPublic(pathname)) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/login";
      return NextResponse.redirect(redirect);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // getClaims() verifies the access token locally against the project's
  // published signing keys (cached), instead of a round trip to Supabase Auth
  // on every request like getUser(). It still refreshes an expired session.
  // With a legacy symmetric JWT secret it falls back to getUser() by itself.
  // Pages keep calling getUser() (lib/auth.ts), so a removed account is still
  // turned away there.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const user = claims ? { id: claims.sub, app_metadata: claims.app_metadata ?? {} } : null;

  // The token's app_metadata is a copy from when it was issued, so a fresh
  // "must set password" flag is confirmed with Supabase before acting on it.
  let needsPassword = false;
  if (user && userNeedsPassword(user)) {
    const { data } = await supabase.auth.getUser();
    needsPassword = userNeedsPassword(data.user);
  }

  const { pathname } = request.nextUrl;

  // Query-string tokens (PKCE `code`, OTP `token_hash`) must reach /auth/callback
  // even if Site URL is `/`, `/login`, or `/for-companies`. Do this before the
  // logged-in /login → /feed bounce, which would otherwise depend on client JS.
  if (shouldForwardToAuthCallback(pathname, request.nextUrl.search, "")) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/auth/callback";
    return redirectKeepingSession(redirect, supabaseResponse);
  }

  const { data: profile } = user
    ? await supabase.from("profiles").select("role, is_admin").eq("id", user.id).maybeSingle()
    : { data: null };

  if (user && needsPassword && !pathname.startsWith("/auth/")) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/auth/set-password";
    return redirectKeepingSession(redirect, supabaseResponse);
  }

  if (!user && !isPublic(pathname)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    return redirectKeepingSession(redirect, supabaseResponse);
  }

  if (
    user &&
    !profile &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/auth/")
  ) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("error", "login_account_missing");
    return redirectKeepingSession(redirect, supabaseResponse);
  }

  const sponsorDemo = Boolean(
    profile?.is_admin && user &&
    request.cookies.get("connect-sponsor-mode")?.value === `${user.id}:demo`,
  );

  // Stay in the fictional sponsor area until the admin exits demo mode.
  // This also prevents direct URLs from showing normal admin/member data
  // underneath a banner that says the information is fictional.
  if (
    sponsorDemo && !isPublic(pathname) &&
    pathname !== "/company" && !pathname.startsWith("/company/") &&
    pathname !== "/admin/sponsor-mode"
  ) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/company";
    redirect.search = "";
    return redirectKeepingSession(redirect, supabaseResponse);
  }

  if (pathname === "/login" && profile && !needsPassword) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = sponsorDemo || profile.role === "company_user" ? "/company" : "/feed";
    return redirectKeepingSession(redirect, supabaseResponse);
  }

  if (profile?.role === "company_user") {
    const blocked =
      pathname.startsWith("/feed") ||
      pathname.startsWith("/members") ||
      pathname.startsWith("/packages") ||
      pathname.startsWith("/applications") ||
      pathname.startsWith("/profile") ||
      pathname.startsWith("/messages") ||
      (pathname.startsWith("/admin") && !profile.is_admin) ||
      pathname === "/";
    if (blocked) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/company";
      return redirectKeepingSession(redirect, supabaseResponse);
    }
  }

  if (profile?.role === "member") {
    if (pathname.startsWith("/company") && !profile.is_admin) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/feed";
      return redirectKeepingSession(redirect, supabaseResponse);
    }
    if (pathname.startsWith("/admin") && !profile.is_admin) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/feed";
      return redirectKeepingSession(redirect, supabaseResponse);
    }
    if (pathname === "/") {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/feed";
      return redirectKeepingSession(redirect, supabaseResponse);
    }
  }

  return supabaseResponse;
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
