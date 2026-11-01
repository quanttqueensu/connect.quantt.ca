import LockedCard from "@/components/LockedCard";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import TalentList, { type TalentRow } from "@/components/TalentList";
import { Field, PrimaryButton, TextInput } from "@/components/Form";
import { getCurrentProfile } from "@/lib/auth";
import { can, graceOnlyCap, loadMyCompanyTier, loadTiers } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cleanSearchTerm, parseGradYearParam } from "../talent-query";

export default async function CandidateSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; program?: string; year?: string; denied?: string }>;
}) {
  const sp = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const { data: cu } = await supabase
    .from("company_users")
    .select("company_id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!cu) redirect("/company");

  const [{ assigned, effective, access, overrides }, tiers] = await Promise.all([
    loadMyCompanyTier(cu.company_id),
    loadTiers(),
  ]);

  const q = cleanSearchTerm(sp.q);
  const program = cleanSearchTerm(sp.program);
  const { yearRaw, year, invalid: yearInvalid } = parseGradYearParam(sp.year);

  const { data: members } =
    can(access, "candidate_search") && !yearInvalid
      ? await supabase.rpc("candidate_search_list", {
          p_q: q || null,
          p_program: program || null,
          p_grad_year: year,
        })
      : { data: [] as TalentRow[] };

  return (
    <>
      <PageHeader kicker="Talent" title="Candidate search">
        Search opted-in members by name, program, year, or interests.
      </PageHeader>
      <Notice message={sp.denied} />
      <LockedCard
        capability="candidate_search"
        tier={access}
        tiers={tiers}
        title="Candidate search"
        description="Your current access does not include searching the member book."
      >
        {graceOnlyCap(assigned, effective, overrides, "candidate_search") && (
            <p className="mb-6 border border-primary/20 bg-primary/5 p-4 text-sm text-ink">
              Search is still open during grandfathering. It will lock when your {assigned?.name}{" "}
              package takes effect.
            </p>
          )}
        {yearInvalid && (
          <p role="alert" className="mb-6 text-sm text-ink">
            Grad year must be a whole number between 1900 and 2100.
          </p>
        )}
        <form method="get" className="mb-8 grid max-w-2xl gap-3 md:grid-cols-4">
          <Field label="Search">
            <TextInput name="q" defaultValue={q} maxLength={80} placeholder="Name or interests" />
          </Field>
          <Field label="Program">
            <TextInput name="program" defaultValue={program} maxLength={80} />
          </Field>
          <Field label="Grad year">
            <TextInput name="year" type="number" defaultValue={yearRaw} />
          </Field>
          <div className="flex items-end">
            <PrimaryButton type="submit">Search</PrimaryButton>
          </div>
        </form>
        <TalentList
          members={(members as TalentRow[] | null) ?? []}
          companyId={cu.company_id}
          returnTo="/company/search"
          dmTier={can(access, "dm_initiate_any") ? access : null}
          tiers={tiers}
          empty={
            q || program || yearRaw
              ? "No opted-in members match these filters."
              : "No opted-in members yet."
          }
        />
      </LockedCard>
    </>
  );
}
