/** Loads a firm's access and a signed-in viewer from D1. */

import { resolveCompanyAccess, type CompanyAccess } from "@/lib/db/access";
import type { D1Database } from "@/lib/db/d1";
import type { Role, Viewer } from "@/lib/db/policies";

export async function loadCompanyAccess(
  db: D1Database,
  companyId: string,
  now = new Date(),
): Promise<CompanyAccess | null> {
  const company = await db
    .prepare(`SELECT id, status, sponsor_tier_id, grace_tier_id, tier_grace_until FROM companies WHERE id = ?`)
    .bind(companyId)
    .first<{ id: string; status: string; sponsor_tier_id: string; grace_tier_id: string | null; tier_grace_until: string | null }>();
  if (!company) return null;
  const tierIds = [company.sponsor_tier_id, company.grace_tier_id ?? company.sponsor_tier_id];
  const [tiers, caps, overrides] = await db.batch([
    db
      .prepare(`SELECT id, applicant_embargo_hours, resume_book_embargo_hours FROM sponsor_tiers WHERE id IN (?, ?)`)
      .bind(...tierIds),
    db.prepare(`SELECT tier_id, capability, value FROM sponsor_tier_capabilities WHERE tier_id IN (?, ?)`).bind(...tierIds),
    db.prepare(`SELECT capability, granted, value FROM company_capability_overrides WHERE company_id = ?`).bind(companyId),
  ]);
  return resolveCompanyAccess(
    {
      company,
      tiers: tiers.results as { id: string; applicant_embargo_hours: number; resume_book_embargo_hours: number }[],
      tierCapabilities: caps.results as { tier_id: string; capability: string; value: number | null }[],
      overrides: overrides.results as { capability: string; granted: number; value: number | null }[],
    },
    now,
  );
}

export async function loadViewer(
  db: D1Database,
  profile: { id: string; role: Role; is_admin: number | boolean; company_id: string | null },
  now = new Date(),
): Promise<Viewer> {
  return {
    id: profile.id,
    role: profile.role,
    isAdmin: Boolean(profile.is_admin),
    companyId: profile.company_id,
    access: profile.company_id ? await loadCompanyAccess(db, profile.company_id, now) : null,
    now,
  };
}
