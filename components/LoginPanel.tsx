"use client";

import { useState, type ReactNode } from "react";

/**
 * Members sign in through auth.quantt.ca, the same Queen's sign-in as the
 * calendar and the other QUANTT sites. Sponsors get an emailed code
 * (`children`, the code form).
 */
export default function LoginPanel({
  children,
  error,
  initial = "member",
}: {
  children: ReactNode;
  error?: string;
  initial?: "member" | "sponsor";
}) {
  const [audience, setAudience] = useState<"member" | "sponsor">(initial);

  return (
    <div className="p-6 sm:p-10 lg:min-h-[43rem] lg:p-12">
      <div role="group" aria-label="Log in as" className="grid grid-cols-2 gap-1 rounded border border-line bg-surface p-1">
        {(["member", "sponsor"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={audience === option}
            onClick={() => setAudience(option)}
            className={`min-h-11 cursor-pointer rounded border px-4 py-2 text-sm font-medium transition-colors ${
              audience === option
                ? "border-primary bg-primary text-white"
                : "border-transparent text-copy hover:bg-white hover:text-primary"
            }`}
          >
            {option === "member" ? "Member" : "Sponsor"}
          </button>
        ))}
      </div>
      <h2 className="mt-7 text-xl font-semibold text-ink">
        {audience === "member" ? "Member login" : "Sponsor login"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-copy">
        {audience === "member"
          ? "Use the same Queen's sign-in as the other QUANTT sites."
          : "We'll email a sign-in code to your invited company address."}
      </p>
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      {audience === "member" && (
        <div className="mt-6">
          {/* The route handler redirects off-site, so this stays a plain link. */}
          <a
            href="/auth/quantt/start"
            className="inline-flex min-h-12 w-full items-center justify-center rounded border border-primary bg-white px-4 py-3 text-center text-sm font-medium leading-6 text-primary transition-colors hover:bg-primary/5"
          >
            Sign in with your Queen&apos;s email
          </a>
        </div>
      )}
      {audience === "sponsor" && children}
    </div>
  );
}
