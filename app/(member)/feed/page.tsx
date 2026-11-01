import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import PostCard from "@/components/PostCard";
import { PrimaryButton, buttonClass } from "@/components/Form";
import { createClient } from "@/lib/supabase/server";
import { kindLabel, roleTypeLabel, type Post, type PostKind, type RoleType } from "@/lib/types";
import Link from "next/link";

const PAGE_SIZE = 20;

type FeedSearchParams = {
  kind?: string;
  role_type?: string;
  term?: string;
  company?: string;
  location?: string;
  sponsor?: string;
  page?: string;
  denied?: string;
};

/** Rebuild the feed URL, keeping every active filter and swapping the page. */
function feedHref(sp: FeedSearchParams, page: number) {
  const qs = new URLSearchParams();
  for (const key of ["kind", "role_type", "term", "company", "location", "sponsor"] as const) {
    const value = sp[key];
    if (value) qs.set(key, value);
  }
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/feed?${s}` : "/feed";
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<FeedSearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const sponsorOnly = sp.sponsor === "1";
  const parsedPage = Number(sp.page);
  const page =
    Number.isInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 10000 ? parsedPage : 1;
  const from = (page - 1) * PAGE_SIZE;

  // Sponsor status lives on the joined company's tier, so push the filter into
  // the query with an inner join rather than fetching everything and filtering
  // in JS. An inner join is also the right semantics: a post with no company can
  // never be a sponsor post. Rank 0 is "Not sponsoring".
  let query = supabase
    .from("posts")
    .select(
      sponsorOnly
        ? "*, companies!inner(*, sponsor_tiers!sponsor_tier_id!inner(id, name, rank, key))"
        : "*, companies(*, sponsor_tiers!sponsor_tier_id(id, name, rank, key))",
    )
    .eq("published", true)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    // One extra row tells us whether a next page exists without a count query.
    .range(from, from + PAGE_SIZE);

  if (sponsorOnly) query = query.gt("companies.sponsor_tiers!sponsor_tier_id.rank", 0);
  if (sp.kind) query = query.eq("kind", sp.kind);
  if (sp.role_type) query = query.eq("role_type", sp.role_type);
  if (sp.location) {
    const location = String(sp.location).replace(/[,()*%\\]/g, " ").trim();
    if (location) query = query.ilike("location", `%${location}%`);
  }
  if (sp.company) query = query.eq("company_id", sp.company);
  if (sp.term) {
    const [season, year] = sp.term.split("-");
    if (season && year) {
      query = query.eq("term_season", season).eq("term_year", Number(year));
    }
  }

  const [{ data: posts, error: postsError }, { data: companies }] = await Promise.all([
    query,
    supabase
      .from("companies")
      .select("id, name")
      .eq("status", "active")
      .order("name"),
  ]);
  if (postsError) {
    console.error("feed: posts query failed", postsError.message, postsError.code);
  }

  const fetched = (posts ?? []) as unknown as Post[];
  const hasNext = fetched.length > PAGE_SIZE;
  const list = hasNext ? fetched.slice(0, PAGE_SIZE) : fetched;

  const kinds: PostKind[] = ["job", "job_link", "event", "announcement", "connection"];
  const now = new Date();
  const termOptions: { value: string; label: string }[] = [];
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 2; y++) {
    for (const [season, label] of [
      ["fall", "Fall"],
      ["winter", "Winter"],
      ["summer", "Summer"],
    ] as const) {
      termOptions.push({ value: `${season}-${y}`, label: `${label} ${y}` });
    }
  }
  const roles: RoleType[] = ["full_time", "internship", "coop"];
  const hasFilters = Boolean(
    sp.kind || sp.role_type || sp.term || sp.company || sp.location || sp.sponsor,
  );

  return (
    <>
      <PageHeader kicker="Hub" title="Feed">
        Jobs, events, connections, and listings from QUANTT and partner firms.
      </PageHeader>
      <Notice message={sp.denied} />
      <form className="mb-8 grid gap-3 md:grid-cols-5">
        <select
          name="kind"
          aria-label="Post type"
          defaultValue={sp.kind ?? ""}
          className="rounded px-3 py-2 text-sm"
        >
          <option value="">All types</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <select
          name="role_type"
          aria-label="Role type"
          defaultValue={sp.role_type ?? ""}
          className="rounded px-3 py-2 text-sm"
        >
          <option value="">Any role type</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleTypeLabel(r)}
            </option>
          ))}
        </select>
        <select
          name="company"
          aria-label="Company"
          defaultValue={sp.company ?? ""}
          className="rounded px-3 py-2 text-sm"
        >
          <option value="">All companies</option>
          {(companies ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          name="term"
          aria-label="Term"
          defaultValue={sp.term ?? ""}
          className="rounded px-3 py-2 text-sm"
        >
          <option value="">Any term</option>
          {termOptions.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          name="location"
          aria-label="Location"
          defaultValue={sp.location ?? ""}
          placeholder="Location"
          className="rounded px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            name="sponsor"
            value="1"
            defaultChecked={sponsorOnly}
            className="h-4 w-4"
          />
          Sponsors only
        </label>
        <PrimaryButton type="submit">Filter</PrimaryButton>
        {hasFilters && (
          <Link href="/feed" className={buttonClass("ghost")}>
            Clear filters
          </Link>
        )}
      </form>
      <div>
        {postsError ? (
          <p className="text-sm text-white/60">Posts could not be loaded. Try again.</p>
        ) : (
          <>
            {list.length === 0 && (
              <p className="text-sm text-white/60">
                {hasFilters ? "No posts match these filters." : "No posts yet."}
              </p>
            )}
            {list.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </>
        )}
      </div>

      {(page > 1 || hasNext) && (
        <nav aria-label="Feed pages" className="mt-8 flex items-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={feedHref(sp, page - 1)} className={buttonClass("quiet")}>
              Newer
            </Link>
          ) : (
            <span className={buttonClass("quiet", "pointer-events-none opacity-40")}>Newer</span>
          )}
          <span className="text-white/50">Page {page}</span>
          {hasNext ? (
            <Link href={feedHref(sp, page + 1)} className={buttonClass("quiet")}>
              Older
            </Link>
          ) : (
            <span className={buttonClass("quiet", "pointer-events-none opacity-40")}>Older</span>
          )}
        </nav>
      )}

      <p className="mt-10 text-sm text-white/60">
        Applied off-platform?{" "}
        <Link href="/applications" className="text-blue-light">
          Log it
        </Link>
      </p>
    </>
  );
}
