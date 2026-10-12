import type { NextConfig } from "next";

/**
 * The Supabase origin the browser talks to directly (auth token refresh,
 * PostgREST reads from client components, Storage signed-URL downloads).
 * Read at build time; if it is absent we fall back to allowing https: so a
 * misconfigured build never produces a CSP that silently breaks sign-in.
 */
const supabaseOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
})();

const connectSrc = [
  "'self'",
  supabaseOrigin ?? "https:",
  supabaseOrigin
    ? supabaseOrigin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
    : "wss:",
].join(" ");
const imgSrc = ["'self'", "data:", "blob:", supabaseOrigin ?? "https:"].join(" ");

/**
 * Content-Security-Policy.
 *
 * Shipped as **Report-Only** on purpose. The App Router emits inline
 * bootstrap/hydration scripts and inline flight-data chunks, and Tailwind's
 * dev pipeline injects inline <style>, so any policy tight enough to be worth
 * enforcing needs per-request nonces threaded through middleware. That is a
 * behavioural change we cannot exercise here (no runnable environment), so the
 * policy is observed first rather than enforced.
 *
 * `frame-ancestors 'none'` is the one directive that is *also* sent enforced,
 * via X-Frame-Options below — clickjacking is the high-value case and it has no
 * inline-script caveat.
 *
 * To promote this to enforcing:
 *   1. Deploy as-is and watch for CSP violation reports / console warnings.
 *   2. If the only remaining violations are Next's own inline scripts, add a
 *      nonce in middleware.ts (generate per request, set it on the
 *      `x-nonce` request header, and swap `'unsafe-inline'` in script-src for
 *      `'nonce-<value>' 'strict-dynamic'`).
 *   3. Rename the header below to `Content-Security-Policy`.
 *
 * `'unsafe-eval'` is deliberately NOT listed: Next's production bundles do not
 * need it. If a dev-only warning appears, keep it out of the production policy.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  // 'unsafe-inline' covers Next's hydration/flight inline scripts. See note above.
  "script-src 'self' 'unsafe-inline'",
  // Tailwind and next/font both emit inline style; there is no nonce-free way around this.
  "style-src 'self' 'unsafe-inline'",
  // next/font/google self-hosts Inter and Merriweather at build time, so no
  // fonts.gstatic.com entry is needed here.
  "font-src 'self' data:",
  `img-src ${imgSrc}`,
  `connect-src ${connectSrc}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Enforced anti-clickjacking. Mirrors `frame-ancestors 'none'` in the CSP.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    // The app never asks for these. Deny them outright so an injected script
    // or embedded third party cannot prompt the user on our origin.
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "autoplay=()",
      "camera=()",
      "display-capture=()",
      "encrypted-media=()",
      "fullscreen=(self)",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "usb=()",
      "xr-spatial-tracking=()",
      "interest-cohort=()",
    ].join(", "),
  },
  {
    // 2 years, subdomains included, preload-eligible. Only sent over HTTPS by
    // browsers, so it is inert on http://localhost during development.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  // Cloudflare Workers has no Next image optimiser; the images are small local logos.
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        // Every route, including /_next assets.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
