import { isPhotoPath } from "@/lib/storage-paths";
import { createClient } from "@/lib/supabase/server";
import { memberPhotoSrc } from "@/lib/files";

export { memberPhotoSrc };

/**
 * Photos are inlined in RSC HTML (directory, profile, member pages). Prefer
 * `memberPhotoSrc` so the markup holds a cookie-gated app route, not a
 * Storage signed URL. This helper remains for callers that already have a
 * path they can SELECT and need a short-lived object URL.
 */
export const PHOTO_SIGNED_URL_TTL_SECONDS = 120;

/** Short-lived photo URL for a path the caller can already SELECT. */
export async function signedPhotoUrl(path: string | null | undefined) {
  if (!path || !isPhotoPath(path, path.split("/")[0])) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage
    .from("photos")
    .createSignedUrl(path, PHOTO_SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}
