import { after } from "next/server";
import { notFound } from "next/navigation";

import AlumniThread from "@/components/AlumniThread";
import { GhostButton, PrimaryButton } from "@/components/Form";
import Notice from "@/components/Notice";
import { decideAlumniRequest } from "@/lib/actions/alumni";
import { requireAlumnus } from "@/lib/alumni/current";
import { getThread, markThreadRead } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ denied?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireAlumnus();
  const { DB } = await hubEnv();
  const viewer = { kind: "alumni" as const, id: me.id };
  const thread = await getThread(DB, viewer, id);
  if (!thread) notFound();
  after(() => markThreadRead(DB, viewer, id));
  return (
    <>
      <h1 className="font-heading text-2xl font-bold text-ink">{thread.member_name}</h1>
      <Notice message={sp.denied} />
      {thread.status !== "accepted" && (
        <div className="mt-4 max-w-lg border border-line bg-surface px-4 py-4">
          <p className="text-sm text-copy">
            {thread.status === "pending"
              ? `${thread.member_name} sent you a message request. Accept to start the conversation.`
              : `You declined ${thread.member_name}'s request. They can't message you unless you accept.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <form action={decideAlumniRequest}>
              <input type="hidden" name="conversation_id" value={id} />
              <input type="hidden" name="decision" value="accept" />
              <PrimaryButton type="submit">Accept</PrimaryButton>
            </form>
            {thread.status === "pending" && (
              <form action={decideAlumniRequest}>
                <input type="hidden" name="conversation_id" value={id} />
                <input type="hidden" name="decision" value="decline" />
                <GhostButton type="submit">Decline</GhostButton>
              </form>
            )}
          </div>
        </div>
      )}
      <AlumniThread
        side="alumni"
        conversationId={id}
        otherName={thread.member_name}
        messages={thread.messages}
        canSend={thread.status === "accepted"}
      />
    </>
  );
}
