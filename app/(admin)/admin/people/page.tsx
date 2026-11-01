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
          <li key={p.email} className="border-t border-line py-3 text-sm text-ink">
            {p.full_name}{" "}
            <span className="text-copy">
              {p.email}
              {p.is_admin ? " · admin" : ""}
            </span>
          </li>
        ))}
      </ul>
      {!(people ?? []).length && <p className="text-sm text-copy">No members yet.</p>}
    </>
  );
}
