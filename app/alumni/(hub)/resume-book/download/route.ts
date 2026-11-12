import { NextResponse } from "next/server";

import { currentAlumnus } from "@/lib/alumni/current";
import { alumniResumeBook } from "@/lib/alumni/talent";
import { hubEnv } from "@/lib/hub/env";
import { isPackagePdfPath } from "@/lib/storage-paths";
import { buildResumeBookZip, resumeBookZipResponse } from "@/lib/resume-book-zip";
import { cleanSearchTerm, parseGradYearParam } from "@/app/(company)/company/talent-query";

/** The alumni resume book as one ZIP, with the page's filters. Layouts don't wrap route handlers, so access is checked here. */
export async function GET(request: Request) {
  if (!(await currentAlumnus())) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  const program = cleanSearchTerm(url.searchParams.get("program") ?? undefined);
  const { year, invalid } = parseGradYearParam(url.searchParams.get("year") ?? undefined);
  if (invalid) return new NextResponse("Bad grad year", { status: 400 });

  const env = await hubEnv();
  const members = await alumniResumeBook(env.DB, { program: program || null, gradYear: year });
  const zip = await buildResumeBookZip(members, async (m) => {
    const obj = isPackagePdfPath(m.resume_path, m.id) ? await env.FILES.get(`resumes/${m.resume_path}`) : null;
    return obj ? new Blob([await obj.arrayBuffer()]) : null;
  });
  return resumeBookZipResponse(zip);
}
