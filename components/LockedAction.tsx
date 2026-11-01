import { can, lowestTierWith, type CapabilityKey, type TierWithCaps } from "@/lib/tiers";
import { QuietButton } from "@/components/Form";
import type { ReactNode } from "react";

export default function LockedAction({
  capability,
  tier,
  tiers,
  children,
  label,
}: {
  capability: CapabilityKey;
  tier: TierWithCaps | null;
  tiers: TierWithCaps[];
  children: ReactNode;
  label?: string;
}) {
  if (can(tier, capability)) return <>{children}</>;
  const needed = lowestTierWith(tiers, capability);
  return (
    <div className="max-w-full">
      <QuietButton type="button" disabled aria-disabled="true">
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="7" width="10" height="7" rx="1.5" />
          <path d="M5 7V5a3 3 0 0 1 6 0v2" />
        </svg>
        {label ?? (typeof children === "string" ? children : "Unavailable")}
      </QuietButton>
      <p className="mt-1.5 max-w-48 text-xs text-copy">
        {needed ? `Requires ${needed.name}.` : "Not included in your current access."}
      </p>
    </div>
  );
}
