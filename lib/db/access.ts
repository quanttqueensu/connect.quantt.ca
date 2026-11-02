/**
 * What a firm can do right now, resolved once per request from its rows.
 *
 * On Supabase this was a stack of SQL functions called from RLS policies
 * (company_effective_tier_id, company_package_has, company_has_capability,
 * company_capability_value, my_embargo_hours, my_resume_book_embargo_hours).
 * D1 has no RLS, so the same rules live here as plain functions, and
 * lib/db/policies.ts turns them into query filters and write checks.
 * Keep the two in step with supabase/migrations until Supabase is removed.
 */

import type { CapabilityKey } from "@/lib/tiers";

export type AccessTier = {
  id: string;
  applicant_embargo_hours: number;
  resume_book_embargo_hours: number;
};

export type AccessTierCapability = {
  tier_id: string;
  capability: string;
  value: number | null;
};

export type AccessOverride = {
  capability: string;
  granted: boolean | number;
  value: number | null;
};

export type AccessCompany = {
  id: string;
  status: string;
  sponsor_tier_id: string;
  grace_tier_id: string | null;
  tier_grace_until: string | null;
};

export type CompanyAccessRows = {
  company: AccessCompany;
  tiers: AccessTier[];
  tierCapabilities: AccessTierCapability[];
  overrides: AccessOverride[];
};

export type CompanyAccess = {
  companyId: string;
  active: boolean;
  assignedTierId: string;
  effectiveTierId: string;
  /** company_has_capability: firm is active, and an override or either package grants it. */
  has(cap: CapabilityKey): boolean;
  /** company_capability_value: override value, else assigned package, else effective package. */
  value(cap: CapabilityKey): number | null;
  /** my_embargo_hours: from the effective (grace, else assigned) package. */
  applicantEmbargoHours: number;
};

/** YYYY-MM-DD in UTC, the same calendar Postgres current_date used on Supabase. */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function effectiveTierId(company: AccessCompany, now: Date): string {
  if (
    company.tier_grace_until != null &&
    company.tier_grace_until >= utcDate(now) &&
    company.grace_tier_id != null
  ) {
    return company.grace_tier_id;
  }
  return company.sponsor_tier_id;
}

export function resolveCompanyAccess(rows: CompanyAccessRows, now: Date): CompanyAccess {
  const { company } = rows;
  const assignedId = company.sponsor_tier_id;
  const effectiveId = effectiveTierId(company, now);

  const capOf = (tierId: string, cap: string) =>
    rows.tierCapabilities.find((c) => c.tier_id === tierId && c.capability === cap);
  const overrideOf = (cap: string) => rows.overrides.find((o) => o.capability === cap);
  const tierOf = (tierId: string) => rows.tiers.find((t) => t.id === tierId);

  const active = company.status === "active";

  const has = (cap: CapabilityKey) => {
    if (!active) return false;
    const o = overrideOf(cap);
    if (o) return Boolean(o.granted);
    return Boolean(capOf(effectiveId, cap) || capOf(assignedId, cap));
  };

  const value = (cap: CapabilityKey) => {
    const o = overrideOf(cap);
    if (o) return o.granted ? o.value : null;
    const assigned = capOf(assignedId, cap);
    if (assigned) return assigned.value;
    return capOf(effectiveId, cap)?.value ?? null;
  };

  const effectiveTier = tierOf(effectiveId);

  return {
    companyId: company.id,
    active,
    assignedTierId: assignedId,
    effectiveTierId: effectiveId,
    has,
    value,
    applicantEmbargoHours: effectiveTier?.applicant_embargo_hours ?? 0,
  };
}
