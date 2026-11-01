import type { ReactNode } from "react";
import HubNav from "@/components/HubNav";
import { requireCurrentProfile } from "@/lib/auth";
import { graceIsOpen, loadMyCompanyTier } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function CompanyLayout({ children }: { children: ReactNode }) {
  const profile = await requireCurrentProfile();
  if (profile.role !== "company_user") redirect("/feed");

  const supabase = await createClient();
  const { data: cu } = await supabase
    .from("company_users")
    .select("company_id")
    .eq("profile_id", profile.id)
    .maybeSingle();

  let unread = 0;
  let graceUntil: string | null = null;
  let assignedName: string | null = null;
  let companyCaps: string[] = [];
  if (cu) {
    // Only the single newest message per conversation, ordered explicitly, so
    // the cost tracks conversations rather than total message volume.
    const { data: convos } = await supabase
      .from("conversations")
      .select("id, company_last_read_at, messages(created_at)")
      .eq("company_id", cu.company_id)
      .order("created_at", { referencedTable: "messages", ascending: false })
      .limit(1, { referencedTable: "messages" });
    unread = (convos ?? []).filter((c) => {
      const last = (c.messages as { created_at: string }[] | null)?.[0]?.created_at;
      if (!last) return false;
      return !c.company_last_read_at || last > c.company_last_read_at;
    }).length;

    const { assigned, access, graceUntil: until } = await loadMyCompanyTier(cu.company_id);
    graceUntil = until ?? null;
    assignedName = assigned?.name ?? null;
    companyCaps = (access?.sponsor_tier_capabilities ?? []).map((c) => c.capability);
  }

  const showGrace = graceIsOpen(graceUntil);

  return (
    <>
      <HubNav profile={profile} unread={unread} companyCaps={companyCaps} />
      {showGrace && graceUntil && (
        <div className="border-b border-primary/20 bg-primary/5 px-5 py-3 text-center text-xs text-ink">
          Your access is grandfathered until {formatDate(`${graceUntil}T12:00:00`)}. From then, your{" "}
          {assignedName ?? "assigned"} package applies.{" "}
          <Link href="/company/sponsorship" className="underline">
            See what changes
          </Link>
          .
        </div>
      )}
      <main className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-14">{children}</main>
    </>
  );
}
