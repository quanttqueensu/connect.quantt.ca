import { createClient } from "@/lib/supabase/server";
import type {
  CompanyCapabilityOverride,
  SponsorCapability,
  SponsorTier,
  SponsorTierCapability,
} from "@/lib/types";

export const CAPABILITY_KEYS = [
  "post_in_app_job",
  "read_applicants",
  "dm_initiate_applicant",
  "post_event",
  "resume_book",
  "candidate_search",
  "dm_initiate_any",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type TierWithCaps = SponsorTier & {
  sponsor_tier_capabilities: SponsorTierCapability[];
};

export function isCapabilityKey(value: string): value is CapabilityKey {
  return (CAPABILITY_KEYS as readonly string[]).includes(value);
}

export function can(tier: TierWithCaps | null | undefined, key: CapabilityKey) {
  return Boolean(tier?.sponsor_tier_capabilities?.some((c) => c.capability === key));
}

/** Assigned package or still-live grandfathered package. */
export function liveCan(
  assigned: TierWithCaps | null | undefined,
  effective: TierWithCaps | null | undefined,
  key: CapabilityKey,
) {
  return can(assigned, key) || can(effective, key);
}

export function liveTier(
  assigned: TierWithCaps | null | undefined,
  effective: TierWithCaps | null | undefined,
  key: CapabilityKey,
) {
  if (can(effective, key)) return effective ?? null;
  if (can(assigned, key)) return assigned ?? null;
  return assigned ?? effective ?? null;
}

export function capValue(tier: TierWithCaps | null | undefined, key: CapabilityKey) {
  return tier?.sponsor_tier_capabilities?.find((c) => c.capability === key)?.value ?? null;
}

export function packageValue(
  assigned: TierWithCaps | null | undefined,
  effective: TierWithCaps | null | undefined,
  key: CapabilityKey,
) {
  if (can(assigned, key)) return capValue(assigned, key);
  if (can(effective, key)) return capValue(effective, key);
  return null;
}

export function overrideFor(
  overrides: Pick<CompanyCapabilityOverride, "capability" | "granted" | "value">[],
  key: CapabilityKey,
) {
  return overrides.find((o) => o.capability === key) ?? null;
}

/** True when this cap is only live because of grandfathering, not an admin override. */
export function graceOnlyCap(
  assigned: TierWithCaps | null | undefined,
  effective: TierWithCaps | null | undefined,
  overrides: Pick<CompanyCapabilityOverride, "capability">[],
  key: CapabilityKey,
) {
  if (overrides.some((o) => o.capability === key)) return false;
  return Boolean(assigned && !can(assigned, key) && can(effective, key));
}

/**
 * What this firm can actually do: assigned ∪ grace, then per-firm overrides.
 * Embargo hours come from the still-live package (grace, else assigned).
 */
export function resolveAccess(
  assigned: TierWithCaps | null,
  effective: TierWithCaps | null,
  overrides: Pick<CompanyCapabilityOverride, "capability" | "granted" | "value">[],
): TierWithCaps | null {
  const base = effective ?? assigned;
  if (!base) return null;
  const caps = new Map<string, number | null>();
  for (const c of effective?.sponsor_tier_capabilities ?? []) {
    caps.set(c.capability, c.value);
  }
  for (const c of assigned?.sponsor_tier_capabilities ?? []) {
    caps.set(c.capability, c.value);
  }
  for (const o of overrides) {
    if (o.granted) caps.set(o.capability, o.value);
    else caps.delete(o.capability);
  }
  return {
    ...base,
    sponsor_tier_capabilities: [...caps.entries()].map(([capability, value]) => ({
      tier_id: base.id,
      capability,
      value,
    })),
  };
}

export function lowestTierWith(tiers: TierWithCaps[], key: CapabilityKey) {
  return (
    [...tiers]
      .filter((t) => t.is_active && t.rank > 0 && can(t, key))
      .sort((a, b) => a.rank - b.rank)[0] ?? null
  );
}

export function graceIsOpen(until: string | null | undefined) {
  if (!until) return false;
  return until >= new Date().toISOString().slice(0, 10);
}

/**
 * Resume-book delay hours, matching `my_resume_book_embargo_hours()` in
 * 0011: assigned package if that package includes the book, otherwise the
 * still-live (grace, else assigned) package. Applicant embargo stays on
 * the effective package — do not reuse this for that column.
 */
export function resumeBookDelayHours(
  assigned: TierWithCaps | null | undefined,
  effective: TierWithCaps | null | undefined,
) {
  if (can(assigned, "resume_book")) return assigned?.resume_book_embargo_hours ?? 0;
  return (effective ?? assigned)?.resume_book_embargo_hours ?? 0;
}

/** True if this firm's live access is `tierId` (assigned, or still in grace on it). */
export function livesOnTier(
  company: {
    sponsor_tier_id: string;
    grace_tier_id: string | null;
    tier_grace_until?: string | null;
  },
  tierId: string,
) {
  if (company.sponsor_tier_id === tierId) return true;
  return company.grace_tier_id === tierId && graceIsOpen(company.tier_grace_until);
}

export function priceDollars(cents: number | null) {
  if (cents == null) return "";
  if (cents % 100 === 0) return String(cents / 100);
  return (cents / 100).toFixed(2);
}

export function formatPrice(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export async function loadCapabilities(): Promise<SponsorCapability[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sponsor_capabilities")
    .select("*")
    .order("sort_order");
  return (data as SponsorCapability[] | null) ?? [];
}

export async function loadTiers(opts: { includeInactive?: boolean } = {}): Promise<TierWithCaps[]> {
  const supabase = await createClient();
  let query = supabase
    .from("sponsor_tiers")
    .select("*, sponsor_tier_capabilities(*)")
    .order("rank");
  if (!opts.includeInactive) query = query.eq("is_active", true);
  const { data } = await query;
  return (data as TierWithCaps[] | null) ?? [];
}

export async function loadMyCompanyTier(companyId: string) {
  const supabase = await createClient();
  const [{ data: company }, { data: overrideRows }] = await Promise.all([
    supabase
      .from("companies")
      .select("sponsor_tier_id, grace_tier_id, tier_grace_until, status")
      .eq("id", companyId)
      .maybeSingle(),
    supabase
      .from("company_capability_overrides")
      .select("capability, granted, value")
      .eq("company_id", companyId),
  ]);
  const empty = {
    assigned: null as TierWithCaps | null,
    effective: null as TierWithCaps | null,
    access: null as TierWithCaps | null,
    overrides: [] as Pick<CompanyCapabilityOverride, "capability" | "granted" | "value">[],
    graceUntil: null as string | null,
    status: null as string | null,
  };
  if (!company) return empty;

  const tiers = await loadTiers({ includeInactive: true });
  const assigned = tiers.find((t) => t.id === company.sponsor_tier_id) ?? null;
  const graceOpen = graceIsOpen(company.tier_grace_until as string | null);
  const effective =
    graceOpen && company.grace_tier_id
      ? (tiers.find((t) => t.id === company.grace_tier_id) ?? assigned)
      : assigned;
  const overrides = (overrideRows ?? []) as Pick<
    CompanyCapabilityOverride,
    "capability" | "granted" | "value"
  >[];
  const merged = resolveAccess(assigned, effective, overrides);
  const withBookDelay = merged
    ? { ...merged, resume_book_embargo_hours: resumeBookDelayHours(assigned, effective) }
    : null;
  const access =
    company.status === "active"
      ? withBookDelay
      : withBookDelay
        ? { ...withBookDelay, sponsor_tier_capabilities: [] }
        : null;
  return {
    assigned,
    effective,
    access,
    overrides,
    graceUntil: company.tier_grace_until as string | null,
    status: company.status as string,
  };
}
