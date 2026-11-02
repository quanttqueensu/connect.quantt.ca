-- Each member's "Keep in sync" setting for their headshot and resume from
-- auth.quantt.ca, and the directory upload times last copied. No row means
-- sync is on and nothing has been copied yet. IF NOT EXISTS because
-- lib/directory-files.ts also creates it on first use.

CREATE TABLE IF NOT EXISTS directory_sync (
  profile_id text PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  enabled integer NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  photo_stamp text,
  resume_stamp text,
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
