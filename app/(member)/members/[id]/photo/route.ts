import { isPhotoPath } from "@/lib/storage-paths";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Member-directory photo. Layouts do not wrap route handlers, so membership
 * is checked here. The HTML pages link here instead of embedding a Storage
 * signed URL, so a forwarded page source is not an unauthenticated pass to
 * someone's face.
 */
const SIGNED_URL_TTL_SECONDS = 90;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "member") {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const { data: member } = await supabase
    .from("profiles")
    .select("id, photo_path")
    .eq("id", id)
    .eq("role", "member")
    .maybeSingle();
  const path = member?.photo_path;
  if (!isPhotoPath(path, id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { data: signed, error } = await supabase.storage
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
