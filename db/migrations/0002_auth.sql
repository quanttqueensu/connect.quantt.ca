-- Sign-in for the Cloudflare hub (replaces Supabase Auth).
--
-- Members keep "Sign in with QUANTT" (auth.quantt.ca). Sponsors and anyone
-- else with an invite sign in with a six-digit code sent to their email.
-- No passwords are stored. Codes and session tokens are stored only as
-- SHA-256 hashes, so a database read cannot sign anyone in.

CREATE TABLE login_codes (
  id text PRIMARY KEY,
  email text NOT NULL COLLATE NOCASE,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at text NOT NULL,
  used_at text,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX login_codes_email_idx ON login_codes (email, created_at);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at text NOT NULL,
  last_seen_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX sessions_profile_idx ON sessions (profile_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
