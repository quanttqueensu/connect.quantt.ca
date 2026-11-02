import Link from "next/link";

import type { ConversationSummary } from "@/lib/alumni/data";

export default function AlumniInbox({
  conversations,
  base,
  empty,
  side,
}: {
  conversations: ConversationSummary[];
  base: string;
  empty: string;
  side: "alumni" | "member";
}) {
  const label = (c: ConversationSummary) =>
    c.status === "pending" ? (side === "alumni" ? "Request" : "Request pending") : c.status === "declined" ? "Declined" : null;
  if (!conversations.length) return <p className="text-sm text-copy">{empty}</p>;
  return (
    <ul>
      {conversations.map((c) => (
        <li key={c.id} className="border-t border-line">
          <Link href={`${base}/${c.id}`} className="block py-4 text-ink hover:text-primary">
            <span className={c.unread ? "font-medium text-ink" : undefined}>{c.other_name}</span>
            {c.unread && <span className="ml-2 text-[10px] uppercase tracking-wider text-primary">New</span>}
            {label(c) && <span className="ml-2 text-[10px] uppercase tracking-wider text-muted">{label(c)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
