"use client";

import { useEffect } from "react";
import CopyLink from "@/components/CopyLink";
import { clearManualInvite } from "@/lib/actions/admin";

/**
 * Shows the temporary password for an account that was just CREATED because
 * the invite email could not be sent. It never belongs to an account that
 * already existed -- the invite path refuses those outright.
 *
 * The password is stashed in a short-lived cookie so it can survive the
 * redirect that lands here, and this component drops that cookie as soon as
 * it has rendered: on a shared exec laptop, reloading the page later must not
 * put a working credential back on screen.
 */
export default function ManualInviteBanner({
  email,
  password,
}: {
  email: string;
  password: string;
}) {
  useEffect(() => {
    void clearManualInvite();
  }, []);

  return (
    <div className="mb-8 border border-primary/20 p-5">
      <p className="text-sm text-primary">
        We could not email the invite (sending is rate-limited), so we created a new account for{" "}
        <span className="text-ink">{email}</span> with the temporary password below. Send it to
        them over a channel you trust — they will be asked to set their own password on first
        login.
      </p>
      <p className="mt-3 text-[11px] uppercase tracking-[2px] text-copy">
        Temporary password — shown once
      </p>
      <div className="mt-2">
        <CopyLink value={password} label="Copy password" />
      </div>
      <p className="mt-3 text-xs text-muted">
        Copy it now. Leaving or reloading this page clears it for good; if you lose it, they can
        use “Forgot your password?” on the login page instead.
      </p>
    </div>
  );
}
