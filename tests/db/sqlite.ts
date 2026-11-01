/**
 * A throwaway in-memory SQLite database with the D1 schema, for tests.
 * D1 is SQLite, so node:sqlite runs the same SQL the Worker will.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveCompanyAccess } from "@/lib/db/access";
import type { D1Database, D1PreparedStatement, D1Result } from "@/lib/db/d1";
import type { Sql, Viewer } from "@/lib/db/policies";

const root = resolve(__dirname, "../..");
const MIGRATIONS = readdirSync(resolve(root, "db/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(resolve(root, "db/migrations", f), "utf8"));
const SEED = readFileSync(resolve(root, "db/seed.sql"), "utf8");

export const TIER = {
  none: "00000000-0000-4000-8000-000000000000",
  grandfathered: "00000000-0000-4000-8000-000000000999",
  supporter: "00000000-0000-4000-8000-000000000010",
  partner: "00000000-0000-4000-8000-000000000020",
  leader: "00000000-0000-4000-8000-000000000030",
  principal: "00000000-0000-4000-8000-000000000040",
} as const;

export type TierKey = keyof typeof TIER;

export function freshDb(opts: { seed?: boolean } = {}) {
  const db = new DatabaseSync(":memory:");
  for (const m of MIGRATIONS) db.exec(m);
  if (opts.seed !== false) db.exec(SEED);
  return db;
}

export type Db = ReturnType<typeof freshDb>;

type Value = string | number | null;

export function all<T = Record<string, unknown>>(db: Db, q: Sql | string, ...params: unknown[]): T[] {
  const text = typeof q === "string" ? q : q.sql;
  const args = (typeof q === "string" ? params : q.params) as Value[];
  return db.prepare(text).all(...args) as T[];
}

export function run(db: Db, text: string, ...params: Value[]) {
  return db.prepare(text).run(...params);
}

export function where(db: Db, table: string, alias: string, scope: Sql): string[] {
  return all<{ id: string }>(db, {
    sql: `SELECT ${alias}.id AS id FROM ${table} ${alias} WHERE ${scope.sql} ORDER BY ${alias}.id`,
    params: scope.params,
  }).map((r) => r.id);
}

let counter = 0;
export function uuid(prefix = 0): string {
  counter += 1;
  const n = (prefix * 1_000_000 + counter).toString(16).padStart(12, "0");
  return `11111111-1111-4111-8111-${n}`;
}

export function iso(d: Date) {
  return d.toISOString();
}

export const NOW = new Date("2026-11-01T12:00:00.000Z");

export function hoursAgo(h: number, now = NOW) {
  return iso(new Date(now.getTime() - h * 3_600_000));
}

export function addMember(db: Db, opts: { admin?: boolean; email?: string; optInAt?: string | null } = {}) {
  const id = uuid();
  run(
    db,
    `INSERT INTO profiles (id, email, full_name, role, is_admin, resume_book_opt_in, resume_book_opt_in_at, resume_book_opt_in_by)
     VALUES (?, ?, ?, 'member', ?, ?, ?, ?)`,
    id,
    opts.email ?? `${id}@club.dev`,
    `Member ${id.slice(-4)}`,
    opts.admin ? 1 : 0,
    opts.optInAt ? 1 : 0,
    opts.optInAt ?? null,
    opts.optInAt ? id : null,
  );
  return id;
}

export function addResume(db: Db, memberId: string) {
  run(
    db,
    `INSERT INTO member_documents (member_id, resume_path) VALUES (?, ?)`,
    memberId,
    `${memberId}/packages/main/resume.pdf`,
  );
}

export function addCompany(
  db: Db,
  tier: TierKey,
  opts: { status?: "active" | "inactive"; grace?: TierKey; graceUntil?: string } = {},
) {
  const id = uuid();
  run(
    db,
    `INSERT INTO companies (id, name, slug, status, sponsor_tier_id, grace_tier_id, tier_grace_until)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    `Firm ${id.slice(-4)}`,
    `firm-${id.slice(-6)}`,
    opts.status ?? "active",
    TIER[tier],
    opts.grace ? TIER[opts.grace] : null,
    opts.graceUntil ?? null,
  );
  const userId = uuid();
  run(
    db,
    `INSERT INTO profiles (id, email, full_name, role) VALUES (?, ?, 'Recruiter', 'company_user')`,
    userId,
    `${userId}@firm.dev`,
  );
  run(db, `INSERT INTO company_users (company_id, profile_id) VALUES (?, ?)`, id, userId);
  return { companyId: id, userId };
}

export function addPost(
  db: Db,
  companyId: string | null,
  authorId: string,
  opts: { kind?: string; published?: boolean; external?: string | null } = {},
) {
  const id = uuid();
  const kind = opts.kind ?? "job";
  const inApp = kind === "job" && !opts.external;
  run(
    db,
    `INSERT INTO posts (id, author_id, company_id, kind, title, published, role_type, term_season, term_year, external_url)
     VALUES (?, ?, ?, ?, 'Role', ?, ?, ?, ?, ?)`,
    id,
    authorId,
    companyId,
    kind,
    opts.published === false ? 0 : 1,
    inApp ? "internship" : null,
    inApp ? "summer" : null,
    inApp ? 2027 : null,
    opts.external ?? (kind === "job_link" ? "https://example.com/job" : null),
  );
  return id;
}

export function addApplication(db: Db, memberId: string, postId: string, createdAt: string) {
  const id = uuid();
  const company = all<{ company_id: string }>(db, `SELECT company_id FROM posts WHERE id = ?`, postId)[0];
  run(
    db,
    `INSERT INTO applications (id, member_id, kind, post_id, company_id, resume_path, created_at, updated_at)
     VALUES (?, ?, 'in_app', ?, ?, ?, ?, ?)`,
    id,
    memberId,
    postId,
    company.company_id,
    `snapshots/${id}/resume.pdf`,
    createdAt,
    createdAt,
  );
  return id;
}

/** Load a firm's access the way the Worker will: one read per table, resolved in code. */
export function loadAccess(db: Db, companyId: string, now = NOW) {
  const company = all<{
    id: string; status: string; sponsor_tier_id: string; grace_tier_id: string | null; tier_grace_until: string | null;
  }>(db, `SELECT id, status, sponsor_tier_id, grace_tier_id, tier_grace_until FROM companies WHERE id = ?`, companyId)[0];
  if (!company) return null;
  const tiers = all<{ id: string; applicant_embargo_hours: number; resume_book_embargo_hours: number }>(
    db,
    `SELECT id, applicant_embargo_hours, resume_book_embargo_hours FROM sponsor_tiers WHERE id IN (?, ?)`,
    company.sponsor_tier_id,
    company.grace_tier_id ?? company.sponsor_tier_id,
  );
  const tierCapabilities = all<{ tier_id: string; capability: string; value: number | null }>(
    db,
    `SELECT tier_id, capability, value FROM sponsor_tier_capabilities WHERE tier_id IN (?, ?)`,
    company.sponsor_tier_id,
    company.grace_tier_id ?? company.sponsor_tier_id,
  );
  const overrides = all<{ capability: string; granted: number; value: number | null }>(
    db,
    `SELECT capability, granted, value FROM company_capability_overrides WHERE company_id = ?`,
    companyId,
  );
  return resolveCompanyAccess({ company, tiers, tierCapabilities, overrides }, now);
}

export function viewer(db: Db, profileId: string, now = NOW): Viewer {
  const p = all<{ id: string; role: "member" | "company_user"; is_admin: number }>(
    db,
    `SELECT id, role, is_admin FROM profiles WHERE id = ?`,
    profileId,
  )[0];
  const cu = all<{ company_id: string }>(db, `SELECT company_id FROM company_users WHERE profile_id = ?`, profileId)[0];
  const companyId = cu?.company_id ?? null;
  return {
    id: p.id,
    role: p.role,
    isAdmin: Boolean(p.is_admin),
    companyId,
    access: companyId ? loadAccess(db, companyId, now) : null,
    now,
  };
}

/** D1's API over node:sqlite, so code written for the Worker runs in tests. */
export function asD1(db: Db): D1Database {
  const statement = (query: string, values: unknown[] = []): D1PreparedStatement & { exec(): D1Result } => {
    const args = values.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v)) as Value[];
    const exec = (): D1Result => {
      const stmt = db.prepare(query);
      if (/^\s*(SELECT|WITH)/i.test(query) || /RETURNING/i.test(query)) {
        return { results: stmt.all(...args) as Record<string, unknown>[], meta: { changes: 0 } };
      }
      const r = stmt.run(...args);
      return { results: [], meta: { changes: Number(r.changes) } };
    };
    return {
      bind: (...v: unknown[]) => statement(query, v),
      first: async <T>() => (exec().results[0] as T) ?? null,
      all: async <T>() => exec() as D1Result<T>,
      run: async () => exec(),
      exec,
    };
  };
  return {
    prepare: (q) => statement(q),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => (s as ReturnType<typeof statement>).exec());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
