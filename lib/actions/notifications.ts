"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { hubEnv } from "@/lib/hub/env";
import { DEFAULT_PREFS, getPrefs, NOTIFICATION_KINDS, savePrefs, type NotificationKind } from "@/lib/notifications";
import { assertSponsorWriteAllowed } from "@/lib/sponsor-mode";
import { setWatchingFeedback } from "@/lib/sponsor-feedback";

/** Which settings each kind of account sees; the rest keep their saved value. */
const SHOWN: Record<"member" | "company_user", NotificationKind[]> = {
  member: ["messages", "application_updates", "new_jobs"],
  company_user: ["messages", "applications"],
};

export async function saveNotificationSettings(formData: FormData) {
  const profile = await requireProfile();
  await assertSponsorWriteAllowed(profile);
  const { DB } = await hubEnv();
  const current = await getPrefs(DB, profile.id).catch(() => ({ ...DEFAULT_PREFS }));
  const shown = new Set(SHOWN[profile.role]);
  const next = Object.fromEntries(
    NOTIFICATION_KINDS.map((k) => [k, shown.has(k) ? formData.get(k) === "on" : current[k]]),
  ) as Record<NotificationKind, boolean>;
  await savePrefs(DB, profile.id, next);
  // Admins also choose sponsor feedback emails here (the box is only shown to them).
  if (profile.is_admin && formData.get("sponsor_feedback_shown") === "1") {
    await setWatchingFeedback(DB, profile.id, formData.get("sponsor_feedback") === "on");
  }
  if (formData.get("setup") === "1") {
    revalidatePath("/", "layout");
    redirect(profile.role === "company_user" ? "/company" : "/feed");
  }
  const back = profile.role === "company_user" ? "/company/sponsorship" : "/profile";
  revalidatePath(back);
  redirect(`${back}?notifications=saved#notifications`);
}
