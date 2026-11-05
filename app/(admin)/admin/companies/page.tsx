import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import CopyLink from "@/components/CopyLink";
import CompanyCapabilityControl from "@/components/CompanyCapabilityControl";
import { Field, GhostButton, PrimaryButton, TextInput, buttonClass } from "@/components/Form";
import { addCompany, resetCompanyAccess, setCompanyAccess, setCompanyTier } from "@/lib/actions/admin";
import {
  graceIsOpen,
  liveCan,
  loadCapabilities,
  loadTiers,
  overrideFor,
  packageValue,
  type CapabilityKey,
} from "@/lib/tiers";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import type { Company, CompanyCapabilityOverride } from "@/lib/types";
import { formatDate } from "@/lib/time";
import Link from "next/link";

type CompanyRow = Company;

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; added?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: companies }, tiers, capabilities, { data: overrideRows }] = await Promise.all([
    supabase.from("companies").select("*").order("name"),
    loadTiers({ includeInactive: true }),
    loadCapabilities(),
    supabase.from("company_capability_overrides").select("*"),
  ]);

  const overridesByCompany = new Map<string, CompanyCapabilityOverride[]>();
  for (const row of (overrideRows as CompanyCapabilityOverride[] | null) ?? []) {
    const list = overridesByCompany.get(row.company_id) ?? [];
    list.push(row);
    overridesByCompany.set(row.company_id, list);
  }

  return (
    <>
      <PageHeader kicker="Firms" title="Companies">
        Assign a sponsor tier, then customize features for individual companies.
        Company overrides take priority over tier defaults and stay in place when the tier changes.
      </PageHeader>
      <Notice message={sp.denied} />
      <div className="mb-6 flex flex-wrap gap-3">
        <Link href="/admin/invite?kind=company" className={buttonClass("primary")}>
          Invite a company contact
        </Link>
        <Link href="/admin/tiers" className={buttonClass("ghost")}>
          Edit tier defaults
        </Link>
      </div>
      {sp.added && (
        <p className="mb-6 border-l-2 border-primary pl-4 text-sm text-copy">
          Company added. Invite a contact whenever you&rsquo;re ready.
        </p>
      )}
      <details className="mb-6 border border-line p-5" open={Boolean(sp.denied?.startsWith("company_"))}>
        <summary className="cursor-pointer font-heading text-lg font-bold text-ink">Add a company</summary>
        <p className="mt-2 text-sm text-copy">No contact needed. Invite people to it later from Invite someone.</p>
        <form action={addCompany} className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Company name">
            <TextInput name="name" required maxLength={120} />
          </Field>
          <Field label="Sponsorship level">
            <select name="sponsor_tier_id" required defaultValue="" className="w-full rounded px-3 py-2 text-sm">
              <option value="" disabled>Choose a level</option>
              {tiers
                .filter((t) => t.is_active)
                .map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
            </select>
          </Field>
          <Field label="Website (optional)">
            <TextInput name="website" type="url" placeholder="https://" />
          </Field>
          <Field label="Logo URL (optional)">
            <TextInput name="logo_url" type="url" placeholder="https://" />
          </Field>
          <div>
            <PrimaryButton type="submit">Add company</PrimaryButton>
          </div>
        </form>
      </details>
      <div className="mb-10 border border-line p-5">
        <p className="text-[11px] uppercase tracking-[2px] text-copy">Public signup link</p>
        <p className="mt-2 text-sm text-copy">
          Firms can request access here. You approve them under Join requests, or invite a contact
          directly.
        </p>
        <div className="mt-3">
          <CopyLink value={`${siteUrl()}/join`} />
        </div>
      </div>
      <div className="space-y-8">
        {(companies as CompanyRow[] | null)?.map((c) => {
          const assigned = tiers.find((t) => t.id === c.sponsor_tier_id) ?? null;
          const grace = graceIsOpen(c.tier_grace_until);
          const effective =
            grace && c.grace_tier_id
              ? (tiers.find((t) => t.id === c.grace_tier_id) ?? assigned)
              : assigned;
          const overrides = overridesByCompany.get(c.id) ?? [];
          return (
            <article key={c.id} id={`company-${c.id}`} className="scroll-mt-6 border border-line p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-heading text-xl font-bold text-ink">{c.name}</h2>
                <p className="text-xs uppercase tracking-wider text-muted">
                  {assigned?.name ?? "unassigned"} · {c.status}
                  {grace && c.tier_grace_until
                    ? ` · grandfathered until ${formatDate(`${c.tier_grace_until}T12:00:00`)}`
                    : ""}
                  {overrides.length ? ` · ${overrides.length} custom` : ""}
                </p>
              </div>

              <form action={setCompanyTier} className="mt-4 grid gap-3 md:grid-cols-3">
                <input type="hidden" name="company_id" value={c.id} />
                <Field label="Sponsorship level">
                  <select
                    name="sponsor_tier_id"
                    defaultValue={c.sponsor_tier_id}
                    aria-label={`Level for ${c.name}`}
                    className="w-full rounded px-3 py-2 text-sm"
                  >
                    {tiers
                      .filter((t) => t.is_active || t.id === c.sponsor_tier_id)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {!t.is_active ? " (inactive)" : ""}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Firm status">
                  <select
                    name="status"
                    defaultValue={c.status}
                    aria-label={`Status for ${c.name}`}
                    className="w-full rounded px-3 py-2 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </Field>
                <div className="flex items-end">
                  <PrimaryButton type="submit">Save level &amp; status</PrimaryButton>
                </div>
              </form>
              <p className="mt-2 text-xs text-muted">
                Inactive firms stay off the member directory. Connect features stay off until you set
                them active again. Changing the level does not clear custom grants below.
              </p>

              <form action={setCompanyAccess} className="mt-6 border-t border-line pt-4">
                <input type="hidden" name="company_id" value={c.id} />
                <p className="text-[11px] uppercase tracking-[2px] text-copy">
                  Company feature overrides
                </p>
                <p className="mt-1 text-sm text-muted">
                  Follow tier uses {assigned?.name ?? "the assigned tier"} defaults and any current
                  grandfathered access. Enable or disable a feature to keep an exception for {c.name}
                  only. Other companies on this tier are unaffected.
                </p>
                {c.status === "inactive" && (
                  <p className="mt-3 border border-primary/20 bg-primary/5 p-3 text-sm text-ink">
                    This firm is inactive, so these products are off for their contacts right now.
                  </p>
                )}
                <ul className="mt-4 space-y-3">
                  {capabilities.map((cap) => {
                    const key = cap.key as CapabilityKey;
                    const custom = overrideFor(overrides, key);
                    const inherited = liveCan(assigned, effective, key);
                    const inheritedValue = packageValue(assigned, effective, key);
                    return (
                      <CompanyCapabilityControl
                        key={`${cap.key}:${custom?.granted ?? "inherit"}:${custom?.value}:${inherited}:${inheritedValue}`}
                        capability={cap}
                        companyName={c.name}
                        inherited={inherited}
                        inheritedValue={inheritedValue}
                        override={custom}
                      />
                    );
                  })}
                </ul>
                <div className="mt-4">
                  <PrimaryButton type="submit">Save company overrides</PrimaryButton>
                </div>
              </form>

              {overrides.length > 0 && (
                <form action={resetCompanyAccess} className="mt-3">
                  <input type="hidden" name="company_id" value={c.id} />
                  <GhostButton type="submit">Reset all features to tier defaults</GhostButton>
                </form>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
