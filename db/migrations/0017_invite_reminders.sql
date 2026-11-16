-- Send reminder log for pending sponsor and alumni invites (lib/invite-reminders.ts).
CREATE TABLE IF NOT EXISTS invite_reminders (
  id text PRIMARY KEY,
  invite_kind text NOT NULL CHECK (invite_kind IN ('sponsor', 'alumni')),
  invite_id text NOT NULL,
  sent_by text REFERENCES profiles (id) ON DELETE SET NULL,
  sent_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS invite_reminders_invite_idx ON invite_reminders (invite_kind, invite_id, sent_at);
