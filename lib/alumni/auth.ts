/**
 * Alumni sign-in: an emailed six-digit code, then a session cookie of its own
 * (connect_alumni). Same design as the sponsor sign-in (lib/cf-auth/), but on
 * separate tables, so an alumni session can never open the member or sponsor
 * hub, and a hub session can never open the alumni area.
 *
 * Only an existing alumni account or a pending alumni invite gets a code. The
 * account is created from the invite on first sign-in.
 */
import type { D1Database } from "@/lib/db/d1";
import { looksLikeEmail, normalizeEmail, randomCode, randomToken, sameHex, sha256Hex } from "@/lib/cf-auth/tokens";
import { ensureAlumniTables, notSuspended } from "@/lib/alumni/schema";

export const ALUMNI_COOKIE = "connect_alumni";
export const ALUMNI_SESSION_DAYS = 30;
export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
export const CODES_PER_HOUR = 5;
const TOUCH_AFTER_MS = 3_600_000;

export type Alumnus = { id: string; email: string; full_name: string };

function hashCode(email: string, code: string) {
  return sha256Hex(`connect-alumni-login:${email}:${code}`);
}

async function alumnusByEmail(db: D1Database, email: string) {
  // A graduate whose graduation was undone on auth.quantt.ca can't sign in (lib/alumni/graduates.ts).
  return db.prepare(`SELECT id, email, full_name FROM alumni WHERE email = ? AND ${notSuspended("alumni.id")}`).bind(email).first<Alumnus>();
}

async function pendingAlumniInvite(db: D1Database, email: string) {
  return db
    .prepare(`SELECT id, full_name FROM alumni_invites WHERE email = ? AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .bind(email)
    .first<{ id: string; full_name: string }>();
}

export async function canAlumniSignIn(db: D1Database, email: string) {
  await ensureAlumniTables(db);
  return Boolean((await alumnusByEmail(db, email)) || (await pendingAlumniInvite(db, email)));
}

/** Sends a code if the email is allowed and under its hourly limit. Same outcome either way for the caller. */
export async function requestAlumniCode(
  db: D1Database,
  rawEmail: string,
  send: (to: string, code: string) => Promise<void>,
  now = new Date(),
) {
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email) || !(await canAlumniSignIn(db, email))) return;
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const recent = await db
    .prepare(`SELECT count(*) AS n FROM alumni_login_codes WHERE email = ? AND created_at > ?`)
    .bind(email, hourAgo)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= CODES_PER_HOUR) return;
  const code = randomCode();
  const at = now.toISOString();
  await db.batch([
    db.prepare(`UPDATE alumni_login_codes SET used_at = ? WHERE email = ? AND used_at IS NULL`).bind(at, email),
    db
      .prepare(`INSERT INTO alumni_login_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), email, await hashCode(email, code), new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString(), at),
  ]);
  await send(email, code);
}

export type AlumniVerify = { ok: true; alumniId: string } | { ok: false; code: "login_code_invalid" | "alumni_account_missing" };

export async function verifyAlumniCode(db: D1Database, rawEmail: string, rawCode: string, now = new Date()): Promise<AlumniVerify> {
  await ensureAlumniTables(db);
  const email = normalizeEmail(rawEmail);
  const code = rawCode.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, code: "login_code_invalid" };
  const at = now.toISOString();
  const row = await db
    .prepare(
      `SELECT id, code_hash, attempts FROM alumni_login_codes
        WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(email, at)
    .first<{ id: string; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= MAX_ATTEMPTS) return { ok: false, code: "login_code_invalid" };
  if (!sameHex(row.code_hash, await hashCode(email, code))) {
    await db
      .prepare(
        `UPDATE alumni_login_codes SET attempts = attempts + 1,
           used_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE used_at END WHERE id = ?`,
      )
      .bind(MAX_ATTEMPTS, at, row.id)
      .run();
    return { ok: false, code: "login_code_invalid" };
  }
  const spent = await db
    .prepare(`UPDATE alumni_login_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`)
    .bind(at, row.id)
    .run();
  if (spent.meta.changes !== 1) return { ok: false, code: "login_code_invalid" };

  const existing = await alumnusByEmail(db, email);
  if (existing) return { ok: true, alumniId: existing.id };
  const invite = await pendingAlumniInvite(db, email);
  if (!invite) return { ok: false, code: "alumni_account_missing" };
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(`INSERT INTO alumni (id, email, full_name, created_at) VALUES (?, ?, ?, ?)`)
      .bind(id, email, invite.full_name.trim() || email.split("@")[0], at),
    db.prepare(`UPDATE alumni_invites SET accepted_at = ? WHERE email = ? AND accepted_at IS NULL`).bind(at, email),
  ]);
  return { ok: true, alumniId: id };
}

export function alumniCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge: ALUMNI_SESSION_DAYS * 86_400 };
}

export async function createAlumniSession(db: D1Database, alumniId: string, now = new Date()) {
  const token = randomToken();
  await db
    .prepare(`INSERT INTO alumni_sessions (token_hash, alumni_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(await sha256Hex(token), alumniId, now.toISOString(), new Date(now.getTime() + ALUMNI_SESSION_DAYS * 86_400_000).toISOString(), now.toISOString())
    .run();
  return token;
}

export async function readAlumniSession(db: D1Database, token: string | null | undefined, now = new Date()): Promise<Alumnus | null> {
  if (!token || token.length < 32 || token.length > 128) return null;
  await ensureAlumniTables(db);
  const hash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT a.id, a.email, a.full_name, s.expires_at, s.last_seen_at
         FROM alumni_sessions s JOIN alumni a ON a.id = s.alumni_id WHERE s.token_hash = ? AND ${notSuspended("a.id")}`,
    )
    .bind(hash)
    .first<Alumnus & { expires_at: string; last_seen_at: string }>();
  if (!row) return null;
  if (row.expires_at <= now.toISOString()) {
    await db.prepare(`DELETE FROM alumni_sessions WHERE token_hash = ?`).bind(hash).run();
    return null;
  }
  if (now.getTime() - Date.parse(row.last_seen_at) > TOUCH_AFTER_MS) {
    await db.prepare(`UPDATE alumni_sessions SET last_seen_at = ? WHERE token_hash = ?`).bind(now.toISOString(), hash).run();
  }
  return { id: row.id, email: row.email, full_name: row.full_name };
}

export async function endAlumniSession(db: D1Database, token: string | null | undefined) {
  if (!token) return;
  await ensureAlumniTables(db);
  await db.prepare(`DELETE FROM alumni_sessions WHERE token_hash = ?`).bind(await sha256Hex(token)).run();
}
