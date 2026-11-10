import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { Field, PrimaryButton, QuietButton, TextInput } from "@/components/Form";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { inviteAlumniAction, removeAlumniAction } from "@/lib/actions/alumni";
import { listAlumniAccounts, listAlumniInvites } from "@/lib/alumni/data";
import { pushConnectAlumni } from "@/lib/alumni/directory-push";
import { hubEnv } from "@/lib/hub/env";
import { formatDate } from "@/lib/time";

export default async function AdminAlumniPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; sent?: string; unsent?: string }>;
}) {
  const sp = await searchParams;
  const { DB, AUTH } = await hubEnv();
  const [invites, accounts] = await Promise.all([listAlumniInvites(DB), listAlumniAccounts(DB)]);
  // Opening this page also brings auth.quantt.ca's Alumni tab up to date (the first time, and after any missed send).
  await pushConnectAlumni(DB, AUTH).catch((e) => console.error("connect alumni push failed", e));
  return (
    <>
      <PageHeader title="Alumni">
        Alumni have their own login at /alumni/login, separate from members and sponsors. They can post jobs and
        mentorship and message members.
      </PageHeader>
      <Notice message={sp.denied} />
      {sp.sent && <p className="mb-6 text-sm text-copy">Invite sent.</p>}
      {sp.unsent && (
        <p className="mb-6 text-sm text-copy">
          Invite saved, but the email didn&apos;t send. Tell them to sign in at connect.quantt.ca/alumni/login.
        </p>
      )}

      <form action={inviteAlumniAction} className="grid max-w-xl gap-4">
        <Field label="Name">
          <TextInput name="full_name" required maxLength={120} />
        </Field>
        <Field label="Email">
          <TextInput name="email" type="email" required maxLength={254} />
        </Field>
        <PrimaryButton type="submit">Invite alum</PrimaryButton>
      </form>

      <section className="mt-6 border-t border-line pt-5">
        <h2 className="mb-4 font-heading text-lg font-bold text-ink">Waiting to join ({invites.length})</h2>
        <ul>
          {invites.map((i) => (
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
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <h2 className="mb-4 font-heading text-lg font-bold text-ink">Alumni ({accounts.length})</h2>
        <ul>
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 border-t border-line py-3 text-sm">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {a.full_name}{" "}
                <span className="text-muted">
                  {[a.email, a.firm, a.grad_year && `Class of ${a.grad_year}`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <form action={removeAlumniAction}>
                <input type="hidden" name="id" value={a.id} />
                <ConfirmSubmitButton variant="danger" confirmMessage={`Remove ${a.full_name}? Their posts and messages are deleted, and they lose the Alumni role in Discord.`}>
                  Remove
                </ConfirmSubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
