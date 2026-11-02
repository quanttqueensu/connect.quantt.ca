import { PrimaryButton, QuietButton } from "@/components/Form";
import type { AlumniProfile } from "@/lib/alumni/data";

/** Alumni cards. `onMessage` adds a Message button (members only). */
export default function AlumniDirectory({
  alumni,
  q,
  messageAction,
}: {
  alumni: AlumniProfile[];
  q: string;
  messageAction?: (formData: FormData) => Promise<void>;
}) {
  return (
    <>
      <form method="get" className="mb-8 flex max-w-md items-stretch gap-2">
        <input
          type="search"
          name="q"
          aria-label="Search alumni by name, firm or program"
          defaultValue={q}
          placeholder="Search by name, firm or program"
          maxLength={80}
          className="min-w-0 w-full border border-line bg-transparent px-3 py-2 text-sm text-ink placeholder:text-muted"
        />
        <PrimaryButton type="submit">Search</PrimaryButton>
      </form>
      {alumni.length === 0 ? (
        <p className="border border-line p-6 text-sm text-copy">{q ? `No alumni match “${q}”.` : "No alumni have joined yet."}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {alumni.map((a) => (
            <div key={a.id} className="min-w-0 border border-line p-5 [overflow-wrap:anywhere]">
              <div className="flex items-center gap-3">
                {a.has_photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/alumni/photo/${a.id}`} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" loading="lazy" />
                ) : null}
                <p className="font-heading text-lg font-bold text-ink">{a.full_name}</p>
              </div>
              <p className="mt-1 text-sm text-muted">
                {[[a.title, a.firm].filter(Boolean).join(", "), a.location, a.grad_year && `Class of ${a.grad_year}`, a.program]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {a.bio && <p className="mt-2 line-clamp-3 text-sm text-copy">{a.bio}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {messageAction && (
                  <form action={messageAction}>
                    <input type="hidden" name="side" value="member" />
                    <input type="hidden" name="alumni_id" value={a.id} />
                    <QuietButton type="submit">Message</QuietButton>
                  </form>
                )}
                {a.linkedin_url && (
                  <a href={a.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
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
