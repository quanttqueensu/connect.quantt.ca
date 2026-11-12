-- Requests and feedback sponsors send from Company -> Feedback. Only Connect
-- admins read them (Admin -> Feedback); the firm sees its own list.
-- Also created on first use by lib/sponsor-feedback.ts, so this file can lag a deploy.
CREATE TABLE IF NOT EXISTS sponsor_feedback (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  profile_id text REFERENCES profiles (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('request', 'feedback', 'problem')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  resolved_at text,
  resolved_by text REFERENCES profiles (id) ON DELETE SET NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS sponsor_feedback_company_idx ON sponsor_feedback (company_id, created_at);
CREATE INDEX IF NOT EXISTS sponsor_feedback_status_idx ON sponsor_feedback (status, created_at);
-- Admins who asked to be emailed about new sponsor feedback (off until they turn it on).
CREATE TABLE IF NOT EXISTS sponsor_feedback_watchers (
  profile_id text PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
