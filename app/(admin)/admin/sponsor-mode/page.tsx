import PageHeader from "@/components/PageHeader";
import SponsorModeToggle from "@/components/SponsorModeToggle";
import { requireCurrentProfile } from "@/lib/auth";
import { sponsorModeCompanyId } from "@/lib/sponsor-mode";
import { redirect } from "next/navigation";

export default async function SponsorModePage() {
  const profile = await requireCurrentProfile();
  if (!profile.is_admin) redirect("/feed");
  const active = Boolean(await sponsorModeCompanyId(profile));
  return (
    <>
      <PageHeader kicker="Admin" title="Sponsor mode">
        Explore the sponsor experience using a fictional company and sample posts, candidates,
        and messages. No real sponsor or member information is shown. Changes cannot be saved.
      </PageHeader>
      <SponsorModeToggle active={active} />
    </>
  );
}
