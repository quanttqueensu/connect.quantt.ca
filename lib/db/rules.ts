/**
 * Per-table read scopes and write rules for the query layer (lib/db/rest.ts),
 * assembled from lib/db/policies.ts. A service principal (the old
 * service-role key) skips the who-may checks but still meets the rules
 * that were triggers on Supabase, since those bound every writer.
 */

import type { D1Database } from "@/lib/db/d1";
import {
  adminOnlyScope,
  applicationInsert,
  applicationsScope,
  companyApplicationsSql,
  assertApplicationUpdate,
  assertCommentDelete,
  assertCommentInsert,
  assertCompanyUpdate,
  assertConversationInsert,
  assertDocumentsWrite,
  assertJobSlot,
  assertMessageInsert,
  assertPackageWrite,
  assertPostInsert,
  assertPostUpdate,
  assertSectionWrite,
  catalogScope,
  commentsScope,
  companiesScope,
  companyUsersScope,
  contactableOptInSql,
  conversationsScope,
  Denied,
  documentsScope,
  iso,
  isMember,
  jobListingsScope,
  isOpenInAppJob,
  messagesScope,
  myCapability,
  openInAppJobCountSql,
  overridesScope,
  packagesScope,
  postsScope,
  profilesScope,
  profileUpdate,
  sectionsScope,
  visibleApplicantSql,
  type MaybeViewer,
  type PostShape,
  type ProfileRow,
  type Sql,
  type Viewer,
} from "@/lib/db/policies";
import type { Principal } from "@/lib/db/rest";
import type { TableName } from "@/lib/db/schema";
import { isPhotoPath } from "@/lib/storage-paths";
import { loadCompanyAccess } from "@/lib/db/viewer";

export type WriteContext = { db: D1Database; principal: Principal; now: Date };

type Row = Record<string, unknown>;

export type TableRules = {
  insert(ctx: WriteContext, row: Row): Promise<Row>;
  updateScope(ctx: WriteContext, alias: string): Sql;
  update(ctx: WriteContext, before: Row, patch: Row): Promise<Row>;
  deleteScope(ctx: WriteContext, alias: string): Sql;
  remove(ctx: WriteContext, row: Row): Promise<void>;
};

const NONE: Sql = { sql: "0", params: [] };
const ALL: Sql = { sql: "1", params: [] };

function viewerOf(ctx: WriteContext): MaybeViewer {
  return ctx.principal.kind === "user" ? ctx.principal.viewer : null;
}

function isService(ctx: WriteContext) {
  return ctx.principal.kind === "service";
}

/** The service key acts like an admin for who-may checks. */
function actor(ctx: WriteContext): Viewer | null {
  if (isService(ctx)) {
    return { id: "00000000-0000-0000-0000-000000000000", role: "member", isAdmin: true, companyId: null, access: null, now: ctx.now };
  }
  return viewerOf(ctx);
}

function isAdminCtx(ctx: WriteContext) {
  return isService(ctx) || Boolean(viewerOf(ctx)?.isAdmin);
}

function requireAdmin(ctx: WriteContext) {
  if (!isAdminCtx(ctx)) throw new Denied();
}

async function exists(db: D1Database, q: Sql) {
  if (q.sql === "0") return false;
  const r = await db.prepare(`SELECT (${q.sql}) AS ok`).bind(...q.params).first<{ ok: number }>();
  return r?.ok === 1;
}

function scopeIf(cond: boolean, s: Sql) {
  return cond ? s : NONE;
}

// --- generic rule sets --------------------------------------------------------

const adminOnly: TableRules = {
  async insert(ctx, row) {
    requireAdmin(ctx);
    return row;
  },
  updateScope: (ctx) => scopeIf(isAdminCtx(ctx), ALL),
  async update(ctx, _before, patch) {
    requireAdmin(ctx);
    return patch;
  },
  deleteScope: (ctx) => scopeIf(isAdminCtx(ctx), ALL),
  async remove(ctx) {
    requireAdmin(ctx);
  },
};

const readOnly: TableRules = {
  async insert() {
    throw new Denied();
  },
  updateScope: () => NONE,
  async update() {
    throw new Denied();
  },
  deleteScope: () => NONE,
  async remove() {
    throw new Denied();
  },
};

/** Writable by the service key only (no RLS write policy existed). */
const serviceOnly: TableRules = {
  async insert(ctx, row) {
    if (!isService(ctx)) throw new Denied();
    return row;
  },
  updateScope: (ctx) => scopeIf(isService(ctx), ALL),
  async update(ctx, _b, patch) {
    if (!isService(ctx)) throw new Denied();
    return patch;
  },
  deleteScope: (ctx) => scopeIf(isService(ctx), ALL),
  async remove(ctx) {
    if (!isService(ctx)) throw new Denied();
  },
};

// --- profiles ---------------------------------------------------------------

const profiles: TableRules = {
  async insert(ctx, row) {
    requireAdmin(ctx);
    if (row.photo_path != null && !isPhotoPath(row.photo_path, String(row.id))) throw new Denied("Invalid photo object path");
    const optIn = Boolean(row.resume_book_opt_in);
    const out = { ...row };
    delete out.resume_book_opt_in_at;
    delete out.resume_book_opt_in_by;
    if (optIn) {
      // profiles_stamp_opt_in: only the member (or the service key) grants consent.
      if (!isService(ctx)) throw new Denied("Only the member can grant resume book consent");
      Object.assign(out, { resume_book_opt_in: 1, resume_book_opt_in_at: iso(ctx.now), resume_book_opt_in_by: null });
    }
    return out;
  },
  updateScope(ctx, a) {
    if (isService(ctx)) return ALL;
    const v = viewerOf(ctx);
    if (!v) return NONE;
    return v.isAdmin ? ALL : { sql: `${a}.id = ?`, params: [v.id] };
  },
  async update(ctx, before, patch) {
    if (isService(ctx)) {
      const out = { ...patch };
      if ("photo_path" in out && out.photo_path != null && out.photo_path !== before.photo_path
        && !isPhotoPath(out.photo_path, String(before.id))) {
        throw new Denied("Invalid photo object path");
      }
      if ("resume_book_opt_in" in out) {
        delete out.resume_book_opt_in_at;
        delete out.resume_book_opt_in_by;
        const on = Boolean(out.resume_book_opt_in);
        if (!on) Object.assign(out, { resume_book_opt_in: 0, resume_book_opt_in_at: null, resume_book_opt_in_by: null });
        else if (!before.resume_book_opt_in) Object.assign(out, { resume_book_opt_in: 1, resume_book_opt_in_at: iso(ctx.now), resume_book_opt_in_by: null });
      }
      return out;
    }
    return profileUpdate(viewerOf(ctx), before as unknown as ProfileRow, patch);
  },
  deleteScope: (ctx) => scopeIf(isAdminCtx(ctx), ALL),
  async remove(ctx) {
    requireAdmin(ctx);
  },
};

// --- companies ----------------------------------------------------------------

const companies: TableRules = {
  ...adminOnly,
  updateScope(ctx, a) {
    if (isAdminCtx(ctx)) return ALL;
    const v = viewerOf(ctx);
    return v?.companyId ? { sql: `${a}.id = ?`, params: [v.companyId] } : NONE;
  },
  async update(ctx, before, patch) {
    if (!isService(ctx)) assertCompanyUpdate(viewerOf(ctx), String(before.id), patch);
    return patch;
  },
};

// --- posts --------------------------------------------------------------------

async function openJobCount(db: D1Database, companyId: string, excludeId?: string) {
  const q = openInAppJobCountSql(companyId, excludeId);
  const r = await db.prepare(q.sql).bind(...q.params).first<{ n: number }>();
  return r?.n ?? 0;
}

const posts: TableRules = {
  async insert(ctx, row) {
    const v = actor(ctx);
    const post = row as unknown as PostShape;
    if (!isService(ctx)) assertPostInsert(v, post);
    if (isOpenInAppJob(post) && post.company_id && !isService(ctx)) {
      const firm = await loadCompanyAccess(ctx.db, post.company_id, ctx.now);
      assertJobSlot(v, firm, await openJobCount(ctx.db, post.company_id), "insert");
    }
    return row;
  },
  updateScope(ctx, a) {
    if (isAdminCtx(ctx)) return ALL;
    const v = viewerOf(ctx);
    return v?.companyId ? { sql: `${a}.company_id = ?`, params: [v.companyId] } : NONE;
  },
  async update(ctx, before, patch) {
    const after = { ...before, ...patch } as unknown as PostShape;
    const was = before as unknown as PostShape;
    if (!isService(ctx)) assertPostUpdate(viewerOf(ctx), was, after);
    const becomesSlot =
      isOpenInAppJob(after) && after.company_id != null &&
      !(isOpenInAppJob(was) && was.company_id === after.company_id);
    if (becomesSlot) {
      const firm = await loadCompanyAccess(ctx.db, after.company_id!, ctx.now);
      assertJobSlot(actor(ctx), firm, await openJobCount(ctx.db, after.company_id!, String(before.id)), "update");
    }
    return patch;
  },
  deleteScope: (ctx) => scopeIf(isAdminCtx(ctx), ALL),
  async remove(ctx) {
    requireAdmin(ctx);
  },
};

// --- comments -------------------------------------------------------------------

const postComments: TableRules = {
  async insert(ctx, row) {
    if (!isService(ctx)) assertCommentInsert(viewerOf(ctx), row as { author_id: string });
    return row;
  },
  updateScope: () => NONE,
  async update() {
    throw new Denied();
  },
  deleteScope(ctx, a) {
    if (isAdminCtx(ctx)) return ALL;
    const v = viewerOf(ctx);
    return v ? { sql: `${a}.author_id = ?`, params: [v.id] } : NONE;
  },
  async remove(ctx, row) {
    if (!isService(ctx)) assertCommentDelete(viewerOf(ctx), row as { author_id: string });
  },
};

// --- applications ---------------------------------------------------------------

function firmSeesApplication(v: MaybeViewer, row: Row) {
  return Boolean(
    v?.companyId &&
      row.kind === "in_app" &&
      row.company_id === v.companyId &&
      myCapability(v, "read_applicants"),
  );
}

const applications: TableRules = {
  async insert(ctx, row) {
    const v = actor(ctx);
    const post = row.post_id
      ? await ctx.db
          .prepare(`SELECT id, kind, external_url, status, published, company_id FROM posts WHERE id = ?`)
          .bind(row.post_id)
          .first<{ id: string; kind: string; external_url: string | null; status: string; published: number; company_id: string | null }>()
      : null;
    const postFirm = post?.company_id ? await loadCompanyAccess(ctx.db, post.company_id, ctx.now) : null;
    const pkg = row.package_id
      ? await ctx.db.prepare(`SELECT member_id FROM hiring_packages WHERE id = ?`).bind(row.package_id).first<{ member_id: string }>()
      : null;
    const { company_id } = applicationInsert(v, row as never, { post, postFirm, packageOwnerId: pkg?.member_id ?? null });
    return row.kind === "in_app" ? { ...row, company_id } : row;
  },
  updateScope(ctx, a) {
    if (isAdminCtx(ctx)) return ALL;
    const v = viewerOf(ctx);
    if (!v) return NONE;
    const own: Sql = { sql: `${a}.member_id = ? AND ${a}.kind = 'off_platform'`, params: [v.id] };
    const firm = companyApplicationsSql(v, a);
    return { sql: `(${own.sql}) OR (${firm.sql})`, params: [...own.params, ...firm.params] };
  },
  async update(ctx, before, patch) {
    if (!isService(ctx)) {
      const v = viewerOf(ctx);
      assertApplicationUpdate(v, before as { member_id: string; kind: string }, patch, {
        visibleToFirm: firmSeesApplication(v, before),
      });
    }
    return patch;
  },
  // Admins delete anything; a member can undo their own "Mark applied" on a listing.
  deleteScope(ctx, a) {
    if (isAdminCtx(ctx)) return ALL;
    const v = viewerOf(ctx);
    if (!isMember(v)) return NONE;
    return { sql: `${a}.member_id = ? AND ${a}.kind = 'off_platform' AND ${a}.job_listing_id IS NOT NULL`, params: [v.id] };
  },
  async remove(ctx, row) {
    if (isAdminCtx(ctx)) return;
    const v = viewerOf(ctx);
    if (!isMember(v) || row.member_id !== v.id || row.kind !== "off_platform" || row.job_listing_id == null) throw new Denied();
  },
};

// --- conversations and messages -----------------------------------------------

const conversations: TableRules = {
  async insert(ctx, row) {
    if (isService(ctx)) return row;
    const v = viewerOf(ctx);
    const memberId = String(row.member_id);
    const member = { sql: "?", params: [memberId] };
    const visibleApplicant = await exists(ctx.db, withParam(visibleApplicantSql(v, "?"), member));
    const contactableOptIn = await exists(ctx.db, withParam(contactableOptInSql(v, "?"), member));
    assertConversationInsert(v, row as { member_id: string; company_id: string }, { visibleApplicant, contactableOptIn });
    return row;
  },
  updateScope(ctx, a) {
    if (isService(ctx)) return ALL;
    const v = viewerOf(ctx);
    if (!v) return NONE;
    if (v.companyId) {
      return { sql: `${a}.member_id = ? OR ${a}.company_id = ?`, params: [v.id, v.companyId] };
    }
    return { sql: `${a}.member_id = ?`, params: [v.id] };
  },
  async update(_ctx, _before, patch) {
    return patch;
  },
  deleteScope: (ctx) => scopeIf(isService(ctx), ALL),
  async remove(ctx) {
    if (!isService(ctx)) throw new Denied();
  },
};

/** Puts a member-id parameter where a helper used `?` as the column. */
function withParam(q: Sql, member: Sql): Sql {
  if (q.sql === "0") return q;
  // The helpers place the column first in their SQL, before their own params.
  return { sql: q.sql, params: [...member.params, ...q.params] };
}

const messages: TableRules = {
  async insert(ctx, row) {
    if (isService(ctx)) return row;
    const conv = await ctx.db
      .prepare(`SELECT member_id, company_id FROM conversations WHERE id = ?`)
      .bind(row.conversation_id)
      .first<{ member_id: string; company_id: string }>();
    if (!conv) throw new Denied();
    assertMessageInsert(viewerOf(ctx), row as { sender_id: string }, conv);
    return row;
  },
  updateScope: () => NONE,
  async update() {
    throw new Denied();
  },
  deleteScope: (ctx) => scopeIf(isService(ctx), ALL),
  async remove(ctx) {
    if (!isService(ctx)) throw new Denied();
  },
};

// --- member-owned tables --------------------------------------------------------

function ownOrAdminScope(ctx: WriteContext, a: string): Sql {
  if (isAdminCtx(ctx)) return ALL;
  const v = viewerOf(ctx);
  return v ? { sql: `${a}.member_id = ?`, params: [v.id] } : NONE;
}

const profileSections: TableRules = {
  async insert(ctx, row) {
    assertSectionWrite(actor(ctx), String(row.member_id));
    return row;
  },
  updateScope: ownOrAdminScope,
  async update(ctx, before, patch) {
    assertSectionWrite(actor(ctx), String({ ...before, ...patch }.member_id));
    return patch;
  },
  deleteScope: ownOrAdminScope,
  async remove(ctx, row) {
    assertSectionWrite(actor(ctx), String(row.member_id));
  },
};

const hiringPackages: TableRules = {
  async insert(ctx, row) {
    assertPackageWrite(actor(ctx), row as never);
    return row;
  },
  updateScope: ownOrAdminScope,
  async update(ctx, before, patch) {
    assertPackageWrite(actor(ctx), { ...before, ...patch } as never);
    return patch;
  },
  deleteScope: ownOrAdminScope,
  async remove(ctx, row) {
    const v = actor(ctx);
    if (!v || (row.member_id !== v.id && !v.isAdmin)) throw new Denied();
  },
};

function documentsOwnScope(ctx: WriteContext, a: string): Sql {
  if (isService(ctx)) return ALL;
  const v = viewerOf(ctx);
  return v && v.role === "member" ? { sql: `${a}.member_id = ?`, params: [v.id] } : NONE;
}

const memberDocuments: TableRules = {
  async insert(ctx, row) {
    const v = isService(ctx) ? { ...actor(ctx)!, id: String(row.member_id) } : viewerOf(ctx);
    assertDocumentsWrite(v, row as never);
    return row;
  },
  updateScope: documentsOwnScope,
  async update(ctx, before, patch) {
    const v = isService(ctx) ? { ...actor(ctx)!, id: String(before.member_id) } : viewerOf(ctx);
    assertDocumentsWrite(v, { ...before, ...patch } as never);
    return { ...patch, updated_at: iso(ctx.now) };
  },
  deleteScope: documentsOwnScope,
  async remove() {},
};

// --- sponsor tier events ----------------------------------------------------------

const tierEvents: TableRules = {
  ...serviceOnly,
  async insert(ctx, row) {
    requireAdmin(ctx);
    return row;
  },
};

const sponsorCapabilities: TableRules = serviceOnly;

// --- opportunities ------------------------------------------------------------------

/** Written by the sync (lib/jobs/store.ts, straight to D1). An admin may only hide or unhide one. */
const jobListings: TableRules = {
  ...serviceOnly,
  updateScope: (ctx) => scopeIf(isAdminCtx(ctx), ALL),
  async update(ctx, _before, patch) {
    requireAdmin(ctx);
    if (!isService(ctx) && Object.keys(patch).some((k) => k !== "hidden")) throw new Denied();
    return patch;
  },
};

// ---------------------------------------------------------------------------

const RULES: Record<TableName, TableRules> = {
  applications,
  companies,
  company_capability_overrides: adminOnly,
  company_join_requests: adminOnly,
  company_join_request_queue: readOnly,
  company_users: adminOnly,
  conversations,
  hiring_packages: hiringPackages,
  invites: adminOnly,
  job_listings: jobListings,
  member_documents: memberDocuments,
  messages,
  post_comments: postComments,
  posts,
  profile_sections: profileSections,
  profiles,
  sponsor_capabilities: sponsorCapabilities,
  sponsor_tier_capabilities: adminOnly,
  sponsor_tier_events: tierEvents,
  sponsor_tiers: adminOnly,
};

export function writeRulesFor(table: TableName): TableRules {
  return RULES[table];
}

export function readScopeFor(table: TableName, v: MaybeViewer, a: string): Sql {
  switch (table) {
    case "applications":
      return applicationsScope(v, a);
    case "companies":
      return companiesScope(v, a);
    case "company_capability_overrides":
      return overridesScope(v, a);
    case "company_join_requests":
    case "company_join_request_queue":
    case "invites":
    case "sponsor_tier_events":
      return adminOnlyScope(v);
    case "company_users":
      return companyUsersScope(v, a);
    case "conversations":
      return conversationsScope(v, a);
    case "hiring_packages":
      return packagesScope(v, a);
    case "job_listings":
      return jobListingsScope(v);
    case "member_documents":
      return documentsScope(v, a);
    case "messages":
      return messagesScope(v, a);
    case "post_comments":
      return commentsScope(v);
    case "posts":
      return postsScope(v, a);
    case "profile_sections":
      return sectionsScope(v, a);
    case "profiles":
      return profilesScope(v, a);
    case "sponsor_capabilities":
    case "sponsor_tier_capabilities":
    case "sponsor_tiers":
      return catalogScope(v);
  }
}
