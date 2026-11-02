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
