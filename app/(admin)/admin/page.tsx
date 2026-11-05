import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function AdminHome() {
  const supabase = await createClient();
  const [{ count: members }, { count: pending }, { count: apps }] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "member"),
    supabase
      .from("company_join_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase.from("applications").select("*", { count: "exact", head: true }),
  ]);

  const links = [
    { href: "/admin/invite", label: "Invite", hint: "Members, execs, and company contacts" },
    { href: "/admin/people", label: "People", hint: `${members ?? 0} members` },
    { href: "/admin/companies", label: "Companies", hint: "Sponsors, firms, and the /join link" },
    { href: "/admin/tiers", label: "Tiers", hint: "Reprice packages and grant functionality" },
    { href: "/admin/requests", label: "Join requests", hint: `${pending ?? 0} pending` },
    { href: "/admin/applications", label: "Applications", hint: `${apps ?? 0} total` },
    { href: "/admin/posts", label: "Posts", hint: "Review, close, or write a post" },
  ];

  return (
    <>
      <PageHeader title="Admin">
        This panel is only for execs. Invite people, approve firms, and post to the club feed.
        Use Member area in the nav to go back to the member area.
      </PageHeader>
      <ul className="grid gap-4 md:grid-cols-2">
        {links.map((l) => (
          <li key={l.href}>
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
