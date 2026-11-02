/**
 * Row-level permissions for D1, ported from the Supabase RLS policies.
 *
 * Supabase checked every query against policies inside Postgres. D1 has no
 * RLS, so every read goes through a `scope` below (a WHERE fragment that
 * returns only rows this viewer could have seen through PostgREST), and
 * every write goes through an `assert`/`can` check first. A policy that
 * returned no rows on Supabase returns no rows here; a write RLS would have
 * refused throws `Denied` here.
 *
 * The comment above each function names the policy or SQL function it
 * replaces, so the two can be compared line by line.
 */

import type { CompanyAccess } from "@/lib/db/access";
import { isPackagePdfPath, isPhotoPath, isSnapshotPath } from "@/lib/storage-paths";
import type { CapabilityKey } from "@/lib/tiers";

export type Role = "member" | "company_user";

export type Viewer = {
  id: string;
  role: Role;
  isAdmin: boolean;
  /** company_users row for a company user, else null. */
  companyId: string | null;
  /** Resolved firm access for a company user, else null. */
  access: CompanyAccess | null;
  now: Date;
  /** Admin previewing a sponsor in sponsor mode: reads as that sponsor, writes nothing. */
  readOnly?: boolean;
};

/** A signed-out visitor. Every scope returns nothing and every write is denied. */
export type MaybeViewer = Viewer | null;

export class Denied extends Error {
  constructor(message = "Not allowed") {
    super(message);
    this.name = "Denied";
  }
}

export type Sql = { sql: string; params: unknown[] };

const NONE: Sql = { sql: "0", params: [] };
const ALL: Sql = { sql: "1", params: [] };

function or(...parts: Sql[]): Sql {
  const live = parts.filter((p) => p.sql !== "0");
  if (live.length === 0) return NONE;
  if (live.some((p) => p.sql === "1")) return ALL;
  return {
    sql: live.map((p) => `(${p.sql})`).join(" OR "),
    params: live.flatMap((p) => p.params),
  };
}

function and(...parts: Sql[]): Sql {
  if (parts.some((p) => p.sql === "0")) return NONE;
  const live = parts.filter((p) => p.sql !== "1");
  if (live.length === 0) return ALL;
  return {
    sql: live.map((p) => `(${p.sql})`).join(" AND "),
    params: live.flatMap((p) => p.params),
  };
}

function when(condition: boolean, part: Sql): Sql {
  return condition ? part : NONE;
}

function sql(text: string, ...params: unknown[]): Sql {
  return { sql: text, params };
}

/** SQL identifiers here are always our own literals, never user input. */
function col(alias: string, column: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias) || !/^[a-z_][a-z0-9_]*$/.test(column)) {
    throw new Error(`bad identifier ${alias}.${column}`);
  }
  return `${alias}.${column}`;
}

export function iso(d: Date) {
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Viewer helpers (is_member, is_admin, my_company_id, my_capability)
// ---------------------------------------------------------------------------

export function isMember(v: MaybeViewer): v is Viewer {
  return v != null && v.role === "member";
}

export function isAdmin(v: MaybeViewer): v is Viewer {
  return v != null && v.isAdmin;
}

export function myCompanyId(v: MaybeViewer): string | null {
  return v?.companyId ?? null;
}

/** my_capability / my_live_capability (identical since 0012). */
export function myCapability(v: MaybeViewer, cap: CapabilityKey): boolean {
  return Boolean(v?.companyId && v.access && v.access.companyId === v.companyId && v.access.has(cap));
}

export function myCapabilityValue(v: MaybeViewer, cap: CapabilityKey): number | null {
  return v?.access ? v.access.value(cap) : null;
}


// ---------------------------------------------------------------------------
// Shared predicates
// ---------------------------------------------------------------------------

/**
 * my_visible_applicant(member): the member applied in-app to one of my
 * firm's posts and my firm can read applicants. No delay: a firm sees an
 * application as soon as it is submitted.
 */
export function visibleApplicantSql(v: MaybeViewer, memberColumn: string): Sql {
  if (!v?.companyId || !myCapability(v, "read_applicants")) return NONE;
  return sql(
    `EXISTS (SELECT 1 FROM applications va JOIN posts vp ON vp.id = va.post_id
      WHERE va.member_id = ${memberColumn} AND va.kind = 'in_app'
        AND vp.company_id = ?)`,
    v.companyId,
  );
}

/**
 * my_opted_in_member(member): I'm at a firm with the resume book, candidate
 * search, or message-any, and the member opted into the book. No delay:
 * every tier sees a new opt-in straight away.
 */
export function optedInMemberSql(v: MaybeViewer, memberColumn: string): Sql {
  if (!v?.companyId) return NONE;
  const talent =
    myCapability(v, "resume_book") ||
    myCapability(v, "candidate_search") ||
    myCapability(v, "dm_initiate_any");
  if (!talent) return NONE;
  return sql(
    `EXISTS (SELECT 1 FROM profiles op WHERE op.id = ${memberColumn}
      AND op.role = 'member' AND op.resume_book_opt_in = 1
      AND op.resume_book_opt_in_at IS NOT NULL)`,
  );
}

/** my_contactable_opt_in(member): message-any plus opted in. */
export function contactableOptInSql(v: MaybeViewer, memberColumn: string): Sql {
  if (!myCapability(v, "dm_initiate_any")) return NONE;
  return optedInMemberSql(v, memberColumn);
}

// ---------------------------------------------------------------------------
// Read scopes, one per table. Use as: `SELECT ... FROM posts p WHERE ${scope.sql}`
// ---------------------------------------------------------------------------

/** profiles_self_select, profiles_admin_all, profiles_members_directory, profiles_company_applicants */
export function profilesScope(v: MaybeViewer, a = "p"): Sql {
  if (!v) return NONE;
  if (v.isAdmin) return ALL;
  return or(
    sql(`${col(a, "id")} = ?`, v.id),
    when(isMember(v), sql(`${col(a, "role")} = 'member'`)),
    visibleApplicantSql(v, col(a, "id")),
  );
}

/** companies_member_read, companies_own_read, companies_admin_write */
export function companiesScope(v: MaybeViewer, a = "c"): Sql {
  if (!v) return NONE;
  if (v.isAdmin) return ALL;
  return or(
    when(isMember(v), sql(`${col(a, "status")} = 'active'`)),
    when(v.companyId != null, sql(`${col(a, "id")} = ?`, v.companyId)),
  );
}

/** company_users_own, company_users_admin */
export function companyUsersScope(v: MaybeViewer, a = "cu"): Sql {
  if (!v) return NONE;
  if (v.isAdmin) return ALL;
  return or(
    sql(`${col(a, "profile_id")} = ?`, v.id),
    when(v.companyId != null, sql(`${col(a, "company_id")} = ?`, v.companyId)),
  );
}

/** company_capability_overrides_own_read, company_capability_overrides_admin */
export function overridesScope(v: MaybeViewer, a = "o"): Sql {
  if (!v) return NONE;
  if (v.isAdmin) return ALL;
  return when(v.companyId != null, sql(`${col(a, "company_id")} = ?`, v.companyId));
}

/** sponsor_capabilities_read, sponsor_tiers_read, sponsor_tier_capabilities_read: any signed-in user. */
export function catalogScope(v: MaybeViewer): Sql {
  return v ? ALL : NONE;
}

/** Opportunities (job_listings): club members and admins; sponsors don't see them. */
export function jobListingsScope(v: MaybeViewer): Sql {
  return v && (v.role === "member" || v.isAdmin) ? ALL : NONE;
}

/** sponsor_tier_events_admin_read, invites_admin, join_requests_admin */
export function adminOnlyScope(v: MaybeViewer): Sql {
  return isAdmin(v) ? ALL : NONE;
}

/** posts_member_feed, posts_company_own, posts_admin_read */
export function postsScope(v: MaybeViewer, a = "p"): Sql {
  if (!v) return NONE;
  if (v.isAdmin) return ALL;
  return or(
    when(isMember(v), sql(`${col(a, "published")} = 1`)),
    when(v.companyId != null, sql(`${col(a, "company_id")} = ?`, v.companyId)),
  );
}

/** comments_member_read */
export function commentsScope(v: MaybeViewer): Sql {
  return isMember(v) ? ALL : NONE;
}

/** applications_own, applications_company_in_app */
export function applicationsScope(v: MaybeViewer, a = "ap"): Sql {
  if (!v) return NONE;
  if (v.isAdmin) return ALL;
  return or(sql(`${col(a, "member_id")} = ?`, v.id), companyApplicationsSql(v, a));
}

/** The firm's half of applications_company_in_app / applications_company_stage. */
export function companyApplicationsSql(v: Viewer, a: string): Sql {
  if (!v.companyId || !myCapability(v, "read_applicants")) return NONE;
  return sql(
    `${col(a, "kind")} = 'in_app'
      AND ${col(a, "post_id")} IN (SELECT id FROM posts WHERE company_id = ?)`,
    v.companyId,
  );
}

/** conversations_member, conversations_company */
export function conversationsScope(v: MaybeViewer, a = "cv"): Sql {
  if (!v) return NONE;
  if (v.isAdmin) return ALL;
  return or(
    sql(`${col(a, "member_id")} = ?`, v.id),
    when(v.companyId != null, sql(`${col(a, "company_id")} = ?`, v.companyId)),
  );
}

/**
 * messages_member, messages_company. Admins see conversations but, as on
 * Supabase, not the messages inside them.
 */
export function messagesScope(v: MaybeViewer, a = "m"): Sql {
  if (!v) return NONE;
  const mine = or(
    sql(`c.member_id = ?`, v.id),
    when(v.companyId != null, sql(`c.company_id = ?`, v.companyId)),
  );
  if (mine.sql === "0") return NONE;
  return {
    sql: `EXISTS (SELECT 1 FROM conversations c WHERE c.id = ${col(a, "conversation_id")} AND (${mine.sql}))`,
    params: mine.params,
  };
}

/** sections_member_read, sections_own_write, sections_admin */
export function sectionsScope(v: MaybeViewer, a = "s"): Sql {
  if (!v) return NONE;
  if (v.isAdmin) return ALL;
  return or(
    sql(`${col(a, "member_id")} = ?`, v.id),
    when(
      isMember(v),
      sql(`EXISTS (SELECT 1 FROM profiles sp WHERE sp.id = ${col(a, "member_id")} AND sp.role = 'member')`),
    ),
  );
}

/** packages_own, packages_admin */
export function packagesScope(v: MaybeViewer, a = "hp"): Sql {
  if (!v) return NONE;
  if (v.isAdmin) return ALL;
  return sql(`${col(a, "member_id")} = ?`, v.id);
}

/** documents_own (members only, and admins have no bypass here) */
export function documentsScope(v: MaybeViewer, a = "d"): Sql {
  if (!isMember(v)) return NONE;
  return sql(`${col(a, "member_id")} = ?`, v.id);
}

// ---------------------------------------------------------------------------
// Talent (resume_book_list, candidate_search_list, talent_*_path)
// ---------------------------------------------------------------------------

function likeEscape(s: string) {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * resume_book_list and candidate_search_list. `q` only applies to search.
 * Returns the full statement; columns match the old RPC rows.
 */
export function talentListSql(
  v: MaybeViewer,
  mode: "resume_book" | "candidate_search",
  filters: { q?: string | null; program?: string | null; gradYear?: number | null } = {},
): Sql | null {
  if (!myCapability(v, mode)) return null;
  const opted = optedInMemberSql(v, "pr.id");
  if (opted.sql === "0") return null;
  const parts: Sql[] = [opted];
  if (filters.program) parts.push(sql(`pr.program LIKE ? ESCAPE '\\'`, likeEscape(filters.program)));
  if (filters.gradYear != null) parts.push(sql(`pr.grad_year = ?`, filters.gradYear));
  if (mode === "candidate_search" && filters.q) {
    const q = likeEscape(filters.q);
    parts.push(
      sql(
        `pr.full_name LIKE ? ESCAPE '\\' OR coalesce(pr.program, '') LIKE ? ESCAPE '\\'
          OR coalesce(pr.interests, '') LIKE ? ESCAPE '\\' OR coalesce(pr.bio, '') LIKE ? ESCAPE '\\'`,
        q, q, q, q,
      ),
    );
  }
  const where = and(...parts);
  return {
    sql: `SELECT pr.id, pr.full_name, pr.program, pr.grad_year, pr.bio, pr.interests,
        pr.linkedin_url, pr.github_url, pr.website_url, pr.photo_path, NULL AS package_name
      FROM profiles pr
      JOIN member_documents md ON md.member_id = pr.id AND md.resume_path IS NOT NULL
      WHERE ${where.sql}
      ORDER BY pr.full_name`,
    params: where.params,
  };
}

/** talent_resume_path / talent_photo_path: book or search, plus opted in. */
export function talentFileAllowed(v: MaybeViewer): boolean {
  return myCapability(v, "resume_book") || myCapability(v, "candidate_search");
}

// ---------------------------------------------------------------------------
// Files (the storage.objects policies, now R2 keys served by the Worker)
// ---------------------------------------------------------------------------

export type Bucket = "resumes" | "photos";

/**
 * photos_member_read, photos_own_read, resumes_own_read, plus the reads the
 * app made with the service key after its own check (snapshots for a firm
 * that can see the application, opted-in talent files). `ctx` carries what
 * the caller already looked up through a scope.
 */
export function canReadFile(
  v: MaybeViewer,
  bucket: Bucket,
  key: string,
  ctx: { applicationVisible?: boolean; talentOptedIn?: boolean } = {},
): boolean {
  if (!v) return false;
  const owner = key.split("/")[0];
  if (bucket === "photos") {
    if (owner === v.id || isMember(v)) return true;
    return Boolean(ctx.talentOptedIn && talentFileAllowed(v));
  }
  if (owner === v.id) return true;
  if (owner === "snapshots") return Boolean(ctx.applicationVisible);
  return Boolean(ctx.talentOptedIn && talentFileAllowed(v));
}

/** photos_own_write/update, resumes_own_write/update: members write under their own id. */
export function canWriteFile(v: MaybeViewer, bucket: Bucket, key: string): boolean {
  if (!isMember(v)) return false;
  if (bucket === "photos") return isPhotoPath(key, v.id);
  return isPackagePdfPath(key, v.id);
}

// ---------------------------------------------------------------------------
// Write checks
// ---------------------------------------------------------------------------

function deny(message?: string): never {
  throw new Denied(message);
}

/** Admin-only tables: invites, join requests, company_users, tiers, overrides, tier events. */
export function assertAdmin(v: MaybeViewer): asserts v is Viewer {
  if (!isAdmin(v)) deny();
}

// --- profiles --------------------------------------------------------------

export type ProfileRow = {
  id: string;
  email: string;
  role: Role;
  is_admin: boolean | number;
  photo_path: string | null;
  resume_book_opt_in: boolean | number;
  resume_book_opt_in_at: string | null;
  resume_book_opt_in_by: string | null;
};

/**
 * profiles_self_update + profiles_protect_privileged + profiles_stamp_opt_in
 * + canonical_object_paths_guard. Returns the patch to write.
 */
export function profileUpdate<T extends Partial<ProfileRow> & Record<string, unknown>>(
  v: MaybeViewer,
  before: ProfileRow,
  patch: T,
): Record<string, unknown> {
  if (!v) deny();
  if (before.id !== v.id && !v.isAdmin) deny();
  const out: Record<string, unknown> = { ...patch };
  delete out.id;
  delete out.resume_book_opt_in_at;
  delete out.resume_book_opt_in_by;
  if (before.id === v.id) {
    // Members cannot self-promote, change email, or change role.
    delete out.role;
    delete out.is_admin;
    delete out.email;
  }
  if ("photo_path" in out && out.photo_path != null && out.photo_path !== before.photo_path) {
    if (!isPhotoPath(out.photo_path, before.id)) deny("Invalid photo object path");
  }
  if ("resume_book_opt_in" in out) {
    Object.assign(out, stampOptIn(v, before, Boolean(out.resume_book_opt_in)));
  }
  return out;
}

/** profiles_stamp_opt_in: only the member grants consent, and the grant time is the server's. */
export function stampOptIn(v: MaybeViewer, before: ProfileRow, optIn: boolean) {
  if (!optIn) {
    return { resume_book_opt_in: 0, resume_book_opt_in_at: null, resume_book_opt_in_by: null };
  }
  if (before.resume_book_opt_in) {
    return {
      resume_book_opt_in: 1,
      resume_book_opt_in_at: before.resume_book_opt_in_at,
      resume_book_opt_in_by: before.resume_book_opt_in_by,
    };
  }
  if (!v || v.id !== before.id) deny("Only the member can grant resume book consent");
  if (before.role !== "member") deny();
  return { resume_book_opt_in: 1, resume_book_opt_in_at: iso(v.now), resume_book_opt_in_by: v.id };
}

// --- companies -------------------------------------------------------------

const COMPANY_ADMIN_FIELDS = ["status", "slug", "sponsor_tier_id", "grace_tier_id", "tier_grace_until"];

/** companies_own_update + companies_protect_admin_fields. */
export function assertCompanyUpdate(v: MaybeViewer, companyId: string, patch: Record<string, unknown>) {
  if (!v) deny();
  if (v.isAdmin) return;
  if (v.companyId !== companyId) deny();
  if ("id" in patch && patch.id !== companyId) deny();
  if (COMPANY_ADMIN_FIELDS.some((f) => f in patch)) deny("Only QUANTT admins can change that");
}

// --- posts -----------------------------------------------------------------

export type PostShape = {
  company_id: string | null;
  author_id: string;
  kind: string;
  external_url: string | null;
  status?: string;
};

function companyMayPostKind(v: Viewer, p: PostShape) {
  if (p.kind === "announcement" || p.kind === "job_link") return true;
  if (p.kind === "job" && p.external_url != null) return true;
  if (p.kind === "event") return myCapability(v, "post_event");
  if (p.kind === "job" && p.external_url == null) return myCapability(v, "post_in_app_job");
  return false;
}

export function isOpenInAppJob(p: Pick<PostShape, "kind" | "external_url" | "status">) {
  return p.kind === "job" && p.external_url == null && (p.status ?? "open") === "open";
}

/** posts_company_insert, posts_admin_write. Quota is checked separately with the open-job count. */
export function assertPostInsert(v: MaybeViewer, post: PostShape) {
  if (!v) deny();
  if (v.isAdmin) return;
  if (post.author_id !== v.id) deny();
  if (!v.companyId || post.company_id !== v.companyId) deny();
  if (!companyMayPostKind(v, post)) deny();
}

/** posts_company_update, posts_admin_write, and the author lock in posts_in_app_quota_guard. */
export function assertPostUpdate(v: MaybeViewer, before: PostShape, after: PostShape) {
  if (!v) deny();
  if (v.isAdmin) return;
  if (!v.companyId || before.company_id !== v.companyId) deny();
  if (after.company_id !== v.companyId) deny();
  if (after.author_id !== before.author_id) deny("Post author cannot be changed");
  if (!companyMayPostKind(v, after)) deny();
}

/** Deleting posts is admin-only (posts_admin_write). Firms close them instead. */
export function assertPostDelete(v: MaybeViewer) {
  assertAdmin(v);
}

/** close_own_post */
export function canClosePost(v: MaybeViewer, post: Pick<PostShape, "company_id">) {
  if (!v) return false;
  return v.isAdmin || (v.companyId != null && post.company_id === v.companyId);
}

/**
 * posts_in_app_quota_guard: a post that becomes an open in-app job needs
 * the capability and a free slot. `openJobs` is the firm's current count of
 * open in-app jobs, not counting this post. Admin inserts skip the check,
 * as they did on Supabase; an admin reopening or moving a post does not.
 */
export function assertJobSlot(
  v: MaybeViewer,
  firm: CompanyAccess | null,
  openJobs: number,
  op: "insert" | "update",
) {
  if (op === "insert" && isAdmin(v)) return;
  if (!firm || !firm.has("post_in_app_job")) deny("This firm is not allowed to post in-app jobs");
  const quota = firm.value("post_in_app_job");
  if (quota != null && openJobs >= quota) deny("This firm has reached its open in-app job limit");
}

/** Rows counted by the quota: open in-app jobs at a firm. */
export function openInAppJobCountSql(companyId: string, excludePostId?: string): Sql {
  return sql(
    `SELECT count(*) AS n FROM posts WHERE company_id = ? AND kind = 'job'
      AND external_url IS NULL AND status = 'open'${excludePostId ? " AND id <> ?" : ""}`,
    ...(excludePostId ? [companyId, excludePostId] : [companyId]),
  );
}

// --- comments --------------------------------------------------------------

/** comments_member_insert */
export function assertCommentInsert(v: MaybeViewer, comment: { author_id: string }) {
  if (!isMember(v) || comment.author_id !== v.id) deny();
}

/** comments_own_delete */
export function assertCommentDelete(v: MaybeViewer, comment: { author_id: string }) {
  if (!v || (comment.author_id !== v.id && !v.isAdmin)) deny();
}

// --- sections, packages, documents -----------------------------------------

/** sections_own_write, sections_admin */
export function assertSectionWrite(v: MaybeViewer, memberId: string) {
  if (!v || (memberId !== v.id && !v.isAdmin)) deny();
}

/** packages_own, packages_admin, hiring_packages_path_guard */
export function assertPackageWrite(
  v: MaybeViewer,
  pkg: { member_id: string; resume_path: string; cover_letter_path: string | null },
) {
  if (!v || (pkg.member_id !== v.id && !v.isAdmin)) deny();
  if (!isPackagePdfPath(pkg.resume_path, pkg.member_id)) deny("Invalid resume path");
  if (pkg.cover_letter_path != null && !isPackagePdfPath(pkg.cover_letter_path, pkg.member_id)) {
    deny("Invalid cover letter path");
  }
}

/** documents_own + the member_documents path checks */
export function assertDocumentsWrite(
  v: MaybeViewer,
  doc: { member_id: string; resume_path?: string | null; cover_letter_path?: string | null },
) {
  if (!isMember(v) || doc.member_id !== v.id) deny();
  if (doc.resume_path != null && !isPackagePdfPath(doc.resume_path, doc.member_id)) deny("Invalid resume path");
  if (doc.cover_letter_path != null && !isPackagePdfPath(doc.cover_letter_path, doc.member_id)) {
    deny("Invalid cover letter path");
  }
}

// --- applications ----------------------------------------------------------

export type ApplicationInsert = {
  id: string;
  member_id: string;
  kind: "in_app" | "off_platform";
  post_id: string | null;
  package_id: string | null;
  resume_path: string | null;
  cover_letter_path: string | null;
  company_name?: string | null;
};

/**
 * applications_member_insert + applications_guard + canonical_object_paths_guard.
 * Returns the company_id to store (always the post's firm for in-app).
 */
export function applicationInsert(
  v: MaybeViewer,
  app: ApplicationInsert,
  ctx: {
    post: { id: string; kind: string; external_url: string | null; status: string; published: boolean | number; company_id: string | null } | null;
    postFirm: CompanyAccess | null;
    packageOwnerId: string | null;
  },
): { company_id: string | null } {
  if (!v) deny();
  if (!v.isAdmin && !(isMember(v) && app.member_id === v.id)) deny();
  if (app.kind === "off_platform") {
    if (!app.company_name) deny();
    return { company_id: null };
  }
  const p = ctx.post;
  if (!p || p.id !== app.post_id || p.kind !== "job" || p.external_url != null || p.status !== "open" || !p.published) {
    deny("Apply is only allowed on open in-app jobs");
  }
  if (p.company_id != null && !(ctx.postFirm && ctx.postFirm.has("read_applicants"))) {
    deny("This firm is not accepting hub applications");
  }
  if (!isSnapshotPath(app.resume_path, app.id)) deny("Invalid resume path");
  if (app.cover_letter_path != null && !isSnapshotPath(app.cover_letter_path, app.id)) {
    deny("Invalid cover letter path");
  }
  if (app.package_id != null && ctx.packageOwnerId !== app.member_id) deny("Invalid package");
  return { company_id: p.company_id };
}

const APPLICATION_MEMBER_FIELDS = new Set(["stage", "notes", "company_name"]);
const APPLICATION_FIRM_FIELDS = new Set(["stage"]);

/**
 * applications_member_off_platform_update, applications_company_stage,
 * applications_admin_write. `visibleToFirm` is whether the row passed the
 * firm's applications scope. Snapshot columns are also locked by a trigger.
 */
export function assertApplicationUpdate(
  v: MaybeViewer,
  before: { member_id: string; kind: string },
  patch: Record<string, unknown>,
  ctx: { visibleToFirm: boolean },
) {
  if (!v) deny();
  if (v.isAdmin) return;
  const keys = Object.keys(patch);
  if (before.member_id === v.id && before.kind === "off_platform") {
    if (keys.every((k) => APPLICATION_MEMBER_FIELDS.has(k))) return;
  }
  if (ctx.visibleToFirm && before.kind === "in_app" && keys.every((k) => APPLICATION_FIRM_FIELDS.has(k))) {
    return;
  }
  deny();
}

// --- conversations and messages --------------------------------------------

/**
 * conversations_member_insert, conversations_company_insert. For a firm,
 * pass whether the member is a visible applicant and whether they are
 * contactable through the resume book (both from the SQL helpers above).
 */
export function assertConversationInsert(
  v: MaybeViewer,
  conv: { member_id: string; company_id: string },
  ctx: { visibleApplicant?: boolean; contactableOptIn?: boolean } = {},
) {
  if (!v) deny();
  if (isMember(v) && conv.member_id === v.id) return;
  if (v.companyId && conv.company_id === v.companyId) {
    if (myCapability(v, "dm_initiate_applicant") && ctx.visibleApplicant) return;
    if (ctx.contactableOptIn) return;
  }
  deny();
}

/** conversations_member_update / conversations_company_update: read receipts on your own side. */
export function conversationReadPatch(v: MaybeViewer, conv: { member_id: string; company_id: string }) {
  if (!v) deny();
  if (conv.member_id === v.id) return { member_last_read_at: iso(v.now) };
  if (v.companyId && conv.company_id === v.companyId) return { company_last_read_at: iso(v.now) };
  deny();
}

/** messages_insert_member, messages_insert_company */
export function assertMessageInsert(
  v: MaybeViewer,
  msg: { sender_id: string },
  conv: { member_id: string; company_id: string },
) {
  if (!v || msg.sender_id !== v.id) deny();
  if (conv.member_id === v.id) return;
  if (v.companyId && conv.company_id === v.companyId) return;
  deny();
}

// ---------------------------------------------------------------------------
// Public join form (submit_join_request)
// ---------------------------------------------------------------------------

export type JoinRequestInput = {
  company_name: string;
  website: string | null;
  contact_name: string;
  contact_email: string;
  note: string | null;
};

/** Field rules from submit_join_request. Returns trimmed values, or null if invalid. */
export function cleanJoinRequest(input: JoinRequestInput): JoinRequestInput | null {
  const company_name = (input.company_name ?? "").trim();
  const contact_name = (input.contact_name ?? "").trim();
  const contact_email = (input.contact_email ?? "").trim().toLowerCase();
  const website = input.website || null;
  const note = input.note || null;
  if (company_name.length < 1 || company_name.length > 200) return null;
  if (contact_name.length < 1 || contact_name.length > 120) return null;
  if (contact_email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) return null;
  if (website != null && (website.length > 500 || !/^https?:\/\//.test(website))) return null;
  if (note != null && note.length > 2000) return null;
  return { company_name, website, contact_name, contact_email, note };
}

/**
 * Fixed UTC windows from submit_join_request: 500/day and 100/hour overall,
 * 5/hour per source, 3/day per email. `source` and `emailHash` are hex digests.
 */
export function joinAdmissionBuckets(now: Date, source: string, emailHash: string) {
  const s = Math.floor(now.getTime() / 1000);
  const day = Math.floor(s / 86400);
  const hour = Math.floor(s / 3600);
  return [
    { key: `global-day:${day}`, maximum: 500, expires_at: iso(new Date((day + 1) * 86400_000)) },
    { key: `global-hour:${hour}`, maximum: 100, expires_at: iso(new Date((hour + 1) * 3600_000)) },
    { key: `source:${source}:${hour}`, maximum: 5, expires_at: iso(new Date((hour + 1) * 3600_000)) },
    { key: `email:${emailHash}:${day}`, maximum: 3, expires_at: iso(new Date((day + 1) * 86400_000)) },
  ];
}

export const MAX_PENDING_JOIN_REQUESTS = 1000;
