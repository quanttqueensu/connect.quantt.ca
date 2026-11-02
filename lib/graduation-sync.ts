import type { D1Database } from "@/lib/db/d1";

/**
 * Grad year and personal email, kept in step with auth.quantt.ca.
 *
 * auth.quantt.ca stores both: it graduates members to alumni on May 1 of their
 * grad year (lib/alumni/graduates.ts) and the alumni account goes to the
 * personal email. Members can set them on their Connect profile or under
 * "Your profile" on auth.quantt.ca:
 *
 *  - Saving the Connect profile saves both to auth straight away.
 *  - The personal email is only ever read from auth, so it is always current.
 *  - The grad year is copied back here from auth when a member opens their
 *    profile and hourly (worker.js), so a change on auth shows up here. A grad
 *    year that exists only here (entered before this sync) is sent to auth.
 */
export type Graduation = { id: string; gradYear: number | null; personal: string | null };
export type GraduationAuth = {
  graduation?(email: string): Promise<Graduation | null>;
  setGraduation?(email: string, fields: { gradYear?: number | null; personal?: string | null }): Promise<unknown>;
};

/** Brings one member's grad year in line with auth. Returns auth's record (with the personal email), or null. */
export async function syncGradYear(db: D1Database, auth: GraduationAuth | undefined, profileId: string, email: string, gradYear: number | null) {
  if (!auth?.graduation) return null;
  const g = await auth.graduation(email);
  if (!g) return null;
  if (g.gradYear && g.gradYear !== gradYear) {
    await db.prepare(`UPDATE profiles SET grad_year = ? WHERE id = ? AND role = 'member'`).bind(g.gradYear, profileId).run();
  } else if (!g.gradYear && gradYear && auth.setGraduation) {
    await auth.setGraduation(email, { gradYear });
    return { ...g, gradYear };
  }
  return g;
}

/** The hourly pass: every member profile. */
export async function syncAllGradYears(db: D1Database, auth: GraduationAuth | undefined) {
  if (!auth?.graduation) return null;
  const { results } = await db
    .prepare(`SELECT id, email, grad_year FROM profiles WHERE role = 'member'`)
    .all<{ id: string; email: string; grad_year: number | null }>();
  let checked = 0, failed = 0;
  for (const p of results ?? []) {
    try { await syncGradYear(db, auth, p.id, p.email, p.grad_year); checked++; } catch { failed++; }
  }
  return { checked, failed };
}
