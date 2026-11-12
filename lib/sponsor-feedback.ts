/**
 * Requests and feedback from sponsors (Company → Feedback), read only by
 * Connect admins (Admin → Feedback). A firm sees its own list and whether
 * each item is still open, never anyone else's.
 *
 * Admins can ask to be emailed about each new item (Profile → Email
 * notifications, admins only); that is off until they
 * turn it on, like every other Connect email (Ethan, 2026-11-02).
 *
 * Same tables as db/migrations/0015_sponsor_feedback.sql (a test checks they
 * match). Created on first use, so a deploy works before the migration runs.
 */
import type { D1Database } from "@/lib/db/d1";
import type { Email, SendEmails } from "@/lib/notifications";
import { siteUrl } from "@/lib/site-url";

export const FEEDBACK_KINDS = ["request", "feedback", "problem"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  request: "Request",
  feedback: "Feedback",
  problem: "Problem",
};
export const MAX_FEEDBACK_LENGTH = 4000;
/** A firm can send this many in a day, so a stuck form can't flood the admins. */
export const MAX_FEEDBACK_PER_DAY = 20;

export const SPONSOR_FEEDBACK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sponsor_feedback (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  profile_id text REFERENCES profiles (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('request', 'feedback', 'problem')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  resolved_at text,
  resolved_by text REFERENCES profiles (id) ON DELETE SET NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`,
  `CREATE INDEX IF NOT EXISTS sponsor_feedback_company_idx ON sponsor_feedback (company_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS sponsor_feedback_status_idx ON sponsor_feedback (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS sponsor_feedback_watchers (
  profile_id text PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`,
];

let ready = false;
export async function ensureFeedbackTables(db: D1Database) {
  if (ready) return;
  await db.batch(SPONSOR_FEEDBACK_SCHEMA.map((s) => db.prepare(s)));
  ready = true;
}

export function parseFeedbackKind(raw: unknown): FeedbackKind | null {
  return (FEEDBACK_KINDS as readonly string[]).includes(String(raw)) ? (raw as FeedbackKind) : null;
}

export type FeedbackRow = {
  id: string;
  company_id: string;
  kind: FeedbackKind;
  body: string;
  status: "open" | "done";
  created_at: string;
  resolved_at: string | null;
  author_name: string | null;
  author_email: string | null;
};

export type AdminFeedbackRow = FeedbackRow & { company_name: string; resolved_by_name: string | null };

export type SubmitResult = { ok: true; id: string } | { ok: false; code: "feedback_empty" | "feedback_limit" };

/** Save one item from a sponsor contact. The caller has already checked who they are and which firm. */
export async function submitFeedback(
  db: D1Database,
  input: { companyId: string; profileId: string; kind: FeedbackKind; body: string },
  now = new Date(),
): Promise<SubmitResult> {
  await ensureFeedbackTables(db);
  const body = input.body.trim().slice(0, MAX_FEEDBACK_LENGTH);
  if (!body) return { ok: false, code: "feedback_empty" };
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const recent = await db
    .prepare(`SELECT count(*) AS n FROM sponsor_feedback WHERE company_id = ? AND created_at > ?`)
    .bind(input.companyId, since)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_FEEDBACK_PER_DAY) return { ok: false, code: "feedback_limit" };
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO sponsor_feedback (id, company_id, profile_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.companyId, input.profileId, input.kind, body, now.toISOString())
    .run();
  return { ok: true, id };
}

const BASE_SELECT = `SELECT f.id, f.company_id, f.kind, f.body, f.status, f.created_at, f.resolved_at,
       p.full_name AS author_name, p.email AS author_email
  FROM sponsor_feedback f LEFT JOIN profiles p ON p.id = f.profile_id`;

/** One firm's own items, newest first. */
export async function listCompanyFeedback(db: D1Database, companyId: string): Promise<FeedbackRow[]> {
  await ensureFeedbackTables(db);
  const { results } = await db
    .prepare(`${BASE_SELECT} WHERE f.company_id = ? ORDER BY f.created_at DESC LIMIT 200`)
    .bind(companyId)
    .all<FeedbackRow>();
  return results;
}

/** Everything, for admins: open first (oldest first, like a queue), then done (newest first). */
export async function listAllFeedback(db: D1Database, status: "open" | "done"): Promise<AdminFeedbackRow[]> {
  await ensureFeedbackTables(db);
  const { results } = await db
    .prepare(
      `SELECT f.id, f.company_id, f.kind, f.body, f.status, f.created_at, f.resolved_at,
              p.full_name AS author_name, p.email AS author_email,
              c.name AS company_name, r.full_name AS resolved_by_name
         FROM sponsor_feedback f
         JOIN companies c ON c.id = f.company_id
         LEFT JOIN profiles p ON p.id = f.profile_id
         LEFT JOIN profiles r ON r.id = f.resolved_by
        WHERE f.status = ?
        ORDER BY f.created_at ${status === "open" ? "ASC" : "DESC"}
        LIMIT 500`,
    )
    .bind(status)
    .all<AdminFeedbackRow>();
  return results;
}

export async function countOpenFeedback(db: D1Database): Promise<number> {
  await ensureFeedbackTables(db);
  const row = await db.prepare(`SELECT count(*) AS n FROM sponsor_feedback WHERE status = 'open'`).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Mark done (with who and when) or reopen. */
export async function setFeedbackStatus(
  db: D1Database,
  id: string,
  status: "open" | "done",
  adminId: string,
  now = new Date(),
) {
  await ensureFeedbackTables(db);
  await db
    .prepare(`UPDATE sponsor_feedback SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`)
    .bind(status, status === "done" ? now.toISOString() : null, status === "done" ? adminId : null, id)
    .run();
}

export async function isWatchingFeedback(db: D1Database, profileId: string) {
  await ensureFeedbackTables(db);
  return Boolean(
    await db.prepare(`SELECT 1 AS x FROM sponsor_feedback_watchers WHERE profile_id = ?`).bind(profileId).first(),
  );
}

export async function setWatchingFeedback(db: D1Database, profileId: string, on: boolean) {
  await ensureFeedbackTables(db);
  await db
    .prepare(
      on
        ? `INSERT INTO sponsor_feedback_watchers (profile_id) VALUES (?) ON CONFLICT (profile_id) DO NOTHING`
        : `DELETE FROM sponsor_feedback_watchers WHERE profile_id = ?`,
    )
    .bind(profileId)
    .run();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Email the admins who turned feedback emails on. Only current admins: someone
 * who stopped being an admin stops getting them even if their row is still
 * there. The email carries the text, since only admins receive it.
 */
export async function notifyNewFeedback(db: D1Database, send: SendEmails, feedbackId: string) {
  await ensureFeedbackTables(db);
  const item = await db
    .prepare(
      `SELECT f.kind, f.body, c.name AS company_name, p.full_name AS author_name
         FROM sponsor_feedback f JOIN companies c ON c.id = f.company_id
         LEFT JOIN profiles p ON p.id = f.profile_id
        WHERE f.id = ?`,
    )
    .bind(feedbackId)
    .first<{ kind: FeedbackKind; body: string; company_name: string; author_name: string | null }>();
  if (!item) return;
  const { results } = await db
    .prepare(`SELECT p.email FROM sponsor_feedback_watchers w JOIN profiles p ON p.id = w.profile_id WHERE p.is_admin = 1`)
    .all<{ email: string }>();
  const what = FEEDBACK_KIND_LABEL[item.kind].toLowerCase();
  const who = item.author_name ? `${item.author_name} (${item.company_name})` : item.company_name;
  const url = `${siteUrl()}/admin/feedback`;
  const note = "You get these because you turned on sponsor feedback in your Connect notification settings.";
  const emails: Email[] = results.map((r) => ({
    to: r.email,
    subject: `Sponsor ${what} from ${item.company_name}`,
    text: [`${who} sent a ${what} on Connect:`, "", item.body, "", url, "", note].join("\n"),
    html:
      `<p>${escapeHtml(who)} sent a ${what} on Connect:</p>` +
      `<blockquote style="margin:0;padding-left:12px;border-left:3px solid #ccc;white-space:pre-wrap">${escapeHtml(item.body)}</blockquote>` +
      `<p><a href="${escapeHtml(url)}">Open in Connect</a></p><p style="color:#666;font-size:12px">${escapeHtml(note)}</p>`,
  }));
  await send(emails);
}
