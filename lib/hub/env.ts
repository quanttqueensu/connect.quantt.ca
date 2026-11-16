import { getCloudflareContext } from "@opennextjs/cloudflare";

import type { D1Database } from "@/lib/db/d1";
import type { R2BucketLike } from "@/lib/db/storage";
import type { Mailer } from "@/lib/cf-auth/email";
import type { QuanttDirectory } from "@/lib/quantt-signin";
import { siteUrl } from "@/lib/site-url";

/** The Worker bindings and secrets the hub needs (wrangler.jsonc, dashboard secrets). */
export type HubEnv = {
  DB: D1Database;
  FILES: R2BucketLike;
  // Email, sent as quantt@clubs.queensu.ca by the quantt-calendar Worker (wrangler.jsonc).
  MAILER?: Mailer;
  FILES_SIGNING_KEY?: string;
  // Alumni in the QUANTT Discord (lib/alumni/discord.ts).
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
  // The quantt-auth service binding (wrangler.jsonc).
  AUTH?: QuanttDirectory;
};

function check(env: unknown): HubEnv {
  const e = env as Partial<HubEnv>;
  if (!e.DB || !e.FILES) throw new Error("The DB and FILES bindings are missing (wrangler.jsonc)");
  return e as HubEnv;
}

export async function hubEnv(): Promise<HubEnv> {
  return check((await getCloudflareContext({ async: true })).env);
}

/** For synchronous callers inside a request (createAdminClient). */
export function hubEnvSync(): HubEnv {
  return check(getCloudflareContext().env);
}

export function fileLinkKey(env: HubEnv) {
  return env.FILES_SIGNING_KEY ? { secret: env.FILES_SIGNING_KEY, siteUrl: siteUrl() } : null;
}
