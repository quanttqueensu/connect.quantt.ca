import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import CopyLink from "@/components/CopyLink";
import CompanyCapabilityControl from "@/components/CompanyCapabilityControl";
import { Field, GhostButton, PrimaryButton, TextInput, buttonClass } from "@/components/Form";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { addCompany, removeContact, resetCompanyAccess, setCompanyAccess, setCompanyTier } from "@/lib/actions/admin";
import { hubEnv } from "@/lib/hub/env";
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
  searchParams: Promise<{ denied?: string; added?: string; removed?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: companies }, tiers, capabilities, { data: overrideRows }] = await Promise.all([
    supabase.from("companies").select("*").order("name"),
    loadTiers({ includeInactive: true }),
    loadCapabilities(),
    supabase.from("company_capability_overrides").select("*"),
  ]);

  const { results: contactRows } = await (await hubEnv()).DB
    .prepare(
      `SELECT cu.company_id, p.id, p.full_name, p.email FROM company_users cu
       JOIN profiles p ON p.id = cu.profile_id ORDER BY p.full_name`,
    )
    .all<{ company_id: string; id: string; full_name: string; email: string }>();
  const contactsByCompany = new Map<string, { id: string; full_name: string; email: string }[]>();
  for (const row of contactRows ?? []) {
    const list = contactsByCompany.get(row.company_id) ?? [];
    list.push(row);
    contactsByCompany.set(row.company_id, list);
  }

  const overridesByCompany = new Map<string, CompanyCapabilityOverride[]>();
  for (const row of (overrideRows as CompanyCapabilityOverride[] | null) ?? []) {
    const list = overridesByCompany.get(row.company_id) ?? [];
    list.push(row);
    overridesByCompany.set(row.company_id, list);
  }

  return (
    <>
      <PageHeader
        title="Companies"
        actions={
          <>
            <Link href="/admin/invite?kind=company" className={buttonClass("primary")}>
              Invite a company contact
            </Link>
            <Link href="/admin/tiers" className={buttonClass("ghost")}>
              Edit tier defaults
            </Link>
          </>
        }
      >
        Overrides beat tier defaults and stay when the level changes. Inactive firms are hidden and lose their features.
      </PageHeader>
      <Notice message={sp.denied} />
      {sp.removed && (
        <p className="mb-6 border-l-2 border-primary pl-4 text-sm text-copy">
          Contact removed and signed out. Their posts and messages stay with the firm.
        </p>
      )}
      {sp.added && (
        <p className="mb-4 border-l-2 border-primary pl-4 text-sm text-copy">
          Company added. Invite a contact whenever you&rsquo;re ready.
        </p>
      )}
      <details className="group mb-4 border border-line px-4 py-3" open={Boolean(sp.denied?.startsWith("company_"))}>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink">
          <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-90">›</span>
          Add a company
          <span className="font-normal text-muted">no contact needed</span>
        </summary>
        <form action={addCompany} className="mt-3 grid gap-3 md:grid-cols-4">
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
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border border-line px-4 py-3">
        <p className="text-sm text-copy">
          <span className="font-medium text-ink">Public signup link.</span> Requests land in Join requests.
        </p>
        <CopyLink value={`${siteUrl()}/join`} />
      </div>
      <div className="space-y-4">
        {(companies as CompanyRow[] | null)?.map((c) => {
          const assigned = tiers.find((t) => t.id === c.sponsor_tier_id) ?? null;
          const grace = graceIsOpen(c.tier_grace_until);
          const effective =
            grace && c.grace_tier_id
              ? (tiers.find((t) => t.id === c.grace_tier_id) ?? assigned)
              : assigned;
          const overrides = overridesByCompany.get(c.id) ?? [];
          return (
            <article key={c.id} id={`company-${c.id}`} className="scroll-mt-6 border border-line p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-heading text-lg font-bold text-ink">{c.name}</h2>
                <p className="text-xs uppercase tracking-wider text-muted">
                  {assigned?.name ?? "unassigned"} · {c.status}
                  {grace && c.tier_grace_until
                    ? ` · grandfathered until ${formatDate(`${c.tier_grace_until}T12:00:00`)}`
                    : ""}
                  {overrides.length ? ` · ${overrides.length} custom` : ""}
                </p>
              </div>

              <div className="mt-3">
                <p className="text-[11px] uppercase tracking-[2px] text-copy">Contacts</p>
                {(contactsByCompany.get(c.id) ?? []).length === 0 ? (
                  <p className="mt-1 text-sm text-copy">None signed in yet.</p>
                ) : (
                  <ul className="mt-1">
                    {(contactsByCompany.get(c.id) ?? []).map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-1 text-sm text-ink">
                        <span>
                          {p.full_name} <span className="text-copy">{p.email}</span>
                        </span>
                        <form action={removeContact}>
                          <input type="hidden" name="profile_id" value={p.id} />
                          <ConfirmSubmitButton
                            variant="quietDanger"
                            confirmMessage={`Remove ${p.email} from ${c.name}? They're signed out and can't sign in again unless you re-invite them.`}
                          >
                            Remove access
                          </ConfirmSubmitButton>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <form action={setCompanyTier} className="mt-3 grid gap-3 md:grid-cols-3">
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

              <details open={overrides.length > 0} className="group mt-4 border-t border-line pt-3">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink">
                  <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-90">›</span>
                  Feature overrides
                  <span className="font-normal text-muted">
                    {overrides.length ? `${overrides.length} custom` : `following ${assigned?.name ?? "tier"}`}
                  </span>
                </summary>
              <form action={setCompanyAccess} className="mt-3">
                <input type="hidden" name="company_id" value={c.id} />
                <p className="text-xs text-muted">
                  Follow tier uses {assigned?.name ?? "the assigned tier"} defaults, including grandfathered
                  access. Enable or disable to make an exception for {c.name} only.
                </p>
                {c.status === "inactive" && (
                  <p className="mt-3 border border-primary/20 bg-primary/5 p-3 text-sm text-ink">
                    This firm is inactive, so these products are off for their contacts right now.
                  </p>
                )}
                <ul className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
                <div className="mt-3">
                  <PrimaryButton type="submit">Save company overrides</PrimaryButton>
                </div>
              </form>

              {overrides.length > 0 && (
                <form action={resetCompanyAccess} className="mt-3">
                  <input type="hidden" name="company_id" value={c.id} />
                  <GhostButton type="submit">Reset all features to tier defaults</GhostButton>
                </form>
              )}
              </details>
            </article>
          );
        })}
      </div>
    </>
  );
}
