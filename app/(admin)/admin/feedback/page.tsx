import { QuietButton } from "@/components/Form";
import PageHeader from "@/components/PageHeader";
import { requireCurrentProfile } from "@/lib/auth";
import { setSponsorFeedbackStatus } from "@/lib/actions/feedback";
import { hubEnv } from "@/lib/hub/env";
import { FEEDBACK_KIND_LABEL, isWatchingFeedback, listAllFeedback } from "@/lib/sponsor-feedback";
import { formatDate } from "@/lib/time";
import Link from "next/link";

/** Requests and feedback from sponsors (Company → Feedback) and alumni (Alumni → Feedback). Admins only (the admin layout checks). */
export default async function AdminFeedbackPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "done" ? "done" : "open";
  const profile = await requireCurrentProfile();
  const { DB } = await hubEnv();
  const [items, watching] = await Promise.all([listAllFeedback(DB, tab), isWatchingFeedback(DB, profile.id)]);

  return (
    <>
      <PageHeader title="Feedback">
        Requests and feedback from sponsors and alumni. Only admins see this.{" "}
        {watching ? "You get an email for each new one" : "Emails for new ones are off"} (
        <Link href="/profile#notifications" className="underline">
          notification settings
        </Link>
        ).
      </PageHeader>

      {/* A filter, not an action: plain text tabs. */}
      <nav aria-label="Filter feedback" className="mb-4 flex gap-5 text-sm">
        {(["open", "done"] as const).map((t) => (
          <Link
            key={t}
            href={t === "open" ? "/admin/feedback" : "/admin/feedback?tab=done"}
            aria-current={tab === t ? "page" : undefined}
            className={
              tab === t
                ? "border-b-2 border-primary pb-1 font-medium text-ink"
                : "border-b-2 border-transparent pb-1 text-copy hover:text-ink"
            }
          >
            {t === "open" ? "To handle" : "Handled"}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="text-sm text-copy">{tab === "open" ? "Nothing to handle." : "Nothing handled yet."}</p>
      ) : (
        <ul>
          {items.map((f) => (
            <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-4">
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-xs text-copy [overflow-wrap:anywhere]">
                  <span className="font-semibold text-ink">{f.company_name}</span> · {FEEDBACK_KIND_LABEL[f.kind]} ·{" "}
                  {formatDate(f.created_at)}
                  {f.author_name ? ` · ${f.author_name}` : ""}
                  {f.author_email ? (
                    <>
                      {" "}
                      <a className="underline" href={`mailto:${f.author_email}`}>
                        {f.author_email}
                      </a>
                    </>
                  ) : null}
                  {f.status === "done" && f.resolved_at
                    ? ` · handled ${formatDate(f.resolved_at)}${f.resolved_by_name ? ` by ${f.resolved_by_name}` : ""}`
                    : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{f.body}</p>
              </div>
              <form action={setSponsorFeedbackStatus}>
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="status" value={f.status === "open" ? "done" : "open"} />
                <QuietButton type="submit">{f.status === "open" ? "Mark handled" : "Move back"}</QuietButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
