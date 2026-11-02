import Link from "next/link";

import type { ConversationSummary } from "@/lib/alumni/data";

export default function AlumniInbox({
  conversations,
  base,
  empty,
}: {
  conversations: ConversationSummary[];
  base: string;
  empty: string;
}) {
  if (!conversations.length) return <p className="text-sm text-copy">{empty}</p>;
  return (
    <ul>
      {conversations.map((c) => (
        <li key={c.id} className="border-t border-line">
          <Link href={`${base}/${c.id}`} className="block py-4 text-ink hover:text-primary">
            <span className={c.unread ? "font-medium text-ink" : undefined}>{c.other_name}</span>
            {c.unread && <span className="ml-2 text-[10px] uppercase tracking-wider text-primary">New</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
