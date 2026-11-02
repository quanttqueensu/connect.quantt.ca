import { getCompanyContext } from "@/lib/sponsor-mode";
import { getCurrentProfile } from "@/lib/auth";
import { csvCell } from "@/lib/files";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { can, loadMyCompanyTier } from "@/lib/tiers";
import type { Application } from "@/lib/types";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "company_user" && !profile.is_admin)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const cu = await getCompanyContext();
  if (!cu) return new NextResponse("Not found", { status: 404 });

  const { access } = await loadMyCompanyTier(cu.company_id);
  if (!can(access, "read_applicants")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const applicantsQuery = supabase
    .from("applications")
    .select("created_at, stage, linkedin_url, posts(title), profiles(full_name, program, grad_year, email)")
    .eq("kind", "in_app")
    .eq("company_id", cu.company_id)
    .order("created_at", { ascending: false });

  const { data: apps } = await applicantsQuery;

  const rows = (apps as Application[] | null) ?? [];
  const header = ["submitted_at", "name", "email", "program", "grad_year", "post", "stage", "linkedin"];
  const lines = [header.join(",")];
  for (const a of rows) {
    const cells = [
      a.created_at,
      a.profiles?.full_name ?? "",
      a.profiles?.email ?? "",
      a.profiles?.program ?? "",
      a.profiles?.grad_year ?? "",
      a.posts?.title ?? "",
      a.stage,
      a.linkedin_url ?? "",
    ].map(csvCell);
    lines.push(cells.join(","));
  }

  return new NextResponse(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="applicants.csv"',
      "Cache-Control": "no-store",
    },
  });
}
