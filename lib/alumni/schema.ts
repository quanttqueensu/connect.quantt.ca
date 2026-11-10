/**
 * The alumni area's tables: its own accounts, sign-in codes, sessions, posts
 * and conversations, kept apart from members (profiles) and sponsors.
 * Mirrors db/migrations/0006_alumni.sql (a test checks they match). Created on
 * first use, so a deploy works before `wrangler d1 migrations apply` has run.
 */
import type { D1Database } from "@/lib/db/d1";

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const ALUMNI_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS alumni (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE COLLATE NOCASE,
  full_name text NOT NULL DEFAULT '',
  grad_year integer,
  program text,
  firm text,
  title text,
  location text,
  linkedin_url text,
  bio text,
  email_messages integer NOT NULL DEFAULT 0 CHECK (email_messages IN (0, 1)),
  created_at text NOT NULL DEFAULT ${NOW}
)`,
  `CREATE TABLE IF NOT EXISTS alumni_invites (
  id text PRIMARY KEY,
  email text NOT NULL COLLATE NOCASE,
  full_name text NOT NULL DEFAULT '',
  invited_by text REFERENCES profiles (id) ON DELETE SET NULL,
  accepted_at text,
  created_at text NOT NULL DEFAULT ${NOW}
)`,
  `CREATE TABLE IF NOT EXISTS alumni_login_codes (
  id text PRIMARY KEY,
  email text NOT NULL COLLATE NOCASE,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at text NOT NULL,
  used_at text,
  created_at text NOT NULL DEFAULT ${NOW}
)`,
  `CREATE INDEX IF NOT EXISTS alumni_login_codes_email_idx ON alumni_login_codes (email, created_at)`,
  `CREATE TABLE IF NOT EXISTS alumni_sessions (
  token_hash text PRIMARY KEY,
  alumni_id text NOT NULL REFERENCES alumni (id) ON DELETE CASCADE,
  created_at text NOT NULL DEFAULT ${NOW},
  expires_at text NOT NULL,
  last_seen_at text NOT NULL DEFAULT ${NOW}
)`,
  `CREATE TABLE IF NOT EXISTS alumni_posts (
  id text PRIMARY KEY,
  alumni_id text NOT NULL REFERENCES alumni (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('job', 'mentorship')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  firm text,
  location text,
  external_url text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at text NOT NULL DEFAULT ${NOW}
)`,
  `CREATE TABLE IF NOT EXISTS alumni_conversations (
  id text PRIMARY KEY,
  alumni_id text NOT NULL REFERENCES alumni (id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  alumni_last_read_at text,
  member_last_read_at text,
  created_at text NOT NULL DEFAULT ${NOW},
  UNIQUE (alumni_id, member_id)
)`,
  `CREATE TABLE IF NOT EXISTS alumni_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES alumni_conversations (id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('alumni', 'member')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at text NOT NULL DEFAULT ${NOW}
)`,
  `CREATE INDEX IF NOT EXISTS alumni_messages_convo_idx ON alumni_messages (conversation_id, created_at)`,
];

/** The Discord account each alumnus linked (lib/alumni/discord.ts). Mirrors db/migrations/0007_alumni_discord.sql. */
export const ALUMNI_DISCORD_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS alumni_discord (
  alumni_id text PRIMARY KEY REFERENCES alumni (id) ON DELETE CASCADE,
  discord_id text NOT NULL UNIQUE,
  username text NOT NULL DEFAULT '',
  linked_at text NOT NULL DEFAULT ${NOW}
)`,
];

/**
 * Message requests and alumni email settings. Mirrors
 * db/migrations/0009_alumni_message_requests.sql.
 *
 *  - alumni_message_requests: a member's first contact with an alum. The
 *    conversation stays read-only for the member until the alum accepts. A
 *    conversation with no row here is open (alum-started, or from before
 *    requests existed).
 *  - alumni_notification_prefs: request emails default ON (Ethan, 2026-11-02);
 *    message emails default to the older alumni.email_messages setting.
 */
export const ALUMNI_REQUESTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS alumni_message_requests (
  conversation_id text PRIMARY KEY REFERENCES alumni_conversations (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at text NOT NULL DEFAULT ${NOW},
  decided_at text
)`,
  `CREATE TABLE IF NOT EXISTS alumni_notification_prefs (
  alumni_id text PRIMARY KEY REFERENCES alumni (id) ON DELETE CASCADE,
  requests integer NOT NULL DEFAULT 1 CHECK (requests IN (0, 1)),
  messages integer NOT NULL DEFAULT 0 CHECK (messages IN (0, 1)),
  updated_at text NOT NULL DEFAULT ${NOW}
)`,
];

/**
 * Graduates (lib/alumni/graduates.ts). Mirrors db/migrations/0011_alumni_graduation.sql.
 *
 *  - alumni_graduation: an alumni account made (or linked) for a member who
 *    graduated on auth.quantt.ca. profile_id is their old member profile, hidden
 *    from member lists while the row is active. suspended_at is set when auth's
 *    "Make member again" undoes the graduation: the account can't sign in and is
 *    hidden, but nothing is deleted. photo_path / resume_path are R2 paths under
 *    photos/ and resumes/.
 *  - graduation_reminders: the April "add a personal email" email, once per member per year.
 */
export const ALUMNI_GRADUATION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS alumni_graduation (
  alumni_id text PRIMARY KEY REFERENCES alumni (id) ON DELETE CASCADE,
  auth_id text NOT NULL UNIQUE,
  profile_id text REFERENCES profiles (id) ON DELETE SET NULL,
  photo_path text,
  resume_path text,
  discord_id text,
  resume_book_was integer NOT NULL DEFAULT 0 CHECK (resume_book_was IN (0, 1)),
  resume_book_at text,
  resume_book_by text,
  suspended_at text,
  created_at text NOT NULL DEFAULT ${NOW}
)`,
  `CREATE TABLE IF NOT EXISTS graduation_reminders (
  auth_id text NOT NULL,
  year integer NOT NULL,
  sent_at text NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (auth_id, year)
)`,
];

/** SQL: the alumni row `col` (e.g. "a.id") isn't a suspended graduate. */
export const notSuspended = (col: string) =>
  `NOT EXISTS (SELECT 1 FROM alumni_graduation sg WHERE sg.alumni_id = ${col} AND sg.suspended_at IS NOT NULL)`;
/** SQL: the member profile `col` isn't hidden because its owner graduated. */
export const notGraduated = (col: string) =>
  `NOT EXISTS (SELECT 1 FROM alumni_graduation gg WHERE gg.profile_id = ${col} AND gg.suspended_at IS NULL)`;

/**
 * Columns added to `alumni` after it was created. Mirrors
 * db/migrations/0013_alumni_contact.sql. Added one at a time on first use;
 * "duplicate column" means a migration or an earlier isolate already did it.
 */
export const ALUMNI_ADDED_COLUMNS = [
  `ALTER TABLE alumni ADD COLUMN phone text`,
  `ALTER TABLE alumni ADD COLUMN other_social_url text`,
];

let ready = false;
export async function ensureAlumniTables(db: D1Database) {
  if (ready) return;
  await db.batch([...ALUMNI_SCHEMA, ...ALUMNI_DISCORD_SCHEMA, ...ALUMNI_REQUESTS_SCHEMA, ...ALUMNI_GRADUATION_SCHEMA].map((s) => db.prepare(s)));
  for (const stmt of ALUMNI_ADDED_COLUMNS) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      if (!/duplicate column/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
  ready = true;
}
