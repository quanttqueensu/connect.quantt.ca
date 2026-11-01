/**
 * Hub sessions on D1, replacing Supabase Auth's JWT cookies.
 *
 * The browser holds a random 256-bit token in an HttpOnly cookie. D1 holds
 * only its SHA-256 hash, so the sessions table cannot be replayed, and a
 * session ends the moment its row is deleted (sign out, or an admin
 * removing the account), which a self-contained JWT could not do.
 */

import type { D1Database } from "@/lib/db/d1";
import { randomToken, sha256Hex } from "@/lib/cf-auth/tokens";

export const SESSION_COOKIE = "connect_session";
export const SESSION_DAYS = 30;
/** Don't write last_seen_at on every request; once an hour is plenty. */
const TOUCH_AFTER_MS = 3_600_000;

export type SessionProfile = {
  id: string;
  email: string;
  role: "member" | "company_user";
  is_admin: number;
  company_id: string | null;
};

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  };
}

export async function createSession(db: D1Database, profileId: string, now = new Date()) {
  const token = randomToken();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, profile_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(await sha256Hex(token), profileId, now.toISOString(), expires.toISOString(), now.toISOString())
    .run();
  return { token, expiresAt: expires };
}

/** The signed-in profile for a cookie value, or null. One D1 read on the hot path. */
export async function readSession(
  db: D1Database,
  token: string | null | undefined,
  now = new Date(),
): Promise<SessionProfile | null> {
  if (!token || token.length < 32 || token.length > 128) return null;
  const hash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT p.id, p.email, p.role, p.is_admin, cu.company_id, s.last_seen_at, s.expires_at
         FROM sessions s
         JOIN profiles p ON p.id = s.profile_id
         LEFT JOIN company_users cu ON cu.profile_id = p.id
        WHERE s.token_hash = ?`,
    )
    .bind(hash)
    .first<SessionProfile & { last_seen_at: string; expires_at: string }>();
  if (!row) return null;
  if (row.expires_at <= now.toISOString()) {
    await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(hash).run();
    return null;
  }
  if (now.getTime() - Date.parse(row.last_seen_at) > TOUCH_AFTER_MS) {
    await db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`).bind(now.toISOString(), hash).run();
  }
  return { id: row.id, email: row.email, role: row.role, is_admin: row.is_admin, company_id: row.company_id };
}

export async function endSession(db: D1Database, token: string | null | undefined) {
  if (!token) return;
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256Hex(token)).run();
}

/** Signs a person out everywhere, e.g. when an admin removes their account. */
export async function endAllSessions(db: D1Database, profileId: string) {
  await db.prepare(`DELETE FROM sessions WHERE profile_id = ?`).bind(profileId).run();
}

/** Housekeeping for the scheduled handler. */
export async function purgeExpired(db: D1Database, now = new Date()) {
  const at = now.toISOString();
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).bind(at),
    db.prepare(`DELETE FROM login_codes WHERE expires_at <= ?`).bind(new Date(now.getTime() - 86_400_000).toISOString()),
    db.prepare(`DELETE FROM join_admission WHERE expires_at <= ?`).bind(at),
  ]);
}
