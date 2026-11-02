-- Message requests: a member's first message to an alum is a request the alum
-- accepts or declines. Plus alumni email settings (request emails on by default).
-- Same statements as ALUMNI_REQUESTS_SCHEMA in lib/alumni/schema.ts, which also runs them on first use.

CREATE TABLE IF NOT EXISTS alumni_message_requests (
  conversation_id text PRIMARY KEY REFERENCES alumni_conversations (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at text
);

CREATE TABLE IF NOT EXISTS alumni_notification_prefs (
  alumni_id text PRIMARY KEY REFERENCES alumni (id) ON DELETE CASCADE,
  requests integer NOT NULL DEFAULT 1 CHECK (requests IN (0, 1)),
  messages integer NOT NULL DEFAULT 0 CHECK (messages IN (0, 1)),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
