import { redirect } from "next/navigation";
import FeedbackPanel from "@/components/FeedbackPanel";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { sendSponsorFeedback } from "@/lib/actions/feedback";
import { hubEnv } from "@/lib/hub/env";
import { getCompanyContext } from "@/lib/sponsor-mode";
import { listCompanyFeedback } from "@/lib/sponsor-feedback";

/**
 * Sponsors send requests and feedback to the QUANTT team. Only Connect admins
 * read them (Admin → Feedback); this firm sees its own list. Read-only in
 * sponsor mode.
 */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ denied?: string; sent?: string }> }) {
  const sp = await searchParams;
  const cu = await getCompanyContext();
  if (!cu) redirect("/company");
  const items = await listCompanyFeedback((await hubEnv()).DB, cu.company_id);

  return (
    <>
      <PageHeader title="Feedback">Requests and feedback for the QUANTT team. Only QUANTT admins see these.</PageHeader>
      <Notice message={sp.denied} />
      {sp.sent && <p className="mb-6 text-sm text-primary">Sent. The QUANTT team will follow up by email.</p>}
      <FeedbackPanel action={sendSponsorFeedback} items={items} listTitle={`Sent by ${cu.company.name}`} readOnly={cu.preview} />
    </>
  );
}
