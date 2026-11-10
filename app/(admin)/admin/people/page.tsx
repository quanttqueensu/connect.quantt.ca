import Link from "next/link";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { buttonClass, QuietButton } from "@/components/Form";
import InviteForm from "@/components/InviteForm";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { removeAlumniAction } from "@/lib/actions/alumni";
import { listAlumniAccounts, listAlumniInvites } from "@/lib/alumni/data";
import { pushConnectAlumni } from "@/lib/alumni/directory-push";
import { hubEnv } from "@/lib/hub/env";
import { createClient } from "@/lib/supabase/server";
import { loadTiers } from "@/lib/tiers";
import { formatDate } from "@/lib/time";
import type { Company } from "@/lib/types";

/**
 * Everyone who can use Connect, in one place: members (from auth.quantt.ca),
 * sponsor contacts and alumni, with one invite form. Replaces the separate
 * Invite and Alumni admin pages, which now redirect here.
 */
type Tab = "members" | "sponsors" | "alumni";
type Named = { name: string } | { name: string }[] | null;
const one = (v: Named) => (Array.isArray(v) ? v[0] : v);

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; denied?: string; sent?: string; unsent?: string; invite?: string }>;
}) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "sponsors" || sp.tab === "alumni" ? sp.tab : "members";
  const supabase = await createClient();
  const { DB, AUTH } = await hubEnv();

  const [{ data: members }, { data: contacts }, { data: pendingSponsors }, { data: companies }, tiers, alumInvites, alumni] =
    await Promise.all([
      supabase.from("profiles").select("id, full_name, email, is_admin").eq("role", "member").order("full_name"),
      supabase.from("company_users").select("company_id, profiles(full_name, email), companies(name)"),
      supabase
        .from("invites")
        .select("email, full_name, created_at, companies(name)")
        .eq("role", "company_user")
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("companies").select("id, name").eq("status", "active").order("name"),
      loadTiers(),
      listAlumniInvites(DB),
      listAlumniAccounts(DB),
    ]);
  if (tab === "alumni") {
    // Opening the Alumni tab also brings auth.quantt.ca's Alumni tab up to date (the first time, and after any missed send).
    await pushConnectAlumni(DB, AUTH).catch((e) => console.error("connect alumni push failed", e));
  }

  type ContactRow = {
    profiles: { full_name: string; email: string } | { full_name: string; email: string }[] | null;
    companies: Named;
  };
  const sponsorRows = ((contacts as ContactRow[] | null) ?? [])
    .map((c) => {
      const p = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
      return { name: p?.full_name ?? "", email: p?.email ?? "", firm: one(c.companies)?.name ?? "" };
    })
    .filter((c) => c.email)
    .sort((a, b) => a.firm.localeCompare(b.firm) || a.name.localeCompare(b.name));
  const sponsorInvites = (pendingSponsors as { email: string; full_name: string; created_at: string; companies: Named }[] | null) ?? [];

  const counts: Record<Tab, number> = {
    members: (members ?? []).length,
    sponsors: sponsorRows.length + sponsorInvites.length,
    alumni: alumni.length + alumInvites.length,
  };
  const labels: Record<Tab, string> = { members: "Members", sponsors: "Sponsors", alumni: "Alumni" };
  const inviteOpen = Boolean(sp.invite || sp.sent || sp.unsent || sp.denied);

  return (
    <>
      <PageHeader title="People">Everyone who can use Connect.</PageHeader>
      <Notice message={sp.denied} />
      {sp.unsent && (
        <p className="mb-6 border-l-2 border-primary pl-4 text-sm text-copy">
          The invite is saved, but the email didn’t send. Tell them to sign in at connect.quantt.ca/login with the
          address you entered; they’ll get a code there.
        </p>
      )}

      <details open={inviteOpen} className="mb-8 rounded border border-line p-4 sm:p-5">
        <summary className="cursor-pointer font-heading text-lg font-bold text-ink">Invite someone</summary>
        <div className="mt-5">
          <InviteForm
            companies={(companies as Pick<Company, "id" | "name">[] | null) ?? []}
            tiers={tiers.map((t) => ({ id: t.id, name: t.name }))}
            initialKind={tab === "alumni" ? "alum" : "company"}
            sent={Boolean(sp.sent)}
          />
        </div>
      </details>

      <nav aria-label="Who" className="mb-4 flex flex-wrap gap-2">
        {(["members", "sponsors", "alumni"] as const).map((t) => (
          <Link
            key={t}
            href={`/admin/people?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={buttonClass(tab === t ? "primary" : "quiet")}
          >
            {labels[t]} ({counts[t]})
          </Link>
        ))}
      </nav>

      {tab === "members" && (
        <section>
          <p className="mb-4 text-sm text-copy">
            Members who have signed in to Connect. Add or remove members, and give admin access, on{" "}
            <a href="https://auth.quantt.ca" className="font-medium text-primary hover:underline">
              auth.quantt.ca
            </a>
            . No invite needed.
          </p>
          <ul>
            {(members ?? []).map((p) => (
              <li key={p.id} className="border-t border-line py-3 text-sm text-ink">
                {p.full_name}{" "}
                <span className="text-copy">
                  {p.email}
                  {p.is_admin ? " · admin" : ""}
                </span>
              </li>
            ))}
          </ul>
          {!(members ?? []).length && <p className="text-sm text-copy">No members yet.</p>}
        </section>
      )}

      {tab === "sponsors" && (
        <section>
          <h2 className="mb-2 font-heading text-lg font-bold text-ink">Waiting to join ({sponsorInvites.length})</h2>
          {!sponsorInvites.length ? (
            <p className="mb-6 text-sm text-copy">No outstanding invites.</p>
          ) : (
            <ul className="mb-6">
              {sponsorInvites.map((i) => (
                <li key={i.email} className="border-t border-line py-3 text-sm text-ink [overflow-wrap:anywhere]">
                  {i.full_name}{" "}
                  <span className="text-copy">
                    {i.email} · {one(i.companies)?.name ?? "Company"} · invited {formatDate(i.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h2 className="mb-2 font-heading text-lg font-bold text-ink">Sponsor contacts ({sponsorRows.length})</h2>
          <ul>
            {sponsorRows.map((c) => (
              <li key={c.email} className="border-t border-line py-3 text-sm text-ink [overflow-wrap:anywhere]">
                {c.name} <span className="text-copy">{c.email} · {c.firm}</span>
              </li>
            ))}
          </ul>
          {!sponsorRows.length && <p className="text-sm text-copy">No sponsor contacts yet.</p>}
        </section>
      )}

      {tab === "alumni" && (
        <section>
          <h2 className="mb-2 font-heading text-lg font-bold text-ink">Waiting to join ({alumInvites.length})</h2>
          <ul className="mb-6">
            {alumInvites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 border-t border-line py-3 text-sm">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {i.full_name} <span className="text-muted">{i.email} · invited {formatDate(i.created_at)}</span>
                </span>
                <form action={removeAlumniAction}>
                  <input type="hidden" name="id" value={i.id} />
                  <input type="hidden" name="what" value="invite" />
                  <QuietButton type="submit">Cancel</QuietButton>
                </form>
              </li>
            ))}
          </ul>
          {!alumInvites.length && <p className="mb-6 text-sm text-copy">No outstanding invites.</p>}
          <h2 className="mb-2 font-heading text-lg font-bold text-ink">Alumni ({alumni.length})</h2>
          <ul>
            {alumni.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 border-t border-line py-3 text-sm">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {a.full_name}{" "}
                  <span className="text-muted">
                    {[a.email, a.phone, a.firm, a.grad_year && `Class of ${a.grad_year}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <form action={removeAlumniAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <ConfirmSubmitButton
                    variant="danger"
                    confirmMessage={`Remove ${a.full_name}? Their posts and messages are deleted, and they lose the Alumni role in Discord.`}
                  >
                    Remove
                  </ConfirmSubmitButton>
                </form>
              </li>
            ))}
          </ul>
          {!alumni.length && <p className="text-sm text-copy">No alumni yet.</p>}
        </section>
      )}
    </>
  );
}
