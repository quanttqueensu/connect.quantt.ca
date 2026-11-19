/**
 * The daily Opportunities run, inside the Worker: fetch the public lists,
 * store them (store.ts), and post the roles that weren't open before to
 * #opportunities in the QUANTT Discord.
 *
 * worker.js runs it from the hourly cron at 11:00 UTC, and for
 * POST /api/opportunities/run (bearer OPPORTUNITIES_SYNC_TOKEN), which the
 * "Run workflow" button on GitHub calls. The Discord post uses the Worker's
 * own DISCORD_BOT_TOKEN secret, the same one the alumni join uses.
 *
 * Reliability:
 *  - One run at a time: a lease row in cron_state (db/migrations/0019). A run
 *    that finds it held stops (RunInProgress); an abandoned lease ends after
 *    LEASE_MINUTES.
 *  - What gets posted comes from D1, not this run's memory: open, unhidden
 *    listings with discord_posted_at NULL first seen in the last NEW_DAYS.
 *    Each Discord message marks its own listings posted once it succeeds, so
 *    a failed post is retried by the next run and nothing is posted twice. A
 *    listing that closes and reopens keeps its discord_posted_at, so it isn't new.
 *  - A missed or failed day: worker.js also runs it on any hourly tick when
 *    the last successful run (cron_state) is over a day old (isDue).
 *  - A source file that gives zero roles two days running is reported in
 *    `alerts` (Simplify's internship list lives in a new repo each year).
 *
 * This used to run on GitHub's schedule with its own copy of the bot token.
 * That copy went stale after the token reset, and GitHub ran the schedule up
 * to ten hours late, so nothing reached Discord from Nov 3.
 *
 * Relative imports only: worker.js bundles this through wrangler, outside Next.
 */
import type { D1Database } from "../db/d1";
import { collectListings, inCanada, type SourceFile } from "./sources";
import { storeListings, tokenMatches, type NewListing, type SyncResult } from "./store";

/** #opportunities in the QUANTT Discord. */
export const OPPORTUNITIES_CHANNEL = "1566267471349030933";
/** The cron hour (UTC) of the daily run: 06:00 / 07:00 in Kingston. */
export const DAILY_HOUR_UTC = 11;

const TERM_ORDER: Record<string, number> = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
const PER_SECTION = 15;
const MAX_MESSAGE = 1900;
/** How long a run's lease lasts; longer than any run (a cron invocation is capped at 15 minutes). */
const LEASE_MINUTES = 15;
/** Unposted listings first seen this recently are posted; older ones are left (a role that reopened, say). */
const NEW_DAYS = 3;
/** worker.js runs a catch-up when the last successful run is older than this. */
const DUE_AFTER_HOURS = 24;
const LEASE_KEY = "opportunities:lease";
const SUCCESS_KEY = "opportunities:last_success";

export type OpportunitiesEnv = {
  DB?: D1Database;
  DISCORD_BOT_TOKEN?: string;
  OPPORTUNITIES_SYNC_TOKEN?: string;
};

export type RunResult = SyncResult & {
  /** "posted N", "nothing new", "no DISCORD_BOT_TOKEN", or "failed: ..." */
  discord: string;
  log: string[];
  /** Problems a person should look at (worker.js posts them as ops alerts). */
  alerts: string[];
};

/** Another run holds the lease; this one did nothing. */
export class RunInProgress extends Error {
  constructor() {
    super("another Opportunities run is in progress");
  }
}

type Get = (url: string) => Promise<string>;
type Send = (content: string) => Promise<void>;

async function fetchText(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "quantt-connect-opportunities" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
}

/**
 * Posts one message to a Discord channel as QUANTT Bot. A 429 (rate limited) means nothing was
 * posted, so it waits Discord's retry_after (at most 30 s) and tries once more.
 */
export function discordSender(token: string, channelId: string): Send {
  // Tolerates a pasted "Bot " prefix, quotes or a trailing newline in the secret.
  const bot = token.trim().replace(/^["']|["']$/g, "").replace(/^Bot\s+/i, "");
  const post = (content: string) =>
    fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${bot}`, "content-type": "application/json" },
      // flags 4: no link previews.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }),
    });
  return async (content) => {
    let r = await post(content);
    if (r.status === 429) {
      const body = (await r.json().catch(() => ({}))) as { retry_after?: number };
      const wait = Math.min(Math.max(Number(body.retry_after) || 1, 0), 30);
      await new Promise((res) => setTimeout(res, wait * 1000));
      r = await post(content);
    }
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  };
}

/** True when worker.js should run today's job now: the daily hour, or the last success is over a day old. */
export async function isDue(db: D1Database, now = new Date()): Promise<boolean> {
  if (now.getUTCHours() === DAILY_HOUR_UTC) return true;
  const row = await db.prepare(`SELECT value FROM cron_state WHERE key = ?`).bind(SUCCESS_KEY).first<{ value: string }>();
  return !row || Date.parse(row.value) < now.getTime() - DUE_AFTER_HOURS * 3_600_000;
}

async function takeLease(db: D1Database, now: Date): Promise<string | null> {
  const until = new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString();
  const r = await db
    .prepare(
      `INSERT INTO cron_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
       WHERE cron_state.value < ?`,
    )
    .bind(LEASE_KEY, until, now.toISOString(), now.toISOString())
    .run();
  return r.meta.changes === 1 ? until : null;
}

/** Records today's state of each source file; returns an alert for each that gave zero roles on an earlier day too. */
async function checkEmptySources(db: D1Database, counts: Partial<Record<SourceFile, number | null>> | undefined, now: Date) {
  const alerts: string[] = [];
  const today = now.toISOString().slice(0, 10);
  for (const [file, n] of Object.entries(counts ?? {})) {
    if (n === null || n === undefined) continue; // not read this run: no news either way
    const key = `empty:${file}`;
    if (n > 0) {
      await db.prepare(`DELETE FROM cron_state WHERE key = ?`).bind(key).run();
      continue;
    }
    await db.prepare(`INSERT INTO cron_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`).bind(key, today).run();
    const since = await db.prepare(`SELECT value FROM cron_state WHERE key = ?`).bind(key).first<{ value: string }>();
    if (since && since.value < today) alerts.push(`opportunities: ${file} has given 0 quant roles since ${since.value}; check its URL in lib/jobs/sources.ts`);
  }
  return alerts;
}

/**
 * Fetch, store, post. `postAll` posts every open role instead of the new ones.
 * `get` and `send` are swapped out by the tests. Throws RunInProgress when another run holds the lease.
 */
export async function runOpportunities(
  env: OpportunitiesEnv,
  opts: { postAll?: boolean; get?: Get; send?: Send; now?: Date } = {},
): Promise<RunResult> {
  const db = env.DB;
  if (!db) throw new Error("the DB binding is missing");
  const now = opts.now ?? new Date();
  const lease = await takeLease(db, now);
  if (!lease) throw new RunInProgress();
  try {
    const log: string[] = [];
    const sources = await collectListings(opts.get ?? fetchText, (line) => log.push(line));
    if (!sources.simplify && !sources.nwft) throw new Error(`every source failed: ${log.join("; ")}`);
    const result = await storeListings(db, { sources: { simplify: sources.simplify, nwft: sources.nwft } }, now);
    const alerts = await checkEmptySources(db, sources.counts, now);
    if (result.held.length) alerts.push(`opportunities: ${result.held.join(", ")} listed far fewer roles than are open; nothing of it was closed`);

    const list: NewListing[] = opts.postAll
      ? [...(sources.simplify ?? []), ...(sources.nwft ?? [])].sort((a, b) =>
          String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? "")),
        )
      : await unposted(db, now);
    const send = opts.send ?? (env.DISCORD_BOT_TOKEN ? discordSender(env.DISCORD_BOT_TOKEN, OPPORTUNITIES_CHANNEL) : null);
    let discord: string;
    if (!list.length) discord = "nothing new";
    else if (!send) discord = "no DISCORD_BOT_TOKEN";
    else {
      let posted = 0;
      try {
        for (const part of digestParts(list, opts.postAll ? "open" : "new")) {
          await send(part.content);
          // Marked per message, right after it posts: a later failure only leaves the rest for next time.
          await db
            .prepare(`UPDATE job_listings SET discord_posted_at = ? WHERE url IN (SELECT value FROM json_each(?)) AND discord_posted_at IS NULL`)
            .bind(now.toISOString(), JSON.stringify(part.urls))
            .run();
          posted += part.urls.length;
        }
        discord = `posted ${list.length}`;
      } catch (err) {
        discord = `failed: ${(err as Error).message}${posted ? ` (after ${posted} roles posted)` : ""}`;
      }
    }
    if (discord === "no DISCORD_BOT_TOKEN") alerts.push("opportunities: no DISCORD_BOT_TOKEN, nothing posted");
    if (!discord.startsWith("failed")) {
      await db
        .prepare(`INSERT INTO cron_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .bind(SUCCESS_KEY, now.toISOString(), now.toISOString())
        .run();
    }
    return { ...result, discord, log, alerts };
  } finally {
    await db.prepare(`DELETE FROM cron_state WHERE key = ? AND value = ?`).bind(LEASE_KEY, lease).run()
      .catch((e) => console.error("opportunities: lease not released", e));
  }
}

/** Open, unhidden listings not yet posted to Discord, first seen in the last NEW_DAYS (newest first). */
async function unposted(db: D1Database, now: Date): Promise<NewListing[]> {
  const since = new Date(now.getTime() - NEW_DAYS * 86_400_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT company, title, url, locations, role_type, term FROM job_listings
        WHERE discord_posted_at IS NULL AND active = 1 AND hidden = 0 AND first_seen_at >= ?
        ORDER BY posted_at DESC`,
    )
    .bind(since)
    .all<{ company: string; title: string; url: string; locations: string; role_type: NewListing["role_type"]; term: string | null }>();
  return (results ?? []).map((r) => ({ ...r, locations: JSON.parse(r.locations || "[]") as string[] }));
}

/** POST /api/opportunities/run, from GitHub's "Run workflow". `?post_all=1` posts every open role. */
export async function handleRun(request: Request, env: OpportunitiesEnv): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!(await tokenMatches(token, env.OPPORTUNITIES_SYNC_TOKEN ?? ""))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const postAll = /^(1|true)$/.test(new URL(request.url).searchParams.get("post_all") ?? "");
  try {
    const result = await runOpportunities(env, { postAll });
    console.log("opportunities run", JSON.stringify({ ...result, added: result.added.length }));
    // A failed Discord post turns the GitHub run red instead of passing quietly.
    return Response.json(result, { status: result.discord.startsWith("failed") ? 502 : 200 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: err instanceof RunInProgress ? 409 : 500 });
  }
}

/** Sort key for a term: "Summer 2027" before "Fall 2027" before "Winter 2028". */
function termRank(term: string | null): number {
  const m = /^(\w+) (\d{4})$/.exec(term ?? "");
  return m ? Number(m[2]) * 4 + (TERM_ORDER[m[1]] ?? 0) : 1e9;
}

function line(l: NewListing): string {
  const locs = l.locations ?? [];
  const where = locs.slice(0, 2).join("; ") + (locs.length > 2 ? ` +${locs.length - 2}` : "");
  const title = l.title.replace(/[[\]]/g, "");
  return `• **${l.company}**: [${title}](<${l.url}>)${where ? ` · ${where}` : ""}${inCanada(locs) ? " 🇨🇦" : ""}`;
}

/** One section per internship term (soonest first), then term not listed, then new grad. */
function sections(list: NewListing[]) {
  const groups = new Map<string, { name: string; rank: number; items: NewListing[] }>();
  for (const l of list) {
    const name = l.role_type === "full_time" ? "New grad" : l.term ? `Internships · ${l.term}` : "Internships · term not listed";
    const rank = l.role_type === "full_time" ? 2e9 : l.term ? termRank(l.term) : 1e9;
    if (!groups.has(name)) groups.set(name, { name, rank, items: [] });
    groups.get(name)!.items.push(l);
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank);
}

type Part = { content: string; urls: string[] };

/**
 * The digest as Discord messages under the 2000-character limit. Each section
 * shows at most PER_SECTION roles; the rest are on Connect.
 */
export function digestMessages(list: NewListing[], kind: "new" | "open"): string[] {
  return digestParts(list, kind).map((p) => p.content);
}

/** digestMessages, with the links each message covers (a section's "…and N more" line covers the rest). */
export function digestParts(list: NewListing[], kind: "new" | "open"): Part[] {
  const head = `## ${list.length} ${kind} quant role${list.length === 1 ? "" : "s"}\nSearch, filter and mark applied: <https://connect.quantt.ca/opportunities>`;
  const blocks: Part[][] = [[{ content: head, urls: [] }]];
  for (const g of sections(list)) {
    const shown = g.items.slice(0, PER_SECTION);
    const rest = g.items.slice(shown.length);
    blocks.push([
      { content: `### ${g.name} (${g.items.length})`, urls: [] },
      ...shown.map((l) => ({ content: line(l), urls: [l.url] })),
      ...(rest.length ? [{ content: `…and ${rest.length} more on Connect`, urls: rest.map((l) => l.url) }] : []),
    ]);
  }
  const messages: Part[] = [];
  let cur: Part | null = null;
  for (const block of blocks) {
    const whole: Part = { content: block.map((p) => p.content).join("\n"), urls: block.flatMap((p) => p.urls) };
    for (const piece of whole.content.length > MAX_MESSAGE ? block : [whole]) {
      if (cur && cur.content.length + piece.content.length + 2 > MAX_MESSAGE) {
        messages.push(cur);
        cur = { content: piece.content, urls: [...piece.urls] };
      } else if (cur) {
        const gap = piece.content.startsWith("###") || piece.content.startsWith("## ") ? "\n" : "";
        cur = { content: `${cur.content}\n${gap}${piece.content}`, urls: [...cur.urls, ...piece.urls] };
      } else {
        cur = { content: piece.content, urls: [...piece.urls] };
      }
    }
  }
  if (cur) messages.push(cur);
  return messages;
}
