import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/site-url";
import { QUANTT_STATE_COOKIE, quanttAuthUrl } from "@/lib/quantt-signin";

/** Sends a club member to auth.quantt.ca to sign in (see lib/quantt-signin.ts). */
export async function GET() {
  const state = randomBytes(24).toString("base64url");
  const url = new URL(`${quanttAuthUrl()}/signin`);
  url.searchParams.set("app", "connect");
  url.searchParams.set("state", state);
  url.searchParams.set("origin", siteUrl());
  const res = NextResponse.redirect(url);
  res.cookies.set(QUANTT_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth/quantt",
    maxAge: 600,
  });
  return res;
}
