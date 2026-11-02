/**
 * The trusted client, the old service-role key: skips the per-person rules
 * but keeps the invariants. Use only after the caller has checked who may
 * do what. Since the move to Cloudflare this is the D1/R2 client.
 */
import { createHubClient } from "@/lib/db/client";
import { fileLinkKey, hubEnvSync } from "@/lib/hub/env";

export function createAdminClient() {
  const env = hubEnvSync();
  return createHubClient({
    db: env.DB,
    files: env.FILES,
    principal: { kind: "service" },
    fileLinks: fileLinkKey(env),
  });
}
