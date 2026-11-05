import PageHeader from "@/components/PageHeader";
import { PrimaryButton, buttonClass } from "@/components/Form";
import { getCurrentProfile } from "@/lib/auth";
import { graduatedProfileIds } from "@/lib/alumni/graduates";
import { hubEnv } from "@/lib/hub/env";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import Link from "next/link";
import { redirect } from "next/navigation";

const PAGE_SIZE = 24;

type MemberCard = Pick<
  Profile,
  "id" | "full_name" | "program" | "grad_year" | "bio" | "linkedin_url" | "photo_path"
>;

/**
 * PostgREST applies its own max-rows ceiling and would silently truncate an
 * unbounded select, so the directory always asks for one explicit page and
 * reads the exact count to decide whether there is a next one.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const me = await getCurrentProfile();
  if (!me) redirect("/login");
  const sp = await searchParams;

  const q = String(sp.q ?? "").trim().slice(0, 80);
  const page = pageNumber(sp.page);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  let query = supabase
    .from("profiles")
    .select("id, full_name, program, grad_year, bio, linkedin_url, photo_path", {
      count: "exact",
    })
    .eq("role", "member");
  // Members who graduated are alumni now (lib/alumni/graduates.ts): leave their old profiles out.
  for (const id of await graduatedProfileIds((await hubEnv()).DB).catch(() => [] as string[])) query = query.neq("id", id);

  if (q) {
    // `or` takes a comma-separated filter list, so commas, parentheses and the
    // wildcard characters have to come out of the term before it is spliced in.
    const term = q.replace(/[,()*%\\]/g, " ").trim();
    if (term) query = query.or(`full_name.ilike.*${term}*,program.ilike.*${term}*`);
  }

  const { data: members, count, error: membersError } = await query
    .order("full_name")
    .range(from, from + PAGE_SIZE - 1);
  if (membersError) {
    console.error("members: query failed", membersError.message);
  }

  const rows = (members as MemberCard[] | null) ?? [];
  const total = count ?? 0;
  const hasPrev = page > 1;
  const hasNext = from + rows.length < total;
  const cards = rows.map((m) => ({
    ...m,
    photoUrl: m.photo_path ? `/members/${m.id}/photo` : null,
  }));

  return (
    <>
      <PageHeader
        title="Members"
        actions={
          <form method="get" className="flex w-full max-w-sm items-stretch gap-2 sm:w-80">
            <input
              type="search"
              name="q"
              aria-label="Search members by name or program"
              defaultValue={q}
              placeholder="Search by name or program"
              maxLength={80}
              className="min-w-0 w-full border border-line bg-transparent min-h-10 px-3 py-1.5 text-sm text-ink placeholder:text-muted"
            />
            <PrimaryButton type="submit">Search</PrimaryButton>
          </form>
        }
      >
        {total > 0 && `${total} member${total === 1 ? "" : "s"}`}
      </PageHeader>


      {membersError ? (
        <p className="border border-line p-6 text-sm text-copy">
          Members could not be loaded. Try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="border border-line p-6 text-sm text-copy">
          {q
            ? `No members match “${q}”. Try a different name or program.`
            : "No members yet. Once an exec invites members, they will show up here."}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
          {cards.map((m) => (
            <Link
              key={m.id}
              href={`/members/${m.id}`}
              className="min-w-0 border border-line px-3 py-2.5 hover:border-line-strong sm:p-4"
            >
              <div className="flex gap-3">
                {m.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.photoUrl} alt="" width={48} height={48} loading="lazy" decoding="async" className="h-12 w-12 shrink-0 object-cover" />
                ) : null}
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="font-heading text-base font-semibold text-ink">{m.full_name}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {[m.program, m.grad_year].filter(Boolean).join(" · ")}
                  </p>
                  {m.bio && <p className="mt-1.5 hidden text-sm text-copy sm:line-clamp-2">{m.bio}</p>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {(hasPrev || hasNext) && (
        <nav className="mt-6 flex items-center justify-between gap-3">
          {hasPrev ? (
            <Link href={pageHref(q, page - 1)} className={buttonClass("quiet")}>
              Previous
            </Link>
          ) : (
            <span className={buttonClass("quiet", "pointer-events-none opacity-40")}>Previous</span>
          )}
          <span className="text-xs text-muted">
            Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          {hasNext ? (
            <Link href={pageHref(q, page + 1)} className={buttonClass("quiet")}>
              Next
            </Link>
          ) : (
            <span className={buttonClass("quiet", "pointer-events-none opacity-40")}>Next</span>
          )}
        </nav>
      )}
    </>
  );
}

function pageNumber(raw: string | undefined) {
  const n = Number(String(raw ?? "1").trim());
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
}

function pageHref(q: string, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const s = params.toString();
  return s ? `/members?${s}` : "/members";
}
