import type { SponsorTier } from "@/lib/types";

export default function TierBadge({
  tier,
}: {
  tier: Pick<SponsorTier, "name" | "rank"> | null | undefined;
}) {
  if (!tier || tier.rank === 0) return null;
  return (
    <span className="rounded border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
      {tier.name}
    </span>
  );
}
