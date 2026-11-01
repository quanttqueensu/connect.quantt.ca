import { getCurrentProfile } from "@/lib/auth";
import { isPackagePdfPath } from "@/lib/storage-paths";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "member" || (kind !== "resume" && kind !== "cover")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const supabase = await createClient();
  const { data: documents } = await supabase.from("member_documents")
    .select("resume_path, cover_letter_path").eq("member_id", profile.id).maybeSingle();
  const path = kind === "resume" ? documents?.resume_path : documents?.cover_letter_path;
  if (!isPackagePdfPath(path, profile.id)) return new NextResponse("Not found", { status: 404 });
  const { data: signed, error } = await supabase.storage.from("resumes")
    .createSignedUrl(path, 90, { download: true });
  if (error || !signed?.signedUrl) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
