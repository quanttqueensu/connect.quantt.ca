import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import ManualInviteBanner from "@/components/ManualInviteBanner";
import { DangerButton, PrimaryButton } from "@/components/Form";
import { readManualInvite, reviewJoinRequest } from "@/lib/actions/admin";
import { loadTiers } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import type { JoinRequest } from "@/lib/types";

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ manual?: string; denied?: string }>;
}) {
  const { manual, denied } = await searchParams;
  const setup = manual ? await readManualInvite() : null;
  const supabase = await createClient();
  const [{ data: requests }, tiers] = await Promise.all([
    supabase.from("company_join_requests").select("*").eq("status", "pending").order("created_at"),
    loadTiers(),
  ]);

  return (
    <>
      <PageHeader kicker="Queue" title="Join requests" />
      <Notice message={denied} />
      {setup && <ManualInviteBanner email={setup.email} password={setup.password} />}
      <ul>
        {(requests as JoinRequest[] | null)?.map((r) => (
          <li key={r.id} className="border-t border-white/10 py-5">
            <p className="text-white">{r.company_name}</p>
            <p className="text-sm text-white/50">
              {r.contact_name} · {r.contact_email}
            </p>
            {r.note && <p className="mt-2 text-sm text-white/60">{r.note}</p>}
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
      {!(requests ?? []).length && <p className="text-sm text-white/60">No pending requests.</p>}
    </>
  );
}
