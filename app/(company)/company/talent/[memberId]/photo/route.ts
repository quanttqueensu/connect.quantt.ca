import { getCompanyContext } from "@/lib/sponsor-mode";
import { isPhotoPath } from "@/lib/storage-paths";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const SIGNED_URL_TTL_SECONDS = 90;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await params;
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "company_user" && !profile.is_admin)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  // A sponsor, or an admin viewing as one; the RPC below applies that sponsor's rules.
  const context = await getCompanyContext();
  if (!context) {
    return new NextResponse("Not found", { status: 404 });
  }
  const { data: path } = await supabase.rpc("talent_photo_path", { p_member: memberId });
  if (!isPhotoPath(path, memberId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage
    .from("photos")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !signed?.signedUrl) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
