-- One hub account per club member. Queen's gives each student two addresses for one mailbox (first.last@ and
-- NetID@), and auth.quantt.ca lets a member sign in with either, so the hub keys members on the directory's
-- stable member id (the sign-in code's `sub`), not on the email they happened to use.
-- Same statement as MEMBER_LINKS_SCHEMA in lib/cf-auth/accounts.ts, which also runs it on first use.

CREATE TABLE IF NOT EXISTS member_links (
  directory_id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  linked_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS member_links_profile_idx ON member_links (profile_id);
