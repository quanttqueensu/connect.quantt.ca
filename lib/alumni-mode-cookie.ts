/**
 * Alumni mode cookie: `${adminProfileId}:${alumniId}`, the alumni twin of the
 * sponsor mode cookie (lib/sponsor-mode-cookie.ts). The value never grants
 * anything by itself: the hub session must still be an admin whose id matches
 * the prefix (lib/alumni/current.ts), and the preview is read-only.
 */
export { parseSponsorModeCookie as parseAlumniModeCookie } from "@/lib/sponsor-mode-cookie";

export const ALUMNI_MODE_COOKIE = "connect-alumni-mode";

export function alumniModeCookieValue(adminId: string, alumniId: string) {
  return `${adminId}:${alumniId}`;
}
