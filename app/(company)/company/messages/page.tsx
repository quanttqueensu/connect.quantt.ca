import { DEMO_CONVERSATIONS } from "@/lib/sponsor-demo";
import { getCompanyContext } from "@/lib/sponsor-mode";
import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import type { Conversation } from "@/lib/types";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function CompanyMessagesPage() {
  const supabase = await createClient();
  const cu = await getCompanyContext();
  if (!cu) redirect("/company");
  const { data: convos } = cu.preview ? { data: DEMO_CONVERSATIONS } : await supabase
    .from("conversations")
    .select("*, profiles(full_name)")
    .eq("company_id", cu.company_id)
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader kicker="Inbox" title="Messages" />
      <ul>
        {(convos as Conversation[] | null)?.map((c) => (
          <li key={c.id} className="border-t border-line">
            <Link
              href={`/company/messages/${c.id}`}
              className="block py-4 text-ink hover:text-primary"
            >
              {c.profiles?.full_name ?? "Member"}
            </Link>
          </li>
        ))}
      </ul>
      {!(convos ?? []).length && (
        <p className="text-sm text-copy">
          No threads yet. Members can start a conversation from any of your posts.
        </p>
      )}
    </>
  );
}
