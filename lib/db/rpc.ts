/**
 * The Postgres functions the app called with `supabase.rpc(...)`, on D1.
 * Same names, arguments and results, so call sites don't change.
 */

import type { D1Database } from "@/lib/db/d1";
import {
  canClosePost,
  cleanJoinRequest,
  joinAdmissionBuckets,
  MAX_PENDING_JOIN_REQUESTS,
  optedInMemberSql,
  talentFileAllowed,
  talentListSql,
  type MaybeViewer,
} from "@/lib/db/policies";
import type { PostgrestError, Principal, Result } from "@/lib/db/rest";
import { sha256Hex } from "@/lib/cf-auth/tokens";

type Args = Record<string, unknown>;

function ok<T>(data: T): Result<T> {
  return { data, error: null, count: null, status: 200, statusText: "OK" };
}

function fail<T>(message: string, code = "P0001"): Result<T> {
  const error: PostgrestError = { message, code, details: null, hint: null };
  return { data: null as T, error, count: null, status: 400, statusText: "Error" };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

async function isOptedIn(db: D1Database, v: MaybeViewer, memberId: string) {
  const q = optedInMemberSql(v, "?");
  if (q.sql === "0") return false;
  const r = await db.prepare(`SELECT (${q.sql}) AS ok`).bind(memberId, ...q.params).first<{ ok: number }>();
  return r?.ok === 1;
}

export async function callRpc(db: D1Database, principal: Principal, name: string, args: Args = {}): Promise<Result<unknown>> {
  const v = principal.kind === "user" ? principal.viewer : null;
  const now = v?.now ?? new Date();
  try {
    switch (name) {
      case "resume_book_list":
      case "candidate_search_list": {
        const mode = name === "resume_book_list" ? "resume_book" : "candidate_search";
        const year = args.p_grad_year == null ? null : Number(args.p_grad_year);
        const q = talentListSql(v, mode, { q: str(args.p_q), program: str(args.p_program), gradYear: year });
        if (!q) return ok([]);
        const { results } = await db.prepare(q.sql).bind(...q.params).all();
        return ok(results);
      }
      case "talent_resume_path":
      case "talent_photo_path": {
        const member = String(args.p_member ?? "");
        if (!talentFileAllowed(v) || !(await isOptedIn(db, v, member))) return ok(null);
        const row =
          name === "talent_resume_path"
            ? await db
                .prepare(`SELECT resume_path AS path FROM member_documents WHERE member_id = ? AND resume_path IS NOT NULL`)
                .bind(member)
                .first<{ path: string }>()
            : await db.prepare(`SELECT photo_path AS path FROM profiles WHERE id = ?`).bind(member).first<{ path: string | null }>();
        return ok(row?.path ?? null);
      }
      case "close_own_post": {
        if (v?.readOnly) return fail("Sponsor mode is read-only", "42501");
        const id = String(args.p_post ?? "");
        const post = await db.prepare(`SELECT id, company_id FROM posts WHERE id = ?`).bind(id).first<{ id: string; company_id: string | null }>();
        if (!post || !(principal.kind === "service" || canClosePost(v, post))) return ok(null);
        await db
          .prepare(`UPDATE posts SET status = 'closed', updated_at = ? WHERE id = ?`)
          .bind(now.toISOString(), id)
          .run();
        return ok(post.id);
      }
      case "submit_join_request":
        return await submitJoinRequest(db, args, now);
      default:
        return fail(`Unknown function ${name}`, "PGRST202");
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Public join form. Over a rate limit, a duplicate pending email, or a full
 * queue, it quietly does nothing, as the Postgres version did.
 */
async function submitJoinRequest(db: D1Database, args: Args, now: Date): Promise<Result<null>> {
  const clean = cleanJoinRequest({
    company_name: String(args.p_company_name ?? ""),
    website: str(args.p_website),
    contact_name: String(args.p_contact_name ?? ""),
    contact_email: String(args.p_contact_email ?? ""),
    note: str(args.p_note),
  });
  const source = String(args.p_source ?? "");
  if (!clean || !/^[0-9a-f]{64}$/.test(source)) return fail("Invalid request fields");

  const at = now.toISOString();
  await db.prepare(`DELETE FROM join_admission WHERE expires_at <= ?`).bind(at).run();
  for (const b of joinAdmissionBuckets(now, source, await sha256Hex(clean.contact_email))) {
    const row = await db
      .prepare(
        `INSERT INTO join_admission (key, used, expires_at) VALUES (?, 1, ?)
         ON CONFLICT (key) DO UPDATE SET used = min(used + 1, ?)
         RETURNING used`,
      )
      .bind(b.key, b.expires_at, b.maximum + 1)
      .first<{ used: number }>();
    if ((row?.used ?? 0) > b.maximum) return ok(null);
  }
  const pending = await db
    .prepare(`SELECT count(*) AS n FROM company_join_requests WHERE status = 'pending'`)
    .first<{ n: number }>();
  if ((pending?.n ?? 0) >= MAX_PENDING_JOIN_REQUESTS) return ok(null);
  await db
    .prepare(
      `INSERT INTO company_join_requests (id, company_name, website, contact_name, contact_email, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (lower(contact_email)) WHERE status = 'pending' DO NOTHING`,
    )
    .bind(crypto.randomUUID(), clean.company_name, clean.website, clean.contact_name, clean.contact_email, clean.note, at)
    .run();
  return ok(null);
}
