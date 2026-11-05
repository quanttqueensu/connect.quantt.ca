import PageHeader from "@/components/PageHeader";
import { buttonClass } from "@/components/Form";
import { requireAlumnus } from "@/lib/alumni/current";
import { discordReady, getAlumniDiscord, type DiscordEnv } from "@/lib/alumni/discord";
import { hubEnv } from "@/lib/hub/env";

const ERRORS: Record<string, string> = {
  unconfigured: "Discord joining isn't switched on yet. Try again later.",
  cancelled: "Discord didn't link your account. Try again.",
  expired: "That link expired. Try again.",
  refused: "Discord refused the sign-in. Try again.",
  no_user: "Couldn't read your Discord account. Try again.",
  roles: "Your Discord account is linked, but the Alumni role couldn't be set yet. An exec can add it.",
};

export default async function AlumniDiscordPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const me = await requireAlumnus();
  const env = await hubEnv();
  const link = await getAlumniDiscord(env.DB, me.id);
  const guild = (env as unknown as DiscordEnv).DISCORD_GUILD_ID;
  const ready = discordReady(env as unknown as DiscordEnv);
  return (
    <>
      <PageHeader title="QUANTT Discord">
        Alumni get the Alumni role: #alumni-lounge and #alumni-jobs with current members, a private #alumni channel, and
        club announcements and events.
      </PageHeader>
      {sp.error && <p className="mb-6 text-sm text-copy">{ERRORS[sp.error] ?? ERRORS.cancelled}</p>}
      {sp.joined && <p className="mb-6 text-sm text-copy">You&apos;re in. The Alumni role is set.</p>}
      <div className="flex flex-wrap items-center gap-4">
        {link && guild && (
          <a href={`https://discord.com/channels/${guild}`} className={buttonClass("primary")}>
            Open the QUANTT server
          </a>
        )}
        {ready ? (
          <a href="/alumni/discord/start" className={buttonClass(link ? "ghost" : "primary")}>
            {link ? "Link a different Discord account" : "Join the QUANTT Discord"}
          </a>
        ) : (
          <p className="text-sm text-copy">Discord joining isn&apos;t switched on yet.</p>
        )}
      </div>
      {link && <p className="mt-6 text-sm text-muted">Linked to {link.username || "your Discord account"}.</p>}
    </>
  );
}
