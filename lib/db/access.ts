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
};

const TORONTO_DAY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Toronto" });

/** YYYY-MM-DD in Kingston (America/Toronto): a grace date "until Dec 31" lasts through Dec 31 there, not in UTC. */
export function torontoDate(now: Date): string {
  return TORONTO_DAY.format(now);
}

export function effectiveTierId(company: AccessCompany, now: Date): string {
  if (
    company.tier_grace_until != null &&
    company.tier_grace_until >= torontoDate(now) &&
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


  return {
    companyId: company.id,
    active,
    assignedTierId: assignedId,
    effectiveTierId: effectiveId,
    has,
    value,
  };
}
