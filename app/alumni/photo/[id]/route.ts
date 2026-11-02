import { NextResponse } from "next/server";

import { currentAlumnus } from "@/lib/alumni/current";
import { alumniPhotoPath } from "@/lib/alumni/graduates";
import { getCurrentProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";

/**
 * A graduate's headshot, copied from their member profile when they became an
 * alum (lib/alumni/graduates.ts). Signed-in alumni and members only, checked
 * here because layouts don't wrap route handlers.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const alum = await currentAlumnus();
  const member = alum ? null : await getCurrentProfile();
  if (!alum && member?.role !== "member") return new NextResponse("Not found", { status: 404 });
  const env = await hubEnv();
  const path = await alumniPhotoPath(env.DB, id);
  const obj = path ? await env.FILES.get(`photos/${path}`) : null;
  if (!obj) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}
