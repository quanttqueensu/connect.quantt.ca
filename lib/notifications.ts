/**
 * Email notifications (Resend), with a per-person on/off for each kind.
 *
 *  - messages:            a new message in one of your conversations
 *  - applications:        sponsors: someone applied to your firm's job
 *  - application_updates: members: a firm moved your application to a new stage
 *  - new_jobs:            members: a new job was posted
 *
 * Everything is OFF until the person turns it on (Ethan, 2026-11-02). The
 * column defaults in the tables don't matter: a saved row always has all four,
 * and a person with no row gets DEFAULT_PREFS.
 *
 * Emails never include message text or application details, only who and a
 * link, so nothing private sits in an inbox. Message emails are throttled to
 * one per conversation per recipient every MESSAGE_QUIET_MINUTES.
 *
 * Everything here is best effort: a failed email never fails the action that
 * caused it. Callers run it in after() so it doesn't slow the page.
 */

import type { D1Database } from "@/lib/db/d1";
import { DEFAULT_FROM, type EmailEnv } from "@/lib/cf-auth/email";
import { getAlumniPrefs } from "@/lib/alumni/data";
import { siteUrl } from "@/lib/site-url";

export const NOTIFICATION_KINDS = ["messages", "applications", "application_updates", "new_jobs"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type NotificationPrefs = Record<NotificationKind, boolean>;

export const DEFAULT_PREFS: NotificationPrefs = {
  messages: false,
  applications: false,
  application_updates: false,
  new_jobs: false,
};

export const MESSAGE_QUIET_MINUTES = 15;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS notification_prefs (
    profile_id text PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    messages integer NOT NULL DEFAULT 1 CHECK (messages IN (0, 1)),
    applications integer NOT NULL DEFAULT 1 CHECK (applications IN (0, 1)),
    application_updates integer NOT NULL DEFAULT 1 CHECK (application_updates IN (0, 1)),
    new_jobs integer NOT NULL DEFAULT 0 CHECK (new_jobs IN (0, 1)),
    updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS notification_log (
    recipient text NOT NULL, topic text NOT NULL, sent_at text NOT NULL,
    PRIMARY KEY (recipient, topic)
  )`,
];

let ready = false;
/** Same tables as db/migrations/0004_notifications.sql, created once per isolate. */
export async function ensureNotificationTables(db: D1Database) {
  if (ready) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready = true;
}

type PrefRow = Record<NotificationKind, number>;

function toPrefs(row: PrefRow | null): NotificationPrefs {
  if (!row) return { ...DEFAULT_PREFS };
  return Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, row[k] === 1])) as NotificationPrefs;
}

export async function getPrefs(db: D1Database, profileId: string): Promise<NotificationPrefs> {
  await ensureNotificationTables(db);
  const row = await db
    .prepare(`SELECT ${NOTIFICATION_KINDS.join(", ")} FROM notification_prefs WHERE profile_id = ?`)
    .bind(profileId)
    .first<PrefRow>();
  return toPrefs(row);
}

/**
 * True once the person has saved their notification settings. Everyone picks
 * them once before using Connect (Ethan, 2026-11-02): the member and sponsor
 * layouts send anyone without a saved row to /setup/notifications.
 */
export async function hasChosenPrefs(db: D1Database, profileId: string) {
  await ensureNotificationTables(db);
  return Boolean(await db.prepare(`SELECT 1 AS x FROM notification_prefs WHERE profile_id = ?`).bind(profileId).first());
}

export async function savePrefs(db: D1Database, profileId: string, prefs: NotificationPrefs, now = new Date()) {
  await ensureNotificationTables(db);
  const vals = NOTIFICATION_KINDS.map((k) => (prefs[k] ? 1 : 0));
  await db
    .prepare(
      `INSERT INTO notification_prefs (profile_id, ${NOTIFICATION_KINDS.join(", ")}, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         ${NOTIFICATION_KINDS.map((k) => `${k} = excluded.${k}`).join(", ")}, updated_at = excluded.updated_at`,
    )
    .bind(profileId, ...vals, now.toISOString())
    .run();
}

type Recipient = { id: string; email: string };

/** The recipients who left `kind` on (rows with no settings use the defaults). */
async function wanting(db: D1Database, kind: NotificationKind, recipients: Recipient[]) {
  if (!recipients.length) return [];
  await ensureNotificationTables(db);
  const ids = recipients.map((r) => r.id);
  const { results } = await db
    .prepare(
      `SELECT profile_id, ${kind} AS on_ FROM notification_prefs WHERE profile_id IN (${ids.map(() => "?").join(", ")})`,
    )
    .bind(...ids)
    .all<{ profile_id: string; on_: number }>();
  const set = new Map(results.map((r) => [r.profile_id, r.on_ === 1]));
  return recipients.filter((r) => set.get(r.id) ?? DEFAULT_PREFS[kind]);
}

/** True (and records the send) if `recipient` wasn't emailed about `topic` in the last `minutes`. */
async function claimSlot(db: D1Database, recipient: string, topic: string, minutes: number, now: Date) {
  await ensureNotificationTables(db);
  const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();
  const res = await db
    .prepare(
      `INSERT INTO notification_log (recipient, topic, sent_at) VALUES (?, ?, ?)
       ON CONFLICT (recipient, topic) DO UPDATE SET sent_at = excluded.sent_at
       WHERE notification_log.sent_at <= ?`,
    )
    .bind(recipient, topic, now.toISOString(), cutoff)
    .run();
  return res.meta.changes === 1;
}

export type Email = { to: string; subject: string; text: string; html: string };
export type SendEmails = (emails: Email[]) => Promise<void>;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const SETTINGS_NOTE = "You can turn these emails off in your Connect notification settings.";

export function notificationEmail(to: string, subject: string, line: string, path: string): Email {
  const url = `${siteUrl()}${path}`;
  return {
    to,
    subject,
    text: [line, "", url, "", SETTINGS_NOTE].join("\n"),
    html: `<p>${escapeHtml(line)}</p><p><a href="${escapeHtml(url)}">Open in Connect</a></p><p style="color:#666;font-size:12px">${SETTINGS_NOTE}</p>`,
  };
}

/** Resend's batch endpoint takes up to 100 emails a call. */
export function resendSender(env: EmailEnv, fetchImpl: typeof fetch = fetch): SendEmails {
  return async (emails) => {
    if (!env.RESEND_API_KEY || !emails.length) return;
    const from = env.LOGIN_EMAIL_FROM?.trim() || DEFAULT_FROM;
    for (let i = 0; i < emails.length; i += 100) {
      const res = await fetchImpl("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(emails.slice(i, i + 100).map((e) => ({ from, ...e, to: [e.to] }))),
      });
      if (!res.ok) throw new Error(`Resend refused the emails (${res.status})`);
    }
  };
}

/** A new message: email the other side of the conversation. */
export async function notifyNewMessage(
  db: D1Database,
  send: SendEmails,
  conversationId: string,
  senderId: string,
  now = new Date(),
) {
  const convo = await db
    .prepare(
      `SELECT c.member_id, c.company_id, co.name AS company_name, m.full_name AS member_name
         FROM conversations c
         JOIN companies co ON co.id = c.company_id
         JOIN profiles m ON m.id = c.member_id
        WHERE c.id = ?`,
    )
    .bind(conversationId)
    .first<{ member_id: string; company_id: string; company_name: string; member_name: string }>();
  if (!convo) return;

  let recipients: Recipient[];
  let line: string;
  let path: string;
  if (senderId === convo.member_id) {
    const { results } = await db
      .prepare(
        `SELECT p.id, p.email FROM company_users cu JOIN profiles p ON p.id = cu.profile_id WHERE cu.company_id = ?`,
      )
      .bind(convo.company_id)
      .all<Recipient>();
    recipients = results;
    line = `${convo.member_name || "A QUANTT member"} sent ${convo.company_name} a message on Connect.`;
    path = `/company/messages/${conversationId}`;
  } else {
    const member = await db
      .prepare(`SELECT id, email FROM profiles WHERE id = ?`)
      .bind(convo.member_id)
      .first<Recipient>();
    recipients = member ? [member] : [];
    line = `${convo.company_name} sent you a message on Connect.`;
    path = `/messages/${conversationId}`;
  }

  const out: Email[] = [];
  for (const r of await wanting(db, "messages", recipients)) {
    if (r.id === senderId) continue;
    if (await claimSlot(db, r.id, `conversation:${conversationId}`, MESSAGE_QUIET_MINUTES, now)) {
      out.push(notificationEmail(r.email, "New message on QUANTT Connect", line, path));
    }
  }
  await send(out);
}

/** A member applied in the hub: email the firm's users. */
export async function notifyNewApplication(db: D1Database, send: SendEmails, postId: string, memberName: string) {
  const post = await db
    .prepare(`SELECT title, company_id FROM posts WHERE id = ?`)
    .bind(postId)
    .first<{ title: string; company_id: string | null }>();
  if (!post?.company_id) return;
  const { results } = await db
    .prepare(`SELECT p.id, p.email FROM company_users cu JOIN profiles p ON p.id = cu.profile_id WHERE cu.company_id = ?`)
    .bind(post.company_id)
    .all<Recipient>();
  const line = `${memberName || "A QUANTT member"} applied to ${post.title}.`;
  await send(
    (await wanting(db, "applications", results)).map((r) =>
      notificationEmail(r.email, `New application: ${post.title}`, line, "/company/applicants"),
    ),
  );
}

const STAGE_LABEL: Record<string, string> = {
  submitted: "Submitted",
  reviewing: "Reviewing",
  interviewing: "Interviewing",
  offer: "Offer",
  closed: "Closed",
};

/** A firm moved an application: email the member. */
export async function notifyApplicationStage(db: D1Database, send: SendEmails, applicationId: string, stage: string) {
  const row = await db
    .prepare(
      `SELECT p.id, p.email, po.title, co.name AS company_name
         FROM applications a
         JOIN profiles p ON p.id = a.member_id
         LEFT JOIN posts po ON po.id = a.post_id
         LEFT JOIN companies co ON co.id = COALESCE(a.company_id, po.company_id)
        WHERE a.id = ?`,
    )
    .bind(applicationId)
    .first<Recipient & { title: string | null; company_name: string | null }>();
  if (!row) return;
  const what = [row.title, row.company_name].filter(Boolean).join(" at ") || "your application";
  const line = `Your application for ${what} is now: ${STAGE_LABEL[stage] ?? stage}.`;
  await send(
    (await wanting(db, "application_updates", [row])).map((r) =>
      notificationEmail(r.email, "Application update on QUANTT Connect", line, "/applications"),
    ),
  );
}

/** A new job post: email members who turned new_jobs on. */
export async function notifyNewJob(db: D1Database, send: SendEmails, postId: string) {
  const post = await db
    .prepare(
      `SELECT po.title, co.name AS company_name FROM posts po LEFT JOIN companies co ON co.id = po.company_id
        WHERE po.id = ? AND po.kind IN ('job', 'job_link') AND po.published = 1`,
    )
    .bind(postId)
    .first<{ title: string; company_name: string | null }>();
  if (!post) return;
  await ensureNotificationTables(db);
  const { results } = await db
    .prepare(
      `SELECT p.id, p.email FROM profiles p JOIN notification_prefs n ON n.profile_id = p.id
        WHERE p.role = 'member' AND n.new_jobs = 1`,
    )
    .all<Recipient>();
  const what = post.company_name ? `${post.title} at ${post.company_name}` : post.title;
  await send(
    results.map((r) => notificationEmail(r.email, `New job on Connect: ${what}`, `New job posted: ${what}.`, `/feed/${postId}`)),
  );
}

/** Runs a notification without ever failing the caller. */
export async function quietly(label: string, task: () => Promise<void>) {
  try {
    await task();
  } catch (e) {
    console.error(`notification not sent (${label})`, e);
  }
}

/** A message in an alumni conversation: email the other side. */
export async function notifyAlumniMessage(
  db: D1Database,
  send: SendEmails,
  conversationId: string,
  sender: "alumni" | "member",
  now = new Date(),
) {
  const c = await db
    .prepare(
      `SELECT c.member_id, p.email AS member_email, p.full_name AS member_name,
              c.alumni_id, a.email AS alumni_email, a.full_name AS alumni_name, a.email_messages
         FROM alumni_conversations c JOIN profiles p ON p.id = c.member_id JOIN alumni a ON a.id = c.alumni_id
        WHERE c.id = ?`,
    )
    .bind(conversationId)
    .first<{
      member_id: string; member_email: string; member_name: string;
      alumni_id: string; alumni_email: string; alumni_name: string; email_messages: number;
    }>();
  if (!c) return;
  const topic = `alumni-conversation:${conversationId}`;
  if (sender === "alumni") {
    const [to] = await wanting(db, "messages", [{ id: c.member_id, email: c.member_email }]);
    if (to && (await claimSlot(db, to.id, topic, MESSAGE_QUIET_MINUTES, now))) {
      await send([
        notificationEmail(to.email, "New message on QUANTT Connect", `${c.alumni_name || "A QUANTT alum"} (alumni) sent you a message on Connect.`, `/alumni-network/messages/${conversationId}`),
      ]);
    }
  } else if (c.email_messages === 1 && (await claimSlot(db, `alumni:${c.alumni_id}`, topic, MESSAGE_QUIET_MINUTES, now))) {
    await send([
      notificationEmail(c.alumni_email, "New message on QUANTT Connect", `${c.member_name || "A QUANTT member"} sent you a message on Connect.`, `/alumni/messages/${conversationId}`),
    ]);
  }
}

/**
 * A member's message request: email the alum. Request emails are ON for alumni
 * until they turn them off (Ethan, 2026-11-02), unlike every other email here.
 */
export async function notifyAlumniRequest(db: D1Database, send: SendEmails, conversationId: string) {
  const c = await db
    .prepare(
      `SELECT c.alumni_id, a.email AS alumni_email, p.full_name AS member_name
         FROM alumni_conversations c JOIN profiles p ON p.id = c.member_id JOIN alumni a ON a.id = c.alumni_id
        WHERE c.id = ?`,
    )
    .bind(conversationId)
    .first<{ alumni_id: string; alumni_email: string; member_name: string }>();
  if (!c || !(await getAlumniPrefs(db, c.alumni_id)).requests) return;
  await send([
    notificationEmail(
      c.alumni_email,
      "New message request on QUANTT Connect",
      `${c.member_name || "A QUANTT member"} asked to message you on Connect. Accept to start the conversation, or decline.`,
      `/alumni/messages/${conversationId}`,
    ),
  ]);
}

/** The alum accepted: email the member if they turned message emails on. */
export async function notifyAlumniRequestAccepted(db: D1Database, send: SendEmails, conversationId: string) {
  const c = await db
    .prepare(
      `SELECT c.member_id, p.email AS member_email, a.full_name AS alumni_name
         FROM alumni_conversations c JOIN profiles p ON p.id = c.member_id JOIN alumni a ON a.id = c.alumni_id
        WHERE c.id = ?`,
    )
    .bind(conversationId)
    .first<{ member_id: string; member_email: string; alumni_name: string }>();
  if (!c) return;
  const [to] = await wanting(db, "messages", [{ id: c.member_id, email: c.member_email }]);
  if (!to) return;
  await send([
    notificationEmail(
      to.email,
      "Message request accepted on QUANTT Connect",
      `${c.alumni_name || "A QUANTT alum"} accepted your message request. You can message them now.`,
      `/alumni-network/messages/${conversationId}`,
    ),
  ]);
}
