import { PrimaryButton, TextArea } from "@/components/Form";
import { sendAlumniThreadMessage } from "@/lib/actions/alumni";
import type { ThreadMessage } from "@/lib/alumni/data";
import { dayKey, formatDay, formatTime } from "@/lib/time";

/** One alumni–member conversation, shared by the alumni and member sides. */
export default function AlumniThread({
  side,
  conversationId,
  otherName,
  messages,
}: {
  side: "alumni" | "member";
  conversationId: string;
  otherName: string;
  messages: ThreadMessage[];
}) {
  const items = messages.map((m, i) => ({
    m,
    newDay: i === 0 || dayKey(m.created_at) !== dayKey(messages[i - 1].created_at),
  }));
  return (
    <>
      <ul className="mt-8 space-y-4">
        {messages.length === 0 && <li className="text-sm text-copy">No messages yet. Say hello to {otherName}.</li>}
        {items.map(({ m, newDay }) => {
          const mine = m.sender === side;
          return (
            <li key={m.id}>
              {newDay && (
                <p className="my-6 text-center text-[11px] uppercase tracking-wider text-muted">{formatDay(m.created_at)}</p>
              )}
              <div className={mine ? "text-right" : ""}>
                <p className="text-[11px] text-muted">
                  <span className="text-copy">{mine ? "You" : otherName}</span>
                  {" · "}
                  <time dateTime={m.created_at}>{formatTime(m.created_at)}</time>
                </p>
                <p
                  className={`mt-2 inline-block max-w-full whitespace-pre-wrap rounded border px-4 py-3 text-left text-sm leading-6 text-ink [overflow-wrap:anywhere] sm:max-w-lg ${mine ? "border-primary/20 bg-primary/5" : "border-line bg-surface"}`}
                >
                  {m.body}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <form action={sendAlumniThreadMessage} className="mt-8 max-w-lg space-y-3">
        <input type="hidden" name="side" value={side} />
        <input type="hidden" name="conversation_id" value={conversationId} />
        <TextArea name="body" rows={3} required aria-label="Message" maxLength={4000} />
        <PrimaryButton type="submit">Send message</PrimaryButton>
      </form>
    </>
  );
}
