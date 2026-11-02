import PageHeader from "@/components/PageHeader";
import { Field, PrimaryButton } from "@/components/Form";
import { requireCurrentProfile } from "@/lib/auth";
import { enterSponsorMode } from "@/lib/actions/sponsor-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Company } from "@/lib/types";
import { redirect } from "next/navigation";

export default async function SponsorModePage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const profile = await requireCurrentProfile();
  if (!profile.is_admin) redirect("/feed");
  const { company: preselect } = await searchParams;
  // Service client: in sponsor mode this request reads as one sponsor, but
  // the picker must list every company. Only admins get here (checked above).
  const admin = createAdminClient();
  const [{ data }, { data: tiers }] = await Promise.all([
    admin.from("companies").select("*").order("name"),
    admin.from("sponsor_tiers").select("id, name"),
  ]);
  const companies = (data as Company[] | null) ?? [];
  const tierName = new Map(((tiers as { id: string; name: string }[] | null) ?? []).map((t) => [t.id, t.name]));

  return (
    <>
      <PageHeader kicker="Admin" title="Sponsor mode">
        Company view. Same pages, package, overrides and data. Read-only.
      </PageHeader>
      {companies.length === 0 ? (
        <p className="text-sm text-copy">No companies yet.</p>
      ) : (
        <form action={enterSponsorMode} className="flex max-w-xl flex-col gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="Company">
              <select
                name="company_id"
                required
                defaultValue={companies.some((c) => c.id === preselect) ? preselect : companies[0].id}
                className="min-h-11 w-full rounded px-3 py-2 text-sm"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {tierName.get(c.sponsor_tier_id) ?? "No package"}
                    {c.status === "active" ? "" : ` · ${c.status}`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <PrimaryButton type="submit">View as sponsor</PrimaryButton>
        </form>
      )}
    </>
  );
}
