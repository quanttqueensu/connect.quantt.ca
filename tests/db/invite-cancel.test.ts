import { describe, expect, it } from "vitest";

import { verifyAlumniCode, requestAlumniCode, canAlumniSignIn } from "@/lib/alumni/auth";
import { cancelAlumniInvite, getPendingAlumniInvite, inviteAlumnus } from "@/lib/alumni/data";
import { canSignIn } from "@/lib/cf-auth/accounts";
import { inviteEmail } from "@/lib/cf-auth/email";
import { requestLoginCode, verifyLoginCode } from "@/lib/cf-auth/login-codes";

import { addCompany, addMember, all, asD1, freshDb, NOW, run, uuid } from "./sqlite";

describe("invite reminder email", () => {
  it("says it is a reminder and keeps the sign-in steps", () => {
    for (const audience of ["sponsor", "alumni"] as const) {
      const first = inviteEmail("Rita", "https://connect.quantt.ca/login", audience);
      const again = inviteEmail("Rita", "https://connect.quantt.ca/login", audience, true);
      expect(again.subject).toBe("Reminder: you're invited to QUANTT Connect");
      expect(again.text).toContain("A reminder that you've been invited");
      expect(again.html).toContain("A reminder that you&#39;ve been invited");
      // Same how-to-sign-in line (and Discord line for alumni) as the first email.
      expect(again.text.split("\n").slice(3)).toEqual(first.text.split("\n").slice(3));
      expect(first.subject).toBe("You're invited to QUANTT Connect");
    }
  });
});

describe("cancelling a pending invite", () => {
  it("sponsor: deleting the pending row stops sign-in, including a code already sent", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    const { companyId } = addCompany(raw, "partner");
    const id = uuid();
    run(raw, `INSERT INTO invites (id, email, full_name, role, company_id) VALUES (?, 'rita@acme.com', 'Rita', 'company_user', ?)`, id, companyId);
    expect(await canSignIn(db, "rita@acme.com")).toBe(true);
    let code = "";
    await requestLoginCode(db, "rita@acme.com", async (_to, c) => void (code = c), NOW);
    expect(code).toMatch(/^\d{6}$/);

    // What cancelSponsorInvite does.
    run(raw, `DELETE FROM invites WHERE id = ? AND accepted_at IS NULL`, id);

    expect(await canSignIn(db, "rita@acme.com")).toBe(false);
    const res = await verifyLoginCode(db, "rita@acme.com", code, NOW);
    expect(res.ok).toBe(false);
    expect(all(raw, `SELECT count(*) AS n FROM profiles WHERE email = 'rita@acme.com'`)[0].n).toBe(0);
  });

  it("alumni: cancelled invite is no longer pending and its code stops working", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    const adminId = addMember(raw, { admin: true });
    await inviteAlumnus(db, "alex@firm.com", "Alex", adminId, NOW);
    const [{ id }] = all<{ id: string }>(raw, `SELECT id FROM alumni_invites`);
    expect(await getPendingAlumniInvite(db, id)).toMatchObject({ email: "alex@firm.com", full_name: "Alex" });
    let code = "";
    await requestAlumniCode(db, "alex@firm.com", async (_to, c) => void (code = c), NOW);
    expect(code).toMatch(/^\d{6}$/);

    await cancelAlumniInvite(db, id);

    expect(await getPendingAlumniInvite(db, id)).toBeNull();
    expect(await canAlumniSignIn(db, "alex@firm.com")).toBe(false);
    expect((await verifyAlumniCode(db, "alex@firm.com", code, NOW)).ok).toBe(false);
    expect(all(raw, `SELECT count(*) AS n FROM alumni`)[0].n).toBe(0);
  });

  it("alumni: an accepted invite is not pending, so it can't be reminded or cancelled", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    const adminId = addMember(raw, { admin: true });
    await inviteAlumnus(db, "alex@firm.com", "Alex", adminId, NOW);
    const [{ id }] = all<{ id: string }>(raw, `SELECT id FROM alumni_invites`);
    run(raw, `UPDATE alumni_invites SET accepted_at = ? WHERE id = ?`, NOW.toISOString(), id);
    expect(await getPendingAlumniInvite(db, id)).toBeNull();
    await cancelAlumniInvite(db, id);
    expect(all(raw, `SELECT count(*) AS n FROM alumni_invites`)[0].n).toBe(1);
  });
});
