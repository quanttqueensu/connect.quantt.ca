/**
 * Writes listings into D1 (table job_listings, db/migrations/0005).
 *
 * The daily run (daily.ts) fetches and filters the lists and calls
 * storeListings; POST /api/opportunities/sync hands it listings fetched
 * elsewhere. This part is cheap: a handful of statements.
 *
 * Relative imports only: worker.js bundles this through wrangler, outside Next.
 */
import type { D1Database } from "../db/d1";
import { normalizeUrl, RoleIndex, type Listing, type ListingSource } from "./sources";

/** What the Action sends. A source is null when its fetch failed. */
export type SyncPayload = { sources: Partial<Record<ListingSource, Listing[] | null>> };

export type NewListing = Pick<Listing, "company" | "title" | "url" | "locations" | "role_type" | "term">;

/** `added` is what this run saw for the first time, for the Discord post (newest first). */
export type SyncResult = { stored: number; closed: Record<string, number>; skipped: string[]; added: NewListing[] };

const SOURCES: ListingSource[] = ["simplify", "nwft"];
/** Far more than the ~400 quant listings today; a cap so a bad payload can't flood the table. */
const MAX_PER_SOURCE = 3000;
/** json_each input per statement, to stay well inside D1's statement limits. */
const CHUNK = 150;
/** Closed listings are kept this long (so a brief gap in a source doesn't lose them), then deleted. */
const KEEP_CLOSED_DAYS = 90;

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Re-checks a listing from the request; the Worker trusts nothing it is sent. */
export function sanitize(raw: unknown, source: ListingSource): Listing | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = normalizeUrl(r.url);
  const company = text(r.company, 120);
  const title = text(r.title, 300);
  const role = r.role_type === "full_time" ? "full_time" : r.role_type === "internship" ? "internship" : null;
  if (!url || !company || !title || !role) return null;
  const term = text(r.term, 40);
  const posted = typeof r.posted_at === "string" && !Number.isNaN(Date.parse(r.posted_at))
    ? new Date(r.posted_at).toISOString()
    : null;
  const locations = Array.isArray(r.locations)
    ? r.locations.map((l) => text(l, 80)).filter(Boolean).slice(0, 12)
    : [];
  return {
    source,
    company,
    title,
    url,
    locations,
    role_type: role,
    term: /^(Spring|Summer|Fall|Winter) \d{4}$/.test(term) ? term : null,
    posted_at: posted,
  };
}

const UPSERT = `
INSERT INTO job_listings
  (id, url, source, company, title, locations, role_type, term, posted_at, first_seen_at, last_seen_at, active)
SELECT lower(hex(randomblob(16))),
       json_extract(value, '$.url'),
       json_extract(value, '$.source'),
       json_extract(value, '$.company'),
       json_extract(value, '$.title'),
       json(json_extract(value, '$.locations')),
       json_extract(value, '$.role_type'),
       json_extract(value, '$.term'),
       coalesce(json_extract(value, '$.posted_at'), ?1),
       ?1, ?1, 1
  FROM json_each(?2)
 WHERE true -- SQLite needs a WHERE before ON CONFLICT in INSERT ... SELECT
ON CONFLICT (url) DO UPDATE SET
  company = excluded.company,
  title = excluded.title,
  locations = excluded.locations,
  role_type = excluded.role_type,
  term = excluded.term,
  last_seen_at = excluded.last_seen_at,
  active = 1`;

export async function storeListings(db: D1Database, payload: SyncPayload, now = new Date()): Promise<SyncResult> {
  const at = now.toISOString();
  const statements = [];
  const skipped: string[] = [];
  let stored = 0;

  const { results: open } = await db
    .prepare("SELECT url, source, company, title, term FROM job_listings WHERE active = 1")
    .all<{ url: string; source: string; company: string; title: string; term: string | null }>();
  // Roles that were open before this run: a role that only changed link isn't "new" for Discord.
  const before = new RoleIndex<(typeof open)[number]>();
  for (const row of open) before.add(row);

  // Which sources are fresh this run. A failed or empty fetch must not close
  // every listing from that source, so its open listings stay as they are.
  const lists = new Map<ListingSource, Listing[]>();
  for (const source of SOURCES) {
    const list = payload.sources?.[source];
    const clean = Array.isArray(list)
      ? list.slice(0, MAX_PER_SOURCE).map((raw) => sanitize(raw, source)).filter((l): l is Listing => l !== null)
      : [];
    if (clean.length === 0) skipped.push(source);
    else lists.set(source, clean);
  }

  // One row per role. The listings a stale source keeps open count as already
  // taken; then each fresh source in order (Simplify first, it has dates).
  const seen = new RoleIndex<{ url: string; company: string; title: string; term: string | null }>();
  for (const row of open) if (!lists.has(row.source as ListingSource)) seen.add(row);
  const fresh: ListingSource[] = [];
  const newRoles: string[] = [];
  for (const [source, list] of lists) {
    const keep: Listing[] = [];
    for (const l of list) {
      if (seen.find(l)) continue;
      seen.add(l);
      keep.push(l);
      if (!before.find(l)) newRoles.push(l.url);
    }
    // Still "fresh" when every listing was a duplicate: its old rows should close.
    fresh.push(source);
    stored += keep.length;
    for (let i = 0; i < keep.length; i += CHUNK) {
      statements.push(db.prepare(UPSERT).bind(at, JSON.stringify(keep.slice(i, i + CHUNK))));
    }
  }

  // Anything a fresh source no longer lists is closed. A link listed by two
  // sources stays open while either still has it (both set last_seen_at).
  for (const source of fresh) {
    statements.push(
      db.prepare("UPDATE job_listings SET active = 0 WHERE source = ? AND active = 1 AND last_seen_at < ?").bind(source, at),
    );
  }
  const cutoff = new Date(now.getTime() - KEEP_CLOSED_DAYS * 86_400_000).toISOString();
  statements.push(db.prepare("DELETE FROM job_listings WHERE active = 0 AND last_seen_at < ?").bind(cutoff));

  const results = await db.batch(statements);
  const closed: Record<string, number> = {};
  const firstClose = results.length - 1 - fresh.length;
  fresh.forEach((source, i) => {
    closed[source] = results[firstClose + i]?.meta.changes ?? 0;
  });
  const { results: rows } = await db
    .prepare(
      `SELECT company, title, url, locations, role_type, term FROM job_listings
        WHERE url IN (SELECT value FROM json_each(?)) AND active = 1 AND hidden = 0
        ORDER BY posted_at DESC LIMIT 200`,
    )
    .bind(JSON.stringify(newRoles))
    .all<{ company: string; title: string; url: string; locations: string; role_type: Listing["role_type"]; term: string | null }>();
  const added = rows.map((r) => ({ ...r, locations: JSON.parse(r.locations || "[]") as string[] }));
  return { stored, closed, skipped, added };
}

/** Constant-time compare of the Action's bearer token with the Worker secret. */
export async function tokenMatches(given: string, expected: string): Promise<boolean> {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** The POST /api/opportunities/sync handler that worker.js calls before Next sees the request. */
export async function handleSync(
  request: Request,
  env: { DB?: D1Database; OPPORTUNITIES_SYNC_TOKEN?: string },
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!(await tokenMatches(token, env.OPPORTUNITIES_SYNC_TOKEN ?? ""))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!env.DB) return new Response("DB binding missing", { status: 500 });
  const body = await request.text();
  if (body.length > 5_000_000) return new Response("Too large", { status: 413 });
  let payload: SyncPayload;
  try {
    payload = JSON.parse(body) as SyncPayload;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const result = await storeListings(env.DB, payload);
  console.log("opportunities sync", JSON.stringify(result));
  return Response.json(result);
}
