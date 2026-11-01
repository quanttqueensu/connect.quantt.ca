import { can, lowestTierWith, type CapabilityKey, type TierWithCaps } from "@/lib/tiers";
import { buttonClass } from "@/components/Form";
import type { ReactNode } from "react";

export default function LockedCard({
  capability,
  tier,
  tiers,
  title,
  description,
  children,
}: {
  capability: CapabilityKey;
  tier: TierWithCaps | null;
  tiers: TierWithCaps[];
  title: string;
  description: string;
  children?: ReactNode;
}) {
  if (can(tier, capability)) return <>{children}</>;

  const needed = lowestTierWith(tiers, capability);

  return (
    <section className="rounded border border-line bg-surface p-6">
      <h2 className="font-heading text-lg font-bold text-copy">{title}</h2>
      <p className="mt-2 text-sm text-copy">{description}</p>
      <p className="mt-4 text-xs uppercase tracking-wider text-primary">
        {needed ? `Included from ${needed.name}` : "Not currently available"}
      </p>
      <a
        href="mailto:sponsors@quantt.ca?subject=QUANTT%20sponsorship"
        className={buttonClass("ghost", "mt-4")}
      >
        Talk to QUANTT
      </a>
    </section>
  );
}
