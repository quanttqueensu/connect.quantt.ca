import { describe, expect, it } from "vitest";

import {
  addApplication,
  addCompany,
  addMember,
  addPost,
  all,
  freshDb,
  NOW,
  run,
  TIER,
  uuid,
} from "./sqlite";

describe("D1 schema", () => {
  it("applies cleanly with the sponsor catalogue", () => {
    const db = freshDb();
    expect(all(db, "SELECT key FROM sponsor_tiers ORDER BY rank").map((r) => r.key)).toEqual([
      "none", "supporter", "partner", "leader", "principal", "grandfathered",
    ]);
    expect(all(db, "SELECT count(*) AS n FROM sponsor_capabilities")[0].n).toBe(7);
    expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("only members can be admins or opt into the resume book", () => {
    const db = freshDb();
    expect(() =>
      run(db, `INSERT INTO profiles (id, email, role, is_admin) VALUES (?, 'a@firm.dev', 'company_user', 1)`, uuid()),
    ).toThrow(/admin_is_member|CHECK/);
    expect(() =>
      run(db, `INSERT INTO profiles (id, email, role, resume_book_opt_in) VALUES (?, 'b@firm.dev', 'company_user', 1)`, uuid()),
    ).toThrow(/CHECK/);
  });

  it("treats emails case-insensitively for profiles and pending invites", () => {
    const db = freshDb();
    addMember(db, { email: "Jane@Queensu.ca" });
    expect(() =>
      run(db, `INSERT INTO profiles (id, email, role) VALUES (?, 'jane@queensu.ca', 'member')`, uuid()),
    ).toThrow(/UNIQUE/);
    run(db, `INSERT INTO invites (id, email, role) VALUES (?, 'New@Club.dev', 'member')`, uuid());
    expect(() =>
      run(db, `INSERT INTO invites (id, email, role) VALUES (?, 'new@club.dev', 'member')`, uuid()),
    ).toThrow(/UNIQUE/);
  });

  it("keeps one pending join request per contact email", () => {
    const db = freshDb();
    const insert = (email: string) =>
      run(
        db,
        `INSERT INTO company_join_requests (id, company_name, contact_name, contact_email) VALUES (?, 'Acme', 'Ann', ?)`,
        uuid(),
        email,
      );
    insert("ann@acme.com");
    expect(() => insert("ANN@acme.com")).toThrow(/UNIQUE/);
    run(db, `UPDATE company_join_requests SET status = 'rejected'`);
    insert("ann@acme.com");
  });

  it("locks an application's snapshot but lets the stage move", () => {
    const db = freshDb();
    const member = addMember(db);
    const firm = addCompany(db, "partner");
    const post = addPost(db, firm.companyId, firm.userId);
    const app = addApplication(db, member, post, NOW.toISOString());

    expect(() => run(db, `UPDATE applications SET resume_path = 'snapshots/x/resume.pdf' WHERE id = ?`, app)).toThrow(
      /snapshot cannot be changed/,
    );
    expect(() => run(db, `UPDATE applications SET company_id = NULL WHERE id = ?`, app)).toThrow(/snapshot/);
    run(db, `UPDATE applications SET stage = 'reviewing' WHERE id = ?`, app);
    const row = all(db, `SELECT stage, updated_at FROM applications WHERE id = ?`, app)[0];
    expect(row.stage).toBe("reviewing");
    expect(row.updated_at).not.toBe(NOW.toISOString());
  });

  it("requires in-app applications to point at their own snapshot", () => {
    const db = freshDb();
    const member = addMember(db);
    const firm = addCompany(db, "partner");
    const post = addPost(db, firm.companyId, firm.userId);
    const id = uuid();
    expect(() =>
      run(
        db,
        `INSERT INTO applications (id, member_id, kind, post_id, resume_path) VALUES (?, ?, 'in_app', ?, ?)`,
        id, member, post, `${member}/packages/x/resume.pdf`,
      ),
    ).toThrow(/CHECK/);
    expect(() =>
      run(db, `INSERT INTO applications (id, member_id, kind) VALUES (?, ?, 'off_platform')`, uuid(), member),
    ).toThrow(/CHECK/);
  });

  it("allows one application per member per job", () => {
    const db = freshDb();
    const member = addMember(db);
    const firm = addCompany(db, "partner");
    const post = addPost(db, firm.companyId, firm.userId);
    addApplication(db, member, post, NOW.toISOString());
    expect(() => addApplication(db, member, post, NOW.toISOString())).toThrow(/UNIQUE/);
  });

  it("keeps one default hiring package per member", () => {
    const db = freshDb();
    const member = addMember(db);
    const add = (isDefault: number) => {
      const id = uuid();
      run(
        db,
        `INSERT INTO hiring_packages (id, member_id, name, linkedin_url, resume_path, is_default) VALUES (?, ?, 'P', 'https://l', ?, ?)`,
        id, member, `${member}/packages/${id.slice(-6)}/resume.pdf`, isDefault,
      );
      return id;
    };
    const a = add(1);
    const b = add(1);
    expect(all(db, `SELECT id FROM hiring_packages WHERE is_default = 1`).map((r) => r.id)).toEqual([b]);
    run(db, `UPDATE hiring_packages SET is_default = 1 WHERE id = ?`, a);
    expect(all(db, `SELECT id FROM hiring_packages WHERE is_default = 1`).map((r) => r.id)).toEqual([a]);
  });

  it("protects the system tiers", () => {
    const db = freshDb();
    expect(() => run(db, `DELETE FROM sponsor_tiers WHERE id = ?`, TIER.none)).toThrow(/required/);
    expect(() => run(db, `UPDATE sponsor_tiers SET is_active = 1 WHERE id = ?`, TIER.grandfathered)).toThrow(
      /cannot change/,
    );
    run(db, `UPDATE sponsor_tiers SET blurb = 'x' WHERE id = ?`, TIER.none);
  });

  it("refuses to delete a tier a firm is on", () => {
    const db = freshDb();
    addCompany(db, "partner");
    expect(() => run(db, `DELETE FROM sponsor_tiers WHERE id = ?`, TIER.partner)).toThrow(/FOREIGN KEY/);
  });

  it("keeps conversation participants fixed", () => {
    const db = freshDb();
    const member = addMember(db);
    const other = addMember(db);
    const firm = addCompany(db, "partner");
    const id = uuid();
    run(db, `INSERT INTO conversations (id, member_id, company_id) VALUES (?, ?, ?)`, id, member, firm.companyId);
    expect(() => run(db, `UPDATE conversations SET member_id = ? WHERE id = ?`, other, id)).toThrow(/cannot be changed/);
    run(db, `UPDATE conversations SET member_last_read_at = ? WHERE id = ?`, NOW.toISOString(), id);
  });

  it("clears the consent stamp when a member opts out", () => {
    const db = freshDb();
    const member = addMember(db, { optInAt: NOW.toISOString() });
    run(db, `UPDATE profiles SET resume_book_opt_in = 0 WHERE id = ?`, member);
    expect(all(db, `SELECT resume_book_opt_in_at, resume_book_opt_in_by FROM profiles WHERE id = ?`, member)[0]).toEqual({
      resume_book_opt_in_at: null,
      resume_book_opt_in_by: null,
    });
  });

  it("cascades a deleted firm to its users, posts and conversations", () => {
    const db = freshDb();
    const member = addMember(db);
    const firm = addCompany(db, "partner");
    addPost(db, firm.companyId, firm.userId, { kind: "announcement" });
    run(db, `INSERT INTO conversations (id, member_id, company_id) VALUES (?, ?, ?)`, uuid(), member, firm.companyId);
    run(db, `DELETE FROM companies WHERE id = ?`, firm.companyId);
    expect(all(db, `SELECT count(*) AS n FROM company_users`)[0].n).toBe(0);
    expect(all(db, `SELECT count(*) AS n FROM posts`)[0].n).toBe(0);
    expect(all(db, `SELECT count(*) AS n FROM conversations`)[0].n).toBe(0);
  });
});
