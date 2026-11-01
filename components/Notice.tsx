"use client";

import { useEffect } from "react";
import { DENIAL_MESSAGES } from "@/lib/denials";

/**
 * Renders a refusal message looked up from an opaque ?denied= code.
 *
 * The code is copied into the URL by denyRedirect, and it would otherwise sit
 * there for the rest of the session: every soft navigation and revalidation
 * would re-render a stale "You've already applied to that job". So after the
 * first paint we strip the param with history.replaceState -- no navigation,
 * no refetch, and the message simply stops rendering on the next render.
 *
 * Note the lookup must stay a lookup: an unrecognised (or attacker-supplied)
 * code renders nothing rather than putting URL text in the hub's own chrome.
 */
export default function Notice({ message }: { message?: string }) {
  const text = message ? DENIAL_MESSAGES[message] : undefined;

  useEffect(() => {
    if (!text) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("denied")) return;
    url.searchParams.delete("denied");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [text]);

  if (!text) return null;
  return (
    <p
      role="alert"
      className="mb-6 rounded border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-ink"
    >
      {text}
    </p>
  );
}
