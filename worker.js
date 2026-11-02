// The Worker's entry point: OpenNext's generated handler, plus a cron job.
//
// POST /api/opportunities/sync is answered here, before Next and its sign-in
// middleware: the GitHub Action (.github/workflows/opportunities.yml) sends the
// day's listings with a bearer token (lib/jobs/store.ts).
//
// The cron in wrangler.jsonc runs `scheduled` once a day to delete expired
// sessions, sign-in codes and join-form admission rows from D1. (It used to
// keep the free Supabase project from pausing.)
//
// See https://opennext.js.org/cloudflare/howtos/custom-worker
// `.open-next/worker.js` only exists after `opennextjs-cloudflare build`.
import handler from "./.open-next/worker.js";
import { handleSync } from "./lib/jobs/store";

const worker = {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname === "/api/opportunities/sync") {
      return handleSync(request, env);
    }
    return handler.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    if (!env.DB) {
      console.error("cleanup: the DB binding is missing");
      return;
    }
    const now = new Date().toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    ctx.waitUntil(
      env.DB.batch([
        env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
        env.DB.prepare("DELETE FROM login_codes WHERE expires_at <= ?").bind(dayAgo),
        env.DB.prepare("DELETE FROM join_admission WHERE expires_at <= ?").bind(now),
      ]).then(
        () => console.log("cleanup: expired rows removed"),
        (err) => console.error("cleanup failed", err),
      ),
    );
  },
};

export default worker;

// OpenNext's Durable Object classes, re-exported as its docs require for a custom
// entry point. This app binds none of them today.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
