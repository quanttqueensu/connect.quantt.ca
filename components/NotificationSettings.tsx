import { saveNotificationSettings } from "@/lib/actions/notifications";
import { PrimaryButton } from "@/components/Form";
import type { NotificationKind, NotificationPrefs } from "@/lib/notifications";

const LABELS: Record<NotificationKind, string> = {
  messages: "New messages",
  applications: "New applications to our jobs",
  application_updates: "Updates to my applications",
  new_jobs: "New jobs posted",
};

const SHOWN: Record<"member" | "company_user", NotificationKind[]> = {
  member: ["messages", "application_updates", "new_jobs"],
  company_user: ["messages", "applications"],
};

export default function NotificationSettings({
  prefs,
  role,
  saved,
  disabled,
  setup,
}: {
  prefs: NotificationPrefs;
  role: "member" | "company_user";
  saved?: boolean;
  disabled?: boolean;
  /** The one-time setup step: no section chrome, and saving continues into Connect. */
  setup?: boolean;
}) {
  const form = (
    <form action={saveNotificationSettings} className={setup ? "space-y-3" : "mt-3 space-y-2"}>
      {setup && <input type="hidden" name="setup" value="1" />}
      {SHOWN[role].map((k) => (
        <label key={k} className="flex items-center gap-3 text-sm text-ink">
          <input type="checkbox" name={k} defaultChecked={prefs[k]} className="h-4 w-4 accent-primary" />
          {LABELS[k]}
        </label>
      ))}
      <div className="flex items-center gap-3 pt-2">
        <PrimaryButton type="submit" disabled={disabled}>
          {setup ? "Save and continue" : "Save notifications"}
        </PrimaryButton>
        {saved && <span className="text-sm text-copy">Saved.</span>}
      </div>
    </form>
  );
  if (setup) return form;
  return (
    <section id="notifications" className="mt-6 max-w-xl scroll-mt-40 border-t border-line pt-5">
      <h2 className="font-heading text-lg font-bold text-ink">Email notifications</h2>
      <p className="mt-1 text-sm text-copy">Emails link back to Connect and never include message text.</p>
      {form}
    </section>
  );
}
