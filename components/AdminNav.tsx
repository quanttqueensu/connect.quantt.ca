"use client";

import ConnectBrand from "@/components/ConnectBrand";
import ViewAsSwitch from "@/components/ViewAsSwitch";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { buttonClass } from "@/components/Form";

// Invites and alumni live on People; join requests and tiers on Companies.
const LINKS = [
  { href: "/admin/people", label: "People" },
  { href: "/admin/companies", label: "Companies" },
  { href: "/admin/posts", label: "Posts" },
  { href: "/admin/applications", label: "Applications" },
  { href: "/admin/feedback", label: "Feedback" },
];

export default function AdminNav({
  sponsorMode = false,
  openFeedback = 0,
}: {
  sponsorMode?: boolean;
  /** Open sponsor feedback items, shown as a dot on Feedback. */
  openFeedback?: number;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="hub-nav">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-2.5 sm:px-8 sm:py-3 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
        <Link href="/admin" className="flex shrink-0 items-center gap-2.5 self-start">
          <ConnectBrand admin />
        </Link>
        <div
          className="flex min-w-0 max-w-full items-center gap-5 overflow-x-auto p-1"
          onFocus={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
        >
          {LINKS.map((link) => {
            const active =
              pathname === link.href ||
              pathname.startsWith(`${link.href}/`) ||
              (link.href === "/admin/companies" && pathname.startsWith("/admin/tiers"));
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className="hub-nav-link relative"
              >
                {link.label}
                {link.href === "/admin/feedback" && openFeedback > 0 && (
                  <>
                    <span aria-hidden="true" className="absolute -right-2 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    <span className="sr-only"> ({openFeedback} open)</span>
                  </>
                )}
              </Link>
            );
          })}
          <div className="ml-1 flex shrink-0 items-center gap-2 border-l border-line pl-4">
            <ViewAsSwitch
              current={
                sponsorMode || pathname.startsWith("/admin/sponsor-mode")
                  ? "sponsor"
                  : pathname.startsWith("/admin/alumni-mode")
                    ? "alum"
                    : "admin"
              }
            />
            <form action={logout}>
              <button type="submit" className={buttonClass("nav")}>
                Log out
              </button>
            </form>
          </div>
        </div>
      </div>
    </nav>
  );
}
