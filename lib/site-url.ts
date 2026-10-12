/** Canonical site URL for auth redirects: NEXT_PUBLIC_SITE_URL (https://connect.quantt.ca on Cloudflare), else the host's own. */
export function siteUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const netlify = process.env.URL?.replace(/\/$/, "");
  if (netlify) return netlify;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export function authCallbackUrl(next = "/auth/set-password") {
  return `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`;
}
