import { Field, PrimaryButton, TextArea } from "@/components/Form";
import { FEEDBACK_KIND_LABEL, FEEDBACK_KINDS, MAX_FEEDBACK_LENGTH, type FeedbackRow } from "@/lib/sponsor-feedback";
import { formatDate } from "@/lib/time";

/** The send form plus the sender's own list. Shared by Company → Feedback and Alumni → Feedback. */
export default function FeedbackPanel({
  action,
  items,
  listTitle,
  readOnly,
}: {
  action: (formData: FormData) => Promise<void>;
  items: FeedbackRow[];
  listTitle: string;
  readOnly?: boolean;
}) {
  return (
    <>
      <form action={action} className="grid max-w-xl gap-4">
        <Field label="Type">
          <select name="kind" defaultValue="request" disabled={readOnly} className="min-h-10 w-full rounded px-3 py-1.5 text-sm">
            {FEEDBACK_KINDS.map((k) => (
              <option key={k} value={k}>
                {FEEDBACK_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Message">
          <TextArea name="body" required rows={6} maxLength={MAX_FEEDBACK_LENGTH} disabled={readOnly} />
        </Field>
        <div>
          <PrimaryButton type="submit" disabled={readOnly}>
            Send
          </PrimaryButton>
        </div>
      </form>

      {items.length > 0 && (
        <section className="mt-8 border-t border-line pt-5">
          <h2 className="font-heading text-lg font-bold text-ink">{listTitle}</h2>
          <ul className="mt-2">
            {items.map((f) => (
              <li key={f.id} className="border-t border-line py-3 text-sm first:border-t-0">
                <p className="text-xs text-copy">
                  {FEEDBACK_KIND_LABEL[f.kind]} · {formatDate(f.created_at)}
                  {f.author_name ? ` · ${f.author_name}` : ""} ·{" "}
                  <span className={f.status === "done" ? "text-primary" : ""}>{f.status === "done" ? "Closed" : "Open"}</span>
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
