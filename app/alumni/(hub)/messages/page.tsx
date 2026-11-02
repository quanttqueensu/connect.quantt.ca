import AlumniInbox from "@/components/AlumniInbox";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { requireAlumnus } from "@/lib/alumni/current";
import { listConversations } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniMessagesPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const sp = await searchParams;
  const me = await requireAlumnus();
  const conversations = await listConversations((await hubEnv()).DB, { kind: "alumni", id: me.id });
  return (
    <>
      <PageHeader kicker="Inbox" title="Messages" />
      <Notice message={sp.denied} />
      <AlumniInbox
        conversations={conversations}
        base="/alumni/messages"
        empty="No conversations yet. Message a member from Members."
      />
    </>
  );
}
