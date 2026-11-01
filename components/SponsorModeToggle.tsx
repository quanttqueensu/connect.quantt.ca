"use client";

import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/Form";
import { enterSponsorMode, exitSponsorMode } from "@/lib/actions/sponsor-mode";

export default function SponsorModeToggle({ active = false }: { active?: boolean }) {
  return (
    <form action={active ? exitSponsorMode : enterSponsorMode} className="shrink-0">
      <ToggleButton active={active} />
    </form>
  );
}

function ToggleButton({ active }: { active: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={active}
      aria-label="Sponsor mode"
      aria-busy={pending}
      disabled={pending}
      title={active ? "Return to admin" : "Preview the sponsor platform with fictional data"}
      className={buttonClass("nav", "gap-3")}
    >
      <span>Sponsor mode</span>
      <span aria-hidden="true" className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors ${active ? "bg-primary" : "bg-line-strong"}`}>
        <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${active ? "translate-x-4" : "translate-x-0"}`} />
      </span>
      <span aria-hidden="true">{pending ? "Switching…" : active ? "On" : "Off"}</span>
    </button>
  );
}
