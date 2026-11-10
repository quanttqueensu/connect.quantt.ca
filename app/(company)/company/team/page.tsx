import { redirect } from "next/navigation";
import { Field, PrimaryButton, TextInput } from "@/components/Form";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { inviteColleague } from "@/lib/actions/company";
import { MAX_COMPANY_CONTACTS } from "@/lib/company-team";
import { getCompanyContext } from "@/lib/sponsor-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/time";

/**
 * The firm's own contacts on Connect, and a form to invite a colleague at the
 * same email domain (lib/actions/company.ts inviteColleague). Read-only in
 * sponsor mode. The company comes from the viewer's own company_users row
 * (or the sponsor-mode pick), never from the URL.
 */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; sent?: string; unsent?: string }>;
}) {
  const sp = await searchParams;
  const cu = await getCompanyContext();
  if (!cu) redirect("/company");
  // company_users and invites are admin-only tables; scoped to this one company here.
  const admin = createAdminClient();
  const [{ data: contacts }, { data: invites }] = await Promise.all([
    admin.from("company_users").select("profiles(full_name, email)").eq("company_id", cu.company_id),
    admin
      .from("invites")
      .select("email, full_name, created_at")
      .eq("company_id", cu.company_id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);
  type P = { full_name: string; email: string };
  const people = ((contacts as { profiles: P | P[] | null }[] | null) ?? [])
    .map((c) => (Array.isArray(c.profiles) ? c.profiles[0] : c.profiles))
    .filter((p): p is P => Boolean(p))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const pending = (invites as { email: string; full_name: string; created_at: string }[] | null) ?? [];
  const full = people.length + pending.length >= MAX_COMPANY_CONTACTS;

  return (
    <>
      <PageHeader title="Team">People at {cu.company.name} who can use Connect.</PageHeader>
      <Notice message={sp.denied} />
      {sp.sent && <p className="mb-6 text-sm text-primary">Invite sent. They sign in at connect.quantt.ca with that address.</p>}
      {sp.unsent && (
        <p className="mb-6 border-l-2 border-primary pl-4 text-sm text-copy">
          The invite is saved, but the email didn’t send. Tell them to sign in at connect.quantt.ca/login with that
          address; they’ll get a code there.
        </p>
      )}

      <ul>
        {people.map((p) => (
          <li key={p.email} className="border-t border-line py-3 text-sm text-ink [overflow-wrap:anywhere]">
            {p.full_name} <span className="text-copy">{p.email}</span>
          </li>
        ))}
        {pending.map((i) => (
          <li key={i.email} className="border-t border-line py-3 text-sm text-ink [overflow-wrap:anywhere]">
            {i.full_name}{" "}
            <span className="text-copy">
              {i.email} · invited {formatDate(i.created_at)}
            </span>
          </li>
        ))}
      </ul>

      <section className="mt-6 max-w-xl border-t border-line pt-5">
        <h2 className="font-heading text-lg font-bold text-ink">Invite a colleague</h2>
        <p className="mt-1 text-sm text-copy">
          They must use an address at your firm’s email domain. Up to {MAX_COMPANY_CONTACTS} people per firm, including
          invites.
        </p>
        {full ? (
          <p className="mt-4 text-sm text-copy">Your firm is at the limit. Ask a QUANTT exec to add more.</p>
        ) : (
          <form action={inviteColleague} className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Full name">
              <TextInput name="full_name" required maxLength={120} autoComplete="off" disabled={cu.preview} />
            </Field>
            <Field label="Work email">
              <TextInput name="email" type="email" required maxLength={254} autoComplete="off" disabled={cu.preview} />
            </Field>
            <div>
              <PrimaryButton type="submit" disabled={cu.preview}>
                Send invite
              </PrimaryButton>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
