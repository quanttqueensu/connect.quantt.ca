/**
 * Writes listings into D1 (table job_listings, db/migrations/0005).
 *
 * The GitHub Action (.github/workflows/opportunities.yml) does the fetching and
 * filtering, because Simplify's lists are about 13 MB each and parsing them
 * takes more CPU than a Worker on Cloudflare's free plan may use. It POSTs the
 * few hundred quant listings it keeps to /api/opportunities/sync, and
 * worker.js hands them here. This part is cheap: a handful of statements.
 *
 * Relative imports only: worker.js bundles this through wrangler, outside Next.
 */
import type { D1Database } from "../db/d1";
import { normalizeUrl, type Listing, type ListingSource } from "./sources";

/** What the Action sends. A source is null when its fetch failed. */
export type SyncPayload = { sources: Partial<Record<ListingSource, Listing[] | null>> };

export type SyncResult = { stored: number; closed: Record<string, number>; skipped: string[] };

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
 WHERE true
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
  const fresh: ListingSource[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let stored = 0;

  for (const source of SOURCES) {
    const list = payload.sources?.[source];
    // A failed or empty fetch must not close every listing from that source.
    if (!Array.isArray(list) || list.length === 0) {
      skipped.push(source);
      continue;
    }
    const clean: Listing[] = [];
    for (const raw of list.slice(0, MAX_PER_SOURCE)) {
      const l = sanitize(raw, source);
      if (l && !seen.has(l.url)) {
        seen.add(l.url);
        clean.push(l);
      }
    }
    if (clean.length === 0) {
      skipped.push(source);
      continue;
    }
    fresh.push(source);
    stored += clean.length;
    for (let i = 0; i < clean.length; i += CHUNK) {
      statements.push(db.prepare(UPSERT).bind(at, JSON.stringify(clean.slice(i, i + CHUNK))));
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
  return { stored, closed, skipped };
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
