import FeedbackPanel from "@/components/FeedbackPanel";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { sendAlumniFeedback } from "@/lib/actions/feedback";
import { requireAlumnus } from "@/lib/alumni/current";
import { hubEnv } from "@/lib/hub/env";
import { listAlumniFeedback } from "@/lib/sponsor-feedback";

/** Alumni send requests and feedback; only Connect admins read them (Admin → Feedback). Read-only in alumni mode. */
export default async function AlumniFeedbackPage({ searchParams }: { searchParams: Promise<{ denied?: string; sent?: string }> }) {
  const sp = await searchParams;
  const me = await requireAlumnus();
  const items = await listAlumniFeedback((await hubEnv()).DB, me.id);
  return (
    <>
      <PageHeader title="Feedback">Requests and feedback for the QUANTT team. Only QUANTT admins see these.</PageHeader>
      <Notice message={sp.denied} />
      {sp.sent && <p className="mb-6 text-sm text-primary">Sent. The QUANTT team will follow up by email.</p>}
      <FeedbackPanel action={sendAlumniFeedback} items={items} listTitle="Sent by you" readOnly={me.preview} />
    </>
  );
}
