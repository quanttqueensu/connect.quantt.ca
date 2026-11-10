// The Worker's entry point: OpenNext's generated handler, plus a cron job.
//
// POST /api/opportunities/sync and /run are answered here, before Next and its
// sign-in middleware, with a bearer token. /run fetches the public job lists,
// stores them and posts new roles to Discord (lib/jobs/daily.ts); "Run workflow"
// on GitHub (.github/workflows/opportunities.yml) calls it. /sync stores
// listings someone else fetched (lib/jobs/store.ts).
//
// The hourly cron in wrangler.jsonc: copy headshots and resumes changed on
// auth.quantt.ca into the profiles of members who keep sync on
// (lib/directory-files.ts); at 08:00 UTC, also delete expired sessions,
// sign-in codes and join-form admission rows from D1. Hourly too: members who
// graduated on auth.quantt.ca become alumni (lib/alumni/graduates.ts); in April
// at 08:00 UTC, graduates without a personal email get one reminder. At 11:00
// UTC, the daily Opportunities run (lib/jobs/daily.ts).
//
// See https://opennext.js.org/cloudflare/howtos/custom-worker
// `.open-next/worker.js` only exists after `opennextjs-cloudflare build`.
import handler from "./.open-next/worker.js";
import { handleSync } from "./lib/jobs/store";
import { DAILY_HOUR_UTC, handleRun, runOpportunities } from "./lib/jobs/daily";
import { syncAllDirectoryFiles } from "./lib/directory-files";
import { syncGraduates, remindPersonalEmail } from "./lib/alumni/graduates";
import { syncAllGradYears } from "./lib/graduation-sync";
import { sendEmail, graduationEmail, personalEmailReminder } from "./lib/cf-auth/email";

const SITE = "https://connect.quantt.ca";

const worker = {
  fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === "/api/opportunities/sync") return handleSync(request, env);
    if (path === "/api/opportunities/run") return handleRun(request, env);
    return handler.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (!env.DB) {
      console.error("cleanup: the DB binding is missing");
      return;
    }
    if (env.FILES && env.AUTH) {
      ctx.waitUntil(
        syncAllDirectoryFiles(env.DB, env.FILES, env.AUTH).then(
          (r) => console.log("directory sync", JSON.stringify(r)),
          (err) => console.error("directory sync failed", err),
        ),
      );
    }
    // Members who graduated on auth.quantt.ca become alumni here (lib/alumni/graduates.ts), after grad years
    // are brought in step with auth (lib/graduation-sync.ts).
    if (env.FILES && env.AUTH) {
      ctx.waitUntil(
        syncAllGradYears(env.DB, env.AUTH).catch((err) => console.error("grad year sync failed", err)).then(() => syncGraduates(env.DB, env.FILES, env.AUTH, (to, name) => sendEmail(env, to, graduationEmail(name, `${SITE}/alumni/login`)))).then(
          (r) => console.log("graduates", JSON.stringify(r)),
          (err) => console.error("graduates sync failed", err),
        ),
      );
    }
    const hour = new Date(controller.scheduledTime).getUTCHours();
    if (hour === DAILY_HOUR_UTC) {
      ctx.waitUntil(
        runOpportunities(env).then(
          (r) => {
            const line = JSON.stringify({ ...r, added: r.added.length });
            if (r.discord.startsWith("failed")) console.error("opportunities: discord post failed", line);
            else console.log("opportunities", line);
          },
          (err) => console.error("opportunities run failed", err),
        ),
      );
    }
    if (hour !== 8) return;
    // April, daily at 08:00 UTC: remind this spring's graduates to give auth a personal email (once each).
    if (env.AUTH) {
      ctx.waitUntil(
        remindPersonalEmail(env.DB, env.AUTH, (to, name, year) => sendEmail(env, to, personalEmailReminder(name, year))).then(
          (n) => n && console.log("graduation reminders sent", n),
          (err) => console.error("graduation reminders failed", err),
        ),
      );
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
    // Separate batch: the alumni tables are created on first use, so they may
    // not exist yet, and that must not stop the cleanup above.
    ctx.waitUntil(
      env.DB.batch([
        env.DB.prepare("DELETE FROM alumni_sessions WHERE expires_at <= ?").bind(now),
        env.DB.prepare("DELETE FROM alumni_login_codes WHERE expires_at <= ?").bind(dayAgo),
      ]).then(
        () => console.log("cleanup: expired alumni rows removed"),
        (err) => console.error("alumni cleanup skipped", err),
      ),
    );
  },
};

export default worker;

// OpenNext's Durable Object classes, re-exported as its docs require for a custom
// entry point. This app binds none of them today.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
