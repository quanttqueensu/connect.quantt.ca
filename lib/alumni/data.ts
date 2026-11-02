/**
 * Alumni area data. Every function takes the viewer and checks access itself:
 *
 *  - Alumni see other alumni, the member directory (name, program, grad year,
 *    bio, LinkedIn; never resumes, applications or sponsor data), alumni
 *    posts, and their own conversations.
 *  - Members see alumni, open alumni posts, and their own alumni conversations.
 *  - A conversation is always one alumnus and one member.
 */
import type { D1Database } from "@/lib/db/d1";
import { ensureAlumniTables } from "@/lib/alumni/schema";

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
  bio: string | null;
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

const PROFILE_COLS = "id, full_name, grad_year, program, firm, title, location, linkedin_url, bio";

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
            WHERE full_name LIKE ?1 ESCAPE '\\' OR firm LIKE ?1 ESCAPE '\\' OR program LIKE ?1 ESCAPE '\\'
            ORDER BY full_name LIMIT 200`,
        )
        .bind(likeTerm(term))
    : db.prepare(`SELECT ${PROFILE_COLS} FROM alumni ORDER BY full_name LIMIT 200`);
  return (await stmt.all<AlumniProfile>()).results;
}

export async function getAlumnus(db: D1Database, id: string) {
  await ensureAlumniTables(db);
  return db.prepare(`SELECT ${PROFILE_COLS}, email_messages FROM alumni WHERE id = ?`).bind(id).first<AlumniProfile & { email_messages: number }>();
}

export type AlumniProfileInput = Omit<AlumniProfile, "id"> & { email_messages: boolean };

export async function updateAlumnus(db: D1Database, viewer: AlumniViewer, input: AlumniProfileInput) {
  if (viewer.kind !== "alumni") throw new Error("Alumni only");
  await db
    .prepare(
      `UPDATE alumni SET full_name = ?, grad_year = ?, program = ?, firm = ?, title = ?, location = ?,
         linkedin_url = ?, bio = ?, email_messages = ? WHERE id = ?`,
    )
    .bind(
      input.full_name, input.grad_year, input.program, input.firm, input.title, input.location,
      input.linkedin_url, input.bio, input.email_messages ? 1 : 0, viewer.id,
    )
    .run();
}

export async function listMembersForAlumni(db: D1Database, viewer: AlumniViewer, q = "") {
  if (viewer.kind !== "alumni") throw new Error("Alumni only");
  const term = q.trim().slice(0, 80);
  const cols = "id, full_name, program, grad_year, bio, linkedin_url";
  const stmt = term
    ? db
        .prepare(
          `SELECT ${cols} FROM profiles WHERE role = 'member'
              AND (full_name LIKE ?1 ESCAPE '\\' OR program LIKE ?1 ESCAPE '\\')
            ORDER BY full_name LIMIT 200`,
        )
        .bind(likeTerm(term))
    : db.prepare(`SELECT ${cols} FROM profiles WHERE role = 'member' ORDER BY full_name LIMIT 200`);
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

/** The conversation between this viewer and `otherId`, created if needed. Null if the other side doesn't exist. */
export async function openConversation(db: D1Database, viewer: AlumniViewer, otherId: string, now = new Date()) {
  await ensureAlumniTables(db);
  const [alumniId, memberId] = viewer.kind === "alumni" ? [viewer.id, otherId] : [otherId, viewer.id];
  const member = await db.prepare(`SELECT id FROM profiles WHERE id = ? AND role = 'member'`).bind(memberId).first();
  const alumnus = await db.prepare(`SELECT id FROM alumni WHERE id = ?`).bind(alumniId).first();
  if (!member || !alumnus) return null;
  await db
    .prepare(
      `INSERT INTO alumni_conversations (id, alumni_id, member_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (alumni_id, member_id) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), alumniId, memberId, now.toISOString())
    .run();
  const row = await db
    .prepare(`SELECT id FROM alumni_conversations WHERE alumni_id = ? AND member_id = ?`)
    .bind(alumniId, memberId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export type ConversationSummary = { id: string; other_id: string; other_name: string; last_at: string; unread: boolean };

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
      `SELECT c.id, ${other}, c.created_at, ${myRead} AS read_at,
              (SELECT max(created_at) FROM alumni_messages m WHERE m.conversation_id = c.id) AS last_at,
              (SELECT max(created_at) FROM alumni_messages m WHERE m.conversation_id = c.id AND m.sender = ?) AS last_in
         FROM alumni_conversations c
         JOIN alumni a ON a.id = c.alumni_id
         JOIN profiles p ON p.id = c.member_id
        WHERE ${mine} = ?`,
    )
    .bind(otherSender, viewer.id)
    .all<{ id: string; other_id: string; other_name: string; created_at: string; read_at: string | null; last_at: string | null; last_in: string | null }>();
  return results
    .map((r) => ({
      id: r.id,
      other_id: r.other_id,
      other_name: r.other_name,
      last_at: r.last_at ?? r.created_at,
      unread: Boolean(r.last_in && (!r.read_at || r.last_in > r.read_at)),
    }))
    .sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
}

export type ThreadMessage = { id: string; sender: "alumni" | "member"; body: string; created_at: string };

/** The thread if the viewer is in it, else null. */
export async function getThread(db: D1Database, viewer: AlumniViewer, conversationId: string, limit = 200) {
  await ensureAlumniTables(db);
  const convo = await db
    .prepare(
      `SELECT c.id, c.alumni_id, c.member_id, a.full_name AS alumni_name, p.full_name AS member_name
         FROM alumni_conversations c JOIN alumni a ON a.id = c.alumni_id JOIN profiles p ON p.id = c.member_id
        WHERE c.id = ? AND ${viewer.kind === "alumni" ? "c.alumni_id" : "c.member_id"} = ?`,
    )
    .bind(conversationId, viewer.id)
    .first<{ id: string; alumni_id: string; member_id: string; alumni_name: string; member_name: string }>();
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

/** Adds a message if the viewer is in the conversation. Returns false otherwise. */
export async function sendThreadMessage(db: D1Database, viewer: AlumniViewer, conversationId: string, body: string, now = new Date()) {
  const text = body.trim();
  if (!text || text.length > MAX_ALUMNI_MESSAGE) return false;
  const thread = await getThread(db, viewer, conversationId, 1);
  if (!thread) return false;
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
      .prepare(`SELECT id, email, full_name, firm, grad_year, created_at FROM alumni ORDER BY full_name`)
      .all<{ id: string; email: string; full_name: string; firm: string | null; grad_year: number | null; created_at: string }>()
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
