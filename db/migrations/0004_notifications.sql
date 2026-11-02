-- Email notifications and each person's settings for them.
-- IF NOT EXISTS because lib/notifications.ts also creates these on first use,
-- so a deploy works before `wrangler d1 migrations apply` has run.

CREATE TABLE IF NOT EXISTS notification_prefs (
  profile_id text PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  messages integer NOT NULL DEFAULT 1 CHECK (messages IN (0, 1)),
  applications integer NOT NULL DEFAULT 1 CHECK (applications IN (0, 1)),
  application_updates integer NOT NULL DEFAULT 1 CHECK (application_updates IN (0, 1)),
  new_jobs integer NOT NULL DEFAULT 0 CHECK (new_jobs IN (0, 1)),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- When someone was last emailed about a thing (e.g. one conversation), so a
-- burst of messages sends one email, not ten.
CREATE TABLE IF NOT EXISTS notification_log (
  recipient text NOT NULL,
  topic text NOT NULL,
  sent_at text NOT NULL,
  PRIMARY KEY (recipient, topic)
);
