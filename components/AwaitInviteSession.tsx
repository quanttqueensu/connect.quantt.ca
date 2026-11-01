"use client";

import { useEffect, useState } from "react";

/** Invite tokens often arrive in the URL hash after a redirect to this page. */
export default function AwaitInviteSession() {
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!window.location.hash.includes("access_token")) {
        setMessage("Sign in link expired. Ask for a new invite.");
        window.location.replace("/login?error=login_link_expired");
      }
    }, 2500);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
