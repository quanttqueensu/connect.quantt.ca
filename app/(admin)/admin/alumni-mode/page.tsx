import { Field, PrimaryButton } from "@/components/Form";
import PageHeader from "@/components/PageHeader";
import { enterAlumniMode } from "@/lib/actions/view-as";
import { listAlumniAccounts } from "@/lib/alumni/data";
import { requireCurrentProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";
import { redirect } from "next/navigation";

/** Pick an alum to view the alumni area as (the twin of Sponsor mode). */
export default async function AlumniModePage() {
  const profile = await requireCurrentProfile();
  if (!profile.is_admin) redirect("/feed");
  const alumni = await listAlumniAccounts((await hubEnv()).DB);
  return (
    <>
      <PageHeader title="Alum view">Alumni area as the chosen alum sees it. Same pages and data. Read-only.</PageHeader>
      {alumni.length === 0 ? (
        <p className="text-sm text-copy">No alumni have joined yet.</p>
      ) : (
        <form action={enterAlumniMode} className="flex max-w-xl flex-col gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="Alum">
              <select name="alumni_id" required defaultValue={alumni[0].id} className="min-h-11 w-full rounded px-3 py-2 text-sm">
                {alumni.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}
                    {a.grad_year ? ` · Class of ${a.grad_year}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <PrimaryButton type="submit">View as alum</PrimaryButton>
        </form>
      )}
    </>
  );
}
