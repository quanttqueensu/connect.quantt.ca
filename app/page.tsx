"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Home() {
  useEffect(() => {
    if (window.location.hash.includes("access_token")) return;

    const supabase = createClient();
    void supabase.auth.getUser().then(({ data: { user } }) => {
      window.location.replace(user ? "/feed" : "/login");
    });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <p className="text-sm text-muted">Loading…</p>
    </div>
  );
}
