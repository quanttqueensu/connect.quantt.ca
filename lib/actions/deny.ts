import { redirect } from "next/navigation";
import type { DenialCode } from "@/lib/denials";

/**
 * Refuse an action legibly. The code — never free text — is what travels in
 * the URL: Notice looks it up in DENIAL_MESSAGES and renders nothing for an
 * unknown code, so a crafted ?denied= link cannot put attacker copy inside the
 * hub's own banner. Never throws — redirect() unwinds via Next's control flow.
 */
export function denyRedirect(path: string, code: DenialCode): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}denied=${encodeURIComponent(code)}`);
}
