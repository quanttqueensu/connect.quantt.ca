import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { canAlumniSignIn } from "@/lib/alumni/auth";
import { graduatedProfileIds, remindPersonalEmail, syncGraduates, type AuthAlum, type GraduateAuth } from "@/lib/alumni/graduates";
import { listAlumni, listMembersForAlumni } from "@/lib/alumni/data";
import { ALUMNI_GRADUATION_SCHEMA } from "@/lib/alumni/schema";

import { addMember, all, asD1, freshDb, NOW, run } from "./sqlite";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const pdf = new TextEncoder().encode("%PDF-1.7 resume");

function r2() {
  const m = new Map<string, Uint8Array>();
  return {
    m,
    async get(k: string) {
      const v = m.get(k);
      return v ? { arrayBuffer: async () => v.slice().buffer, body: new Blob([v.slice().buffer as ArrayBuffer]).stream(), size: v.byteLength } : null;
    },
    async head(k: string) { const v = m.get(k); return v ? { size: v.byteLength } : null; },
    async put(k: string, v: ArrayBuffer | Uint8Array) { m.set(k, new Uint8Array(v as ArrayBuffer)); },
    async delete(k: string | string[]) { for (const x of [k].flat()) m.delete(x); },
  };
}

function alum(over: Partial<AuthAlum> = {}): AuthAlum {
  return { id: "m_ann", name: "Ann Lee", team: "Quantitative Research", gradYear: 2027, personal: "ann@gmail.com", emails: ["ann@queensu.ca"], graduated: NOW.toISOString(), discord: "999", files: { photo: "t1", resume: "t2" }, ...over };
}
function authWith(list: AuthAlum[]): GraduateAuth & { list: AuthAlum[] } {
  const a = {
    list,
    async alumni() { return a.list; },
    async alumFile(_id: string, kind: "photo" | "resume") { return { type: kind === "photo" ? "image/jpeg" : "application/pdf", data: (kind === "photo" ? jpeg : pdf).slice().buffer }; },
    async missingPersonal() { return [{ id: "m_bo", name: "Bo", email: "bo@queensu.ca", gradYear: 2027 }]; },
  };
  return a;
}

function setup() {
  const raw = freshDb();
  const pid = addMember(raw, { email: "ann@queensu.ca", optInAt: "2026-10-01T00:00:00.000Z" });
  run(raw, `UPDATE profiles SET full_name = 'Ann Lee', program = 'Comm', bio = 'Hi', linkedin_url = 'https://linkedin.com/in/ann' WHERE id = ?`, pid);
  const other = addMember(raw);
  return { raw, db: asD1(raw), pid, other };
}

describe("graduation schema", () => {
  it("matches db/migrations/0011_alumni_graduation.sql exactly", () => {
    const sql = readFileSync(resolve(__dirname, "../../db/migrations/0011_alumni_graduation.sql"), "utf8");
    for (const stmt of ALUMNI_GRADUATION_SCHEMA) expect(sql).toContain(stmt.replace("${NOW}", "").trim().slice(0, 40));
  });
});

describe("graduates become alumni", () => {
  it("makes an alumni account from the member profile, copies files, hides the member, and undo suspends it", async () => {
    const { raw, db, pid, other } = setup();
    const files = r2();
    const auth = authWith([alum()]);
    const sent: string[] = [];
    const r = await syncGraduates(db, files, auth, async (to) => void sent.push(to), NOW);
    expect(r).toMatchObject({ created: 1, suspended: 0 });
    expect(sent).toEqual(["ann@gmail.com"]);
    const [a] = all<{ id: string; full_name: string; grad_year: number; program: string; bio: string; linkedin_url: string }>(raw, `SELECT * FROM alumni`);
    expect(a).toMatchObject({ full_name: "Ann Lee", grad_year: 2027, program: "Comm", bio: "Hi", linkedin_url: "https://linkedin.com/in/ann" });
    expect([...files.m.keys()].some((k) => k.startsWith(`photos/alumni/${a.id}/`))).toBe(true);
    expect([...files.m.keys()].some((k) => k.startsWith(`resumes/alumni/${a.id}/`))).toBe(true);
    expect(await canAlumniSignIn(db, "ann@gmail.com")).toBe(true);
    expect((await listAlumni(db))[0].has_photo).toBe(1);
    expect(await graduatedProfileIds(db)).toEqual([pid]);
    expect(all(raw, `SELECT resume_book_opt_in FROM profiles WHERE id = ?`, pid)[0]).toEqual({ resume_book_opt_in: 0 });
    expect(all(raw, `SELECT discord_id FROM alumni_discord`)).toEqual([{ discord_id: "999" }]);
    const seen = (await listMembersForAlumni(db, { kind: "alumni", id: a.id })).map((m) => m.id);
    expect(seen).toContain(other);
    expect(seen).not.toContain(pid);

    // Running again changes nothing and sends nothing.
    expect(await syncGraduates(db, files, auth, async (to) => void sent.push(to), NOW)).toMatchObject({ created: 0, linked: 0, reactivated: 0 });
    expect(sent.length).toBe(1);

    // "Make member again" on auth: suspended, member profile and resume book back, nothing deleted.
    auth.list = [];
    expect(await syncGraduates(db, files, auth, async () => {}, NOW)).toMatchObject({ suspended: 1 });
    expect(await canAlumniSignIn(db, "ann@gmail.com")).toBe(false);
    expect(await listAlumni(db)).toEqual([]);
    expect(await graduatedProfileIds(db)).toEqual([]);
    expect(all(raw, `SELECT resume_book_opt_in FROM profiles WHERE id = ?`, pid)[0]).toEqual({ resume_book_opt_in: 1 });
    expect(all(raw, `SELECT count(*) AS n FROM alumni`)[0]).toEqual({ n: 1 });

    // Graduates again a year later: same account comes back.
    auth.list = [alum({ gradYear: 2028 })];
    expect(await syncGraduates(db, files, auth, async () => {}, NOW)).toMatchObject({ reactivated: 1, created: 0 });
    expect(await canAlumniSignIn(db, "ann@gmail.com")).toBe(true);
    expect(await graduatedProfileIds(db)).toEqual([pid]);
  });

  it("waits for a personal email, and links an alum an admin already invited", async () => {
    const { raw, db } = setup();
    const auth = authWith([alum({ personal: null })]);
    expect(await syncGraduates(db, r2(), auth, async () => {}, NOW)).toMatchObject({ created: 0, waiting: ["Ann Lee"] });
    run(raw, `INSERT INTO alumni (id, email, full_name) VALUES ('a_old', 'ann@gmail.com', 'Ann')`);
    auth.list = [alum()];
    const sent: string[] = [];
    expect(await syncGraduates(db, r2(), auth, async (to) => void sent.push(to), NOW)).toMatchObject({ linked: 1, created: 0 });
    expect(sent).toEqual([]);
    expect(all(raw, `SELECT alumni_id FROM alumni_graduation`)).toEqual([{ alumni_id: "a_old" }]);
  });

  it("sends the April reminder once per member, only in April", async () => {
    const { db } = setup();
    const auth = authWith([]);
    const to: string[] = [];
    const send = async (t: string) => void to.push(t);
    expect(await remindPersonalEmail(db, auth, send, new Date("2027-03-31T12:00:00Z"))).toBe(0);
    expect(await remindPersonalEmail(db, auth, send, new Date("2027-04-01T12:00:00Z"))).toBe(1);
    expect(await remindPersonalEmail(db, auth, send, new Date("2027-04-02T12:00:00Z"))).toBe(0);
    expect(to).toEqual(["bo@queensu.ca"]);
  });
});
