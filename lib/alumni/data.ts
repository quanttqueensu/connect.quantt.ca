/**
 * Alumni area data. Every function takes the viewer and checks access itself:
 *
 *  - Alumni see other alumni, the member directory (name, program, grad year,
 *    bio, LinkedIn; never resumes, applications or sponsor data), alumni
 *    posts, and their own conversations.
 *  - Members see alumni, open alumni posts, and their own alumni conversations.
 *  - A conversation is always one alumnus and one member.
 *  - A member's first contact is a message request (Ethan, 2026-11-02): the
 *    member sends one intro message, then can't send more until the alum
 *    accepts. Alumni can message any member directly, and an alum replying to a
 *    request accepts it. Declined requests drop out of the alum's inbox.
 */
import type { D1Database } from "@/lib/db/d1";
import { ensureAlumniTables, notGraduated, notSuspended } from "@/lib/alumni/schema";

export type AlumniViewer = { kind: "alumni"; id: string } | { kind: "member"; id: string };

export type AlumniProfile = {
  id: string;
  full_name: string;
  grad_year: number | null;
  program: string | null;
  firm: string | null;
  title: string | null;
  location: string | null;
  linkedin_url: string | null;
  other_social_url: string | null;
  bio: string | null;
  has_photo?: number | null;
};

export type AlumniPost = {
  id: string;
  alumni_id: string;
  kind: "job" | "mentorship";
  title: string;
  body: string;
  firm: string | null;
  location: string | null;
  external_url: string | null;
  status: "open" | "closed";
  created_at: string;
  author_name: string;
};

export type MemberCardForAlumni = {
  id: string;
  full_name: string;
  program: string | null;
  grad_year: number | null;
  bio: string | null;
  linkedin_url: string | null;
};

// has_photo: a graduate's headshot copied from their member profile (lib/alumni/graduates.ts), served at /alumni/photo/<id>.
const PROFILE_COLS =
  "id, full_name, grad_year, program, firm, title, location, linkedin_url, other_social_url, bio, " +
  "(SELECT CASE WHEN g.photo_path IS NULL THEN 0 ELSE 1 END FROM alumni_graduation g WHERE g.alumni_id = alumni.id) AS has_photo";

function likeTerm(q: string) {
  return `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

export async function listAlumni(db: D1Database, q = "") {
  await ensureAlumniTables(db);
  const term = q.trim().slice(0, 80);
  const stmt = term
    ? db
        .prepare(
          `SELECT ${PROFILE_COLS} FROM alumni
            WHERE (full_name LIKE ?1 ESCAPE '\\' OR firm LIKE ?1 ESCAPE '\\' OR program LIKE ?1 ESCAPE '\\')
              AND ${notSuspended("alumni.id")}
            ORDER BY full_name LIMIT 200`,
        )
        .bind(likeTerm(term))
    : db.prepare(`SELECT ${PROFILE_COLS} FROM alumni WHERE ${notSuspended("alumni.id")} ORDER BY full_name LIMIT 200`);
  return (await stmt.all<AlumniProfile>()).results;
}

export async function getAlumnus(db: D1Database, id: string) {
  await ensureAlumniTables(db);
  return db
    .prepare(`SELECT ${PROFILE_COLS}, phone, email_messages FROM alumni WHERE id = ?`)
    .bind(id)
    .first<AlumniProfile & { phone: string | null; email_messages: number }>();
}

/**
 * What an alum must fill in before using Connect: LinkedIn, a phone number and
 * an About. The phone is never shown to members, only to QUANTT admins.
 */
export function alumniProfileComplete(a: { full_name?: string | null; linkedin_url: string | null; phone: string | null; bio: string | null }) {
  return Boolean(a.full_name?.trim() && a.linkedin_url?.trim() && a.phone?.trim() && a.bio?.trim());
}

export type AlumniProfileInput = Omit<AlumniProfile, "id"> & { phone: string | null };

export async function updateAlumnus(db: D1Database, viewer: AlumniViewer, input: AlumniProfileInput) {
  if (viewer.kind !== "alumni") throw new Error("Alumni only");
  await db
    .prepare(
      `UPDATE alumni SET full_name = ?, grad_year = ?, program = ?, firm = ?, title = ?, location = ?,
         linkedin_url = ?, other_social_url = ?, phone = ?, bio = ? WHERE id = ?`,
    )
    .bind(
      input.full_name, input.grad_year, input.program, input.firm, input.title, input.location,
      input.linkedin_url, input.other_social_url, input.phone, input.bio, viewer.id,
    )
    .run();
}

export async function listMembersForAlumni(db: D1Database, viewer: AlumniViewer, q = "") {
  if (viewer.kind !== "alumni") throw new Error("Alumni only");
  await ensureAlumniTables(db);
  const term = q.trim().slice(0, 80);
  const cols = "id, full_name, program, grad_year, bio, linkedin_url";
  const stmt = term
    ? db
        .prepare(
          `SELECT ${cols} FROM profiles WHERE role = 'member' AND ${notGraduated("profiles.id")}
              AND (full_name LIKE ?1 ESCAPE '\\' OR program LIKE ?1 ESCAPE '\\')
            ORDER BY full_name LIMIT 200`,
        )
        .bind(likeTerm(term))
    : db.prepare(`SELECT ${cols} FROM profiles WHERE role = 'member' AND ${notGraduated("profiles.id")} ORDER BY full_name LIMIT 200`);
  return (await stmt.all<MemberCardForAlumni>()).results;
}

export async function listAlumniPosts(db: D1Database, opts: { authorId?: string; includeClosed?: boolean } = {}) {
  await ensureAlumniTables(db);
  const where = [opts.includeClosed ? "1 = 1" : "p.status = 'open'"];
  const params: string[] = [];
  if (opts.authorId) {
    where.push("p.alumni_id = ?");
    params.push(opts.authorId);
  }
  return (
    await db
      .prepare(
        `SELECT p.*, a.full_name AS author_name FROM alumni_posts p JOIN alumni a ON a.id = p.alumni_id
          WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT 200`,
      )
      .bind(...params)
      .all<AlumniPost>()
  ).results;
}

export type AlumniPostInput = Pick<AlumniPost, "kind" | "title" | "body" | "firm" | "location" | "external_url">;

export async function createAlumniPost(db: D1Database, viewer: AlumniViewer, input: AlumniPostInput, now = new Date()) {
  if (viewer.kind !== "alumni") throw new Error("Alumni only");
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO alumni_posts (id, alumni_id, kind, title, body, firm, location, external_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, viewer.id, input.kind, input.title, input.body, input.firm, input.location, input.external_url, now.toISOString())
    .run();
  return id;
}

/** Only the author can close their post. Returns false if it wasn't theirs. */
export async function closeAlumniPost(db: D1Database, viewer: AlumniViewer, postId: string) {
  if (viewer.kind !== "alumni") return false;
  const res = await db
    .prepare(`UPDATE alumni_posts SET status = 'closed' WHERE id = ? AND alumni_id = ?`)
    .bind(postId, viewer.id)
    .run();
  return res.meta.changes === 1;
}

export type RequestStatus = "pending" | "accepted" | "declined";

/** A conversation with no request row is open: alum-started, or from before requests existed. */
const STATUS_SQL = `COALESCE((SELECT r.status FROM alumni_message_requests r WHERE r.conversation_id = c.id), 'accepted')`;

async function bothExist(db: D1Database, alumniId: string, memberId: string) {
  const member = await db.prepare(`SELECT id FROM profiles WHERE id = ? AND role = 'member'`).bind(memberId).first();
  const alumnus = await db.prepare(`SELECT id FROM alumni WHERE id = ?`).bind(alumniId).first();
  return Boolean(member && alumnus);
}

async function existingConversation(db: D1Database, alumniId: string, memberId: string) {
  const row = await db
    .prepare(`SELECT id FROM alumni_conversations WHERE alumni_id = ? AND member_id = ?`)
    .bind(alumniId, memberId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Alumni: the conversation with this member, created (open, no request) if
 * needed. Members: the existing conversation only, since a member's first
 * contact goes through requestConversation. Null if there's nothing to open.
 */
export async function openConversation(db: D1Database, viewer: AlumniViewer, otherId: string, now = new Date()) {
  await ensureAlumniTables(db);
  const [alumniId, memberId] = viewer.kind === "alumni" ? [viewer.id, otherId] : [otherId, viewer.id];
  if (viewer.kind === "member") return existingConversation(db, alumniId, memberId);
  if (!(await bothExist(db, alumniId, memberId))) return null;
  await db
    .prepare(
      `INSERT INTO alumni_conversations (id, alumni_id, member_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (alumni_id, member_id) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), alumniId, memberId, now.toISOString())
    .run();
  return existingConversation(db, alumniId, memberId);
}

/**
 * A member asks to message an alum, with a short intro the alum sees first.
 * If they already have a conversation, nothing is added and its id comes back
 * with created = false. Null if the alum or member doesn't exist or the intro is empty.
 */
export async function requestConversation(
  db: D1Database,
  viewer: AlumniViewer,
  alumniId: string,
  intro: string,
  now = new Date(),
): Promise<{ id: string; created: boolean } | null> {
  if (viewer.kind !== "member") return null;
  await ensureAlumniTables(db);
  const existing = await existingConversation(db, alumniId, viewer.id);
  if (existing) return { id: existing, created: false };
  const text = intro.trim();
  if (!text || text.length > MAX_ALUMNI_REQUEST) return null;
  if (!(await bothExist(db, alumniId, viewer.id))) return null;
  const id = crypto.randomUUID();
  const at = now.toISOString();
  await db.batch([
    db
      .prepare(`INSERT INTO alumni_conversations (id, alumni_id, member_id, member_last_read_at, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, alumniId, viewer.id, at, at),
    db.prepare(`INSERT INTO alumni_message_requests (conversation_id, status, created_at) VALUES (?, 'pending', ?)`).bind(id, at),
    db
      .prepare(`INSERT INTO alumni_messages (id, conversation_id, sender, body, created_at) VALUES (?, ?, 'member', ?, ?)`)
      .bind(crypto.randomUUID(), id, text, at),
  ]);
  return { id, created: true };
}

/** The alum accepts or declines a request in their inbox. False if it isn't theirs or isn't a request. */
export async function decideRequest(db: D1Database, viewer: AlumniViewer, conversationId: string, accept: boolean, now = new Date()) {
  if (viewer.kind !== "alumni") return false;
  await ensureAlumniTables(db);
  const res = await db
    .prepare(
      `UPDATE alumni_message_requests SET status = ?, decided_at = ?
        WHERE conversation_id = ? AND status <> ?
          AND conversation_id IN (SELECT id FROM alumni_conversations WHERE alumni_id = ?)`,
    )
    .bind(accept ? "accepted" : "declined", now.toISOString(), conversationId, accept ? "accepted" : "declined", viewer.id)
    .run();
  return res.meta.changes === 1;
}

/** Name of an alum a member can request, or null. */
export async function getAlumnusName(db: D1Database, id: string) {
  await ensureAlumniTables(db);
  return (await db.prepare(`SELECT full_name FROM alumni WHERE id = ?`).bind(id).first<{ full_name: string }>())?.full_name ?? null;
}

export type ConversationSummary = {
  id: string;
  other_id: string;
  other_name: string;
  last_at: string;
  unread: boolean;
  status: RequestStatus;
};

export async function listConversations(db: D1Database, viewer: AlumniViewer): Promise<ConversationSummary[]> {
  await ensureAlumniTables(db);
  const mine = viewer.kind === "alumni" ? "c.alumni_id" : "c.member_id";
  const myRead = viewer.kind === "alumni" ? "c.alumni_last_read_at" : "c.member_last_read_at";
  const otherSender = viewer.kind === "alumni" ? "member" : "alumni";
  const other =
    viewer.kind === "alumni"
      ? "c.member_id AS other_id, p.full_name AS other_name"
      : "c.alumni_id AS other_id, a.full_name AS other_name";
  const { results } = await db
    .prepare(
      `SELECT c.id, ${other}, c.created_at, ${myRead} AS read_at, ${STATUS_SQL} AS status,
              (SELECT max(created_at) FROM alumni_messages m WHERE m.conversation_id = c.id) AS last_at,
              (SELECT max(created_at) FROM alumni_messages m WHERE m.conversation_id = c.id AND m.sender = ?) AS last_in
         FROM alumni_conversations c
         JOIN alumni a ON a.id = c.alumni_id
         JOIN profiles p ON p.id = c.member_id
        WHERE ${mine} = ?`,
    )
    .bind(otherSender, viewer.id)
    .all<{
      id: string; other_id: string; other_name: string; created_at: string; read_at: string | null;
      last_at: string | null; last_in: string | null; status: RequestStatus;
    }>();
  return results
    // Declined requests leave the alum's inbox; the member still sees the outcome.
    .filter((r) => !(viewer.kind === "alumni" && r.status === "declined"))
    .map((r) => ({
      id: r.id,
      other_id: r.other_id,
      other_name: r.other_name,
      last_at: r.last_at ?? r.created_at,
      unread: Boolean(r.last_in && (!r.read_at || r.last_in > r.read_at)),
      status: r.status,
    }))
    .sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
}

export type ThreadMessage = { id: string; sender: "alumni" | "member"; body: string; created_at: string };

/** The thread if the viewer is in it, else null. */
export async function getThread(db: D1Database, viewer: AlumniViewer, conversationId: string, limit = 200) {
  await ensureAlumniTables(db);
  const convo = await db
    .prepare(
      `SELECT c.id, c.alumni_id, c.member_id, a.full_name AS alumni_name, p.full_name AS member_name, ${STATUS_SQL} AS status
         FROM alumni_conversations c JOIN alumni a ON a.id = c.alumni_id JOIN profiles p ON p.id = c.member_id
        WHERE c.id = ? AND ${viewer.kind === "alumni" ? "c.alumni_id" : "c.member_id"} = ?`,
    )
    .bind(conversationId, viewer.id)
    .first<{ id: string; alumni_id: string; member_id: string; alumni_name: string; member_name: string; status: RequestStatus }>();
  if (!convo) return null;
  const { results } = await db
    .prepare(
      `SELECT id, sender, body, created_at FROM (
         SELECT * FROM alumni_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
       ) ORDER BY created_at`,
    )
    .bind(conversationId, limit)
    .all<ThreadMessage>();
  return { ...convo, messages: results };
}

export async function markThreadRead(db: D1Database, viewer: AlumniViewer, conversationId: string, now = new Date()) {
  const col = viewer.kind === "alumni" ? "alumni_last_read_at" : "member_last_read_at";
  const who = viewer.kind === "alumni" ? "alumni_id" : "member_id";
  await db
    .prepare(`UPDATE alumni_conversations SET ${col} = ? WHERE id = ? AND ${who} = ?`)
    .bind(now.toISOString(), conversationId, viewer.id)
    .run();
}

export const MAX_ALUMNI_MESSAGE = 4000;
export const MAX_ALUMNI_REQUEST = 1000;

/**
 * Adds a message if the viewer is in the conversation. Returns false otherwise,
 * and for a member whose request is still pending or was declined. An alum
 * replying to a request accepts it.
 */
export async function sendThreadMessage(db: D1Database, viewer: AlumniViewer, conversationId: string, body: string, now = new Date()) {
  const text = body.trim();
  if (!text || text.length > MAX_ALUMNI_MESSAGE) return false;
  const thread = await getThread(db, viewer, conversationId, 1);
  if (!thread) return false;
  if (thread.status !== "accepted") {
    if (viewer.kind === "member") return false;
    await decideRequest(db, viewer, conversationId, true, now);
  }
  await db
    .prepare(`INSERT INTO alumni_messages (id, conversation_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), conversationId, viewer.kind, text, now.toISOString())
    .run();
  await markThreadRead(db, viewer, conversationId, now);
  return true;
}

export async function unreadCount(db: D1Database, viewer: AlumniViewer) {
  return (await listConversations(db, viewer)).filter((c) => c.unread).length;
}

/** Alumni email settings. With no saved row: request emails on, message emails per the older profile checkbox. */
export type AlumniNotificationPrefs = { requests: boolean; messages: boolean };

export async function getAlumniPrefs(db: D1Database, alumniId: string): Promise<AlumniNotificationPrefs> {
  await ensureAlumniTables(db);
  const row = await db
    .prepare(
      `SELECT a.email_messages, n.requests, n.messages
         FROM alumni a LEFT JOIN alumni_notification_prefs n ON n.alumni_id = a.id WHERE a.id = ?`,
    )
    .bind(alumniId)
    .first<{ email_messages: number; requests: number | null; messages: number | null }>();
  if (!row) return { requests: false, messages: false };
  return { requests: (row.requests ?? 1) === 1, messages: (row.messages ?? row.email_messages) === 1 };
}

/** True once the alum has saved their email settings (the alumni area asks once, at /alumni/setup). */
export async function hasChosenAlumniPrefs(db: D1Database, alumniId: string) {
  await ensureAlumniTables(db);
  return Boolean(await db.prepare(`SELECT 1 AS x FROM alumni_notification_prefs WHERE alumni_id = ?`).bind(alumniId).first());
}

export async function saveAlumniPrefs(db: D1Database, viewer: AlumniViewer, prefs: AlumniNotificationPrefs, now = new Date()) {
  if (viewer.kind !== "alumni") throw new Error("Alumni only");
  await ensureAlumniTables(db);
  await db.batch([
    db
      .prepare(
        `INSERT INTO alumni_notification_prefs (alumni_id, requests, messages, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (alumni_id) DO UPDATE SET requests = excluded.requests, messages = excluded.messages, updated_at = excluded.updated_at`,
      )
      .bind(viewer.id, prefs.requests ? 1 : 0, prefs.messages ? 1 : 0, now.toISOString()),
    db.prepare(`UPDATE alumni SET email_messages = ? WHERE id = ?`).bind(prefs.messages ? 1 : 0, viewer.id),
  ]);
}

/** Admin: invites, accounts and removal. Callers check is_admin. */
export async function inviteAlumnus(db: D1Database, email: string, fullName: string, invitedBy: string, now = new Date()) {
  await ensureAlumniTables(db);
  const existing = await db.prepare(`SELECT id FROM alumni WHERE email = ?`).bind(email).first();
  if (existing) return "exists" as const;
  await db
    .prepare(`INSERT INTO alumni_invites (id, email, full_name, invited_by, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), email, fullName, invitedBy, now.toISOString())
    .run();
  return "invited" as const;
}

export async function listAlumniInvites(db: D1Database) {
  await ensureAlumniTables(db);
  return (
    await db
      .prepare(`SELECT id, email, full_name, created_at FROM alumni_invites WHERE accepted_at IS NULL ORDER BY created_at DESC`)
      .all<{ id: string; email: string; full_name: string; created_at: string }>()
  ).results;
}

export async function listAlumniAccounts(db: D1Database) {
  await ensureAlumniTables(db);
  return (
    await db
      .prepare(`SELECT id, email, full_name, firm, grad_year, phone, created_at FROM alumni ORDER BY full_name`)
      .all<{ id: string; email: string; full_name: string; firm: string | null; grad_year: number | null; phone: string | null; created_at: string }>()
  ).results;
}

export async function removeAlumnus(db: D1Database, id: string) {
  await ensureAlumniTables(db);
  const row = await db.prepare(`SELECT email FROM alumni WHERE id = ?`).bind(id).first<{ email: string }>();
  await db.batch([
    db.prepare(`DELETE FROM alumni WHERE id = ?`).bind(id),
    ...(row ? [db.prepare(`DELETE FROM alumni_invites WHERE email = ?`).bind(row.email)] : []),
  ]);
}

export async function cancelAlumniInvite(db: D1Database, id: string) {
  await ensureAlumniTables(db);
  await db.prepare(`DELETE FROM alumni_invites WHERE id = ? AND accepted_at IS NULL`).bind(id).run();
}
