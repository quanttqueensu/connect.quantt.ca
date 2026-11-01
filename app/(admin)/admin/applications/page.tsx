import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { updateApplicationStage } from "@/lib/actions/applications";
import { createClient } from "@/lib/supabase/server";
import { QuietButton } from "@/components/Form";
import { applicationKindLabel, stageLabel, type Application } from "@/lib/types";

const stages = ["submitted", "reviewing", "interviewing", "offer", "closed"] as const;

export default async function AdminApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: apps } = await supabase
    .from("applications")
    .select("*, posts(title), profiles(full_name)")
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader kicker="Pipeline" title="All applications" />
      <Notice message={sp.denied} />
      <ul>
        {(apps as Application[] | null)?.map((a) => (
          <li key={a.id} className="border-t border-line py-3 text-sm">
            <span className="text-ink">{a.profiles?.full_name}</span>
            <span className="text-copy">
              {" "}
              · {a.kind === "in_app" ? a.posts?.title : a.company_name} · {applicationKindLabel(a.kind)}
            </span>
            <form action={updateApplicationStage} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={a.id} />
              <select name="stage" aria-label={`Application stage for ${a.profiles?.full_name ?? "applicant"}`} defaultValue={a.stage} className="min-h-10 rounded px-3 py-1.5 text-sm">
                {stages.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </select>
              <QuietButton type="submit">Save stage</QuietButton>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
