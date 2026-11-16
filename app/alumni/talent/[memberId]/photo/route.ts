import { NextResponse } from "next/server";

import { currentAlumnus } from "@/lib/alumni/current";
import { memberPhotoPathForAlumni } from "@/lib/alumni/talent";
import { hubEnv } from "@/lib/hub/env";

/** A current member's headshot, for signed-in alumni (and admins previewing as one). */
export async function GET(_request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  if (!(await currentAlumnus())) return new NextResponse("Not found", { status: 404 });
  const env = await hubEnv();
  const path = await memberPhotoPathForAlumni(env.DB, memberId);
  const obj = path ? await env.FILES.get(`photos/${path}`) : null;
  if (!obj) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}
