-- Graduates: alumni accounts made from members who graduated on auth.quantt.ca,
-- and the April personal-email reminder log. Same statements as
-- ALUMNI_GRADUATION_SCHEMA in lib/alumni/schema.ts, which also runs them on first use.

CREATE TABLE IF NOT EXISTS alumni_graduation (
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
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS graduation_reminders (
  auth_id text NOT NULL,
  year integer NOT NULL,
  sent_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (auth_id, year)
);
