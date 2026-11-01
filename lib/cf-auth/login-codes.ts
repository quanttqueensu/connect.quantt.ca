/**
 * Email sign-in codes, replacing Supabase's password login and reset emails.
 *
 * A person types their email; if it has an account or a pending invite, we
 * email a six-digit code that works once, for 10 minutes, with 5 tries.
 * The page says the same thing whether or not the email is known, so it
 * cannot be used to find out who is a member or a sponsor.
 */

import type { D1Database } from "@/lib/db/d1";
import { canSignIn, profileForSignIn } from "@/lib/cf-auth/accounts";
import { looksLikeEmail, normalizeEmail, randomCode, sameHex, sha256Hex } from "@/lib/cf-auth/tokens";

export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
/** Codes one email can be sent per hour. */
export const CODES_PER_HOUR = 5;

export type SendCode = (to: string, code: string) => Promise<void>;

function hashCode(email: string, code: string) {
  return sha256Hex(`connect-login:${email}:${code}`);
}

/**
 * Sends a code if the email may sign in and is under its hourly limit.
 * Always resolves the same way; callers show one message either way.
 */
export async function requestLoginCode(db: D1Database, rawEmail: string, send: SendCode, now = new Date()) {
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email)) return;
  if (!(await canSignIn(db, email))) return;

  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const recent = await db
    .prepare(`SELECT count(*) AS n FROM login_codes WHERE email = ? AND created_at > ?`)
    .bind(email, hourAgo)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= CODES_PER_HOUR) return;

  const code = randomCode();
  const at = now.toISOString();
  const expires = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString();
  await db.batch([
    // Only the newest code works.
    db.prepare(`UPDATE login_codes SET used_at = ? WHERE email = ? AND used_at IS NULL`).bind(at, email),
    db
      .prepare(`INSERT INTO login_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), email, await hashCode(email, code), expires, at),
  ]);
  await send(email, code);
}

export type VerifyResult =
  | { ok: true; profileId: string; role: "member" | "company_user" }
  | { ok: false; code: "login_code_invalid" | "login_account_missing" };

/** Checks a code and, on success, returns the profile to start a session for. */
export async function verifyLoginCode(
  db: D1Database,
  rawEmail: string,
  rawCode: string,
  now = new Date(),
): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  const code = rawCode.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, code: "login_code_invalid" };

  const at = now.toISOString();
  const row = await db
    .prepare(
      `SELECT id, code_hash, attempts FROM login_codes
        WHERE email = ? AND used_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(email, at)
    .first<{ id: string; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= MAX_ATTEMPTS) return { ok: false, code: "login_code_invalid" };

  if (!sameHex(row.code_hash, await hashCode(email, code))) {
    await db
      .prepare(
        `UPDATE login_codes SET attempts = attempts + 1,
           used_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE used_at END
         WHERE id = ?`,
      )
      .bind(MAX_ATTEMPTS, at, row.id)
      .run();
    return { ok: false, code: "login_code_invalid" };
  }

  // Spend the code exactly once, even if two requests race.
  const spent = await db
    .prepare(`UPDATE login_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`)
    .bind(at, row.id)
    .run();
  if (spent.meta.changes !== 1) return { ok: false, code: "login_code_invalid" };

  const profile = await profileForSignIn(db, email, now);
  if (!profile) return { ok: false, code: "login_account_missing" };
  return { ok: true, profileId: profile.id, role: profile.role };
}
