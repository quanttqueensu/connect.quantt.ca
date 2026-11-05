import { redirect } from "next/navigation";

import AlumniDirectory from "@/components/AlumniDirectory";
import AlumniInbox from "@/components/AlumniInbox";
import AlumniPostList from "@/components/AlumniPostList";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { startAlumniConversation } from "@/lib/actions/alumni";
import { listAlumni, listAlumniPosts, listConversations } from "@/lib/alumni/data";
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
  const [posts, alumni, conversations] = await Promise.all([
    listAlumniPosts(DB),
    listAlumni(DB, q),
    listConversations(DB, { kind: "member", id: me.id }),
  ]);
  return (
    <>
      <PageHeader title="Alumni">
        Jobs and mentorship from QUANTT alumni. Send any alum a message request; once they accept, message freely.
      </PageHeader>
      <Notice message={sp.denied} />

      <section>
        <h2 className="mb-4 font-heading text-lg font-bold text-ink">Opportunities from alumni</h2>
        <AlumniPostList
          posts={posts}
          empty="No alumni posts yet."
          action={(p) => (
            <form action={startAlumniConversation}>
              <input type="hidden" name="side" value="member" />
              <input type="hidden" name="alumni_id" value={p.alumni_id} />
              <button type="submit" className="text-sm font-medium text-primary hover:underline">
                Message {p.author_name}
              </button>
            </form>
          )}
        />
      </section>

      {conversations.length > 0 && (
        <section className="mt-6 border-t border-line pt-5">
          <h2 className="mb-2 font-heading text-lg font-bold text-ink">Your alumni conversations</h2>
          <AlumniInbox side="member" conversations={conversations} base="/alumni-network/messages" empty="" />
        </section>
      )}

      <section className="mt-6 border-t border-line pt-5">
        <h2 className="mb-4 font-heading text-lg font-bold text-ink">Alumni directory</h2>
        <AlumniDirectory alumni={alumni} q={q} messageAction={startAlumniConversation} />
      </section>
    </>
  );
}
