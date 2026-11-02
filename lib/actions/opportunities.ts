"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Admins hide a listing that isn't a fit (or show it again). The sync never unhides one. */
export async function setListingHidden(formData: FormData) {
  const profile = await requireProfile();
  if (!profile.is_admin) throw new Error("Only admins can hide listings");
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const hidden = formData.get("hidden") === "1";
  const { error } = await supabase.from("job_listings").update({ hidden }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/opportunities");
}

/**
 * A member marks a listing as applied: an off-platform application in their
 * tracker, linked to the listing (one per member and listing). Marking twice
 * is not an error.
 */
export async function markListingApplied(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "member") throw new Error("Members only");
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const { data: listing } = await supabase.from("job_listings").select("id, company, title, url").eq("id", id).maybeSingle();
  if (!listing) throw new Error("Listing not found");
  const l = listing as { id: string; company: string; title: string; url: string };
  const { error } = await supabase.from("applications").insert({
    member_id: profile.id,
    kind: "off_platform",
    company_name: l.company.slice(0, 200),
    notes: `${l.title}\n${l.url}`.slice(0, 2000),
    stage: "submitted",
    job_listing_id: l.id,
  });
  if (error && error.code !== "23505") throw new Error(error.message);
  revalidatePath("/opportunities");
  revalidatePath("/applications");
}

/** Undo "Mark applied": removes that tracker entry (only one made from a listing). */
export async function unmarkListingApplied(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "member") throw new Error("Members only");
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("member_id", profile.id)
    .eq("job_listing_id", id)
    .eq("kind", "off_platform");
  if (error) throw new Error(error.message);
  revalidatePath("/opportunities");
  revalidatePath("/applications");
}
