import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTicket } from "../lib/quantt-ticket";

const SECRET = "test-secret";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function ticket(payload: Record<string, unknown>, secret = SECRET, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }) {
  const data = `${b64(header)}.${b64(payload)}`;
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}
const now = Date.now();
const good = {
  iss: "https://auth.quantt.ca", aud: "connect", sub: "m_1", email: "A.Member@QueensU.ca",
  name: "A Member", team: "Co-Chairs", role: "member", state: "s".repeat(32), exp: Math.floor(now / 1000) + 60,
};

describe("Sign in with QUANTT tickets", () => {
  it("accepts a fresh ticket for this site and state", () => {
    const r = verifyTicket(ticket(good), SECRET, good.state, now);
    expect(r).toEqual({ ok: true, claims: { sub: "m_1", email: "a.member@queensu.ca", name: "A Member", team: "Co-Chairs", role: "member" } });
  });
  it("reads the admin role", () => {
    const r = verifyTicket(ticket({ ...good, role: "admin" }), SECRET, good.state, now);
    expect(r.ok && r.claims.role).toBe("admin");
  });
  it.each([
    ["another secret", ticket(good, "other"), good.state, "bad signature"],
    ["another browser's state", ticket(good), "t".repeat(32), "state mismatch"],
    ["no state cookie", ticket(good), undefined, "state mismatch"],
    ["an expired ticket", ticket({ ...good, exp: Math.floor(now / 1000) - 1 }), good.state, "ticket expired"],
    ["another site", ticket({ ...good, aud: "calendar" }), good.state, "ticket is for another site"],
    ["another issuer", ticket({ ...good, iss: "https://evil.example" }), good.state, "ticket is for another site"],
    ["alg none", ticket(good, SECRET, { alg: "none" }), good.state, "unexpected algorithm"],
    ["garbage", "a.b", good.state, "malformed ticket"],
  ])("refuses %s", (_label, t, state, reason) => {
    expect(verifyTicket(t, SECRET, state, now)).toEqual({ ok: false, reason });
  });
  it("refuses everything when the secret isn't set", () => {
    expect(verifyTicket(ticket(good), "", good.state, now)).toEqual({ ok: false, reason: "QUANTT_AUTH_SECRET is not set" });
  });
});
