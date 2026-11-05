/**
 * Who an email belongs to, and creating the profile the first time an
 * invited person signs in. Replaces Supabase's handle_new_user() trigger and
 * the account half of app/auth/quantt/callback/route.ts.
 */

import type { D1Database } from "@/lib/db/d1";
import { normalizeEmail } from "@/lib/cf-auth/tokens";

type Invite = {
  id: string;
  email: string;
  full_name: string;
  role: "member" | "company_user";
  is_admin: number;
  company_id: string | null;
};

type ProfileRef = { id: string; role: "member" | "company_user"; is_admin: number };

export async function profileByEmail(db: D1Database, email: string) {
  return db
    .prepare(`SELECT id, role, is_admin FROM profiles WHERE email = ? COLLATE NOCASE`)
    .bind(normalizeEmail(email))
    .first<ProfileRef>();
}

export async function pendingInvite(db: D1Database, email: string) {
  return db
    .prepare(
      `SELECT id, email, full_name, role, is_admin, company_id FROM invites
        WHERE lower(email) = ? AND accepted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(normalizeEmail(email))
    .first<Invite>();
}

/**
 * True if this email may be sent a sign-in code: a company account, or a
 * pending company invite. Club members sign in through auth.quantt.ca
 * ("Sign in with QUANTT"), never with an emailed code.
 */
export async function canSignIn(db: D1Database, email: string) {
  const profile = await profileByEmail(db, email);
  const invite = await pendingInvite(db, email);
  if (profile) {
    if (profile.role !== "company_user") return false;
    // A contact an admin removed has no firm link left; only a new invite lets them back in.
    return (await hasCompanyLink(db, profile.id)) || invite?.role === "company_user";
  }
  return invite?.role === "company_user";
}

async function hasCompanyLink(db: D1Database, profileId: string) {
  return Boolean(
    await db.prepare(`SELECT 1 AS ok FROM company_users WHERE profile_id = ?`).bind(profileId).first(),
  );
}

/**
 * Admin "Remove access" for a sponsor contact: unlink them from their firm and
 * sign them out everywhere. Their posts and messages stay with the firm.
 * Members and admins are never touched. Returns false if nothing was removed.
 */
export async function removeCompanyContact(db: D1Database, profileId: string) {
  const row = await db
    .prepare(`SELECT p.id FROM profiles p JOIN company_users cu ON cu.profile_id = p.id
      WHERE p.id = ? AND p.role = 'company_user' AND p.is_admin = 0`)
    .bind(profileId)
    .first<{ id: string }>();
  if (!row) return false;
  await db.batch([
    db.prepare(`DELETE FROM company_users WHERE profile_id = ?`).bind(profileId),
    db.prepare(`DELETE FROM sessions WHERE profile_id = ?`).bind(profileId),
  ]);
  return true;
}

/** Admin "Cancel invite": only an invite nobody has used yet. */
export async function cancelPendingInvite(db: D1Database, inviteId: string) {
  const res = await db
    .prepare(`DELETE FROM invites WHERE id = ? AND accepted_at IS NULL`)
    .bind(inviteId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

function defaultName(invite: { full_name: string }, email: string) {
  return invite.full_name.trim() || email.split("@")[0];
}

/**
 * handle_new_user(): the person's profile, creating it from their pending
 * invite on first sign-in. Null when there is neither (invite required).
 */
export async function profileForSignIn(db: D1Database, rawEmail: string, now = new Date()) {
  const email = normalizeEmail(rawEmail);
  const existing = await profileByEmail(db, email);
  const invite = await pendingInvite(db, email);
  if (existing) {
    // A removed sponsor contact invited again: link them to the invite's firm.
    if (
      existing.role === "company_user" && invite?.role === "company_user" && invite.company_id &&
      !(await hasCompanyLink(db, existing.id))
    ) {
      await db.batch([
        db.prepare(`INSERT INTO company_users (company_id, profile_id) VALUES (?, ?)`).bind(invite.company_id, existing.id),
        db.prepare(`UPDATE invites SET accepted_at = ? WHERE id = ?`).bind(now.toISOString(), invite.id),
      ]);
    }
    return existing;
  }
  if (!invite) return null;

  const id = crypto.randomUUID();
  const at = now.toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO profiles (id, email, full_name, role, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, email, defaultName(invite, email), invite.role, invite.is_admin ? 1 : 0, at),
    db.prepare(`UPDATE invites SET accepted_at = ? WHERE id = ?`).bind(at, invite.id),
  ];
  if (invite.role === "company_user" && invite.company_id) {
    statements.splice(
      1,
      0,
      db.prepare(`INSERT INTO company_users (company_id, profile_id) VALUES (?, ?)`).bind(invite.company_id, id),
    );
  }
  await db.batch(statements);
  return { id, role: invite.role, is_admin: invite.is_admin ? 1 : 0 } satisfies ProfileRef;
}

export type QuanttSigninOutcome =
  | { ok: true; profileId: string }
  | { ok: false; code: "quantt_signin_company" | "quantt_signin_failed" };

export const MEMBER_LINKS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS member_links (
  directory_id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  linked_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`,
  `CREATE INDEX IF NOT EXISTS member_links_profile_idx ON member_links (profile_id)`,
];

let linksReady = false;
async function ensureMemberLinks(db: D1Database) {
  if (linksReady) return;
  await db.batch(MEMBER_LINKS_SCHEMA.map((s) => db.prepare(s)));
  linksReady = true;
}

/** The member profile already linked to this directory member, if any. */
async function linkedProfile(db: D1Database, directoryId: string) {
  return db
    .prepare(
      `SELECT p.id, p.role, p.is_admin FROM member_links l JOIN profiles p ON p.id = l.profile_id
        WHERE l.directory_id = ?`,
    )
    .bind(directoryId)
    .first<ProfileRef>();
}

/** The oldest member profile under any of the member's addresses (an older account made before linking). */
async function memberProfileByEmails(db: D1Database, emails: string[]) {
  if (!emails.length) return null;
  return db
    .prepare(
      `SELECT id, role, is_admin FROM profiles
        WHERE role = 'member' AND lower(email) IN (${emails.map(() => "?").join(", ")})
        ORDER BY created_at, id LIMIT 1`,
    )
    .bind(...emails)
    .first<ProfileRef>();
}

/**
 * "Sign in with QUANTT" (auth.quantt.ca). Club members need no invite: the
 * directory already vouched for them. Its Connect role decides hub admin on
 * every sign-in. A company account with the same email is refused.
 *
 * One account per member: a Queen's student has two addresses for one mailbox
 * (first.last@ and NetID@) and may sign in with either. The hub finds the member
 * by the directory's stable id (`sub`), then by any of their addresses
 * (`emails`, all of them as the directory knows them), and only then creates a
 * profile. Whichever it finds is linked to `sub` so later sign-ins land on it.
 */
export async function profileForQuanttMember(
  db: D1Database,
  claims: { sub?: string | null; email: string; emails?: string[]; name: string | null; role: "admin" | "member" },
  now = new Date(),
): Promise<QuanttSigninOutcome> {
  const email = normalizeEmail(claims.email);
  const emails = [...new Set([email, ...(claims.emails ?? []).map(normalizeEmail)].filter((e) => e.includes("@")))];
  const sub = claims.sub?.trim() || null;
  const isAdmin = claims.role === "admin" ? 1 : 0;

  const byEmail = await profileByEmail(db, email);
  if (byEmail?.role === "company_user") return { ok: false, code: "quantt_signin_company" };

  if (sub) await ensureMemberLinks(db);
  const existing =
    (sub ? await linkedProfile(db, sub) : null) ?? (byEmail?.role === "member" ? byEmail : null) ?? (await memberProfileByEmails(db, emails));
  if (existing) {
    const statements = [];
    if (existing.is_admin !== isAdmin) {
      statements.push(db.prepare(`UPDATE profiles SET is_admin = ? WHERE id = ?`).bind(isAdmin, existing.id));
    }
    if (sub) statements.push(linkStatement(db, sub, existing.id, now));
    if (statements.length) await db.batch(statements);
    return { ok: true, profileId: existing.id };
  }

  const invite = await pendingInvite(db, email);
  if (invite?.role === "company_user") return { ok: false, code: "quantt_signin_company" };

  const id = crypto.randomUUID();
  const at = now.toISOString();
  const name = claims.name?.trim() || (invite ? defaultName(invite, email) : email.split("@")[0]);
  const statements = [
    db
      .prepare(
        `INSERT INTO profiles (id, email, full_name, role, is_admin, created_at) VALUES (?, ?, ?, 'member', ?, ?)`,
      )
      .bind(id, email, name, isAdmin, at),
  ];
  if (invite) statements.push(db.prepare(`UPDATE invites SET accepted_at = ? WHERE id = ?`).bind(at, invite.id));
  if (sub) statements.push(linkStatement(db, sub, id, now));
  await db.batch(statements);
  return { ok: true, profileId: id };
}

function linkStatement(db: D1Database, directoryId: string, profileId: string, now: Date) {
  return db
    .prepare(
      `INSERT INTO member_links (directory_id, profile_id, linked_at) VALUES (?, ?, ?)
       ON CONFLICT (directory_id) DO NOTHING`,
    )
    .bind(directoryId, profileId, now.toISOString());
}
