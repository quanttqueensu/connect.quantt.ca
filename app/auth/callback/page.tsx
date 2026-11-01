"use client";

import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { markMustSetPassword } from "@/lib/actions/auth";
import {
  authCallbackNeedsPassword,
  parseAuthHash,
  userNeedsPassword,
} from "@/lib/auth-session";
import { createClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const token_hash = url.searchParams.get("token_hash");
      const typeParam = url.searchParams.get("type");
      const hash = parseAuthHash(url.hash);
      const type = (typeParam || hash.type) as EmailOtpType | null;

      try {
        if (hash.error) {
          throw new Error("login_link_expired");
        }

        let exchanged = false;
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          exchanged = true;
        } else if (token_hash && type) {
          const { error } = await supabase.auth.verifyOtp({ token_hash, type });
          if (error) throw error;
          exchanged = true;
        } else if (hash.access_token && hash.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: hash.access_token,
            refresh_token: hash.refresh_token,
          });
          if (error) throw error;
          exchanged = true;
        } else {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (!session) throw new Error("login_link_expired");
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("login_link_expired");

        const needsPassword = authCallbackNeedsPassword({
          exchanged,
          type,
          next: url.searchParams.get("next"),
          userMustSetPassword: userNeedsPassword(user),
        });
        if (needsPassword && exchanged) {
          try {
            await markMustSetPassword();
          } catch {
            // Session is already established. Missing service-role metadata
            // must not throw away a working invite/recovery link.
          }
        }

        window.location.replace(needsPassword ? "/auth/set-password" : "/");
      } catch {
        if (cancelled) return;
        setMessage("That sign-in link didn't work.");
        window.location.replace("/login?error=login_link_expired");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
