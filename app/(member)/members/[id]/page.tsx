import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile, ProfileSection } from "@/lib/types";
import { notFound, redirect } from "next/navigation";

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Every sibling member page redirects a signed-out visitor to /login; without
  // this the anonymous client's RLS-empty read renders a 404 instead.
  const me = await getCurrentProfile();
  if (!me) redirect("/login");
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("profiles")
    .select(
      "id, full_name, program, grad_year, bio, interests, linkedin_url, github_url, website_url, photo_path",
    )
    .eq("id", id)
    .eq("role", "member")
    .maybeSingle();
  if (!member) notFound();
  const m = member as Pick<
    Profile,
    | "id"
    | "full_name"
    | "program"
    | "grad_year"
    | "bio"
    | "interests"
    | "linkedin_url"
    | "github_url"
    | "website_url"
    | "photo_path"
  >;
  const { data: sections } = await supabase
    .from("profile_sections")
    .select("*")
    .eq("member_id", id)
    .order("sort_order");

  const fields = [
    { label: "Bio", value: m.bio, kind: "text" as const },
    { label: "Interests", value: m.interests, kind: "text" as const },
    { label: "LinkedIn", value: m.linkedin_url, kind: "url" as const },
    { label: "GitHub", value: m.github_url, kind: "url" as const },
    { label: "Website", value: m.website_url, kind: "url" as const },
  ].filter((f): f is { label: string; value: string; kind: "text" | "url" } => Boolean(f.value));

  const photoUrl = m.photo_path ? `/members/${m.id}/photo` : null;

  return (
    <article>
      <div className="flex items-start gap-4">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-20 w-20 object-cover" />
        ) : null}
        <div>
          <h1 className="font-heading text-3xl font-bold text-ink">{m.full_name}</h1>
          <p className="mt-2 text-sm text-muted">
            {[m.program, m.grad_year].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <dl className="mt-8 space-y-4">
        {fields.map((field) => (
          <div key={field.label}>
            <dt className="text-[11px] uppercase tracking-wider text-copy">{field.label}</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-copy">
              {field.kind === "url" && /^https?:\/\//i.test(field.value) ? (
                <a
                  href={field.value}
                  className="text-primary hover:text-ink"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {field.value}
                </a>
              ) : (
                field.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {(sections as ProfileSection[] | null)?.map((s) => (
        <section key={s.id} className="mt-8 border-t border-line pt-6">
          <h2 className="text-[11px] uppercase tracking-wider text-copy">{s.label}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-copy">{s.body}</p>
        </section>
      ))}
    </article>
  );
}
