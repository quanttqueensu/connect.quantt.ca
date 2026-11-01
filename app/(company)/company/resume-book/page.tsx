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

export default async function ResumeBookPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; year?: string; denied?: string }>;
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

  const program = cleanSearchTerm(sp.program);
  const { yearRaw, year, invalid: yearInvalid } = parseGradYearParam(sp.year);

  const { data: members } =
    can(access, "resume_book") && !yearInvalid
      ? await supabase.rpc("resume_book_list", {
          p_program: program || null,
          p_grad_year: year,
        })
      : { data: [] as TalentRow[] };

  const delay = access?.resume_book_embargo_hours ?? 0;

  return (
    <>
      <PageHeader kicker="Talent" title="Resume book">
        Members who opted in, with the resume on their default hiring package.
      </PageHeader>
      <Notice message={sp.denied} />
      <LockedCard
        capability="resume_book"
        tier={access}
        tiers={tiers}
        title="Resume book"
        description="Your current access does not include the opt-in member resume book."
      >
        {graceOnlyCap(assigned, effective, overrides, "resume_book") && (
            <p className="mb-6 border border-primary/20 bg-primary/5 p-4 text-sm text-ink">
              You can browse the book during grandfathering. It will lock when your{" "}
              {assigned?.name} package takes effect.
            </p>
          )}
        {delay > 0 && (
          <p className="mb-6 text-sm text-copy">
            New opt-ins appear after {delay} hours at your tier.
          </p>
        )}
        {yearInvalid && (
          <p role="alert" className="mb-6 text-sm text-ink">
            Grad year must be a whole number between 1900 and 2100.
          </p>
        )}
        <form method="get" className="mb-8 grid max-w-xl gap-3 md:grid-cols-3">
          <Field label="Program">
            <TextInput name="program" defaultValue={program} maxLength={80} />
          </Field>
          <Field label="Grad year">
            <TextInput name="year" type="number" defaultValue={yearRaw} />
          </Field>
          <div className="flex items-end">
            <PrimaryButton type="submit">Apply filters</PrimaryButton>
          </div>
        </form>
        <TalentList
          members={(members as TalentRow[] | null) ?? []}
          companyId={cu.company_id}
          returnTo="/company/resume-book"
          dmTier={can(access, "dm_initiate_any") ? access : null}
          tiers={tiers}
          empty={
            program || yearRaw
              ? "No opted-in members match these filters."
              : "No opted-in members yet."
          }
        />
      </LockedCard>
    </>
  );
}
