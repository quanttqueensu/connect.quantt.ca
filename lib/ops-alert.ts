/**
 * Ops alerts: a short post to the QUANTT ops Discord channel (Worker var
 * OPS_ALERT_CHANNEL) from QUANTT Bot (DISCORD_BOT_TOKEN), for things a person
 * should look at: a scheduled job skipped a step or failed.
 *
 * Always logged with console.error. Posted at most once per key per UTC day
 * (cron_state, db/migrations/0019). Missing var or token: log only. Never
 * throws into the caller.
 *
 * Relative imports only: worker.js bundles this through wrangler, outside Next.
 */
import type { D1Database } from "./db/d1";
import { discordSender } from "./jobs/daily";

export type OpsEnv = { DB?: D1Database; DISCORD_BOT_TOKEN?: string; OPS_ALERT_CHANNEL?: string };

export async function opsAlert(env: OpsEnv, key: string, text: string, now = new Date()): Promise<void> {
  console.error(`ops alert [${key}]`, text);
  try {
    if (!env.OPS_ALERT_CHANNEL || !env.DISCORD_BOT_TOKEN || !env.DB) return;
    const day = now.toISOString().slice(0, 10);
    const claim = await env.DB
      .prepare(
        `INSERT INTO cron_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
         WHERE cron_state.value <> excluded.value`,
      )
      .bind(`alert:${key}`, day, now.toISOString())
      .run();
    if (claim.meta.changes !== 1) return; // already posted today
    await discordSender(env.DISCORD_BOT_TOKEN, env.OPS_ALERT_CHANNEL)(`⚠️ connect.quantt.ca: ${text}`.slice(0, 1900));
  } catch (e) {
    console.error("ops alert not posted", key, e);
  }
}
