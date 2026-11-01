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

/** True if this email may be sent a sign-in code: an account or a pending invite. */
export async function canSignIn(db: D1Database, email: string) {
  return Boolean((await profileByEmail(db, email)) || (await pendingInvite(db, email)));
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
  if (existing) return existing;
  const invite = await pendingInvite(db, email);
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

/**
 * "Sign in with QUANTT" (auth.quantt.ca). Club members need no invite: the
 * directory already vouched for them. Its Connect role decides hub admin on
 * every sign-in. A company account with the same email is refused.
 */
export async function profileForQuanttMember(
  db: D1Database,
  claims: { email: string; name: string | null; role: "admin" | "member" },
  now = new Date(),
): Promise<QuanttSigninOutcome> {
  const email = normalizeEmail(claims.email);
  const isAdmin = claims.role === "admin" ? 1 : 0;
  const existing = await profileByEmail(db, email);
  if (existing?.role === "company_user") return { ok: false, code: "quantt_signin_company" };
  if (existing) {
    if (existing.is_admin !== isAdmin) {
      await db.prepare(`UPDATE profiles SET is_admin = ? WHERE id = ?`).bind(isAdmin, existing.id).run();
    }
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
  await db.batch(statements);
  return { ok: true, profileId: id };
}
