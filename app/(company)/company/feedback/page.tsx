import { redirect } from "next/navigation";
import { Field, PrimaryButton, TextArea } from "@/components/Form";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { sendSponsorFeedback } from "@/lib/actions/feedback";
import { hubEnv } from "@/lib/hub/env";
import { getCompanyContext } from "@/lib/sponsor-mode";
import { FEEDBACK_KIND_LABEL, FEEDBACK_KINDS, listCompanyFeedback, MAX_FEEDBACK_LENGTH } from "@/lib/sponsor-feedback";
import { formatDate } from "@/lib/time";

/**
 * Sponsors send requests and feedback to the QUANTT team. Only Connect admins
 * read them (Admin → Feedback); this firm sees its own list. Read-only in
 * sponsor mode.
 */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ denied?: string; sent?: string }> }) {
  const sp = await searchParams;
  const cu = await getCompanyContext();
  if (!cu) redirect("/company");
  const items = await listCompanyFeedback((await hubEnv()).DB, cu.company_id);

  return (
    <>
      <PageHeader title="Feedback">Requests and feedback for the QUANTT team. Only QUANTT admins see these.</PageHeader>
      <Notice message={sp.denied} />
      {sp.sent && <p className="mb-6 text-sm text-primary">Sent. The QUANTT team will follow up by email.</p>}

      <form action={sendSponsorFeedback} className="grid max-w-xl gap-4">
        <Field label="Type">
          <select name="kind" defaultValue="request" disabled={cu.preview} className="min-h-10 w-full rounded px-3 py-1.5 text-sm">
            {FEEDBACK_KINDS.map((k) => (
              <option key={k} value={k}>
                {FEEDBACK_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Message">
          <TextArea name="body" required rows={6} maxLength={MAX_FEEDBACK_LENGTH} disabled={cu.preview} />
        </Field>
        <div>
          <PrimaryButton type="submit" disabled={cu.preview}>
            Send
          </PrimaryButton>
        </div>
      </form>

      {items.length > 0 && (
        <section className="mt-8 border-t border-line pt-5">
          <h2 className="font-heading text-lg font-bold text-ink">Sent by {cu.company.name}</h2>
          <ul className="mt-2">
            {items.map((f) => (
              <li key={f.id} className="border-t border-line py-3 text-sm first:border-t-0">
                <p className="text-xs text-copy">
                  {FEEDBACK_KIND_LABEL[f.kind]} · {formatDate(f.created_at)}
                  {f.author_name ? ` · ${f.author_name}` : ""} ·{" "}
                  <span className={f.status === "done" ? "text-primary" : ""}>{f.status === "done" ? "Done" : "Open"}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
