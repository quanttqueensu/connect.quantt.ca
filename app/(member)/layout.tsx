import type { ReactNode } from "react";
import HubNav from "@/components/HubNav";
import { requireCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/types";
import { redirect } from "next/navigation";

export default async function MemberLayout({ children }: { children: ReactNode }) {
  const profile = await requireCurrentProfile();
  if (profile.role === "company_user") redirect("/company");

  const supabase = await createClient();
  // Only the single newest message per conversation, ordered explicitly.
  // PostgREST turns this into a lateral join limited to one row per row of the
  // parent, so the cost tracks the number of conversations, not the number of
  // messages, and the "latest" row is actually the latest.
  const { data: convos } = await supabase
    .from("conversations")
    .select("id, member_last_read_at, messages(created_at)")
    .eq("member_id", profile.id)
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" });

  const unread = (convos ?? []).filter((c) => {
    const last = one(
      c.messages as { created_at: string } | { created_at: string }[] | null,
    )?.created_at;
    if (!last) return false;
    return !c.member_last_read_at || last > c.member_last_read_at;
  }).length;

  return (
    <>
      <HubNav profile={profile} unread={unread} />
      <main className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-14">{children}</main>
    </>
  );
}
