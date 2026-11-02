import { describe, expect, it } from "vitest";

import { copyDirectoryFiles } from "@/lib/directory-files";

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
const auth = (photo: ArrayBuffer | null, resume: ArrayBuffer | null) => ({
  photo: async () => (photo ? { type: "image/jpeg", data: photo } : null),
  resume: async () => (resume ? { type: "application/pdf", data: resume } : null),
});
function setup() {
  const raw = freshDb();
  const id = addMember(raw, { email: "ann@queensu.ca" });
  return { raw, db: asD1(raw), id };
}
const row = (raw: ReturnType<typeof freshDb>, sql: string, ...args: string[]) =>
  raw.prepare(sql).get(...args) as Record<string, unknown> | undefined;

describe("copying directory headshots and resumes", () => {
  it("fills an empty profile with both", async () => {
    const { raw, db, id } = setup();
    const r2 = bucket();
    expect(await copyDirectoryFiles(db, r2, auth(jpeg, pdf), id, "ann@queensu.ca")).toEqual({ photo: true, resume: true });
    expect(row(raw, `SELECT photo_path FROM profiles WHERE id = ?`, id)?.photo_path).toBe(`${id}/photo.jpg`);
    expect(r2.objects.get(`photos/${id}/photo.jpg`)?.type).toBe("image/jpeg");
    const path = row(raw, `SELECT resume_path FROM member_documents WHERE member_id = ?`, id)?.resume_path as string;
    expect(path).toMatch(new RegExp(`^${id}/packages/[0-9a-f-]{36}/resume\\.pdf$`));
    expect(r2.objects.get(`resumes/${path}`)?.type).toBe("application/pdf");
  });

  it("never replaces a photo or documents the member already has, or put back a removed resume", async () => {
    const { raw, db, id } = setup();
    run(raw, `UPDATE profiles SET photo_path = ? WHERE id = ?`, `${id}/photo.png`, id);
    run(raw, `INSERT INTO member_documents (member_id, resume_path) VALUES (?, NULL)`, id);
    const r2 = bucket();
    expect(await copyDirectoryFiles(db, r2, auth(jpeg, pdf), id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
    expect(r2.objects.size).toBe(0);
    expect(row(raw, `SELECT photo_path FROM profiles WHERE id = ?`, id)?.photo_path).toBe(`${id}/photo.png`);
  });

  it("ignores files that aren't what they claim, and members with nothing on file", async () => {
    const { db, id } = setup();
    const r2 = bucket();
    const html = new TextEncoder().encode("<html>").buffer;
    expect(await copyDirectoryFiles(db, r2, auth(html, html), id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
    expect(await copyDirectoryFiles(db, r2, auth(null, null), id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
    expect(await copyDirectoryFiles(db, r2, {}, id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
    expect(r2.objects.size).toBe(0);
  });

  it("skips company accounts", async () => {
    const { raw, db, id } = setup();
    run(raw, `UPDATE profiles SET role = 'company_user' WHERE id = ?`, id);
    expect(await copyDirectoryFiles(db, bucket(), auth(jpeg, pdf), id, "ann@queensu.ca")).toEqual({ photo: false, resume: false });
  });
});
