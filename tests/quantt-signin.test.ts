import { describe, expect, it } from "vitest";
import { redeemSignin, type QuanttDirectory } from "../lib/quantt-signin";

const STATE = "s".repeat(32);
const claims = { app: "connect", sub: "m_1", email: "A.Member@QueensU.ca", name: "A Member", team: "Co-Chairs", role: "member", state: STATE };

// One-time codes, as the quantt-auth Worker keeps them.
function directory(entries: Record<string, Record<string, unknown>>): QuanttDirectory {
  const codes = new Map(Object.entries(entries));
  return {
    async redeem(code, app) {
      const c = codes.get(code);
      codes.delete(code);
      return c && c.app === app ? c : null;
    },
  };
}

describe("Sign in with QUANTT codes", () => {
  it("accepts a code carrying this browser's state", async () => {
    const r = await redeemSignin(directory({ ok: claims }), "ok", STATE);
    expect(r).toEqual({ ok: true, claims: { sub: "m_1", email: "a.member@queensu.ca", name: "A Member", team: "Co-Chairs", role: "member" } });
  });
  it("reads the admin role", async () => {
    const r = await redeemSignin(directory({ ok: { ...claims, role: "admin" } }), "ok", STATE);
    expect(r.ok && r.claims.role).toBe("admin");
  });
  it("works once", async () => {
    const auth = directory({ ok: claims });
    await redeemSignin(auth, "ok", STATE);
    expect(await redeemSignin(auth, "ok", STATE)).toEqual({ ok: false, reason: "code unknown, used or expired" });
  });
  it.each([
    ["another browser's state", "t".repeat(32), "state mismatch"],
    ["no state cookie", undefined, "state mismatch"],
  ])("refuses %s", async (_label, state, reason) => {
    expect(await redeemSignin(directory({ ok: claims }), "ok", state)).toEqual({ ok: false, reason });
  });
  it("refuses a code for another site", async () => {
    expect(await redeemSignin(directory({ ok: { ...claims, app: "calendar" } }), "ok", STATE)).toEqual({ ok: false, reason: "code unknown, used or expired" });
  });
  it("refuses without a code or a binding", async () => {
    expect(await redeemSignin(directory({}), null, STATE)).toEqual({ ok: false, reason: "no code" });
    expect(await redeemSignin(undefined, "ok", STATE)).toEqual({ ok: false, reason: "the AUTH service binding is missing" });
  });
});
