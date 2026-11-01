import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import CopyLink from "@/components/CopyLink";
import { Field, GhostButton, PrimaryButton, TextInput, buttonClass } from "@/components/Form";
import { resetCompanyAccess, setCompanyAccess, setCompanyTier } from "@/lib/actions/admin";
import {
  can,
  capValue,
  graceIsOpen,
  liveCan,
  loadCapabilities,
  loadTiers,
  overrideFor,
  resolveAccess,
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
  searchParams: Promise<{ denied?: string }>;
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
        Assign a sponsorship level to each firm, then grant or revoke hub features for that firm.
        Company contacts never see the member feed — only their own posts and the products you turn
        on.
      </PageHeader>
      <Notice message={sp.denied} />
      <div className="mb-6">
        <Link href="/admin/invite?kind=company" className={buttonClass("primary")}>
          Invite a company contact
        </Link>
      </div>
      <div className="mb-10 border border-white/10 p-5">
        <p className="text-[11px] uppercase tracking-[2px] text-white/60">Public signup link</p>
        <p className="mt-2 text-sm text-white/60">
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
          const access = resolveAccess(assigned, effective, overrides);
          return (
            <article key={c.id} className="border border-white/10 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-heading text-xl font-bold text-white">{c.name}</h2>
                <p className="text-xs uppercase tracking-wider text-white/50">
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
              <p className="mt-2 text-xs text-white/50">
                Inactive firms stay off the member directory. Hub products stay off until you set
                them active again. Changing the level does not clear custom grants below.
              </p>

              <form action={setCompanyAccess} className="mt-6 border-t border-white/10 pt-4">
                <input type="hidden" name="company_id" value={c.id} />
                <p className="text-[11px] uppercase tracking-[2px] text-white/60">
                  Hub access for this firm
                </p>
                <p className="mt-1 text-sm text-white/55">
                  Checkboxes start from {assigned?.name ?? "the assigned level"}. Tick extras or
                  untick features for this sponsor only — they still cannot browse the member feed.
                </p>
                {c.status === "inactive" && (
                  <p className="mt-3 border border-blue-light/30 bg-blue-light/10 p-3 text-sm text-white/80">
                    This firm is inactive, so these products are off for their contacts right now.
                  </p>
                )}
                <ul className="mt-4 space-y-3">
                  {capabilities.map((cap) => {
                    const key = cap.key as CapabilityKey;
                    const granted = can(access, key);
                    const value = capValue(access, key);
                    const onPackage = liveCan(assigned, effective, key);
                    const custom = overrideFor(overrides, key);
                    return (
                      <li key={cap.key}>
                        <label className="flex items-start gap-2 text-sm text-white/80">
                          <input
                            type="checkbox"
                            name={`grant_${cap.key}`}
                            defaultChecked={granted}
                            className="mt-1 h-4 w-4"
                          />
                          <span>
                            <span className="text-white">{cap.label}</span>
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-white/40">
                              {custom
                                ? custom.granted
                                  ? "added for this firm"
                                  : "removed for this firm"
                                : onPackage
                                  ? "in package"
                                  : "not in package"}
                            </span>
                            <span className="mt-0.5 block text-xs text-white/50">
                              {cap.description}
                            </span>
                          </span>
                        </label>
                        {cap.kind === "quota" && (
                          <div className="ml-6 mt-2">
                            <Field label="Open in-app jobs (blank = unlimited)">
                              <TextInput
                                name={`value_${cap.key}`}
                                inputMode="numeric"
                                defaultValue={value == null ? "" : String(value)}
                                placeholder="unlimited"
                              />
                            </Field>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-4">
                  <PrimaryButton type="submit">Save access</PrimaryButton>
                </div>
              </form>

              {overrides.length > 0 && (
                <form action={resetCompanyAccess} className="mt-3">
                  <input type="hidden" name="company_id" value={c.id} />
                  <GhostButton type="submit">Reset to package</GhostButton>
                </form>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
