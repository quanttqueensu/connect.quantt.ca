-- Graduates' welcome email is sent once, recorded here (lib/alumni/graduates.ts): sent while NULL,
-- set after the send succeeds. Every graduate already here was welcomed (or linked to an invited
-- account) under the old code, so they are marked as sent and nobody is emailed again.
ALTER TABLE alumni_graduation ADD COLUMN welcome_sent_at text;
UPDATE alumni_graduation SET welcome_sent_at = created_at WHERE welcome_sent_at IS NULL;
