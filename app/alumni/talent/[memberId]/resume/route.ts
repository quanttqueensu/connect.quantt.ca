import { NextResponse } from "next/server";

import { currentAlumnus } from "@/lib/alumni/current";
import { memberResumePathForAlumni } from "@/lib/alumni/talent";
import { hubEnv } from "@/lib/hub/env";
import { safeFileName } from "@/lib/zip";

/** A resume-book member's resume, for signed-in alumni. Downloads, never inline. */
export async function GET(_request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  if (!(await currentAlumnus())) return new NextResponse("Not found", { status: 404 });
  const env = await hubEnv();
  const path = await memberResumePathForAlumni(env.DB, memberId);
  const obj = path ? await env.FILES.get(`resumes/${path}`) : null;
  if (!obj) return new NextResponse("Not found", { status: 404 });
  const name = await env.DB.prepare(`SELECT full_name FROM profiles WHERE id = ?`).bind(memberId).first<{ full_name: string }>();
  return new NextResponse(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeFileName(name?.full_name ?? "", "Member")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
