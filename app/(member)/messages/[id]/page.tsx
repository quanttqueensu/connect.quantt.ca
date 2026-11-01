import Notice from "@/components/Notice";
import { sendMessage } from "@/lib/actions/messages";
import { markConversationRead } from "@/lib/message-read";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { one, type Conversation, type Message } from "@/lib/types";
import { PrimaryButton, TextArea } from "@/components/Form";
import { after } from "next/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { dayKey, formatDay, formatTime } from "@/lib/time";

const PAGE_SIZE = 50;
const MAX_MESSAGES = 500;

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ denied?: string; show?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await createClient();
  const { data: convo } = await supabase
    .from("conversations")
    .select("*, companies(name)")
    .eq("id", id)
    .eq("member_id", profile.id)
    .maybeSingle();
  if (!convo) notFound();
  after(() => markConversationRead(supabase, profile, id));

  // Newest N only. Fetching descending and reversing keeps the query bounded
  // while still showing the tail of the thread, which is what people read.
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
  const companyName = one(c.companies)?.name ?? "Company";

  // Precompute date separators so nothing is mutated during render.
  const items = messages.map((m, i) => ({
    message: m,
    newDay: i === 0 || dayKey(m.created_at) !== dayKey(messages[i - 1].created_at),
  }));

  return (
    <>
      <h1 className="font-heading text-2xl font-bold text-white">{companyName}</h1>
      <Notice message={sp.denied} />

      {olderCount > 0 && (
        <p className="mt-6 text-sm text-white/60">
          {show < MAX_MESSAGES ? (
            <Link
              href={`/messages/${id}?show=${Math.min(show + PAGE_SIZE, MAX_MESSAGES)}`}
              className="text-blue-light underline"
            >
              Load older messages
            </Link>
          ) : (
            <span>Showing the latest {MAX_MESSAGES} messages</span>
          )}{" "}
          ({olderCount} older)
        </p>
      )}

      <ul className="mt-8 space-y-4">
        {messages.length === 0 && (
          <li className="text-sm text-white/60">
            No messages yet. Say hello to {companyName}.
          </li>
        )}
        {items.map(({ message: m, newDay }) => {
          const mine = m.sender_id === profile.id;
          const sender = mine ? "You" : companyName;
          return (
            <li key={m.id}>
              {newDay && (
                <p className="my-6 text-center text-[11px] uppercase tracking-wider text-white/45">
                  {formatDay(m.created_at)}
                </p>
              )}
              <div className={mine ? "text-right" : ""}>
                <p className="text-[11px] text-white/50">
                  <span className="text-white/70">{sender}</span>
                  {" · "}
                  <time dateTime={m.created_at}>{formatTime(m.created_at)}</time>
                </p>
                <p className="mt-1 inline-block max-w-full whitespace-pre-wrap rounded border border-white/10 px-4 py-2 text-left text-sm text-white/80 [overflow-wrap:anywhere] sm:max-w-lg">
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
        <PrimaryButton type="submit">Send</PrimaryButton>
      </form>
    </>
  );
}
