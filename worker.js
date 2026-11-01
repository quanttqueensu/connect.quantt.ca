// The Worker's entry point: OpenNext's generated handler, plus a cron job.
//
// Supabase pauses a free project after about a week with no database activity,
// and then every sign-in check on connect.quantt.ca hangs until someone clicks
// Restore in the Supabase dashboard (this happened 2026-11-01). The cron in
// wrangler.jsonc runs `scheduled` every few days and makes one small database
// read, which counts as activity.
//
// See https://opennext.js.org/cloudflare/howtos/custom-worker
// `.open-next/worker.js` only exists after `opennextjs-cloudflare build`.
import handler from "./.open-next/worker.js";

const worker = {
  fetch: handler.fetch,

  async scheduled(_controller, env, ctx) {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      console.error("keep-alive: Supabase URL or anon key is not set");
      return;
    }
    // A plain PostgREST read reaches Postgres even when row-level security
    // returns no rows, which is all the pause timer looks at.
    ctx.waitUntil(
      fetch(`${url}/rest/v1/sponsor_tiers?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      }).then(
        (res) => console.log(`keep-alive: Supabase answered ${res.status}`),
        (err) => console.error("keep-alive: Supabase request failed", err),
      ),
    );
  },
};

export default worker;

// OpenNext's Durable Object classes, re-exported as its docs require for a custom
// entry point. This app binds none of them today.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
