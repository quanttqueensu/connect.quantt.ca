import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import {
  DIRECTORY_SYNC_SCHEMA,
  getDirectorySync,
  pushToDirectory,
  setDirectorySync,
  syncAllDirectoryFiles,
  syncDirectoryFiles,
} from "@/lib/directory-files";

import { addMember, asD1, freshDb, run } from "./db/sqlite";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5, 6, 7]).buffer;
const pdf = new TextEncoder().encode("%PDF-1.7 resume").buffer;

function bucket() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  return {
    objects,
    async get() { return null; },
    async head() { return null; },
    async put(key: string, value: unknown, o?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { bytes: value as Uint8Array, type: o?.httpMetadata?.contentType });
    },
    async delete(keys: string | string[]) { for (const k of [keys].flat()) objects.delete(k); },
  };
}
type Store = { photo: ArrayBuffer | null; resume: ArrayBuffer | null; photoAt: string | null; resumeAt: string | null };
/** A fake auth Directory for ann@queensu.ca; `fetched` counts file downloads. */
function auth(photo: ArrayBuffer | null, resume: ArrayBuffer | null, opts: { stamps?: boolean } = {}) {
  const st: Store = { photo, resume, photoAt: photo ? "2026-11-01T00:00:00.000Z" : null, resumeAt: resume ? "2026-11-01T00:00:00.000Z" : null };
  const fetched = { photo: 0, resume: 0 };
  const mine = (who: string) => who === "ann@queensu.ca";
  return {
    st,
    fetched,
    photo: async (who: string) => { fetched.photo++; return mine(who) && st.photo ? { type: "image/jpeg", data: st.photo, updated: st.photoAt! } : null; },
    resume: async (who: string) => { fetched.resume++; return mine(who) && st.resume ? { type: "application/pdf", data: st.resume, updated: st.resumeAt! } : null; },
    ...(opts.stamps === false ? {} : { files: async (who: string) => (mine(who) ? { photo: st.photoAt, resume: st.resumeAt } : null) }),
  };
}
function setup() {
  const raw = freshDb();
  const id = addMember(raw, { email: "ann@queensu.ca" });
  return { raw, db: asD1(raw), id };
}
const row = (raw: ReturnType<typeof freshDb>, sql: string, ...args: string[]) =>
  raw.prepare(sql).get(...args) as Record<string, unknown> | undefined;
const photoPath = (raw: ReturnType<typeof freshDb>, id: string) => row(raw, `SELECT photo_path FROM profiles WHERE id = ?`, id)?.photo_path as string | null;
const resumePath = (raw: ReturnType<typeof freshDb>, id: string) => row(raw, `SELECT resume_path FROM member_documents WHERE member_id = ?`, id)?.resume_path as string | null;

describe("syncing directory headshots and resumes", () => {
  it("is on by default and fills an empty profile with both", async () => {
    const { raw, db, id } = setup();
    const r2 = bucket();
    expect(await getDirectorySync(db, id)).toBe(true);
    expect(await syncDirectoryFiles(db, r2, auth(jpeg, pdf), id, "ann@queensu.ca")).toEqual({ photo: true, resume: true });
    expect(photoPath(raw, id)).toMatch(new RegExp(`^${id}/directory-[0-9a-f]{8}\\.jpg$`));
    expect(r2.objects.get(`photos/${photoPath(raw, id)}`)?.type).toBe("image/jpeg");
    expect(resumePath(raw, id)).toMatch(new RegExp(`^${id}/packages/[0-9a-f-]{36}/resume\\.pdf$`));
    expect(r2.objects.get(`resumes/${resumePath(raw, id)}`)?.type).toBe("application/pdf");
  });

  it("copies only when the directory has a newer upload, and never deletes earlier files", async () => {
    const { raw, db, id } = setup();
    run(raw, `UPDATE profiles SET photo_path = ? WHERE id = ?`, `${id}/photo.png`, id);
    run(raw, `INSERT INTO member_documents (member_id, resume_path, cover_letter_path) VALUES (?, ?, ?)`, id, `${id}/packages/old/resume.pdf`, `${id}/packages/old/cover.pdf`);
    const r2 = bucket();
    const a = auth(jpeg, pdf);
    await syncDirectoryFiles(db, r2, a, id, "ann@queensu.ca");
    const first = { photo: photoPath(raw, id), resume: resumePath(raw, id) };
    expect(first.photo).not.toBe(`${id}/photo.png`);
    expect(row(raw, `SELECT cover_letter_path FROM member_documents WHERE member_id = ?`, id)?.cover_letter_path).toBe(`${id}/packages/old/cover.pdf`);

    // Nothing new: no downloads, nothing changes.
    a.fetched.photo = a.fetched.resume = 0;
    expect(await syncDirectoryFiles(db, r2, a, id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
    expect(a.fetched).toEqual({ photo: 0, resume: 0 });

    // A new headshot on auth: only the photo is copied, the earlier copy stays in R2.
    a.st.photoAt = "2026-11-02T00:00:00.000Z";
    expect(await syncDirectoryFiles(db, r2, a, id, "ann@queensu.ca")).toEqual({ photo: true, resume: false });
    expect(photoPath(raw, id)).not.toBe(first.photo);
    expect(r2.objects.has(`photos/${first.photo}`)).toBe(true);
    expect(resumePath(raw, id)).toBe(first.resume);
    expect(r2.objects.size).toBe(3);

    // Removed on auth: the hub keeps its copy.
    a.st.photo = null; a.st.photoAt = null;
    expect(await syncDirectoryFiles(db, r2, a, id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
    expect(photoPath(raw, id)).not.toBeNull();
  });

  it("does nothing while the member has sync off, and catches up when they turn it back on", async () => {
    const { raw, db, id } = setup();
    run(raw, `UPDATE profiles SET photo_path = ? WHERE id = ?`, `${id}/photo.png`, id);
    const r2 = bucket();
    await setDirectorySync(db, id, false);
    expect(await getDirectorySync(db, id)).toBe(false);
    expect(await syncDirectoryFiles(db, r2, auth(jpeg, pdf), id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
    expect(await syncAllDirectoryFiles(db, r2, auth(jpeg, pdf))).toMatchObject({ members: 0 });
    expect(photoPath(raw, id)).toBe(`${id}/photo.png`);
    expect(r2.objects.size).toBe(0);

    await setDirectorySync(db, id, true);
    expect(await syncDirectoryFiles(db, r2, auth(jpeg, pdf), id, "ann@queensu.ca")).toEqual({ photo: true, resume: true });
  });

  it("re-copies after sync is turned off and on, even with no new upload", async () => {
    const { db, id } = setup();
    const r2 = bucket();
    const a = auth(jpeg, null);
    await syncDirectoryFiles(db, r2, a, id, "ann@queensu.ca");
    await setDirectorySync(db, id, false);
    await setDirectorySync(db, id, true);
    expect(await syncDirectoryFiles(db, r2, a, id, "ann@queensu.ca")).toEqual({ photo: true, resume: false });
  });

  it("works with an auth Worker that has no files() yet, using each file's upload time", async () => {
    const { db, id } = setup();
    const r2 = bucket();
    const a = auth(jpeg, pdf, { stamps: false });
    expect(await syncDirectoryFiles(db, r2, a, id, "ann@queensu.ca")).toEqual({ photo: true, resume: true });
    expect(await syncDirectoryFiles(db, r2, a, id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
  });

  it("ignores files that aren't what they claim, and members with nothing on file", async () => {
    const { db, id } = setup();
    const r2 = bucket();
    const html = new TextEncoder().encode("<html>").buffer;
    expect(await syncDirectoryFiles(db, r2, auth(html, html), id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
    expect(await syncDirectoryFiles(db, r2, auth(null, null), id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
    expect(await syncDirectoryFiles(db, r2, {}, id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
    expect(r2.objects.size).toBe(0);
  });

  it("copies each member's own files only, and skips company accounts", async () => {
    const { raw, db, id } = setup();
    const bob = addMember(raw, { email: "bob@queensu.ca" });
    const r2 = bucket();
    expect(await syncAllDirectoryFiles(db, r2, auth(jpeg, pdf))).toEqual({ members: 2, photos: 1, resumes: 1, failed: 0 });
    expect(photoPath(raw, bob)).toBeNull();
    expect([...r2.objects.keys()].every((k) => k.includes(`/${id}/`))).toBe(true);
    run(raw, `UPDATE profiles SET role = 'company_user' WHERE id = ?`, id);
    expect(await syncDirectoryFiles(db, bucket(), auth(jpeg, pdf), id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
  });

  it("sends a Connect upload to the directory and copies it back", async () => {
    const { raw, db, id } = setup();
    const r2 = bucket();
    const a = auth(null, null);
    const sent: unknown[] = [];
    const withUpload = {
      ...a,
      upload: async (email: string, kind: "photo" | "resume", data: ArrayBuffer, name: string) => {
        sent.push([email, kind, name]);
        if (kind === "photo") { a.st.photo = data; a.st.photoAt = "2026-11-05T00:00:00.000Z"; }
        else { a.st.resume = data; a.st.resumeAt = "2026-11-05T00:00:00.000Z"; }
      },
    };
    expect(await pushToDirectory(db, r2, withUpload, id, "ann@queensu.ca", "resume", pdf, "cv.pdf")).toEqual({ photo: false, resume: true });
    expect(sent).toEqual([["ann@queensu.ca", "resume", "cv.pdf"]]);
    expect(resumePath(raw, id)).toMatch(/\/resume\.pdf$/);
    await pushToDirectory(db, r2, withUpload, id, "ann@queensu.ca", "photo", jpeg, "me.jpg");
    expect(photoPath(raw, id)).toMatch(/directory-[0-9a-f]{8}\.jpg$/);
  });

  it("refuses a Connect upload when the auth Worker can't take one yet", async () => {
    const { db, id } = setup();
    await expect(pushToDirectory(db, bucket(), auth(null, null), id, "ann@queensu.ca", "photo", jpeg, "x.jpg")).rejects.toThrow(/can't take uploads/);
  });

  it("matches the migration", () => {
    const sql = readFileSync("db/migrations/0007_directory_sync.sql", "utf8");
    for (const stmt of DIRECTORY_SYNC_SCHEMA) expect(sql).toContain(stmt.trim());
  });
});
