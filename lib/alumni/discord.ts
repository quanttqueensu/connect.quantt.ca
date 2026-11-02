/**
 * Alumni in the QUANTT Discord. An alumnus links their Discord account from
 * /alumni/discord (Discord's own consent screen, scopes identify + guilds.join),
 * and the QUANTT Bot adds them to the server with the "Alumni" role and their
 * name as nickname. Only signed-in alumni can start this, and only invited
 * people can sign in to the alumni area, so the alumni list in connect is the
 * whole approval.
 *
 * One way only: connect -> Discord. Nothing done in Discord changes connect.
 * The bot only ever adds or removes the Alumni role; member roles are managed by
 * auth.quantt.ca and are never touched here.
 *
 * Needs DISCORD_CLIENT_ID, DISCORD_GUILD_ID (vars in wrangler.jsonc) and the
 * secrets DISCORD_CLIENT_SECRET + DISCORD_BOT_TOKEN on the quantt-connect Worker.
 * The OAuth app is the same "QUANTT Bot" app auth.quantt.ca uses; its Redirects
 * list must include https://connect.quantt.ca/alumni/discord/callback.
 */
import type { D1Database } from "@/lib/db/d1";
import { ensureAlumniTables } from "@/lib/alumni/schema";

const API = "https://discord.com/api/v10";
export const ALUMNI_ROLE = "Alumni";
export const DISCORD_STATE_COOKIE = "connect_alumni_discord_state";

export type DiscordEnv = {
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
};
type Fetch = typeof fetch;

export const discordReady = (env: DiscordEnv) =>
  Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID);

export const discordCallbackUrl = (site: string) => `${site}/alumni/discord/callback`;

export function discordAuthorizeUrl(env: DiscordEnv, site: string, state: string) {
  const go = new URL("https://discord.com/oauth2/authorize");
  go.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: discordCallbackUrl(site),
    scope: "identify guilds.join",
    state,
  }).toString();
  return go.toString();
}

export type AlumniDiscord = { alumni_id: string; discord_id: string; username: string; linked_at: string };

export async function getAlumniDiscord(db: D1Database, alumniId: string) {
  await ensureAlumniTables(db);
  return db
    .prepare(`SELECT alumni_id, discord_id, username, linked_at FROM alumni_discord WHERE alumni_id = ?`)
    .bind(alumniId)
    .first<AlumniDiscord>();
}

/** One Discord account per alumnus, and one alumnus per Discord account. */
export async function saveAlumniDiscord(db: D1Database, alumniId: string, discordId: string, username: string, now = new Date()) {
  await ensureAlumniTables(db);
  await db.batch([
    db.prepare(`DELETE FROM alumni_discord WHERE discord_id = ? AND alumni_id <> ?`).bind(discordId, alumniId),
    db
      .prepare(
        `INSERT INTO alumni_discord (alumni_id, discord_id, username, linked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (alumni_id) DO UPDATE SET discord_id = excluded.discord_id, username = excluded.username, linked_at = excluded.linked_at`,
      )
      .bind(alumniId, discordId, username, now.toISOString()),
  ]);
}

function bot(env: DiscordEnv, f: Fetch) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await f(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "content-type": "application/json",
        "user-agent": "DiscordBot (https://connect.quantt.ca, 1)",
        "x-audit-log-reason": "QUANTT alumni (connect)",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Discord said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? {} : res.json();
  };
}

async function alumniRoleId(call: ReturnType<typeof bot>, guild: string) {
  const roles = ((await call("GET", `/guilds/${guild}/roles`)) ?? []) as { id: string; name: string }[];
  const id = roles.find((r) => r.name === ALUMNI_ROLE)?.id;
  if (!id) throw new Error(`the server has no "${ALUMNI_ROLE}" role`);
  return id;
}

export type LinkResult =
  | { ok: true; outcome: "added" | "updated"; username: string }
  | { ok: false; reason: "refused" | "no_user" | "roles"; detail?: string; username?: string };

/**
 * Finishes the Discord consent screen: swaps the code for a token, reads the
 * Discord user, saves the link, then adds them to the server with the Alumni
 * role (or adds the role if they are already in it, keeping every other role).
 */
export async function linkAlumnusDiscord(
  db: D1Database,
  env: DiscordEnv,
  alumnus: { id: string; full_name: string },
  code: string,
  site: string,
  f: Fetch = fetch,
): Promise<LinkResult> {
  const tok = await f("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID ?? "",
      client_secret: env.DISCORD_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: discordCallbackUrl(site),
    }).toString(),
  });
  if (!tok.ok) return { ok: false, reason: "refused", detail: String(tok.status) };
  const { access_token } = (await tok.json()) as { access_token?: string };
  if (!access_token) return { ok: false, reason: "refused" };
  const user = (await (await f(`${API}/users/@me`, { headers: { authorization: `Bearer ${access_token}` } })).json()) as {
    id?: string;
    username?: string;
  };
  if (!user?.id) return { ok: false, reason: "no_user" };
  const username = user.username ?? "";
  await saveAlumniDiscord(db, alumnus.id, user.id, username);

  const call = bot(env, f);
  const guild = env.DISCORD_GUILD_ID ?? "";
  const nick = alumnus.full_name.trim().slice(0, 32) || undefined;
  try {
    const role = await alumniRoleId(call, guild);
    const path = `/guilds/${guild}/members/${user.id}`;
    const cur = (await call("GET", path)) as { roles: string[]; nick?: string | null } | null;
    if (!cur) {
      await call("PUT", path, { access_token, roles: [role], ...(nick ? { nick } : {}) });
      return { ok: true, outcome: "added", username };
    }
    if (!cur.roles.includes(role)) await call("PUT", `${path}/roles/${role}`);
    // Members already carry their directory name; only fill a missing nickname. The owner's can't be set.
    if (nick && !cur.nick) await call("PATCH", path, { nick }).catch(() => {});
    return { ok: true, outcome: "updated", username };
  } catch (e) {
    return { ok: false, reason: "roles", detail: e instanceof Error ? e.message : String(e), username };
  }
}

/**
 * When an admin removes an alumnus: take the Alumni role away (they stay in the
 * server and see only what non-members see; any member roles stay). Call before
 * deleting the alumni row, since the link is deleted with it. Never throws.
 */
export async function removeAlumnusFromDiscord(db: D1Database, env: DiscordEnv, alumniId: string, f: Fetch = fetch) {
  if (!discordReady(env)) return "not set up";
  const link = await getAlumniDiscord(db, alumniId);
  if (!link) return "not linked";
  try {
    const call = bot(env, f);
    const role = await alumniRoleId(call, env.DISCORD_GUILD_ID ?? "");
    await call("DELETE", `/guilds/${env.DISCORD_GUILD_ID}/members/${link.discord_id}/roles/${role}`);
    return "removed";
  } catch (e) {
    console.warn("alumni discord: role removal failed", e instanceof Error ? e.message : e);
    return "failed";
  }
}
