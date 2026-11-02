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

let ready = false;
export async function ensureAlumniTables(db: D1Database) {
  if (ready) return;
  await db.batch([...ALUMNI_SCHEMA, ...ALUMNI_DISCORD_SCHEMA].map((s) => db.prepare(s)));
  ready = true;
}
