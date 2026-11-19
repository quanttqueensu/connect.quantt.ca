/**
 * Canonical site URL for links in emails and redirects: NEXT_PUBLIC_SITE_URL, else the host's own.
 * Production builds read it from the committed .env.production (https://connect.quantt.ca). A
 * production build without it throws instead of quietly emailing localhost links.
 */
export function siteUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const netlify = process.env.URL?.replace(/\/$/, "");
  if (netlify) return netlify;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  if (process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_SITE_URL is not set (see .env.production)");
  return "http://localhost:3000";
}
