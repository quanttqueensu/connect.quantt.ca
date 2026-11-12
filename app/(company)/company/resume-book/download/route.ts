import { getCompanyContext } from "@/lib/sponsor-mode";
import { getCurrentProfile } from "@/lib/auth";
import { isPackagePdfPath } from "@/lib/storage-paths";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { can, loadMyCompanyTier } from "@/lib/tiers";
import { buildResumeBookZip, resumeBookZipResponse } from "@/lib/resume-book-zip";
import type { TalentRow } from "@/components/TalentList";
import { NextResponse } from "next/server";
import { cleanSearchTerm, parseGradYearParam } from "../../talent-query";

/**
 * Resume book as one ZIP: every opted-in member's resume PDF matching the
 * page's filters, plus index.csv. Same rules as the page and the single
 * "View resume" link: the resume_book capability, opted-in members only.
 */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "company_user" && !profile.is_admin)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const cu = await getCompanyContext();
  // Sponsor mode reads through the chosen company's rules, so an admin gets
  // exactly the files that company's sponsor would. Downloading writes nothing.
  if (!cu) return new NextResponse("Not found", { status: 404 });

  const { access } = await loadMyCompanyTier(cu.company_id);
  if (!can(access, "resume_book")) return new NextResponse("Not found", { status: 404 });

  const url = new URL(request.url);
  const program = cleanSearchTerm(url.searchParams.get("program") ?? undefined);
  const { year, invalid } = parseGradYearParam(url.searchParams.get("year") ?? undefined);
  if (invalid) return new NextResponse("Bad grad year", { status: 400 });

  const supabase = await createClient();
  const { data } = await supabase.rpc("resume_book_list", {
    p_program: program || null,
    p_grad_year: year,
  });
  const members = (data as TalentRow[] | null) ?? [];

  const admin = createAdminClient();
  const zip = await buildResumeBookZip(members, async (m) => {
    const { data: path } = await supabase.rpc("talent_resume_path", { p_member: m.id });
    if (!isPackagePdfPath(path, m.id)) return null;
    const { data: blob } = await admin.storage.from("resumes").download(path);
    return blob ?? null;
  });
  return resumeBookZipResponse(zip);
}
