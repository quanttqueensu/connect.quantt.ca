/**
 * "Sign in with QUANTT": club members sign in once on auth.quantt.ca (the shared
 * member directory, behind Cloudflare Access), which stores who they are under a
 * one-time code and sends them back to /auth/quantt/callback?code=…. The callback
 * redeems the code through the service binding AUTH (the quantt-auth Worker,
 * wrangler.jsonc), so nothing secret is shared with this site, and checks that the
 * code carries the `state` this hub put in a cookie when it sent the member away,
 * so a code cannot be replayed into someone else's browser.
 *
 * Sponsors never use this; they keep the Supabase email and password login.
 */
export const QUANTT_STATE_COOKIE = "quantt_state";

export function quanttAuthUrl() {
  return (process.env.QUANTT_AUTH_URL?.trim() || "https://auth.quantt.ca").replace(/\/+$/, "");
}

export type QuanttClaims = {
  sub: string;
  email: string;
  name: string | null;
  team: string | null;
  /** "admin" or "member", from the Connect role on auth.quantt.ca. */
  role: "admin" | "member";
};

/** The quantt-auth RPC entrypoint (Directory) as this site sees it. */
export type QuanttDirectory = {
  redeem(code: string, app: string): Promise<Record<string, unknown> | null>;
};

export type SigninResult = { ok: true; claims: QuanttClaims } | { ok: false; reason: string };

export async function redeemSignin(
  auth: QuanttDirectory | undefined,
  code: string | null | undefined,
  state: string | null | undefined,
): Promise<SigninResult> {
  if (!auth) return { ok: false, reason: "the AUTH service binding is missing" };
  if (!code) return { ok: false, reason: "no code" };
  const c = await auth.redeem(code, "connect");
  if (!c) return { ok: false, reason: "code unknown, used or expired" };
  if (!state || c.state !== state) return { ok: false, reason: "state mismatch" };
  if (typeof c.sub !== "string" || typeof c.email !== "string" || !c.email.includes("@")) {
    return { ok: false, reason: "code has no member" };
  }
  return {
    ok: true,
    claims: {
      sub: c.sub,
      email: c.email.toLowerCase(),
      name: typeof c.name === "string" ? c.name : null,
      team: typeof c.team === "string" ? c.team : null,
      role: c.role === "admin" ? "admin" : "member",
    },
  };
}
