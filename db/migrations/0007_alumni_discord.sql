-- The Discord account each alumnus linked from /alumni/discord, so the bot can
-- take the Alumni role away when an admin removes them (lib/alumni/discord.ts).
-- Same statement as ALUMNI_DISCORD_SCHEMA in lib/alumni/schema.ts, which also runs it on first use.

CREATE TABLE IF NOT EXISTS alumni_discord (
  alumni_id text PRIMARY KEY REFERENCES alumni (id) ON DELETE CASCADE,
  discord_id text NOT NULL UNIQUE,
  username text NOT NULL DEFAULT '',
  linked_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
