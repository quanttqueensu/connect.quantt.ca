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
  const viewer = { kind: "member" as const, id: me.id, admin: Boolean(me.is_admin) };
  const thread = await getThread(DB, viewer, id);
  if (!thread) notFound();
  // Admins message alumni without a request, so the request notes don't apply.
  const status = viewer.admin ? "accepted" : thread.status;
  after(() => markThreadRead(DB, viewer, id));
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
        <Link href="/alumni-network" className="hover:underline">Alumni</Link>
      </p>
      <h1 className="mt-2 font-heading text-2xl font-bold text-ink">{thread.alumni_name}</h1>
      <Notice message={sp.denied} />
      {status === "pending" && (
        <p className="mt-4 max-w-lg border border-line bg-surface px-4 py-3 text-sm text-copy">
          Request sent. You can send more messages once {thread.alumni_name} accepts.
        </p>
      )}
      {status === "declined" && (
        <p className="mt-4 max-w-lg border border-line bg-surface px-4 py-3 text-sm text-copy">
          {thread.alumni_name} declined this request.
        </p>
      )}
      <AlumniThread
        side="member"
        conversationId={id}
        otherName={thread.alumni_name}
        messages={thread.messages}
        canSend={status === "accepted"}
      />
    </>
  );
}
