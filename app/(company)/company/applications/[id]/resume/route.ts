import { getCompanyContext } from "@/lib/sponsor-mode";
import { isSnapshotPath } from "@/lib/storage-paths";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Mints an applicant document URL on demand.
 *
 * The recruiter page used to embed a one-hour signed URL for every applicant's
 * resume and cover letter in its RSC payload. Those URLs carry no
 * authentication, so a forwarded link or a screenshot of the page source
 * handed anyone an hour of access to a student's resume. Nothing is signed
 * until someone actually clicks, the click is re-authorised here against the
 * caller's own company, and the URL that comes back lives ~90 seconds -- long
 * enough for the browser to follow the redirect, not long enough to pass on.
 * `download: true` forces Content-Disposition: attachment so a polyglot is
 * saved, not inlined as HTML if a browser sniffed the bytes.
 *
 * Layouts do not wrap route handlers, so every check the page's layout would
 * have made is repeated here explicitly.
 */
const SIGNED_URL_TTL_SECONDS = 90;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const doc = new URL(request.url).searchParams.get("doc") === "cover" ? "cover" : "resume";

  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "company_user" && !profile.is_admin)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const cu = await getCompanyContext();
  if (!cu?.company_id) return new NextResponse("Not found", { status: 404 });

  // RLS already scopes applications to the caller's company; company_id is
  // compared again so a policy change can never silently widen this route.
  const applicationQuery = supabase
    .from("applications")
    .select("id, company_id, resume_path, cover_letter_path")
    .eq("id", id)
    .eq("company_id", cu.company_id);

  const { data: app } = await applicationQuery.maybeSingle();
  if (!app || app.company_id !== cu.company_id) {
    return new NextResponse("Not found", { status: 404 });
  }

  const path = doc === "cover" ? app.cover_letter_path : app.resume_path;
  // Only the frozen snapshot taken for THIS application. A member-supplied
  // `{member_id}/...` path is a live file they can overwrite after the fact,
  // and a `snapshots/{other_application_id}/...` path is someone else's
  // document -- the service role would happily sign either one.
  if (!isSnapshotPath(path, id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage
    .from("resumes")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: true });
  if (error || !signed?.signedUrl) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
