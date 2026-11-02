import Notice from "@/components/Notice";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { Field, GhostButton, PrimaryButton, TextArea, TextInput } from "@/components/Form";
import {
  createTier,
  deactivateTier,
  reactivateTier,
  saveTierCapabilities,
  updateTier,
} from "@/lib/actions/tiers";
import {
  can,
  capValue,
  formatPrice,
  livesOnTier,
  loadCapabilities,
  loadTiers,
  priceDollars,
} from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import type { CapabilityKey } from "@/lib/tiers";
import type { SponsorCapability } from "@/lib/types";

function monotonicWarnings(
  tiers: Awaited<ReturnType<typeof loadTiers>>,
  capabilities: SponsorCapability[],
) {
  const warnings: string[] = [];
  const active = tiers.filter((t) => t.is_active && t.rank > 0);
  for (const cap of capabilities) {
    const key = cap.key as CapabilityKey;
    const granting = active.filter((t) => can(t, key)).sort((a, b) => a.rank - b.rank);
    const missing = active.filter((t) => !can(t, key)).sort((a, b) => b.rank - a.rank);
    const lowestWith = granting[0];
    const highestWithout = missing[0];
    if (highestWithout && lowestWith && highestWithout.rank > lowestWith.rank) {
      warnings.push(
        `${highestWithout.name} does not include “${cap.label}” but the lower ${lowestWith.name} does.`,
      );
    }
  }
  return warnings;
}

export default async function AdminTiersPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [tiers, capabilities, { data: companies }, { data: events }] = await Promise.all([
    loadTiers({ includeInactive: true }),
    loadCapabilities(),
    supabase.from("companies").select("id, sponsor_tier_id, grace_tier_id, tier_grace_until"),
    supabase
      .from("sponsor_tier_events")
      .select("id, kind, created_at, detail, sponsor_tiers(name), companies(name)")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const firmCount = new Map<string, number>();
  for (const c of companies ?? []) {
    for (const tier of tiers) {
      if (
        livesOnTier(
          {
            sponsor_tier_id: c.sponsor_tier_id,
            grace_tier_id: (c.grace_tier_id as string | null) ?? null,
            tier_grace_until: (c.tier_grace_until as string | null) ?? null,
          },
          tier.id,
        )
      ) {
        firmCount.set(tier.id, (firmCount.get(tier.id) ?? 0) + 1);
      }
    }
  }

  const warnings = monotonicWarnings(tiers, capabilities);

  return (
    <>
      <PageHeader kicker="Packages" title="Sponsor tiers">
        Edit the default features, pricing, and delays shared by companies on each tier.
        Company-specific feature overrides take priority over these defaults.
      </PageHeader>
      <Notice message={sp.denied} />
      <p className="mb-8 text-sm text-copy">
        To change access for just one sponsor, use{" "}
        <Link href="/admin/companies" className="text-primary underline">
          company feature overrides
        </Link>.
      </p>

      {warnings.length > 0 && (
        <div className="mb-8 border border-primary/20 bg-primary/5 p-4 text-sm text-ink">
          <p className="text-[11px] uppercase tracking-[2px] text-primary">Check the ladder</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="mb-12 border border-line p-5">
        <h2 className="font-heading text-lg font-bold text-ink">New package</h2>
        <p className="mt-1 text-sm text-copy">
          Rank is display order. Leave gaps (15, 25) so a new package can sit between existing ones.
        </p>
        <form action={createTier} className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Name">
            <TextInput name="name" required maxLength={80} />
          </Field>
          <Field label="Rank">
            <TextInput name="rank" type="number" required min={1} placeholder="25" />
          </Field>
          <Field label="Price (CAD, blank if none)">
            <TextInput name="price" inputMode="decimal" placeholder="2500" />
          </Field>
          <div className="md:col-span-2">
            <Field label="Blurb">
              <TextArea name="blurb" rows={2} maxLength={400} />
            </Field>
          </div>
          <div>
            <PrimaryButton type="submit">Create package</PrimaryButton>
          </div>
        </form>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {tiers.map((tier) => {
          const n = firmCount.get(tier.id) ?? 0;
          return (
            <article key={tier.id} className="border border-line p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-heading text-xl font-bold text-ink">{tier.name}</h2>
                <p className="text-xs uppercase tracking-wider text-muted">
                  {formatPrice(tier.price_cents)} · rank {tier.rank}
                  {tier.is_system ? " · system" : ""}
                  {!tier.is_active ? " · inactive" : ""}
                  {n ? ` · ${n} ${n === 1 ? "firm" : "firms"}` : ""}
                </p>
              </div>
              {tier.blurb && <p className="mt-2 text-sm text-copy">{tier.blurb}</p>}

              <form action={updateTier} className="mt-4 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="tier_id" value={tier.id} />
                <Field label="Name">
                  <TextInput name="name" required defaultValue={tier.name} maxLength={80} />
                </Field>
                <Field label="Rank">
                  <TextInput
                    name="rank"
                    type="number"
                    required
                    min={tier.key === "none" ? 0 : 1}
                    defaultValue={tier.rank}
                  />
                </Field>
                <Field label="Price (CAD)">
                  <TextInput
                    name="price"
                    inputMode="decimal"
                    defaultValue={priceDollars(tier.price_cents)}
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Blurb">
                    <TextArea name="blurb" rows={2} maxLength={400} defaultValue={tier.blurb} />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-3 md:col-span-2">
                  <PrimaryButton type="submit">Save package</PrimaryButton>
                </div>
              </form>

              {!tier.is_system && (
                <form action={tier.is_active ? deactivateTier : reactivateTier} className="mt-3">
                  <input type="hidden" name="tier_id" value={tier.id} />
                  {tier.is_active ? (
                    <ConfirmSubmitButton
                      variant="danger"
                      confirmMessage={`Deactivate ${tier.name}? Firms already on it keep it until you move them. It will no longer appear in new assignments.`}
                    >
                      Deactivate package
                    </ConfirmSubmitButton>
                  ) : (
                    <GhostButton type="submit">Reactivate package</GhostButton>
                  )}
                </form>
              )}

              <form action={saveTierCapabilities} className="mt-6 border-t border-line pt-4">
                <input type="hidden" name="tier_id" value={tier.id} />
                <p className="text-[11px] uppercase tracking-[2px] text-copy">Tier default features</p>
                <p className="mt-2 text-xs text-muted">
                  Applies to companies following this tier. Explicit company overrides stay in place.
                </p>
                <ul className="mt-3 space-y-3">
                  {capabilities.map((cap) => {
                    const granted = can(tier, cap.key as CapabilityKey);
                    const value = capValue(tier, cap.key as CapabilityKey);
                    return (
                      <li key={cap.key}>
                        <label className="flex items-start gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            name={`grant_${cap.key}`}
                            defaultChecked={granted}
                            className="mt-1 h-4 w-4"
                          />
                          <span>
                            <span className="text-ink">{cap.label}</span>
                            {!cap.is_enforced && (
                              <span className="ml-2 text-[10px] uppercase tracking-wider text-muted">
                                commitment only
                              </span>
                            )}
                            <span className="mt-0.5 block text-xs text-muted">
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
                {n > 0 && (
                  <label className="mt-4 flex items-start gap-2 text-sm text-copy">
                    <input type="checkbox" name="confirmed" className="mt-1 h-4 w-4" />
                    <span>
                      I understand this can remove access from {n}{" "}
                      {n === 1 ? "firm" : "firms"} already on {tier.name}.
                    </span>
                  </label>
                )}
                <div className="mt-4">
                  <PrimaryButton type="submit">Save features</PrimaryButton>
                </div>
              </form>
            </article>
          );
        })}
      </div>

      <section className="mt-14">
        <h2 className="font-heading text-lg font-bold text-ink">Recent changes</h2>
        {!(events ?? []).length ? (
          <p className="mt-3 text-sm text-copy">No edits yet.</p>
        ) : (
          <ul className="mt-4">
            {(events ?? []).map((e) => {
              const tierName = Array.isArray(e.sponsor_tiers)
                ? e.sponsor_tiers[0]?.name
                : (e.sponsor_tiers as { name: string } | null)?.name;
              const companyName = Array.isArray(e.companies)
                ? e.companies[0]?.name
                : (e.companies as { name: string } | null)?.name;
              return (
                <li key={e.id} className="border-t border-line py-3 text-sm text-copy">
                  <span className="text-ink">{e.kind.replaceAll("_", " ")}</span>
                  {tierName ? ` · ${tierName}` : ""}
                  {companyName ? ` · ${companyName}` : ""}
                  <span className="ml-2 text-xs text-muted">
                    {new Date(e.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
