import { PrimaryButton, QuietButton } from "@/components/Form";
import Notice from "@/components/Notice";
import PageHeader from "@/components/PageHeader";
import { startAlumniConversation } from "@/lib/actions/alumni";
import { requireAlumnus } from "@/lib/alumni/current";
import { listMembersForAlumni } from "@/lib/alumni/data";
import { hubEnv } from "@/lib/hub/env";

export default async function AlumniMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; denied?: string }>;
}) {
  const sp = await searchParams;
  const me = await requireAlumnus();
  const q = String(sp.q ?? "").trim().slice(0, 80);
  const members = await listMembersForAlumni((await hubEnv()).DB, { kind: "alumni", id: me.id }, q);
  return (
    <>
      <PageHeader kicker="Club" title="Current members">
        Message a member to offer advice, a referral or a coffee chat.
      </PageHeader>
      <Notice message={sp.denied} />
      <form method="get" className="mb-8 flex max-w-md items-stretch gap-2">
        <input
          type="search"
          name="q"
          aria-label="Search members by name or program"
          defaultValue={q}
          placeholder="Search by name or program"
          maxLength={80}
          className="min-w-0 w-full border border-line bg-transparent px-3 py-2 text-sm text-ink placeholder:text-muted"
        />
        <PrimaryButton type="submit">Search</PrimaryButton>
      </form>
      {members.length === 0 ? (
        <p className="border border-line p-6 text-sm text-copy">
          {q ? `No members match “${q}”.` : "No members have signed in yet."}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {members.map((m) => (
            <div key={m.id} className="min-w-0 border border-line p-5 [overflow-wrap:anywhere]">
              <p className="font-heading text-lg font-bold text-ink">{m.full_name}</p>
              <p className="mt-1 text-sm text-muted">{[m.program, m.grad_year].filter(Boolean).join(" · ")}</p>
              {m.bio && <p className="mt-2 line-clamp-3 text-sm text-copy">{m.bio}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <form action={startAlumniConversation}>
                  <input type="hidden" name="side" value="alumni" />
                  <input type="hidden" name="member_id" value={m.id} />
                  <QuietButton type="submit">Message</QuietButton>
                </form>
                {m.linkedin_url && (
                  <a href={m.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
