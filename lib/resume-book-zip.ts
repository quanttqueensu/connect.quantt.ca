import { csvCell } from "@/lib/files";
import { buildZip, safeFileName, type ZipEntry } from "@/lib/zip";

/** Keeps the whole archive well inside a Worker's memory. */
export const MAX_RESUME_BOOK_BYTES = 60 * 1024 * 1024;

export type ResumeBookMember = {
  id: string;
  full_name: string;
  program: string | null;
  grad_year: number | null;
  linkedin_url: string | null;
};

/**
 * The resume book as one ZIP: each member's resume PDF plus index.csv.
 * `resumeFor` returns the PDF, or null when the member has no readable resume
 * (the caller checks access and paths). Shared by sponsors and alumni.
 */
export async function buildResumeBookZip<M extends ResumeBookMember>(
  members: M[],
  resumeFor: (member: M) => Promise<Blob | null>,
): Promise<Uint8Array<ArrayBuffer>> {
  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  const index = [["name", "program", "grad_year", "linkedin", "file"].join(",")];
  let total = 0;

  for (const m of members) {
    let file = "";
    const blob = await resumeFor(m);
    if (blob && total + blob.size <= MAX_RESUME_BOOK_BYTES) {
      const base = safeFileName(m.full_name, "Member");
      let name = `${base}.pdf`;
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i}).pdf`;
      used.add(name.toLowerCase());
      entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
      total += blob.size;
      file = name;
    } else if (blob) {
      file = "not included (download too large, narrow the filters)";
    }
    index.push([m.full_name, m.program ?? "", m.grad_year ?? "", m.linkedin_url ?? "", file].map(csvCell).join(","));
  }

  entries.unshift({ name: "index.csv", data: new TextEncoder().encode(index.join("\n") + "\n") });
  return buildZip(entries);
}

export function resumeBookZipResponse(zip: Uint8Array<ArrayBuffer>) {
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(zip, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="quantt-resume-book-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
