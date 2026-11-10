import { NextResponse, type NextRequest } from "next/server";

import { discordReady, DISCORD_STATE_COOKIE, linkAlumnusDiscord } from "@/lib/alumni/discord";
import { discordRouteContext } from "@/lib/alumni/discord-env";
import { pushConnectAlumni, type AlumniPushAuth } from "@/lib/alumni/directory-push";
import { siteUrl } from "@/lib/site-url";

/** Back from Discord's consent screen: link the account and add the Alumni role (lib/alumni/discord.ts). */
export async function GET(request: NextRequest) {
  const back = (q: string) => {
    const res = NextResponse.redirect(`${siteUrl()}/alumni/discord?${q}`);
    res.cookies.delete({ name: DISCORD_STATE_COOKIE, path: "/alumni/discord" });
    return res;
  };
  const { env, db, alumnus } = await discordRouteContext(request);
  if (!alumnus || !db) return NextResponse.redirect(`${siteUrl()}/login`);
  if (!discordReady(env)) return back("error=unconfigured");
  const sp = request.nextUrl.searchParams;
  if (sp.get("error")) return back("error=cancelled");
  const state = sp.get("state");
  const code = sp.get("code");
  if (!state || state !== request.cookies.get(DISCORD_STATE_COOKIE)?.value || !code) return back("error=expired");
  const result = await linkAlumnusDiscord(db, env, alumnus, code, siteUrl());
  if (result.ok) {
    // auth.quantt.ca's Alumni tab shows who linked Discord.
    await pushConnectAlumni(db, (env as { AUTH?: AlumniPushAuth }).AUTH).catch((e) => console.error("connect alumni push failed", e));
    return back(`joined=${result.outcome}`);
  }
  console.warn(`alumni discord: ${result.reason} ${result.detail ?? ""}`);
  return back(`error=${result.reason}`);
}
