import Link from "next/link";
import { DangerButton, PrimaryButton } from "@/components/Form";
import { reviewJoinRequest } from "@/lib/actions/admin";
import { loadTiers } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import type { JoinRequest } from "@/lib/types";

type QueueRequest = Pick<JoinRequest, "id" | "company_name" | "contact_name" | "contact_email" | "note">;

/**
 * Pending sponsor join requests (from /join), shown at the top of Admin →
 * Companies so approving a firm and managing it happen in one place.
 * Renders nothing when there are none.
 */
export default async function JoinRequestQueue({ rawPage }: { rawPage?: string }) {
  const page = Math.min(10000, Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1));
  const pageSize = 25;
  const supabase = await createClient();
  const [{ data: requests, error: requestsError }, tiers] = await Promise.all([
    supabase.from("company_join_request_queue").select("*").eq("status", "pending").order("created_at").order("id").range((page - 1) * pageSize, page * pageSize),
    loadTiers(),
  ]);

  if (!requestsError && !(requests ?? []).length && page === 1) return null;
  return (
    <section className="mb-6 border border-line px-4 py-3">
      <h2 className="mb-1 font-heading text-lg font-bold text-ink">Join requests ({(requests ?? []).length > pageSize ? `${pageSize}+` : (requests ?? []).length})</h2>
      <ul>
        {(requests as QueueRequest[] | null)?.slice(0, pageSize).map((r) => (
          <li key={r.id} className="min-w-0 border-t border-line py-5 [overflow-wrap:anywhere]">
            <p className="text-ink">{r.company_name}</p>
            <p className="text-sm text-muted">
              {r.contact_name} · {r.contact_email}
            </p>
            {r.note && <p className="mt-2 text-sm text-copy">{r.note}</p>}
            <div className="mt-4 grid gap-3 sm:flex sm:flex-wrap sm:items-end">
              <form action={reviewJoinRequest} className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="decision" value="approved" />
                <select
                  name="sponsor_tier_id"
                  required
                  aria-label={`Package for ${r.company_name}`}
                  className="rounded px-3 py-2 text-sm"
                  defaultValue=""
                >
                  <option value="">Choose a package</option>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <PrimaryButton type="submit">Approve request</PrimaryButton>
              </form>
              <form action={reviewJoinRequest}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="decision" value="rejected" />
                <DangerButton type="submit" className="w-full sm:w-auto">Reject request</DangerButton>
              </form>
            </div>
          </li>
        ))}
      </ul>
      {!requestsError && <nav className="mt-6 flex gap-6 text-sm" aria-label="Request pages">
        {page > 1 && <Link href={`/admin/companies?rpage=${page - 1}`}>Previous</Link>}
        {(requests ?? []).length > pageSize && <Link href={`/admin/companies?rpage=${page + 1}`}>Next</Link>}
      </nav>}
      {requestsError && <p role="alert" className="text-sm text-copy">Join requests could not be loaded. Try again.</p>}
    </section>
  );
}
