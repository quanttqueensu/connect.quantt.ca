"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { GhostButton, buttonClass } from "@/components/Form";

/**
 * `reset()` only re-renders the failed segment. These are Server Component
 * pages whose data load already failed, so a retry usually fails the same way
 * — always offer a route out as well.
 */
function homeFor(pathname: string) {
  if (pathname.startsWith("/admin")) return { href: "/admin", label: "Admin" };
  if (pathname.startsWith("/company")) return { href: "/company", label: "Company" };
  if (pathname.startsWith("/feed") || pathname.startsWith("/members")) {
    return { href: "/feed", label: "Feed" };
  }
  return { href: "/", label: "Home" };
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const home = homeFor(pathname ?? "/");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-5 py-20">
      <p className="text-xs uppercase tracking-wider text-primary">Error</p>
      <h1 className="mt-2 font-heading text-2xl font-bold text-ink">
        This page didn&apos;t load
      </h1>
      <p className="mt-4 text-sm text-copy">
        Nothing was saved. Retrying may not help — go back to {home.label} instead. If it keeps
        happening, send a QUANTT exec the reference below.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-copy">Reference: {error.digest}</p>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href={home.href} className={buttonClass("primary")}>
          Go to {home.label}
        </Link>
        <GhostButton type="button" onClick={reset}>
          Try again
        </GhostButton>
      </div>
    </div>
  );
}
