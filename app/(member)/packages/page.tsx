import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { Field, FileInput, PrimaryButton, QuietButton, QuietDangerButton, TextArea, TextInput } from "@/components/Form";
import { createPackage, deletePackage, setDefaultPackage } from "@/lib/actions/packages";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { HiringPackage } from "@/lib/types";
import { redirect } from "next/navigation";

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const sp = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const { data: packages, error: packagesError } = await supabase
    .from("hiring_packages")
    .select("*")
    .eq("member_id", profile.id)
    .order("created_at", { ascending: false });
  if (packagesError) {
    console.error("packages: query failed", packagesError.message);
  }

  const rows = (packages as HiringPackage[] | null) ?? [];

  return (
    <>
      <PageHeader kicker="Apply" title="Hiring packages">
        A package is resume + LinkedIn, with an optional default cover letter. You can change
        package and cover letter on each in-app job.
      </PageHeader>
      <Notice message={sp.denied} />
      {packagesError ? (
        <p className="border border-white/10 p-6 text-sm text-white/60">
          Hiring packages could not be loaded. Try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="border border-white/10 p-6 text-sm text-white/60">
          You have no hiring packages yet. Build your first one with the form below — you
          need at least one before you can apply to an in-app job.
        </p>
      ) : null}
      <ul className="space-y-4">
        {rows.map((pkg) => (
          <li key={pkg.id} className="border-t border-white/10 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <p className="text-white">
                  {pkg.name}{" "}
                  {pkg.is_default && (
                    <span className="text-[10px] uppercase tracking-wider text-blue-light">
                      Default
                    </span>
                  )}
                </p>
                <p className="text-sm text-white/60">{pkg.linkedin_url}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {!pkg.is_default && (
                  <form action={setDefaultPackage}>
                    <input type="hidden" name="id" value={pkg.id} />
                    <QuietButton type="submit">Make default</QuietButton>
                  </form>
                )}
                <form action={deletePackage}>
                  <input type="hidden" name="id" value={pkg.id} />
                  <QuietDangerButton type="submit">Delete package</QuietDangerButton>
                </form>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <form action={createPackage} encType="multipart/form-data" className="mt-10 max-w-lg space-y-4">
        <h2 className="font-heading text-lg font-bold text-white">New package</h2>
        <Field label="Name">
          <TextInput name="name" required placeholder="Quant Research" maxLength={120} />
        </Field>
        <Field label="LinkedIn URL">
          <TextInput
            name="linkedin_url"
            required
            defaultValue={profile.linkedin_url ?? ""}
            maxLength={500}
          />
        </Field>
        <Field label="Resume PDF">
          <FileInput name="resume" accept="application/pdf" required />
        </Field>
        <Field label="Default cover letter (optional)">
          <TextArea name="cover_letter" rows={5} maxLength={4000} />
        </Field>
        <Field label="Default cover PDF (optional)">
          <FileInput name="cover_pdf" accept="application/pdf" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" name="is_default" />
          Make this my default package
        </label>
        <PrimaryButton type="submit">Create hiring package</PrimaryButton>
      </form>
    </>
  );
}
