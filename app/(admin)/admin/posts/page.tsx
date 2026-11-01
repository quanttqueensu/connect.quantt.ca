import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { QuietDangerButton, buttonClass } from "@/components/Form";
import { closePost } from "@/lib/actions/posts";
import { createClient } from "@/lib/supabase/server";
import type { Post } from "@/lib/types";
import { kindLabel, one } from "@/lib/types";
import Link from "next/link";

type PostRow = Post & { companies: { name: string } | { name: string }[] | null };

export default async function AdminPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: posts } = await supabase
    .from("posts")
    .select("*, companies(name)")
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader kicker="Feed" title="Posts">
        Everything on the club feed, newest first.
      </PageHeader>
      <Notice message={sp.denied} />
      <div className="mb-6">
        <Link href="/admin/posts/new" className={buttonClass("primary")}>
          Write a new post
        </Link>
      </div>
      <ul>
        {(posts as PostRow[] | null)?.map((p) => {
          const company = one(p.companies);
          return (
            <li
              key={p.id}
              className="flex flex-col gap-3 border-t border-white/10 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <p className="text-white">{p.title}</p>
                <p className="mt-1 text-xs text-white/60">
                  {kindLabel(p.kind)} · {company?.name ?? "QUANTT"} · {p.status} ·{" "}
                  {p.published ? "published" : "unpublished"}
                </p>
              </div>
              {p.status === "open" && (
                <form action={closePost} className="shrink-0">
                  <input type="hidden" name="id" value={p.id} />
                  <QuietDangerButton type="submit">Close posting</QuietDangerButton>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {!(posts ?? []).length && <p className="text-sm text-white/60">No posts yet.</p>}
    </>
  );
}
