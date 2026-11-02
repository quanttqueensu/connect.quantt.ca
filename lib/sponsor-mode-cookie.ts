/**
 * Sponsor mode cookie: `${adminProfileId}:${companyId}`. Kept apart from
 * lib/sponsor-mode.ts so the database client can read it without a cycle.
 * The value never grants anything by itself: the session must still be an
 * admin whose id matches the prefix.
 */
export const SPONSOR_MODE_COOKIE = "connect-sponsor-mode";

export function sponsorModeCookieValue(adminId: string, companyId: string) {
  return `${adminId}:${companyId}`;
}

export function parseSponsorModeCookie(value: string | undefined, adminId: string): string | null {
  if (!value) return null;
  const prefix = `${adminId}:`;
  if (!value.startsWith(prefix)) return null;
  const companyId = value.slice(prefix.length);
  return /^[A-Za-z0-9_-]{1,64}$/.test(companyId) ? companyId : null;
}
