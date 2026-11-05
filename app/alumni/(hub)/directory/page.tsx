import AlumniDirectory from "@/components/AlumniDirectory";
import PageHeader from "@/components/PageHeader";
import { requireAlumnus } from "@/lib/alumni/current";
import { listAlumni } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniDirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAlumnus();
  const q = String((await searchParams).q ?? "").trim().slice(0, 80);
  const alumni = await listAlumni((await hubEnv()).DB, q);
  return (
    <>
      <PageHeader title="Alumni" />
      <AlumniDirectory alumni={alumni} q={q} />
    </>
  );
}
