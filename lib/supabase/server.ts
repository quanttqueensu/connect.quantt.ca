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
import { loadViewer } from "@/lib/db/viewer";
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
  const env = await hubEnv();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return readSession(env.DB, token);
});

export const createClient = cache(async (): Promise<ServerClient> => {
  const env = await hubEnv();
  const session = await currentSession();
  const viewer = session ? await loadViewer(env.DB, session) : null;
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
