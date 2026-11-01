import { describe, expect, it, vi } from "vitest";

import { profileForQuanttMember, profileForSignIn } from "@/lib/cf-auth/accounts";
import { loginCodeEmail, sendLoginCodeEmail } from "@/lib/cf-auth/email";
import { CODES_PER_HOUR, MAX_ATTEMPTS, requestLoginCode, verifyLoginCode } from "@/lib/cf-auth/login-codes";
import { createSession, endAllSessions, endSession, purgeExpired, readSession } from "@/lib/cf-auth/sessions";
import { randomCode, sha256Hex } from "@/lib/cf-auth/tokens";

import { addCompany, addMember, all, asD1, freshDb, NOW, run, uuid, type Db } from "./sqlite";

function setup() {
  const raw = freshDb();
  return { raw, db: asD1(raw) };
}

function inviteMember(raw: Db, email: string, opts: { admin?: boolean; name?: string } = {}) {
  run(raw, `INSERT INTO invites (id, email, full_name, role, is_admin) VALUES (?, ?, ?, 'member', ?)`, uuid(), email, opts.name ?? "", opts.admin ? 1 : 0);
}

function inviteRecruiter(raw: Db, email: string, companyId: string) {
  run(raw, `INSERT INTO invites (id, email, full_name, role, company_id) VALUES (?, ?, 'Rita', 'company_user', ?)`, uuid(), email, companyId);
}

/** Request a code and capture what would have been emailed. */
async function codeFor(db: ReturnType<typeof asD1>, email: string, now = NOW) {
  const sent: string[] = [];
  await requestLoginCode(db, email, async (_to, code) => void sent.push(code), now);
  return sent[0] ?? null;
}

describe("sign-in codes", () => {
  it("emails a code to an existing account and signs in with it once", async () => {
    const { raw, db } = setup();
    const member = addMember(raw, { email: "ann@queensu.ca" });
    const code = await codeFor(db, " Ann@Queensu.ca ");
    expect(code).toMatch(/^\d{6}$/);
    expect(await verifyLoginCode(db, "ann@queensu.ca", code!, NOW)).toEqual({ ok: true, profileId: member, role: "member" });
    expect(await verifyLoginCode(db, "ann@queensu.ca", code!, NOW)).toEqual({ ok: false, code: "login_code_invalid" });
  });

  it("stores only a hash of the code", async () => {
    const { raw, db } = setup();
    addMember(raw, { email: "ann@queensu.ca" });
    const code = await codeFor(db, "ann@queensu.ca");
    const stored = all<{ code_hash: string }>(raw, `SELECT code_hash FROM login_codes`)[0].code_hash;
    expect(stored).not.toContain(code!);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sends nothing to an unknown email, and says nothing different", async () => {
    const { db } = setup();
    const send = vi.fn();
    await expect(requestLoginCode(db, "stranger@example.com", send, NOW)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("expires codes after 10 minutes", async () => {
    const { raw, db } = setup();
    addMember(raw, { email: "ann@queensu.ca" });
    const code = await codeFor(db, "ann@queensu.ca");
    const later = new Date(NOW.getTime() + 11 * 60_000);
    expect((await verifyLoginCode(db, "ann@queensu.ca", code!, later)).ok).toBe(false);
  });

  it("burns a code after too many wrong guesses", async () => {
    const { raw, db } = setup();
    addMember(raw, { email: "ann@queensu.ca" });
    const code = await codeFor(db, "ann@queensu.ca");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect((await verifyLoginCode(db, "ann@queensu.ca", wrong, NOW)).ok).toBe(false);
    }
    expect((await verifyLoginCode(db, "ann@queensu.ca", code!, NOW)).ok).toBe(false);
  });

  it("only the newest code works", async () => {
    const { raw, db } = setup();
    addMember(raw, { email: "ann@queensu.ca" });
    const first = await codeFor(db, "ann@queensu.ca");
    const second = await codeFor(db, "ann@queensu.ca", new Date(NOW.getTime() + 1000));
    if (first !== second) expect((await verifyLoginCode(db, "ann@queensu.ca", first!, NOW)).ok).toBe(false);
    expect((await verifyLoginCode(db, "ann@queensu.ca", second!, NOW)).ok).toBe(true);
  });

  it("limits how many codes one email can be sent per hour", async () => {
    const { raw, db } = setup();
    addMember(raw, { email: "ann@queensu.ca" });
    const send = vi.fn(async () => {});
    for (let i = 0; i < CODES_PER_HOUR + 3; i++) {
      await requestLoginCode(db, "ann@queensu.ca", send, new Date(NOW.getTime() + i * 1000));
    }
    expect(send).toHaveBeenCalledTimes(CODES_PER_HOUR);
  });

  it("a code for one email does not work for another", async () => {
    const { raw, db } = setup();
    addMember(raw, { email: "ann@queensu.ca" });
    addMember(raw, { email: "bob@queensu.ca" });
    const code = await codeFor(db, "ann@queensu.ca");
    expect((await verifyLoginCode(db, "bob@queensu.ca", code!, NOW)).ok).toBe(false);
  });
});

describe("first sign-in from an invite", () => {
  it("creates a recruiter's profile and firm link from their invite", async () => {
    const { raw, db } = setup();
    const firm = addCompany(raw, "partner");
    inviteRecruiter(raw, "Rita@Acme.com", firm.companyId);
    const code = await codeFor(db, "rita@acme.com");
    const result = await verifyLoginCode(db, "rita@acme.com", code!, NOW);
    expect(result).toMatchObject({ ok: true, role: "company_user" });
    const id = (result as { profileId: string }).profileId;
    expect(all(raw, `SELECT company_id FROM company_users WHERE profile_id = ?`, id)).toEqual([{ company_id: firm.companyId }]);
    expect(all(raw, `SELECT accepted_at FROM invites`)[0].accepted_at).not.toBeNull();
    expect(all(raw, `SELECT email, full_name FROM profiles WHERE id = ?`, id)[0]).toEqual({ email: "rita@acme.com", full_name: "Rita" });
  });

  it("does not create anyone without an invite", async () => {
    const { db } = setup();
    expect(await profileForSignIn(db, "nobody@example.com")).toBeNull();
  });
});

describe("Sign in with QUANTT", () => {
  it("creates a club member without an invite and copies the admin role", async () => {
    const { raw, db } = setup();
    const out = await profileForQuanttMember(db, { email: "Zed@queensu.ca", name: "Zed", role: "admin" });
    expect(out.ok).toBe(true);
    expect(all(raw, `SELECT email, full_name, role, is_admin FROM profiles`)).toEqual([
      { email: "zed@queensu.ca", full_name: "Zed", role: "member", is_admin: 1 },
    ]);
    await profileForQuanttMember(db, { email: "zed@queensu.ca", name: "Zed", role: "member" });
    expect(all(raw, `SELECT is_admin FROM profiles`)).toEqual([{ is_admin: 0 }]);
  });

  it("uses up a member's pending invite", async () => {
    const { raw, db } = setup();
    inviteMember(raw, "amy@queensu.ca", { name: "Amy" });
    await profileForQuanttMember(db, { email: "amy@queensu.ca", name: null, role: "member" });
    expect(all(raw, `SELECT full_name FROM profiles`)).toEqual([{ full_name: "Amy" }]);
    expect(all(raw, `SELECT count(*) AS n FROM invites WHERE accepted_at IS NULL`)[0].n).toBe(0);
  });

  it("refuses an email that belongs to a firm account or firm invite", async () => {
    const { raw, db } = setup();
    const firm = addCompany(raw, "partner");
    const recruiterEmail = all<{ email: string }>(raw, `SELECT email FROM profiles WHERE id = ?`, firm.userId)[0].email;
    expect(await profileForQuanttMember(db, { email: recruiterEmail, name: null, role: "admin" })).toEqual({
      ok: false,
      code: "quantt_signin_company",
    });
    inviteRecruiter(raw, "new@acme.com", firm.companyId);
    expect((await profileForQuanttMember(db, { email: "new@acme.com", name: null, role: "member" })).ok).toBe(false);
  });
});

describe("sessions", () => {
  it("round-trips a session and stores only the token's hash", async () => {
    const { raw, db } = setup();
    const firm = addCompany(raw, "partner");
    const { token } = await createSession(db, firm.userId, NOW);
    const stored = all<{ token_hash: string }>(raw, `SELECT token_hash FROM sessions`)[0].token_hash;
    expect(stored).toBe(await sha256Hex(token));
    expect(await readSession(db, token, NOW)).toMatchObject({ id: firm.userId, role: "company_user", company_id: firm.companyId });
  });

  it("rejects unknown, malformed and expired tokens", async () => {
    const { raw, db } = setup();
    const member = addMember(raw);
    const { token } = await createSession(db, member, NOW);
    expect(await readSession(db, "x".repeat(43), NOW)).toBeNull();
    expect(await readSession(db, "short", NOW)).toBeNull();
    expect(await readSession(db, undefined, NOW)).toBeNull();
    const later = new Date(NOW.getTime() + 31 * 86_400_000);
    expect(await readSession(db, token, later)).toBeNull();
    expect(all(raw, `SELECT count(*) AS n FROM sessions`)[0].n).toBe(0);
  });

  it("signs out one session or all of them", async () => {
    const { raw, db } = setup();
    const member = addMember(raw);
    const a = await createSession(db, member, NOW);
    const b = await createSession(db, member, NOW);
    await endSession(db, a.token);
    expect(await readSession(db, a.token, NOW)).toBeNull();
    expect(await readSession(db, b.token, NOW)).not.toBeNull();
    await endAllSessions(db, member);
    expect(await readSession(db, b.token, NOW)).toBeNull();
  });

  it("ends sessions when the account is deleted", async () => {
    const { raw, db } = setup();
    const member = addMember(raw);
    const { token } = await createSession(db, member, NOW);
    run(raw, `DELETE FROM profiles WHERE id = ?`, member);
    expect(await readSession(db, token, NOW)).toBeNull();
  });

  it("purges expired rows", async () => {
    const { raw, db } = setup();
    const member = addMember(raw);
    await createSession(db, member, NOW);
    await purgeExpired(db, new Date(NOW.getTime() + 31 * 86_400_000));
    expect(all(raw, `SELECT count(*) AS n FROM sessions`)[0].n).toBe(0);
  });
});

describe("code email", () => {
  it("draws codes from all six digits", () => {
    const codes = new Set(Array.from({ length: 200 }, randomCode));
    expect([...codes].every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(codes.size).toBeGreaterThan(190);
  });

  it("posts to Resend with the code and the sender", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendLoginCodeEmail({ RESEND_API_KEY: "test-key", LOGIN_EMAIL_FROM: "Hub <hub@quantt.ca>" }, "ann@queensu.ca", "123456", fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: "Hub <hub@quantt.ca>", to: ["ann@queensu.ca"] });
    expect(body.subject).toContain("123456");
    expect(loginCodeEmail("123456").text).toContain("10 minutes");
  });

  it("fails loudly without an API key", async () => {
    await expect(sendLoginCodeEmail({}, "a@b.co", "123456")).rejects.toThrow(/RESEND_API_KEY/);
  });
});
