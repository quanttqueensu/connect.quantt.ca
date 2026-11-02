"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/Form";
import { exitSponsorMode } from "@/lib/actions/sponsor-mode";

/** Off: opens the company picker. On: returns to admin. */
export default function SponsorModeToggle({ active = false }: { active?: boolean }) {
  if (!active) {
    return (
      <Link href="/admin/sponsor-mode" role="switch" aria-checked={false} aria-label="Sponsor mode"
        title="See Connect exactly as a sponsor company sees it" className={`${buttonClass("nav", "gap-3")} shrink-0`}>
        <span>Sponsor mode</span>
        <Switch active={false} />
        <span aria-hidden="true">Off</span>
      </Link>
    );
  }
  return (
    <form action={exitSponsorMode} className="shrink-0">
      <ExitButton />
    </form>
  );
}

function Switch({ active }: { active: boolean }) {
  return (
    <span aria-hidden="true" className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors ${active ? "bg-primary" : "bg-line-strong"}`}>
      <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${active ? "translate-x-4" : "translate-x-0"}`} />
    </span>
  );
}

function ExitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="switch"
      aria-checked
      aria-label="Sponsor mode"
      aria-busy={pending}
      disabled={pending}
      title="Return to admin"
      className={buttonClass("nav", "gap-3")}
    >
      <span>Sponsor mode</span>
      <Switch active />
      <span aria-hidden="true">{pending ? "Switching…" : "On"}</span>
    </button>
  );
}
