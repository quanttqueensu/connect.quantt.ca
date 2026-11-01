import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { buttonClass } from "@/components/Form";

export default async function PeoplePage() {
  const supabase = await createClient();
  const { data: people } = await supabase
    .from("profiles")
    .select("full_name, email, role, is_admin")
    .eq("role", "member")
    .order("full_name");

  return (
    <>
      <PageHeader kicker="Roster" title="People">
        Club members and execs who have already joined.
      </PageHeader>
      <div className="mb-6">
        <Link href="/admin/invite" className={buttonClass("primary")}>
          Invite a member
        </Link>
      </div>
      <ul>
        {(people ?? []).map((p) => (
          <li key={p.email} className="border-t border-white/10 py-3 text-sm text-white/80">
            {p.full_name}{" "}
            <span className="text-white/60">
              {p.email}
              {p.is_admin ? " · admin" : ""}
            </span>
          </li>
        ))}
      </ul>
      {!(people ?? []).length && <p className="text-sm text-white/60">No members yet.</p>}
    </>
  );
}
