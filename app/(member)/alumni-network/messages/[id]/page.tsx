import { after } from "next/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import AlumniThread from "@/components/AlumniThread";
import Notice from "@/components/Notice";
import { getThread, markThreadRead } from "@/lib/alumni/data";
import { getCurrentProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";

export default async function MemberAlumniThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ denied?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getCurrentProfile();
  if (!me) redirect("/login");
  if (me.role !== "member") redirect("/company");
  const { DB } = await hubEnv();
  const viewer = { kind: "member" as const, id: me.id };
  const thread = await getThread(DB, viewer, id);
  if (!thread) notFound();
  after(() => markThreadRead(DB, viewer, id));
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
        <Link href="/alumni-network" className="hover:underline">Alumni</Link>
      </p>
      <h1 className="mt-2 font-heading text-2xl font-bold text-ink">{thread.alumni_name}</h1>
      <Notice message={sp.denied} />
      <AlumniThread side="member" conversationId={id} otherName={thread.alumni_name} messages={thread.messages} />
    </>
  );
}
