/**
 * The object the app gets where it used to get a Supabase client:
 * `from()` (lib/db/rest.ts), `rpc()` (lib/db/rpc.ts) and `storage`
 * (lib/db/storage.ts), all bound to one principal.
 */

import type { D1Database } from "@/lib/db/d1";
import { createRestClient, type Principal } from "@/lib/db/rest";
import { callRpc } from "@/lib/db/rpc";
import { createStorage, type FileLinkKey, type R2BucketLike } from "@/lib/db/storage";

export type HubClient = ReturnType<typeof createHubClient>;

export function createHubClient(opts: {
  db: D1Database;
  files: R2BucketLike;
  principal: Principal;
  fileLinks: FileLinkKey | null;
}) {
  const rest = createRestClient(opts.db, opts.principal);
  return {
    from: rest.from,
    rpc: (name: string, args?: Record<string, unknown>) => callRpc(opts.db, opts.principal, name, args),
    storage: createStorage(opts.files, opts.principal, opts.fileLinks),
  };
}
