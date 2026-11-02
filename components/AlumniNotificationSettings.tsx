import { PrimaryButton } from "@/components/Form";
import { saveAlumniNotifications } from "@/lib/actions/alumni";
import type { AlumniNotificationPrefs } from "@/lib/alumni/data";

/** Alumni email settings, on the profile page and at the one-time /alumni/setup step. */
export default function AlumniNotificationSettings({
  prefs,
  saved,
  setup,
}: {
  prefs: AlumniNotificationPrefs;
  saved?: boolean;
  setup?: boolean;
}) {
  return (
    <form action={saveAlumniNotifications} className="space-y-3">
      {setup && <input type="hidden" name="setup" value="1" />}
      <label className="flex items-center gap-3 text-sm text-ink">
        <input type="checkbox" name="requests" defaultChecked={prefs.requests} className="h-4 w-4 accent-primary" />
        Message requests from members
      </label>
      <label className="flex items-center gap-3 text-sm text-ink">
        <input type="checkbox" name="messages" defaultChecked={prefs.messages} className="h-4 w-4 accent-primary" />
        New messages in my conversations
      </label>
      <div className="flex items-center gap-3 pt-2">
        <PrimaryButton type="submit">{setup ? "Save and continue" : "Save notifications"}</PrimaryButton>
        {saved && <span className="text-sm text-copy">Saved.</span>}
      </div>
    </form>
  );
}
