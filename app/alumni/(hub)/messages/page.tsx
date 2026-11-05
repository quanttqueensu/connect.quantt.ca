import AlumniInbox from "@/components/AlumniInbox";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { requireAlumnus } from "@/lib/alumni/current";
import { listConversations } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; declined?: string }>;
}) {
  const sp = await searchParams;
  const me = await requireAlumnus();
  const conversations = await listConversations((await hubEnv()).DB, { kind: "alumni", id: me.id });
  const requests = conversations.filter((c) => c.status === "pending");
  const open = conversations.filter((c) => c.status !== "pending");
  return (
    <>
      <PageHeader title="Messages" />
      <Notice message={sp.denied} />
      {sp.declined && <p className="mb-6 text-sm text-copy">Request declined.</p>}
      {requests.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 font-heading text-lg font-bold text-ink">Message requests</h2>
          <AlumniInbox side="alumni" conversations={requests} base="/alumni/messages" empty="" />
        </section>
      )}
      <AlumniInbox
        side="alumni"
        conversations={open}
        base="/alumni/messages"
        empty="No conversations yet. Message a member from Members."
      />
    </>
  );
}
