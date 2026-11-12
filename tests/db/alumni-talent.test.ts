import { describe, expect, it } from "vitest";

import { alumniResumeBook, memberPhotoPathForAlumni, memberResumePathForAlumni } from "@/lib/alumni/talent";
import { listMembersForAlumni } from "@/lib/alumni/data";

import { addMember, addResume, all, asD1, freshDb, NOW, run } from "./sqlite";

describe("alumni see member headshots and the resume book", () => {
  it("shows opted-in members with a resume, and every current member's headshot", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    const inBook = addMember(raw, { optInAt: NOW.toISOString() });
    const noOptIn = addMember(raw);
    const noResume = addMember(raw, { optInAt: NOW.toISOString() });
    addResume(raw, inBook);
    addResume(raw, noOptIn);
    run(raw, `UPDATE profiles SET photo_path = ? WHERE id = ?`, `${noOptIn}/directory-1.jpg`, noOptIn);
    run(raw, `UPDATE profiles SET photo_path = ? WHERE id = ?`, `../evil.jpg`, inBook);

    expect((await alumniResumeBook(db)).map((m) => m.id)).toEqual([inBook]);
    expect(await memberResumePathForAlumni(db, inBook)).toBe(`${inBook}/packages/main/resume.pdf`);
    expect(await memberResumePathForAlumni(db, noOptIn)).toBeNull();
    expect(await memberResumePathForAlumni(db, noResume)).toBeNull();

    expect(await memberPhotoPathForAlumni(db, noOptIn)).toBe(`${noOptIn}/directory-1.jpg`);
    expect(await memberPhotoPathForAlumni(db, inBook)).toBeNull(); // bad path

    const cards = await listMembersForAlumni(db, { kind: "alumni", id: "a" });
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(byId[inBook]).toMatchObject({ in_book: 1 });
    expect(byId[noOptIn]).toMatchObject({ in_book: 0, has_photo: 1 });
    expect(byId[noResume]).toMatchObject({ in_book: 0, has_photo: 0 });
  });

  it("drops graduated members and non-members", async () => {
    const raw = freshDb();
    const db = asD1(raw);
    const grad = addMember(raw, { optInAt: NOW.toISOString() });
    addResume(raw, grad);
    expect(await alumniResumeBook(db, { gradYear: 1999 })).toEqual([]);
    expect((await alumniResumeBook(db)).length).toBe(1);
    await listMembersForAlumni(db, { kind: "alumni", id: "a" }); // creates alumni tables
    run(raw, `INSERT INTO alumni (id, email, full_name) VALUES ('x', 'grad@home.com', 'Grad')`);
    run(raw, `INSERT INTO alumni_graduation (alumni_id, auth_id, profile_id) VALUES ('x', 'auth-1', ?)`, grad);
    expect(await alumniResumeBook(db)).toEqual([]);
    expect(await memberResumePathForAlumni(db, grad)).toBeNull();
  });
});

describe("migration 0014: resume book is opt-out", () => {
  it("opts in existing members who never chose, but not graduates or sponsors", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const raw = freshDb();
    const db = asD1(raw);
    const never = addMember(raw);
    const already = addMember(raw, { optInAt: "2026-09-01T00:00:00.000Z" });
    const grad = addMember(raw);
    await listMembersForAlumni(db, { kind: "alumni", id: "a" }); // creates alumni tables
    run(raw, `INSERT INTO alumni (id, email, full_name) VALUES ('x', 'grad@home.com', 'Grad')`);
    run(raw, `INSERT INTO alumni_graduation (alumni_id, auth_id, profile_id) VALUES ('x', 'auth-1', ?)`, grad);
    raw.exec(readFileSync(resolve(__dirname, "../../db/migrations/0014_resume_book_opt_out.sql"), "utf8"));
    const rows = Object.fromEntries(
      all(raw, `SELECT id, resume_book_opt_in, resume_book_opt_in_at FROM profiles`).map((r) => [r.id, r]),
    );
    expect(rows[never]).toMatchObject({ resume_book_opt_in: 1 });
    expect(rows[never].resume_book_opt_in_at).toBeTruthy();
    expect(rows[already]).toMatchObject({ resume_book_opt_in: 1, resume_book_opt_in_at: "2026-09-01T00:00:00.000Z" });
    expect(rows[grad]).toMatchObject({ resume_book_opt_in: 0 });
  });
});
