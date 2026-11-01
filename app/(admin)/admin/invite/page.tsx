import PageHeader from "@/components/PageHeader";
import InviteForm from "@/components/InviteForm";
import Notice from "@/components/Notice";
import { loadTiers } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import type { Company } from "@/lib/types";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; denied?: string; unsent?: string; kind?: string }>;
}) {
  const { sent, denied, unsent, kind } = await searchParams;
  const supabase = await createClient();
  const [{ data: companies }, { data: pending }, tiers] = await Promise.all([
    supabase.from("companies").select("id, name").eq("status", "active").order("name"),
    supabase
      .from("invites")
      .select("email, full_name, role, is_admin, created_at, companies(name)")
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
    loadTiers(),
  ]);

  const initialKind =
    kind === "admin" || kind === "company" || kind === "member" ? kind : "member";

  return (
    <>
      <PageHeader kicker="Access" title="Invite someone">
        Pick whether they’re a club member, an exec admin, or a company contact. We’ll email them
        to say they can sign in at connect.quantt.ca with that address.
      </PageHeader>
      <Notice message={denied} />
      {unsent && (
        <p className="mb-6 border-l-2 border-primary pl-4 text-sm text-copy">
          The invite is saved, but the email didn’t send. Tell them to sign in at
          connect.quantt.ca/login with the address you entered; they’ll get a code there.
        </p>
      )}
      <InviteForm
        companies={(companies as Pick<Company, "id" | "name">[] | null) ?? []}
        tiers={tiers.map((t) => ({ id: t.id, name: t.name }))}
        initialKind={initialKind}
        sent={Boolean(sent)}
      />
      <section className="mt-14">
        <h2 className="font-heading text-lg font-bold text-ink">Waiting to join</h2>
        {!(pending ?? []).length ? (
          <p className="mt-3 text-sm text-copy">No outstanding invites.</p>
        ) : (
          <ul className="mt-4">
            {(pending ?? []).map((invite) => {
              const companyName = Array.isArray(invite.companies)
                ? invite.companies[0]?.name
                : (invite.companies as { name: string } | null)?.name;
              const kindLabel = invite.role === "company_user"
                ? companyName
                  ? `Company · ${companyName}`
                  : "Company"
                : invite.is_admin
                  ? "Exec admin"
                  : "Club member";
              return (
                <li
                  key={invite.email}
                  className="border-t border-line py-3 text-sm text-ink"
                >
                  {invite.full_name}{" "}
                  <span className="text-copy">
                    {invite.email} · {kindLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
