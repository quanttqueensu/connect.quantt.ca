import Link from "next/link";
import { redirect } from "next/navigation";

import AlumniDirectory from "@/components/AlumniDirectory";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { startAlumniConversation } from "@/lib/actions/alumni";
import { listAlumni } from "@/lib/alumni/data";
import { getCurrentProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniNetworkPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; denied?: string }>;
}) {
  const sp = await searchParams;
  const me = await getCurrentProfile();
  if (!me) redirect("/login");
  if (me.role !== "member") redirect("/company");
  const q = String(sp.q ?? "").trim().slice(0, 80);
  const { DB } = await hubEnv();
  const alumni = await listAlumni(DB, q);
  return (
    <>
      <PageHeader title="Alumni">
        {me.is_admin
          ? "QUANTT alumni. As an admin you can message any alum directly."
          : "QUANTT alumni. Send any alum a message request; once they accept, message freely."}
      </PageHeader>
      <Notice message={sp.denied} />

      <p className="mb-6 text-sm text-copy">
        Alumni jobs and mentorship are on{" "}
        <Link href="/opportunities?view=alumni" className="font-medium text-primary hover:underline">
          Opportunities
        </Link>
        . Your alumni chats are in{" "}
        <Link href="/messages" className="font-medium text-primary hover:underline">
          Messages
        </Link>
        .
      </p>

      <section>
        <h2 className="mb-4 font-heading text-lg font-bold text-ink">Alumni directory</h2>
        <AlumniDirectory alumni={alumni} q={q} messageAction={startAlumniConversation} />
      </section>
    </>
  );
}
