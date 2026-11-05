import Link from "next/link";
import TierBadge from "@/components/TierBadge";
import type { Post } from "@/lib/types";
import { isInAppJob, isPlatformJob, kindLabel, one, roleTypeLabel, termLabel } from "@/lib/types";
import { formatDate } from "@/lib/time";

export default function PostCard({ post }: { post: Post }) {
  const company = post.companies;
  const job = isInAppJob(post);
  const closed = isPlatformJob(post) && post.status === "closed";
  const logo = company?.logo_url;
  return (
    <Link
      href={`/feed/${post.id}`}
      className="group block border-b border-line py-4 transition-colors hover:bg-surface/60"
    >
      <div className="flex items-baseline gap-3">
        {logo && /^https?:\/\//i.test(logo) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-6 w-6 object-contain" />
        ) : null}
        <span className="text-xs font-medium text-primary">{kindLabel(post.kind)}</span>
        <TierBadge tier={one(company?.sponsor_tiers)} />
        {closed && (
          <span className="text-[10px] uppercase tracking-wider text-muted">Closed</span>
        )}
      </div>
      <h2 className="mt-1 font-heading text-lg font-semibold text-ink group-hover:text-primary">{post.title}</h2>
      <p className="mt-0.5 text-sm text-muted">
        {[
          company?.name,
          roleTypeLabel(post.role_type),
          termLabel(post.term_season, post.term_year),
          post.location,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-copy">{post.body}</p>
      <p className="mt-2 text-xs text-muted">
        <span className="font-medium text-primary">
          {job ? "Apply through Connect" : closed ? "Closed" : post.external_url ? "External listing" : "Post"}
        </span>
        {" · "}Posted <time dateTime={post.created_at}>{formatDate(post.created_at)}</time>
      </p>
    </Link>
  );
}
