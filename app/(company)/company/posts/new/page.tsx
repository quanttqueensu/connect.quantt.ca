import { getCompanyContext } from "@/lib/sponsor-mode";
import LockedCard from "@/components/LockedCard";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import PostForm from "@/components/PostForm";
import { can, capValue, loadMyCompanyTier, loadTiers } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import type { PostKind } from "@/lib/types";
import { redirect } from "next/navigation";

export default async function NewCompanyPost({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const cu = await getCompanyContext();
  if (!cu) redirect("/company");

  const [{ access }, tiers] = await Promise.all([
    loadMyCompanyTier(cu.company_id),
    loadTiers(),
  ]);

  const quota = capValue(access, "post_in_app_job");
  const { count: openInApp } = can(access, "post_in_app_job")
    ? await supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("company_id", cu.company_id)
        .eq("kind", "job")
        .is("external_url", null)
        .eq("status", "open")
    : { count: 0 };
  const atQuota = quota != null && (openInApp ?? 0) >= quota;
  const allowInAppJob = can(access, "post_in_app_job") && !atQuota;

  const kinds: PostKind[] = ["job", "job_link", "announcement"];
  if (can(access, "post_event")) kinds.splice(2, 0, "event");

  return (
    <>
      <PageHeader title="New post" />
      <Notice message={sp.denied} />
      {!can(access, "post_in_app_job") && (
        <div className="mb-8">
          <LockedCard
            capability="post_in_app_job"
            tier={access}
            tiers={tiers}
            title="In-app applications"
            description="Your current access does not include jobs that take applications through Connect. You can still publish a listing with an external URL."
          />
        </div>
      )}
      {can(access, "post_in_app_job") && quota != null && (
        <p className="mb-8 text-sm text-copy">
          Open in-app jobs: {openInApp ?? 0} / {quota}
          {atQuota
            ? ". Close one first to take applications through Connect, or publish a listing with an external URL."
            : "."}
        </p>
      )}
      <PostForm kinds={kinds} redirectTo="/company" allowInAppJob={allowInAppJob} readOnly={cu.preview} />
    </>
  );
}
