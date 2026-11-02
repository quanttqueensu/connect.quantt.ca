import { getCompanyContext } from "@/lib/sponsor-mode";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import TierBadge from "@/components/TierBadge";
import { Field, PrimaryButton, TextArea, TextInput } from "@/components/Form";
import { updateCompanyProfile } from "@/lib/actions/company";
import {
  can,
  capValue,
  formatPrice,
  graceIsOpen,
  liveCan,
  loadCapabilities,
  loadMyCompanyTier,
  loadTiers,
  lowestTierWith,
  overrideFor,
} from "@/lib/tiers";
import type { CapabilityKey } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { redirect } from "next/navigation";
import NotificationSettings from "@/components/NotificationSettings";
import { getCurrentProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";
import { DEFAULT_PREFS, getPrefs } from "@/lib/notifications";

export default async function SponsorshipPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; notifications?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const cu = await getCompanyContext();
  if (!cu) redirect("/company");

  const [{ assigned, effective, access, overrides, graceUntil }, capabilities, tiers, { data: company }] =
    await Promise.all([
      loadMyCompanyTier(cu.company_id),
      loadCapabilities(),
      loadTiers(),
      supabase
        .from("companies")
        .select("website, logo_url, description")
        .eq("id", cu.company_id)
        .maybeSingle(),
    ]);

  const me = cu.preview ? null : await getCurrentProfile();
  const prefs = me
    ? await getPrefs((await hubEnv()).DB, me.id).catch(() => ({ ...DEFAULT_PREFS }))
    : null;
  const display = assigned ?? effective;
  const grace = graceIsOpen(graceUntil);

  return (
    <>
      <PageHeader kicker="Package" title="Sponsorship">
        What your firm bought, and what Connect currently unlocks for your contacts. You do not
        see the member feed — that stays with QUANTT members.
      </PageHeader>
      <Notice message={sp.denied} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-heading text-2xl font-bold text-ink">{display?.name ?? "Unassigned"}</h2>
        <TierBadge tier={display} />
      </div>
      <p className="mt-2 text-sm text-copy">
        {formatPrice(display?.price_cents ?? null)}
        {display?.blurb ? ` · ${display.blurb}` : ""}
      </p>
      {grace && graceUntil && assigned && effective && assigned.id !== effective.id && (
        <p className="mt-4 border border-primary/20 bg-primary/5 p-4 text-sm text-ink">
          Until {formatDate(`${graceUntil}T12:00:00`)} you still have {effective.name} access. After
          that, {assigned.name} applies.
        </p>
      )}

      <ul className="mt-8 space-y-4">
        {capabilities.map((cap) => {
          const key = cap.key as CapabilityKey;
          const included = can(access, key);
          const onPackage = liveCan(assigned, effective, key);
          const custom = overrideFor(overrides, key);
          const needed = included ? null : lowestTierWith(tiers, key);
          const quota = cap.kind === "quota" ? capValue(access, key) : null;
          return (
            <li key={cap.key} className="border-t border-line py-4">
              <p className="text-ink">
                {cap.label}{" "}
                <span className="text-xs uppercase tracking-wider text-muted">
                  {included
                    ? quota == null
                      ? cap.kind === "quota"
                        ? "unlimited"
                        : custom?.granted && !onPackage
                          ? "added for your firm"
                          : "included"
                      : `${quota} open jobs`
                    : custom && !custom.granted
                      ? "removed for your firm"
                      : "not included"}
                </span>
              </p>
              <p className="mt-1 text-sm text-muted">{cap.description}</p>
              {!included && needed && (
                <p className="mt-2 text-xs text-primary">Included from {needed.name}.</p>
              )}
            </li>
          );
        })}
      </ul>
      {access && access.applicant_embargo_hours > 0 && (
        <p className="mt-8 text-sm text-copy">
          New applications appear {access.applicant_embargo_hours} hours after they are submitted.
        </p>
      )}
      {access && access.resume_book_embargo_hours > 0 && can(access, "resume_book") && (
        <p className="mt-3 text-sm text-copy">
          New resume-book opt-ins appear {access.resume_book_embargo_hours} hours after a member
          opts in.
        </p>
      )}

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="font-heading text-lg font-bold text-ink">Firm profile</h2>
        <p className="mt-1 text-sm text-copy">
          Your logo appears next to posts on the member feed.
        </p>
        <form action={updateCompanyProfile} className="mt-4 grid max-w-xl gap-4">
          <Field label="Website">
            <TextInput
              name="website"
              type="url"
              defaultValue={company?.website ?? ""}
              maxLength={500}
              placeholder="https://"
            />
          </Field>
          <Field label="Logo URL">
            <TextInput
              name="logo_url"
              type="url"
              defaultValue={company?.logo_url ?? ""}
              maxLength={500}
              placeholder="https://"
            />
          </Field>
          <Field label="Description">
            <TextArea
              name="description"
              rows={3}
              defaultValue={company?.description ?? ""}
              maxLength={500}
            />
          </Field>
          <PrimaryButton type="submit" disabled={cu.preview}>Save profile</PrimaryButton>
        </form>
      </section>
      {prefs && (
        <NotificationSettings prefs={prefs} role="company_user" saved={sp.notifications === "saved"} />
      )}
    </>
  );
}
