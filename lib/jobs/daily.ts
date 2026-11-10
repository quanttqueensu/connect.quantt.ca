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
 * This used to run on GitHub's schedule with its own copy of the bot token.
 * That copy went stale after the token reset, and GitHub ran the schedule up
 * to ten hours late, so nothing reached Discord from Nov 3.
 *
 * Relative imports only: worker.js bundles this through wrangler, outside Next.
 */
import type { D1Database } from "../db/d1";
import { collectListings, inCanada } from "./sources";
import { storeListings, tokenMatches, type NewListing, type SyncResult } from "./store";

/** #opportunities in the QUANTT Discord. */
export const OPPORTUNITIES_CHANNEL = "1566267471349030933";
/** The cron hour (UTC) of the daily run: 06:00 / 07:00 in Kingston. */
export const DAILY_HOUR_UTC = 11;

const TERM_ORDER: Record<string, number> = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
const PER_SECTION = 15;
const MAX_MESSAGE = 1900;

export type OpportunitiesEnv = {
  DB?: D1Database;
  DISCORD_BOT_TOKEN?: string;
  OPPORTUNITIES_SYNC_TOKEN?: string;
};

export type RunResult = SyncResult & {
  /** "posted N", "nothing new", "no DISCORD_BOT_TOKEN", or "failed: ..." */
  discord: string;
  log: string[];
};

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

/** Posts one message to a Discord channel as QUANTT Bot. */
export function discordSender(token: string, channelId: string): Send {
  // Tolerates a pasted "Bot " prefix, quotes or a trailing newline in the secret.
  const bot = token.trim().replace(/^["']|["']$/g, "").replace(/^Bot\s+/i, "");
  return async (content) => {
    const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${bot}`, "content-type": "application/json" },
      // flags 4: no link previews.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }),
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  };
}

/**
 * Fetch, store, post. `postAll` posts every open role instead of the new ones.
 * `get` and `send` are swapped out by the tests.
 */
export async function runOpportunities(
  env: OpportunitiesEnv,
  opts: { postAll?: boolean; get?: Get; send?: Send; now?: Date } = {},
): Promise<RunResult> {
  if (!env.DB) throw new Error("the DB binding is missing");
  const log: string[] = [];
  const sources = await collectListings(opts.get ?? fetchText, (line) => log.push(line));
  if (!sources.simplify && !sources.nwft) throw new Error(`every source failed: ${log.join("; ")}`);
  const result = await storeListings(env.DB, { sources }, opts.now);

  const list: NewListing[] = opts.postAll
    ? [...(sources.simplify ?? []), ...(sources.nwft ?? [])].sort((a, b) =>
        String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? "")),
      )
    : result.added;
  const send = opts.send ?? (env.DISCORD_BOT_TOKEN ? discordSender(env.DISCORD_BOT_TOKEN, OPPORTUNITIES_CHANNEL) : null);
  let discord: string;
  if (!list.length) discord = "nothing new";
  else if (!send) discord = "no DISCORD_BOT_TOKEN";
  else {
    try {
      for (const content of digestMessages(list, opts.postAll ? "open" : "new")) await send(content);
      discord = `posted ${list.length}`;
    } catch (err) {
      discord = `failed: ${(err as Error).message}`;
    }
  }
  return { ...result, discord, log };
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
    return Response.json({ error: (err as Error).message }, { status: 500 });
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

/**
 * The digest as Discord messages under the 2000-character limit. Each section
 * shows at most PER_SECTION roles; the rest are on Connect.
 */
export function digestMessages(list: NewListing[], kind: "new" | "open"): string[] {
  const head = `## ${list.length} ${kind} quant role${list.length === 1 ? "" : "s"}\nSearch, filter and mark applied: <https://connect.quantt.ca/opportunities>`;
  const blocks = [head];
  for (const g of sections(list)) {
    const shown = g.items.slice(0, PER_SECTION).map(line);
    const more = g.items.length > shown.length ? [`…and ${g.items.length - shown.length} more on Connect`] : [];
    blocks.push([`### ${g.name} (${g.items.length})`, ...shown, ...more].join("\n"));
  }
  const messages: string[] = [];
  let cur = "";
  for (const block of blocks) {
    for (const piece of block.length > MAX_MESSAGE ? block.split("\n") : [block]) {
      if (cur && cur.length + piece.length + 2 > MAX_MESSAGE) {
        messages.push(cur);
        cur = piece;
      } else {
        cur = cur ? `${cur}\n${piece.startsWith("###") || piece.startsWith("## ") ? "\n" : ""}${piece}` : piece;
      }
    }
  }
  if (cur) messages.push(cur);
  return messages;
}
