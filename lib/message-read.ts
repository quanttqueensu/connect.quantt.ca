import type { HubClient } from "@/lib/db/client";
import type { Profile } from "./types";

/**
 * Call only after authenticating the profile and authorizing the thread.
 * Reuse the request's cookie-bound client: Server Component after() callbacks
 * cannot read cookies themselves. Returning this promise keeps the write alive.
 */
export async function markConversationRead(
  supabase: HubClient,
  profile: Pick<Profile, "id" | "role">,
  conversationId: string,
) {
  const col =
    profile.role === "company_user" ? "company_last_read_at" : "member_last_read_at";
  const q = supabase
    .from("conversations")
    .update({ [col]: new Date().toISOString() })
    .eq("id", conversationId)
    .select("id");
  const { data, error } =
    profile.role === "company_user" ? await q : await q.eq("member_id", profile.id);
  if (error) throw new Error("Could not update conversation");
  // RLS can refuse an update without an error. A read marker is cosmetic,
  // so log the refusal rather than redirecting after the response was sent.
  if (!data?.length) {
    console.warn(
      `markRead: conversation ${conversationId} refused for profile ${profile.id}`,
    );
  }
}
