import type { User } from "@supabase/supabase-js";

/**
 * Invited users must set a password before using the app.
 * `invited_at` is never cleared after updateUser({ password }), so do not use it.
 */
export function userNeedsPassword(user: User | null | undefined) {
  return user?.app_metadata?.must_set_password === true;
}

export function isPasswordSetupAuthType(type: string | null | undefined) {
  return type === "invite" || type === "recovery";
}

export function parseAuthHash(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return {
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
    type: params.get("type"),
    error: params.get("error") ?? params.get("error_code"),
    error_description: params.get("error_description"),
  };
}

/**
 * Invite / recovery / magic links often land on `/` or `/login` because that
 * is the Supabase Site URL. The only page that exchanges them is
 * `/auth/callback`. Forward rather than dropping the tokens.
 */
export function shouldForwardToAuthCallback(
  pathname: string,
  search: string,
  hash: string,
) {
  if (pathname.startsWith("/auth/callback")) return false;
  // auth.quantt.ca's one-time `code` is not a Supabase code; its own route redeems it.
  if (pathname.startsWith("/auth/quantt/")) return false;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("code") || params.get("token_hash")) return true;
  const parsed = parseAuthHash(hash);
  if (parsed.error) return true;
  return Boolean(parsed.access_token && parsed.refresh_token);
}

const AUTH_NEXT_ALLOWLIST = new Set(["/auth/set-password"]);

/**
 * `authCallbackUrl()` puts `next=` on the invite/recovery lander. Callback
 * must never honor an absolute or off-allowlist value — that would be an
 * open redirect. The only destination we currently send is set-password.
 */
export function safeAuthNext(next: string | null | undefined): string | null {
  if (!next) return null;
  const trimmed = next.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    trimmed.includes("://")
  ) {
    return null;
  }
  const path = trimmed.split("?")[0].split("#")[0];
  if (path.includes("..") || path.includes("/.")) return null;
  return AUTH_NEXT_ALLOWLIST.has(path) ? path : null;
}

/**
 * After exchanging an invite/recovery link, send the user to set a password.
 *
 * PKCE recovery links often have no `type=` after the code exchange — only
 * the `next=/auth/set-password` we put on redirectTo. Do not treat a bare
 * `?type=invite` on an existing session as setup: that would let anyone
 * lock a signed-in user into the password form.
 */
export function authCallbackNeedsPassword(input: {
  exchanged: boolean;
  type: string | null | undefined;
  next: string | null | undefined;
  userMustSetPassword: boolean;
}): boolean {
  if (input.userMustSetPassword) return true;
  if (!input.exchanged) return false;
  if (isPasswordSetupAuthType(input.type)) return true;
  return safeAuthNext(input.next) === "/auth/set-password";
}
