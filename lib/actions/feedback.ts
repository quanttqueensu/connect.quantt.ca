"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";
import { notifyLater } from "@/lib/notify";
import { assertSponsorWriteAllowed } from "@/lib/sponsor-mode";
import {
  notifyNewFeedback,
  parseFeedbackKind,
  setFeedbackStatus,
  submitFeedback,
} from "@/lib/sponsor-feedback";
import { createClient } from "@/lib/supabase/server";
import { denyRedirect } from "./deny";

/**
 * A sponsor contact sends a request or feedback (Company → Feedback). The firm
 * comes from their own company_users row, never from the form. Read-only in
 * sponsor mode.
 */
export async function sendSponsorFeedback(formData: FormData) {
  const profile = await requireProfile();
  await assertSponsorWriteAllowed(profile);
  if (profile.role !== "company_user") throw new Error("Companies only");
  const supabase = await createClient();
  const { data: cu } = await supabase
    .from("company_users")
    .select("company_id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!cu) throw new Error("No company on this account");

  const kind = parseFeedbackKind(formData.get("kind"));
  if (!kind) denyRedirect("/company/feedback", "feedback_kind");
  const { DB } = await hubEnv();
  const res = await submitFeedback(DB, {
    companyId: cu.company_id,
    profileId: profile.id,
    kind,
    body: String(formData.get("body") ?? ""),
  });
  if (!res.ok) denyRedirect("/company/feedback", res.code);
  notifyLater("sponsor feedback", (db, send) => notifyNewFeedback(db, send, res.id));
  revalidatePath("/company/feedback");
  revalidatePath("/admin/feedback");
  redirect("/company/feedback?sent=1");
}

async function requireAdmin() {
  const profile = await requireProfile();
  if (!profile.is_admin) throw new Error("Admins only");
  return profile;
}

/** Admin → Feedback: mark an item done, or reopen it. */
export async function setSponsorFeedbackStatus(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = formData.get("status") === "done" ? "done" : "open";
  if (id) await setFeedbackStatus((await hubEnv()).DB, id, status, admin.id);
  revalidatePath("/admin/feedback");
  revalidatePath("/company/feedback");
}
