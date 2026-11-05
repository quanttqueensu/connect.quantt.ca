import { getCompanyContext } from "@/lib/sponsor-mode";
import LockedCard from "@/components/LockedCard";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import ResumeDocLink from "../ResumeDocLink";
import { can, graceOnlyCap, loadMyCompanyTier, loadTiers } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import type { Application } from "@/lib/types";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClass } from "@/components/Form";

export default async function ApplicantsPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const cu = await getCompanyContext();
  if (!cu) redirect("/company");

  const [{ assigned, effective, access, overrides }, tiers] = await Promise.all([
    loadMyCompanyTier(cu.company_id),
    loadTiers(),
  ]);

  const { data: apps } = can(access, "read_applicants") ? await supabase
    .from("applications")
    .select("*, posts(title), profiles(full_name)")
    .eq("kind", "in_app")
    .eq("company_id", cu.company_id)
    .order("created_at", { ascending: false }) : { data: [] };

  return (
    <>
      <PageHeader title="Applicants" />
      <Notice message={sp.denied} />
      <LockedCard
        capability="read_applicants"
        tier={access}
        tiers={tiers}
        title="Applicant pipeline"
        description="Your current access does not include seeing who applied through Connect."
      >
        {graceOnlyCap(assigned, effective, overrides, "read_applicants") && (
            <p className="mb-6 border border-primary/20 bg-primary/5 p-4 text-sm text-ink">
              This pipeline is still open during grandfathering. It will lock when your{" "}
              {assigned?.name} package takes effect.
            </p>
          )}
        <p className="mb-6">
          <a href="/company/applicants/export" className={buttonClass("ghost")}>
            Download CSV
          </a>
        </p>
        <ul>
          {(apps as Application[] | null)?.map((a) => (
            <li key={a.id} className="border-t border-line py-4">
              <p className="text-ink">{a.profiles?.full_name}</p>
              <p className="text-sm text-copy">
                {a.posts?.title} · {a.stage}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ResumeDocLink applicationId={a.id} path={a.resume_path} doc="resume" />
                <ResumeDocLink applicationId={a.id} path={a.cover_letter_path} doc="cover" />
                {a.post_id && (
                  <Link href={`/company/posts/${a.post_id}`} className={buttonClass("quiet")}>
                    Open posting
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
        {!(apps ?? []).length && <p className="text-sm text-copy">No applicants yet.</p>}
      </LockedCard>
    </>
  );
}
