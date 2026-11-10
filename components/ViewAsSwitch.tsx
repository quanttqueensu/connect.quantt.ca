"use client";

import { useFormStatus } from "react-dom";
import { viewAs } from "@/lib/actions/view-as";

export type ViewAs = "admin" | "member" | "sponsor" | "alum";

const OPTIONS: { id: ViewAs; label: string }[] = [
  { id: "admin", label: "Admin" },
  { id: "member", label: "Member" },
  { id: "sponsor", label: "Sponsor" },
  { id: "alum", label: "Alum" },
];

/**
 * One switch for admins, in the same place on every view: Admin, Member,
 * Sponsor or Alum. Sponsor and Alum are read-only previews of a chosen
 * company or alum (lib/actions/view-as.ts).
 */
export default function ViewAsSwitch({ current }: { current: ViewAs }) {
  return (
    <form action={viewAs} className="flex shrink-0 items-center gap-2" aria-label="View as">
      <span className="text-xs text-copy">View as</span>
      <Options current={current} />
    </form>
  );
}

function Options({ current }: { current: ViewAs }) {
  const { pending } = useFormStatus();
  return (
    <div role="group" aria-label="View as" className="flex rounded border border-line bg-surface p-0.5">
      {OPTIONS.map((o) => {
        const on = o.id === current;
        return (
          <button
            key={o.id}
            type="submit"
            name="target"
            value={o.id}
            aria-pressed={on}
            disabled={pending}
            className={`min-h-8 cursor-pointer rounded px-2.5 text-xs font-medium transition-colors disabled:cursor-wait ${
              on ? "bg-primary text-white" : "text-copy hover:bg-white hover:text-primary"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
