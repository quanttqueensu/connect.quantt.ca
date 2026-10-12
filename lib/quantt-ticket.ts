import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * "Sign in with QUANTT": club members sign in once on auth.quantt.ca (the shared
 * member directory, behind Cloudflare Access), which sends them back to
 * /auth/quantt/callback with a ticket. The ticket is a JWT signed (HS256) with
 * QUANTT_AUTH_SECRET, the same value set as CONNECT_SECRET on the quantt-auth
 * Worker. It is valid for two minutes and carries the `state` this hub put in
 * a cookie when it sent the member away, so a ticket cannot be replayed into
 * someone else's browser.
 *
 * Sponsors never use this; they keep the Supabase email and password login.
 */
export const QUANTT_STATE_COOKIE = "quantt_state";
export const QUANTT_ISSUER = "https://auth.quantt.ca";

export function quanttAuthUrl() {
  return (process.env.QUANTT_AUTH_URL?.trim() || QUANTT_ISSUER).replace(/\/+$/, "");
}

export type QuanttClaims = {
  sub: string;
  email: string;
  name: string | null;
  team: string | null;
  /** "admin" or "member", from the Connect role on auth.quantt.ca. */
  role: string;
};

export type TicketResult = { ok: true; claims: QuanttClaims } | { ok: false; reason: string };

const fromB64url = (s: string) => Buffer.from(s, "base64url");

export function verifyTicket(
  ticket: string | null | undefined,
  secret: string | null | undefined,
  state: string | null | undefined,
  now = Date.now(),
): TicketResult {
  if (!secret) return { ok: false, reason: "QUANTT_AUTH_SECRET is not set" };
  if (!ticket) return { ok: false, reason: "no ticket" };
  const parts = ticket.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed ticket" };
  const [h, p, s] = parts;

  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const given = fromB64url(s);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad signature" };
  }

  let header: { alg?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(fromB64url(h).toString("utf8"));
    payload = JSON.parse(fromB64url(p).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed ticket" };
  }
  if (header.alg !== "HS256") return { ok: false, reason: "unexpected algorithm" };
  if (payload.iss !== QUANTT_ISSUER || payload.aud !== "connect") return { ok: false, reason: "ticket is for another site" };
  if (typeof payload.exp !== "number" || payload.exp * 1000 < now) return { ok: false, reason: "ticket expired" };
  if (!state || payload.state !== state) return { ok: false, reason: "state mismatch" };
  if (typeof payload.sub !== "string" || typeof payload.email !== "string" || !payload.email.includes("@")) {
    return { ok: false, reason: "ticket has no member" };
  }

  return {
    ok: true,
    claims: {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      name: typeof payload.name === "string" ? payload.name : null,
      team: typeof payload.team === "string" ? payload.team : null,
      role: payload.role === "admin" ? "admin" : "member",
    },
  };
}
