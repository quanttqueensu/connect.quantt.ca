import type { NextRequest } from "next/server";

import { verifyFileLink } from "@/lib/db/storage";
import { hubEnv } from "@/lib/hub/env";

/**
 * Streams a resume or photo from R2 for a link made by createSignedUrl
 * (lib/db/storage.ts). The signature is the permission: whoever made the link
 * already checked the viewer could see the file, as with Supabase's signed
 * URLs. Links expire, and any change to the path or expiry breaks them.
 */
export async function GET(request: NextRequest) {
  const env = await hubEnv();
  if (!env.FILES_SIGNING_KEY) return new Response("Not found", { status: 404 });
  const link = await verifyFileLink(env.FILES_SIGNING_KEY, request.nextUrl);
  if (!link) return new Response("Not found", { status: 404 });

  const object = await env.FILES.get(link.key);
  if (!object) return new Response("Not found", { status: 404 });

  const name = link.path.split("/").pop() ?? "file";
  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
    "Content-Length": String(object.size),
    "Content-Disposition": `${link.download ? "attachment" : "inline"}; filename="${name.replace(/[^\w.-]/g, "_")}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    // A file is never a page: no scripts even if someone uploads HTML as a "PDF".
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    "Referrer-Policy": "no-referrer",
  });
  return new Response(object.body, { headers });
}
