import type { D1Database } from "@/lib/db/d1";
import type { R2BucketLike } from "@/lib/db/storage";
import {
  imageContentType,
  imageExtension,
  imageKindFromBytes,
  isPdfHeader,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  PDF_CONTENT_TYPE,
} from "@/lib/files";
import { isPackagePdfPath, isPhotoPath } from "@/lib/storage-paths";

/**
 * Headshots and resumes are uploaded on auth.quantt.ca (the member directory).
 * Each member chooses on their Connect profile whether the hub keeps in step
 * with it ("Keep in sync", on unless they turn it off):
 *
 * - On: whenever the directory has a newer upload than the one last copied,
 *   the hub copies it into the member's profile (headshot) and documents
 *   (resume). Checked at sign-in, when they open their profile, and hourly
 *   (worker.js). While on, the hub's own photo and resume uploads are locked so
 *   the two sites can't disagree; the cover letter is never synced.
 * - Off: nothing is copied; the member uploads their own files here.
 *
 * Nothing is ever deleted: a copy goes to a fresh R2 key and only the profile's
 * pointer moves, so earlier files (and application snapshots) stay where they
 * were. A file removed from the directory leaves the hub's copy in place.
 * Each member's copies come only from their own directory entry, matched by
 * their sign-in email, and land only under their own profile id.
 */
export type DirectoryFile = { type: string; data: ArrayBuffer; updated?: string };
export type DirectoryStamps = { photo: string | null; resume: string | null };

export type DirectoryFiles = {
  photo?(who: string): Promise<DirectoryFile | null>;
  resume?(who: string): Promise<DirectoryFile | null>;
  /** Upload times only (no bytes). Older auth Workers don't have it. */
  files?(who: string): Promise<DirectoryStamps | null>;
};

type Kind = "photo" | "resume";

export const DIRECTORY_SYNC_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS directory_sync (
  profile_id text PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  enabled integer NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  photo_stamp text,
  resume_stamp text,
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`,
];

let ready = false;
export async function ensureDirectorySyncTable(db: D1Database) {
  if (ready) return;
  await db.batch(DIRECTORY_SYNC_SCHEMA.map((s) => db.prepare(s)));
  ready = true;
}

type SyncRow = { enabled: number; photo_stamp: string | null; resume_stamp: string | null };

/** Whether the member keeps their hub files in sync with the directory (default on). */
export async function getDirectorySync(db: D1Database, profileId: string): Promise<boolean> {
  await ensureDirectorySyncTable(db);
  const row = await db
    .prepare(`SELECT enabled FROM directory_sync WHERE profile_id = ?`)
    .bind(profileId)
    .first<{ enabled: number }>();
  return row ? row.enabled === 1 : true;
}

/**
 * Turns sync on or off. Turning it on forgets what was last copied, so the
 * next sync copies the directory's current files even if they are older than
 * files the member uploaded here meanwhile.
 */
export async function setDirectorySync(db: D1Database, profileId: string, enabled: boolean, now = new Date()) {
  await ensureDirectorySyncTable(db);
  await db
    .prepare(
      `INSERT INTO directory_sync (profile_id, enabled, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at,
         photo_stamp = CASE WHEN excluded.enabled = 1 THEN NULL ELSE photo_stamp END,
         resume_stamp = CASE WHEN excluded.enabled = 1 THEN NULL ELSE resume_stamp END`,
    )
    .bind(profileId, enabled ? 1 : 0, now.toISOString())
    .run();
}

async function stamps(auth: DirectoryFiles, email: string): Promise<DirectoryStamps | undefined> {
  if (!auth.files) return undefined;
  try {
    return (await auth.files(email)) ?? { photo: null, resume: null };
  } catch {
    // An auth Worker without files(): fall back to fetching the files themselves.
    return undefined;
  }
}

async function fetchFile(auth: DirectoryFiles, kind: Kind, email: string) {
  const get = auth[kind];
  return get ? await get(email).catch(() => null) : null;
}

async function copyPhoto(db: D1Database, files: R2BucketLike, profileId: string, f: DirectoryFile) {
  const bytes = f.data ? new Uint8Array(f.data) : null;
  const kind = bytes && bytes.byteLength <= MAX_IMAGE_BYTES ? imageKindFromBytes(bytes.subarray(0, 12)) : null;
  if (!bytes || !kind) return false;
  const path = `${profileId}/directory-${crypto.randomUUID().slice(0, 8)}.${imageExtension(kind)}`;
  if (!isPhotoPath(path, profileId)) return false;
  await files.put(`photos/${path}`, bytes, { httpMetadata: { contentType: imageContentType(kind) } });
  const r = await db
    .prepare(`UPDATE profiles SET photo_path = ? WHERE id = ? AND role = 'member'`)
    .bind(path, profileId)
    .run();
  return r.meta.changes > 0;
}

async function copyResume(db: D1Database, files: R2BucketLike, profileId: string, f: DirectoryFile) {
  const bytes = f.data ? new Uint8Array(f.data) : null;
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_BYTES || !isPdfHeader(bytes.subarray(0, 8))) return false;
  const path = `${profileId}/packages/${crypto.randomUUID()}/resume.pdf`;
  if (!isPackagePdfPath(path, profileId)) return false;
  await files.put(`resumes/${path}`, bytes, { httpMetadata: { contentType: PDF_CONTENT_TYPE } });
  const r = await db
    .prepare(
      `INSERT INTO member_documents (member_id, resume_path, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (member_id) DO UPDATE SET resume_path = excluded.resume_path, updated_at = excluded.updated_at`,
    )
    .bind(profileId, path, new Date().toISOString())
    .run();
  if (r.meta.changes > 0) return true;
  await files.delete(`resumes/${path}`);
  return false;
}

/**
 * Brings one member's hub headshot and resume up to date with the directory,
 * if they keep sync on. Returns which files were copied.
 */
export async function syncDirectoryFiles(
  db: D1Database,
  files: R2BucketLike,
  auth: DirectoryFiles,
  profileId: string,
  email: string,
): Promise<{ photo: boolean; resume: boolean }> {
  const out = { photo: false, resume: false };
  const profile = await db
    .prepare(`SELECT 1 AS x FROM profiles WHERE id = ? AND role = 'member'`)
    .bind(profileId)
    .first();
  if (!profile) return out;
  await ensureDirectorySyncTable(db);
  const row = await db
    .prepare(`SELECT enabled, photo_stamp, resume_stamp FROM directory_sync WHERE profile_id = ?`)
    .bind(profileId)
    .first<SyncRow>();
  if (row && row.enabled !== 1) return out;

  const known = await stamps(auth, email);
  for (const kind of ["photo", "resume"] as const) {
    const last = row?.[`${kind}_stamp`] ?? null;
    // Known upload time: skip when it's what we copied last, or when nothing is on file.
    if (known && (!known[kind] || known[kind] === last)) continue;
    const f = await fetchFile(auth, kind, email);
    if (!f) continue;
    const stamp = f.updated ?? known?.[kind] ?? null;
    if (stamp && stamp === last) continue;
    const copied = kind === "photo" ? await copyPhoto(db, files, profileId, f) : await copyResume(db, files, profileId, f);
    if (!copied) continue;
    out[kind] = true;
    // Without an upload time there is nothing to compare later; remember "copied" so it isn't re-copied every hour.
    await db
      .prepare(
        `INSERT INTO directory_sync (profile_id, ${kind}_stamp, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (profile_id) DO UPDATE SET ${kind}_stamp = excluded.${kind}_stamp, updated_at = excluded.updated_at
         WHERE directory_sync.enabled = 1`,
      )
      .bind(profileId, stamp ?? "copied", new Date().toISOString())
      .run();
  }
  return out;
}

/** The hourly pass (worker.js): every member who keeps sync on. */
export async function syncAllDirectoryFiles(db: D1Database, files: R2BucketLike, auth: DirectoryFiles) {
  await ensureDirectorySyncTable(db);
  const { results } = await db
    .prepare(
      `SELECT p.id, p.email FROM profiles p LEFT JOIN directory_sync s ON s.profile_id = p.id
       WHERE p.role = 'member' AND COALESCE(s.enabled, 1) = 1`,
    )
    .all<{ id: string; email: string }>();
  let photos = 0, resumes = 0, failed = 0;
  for (const m of results ?? []) {
    try {
      const r = await syncDirectoryFiles(db, files, auth, m.id, m.email);
      photos += r.photo ? 1 : 0;
      resumes += r.resume ? 1 : 0;
    } catch (e) {
      failed++;
      console.warn("directory sync failed for a member", e instanceof Error ? e.message : e);
    }
  }
  return { members: results?.length ?? 0, photos, resumes, failed };
}
