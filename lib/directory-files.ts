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
 * Headshots and resumes are uploaded once, on auth.quantt.ca (the member
 * directory). When a member signs in with QUANTT, their hub profile gets a
 * copy of each one it doesn't have yet:
 * - the headshot, when the profile has no photo;
 * - the resume, when the member has never saved hub documents (no
 *   member_documents row), so a resume they removed here is not put back.
 * The copies live in the hub's own R2 like any upload, so the member can
 * replace or remove them, and sponsors see the resume only under the usual
 * resume-book consent.
 */
export type DirectoryFile = { type: string; data: ArrayBuffer };

export type DirectoryFiles = {
  photo?(who: string): Promise<DirectoryFile | null>;
  resume?(who: string): Promise<DirectoryFile | null>;
};

export async function copyDirectoryFiles(
  db: D1Database,
  files: R2BucketLike,
  auth: DirectoryFiles,
  profileId: string,
  email: string,
): Promise<{ photo: boolean; resume: boolean }> {
  const out = { photo: false, resume: false };
  const profile = await db
    .prepare(`SELECT photo_path FROM profiles WHERE id = ? AND role = 'member'`)
    .bind(profileId)
    .first<{ photo_path: string | null }>();
  if (!profile) return out;

  if (!profile.photo_path && auth.photo) {
    const f = await auth.photo(email).catch(() => null);
    const bytes = f?.data ? new Uint8Array(f.data) : null;
    const kind = bytes && bytes.byteLength <= MAX_IMAGE_BYTES ? imageKindFromBytes(bytes.subarray(0, 12)) : null;
    if (bytes && kind) {
      const path = `${profileId}/photo.${imageExtension(kind)}`;
      if (isPhotoPath(path, profileId)) {
        await files.put(`photos/${path}`, bytes, { httpMetadata: { contentType: imageContentType(kind) } });
        const r = await db
          .prepare(`UPDATE profiles SET photo_path = ? WHERE id = ? AND photo_path IS NULL`)
          .bind(path, profileId)
          .run();
        out.photo = r.meta.changes > 0;
      }
    }
  }

  const docs = await db.prepare(`SELECT 1 AS x FROM member_documents WHERE member_id = ?`).bind(profileId).first();
  if (!docs && auth.resume) {
    const f = await auth.resume(email).catch(() => null);
    const bytes = f?.data ? new Uint8Array(f.data) : null;
    if (bytes && bytes.byteLength > 0 && bytes.byteLength <= MAX_PDF_BYTES && isPdfHeader(bytes.subarray(0, 8))) {
      const path = `${profileId}/packages/${crypto.randomUUID()}/resume.pdf`;
      if (isPackagePdfPath(path, profileId)) {
        await files.put(`resumes/${path}`, bytes, { httpMetadata: { contentType: PDF_CONTENT_TYPE } });
        const r = await db
          .prepare(`INSERT INTO member_documents (member_id, resume_path, updated_at) VALUES (?, ?, ?) ON CONFLICT (member_id) DO NOTHING`)
          .bind(profileId, path, new Date().toISOString())
          .run();
        out.resume = r.meta.changes > 0;
        if (!out.resume) await files.delete(`resumes/${path}`);
      }
    }
  }
  return out;
}
