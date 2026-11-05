import { getCompanyContext } from "@/lib/sponsor-mode";
import { startConversation } from "@/lib/actions/messages";
import { updateApplicationStage } from "@/lib/actions/applications";
import ResumeDocLink from "../../ResumeDocLink";
import LockedAction from "@/components/LockedAction";
import LockedCard from "@/components/LockedCard";
import { can, graceOnlyCap, loadMyCompanyTier, loadTiers } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import { isPlatformJob, kindLabel, stageLabel, type Application, type Post } from "@/lib/types";
import { QuietButton, buttonClass } from "@/components/Form";
import { notFound } from "next/navigation";
import { isSafeHttpUrl } from "../../talent-query";

const stages = ["submitted", "reviewing", "interviewing", "offer", "closed"] as const;

export default async function CompanyPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const cu = await getCompanyContext();
  if (!cu) notFound();
  const { data: post } = await supabase.from("posts").select("*").eq("id", id).maybeSingle();
  if (!cu || !post || post.company_id !== cu.company_id) notFound();
  const p = post as Post;

  const [{ assigned, effective, access, overrides }, tiers] = await Promise.all([
    loadMyCompanyTier(cu.company_id),
    loadTiers(),
  ]);

  const { data: apps } = isPlatformJob(p) && can(access, "read_applicants")
      ? await supabase.from("applications")
        .select("*, profiles(id, full_name, program, grad_year, linkedin_url)")
        .eq("post_id", id).eq("kind", "in_app").eq("company_id", cu.company_id)
      : { data: [] as Application[] };

  return (
    <>
      <p className="text-[11px] uppercase tracking-wider text-primary">{kindLabel(p.kind)}</p>
      <h1 className="mt-1 font-heading text-3xl font-bold text-ink">{p.title}</h1>
      <p className="mt-4 whitespace-pre-wrap text-sm text-copy">{p.body}</p>
      {p.external_url && isSafeHttpUrl(p.external_url) && (
        <p className="mt-4">
          <a
            href={p.external_url}
            className={buttonClass("ghost")}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open listing
          </a>
        </p>
      )}
      {isPlatformJob(p) && (
        <section className="mt-6">
          <LockedCard
            capability="read_applicants"
            tier={access}
            tiers={tiers}
            title="Applicants"
            description="Your current access does not include seeing who applied to this posting."
          >
            <h2 className="font-heading text-lg font-bold text-ink">Applicants</h2>
            {graceOnlyCap(assigned, effective, overrides, "read_applicants") && (
                <p className="mt-3 mb-2 border border-primary/20 bg-primary/5 p-4 text-sm text-ink">
                  Applicant access is still open during grandfathering. It will lock when your{" "}
                  {assigned?.name} package takes effect.
                </p>
              )}
            <ul className="mt-4 space-y-4">
              {(apps as Application[] | null)?.map((a) => (
                <li key={a.id} className="border-t border-line py-4">
                  <p className="text-ink">{a.profiles?.full_name}</p>
                  <p className="text-sm text-muted">
                    {a.linkedin_url}
                  </p>
                  {a.cover_letter && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-copy">{a.cover_letter}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <ResumeDocLink applicationId={a.id} path={a.resume_path} doc="resume" />
                    <ResumeDocLink applicationId={a.id} path={a.cover_letter_path} doc="cover" />
                  </div>
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <form action={updateApplicationStage} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="return_to" value={`/company/posts/${id}`} />
                      <select name="stage" aria-label={`Application stage for ${a.profiles?.full_name ?? "applicant"}`} defaultValue={a.stage} className="min-h-10 rounded px-3 py-1.5 text-sm">
                        {stages.map((s) => (
                          <option key={s} value={s}>
                            {stageLabel(s)}
                          </option>
                        ))}
                      </select>
                      <QuietButton type="submit" disabled={cu.preview}>Save stage</QuietButton>
                    </form>
                    {a.member_id && p.company_id && (
                      <LockedAction
                        label="Message applicant"
                        capability="dm_initiate_applicant"
                        tier={access}
                        tiers={tiers}
                      >
                        <form action={startConversation}>
                          <input type="hidden" name="company_id" value={p.company_id} />
                          <input type="hidden" name="member_id" value={a.member_id} />
                          <QuietButton type="submit" disabled={cu.preview}>Message applicant</QuietButton>
                        </form>
                      </LockedAction>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </LockedCard>
        </section>
      )}
    </>
  );
}
