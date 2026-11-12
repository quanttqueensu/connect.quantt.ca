-- Requests and feedback alumni send from Alumni -> Feedback. Same admin inbox
-- (Admin -> Feedback) as sponsor feedback; the alum sees their own list.
-- Also created on first use by lib/sponsor-feedback.ts, so this file can lag a deploy.
CREATE TABLE IF NOT EXISTS alumni_feedback (
  id text PRIMARY KEY,
  alumni_id text REFERENCES alumni (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('request', 'feedback', 'problem')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  resolved_at text,
  resolved_by text REFERENCES profiles (id) ON DELETE SET NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS alumni_feedback_alumni_idx ON alumni_feedback (alumni_id, created_at);
CREATE INDEX IF NOT EXISTS alumni_feedback_status_idx ON alumni_feedback (status, created_at);
