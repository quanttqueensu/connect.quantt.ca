import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { Field, PrimaryButton, QuietButton, TextInput } from "@/components/Form";
import { logOffPlatform, updateApplicationStage } from "@/lib/actions/applications";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { applicationKindLabel, one, stageLabel, type Application } from "@/lib/types";
import Link from "next/link";
import { redirect } from "next/navigation";

const stages = ["submitted", "reviewing", "interviewing", "offer", "closed"] as const;

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const sp = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const { data: apps, error: appsError } = await supabase
    .from("applications")
    .select("*, posts(id, title, kind)")
    .eq("member_id", profile.id)
    .order("created_at", { ascending: false });
  if (appsError) {
    console.error("applications: query failed", appsError.message);
  }

  const rows = (apps as Application[] | null) ?? [];

  return (
    <>
      <PageHeader kicker="Pipeline" title="My applications" />
      <Notice message={sp.denied} />
      {appsError ? (
        <p className="border border-line p-6 text-sm text-copy">
          Applications could not be loaded. Try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="border border-line p-6 text-sm text-copy">
          Nothing here yet. Apply to an in-app job from the{" "}
          <Link href="/feed" className="text-primary hover:underline">
            feed
          </Link>{" "}
          and it will appear here, or log an application you made elsewhere using the form
          below.
        </p>
      ) : null}
      <ul className="space-y-4">
        {rows.map((a) => {
          const post = one(a.posts);
          const title =
            a.kind === "in_app" ? (post?.title ?? "Job posting") : a.company_name;
          return (
            <li key={a.id} className="border-t border-line py-4">
              <p className="text-ink">
                {a.kind === "in_app" && post?.id ? (
                  <Link href={`/feed/${post.id}`} className="text-ink hover:text-primary">
                    {title}
                  </Link>
                ) : (
                  title
                )}{" "}
                <span className="text-xs text-copy">
                  {a.kind === "in_app" && a.package_name
                    ? a.package_name
                    : applicationKindLabel(a.kind)}{" "}
                  · {stageLabel(a.stage)}
                </span>
              </p>
              {a.kind === "off_platform" && (
                <form action={updateApplicationStage} className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={a.id} />
                  <select name="stage" aria-label={`Application stage for ${title}`} defaultValue={a.stage} className="min-h-10 rounded px-3 py-1.5 text-sm">
                    {stages.map((s) => (
                      <option key={s} value={s}>
                        {stageLabel(s)}
                      </option>
                    ))}
                  </select>
                  <QuietButton type="submit">Save stage</QuietButton>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      <form action={logOffPlatform} className="mt-12 max-w-md space-y-3">
        <h2 className="font-heading text-lg font-bold text-ink">Log an external application</h2>
        <Field label="Company name">
          <TextInput name="company_name" required />
        </Field>
        <Field label="Notes">
          <TextInput name="notes" />
        </Field>
        <PrimaryButton type="submit">Log application</PrimaryButton>
      </form>
    </>
  );
}
