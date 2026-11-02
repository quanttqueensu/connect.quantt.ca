import type { AlumniPost } from "@/lib/alumni/data";
import { formatDate } from "@/lib/time";
import type { ReactNode } from "react";

/** Alumni jobs and mentorship offers, shared by the alumni and member sides. */
export default function AlumniPostList({
  posts,
  empty,
  action,
}: {
  posts: AlumniPost[];
  empty: string;
  action?: (post: AlumniPost) => ReactNode;
}) {
  if (!posts.length) return <p className="border border-line p-6 text-sm text-copy">{empty}</p>;
  return (
    <ul className="grid gap-4">
      {posts.map((p) => (
        <li key={p.id} className="min-w-0 border border-line p-5 [overflow-wrap:anywhere]">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            {p.kind === "mentorship" ? "Mentorship" : "Job"}
            {p.status === "closed" && <span className="ml-2 text-muted">Closed</span>}
          </p>
          <p className="mt-2 font-heading text-lg font-bold text-ink">{p.title}</p>
          <p className="mt-1 text-sm text-muted">
            {[p.firm, p.location, `posted by ${p.author_name}`, formatDate(p.created_at)].filter(Boolean).join(" · ")}
          </p>
          {p.body && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-copy">{p.body}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {p.external_url && (
              <a href={p.external_url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
                Open listing
              </a>
            )}
            {action?.(p)}
          </div>
        </li>
      ))}
    </ul>
  );
}
