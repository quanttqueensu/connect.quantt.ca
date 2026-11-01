/**
 * The slice of Cloudflare's D1 API this app uses. Typed here (not imported
 * from @cloudflare/workers-types) so tests can pass an in-memory SQLite
 * adapter with the same shape.
 */

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Runs the statements in one transaction: all apply or none do. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export function nowIso(now = new Date()) {
  return now.toISOString();
}
