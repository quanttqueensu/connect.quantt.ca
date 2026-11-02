import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { NextRequest } from "next/server";

import { ALUMNI_COOKIE, readAlumniSession } from "@/lib/alumni/auth";
import type { DiscordEnv } from "@/lib/alumni/discord";
import type { D1Database } from "@/lib/db/d1";

/** For the /alumni/discord route handlers: the bindings, and the alumnus from their own session cookie (or null). */
export async function discordRouteContext(request: NextRequest) {
  const { env } = await getCloudflareContext({ async: true });
  const e = env as unknown as DiscordEnv & { DB?: D1Database };
  const alumnus = e.DB ? await readAlumniSession(e.DB, request.cookies.get(ALUMNI_COOKIE)?.value) : null;
  return { env: e, db: e.DB, alumnus };
}
