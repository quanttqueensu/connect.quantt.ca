import type { ReactNode } from "react";

/**
 * One sign-in page for everyone. Club members sign in through auth.quantt.ca,
 * the same Queen's sign-in as the calendar and the other QUANTT sites.
 * Sponsors and alumni type their email in one box and get a code
 * (`children`, the code form); lib/actions/auth.ts works out which they are.
 */
export default function LoginPanel({
  children,
  error,
  codeStep = false,
}: {
  children: ReactNode;
  error?: string;
  codeStep?: boolean;
}) {
  return (
    <div className="p-6 sm:p-8">
      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
      {!codeStep && (
        <>
          <h2 className="text-xl font-semibold text-ink">Club member</h2>
          <p className="mt-1 text-sm leading-6 text-copy">Same Queen&apos;s sign-in as the other QUANTT sites.</p>
          {/* The route handler redirects off-site, so this stays a plain link. */}
          <a
            href="/auth/quantt/start"
            className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded border border-primary bg-white px-4 py-3 text-center text-sm font-medium leading-6 text-primary transition-colors hover:bg-primary/5"
          >
            Sign in with your Queen&apos;s email
          </a>
          <div className="mt-6 flex items-center gap-3 text-xs text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
            Sponsor or alum
          </div>
        </>
      )}
      {children}
    </div>
  );
}
