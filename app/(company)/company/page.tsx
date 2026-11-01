import { DEMO_POSTS } from "@/lib/sponsor-demo";
import { getCompanyContext } from "@/lib/sponsor-mode";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { QuietDangerButton, buttonClass } from "@/components/Form";
import { closePost } from "@/lib/actions/posts";
import { createClient } from "@/lib/supabase/server";
import type { Post } from "@/lib/types";
import { kindLabel } from "@/lib/types";
import Link from "next/link";

export default async function CompanyHome({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const cu = await getCompanyContext();
  if (!cu) {
    return <p className="text-copy">This account is not attached to a company.</p>;
  }
  const { data: posts } = cu.preview ? { data: DEMO_POSTS } : await supabase
    .from("posts")
    .select("*")
    .eq("company_id", cu.company_id)
    .order("created_at", { ascending: false });

  const company = cu.company;

  return (
    <>
      <PageHeader kicker="Company" title={company?.name ?? "Your posts"}>
        You only see posts from your firm. Members see these on the global feed.
      </PageHeader>
      <Notice message={sp.denied} />
      <Link href="/company/posts/new" className={buttonClass("primary")}>
        New post
      </Link>
      <ul className="mt-8">
        {(posts as Post[] | null)?.map((p) => (
          <li key={p.id} className="border-t border-line py-4">
            <Link href={`/company/posts/${p.id}`} className="text-ink hover:text-primary">
              {p.title}{" "}
              <span className="text-xs text-copy">
                {kindLabel(p.kind)} · {p.status}
              </span>
            </Link>
            {p.status === "open" && (
              <form action={closePost} className="mt-2">
                <input type="hidden" name="id" value={p.id} />
                <QuietDangerButton type="submit" disabled={cu.preview}>Close posting</QuietDangerButton>
              </form>
            )}
          </li>
        ))}
      </ul>
      {!(posts ?? []).length && <p className="mt-8 text-sm text-copy">No posts yet.</p>}
    </>
  );
}
