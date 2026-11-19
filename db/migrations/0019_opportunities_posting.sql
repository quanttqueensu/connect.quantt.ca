-- Opportunities digest (lib/jobs/daily.ts): which listings reached #opportunities, and the cron's
-- own small state.
--
-- job_listings.discord_posted_at: set per Discord message once that message is posted. The daily
-- run posts open, unhidden listings where it is NULL. Everything stored before this migration was
-- already handled by the old digest, so it is marked as posted (no flood on the first run).
ALTER TABLE job_listings ADD COLUMN discord_posted_at text;
UPDATE job_listings SET discord_posted_at = first_seen_at WHERE discord_posted_at IS NULL;

-- cron_state: one row per key, for the Worker's scheduled jobs.
--   opportunities:lease         ISO time a running Opportunities run's claim ends (no overlapping runs)
--   opportunities:last_success  ISO time of the last run that stored and posted without error
--   empty:<source file>         YYYY-MM-DD a source first returned zero roles (alert on a second day)
--   alert:<key>                 YYYY-MM-DD an ops alert was last posted (one per key per day, lib/ops-alert.ts)
CREATE TABLE IF NOT EXISTS cron_state (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
