import { getCurrentProfile } from "@/lib/auth";
import { getCompanyContext } from "@/lib/sponsor-mode";
import Notice from "@/components/Notice";
import { sendMessage } from "@/lib/actions/messages";
import { markConversationRead } from "@/lib/message-read";
import { createClient } from "@/lib/supabase/server";
import type { Conversation, Message } from "@/lib/types";
import { PrimaryButton, TextArea } from "@/components/Form";
import { after } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { dayKey, formatDay, formatTime } from "@/lib/time";

const PAGE_SIZE = 50;
const MAX_MESSAGES = 500;

export default async function CompanyThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ denied?: string; show?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const cu = await getCompanyContext();
  if (!cu) notFound();
  const { data: convo } = await supabase
    .from("conversations")
    .select("*, profiles(full_name)")
    .eq("id", id)
    .eq("company_id", cu?.company_id ?? "")
    .maybeSingle();
  if (!convo) notFound();
  if (!cu?.preview) {
    if (profile) after(() => markConversationRead(supabase, profile, id));
  }

  // Newest N only, so a long thread stays a bounded query and render.
  const requested = Number(sp.show);
  const show = Math.min(
    Number.isInteger(requested) && requested > PAGE_SIZE ? requested : PAGE_SIZE,
    MAX_MESSAGES,
  );
  const { data: rows, count } = await supabase
    .from("messages")
    .select("*", { count: "exact" })
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(show);

  const c = convo as Conversation;
  const messages = ((rows as Message[] | null) ?? []).slice().reverse();
  const total = count ?? messages.length;
  const olderCount = total - messages.length;
  const memberName = c.profiles?.full_name ?? "Member";

  // Precompute date separators so nothing is mutated during render.
  const items = messages.map((m, i) => ({
    message: m,
    newDay: i === 0 || dayKey(m.created_at) !== dayKey(messages[i - 1].created_at),
  }));

  return (
    <>
      <h1 className="font-heading text-2xl font-bold text-ink">{memberName}</h1>
      <Notice message={sp.denied} />

      {olderCount > 0 && (
        <p className="mt-6 text-sm text-copy">
          {show < MAX_MESSAGES ? (
            <Link
              href={`/company/messages/${id}?show=${Math.min(show + PAGE_SIZE, MAX_MESSAGES)}`}
              className="text-primary underline"
            >
              Load older messages
            </Link>
          ) : (
            <span>Showing the latest {MAX_MESSAGES} messages</span>
          )}{" "}
          ({olderCount} older)
        </p>
      )}

      {cu?.preview && <p className="mt-6 text-sm text-copy">Sponsor mode is read-only. Sending is off.</p>}
      <ul className="mt-8 space-y-4">
        {messages.length === 0 && (
          <li className="text-sm text-copy">No messages yet. Start the conversation.</li>
        )}
        {items.map(({ message: m, newDay }) => {
          const mine = m.sender_id === profile?.id;
          const sender =
            m.sender_id === c.member_id ? memberName : mine ? "You" : "Your team";
          return (
            <li key={m.id}>
              {newDay && (
                <p className="my-6 text-center text-[11px] uppercase tracking-wider text-muted">
                  {formatDay(m.created_at)}
                </p>
              )}
              <div className={mine ? "text-right" : ""}>
                <p className="text-[11px] text-muted">
                  <span className="text-copy">{sender}</span>
                  {" · "}
                  <time dateTime={m.created_at}>{formatTime(m.created_at)}</time>
                </p>
                <p className={`mt-2 inline-block max-w-full whitespace-pre-wrap rounded border px-4 py-3 text-left text-sm leading-6 text-ink [overflow-wrap:anywhere] sm:max-w-lg ${mine ? "border-primary/20 bg-primary/5" : "border-line bg-surface"}`}>
                  {m.body}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <form action={sendMessage} className="mt-8 max-w-lg space-y-3">
        <input type="hidden" name="conversation_id" value={id} />
        <TextArea name="body" rows={3} required aria-label="Message" maxLength={4000} />
        <PrimaryButton type="submit" disabled={cu?.preview}>Send message</PrimaryButton>
      </form>
    </>
  );
}
