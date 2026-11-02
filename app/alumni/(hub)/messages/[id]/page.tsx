import { after } from "next/server";
import { notFound } from "next/navigation";

import AlumniThread from "@/components/AlumniThread";
import Notice from "@/components/Notice";
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
      <AlumniThread side="alumni" conversationId={id} otherName={thread.member_name} messages={thread.messages} />
    </>
  );
}
