import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { discordAuthorizeUrl, discordReady, DISCORD_STATE_COOKIE } from "@/lib/alumni/discord";
import { discordRouteContext } from "@/lib/alumni/discord-env";
import { siteUrl } from "@/lib/site-url";

/** "Join the QUANTT Discord": a signed-in alumnus goes to Discord's consent screen (lib/alumni/discord.ts). */
export async function GET(request: NextRequest) {
  const { env, alumnus } = await discordRouteContext(request);
  if (!alumnus) return NextResponse.redirect(`${siteUrl()}/alumni/login`);
  if (!discordReady(env)) return NextResponse.redirect(`${siteUrl()}/alumni/discord?error=unconfigured`);
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(discordAuthorizeUrl(env, siteUrl(), state));
  res.cookies.set(DISCORD_STATE_COOKIE, state, {
    httpOnly: true,
    secure: siteUrl().startsWith("https://"),
    sameSite: "lax",
    path: "/alumni/discord",
    maxAge: 600,
  });
  return res;
}
