import { startConversation } from "@/lib/actions/messages";
import LockedAction from "@/components/LockedAction";
import { QuietButton, buttonClass } from "@/components/Form";
import type { CapabilityKey, TierWithCaps } from "@/lib/tiers";
import { can } from "@/lib/tiers";

export type TalentRow = {
  id: string;
  full_name: string;
  program: string | null;
  grad_year: number | null;
  bio: string | null;
  interests: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  website_url: string | null;
  photo_path: string | null;
  package_name: string | null;
};

export default function TalentList({
  members,
  companyId,
  returnTo,
  dmTier,
  tiers,
  empty,
}: {
  members: TalentRow[];
  companyId: string;
  returnTo: string;
  dmTier: TierWithCaps | null;
  tiers: TierWithCaps[];
  empty: string;
}) {
  const canMessage = can(dmTier, "dm_initiate_any");
  if (!members.length) {
    return <p className="text-sm text-copy">{empty}</p>;
  }
  return (
    <ul>
      {members.map((m) => (
        <li key={m.id} className="border-t border-line py-5">
          <div className="flex gap-4">
            {m.photo_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/company/talent/${m.id}/photo`}
                alt=""
                width={56}
                height={56}
                loading="lazy"
                decoding="async"
                className="h-14 w-14 shrink-0 bg-surface object-cover"
              />
            ) : (
              <div className="h-14 w-14 shrink-0 bg-surface" aria-hidden />
            )}
            <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <p className="font-heading text-lg font-bold text-ink">{m.full_name}</p>
              <p className="mt-1 text-sm text-muted">
                {[m.program, m.grad_year, m.package_name].filter(Boolean).join(" · ")}
              </p>
              {m.bio && <p className="mt-2 line-clamp-3 text-sm text-copy">{m.bio}</p>}
              {m.interests && (
                <p className="mt-1 text-xs text-muted">Interests: {m.interests}</p>
              )}
              <div className="mt-3 flex flex-wrap items-start gap-2">
                <a
                  href={`/company/talent/${m.id}/resume`}
                  className={buttonClass("quiet")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View resume
                </a>
                <ExtLink href={m.linkedin_url} label="LinkedIn" />
                <ExtLink href={m.github_url} label="GitHub" />
                <ExtLink href={m.website_url} label="Website" />
                {canMessage ? (
                  <form action={startConversation}>
                    <input type="hidden" name="company_id" value={companyId} />
                    <input type="hidden" name="member_id" value={m.id} />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <QuietButton type="submit">Message member</QuietButton>
                  </form>
                ) : (
                  <LockedAction
                    capability={"dm_initiate_any" as CapabilityKey}
                    tier={dmTier}
                    tiers={tiers}
                  >
                    Message member
                  </LockedAction>
                )}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ExtLink({ href, label }: { href: string | null; label: string }) {
  if (!href || !/^https?:\/\//i.test(href)) return null;
  return (
    <a
      href={href}
      className={buttonClass("quiet")}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  );
}
