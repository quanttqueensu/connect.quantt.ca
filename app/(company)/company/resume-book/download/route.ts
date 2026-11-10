import { getCompanyContext } from "@/lib/sponsor-mode";
import { getCurrentProfile } from "@/lib/auth";
import { csvCell } from "@/lib/files";
import { isPackagePdfPath } from "@/lib/storage-paths";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { can, loadMyCompanyTier } from "@/lib/tiers";
import { buildZip, safeFileName, type ZipEntry } from "@/lib/zip";
import type { TalentRow } from "@/components/TalentList";
import { NextResponse } from "next/server";
import { cleanSearchTerm, parseGradYearParam } from "../../talent-query";

/** Keeps the whole archive well inside a Worker's memory. */
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

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
  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  const index = [["name", "program", "grad_year", "linkedin", "file"].join(",")];
  let total = 0;

  for (const m of members) {
    let file = "";
    const { data: path } = await supabase.rpc("talent_resume_path", { p_member: m.id });
    if (isPackagePdfPath(path, m.id)) {
      const { data: blob } = await admin.storage.from("resumes").download(path);
      if (blob && total + blob.size <= MAX_TOTAL_BYTES) {
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
    }
    index.push(
      [m.full_name, m.program ?? "", m.grad_year ?? "", m.linkedin_url ?? "", file].map(csvCell).join(","),
    );
  }

  entries.unshift({ name: "index.csv", data: new TextEncoder().encode(index.join("\n") + "\n") });
  const zip = buildZip(entries);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(zip, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="quantt-resume-book-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
