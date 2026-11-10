import AlumniInbox from "@/components/AlumniInbox";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { listConversations } from "@/lib/alumni/data";
import { getCurrentProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";
import { createClient } from "@/lib/supabase/server";
import { one, type Conversation } from "@/lib/types";
import Link from "next/link";
import { redirect } from "next/navigation";

type InboxRow = Conversation & {
  messages?: { created_at: string } | { created_at: string }[] | null;
};

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const sp = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const { data: convos, error: convosError } = await supabase
    .from("conversations")
    .select("*, companies(name), messages(created_at)")
    .eq("member_id", profile.id)
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" });
  if (convosError) {
    console.error("messages: query failed", convosError.message);
  }
  // Members' chats with alumni live in their own tables (lib/alumni/data.ts); companies can't have any.
  const alumniConvos =
    profile.role === "member" ? await listConversations((await hubEnv()).DB, { kind: "member", id: profile.id }) : [];

  const rows = ((convos as InboxRow[] | null) ?? [])
    .map((c) => {
      const last = one(
        c.messages as { created_at: string } | { created_at: string }[] | null,
      )?.created_at;
      return {
        id: c.id,
        name: one(c.companies)?.name ?? "Company",
        lastAt: last ?? c.created_at,
        unread: Boolean(last && (!c.member_last_read_at || last > c.member_last_read_at)),
      };
    })
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));

  return (
    <>
      <PageHeader title="Messages" />
      <Notice message={sp.denied} />
      {alumniConvos.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 font-heading text-lg font-bold text-ink">Alumni</h2>
          <AlumniInbox side="member" conversations={alumniConvos} base="/alumni-network/messages" empty="" />
        </section>
      )}
      {alumniConvos.length > 0 && rows.length > 0 && (
        <h2 className="mb-2 font-heading text-lg font-bold text-ink">Companies</h2>
      )}
      {convosError ? (
        <p className="text-sm text-copy">Messages could not be loaded. Try again.</p>
      ) : (
        <>
          <ul>
            {rows.map((c) => (
              <li key={c.id} className="border-t border-line">
                <Link
                  href={`/messages/${c.id}`}
                  className="block py-4 text-ink hover:text-primary"
                >
                  <span className={c.unread ? "font-medium text-ink" : undefined}>
                    {c.name}
                  </span>
                  {c.unread && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-primary">
                      New
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {rows.length === 0 && alumniConvos.length === 0 && (
            <p className="text-sm text-copy">No threads yet. Message a company from a post, or an alum from Alumni.</p>
          )}
        </>
      )}
    </>
  );
}
