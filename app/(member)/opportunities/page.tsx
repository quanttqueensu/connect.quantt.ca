import PageHeader from "@/components/PageHeader";
import PostCard from "@/components/PostCard";
import { PrimaryButton, TextInput, buttonClass } from "@/components/Form";
import { requireCurrentProfile } from "@/lib/auth";
import { markListingApplied, setListingHidden, unmarkListingApplied } from "@/lib/actions/opportunities";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import type { Post } from "@/lib/types";
import Link from "next/link";

const PAGE_SIZE = 30;

type Listing = {
  id: string;
  url: string;
  source: "simplify" | "nwft";
  company: string;
  title: string;
  locations: string[] | null;
  role_type: "internship" | "full_time";
  term: string | null;
  posted_at: string;
  hidden: boolean;
};

type SearchParams = {
  view?: string;
  q?: string;
  role?: string;
  term?: string;
  location?: string;
  canada?: string;
  hidden?: string;
  applied?: string;
  page?: string;
};

// No commas: or() splits on them.
const CANADA = [
  "Canada", "Toronto", "Montreal", "Montréal", "Vancouver", "Calgary", "Ottawa", "Waterloo", "Kingston",
  "Edmonton", "Mississauga", "Ontario", "Quebec",
];

/** Strip characters that or()/ilike would read as syntax. */
function term(v: string | undefined) {
  return String(v ?? "").replace(/[,()*%\\_.]/g, " ").trim().slice(0, 80);
}

function href(sp: SearchParams, page: number) {
  const qs = new URLSearchParams();
  for (const k of ["view", "q", "role", "term", "location", "canada", "hidden", "applied"] as const) {
    if (sp[k]) qs.set(k, String(sp[k]));
  }
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/opportunities?${s}` : "/opportunities";
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const profile = await requireCurrentProfile();
  const supabase = await createClient();
  const isAdmin = Boolean(profile.is_admin);
  const showHidden = isAdmin && sp.hidden === "1";

  // Jobs QUANTT's sponsors posted on Connect (rank 0 is "Not sponsoring"). Kept
  // apart from the public listings below: members apply to these through the hub.
  const { data: sponsorData, error: sponsorError } = await supabase
    .from("posts")
    .select("*, companies!inner(*, sponsor_tiers!sponsor_tier_id!inner(id, name, rank, key))")
    .eq("published", true)
    .eq("status", "open")
    .in("kind", ["job", "job_link"])
    .gt("companies.sponsor_tiers!sponsor_tier_id.rank", 0)
    .order("created_at", { ascending: false })
    .limit(100);
  if (sponsorError) console.error("opportunities: sponsor jobs failed", sponsorError.message, sponsorError.code);
  const sponsorJobs = (sponsorData ?? []) as unknown as Post[];
  // Sponsor jobs first whenever there are any; otherwise straight to every listing.
  const view = sp.view === "sponsors" || sp.view === "all" ? sp.view : sponsorJobs.length > 0 ? "sponsors" : "all";

  // Listings this member marked applied (members only; admins and sponsors have no tracker).
  const isMember = profile.role === "member";
  const { data: appliedData } = isMember
    ? await supabase.from("applications").select("job_listing_id").eq("member_id", profile.id)
    : { data: [] };
  const appliedIds = new Set(
    ((appliedData ?? []) as { job_listing_id: string | null }[]).map((a) => a.job_listing_id).filter((x): x is string => Boolean(x)),
  );
  const appliedFilter = isMember && (sp.applied === "yes" || sp.applied === "no") ? sp.applied : "";

  const parsed = Number(sp.page);
  const page = Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000 ? parsed : 1;
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("job_listings")
    .select("id, url, source, company, title, locations, role_type, term, posted_at, hidden")
    .eq("active", true)
    .eq("hidden", showHidden)
    .order("posted_at", { ascending: false })
    .range(from, from + PAGE_SIZE);

  const q = term(sp.q);
  if (q) query = query.or(`title.ilike.*${q}*,company.ilike.*${q}*`);
  if (sp.role === "internship" || sp.role === "full_time") query = query.eq("role_type", sp.role);
  const t = /^(Spring|Summer|Fall|Winter) \d{4}$/.test(sp.term ?? "") ? sp.term! : "";
  if (t) query = query.eq("term", t);
  const loc = term(sp.location);
  if (loc) query = query.ilike("locations", `%${loc}%`);
  if (sp.canada === "1") query = query.or(CANADA.map((c) => `locations.ilike.*${c}*`).join(","));
  if (appliedFilter === "yes") query = query.in("id", [...appliedIds]);
  if (appliedFilter === "no") query = query.notIn("id", [...appliedIds]);

  const { data, error } = await query;
  if (error) console.error("opportunities: query failed", error.message, error.code);
  const rows = (data ?? []) as unknown as Listing[];
  const hasNext = rows.length > PAGE_SIZE;
  const list = hasNext ? rows.slice(0, PAGE_SIZE) : rows;

  const year = new Date().getFullYear();
  const terms: string[] = [];
  for (let y = year; y <= year + 2; y++) {
    for (const s of ["Winter", "Spring", "Summer", "Fall"]) terms.push(`${s} ${y}`);
  }
  const hasFilters = Boolean(sp.q || sp.role || sp.term || sp.location || sp.canada || appliedFilter);

  return (
    <>
      <PageHeader kicker="Connect" title="Opportunities">
        Jobs from QUANTT sponsors, plus open quant internships and new-grad roles from public lists, refreshed daily.
      </PageHeader>

      <nav aria-label="Opportunity type" className="mb-6 flex gap-2">
        <Link
          href="/opportunities?view=sponsors"
          aria-current={view === "sponsors" ? "page" : undefined}
          className={buttonClass(view === "sponsors" ? "primary" : "quiet")}
        >
          Sponsor jobs ({sponsorJobs.length})
        </Link>
        <Link
          href="/opportunities?view=all"
          aria-current={view === "all" ? "page" : undefined}
          className={buttonClass(view === "all" ? "primary" : "quiet")}
        >
          All quant listings
        </Link>
      </nav>

      {view === "sponsors" ? (
        <div>
          {sponsorError ? (
            <p className="text-sm text-copy">Sponsor jobs could not be loaded. Try again.</p>
          ) : sponsorJobs.length === 0 ? (
            <p className="text-sm text-copy">
              No sponsor jobs open right now.{" "}
              <Link href="/opportunities?view=all" className="text-primary">
                See all quant listings
              </Link>
            </p>
          ) : (
            sponsorJobs.map((post) => <PostCard key={post.id} post={post} />)
          )}
        </div>
      ) : (
      <>
      <form className="mb-4 grid items-end gap-3 rounded border border-line bg-surface p-5 md:grid-cols-4">
        <input type="hidden" name="view" value="all" />
        <TextInput
          name="q"
          aria-label="Search role or firm"
          defaultValue={sp.q ?? ""}
          placeholder="Role or firm"
          className="rounded px-3 py-2 text-sm"
        />
        <select name="role" aria-label="Role type" defaultValue={sp.role ?? ""} className="rounded px-3 py-2 text-sm">
          <option value="">Internships and new grad</option>
          <option value="internship">Internships</option>
          <option value="full_time">New grad</option>
        </select>
        <select name="term" aria-label="Term" defaultValue={t} className="rounded px-3 py-2 text-sm">
          <option value="">Any term</option>
          {terms.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <TextInput
          name="location"
          aria-label="Location"
          defaultValue={sp.location ?? ""}
          placeholder="Location"
          className="rounded px-3 py-2 text-sm"
        />
        {isMember && (
          <select name="applied" aria-label="Applied" defaultValue={appliedFilter} className="rounded px-3 py-2 text-sm">
            <option value="">Applied or not</option>
            <option value="no">Not applied</option>
            <option value="yes">Applied</option>
          </select>
        )}
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-copy">
          <input type="checkbox" name="canada" value="1" defaultChecked={sp.canada === "1"} className="h-4 w-4" />
          Canada only
        </label>
        {isAdmin && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-copy">
            <input type="checkbox" name="hidden" value="1" defaultChecked={showHidden} className="h-4 w-4" />
            Hidden listings
          </label>
        )}
        <PrimaryButton type="submit">Apply filters</PrimaryButton>
        {(hasFilters || showHidden) && (
          <Link href="/opportunities?view=all" className={buttonClass("ghost")}>
            Clear filters
          </Link>
        )}
      </form>

      <div>
        {error ? (
          <p className="text-sm text-copy">Listings could not be loaded. Try again.</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-copy">
            {hasFilters ? "No listings match these filters." : "No listings yet. They arrive with the next daily refresh."}
          </p>
        ) : (
          list.map((l) => (
            <article key={l.id} className="flex flex-col gap-3 border-b border-line py-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-primary">
                  {l.role_type === "internship" ? "Internship" : "New grad"}
                  {l.term ? ` · ${l.term}` : ""}
                </p>
                <h2 className="mt-1.5 font-heading text-lg font-semibold text-ink">{l.title}</h2>
                <p className="mt-1 text-sm text-muted">
                  {[l.company, (l.locations ?? []).slice(0, 3).join(", ") + ((l.locations?.length ?? 0) > 3 ? ` +${l.locations!.length - 3}` : "")]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="mt-1 text-[11px] text-muted">
                  {l.source === "nwft" ? "Listed" : "Posted"} <time dateTime={l.posted_at}>{formatDate(l.posted_at)}</time>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>
                  Apply
                </a>
                {isMember &&
                  (appliedIds.has(l.id) ? (
                    <form action={unmarkListingApplied}>
                      <input type="hidden" name="id" value={l.id} />
                      <button type="submit" className={buttonClass("quiet")} title="Remove from your applications">
                        Applied ✓
                      </button>
                    </form>
                  ) : (
                    <form action={markListingApplied}>
                      <input type="hidden" name="id" value={l.id} />
                      <button type="submit" className={buttonClass("quiet")}>
                        Mark applied
                      </button>
                    </form>
                  ))}
                {isAdmin && (
                  <form action={setListingHidden}>
                    <input type="hidden" name="id" value={l.id} />
                    <input type="hidden" name="hidden" value={l.hidden ? "0" : "1"} />
                    <button type="submit" className={buttonClass("quiet")}>
                      {l.hidden ? "Unhide" : "Hide"}
                    </button>
                  </form>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      {(page > 1 || hasNext) && (
        <nav aria-label="Listing pages" className="mt-8 flex items-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={href(sp, page - 1)} className={buttonClass("quiet")}>
              Newer
            </Link>
          ) : (
            <span className={buttonClass("quiet", "pointer-events-none opacity-40")}>Newer</span>
          )}
          <span className="text-muted">Page {page}</span>
          {hasNext ? (
            <Link href={href(sp, page + 1)} className={buttonClass("quiet")}>
              Older
            </Link>
          ) : (
            <span className={buttonClass("quiet", "pointer-events-none opacity-40")}>Older</span>
          )}
        </nav>
      )}

      </>
      )}

      <p className="mt-10 text-xs text-muted">
        Listings from{" "}
        <a href="https://github.com/SimplifyJobs/Summer2027-Internships" target="_blank" rel="noopener noreferrer" className="text-primary">
          Simplify
        </a>{" "}
        and{" "}
        <a href="https://github.com/northwesternfintech/2027QuantInternships" target="_blank" rel="noopener noreferrer" className="text-primary">
          Northwestern Fintech
        </a>
        . Applied somewhere?{" "}
        <Link href="/applications" className="text-primary">
          Log it
        </Link>
      </p>
    </>
  );
}
