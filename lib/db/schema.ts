/**
 * Column and relationship facts about the D1 tables, used by the query
 * layer (lib/db/rest.ts) to validate column names, convert SQLite's 0/1
 * and JSON text back into the booleans and objects the app expects, and
 * resolve embeds like `posts.select("*, companies(name)")`.
 *
 * Mirrors db/migrations. tests/db/rest.test.ts checks it against the real
 * schema, so a column added to one and not the other fails the tests.
 */

export type TableName =
  | "applications"
  | "companies"
  | "company_capability_overrides"
  | "company_join_requests"
  | "company_join_request_queue"
  | "company_users"
  | "conversations"
  | "hiring_packages"
  | "invites"
  | "job_listings"
  | "member_documents"
  | "messages"
  | "post_comments"
  | "posts"
  | "profile_sections"
  | "profiles"
  | "sponsor_capabilities"
  | "sponsor_tier_capabilities"
  | "sponsor_tier_events"
  | "sponsor_tiers";

type TableInfo = {
  columns: string[];
  /** Columns that make a row unique, for updates and upserts. */
  key: string[];
  booleans?: string[];
  json?: string[];
  /** Columns the database fills in when an insert leaves them out. */
  generatedId?: boolean;
  readOnly?: boolean;
};

export const TABLES: Record<TableName, TableInfo> = {
  applications: {
    columns: [
      "id", "member_id", "kind", "post_id", "company_id", "company_name", "package_id", "package_name",
      "linkedin_url", "resume_path", "cover_letter", "cover_letter_path", "stage", "notes", "created_at", "updated_at",
    ],
    key: ["id"],
    generatedId: true,
  },
  companies: {
    columns: [
      "id", "name", "slug", "logo_url", "website", "description", "status", "created_at",
      "sponsor_tier_id", "grace_tier_id", "tier_grace_until",
    ],
    key: ["id"],
    generatedId: true,
  },
  company_capability_overrides: {
    columns: ["company_id", "capability", "granted", "value"],
    key: ["company_id", "capability"],
    booleans: ["granted"],
  },
  company_join_requests: {
    columns: [
      "id", "company_name", "website", "contact_name", "contact_email", "note", "status",
      "reviewed_by", "reviewed_at", "admin_note", "company_id", "created_at",
    ],
    key: ["id"],
    generatedId: true,
  },
  company_join_request_queue: {
    columns: ["id", "created_at", "status", "company_name", "contact_name", "contact_email", "note"],
    key: ["id"],
    readOnly: true,
  },
  company_users: { columns: ["company_id", "profile_id"], key: ["company_id", "profile_id"] },
  conversations: {
    columns: ["id", "member_id", "company_id", "member_last_read_at", "company_last_read_at", "created_at"],
    key: ["id"],
    generatedId: true,
  },
  hiring_packages: {
    columns: [
      "id", "member_id", "name", "linkedin_url", "resume_path", "cover_letter", "cover_letter_path",
      "is_default", "created_at", "updated_at",
    ],
    key: ["id"],
    booleans: ["is_default"],
    generatedId: true,
  },
  invites: {
    columns: ["id", "email", "full_name", "role", "is_admin", "company_id", "invited_by", "accepted_at", "created_at"],
    key: ["id"],
    booleans: ["is_admin"],
    generatedId: true,
  },
  job_listings: {
    columns: [
      "id", "url", "source", "company", "title", "locations", "role_type", "term", "posted_at", "first_seen_at",
      "last_seen_at", "active", "hidden",
    ],
    key: ["id"],
    booleans: ["active", "hidden"],
    json: ["locations"],
  },
  member_documents: {
    columns: ["member_id", "resume_path", "cover_letter_path", "cover_letter", "updated_at"],
    key: ["member_id"],
  },
  messages: {
    columns: ["id", "conversation_id", "sender_id", "body", "created_at"],
    key: ["id"],
    generatedId: true,
  },
  post_comments: {
    columns: ["id", "post_id", "author_id", "body", "created_at"],
    key: ["id"],
    generatedId: true,
  },
  posts: {
    columns: [
      "id", "author_id", "company_id", "kind", "title", "body", "location", "starts_at", "published", "status",
      "role_type", "term_season", "term_year", "external_url", "created_at", "updated_at",
    ],
    key: ["id"],
    booleans: ["published"],
    generatedId: true,
  },
  profile_sections: {
    columns: ["id", "member_id", "label", "body", "sort_order"],
    key: ["id"],
    generatedId: true,
  },
  profiles: {
    columns: [
      "id", "email", "full_name", "role", "is_admin", "program", "grad_year", "bio", "interests",
      "linkedin_url", "github_url", "website_url", "photo_path", "created_at",
      "resume_book_opt_in", "resume_book_opt_in_at", "resume_book_opt_in_by",
    ],
    key: ["id"],
    booleans: ["is_admin", "resume_book_opt_in"],
  },
  sponsor_capabilities: {
    columns: ["key", "label", "description", "kind", "is_enforced", "sort_order"],
    key: ["key"],
    booleans: ["is_enforced"],
  },
  sponsor_tier_capabilities: { columns: ["tier_id", "capability", "value"], key: ["tier_id", "capability"] },
  sponsor_tier_events: {
    columns: ["id", "kind", "tier_id", "company_id", "detail", "actor_id", "created_at"],
    key: ["id"],
    json: ["detail"],
    generatedId: true,
  },
  sponsor_tiers: {
    columns: [
      "id", "key", "name", "rank", "price_cents", "blurb", "applicant_embargo_hours", "is_active", "is_system",
      "created_at", "resume_book_embargo_hours",
    ],
    key: ["id"],
    booleans: ["is_active", "is_system"],
    generatedId: true,
  },
};

/**
 * Foreign keys, as PostgREST sees them. `from.column` references
 * `to.toColumn`. An embed `to(...)` on `from` is to-one; an embed `from(...)`
 * on `to` is to-many. A `!column` hint picks one when a pair has several.
 */
export type Relation = { from: TableName; column: string; to: TableName; toColumn: string };

export const RELATIONS: Relation[] = [
  { from: "applications", column: "member_id", to: "profiles", toColumn: "id" },
  { from: "applications", column: "post_id", to: "posts", toColumn: "id" },
  { from: "applications", column: "company_id", to: "companies", toColumn: "id" },
  { from: "applications", column: "package_id", to: "hiring_packages", toColumn: "id" },
  { from: "companies", column: "sponsor_tier_id", to: "sponsor_tiers", toColumn: "id" },
  { from: "companies", column: "grace_tier_id", to: "sponsor_tiers", toColumn: "id" },
  { from: "company_capability_overrides", column: "company_id", to: "companies", toColumn: "id" },
  { from: "company_capability_overrides", column: "capability", to: "sponsor_capabilities", toColumn: "key" },
  { from: "company_join_requests", column: "company_id", to: "companies", toColumn: "id" },
  { from: "company_join_requests", column: "reviewed_by", to: "profiles", toColumn: "id" },
  { from: "company_users", column: "company_id", to: "companies", toColumn: "id" },
  { from: "company_users", column: "profile_id", to: "profiles", toColumn: "id" },
  { from: "conversations", column: "member_id", to: "profiles", toColumn: "id" },
  { from: "conversations", column: "company_id", to: "companies", toColumn: "id" },
  { from: "hiring_packages", column: "member_id", to: "profiles", toColumn: "id" },
  { from: "invites", column: "company_id", to: "companies", toColumn: "id" },
  { from: "invites", column: "invited_by", to: "profiles", toColumn: "id" },
  { from: "member_documents", column: "member_id", to: "profiles", toColumn: "id" },
  { from: "messages", column: "conversation_id", to: "conversations", toColumn: "id" },
  { from: "messages", column: "sender_id", to: "profiles", toColumn: "id" },
  { from: "post_comments", column: "post_id", to: "posts", toColumn: "id" },
  { from: "post_comments", column: "author_id", to: "profiles", toColumn: "id" },
  { from: "posts", column: "author_id", to: "profiles", toColumn: "id" },
  { from: "posts", column: "company_id", to: "companies", toColumn: "id" },
  { from: "profile_sections", column: "member_id", to: "profiles", toColumn: "id" },
  { from: "profiles", column: "resume_book_opt_in_by", to: "profiles", toColumn: "id" },
  { from: "sponsor_tier_capabilities", column: "tier_id", to: "sponsor_tiers", toColumn: "id" },
  { from: "sponsor_tier_capabilities", column: "capability", to: "sponsor_capabilities", toColumn: "key" },
  { from: "sponsor_tier_events", column: "tier_id", to: "sponsor_tiers", toColumn: "id" },
  { from: "sponsor_tier_events", column: "company_id", to: "companies", toColumn: "id" },
  { from: "sponsor_tier_events", column: "actor_id", to: "profiles", toColumn: "id" },
];

export function isTable(name: string): name is TableName {
  return Object.prototype.hasOwnProperty.call(TABLES, name);
}

export type Embed = { kind: "one" | "many"; table: TableName; localColumn: string; remoteColumn: string };

/** Resolves `embed` (with optional `!hint`) on `parent`, as PostgREST would. */
export function resolveEmbed(parent: TableName, embed: string, hint?: string): Embed {
  if (!isTable(embed)) throw new Error(`Unknown table ${embed}`);
  const toOne = RELATIONS.filter((r) => r.from === parent && r.to === embed && (!hint || r.column === hint));
  const toMany = RELATIONS.filter((r) => r.to === parent && r.from === embed && (!hint || r.column === hint));
  const all = [
    ...toOne.map((r) => ({ kind: "one" as const, table: embed, localColumn: r.column, remoteColumn: r.toColumn })),
    ...toMany.map((r) => ({ kind: "many" as const, table: embed, localColumn: r.toColumn, remoteColumn: r.column })),
  ];
  if (all.length === 0) throw new Error(`No relationship between ${parent} and ${embed}`);
  if (all.length > 1) throw new Error(`Ambiguous embed ${embed} on ${parent}; add a !column hint`);
  return all[0];
}

/** SQLite gives back 0/1 and JSON text; give the app the types Postgres did. */
export function decodeRow(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const info = TABLES[table];
  const out: Record<string, unknown> = { ...row };
  for (const c of info.booleans ?? []) if (c in out && out[c] != null) out[c] = Boolean(out[c]);
  for (const c of info.json ?? []) {
    if (typeof out[c] === "string") {
      try {
        out[c] = JSON.parse(out[c] as string);
      } catch {
        // Leave malformed JSON as text; the column has a json_valid check.
      }
    }
  }
  return out;
}

/** The reverse, for values written or compared. */
export function encodeValue(table: TableName, column: string, value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  if ((TABLES[table].json ?? []).includes(column) && value !== null && typeof value !== "string") {
    return JSON.stringify(value);
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}
