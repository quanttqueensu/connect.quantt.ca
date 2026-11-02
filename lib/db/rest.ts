/**
 * A Supabase-client-shaped query builder over D1.
 *
 * The hub's pages and actions talk to the database through
 * `supabase.from(table).select(...).eq(...)`. Rather than rewrite all of
 * them, this implements the part of that API the app uses, on D1, with the
 * RLS policies from lib/db/policies.ts applied to every read and write. At
 * switch-over, lib/supabase/server.ts and admin.ts return this instead of
 * a Supabase client, and the pages keep working unchanged.
 *
 * Supported: select with embeds (`*, companies(name)`, `!hint`, `!inner`,
 * nested), count/head, eq neq gt gte lt lte is in like ilike or, filters on
 * embedded columns, order/limit (also on an embedded table), range, single,
 * maybeSingle, insert, update, upsert, delete, and `.select()` after a write.
 * Anything else throws, so a page that needs more fails loudly in tests.
 *
 * Results have Supabase's shape, `{ data, error, count, status }`, and never
 * throw. As on Supabase, a read the policies hide returns no rows, an update
 * or delete of a hidden row silently changes nothing, and an insert or a
 * change the policies refuse returns error code 42501.
 */

import type { D1Database, D1PreparedStatement } from "@/lib/db/d1";
import { Denied, type MaybeViewer, type Sql } from "@/lib/db/policies";
import { readScopeFor, writeRulesFor, type WriteContext } from "@/lib/db/rules";
import { decodeRow, encodeValue, isTable, resolveEmbed, TABLES, type TableName } from "@/lib/db/schema";

export type Principal = { kind: "service" } | { kind: "anon" } | { kind: "user"; viewer: MaybeViewer };

export type PostgrestError = { message: string; code: string; details: string | null; hint: string | null };

export type Result<T> = {
  data: T;
  error: PostgrestError | null;
  count: number | null;
  status: number;
  statusText: string;
};

const MAX_IN = 90; // D1 allows 100 bound parameters per statement.

// ---------------------------------------------------------------------------
// select-string parser
// ---------------------------------------------------------------------------

type SelectNode = {
  columns: string[] | "*";
  embeds: EmbedNode[];
};

type EmbedNode = SelectNode & { name: string; hint?: string; inner: boolean; alias: string };

export function parseSelect(text: string): SelectNode {
  let i = 0;
  const s = text.replace(/\s+/g, "");
  function parseList(): SelectNode {
    const node: SelectNode = { columns: [], embeds: [] };
    const cols: string[] = [];
    let star = false;
    while (i < s.length && s[i] !== ")") {
      let token = "";
      while (i < s.length && !",()".includes(s[i])) token += s[i++];
      if (s[i] === "(") {
        i++;
        const child = parseList();
        if (s[i] !== ")") throw new Error(`Bad select: ${text}`);
        i++;
        let alias = "";
        let rest = token;
        const colon = token.indexOf(":");
        if (colon >= 0) {
          alias = token.slice(0, colon);
          rest = token.slice(colon + 1);
        }
        const [name, ...mods] = rest.split("!");
        const inner = mods.includes("inner");
        const hint = mods.find((m) => m !== "inner" && m !== "left");
        node.embeds.push({ ...child, name, hint, inner, alias: alias || name });
      } else if (token === "*") {
        star = true;
      } else if (token) {
        if (!/^[a-z_][a-z0-9_]*$/.test(token)) throw new Error(`Unsupported select column: ${token}`);
        cols.push(token);
      }
      if (s[i] === ",") i++;
    }
    node.columns = star ? "*" : cols;
    return node;
  }
  const root = parseList();
  if (i !== s.length) throw new Error(`Bad select: ${text}`);
  if (root.columns !== "*" && root.columns.length === 0 && root.embeds.length === 0) root.columns = "*";
  return root;
}

// ---------------------------------------------------------------------------
// filters
// ---------------------------------------------------------------------------

type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "is" | "in" | "nin" | "like" | "ilike";
type Filter = { path: string[]; column: string; op: Op; value: unknown } | { or: Filter[] };

const OP_SQL: Record<Exclude<Op, "is" | "in" | "nin">, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
  ilike: "LIKE",
};

function splitPath(col: string) {
  const parts = col.split(".");
  return { path: parts.slice(0, -1), column: parts[parts.length - 1] };
}

function checkColumn(table: TableName, column: string) {
  if (!TABLES[table].columns.includes(column)) throw new Error(`Unknown column ${table}.${column}`);
}

function filterSql(table: TableName, alias: string, f: Filter): Sql {
  if ("or" in f) {
    const parts = f.or.map((x) => filterSql(table, alias, x));
    return { sql: parts.map((p) => `(${p.sql})`).join(" OR "), params: parts.flatMap((p) => p.params) };
  }
  checkColumn(table, f.column);
  const c = `${alias}.${f.column}`;
  const v = encodeValue(table, f.column, f.value);
  switch (f.op) {
    case "is":
      if (f.value === null) return { sql: `${c} IS NULL`, params: [] };
      if (f.value === true || f.value === false) return { sql: `${c} IS ?`, params: [v] };
      throw new Error(`Unsupported is(${String(f.value)})`);
    case "in":
    case "nin": {
      const list = (f.value as unknown[]).map((x) => encodeValue(table, f.column, x));
      const not = f.op === "nin";
      if (list.length === 0) return { sql: not ? "1" : "0", params: [] };
      // A long list goes in as one JSON parameter: D1 allows 100 bound values per statement.
      if (list.length > 20) {
        return { sql: `${c} ${not ? "NOT IN" : "IN"} (SELECT value FROM json_each(?))`, params: [JSON.stringify(list)] };
      }
      return { sql: `${c} ${not ? "NOT IN" : "IN"} (${list.map(() => "?").join(", ")})`, params: list };
    }
    case "like":
      // Postgres LIKE is case-sensitive; SQLite's is not for ASCII. GLOB would be, but uses * not %.
      return { sql: `${c} LIKE ? ESCAPE '\\'`, params: [v] };
    case "ilike":
      return { sql: `${c} LIKE ? ESCAPE '\\'`, params: [v] };
    default:
      return { sql: `${c} ${OP_SQL[f.op]} ?`, params: [v] };
  }
}

/** PostgREST `or` syntax: `col.op.value,col.op.value`, with `*` as the LIKE wildcard. */
export function parseOr(text: string): Filter[] {
  return text.split(",").map((part) => {
    const m = /^([a-z_][a-z0-9_]*)\.(eq|neq|gt|gte|lt|lte|is|like|ilike)\.(.*)$/.exec(part.trim());
    if (!m) throw new Error(`Unsupported or() term: ${part}`);
    const [, column, op, raw] = m;
    let value: unknown = raw;
    if (op === "like" || op === "ilike") value = raw.replace(/\*/g, "%");
    if (op === "is") value = raw === "null" ? null : raw === "true";
    return { path: [], column, op: op as Op, value };
  });
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

function toError(e: unknown): PostgrestError {
  if (e instanceof Denied) {
    return { message: e.message === "Not allowed" ? "new row violates row-level security policy" : e.message, code: "42501", details: null, hint: null };
  }
  const message = e instanceof Error ? e.message : String(e);
  let code = "P0001";
  if (/UNIQUE constraint failed/i.test(message)) code = "23505";
  else if (/CHECK constraint failed/i.test(message)) code = "23514";
  else if (/FOREIGN KEY constraint failed/i.test(message)) code = "23503";
  else if (/NOT NULL constraint failed/i.test(message)) code = "23502";
  else if (/^(Unknown|Unsupported|Bad select|No relationship|Ambiguous)/.test(message)) code = "PGRST100";
  return { message: message.replace(/^D1_ERROR:\s*/, "").replace(/:\s*SQLITE_CONSTRAINT.*$/, ""), code, details: null, hint: null };
}

function ok<T>(data: T, count: number | null = null, status = 200): Result<T> {
  return { data, error: null, count, status, statusText: "OK" };
}

function fail<T>(e: unknown): Result<T> {
  const error = toError(e);
  const status = error.code === "42501" ? 403 : error.code.startsWith("23") ? 409 : 400;
  return { data: null as T, error, count: null, status, statusText: "Error" };
}

// ---------------------------------------------------------------------------
// the builder
// ---------------------------------------------------------------------------

type Action =
  | { kind: "select" }
  | { kind: "insert"; rows: Record<string, unknown>[] }
  | { kind: "upsert"; rows: Record<string, unknown>[]; onConflict: string[]; ignoreDuplicates: boolean }
  | { kind: "update"; patch: Record<string, unknown> }
  | { kind: "delete" };

type Order = { column: string; ascending: boolean; nullsFirst?: boolean; referencedTable?: string };

export class QueryBuilder<T = unknown> implements PromiseLike<Result<T>> {
  private action: Action = { kind: "select" };
  private selectText: string | null = null;
  private countMode: "exact" | null = null;
  private head = false;
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private limits = new Map<string, number>();
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private singleMode: "single" | "maybe" | null = null;
  private returning = false;

  constructor(
    private readonly db: D1Database,
    private readonly principal: Principal,
    private readonly table: TableName,
  ) {}

  // --- verbs ---------------------------------------------------------------

  select(columns = "*", opts: { count?: "exact"; head?: boolean } = {}) {
    this.selectText = columns;
    if (this.action.kind !== "select") this.returning = true;
    if (opts.count) {
      if (opts.count !== "exact") throw new Error(`Unsupported count: ${opts.count}`);
      this.countMode = "exact";
    }
    this.head = Boolean(opts.head);
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    this.action = { kind: "insert", rows: Array.isArray(values) ? values : [values] };
    return this;
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    opts: { onConflict?: string; ignoreDuplicates?: boolean } = {},
  ) {
    const onConflict = (opts.onConflict ?? TABLES[this.table].key.join(",")).split(",").map((c) => c.trim());
    this.action = {
      kind: "upsert",
      rows: Array.isArray(values) ? values : [values],
      onConflict,
      ignoreDuplicates: Boolean(opts.ignoreDuplicates),
    };
    return this;
  }

  update(patch: Record<string, unknown>) {
    this.action = { kind: "update", patch };
    return this;
  }

  delete() {
    this.action = { kind: "delete" };
    return this;
  }

  // --- filters -------------------------------------------------------------

  private push(column: string, op: Op, value: unknown) {
    const { path, column: col } = splitPath(column);
    this.filters.push({ path, column: col, op, value });
    return this;
  }

  eq(column: string, value: unknown) { return this.push(column, "eq", value); }
  neq(column: string, value: unknown) { return this.push(column, "neq", value); }
  gt(column: string, value: unknown) { return this.push(column, "gt", value); }
  gte(column: string, value: unknown) { return this.push(column, "gte", value); }
  lt(column: string, value: unknown) { return this.push(column, "lt", value); }
  lte(column: string, value: unknown) { return this.push(column, "lte", value); }
  is(column: string, value: null | boolean) { return this.push(column, "is", value); }
  in(column: string, values: readonly unknown[]) { return this.push(column, "in", [...values]); }
  /** Not in the list (NOT IN; a NULL column never matches, as in Postgres). */
  notIn(column: string, values: readonly unknown[]) { return this.push(column, "nin", [...values]); }
  like(column: string, pattern: string) { return this.push(column, "like", pattern); }
  ilike(column: string, pattern: string) { return this.push(column, "ilike", pattern); }

  match(query: Record<string, unknown>) {
    for (const [k, v] of Object.entries(query)) this.eq(k, v);
    return this;
  }

  or(text: string, opts: { referencedTable?: string } = {}) {
    if (opts.referencedTable) throw new Error("Unsupported or() on a referenced table");
    this.filters.push({ or: parseOr(text) });
    return this;
  }

  // --- shaping -------------------------------------------------------------

  order(column: string, opts: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string; foreignTable?: string } = {}) {
    this.orders.push({
      column,
      ascending: opts.ascending ?? true,
      nullsFirst: opts.nullsFirst,
      referencedTable: opts.referencedTable ?? opts.foreignTable,
    });
    return this;
  }

  limit(n: number, opts: { referencedTable?: string; foreignTable?: string } = {}) {
    this.limits.set(opts.referencedTable ?? opts.foreignTable ?? "", n);
    return this;
  }

  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  maybeSingle<R = Row<T>>() {
    this.singleMode = "maybe";
    return this as unknown as QueryBuilder<R | null>;
  }

  single<R = Row<T>>() {
    this.singleMode = "single";
    return this as unknown as QueryBuilder<R>;
  }

  returns<R>() {
    return this as unknown as QueryBuilder<R>;
  }

  abortSignal() {
    return this;
  }

  then<A = Result<T>, B = never>(
    onfulfilled?: ((value: Result<T>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }

  // --- execution -----------------------------------------------------------

  private get viewer(): MaybeViewer {
    return this.principal.kind === "user" ? this.principal.viewer : null;
  }

  private get service() {
    return this.principal.kind === "service";
  }

  private scope(table: TableName, alias: string): Sql {
    if (this.service) return { sql: "1", params: [] };
    return readScopeFor(table, this.viewer, alias);
  }

  async execute(): Promise<Result<T>> {
    try {
      if (this.action.kind !== "select" && this.viewer?.readOnly) throw new Denied("Sponsor mode is read-only");
      switch (this.action.kind) {
        case "select":
          return await this.runSelect();
        case "insert":
        case "upsert":
          return await this.runInsert();
        case "update":
          return await this.runUpdate();
        case "delete":
          return await this.runDelete();
      }
    } catch (e) {
      return fail(e);
    }
  }

  private mainWhere(alias: string, extra: Sql[] = []): Sql {
    const parts: Sql[] = [this.scope(this.table, alias), ...extra];
    const own = this.filters.filter((f) => "or" in f || f.path.length === 0);
    for (const f of own) parts.push(filterSql(this.table, alias, f));
    const tree = this.selectText ? parseSelect(this.selectText) : null;
    for (const inner of this.innerJoins(tree)) parts.push(inner);
    return {
      sql: parts.map((p) => `(${p.sql})`).join(" AND "),
      params: parts.flatMap((p) => p.params),
    };
  }

  /** `!inner` embeds, and their filters, as EXISTS clauses so paging stays right. */
  private innerJoins(tree: SelectNode | null): Sql[] {
    if (!tree) return [];
    const out: Sql[] = [];
    let n = 0;
    const walk = (parent: TableName, parentAlias: string, node: SelectNode, path: string[]): Sql | null => {
      const clauses: Sql[] = [];
      for (const e of node.embeds) {
        const embedPath = [...path, e.alias + (e.hint ? `!${e.hint}` : "")];
        const rel = resolveEmbed(parent, e.name, e.hint);
        const a = `j${++n}`;
        const parts: Sql[] = [
          { sql: `${a}.${rel.remoteColumn} = ${parentAlias}.${rel.localColumn}`, params: [] },
          this.scope(rel.table, a),
        ];
        for (const f of this.filters) {
          if ("or" in f) continue;
          if (samePath(f.path, embedPath)) parts.push(filterSql(rel.table, a, f));
        }
        const nested = walk(rel.table, a, e, embedPath);
        if (nested) parts.push(nested);
        if (e.inner) {
          clauses.push({
            sql: `EXISTS (SELECT 1 FROM ${rel.table} ${a} WHERE ${parts.map((p) => `(${p.sql})`).join(" AND ")})`,
            params: parts.flatMap((p) => p.params),
          });
        }
      }
      if (clauses.length === 0) return null;
      return { sql: clauses.map((c) => c.sql).join(" AND "), params: clauses.flatMap((c) => c.params) };
    };
    const top = walk(this.table, "t", tree, []);
    if (top) out.push(top);
    return out;
  }

  private orderSql(alias: string) {
    const own = this.orders.filter((o) => !o.referencedTable);
    if (own.length === 0) return "";
    return (
      " ORDER BY " +
      own
        .map((o) => {
          checkColumn(this.table, o.column);
          const dir = o.ascending ? "ASC" : "DESC";
          // Postgres puts NULLs last ascending and first descending by default.
          const nullsFirst = o.nullsFirst ?? !o.ascending;
          const nulls = nullsFirst ? "NULLS FIRST" : "NULLS LAST";
          return `${alias}.${o.column} ${dir} ${nulls}`;
        })
        .join(", ")
    );
  }

  private async runSelect(): Promise<Result<T>> {
    const tree = parseSelect(this.selectText ?? "*");
    validateTree(this.table, tree);
    const where = this.mainWhere("t");
    let count: number | null = null;
    if (this.countMode) {
      const c = await this.db
        .prepare(`SELECT count(*) AS n FROM ${this.table} t WHERE ${where.sql}`)
        .bind(...where.params)
        .first<{ n: number }>();
      count = c?.n ?? 0;
    }
    if (this.head) return ok(null as T, count);

    let sql = `SELECT t.* FROM ${this.table} t WHERE ${where.sql}${this.orderSql("t")}`;
    const params = [...where.params];
    const limit = this.limits.get("");
    if (this.rangeFrom != null && this.rangeTo != null) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(Math.max(0, this.rangeTo - this.rangeFrom + 1), this.rangeFrom);
    } else if (limit != null) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }
    const { results } = await this.db.prepare(sql).bind(...params).all<Record<string, unknown>>();
    const rows = await this.shape(this.table, tree, results, []);
    return this.finish(rows, count);
  }

  private finish(rows: Record<string, unknown>[], count: number | null): Result<T> {
    if (this.singleMode) {
      if (rows.length > 1) {
        return { data: null as T, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116", details: `${rows.length} rows`, hint: null }, count, status: 406, statusText: "Not Acceptable" };
      }
      if (rows.length === 0) {
        if (this.singleMode === "maybe") return ok(null as T, count);
        return { data: null as T, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116", details: "0 rows", hint: null }, count, status: 406, statusText: "Not Acceptable" };
      }
      return ok(rows[0] as T, count);
    }
    return ok(rows as T, count);
  }

  /** Projects columns and fills embeds, recursively. */
  private async shape(
    table: TableName,
    node: SelectNode,
    raw: Record<string, unknown>[],
    path: string[],
  ): Promise<Record<string, unknown>[]> {
    const decoded = raw.map((r) => decodeRow(table, r));
    const out = decoded.map((r) => {
      if (node.columns === "*") return { ...r };
      const o: Record<string, unknown> = {};
      for (const c of node.columns) o[c] = r[c];
      return o;
    });
    for (const e of node.embeds) {
      const rel = resolveEmbed(table, e.name, e.hint);
      const embedPath = [...path, e.alias + (e.hint ? `!${e.hint}` : "")];
      const keys = [...new Set(decoded.map((r) => r[rel.localColumn]).filter((k) => k != null))];
      const fetched: Record<string, unknown>[] = [];
      for (let i = 0; i < keys.length; i += MAX_IN) {
        const chunk = keys.slice(i, i + MAX_IN);
        const parts: Sql[] = [
          { sql: `e.${rel.remoteColumn} IN (${chunk.map(() => "?").join(", ")})`, params: chunk },
          this.scope(rel.table, "e"),
        ];
        for (const f of this.filters) {
          if (!("or" in f) && samePath(f.path, embedPath)) parts.push(filterSql(rel.table, "e", f));
        }
        const order = this.orders.filter((o) => o.referencedTable === e.alias || o.referencedTable === e.name);
        for (const o of order) checkColumn(rel.table, o.column);
        const orderSql = order.length
          ? " ORDER BY " + order.map((o) => `e.${o.column} ${o.ascending ? "ASC" : "DESC"}`).join(", ")
          : "";
        const { results } = await this.db
          .prepare(`SELECT e.* FROM ${rel.table} e WHERE ${parts.map((p) => `(${p.sql})`).join(" AND ")}${orderSql}`)
          .bind(...parts.flatMap((p) => p.params))
          .all<Record<string, unknown>>();
        fetched.push(...results);
      }
      const shaped = await this.shape(rel.table, e, fetched, embedPath);
      const limit = this.limits.get(e.alias) ?? this.limits.get(e.name);
      decoded.forEach((r, idx) => {
        const key = r[rel.localColumn];
        const matches = shaped.filter((_, j) => key != null && fetched[j][rel.remoteColumn] === key);
        out[idx][e.alias] = rel.kind === "one" ? (matches[0] ?? null) : limit != null ? matches.slice(0, limit) : matches;
      });
    }
    return out;
  }

  // --- writes --------------------------------------------------------------

  private context(): WriteContext {
    return { db: this.db, principal: this.principal, now: new Date() };
  }

  private async afterWrite(keys: Record<string, unknown>[]): Promise<Result<T>> {
    if (!this.returning) {
      if (this.singleMode) return ok(null as T);
      return ok(null as T, null, 201);
    }
    if (keys.length === 0) return this.finish([], null);
    // Return what the writer may now read, the way PostgREST's RETURNING does.
    const key = TABLES[this.table].key;
    const rows: Record<string, unknown>[] = [];
    const tree = parseSelect(this.selectText ?? "*");
    for (const k of keys) {
      const parts: Sql[] = [this.scope(this.table, "t"), ...key.map((c) => ({ sql: `t.${c} = ?`, params: [encodeValue(this.table, c, k[c])] }))];
      const { results } = await this.db
        .prepare(`SELECT t.* FROM ${this.table} t WHERE ${parts.map((p) => `(${p.sql})`).join(" AND ")}`)
        .bind(...parts.flatMap((p) => p.params))
        .all<Record<string, unknown>>();
      rows.push(...(await this.shape(this.table, tree, results, [])));
    }
    return this.finish(rows, null);
  }

  private async runInsert(): Promise<Result<T>> {
    const info = TABLES[this.table];
    if (info.readOnly) throw new Error(`Unsupported write to ${this.table}`);
    const action = this.action as Extract<Action, { kind: "insert" | "upsert" }>;
    const rules = writeRulesFor(this.table);
    const ctx = this.context();
    const statements: D1PreparedStatement[] = [];
    const keys: Record<string, unknown>[] = [];

    for (const input of action.rows) {
      let row: Record<string, unknown> = { ...input };
      for (const c of Object.keys(row)) checkColumn(this.table, c);
      if (info.generatedId && row.id == null) row.id = crypto.randomUUID();

      let existing: Record<string, unknown> | null = null;
      if (action.kind === "upsert") {
        const conflict = action.onConflict;
        for (const c of conflict) checkColumn(this.table, c);
        existing = await this.db
          .prepare(`SELECT * FROM ${this.table} WHERE ${conflict.map((c) => `${c} = ?`).join(" AND ")}`)
          .bind(...conflict.map((c) => encodeValue(this.table, c, row[c])))
          .first<Record<string, unknown>>();
        if (existing && action.ignoreDuplicates) continue;
      }

      if (existing) {
        const before = decodeRow(this.table, existing);
        const visible = this.service || (await this.inUpdateScope(before));
        if (!visible) throw new Denied();
        const patch = { ...row };
        for (const c of info.key) delete patch[c];
        const finalPatch = await rules.update(ctx, before, patch);
        statements.push(this.updateStatement(before, finalPatch));
        keys.push(pick(before, info.key));
      } else {
        row = await rules.insert(ctx, row);
        const cols = Object.keys(row);
        statements.push(
          this.db
            .prepare(`INSERT INTO ${this.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
            .bind(...cols.map((c) => encodeValue(this.table, c, row[c]))),
        );
        keys.push(pick(row, info.key));
      }
    }
    if (statements.length) await this.db.batch(statements);
    return this.afterWrite(keys);
  }

  private async inUpdateScope(row: Record<string, unknown>) {
    const scope = writeRulesFor(this.table).updateScope(this.context(), "t");
    const key = TABLES[this.table].key;
    const parts: Sql[] = [scope, ...key.map((c) => ({ sql: `t.${c} = ?`, params: [encodeValue(this.table, c, row[c])] }))];
    const hit = await this.db
      .prepare(`SELECT 1 AS ok FROM ${this.table} t WHERE ${parts.map((p) => `(${p.sql})`).join(" AND ")}`)
      .bind(...parts.flatMap((p) => p.params))
      .first();
    return Boolean(hit);
  }

  private updateStatement(before: Record<string, unknown>, patch: Record<string, unknown>) {
    const key = TABLES[this.table].key;
    const cols = Object.keys(patch);
    if (cols.length === 0) {
      return this.db.prepare(`SELECT 1`);
    }
    return this.db
      .prepare(
        `UPDATE ${this.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${key.map((c) => `${c} = ?`).join(" AND ")}`,
      )
      .bind(
        ...cols.map((c) => encodeValue(this.table, c, patch[c])),
        ...key.map((c) => encodeValue(this.table, c, before[c])),
      );
  }

  /** Rows the filters pick that this principal may change (RLS USING). */
  private async targets(kind: "update" | "delete") {
    const rules = writeRulesFor(this.table);
    const ctx = this.context();
    const scope = this.service
      ? { sql: "1", params: [] }
      : kind === "update"
        ? rules.updateScope(ctx, "t")
        : rules.deleteScope(ctx, "t");
    const where = this.mainWhere("t", [scope]);
    const { results } = await this.db
      .prepare(`SELECT t.* FROM ${this.table} t WHERE ${where.sql}`)
      .bind(...where.params)
      .all<Record<string, unknown>>();
    return results.map((r) => decodeRow(this.table, r));
  }

  private async runUpdate(): Promise<Result<T>> {
    const info = TABLES[this.table];
    if (info.readOnly) throw new Error(`Unsupported write to ${this.table}`);
    const { patch } = this.action as Extract<Action, { kind: "update" }>;
    for (const c of Object.keys(patch)) checkColumn(this.table, c);
    const rules = writeRulesFor(this.table);
    const ctx = this.context();
    const rows = await this.targets("update");
    const statements: D1PreparedStatement[] = [];
    for (const before of rows) {
      const finalPatch = await rules.update(ctx, before, { ...patch });
      statements.push(this.updateStatement(before, finalPatch));
    }
    if (statements.length) await this.db.batch(statements);
    return this.afterWrite(rows.map((r) => pick({ ...r, ...patch }, info.key)));
  }

  private async runDelete(): Promise<Result<T>> {
    const info = TABLES[this.table];
    if (info.readOnly) throw new Error(`Unsupported write to ${this.table}`);
    const rows = await this.targets("delete");
    const rules = writeRulesFor(this.table);
    const ctx = this.context();
    const statements: D1PreparedStatement[] = [];
    for (const row of rows) {
      await rules.remove(ctx, row);
      statements.push(
        this.db
          .prepare(`DELETE FROM ${this.table} WHERE ${info.key.map((c) => `${c} = ?`).join(" AND ")}`)
          .bind(...info.key.map((c) => encodeValue(this.table, c, row[c]))),
      );
    }
    let returned: Record<string, unknown>[] = [];
    if (this.returning) {
      const tree = parseSelect(this.selectText ?? "*");
      returned = await this.shape(this.table, tree, rows, []);
    }
    if (statements.length) await this.db.batch(statements);
    if (!this.returning) return ok(null as T, null, 204);
    return this.finish(returned, null);
  }
}

function samePath(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i] || x.split("!")[0] === b[i]);
}

function pick(row: Record<string, unknown>, cols: string[]) {
  const o: Record<string, unknown> = {};
  for (const c of cols) o[c] = row[c];
  return o;
}

function validateTree(table: TableName, node: SelectNode) {
  if (node.columns !== "*") for (const c of node.columns) checkColumn(table, c);
  for (const e of node.embeds) {
    const rel = resolveEmbed(table, e.name, e.hint);
    validateTree(rel.table, e);
  }
}

// ---------------------------------------------------------------------------
// client
// ---------------------------------------------------------------------------

/** Untyped rows, like supabase-js without generated types: a list of `any`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRows = any[];
/** The row type of a list result, for single() and maybeSingle(). */
export type Row<T> = T extends readonly (infer E)[] ? E : T;

export type RestClient = {
  from<T = AnyRows>(table: string): QueryBuilder<T>;
};

export function createRestClient(db: D1Database, principal: Principal): RestClient {
  return {
    from<T = AnyRows>(table: string) {
      if (!isTable(table)) throw new Error(`Unknown table ${table}`);
      return new QueryBuilder<T>(db, principal, table);
    },
  };
}
