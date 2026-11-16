import PageHeader from "@/components/PageHeader";
import MemberPhoto from "@/components/AlumniMemberPhoto";
import { Field, PrimaryButton, QuietButton, TextInput, buttonClass } from "@/components/Form";
import { startAlumniConversation } from "@/lib/actions/alumni";
import { requireAlumnus } from "@/lib/alumni/current";
import { alumniResumeBook } from "@/lib/alumni/talent";
import { hubEnv } from "@/lib/hub/env";
import { cleanSearchTerm, isSafeHttpUrl, parseGradYearParam } from "@/app/(company)/company/talent-query";

/** The member resume book, as sponsors see it: opted-in members with a resume. */
export default async function AlumniResumeBookPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; year?: string }>;
}) {
  const sp = await searchParams;
  const me = await requireAlumnus();
  const program = cleanSearchTerm(sp.program);
  const { yearRaw, year, invalid } = parseGradYearParam(sp.year);
  const members = invalid ? [] : await alumniResumeBook((await hubEnv()).DB, { program: program || null, gradYear: year });

  const q = new URLSearchParams();
  if (program) q.set("program", program);
  if (year != null) q.set("year", String(year));
  const downloadHref = `/alumni/resume-book/download${q.size ? `?${q}` : ""}`;

  return (
    <>
      <PageHeader title="Resume book">Members who opted in, with the resume saved in their profile.</PageHeader>
      {invalid && (
        <p role="alert" className="mb-6 text-sm text-ink">
          Grad year must be a whole number between 1900 and 2100.
        </p>
      )}
      <form method="get" className="mb-8 grid max-w-xl gap-3 md:grid-cols-3">
        <Field label="Program">
          <TextInput name="program" defaultValue={program} maxLength={80} />
        </Field>
        <Field label="Grad year">
          <TextInput name="year" type="number" defaultValue={yearRaw} />
        </Field>
        <div className="flex items-end">
          <PrimaryButton type="submit">Apply filters</PrimaryButton>
        </div>
      </form>
      {members.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <a href={downloadHref} className={buttonClass("ghost")}>
            Download all (ZIP)
          </a>
          <span className="text-xs text-muted">
            {members.length} resumes as PDFs, plus index.csv{program || yearRaw ? ", matching these filters" : ""}.
          </span>
        </div>
      )}
      {members.length === 0 ? (
        <p className="text-sm text-copy">{program || yearRaw ? "No opted-in members match these filters." : "No opted-in members yet."}</p>
      ) : (
        <ul>
          {members.map((m) => (
            <li key={m.id} className="border-t border-line py-5">
              <div className="flex gap-4">
                <MemberPhoto id={m.id} hasPhoto={Boolean(m.has_photo)} />
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <p className="font-heading text-lg font-bold text-ink">{m.full_name}</p>
                  <p className="mt-1 text-sm text-muted">{[m.program, m.grad_year].filter(Boolean).join(" · ")}</p>
                  {m.bio && <p className="mt-2 line-clamp-3 text-sm text-copy">{m.bio}</p>}
                  {m.interests && <p className="mt-1 text-xs text-muted">Interests: {m.interests}</p>}
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <a href={`/alumni/talent/${m.id}/resume`} className={buttonClass("quiet")}>
                      View resume
                    </a>
                    {[
                      [m.linkedin_url, "LinkedIn"],
                      [m.github_url, "GitHub"],
                      [m.website_url, "Website"],
                    ].map(([href, label]) =>
                      isSafeHttpUrl(href) ? (
                        <a key={label} href={href!} className={buttonClass("quiet")} target="_blank" rel="noopener noreferrer">
                          {label}
                        </a>
                      ) : null,
                    )}
                    <form action={startAlumniConversation}>
                      <input type="hidden" name="side" value="alumni" />
                      <input type="hidden" name="member_id" value={m.id} />
                      <QuietButton type="submit" disabled={me.preview}>Message</QuietButton>
                    </form>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
