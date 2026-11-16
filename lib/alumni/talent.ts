/**
 * What alumni see of current members' files (Ethan, 2026-11-12): every
 * current member's headshot, and the resume book on the same terms sponsors
 * get it, so only members who opted in to the resume book, with a resume saved.
 * Graduated members are alumni now and drop out of both.
 */
import type { D1Database } from "@/lib/db/d1";
import { ensureAlumniTables, notGraduated } from "@/lib/alumni/schema";
import { isPackagePdfPath, isPhotoPath } from "@/lib/storage-paths";

const CURRENT_MEMBER = (col: string) => `${col}.role = 'member' AND ${notGraduated(`${col}.id`)}`;
const OPTED_IN = (col: string) => `${col}.resume_book_opt_in = 1 AND ${col}.resume_book_opt_in_at IS NOT NULL`;

export type AlumniResumeBookRow = {
  id: string;
  full_name: string;
  program: string | null;
  grad_year: number | null;
  bio: string | null;
  interests: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  website_url: string | null;
  has_photo: number;
  /** Server-side only: for the ZIP. Pages never render it. */
  resume_path: string;
};

function likeTerm(q: string) {
  return `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

/** Opted-in current members with a resume, same list sponsors see. */
export async function alumniResumeBook(
  db: D1Database,
  filters: { program?: string | null; gradYear?: number | null } = {},
): Promise<AlumniResumeBookRow[]> {
  await ensureAlumniTables(db);
  const where = [CURRENT_MEMBER("pr"), OPTED_IN("pr")];
  const params: (string | number)[] = [];
  if (filters.program) {
    where.push(`pr.program LIKE ? ESCAPE '\\'`);
    params.push(likeTerm(filters.program));
  }
  if (filters.gradYear != null) {
    where.push(`pr.grad_year = ?`);
    params.push(filters.gradYear);
  }
  const { results } = await db
    .prepare(
      `SELECT pr.id, pr.full_name, pr.program, pr.grad_year, pr.bio, pr.interests,
              pr.linkedin_url, pr.github_url, pr.website_url,
              CASE WHEN pr.photo_path IS NULL THEN 0 ELSE 1 END AS has_photo, md.resume_path
         FROM profiles pr
         JOIN member_documents md ON md.member_id = pr.id AND md.resume_path IS NOT NULL
        WHERE ${where.join(" AND ")}
        ORDER BY pr.full_name`,
    )
    .bind(...params)
    .all<AlumniResumeBookRow>();
  return results;
}

/** A current member's headshot path, or null. */
export async function memberPhotoPathForAlumni(db: D1Database, memberId: string) {
  await ensureAlumniTables(db);
  const row = await db
    .prepare(`SELECT pr.photo_path AS path FROM profiles pr WHERE pr.id = ? AND ${CURRENT_MEMBER("pr")}`)
    .bind(memberId)
    .first<{ path: string | null }>();
  return isPhotoPath(row?.path, memberId) ? row!.path! : null;
}

/** An opted-in current member's resume path, or null. */
export async function memberResumePathForAlumni(db: D1Database, memberId: string) {
  await ensureAlumniTables(db);
  const row = await db
    .prepare(
      `SELECT md.resume_path AS path FROM profiles pr
         JOIN member_documents md ON md.member_id = pr.id
        WHERE pr.id = ? AND ${CURRENT_MEMBER("pr")} AND ${OPTED_IN("pr")}`,
    )
    .bind(memberId)
    .first<{ path: string | null }>();
  return isPackagePdfPath(row?.path, memberId) ? row!.path! : null;
}
