/**
 * Members who graduate become alumni here automatically.
 *
 * auth.quantt.ca owns graduation: on May 1 of a member's grad year it moves
 * them to its alumni list (Directory.alumni()) and swaps their Discord roles.
 * The hourly cron (worker.js) runs syncGraduates, which for each graduate:
 *
 *  - makes an alumni account at their personal email (or links the one an
 *    admin already invited), filled from their member profile: name, grad
 *    year, program, bio, LinkedIn;
 *  - copies their headshot and resume (from auth, else from their hub profile);
 *  - hides their member profile from member lists and takes them out of the
 *    resume book (remembering whether they were in it);
 *  - records their linked Discord account, so removing them as an alum here
 *    also takes the Alumni role away;
 *  - emails them the alumni sign-in link (once: alumni_graduation.welcome_sent_at,
 *    retried next hour if the send failed).
 *
 * The account and its alumni_graduation row are written in one batch. A
 * graduate that fails is logged and counted in `failed`; the others still run.
 * Graduates without a personal email wait until an admin adds one on auth.
 *
 * Undo: when auth's "Make member again" takes someone off its alumni list,
 * the account made here is suspended (can't sign in, hidden from the alumni
 * directory) and their member profile and resume-book choice come back.
 * Nothing is deleted, so a later graduation picks up where it left off. If
 * auth's list is empty or under half the active graduates, that looks like a
 * bad read, so nobody is suspended that run (`suspendSkipped`, alerted by worker.js).
 */
import type { D1Database } from "@/lib/db/d1";
import type { R2BucketLike } from "@/lib/db/storage";
import type { DirectoryFile } from "@/lib/directory-files";
import { imageContentType, imageExtension, imageKindFromBytes, isPdfHeader, MAX_IMAGE_BYTES, MAX_PDF_BYTES, PDF_CONTENT_TYPE } from "@/lib/files";
import { ensureAlumniTables } from "@/lib/alumni/schema";

export type AuthAlum = {
  id: string;
  name: string;
  team: string | null;
  gradYear: number | null;
  personal: string | null;
  emails: string[];
  graduated: string;
  discord: string | null;
  files: { photo: string | null; resume: string | null };
};

/** The parts of the AUTH service binding this uses. Older auth Workers lack them. */
export type GraduateAuth = {
  alumni?(): Promise<AuthAlum[]>;
  alumFile?(id: string, kind: "photo" | "resume"): Promise<DirectoryFile | null>;
  missingPersonal?(): Promise<{ id: string; name: string; email: string | null; gradYear: number }[]>;
};

type Profile = { id: string; full_name: string; program: string | null; grad_year: number | null; bio: string | null; linkedin_url: string | null; photo_path: string | null; resume_book_opt_in: number; resume_book_opt_in_at: string | null; resume_book_opt_in_by: string | null };
type Row = { alumni_id: string; auth_id: string; profile_id: string | null; suspended_at: string | null; discord_id: string | null; resume_book_was: number; resume_book_at: string | null; resume_book_by: string | null };

export type SyncResult = {
  created: number;
  linked: number;
  reactivated: number;
  suspended: number;
  welcomed: number;
  waiting: string[];
  /** Graduates (or welcome emails) that failed this run; retried next hour. */
  failed: string[];
  /** Why the suspend pass didn't run, when auth's list looked wrong. */
  suspendSkipped: string | null;
};

const PROFILE_FIELDS = "id, full_name, program, grad_year, bio, linkedin_url, photo_path, resume_book_opt_in, resume_book_opt_in_at, resume_book_opt_in_by";

/** Their member profile: the one linked to their directory id (member_links), else the oldest under any of their addresses. */
async function findProfile(db: D1Database, authId: string, emails: string[]) {
  try {
    const linked = await db
      .prepare(`SELECT ${PROFILE_FIELDS.split(", ").map((c) => `p.${c}`).join(", ")} FROM member_links l JOIN profiles p ON p.id = l.profile_id WHERE l.directory_id = ? AND p.role = 'member'`)
      .bind(authId)
      .first<Profile>();
    if (linked) return linked;
  } catch {
    // member_links is created on the first member sign-in; before that there are no links.
  }
  if (!emails.length) return null;
  return db
    .prepare(`SELECT ${PROFILE_FIELDS} FROM profiles WHERE role = 'member' AND lower(email) IN (${emails.map(() => "?").join(", ")}) ORDER BY created_at, id LIMIT 1`)
    .bind(...emails.map((e) => e.toLowerCase()))
    .first<Profile>();
}

async function bytesOf(files: R2BucketLike, key: string) {
  const o = await files.get(key).catch(() => null);
  return o ? new Uint8Array(await o.arrayBuffer()) : null;
}

/** Copies the headshot into R2 at photos/alumni/<id>/..., returning the path after "photos/", or null. */
async function copyPhoto(files: R2BucketLike, alumniId: string, auth: GraduateAuth, a: AuthAlum, p: Profile | null) {
  let bytes: Uint8Array | null = null;
  if (a.files.photo && auth.alumFile) {
    const f = await auth.alumFile(a.id, "photo").catch(() => null);
    if (f?.data) bytes = new Uint8Array(f.data);
  }
  if (!bytes && p?.photo_path) bytes = await bytesOf(files, `photos/${p.photo_path}`);
  const kind = bytes && bytes.byteLength <= MAX_IMAGE_BYTES ? imageKindFromBytes(bytes.subarray(0, 12)) : null;
  if (!bytes || !kind) return null;
  const path = `alumni/${alumniId}/${crypto.randomUUID().slice(0, 8)}.${imageExtension(kind)}`;
  await files.put(`photos/${path}`, bytes, { httpMetadata: { contentType: imageContentType(kind) } });
  return path;
}

/** Copies the resume into R2 at resumes/alumni/<id>/..., returning the path after "resumes/", or null. */
async function copyResume(db: D1Database, files: R2BucketLike, alumniId: string, auth: GraduateAuth, a: AuthAlum, p: Profile | null) {
  let bytes: Uint8Array | null = null;
  if (a.files.resume && auth.alumFile) {
    const f = await auth.alumFile(a.id, "resume").catch(() => null);
    if (f?.data) bytes = new Uint8Array(f.data);
  }
  if (!bytes && p) {
    const doc = await db.prepare(`SELECT resume_path FROM member_documents WHERE member_id = ?`).bind(p.id).first<{ resume_path: string | null }>();
    if (doc?.resume_path) bytes = await bytesOf(files, `resumes/${doc.resume_path}`);
  }
  if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_PDF_BYTES || !isPdfHeader(bytes.subarray(0, 8))) return null;
  const path = `alumni/${alumniId}/${crypto.randomUUID()}/resume.pdf`;
  await files.put(`resumes/${path}`, bytes, { httpMetadata: { contentType: PDF_CONTENT_TYPE } });
  return path;
}

export async function syncGraduates(
  db: D1Database,
  files: R2BucketLike,
  auth: GraduateAuth,
  welcome: (to: string, name: string) => Promise<void>,
  now = new Date(),
): Promise<SyncResult | null> {
  if (!auth.alumni) return null;
  // If auth can't be reached this throws, and nothing below runs (no suspensions on a failed read).
  const list = await auth.alumni();
  await ensureAlumniTables(db);
  const at = now.toISOString();
  const out: SyncResult = { created: 0, linked: 0, reactivated: 0, suspended: 0, welcomed: 0, waiting: [], failed: [], suspendSkipped: null };

  // One graduate at a time; one that fails is logged and counted, and the rest still run.
  for (const a of list) {
    try {
      await syncOne(db, files, auth, a, at, out);
    } catch (e) {
      console.error("graduate sync failed", a.id, e);
      out.failed.push(a.name || a.id);
    }
  }

  // Welcome emails, driven by welcome_sent_at so a failed send is retried next hour and a sent one never is.
  // Claimed before sending so two overlapping runs send one email.
  const { results: unwelcomed } = await db
    .prepare(
      `SELECT g.alumni_id, a.email, a.full_name FROM alumni_graduation g JOIN alumni a ON a.id = g.alumni_id
        WHERE g.welcome_sent_at IS NULL AND g.suspended_at IS NULL`,
    )
    .all<{ alumni_id: string; email: string; full_name: string }>();
  for (const w of unwelcomed ?? []) {
    const claim = await db
      .prepare(`UPDATE alumni_graduation SET welcome_sent_at = ? WHERE alumni_id = ? AND welcome_sent_at IS NULL`)
      .bind(at, w.alumni_id)
      .run();
    if (claim.meta.changes !== 1) continue;
    try {
      await welcome(w.email, w.full_name);
      out.welcomed++;
    } catch (e) {
      console.error("graduation email failed", w.full_name, e);
      out.failed.push(`${w.full_name || w.email} (welcome email)`);
      await db.prepare(`UPDATE alumni_graduation SET welcome_sent_at = NULL WHERE alumni_id = ? AND welcome_sent_at = ?`).bind(w.alumni_id, at).run();
    }
  }

  // Undone on auth ("Make member again"): suspend the account, give the member profile back.
  // Suspending signs people out and takes their Discord role, so a list that is empty or less than
  // half the active graduates is treated as a bad read from auth: skip the pass and say so.
  const listed = new Set(list.map((a) => a.id));
  const { results: active } = await db.prepare(`SELECT * FROM alumni_graduation WHERE suspended_at IS NULL`).all<Row>();
  const rows = active ?? [];
  if (rows.length && (list.length === 0 || list.length < rows.length / 2)) {
    out.suspendSkipped = `auth listed ${list.length} alumni for ${rows.length} active graduates; suspend pass skipped`;
    console.error("graduates:", out.suspendSkipped);
    return out;
  }
  for (const r of rows) {
    if (listed.has(r.auth_id)) continue;
    await db.batch([
      db.prepare(`UPDATE alumni_graduation SET suspended_at = ? WHERE alumni_id = ?`).bind(at, r.alumni_id),
      db.prepare(`DELETE FROM alumni_sessions WHERE alumni_id = ?`).bind(r.alumni_id),
      ...(r.discord_id ? [db.prepare(`DELETE FROM alumni_discord WHERE alumni_id = ? AND discord_id = ?`).bind(r.alumni_id, r.discord_id)] : []),
      ...(r.profile_id && r.resume_book_was
        ? [db.prepare(`UPDATE profiles SET resume_book_opt_in = 1, resume_book_opt_in_at = ?, resume_book_opt_in_by = ? WHERE id = ? AND role = 'member'`)
            .bind(r.resume_book_at ?? at, r.resume_book_by ?? r.profile_id, r.profile_id)]
        : []),
    ]);
    out.suspended++;
  }
  return out;
}

/** Hides the member profile from the resume book (member lists hide it through alumni_graduation). */
function hideProfile(db: D1Database, profileId: string) {
  return db.prepare(`UPDATE profiles SET resume_book_opt_in = 0 WHERE id = ? AND role = 'member'`).bind(profileId);
}

function linkDiscord(db: D1Database, alumniId: string, discordId: string) {
  return db.prepare(`INSERT OR IGNORE INTO alumni_discord (alumni_id, discord_id, username) VALUES (?, ?, '')`).bind(alumniId, discordId);
}

/** One graduate from auth's list: reactivate, wait, or make (or link) their alumni account. */
async function syncOne(db: D1Database, files: R2BucketLike, auth: GraduateAuth, a: AuthAlum, at: string, out: SyncResult) {
  const row = await db.prepare(`SELECT * FROM alumni_graduation WHERE auth_id = ?`).bind(a.id).first<Row>();
  if (row) {
    if (!row.suspended_at) return;
    // Graduated again after an undo: same account, hide the member profile again.
    const p = row.profile_id
      ? await db.prepare(`SELECT resume_book_opt_in, resume_book_opt_in_at, resume_book_opt_in_by FROM profiles WHERE id = ?`).bind(row.profile_id)
          .first<{ resume_book_opt_in: number; resume_book_opt_in_at: string | null; resume_book_opt_in_by: string | null }>()
      : null;
    await db.batch([
      db.prepare(`UPDATE alumni_graduation SET suspended_at = NULL, resume_book_was = ?, resume_book_at = ?, resume_book_by = ?, discord_id = ? WHERE alumni_id = ?`)
        .bind(p?.resume_book_opt_in ? 1 : 0, p?.resume_book_opt_in_at ?? null, p?.resume_book_opt_in_by ?? null, a.discord, row.alumni_id),
      ...(row.profile_id ? [hideProfile(db, row.profile_id)] : []),
      ...(a.discord ? [linkDiscord(db, row.alumni_id, a.discord)] : []),
    ]);
    out.reactivated++;
    return;
  }
  if (!a.personal) { out.waiting.push(a.name); return; }

  const p = await findProfile(db, a.id, a.emails);
  const existing = await db.prepare(`SELECT id FROM alumni WHERE email = ?`).bind(a.personal).first<{ id: string }>();
  if (existing) {
    // Two graduates gave auth the same personal email: the account already belongs to the first.
    const taken = await db.prepare(`SELECT auth_id FROM alumni_graduation WHERE alumni_id = ?`).bind(existing.id).first<{ auth_id: string }>();
    if (taken) throw new Error(`personal email ${a.personal} is already the alumni account of graduate ${taken.auth_id}`);
  }
  const alumniId = existing?.id ?? crypto.randomUUID();
  const photo = await copyPhoto(files, alumniId, auth, a, p).catch(() => null);
  const resume = await copyResume(db, files, alumniId, auth, a, p).catch(() => null);
  try {
    // All or nothing, so a failure part-way can't leave an account without its graduation row.
    // An admin-invited account (existing) already got its invite email, so it's marked welcomed.
    await db.batch([
      ...(existing
        ? []
        : [db
            .prepare(`INSERT INTO alumni (id, email, full_name, grad_year, program, linkedin_url, bio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(alumniId, a.personal, a.name || p?.full_name || "", a.gradYear ?? p?.grad_year ?? null, p?.program ?? null, p?.linkedin_url ?? null, p?.bio ?? null, at)]),
      db.prepare(`UPDATE alumni_invites SET accepted_at = ? WHERE email = ? AND accepted_at IS NULL`).bind(at, a.personal),
      db
        .prepare(
          `INSERT INTO alumni_graduation (alumni_id, auth_id, profile_id, photo_path, resume_path, discord_id, resume_book_was, resume_book_at, resume_book_by, welcome_sent_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(alumniId, a.id, p?.id ?? null, photo, resume, a.discord, p?.resume_book_opt_in ? 1 : 0, p?.resume_book_opt_in_at ?? null, p?.resume_book_opt_in_by ?? null, existing ? at : null, at),
      ...(p ? [hideProfile(db, p.id)] : []),
      ...(a.discord ? [linkDiscord(db, alumniId, a.discord)] : []),
    ]);
  } catch (e) {
    // Nothing was saved, so the copies just made are unused: remove them (best effort).
    const keys = [photo && `photos/${photo}`, resume && `resumes/${resume}`].filter((k): k is string => Boolean(k));
    if (keys.length) await files.delete(keys).catch(() => undefined);
    throw e;
  }
  if (existing) out.linked++;
  else out.created++;
}

/**
 * April: email members graduating this spring who haven't given auth.quantt.ca
 * a personal email yet, once each per year.
 */
export async function remindPersonalEmail(
  db: D1Database,
  auth: GraduateAuth,
  remind: (to: string, name: string, year: number) => Promise<void>,
  now = new Date(),
) {
  if (!auth.missingPersonal || now.getUTCMonth() !== 3) return 0;
  await ensureAlumniTables(db);
  let sent = 0;
  for (const m of await auth.missingPersonal()) {
    if (!m.email) continue;
    // Claim the reminder, send, and give the claim back if the send failed (tried again tomorrow).
    const r = await db.prepare(`INSERT OR IGNORE INTO graduation_reminders (auth_id, year) VALUES (?, ?)`).bind(m.id, m.gradYear).run();
    if (!r.meta.changes) continue;
    try {
      await remind(m.email, m.name, m.gradYear);
      sent++;
    } catch (e) {
      console.error("reminder failed", m.name, e);
      await db.prepare(`DELETE FROM graduation_reminders WHERE auth_id = ? AND year = ?`).bind(m.id, m.gradYear).run();
    }
  }
  return sent;
}

/** Hidden graduates' member profile ids, for member lists built with the query client. */
export async function graduatedProfileIds(db: D1Database) {
  await ensureAlumniTables(db);
  const { results } = await db
    .prepare(`SELECT profile_id FROM alumni_graduation WHERE suspended_at IS NULL AND profile_id IS NOT NULL`)
    .all<{ profile_id: string }>();
  return (results ?? []).map((r) => r.profile_id);
}

/** An alum's copied headshot path (after "photos/"), if they have one. */
export async function alumniPhotoPath(db: D1Database, alumniId: string) {
  await ensureAlumniTables(db);
  const r = await db
    .prepare(`SELECT photo_path FROM alumni_graduation WHERE alumni_id = ? AND suspended_at IS NULL`)
    .bind(alumniId)
    .first<{ photo_path: string | null }>();
  return r?.photo_path && r.photo_path.startsWith(`alumni/${alumniId}/`) ? r.photo_path : null;
}
