/**
 * The request's database client. The name is historical: since the move to
 * Cloudflare this returns the D1/R2 client (lib/db/client.ts) acting as the
 * signed-in person, with the old RLS rules applied, so pages that call
 * `createClient()` didn't need rewriting.
 */
import { cookies } from "next/headers";
import { cache } from "react";

import { readSession, SESSION_COOKIE, type SessionProfile } from "@/lib/cf-auth/sessions";
import { createHubClient, type HubClient } from "@/lib/db/client";
import { loadCompanyAccess, loadViewer } from "@/lib/db/viewer";
import type { Viewer } from "@/lib/db/policies";
import { parseSponsorModeCookie, SPONSOR_MODE_COOKIE } from "@/lib/sponsor-mode-cookie";
import { fileLinkKey, hubEnv } from "@/lib/hub/env";

export type SessionUser = { id: string; email: string; app_metadata: Record<string, unknown> };

export type ServerClient = HubClient & {
  auth: {
    getUser(): Promise<{ data: { user: SessionUser | null }; error: null }>;
  };
};

/** Bindings exist (always true on the Worker; false in a bare `next dev`). */
export function isSupabaseConfigured() {
  return true;
}

/** The signed-in profile for this request, read once. */
export const currentSession = cache(async (): Promise<SessionProfile | null> => {
  // cookies() first: it marks the page as per-request, so `next build` never
  // prerenders it and never starts a local Workers runtime to get bindings.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const env = await hubEnv();
  return readSession(env.DB, token);
});

/**
 * Sponsor mode: an admin who picked a company reads every page as that
 * company's sponsor contact would (same RLS, tier and overrides), and every
 * write is refused. Anyone else, or a cookie naming a missing company, gets
 * their normal viewer.
 */
export const sponsorModeViewer = cache(async (): Promise<Viewer | null> => {
  const session = await currentSession();
  if (!session?.is_admin) return null;
  const companyId = parseSponsorModeCookie((await cookies()).get(SPONSOR_MODE_COOKIE)?.value, session.id);
  if (!companyId) return null;
  const now = new Date();
  const access = await loadCompanyAccess((await hubEnv()).DB, companyId, now);
  if (!access) return null;
  return { id: session.id, role: "company_user", isAdmin: false, companyId, access, now, readOnly: true };
});

export const createClient = cache(async (): Promise<ServerClient> => {
  const session = await currentSession();
  const env = await hubEnv();
  const viewer = session ? ((await sponsorModeViewer()) ?? (await loadViewer(env.DB, session))) : null;
  const client = createHubClient({
    db: env.DB,
    files: env.FILES,
    principal: viewer ? { kind: "user", viewer } : { kind: "anon" },
    fileLinks: fileLinkKey(env),
  });
  const user = session ? { id: session.id, email: session.email, app_metadata: {} } : null;
  return {
    ...client,
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
  };
});
