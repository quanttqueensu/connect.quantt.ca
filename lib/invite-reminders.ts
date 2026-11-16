import type { D1Database } from "@/lib/db/d1";

/**
 * A log of "Send reminder" emails for pending invites (Admin -> People), so
 * each "Waiting to join" row can show "Reminded <date> · N times".
 * One row per reminder that Gmail accepted. Rows go when the invite is
 * cancelled. db/migrations/0017_invite_reminders.sql; also created on first use.
 */
export type InviteKind = "sponsor" | "alumni";

export const INVITE_REMINDERS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS invite_reminders (
  id text PRIMARY KEY,
  invite_kind text NOT NULL CHECK (invite_kind IN ('sponsor', 'alumni')),
  invite_id text NOT NULL,
  sent_by text REFERENCES profiles (id) ON DELETE SET NULL,
  sent_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`,
  `CREATE INDEX IF NOT EXISTS invite_reminders_invite_idx ON invite_reminders (invite_kind, invite_id, sent_at)`,
];

let ready = false;
export async function ensureInviteReminderTables(db: D1Database) {
  if (ready) return;
  await db.batch(INVITE_REMINDERS_SCHEMA.map((s) => db.prepare(s)));
  ready = true;
}

export async function recordInviteReminder(db: D1Database, kind: InviteKind, inviteId: string, sentBy: string, now = new Date()) {
  await ensureInviteReminderTables(db);
  await db
    .prepare(`INSERT INTO invite_reminders (id, invite_kind, invite_id, sent_by, sent_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), kind, inviteId, sentBy, now.toISOString())
    .run();
}

export type ReminderSummary = { count: number; last: string };

/** invite id -> how many reminders and when the last one went out. */
export async function inviteReminderSummary(db: D1Database, kind: InviteKind): Promise<Map<string, ReminderSummary>> {
  await ensureInviteReminderTables(db);
  const { results } = await db
    .prepare(
      `SELECT invite_id, count(*) AS n, max(sent_at) AS last FROM invite_reminders WHERE invite_kind = ? GROUP BY invite_id`,
    )
    .bind(kind)
    .all<{ invite_id: string; n: number; last: string }>();
  return new Map(results.map((r) => [r.invite_id, { count: Number(r.n), last: r.last }]));
}

export async function clearInviteReminders(db: D1Database, kind: InviteKind, inviteId: string) {
  await ensureInviteReminderTables(db);
  await db.prepare(`DELETE FROM invite_reminders WHERE invite_kind = ? AND invite_id = ?`).bind(kind, inviteId).run();
}
