import PageHeader from "@/components/PageHeader";
import { listAlumniAccounts, listAlumniInvites } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";
import { createClient } from "@/lib/supabase/server";
import { countOpenFeedback } from "@/lib/sponsor-feedback";
import Link from "next/link";

export default async function AdminHome() {
  const supabase = await createClient();
  const { DB } = await hubEnv();
  const [{ count: members }, { count: contacts }, { count: pending }, { count: sponsorInvites }, { count: apps }, alumni, alumInvites] =
    await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "member"),
      supabase.from("company_users").select("*", { count: "exact", head: true }),
      supabase.from("company_join_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("invites").select("*", { count: "exact", head: true }).eq("role", "company_user").is("accepted_at", null),
      supabase.from("applications").select("*", { count: "exact", head: true }),
      listAlumniAccounts(DB),
      listAlumniInvites(DB),
    ]);
  const openFeedback = await countOpenFeedback(DB);

  // What needs an exec first, then the rest.
  const links = [
    { href: "/admin/companies", label: "Join requests", hint: `${pending ?? 0} waiting for a decision` },
    { href: "/admin/feedback", label: "Sponsor feedback", hint: `${openFeedback} open` },
    { href: "/admin/people?tab=sponsors", label: "Sponsors", hint: `${contacts ?? 0} contacts · ${sponsorInvites ?? 0} invited, not joined` },
    { href: "/admin/people?tab=alumni", label: "Alumni", hint: `${alumni.length} joined · ${alumInvites.length} invited, not joined` },
    { href: "/admin/people?tab=members", label: "Members", hint: `${members ?? 0} signed in · managed on auth.quantt.ca` },
    { href: "/admin/applications", label: "Applications", hint: `${apps ?? 0} total` },
    { href: "/admin/posts", label: "Posts", hint: "Review, close, or write a post" },
  ];

  return (
    <>
      <PageHeader title="Admin">
        Invite sponsors and alumni on People. Approve firms and set packages on Companies.
      </PageHeader>
      <ul className="grid gap-4 md:grid-cols-2">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="group block rounded border border-line p-6 transition-colors hover:border-primary/40 hover:bg-surface">
              <p className="font-heading text-lg font-semibold text-ink group-hover:text-primary">{l.label}</p>
              <p className="mt-1 text-sm text-copy">{l.hint}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
